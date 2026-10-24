"""The AI job queue against a real PostgreSQL (ADR-0031, ADR-0033, ADR-0036).

What only the database can show: that two workers claiming at once take different jobs
without waiting for each other, that the notification arrives only when the job is
committed, and that every CHECK refuses a job that contradicts its own state.

The claim takes the oldest ready job in the whole table, so these tests need a queue nobody
else is using. The fixture says so and fails, rather than letting a stray job from a manual
session make a test pass or fail by accident. Jobs that two connections must see are
committed, and everything a test commits is deleted with its owners afterwards.
"""

import uuid
from collections.abc import Iterator
from datetime import timedelta
from typing import Any

import psycopg
import pytest
from sqlalchemy import delete, func, insert, select, text, update
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from syncaai.config import get_settings
from syncaai.db import get_session_factory
from syncaai.errors import PlanInProgressError
from syncaai.models import AiJob, AiJobAnswer, User
from syncaai.planning.context import PROMPT_VERSION
from syncaai.services.ai_queue import (
    CHANNEL,
    GAVE_UP,
    MAX_QUEUED,
    VISIBILITY_TIMEOUT,
    WAITED_TOO_LONG,
    claim_next,
    enqueue_plan,
    sweep,
)

pytestmark = pytest.mark.integration

REQUEST = "Plano de estudos para a prova de sábado"


@pytest.fixture
def owners() -> Iterator[list[uuid.UUID]]:
    """Three committed accounts, deleted afterwards with every job they own."""
    with get_session_factory()() as session:
        unfinished = session.scalar(
            select(func.count()).select_from(AiJob).where(AiJob.status.in_(("queued", "running")))
        )
        assert unfinished == 0, "the queue already has unfinished jobs; these tests need it empty"
        users = [
            User(email=f"queue-{uuid.uuid4()}@example.com", password_hash="not-a-real-hash")
            for _ in range(3)
        ]
        session.add_all(users)
        session.commit()
        ids = [user.id for user in users]
    try:
        yield ids
    finally:
        with get_session_factory()() as session:
            session.execute(delete(User).where(User.id.in_(ids)))
            session.commit()


def _job(session: Session, owner: uuid.UUID, **state: Any) -> uuid.UUID:
    """A job inserted through SQL, in whatever state the test needs."""
    row = {
        "id": uuid.uuid4(),
        "user_id": owner,
        "request": REQUEST,
        "horizon_days": 14,
        "prompt_version": PROMPT_VERSION,
        **state,
    }
    session.execute(insert(AiJob).values(**row))
    return row["id"]


def _ago(delta: timedelta) -> Any:
    return func.now() - delta


# --- Enqueueing ----------------------------------------------------------------------------


def test_a_plan_is_queued_with_its_request_and_the_prompt_version(
    owners: list[uuid.UUID],
) -> None:
    with get_session_factory()() as session:
        job = enqueue_plan(session, owners[0], REQUEST, horizon_days=7)
        session.commit()

        assert (job.status, job.kind, job.attempts) == ("queued", "plan", 0)
        assert (job.request, job.horizon_days, job.prompt_version) == (REQUEST, 7, PROMPT_VERSION)


def test_a_second_plan_while_one_is_in_progress_is_refused_by_the_index(
    owners: list[uuid.UUID],
) -> None:
    """The refusal leaves the caller's transaction usable: the first job is still there."""
    with get_session_factory()() as session:
        first = enqueue_plan(session, owners[0], REQUEST, horizon_days=14)

        with pytest.raises(PlanInProgressError):
            enqueue_plan(session, owners[0], "Outro plano", horizon_days=14)

        session.commit()
        assert session.scalars(select(AiJob.id).where(AiJob.user_id == owners[0])).all() == [
            first.id
        ]


def test_any_other_refusal_is_not_mistaken_for_a_plan_in_progress(
    owners: list[uuid.UUID],
) -> None:
    """Only the index's name becomes the friendly error. A request past its bound is a defect
    upstream, and it surfaces as the database's refusal rather than as a 409."""
    with get_session_factory()() as session:
        with pytest.raises(IntegrityError, match="ck_ai_jobs_request_length"):
            enqueue_plan(session, owners[0], "x" * 501, horizon_days=14)
        session.rollback()


@pytest.mark.parametrize("status", ["running", "queued"])
def test_the_index_holds_whichever_state_the_job_in_progress_is_in(
    owners: list[uuid.UUID], status: str
) -> None:
    with get_session_factory()() as session:
        lock = _ago(-VISIBILITY_TIMEOUT) if status == "running" else None
        _job(session, owners[0], status=status, locked_until=lock)

        with pytest.raises(IntegrityError, match="ux_ai_jobs_one_in_progress"):
            _job(session, owners[0])
        session.rollback()


