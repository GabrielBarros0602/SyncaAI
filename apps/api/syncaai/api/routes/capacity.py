"""The day-capacity endpoint.

The first read in this API that needs more than an owner to scope by. Free capacity is a
question about local days, and only the user's row knows which zone those days belong to —
so this takes ``CurrentUser`` where every other route takes ``CurrentUserId``.
"""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from syncaai.api.dependencies import CurrentUser, SessionDep
from syncaai.repositories.tasks import TaskRepository
from syncaai.schemas.tasks import DayCapacityRead
from syncaai.schemas.users import WallClockMinute
from syncaai.services.capacity import CapacityService
from syncaai.services.users import usable_window

router = APIRouter(tags=["capacity"])

_UNSAVED_END = (
    "An end of a usable day not saved, to measure the days against it instead of the "
    "account's own. Nothing is written. The other end is the stored one when it is left out."
)


def get_capacity_service(
    session: SessionDep,
    user: CurrentUser,
    day_starts_at: Annotated[WallClockMinute | None, Query(description=_UNSAVED_END)] = None,
    day_ends_at: Annotated[WallClockMinute | None, Query(description=_UNSAVED_END)] = None,
) -> CapacityService:
    # The zone and the window come from the same row: the window's hours mean nothing
    # until a zone says which instants they are (ADR-0029). A window not saved is judged
    # exactly as PATCH /me would judge it, so the week a screen shows before Save is the week
    # Save would leave, or the same refusal (ADR-0060).
    window = usable_window(user, day_starts_at, day_ends_at)
    return CapacityService(TaskRepository(session, user.id), user.timezone, window)


ServiceDep = Annotated[CapacityService, Depends(get_capacity_service)]


@router.get("/capacity", summary="Free and booked minutes per day")
def read_capacity(
    service: ServiceDep,
    first_day: Annotated[date, Query(description="First local day, inclusive.")],
    last_day: Annotated[date, Query(description="Last local day, inclusive.")],
) -> list[DayCapacityRead]:
    """Every day in the window, including the ones with nothing on them.

    Local dates rather than instants: "what does my Tuesday look like" is a question about a
    calendar, and the conversion to a UTC range happens once, at this edge (ADR-0009).

    With ``day_starts_at`` or ``day_ends_at``, the same days measured against a usable day
    the person has typed and not saved: the settings screen shows what a change does to each
    day before it is made, and the level of each day stays the server's (ADR-0060).
    """
    return [DayCapacityRead.model_validate(day) for day in service.by_day(first_day, last_day)]
