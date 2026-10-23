"""Asking for a plan and reading it, over HTTP against a real PostgreSQL (ADR-0038).

The signed-in person is set by overriding who the token says they are, because login has its
own tests; everything below that is real. A plan is produced by running the job here, as the
worker would, with a scripted answer, so the review read back is one the test chose.
"""

import json
import uuid
from collections.abc import Iterator
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select, update

from syncaai.api.dependencies import get_current_user_id
from syncaai.db import get_session_factory
from syncaai.models import AiJob, PlanDraft, PlanDraftItem, User
from syncaai.planning.generator import FakeGenerator
from syncaai.services.ai_queue import VISIBILITY_TIMEOUT
from syncaai.services.plan_jobs import PLAN_IN_PROGRESS, run_plan_job

pytestmark = pytest.mark.integration

PLANS = "/api/v1/ai/plans"
REQUEST = "Plano para aprender JOINs em SQL"
# A Wednesday at noon in São Paulo, years ahead, so every placed step is still to come.
WEDNESDAY_NOON = datetime(2031, 6, 4, 12, 0, tzinfo=ZoneInfo("America/Sao_Paulo"))


def _item(title: str, minutes: int = 45, **fields: object) -> dict[str, object]:
    return {
        "title": title,
        "description": "",
        "estimated_minutes": minutes,
        "depends_on": [],
        "links": [],
        **fields,
    }


ANSWER = json.dumps(
    {
        "items": [
            _item(
                "Ler o capítulo de JOINs",
                description="O capítulo 6.",
                links=[{"label": "SQLBolt", "url": "https://sqlbolt.com/lesson/6"}],
            ),
            _item("Exercícios de JOINs", depends_on=[0]),
            _item("Projeto final", minutes=300),
        ]
    }
)


@pytest.fixture
def people() -> Iterator[list[uuid.UUID]]:
    with get_session_factory()() as session:
        users = [
            User(email=f"plans-{uuid.uuid4()}@example.com", password_hash="not-a-real-hash")
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


def _as(app: FastAPI, person: uuid.UUID) -> None:
    app.dependency_overrides[get_current_user_id] = lambda: person


def _ask(client: TestClient, **body: object) -> dict[str, object]:
    response = client.post(PLANS, json={"request": REQUEST, **body})
    assert response.status_code == 202, response.text
    return dict(response.json())


def _make_the_plan(job_id: str, answer: str = ANSWER) -> None:
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
        FakeGenerator([answer, answer]),
        uuid.UUID(job_id),
        attempt=1,
        clock=lambda: WEDNESDAY_NOON.astimezone(timezone.utc),
    )


# --- Asking --------------------------------------------------------------------------------


