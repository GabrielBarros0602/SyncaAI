"""The circuit breaker against a real PostgreSQL (ADR-0006, ADR-0046).

Its state is a reading of the provider's latest calls in ``ai_usage``, so each test writes the
calls it needs, aged as it needs them, under a provider no other test uses. Only the requests
and the worker's ticks are real. Everything committed is deleted afterwards.
"""

import json
import uuid
from collections.abc import Iterator
from datetime import timedelta
from decimal import Decimal
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, insert, select

from syncaai.api.dependencies import get_current_user_id
from syncaai.config import Settings, get_settings
from syncaai.db import get_session_factory
from syncaai.errors import ProviderUnavailableError
from syncaai.models import AiJob, AiUsage, User
from syncaai.planning.context import PROMPT_VERSION, PlanPrompt
from syncaai.planning.generator import FakeGenerator, Generation, Repair
from syncaai.services.ai_breaker import COOL_DOWN, refuse_while_open, seconds_until_probe
from syncaai.services.ai_queue import enqueue_plan
from syncaai.worker import Worker, listen_url

pytestmark = pytest.mark.integration

PLANS = "/api/v1/ai/plans"
REQUEST = "Plano para aprender JOINs em SQL"
# A provider and a model no other test writes calls for, so the latest calls are these.
PROVIDER = "breaker-test"
MODEL = "breaker-test-model"
PLAN = json.dumps(
    {
        "items": [
            {
                "title": "Ler o capítulo de JOINs",
                "description": "",
                "estimated_minutes": 45,
                "depends_on": [],
                "links": [],
            }
        ]
    }
)


@pytest.fixture
def people() -> Iterator[list[uuid.UUID]]:
    with get_session_factory()() as session:
        users = [
            User(email=f"breaker-{uuid.uuid4()}@example.com", password_hash="not-a-real-hash")
            for _ in range(4)
        ]
        session.add_all(users)
        session.commit()
        ids = [user.id for user in users]
    try:
        yield ids
    finally:
        with get_session_factory()() as session:
            session.execute(delete(AiUsage).where(AiUsage.model == MODEL))
            session.execute(delete(User).where(User.id.in_(ids)))
            session.commit()


def _calls(*seconds_ago: float, outcome: str = "failed", provider: str = PROVIDER) -> None:
    """Calls the provider made, that many seconds ago."""
    measured: dict[str, Any] = (
        {"error": "ConnectionRefusedError", "cost_usd": Decimal(0)}
        if outcome == "failed"
        else {"input_tokens": 1000, "output_tokens": 500, "cost_usd": Decimal(0)}
    )
    with get_session_factory()() as session:
        for seconds in seconds_ago:
            session.execute(
                insert(AiUsage).values(
                    attempt=1,
                    position=0,
                    provider=provider,
                    model=MODEL,
                    prompt_version=PROMPT_VERSION,
                    outcome=outcome,
                    latency_ms=5,
                    created_at=func.now() - timedelta(seconds=seconds),
                    **measured,
                )
            )
        session.commit()


def _wait(provider: str = PROVIDER) -> float | None:
    with get_session_factory()() as session:
        return seconds_until_probe(session, provider)


# --- The reading ---------------------------------------------------------------------------


def test_three_failures_in_a_row_open_it_until_a_minute_after_the_last(
    people: list[uuid.UUID],
) -> None:
    _calls(30, 20, 10)

    wait = _wait()

    assert wait is not None
    assert abs(wait - (COOL_DOWN.total_seconds() - 10)) <= 2


def test_two_failures_leave_it_closed(people: list[uuid.UUID]) -> None:
    _calls(20, 10)

    assert _wait() is None


def test_a_call_that_completed_among_the_latest_three_leaves_it_closed(
    people: list[uuid.UUID],
) -> None:
    _calls(40, 30, 10)
    _calls(20, outcome="completed")

    assert _wait() is None


def test_failures_older_than_a_success_are_forgotten(people: list[uuid.UUID]) -> None:
    _calls(50, 40, 30)
    _calls(20, outcome="completed")
    _calls(10, 5)

    assert _wait() is None


def test_a_minute_after_the_last_failure_it_lets_a_probe_through(
    people: list[uuid.UUID],
) -> None:
    _calls(90, 80, 70)

    assert _wait() is None


def test_a_probe_that_fails_opens_it_for_another_minute(people: list[uuid.UUID]) -> None:
    _calls(90, 80, 70)
    _calls(1)

    wait = _wait()

    assert wait is not None and wait > COOL_DOWN.total_seconds() - 3


def test_another_provider_s_failures_are_not_this_one_s(people: list[uuid.UUID]) -> None:
    _calls(30, 20, 10, provider="breaker-test-other")

    assert _wait() is None


