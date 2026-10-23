"""Changes an account makes to itself."""

from syncaai.errors import BlockLengthOutOfRangeError, NoDayToPlanError, WeekdayOutOfRangeError
from syncaai.models import User
from syncaai.planning.contract import MAX_ITEM_MINUTES, MIN_ITEM_MINUTES
from syncaai.schemas.users import MeUpdate
from syncaai.services.capacity import UsableWindow

WEEKDAYS = range(1, 8)


def change_settings(user: User, payload: MeUpdate) -> None:
    """Apply a settings change, checking all of it before writing any of it.

    A request that sets a valid window and an invalid block changes neither: half a settings
    change is a state the person never asked for and has no way to see.
    """
    window = _window(user, payload)
    days_off = None if payload.days_off is None else _days_off(payload.days_off)
    block = (
        None if payload.preferred_block_minutes is None else _block(payload.preferred_block_minutes)
    )

    user.day_starts_at = window.starts_at
    user.day_ends_at = window.ends_at
    if days_off is not None:
        user.days_off = days_off
    if block is not None:
        user.preferred_block_minutes = block


def _window(user: User, payload: MeUpdate) -> UsableWindow:
    """The usable day the request leaves behind (ADR-0029).

    Either end may arrive alone, so the pair is assembled from the request and the stored row
    before anything is checked. Checking each end on its own could not tell that moving the
    start past the stored end produces a window that ends before it starts.
    """
    window = UsableWindow(
        payload.day_starts_at if payload.day_starts_at is not None else user.day_starts_at,
        payload.day_ends_at if payload.day_ends_at is not None else user.day_ends_at,
    )
    window.check()
    return window


def _days_off(days: list[int]) -> list[int]:
    """ISO weekdays, stored sorted and without repeats, so one set has one spelling and the
    column's count of days is a count of days (ADR-0032)."""
    if any(day not in WEEKDAYS for day in days):
        raise WeekdayOutOfRangeError
    normalised = sorted(set(days))
    if len(normalised) == len(WEEKDAYS):
        raise NoDayToPlanError
    return normalised


def _block(minutes: int) -> int:
    """The bounds a planned step has, because the block is what bounds a step (ADR-0032)."""
    if not MIN_ITEM_MINUTES <= minutes <= MAX_ITEM_MINUTES:
        raise BlockLengthOutOfRangeError
    return minutes
