"""Tests for converting a local calendar window into a UTC range.

The expected values are not derived from the implementation. They come from the IANA
database's account of what actually happened in Brazil, which is what makes them worth
asserting: daylight saving there began *at* midnight, so a date could have no midnight and
a day could be shorter or longer than 1440 minutes.
"""

from datetime import UTC, date, datetime

import pytest

from syncaai.time_windows import minutes_in_local_day, utc_window

SAO_PAULO = "America/Sao_Paulo"
LISBON = "Europe/Lisbon"


def test_a_week_becomes_a_half_open_utc_range() -> None:
    start, end = utc_window(date(2026, 8, 10), date(2026, 8, 16), SAO_PAULO)

    assert start == datetime(2026, 8, 10, 3, 0, tzinfo=UTC)
    assert end == datetime(2026, 8, 17, 3, 0, tzinfo=UTC)


def test_the_window_depends_on_the_zone() -> None:
    start, end = utc_window(date(2026, 8, 10), date(2026, 8, 10), LISBON)

    assert start == datetime(2026, 8, 9, 23, 0, tzinfo=UTC)
    assert end == datetime(2026, 8, 10, 23, 0, tzinfo=UTC)


def test_a_day_whose_midnight_never_happened() -> None:
    """Brazil started daylight saving at midnight: on 2018-11-04, 00:00 did not exist.

    The first instant of that local day is 01:00 local, which is 03:00 UTC.
    """
    start, end = utc_window(date(2018, 11, 4), date(2018, 11, 4), SAO_PAULO)

    assert start == datetime(2018, 11, 4, 3, 0, tzinfo=UTC)
    assert end == datetime(2018, 11, 5, 2, 0, tzinfo=UTC)


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
