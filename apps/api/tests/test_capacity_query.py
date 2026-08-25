"""The capacity query against a real PostgreSQL.

Two claims live here that no amount of faking can establish.

**It groups by the right day.** ``AT TIME ZONE`` is PostgreSQL's conversion, using
PostgreSQL's copy of the time zone database. A task at 22:00 in São Paulo is 01:00 the next
day in UTC, and the grouping has to say the former.

**It uses the index.** The plan is asserted, not inspected by hand, because "we checked
EXPLAIN once" decays the moment someone edits the WHERE clause. Enough rows are inserted
for the planner to have a real choice; on a table of five rows it would pick a sequential
scan no matter how good the index is, and the assertion would prove nothing.
"""

import uuid
from collections.abc import Iterator
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import delete, insert, text
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session

from syncaai.db import get_session_factory
from syncaai.models import Task, User
from syncaai.repositories.tasks import TaskRepository
from syncaai.services.capacity import CapacityService
from syncaai.time_windows import utc_window

pytestmark = pytest.mark.integration

SAO_PAULO = "America/Sao_Paulo"
A_MONDAY = date(2031, 6, 2)

# Enough that the planner prefers a narrow index scan over reading the table. One owner's
# seven days is well under one percent of this, which is the ratio that makes the choice
# obvious rather than marginal.
OTHER_OWNERS = 19
TASKS_EACH = 250


def _a_user(session: Session, email_prefix: str = "capacity") -> User:
    user = User(
        email=f"{email_prefix}-{uuid.uuid4()}@example.com",
        password_hash="not-a-real-hash",
        timezone=SAO_PAULO,
    )
    session.add(user)
    session.flush()
    return user


def _local(day: date, hour: int, minute: int = 0) -> datetime:
    """An instant expressed the way a user would say it, in their own zone."""
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=ZoneInfo(SAO_PAULO))


def _bulk(session: Session, user_id: uuid.UUID, *, first: datetime, count: int) -> None:
    """Non-overlapping half-hour blocks. They have to be non-overlapping — the exclusion
    constraint is not advisory."""
    session.execute(
        insert(Task),
        [
            {
                "id": uuid.uuid4(),
                "user_id": user_id,
                "title": f"row {index}",
                "start_at": first + timedelta(minutes=30 * index),
                "duration_minutes": 25,
            }
            for index in range(count)
        ],
    )


@pytest.fixture
def owner() -> Iterator[Session]:
    """A session holding one owner, rolled back afterwards so nothing survives."""
    with get_session_factory()() as session:
        yield session
        session.rollback()


def _windows(first: date, last: date) -> list[tuple[date, datetime, datetime]]:
    days = [first + timedelta(days=n) for n in range((last - first).days + 1)]
    return [(day, *utc_window(day, day, SAO_PAULO)) for day in days]


def _minutes(session: Session, user_id: uuid.UUID, first: date, last: date) -> dict[date, int]:
    rows = TaskRepository(session, user_id).occupied_minutes_by_day(windows=_windows(first, last))
    return {row.day: round(float(row.occupied_minutes)) for row in rows}


def test_a_task_is_counted_on_the_local_day_not_the_utc_one(owner: Session) -> None:
    """22:00 in São Paulo is 01:00 the next day in UTC. Counting on the stored instant would
    move a Monday evening onto Tuesday, and the whole calendar with it."""
    user = _a_user(owner)
    owner.add(
        Task(user_id=user.id, title="late", start_at=_local(A_MONDAY, 22), duration_minutes=60)
    )
    owner.flush()

    assert _minutes(owner, user.id, A_MONDAY, A_MONDAY) == {A_MONDAY: 60}


def test_a_task_crossing_midnight_is_split_between_the_two_days(owner: Session) -> None:
    """ADR-0022 in the database rather than in prose. 23:00 plus two hours gives one hour to
    Monday and one to Tuesday — the behaviour rule 3 of ADR-0012 got wrong, and the reason
    that rule was superseded."""
    user = _a_user(owner)
    owner.add(
        Task(user_id=user.id, title="across", start_at=_local(A_MONDAY, 23), duration_minutes=120)
    )
    owner.flush()
    tuesday = A_MONDAY + timedelta(days=1)

    assert _minutes(owner, user.id, A_MONDAY, tuesday) == {A_MONDAY: 60, tuesday: 60}


def test_completing_early_gives_the_remaining_minutes_back(owner: Session) -> None:
    """Booked 12:00 to 15:00, finished at 13:30. The day gets ninety minutes back, and the
    query never asks whether the task was completed — end_at already knows."""
    user = _a_user(owner)
    task = Task(user_id=user.id, title="long", start_at=_local(A_MONDAY, 12), duration_minutes=180)
    owner.add(task)
    owner.flush()
    assert _minutes(owner, user.id, A_MONDAY, A_MONDAY) == {A_MONDAY: 180}

    task.completed_at = _local(A_MONDAY, 13, 30)
    owner.flush()

    assert _minutes(owner, user.id, A_MONDAY, A_MONDAY) == {A_MONDAY: 90}


