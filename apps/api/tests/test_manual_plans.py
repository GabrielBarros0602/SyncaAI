"""Plans written by hand, in the same draft a model's plan is reviewed in (ADR-0006, ADR-0047).

Through HTTP, a plan by hand is followed from empty to tasks, with explicit times so the test
does not depend on the clock it runs at; where a step is placed is asserted against the
service with a fixed clock instead. Everything committed is deleted with its owner afterwards.
"""

import json
import uuid
from collections.abc import Iterator
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from syncaai.api.dependencies import get_current_user_id
from syncaai.db import get_session_factory
from syncaai.errors import PlanInProgressError
from syncaai.models import AiJob, AiUsage, PlanDraft, Task, User
from syncaai.planning.contract import MAX_PLAN_ITEMS
from syncaai.planning.generator import FakeGenerator
from syncaai.schemas.plans import PlanItemCreate
from syncaai.services.ai_queue import VISIBILITY_TIMEOUT
from syncaai.services.plan_jobs import PLAN_IN_PROGRESS, run_plan_job
from syncaai.services.plans import PlanService

pytestmark = pytest.mark.integration

PLANS = "/api/v1/plans"
SAO_PAULO = ZoneInfo("America/Sao_Paulo")
# A Wednesday at noon in São Paulo: free from 12:05 to the window's end at 22:00.
WEDNESDAY_NOON = datetime(2031, 6, 4, 12, 0, tzinfo=SAO_PAULO)
STEP = {"title": "Encaixotar a cozinha", "minutes": 45}


@pytest.fixture
def people() -> Iterator[list[uuid.UUID]]:
    with get_session_factory()() as session:
        users = [
            User(email=f"by-hand-{uuid.uuid4()}@example.com", password_hash="not-a-real-hash")
            for _ in range(2)
        ]
        session.add_all(users)
        session.commit()
        ids = [user.id for user in users]
    try:
        yield ids
    finally:
        with get_session_factory()() as session:
            session.execute(delete(AiUsage).where(AiUsage.user_id.in_(ids)))
            session.execute(delete(User).where(User.id.in_(ids)))
            session.commit()


def _as(app: FastAPI, person: uuid.UUID) -> None:
    app.dependency_overrides[get_current_user_id] = lambda: person


def _write(client: TestClient, name: str = "Mudança de apartamento") -> dict[str, Any]:
    response = client.post(PLANS, json={"request": name})
    assert response.status_code == 201, response.text
    return dict(response.json())


def _add(client: TestClient, plan: dict[str, Any], **step: Any) -> Any:
    return client.post(f"{PLANS}/{plan['id']}/items", json={**STEP, **step})


def _draft(plan: dict[str, Any]) -> PlanDraft:
    with get_session_factory()() as session:
        return session.get_one(PlanDraft, uuid.UUID(plan["id"]))


# --- A plan by hand ------------------------------------------------------------------------


