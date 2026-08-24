"""Tests for the day-capacity calculation.

This is the number the AI layer plans against (ADR-0004). A wrong answer here does not
look like a bug — it looks like a plan that quietly overbooks a Sunday in November.

The repository is faked, because what is under test is arithmetic over local days, and the
part PostgreSQL owns — grouping rows by a derived date — is asserted against a real
database in ``test_capacity_query.py``.
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
from syncaai.services.capacity import MAX_HORIZON_DAYS, CapacityService

CAPACITY = "/api/v1/capacity"
SAO_PAULO = "America/Sao_Paulo"

# Brazil no longer observes daylight saving, but the database remembers when it did, and a
# stored zone is only as good as its history. These two dates are why the calculation cannot
# use 1440: the clock moved at midnight, so one date lost an hour and the other gained one.
A_SHORT_DAY = date(2018, 11, 4)  # 23 hours
A_LONG_DAY = date(2019, 2, 16)  # 25 hours


class _Row(NamedTuple):
    """The shape ``execute(...).all()`` returns for the grouped query."""

    day: date
    occupied_minutes: int
    task_count: int


class _FakeTasks:
    def __init__(self, rows: list[_Row] | None = None) -> None:
        self.rows = rows or []
        self.asked_for: dict[str, Any] | None = None

    def occupied_minutes_by_day(
        self, *, window_start: datetime, window_end: datetime, zone_name: str
    ) -> list[_Row]:
        self.asked_for = {"start": window_start, "end": window_end, "zone": zone_name}
        return self.rows


def _service(rows: list[_Row] | None = None, zone: str = SAO_PAULO) -> CapacityService:
    return CapacityService(_FakeTasks(rows), zone)  # type: ignore[arg-type]


def test_a_day_with_nothing_on_it_is_still_in_the_answer() -> None:
    """A gap in the result is not an empty day — it is a day the caller has to guess at."""
    days = _service().by_day(date(2030, 6, 1), date(2030, 6, 3))

    assert [day.day for day in days] == [date(2030, 6, 1), date(2030, 6, 2), date(2030, 6, 3)]
    assert [day.free_minutes for day in days] == [1440, 1440, 1440]
    assert [day.task_count for day in days] == [0, 0, 0]


def test_booked_minutes_come_off_the_free_ones() -> None:
    days = _service([_Row(date(2030, 6, 1), 90, 2)]).by_day(date(2030, 6, 1), date(2030, 6, 1))

    assert days[0].occupied_minutes == 90
    assert days[0].free_minutes == 1350
    assert days[0].task_count == 2
    assert days[0].over_capacity is False


def test_a_day_that_loses_an_hour_has_fewer_minutes_to_give() -> None:
    """1380, not 1440. Using the constant would hand the planner an hour that never
    existed, and it would do so in the direction that overbooks."""
    days = _service().by_day(A_SHORT_DAY, A_SHORT_DAY)

    assert days[0].total_minutes == 1380
    assert days[0].free_minutes == 1380


def test_a_day_that_gains_an_hour_has_more() -> None:
    days = _service().by_day(A_LONG_DAY, A_LONG_DAY)

    assert days[0].total_minutes == 1500
    assert days[0].free_minutes == 1500


def test_free_minutes_on_a_short_day_account_for_the_missing_hour() -> None:
    booked = _Row(A_SHORT_DAY, 600, 4)

    days = _service([booked]).by_day(A_SHORT_DAY, A_SHORT_DAY)

    assert days[0].free_minutes == 780  # 1380 - 600, and not 840


def test_a_day_booked_past_its_own_length_floors_at_zero_and_says_so() -> None:
    """Rule 3 of ADR-0012 puts every minute on the starting day, so 23:30 plus an hour
    books sixty minutes into a day with thirty left. A negative number would be arithmetic
    the caller has to know about; a flag is the same fact, stated."""
    days = _service([_Row(date(2030, 6, 1), 1500, 3)]).by_day(date(2030, 6, 1), date(2030, 6, 1))

    assert days[0].occupied_minutes == 1500
    assert days[0].free_minutes == 0
    assert days[0].over_capacity is True


def test_a_day_booked_exactly_full_is_not_over_capacity() -> None:
    """The boundary. Full is full; over is over."""
    days = _service([_Row(date(2030, 6, 1), 1440, 1)]).by_day(date(2030, 6, 1), date(2030, 6, 1))

    assert days[0].free_minutes == 0
    assert days[0].over_capacity is False


def test_the_weekday_is_iso_so_monday_is_one() -> None:
    days = _service().by_day(date(2030, 6, 3), date(2030, 6, 9))

    assert [day.weekday for day in days] == [1, 2, 3, 4, 5, 6, 7]


def test_the_query_is_asked_for_a_utc_range_not_for_dates() -> None:
    """The conversion happens once, at the edge (ADR-0009). A query filtering on a derived
    local date could not use the index on ``(user_id, start_at)``."""
    tasks = _FakeTasks()

    CapacityService(tasks, SAO_PAULO).by_day(date(2030, 6, 1), date(2030, 6, 2))  # type: ignore[arg-type]

    assert tasks.asked_for is not None
    assert tasks.asked_for["start"] == datetime(2030, 6, 1, 3, tzinfo=timezone.utc)
    # Half-open: the first instant of the day *after* the last one asked for.
    assert tasks.asked_for["end"] == datetime(2030, 6, 3, 3, tzinfo=timezone.utc)


def test_the_window_follows_the_users_own_zone() -> None:
    """Two users asking for the same date are asking about different instants."""
    in_tokyo = _FakeTasks()

    CapacityService(in_tokyo, "Asia/Tokyo").by_day(date(2030, 6, 1), date(2030, 6, 1))  # type: ignore[arg-type]

    assert in_tokyo.asked_for is not None
    assert in_tokyo.asked_for["start"] == datetime(2030, 5, 31, 15, tzinfo=timezone.utc)


def test_a_window_that_ends_before_it_starts_is_refused() -> None:
    with pytest.raises(InvertedWindowError):
        _service().by_day(date(2030, 6, 2), date(2030, 6, 1))


def test_one_day_is_a_valid_window() -> None:
    assert len(_service().by_day(date(2030, 6, 1), date(2030, 6, 1))) == 1


def test_the_longest_allowed_horizon_is_accepted_and_one_more_is_not() -> None:
    """Asserted on both sides of the boundary, because an off-by-one here is invisible."""
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


def test_the_endpoint_returns_one_object_per_day(app: FastAPI, client: TestClient) -> None:
    _wire(app, _service([_Row(date(2030, 6, 2), 120, 2)]))

    body = client.get(CAPACITY, params={"first_day": "2030-06-01", "last_day": "2030-06-03"}).json()

    assert [day["day"] for day in body] == ["2030-06-01", "2030-06-02", "2030-06-03"]
    assert body[1] == {
        "day": "2030-06-02",
        "weekday": 7,
        "total_minutes": 1440,
        "occupied_minutes": 120,
        "free_minutes": 1320,
        "task_count": 2,
        "over_capacity": False,
    }


def test_no_task_ever_appears_in_the_response(app: FastAPI, client: TestClient) -> None:
    """Capacity is an aggregate, never content (ADR-0004). Asserted on the shape rather
    than trusted to review, because this is the field a future change would add."""
    _wire(app, _service([_Row(date(2030, 6, 1), 60, 1)]))

    body = client.get(CAPACITY, params={"first_day": "2030-06-01", "last_day": "2030-06-01"}).json()

    assert set(body[0]) == {
        "day",
        "weekday",
        "total_minutes",
        "occupied_minutes",
        "free_minutes",
        "task_count",
        "over_capacity",
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


def test_a_day_that_is_not_a_date_answers_422(app: FastAPI, client: TestClient) -> None:
    _wire(app, _service())

    assert client.get(CAPACITY, params={"first_day": "soon", "last_day": "later"}).status_code == (
        422
    )


def test_the_endpoint_needs_a_token(app: FastAPI, client: TestClient) -> None:
    app.dependency_overrides[get_session] = lambda: _NoOpSession()

    response = client.get(CAPACITY, params={"first_day": "2030-06-01", "last_day": "2030-06-01"})

    assert response.status_code == 401
