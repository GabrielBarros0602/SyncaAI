"""The plan rate limit against a real PostgreSQL (ADR-0006, ADR-0042).

Ten jobs in any hour and thirty in any twenty-four, counted from the person's own jobs. The
jobs are written with the age each test needs, so a window is measured, not waited for; only
a request goes through HTTP, and only it is what is limited. Everything committed is deleted
with its owner afterwards.
"""

import uuid
from collections.abc import Iterator
from datetime import timedelta
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, insert, select, text, update
from sqlalchemy.dialects import postgresql

from syncaai.api.dependencies import get_current_user_id
from syncaai.db import get_session_factory
from syncaai.models import AiJob, User
from syncaai.planning.context import PROMPT_VERSION
from syncaai.repositories.plans import AiJobRepository

pytestmark = pytest.mark.integration

PLANS = "/api/v1/ai/plans"
REQUEST = "Plano para aprender JOINs em SQL"
HOUR = 60
DAY = 24 * 60


@pytest.fixture
def people() -> Iterator[list[uuid.UUID]]:
    with get_session_factory()() as session:
        users = [
            User(email=f"limit-{uuid.uuid4()}@example.com", password_hash="not-a-real-hash")
            for _ in range(2)
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


def _had(person: uuid.UUID, *minutes_ago: float, status: str = "done") -> None:
    """Jobs the person already had, created that many minutes ago."""
    finished = {"finished_at": func.now(), "chosen_answer": 0} if status == "done" else {}
    rows = [
        {
            "user_id": person,
            "request": REQUEST,
            "horizon_days": 14,
            "prompt_version": PROMPT_VERSION,
            "status": status,
            "created_at": func.now() - timedelta(minutes=minutes),
            **finished,
        }
        for minutes in minutes_ago
    ]
    with get_session_factory()() as session:
        for row in rows:
            session.execute(insert(AiJob).values(**row))
        session.commit()


def _jobs(person: uuid.UUID) -> int:
    with get_session_factory()() as session:
        count = select(func.count()).select_from(AiJob).where(AiJob.user_id == person)
        return int(session.scalar(count) or 0)


def _ask(app: FastAPI, client: TestClient, person: uuid.UUID) -> Any:
    app.dependency_overrides[get_current_user_id] = lambda: person
    return client.post(PLANS, json={"request": REQUEST})


def _spread(count: int, *, oldest: float, newest: float) -> list[float]:
    step = (oldest - newest) / (count - 1)
    return [oldest - step * n for n in range(count)]


def test_the_eleventh_plan_in_an_hour_waits_for_the_oldest_to_leave_it(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    _had(people[0], *_spread(10, oldest=55, newest=10))

    response = _ask(app, client, people[0])

    assert response.status_code == 429
    assert response.json() == {"detail": "At most 10 plans an hour. Try again later."}
    # The oldest of the ten leaves the hour in five minutes.
    assert abs(int(response.headers["Retry-After"]) - 5 * 60) <= 2
    assert _jobs(people[0]) == 10


def test_a_job_older_than_the_hour_no_longer_counts_in_it(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    _had(people[0], HOUR + 1, *_spread(9, oldest=50, newest=10))

    assert _ask(app, client, people[0]).status_code == 202


def test_thirty_in_a_day_refuse_a_plan_with_the_hour_empty(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    _had(people[0], *_spread(30, oldest=DAY - HOUR, newest=2 * HOUR))

    response = _ask(app, client, people[0])

    assert response.status_code == 429
    assert response.json() == {"detail": "At most 30 plans in 24 hours. Try again later."}
    assert abs(int(response.headers["Retry-After"]) - 60 * 60) <= 2


def test_with_both_windows_full_the_longer_wait_is_the_one_given(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    _had(people[0], *_spread(20, oldest=DAY - HOUR, newest=2 * HOUR))
    _had(people[0], *_spread(10, oldest=55, newest=10))

    response = _ask(app, client, people[0])

    assert response.status_code == 429
    assert "in 24 hours" in response.json()["detail"]
    assert abs(int(response.headers["Retry-After"]) - 60 * 60) <= 2


def test_a_refused_request_spends_nothing_and_does_not_push_the_wait_away(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    _had(people[0], *_spread(10, oldest=55, newest=10))

    first = _ask(app, client, people[0])
    second = _ask(app, client, people[0])

    assert (first.status_code, second.status_code) == (429, 429)
    assert int(second.headers["Retry-After"]) <= int(first.headers["Retry-After"])
    assert _jobs(people[0]) == 10


def test_a_request_refused_while_a_plan_is_in_progress_spends_nothing(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    """Had the refused request counted, as an attempt does at sign-in, the next one would
    be the eleventh of the hour (ADR-0042)."""
    _had(people[0], *_spread(8, oldest=55, newest=15))
    _had(people[0], 5, status="queued")

    assert _ask(app, client, people[0]).status_code == 409

    with get_session_factory()() as session:
        session.execute(
            update(AiJob)
            .where(AiJob.user_id == people[0], AiJob.status == "queued")
            .values(status="done", finished_at=func.now(), chosen_answer=0)
        )
        session.commit()
    assert _ask(app, client, people[0]).status_code == 202
    assert _jobs(people[0]) == 10


def test_the_limit_is_answered_before_the_plan_in_progress(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    """The cheapest refusal first (ADR-0006): the person learns the wait that is true for
    the next request, not only that one is running."""
    _had(people[0], *_spread(9, oldest=55, newest=15))
    _had(people[0], 5, status="queued")

    assert _ask(app, client, people[0]).status_code == 429


def test_another_person_s_plans_are_not_counted(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    _had(people[1], *_spread(30, oldest=50, newest=1))

    assert _ask(app, client, people[0]).status_code == 202


# --- The index -----------------------------------------------------------------------------

OTHER_OWNERS = 99
JOBS_EACH = 30


@pytest.fixture
def a_crowded_table() -> Iterator[uuid.UUID]:
    """A hundred people with thirty jobs each over the last day, committed and analysed.

    Committed rather than rolled back because ``ANALYZE`` reads what is stored, and the
    planner's choice is what is asserted: on a handful of rows it scans the table whatever
    the index, and the assertion would prove nothing.
    """
    with get_session_factory()() as session:
        users = [
            User(email=f"limit-noise-{uuid.uuid4()}@example.com", password_hash="not-a-real-hash")
            for _ in range(OTHER_OWNERS + 1)
        ]
        session.add_all(users)
        session.commit()
        ids = [user.id for user in users]
    for person in ids:
        _had(person, *_spread(JOBS_EACH, oldest=DAY - 1, newest=1))
    with get_session_factory()() as session:
        session.execute(text("ANALYZE ai_jobs"))
        session.commit()
    try:
        yield ids[0]
    finally:
        with get_session_factory()() as session:
            session.execute(delete(User).where(User.id.in_(ids)))
            session.commit()


@pytest.mark.parametrize("window", [timedelta(hours=1), timedelta(hours=24)])
def test_the_count_reaches_a_person_s_jobs_through_the_index(
    a_crowded_table: uuid.UUID, window: timedelta
) -> None:
    """``ix_ai_jobs_user_id_created_at`` covers ``(user_id, created_at)``, the whole
    predicate. Both bounds belong in the index condition: without the time, the scan reads
    a person's whole history to answer about one day."""
    with get_session_factory()() as session:
        statement = AiJobRepository(session, a_crowded_table).holding_statement(
            window=window, limit=10
        )
        compiled = statement.compile(dialect=postgresql.dialect())
        rows = session.connection().exec_driver_sql(f"EXPLAIN ANALYZE {compiled}", compiled.params)
        plan = "\n".join(str(row[0]) for row in rows)

    assert "ix_ai_jobs_user_id_created_at" in plan, plan
    assert "Seq Scan on ai_jobs" not in plan, plan
    [condition] = [line for line in plan.splitlines() if "Index Cond" in line]
    assert "user_id =" in condition and "created_at >" in condition, plan
