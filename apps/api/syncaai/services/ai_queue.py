"""The queue the AI layer's jobs wait in (ADR-0031, ADR-0033, ADR-0036).

Three operations, each a single statement the database answers on its own terms:

- **enqueue** inserts a job and knocks on the worker's door, in one transaction;
- **claim** takes the oldest ready job, skipping any another worker holds, and marks it
  running under a lock that expires;
- **sweep** fails what can no longer run: a job queued too long, or one whose last allowed
  attempt died.

The claim and the sweep ask disjoint questions, so neither can take a job the other is about
to. A claimed job is committed at once by the caller, and the provider is called outside any
transaction: a lock never spans a network call.
"""

from datetime import timedelta
from uuid import UUID

from sqlalchemy import and_, case, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from syncaai.errors import PlanInProgressError
from syncaai.models import MAX_JOB_ATTEMPTS, AiJob
from syncaai.planning.context import PROMPT_VERSION

CHANNEL = "ai_jobs"
ONE_IN_PROGRESS = "ux_ai_jobs_one_in_progress"

# How long a claim holds a job before another worker may take it back (ADR-0031). A worker
# that dies leaves its lock to run out, which is the whole of the visibility timeout.
VISIBILITY_TIMEOUT = timedelta(seconds=120)
# A job still waiting after this fails rather than running late against a calendar that has
# moved on: the queue waits out a provider outage, but not for ever (ADR-0006, ADR-0031).
MAX_QUEUED = timedelta(minutes=15)

# Read by the person whose plan it was, next to the manual retry ADR-0005 promises.
WAITED_TOO_LONG = "The plan waited too long to start. Ask for it again."
GAVE_UP = f"The plan could not be made in {MAX_JOB_ATTEMPTS} tries. Ask for it again."


def enqueue_plan(session: Session, user_id: UUID, request: str, *, horizon_days: int) -> AiJob:
    """Queue a plan and wake the worker. The caller commits.

    Inside a savepoint, so a refusal leaves the caller's transaction usable. The notification
    is delivered only when that transaction commits, so the worker cannot wake for a job it
    cannot see yet, and it carries no payload: a knock on the door, never data.
    """
    # The version this job was asked under. The worker records the one it actually builds,
    # should a deploy land between the two.
    job = AiJob(
        user_id=user_id,
        kind="plan",
        request=request,
        horizon_days=horizon_days,
        prompt_version=PROMPT_VERSION,
    )
    try:
        with session.begin_nested():
            session.add(job)
            session.flush()
    except IntegrityError as error:
        diagnostics = getattr(error.orig, "diag", None)
        if getattr(diagnostics, "constraint_name", None) == ONE_IN_PROGRESS:
            raise PlanInProgressError from error
        raise
    session.execute(select(func.pg_notify(CHANNEL, "")))
    return job


def claim_next(session: Session) -> AiJob | None:
    """The oldest ready job, now running under a fresh lock; None when nothing is ready.

    Ready means queued for less than ``MAX_QUEUED``, or running under a lock that has run out
    with an attempt left. ``SKIP LOCKED`` lets several workers claim at once: each passes over
    the rows the others are claiming instead of waiting for them. The caller commits at once.
    """
    now = func.now()
    ready = (
        select(AiJob.id)
        .where(
            or_(
                and_(AiJob.status == "queued", AiJob.created_at > now - MAX_QUEUED),
                and_(
                    AiJob.status == "running",
                    AiJob.locked_until < now,
                    AiJob.attempts < MAX_JOB_ATTEMPTS,
                ),
            )
        )
        .order_by(AiJob.created_at)
        .limit(1)
        .with_for_update(skip_locked=True)
        .scalar_subquery()
    )
    statement = (
        update(AiJob)
        .where(AiJob.id == ready)
        .values(
            status="running",
            attempts=AiJob.attempts + 1,
            locked_until=now + VISIBILITY_TIMEOUT,
        )
        .returning(AiJob)
        .execution_options(synchronize_session=False)
    )
    return session.scalars(statement).one_or_none()


def sweep(session: Session) -> list[UUID]:
    """Fail every job that can no longer run, and return their ids. The caller commits.

    The two conditions are the complements of the claim's, so a job is either ready, or
    failed here, or still in a worker's hands: never two of them at once.
    """
    now = func.now()
    waited_too_long = and_(AiJob.status == "queued", AiJob.created_at <= now - MAX_QUEUED)
    out_of_attempts = and_(
        AiJob.status == "running",
        AiJob.locked_until < now,
        AiJob.attempts >= MAX_JOB_ATTEMPTS,
    )
    statement = (
        update(AiJob)
        .where(or_(waited_too_long, out_of_attempts))
        .values(
            status="failed",
            failure_reason=case((AiJob.status == "queued", WAITED_TOO_LONG), else_=GAVE_UP),
            finished_at=now,
            locked_until=None,
        )
        .returning(AiJob.id)
        .execution_options(synchronize_session=False)
    )
    return list(session.scalars(statement).all())
