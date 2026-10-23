"""What the worker deletes every hour, and why each margin is what it is.

- **Tokens** that expired more than seven days ago (ADR-0031). A token past its expiry already
  grants nothing; the week keeps a short trail for investigating something that just happened.
- **Rate-limit windows** that ended more than a day ago (ADR-0031). The counter of an hour that
  has passed limits nothing.
- **A finished job's content** after thirty days: its answers are deleted and its request is
  cleared, and the job keeps only its metadata (ADR-0031, ADR-0036).
- **Discarded and expired drafts** thirty days after they ended, whole (ADR-0037). An approved
  draft stays: its tasks point at it.

Together the last two keep one promise: nothing a person wrote in a request survives thirty
days, unless they approved the plan it produced.
"""

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import ColumnElement, Integer, delete, func, literal_column, update
from sqlalchemy.orm import Session
from sqlalchemy.sql.dml import ReturningDelete

from syncaai.models import (
    AiJob,
    AiJobAnswer,
    Base,
    PasswordResetToken,
    PlanDraft,
    RateLimitCounter,
    RefreshToken,
    VerificationToken,
)
from syncaai.services.rate_limit import WINDOW

TOKEN_GRACE = timedelta(days=7)
RATE_LIMIT_GRACE = timedelta(days=1)
CONTENT_KEPT_FOR = timedelta(days=30)


@dataclass(frozen=True)
class PurgeReport:
    tokens: int
    rate_limit_windows: int
    answers: int
    requests_cleared: int
    drafts: int


def purge(session: Session) -> PurgeReport:
    """Delete everything past its margin, in one transaction the caller commits."""
    now = func.now()
    tokens = sum(
        _deleted(session, model, model.expires_at < now - TOKEN_GRACE)
        for model in (RefreshToken, VerificationToken, PasswordResetToken)
    )
    # A window is named by its start and lasts WINDOW; it ended at start + WINDOW.
    windows = _deleted(
        session,
        RateLimitCounter,
        RateLimitCounter.window_start < now - RATE_LIMIT_GRACE - WINDOW,
    )

    # Answers first, while the request still marks the job as holding content: that is what
    # the partial index covers, and clearing it is the last step.
    holding_content = (
        AiJob.request.is_not(None),
        AiJob.finished_at < now - CONTENT_KEPT_FOR,
    )
    answers = _deleted(session, AiJobAnswer, AiJobAnswer.job_id == AiJob.id, *holding_content)
    cleared = session.execute(
        update(AiJob)
        .where(*holding_content)
        .values(request=None)
        .returning(AiJob.id)
        .execution_options(synchronize_session=False)
    ).all()

    drafts = _deleted(
        session,
        PlanDraft,
        PlanDraft.status.in_(("discarded", "expired")),
        PlanDraft.ended_at < now - CONTENT_KEPT_FOR,
    )
    return PurgeReport(tokens, windows, answers, len(cleared), drafts)


def _deleted(session: Session, model: type[Base], *where: ColumnElement[bool]) -> int:
    """How many rows a delete removed, read from RETURNING rather than a driver row count."""
    statement: ReturningDelete[tuple[int]] = (
        delete(model)
        .where(*where)
        .returning(literal_column("1", Integer))
        .execution_options(synchronize_session=False)
    )
    return len(session.execute(statement).all())
