"""The planner's preferences against a real PostgreSQL (ADR-0032).

Two claims only the database can make. A row written without them gets no days off and a
sixty-minute block, from the columns' own defaults, so the migration changed nothing for any
existing account. And the CHECKs refuse what the service refuses, even when the service is
bypassed — the guard that survives a bug in it.

Nothing is committed; each test rolls back.
"""

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from syncaai.db import get_session_factory
from syncaai.models import User

pytestmark = pytest.mark.integration


def test_an_account_written_without_preferences_plans_every_day_in_hour_blocks() -> None:
    """Through SQL, so the defaults asserted are the columns' and not the model's."""
    with get_session_factory()() as session:
        row = session.execute(
            text(
                "INSERT INTO users (id, email, password_hash) VALUES (:id, :email, 'x') "
                "RETURNING days_off, preferred_block_minutes"
            ),
            {"id": uuid.uuid4(), "email": f"prefs-{uuid.uuid4()}@example.com"},
        ).one()

        assert (row.days_off, row.preferred_block_minutes) == ([], 60)

        session.rollback()


@pytest.mark.parametrize(
    ("days_off", "accepted"),
    [
        ("{6,7}", True),
        ("{1,2,3,4,5,6}", True),
        ("{1,2,3,4,5,6,7}", False),
        ("{0}", False),
        ("{8}", False),
    ],
)
def test_the_column_refuses_days_off_that_are_not_a_week_with_a_day_left(
    days_off: str, accepted: bool
) -> None:
    _assert_update("days_off = CAST(:value AS smallint[])", days_off, accepted, "ck_users_days_off")


@pytest.mark.parametrize(
    ("minutes", "accepted"), [(15, True), (240, True), (14, False), (241, False)]
)
def test_the_column_refuses_a_block_outside_fifteen_minutes_to_four_hours(
    minutes: int, accepted: bool
) -> None:
    _assert_update(
        "preferred_block_minutes = :value", minutes, accepted, "ck_users_preferred_block"
    )


def _assert_update(assignment: str, value: object, accepted: bool, constraint: str) -> None:
    with get_session_factory()() as session:
        user = User(email=f"prefs-{uuid.uuid4()}@example.com", password_hash="x")
        session.add(user)
        session.flush()
        # The assignment is one of two literals written in this file, never input.
        update = text(f"UPDATE users SET {assignment} WHERE id = :id")

        if accepted:
            session.execute(update, {"value": value, "id": user.id})
        else:
            with pytest.raises(IntegrityError, match=constraint):
                session.execute(update, {"value": value, "id": user.id})

        session.rollback()