def test_a_request_is_queued_and_answered_with_its_job(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    _as(app, people[0])

    body = _ask(client, request=f"  {REQUEST}  ")

    assert body["status"] == "queued" and body["plan_id"] is None
    with get_session_factory()() as session:
        job = session.get_one(AiJob, uuid.UUID(str(body["job_id"])))
        assert (job.user_id, job.request, job.horizon_days) == (people[0], REQUEST, 14)


@pytest.mark.parametrize(
    "body",
    [
        {"request": ""},
        {"request": "     "},
        {"request": "x" * 501},
        {"request": REQUEST, "horizon_days": 0},
        {"request": REQUEST, "horizon_days": 15},
    ],
)
def test_a_request_outside_its_bounds_is_refused_before_it_is_queued(
    app: FastAPI, client: TestClient, people: list[uuid.UUID], body: dict[str, object]
) -> None:
    _as(app, people[0])

    response = client.post(PLANS, json=body)

    assert response.status_code == 422, response.text
    with get_session_factory()() as session:
        assert (
            session.scalar(
                select(func.count()).select_from(AiJob).where(AiJob.user_id == people[0])
            )
            == 0
        )


def test_one_plan_at_a_time_while_the_first_is_queued_and_while_it_waits_for_review(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    _as(app, people[0])
    first = _ask(client)

    queued = client.post(PLANS, json={"request": "Outro plano"})
    _make_the_plan(str(first["job_id"]))
    pending = client.post(PLANS, json={"request": "Outro plano"})

    for refused in (queued, pending):
        assert refused.status_code == 409
        assert refused.json() == {"detail": PLAN_IN_PROGRESS}


def test_someone_else_s_plan_in_progress_does_not_stop_mine(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    _as(app, people[0])
    _ask(client)

    _as(app, people[1])
    _ask(client)


def test_a_discarded_plan_makes_room_for_the_next(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    _as(app, people[0])
    first = _ask(client)
    _make_the_plan(str(first["job_id"]))
    with get_session_factory()() as session:
        session.execute(
            update(PlanDraft)
            .where(PlanDraft.user_id == people[0])
            .values(status="discarded", ended_at=func.now())
        )
        session.commit()

    _ask(client)


# --- The job -------------------------------------------------------------------------------


def test_the_job_names_its_plan_once_there_is_one(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    _as(app, people[0])
    job_id = str(_ask(client)["job_id"])

    before = client.get(f"{PLANS}/{job_id}").json()
    _make_the_plan(job_id)
    after = client.get(f"{PLANS}/{job_id}").json()

    assert before == {"job_id": job_id, "status": "queued", "failure_reason": None, "plan_id": None}
    assert after["status"] == "done" and after["plan_id"] is not None


def test_a_failed_job_says_why_and_names_no_plan(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    _as(app, people[0])
    job_id = str(_ask(client)["job_id"])

    _make_the_plan(job_id, answer="Here is your plan.")
    body = client.get(f"{PLANS}/{job_id}").json()

    assert body["status"] == "failed" and body["plan_id"] is None
    assert (
        body["failure_reason"] == "No usable step came back, even after one correction. Try again."
    )


def test_someone_else_s_job_and_plan_are_not_found(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    """Not 403: the answer does not confirm the job or the plan exists (ADR-0016)."""
    _as(app, people[0])
    job_id = str(_ask(client)["job_id"])
    _make_the_plan(job_id)
    plan_id = client.get(f"{PLANS}/{job_id}").json()["plan_id"]

    _as(app, people[1])

    assert client.get(f"{PLANS}/{job_id}").status_code == 404
    assert client.get(f"/api/v1/plans/{plan_id}").status_code == 404
    assert client.get(f"{PLANS}/{uuid.uuid4()}").status_code == 404


# --- The plan ------------------------------------------------------------------------------


def _plan(app: FastAPI, client: TestClient, person: uuid.UUID) -> dict[str, object]:
    _as(app, person)
    job_id = str(_ask(client)["job_id"])
    _make_the_plan(job_id)
    plan_id = client.get(f"{PLANS}/{job_id}").json()["plan_id"]
    response = client.get(f"/api/v1/plans/{plan_id}")
    assert response.status_code == 200, response.text
    return dict(response.json())


def test_a_plan_reads_back_its_steps_their_links_and_what_was_discarded(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    plan = _plan(app, client, people[0])

    assert (plan["status"], plan["request"]) == ("pending", REQUEST)
    assert (plan["first_day"], plan["last_day"], plan["week_ends_on"]) == (
        "2031-06-04",
        "2031-06-17",
        "2031-06-08",
    )
    first, second = plan["items"]  # type: ignore[misc]
    assert (first["title"], first["state"], first["minutes"]) == (
        "Ler o capítulo de JOINs",
        "placed",
        45,
    )
    assert first["start_at"] == "2031-06-04T15:05:00Z"
    assert first["links"] == [{"label": "SQLBolt", "url": "https://sqlbolt.com/lesson/6"}]
    assert second["prerequisites"] == [first["id"]]
    assert plan["discarded"] == [
        {
            "position": 2,
            "title": "Projeto final",
            "reasons": ["it takes 300 minutes, and a step has to take between 15 and 60"],
        }
    ]


def test_a_step_whose_start_has_passed_reads_as_passed(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    """Read against the clock, never stored (ADR-0033): the row still says placed."""
    plan = _plan(app, client, people[0])
    first = plan["items"][0]  # type: ignore[index]
    with get_session_factory()() as session:
        session.execute(
            update(PlanDraftItem)
            .where(PlanDraftItem.id == uuid.UUID(first["id"]))
            .values(start_at=datetime(2020, 1, 6, 12, 0, tzinfo=timezone.utc))
        )
        session.commit()

    again = client.get(f"/api/v1/plans/{plan['id']}").json()

    assert [item["state"] for item in again["items"]] == ["passed", "placed"]
    with get_session_factory()() as session:
        assert session.get_one(PlanDraftItem, uuid.UUID(first["id"])).placement == "placed"


def test_only_a_pending_plan_has_steps_that_passed(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    """An approved plan's steps are tasks now; a start in the past is not a step running late."""
    plan = _plan(app, client, people[0])
    with get_session_factory()() as session:
        session.execute(
            update(PlanDraftItem)
            .where(PlanDraftItem.draft_id == uuid.UUID(str(plan["id"])))
            .values(start_at=datetime(2020, 1, 6, 12, 0, tzinfo=timezone.utc))
        )
        session.execute(
            update(PlanDraft)
            .where(PlanDraft.id == uuid.UUID(str(plan["id"])))
            .values(status="approved", ended_at=func.now(), idempotency_key="k-1")
        )
        session.commit()

    again = client.get(f"/api/v1/plans/{plan['id']}").json()

    assert again["status"] == "approved"
    assert [item["state"] for item in again["items"]] == ["placed", "placed"]
