"""Asking for a plan and reading it, over HTTP against a real PostgreSQL (ADR-0038).

The signed-in person is set by overriding who the token says they are, because login has its
own tests; everything below that is real. A plan is produced by running the job here, as the
worker would, with a scripted answer, so the review read back is one the test chose.
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
from sqlalchemy import delete, event, func, select, text, update
from sqlalchemy.exc import OperationalError

from syncaai.api.dependencies import get_current_user_id
from syncaai.db import get_session_factory
from syncaai.errors import PlanNotPendingError
from syncaai.models import AiJob, AiUsage, PlanDraft, PlanDraftItem, Task, User
from syncaai.planning.generator import FakeGenerator
from syncaai.repositories.plans import PlanDraftRepository
from syncaai.services.ai_queue import VISIBILITY_TIMEOUT
from syncaai.services.plan_jobs import PLAN_IN_PROGRESS, run_plan_job
from syncaai.services.plans import PlanService

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
            # Usage outlives an account on purpose (ADR-0041), so it is deleted by hand.
            session.execute(delete(AiUsage).where(AiUsage.user_id.in_(ids)))
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


# --- Reviewing: changing a step (ADR-0030) -------------------------------------------------
#
# The plan made above: "Ler" at 12:05 and "Exercícios" at 12:50 on Wednesday 4 June 2031, in
# São Paulo, the second depending on the first. Moves go to the Thursday after.


def _step_url(plan: dict[str, object], index: int) -> str:
    item = plan["items"][index]  # type: ignore[index]
    return f"/api/v1/plans/{plan['id']}/items/{item['id']}"


def _thursday(hour: int, minute: int = 0) -> str:
    return f"2031-06-05T{hour:02d}:{minute:02d}:00-03:00"


def _book(person: uuid.UUID, start: str, minutes: int, *, completed_before: bool = False) -> None:
    with get_session_factory()() as session:
        task = Task(
            user_id=person,
            title="Dentista",
            start_at=datetime.fromisoformat(start),
            duration_minutes=minutes,
        )
        session.add(task)
        session.flush()
        if completed_before:
            task.completed_at = datetime.fromisoformat(start) - timedelta(days=1)
        session.commit()


def test_a_step_can_be_renamed_resized_and_moved(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    plan = _plan(app, client, people[0])

    response = client.patch(
        _step_url(plan, 1),
        json={"title": "  Exercícios de LEFT JOIN  ", "minutes": 30, "start_at": _thursday(10)},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["title"], body["minutes"], body["start_at"], body["state"]) == (
        "Exercícios de LEFT JOIN",
        30,
        "2031-06-05T13:00:00Z",
        "placed",
    )


@pytest.mark.parametrize(
    "changes",
    [
        {"title": "   "},
        {"title": None},
        {"minutes": 0},
        {"minutes": 1441},
        {"minutes": None},
        {"start_at": None},
        {"start_at": "2031-06-05T10:00:00"},
    ],
)
def test_a_change_outside_a_task_s_bounds_is_refused(
    app: FastAPI, client: TestClient, people: list[uuid.UUID], changes: dict[str, object]
) -> None:
    plan = _plan(app, client, people[0])

    assert client.patch(_step_url(plan, 0), json=changes).status_code == 422


def test_a_step_may_outgrow_the_block_once_the_person_edits_it(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    """The block bounds what the model proposes, never what the person edits (ADR-0032)."""
    plan = _plan(app, client, people[0])

    response = client.patch(_step_url(plan, 1), json={"minutes": 240, "start_at": _thursday(8)})

    assert response.status_code == 200, response.text


def test_a_step_cannot_be_moved_into_the_past(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    plan = _plan(app, client, people[0])

    response = client.patch(_step_url(plan, 0), json={"start_at": "2020-01-06T09:00:00-03:00"})

    assert response.status_code == 422
    assert response.json() == {"detail": "A step cannot start in the past."}


def test_a_step_cannot_be_moved_onto_a_task_but_may_follow_it(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    plan = _plan(app, client, people[0])
    _book(people[0], _thursday(10), 60)

    onto = client.patch(_step_url(plan, 0), json={"start_at": _thursday(10, 30)})
    after = client.patch(_step_url(plan, 0), json={"start_at": _thursday(11)})

    assert onto.status_code == 409
    assert onto.json() == {"detail": "That time is already taken by a task."}
    assert after.status_code == 200, after.text


def test_a_task_completed_before_it_began_holds_no_time(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    """The empty range sits inside the step's forty-five minutes, where a query for what
    touches the step does return it: the step's own check is what lets it through."""
    plan = _plan(app, client, people[0])
    _book(people[0], _thursday(14, 30), 60, completed_before=True)

    assert client.patch(_step_url(plan, 0), json={"start_at": _thursday(14)}).status_code == 200


