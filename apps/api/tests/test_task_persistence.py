"""Integration tests for the invariants PostgreSQL enforces on tasks.

These need a migrated database, so they are marked ``integration`` and run in CI. They
cover the two guarantees that do not exist anywhere in Python: the trigger that derives
``end_at``, and the exclusion constraint that forbids a user's tasks from overlapping.

Nothing is committed — each test rolls back — so they leave no residue.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.exc import IntegrityError

from syncaai.db import get_session_factory
from syncaai.models import Task, User

A_FIXED_FUTURE = datetime(2030, 1, 1, 10, 0, tzinfo=UTC)


def _a_user() -> User:
    return User(email=f"probe-{uuid.uuid4()}@example.test", password_hash="not-a-real-hash")


@pytest.mark.integration
def test_the_database_derives_end_at_from_start_and_duration() -> None:
    with get_session_factory()() as session:
        user = _a_user()
        session.add(user)
        session.flush()

        task = Task(user_id=user.id, title="probe", start_at=A_FIXED_FUTURE, duration_minutes=90)
        session.add(task)
        session.flush()
        session.refresh(task)

        assert task.end_at == A_FIXED_FUTURE + timedelta(minutes=90)

        session.rollback()


@pytest.mark.integration
def test_end_at_follows_a_change_to_duration() -> None:
    with get_session_factory()() as session:
        user = _a_user()
        session.add(user)
        session.flush()

        task = Task(user_id=user.id, title="probe", start_at=A_FIXED_FUTURE, duration_minutes=30)
        session.add(task)
        session.flush()

        task.duration_minutes = 120
        session.flush()
        session.refresh(task)

        assert task.end_at == A_FIXED_FUTURE + timedelta(minutes=120)

        session.rollback()


@pytest.mark.integration
def test_a_user_cannot_have_two_overlapping_tasks() -> None:
    with get_session_factory()() as session:
        user = _a_user()
        session.add(user)
        session.flush()

        session.add(
            Task(user_id=user.id, title="first", start_at=A_FIXED_FUTURE, duration_minutes=60)
        )
        session.flush()

        session.add(
            Task(
                user_id=user.id,
                title="overlapping",
                start_at=A_FIXED_FUTURE + timedelta(minutes=30),
                duration_minutes=60,
            )
        )

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()


@pytest.mark.integration
def test_two_users_may_occupy_the_same_slot() -> None:
    """The constraint is per user, not global."""
    with get_session_factory()() as session:
        first, second = _a_user(), _a_user()
        session.add_all([first, second])
        session.flush()

        session.add_all(
            [
                Task(user_id=first.id, title="a", start_at=A_FIXED_FUTURE, duration_minutes=60),
                Task(user_id=second.id, title="b", start_at=A_FIXED_FUTURE, duration_minutes=60),
            ]
        )
        session.flush()

        session.rollback()
