"""Tests for converting a local calendar window into a UTC range.

The expected values are not derived from the implementation. They come from the IANA
database's account of what actually happened in Brazil, which is what makes them worth
asserting: daylight saving there began *at* midnight, so a date could have no midnight and
a day could be shorter or longer than 1440 minutes.
"""

from datetime import date, datetime, time, timezone

import pytest

from syncaai.time_windows import minutes_between, minutes_in_local_day, utc_window

SAO_PAULO = "America/Sao_Paulo"
LISBON = "Europe/Lisbon"


def test_a_week_becomes_a_half_open_utc_range() -> None:
    start, end = utc_window(date(2026, 8, 10), date(2026, 8, 16), SAO_PAULO)

    assert start == datetime(2026, 8, 10, 3, 0, tzinfo=timezone.utc)
    assert end == datetime(2026, 8, 17, 3, 0, tzinfo=timezone.utc)


def test_the_window_depends_on_the_zone() -> None:
    start, end = utc_window(date(2026, 8, 10), date(2026, 8, 10), LISBON)

    assert start == datetime(2026, 8, 9, 23, 0, tzinfo=timezone.utc)
    assert end == datetime(2026, 8, 10, 23, 0, tzinfo=timezone.utc)


def test_a_day_whose_midnight_never_happened() -> None:
    """Brazil started daylight saving at midnight: on 2018-11-04, 00:00 did not exist.

    The first instant of that local day is 01:00 local, which is 03:00 UTC.
    """
    start, end = utc_window(date(2018, 11, 4), date(2018, 11, 4), SAO_PAULO)

    assert start == datetime(2018, 11, 4, 3, 0, tzinfo=timezone.utc)
    assert end == datetime(2018, 11, 5, 2, 0, tzinfo=timezone.utc)


def test_an_ordinary_day_lasts_1440_minutes() -> None:
    assert minutes_in_local_day(date(2026, 8, 10), SAO_PAULO) == 1440


def test_the_day_daylight_saving_began_lasted_23_hours() -> None:
    assert minutes_in_local_day(date(2018, 11, 4), SAO_PAULO) == 1380


def test_the_day_daylight_saving_ended_lasted_25_hours() -> None:
    assert minutes_in_local_day(date(2019, 2, 16), SAO_PAULO) == 1500


def test_a_single_day_window_covers_exactly_that_day() -> None:
    start, end = utc_window(date(2026, 8, 10), date(2026, 8, 10), SAO_PAULO)

    assert (end - start).total_seconds() == 24 * 60 * 60


def test_an_inverted_range_is_rejected() -> None:
    with pytest.raises(ValueError, match="precedes"):
        utc_window(date(2026, 8, 16), date(2026, 8, 10), SAO_PAULO)


def test_part_of_an_ordinary_day_is_its_length_on_the_clock() -> None:
    assert minutes_between(date(2026, 8, 10), time(6), time(22), SAO_PAULO) == 960


def test_part_of_a_day_loses_the_hour_the_clock_skips_inside_it() -> None:
    """Lisbon moved from 01:00 to 02:00 on 2026-03-29. Eighteen hours on the clock, from
    midnight, were seventeen real ones (ADR-0029)."""
    assert minutes_between(date(2026, 3, 29), time(0), time(18), LISBON) == 17 * 60


def test_part_of_a_day_gains_the_hour_the_clock_repeats_inside_it() -> None:
    """And moved back from 02:00 to 01:00 on 2026-10-25, the Sunday the week designs use."""
    assert minutes_between(date(2026, 10, 25), time(0), time(18), LISBON) == 19 * 60


def test_a_change_outside_the_stretch_does_not_touch_it() -> None:
    """São Paulo's change happened at midnight, so a day that began at six never saw it."""
    assert minutes_between(date(2018, 11, 4), time(6), time(22), SAO_PAULO) == 960
    assert minutes_between(date(2019, 2, 16), time(6), time(22), SAO_PAULO) == 960
