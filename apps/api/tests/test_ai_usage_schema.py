"""The usage table against a real PostgreSQL (ADR-0041).

Each rule the table holds is driven to its refusal by name, written through SQL so no service
stands between the row and the constraint, and the two deletions it outlives are run. Nothing
is committed; each test rolls back.
"""

import uuid
from collections.abc import Iterator
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy import delete, func, insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from syncaai.db import get_session_factory
from syncaai.models import AiJob, AiUsage, User
from syncaai.planning.context import PROMPT_VERSION

pytestmark = pytest.mark.integration


@pytest.fixture
def session() -> Iterator[Session]:
    with get_session_factory()() as session:
        yield session
        session.rollback()


@pytest.fixture
def owner(session: Session) -> uuid.UUID:
    user = User(email=f"usage-{uuid.uuid4()}@example.com", password_hash="not-a-real-hash")
    session.add(user)
    session.flush()
    return user.id


def _job(session: Session, owner: uuid.UUID) -> uuid.UUID:
    job_id = uuid.uuid4()
    session.execute(
        insert(AiJob).values(
            id=job_id,
            user_id=owner,
            request="Plano SQL",
            horizon_days=14,
            prompt_version=PROMPT_VERSION,
            status="done",
            attempts=1,
            finished_at=func.now(),
            chosen_answer=0,
        )
    )
    return job_id


def _usage(session: Session, owner: uuid.UUID, **fields: Any) -> uuid.UUID:
    row = {
        "id": uuid.uuid4(),
        "user_id": owner,
        "attempt": 1,
        "position": 0,
        "provider": "ollama",
        "model": "qwen3.5:4b",
        "prompt_version": PROMPT_VERSION,
        "outcome": "completed",
        "input_tokens": 1165,
        "output_tokens": 800,
        "cost_usd": Decimal(0),
        "latency_ms": 23_400,
        **fields,
    }
    row.setdefault("job_id", _job(session, owner))
    session.execute(insert(AiUsage).values(**row))
    return row["id"]


FAILED = {
    "outcome": "failed",
    "error": "TimeoutError",
    "input_tokens": None,
    "output_tokens": None,
    "cost_usd": None,
}


def test_a_completed_call_and_a_failed_one_are_both_rows(
    session: Session, owner: uuid.UUID
) -> None:
    _usage(session, owner)
    _usage(session, owner, position=1, **FAILED)


@pytest.mark.parametrize(
    ("fields", "constraint"),
    [
        ({"outcome": "timeout"}, "ck_ai_usage_outcome"),
        ({"attempt": 0}, "ck_ai_usage_attempt"),
        ({"attempt": 4}, "ck_ai_usage_attempt"),
        ({"position": 2}, "ck_ai_usage_position"),
        ({"input_tokens": None}, "ck_ai_usage_measured_when_completed"),
        ({"output_tokens": None}, "ck_ai_usage_measured_when_completed"),
        ({"cost_usd": None}, "ck_ai_usage_measured_when_completed"),
        ({**FAILED, "input_tokens": 10}, "ck_ai_usage_no_tokens_when_failed"),
        ({**FAILED, "output_tokens": 10}, "ck_ai_usage_no_tokens_when_failed"),
        ({**FAILED, "error": None}, "ck_ai_usage_error_when_failed"),
        ({"error": "TimeoutError"}, "ck_ai_usage_error_when_failed"),
        ({"input_tokens": -1}, "ck_ai_usage_not_negative"),
        ({"cost_usd": Decimal("-0.00000001")}, "ck_ai_usage_not_negative"),
        ({"latency_ms": -1}, "ck_ai_usage_not_negative"),
    ],
)
def test_a_call_that_contradicts_its_outcome_is_refused(
    session: Session, owner: uuid.UUID, fields: dict[str, Any], constraint: str
) -> None:
    with pytest.raises(IntegrityError, match=constraint), session.begin_nested():
        _usage(session, owner, **fields)


def test_a_cost_keeps_eight_decimals(session: Session, owner: uuid.UUID) -> None:
    usage = _usage(session, owner, cost_usd=Decimal("0.00051650"))

    assert session.get_one(AiUsage, usage).cost_usd == Decimal("0.00051650")


def test_deleting_the_account_keeps_its_spend_and_forgets_whose_it_was(
    session: Session, owner: uuid.UUID
) -> None:
    """Deleting jobs with their owner would take the month's spend out of the ceilings,
    and the global one would open again (ADR-0041)."""
    usage = _usage(session, owner, cost_usd=Decimal("0.0005165"))

    session.execute(delete(User).where(User.id == owner))
    session.expire_all()

    row = session.get_one(AiUsage, usage)
    assert (row.user_id, row.job_id) == (None, None)
    assert row.cost_usd == Decimal("0.0005165")


def test_deleting_a_job_keeps_its_calls(session: Session, owner: uuid.UUID) -> None:
    job_id = _job(session, owner)
    usage = _usage(session, owner, job_id=job_id)

    session.execute(delete(AiJob).where(AiJob.id == job_id))
    session.expire_all()

    assert session.get_one(AiUsage, usage).job_id is None
