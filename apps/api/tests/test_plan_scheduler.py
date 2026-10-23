"""Where a plan's steps go (ADR-0030 §3).

The scheduler and the slots it reads are pure, so every case here is a fixture: the day's
free intervals and budget, the steps, and now. The boundaries ADR-0005 asked to be tested
first come first: no free day, a step larger than every gap, a prerequisite that does not
fit, and the budget binding before the window does.
"""

from datetime import date, datetime, time, timedelta, timezone
from itertools import pairwise
from zoneinfo import ZoneInfo

import pytest

from syncaai.planning.scheduler import Placement, Step, schedule
from syncaai.planning.slots import DaySlots, build_slots
from syncaai.services.capacity import DayCapacity, UsableWindow

MONDAY = date(2031, 6, 2)
TUESDAY = date(2031, 6, 3)
SAO_PAULO = "America/Sao_Paulo"
LISBON = "Europe/Lisbon"


def _utc(day: date, hour: int, minute: int = 0) -> datetime:
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=timezone.utc)


def _local(day: date, hour: int, minute: int = 0, zone: str = SAO_PAULO) -> datetime:
    local = datetime(day.year, day.month, day.day, hour, minute, tzinfo=ZoneInfo(zone))
    return local.astimezone(timezone.utc)


def _day(day: date, *gaps: tuple[int, int, int, int], budget: int = 960) -> DaySlots:
    """A day's free gaps in UTC, as (hour, minute, hour, minute)."""
    free = tuple((_utc(day, h1, m1), _utc(day, h2, m2)) for h1, m1, h2, m2 in gaps)
    return DaySlots(day, free, budget)


def _starts(placements: list[Placement]) -> list[datetime | None]:
    return [placement.start for placement in placements]


NOW = _utc(MONDAY, 8)
MONDAY_MIDNIGHT_UTC = _utc(MONDAY, 0)


# --- The scheduler -------------------------------------------------------------------------


def test_steps_take_the_earliest_start_that_holds_them_in_order() -> None:
    placements = schedule([Step(0, 60), Step(1, 30)], [_day(MONDAY, (9, 0, 12, 0))], now=NOW)

    assert _starts(placements) == [_utc(MONDAY, 9), _utc(MONDAY, 10)]


@pytest.mark.parametrize(
    ("now", "expected"),
    [
        (_utc(MONDAY, 8), _utc(MONDAY, 8, 5)),
        (_utc(MONDAY, 8, 2) + timedelta(seconds=30), _utc(MONDAY, 8, 5)),
    ],
)
def test_a_start_is_strictly_after_now_and_on_a_five_minute_mark(
    now: datetime, expected: datetime
) -> None:
    """A task cannot start at now (ADR-0012), so a now exactly on a mark moves to the next."""
    placements = schedule([Step(0, 30)], [_day(MONDAY, (8, 0, 12, 0))], now=now)

    assert _starts(placements) == [expected]


def test_a_start_rounds_up_inside_a_gap_that_opens_off_the_grid() -> None:
    placements = schedule([Step(0, 30)], [_day(MONDAY, (9, 2, 12, 0))], now=NOW)

    assert _starts(placements) == [_utc(MONDAY, 9, 5)]


def test_a_step_waits_for_its_prerequisite_even_with_an_earlier_gap_free() -> None:
    """The second step could fit at nine, but its prerequisite only ends at eleven. A step
    with no prerequisite is free to take the gap the other could not."""
    day = _day(MONDAY, (9, 0, 9, 30), (10, 0, 12, 0))

    placements = schedule([Step(0, 60), Step(1, 30, after=(0,)), Step(2, 30)], [day], now=NOW)

    assert _starts(placements) == [_utc(MONDAY, 10), _utc(MONDAY, 11), _utc(MONDAY, 9)]