def test_a_step_cannot_take_another_step_s_time(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    """Moving onto the other step is refused; staying put is no overlap with itself; and
    lengthening into the next step is refused, because the end moves too."""
    plan = _plan(app, client, people[0])
    first = plan["items"][0]  # type: ignore[index]

    onto = client.patch(_step_url(plan, 1), json={"start_at": first["start_at"]})
    stay = client.patch(_step_url(plan, 0), json={"start_at": first["start_at"]})
    longer = client.patch(_step_url(plan, 0), json={"minutes": 60})

    assert onto.status_code == 409
    assert onto.json() == {"detail": "That time is taken by another step of this plan."}
    assert stay.status_code == 200, stay.text
    assert longer.status_code == 409


def test_a_step_with_no_time_is_placed_by_giving_it_a_start(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    plan = _plan(app, client, people[0])
    second = plan["items"][1]  # type: ignore[index]
    with get_session_factory()() as session:
        session.execute(
            update(PlanDraftItem)
            .where(PlanDraftItem.id == uuid.UUID(second["id"]))
            .values(placement="no_room", start_at=None)
        )
        session.commit()

    response = client.patch(_step_url(plan, 1), json={"start_at": _thursday(9)})

    assert response.json()["state"] == "placed"


def test_removing_a_step_frees_the_steps_that_waited_for_it(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    plan = _plan(app, client, people[0])

    removed = client.delete(_step_url(plan, 0))
    again = client.delete(_step_url(plan, 0))

    assert removed.status_code == 204
    assert again.status_code == 404 and again.json() == {"detail": "No such step."}
    [left] = client.get(f"/api/v1/plans/{plan['id']}").json()["items"]
    assert (left["title"], left["prerequisites"]) == ("Exercícios de JOINs", [])


# --- Discarding ----------------------------------------------------------------------------


def test_a_discarded_plan_stays_readable_and_closed_to_change(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    plan = _plan(app, client, people[0])
    discard = f"/api/v1/plans/{plan['id']}/discard"

    assert client.post(discard).status_code == 204

    assert client.get(f"/api/v1/plans/{plan['id']}").json()["status"] == "discarded"
    closed = {"detail": "This plan is no longer open for review."}
    for refused in (
        client.patch(_step_url(plan, 0), json={"minutes": 30}),
        client.delete(_step_url(plan, 0)),
        client.post(discard),
    ):
        assert refused.status_code == 409 and refused.json() == closed
    with get_session_factory()() as session:
        assert session.get_one(PlanDraft, uuid.UUID(str(plan["id"]))).ended_at is not None


def test_someone_else_s_plan_cannot_be_changed_or_discarded(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    plan = _plan(app, client, people[0])
    _as(app, people[1])

    for response in (
        client.patch(_step_url(plan, 0), json={"minutes": 30}),
        client.delete(_step_url(plan, 0)),
        client.post(f"/api/v1/plans/{plan['id']}/discard"),
    ):
        assert response.status_code == 404
    _as(app, people[0])
    assert client.get(f"/api/v1/plans/{plan['id']}").json()["status"] == "pending"


def test_a_step_of_another_plan_is_not_found_in_this_one(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    """Somebody else's real step, named through my own plan: a step is looked up inside the
    plan the path names, never by its id alone."""
    theirs = _plan(app, client, people[1])
    their_step = theirs["items"][0]  # type: ignore[index]
    mine = _plan(app, client, people[0])

    response = client.patch(
        f"/api/v1/plans/{mine['id']}/items/{their_step['id']}", json={"minutes": 30}
    )

    assert response.status_code == 404 and response.json() == {"detail": "No such step."}
    with get_session_factory()() as session:
        assert session.get_one(PlanDraftItem, uuid.UUID(their_step["id"])).minutes == 45


def test_two_changes_to_one_plan_wait_for_each_other(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    """Each change checks for overlap and then writes; without the lock, two at once could
    each find the time free and both take it. The second waits, and ``lock_timeout`` turns
    that wait into an error here instead of a hang."""
    plan = _plan(app, client, people[0])
    plan_id = uuid.UUID(str(plan["id"]))
    factory = get_session_factory()

    with factory() as first, factory() as second:
        assert PlanDraftRepository(first, people[0]).get_for_change(plan_id) is not None
        second.execute(text("SET LOCAL lock_timeout = '500ms'"))
        with pytest.raises(OperationalError, match="lock timeout"):
            PlanDraftRepository(second, people[0]).get_for_change(plan_id)
        first.rollback()
        second.rollback()


# --- Committing (ADR-0030 §6) --------------------------------------------------------------


def _commit(client: TestClient, plan: dict[str, object], key: str | None = "key-1") -> Any:
    headers = {} if key is None else {"Idempotency-Key": key}
    return client.post(f"/api/v1/plans/{plan['id']}/commit", headers=headers)


def _tasks_of(person: uuid.UUID) -> list[Task]:
    with get_session_factory()() as session:
        statement = select(Task).where(Task.user_id == person).order_by(Task.start_at)
        return list(session.scalars(statement).all())


def test_a_committed_plan_becomes_its_tasks_and_closes(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    plan = _plan(app, client, people[0])

    response = _commit(client, plan)

    assert response.status_code == 200, response.text
    tasks = _tasks_of(people[0])
    assert response.json() == {"plan_id": plan["id"], "task_ids": [str(t.id) for t in tasks]}
    assert [(t.title, t.duration_minutes, t.plan_id) for t in tasks] == [
        ("Ler o capítulo de JOINs", 45, uuid.UUID(str(plan["id"]))),
        ("Exercícios de JOINs", 45, uuid.UUID(str(plan["id"]))),
    ]
    assert [t.start_at for t in tasks] == [
        datetime(2031, 6, 4, 15, 5, tzinfo=timezone.utc),
        datetime(2031, 6, 4, 15, 50, tzinfo=timezone.utc),
    ]
    # The note is written by code from what the draft kept, never copied from the model.
    assert tasks[0].notes == "O capítulo 6.\n\nLinks\n- SQLBolt — https://sqlbolt.com/lesson/6"
    assert tasks[1].notes is None
    assert client.get(f"/api/v1/plans/{plan['id']}").json()["status"] == "approved"
    with get_session_factory()() as session:
        draft = session.get_one(PlanDraft, uuid.UUID(str(plan["id"])))
        assert (draft.idempotency_key, draft.ended_at is not None) == ("key-1", True)


def test_a_repeat_with_the_same_key_answers_the_first_commit_and_adds_nothing(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    plan = _plan(app, client, people[0])

    first = _commit(client, plan)
    repeat = _commit(client, plan)

    assert repeat.status_code == 200
    assert repeat.json() == first.json()
    assert len(_tasks_of(people[0])) == 2


def test_another_commit_of_a_committed_plan_is_refused(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    plan = _plan(app, client, people[0])
    _commit(client, plan)

    other = _commit(client, plan, key="key-2")

    assert other.status_code == 409
    assert other.json() == {"detail": "This plan is no longer open for review."}
    assert len(_tasks_of(people[0])) == 2


def test_a_commit_without_an_idempotency_key_is_refused(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    plan = _plan(app, client, people[0])

    assert _commit(client, plan, key=None).status_code == 422
    assert _tasks_of(people[0]) == []


def test_steps_in_the_way_are_all_named_and_nothing_is_written(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    """One step with no time, one whose start has passed: both reasons in one answer, so the
    review can show everything to change at once."""
    plan = _plan(app, client, people[0])
    first, second = plan["items"]  # type: ignore[misc]
    with get_session_factory()() as session:
        session.execute(
            update(PlanDraftItem)
            .where(PlanDraftItem.id == uuid.UUID(first["id"]))
            .values(placement="no_room", start_at=None)
        )
        session.execute(
            update(PlanDraftItem)
            .where(PlanDraftItem.id == uuid.UUID(second["id"]))
            .values(start_at=datetime(2020, 1, 6, 12, 0, tzinfo=timezone.utc))
        )
        session.commit()

    response = _commit(client, plan)

    assert response.status_code == 409
    assert response.json() == {
        "detail": "The plan cannot become tasks as it stands. Nothing was written.",
        "items": [
            {
                "id": first["id"],
                "title": first["title"],
                "reason": "It has no time yet. Give it one, or remove it.",
            },
            {
                "id": second["id"],
                "title": second["title"],
                "reason": "Its start has passed. Move it, or remove it.",
            },
        ],
    }
    assert _tasks_of(people[0]) == []
    assert client.get(f"/api/v1/plans/{plan['id']}").json()["status"] == "pending"


def test_a_task_booked_since_on_a_step_s_time_stops_the_commit(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    plan = _plan(app, client, people[0])
    first = plan["items"][0]  # type: ignore[index]
    _book(people[0], "2031-06-04T12:30:00-03:00", 15)

    response = _commit(client, plan)

    assert response.status_code == 409
    assert response.json()["items"] == [
        {
            "id": first["id"],
            "title": first["title"],
            "reason": "A task was booked on its time since. Move it, or remove it.",
        }
    ]
    assert len(_tasks_of(people[0])) == 1


def test_a_task_completed_before_it_began_does_not_stop_the_commit(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    plan = _plan(app, client, people[0])
    _book(people[0], "2031-06-04T12:30:00-03:00", 15, completed_before=True)

    assert _commit(client, plan).status_code == 200


def test_a_plan_with_every_step_removed_has_nothing_to_commit(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    plan = _plan(app, client, people[0])
    client.delete(_step_url(plan, 0))
    client.delete(_step_url(plan, 1))

    response = _commit(client, plan)

    assert response.status_code == 409
    assert response.json() == {"detail": "Nothing is left to commit. Discard the plan instead."}


def test_a_discarded_plan_cannot_be_committed_and_someone_else_s_is_not_found(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    mine = _plan(app, client, people[0])
    client.post(f"/api/v1/plans/{mine['id']}/discard")
    assert _commit(client, mine).status_code == 409

    theirs = _plan(app, client, people[1])
    _as(app, people[0])
    assert _commit(client, theirs).status_code == 404
    assert _tasks_of(people[1]) == []


def test_a_task_booked_between_the_check_and_the_insert_loses_to_the_constraint(
    app: FastAPI, client: TestClient, people: list[uuid.UUID], monkeypatch: pytest.MonkeyPatch
) -> None:
    """The check is skipped to stand for the race it cannot see: the exclusion constraint has
    the final word, and the whole commit goes with it."""
    plan = _plan(app, client, people[0])
    _book(people[0], "2031-06-04T12:30:00-03:00", 15)
    monkeypatch.setattr(PlanService, "_commit_problems", lambda self, draft, now: [])

    response = _commit(client, plan)

    assert response.status_code == 409
    assert response.json() == {
        "detail": "A task was booked on one of these times just now. "
        "Nothing was written; read the plan again."
    }
    assert [t.title for t in _tasks_of(people[0])] == ["Dentista"]
    assert client.get(f"/api/v1/plans/{plan['id']}").json()["status"] == "pending"


def test_a_committed_plan_makes_room_for_the_next(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    plan = _plan(app, client, people[0])
    _commit(client, plan)

    _ask(client)


def test_a_commit_waits_for_any_other_change_to_the_same_plan(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    """Two commits of one plan are one commit and one repeat only if the second waits for
    the first before it writes anything. Without its own lock it would still stop, but later:
    at the plan's UPDATE, with its tasks already inserted. So the statements it sent are
    recorded, and none of them may be an insert of tasks. ``lock_timeout`` turns the wait
    into an error here instead of a hang."""
    plan = _plan(app, client, people[0])
    plan_id = uuid.UUID(str(plan["id"]))
    factory = get_session_factory()
    sent: list[str] = []

    with factory() as first, factory() as second:
        assert PlanDraftRepository(first, people[0]).get_for_change(plan_id) is not None
        second.execute(text("SET LOCAL lock_timeout = '500ms'"))
        connection = second.connection()

        def record(_conn: object, _cursor: object, statement: str, *_args: object) -> None:
            sent.append(statement)

        event.listen(connection, "before_cursor_execute", record)
        with pytest.raises(OperationalError, match="lock timeout"):
            PlanService(second, people[0]).commit(
                plan_id, key="key-1", now=datetime.now(timezone.utc)
            )
        event.remove(connection, "before_cursor_execute", record)
        first.rollback()
        second.rollback()

    assert sent, "the second commit sent nothing, so this test proved nothing"
    assert not any(statement.lstrip().upper().startswith("INSERT INTO TASKS") for statement in sent)


# --- Placing again (ADR-0033) --------------------------------------------------------------
#
# The scheduler runs against the clock, so these call the service with a chosen instant; the
# routes are checked for their wiring at the end. The plan is the one made above, on
# Wednesday 4 June 2031 at noon: "Ler" at 12:05 and "Exercícios" at 12:50, the second after
# the first, and a horizon to Tuesday 17 June.

SAO_PAULO = ZoneInfo("America/Sao_Paulo")


def _at(day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(2031, 6, day, hour, minute, tzinfo=SAO_PAULO).astimezone(timezone.utc)


def _service_call(person: uuid.UUID, action: str, plan: dict[str, object], now: datetime) -> Any:
    with get_session_factory()() as session:
        result = getattr(PlanService(session, person), action)(uuid.UUID(str(plan["id"])), now=now)
        session.commit()
        return result


def _move(item_id: str, **values: object) -> None:
    with get_session_factory()() as session:
        session.execute(
            update(PlanDraftItem).where(PlanDraftItem.id == uuid.UUID(item_id)).values(**values)
        )
        session.commit()


def _starts(plan: Any) -> list[tuple[datetime | None, str]]:
    return [(item.start_at, item.state) for item in plan.items]


def test_steps_whose_time_passed_are_placed_again_after_now_keeping_their_order(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    """At 14:00 both steps have passed: they go to 14:05 and 14:50, the second still after
    the first, and a title changed in review stays changed."""
    plan = _plan(app, client, people[0])
    client.patch(_step_url(plan, 0), json={"title": "Ler o capítulo 6"})

    placed = _service_call(people[0], "replace", plan, _at(4, 14))

    assert _starts(placed) == [(_at(4, 14, 5), "placed"), (_at(4, 14, 50), "placed")]
    assert placed.items[0].title == "Ler o capítulo 6"


def test_a_step_that_keeps_its_time_holds_it_when_another_is_placed_again(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    """With the first step removed, the second is moved by hand to 14:05 and stays, and a
    new step has no time. It must not land on the kept one, which is not a task yet and so
    is invisible to the calendar."""
    plan = _plan(app, client, people[0])
    first, second = plan["items"]  # type: ignore[misc]
    client.delete(f"/api/v1/plans/{plan['id']}/items/{first['id']}")
    _move(second["id"], start_at=_at(4, 14, 5), placement="placed")
    with get_session_factory()() as session:
        draft = session.get_one(PlanDraft, uuid.UUID(str(plan["id"])))
        session.add(
            PlanDraftItem(
                draft_id=draft.id,
                position=5,
                title="Revisar",
                minutes=45,
                placement="no_room",
            )
        )
        session.commit()

    placed = _service_call(people[0], "replace", plan, _at(4, 14))

    assert _starts(placed) == [(_at(4, 14, 5), "placed"), (_at(4, 14, 50), "placed")]


def test_placing_again_fills_this_week_first(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    """Sunday at 21:00: fifty-five minutes are left in the week. One step goes there, and the
    one after it waits for next week rather than being placed on Monday unasked."""
    plan = _plan(app, client, people[0])

    placed = _service_call(people[0], "replace", plan, _at(8, 21))

    assert _starts(placed) == [(_at(8, 21, 5), "placed"), (None, "not_this_week")]


def test_sent_on_a_step_takes_the_week_after_and_still_waits_for_its_prerequisite(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    plan = _plan(app, client, people[0])
    _service_call(people[0], "replace", plan, _at(8, 21))

    sent = _service_call(people[0], "next_week", plan, _at(8, 21))

    assert _starts(sent) == [(_at(8, 21, 5), "placed"), (_at(9, 6), "placed")]


def test_next_week_is_the_week_after_the_plan_s_first_not_after_today(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    """Pressed on the Tuesday after, the step goes that Tuesday, not a week further on."""
    plan = _plan(app, client, people[0])
    second = plan["items"][1]  # type: ignore[index]
    _move(second["id"], start_at=None, placement="not_this_week")

    sent = _service_call(people[0], "next_week", plan, _at(10, 8))

    assert _starts(sent)[1] == (_at(10, 8, 5), "placed")


def test_with_nothing_to_move_neither_action_changes_the_plan(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    plan = _plan(app, client, people[0])

    replaced = _service_call(people[0], "replace", plan, _at(4, 12))
    sent = _service_call(people[0], "next_week", plan, _at(4, 12))

    expected = [(_at(4, 12, 5), "placed"), (_at(4, 12, 50), "placed")]
    assert _starts(replaced) == expected and _starts(sent) == expected


def test_a_plan_whose_last_day_has_ended_reads_as_expired_and_takes_no_change(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    """The sweep has not recorded it yet; reading notices anyway (ADR-0033)."""
    plan = _plan(app, client, people[0])
    after_the_horizon = _at(18, 9)

    with get_session_factory()() as session:
        service = PlanService(session, people[0])
        # Its last day, Tuesday 17 June, is still a day to place in.
        assert service.plan(uuid.UUID(str(plan["id"])), now=_at(17, 21)).status == "pending"
        assert service.plan(uuid.UUID(str(plan["id"])), now=after_the_horizon).status == "expired"
        for action in ("replace", "next_week", "discard"):
            with pytest.raises(PlanNotPendingError):
                getattr(service, action)(uuid.UUID(str(plan["id"])), now=after_the_horizon)
        with pytest.raises(PlanNotPendingError):
            service.commit(uuid.UUID(str(plan["id"])), key="k", now=after_the_horizon)
        session.rollback()


def test_the_routes_answer_with_the_plan(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    plan = _plan(app, client, people[0])

    for action in ("replace", "next-week"):
        response = client.post(f"/api/v1/plans/{plan['id']}/{action}")
        assert response.status_code == 200, response.text
        assert response.json()["id"] == plan["id"]
    client.post(f"/api/v1/plans/{plan['id']}/discard")
    assert client.post(f"/api/v1/plans/{plan['id']}/replace").status_code == 409
    _as(app, people[1])
    assert client.post(f"/api/v1/plans/{plan['id']}/next-week").status_code == 404


def test_a_step_placed_again_still_waits_for_a_prerequisite_that_kept_its_time(
    app: FastAPI, client: TestClient, people: list[uuid.UUID]
) -> None:
    """The first step was moved to 15:00 and keeps it; the second, after it, has passed. At
    14:00 the free 14:05 would hold it, but its prerequisite only ends at 15:45."""
    plan = _plan(app, client, people[0])
    _move(plan["items"][0]["id"], start_at=_at(4, 15))  # type: ignore[index]

    placed = _service_call(people[0], "replace", plan, _at(4, 14))

    assert _starts(placed) == [(_at(4, 15), "placed"), (_at(4, 15, 45), "placed")]
