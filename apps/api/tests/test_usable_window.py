"""The usable window against a real PostgreSQL (ADR-0029).

Three claims no fake can make. A row written without the window gets the sixteen hours
every account had before, from the column's own default, so the migration changed nobody's
numbers. The CHECK refuses a window ADR-0023 forbids even when the service is bypassed —
the guard that survives a bug in the other two. And the capacity a person reads is measured
against their own window, not the default.

Nothing is committed; each test rolls back.
"""

import uuid
from datetime import date, time

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from syncaai.api.routes.capacity import get_capacity_service
from syncaai.db import get_session_factory
from syncaai.models import User

pytestmark = pytest.mark.integration

A_MONDAY = date(2031, 6, 2)


def test_an_account_written_without_a_window_gets_the_old_sixteen_hours() -> None:
    """Through SQL rather than the ORM, so the default asserted is the column's, the one the
    migration gave every existing row, and not the model's."""
    with get_session_factory()() as session:
        row = session.execute(
            text(
                "INSERT INTO users (id, email, password_hash) VALUES (:id, :email, 'x') "
                "RETURNING day_starts_at, day_ends_at"
            ),
            {"id": uuid.uuid4(), "email": f"window-{uuid.uuid4()}@example.com"},
        ).one()

        assert (row.day_starts_at, row.day_ends_at) == (time(6), time(22))

        session.rollback()


@pytest.mark.parametrize(
    ("starts", "ends", "accepted"),
    [
        ("09:00", "10:00", True),
        ("09:00", "09:59", False),
        ("05:00", "23:00", True),
        ("05:00", "23:01", False),
        ("10:00", "09:00", False),
        ("10:00", "10:00", False),
    ],
)
def test_the_column_refuses_a_window_adr_0023_forbids(
    starts: str, ends: str, accepted: bool
) -> None:
    """Both sides of the floor, both sides of the ceiling, a reversed window and an empty
    one, written straight to the table."""
    with get_session_factory()() as session:
        user = User(email=f"window-{uuid.uuid4()}@example.com", password_hash="x")
        session.add(user)
        session.flush()
        update = text("UPDATE users SET day_starts_at = :s, day_ends_at = :e WHERE id = :id")

        if accepted:
            session.execute(update, {"s": starts, "e": ends, "id": user.id})
        else:
            with pytest.raises(IntegrityError, match="ck_users_usable_window"):
                session.execute(update, {"s": starts, "e": ends, "id": user.id})

        session.rollback()


def test_capacity_is_measured_against_the_account_s_own_window() -> None:
    """The route builds the service from the row: zone and window together. A wiring that
    forgot the window would hand everyone the default and every other test would pass."""
    with get_session_factory()() as session:
        user = User(
            email=f"window-{uuid.uuid4()}@example.com",
            password_hash="x",
            timezone="America/Sao_Paulo",
            day_starts_at=time(8),
            day_ends_at=time(12),
        )
        session.add(user)
        session.flush()

        day = get_capacity_service(session, user).by_day(A_MONDAY, A_MONDAY)[0]

        assert day.usable_minutes == 4 * 60

        session.rollback()
