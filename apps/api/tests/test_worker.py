"""The worker against a real PostgreSQL (ADR-0031, ADR-0033).

The worker claims the oldest ready job in the whole table, so like the queue's own tests
these need a queue nobody else is using, and say so instead of passing or failing by accident.
Everything committed is deleted with its owners afterwards.
"""

import logging
import signal
import threading
import time
import uuid
from collections.abc import Iterator
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import delete, func, insert, select, update

from syncaai.config import get_settings
from syncaai.db import get_session_factory
from syncaai.models import AiJob, AiUsage, PlanDraft, User
from syncaai.planning.context import PROMPT_VERSION, PlanPrompt
from syncaai.planning.generator import Generation, PlanGenerator, Repair, SampleGenerator
from syncaai.services.ai_queue import GAVE_UP, MAX_QUEUED, enqueue_plan
from syncaai.services.plan_drafts import expire_drafts
from syncaai.services.purge import PurgeReport
from syncaai.worker import PURGE_INTERVAL_SECONDS, SWEEP_INTERVAL_SECONDS, Worker, listen_url, main

pytestmark = pytest.mark.integration

REQUEST = "Plano de estudos para a prova"


@pytest.fixture
def people() -> Iterator[list[uuid.UUID]]:
    with get_session_factory()() as session:
        unfinished = session.scalar(
            select(func.count()).select_from(AiJob).where(AiJob.status.in_(("queued", "running")))
        )
        assert unfinished == 0, "the queue already has unfinished jobs; these tests need it empty"
        users = [
            User(email=f"worker-{uuid.uuid4()}@example.com", password_hash="not-a-real-hash")
            for _ in range(2)
        ]
        session.add_all(users)
        session.commit()
        ids = [user.id for user in users]
    try:
        yield ids
    finally:
        with get_session_factory()() as session:
            # Usage outlives an account on purpose (ADR-0041), so it is deleted by hand.
            session.execute(delete(AiUsage).where(AiUsage.user_id.in_(ids)))
            session.execute(delete(User).where(User.id.in_(ids)))
            session.commit()


def _worker(generator: PlanGenerator | None = None) -> Worker:
    return Worker(
        get_session_factory(),
        generator or SampleGenerator(),
        listen_url=listen_url(get_settings().database_url),
    )


def _enqueue(person: uuid.UUID) -> uuid.UUID:
    with get_session_factory()() as session:
        job = enqueue_plan(session, person, REQUEST, horizon_days=14)
        session.commit()
        return job.id


def _status(job_id: uuid.UUID) -> tuple[str, int]:
    with get_session_factory()() as session:
        job = session.get_one(AiJob, job_id)
        return job.status, job.attempts


def _has_draft(job_id: uuid.UUID) -> bool:
    with get_session_factory()() as session:
        draft = session.scalars(select(PlanDraft).where(PlanDraft.job_id == job_id)).one_or_none()
        return draft is not None and len(draft.items) == 3


def test_a_tick_runs_every_ready_job_to_a_draft(people: list[uuid.UUID]) -> None:
    jobs = [_enqueue(person) for person in people]

    assert _worker().tick() == 2

    assert [_status(job) for job in jobs] == [("done", 1), ("done", 1)]
    assert all(_has_draft(job) for job in jobs)


class _FailsOnce(SampleGenerator):
    def __init__(self) -> None:
        self.calls = 0

    def generate(self, prompt: PlanPrompt, *, repair: Repair | None = None) -> Generation:
        self.calls += 1
        if self.calls == 1:
            raise RuntimeError("the provider went away")
        return super().generate(prompt, repair=repair)


def test_a_job_that_raises_is_left_to_its_lock_and_the_next_one_still_runs(
    people: list[uuid.UUID], caplog: pytest.LogCaptureFixture
) -> None:
    first, second = (_enqueue(person) for person in people)

    with caplog.at_level(logging.ERROR, logger="syncaai.worker"):
        assert _worker(_FailsOnce()).tick() == 2

    assert _status(first) == ("running", 1)
    assert _status(second) == ("done", 1)
    assert f"job {first}, attempt 1: did not finish" in caplog.text


def test_a_tick_sweeps_what_can_no_longer_run_before_claiming(people: list[uuid.UUID]) -> None:
    dead = _enqueue(people[0])
    with get_session_factory()() as session:
        session.execute(
            update(AiJob)
            .where(AiJob.id == dead)
            .values(status="running", attempts=3, locked_until=func.now() - timedelta(seconds=1))
        )
        stale = enqueue_plan(session, people[1], REQUEST, horizon_days=14)
        session.flush()
        session.execute(
            update(AiJob)
            .where(AiJob.id == stale.id)
            .values(created_at=func.now() - MAX_QUEUED - timedelta(seconds=1))
        )
        session.commit()
        stale_id = stale.id
    ended = _draft(people[0], date(2020, 1, 1))

    assert _worker().tick() == 0

    assert _status(dead) == ("failed", 3)
    assert _status(stale_id) == ("failed", 0)
    with get_session_factory()() as session:
        assert session.get_one(AiJob, dead).failure_reason == GAVE_UP
        assert session.get_one(PlanDraft, ended).status == "expired"


