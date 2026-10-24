"""The hourly purge against a real PostgreSQL (ADR-0031, ADR-0036, ADR-0037).

Every margin is tested at both sides: a row one second past it goes, a row a minute short of it
stays. The purge acts on the whole database, so each test runs in a transaction that is rolled
back, and a first pass clears whatever the development database already held before the rows
under test are written. Its counts are then exactly theirs.
"""

import secrets
import uuid
from collections.abc import Iterator
from datetime import date, timedelta
from typing import Any

import pytest
from sqlalchemy import ColumnElement, func, insert, select
from sqlalchemy.orm import Session

from syncaai.db import get_session_factory
from syncaai.models import (
    AiJob,
    AiJobAnswer,
    PasswordResetToken,
    PlanDraft,
    PlanDraftItem,
    RateLimitCounter,
    RefreshToken,
    User,
    VerificationToken,
)
from syncaai.planning.context import PROMPT_VERSION
from syncaai.services.purge import (
    CONTENT_KEPT_FOR,
    RATE_LIMIT_GRACE,
    TOKEN_GRACE,
    purge,
)
from syncaai.services.rate_limit import WINDOW

pytestmark = pytest.mark.integration

PAST = timedelta(seconds=1)
SHORT = timedelta(minutes=1)
SECRET_REQUEST = "Plano para a entrevista na Empresa X"


@pytest.fixture
def session() -> Iterator[Session]:
    with get_session_factory()() as session:
        purge(session)
        yield session
        session.rollback()


@pytest.fixture
def owner(session: Session) -> uuid.UUID:
    user = User(email=f"purge-{uuid.uuid4()}@example.com", password_hash="not-a-real-hash")
    session.add(user)
    session.flush()
    return user.id


def _ago(delta: timedelta) -> ColumnElement[Any]:
    return func.now() - delta


def _exists(session: Session, model: Any, row_id: uuid.UUID) -> bool:
    return session.scalar(select(func.count()).select_from(model).where(model.id == row_id)) == 1


# --- Tokens and rate limits ----------------------------------------------------------------


@pytest.mark.parametrize("model", [RefreshToken, VerificationToken, PasswordResetToken])
def test_a_token_goes_a_week_after_it_expired_and_not_before(
    session: Session, owner: uuid.UUID, model: Any
) -> None:
    gone, kept = uuid.uuid4(), uuid.uuid4()
    for token_id, expired in ((gone, TOKEN_GRACE + PAST), (kept, TOKEN_GRACE - SHORT)):
        session.execute(
            insert(model).values(
                id=token_id,
                user_id=owner,
                token_hash=secrets.token_hex(32),
                expires_at=_ago(expired),
            )
        )

    report = purge(session)

    assert report.tokens == 1
    assert not _exists(session, model, gone)
    assert _exists(session, model, kept)


def test_a_rate_limit_window_goes_a_day_after_it_ended(session: Session) -> None:
    """A window is named by its start and ends an hour later: the margin counts from its end."""
    gone, kept = uuid.uuid4(), uuid.uuid4()
    for counter_id, started in (
        (gone, RATE_LIMIT_GRACE + WINDOW + PAST),
        (kept, RATE_LIMIT_GRACE + WINDOW - SHORT),
    ):
        session.execute(
            insert(RateLimitCounter).values(
                id=counter_id,
                bucket=f"purge-test-{counter_id}",
                window_start=_ago(started),
                hits=1,
            )
        )

    report = purge(session)

    assert report.rate_limit_windows == 1
    assert not _exists(session, RateLimitCounter, gone)
    assert _exists(session, RateLimitCounter, kept)


# --- A job's content -----------------------------------------------------------------------


def _job(session: Session, owner: uuid.UUID, finished: timedelta, answers: int = 1) -> uuid.UUID:
    job_id = uuid.uuid4()
    session.execute(
        insert(AiJob).values(
            id=job_id,
            user_id=owner,
            request=SECRET_REQUEST,
            horizon_days=14,
            prompt_version=PROMPT_VERSION,
            context_fingerprint="ab" * 32,
            status="done",
            finished_at=_ago(finished),
            chosen_answer=answers - 1,
        )
    )
    for position in range(answers):
        session.execute(
            insert(AiJobAnswer).values(
                job_id=job_id,
                position=position,
                raw=f'{{"note": "{SECRET_REQUEST}"}}',
                model="fake",
            )
        )
    return job_id


