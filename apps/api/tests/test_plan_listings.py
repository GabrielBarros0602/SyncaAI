"""Finding a plan without its id, over HTTP against a real PostgreSQL (ADR-0050).

A screen that reloads keeps nothing, so what it was following has to be found again from the
server: the request in progress, the latest that failed, the plan waiting for review. Each
test builds the rows it lists through the routes a person uses, and moves a row by hand only
where the state it needs is one a clock or a worker would reach.
"""

import json
import uuid
from collections.abc import Iterator
from datetime import date, datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, update

from syncaai.api.dependencies import get_current_user_id
from syncaai.db import get_session_factory
from syncaai.models import AiJob, AiUsage, PlanDraft, User
from syncaai.planning.generator import FakeGenerator
from syncaai.services.ai_queue import VISIBILITY_TIMEOUT
from syncaai.services.plan_jobs import run_plan_job

pytestmark = pytest.mark.integration

JOBS = "/api/v1/ai/plans"
PLANS = "/api/v1/plans"
REQUEST = "Organizar a mudança de apartamento"
WEDNESDAY_NOON = datetime(2031, 6, 4, 12, 0, tzinfo=ZoneInfo("America/Sao_Paulo"))
ANSWER = json.dumps(
    {
        "items": [
            {
                "title": "Comprar caixas",
                "description": "",
                "estimated_minutes": 30,
                "depends_on": [],
                "links": [],
            }
        ]
    }
)


