"""Tests for the checklist endpoints (ADR-0028).

The service and the schemas are real; the repository is a dictionary. What is checked here
is the contract — where an item lands, the stale-order refusal, both 404s, PATCH semantics.

Two claims need PostgreSQL and live elsewhere: that a full reorder and a delete pass the
deferred unique position (``test_task_persistence.py``), and that a stranger cannot reach an
item over HTTP (``test_task_isolation.py``).
"""

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient

from syncaai.api.dependencies import get_current_user_id
from syncaai.api.routes.tasks import get_checklist_service
from syncaai.db import get_session
from syncaai.models import ChecklistItem, Task
from syncaai.schemas.tasks import MAX_CHECKLIST_ITEMS
from syncaai.services.checklist import ChecklistService

TASKS = "/api/v1/tasks"
AN_OWNER = uuid.UUID("11111111-1111-1111-1111-111111111111")


class _FakeTasks:
    """Stands in for the repository, including the two things the ORM does here."""

    owner_id = AN_OWNER

    def __init__(self) -> None:
        self.rows: dict[uuid.UUID, Task] = {}

    def get_with_items(self, task_id: uuid.UUID) -> Task | None:
        task = self.rows.get(task_id)
        if task is not None:
            # The relationship is declared ordered by position, so a load arrives sorted.
            task.items.sort(key=lambda item: item.position)
        return task

    def flush(self) -> None:
        for task in self.rows.values():
            for item in task.items:
                item.id = item.id or uuid.uuid4()


class _NoOpSession:
    def commit(self) -> None:
        pass


def _wire(app: FastAPI, tasks: _FakeTasks) -> None:
    app.dependency_overrides[get_current_user_id] = lambda: AN_OWNER
    app.dependency_overrides[get_session] = lambda: _NoOpSession()
    app.dependency_overrides[get_checklist_service] = lambda: ChecklistService(tasks)  # type: ignore[arg-type]


def _task_with(tasks: _FakeTasks, *labels: str) -> tuple[str, list[str]]:
    task = Task(
        id=uuid.uuid4(),
        user_id=AN_OWNER,
        title="a task with steps",
        start_at=datetime.now(timezone.utc) + timedelta(days=1),
        duration_minutes=60,
    )
    task.items = [
        ChecklistItem(id=uuid.uuid4(), label=label, position=position, completed_at=None)
        for position, label in enumerate(labels)
    ]
    tasks.rows[task.id] = task
    return str(task.id), [str(item.id) for item in task.items]


def _order(tasks: _FakeTasks, task_id: str) -> list[tuple[int, str]]:
    task = tasks.get_with_items(uuid.UUID(task_id))
    assert task is not None
    return [(item.position, item.label) for item in task.items]


def test_an_added_item_lands_at_the_end(app: FastAPI, client: TestClient) -> None:
    tasks = _FakeTasks()
    _wire(app, tasks)
    task_id, _ = _task_with(tasks, "outline", "draft")

    response = client.post(f"{TASKS}/{task_id}/items", json={"label": "review"})

    assert response.status_code == 201, response.text
    assert response.json()["position"] == 2
    assert response.json()["completed_at"] is None
    assert _order(tasks, task_id) == [(0, "outline"), (1, "draft"), (2, "review")]


def test_adding_to_a_full_checklist_is_refused(app: FastAPI, client: TestClient) -> None:
    tasks = _FakeTasks()
    _wire(app, tasks)
    task_id, _ = _task_with(tasks, *(f"step {n}" for n in range(MAX_CHECKLIST_ITEMS)))

    response = client.post(f"{TASKS}/{task_id}/items", json={"label": "one too many"})

    assert response.status_code == 422
    assert response.json()["detail"] == "A task holds at most 50 checklist items."


def test_ticking_writes_the_moment_and_unticking_clears_it(
    app: FastAPI, client: TestClient
) -> None:
    tasks = _FakeTasks()
    _wire(app, tasks)
    task_id, [item_id] = _task_with(tasks, "outline")
    path = f"{TASKS}/{task_id}/items/{item_id}"

    ticked = client.patch(path, json={"completed": True}).json()
    unticked = client.patch(path, json={"completed": False}).json()

    assert ticked["completed_at"] is not None
    assert unticked["completed_at"] is None


