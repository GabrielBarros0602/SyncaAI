"""The privacy test ADR-0004 calls the guarantee, against a real calendar in PostgreSQL.

A person's week holds a therapy session with its notes, its tag and a checklist item, a job
interview they are keeping from their manager, a cancelled appointment and, in another
account, somebody else's whole Friday. The prompt built from it has to describe the room
each day has, and say nothing of any of that.

Two things are asserted, because either alone proves less than it seems. The strings are
absent from the prompt, and the bookings still shaped it, so the absence is not just an
empty calendar. And no statement the assembly sends selects a title, a note, a tag or a
checklist item, so the absence does not depend on the assembler's discipline alone.
"""

import json
import uuid
from collections.abc import Iterator
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session

from syncaai.db import get_session_factory
from syncaai.models import ChecklistItem, Tag, Task, User
from syncaai.planning.context import PlanPrompt
from syncaai.repositories.tasks import TaskRepository
from syncaai.services.plan_context import plan_prompt_for

pytestmark = pytest.mark.integration

SAO_PAULO = "America/Sao_Paulo"
WEDNESDAY = date(2031, 6, 4)
THURSDAY = WEDNESDAY + timedelta(days=1)
FRIDAY = WEDNESDAY + timedelta(days=2)
SATURDAY = WEDNESDAY + timedelta(days=3)
# Read in UTC, as the API reads the clock. 21:00 in São Paulo is already Friday there, so a
# local date taken from it without the zone would start the horizon a day late.
NOW = datetime(2031, 6, 5, 21, 0, tzinfo=ZoneInfo(SAO_PAULO)).astimezone(timezone.utc)

SENSITIVE = [
    "Terapia — Dra. Helena Prado",
    "Falar sobre o diagnóstico de ansiedade",
    "Saúde mental",
    "Levar a receita do clonazepam",
    "Entrevista na Concorrente S.A.",
    "Não contar ao gestor",
    "Consulta cancelada com o advogado",
    "A sexta inteira de outra pessoa",
]
# Single words too, so a prompt that carried a fragment of a title would still fail.
SENSITIVE_WORDS = ["Helena", "diagnóstico", "ansiedade", "clonazepam", "Concorrente", "advogado"]


@pytest.fixture
def session() -> Iterator[Session]:
    with get_session_factory()() as session:
        yield session
        session.rollback()


def _local(day: date, hour: int, minute: int = 0) -> datetime:
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=ZoneInfo(SAO_PAULO))


def _user(session: Session, **preferences: object) -> User:
    user = User(
        email=f"privacy-{uuid.uuid4()}@example.com",
        password_hash="not-a-real-hash",
        timezone=SAO_PAULO,
        **preferences,
    )
    session.add(user)
    session.flush()
    return user


def _task(
    session: Session, user: User, start: datetime, minutes: int, title: str, **fields: object
) -> Task:
    task = Task(user_id=user.id, title=title, start_at=start, duration_minutes=minutes, **fields)
    session.add(task)
    session.flush()
    return task


def _a_private_week(session: Session) -> User:
    person = _user(session, days_off=[7])
    tag = Tag(user_id=person.id, name="Saúde mental")
    session.add(tag)
    session.flush()
    therapy = _task(
        session,
        person,
        _local(FRIDAY, 14),
        60,
        "Terapia — Dra. Helena Prado",
        notes="Falar sobre o diagnóstico de ansiedade",
        tag_id=tag.id,
    )
    session.add(
        ChecklistItem(task_id=therapy.id, label="Levar a receita do clonazepam", position=0)
    )
    _task(
        session,
        person,
        _local(SATURDAY, 9),
        120,
        "Entrevista na Concorrente S.A.",
        notes="Não contar ao gestor",
    )
    cancelled = _task(session, person, _local(FRIDAY, 10), 60, "Consulta cancelada com o advogado")
    # Completed before it began: the trigger collapses its range onto its start.
    cancelled.completed_at = _local(FRIDAY, 10) - timedelta(days=1)
    session.flush()

    somebody_else = _user(session)
    _task(session, somebody_else, _local(FRIDAY, 6), 960, "A sexta inteira de outra pessoa")
    return person