def test_a_step_larger_than_every_gap_stays_unplaced_and_the_rest_go_on() -> None:
    """Ninety free minutes in pieces do not hold a 60-minute step: the reason contiguity is
    measured on intervals and not on the aggregate (ADR-0030)."""
    day = _day(MONDAY, (9, 0, 9, 30), (10, 0, 10, 30), (11, 0, 11, 30))

    placements = schedule([Step(0, 60), Step(1, 30)], [day], now=NOW)

    assert placements[0].start is None
    assert placements[0].reason == "No free time in the plan's days holds 60 minutes in one piece."
    assert placements[1].start == _utc(MONDAY, 9)


def test_a_step_whose_prerequisite_has_no_time_stays_unplaced_too() -> None:
    day = _day(MONDAY, (9, 0, 9, 30))

    placements = schedule([Step(0, 60), Step(1, 15, after=(0,))], [day], now=NOW)

    assert _starts(placements) == [None, None]
    assert placements[1].reason == "A step it depends on has no time yet. Place that first."


def test_the_budget_binds_before_the_window_does() -> None:
    """Monday has eight empty hours inside its window, and thirty minutes of budget left,
    because tasks outside the window already spent the rest. The step goes to Tuesday."""
    monday = _day(MONDAY, (9, 0, 17, 0), budget=30)
    tuesday = _day(TUESDAY, (9, 0, 17, 0))

    placements = schedule([Step(0, 45)], [monday, tuesday], now=NOW)

    assert _starts(placements) == [_utc(TUESDAY, 9)]


def test_the_budget_is_spent_as_steps_are_placed() -> None:
    monday = _day(MONDAY, (9, 0, 17, 0), budget=60)
    tuesday = _day(TUESDAY, (9, 0, 17, 0))

    placements = schedule([Step(0, 45), Step(1, 30)], [monday, tuesday], now=NOW)

    assert _starts(placements) == [_utc(MONDAY, 9), _utc(TUESDAY, 9)]


def test_with_no_day_to_plan_in_nothing_is_placed() -> None:
    placements = schedule([Step(0, 30), Step(1, 30)], [], now=NOW)

    assert _starts(placements) == [None, None]


def test_a_gap_left_after_a_step_serves_the_next() -> None:
    placements = schedule([Step(0, 60), Step(1, 60)], [_day(MONDAY, (9, 0, 11, 0))], now=NOW)

    assert _starts(placements) == [_utc(MONDAY, 9), _utc(MONDAY, 10)]


def test_no_placement_overlaps_another_or_leaves_the_gap_it_came_from() -> None:
    """A dozen steps of mixed lengths and dependencies across two fragmented days, checked
    for the properties the commit relies on rather than for particular times."""
    days = [
        _day(MONDAY, (9, 0, 10, 10), (10, 40, 12, 0), (14, 3, 18, 0), budget=200),
        _day(TUESDAY, (8, 0, 9, 0), (13, 0, 16, 45)),
    ]
    lengths = [45, 20, 60, 15, 90, 30, 25, 60, 15, 40, 35, 50]
    steps = [
        Step(n, minutes, after=(n - 1,) if n % 3 == 2 else ()) for n, minutes in enumerate(lengths)
    ]

    placements = schedule(steps, days, now=NOW)

    placed = sorted(
        (p.start, p.start + timedelta(minutes=lengths[p.key])) for p in placements if p.start
    )
    assert len(placed) >= 8
    for (_, first_end), (second_start, _) in pairwise(placed):
        assert first_end <= second_start
    gaps = [gap for day in days for gap in day.free]
    for start, end in placed:
        assert start > NOW and start.minute % 5 == 0 and start.second == 0
        assert any(opens <= start and end <= closes for opens, closes in gaps)
    monday_minutes = sum(lengths[p.key] for p in placements if p.start and p.start.date() == MONDAY)
    assert monday_minutes <= 200
    for step, placement in zip(steps, placements, strict=True):
        for key in step.after:
            prerequisite = placements[key]
            if placement.start and prerequisite.start:
                assert prerequisite.start + timedelta(minutes=lengths[key]) <= placement.start


# --- The slots -----------------------------------------------------------------------------


def _capacity(day: date, free_minutes: int = 960) -> DayCapacity:
    return DayCapacity(
        day=day,
        weekday=day.isoweekday(),
        total_minutes=1440,
        usable_minutes=960,
        occupied_minutes=960 - free_minutes,
        free_minutes=free_minutes,
        task_count=0,
    )


