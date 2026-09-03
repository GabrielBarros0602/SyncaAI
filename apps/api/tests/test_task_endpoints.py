"""Tests for the task endpoints.

The service and the schemas are real; only the repositories and the session are
substituted. What is being checked here is the shape of the contract — validation, error
mapping, PATCH semantics, pagination bounds — none of which needs a database to be true.

The two claims that do need one are elsewhere: that PostgreSQL actually refuses an overlap
lives in the integration suite, and that one owner cannot reach another's task over HTTP
lives in ``test_task_isolation.py``.
"""

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError

from syncaai.api.dependencies import get_current_user, get_current_user_id
from syncaai.api.routes.tasks import get_task_service
from syncaai.config import Settings
from syncaai.db import get_session
from syncaai.models import Tag, Task
from syncaai.schemas.tasks import MAX_NOTES_LENGTH
from syncaai.services.tasks import OVERLAP_CONSTRAINT, TaskService

TASKS = "/api/v1/tasks"
TAGS = "/api/v1/tags"
AN_OWNER = uuid.UUID("11111111-1111-1111-1111-111111111111")
SAO_PAULO = "America/Sao_Paulo"


class _FakeUser:
    """The listing endpoint needs a zone to convert a local window (ADR-0009), so it takes
    the user row rather than only the id."""

    id = AN_OWNER
    timezone = SAO_PAULO


def _parsed(value: str) -> datetime:
    """``fromisoformat`` only learned to read a trailing ``Z`` in 3.11. The project runs
    3.12; this keeps the suite runnable on an older local interpreter too."""
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _future(**offset: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(**offset)).isoformat()


class _FakeTasks:
    """Stands in for the repository, including the part the database normally does."""

    def __init__(self, *, on_write: Exception | None = None) -> None:
        self.rows: dict[uuid.UUID, Task] = {}
        self.on_write = on_write
        self.last_page: tuple[int, int] | None = None
        self.last_window: tuple[datetime, datetime | None] | None = None

    owner_id = AN_OWNER

    def _derive_end_at(self, task: Task) -> None:
        # The trigger's job (ADR-0013). Doing it here keeps the response model satisfiable
        # without pretending the application owns the column.
        task.end_at = task.start_at + timedelta(minutes=task.duration_minutes)

    def add(self, task: Task) -> None:
        if self.on_write is not None:
            raise self.on_write
        task.id = task.id or uuid.uuid4()
        for position, item in enumerate(task.items):
            item.id, item.position, item.completed_at = uuid.uuid4(), position, None
        self._derive_end_at(task)
        self.rows[task.id] = task

    def flush(self) -> None:
        if self.on_write is not None:
            raise self.on_write
        for task in self.rows.values():
            self._derive_end_at(task)

    def get_with_items(self, task_id: uuid.UUID) -> Task | None:
        return self.rows.get(task_id)

    def list_with_items(
        self,
        *,
        limit: int,
        offset: int,
        starts_at_or_after: datetime | None = None,
        starts_before: datetime | None = None,
    ) -> list[Task]:
        self.last_page = (limit, offset)
        self.last_window = (
            None if starts_at_or_after is None else (starts_at_or_after, starts_before)
        )
        ordered = sorted(self.rows.values(), key=lambda task: task.start_at)
        return ordered[offset : offset + limit]

    def delete(self, task_id: uuid.UUID) -> bool:
        return self.rows.pop(task_id, None) is not None


class _FakeTags:
    def __init__(self) -> None:
        self.rows: dict[str, Tag] = {}

    def get_or_create(self, name: str) -> Tag:
        if name not in self.rows:
            self.rows[name] = Tag(id=uuid.uuid4(), user_id=AN_OWNER, name=name)
        return self.rows[name]

    def list(self, *, limit: int) -> list[Tag]:
        return sorted(self.rows.values(), key=lambda tag: tag.name)[:limit]


class _NoOpSession:
    def commit(self) -> None:
        pass


def _overlap_error() -> IntegrityError:
    """An IntegrityError shaped like the one psycopg raises for the exclusion constraint."""

    class _Diagnostics:
        constraint_name = OVERLAP_CONSTRAINT

    class _Original(Exception):
        diag = _Diagnostics()

    return IntegrityError("INSERT ...", None, _Original())