@pytest.mark.parametrize(
    ("status", "finished"),
    [("done", {"chosen_answer": 0}), ("failed", {"failure_reason": GAVE_UP})],
)
def test_a_finished_plan_does_not_stop_the_next_one(
    owners: list[uuid.UUID], status: str, finished: dict[str, Any]
) -> None:
    with get_session_factory()() as session:
        _job(session, owners[0], status=status, finished_at=func.now(), **finished)

        job = enqueue_plan(session, owners[0], REQUEST, horizon_days=14)

        assert job.status == "queued"
        session.rollback()


def test_the_worker_is_woken_only_once_the_job_is_committed(owners: list[uuid.UUID]) -> None:
    """And the knock carries nothing: no part of a request travels on the channel."""
    url = make_url(get_settings().database_url).set(drivername="postgresql")
    with psycopg.connect(url.render_as_string(hide_password=False), autocommit=True) as listener:
        listener.execute(f"LISTEN {CHANNEL}")

        with get_session_factory()() as session:
            enqueue_plan(session, owners[0], REQUEST, horizon_days=14)
            session.flush()
            assert list(listener.notifies(timeout=0.5)) == []

            session.commit()
            [knock] = list(listener.notifies(timeout=2, stop_after=1))

    assert (knock.channel, knock.payload) == (CHANNEL, "")


# --- Claiming ------------------------------------------------------------------------------


def test_the_oldest_ready_job_is_claimed_and_locked(owners: list[uuid.UUID]) -> None:
    with get_session_factory()() as session:
        newer = _job(session, owners[0], created_at=_ago(timedelta(minutes=1)))
        older = _job(session, owners[1], created_at=_ago(timedelta(minutes=2)))

        job = claim_next(session)

        assert job is not None and job.id == older
        assert (job.status, job.attempts) == ("running", 1)
        lock = session.scalar(select(AiJob.locked_until - func.now()).where(AiJob.id == older))
        assert lock == VISIBILITY_TIMEOUT
        following = claim_next(session)
        assert following is not None and following.id == newer
        assert claim_next(session) is None
        session.rollback()


def test_two_workers_claiming_at_once_take_different_jobs_without_waiting(
    owners: list[uuid.UUID],
) -> None:
    """The second worker does not block on the row the first holds. ``lock_timeout`` turns a
    regression to plain ``FOR UPDATE`` into a failure in two seconds rather than a hang."""
    with get_session_factory()() as session:
        jobs = {
            _job(session, owners[0], created_at=_ago(timedelta(minutes=2))),
            _job(session, owners[1], created_at=_ago(timedelta(minutes=1))),
        }
        session.commit()

    factory = get_session_factory()
    with factory() as first, factory() as second:
        second.execute(text("SET LOCAL lock_timeout = '2s'"))
        taken_first = claim_next(first)
        taken_second = claim_next(second)
        assert taken_first is not None and taken_second is not None
        claimed = {taken_first.id, taken_second.id}
        first.commit()
        second.commit()

    assert claimed == jobs


def test_a_job_whose_worker_died_is_claimed_again_and_the_attempt_counted(
    owners: list[uuid.UUID],
) -> None:
    with get_session_factory()() as session:
        job_id = _job(
            session,
            owners[0],
            status="running",
            attempts=1,
            locked_until=_ago(timedelta(seconds=1)),
        )

        # It has attempts left, so the sweep leaves it for a worker to take back.
        assert sweep(session) == []
        job = claim_next(session)

        assert job is not None and (job.id, job.attempts) == (job_id, 2)
        session.rollback()


def test_a_job_still_held_by_a_live_worker_is_left_alone(owners: list[uuid.UUID]) -> None:
    with get_session_factory()() as session:
        _job(
            session, owners[0], status="running", attempts=1, locked_until=_ago(-VISIBILITY_TIMEOUT)
        )

        assert claim_next(session) is None
        assert sweep(session) == []
        session.rollback()


# --- Sweeping ------------------------------------------------------------------------------


def test_a_job_queued_too_long_is_not_claimed_but_failed(owners: list[uuid.UUID]) -> None:
    """Claimed before the sweep runs, so the claim is what passes over the older job: the
    sweep is not what keeps it from running late."""
    with get_session_factory()() as session:
        stale = _job(session, owners[0], created_at=_ago(MAX_QUEUED + timedelta(seconds=1)))
        fresh = _job(session, owners[1], created_at=_ago(MAX_QUEUED - timedelta(seconds=30)))
        waiting = _job(session, owners[2])

        claimed = claim_next(session)
        assert claimed is not None and claimed.id == fresh
        assert sweep(session) == [stale]
        assert session.scalar(select(AiJob.status).where(AiJob.id == waiting)) == "queued"

        job = session.get(AiJob, stale)
        assert job is not None
        session.refresh(job)
        assert (job.status, job.failure_reason) == ("failed", WAITED_TOO_LONG)
        assert job.finished_at is not None
        session.rollback()