def _slots(
    *days: date,
    occupied: list[tuple[datetime, datetime]] | None = None,
    now: datetime = MONDAY_MIDNIGHT_UTC,
    days_off: frozenset[int] = frozenset(),
    window: UsableWindow | None = None,
    zone: str = SAO_PAULO,
) -> list[DaySlots]:
    return build_slots(
        [_capacity(day) for day in days],
        occupied or [],
        window=window or UsableWindow(),
        zone_name=zone,
        days_off=days_off,
        now=now,
    )


def test_a_day_s_gaps_are_its_window_minus_what_is_booked() -> None:
    booked = [(_local(MONDAY, 10), _local(MONDAY, 11))]

    [monday] = _slots(MONDAY, occupied=booked)

    assert monday.free == (
        (_local(MONDAY, 6), _local(MONDAY, 10)),
        (_local(MONDAY, 11), _local(MONDAY, 22)),
    )


def test_a_task_ending_at_ten_leaves_ten_free() -> None:
    """Half-open, like every range in this project: back to back is not an overlap."""
    [monday] = _slots(MONDAY, occupied=[(_local(MONDAY, 6), _local(MONDAY, 10))])

    assert monday.free[0][0] == _local(MONDAY, 10)


def test_the_past_is_not_free() -> None:
    [monday] = _slots(MONDAY, now=_local(MONDAY, 12, 30))

    assert monday.free == ((_local(MONDAY, 12, 30), _local(MONDAY, 22)),)


def test_a_task_from_the_night_before_still_occupies_the_morning() -> None:
    """It belongs to Sunday (ADR-0012) and it runs until seven on Monday. Its minutes count
    where they happen, so the window opens at seven."""
    overnight = [(_local(MONDAY - timedelta(days=1), 23), _local(MONDAY, 7))]

    [monday] = _slots(MONDAY, occupied=overnight)

    assert monday.free[0][0] == _local(MONDAY, 7)


def test_a_day_whose_window_has_already_closed_has_no_gap() -> None:
    """Today, late at night: still a day of the horizon, with nothing left to offer."""
    [monday] = _slots(MONDAY, now=_local(MONDAY, 23))

    assert monday.free == ()


def test_a_booking_outside_the_window_leaves_the_window_whole() -> None:
    """It spends the day's budget, which the capacity query already counts, but it takes no
    gap the window had."""
    [monday] = _slots(MONDAY, occupied=[(_local(MONDAY, 3), _local(MONDAY, 4))])

    assert monday.free == ((_local(MONDAY, 6), _local(MONDAY, 22)),)


def test_a_booking_running_past_the_window_closes_it_early() -> None:
    [monday] = _slots(MONDAY, occupied=[(_local(MONDAY, 20), _local(MONDAY, 23, 30))])

    assert monday.free == ((_local(MONDAY, 6), _local(MONDAY, 20)),)


def test_days_off_are_not_offered_and_the_rest_are() -> None:
    """Monday is 1 (ADR-0032)."""
    days = _slots(MONDAY, TUESDAY, days_off=frozenset({1}))

    assert [day.day for day in days] == [TUESDAY]


def test_the_budget_is_the_free_minutes_the_capacity_query_reports() -> None:
    [monday] = build_slots(
        [_capacity(MONDAY, free_minutes=90)],
        [],
        window=UsableWindow(),
        zone_name=SAO_PAULO,
        days_off=frozenset(),
        now=_utc(MONDAY, 0),
    )

    assert monday.budget_minutes == 90


def test_the_window_is_read_through_the_zone_on_a_day_the_clock_changes() -> None:
    """Lisbon fell back on 2026-10-25. A window from midnight to six held seven real hours,
    the same reading the budget uses (ADR-0029)."""
    sunday = date(2026, 10, 25)
    window = UsableWindow(time(0), time(6))

    [day] = _slots(sunday, window=window, zone=LISBON, now=_utc(sunday, 0) - timedelta(days=1))

    ((opens, closes),) = day.free
    assert closes - opens == timedelta(hours=7)
