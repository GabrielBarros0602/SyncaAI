"""What a month has spent, against the ceilings of ADR-0006 and ADR-0044.

Sums over ``ai_usage``, which records every call as it ends (ADR-0041). A month is the
calendar month in UTC, read on the database's clock, the one ``created_at`` is written with.
"""

import uuid
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import ColumnElement, Select, func, select
from sqlalchemy.orm import Session

from syncaai.config import Settings
from syncaai.errors import AllowanceSpentError, PlanningPausedError
from syncaai.models import AiUsage


@dataclass(frozen=True)
class Ceilings:
    """US dollars a UTC month may spend."""

    per_person: Decimal
    everyone: Decimal


DEFAULT_CEILINGS = Ceilings(per_person=Decimal("0.50"), everyone=Decimal("5.00"))


def ceilings_from(settings: Settings) -> Ceilings:
    return Ceilings(
        per_person=settings.ai_ceiling_per_person_usd,
        everyone=settings.ai_ceiling_everyone_usd,
    )


def _utc_month(months_ahead: int = 0) -> ColumnElement[object]:
    """The instant a UTC month begins. The arithmetic is done on UTC wall time, so the
    session's own zone cannot move a month's edge."""
    utc_now = func.timezone("UTC", func.now())
    start = func.date_trunc("month", utc_now) + func.make_interval(0, months_ahead)
    return func.timezone("UTC", start)


def spend_statement(user_id: uuid.UUID | None = None) -> Select[tuple[Decimal | None]]:
    """This month's spend: one person's, or everyone's, deleted accounts included."""
    statement = select(func.coalesce(func.sum(AiUsage.cost_usd), 0)).where(
        AiUsage.created_at >= _utc_month()
    )
    if user_id is not None:
        statement = statement.where(AiUsage.user_id == user_id)
    return statement


def refuse_past_the_ceilings(
    session: Session, user_id: uuid.UUID, ceilings: Ceilings, *, adding: Decimal = Decimal(0)
) -> None:
    """Refuse unless, with ``adding``, the month stays under both ceilings.

    Everyone's first: once the kill switch has tripped, it is the answer that is true for
    every person, whatever their own month holds.
    """
    if _spent(session) + adding >= ceilings.everyone:
        raise PlanningPausedError(_seconds_until_next_month(session))
    if _spent(session, user_id) + adding >= ceilings.per_person:
        raise AllowanceSpentError(_seconds_until_next_month(session))


def _spent(session: Session, user_id: uuid.UUID | None = None) -> Decimal:
    return Decimal(session.scalar(spend_statement(user_id)) or 0)


def _seconds_until_next_month(session: Session) -> int:
    seconds = session.scalar(select(func.extract("epoch", _utc_month(1) - func.now())))
    return max(1, int(seconds or 0))
