"""Tests for bounding attempts per caller.

The endpoint tests substitute the limiter, so what is asserted there is the shape of the
refusal: the status, the body and the header a client needs to behave. The counting itself
is a database concern and is tested against a real one.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from syncaai.api.dependencies import limit_login, limit_registration
from syncaai.db import get_session_factory
from syncaai.errors import RateLimitExceededError
from syncaai.services.rate_limit import WINDOW, RateLimiter

LOGIN = "/api/v1/auth/login"
REGISTER = "/api/v1/auth/register"
A_MOMENT = datetime(2030, 6, 1, 10, 30, tzinfo=timezone.utc)


def _refuse() -> None:
    raise RateLimitExceededError(90)


def test_a_limited_login_answers_429_with_retry_after(app: FastAPI, client: TestClient) -> None:
    app.dependency_overrides[limit_login] = _refuse

    response = client.post(LOGIN, json={"email": "someone@example.com", "password": "whatever1"})

    assert response.status_code == 429
    assert response.headers["Retry-After"] == "90"


def test_a_limited_registration_answers_429(app: FastAPI, client: TestClient) -> None:
    app.dependency_overrides[limit_registration] = _refuse

    response = client.post(
        REGISTER, json={"email": "someone@example.com", "password": "a decent password"}
    )

    assert response.status_code == 429


def test_the_refusal_says_nothing_about_the_credentials(app: FastAPI, client: TestClient) -> None:
    """A caller over the limit learns nothing about whether the account or password was right."""
    app.dependency_overrides[limit_login] = _refuse

    known = client.post(LOGIN, json={"email": "someone@example.com", "password": "whatever1"})
    unknown = client.post(LOGIN, json={"email": "nobody@example.com", "password": "whatever1"})

    assert known.json() == unknown.json()


def _a_bucket() -> str:
    return f"probe:{uuid.uuid4()}"


@pytest.mark.integration
def test_attempts_are_allowed_up_to_the_limit() -> None:
    with get_session_factory()() as session:
        limiter, bucket = RateLimiter(session), _a_bucket()

        for _ in range(3):
            limiter.check(bucket, limit=3, now=A_MOMENT)


@pytest.mark.integration
def test_the_attempt_after_the_limit_is_refused() -> None:
    with get_session_factory()() as session:
        limiter, bucket = RateLimiter(session), _a_bucket()
        for _ in range(3):
            limiter.check(bucket, limit=3, now=A_MOMENT)

        with pytest.raises(RateLimitExceededError):
            limiter.check(bucket, limit=3, now=A_MOMENT)


@pytest.mark.integration
def test_the_refusal_says_when_to_come_back() -> None:
    with get_session_factory()() as session:
        limiter, bucket = RateLimiter(session), _a_bucket()
        limiter.check(bucket, limit=1, now=A_MOMENT)

        with pytest.raises(RateLimitExceededError) as refusal:
            limiter.check(bucket, limit=1, now=A_MOMENT)

        # A_MOMENT is half past the hour, so the window ends in thirty minutes.
        assert refusal.value.retry_after_seconds == 30 * 60


@pytest.mark.integration
def test_buckets_do_not_share_an_allowance() -> None:
    """One caller exhausting its allowance must not lock out everybody else."""
    with get_session_factory()() as session:
        limiter = RateLimiter(session)
        exhausted, other = _a_bucket(), _a_bucket()
        limiter.check(exhausted, limit=1, now=A_MOMENT)

        limiter.check(other, limit=1, now=A_MOMENT)

        with pytest.raises(RateLimitExceededError):
            limiter.check(exhausted, limit=1, now=A_MOMENT)


@pytest.mark.integration
def test_the_next_window_starts_a_new_allowance() -> None:
    with get_session_factory()() as session:
        limiter, bucket = RateLimiter(session), _a_bucket()
        limiter.check(bucket, limit=1, now=A_MOMENT)

        limiter.check(bucket, limit=1, now=A_MOMENT + WINDOW)


@pytest.mark.integration
def test_a_refused_attempt_still_counts() -> None:
    """Otherwise a caller over the limit could keep knocking for free."""
    with get_session_factory()() as session:
        limiter, bucket = RateLimiter(session), _a_bucket()
        limiter.check(bucket, limit=1, now=A_MOMENT)
        for _ in range(3):
            with pytest.raises(RateLimitExceededError):
                limiter.check(bucket, limit=1, now=A_MOMENT)

        later = A_MOMENT + timedelta(minutes=1)
        with pytest.raises(RateLimitExceededError):
            limiter.check(bucket, limit=4, now=later)