def _wire(app: FastAPI, tasks: _FakeTasks, tags: _FakeTags | None = None) -> _FakeTags:
    tags = tags or _FakeTags()
    app.dependency_overrides[get_current_user_id] = lambda: AN_OWNER
    app.dependency_overrides[get_current_user] = lambda: _FakeUser()
    app.dependency_overrides[get_session] = lambda: _NoOpSession()
    app.dependency_overrides[get_task_service] = lambda: TaskService(tasks, tags)  # type: ignore[arg-type]
    return tags


def _created(client: TestClient, **overrides: Any) -> dict[str, Any]:
    payload = {"title": "write the ADR", "start_at": _future(days=1), "duration_minutes": 60}
    payload.update(overrides)
    response = client.post(TASKS, json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def test_scheduling_a_task_returns_it_with_a_derived_end(app: FastAPI, client: TestClient) -> None:
    _wire(app, _FakeTasks())

    body = _created(client, duration_minutes=90)

    start = _parsed(body["start_at"])
    assert _parsed(body["end_at"]) == start + timedelta(minutes=90)


def test_checklist_items_keep_the_order_they_were_sent_in(app: FastAPI, client: TestClient) -> None:
    """Position is assigned by the server. A client that reorders its JSON cannot shuffle it."""
    _wire(app, _FakeTasks())

    body = _created(client, items=[{"label": "first"}, {"label": "second"}, {"label": "third"}])

    assert [(item["position"], item["label"]) for item in body["items"]] == [
        (0, "first"),
        (1, "second"),
        (2, "third"),
    ]


def test_a_start_in_the_past_is_refused(app: FastAPI, client: TestClient) -> None:
    _wire(app, _FakeTasks())

    response = client.post(
        TASKS,
        json={"title": "yesterday", "start_at": _future(days=-1), "duration_minutes": 30},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "A task cannot start in the past."


def test_a_start_seconds_away_is_accepted(app: FastAPI, client: TestClient) -> None:
    """The boundary is now, not some padded margin. Ten seconds ahead is the future."""
    _wire(app, _FakeTasks())

    response = client.post(
        TASKS, json={"title": "soon", "start_at": _future(seconds=10), "duration_minutes": 30}
    )

    assert response.status_code == 201


def test_a_timestamp_without_an_offset_is_refused(app: FastAPI, client: TestClient) -> None:
    """Which zone did the caller mean? Guessing is wrong twice a year (ADR-0009)."""
    _wire(app, _FakeTasks())

    response = client.post(
        TASKS,
        json={"title": "ambiguous", "start_at": "2030-06-01T09:00:00", "duration_minutes": 30},
    )

    assert response.status_code == 422
    assert "offset" in response.text


def test_a_duration_longer_than_a_day_is_refused(app: FastAPI, client: TestClient) -> None:
    _wire(app, _FakeTasks())

    response = client.post(
        TASKS, json={"title": "forever", "start_at": _future(days=1), "duration_minutes": 1441}
    )

    assert response.status_code == 422


def test_a_note_at_the_bound_is_accepted_and_one_past_it_is_not(
    app: FastAPI, client: TestClient
) -> None:
    """The only free-text field with no column behind it to bound it.

    It matters because of where a note goes rather than where it is stored: ADR-0004 excludes
    notes from the plan-generation context entirely and sends the invoked task's description
    for task assistance, so exactly one of these reaches a paid provider. ADR-0006 estimates
    spend before the call, and an unbounded field makes that estimate's worst case unbounded.

    Asserted at both sides of the bound, because a limit tested only from above passes just as
    well when it is off by one in the direction that refuses valid input.
    """
    _wire(app, _FakeTasks())
    task = {"title": "with a note", "start_at": _future(days=1), "duration_minutes": 30}

    at_the_bound = client.post(TASKS, json={**task, "notes": "n" * MAX_NOTES_LENGTH})
    past_it = client.post(TASKS, json={**task, "notes": "n" * (MAX_NOTES_LENGTH + 1)})

    assert at_the_bound.status_code == 201, at_the_bound.text
    assert past_it.status_code == 422


def test_an_overlap_answers_409_rather_than_500(app: FastAPI, client: TestClient) -> None:
    """The database refuses it; this asserts the refusal arrives as a rule, not a crash."""
    _wire(app, _FakeTasks(on_write=_overlap_error()))

    response = client.post(
        TASKS, json={"title": "double booked", "start_at": _future(days=1), "duration_minutes": 30}
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "That time is already taken by another task."


def test_an_unrelated_integrity_error_is_not_disguised_as_a_conflict(
    app: FastAPI, client: TestClient
) -> None:
    """A defect should look like one. Only the known constraint gets a friendly answer."""
    _wire(app, _FakeTasks(on_write=IntegrityError("INSERT ...", None, Exception("something else"))))

    with pytest.raises(IntegrityError):
        client.post(
            TASKS, json={"title": "broken", "start_at": _future(days=1), "duration_minutes": 30}
        )


def test_tags_that_differ_only_in_case_and_spacing_become_one(
    app: FastAPI, client: TestClient
) -> None:
    tags = _wire(app, _FakeTasks())

    for spelling in ("Deep Work", "deep work", "  DEEP   work  "):
        _created(client, tag=spelling, start_at=_future(days=len(spelling)))

    assert list(tags.rows) == ["deep work"]


def test_an_empty_tag_is_no_tag(app: FastAPI, client: TestClient) -> None:
    tags = _wire(app, _FakeTasks())

    body = _created(client, tag="   ")

    assert body["tag"] is None
    assert tags.rows == {}


def test_reading_a_task_that_does_not_exist_answers_404(app: FastAPI, client: TestClient) -> None:
    _wire(app, _FakeTasks())

    assert client.get(f"{TASKS}/{uuid.uuid4()}").status_code == 404


def test_completing_a_task_records_when(app: FastAPI, client: TestClient) -> None:
    """A timestamp, not a flag — the heatmap needs to know when (ADR-0008)."""
    _wire(app, _FakeTasks())
    task_id = _created(client)["id"]

    body = client.patch(f"{TASKS}/{task_id}", json={"completed": True}).json()

    assert body["completed_at"] is not None
    assert (
        client.patch(f"{TASKS}/{task_id}", json={"completed": False}).json()["completed_at"] is None
    )


def test_a_field_left_out_of_a_patch_is_left_alone(app: FastAPI, client: TestClient) -> None:
    _wire(app, _FakeTasks())
    task_id = _created(client, notes="keep me")["id"]

    body = client.patch(f"{TASKS}/{task_id}", json={"title": "renamed"}).json()

    assert body["title"] == "renamed"
    assert body["notes"] == "keep me"


def test_an_explicit_null_clears_a_nullable_field(app: FastAPI, client: TestClient) -> None:
    """Otherwise a note could be written and never removed."""
    _wire(app, _FakeTasks())
    task_id = _created(client, notes="a note", tag="deep work")["id"]

    body = client.patch(f"{TASKS}/{task_id}", json={"notes": None, "tag": None}).json()

    assert body["notes"] is None
    assert body["tag"] is None


def test_an_explicit_null_on_a_required_field_is_refused(app: FastAPI, client: TestClient) -> None:
    """Silently ignoring it would report success for a change that never happened."""
    _wire(app, _FakeTasks())
    task_id = _created(client)["id"]

    response = client.patch(f"{TASKS}/{task_id}", json={"title": None})

    assert response.status_code == 422


def test_patching_a_start_into_the_past_is_refused(app: FastAPI, client: TestClient) -> None:
    """The rule belongs to the task, not to the act of creating one."""
    _wire(app, _FakeTasks())
    task_id = _created(client)["id"]

    response = client.patch(f"{TASKS}/{task_id}", json={"start_at": _future(days=-1)})

    assert response.status_code == 422


def test_deleting_a_task_answers_204_and_it_stops_existing(
    app: FastAPI, client: TestClient
) -> None:
    _wire(app, _FakeTasks())
    task_id = _created(client)["id"]

    assert client.delete(f"{TASKS}/{task_id}").status_code == 204
    assert client.get(f"{TASKS}/{task_id}").status_code == 404


def test_deleting_the_same_task_twice_answers_404_the_second_time(
    app: FastAPI, client: TestClient
) -> None:
    _wire(app, _FakeTasks())
    task_id = _created(client)["id"]

    client.delete(f"{TASKS}/{task_id}")

    assert client.delete(f"{TASKS}/{task_id}").status_code == 404


def test_listing_is_ordered_by_when_the_task_starts(app: FastAPI, client: TestClient) -> None:
    _wire(app, _FakeTasks())
    for days in (3, 1, 2):
        _created(client, title=f"day {days}", start_at=_future(days=days))

    titles = [task["title"] for task in client.get(TASKS).json()["items"]]

    assert titles == ["day 1", "day 2", "day 3"]


def test_a_page_reports_the_window_it_answered_for(app: FastAPI, client: TestClient) -> None:
    """No ``total``: counting every row a user owns to render one page is work nobody
    asked for (ADR-0020)."""
    _wire(app, _FakeTasks())

    body = client.get(TASKS, params={"limit": 5, "offset": 10}).json()

    assert body["limit"] == 5
    assert body["offset"] == 10
    assert "total" not in body


def test_asking_for_more_than_the_maximum_page_is_refused(app: FastAPI, client: TestClient) -> None:
    """Refused rather than quietly clamped: a caller that thinks it got 5000 rows and got
    100 would page through the rest wrong."""
    _wire(app, _FakeTasks())

    assert client.get(TASKS, params={"limit": 5000}).status_code == 422
    assert client.get(TASKS, params={"offset": -1}).status_code == 422


def test_tags_are_listed_but_cannot_be_created_on_their_own(
    app: FastAPI, client: TestClient
) -> None:
    """A tag exists because a task named it (ADR-0020)."""
    _wire(app, _FakeTasks())
    _created(client, tag="deep work")

    assert [tag["name"] for tag in client.get(TAGS).json()] == ["deep work"]
    assert client.post(TAGS, json={"name": "invented"}).status_code == 405


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("post", TASKS),
        ("get", TASKS),
        ("get", f"{TASKS}/{uuid.uuid4()}"),
        ("patch", f"{TASKS}/{uuid.uuid4()}"),
        ("delete", f"{TASKS}/{uuid.uuid4()}"),
        ("get", TAGS),
    ],
)
def test_every_endpoint_needs_a_token(
    app: FastAPI, client: TestClient, settings: Settings, method: str, path: str
) -> None:
    """Asserted for each one rather than for a representative sample, because forgetting
    the dependency on a single route is exactly how this fails."""
    app.dependency_overrides[get_session] = lambda: _NoOpSession()

    assert client.request(method, path, json={}).status_code == 401


def test_a_window_narrows_the_listing_to_those_local_days(app: FastAPI, client: TestClient) -> None:
    """The week view asks for seven days and must not receive an eighth."""
    tasks = _FakeTasks()
    _wire(app, tasks)

    client.get(TASKS, params={"first_day": "2030-06-01", "last_day": "2030-06-07"})

    assert tasks.last_window == (
        datetime(2030, 6, 1, 3, tzinfo=timezone.utc),
        datetime(2030, 6, 8, 3, tzinfo=timezone.utc),
    )


def test_the_window_is_half_open_so_two_weeks_side_by_side_neither_overlap_nor_gap(
    app: FastAPI, client: TestClient
) -> None:
    tasks = _FakeTasks()
    _wire(app, tasks)

    client.get(TASKS, params={"first_day": "2030-06-01", "last_day": "2030-06-07"})
    first_end = tasks.last_window[1] if tasks.last_window else None
    client.get(TASKS, params={"first_day": "2030-06-08", "last_day": "2030-06-14"})
    second_start = tasks.last_window[0] if tasks.last_window else None

    assert first_end == second_start


def test_one_day_of_the_window_without_the_other_is_refused(
    app: FastAPI, client: TestClient
) -> None:
    """An open-ended range that looks like a filter is almost certainly a caller bug, and
    answering it as if it were deliberate hides that until the data gets big."""
    _wire(app, _FakeTasks())

    assert client.get(TASKS, params={"first_day": "2030-06-01"}).status_code == 422
    assert client.get(TASKS, params={"last_day": "2030-06-07"}).status_code == 422


def test_an_inverted_or_oversized_window_is_refused_the_same_way_capacity_refuses_it(
    app: FastAPI, client: TestClient
) -> None:
    _wire(app, _FakeTasks())

    inverted = client.get(TASKS, params={"first_day": "2030-06-02", "last_day": "2030-06-01"})
    oversized = client.get(TASKS, params={"first_day": "2030-01-01", "last_day": "2031-01-01"})

    assert inverted.status_code == 422
    assert inverted.json()["detail"] == "last_day cannot precede first_day."
    assert oversized.status_code == 422


def test_no_window_still_lists_everything(app: FastAPI, client: TestClient) -> None:
    tasks = _FakeTasks()
    _wire(app, tasks)

    client.get(TASKS)

    assert tasks.last_window is None
