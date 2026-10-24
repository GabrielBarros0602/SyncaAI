"""The spend ceilings against a real PostgreSQL (ADR-0006, ADR-0044).

Spend is written into ``ai_usage`` directly, priced as a paid model's would be, because
nothing the project runs costs money yet: the ceilings are there for the day something does.
The global ceiling is set relative to whatever the table already holds, so the tests do not
depend on it being empty. Everything committed is deleted afterwards.
"""

import json
import uuid
from collections.abc import Iterator
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, insert, or_, select, text, update
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session

from syncaai.api.dependencies import get_current_user_id
from syncaai.config import Settings, get_settings
from syncaai.db import get_session_factory
from syncaai.errors import AllowanceSpentError, PlanningPausedError
from syncaai.models import AiJob, AiUsage, User
from syncaai.planning.context import PROMPT_VERSION, PlanPrompt
from syncaai.planning.contract import MAX_ANSWER_TOKENS
from syncaai.planning.generator import FakeGenerator, Generation, Repair
from syncaai.planning.prices import cost_of
from syncaai.services.ai_queue import VISIBILITY_TIMEOUT, enqueue_plan
from syncaai.services.ai_spend import DEFAULT_CEILINGS, Ceilings, spend_statement
from syncaai.services.plan_jobs import Outcome, run_plan_job
from syncaai.worker import Worker, listen_url

pytestmark = pytest.mark.integration

PLANS = "/api/v1/ai/plans"
REQUEST = "Plano para aprender JOINs em SQL"
LAST_MONTH = func.date_trunc("month", func.now(), "UTC") - timedelta(seconds=1)


@pytest.fixture
def people() -> Iterator[list[uuid.UUID]]:
    with get_session_factory()() as session:
        users = [
            User(email=f"ceiling-{uuid.uuid4()}@example.com", password_hash="not-a-real-hash")
            for _ in range(3)
        ]
        session.add_all(users)
        session.commit()
        ids = [user.id for user in users]
    try:
        yield ids
    finally:
        with get_session_factory()() as session:
            session.execute(
                delete(AiUsage).where(
                    or_(AiUsage.model == "spend-ceiling-test", AiUsage.user_id.in_(ids))
                )
            )
            session.execute(delete(User).where(User.id.in_(ids)))
            session.commit()


def _spent(person: uuid.UUID | None, usd: str, *, created_at: Any = None) -> None:
    """A completed call that cost ``usd``, made this month unless said otherwise."""
    with get_session_factory()() as session:
        session.execute(
            insert(AiUsage).values(
                user_id=person,
                attempt=1,
                position=0,
                provider="anthropic",
                model="spend-ceiling-test",
                prompt_version=PROMPT_VERSION,
                outcome="completed",
                input_tokens=1000,
                output_tokens=1000,
                cost_usd=Decimal(usd),
                latency_ms=1000,
                created_at=func.now() if created_at is None else created_at,
            )
        )
        session.commit()


def _everyone_spent() -> Decimal:
    with get_session_factory()() as session:
        return Decimal(session.scalar(spend_statement()) or 0)


def _ask(app: FastAPI, client: TestClient, person: uuid.UUID) -> Any:
    app.dependency_overrides[get_current_user_id] = lambda: person
    return client.post(PLANS, json={"request": REQUEST})


