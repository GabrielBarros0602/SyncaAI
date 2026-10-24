"""Running a plan job end to end, against a real PostgreSQL and a scripted model.

Each test claims one job, scripts what the model answers, and asserts what was written: the
draft and its rows, the answers, and the job's end. The job is marked running directly rather
than through the claim, so these tests do not depend on what else is in the queue; the claim
has its own tests. Everything committed is deleted with its owner afterwards.
"""

import json
import uuid
from collections.abc import Iterator
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from syncaai.db import get_session_factory
from syncaai.models import (
    AiJob,
    AiJobAnswer,
    AiUsage,
    PlanDraft,
    PlanDraftDiscard,
    PlanDraftItem,
    PlanDraftItemLink,
    PlanDraftItemPrerequisite,
    Task,
    User,
)
from syncaai.planning.context import PROMPT_VERSION, PlanPrompt
from syncaai.planning.generator import FakeGenerator, Generation, Repair
from syncaai.planning.ladder import NO_USABLE_PLAN
from syncaai.services.ai_queue import VISIBILITY_TIMEOUT, enqueue_plan
from syncaai.services.plan_jobs import PLAN_IN_PROGRESS, Outcome, run_plan_job

pytestmark = pytest.mark.integration

SAO_PAULO = ZoneInfo("America/Sao_Paulo")
# A Wednesday at noon in São Paulo: free from 12:05 to the window's end at 22:00.
WEDNESDAY_NOON = datetime(2031, 6, 4, 12, 0, tzinfo=SAO_PAULO).astimezone(timezone.utc)
SUNDAY_NIGHT = datetime(2031, 6, 8, 21, 0, tzinfo=SAO_PAULO).astimezone(timezone.utc)
REQUEST = "Plano para aprender JOINs em SQL"


