"""The plan prompt for one person, read from their calendar (ADR-0004, ADR-0034).

Two queries reach the calendar, and neither selects a title, a note, a checklist item or a
tag: the capacity query returns minutes per day, and the occupied ranges are a start and an
end. What the assembler cannot be handed it cannot send.
"""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from syncaai.models import User
from syncaai.planning.context import PlanPrompt, build_plan_context
from syncaai.planning.slots import build_slots
from syncaai.repositories.tasks import TaskRepository
from syncaai.services.capacity import CapacityService, UsableWindow
from syncaai.time_windows import utc_window


def plan_prompt_for(
    session: Session, user: User, request: str, *, horizon_days: int, now: datetime
) -> PlanPrompt:
    """The prompt for ``request`` over ``horizon_days`` local days, starting today.

    ``now`` is read once by the caller and passed down, so the slots, the room each day is
    said to have and the date the prompt calls today all describe the same instant.
    """
    zone_name = user.timezone
    today = now.astimezone(ZoneInfo(zone_name)).date()
    last_day = today + timedelta(days=horizon_days - 1)
    window = UsableWindow(user.day_starts_at, user.day_ends_at)
    days_off = frozenset(user.days_off)

    tasks = TaskRepository(session, user.id)
    capacities = CapacityService(tasks, zone_name, window).by_day(today, last_day)
    starts, ends = utc_window(today, last_day, zone_name)
    slots = build_slots(
        capacities,
        tasks.occupied_ranges(starts=starts, ends=ends),
        window=window,
        zone_name=zone_name,
        days_off=days_off,
        now=now,
    )
    return build_plan_context(
        request,
        slots=slots,
        horizon_days=horizon_days,
        days_off=days_off,
        block_minutes=user.preferred_block_minutes,
        zone_name=zone_name,
        now=now,
    )
