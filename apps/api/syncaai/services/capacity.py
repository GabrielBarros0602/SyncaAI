"""How much of each day is already spoken for.

This is the foundation of the AI layer, and it exists before any of it. ADR-0004 sends the
provider a per-day aggregate and never the tasks themselves — date, weekday, minutes
booked, minutes free, task count — so the number this produces is the number a plan is
built on. If it is wrong, every generated plan is wrong in a way that is very hard to see.

Two details carry that weight:

- **A day is not 1440 minutes.** On a daylight-saving transition it is 1380 or 1500. That
  length is still reported, because it is the only thing in the model that changes geometry
  and the screen draws it.
- **A day does not offer all of itself.** Capacity is measured against sixteen usable hours
  (ADR-0022), because a tool that says you have twenty-four hours free is not helping
  anybody plan. The first person other than the author to see the screen said so in one
  sentence: "why is it only full at 24 hours — doesn't he sleep?"
- **Minutes count where they happen.** A task crossing midnight gives its minutes to both
  days, clipped, and one completed early stops occupying the time it gave back. Both come
  out of the query rather than out of arithmetic here.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

from syncaai.errors import HorizonTooLongError, InvertedWindowError
from syncaai.repositories.tasks import TaskRepository
from syncaai.time_windows import minutes_in_local_day, utc_window

# The horizon a caller may ask for at once. ADR-0004's planning window is 14 days; this is
# well past it and still bounded, because the query is cheap per day but the response is
# not free and an unbounded range is an easy way to make the server assemble a year.
MAX_HORIZON_DAYS = 90

# Sixteen hours, leaving eight for sleep (ADR-0022). A constant rather than a column: it
# becomes a per-user preference alongside the working hours ADR-0004 lists, and GET /me is
# the resource it will attach to.
USABLE_MINUTES_PER_DAY = 16 * 60

# Where the day stops being merely full and starts being worth saying something about. The
# thresholds are strictly greater, so eighteen hours exactly is still `heavy` — the same
# convention over_capacity already uses.
STRAINED_ABOVE = 18 * 60
UNSUSTAINABLE_ABOVE = 20 * 60

MINUTES_IN_A_CALENDAR_DAY = 24 * 60

Load = Literal["fine", "heavy", "strained", "unsustainable"]


@dataclass(frozen=True)
class DayCapacity:
    """One day's aggregate. No task ever appears here, by design (ADR-0004)."""

    day: date
    weekday: int
    #: The real length of the local day — 1440, or 1380/1500 on a transition. Kept because
    #: it is the only thing in the model that changes geometry, and the screen draws it.
    total_minutes: int
    #: What a person can actually spend. The figures below are all measured against this.
    usable_minutes: int
    occupied_minutes: int
    free_minutes: int
    task_count: int

    @property
    def over_capacity(self) -> bool:
        """Booked past the usable day.

        Against ``usable_minutes`` rather than ``total_minutes``, which is what keeps this
        reachable at all. With minutes clipped at midnight and overlaps already impossible,
        a day can never exceed its own length — measured against the calendar day this flag
        would be dead code (ADR-0022).
        """
        return self.occupied_minutes > self.usable_minutes

    @property
    def load(self) -> Load:
        """How heavy the day is, in four steps.

        Strictly greater at every threshold, so sixteen hours exactly is still ``fine`` —
        the same convention ``over_capacity`` uses.
        """
        if self.occupied_minutes > UNSUSTAINABLE_ABOVE:
            return "unsustainable"
        if self.occupied_minutes > STRAINED_ABOVE:
            return "strained"
        if self.occupied_minutes > self.usable_minutes:
            return "heavy"
        return "fine"

    @property
    def unbooked_minutes(self) -> int:
        """What is left of the whole day, not of the budget.

        The figure the two loudest messages carry. Measured against the budget it would read
        zero at every level that shows it, and say nothing.
        """
        return max(0, MINUTES_IN_A_CALENDAR_DAY - self.occupied_minutes)


class CapacityService:
    def __init__(self, tasks: TaskRepository, zone_name: str) -> None:
        self._tasks = tasks
        self._zone_name = zone_name

    def by_day(self, first_day: date, last_day: date) -> list[DayCapacity]:
        """Every day in the window, including the empty ones.

        The gaps are filled here rather than in SQL because an empty day still has a
        length, and that length depends on the time zone — which the query deliberately
        does not know.
        """
        self._check_window(first_day, last_day)

        days = _days(first_day, last_day)
        # One window per day rather than one for the whole range: the clipping is per day,
        # and each day's boundaries are its own — a daylight-saving day is not 1440 minutes
        # after the one before it.
        windows = [(day, *utc_window(day, day, self._zone_name)) for day in days]

        booked = {
            row.day: (round(float(row.occupied_minutes)), int(row.task_count))
            for row in self._tasks.occupied_minutes_by_day(windows=windows)
        }

        return [self._for(day, *booked.get(day, (0, 0))) for day in days]

    def _for(self, day: date, occupied: int, task_count: int) -> DayCapacity:
        total = minutes_in_local_day(day, self._zone_name)
        # Clamped by the real day, so a hypothetically short day cannot offer more usable
        # minutes than it has hours.
        usable = min(USABLE_MINUTES_PER_DAY, total)
        return DayCapacity(
            day=day,
            # ISO: Monday is 1. Included so the assembler does not recompute it, and because
            # "which day of the week" is what a planning prompt actually reasons about.
            weekday=day.isoweekday(),
            total_minutes=total,
            usable_minutes=usable,
            occupied_minutes=occupied,
            free_minutes=max(0, usable - occupied),
            task_count=task_count,
        )

    @staticmethod
    def _check_window(first_day: date, last_day: date) -> None:
        if last_day < first_day:
            raise InvertedWindowError
        if (last_day - first_day).days + 1 > MAX_HORIZON_DAYS:
            raise HorizonTooLongError


def _days(first_day: date, last_day: date) -> Sequence[date]:
    return [first_day + timedelta(days=offset) for offset in range((last_day - first_day).days + 1)]