def _local(day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(2031, 6, day, hour, minute, tzinfo=SAO_PAULO)


def _item(title: str, minutes: int = 45, **fields: Any) -> dict[str, Any]:
    return {
        "title": title,
        "description": "",
        "estimated_minutes": minutes,
        "depends_on": [],
        "links": [],
        **fields,
    }


THREE_STEPS = json.dumps(
    {
        "items": [
            _item(
                "Ler o capítulo de JOINs",
                description="O capítulo 6 inteiro.",
                links=[{"label": "SQLBolt", "url": "https://sqlbolt.com/lesson/6"}],
            ),
            _item("Exercícios de JOINs", depends_on=[0]),
            _item("Projeto", depends_on=[1]),
        ]
    }
)
# The third step takes longer than the block of sixty: two of three kept.
TWO_OF_THREE = json.dumps(
    {"items": [_item("Ler"), _item("Exercícios"), _item("Projeto", minutes=300)]}
)
NOT_A_PLAN = "Here is your plan."


@pytest.fixture
def person() -> Iterator[uuid.UUID]:
    with get_session_factory()() as session:
        user = User(email=f"jobs-{uuid.uuid4()}@example.com", password_hash="not-a-real-hash")
        session.add(user)
        session.commit()
        user_id = user.id
    try:
        yield user_id
    finally:
        with get_session_factory()() as session:
            # Usage outlives an account on purpose (ADR-0041), so it is deleted by hand.
            session.execute(delete(AiUsage).where(AiUsage.user_id == user_id))
            session.execute(delete(User).where(User.id == user_id))
            session.commit()


def _claimed(person: uuid.UUID, *, horizon_days: int = 14) -> uuid.UUID:
    with get_session_factory()() as session:
        job = enqueue_plan(session, person, REQUEST, horizon_days=horizon_days)
        session.commit()
        session.execute(
            update(AiJob)
            .where(AiJob.id == job.id)
            .values(status="running", attempts=1, locked_until=func.now() + VISIBILITY_TIMEOUT)
        )
        session.commit()
        return job.id


def _run(job_id: uuid.UUID, generator: FakeGenerator, now: datetime = WEDNESDAY_NOON) -> Outcome:
    return run_plan_job(get_session_factory(), generator, job_id, attempt=1, clock=lambda: now)


def _draft(session: Session, job_id: uuid.UUID) -> PlanDraft | None:
    return session.scalars(select(PlanDraft).where(PlanDraft.job_id == job_id)).one_or_none()


def _answers(session: Session, job_id: uuid.UUID) -> list[AiJobAnswer]:
    statement = (
        select(AiJobAnswer).where(AiJobAnswer.job_id == job_id).order_by(AiJobAnswer.position)
    )
    return list(session.scalars(statement).all())


def _usage(session: Session, job_id: uuid.UUID) -> list[AiUsage]:
    statement = select(AiUsage).where(AiUsage.job_id == job_id).order_by(AiUsage.position)
    return list(session.scalars(statement).all())


def test_a_clean_answer_becomes_a_pending_draft_placed_in_free_time(person: uuid.UUID) -> None:
    """Queued under an older prompt, the job ends recording the version it was built with."""
    job_id = _claimed(person)
    with get_session_factory()() as session:
        session.execute(update(AiJob).where(AiJob.id == job_id).values(prompt_version="plan-0"))
        session.commit()

    assert _run(job_id, FakeGenerator([THREE_STEPS])) is Outcome.DONE

    with get_session_factory()() as session:
        job = session.get_one(AiJob, job_id)
        assert (job.status, job.chosen_answer, job.locked_until) == ("done", 0, None)
        assert job.finished_at is not None and job.prompt_version == PROMPT_VERSION
        [answer] = _answers(session, job_id)
        assert (answer.raw, answer.errors, answer.model) == (THREE_STEPS, [], "fake")

        draft = _draft(session, job_id)
        assert draft is not None
        assert (draft.status, draft.request, draft.user_id) == ("pending", REQUEST, person)
        assert (draft.first_day, draft.last_day) == (
            _local(4, 0).date(),
            _local(17, 0).date(),
        )
        assert [(i.title, i.start_at, i.placement) for i in draft.items] == [
            ("Ler o capítulo de JOINs", _local(4, 12, 5), "placed"),
            ("Exercícios de JOINs", _local(4, 12, 50), "placed"),
            ("Projeto", _local(4, 13, 35), "placed"),
        ]
        first, second, third = draft.items
        assert first.description == "O capítulo 6 inteiro."
        assert [(link.label, link.url) for link in first.links] == [
            ("SQLBolt", "https://sqlbolt.com/lesson/6")
        ]
        prerequisites = session.execute(
            select(
                PlanDraftItemPrerequisite.item_id, PlanDraftItemPrerequisite.prerequisite_id
            ).where(PlanDraftItemPrerequisite.draft_id == draft.id)
        ).all()
        assert set(prerequisites) == {(second.id, first.id), (third.id, second.id)}
        assert draft.discards == []


def test_after_a_repair_both_answers_are_kept_and_the_better_one_used(
    person: uuid.UUID,
) -> None:
    job_id = _claimed(person)

    assert _run(job_id, FakeGenerator([TWO_OF_THREE, THREE_STEPS])) is Outcome.DONE

    with get_session_factory()() as session:
        assert session.get_one(AiJob, job_id).chosen_answer == 1
        first, repair = _answers(session, job_id)
        assert first.errors == [
            "items[2]: it takes 300 minutes, and a step has to take between 15 and 60"
        ]
        assert repair.errors == []
        draft = _draft(session, job_id)
        assert draft is not None and len(draft.items) == 3 and draft.discards == []


def test_every_call_a_job_makes_is_recorded_with_whose_it_was(person: uuid.UUID) -> None:
    job_id = _claimed(person)

    _run(job_id, FakeGenerator([TWO_OF_THREE, THREE_STEPS]))

    with get_session_factory()() as session:
        calls = _usage(session, job_id)
    assert [(call.position, call.outcome) for call in calls] == [
        (0, "completed"),
        (1, "completed"),
    ]
    for call in calls:
        assert (call.user_id, call.attempt, call.provider, call.model) == (
            person,
            1,
            "fake",
            "fake",
        )
        assert call.prompt_version == PROMPT_VERSION
        assert (call.input_tokens, call.output_tokens, call.cost_usd) == (0, 0, 0)
        assert call.latency_ms >= 0


def test_a_call_that_raises_is_counted_and_the_job_left_to_its_lock(person: uuid.UUID) -> None:
    """A provider can bill a call that failed here, so it is counted before the error goes on
    to leave the job running for its lock to run out (ADR-0031, ADR-0041)."""
    job_id = _claimed(person)

    with pytest.raises(RuntimeError, match="not scripted"):
        _run(job_id, FakeGenerator([]))

    with get_session_factory()() as session:
        assert session.get_one(AiJob, job_id).status == "running"
        [call] = _usage(session, job_id)
    assert (call.outcome, call.error, call.model) == ("failed", "RuntimeError", "fake")
    # Charged at its estimate, which for a free model is nothing (ADR-0044).
    assert (call.input_tokens, call.output_tokens, call.cost_usd) == (None, None, 0)


def test_a_worse_repair_leaves_the_first_answer_and_its_discards(person: uuid.UUID) -> None:
    job_id = _claimed(person)

    assert _run(job_id, FakeGenerator([TWO_OF_THREE, NOT_A_PLAN])) is Outcome.DONE

    with get_session_factory()() as session:
        assert session.get_one(AiJob, job_id).chosen_answer == 0
        draft = _draft(session, job_id)
        assert draft is not None
        assert [item.title for item in draft.items] == ["Ler", "Exercícios"]
        [discard] = draft.discards
        assert (discard.position, discard.title) == (2, "Projeto")
        assert discard.reasons == ["it takes 300 minutes, and a step has to take between 15 and 60"]


def test_with_nothing_usable_the_job_fails_visibly_and_keeps_both_answers(
    person: uuid.UUID,
) -> None:
    job_id = _claimed(person)

    assert _run(job_id, FakeGenerator([NOT_A_PLAN, NOT_A_PLAN])) is Outcome.FAILED

    with get_session_factory()() as session:
        job = session.get_one(AiJob, job_id)
        assert (job.status, job.failure_reason, job.chosen_answer) == (
            "failed",
            NO_USABLE_PLAN,
            None,
        )
        assert len(_answers(session, job_id)) == 2
        assert _draft(session, job_id) is None


def test_what_does_not_fit_by_sunday_is_stored_as_waiting_for_next_week(
    person: uuid.UUID,
) -> None:
    """Sunday at 21:00: fifty-five minutes left in the week hold one step (ADR-0033)."""
    job_id = _claimed(person)

    assert _run(job_id, FakeGenerator([THREE_STEPS]), now=SUNDAY_NIGHT) is Outcome.DONE

    with get_session_factory()() as session:
        draft = _draft(session, job_id)
        assert draft is not None
        assert [(item.start_at, item.placement) for item in draft.items] == [
            (_local(8, 21, 5), "placed"),
            (None, "not_this_week"),
            (None, "not_this_week"),
        ]


class _BooksWhileAnswering(FakeGenerator):
    """The person books their Wednesday afternoon while the model is answering."""

    def __init__(self, answers: list[str], owner: uuid.UUID) -> None:
        super().__init__(answers)
        self._owner = owner

    def generate(self, prompt: PlanPrompt, *, repair: Repair | None = None) -> Generation:
        with get_session_factory()() as session:
            session.add(
                Task(
                    user_id=self._owner,
                    title="Dentista",
                    start_at=_local(4, 12),
                    duration_minutes=120,
                )
            )
            session.commit()
        return super().generate(prompt, repair=repair)


def test_the_steps_are_placed_against_the_calendar_as_it_is_when_the_answer_arrives(
    person: uuid.UUID,
) -> None:
    job_id = _claimed(person)

    assert _run(job_id, _BooksWhileAnswering([THREE_STEPS], person)) is Outcome.DONE

    with get_session_factory()() as session:
        draft = _draft(session, job_id)
        assert draft is not None
        assert [item.start_at for item in draft.items] == [
            _local(4, 14),
            _local(4, 14, 45),
            _local(4, 15, 30),
        ]


class _ReclaimedWhileAnswering(FakeGenerator):
    """This worker outlives its lock, and another claims the job while the model answers."""

    def __init__(self, answers: list[str], job_id: uuid.UUID) -> None:
        super().__init__(answers)
        self._job_id = job_id

    def generate(self, prompt: PlanPrompt, *, repair: Repair | None = None) -> Generation:
        with get_session_factory()() as session:
            session.execute(
                update(AiJob).where(AiJob.id == self._job_id).values(attempts=AiJob.attempts + 1)
            )
            session.commit()
        return super().generate(prompt, repair=repair)


def test_a_worker_that_lost_its_job_keeps_nothing_but_the_call_it_made(
    person: uuid.UUID,
) -> None:
    """The answer belongs to whoever holds the job now; the call was spent either way, and a
    ceiling has to see it (ADR-0041)."""
    job_id = _claimed(person)

    outcome = _run(job_id, _ReclaimedWhileAnswering([THREE_STEPS], job_id))

    assert outcome is Outcome.LOST
    with get_session_factory()() as session:
        job = session.get_one(AiJob, job_id)
        assert (job.status, job.attempts) == ("running", 2)
        assert _answers(session, job_id) == []
        assert _draft(session, job_id) is None
        [call] = _usage(session, job_id)
        assert (call.attempt, call.outcome) == (1, "completed")


def test_a_job_no_longer_running_is_not_started(person: uuid.UUID) -> None:
    job_id = _claimed(person)
    generator = FakeGenerator([])

    outcome = run_plan_job(get_session_factory(), generator, job_id, attempt=2)

    assert outcome is Outcome.LOST
    assert generator.calls == []


def test_a_draft_already_pending_fails_the_job_and_keeps_the_first_draft(
    person: uuid.UUID,
) -> None:
    first = _claimed(person)
    assert _run(first, FakeGenerator([THREE_STEPS])) is Outcome.DONE
    second = _claimed(person)

    assert _run(second, FakeGenerator([THREE_STEPS])) is Outcome.FAILED

    with get_session_factory()() as session:
        job = session.get_one(AiJob, second)
        assert (job.status, job.failure_reason) == ("failed", PLAN_IN_PROGRESS)
        assert len(_answers(session, second)) == 1
        pending = select(func.count()).select_from(PlanDraft).where(PlanDraft.user_id == person)
        assert session.scalar(pending) == 1
        for model in (PlanDraftItem, PlanDraftDiscard):
            assert (
                session.scalar(
                    select(func.count())
                    .select_from(model)
                    .join(PlanDraft)
                    .where(PlanDraft.job_id == second)
                )
                == 0
            )
        assert (
            session.scalar(
                select(func.count())
                .select_from(PlanDraftItemLink)
                .join(PlanDraftItem)
                .join(PlanDraft)
                .where(PlanDraft.job_id == second)
            )
            == 0
        )


def test_the_prompt_carries_the_request_and_the_person_s_week(person: uuid.UUID) -> None:
    job_id = _claimed(person, horizon_days=3)
    generator = FakeGenerator([THREE_STEPS])

    _run(job_id, generator)

    [(prompt, repair)] = generator.calls
    message = json.loads(prompt.message)
    assert repair is None
    assert message["request"] == REQUEST
    assert [day["date"] for day in message["context"]["days"]] == [
        "2031-06-04",
        "2031-06-05",
        "2031-06-06",
    ]


def test_any_other_refusal_rolls_the_whole_write_back_and_leaves_the_job_to_its_lock(
    person: uuid.UUID,
) -> None:
    """A job with a draft already written for it is a defect, not a plan in progress: it
    surfaces as the database's refusal, nothing of the write survives, and the job stays
    running until its lock runs out and the claim or the sweep takes it (ADR-0031)."""
    job_id = _claimed(person)
    with get_session_factory()() as session:
        session.add(
            PlanDraft(
                user_id=person,
                job_id=job_id,
                request=REQUEST,
                prompt_version=PROMPT_VERSION,
                first_day=_local(4, 0).date(),
                last_day=_local(4, 0).date(),
                status="discarded",
                ended_at=func.now(),
            )
        )
        session.commit()

    with pytest.raises(IntegrityError, match="uq_plan_drafts_job_id"):
        _run(job_id, FakeGenerator([THREE_STEPS]))

    with get_session_factory()() as session:
        job = session.get_one(AiJob, job_id)
        assert (job.status, job.attempts) == ("running", 1)
        assert _answers(session, job_id) == []