def test_renaming_leaves_the_tick_alone(app: FastAPI, client: TestClient) -> None:
    """Only what was sent changes. A rename that resent the tick would undo one written by
    another tab — the reason the checklist is its own resource."""
    tasks = _FakeTasks()
    _wire(app, tasks)
    task_id, [item_id] = _task_with(tasks, "outline")
    path = f"{TASKS}/{task_id}/items/{item_id}"
    client.patch(path, json={"completed": True})

    body = client.patch(path, json={"label": "outline, first pass"}).json()

    assert body["label"] == "outline, first pass"
    assert body["completed_at"] is not None


def test_an_explicit_null_label_is_refused(app: FastAPI, client: TestClient) -> None:
    tasks = _FakeTasks()
    _wire(app, tasks)
    task_id, [item_id] = _task_with(tasks, "outline")

    response = client.patch(f"{TASKS}/{task_id}/items/{item_id}", json={"label": None})

    assert response.status_code == 422


def test_removing_an_item_closes_the_gap(app: FastAPI, client: TestClient) -> None:
    tasks = _FakeTasks()
    _wire(app, tasks)
    task_id, [first, _, _] = _task_with(tasks, "outline", "draft", "review")

    response = client.delete(f"{TASKS}/{task_id}/items/{first}")

    assert response.status_code == 204
    assert _order(tasks, task_id) == [(0, "draft"), (1, "review")]


def test_a_reorder_sets_every_position_at_once(app: FastAPI, client: TestClient) -> None:
    tasks = _FakeTasks()
    _wire(app, tasks)
    task_id, [outline, draft, review] = _task_with(tasks, "outline", "draft", "review")

    response = client.put(
        f"{TASKS}/{task_id}/items/order", json={"item_ids": [review, outline, draft]}
    )

    assert response.status_code == 200, response.text
    assert [item["label"] for item in response.json()] == ["review", "outline", "draft"]
    assert _order(tasks, task_id) == [(0, "review"), (1, "outline"), (2, "draft")]


def test_a_reorder_that_leaves_an_item_out_is_refused(app: FastAPI, client: TestClient) -> None:
    """An item added elsewhere since the client read the list. Merging would produce an
    order nobody saw."""
    tasks = _FakeTasks()
    _wire(app, tasks)
    task_id, [outline, draft, _] = _task_with(tasks, "outline", "draft", "review")

    response = client.put(f"{TASKS}/{task_id}/items/order", json={"item_ids": [draft, outline]})

    assert response.status_code == 409
    assert response.json()["detail"] == "The checklist changed since it was read. Read it again."
    assert _order(tasks, task_id) == [(0, "outline"), (1, "draft"), (2, "review")]


def test_a_reorder_that_names_an_item_twice_is_refused(app: FastAPI, client: TestClient) -> None:
    """The set of ids can be right while the list is not."""
    tasks = _FakeTasks()
    _wire(app, tasks)
    task_id, [outline, draft] = _task_with(tasks, "outline", "draft")

    response = client.put(
        f"{TASKS}/{task_id}/items/order", json={"item_ids": [outline, draft, outline]}
    )

    assert response.status_code == 409


def test_a_reorder_that_names_an_unknown_item_is_refused(app: FastAPI, client: TestClient) -> None:
    tasks = _FakeTasks()
    _wire(app, tasks)
    task_id, [outline, _] = _task_with(tasks, "outline", "draft")

    response = client.put(
        f"{TASKS}/{task_id}/items/order", json={"item_ids": [outline, str(uuid.uuid4())]}
    )

    assert response.status_code == 409


def test_an_item_is_only_found_on_its_own_task(app: FastAPI, client: TestClient) -> None:
    """Both tasks belong to the caller. The item id is still looked up among the items of
    the task in the path, and nowhere else."""
    tasks = _FakeTasks()
    _wire(app, tasks)
    one, _ = _task_with(tasks, "outline")
    _, [elsewhere] = _task_with(tasks, "pack the bag")

    response = client.patch(f"{TASKS}/{one}/items/{elsewhere}", json={"completed": True})

    assert response.status_code == 404
    assert response.json()["detail"] == "No such checklist item."


def test_an_unknown_task_answers_as_a_missing_task(app: FastAPI, client: TestClient) -> None:
    """The same 404 a task route gives, so the checklist cannot become the oracle the task
    routes refuse to be (ADR-0016)."""
    _wire(app, _FakeTasks())

    response = client.post(f"{TASKS}/{uuid.uuid4()}/items", json={"label": "anything"})

    assert response.status_code == 404
    assert response.json()["detail"] == "No such task."
