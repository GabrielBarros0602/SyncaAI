"""How many requests a response cache would have answered (ADR-0045), against PostgreSQL.

The reading covers the whole table, so each test measures it before and after writing its own
jobs and asserts the difference, whatever else the table holds. Nothing is committed.
"""

import uuid
from collections.abc import Iterator
from datetime import timedelta
from typing import Any

import pytest
from sqlalchemy import func, insert
from sqlalchemy.orm import Session

from syncaai.db import get_session_factory
from syncaai.models import AiJob, User
from syncaai.planning.context import PROMPT_VERSION
from syncaai.services.ai_metrics import WouldBeCacheHits, would_be_cache_hits

pytestmark = pytest.mark.integration

REQUEST = "Plano para aprender JOINs em SQL"
WEEK = "ab" * 32
OTHER_WEEK = "cd" * 32


@pytest.fixture
def session() -> Iterator[Session]:
    with get_session_factory()() as session:
        yield session
        session.rollback()


@pytest.fixture
def people(session: Session) -> list[uuid.UUID]:
    users = [
        User(email=f"metrics-{uuid.uuid4()}@example.com", password_hash="not-a-real-hash")
        for _ in range(2)
    ]
    session.add_all(users)
    session.flush()
    return [user.id for user in users]


def _job(
    session: Session,
    person: uuid.UUID,
    *,
    asked_ago: timedelta,
    took: timedelta = timedelta(minutes=1),
    request: str = REQUEST,
    fingerprint: str | None = WEEK,
    status: str = "done",
    prompt_version: str = PROMPT_VERSION,
) -> None:
    ended = {"done": {"chosen_answer": 0}, "failed": {"failure_reason": "No usable step."}}
    session.execute(
        insert(AiJob).values(
            user_id=person,
            request=request,
            horizon_days=14,
            prompt_version=prompt_version,
            context_fingerprint=fingerprint,
            status=status,
            created_at=func.now() - asked_ago,
            finished_at=func.now() - asked_ago + took,
            **ended[status],
        )
    )


def _measured(session: Session, write: Any) -> WouldBeCacheHits:
    """What writing these jobs added to the reading."""
    before = would_be_cache_hits(session)
    write()
    after = would_be_cache_hits(session)
    return WouldBeCacheHits(jobs=after.jobs - before.jobs, hits=after.hits - before.hits)


def test_the_same_request_against_the_same_week_would_have_been_answered(
    session: Session, people: list[uuid.UUID]
) -> None:
    """Trimmed, spaced and lowercased alike, it is the same request a cache would compare."""

    def write() -> None:
        _job(session, people[0], asked_ago=timedelta(hours=3))
        _job(
            session,
            people[0],
            asked_ago=timedelta(hours=1),
            request="plano para  aprender JOINS em sql",
        )

    assert _measured(session, write) == WouldBeCacheHits(jobs=2, hits=1)


@pytest.mark.parametrize(
    ("earlier", "reason"),
    [
        ({"fingerprint": OTHER_WEEK}, "the week had changed"),
        ({"request": "Plano para aprender índices"}, "another request"),
        ({"status": "failed"}, "the earlier job made no plan"),
        ({"prompt_version": "plan-0"}, "another prompt"),
        ({"asked_ago": timedelta(hours=8)}, "it finished more than six hours before"),
        ({"took": timedelta(hours=3)}, "it had not finished when the later one was asked"),
    ],
)
def test_an_earlier_job_answers_nothing_when(
    session: Session, people: list[uuid.UUID], earlier: dict[str, Any], reason: str
) -> None:
    first = {"asked_ago": timedelta(hours=3), **earlier}

    def write() -> None:
        _job(session, people[0], **first)
        _job(session, people[0], asked_ago=timedelta(hours=1))

    assert _measured(session, write).hits == 0, reason


def test_another_person_s_plan_is_never_counted_as_a_hit(
    session: Session, people: list[uuid.UUID]
) -> None:
    """A cache scoped to its owner (ADR-0016, ADR-0045)."""

    def write() -> None:
        _job(session, people[1], asked_ago=timedelta(hours=3))
        _job(session, people[0], asked_ago=timedelta(hours=1))

    assert _measured(session, write).hits == 0


def test_a_job_without_its_fingerprint_is_not_measured(
    session: Session, people: list[uuid.UUID]
) -> None:
    """Jobs from before the fingerprint was kept, or past the thirty-day purge."""

    def write() -> None:
        _job(session, people[0], asked_ago=timedelta(hours=3), fingerprint=None)

    assert _measured(session, write) == WouldBeCacheHits(jobs=0, hits=0)
