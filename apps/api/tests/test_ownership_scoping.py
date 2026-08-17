"""Tests for the owner-scoped repository base.

Two layers. The structural ones assert on compiled SQL and need no database: they exist
because the property being claimed — that no read escapes the owner filter — is a property
of the statement, not of any particular row. The integration ones prove PostgreSQL agrees.

They reach for ``_scoped``, a protected member, on purpose. The claim under test is
structural, and asserting it through a public method would only observe it indirectly on
whatever data the test happened to create.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from syncaai.db import get_session_factory
from syncaai.models import ChecklistItem, Task, User
from syncaai.repositories.tasks import ChecklistItemRepository, TaskRepository

AN_OWNER = uuid.UUID("11111111-1111-1111-1111-111111111111")
A_FIXED_FUTURE = datetime(2030, 6, 1, 9, 0, tzinfo=timezone.utc)


def _sql(statement: object) -> str:
    return " ".join(str(statement).split())


def test_reading_tasks_always_filters_by_the_owner_column() -> None:
    statement = TaskRepository(None, AN_OWNER)._scoped()  # type: ignore[arg-type]

    assert "WHERE tasks.user_id =" in _sql(statement)


def test_reading_checklist_items_reaches_the_owner_through_a_join() -> None:
    """The item has no user_id by design, so the filter lands on the parent task."""
    statement = ChecklistItemRepository(None, AN_OWNER)._scoped()  # type: ignore[arg-type]
    sql = _sql(statement)

    assert "JOIN tasks ON tasks.id = checklist_items.task_id" in sql
    assert "WHERE tasks.user_id =" in sql


def test_fetching_one_entity_keeps_the_owner_filter() -> None:
    """The id narrows the query; it does not replace the scoping."""
    repository = TaskRepository(None, AN_OWNER)  # type: ignore[arg-type]

    sql = _sql(repository._scoped().where(Task.id == uuid.uuid4()))

    assert "tasks.user_id =" in sql
    assert "tasks.id =" in sql


def _a_user(session: object) -> User:
    user = User(
        email=f"probe-{uuid.uuid4()}@example.com",
        password_hash="not-a-real-hash",
        timezone="America/Sao_Paulo",
    )
    session.add(user)  # type: ignore[attr-defined]
    session.flush()  # type: ignore[attr-defined]
    return user


def _a_task(session: object, user: User, *, minutes_from_start: int = 0) -> Task:
    task = Task(
        user_id=user.id,
        title="probe",
        start_at=A_FIXED_FUTURE + timedelta(minutes=minutes_from_start),
        duration_minutes=30,
    )
    task.items = [ChecklistItem(label="a step", position=0)]
    session.add(task)  # type: ignore[attr-defined]
    session.flush()  # type: ignore[attr-defined]
    return task


@pytest.mark.integration
def test_an_owner_reads_their_own_task() -> None:
    with get_session_factory()() as session:
        owner = _a_user(session)
        task = _a_task(session, owner)

        assert TaskRepository(session, owner.id).get(task.id) is task

        session.rollback()


@pytest.mark.integration
def test_another_owner_cannot_read_it_and_is_told_nothing() -> None:
    """The repository answers None, which is what lets the API answer 404 rather than 403."""
    with get_session_factory()() as session:
        owner, stranger = _a_user(session), _a_user(session)
        task = _a_task(session, owner)

        assert TaskRepository(session, stranger.id).get(task.id) is None

        session.rollback()


@pytest.mark.integration
def test_listing_returns_only_the_owner_rows() -> None:
    with get_session_factory()() as session:
        owner, stranger = _a_user(session), _a_user(session)
        mine = _a_task(session, owner)
        _a_task(session, stranger, minutes_from_start=120)

        listed = TaskRepository(session, owner.id).list()

        assert [task.id for task in listed] == [mine.id]

        session.rollback()


@pytest.mark.integration
def test_a_checklist_item_is_scoped_through_its_task() -> None:
    with get_session_factory()() as session:
        owner, stranger = _a_user(session), _a_user(session)
        item_id = _a_task(session, owner).items[0].id

        assert ChecklistItemRepository(session, owner.id).get(item_id) is not None
        assert ChecklistItemRepository(session, stranger.id).get(item_id) is None

        session.rollback()


@pytest.mark.integration
def test_deleting_someone_elses_entity_does_nothing() -> None:
    """Returns False and leaves the row alone, rather than reporting a success it did not have."""
    with get_session_factory()() as session:
        owner, stranger = _a_user(session), _a_user(session)
        task = _a_task(session, owner)

        assert TaskRepository(session, stranger.id).delete(task.id) is False

        remaining = session.scalar(select(func.count()).select_from(Task).where(Task.id == task.id))
        assert remaining == 1

        session.rollback()


@pytest.mark.integration
def test_deleting_your_own_entity_removes_it_and_its_items() -> None:
    with get_session_factory()() as session:
        owner = _a_user(session)
        task = _a_task(session, owner)
        task_id = task.id

        assert TaskRepository(session, owner.id).delete(task_id) is True
        session.flush()

        assert session.scalar(select(func.count()).select_from(Task).where(Task.id == task_id)) == 0
        assert (
            session.scalar(
                select(func.count())
                .select_from(ChecklistItem)
                .where(ChecklistItem.task_id == task_id)
            )
            == 0
        )

        session.rollback()