def _prompt(session: Session, person: User) -> PlanPrompt:
    return plan_prompt_for(
        session, person, "Plano de estudos para a prova de sábado", horizon_days=4, now=NOW
    )


def _days(prompt: PlanPrompt) -> list[tuple[str, bool, int, int]]:
    days = json.loads(prompt.message)["context"]["days"]
    return [
        (day["weekday"], day["day_off"], day["plannable_minutes"], day["longest_free_minutes"])
        for day in days
    ]


def test_nothing_private_in_the_calendar_reaches_the_prompt(session: Session) -> None:
    prompt = _prompt(session, _a_private_week(session))

    sent = (prompt.instructions + prompt.message).casefold()
    for secret in SENSITIVE + SENSITIVE_WORDS:
        assert secret.casefold() not in sent, secret


def test_the_bookings_still_shape_the_room_each_day_has(session: Session) -> None:
    """Without this, an empty calendar would pass the test above.

    Friday loses the hour of therapy and keeps the morning whole across the cancelled
    appointment; Saturday loses the interview; the other account's Friday takes nothing.
    """
    prompt = _prompt(session, _a_private_week(session))

    assert _days(prompt) == [
        ("Thursday", False, 55, 55),
        ("Friday", False, 900, 480),
        ("Saturday", False, 840, 660),
        ("Sunday", True, 0, 0),
    ]


def test_no_statement_the_assembly_sends_selects_private_columns(session: Session) -> None:
    """The privacy boundary is the query, not only the assembler: what is never selected
    cannot reach a prompt, a log line or a stack trace."""
    person = _a_private_week(session)
    statements: list[str] = []

    def record(_conn: object, _cursor: object, statement: str, *_args: object) -> None:
        statements.append(statement.casefold())

    engine = session.get_bind()
    event.listen(engine, "before_cursor_execute", record)
    try:
        _prompt(session, person)
    finally:
        event.remove(engine, "before_cursor_execute", record)

    assert statements, "the assembly sent no statement, so this test proved nothing"
    for statement in statements:
        for private in ("title", "notes", "label", "tags", "checklist_items"):
            assert private not in statement, (private, statement)


def test_the_person_s_own_window_days_off_and_block_shape_the_prompt(session: Session) -> None:
    """At 21:00 a window that closes at 20:00 has nothing left today, and a 45-minute block
    bounds every step."""
    person = _user(
        session,
        day_starts_at=time(8),
        day_ends_at=time(20),
        days_off=[6, 7],
        preferred_block_minutes=45,
    )

    prompt = _prompt(session, person)

    assert _days(prompt) == [
        ("Thursday", False, 0, 0),
        ("Friday", False, 720, 720),
        ("Saturday", True, 0, 0),
        ("Sunday", True, 0, 0),
    ]
    assert json.loads(prompt.message)["context"]["step_minutes"] == {"min": 15, "max": 45}


# --- The ranges the gaps are built from ----------------------------------------------------


def _ranges(
    session: Session, user: User, first: date, last: date
) -> list[tuple[datetime, datetime]]:
    starts = _local(first, 0)
    ends = _local(last + timedelta(days=1), 0)
    return TaskRepository(session, user.id).occupied_ranges(starts=starts, ends=ends)


def test_a_booking_from_the_evening_before_is_still_returned(session: Session) -> None:
    """It began before the horizon and runs into its first morning."""
    person = _user(session)
    _task(session, person, _local(WEDNESDAY, 23), 240, "overnight")

    assert _ranges(session, person, THURSDAY, THURSDAY) == [
        (_local(WEDNESDAY, 23), _local(THURSDAY, 3))
    ]


def test_bookings_that_only_touch_the_horizon_are_not_returned(session: Session) -> None:
    """Half-open at both ends: one ending at its first instant, one starting at its last."""
    person = _user(session)
    _task(session, person, _local(WEDNESDAY, 23), 60, "ends at midnight")
    _task(session, person, _local(FRIDAY, 0), 60, "starts after")

    assert _ranges(session, person, THURSDAY, THURSDAY) == []


def test_only_the_owner_s_bookings_are_returned(session: Session) -> None:
    person, somebody_else = _user(session), _user(session)
    _task(session, somebody_else, _local(THURSDAY, 9), 60, "not theirs")

    assert _ranges(session, person, THURSDAY, THURSDAY) == []