@pytest.fixture
def people() -> Iterator[list[uuid.UUID]]:
    with get_session_factory()() as session:
        users = [
            User(email=f"listings-{uuid.uuid4()}@example.com", password_hash="not-a-real-hash")
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


def _as(app: FastAPI, person: uuid.UUID) -> None:
    app.dependency_overrides[get_current_user_id] = lambda: person


def _ask(client: TestClient) -> str:
    response = client.post(JOBS, json={"request": REQUEST})
    assert response.status_code == 202, response.text
    return str(response.json()["job_id"])


def _make_the_plan(job_id: str) -> None:
    """What the worker does: claim the job, then run it with a scripted model."""
    with get_session_factory()() as session:
        session.execute(
            update(AiJob)
            .where(AiJob.id == uuid.UUID(job_id))
            .values(status="running", attempts=1, locked_until=func.now() + VISIBILITY_TIMEOUT)
        )
        session.commit()
    run_plan_job(
        get_session_factory(),
        FakeGenerator([ANSWER, ANSWER]),
        uuid.UUID(job_id),
        attempt=1,
        clock=lambda: WEDNESDAY_NOON.astimezone(timezone.utc),
    )


def _fail(job_id: str) -> None:
    """Where the sweep leaves a job whose attempts ran out (ADR-0031)."""
    with get_session_factory()() as session:
        session.execute(
            update(AiJob)
            .where(AiJob.id == uuid.UUID(job_id))
            .values(status="failed", finished_at=func.now(), failure_reason="It took too long.")
        )
        session.commit()


def _three_requests(client: TestClient) -> tuple[str, str, str, str]:
    """One done, whose plan was discarded to make room; one failed; one still queued. Each is
    its own transaction, so each was created after the one before."""
    done = _ask(client)
    _make_the_plan(done)
    plan_id = client.get(f"{JOBS}/{done}").json()["plan_id"]
    assert client.post(f"/api/v1/plans/{plan_id}/discard").status_code == 204
    failed = _ask(client)
    _fail(failed)
    queued = _ask(client)
    return done, plan_id, failed, queued


# --- Plan requests -------------------------------------------------------------------------


def test_the_requests_are_listed_newest_first_each_as_it_reads(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    _as(app, people[0])
    done, plan_id, failed, queued = _three_requests(client)

    response = client.get(JOBS)

    assert response.status_code == 200, response.text
    assert response.json() == {
        "items": [client.get(f"{JOBS}/{job}").json() for job in (queued, failed, done)],
        "limit": 50,
        "offset": 0,
    }
    assert [item["plan_id"] for item in response.json()["items"]] == [None, None, plan_id]
    assert response.json()["items"][1]["failure_reason"] == "It took too long."


def test_the_request_to_follow_after_a_reload_is_found_by_its_status(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    _as(app, people[0])
    _, _, failed, queued = _three_requests(client)

    in_progress = client.get(JOBS, params={"status": ["queued", "running"], "limit": 1}).json()
    latest_failure = client.get(JOBS, params={"status": "failed"}).json()

    assert [item["job_id"] for item in in_progress["items"]] == [queued]
    assert [item["job_id"] for item in latest_failure["items"]] == [failed]


def test_the_requests_are_paged_by_limit_and_offset(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    _as(app, people[0])
    done, _, failed, _ = _three_requests(client)

    second = client.get(JOBS, params={"limit": 1, "offset": 1}).json()
    past_the_end = client.get(JOBS, params={"limit": 2, "offset": 2}).json()

    assert ([item["job_id"] for item in second["items"]], second["limit"], second["offset"]) == (
        [failed],
        1,
        1,
    )
    assert [item["job_id"] for item in past_the_end["items"]] == [done]


def test_someone_else_s_requests_are_not_listed(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    _as(app, people[0])
    _ask(client)

    _as(app, people[1])
    mine = _ask(client)

    assert [item["job_id"] for item in client.get(JOBS).json()["items"]] == [mine]


@pytest.mark.parametrize(
    "params",
    [{"status": "pending"}, {"limit": 0}, {"limit": 101}, {"offset": -1}],
)
def test_a_listing_outside_its_bounds_is_refused(
    app: FastAPI, client: TestClient, people: list[uuid.UUID], params: dict[str, Any]
) -> None:
    _as(app, people[0])

    assert client.get(JOBS, params=params).status_code == 422


# --- Plans ---------------------------------------------------------------------------------


def _write(client: TestClient, name: str) -> str:
    """A plan by hand: no job, no model, and no worker needed to reach review (ADR-0047)."""
    response = client.post(PLANS, json={"request": name})
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


def _discarded_then_pending(client: TestClient) -> tuple[str, str]:
    first = _write(client, "Arrumar o quarto")
    assert client.post(f"{PLANS}/{first}/discard").status_code == 204
    return first, _write(client, "Estudar para a prova")


def _listed(client: TestClient, **params: Any) -> list[str]:
    response = client.get(PLANS, params=params)
    assert response.status_code == 200, response.text
    return [item["id"] for item in response.json()["items"]]


def test_the_plans_are_listed_newest_first_each_as_it_reads(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    _as(app, people[0])
    discarded, pending = _discarded_then_pending(client)

    response = client.get(PLANS)

    assert response.status_code == 200, response.text
    assert response.json() == {
        "items": [client.get(f"{PLANS}/{plan}").json() for plan in (pending, discarded)],
        "limit": 50,
        "offset": 0,
    }
    assert [item["status"] for item in response.json()["items"]] == ["pending", "discarded"]


def test_the_plan_waiting_for_review_is_found_by_its_status(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    _as(app, people[0])
    discarded, pending = _discarded_then_pending(client)

    assert _listed(client, status="pending", limit=1) == [pending]
    assert _listed(client, status="discarded") == [discarded]
    assert _listed(client, status=["approved", "expired"]) == []
    assert _listed(client, status=["discarded", "pending"]) == [
        pending,
        discarded,
    ]


def test_the_plans_are_paged_by_limit_and_offset(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    _as(app, people[0])
    discarded, _ = _discarded_then_pending(client)

    second = client.get(PLANS, params={"limit": 1, "offset": 1}).json()

    assert ([item["id"] for item in second["items"]], second["limit"], second["offset"]) == (
        [discarded],
        1,
        1,
    )


def _move_to_the_past(plan_id: str, **values: object) -> None:
    """Where the clock leaves a plan once its horizon is over: two weeks long ago."""
    with get_session_factory()() as session:
        session.execute(
            update(PlanDraft)
            .where(PlanDraft.id == uuid.UUID(plan_id))
            .values(first_day=date(2020, 1, 6), last_day=date(2020, 1, 19), **values)
        )
        session.commit()


def test_a_plan_whose_last_day_has_ended_is_listed_as_expired_before_the_sweep(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    """Listed as it reads, not as it is stored (ADR-0033, ADR-0050). The first plan is where
    the sweep leaves one; the second is still stored as pending, and must not be listed as
    the plan waiting for review."""
    _as(app, people[0])
    swept = _write(client, "Arrumar o quarto")
    _move_to_the_past(swept, status="expired", ended_at=func.now())
    unswept = _write(client, "Estudar para a prova")
    _move_to_the_past(unswept)

    expired = client.get(PLANS, params={"status": "expired"}).json()["items"]

    assert [(plan["id"], plan["status"]) for plan in expired] == [
        (unswept, "expired"),
        (swept, "expired"),
    ]
    assert _listed(client, status="pending") == []
    assert client.get(f"{PLANS}/{unswept}").json()["status"] == "expired"
    with get_session_factory()() as session:
        assert session.get_one(PlanDraft, uuid.UUID(unswept)).status == "pending"


def test_someone_else_s_plans_are_not_listed(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    _as(app, people[0])
    _write(client, "Arrumar o quarto")

    _as(app, people[1])
    mine = _write(client, "Estudar para a prova")

    assert _listed(client) == [mine]


@pytest.mark.parametrize(
    "params",
    [{"status": "queued"}, {"limit": 0}, {"limit": 101}, {"offset": -1}],
)
def test_a_plan_listing_outside_its_bounds_is_refused(
    app: FastAPI, client: TestClient, people: list[uuid.UUID], params: dict[str, Any]
) -> None:
    _as(app, people[0])

    assert client.get(PLANS, params=params).status_code == 422
