"""How much of each day is already spoken for.

This is the foundation of the AI layer, and it exists before any of it. ADR-0004 sends the
provider a per-day aggregate and never the tasks themselves — date, weekday, minutes
booked, minutes free, task count — so the number this produces is the number a plan is
built on. If it is wrong, every generated plan is wrong in a way that is very hard to see.

Two details carry that weight:

- **A day is not 1440 minutes.** On a daylight-saving transition it is 1380 or 1500. Using
  the constant would make free capacity wrong by an hour twice a year, and it would be
  wrong in the direction that overbooks.
- **A day can be over capacity.** Rule 3 of ADR-0012 puts every minute of a task on the day
  it starts, so a task beginning at 23:30 books 60 minutes into a day with 30 left. Free
  minutes floor at zero and the day is flagged, rather than reporting a negative number
  that a caller would have to know to handle.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, timedelta

from syncaai.errors import HorizonTooLongError, InvertedWindowError
from syncaai.repositories.tasks import TaskRepository
from syncaai.time_windows import minutes_in_local_day, utc_window

# The horizon a caller may ask for at once. ADR-0004's planning window is 14 days; this is
# well past it and still bounded, because the query is cheap per day but the response is
# not free and an unbounded range is an easy way to make the server assemble a year.
MAX_HORIZON_DAYS = 90


@dataclass(frozen=True)
class DayCapacity:
    """One day's aggregate. No task ever appears here, by design (ADR-0004)."""

    day: date
    weekday: int
    total_minutes: int
    occupied_minutes: int
    free_minutes: int
    task_count: int

    @property
    def over_capacity(self) -> bool:
        """Whether the day is booked past its own length.

        Reported rather than hidden: it is the visible consequence of Rule 3, and an
        interface that shows "over capacity" is more honest than one showing zero free
        minutes for a day with four hours of overflow.
        """
        return self.occupied_minutes > self.total_minutes


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

        window_start, window_end = utc_window(first_day, last_day, self._zone_name)
        booked = {
            row.day: (int(row.occupied_minutes), int(row.task_count))
            for row in self._tasks.occupied_minutes_by_day(
                window_start=window_start, window_end=window_end, zone_name=self._zone_name
            )
        }

        return [self._for(day, *booked.get(day, (0, 0))) for day in _days(first_day, last_day)]

    def _for(self, day: date, occupied: int, task_count: int) -> DayCapacity:
        total = minutes_in_local_day(day, self._zone_name)
        return DayCapacity(
            day=day,
            # ISO: Monday is 1. Included so the assembler does not recompute it, and because
            # "which day of the week" is what a planning prompt actually reasons about.
            weekday=day.isoweekday(),
            total_minutes=total,
            occupied_minutes=occupied,
            free_minutes=max(0, total - occupied),
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