def test_a_knock_wakes_the_worker_before_the_sweep_would(people: list[uuid.UUID]) -> None:
    """Enqueued once the worker is waiting: done well inside the five seconds the sweep would
    take, so it was the notification that woke it."""
    worker = _worker()
    thread = threading.Thread(target=worker.run, daemon=True)
    thread.start()
    time.sleep(0.5)

    job = _enqueue(people[0])
    queued_at = time.monotonic()
    while _status(job)[0] != "done" and time.monotonic() - queued_at < SWEEP_INTERVAL_SECONDS:
        time.sleep(0.05)
    elapsed = time.monotonic() - queued_at

    worker.stop()
    thread.join(timeout=SWEEP_INTERVAL_SECONDS + 1)
    assert not thread.is_alive(), "the worker did not stop within one interval"
    assert _status(job)[0] == "done"
    assert elapsed < SWEEP_INTERVAL_SECONDS - 2, elapsed


def test_a_worker_told_to_stop_claims_nothing(people: list[uuid.UUID]) -> None:
    job = _enqueue(people[0])
    worker = _worker()

    worker.stop()
    worker.run()

    assert _status(job) == ("queued", 0)


def test_the_worker_purges_on_its_first_tick_and_then_once_an_hour(
    people: list[uuid.UUID], monkeypatch: pytest.MonkeyPatch
) -> None:
    purges: list[object] = []
    monkeypatch.setattr(
        "syncaai.worker.purge", lambda session: purges.append(session) or PurgeReport(0, 0, 0, 0, 0)
    )
    readings = iter([0.0, 10.0, PURGE_INTERVAL_SECONDS - 1, PURGE_INTERVAL_SECONDS + 1])
    worker = Worker(
        get_session_factory(),
        SampleGenerator(),
        listen_url=listen_url(get_settings().database_url),
        monotonic=lambda: next(readings),
    )

    for _ in range(4):
        worker.tick()

    assert len(purges) == 2


# --- Drafts nobody acted on (ADR-0033) -----------------------------------------------------


def _draft(person: uuid.UUID, last_day: date, status: str = "pending") -> uuid.UUID:
    with get_session_factory()() as session:
        job_id = uuid.uuid4()
        session.execute(
            insert(AiJob).values(
                id=job_id,
                user_id=person,
                request=REQUEST,
                horizon_days=14,
                prompt_version=PROMPT_VERSION,
                status="done",
                finished_at=func.now(),
                chosen_answer=0,
            )
        )
        draft = PlanDraft(
            user_id=person,
            job_id=job_id,
            request=REQUEST,
            prompt_version=PROMPT_VERSION,
            first_day=last_day - timedelta(days=13),
            last_day=last_day,
            status=status,
            ended_at=None if status == "pending" else func.now(),
            idempotency_key="k" if status == "approved" else None,
        )
        session.add(draft)
        session.commit()
        return draft.id


def test_a_draft_expires_once_its_last_day_has_ended_where_its_owner_lives(
    people: list[uuid.UUID],
) -> None:
    """The same last day, two zones twenty-six hours apart: still today at UTC-12, already
    past at UTC+14."""
    behind, ahead = people
    with get_session_factory()() as session:
        session.execute(update(User).where(User.id == behind).values(timezone="Etc/GMT+12"))
        session.execute(update(User).where(User.id == ahead).values(timezone="Etc/GMT-14"))
        session.commit()
    today_behind = datetime.now(ZoneInfo("Etc/GMT+12")).date()
    still_alive = _draft(behind, today_behind)
    ended = _draft(ahead, today_behind)

    with get_session_factory()() as session:
        expired = expire_drafts(session)
        session.commit()

    assert expired == [ended]
    with get_session_factory()() as session:
        assert session.get_one(PlanDraft, still_alive).status == "pending"
        draft = session.get_one(PlanDraft, ended)
        assert draft.status == "expired" and draft.ended_at is not None


def test_only_a_pending_draft_expires(people: list[uuid.UUID]) -> None:
    long_ago = date(2020, 1, 1)
    approved = _draft(people[0], long_ago, status="approved")
    discarded = _draft(people[1], long_ago, status="discarded")

    with get_session_factory()() as session:
        assert expire_drafts(session) == []
        session.rollback()

    with get_session_factory()() as session:
        assert session.get_one(PlanDraft, approved).status == "approved"
        assert session.get_one(PlanDraft, discarded).status == "discarded"


# --- Starting it ---------------------------------------------------------------------------


def test_the_listener_addresses_the_same_database_through_psycopg() -> None:
    assert (
        listen_url("postgresql+psycopg://user:secret@db:5432/syncaai")
        == "postgresql://user:secret@db:5432/syncaai"
    )


def test_main_stops_the_worker_on_sigterm_and_on_ctrl_c(monkeypatch: pytest.MonkeyPatch) -> None:
    previous = signal.getsignal(signal.SIGTERM), signal.getsignal(signal.SIGINT)
    seen: list[object] = []

    def run(worker: Worker) -> None:
        seen.extend(
            [worker.stop, signal.getsignal(signal.SIGTERM), signal.getsignal(signal.SIGINT)]
        )

    monkeypatch.setattr(Worker, "run", run)
    try:
        main()
    finally:
        signal.signal(signal.SIGTERM, previous[0])
        signal.signal(signal.SIGINT, previous[1])

    stop, on_term, on_interrupt = seen
    assert on_term == stop and on_interrupt == stop