def test_a_job_that_died_on_its_last_attempt_is_not_claimed_but_failed(
    owners: list[uuid.UUID],
) -> None:
    with get_session_factory()() as session:
        dead = _job(
            session,
            owners[0],
            status="running",
            attempts=3,
            locked_until=_ago(timedelta(seconds=1)),
        )

        assert claim_next(session) is None
        assert sweep(session) == [dead]

        job = session.get(AiJob, dead)
        assert job is not None
        session.refresh(job)
        assert (job.status, job.failure_reason, job.locked_until) == ("failed", GAVE_UP, None)
        session.rollback()


# --- What the table refuses ----------------------------------------------------------------


@pytest.mark.parametrize(
    ("state", "constraint"),
    [
        ({"kind": "chat"}, "ck_ai_jobs_kind"),
        ({"status": "paused"}, "ck_ai_jobs_status"),
        ({"horizon_days": 0}, "ck_ai_jobs_horizon"),
        ({"horizon_days": 15}, "ck_ai_jobs_horizon"),
        ({"attempts": 4}, "ck_ai_jobs_attempts"),
        ({"request": ""}, "ck_ai_jobs_request_length"),
        ({"request": "x" * 501}, "ck_ai_jobs_request_length"),
        ({"request": None}, "ck_ai_jobs_request_kept_until_finished"),
        ({"status": "running"}, "ck_ai_jobs_running_is_locked"),
        ({"finished_at": func.now()}, "ck_ai_jobs_finished_when_done_or_failed"),
        (
            {"status": "failed", "finished_at": func.now()},
            "ck_ai_jobs_reason_when_failed",
        ),
        ({"failure_reason": GAVE_UP}, "ck_ai_jobs_reason_when_failed"),
        (
            {"status": "done", "finished_at": func.now()},
            "ck_ai_jobs_answer_when_done",
        ),
        ({"chosen_answer": 0}, "ck_ai_jobs_answer_when_done"),
        ({"context_fingerprint": "not-a-digest"}, "ck_ai_jobs_context_fingerprint_shape"),
        ({"context_fingerprint": "AB" * 32}, "ck_ai_jobs_context_fingerprint_shape"),
        (
            {
                "status": "done",
                "finished_at": func.now(),
                "chosen_answer": 0,
                "request": None,
                "context_fingerprint": "ab" * 32,
            },
            "ck_ai_jobs_context_fingerprint_with_its_request",
        ),
        (
            {"status": "done", "finished_at": func.now(), "chosen_answer": 2},
            "ck_ai_jobs_chosen_answer",
        ),
    ],
)
def test_a_job_that_contradicts_its_own_state_is_refused(
    owners: list[uuid.UUID], state: dict[str, Any], constraint: str
) -> None:
    with get_session_factory()() as session:
        with pytest.raises(IntegrityError, match=constraint):
            _job(session, owners[0], **state)
        session.rollback()


def test_a_finished_job_may_lose_its_request_to_the_purge(owners: list[uuid.UUID]) -> None:
    with get_session_factory()() as session:
        job_id = _job(session, owners[0], status="done", finished_at=func.now(), chosen_answer=1)

        session.execute(update(AiJob).where(AiJob.id == job_id).values(request=None))

        assert session.scalar(select(AiJob.request).where(AiJob.id == job_id)) is None
        session.rollback()


def _answer(session: Session, job_id: uuid.UUID, position: int) -> None:
    session.execute(
        insert(AiJobAnswer).values(job_id=job_id, position=position, raw="{}", model="fake")
    )


def test_a_job_holds_its_answer_and_one_repair_and_never_a_third(
    owners: list[uuid.UUID],
) -> None:
    with get_session_factory()() as session:
        job_id = _job(session, owners[0])
        _answer(session, job_id, 0)
        _answer(session, job_id, 1)

        with (
            pytest.raises(IntegrityError, match="ck_ai_job_answers_position"),
            session.begin_nested(),
        ):
            _answer(session, job_id, 2)
        with pytest.raises(IntegrityError, match="pk_ai_job_answers"), session.begin_nested():
            _answer(session, job_id, 1)
        session.rollback()


def test_a_job_s_answers_go_with_it(owners: list[uuid.UUID]) -> None:
    with get_session_factory()() as session:
        job_id = _job(session, owners[0])
        _answer(session, job_id, 0)

        session.execute(delete(AiJob).where(AiJob.id == job_id))

        remaining = select(func.count()).select_from(AiJobAnswer)
        assert session.scalar(remaining.where(AiJobAnswer.job_id == job_id)) == 0
        session.rollback()