def test_a_plan_written_by_hand_starts_empty_with_no_job_and_no_prompt(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    _as(app, people[0])

    plan = _write(client, "  Mudança de apartamento  ")

    assert (plan["status"], plan["request"], plan["items"]) == (
        "pending",
        "Mudança de apartamento",
        [],
    )
    draft = _draft(plan)
    assert (draft.job_id, draft.prompt_version) == (None, None)
    assert (draft.last_day - draft.first_day).days == 13
    with get_session_factory()() as session:
        jobs = select(func.count()).select_from(AiJob).where(AiJob.user_id == people[0])
        # Not a job: it spends none of the AI's rate limit (ADR-0042).
        assert session.scalar(jobs) == 0


def test_a_plan_by_hand_goes_from_empty_to_tasks(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    _as(app, people[0])
    plan = _write(client)
    first = _add(client, plan, title="Comprar caixas", minutes=30).json()
    second = _add(client, plan, title="Encaixotar a cozinha", minutes=60).json()
    day = datetime.now(SAO_PAULO).date() + timedelta(days=2)
    for item, hour in ((first, 9), (second, 10)):
        start = datetime(day.year, day.month, day.day, hour, tzinfo=SAO_PAULO)
        moved = client.patch(
            f"{PLANS}/{plan['id']}/items/{item['id']}", json={"start_at": start.isoformat()}
        )
        assert moved.status_code == 200, moved.text

    response = client.post(f"{PLANS}/{plan['id']}/commit", headers={"Idempotency-Key": "k-1"})

    assert response.status_code == 200, response.text
    with get_session_factory()() as session:
        tasks = session.scalars(
            select(Task).where(Task.user_id == people[0]).order_by(Task.start_at)
        ).all()
        assert [(t.title, t.duration_minutes) for t in tasks] == [
            ("Comprar caixas", 30),
            ("Encaixotar a cozinha", 60),
        ]
    assert _draft(plan).status == "approved"


def test_a_plan_with_no_step_is_refused_at_commit(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    _as(app, people[0])
    plan = _write(client)

    response = client.post(f"{PLANS}/{plan['id']}/commit", headers={"Idempotency-Key": "k-1"})

    assert response.status_code == 409
    assert response.json() == {
        "detail": "The plan has no steps to commit. Add one, or discard the plan."
    }


# --- One plan at a time --------------------------------------------------------------------


def test_a_second_plan_by_hand_is_refused_while_one_is_pending(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    _as(app, people[0])
    _write(client)

    response = client.post(PLANS, json={"request": "Outro plano"})

    assert response.status_code == 409
    assert response.json() == {"detail": PLAN_IN_PROGRESS}


def test_a_plan_by_hand_is_refused_while_a_model_is_making_one(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    _as(app, people[0])
    assert client.post("/api/v1/ai/plans", json={"request": "Plano SQL"}).status_code == 202

    assert client.post(PLANS, json={"request": "À mão"}).status_code == 409


def test_a_model_is_not_asked_while_a_plan_by_hand_is_pending(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    _as(app, people[0])
    _write(client)

    assert client.post("/api/v1/ai/plans", json={"request": "Plano SQL"}).status_code == 409


# --- Adding a step -------------------------------------------------------------------------


def test_a_step_added_is_the_plan_s_last(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    _as(app, people[0])
    plan = _write(client)
    _add(client, plan, title="Primeiro")

    response = _add(client, plan, title="Segundo", minutes=20, description="  Com calma.  ")

    assert response.status_code == 201, response.text
    step = response.json()
    assert (step["position"], step["title"], step["minutes"], step["description"]) == (
        1,
        "Segundo",
        20,
        "Com calma.",
    )
    assert step["prerequisites"] == [] and step["links"] == []
    read = client.get(f"{PLANS}/{plan['id']}").json()
    assert [item["title"] for item in read["items"]] == ["Primeiro", "Segundo"]


def test_a_step_can_be_added_to_a_plan_a_model_wrote(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    """The step the model left out (ADR-0047)."""
    _as(app, people[0])
    job_id = uuid.UUID(client.post("/api/v1/ai/plans", json={"request": "SQL"}).json()["job_id"])
    with get_session_factory()() as session:
        session.execute(
            update(AiJob)
            .where(AiJob.id == job_id)
            .values(status="running", attempts=1, locked_until=func.now() + VISIBILITY_TIMEOUT)
        )
        session.commit()
    answer = {
        "items": [
            {
                "title": "Ler sobre JOINs",
                "description": "",
                "estimated_minutes": 45,
                "depends_on": [],
                "links": [],
            }
        ]
    }
    run_plan_job(get_session_factory(), FakeGenerator([json.dumps(answer)]), job_id, attempt=1)
    plan_id = client.get(f"/api/v1/ai/plans/{job_id}").json()["plan_id"]

    response = _add(client, {"id": plan_id}, title="Praticar no SQLBolt")

    assert response.status_code == 201, response.text
    assert response.json()["position"] == 1
    with get_session_factory()() as session:
        assert session.get_one(PlanDraft, uuid.UUID(plan_id)).job_id == job_id


def test_the_twelfth_step_is_the_last_a_plan_takes(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    _as(app, people[0])
    plan = _write(client)
    for n in range(MAX_PLAN_ITEMS):
        assert _add(client, plan, title=f"Passo {n}", minutes=15).status_code == 201

    response = _add(client, plan, title="Um a mais", minutes=15)

    assert response.status_code == 422
    assert response.json() == {"detail": f"A plan holds at most {MAX_PLAN_ITEMS} steps."}


@pytest.mark.parametrize(
    "step",
    [
        {"title": ""},
        {"title": "   "},
        {"title": "t" * 201},
        {"minutes": 0},
        {"minutes": 1441},
        {"description": "d" * 501},
    ],
)
def test_a_step_outside_its_bounds_is_refused(
    app: FastAPI, client: TestClient, people: list[uuid.UUID], step: dict[str, Any]
) -> None:
    _as(app, people[0])
    plan = _write(client)

    assert _add(client, plan, **step).status_code == 422


def test_another_person_s_plan_takes_no_step(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    _as(app, people[0])
    plan = _write(client)
    _as(app, people[1])

    assert _add(client, plan).status_code == 404


def test_a_discarded_plan_takes_no_step(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    _as(app, people[0])
    plan = _write(client)
    assert client.post(f"{PLANS}/{plan['id']}/discard").status_code == 204

    assert _add(client, plan).status_code == 409


# --- Where an added step goes, on a fixed clock ---------------------------------------------


@pytest.fixture
def session() -> Iterator[Session]:
    with get_session_factory()() as session:
        yield session
        session.rollback()


@pytest.fixture
def owner(session: Session) -> uuid.UUID:
    user = User(email=f"by-hand-{uuid.uuid4()}@example.com", password_hash="not-a-real-hash")
    session.add(user)
    session.flush()
    return user.id


def _service_plan(session: Session, owner: uuid.UUID) -> tuple[PlanService, uuid.UUID]:
    service = PlanService(session, owner)
    plan = service.write("Mudança", horizon_days=14, now=WEDNESDAY_NOON)
    return service, plan.id


def test_an_added_step_is_placed_at_the_earliest_free_time(
    session: Session, owner: uuid.UUID
) -> None:
    service, plan_id = _service_plan(session, owner)

    first = service.add_item(plan_id, PlanItemCreate(**STEP), now=WEDNESDAY_NOON)
    second = service.add_item(
        plan_id, PlanItemCreate(title="Desmontar a cama", minutes=30), now=WEDNESDAY_NOON
    )

    assert (first.state, first.start_at) == (
        "placed",
        datetime(2031, 6, 4, 15, 5, tzinfo=timezone.utc),
    )
    # The first step is held where it is: the second goes after it.
    assert second.start_at == datetime(2031, 6, 4, 15, 50, tzinfo=timezone.utc)


def test_an_added_step_goes_around_a_booked_task(session: Session, owner: uuid.UUID) -> None:
    service, plan_id = _service_plan(session, owner)
    session.add(
        Task(
            user_id=owner,
            title="Reunião",
            start_at=datetime(2031, 6, 4, 12, 30, tzinfo=SAO_PAULO),
            duration_minutes=150,
        )
    )
    session.flush()

    step = service.add_item(plan_id, PlanItemCreate(**STEP), now=WEDNESDAY_NOON)

    assert step.start_at == datetime(2031, 6, 4, 18, 0, tzinfo=timezone.utc)


def test_two_plans_by_hand_at_once_lose_the_race_at_the_index(
    session: Session, owner: uuid.UUID, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The second request passed its check before the first was written, and the index on
    drafts refuses it with the same sentence (ADR-0033)."""
    _service_plan(session, owner)
    late = PlanService(session, owner)
    monkeypatch.setattr(late._drafts, "any_pending", lambda: False)

    with pytest.raises(PlanInProgressError):
        late.write("Outro plano", horizon_days=14, now=WEDNESDAY_NOON)


def test_any_other_refusal_of_a_plan_by_hand_is_the_database_s(
    session: Session, owner: uuid.UUID
) -> None:
    """Below the schema's checks, the table's own: an empty name is not a race."""
    with pytest.raises(IntegrityError, match="ck_plan_drafts_request_length"):
        PlanService(session, owner).write("", horizon_days=14, now=WEDNESDAY_NOON)