def _seconds_to_next_utc_month() -> float:
    now = datetime.now(timezone.utc)
    turn = datetime(now.year + now.month // 12, now.month % 12 + 1, 1, tzinfo=timezone.utc)
    return (turn - now).total_seconds()


def _jobs(person: uuid.UUID) -> int:
    with get_session_factory()() as session:
        count = select(func.count()).select_from(AiJob).where(AiJob.user_id == person)
        return int(session.scalar(count) or 0)


# --- A person's month ----------------------------------------------------------------------


def test_a_person_whose_month_is_spent_is_refused_until_it_turns(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    _spent(people[0], "0.30")
    _spent(people[0], "0.20")

    response = _ask(app, client, people[0])

    assert response.status_code == 429
    assert response.json() == {
        "detail": "This month's plans are used up. They renew on the first of next month."
    }
    assert abs(int(response.headers["Retry-After"]) - _seconds_to_next_utc_month()) <= 5
    assert _jobs(people[0]) == 0


def test_a_month_just_under_the_ceiling_still_queues_a_plan(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    _spent(people[0], "0.49999999")

    assert _ask(app, client, people[0]).status_code == 202


def test_last_month_s_spend_does_not_count(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    _spent(people[0], "0.50", created_at=LAST_MONTH)

    assert _ask(app, client, people[0]).status_code == 202


def test_another_person_s_spend_is_not_held_against_the_person(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    _spent(people[1], "0.50")

    assert _ask(app, client, people[0]).status_code == 202


def test_the_setting_is_the_ceiling(
    app: FastAPI, client: TestClient, settings: Settings, people: list[uuid.UUID]
) -> None:
    settings.ai_ceiling_per_person_usd = Decimal("0.10")
    _spent(people[0], "0.10")

    assert _ask(app, client, people[0]).status_code == 429


# --- Everyone's month ----------------------------------------------------------------------


def test_the_global_ceiling_pauses_planning_for_everyone(
    app: FastAPI, client: TestClient, settings: Settings, people: list[uuid.UUID]
) -> None:
    settings.ai_ceiling_everyone_usd = _everyone_spent() + Decimal("0.40")
    _spent(people[1], "0.40")

    response = _ask(app, client, people[0])

    assert response.status_code == 503
    assert response.json() == {"detail": "Planning is paused until next month."}
    assert abs(int(response.headers["Retry-After"]) - _seconds_to_next_utc_month()) <= 5


def test_a_deleted_account_s_spend_still_counts_for_everyone(
    app: FastAPI, client: TestClient, settings: Settings, people: list[uuid.UUID]
) -> None:
    """Deleting an account nulls its usage rather than taking its spend away (ADR-0041)."""
    settings.ai_ceiling_everyone_usd = _everyone_spent() + Decimal("0.40")
    _spent(people[2], "0.40")
    with get_session_factory()() as session:
        session.execute(delete(User).where(User.id == people[2]))
        session.commit()

    assert _ask(app, client, people[0]).status_code == 503


def test_the_kill_switch_is_answered_before_the_person_s_own_ceiling(
    app: FastAPI, client: TestClient, settings: Settings, people: list[uuid.UUID]
) -> None:
    settings.ai_ceiling_everyone_usd = _everyone_spent() + Decimal("0.50")
    _spent(people[0], "0.50")

    assert _ask(app, client, people[0]).status_code == 503


def test_the_rate_limit_is_answered_before_a_ceiling(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    """The cheapest refusal first (ADR-0006)."""
    _spent(people[0], "0.50")
    with get_session_factory()() as session:
        for minutes in range(10):
            session.execute(
                insert(AiJob).values(
                    user_id=people[0],
                    request=REQUEST,
                    horizon_days=14,
                    prompt_version=PROMPT_VERSION,
                    status="done",
                    finished_at=func.now(),
                    chosen_answer=0,
                    created_at=func.now() - timedelta(minutes=minutes),
                )
            )
        session.commit()

    response = _ask(app, client, people[0])

    assert response.status_code == 429
    assert "plans an hour" in response.json()["detail"]


# --- Before each call ---------------------------------------------------------------------

PLAN = json.dumps(
    {
        "items": [
            {
                "title": "Ler o capítulo de JOINs",
                "description": "",
                "estimated_minutes": 45,
                "depends_on": [],
                "links": [],
            }
        ]
    }
)
# Too long for any block: the first answer needs a repair.
NEEDS_A_REPAIR = PLAN.replace('"estimated_minutes": 45', '"estimated_minutes": 999')


class _Paid(FakeGenerator):
    """A paid model as the price table names one, answering from a script."""

    provider = "anthropic"
    model = "claude-haiku-5-5"

    def __init__(self, answers: list[str], *, output_tokens: int = 500) -> None:
        super().__init__(answers)
        self._output_tokens = output_tokens

    def generate(self, prompt: PlanPrompt, *, repair: Repair | None = None) -> Generation:
        answer = super().generate(prompt, repair=repair)
        return Generation(
            raw=answer.raw,
            model=answer.model,
            input_tokens=1000,
            output_tokens=self._output_tokens,
        )


def _claimed(person: uuid.UUID) -> uuid.UUID:
    with get_session_factory()() as session:
        job = enqueue_plan(session, person, REQUEST, horizon_days=7)
        session.commit()
        session.execute(
            update(AiJob)
            .where(AiJob.id == job.id)
            .values(status="running", attempts=1, locked_until=func.now() + VISIBILITY_TIMEOUT)
        )
        session.commit()
        return job.id


def _run(
    job_id: uuid.UUID, generator: FakeGenerator, ceilings: Ceilings = DEFAULT_CEILINGS
) -> Outcome:
    return run_plan_job(get_session_factory(), generator, job_id, attempt=1, ceilings=ceilings)


def _job(job_id: uuid.UUID) -> AiJob:
    with get_session_factory()() as session:
        return session.get_one(AiJob, job_id)


def _usage(job_id: uuid.UUID) -> list[AiUsage]:
    with get_session_factory()() as session:
        statement = select(AiUsage).where(AiUsage.job_id == job_id).order_by(AiUsage.position)
        return list(session.scalars(statement).all())


def test_a_job_whose_person_has_spent_the_month_fails_without_a_call(
    people: list[uuid.UUID],
) -> None:
    """Spent while the job waited: failed with the sentence, not left to be tried again."""
    job_id = _claimed(people[0])
    _spent(people[0], "0.50")
    model = _Paid([PLAN])

    assert _run(job_id, model) is Outcome.FAILED

    assert _job(job_id).failure_reason == AllowanceSpentError.sentence
    assert (model.calls, _usage(job_id)) == ([], [])
    # A refused request could have been a cache hit, so it is measured too (ADR-0045).
    assert _job(job_id).context_fingerprint is not None


def test_a_paid_call_is_not_made_when_its_estimate_would_cross_the_ceiling(
    people: list[uuid.UUID],
) -> None:
    """US$ 0.499 spent leaves less than any paid call's estimate: the answer's cap alone,
    4,096 tokens at Haiku's price, is US$ 0.002."""
    job_id = _claimed(people[0])
    _spent(people[0], "0.499")
    model = _Paid([PLAN])

    assert _run(job_id, model) is Outcome.FAILED
    assert model.calls == []


def test_a_free_call_with_the_same_month_left_is_made(people: list[uuid.UUID]) -> None:
    job_id = _claimed(people[0])
    _spent(people[0], "0.499")

    assert _run(job_id, FakeGenerator([PLAN])) is Outcome.DONE


def test_a_repair_the_ceiling_refuses_fails_the_job_and_keeps_the_first_call_counted(
    people: list[uuid.UUID],
) -> None:
    """The first call is admitted and costs US$ 0.0251; with it the month passes the ceiling,
    so the repair is refused before it is made (ADR-0044)."""
    job_id = _claimed(people[0])
    _spent(people[0], "0.49")
    model = _Paid([NEEDS_A_REPAIR, PLAN], output_tokens=50_000)

    assert _run(job_id, model) is Outcome.FAILED

    assert len(model.calls) == 1
    assert _job(job_id).failure_reason == AllowanceSpentError.sentence
    [first] = _usage(job_id)
    assert (first.position, first.outcome, first.cost_usd) == (0, "completed", Decimal("0.0251"))


def test_a_paid_call_that_raises_is_charged_at_its_estimate(people: list[uuid.UUID]) -> None:
    job_id = _claimed(people[0])

    with pytest.raises(RuntimeError, match="not scripted"):
        _run(job_id, _Paid([]))

    [call] = _usage(job_id)
    assert call.outcome == "failed"
    assert call.cost_usd is not None
    assert call.cost_usd >= cost_of(
        "anthropic", "claude-haiku-5-5", input_tokens=0, output_tokens=MAX_ANSWER_TOKENS
    )


def test_the_kill_switch_stops_a_job_queued_before_it_tripped(
    people: list[uuid.UUID],
) -> None:
    job_id = _claimed(people[0])
    ceilings = Ceilings(per_person=Decimal("0.50"), everyone=_everyone_spent() + Decimal("0.01"))
    _spent(people[1], "0.01")
    model = _Paid([PLAN])

    assert _run(job_id, model, ceilings) is Outcome.FAILED

    assert _job(job_id).failure_reason == PlanningPausedError.sentence
    assert model.calls == []


def test_the_worker_holds_its_jobs_to_the_ceilings_it_was_given(
    people: list[uuid.UUID],
) -> None:
    with get_session_factory()() as session:
        job_id = enqueue_plan(session, people[0], REQUEST, horizon_days=7).id
        session.commit()
    _spent(people[0], "0.01")
    worker = Worker(
        get_session_factory(),
        FakeGenerator([PLAN]),
        listen_url=listen_url(get_settings().database_url),
        ceilings=Ceilings(per_person=Decimal("0.01"), everyone=Decimal(1000)),
    )

    worker.tick()

    assert _job(job_id).failure_reason == AllowanceSpentError.sentence


# --- The indexes ---------------------------------------------------------------------------

OTHER_OWNERS = 99
CALLS_EACH = 30


@pytest.fixture
def two_years_of_usage() -> Iterator[uuid.UUID]:
    """A hundred people's calls spread over two years, committed and analysed, so a month is a
    small part of the table and the planner has a real choice to make."""
    with get_session_factory()() as session:
        users = [
            User(email=f"ceiling-noise-{uuid.uuid4()}@example.com", password_hash="x")
            for _ in range(OTHER_OWNERS + 1)
        ]
        session.add_all(users)
        session.commit()
        ids = [user.id for user in users]
        rows = [
            {
                "user_id": person,
                "attempt": 1,
                "position": 0,
                "provider": "anthropic",
                "model": "spend-ceiling-test",
                "prompt_version": PROMPT_VERSION,
                "outcome": "completed",
                "input_tokens": 1000,
                "output_tokens": 1000,
                "cost_usd": Decimal("0.001"),
                "latency_ms": 1000,
                "created_at": datetime.now(timezone.utc) - timedelta(days=24 * n),
            }
            for person in ids
            for n in range(CALLS_EACH)
        ]
        session.execute(insert(AiUsage), rows)
        session.commit()
        session.execute(text("ANALYZE ai_usage"))
        session.commit()
    try:
        yield ids[0]
    finally:
        with get_session_factory()() as session:
            session.execute(delete(AiUsage).where(AiUsage.model == "spend-ceiling-test"))
            session.execute(delete(User).where(User.id.in_(ids)))
            session.commit()


def _explain(session: Session, statement: Any) -> str:
    compiled = statement.compile(dialect=postgresql.dialect())
    rows = session.connection().exec_driver_sql(f"EXPLAIN ANALYZE {compiled}", compiled.params)
    return "\n".join(str(row[0]) for row in rows)


def test_a_person_s_month_is_summed_through_its_index(two_years_of_usage: uuid.UUID) -> None:
    with get_session_factory()() as session:
        plan = _explain(session, spend_statement(two_years_of_usage))

    assert "ix_ai_usage_user_id_created_at" in plan, plan
    assert "Seq Scan on ai_usage" not in plan, plan


def test_everyone_s_month_is_summed_through_its_index(two_years_of_usage: uuid.UUID) -> None:
    """The kill switch reads one month of every person's calls, never the whole history."""
    with get_session_factory()() as session:
        plan = _explain(session, spend_statement())

    assert "ix_ai_usage_created_at" in plan, plan
    assert "Seq Scan on ai_usage" not in plan, plan
