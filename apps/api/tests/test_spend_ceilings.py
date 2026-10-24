"""The spend ceilings against a real PostgreSQL (ADR-0006, ADR-0044).

Spend is written into ``ai_usage`` directly, priced as a paid model's would be, because
nothing the project runs costs money yet: the ceilings are there for the day something does.
The global ceiling is set relative to whatever the table already holds, so the tests do not
depend on it being empty. Everything committed is deleted afterwards.
"""

import uuid
from collections.abc import Iterator
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, insert, select, text
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session

from syncaai.api.dependencies import get_current_user_id
from syncaai.config import Settings
from syncaai.db import get_session_factory
from syncaai.models import AiJob, AiUsage, User
from syncaai.planning.context import PROMPT_VERSION
from syncaai.services.ai_spend import spend_statement

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
            session.execute(delete(AiUsage).where(AiUsage.model == "spend-ceiling-test"))
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