def test_thirty_days_after_a_job_finished_its_content_goes_and_its_metadata_stays(
    session: Session, owner: uuid.UUID
) -> None:
    old = _job(session, owner, CONTENT_KEPT_FOR + PAST, answers=2)
    recent = _job(session, owner, CONTENT_KEPT_FOR - SHORT)

    report = purge(session)

    assert (report.answers, report.requests_cleared) == (2, 1)
    job = session.get_one(AiJob, old)
    session.refresh(job)
    assert (job.request, job.context_fingerprint) == (None, None)
    assert (job.status, job.chosen_answer, job.prompt_version) == ("done", 1, PROMPT_VERSION)
    assert (
        session.scalar(
            select(func.count()).select_from(AiJobAnswer).where(AiJobAnswer.job_id == old)
        )
        == 0
    )
    kept = session.get_one(AiJob, recent)
    session.refresh(kept)
    assert (kept.request, kept.context_fingerprint) == (SECRET_REQUEST, "ab" * 32)
    assert (
        session.scalar(
            select(func.count()).select_from(AiJobAnswer).where(AiJobAnswer.job_id == recent)
        )
        == 1
    )


def test_an_unfinished_job_keeps_its_request_whatever_its_age(
    session: Session, owner: uuid.UUID
) -> None:
    job_id = uuid.uuid4()
    session.execute(
        insert(AiJob).values(
            id=job_id,
            user_id=owner,
            request=SECRET_REQUEST,
            horizon_days=14,
            prompt_version=PROMPT_VERSION,
            created_at=_ago(CONTENT_KEPT_FOR * 2),
        )
    )

    assert purge(session).requests_cleared == 0
    assert session.scalar(select(AiJob.request).where(AiJob.id == job_id)) == SECRET_REQUEST


# --- Drafts --------------------------------------------------------------------------------


def _draft(session: Session, owner: uuid.UUID, status: str, ended: timedelta | None) -> uuid.UUID:
    # Its job finished when the draft was made, never after the draft ended.
    job_id = _job(session, owner, ended or timedelta(0))
    draft_id = uuid.uuid4()
    session.execute(
        insert(PlanDraft).values(
            id=draft_id,
            user_id=owner,
            job_id=job_id,
            request=SECRET_REQUEST,
            prompt_version=PROMPT_VERSION,
            first_day=date(2031, 6, 2),
            last_day=date(2031, 6, 15),
            status=status,
            ended_at=None if ended is None else _ago(ended),
            idempotency_key="k" if status == "approved" else None,
        )
    )
    session.execute(
        insert(PlanDraftItem).values(
            id=uuid.uuid4(),
            draft_id=draft_id,
            position=0,
            title="Pesquisar salários da Empresa X",
            minutes=45,
            placement="no_room",
        )
    )
    return draft_id


@pytest.mark.parametrize("status", ["discarded", "expired"])
def test_an_unapproved_draft_goes_whole_thirty_days_after_it_ended(
    session: Session, owner: uuid.UUID, status: str
) -> None:
    gone = _draft(session, owner, status, CONTENT_KEPT_FOR + PAST)
    kept = _draft(session, owner, status, CONTENT_KEPT_FOR - SHORT)

    report = purge(session)

    assert report.drafts == 1
    assert not _exists(session, PlanDraft, gone)
    assert (
        session.scalar(
            select(func.count()).select_from(PlanDraftItem).where(PlanDraftItem.draft_id == gone)
        )
        == 0
    )
    assert _exists(session, PlanDraft, kept)


def test_an_approved_or_pending_draft_is_never_purged(session: Session, owner: uuid.UUID) -> None:
    approved = _draft(session, owner, "approved", CONTENT_KEPT_FOR * 3)
    pending = _draft(session, owner, "pending", None)

    assert purge(session).drafts == 0
    assert _exists(session, PlanDraft, approved)
    assert _exists(session, PlanDraft, pending)


def test_nothing_a_person_wrote_survives_thirty_days_unless_they_approved_it(
    session: Session, owner: uuid.UUID
) -> None:
    """The promise the two content margins keep together: the request is searched for in
    every place it was ever written."""
    _job(session, owner, CONTENT_KEPT_FOR + PAST, answers=2)
    _draft(session, owner, "discarded", CONTENT_KEPT_FOR + PAST)

    purge(session)

    pattern = f"%{SECRET_REQUEST}%"
    for column, owned in (
        (AiJob.request, AiJob.user_id == owner),
        (PlanDraft.request, PlanDraft.user_id == owner),
        (AiJobAnswer.raw, AiJobAnswer.job_id.in_(select(AiJob.id).where(AiJob.user_id == owner))),
    ):
        statement = select(func.count()).where(column.like(pattern), owned)
        assert session.scalar(statement) == 0, column
