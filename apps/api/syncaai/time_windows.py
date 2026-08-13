"""Translating between a user's local calendar and stored instants.

Instants are stored as ``timestamptz`` and the local day is never materialised
(ADR-0009), so every query over a local window has to convert that window into a UTC
range first. This module is the single place that conversion happens; reimplementing it
per query is how timezone bugs get in.

The conversion is not arithmetic on a fixed offset. Two facts make it awkward, and both
are covered by tests:

- Midnight does not always exist. Brazil used to start daylight saving *at* midnight, so
  on 2018-11-04 the clock went from 23:59:59 straight to 01:00:00 and 00:00 never
  happened. The first instant of that local day is 01:00 local.
- A day is not always 1440 minutes. The same date lasted 23 hours; 2019-02-16 lasted 25.
"""

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

SECONDS_IN_A_MINUTE = 60


def utc_window(first_day: date, last_day: date, zone_name: str) -> tuple[datetime, datetime]:
    """Return the half-open UTC range covering ``first_day`` through ``last_day``.

    Half-open — ``[start, end)`` — because that is what a range predicate wants:
    ``start_at >= start AND start_at < end`` needs no adjustment for the last microsecond
    of the window, and it composes when windows are placed side by side.

    Raises ``ValueError`` if the range is inverted, and ``ZoneInfoNotFoundError`` if the
    zone is unknown, which is why ``User.timezone`` is validated before it is stored.
    """
    if last_day < first_day:
        message = f"last_day {last_day} precedes first_day {first_day}"
        raise ValueError(message)

    zone = ZoneInfo(zone_name)
    start = datetime.combine(first_day, time.min, tzinfo=zone)
    end = datetime.combine(last_day + timedelta(days=1), time.min, tzinfo=zone)
    return start.astimezone(UTC), end.astimezone(UTC)


def minutes_in_local_day(day: date, zone_name: str) -> int:
    """Return how many minutes that local day actually lasts.

    Usually 1440, but 1380 or 1500 on a daylight saving transition. The capacity
    calculation must use this rather than a constant, or a day's free minutes will be
    wrong by an hour twice a year in any zone that still observes daylight saving.
    """
    start, end = utc_window(day, day, zone_name)
    return int((end - start).total_seconds() // SECONDS_IN_A_MINUTE)
