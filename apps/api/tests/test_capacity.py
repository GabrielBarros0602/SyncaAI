"""Tests for the day-capacity calculation.

This is the number the AI layer plans against (ADR-0004). A wrong answer here does not look
like a bug — it looks like a plan that quietly overbooks a Tuesday.

The repository is faked, because what is under test is what the service does with the
numbers. The part PostgreSQL owns — clipping each task to each day — is asserted against a
real database in ``test_capacity_query.py``.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, NamedTuple

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from syncaai.api.dependencies import get_current_user
from syncaai.api.routes.capacity import get_capacity_service
from syncaai.db import get_session
from syncaai.errors import HorizonTooLongError, InvertedWindowError
from syncaai.services.capacity import (
    DEFAULT_USABLE_MINUTES,
    MAX_HORIZON_DAYS,
    MAX_USABLE_MINUTES,
    STRAINED_ABOVE,
    UNSUSTAINABLE_ABOVE,
    CapacityService,
)

CAPACITY = "/api/v1/capacity"
SAO_PAULO = "America/Sao_Paulo"

# Brazil no longer observes daylight saving, but the time zone database remembers when it
# did, and a stored zone is only as good as its history.
A_SHORT_DAY = date(2018, 11, 4)  # 23 hours
A_LONG_DAY = date(2019, 2, 16)  # 25 hours


class _Row(NamedTuple):
    day: date
    occupied_minutes: float
    task_count: int


class _FakeTasks:
    def __init__(self, rows: list[_Row] | None = None) -> None:
        self.rows = rows or []
        self.windows: list[tuple[date, datetime, datetime]] | None = None

    def occupied_minutes_by_day(
        self, *, windows: list[tuple[date, datetime, datetime]]
    ) -> list[_Row]:
        self.windows = windows
        return self.rows


def _service(
    rows: list[_Row] | None = None,
    zone: str = SAO_PAULO,
    usable: int = DEFAULT_USABLE_MINUTES,
) -> CapacityService:
    return CapacityService(_FakeTasks(rows), zone, usable)  # type: ignore[arg-type]


def _booked(day: date, minutes: float, tasks: int = 1) -> list[_Row]:
    return [_Row(day, minutes, tasks)]


A_MONDAY = date(2030, 6, 3)


def test_a_day_offers_sixteen_usable_hours_not_twenty_four() -> None:
    # The whole reason ADR-0022 exists. The first person other than the author to see the
    # screen asked why a day was only full at 24 hours — "doesn't he sleep?".
    day = _service().by_day(A_MONDAY, A_MONDAY)[0]

    assert day.usable_minutes == DEFAULT_USABLE_MINUTES
    assert day.free_minutes == DEFAULT_USABLE_MINUTES


def test_the_real_length_of_the_day_is_still_reported() -> None:
    # It drives the track under each column, and it is the only thing in the model that
    # changes geometry. Replacing it with the budget would erase the daylight-saving day.
    ordinary = _service().by_day(A_MONDAY, A_MONDAY)[0]
    short = _service().by_day(A_SHORT_DAY, A_SHORT_DAY)[0]
    long = _service().by_day(A_LONG_DAY, A_LONG_DAY)[0]

    assert (ordinary.total_minutes, short.total_minutes, long.total_minutes) == (1440, 1380, 1500)


def test_a_daylight_saving_day_still_offers_the_same_budget() -> None:
    # The hour that disappears is one nobody was going to work through.
    assert _service().by_day(A_SHORT_DAY, A_SHORT_DAY)[0].usable_minutes == DEFAULT_USABLE_MINUTES


def test_free_minutes_come_off_the_budget_not_off_the_calendar_day() -> None:
    day = _service(_booked(A_MONDAY, 120, 2)).by_day(A_MONDAY, A_MONDAY)[0]

    assert day.occupied_minutes == 120
    assert day.free_minutes == DEFAULT_USABLE_MINUTES - 120
    assert day.task_count == 2


def test_a_day_with_nothing_on_it_is_still_in_the_answer() -> None:
    """A gap in the result is not an empty day — it is a day the caller has to guess at."""
    days = _service().by_day(A_MONDAY, A_MONDAY + timedelta(days=2))

    assert [day.day for day in days] == [A_MONDAY, date(2030, 6, 4), date(2030, 6, 5)]
    assert [day.task_count for day in days] == [0, 0, 0]


@pytest.mark.parametrize(
    ("booked", "expected"),
    [
        (0, "fine"),
        (DEFAULT_USABLE_MINUTES - 1, "fine"),
        (DEFAULT_USABLE_MINUTES, "fine"),
        (DEFAULT_USABLE_MINUTES + 1, "heavy"),
        (STRAINED_ABOVE, "heavy"),
        (STRAINED_ABOVE + 1, "strained"),
        (UNSUSTAINABLE_ABOVE, "strained"),
        (UNSUSTAINABLE_ABOVE + 1, "unsustainable"),
    ],
)
def test_load_steps_strictly_above_each_threshold(booked: int, expected: str) -> None:
    # Both sides of all three boundaries. Sixteen hours exactly is still fine — the same
    # convention over_capacity already used, and an off-by-one here is invisible.
    assert _service(_booked(A_MONDAY, booked)).by_day(A_MONDAY, A_MONDAY)[0].load == expected


def test_over_capacity_is_measured_against_the_budget() -> None:
    # Against the calendar day this flag would be unreachable: minutes are clipped at
    # midnight and overlaps are impossible, so a day can never exceed its own length. The
    # budget is what keeps it meaning something (ADR-0022).
    days = _service(_booked(A_MONDAY, DEFAULT_USABLE_MINUTES + 60)).by_day(A_MONDAY, A_MONDAY)

    assert days[0].over_capacity is True
    assert days[0].free_minutes == 0


def test_exactly_the_budget_is_full_but_not_over() -> None:
    day = _service(_booked(A_MONDAY, DEFAULT_USABLE_MINUTES)).by_day(A_MONDAY, A_MONDAY)[0]

    assert day.free_minutes == 0
    assert day.over_capacity is False


def test_unbooked_counts_against_the_whole_day() -> None:
    # The figure the two loudest messages carry. Against the budget it would read zero at
    # every level that shows it, and say nothing.
    day = _service(_booked(A_MONDAY, 19 * 60)).by_day(A_MONDAY, A_MONDAY)[0]

    assert day.load == "strained"
    assert day.unbooked_minutes == 5 * 60


def test_unbooked_counts_against_the_day_the_zone_actually_has() -> None:
    # Twenty-three hours, not twenty-four. Against a fixed 1440 this would answer 5h and
    # offer an hour that the clock skipped — the same lie about a day's size that ADR-0022
    # was written to remove, surviving in the one figure measured against the whole day.
    day = _service(_booked(A_SHORT_DAY, 19 * 60)).by_day(A_SHORT_DAY, A_SHORT_DAY)[0]

    assert day.total_minutes == 23 * 60
    assert day.unbooked_minutes == 4 * 60


def test_unbooked_counts_the_hour_a_long_day_gains() -> None:
    day = _service(_booked(A_LONG_DAY, 19 * 60)).by_day(A_LONG_DAY, A_LONG_DAY)[0]

    assert day.total_minutes == 25 * 60
    assert day.unbooked_minutes == 6 * 60


def test_nothing_ever_reports_a_negative() -> None:
    day = _service(_booked(A_MONDAY, 22 * 60)).by_day(A_MONDAY, A_MONDAY)[0]

    assert day.free_minutes == 0
    assert day.unbooked_minutes == 2 * 60


def test_heavy_is_measured_against_this_person_s_budget() -> None:
    # Somebody who says their day is eight hours is heavy at eight hours and one minute, not
    # at sixteen. `heavy` is the one step that is a statement about a plan (ADR-0023).
    eight_hours = 8 * 60
    service = _service(_booked(A_MONDAY, eight_hours + 1), usable=eight_hours)

    day = service.by_day(A_MONDAY, A_MONDAY)[0]
    assert day.usable_minutes == eight_hours
    assert day.load == "heavy"
    assert day.over_capacity is True


def test_the_two_loud_levels_ignore_the_budget_entirely() -> None:
    # A shorter budget must not make a nineteen-hour day sound worse than it is, nor a
    # longer one make it sound better. These two are claims about a person (ADR-0023).
    for usable in (6 * 60, 12 * 60, MAX_USABLE_MINUTES):
        day = _service(_booked(A_MONDAY, 19 * 60), usable=usable).by_day(A_MONDAY, A_MONDAY)[0]
        assert day.load == "strained"


def test_a_budget_past_the_ceiling_is_brought_back_to_it() -> None:
    # The single reason the ladder cannot invert. Left alone, a twenty-hour budget would let
    # a nineteen-hour day report `strained` while sitting inside its own budget — an extreme
    # -day warning beside a figure saying there is an hour left (ADR-0023).
    day = _service(_booked(A_MONDAY, 19 * 60), usable=20 * 60).by_day(A_MONDAY, A_MONDAY)[0]

    assert day.usable_minutes == MAX_USABLE_MINUTES
    assert day.load == "strained"
    assert day.over_capacity is True


@pytest.mark.parametrize("usable", [60, 8 * 60, DEFAULT_USABLE_MINUTES, MAX_USABLE_MINUTES])
def test_over_capacity_is_exactly_load_other_than_fine(usable: int) -> None:
    """The invariant the ceiling buys, at every budget a person can choose.

    The screen drives its accent colour from one of the two. If they could ever disagree it
    would show a warning with no chip, or a chip with nothing said — so this is asserted
    rather than assumed (ADR-0023).
    """
    for booked in range(0, 24 * 60 + 1, 30):
        day = _service(_booked(A_MONDAY, booked), usable=usable).by_day(A_MONDAY, A_MONDAY)[0]
        assert day.over_capacity is (day.load != "fine"), f"{usable=} {booked=} {day.load=}"


def test_the_weekday_is_iso_so_monday_is_one() -> None:
    days = _service().by_day(A_MONDAY, A_MONDAY + timedelta(days=6))

    assert [day.weekday for day in days] == [1, 2, 3, 4, 5, 6, 7]


def test_one_window_is_asked_for_per_day_not_one_for_the_range() -> None:
    # The clipping is per day, and each day's boundaries are its own. A single range would
    # make a daylight-saving day 1440 minutes after the one before it.
    tasks = _FakeTasks()

    CapacityService(tasks, SAO_PAULO).by_day(A_MONDAY, A_MONDAY + timedelta(days=2))  # type: ignore[arg-type]

    assert tasks.windows is not None
    assert len(tasks.windows) == 3
    assert tasks.windows[0] == (
        A_MONDAY,
        datetime(2030, 6, 3, 3, tzinfo=timezone.utc),
        datetime(2030, 6, 4, 3, tzinfo=timezone.utc),
    )


def test_the_windows_follow_the_users_own_zone() -> None:
    """Two users asking for the same date are asking about different instants."""
    in_tokyo = _FakeTasks()

    CapacityService(in_tokyo, "Asia/Tokyo").by_day(A_MONDAY, A_MONDAY)  # type: ignore[arg-type]

    assert in_tokyo.windows is not None
    assert in_tokyo.windows[0][1] == datetime(2030, 6, 2, 15, tzinfo=timezone.utc)


def test_a_window_that_ends_before_it_starts_is_refused() -> None:
    with pytest.raises(InvertedWindowError):
        _service().by_day(date(2030, 6, 2), date(2030, 6, 1))


def test_the_longest_allowed_horizon_is_accepted_and_one_more_is_not() -> None:
    first = date(2030, 6, 1)

    assert len(_service().by_day(first, first + timedelta(days=MAX_HORIZON_DAYS - 1))) == (
        MAX_HORIZON_DAYS
    )
    with pytest.raises(HorizonTooLongError):
        _service().by_day(first, first + timedelta(days=MAX_HORIZON_DAYS))


class _NoOpSession:
    def commit(self) -> None:
        pass


class _FakeUser:
    id = uuid.UUID("11111111-1111-1111-1111-111111111111")
    timezone = SAO_PAULO


def _wire(app: FastAPI, service: CapacityService) -> None:
    app.dependency_overrides[get_current_user] = lambda: _FakeUser()
    app.dependency_overrides[get_session] = lambda: _NoOpSession()
    app.dependency_overrides[get_capacity_service] = lambda: service


def test_the_endpoint_reports_both_lengths_and_the_load(app: FastAPI, client: TestClient) -> None:
    _wire(app, _service(_booked(A_MONDAY, 19 * 60, 12)))

    body: list[dict[str, Any]] = client.get(
        CAPACITY, params={"first_day": "2030-06-03", "last_day": "2030-06-03"}
    ).json()

    assert body[0] == {
        "day": "2030-06-03",
        "weekday": 1,
        "total_minutes": 1440,
        "usable_minutes": 960,
        "occupied_minutes": 1140,
        "free_minutes": 0,
        "unbooked_minutes": 300,
        "task_count": 12,
        "over_capacity": True,
        "load": "strained",
    }


def test_no_task_ever_appears_in_the_response(app: FastAPI, client: TestClient) -> None:
    """Capacity is an aggregate, never content (ADR-0004). Asserted on the shape rather
    than trusted to review, because this is the field a future change would add."""
    _wire(app, _service(_booked(A_MONDAY, 60)))

    body = client.get(CAPACITY, params={"first_day": "2030-06-03", "last_day": "2030-06-03"}).json()

    assert set(body[0]) == {
        "day",
        "weekday",
        "total_minutes",
        "usable_minutes",
        "occupied_minutes",
        "free_minutes",
        "unbooked_minutes",
        "task_count",
        "over_capacity",
        "load",
    }


def test_an_inverted_window_answers_422(app: FastAPI, client: TestClient) -> None:
    _wire(app, _service())

    response = client.get(CAPACITY, params={"first_day": "2030-06-02", "last_day": "2030-06-01"})

    assert response.status_code == 422
    assert response.json()["detail"] == "last_day cannot precede first_day."


def test_asking_for_too_long_a_horizon_answers_422(app: FastAPI, client: TestClient) -> None:
    _wire(app, _service())

    response = client.get(CAPACITY, params={"first_day": "2030-01-01", "last_day": "2031-01-01"})

    assert response.status_code == 422
    assert str(MAX_HORIZON_DAYS) in response.json()["detail"]


def test_the_endpoint_needs_a_token(app: FastAPI, client: TestClient) -> None:
    app.dependency_overrides[get_session] = lambda: _NoOpSession()

    response = client.get(CAPACITY, params={"first_day": "2030-06-03", "last_day": "2030-06-03"})

    assert response.status_code == 401
