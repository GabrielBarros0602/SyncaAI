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
  Nor is any stretch of it that contains the change, which is why a person's usable window
  is measured here too.
"""

# timezone.utc rather than the datetime.UTC alias: identical object, and the older
# spelling keeps this module importable under interpreters before 3.11.
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

SECONDS_IN_A_MINUTE = 60


def is_valid_timezone(zone_name: str) -> bool:
    """Return whether the name is one the time zone database knows.

    Validated at the boundary, before a user is stored. A stored name that does not resolve
    turns every later window calculation for that user into an exception raised far from
    its cause.
    """
    try:
        ZoneInfo(zone_name)
    except (ZoneInfoNotFoundError, ValueError):
        return False
    return True


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
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc)


def minutes_in_local_day(day: date, zone_name: str) -> int:
    """Return how many minutes that local day actually lasts.

    Usually 1440, but 1380 or 1500 on a daylight saving transition. The capacity
    calculation must use this rather than a constant, or a day's free minutes will be
    wrong by an hour twice a year in any zone that still observes daylight saving.
    """
    start, end = utc_window(day, day, zone_name)
    return int((end - start).total_seconds() // SECONDS_IN_A_MINUTE)


def minutes_between(day: date, starts_at: time, ends_at: time, zone_name: str) -> int:
    """Return how many minutes really pass between two wall-clock times on one local day.

    The same fact ``minutes_in_local_day`` accounts for, applied to part of a day: usually
    the difference on the clock, an hour more or less when the clock changes in between
    (ADR-0029). A time inside a skipped hour does not exist and is read the way ``zoneinfo``
    reads it, with the offset in force before the change; one inside a repeated hour is its
    first occurrence.
    """
    zone = ZoneInfo(zone_name)
    start = datetime.combine(day, starts_at, tzinfo=zone)
    end = datetime.combine(day, ends_at, tzinfo=zone)
    # Through UTC on purpose. Subtracting two aware datetimes that share a tzinfo compares
    # their wall clocks and ignores the offsets, which would erase the very hour this exists
    # to count.
    elapsed = end.astimezone(timezone.utc) - start.astimezone(timezone.utc)
    return int(elapsed.total_seconds() // SECONDS_IN_A_MINUTE)