def test_while_open_it_refuses_with_the_wait(people: list[uuid.UUID]) -> None:
    _calls(30, 20, 10)

    with get_session_factory()() as session, pytest.raises(ProviderUnavailableError) as raised:
        refuse_while_open(session, PROVIDER)

    assert abs(raised.value.retry_after_seconds - 50) <= 2


# --- A request -----------------------------------------------------------------------------


@pytest.fixture
def ollama(settings: Settings) -> Settings:
    """The API's provider, as the setting names it."""
    settings.ai_provider = "ollama"
    settings.ollama_model = "qwen3.5:4b"
    return settings


def _ask(app: FastAPI, client: TestClient, person: uuid.UUID) -> Any:
    app.dependency_overrides[get_current_user_id] = lambda: person
    return client.post(PLANS, json={"request": REQUEST})


def test_a_request_while_the_model_is_down_is_refused_with_503(
    app: FastAPI, client: TestClient, ollama: Settings, people: list[uuid.UUID]
) -> None:
    _calls(30, 20, 10, provider="ollama")

    response = _ask(app, client, people[0])

    assert response.status_code == 503
    assert response.json() == {"detail": ProviderUnavailableError.sentence}
    assert abs(int(response.headers["Retry-After"]) - 50) <= 2
    with get_session_factory()() as session:
        jobs = select(func.count()).select_from(AiJob).where(AiJob.user_id == people[0])
        assert session.scalar(jobs) == 0


def test_a_request_once_the_probe_is_due_is_queued(
    app: FastAPI, client: TestClient, ollama: Settings, people: list[uuid.UUID]
) -> None:
    _calls(90, 80, 70, provider="ollama")

    assert _ask(app, client, people[0]).status_code == 202


def test_a_spent_month_is_answered_before_the_model_being_down(
    app: FastAPI, client: TestClient, ollama: Settings, people: list[uuid.UUID]
) -> None:
    """The refusal that stays true longer first (ADR-0046)."""
    _calls(30, 20, 10, provider="ollama")
    with get_session_factory()() as session:
        session.execute(
            insert(AiUsage).values(
                user_id=people[0],
                attempt=1,
                position=0,
                provider="anthropic",
                model=MODEL,
                prompt_version=PROMPT_VERSION,
                outcome="completed",
                input_tokens=1000,
                output_tokens=1000,
                cost_usd=Decimal("0.50"),
                latency_ms=5,
            )
        )
        session.commit()

    assert _ask(app, client, people[0]).status_code == 429


# --- The worker ----------------------------------------------------------------------------


class _Model(FakeGenerator):
    """The free test double, answering from a script or down. Free, because a call has to be
    estimated before it is admitted, and an unpriced paid model is refused (ADR-0044)."""

    model = MODEL

    def __init__(self, answers: list[str], *, down: bool = False) -> None:
        super().__init__(answers)
        self._down = down

    def generate(self, prompt: PlanPrompt, *, repair: Repair | None = None) -> Generation:
        if self._down:
            self.calls.append((prompt, repair))
            raise ConnectionRefusedError("nothing is listening")
        return super().generate(prompt, repair=repair)


def _worker(model: _Model) -> Worker:
    return Worker(get_session_factory(), model, listen_url=listen_url(get_settings().database_url))


def _queued(person: uuid.UUID) -> uuid.UUID:
    with get_session_factory()() as session:
        job = enqueue_plan(session, person, REQUEST, horizon_days=7)
        session.commit()
        return job.id


def _state(job_id: uuid.UUID) -> tuple[str, int]:
    with get_session_factory()() as session:
        job = session.get_one(AiJob, job_id)
        return job.status, job.attempts


def test_while_open_the_worker_claims_nothing_and_the_job_waits(
    people: list[uuid.UUID],
) -> None:
    _calls(30, 20, 10, provider="fake")
    job_id = _queued(people[0])
    model = _Model([PLAN])

    assert _worker(model).tick() == 0

    assert _state(job_id) == ("queued", 0)
    assert model.calls == []


def test_once_the_probe_is_due_the_worker_runs_a_job_and_a_success_closes_it(
    people: list[uuid.UUID],
) -> None:
    _calls(90, 80, 70, provider="fake")
    job_id = _queued(people[0])

    assert _worker(_Model([PLAN])).tick() == 1

    assert _state(job_id) == ("done", 1)
    assert _wait("fake") is None


def test_a_model_that_fails_three_times_stops_the_worker_claiming(
    people: list[uuid.UUID],
) -> None:
    """With the model down, the worker finds out in three calls rather than on every job."""
    jobs = [_queued(person) for person in people]
    model = _Model([], down=True)

    assert _worker(model).tick() == 3

    assert len(model.calls) == 3
    assert sorted(_state(job)[0] for job in jobs) == ["queued", "running", "running", "running"]
    assert _wait("fake") is not None
