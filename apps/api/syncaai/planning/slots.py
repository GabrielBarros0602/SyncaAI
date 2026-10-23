"""The free time a plan may use, day by day (ADR-0030).

Two limits per day, and an item has to fit inside both:

- **the free intervals** — the usable window (ADR-0029), minus every occupied range
  (ADR-0022), minus the past. Contiguity lives here: a 45-minute item needs 45 minutes in
  one piece, and three free half-hours do not hold it.
- **the free minutes left** — usable minus occupied, exactly as the capacity query reports
  it. A task booked outside the window still spends the day's budget, so a plan that only
  looked at the window could make a day heavy with every slot it used genuinely empty.

Pure: the capacities and the occupied ranges are handed in. Titles are never among them,
and nothing here could read one if they were.
"""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from syncaai.services.capacity import DayCapacity, UsableWindow
from syncaai.time_windows import SECONDS_IN_A_MINUTE, utc_window

Interval = tuple[datetime, datetime]


@dataclass(frozen=True)
class DaySlots:
    """One plannable day: where an item can go, and how many minutes it may still spend."""

    day: date
    #: Half-open UTC intervals, sorted, none empty.
    free: tuple[Interval, ...]
    budget_minutes: int


def build_slots(
    days: Sequence[DayCapacity],
    occupied: Iterable[Interval],
    *,
    window: UsableWindow,
    zone_name: str,
    days_off: frozenset[int],
    now: datetime,
    held: Iterable[Interval] = (),
) -> list[DaySlots]:
    """Every day of the horizon that is not a day off, with its two limits (ADR-0032).

    ``occupied`` is every booked range that touches the horizon, as ``[start_at, end_at)``.
    A range that began the evening before still occupies the morning it runs into; it is
    subtracted wherever it overlaps, whichever day it belongs to.

    ``held`` is time the plan's own steps hold before they are tasks, when a plan is
    placed again (ADR-0033). The capacity query cannot see it, so it is taken out of
    the gaps here and out of each local day's budget, by the minutes it overlaps.
    """
    zone = ZoneInfo(zone_name)
    kept = sorted(span for span in held if span[0] < span[1])
    taken = sorted([*occupied, *kept])
    plannable: list[DaySlots] = []
    for capacity in days:
        if capacity.day.isoweekday() in days_off:
            continue
        # The same conversion minutes_between uses, so the slots and the budget agree on
        # what the window is on a day the clock changes inside it.
        opens = datetime.combine(capacity.day, window.starts_at, tzinfo=zone).astimezone(
            timezone.utc
        )
        closes = datetime.combine(capacity.day, window.ends_at, tzinfo=zone).astimezone(
            timezone.utc
        )
        free = _subtract((max(opens, now), closes), taken)
        budget = max(0, capacity.free_minutes - _overlap(capacity.day, kept, zone_name))
        plannable.append(DaySlots(capacity.day, tuple(free), budget))
    return plannable


def _overlap(day: date, spans: Sequence[Interval], zone_name: str) -> int:
    """Minutes of ``spans`` inside the local ``day``: a step running past midnight
    spends each day the part it holds of it, as a task does (ADR-0022)."""
    day_start, day_end = utc_window(day, day, zone_name)
    seconds = sum(
        (min(end, day_end) - max(start, day_start)).total_seconds()
        for start, end in spans
        if start < day_end and end > day_start
    )
    return int(seconds) // SECONDS_IN_A_MINUTE


def _subtract(span: Interval, taken: Sequence[Interval]) -> list[Interval]:
    """What is left of ``span`` once every taken range is removed. Half-open throughout, so
    a task ending at 10:00 leaves 10:00 free."""
    start, end = span
    if start >= end:
        return []
    left: list[Interval] = []
    cursor = start
    for busy_start, busy_end in taken:
        # An empty range is a task completed before it began: it holds nothing, and the
        # exclusion constraint agrees, so it must not split the gap it sits in.
        if busy_end <= cursor or busy_start >= end or busy_start >= busy_end:
            continue
        if busy_start > cursor:
            left.append((cursor, busy_start))
        cursor = max(cursor, busy_end)
        if cursor >= end:
            break
    if cursor < end:
        left.append((cursor, end))
    return left
