"""What happens to a draft nobody acted on (ADR-0033, ADR-0037)."""

from uuid import UUID

from sqlalchemy import Date, cast, func, update
from sqlalchemy.orm import Session

from syncaai.models import PlanDraft, User


def expire_drafts(session: Session) -> list[UUID]:
    """Mark ``expired`` every pending draft whose horizon's last day has ended, and return
    their ids. The caller commits.

    "Ended" is in the owner's zone: a draft whose last day is Sunday is still alive on Sunday
    evening in São Paulo, when it is already Monday in UTC. Once expired, nothing is left to
    place it in, and the thirty days of ADR-0037 start counting.
    """
    local_today = cast(func.timezone(User.timezone, func.now()), Date)
    statement = (
        update(PlanDraft)
        .where(
            PlanDraft.user_id == User.id,
            PlanDraft.status == "pending",
            PlanDraft.last_day < local_today,
        )
        .values(status="expired", ended_at=func.now())
        .returning(PlanDraft.id)
        .execution_options(synchronize_session=False)
    )
    return list(session.scalars(statement).all())
