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
from syncaai.services.capacity import CapacityService

router = APIRouter(tags=["capacity"])


def get_capacity_service(session: SessionDep, user: CurrentUser) -> CapacityService:
    return CapacityService(TaskRepository(session, user.id), user.timezone)


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
    """
    return [DayCapacityRead.model_validate(day) for day in service.by_day(first_day, last_day)]