def test_the_freed_time_becomes_bookable(owner: Session) -> None:
    """The exclusion constraint follows end_at, so nothing has to be told the time is free."""
    user = _a_user(owner)
    task = Task(user_id=user.id, title="long", start_at=_local(A_MONDAY, 12), duration_minutes=180)
    owner.add(task)
    owner.flush()
    task.completed_at = _local(A_MONDAY, 13, 30)
    owner.flush()

    owner.add(
        Task(
            user_id=user.id,
            title="the freed slot",
            start_at=_local(A_MONDAY, 14),
            duration_minutes=60,
        )
    )

    owner.flush()  # raises if the range had not shrunk


def test_completing_late_does_not_extend_the_booking(owner: Session) -> None:
    """LEAST, not the elapsed time. A grown range could collide with a neighbour, and a
    completion that fails is worse than one that is merely imprecise."""
    user = _a_user(owner)
    task = Task(
        user_id=user.id, title="ran over", start_at=_local(A_MONDAY, 9), duration_minutes=60
    )
    owner.add(task)
    owner.flush()

    task.completed_at = _local(A_MONDAY, 12)
    owner.flush()

    assert _minutes(owner, user.id, A_MONDAY, A_MONDAY) == {A_MONDAY: 60}


def test_only_the_owners_own_minutes_are_counted(owner: Session) -> None:
    user, stranger = _a_user(owner), _a_user(owner)
    for owner_id in (user.id, stranger.id):
        owner.add(
            Task(user_id=owner_id, title="mine", start_at=_local(A_MONDAY, 9), duration_minutes=60)
        )
    owner.flush()

    assert _minutes(owner, user.id, A_MONDAY, A_MONDAY) == {A_MONDAY: 60}


def test_a_day_with_nothing_on_it_comes_back_as_zero(owner: Session) -> None:
    """The outer join answers every window, so a day inside the range is reported rather
    than absent — the service has nothing left to invent."""
    user = _a_user(owner)

    assert _minutes(owner, user.id, A_MONDAY, A_MONDAY) == {A_MONDAY: 0}


def test_the_service_reports_the_same_totals_over_a_real_query(owner: Session) -> None:
    """End to end without the endpoint, and free is measured against the usable day."""
    user = _a_user(owner)
    for hour in (9, 14):
        owner.add(
            Task(
                user_id=user.id,
                title=f"{hour}h",
                start_at=_local(A_MONDAY, hour),
                duration_minutes=60,
            )
        )
    owner.add(
        Task(
            user_id=user.id,
            title="wednesday",
            start_at=_local(A_MONDAY + timedelta(days=2), 10),
            duration_minutes=30,
        )
    )
    owner.flush()

    days = CapacityService(TaskRepository(owner, user.id), SAO_PAULO).by_day(
        A_MONDAY, A_MONDAY + timedelta(days=2)
    )

    assert [(day.occupied_minutes, day.free_minutes, day.task_count) for day in days] == [
        (120, 840, 2),
        (0, 960, 0),
        (30, 930, 1),
    ]


@pytest.fixture
def a_populated_table() -> Iterator[uuid.UUID]:
    """Twenty owners with two hundred and fifty tasks each, committed and analysed.

    Committed rather than rolled back because ``ANALYZE`` reads what is actually stored, and
    the planner's choice is the thing being asserted. Everything is removed afterwards.
    """
    with get_session_factory()() as session:
        target = _a_user(session, "plan-target")
        first = _local(A_MONDAY, 0)
        _bulk(session, target.id, first=first, count=TASKS_EACH)
        others = [_a_user(session, "plan-noise") for _ in range(OTHER_OWNERS)]
        for other in others:
            _bulk(session, other.id, first=first, count=TASKS_EACH)
        session.commit()
        session.execute(text("ANALYZE tasks"))
        session.commit()
        emails = [target.email, *(other.email for other in others)]
        target_id = target.id

    try:
        yield target_id
    finally:
        with get_session_factory()() as session:
            session.execute(delete(User).where(User.email.in_(emails)))
            session.commit()


def test_the_capacity_query_reaches_the_rows_through_the_index(
    a_populated_table: uuid.UUID,
) -> None:
    """``ix_tasks_user_start_at`` covers ``(user_id, start_at)``, which is exactly the
    predicate. If a future change moves the time zone conversion into the WHERE clause, the
    index stops being usable and this test is what says so."""
    with get_session_factory()() as session:
        plan = _explain(
            session, a_populated_table, _windows(A_MONDAY, A_MONDAY + timedelta(days=6))
        )

    assert "ix_tasks_user_start_at" in plan, plan
    assert "Seq Scan on tasks" not in plan, plan


def _explain(
    session: Session, owner_id: uuid.UUID, windows: list[tuple[date, datetime, datetime]]
) -> str:
    """EXPLAIN ANALYZE over the statement the repository actually builds."""
    statement = TaskRepository(session, owner_id).capacity_statement(windows=windows)
    # literal_binds because EXPLAIN is issued as raw text; the values are a uuid and two
    # timestamps that the application produced, never anything a caller typed.
    compiled = statement.compile(
        dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
    )
    rows = session.execute(text(f"EXPLAIN ANALYZE {compiled}")).all()
    return "\n".join(str(row[0]) for row in rows)
