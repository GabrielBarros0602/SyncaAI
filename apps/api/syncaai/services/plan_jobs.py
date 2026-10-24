"""Running one plan job, from its request to a draft (ADR-0003, ADR-0031, ADR-0035 to ADR-0037).

Three phases, and only the middle one talks to a model:

1. **read**: the job, its owner, and the prompt built from their calendar. Nothing is
   written, and the transaction ends before the call.
2. **ask**: the ladder, at most two calls, outside any transaction. A lock never spans a
   network call (ADR-0031). Each call is admitted first, only while the month stays under
   the spend ceilings with its estimate, and a refusal fails the job (ADR-0044). Each call's
   usage is committed on its own as the call ends, so it is counted whatever happens to this
   attempt afterwards (ADR-0041).
3. **write**: in one transaction, the answers and either the draft or the failure. The
   calendar is read again, because it may have changed while the model was answering, and
   the steps are placed against what is there now.

The write happens only while the job is still this worker's. The attempt counted at the claim
is the fence: a worker that outlived its lock finds the count moved on, because another worker
claimed the job again, and writes nothing.
"""

import uuid
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from enum import StrEnum
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from syncaai.errors import CeilingReachedError
from syncaai.models import (
    AiJob,
    AiJobAnswer,
    PlanDraft,
    PlanDraftDiscard,
    PlanDraftItem,
    PlanDraftItemLink,
    PlanDraftItemPrerequisite,
    User,
)
from syncaai.planning.context import PlanPrompt
from syncaai.planning.estimate import estimate_cost
from syncaai.planning.generator import PlanGenerator, Repair
from syncaai.planning.ladder import LadderResult, run_ladder
from syncaai.planning.metering import MeteredGenerator
from syncaai.planning.scheduler import Step, schedule_this_week, week_end
from syncaai.planning.validation import PlanReport
from syncaai.services.ai_spend import DEFAULT_CEILINGS, Ceilings, refuse_past_the_ceilings
from syncaai.services.ai_usage import usage_recorder
from syncaai.services.plan_context import plan_prompt_for, plannable_days

ONE_PENDING_DRAFT = "ux_plan_drafts_one_pending"
PLACED = "placed"

# Read by the person whose plan it was. The race it answers is narrow: a draft left pending
# while this job waited, which the request itself is refused for (ADR-0033).
PLAN_IN_PROGRESS = "Review or discard the plan you have first."


class Outcome(StrEnum):
    DONE = "done"
    FAILED = "failed"
    #: Another worker holds the job now; this one wrote nothing.
    LOST = "lost"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def run_plan_job(
    factory: sessionmaker[Session],
    generator: PlanGenerator,
    job_id: uuid.UUID,
    *,
    attempt: int,
    clock: Callable[[], datetime] = _utc_now,
    ceilings: Ceilings = DEFAULT_CEILINGS,
) -> Outcome:
    """Run the job claimed as ``attempt``, and say how it ended."""
    with factory() as session:
        job = session.get(AiJob, job_id)
        if job is None or not _still_mine(job, attempt):
            return Outcome.LOST
        user = session.get_one(User, job.user_id)
        assert job.request is not None, "an unfinished job always keeps its request"
        prompt = plan_prompt_for(
            session, user, job.request, horizon_days=job.horizon_days, now=clock()
        )
        block = user.preferred_block_minutes

    def admit(prompt: PlanPrompt, repair: Repair | None) -> Decimal:
        """The call's estimate, if the month stays under both ceilings with it (ADR-0044)."""
        estimate = estimate_cost(generator.provider, generator.model, prompt, repair)
        with factory() as session:
            refuse_past_the_ceilings(session, user.id, ceilings, adding=estimate)
        return estimate

    record = usage_recorder(
        factory,
        user_id=user.id,
        job_id=job_id,
        attempt=attempt,
        provider=generator.provider,
        prompt_version=prompt.version,
    )
    metered = MeteredGenerator(generator, record, admit=admit)
    try:
        result = run_ladder(metered, prompt, max_item_minutes=block)
    except CeilingReachedError as refusal:
        # Failed rather than left to its lock: another attempt would meet the same ceiling.
        return _refused(factory, job_id, attempt, refusal.sentence)

    with factory() as session, session.begin():
        job = _locked_if_mine(session, job_id, attempt)
        if job is None:
            return Outcome.LOST
        _keep_answers(session, job, result)
        # The version actually built, should a deploy have landed since the job was queued.
        job.prompt_version = prompt.version
        if result.report is None:
            _finish(job, failure=result.failure)
            return Outcome.FAILED
        assert result.chosen is not None
        try:
            with session.begin_nested():
                _write_draft(session, job, result.report, prompt, now=clock())
        except IntegrityError as error:
            diagnostics = getattr(error.orig, "diag", None)
            if getattr(diagnostics, "constraint_name", None) == ONE_PENDING_DRAFT:
                _finish(job, failure=PLAN_IN_PROGRESS)
                return Outcome.FAILED
            raise
        _finish(job, chosen=result.chosen)
        return Outcome.DONE


def _still_mine(job: AiJob, attempt: int) -> bool:
    return job.status == "running" and job.attempts == attempt


def _locked_if_mine(session: Session, job_id: uuid.UUID, attempt: int) -> AiJob | None:
    """The job, locked for the write, while this attempt still holds it."""
    locked = select(AiJob).where(AiJob.id == job_id).with_for_update()
    job = session.scalars(locked).one_or_none()
    return job if job is not None and _still_mine(job, attempt) else None


def _refused(
    factory: sessionmaker[Session], job_id: uuid.UUID, attempt: int, reason: str
) -> Outcome:
    """A job a ceiling stopped. Answers made before the refusal are not kept: the ladder did
    not finish, and their usage is already recorded (ADR-0044)."""
    with factory() as session, session.begin():
        job = _locked_if_mine(session, job_id, attempt)
        if job is None:
            return Outcome.LOST
        _finish(job, failure=reason)
        return Outcome.FAILED


def _keep_answers(session: Session, job: AiJob, result: LadderResult) -> None:
    """Every answer, the one used and the one not, with its errors (ADR-0035, ADR-0036)."""
    for position, attempt in enumerate(result.attempts):
        session.add(
            AiJobAnswer(
                job_id=job.id,
                position=position,
                raw=attempt.generation.raw,
                errors=list(attempt.errors),
                model=attempt.generation.model,
            )
        )


def _finish(job: AiJob, *, chosen: int | None = None, failure: str | None = None) -> None:
    job.status = "failed" if failure else "done"
    job.failure_reason = failure
    job.chosen_answer = chosen
    job.locked_until = None
    # The database's clock, the one the thirty-day purge will compare against.
    job.finished_at = func.now()


def _write_draft(
    session: Session, job: AiJob, report: PlanReport, prompt: PlanPrompt, *, now: datetime
) -> None:
    user = session.get_one(User, job.user_id)
    today = now.astimezone(ZoneInfo(user.timezone)).date()
    assert job.request is not None
    draft = PlanDraft(
        id=uuid.uuid4(),
        user_id=user.id,
        job_id=job.id,
        request=job.request,
        prompt_version=prompt.version,
        first_day=today,
        last_day=today + timedelta(days=job.horizon_days - 1),
    )
    session.add(draft)
    session.flush()

    days = plannable_days(session, user, horizon_days=job.horizon_days, now=now)
    steps = [Step(item.position, item.minutes, item.depends_on) for item in report.kept]
    placements = {
        placement.key: placement
        for placement in schedule_this_week(steps, days, now=now, week_ends=week_end(today))
    }

    ids = {item.position: uuid.uuid4() for item in report.kept}
    for item in report.kept:
        placement = placements[item.position]
        session.add(
            PlanDraftItem(
                id=ids[item.position],
                draft_id=draft.id,
                position=item.position,
                title=item.title,
                description=item.description,
                minutes=item.minutes,
                start_at=placement.start,
                placement=placement.unplaced.value if placement.unplaced else PLACED,
                links=[
                    PlanDraftItemLink(position=n, label=label, url=url)
                    for n, (label, url) in enumerate(item.links)
                ],
            )
        )
    session.flush()
    for item in report.kept:
        for prerequisite in item.depends_on:
            session.add(
                PlanDraftItemPrerequisite(
                    draft_id=draft.id,
                    item_id=ids[item.position],
                    prerequisite_id=ids[prerequisite],
                )
            )
    for discarded in report.discarded:
        session.add(
            PlanDraftDiscard(
                draft_id=draft.id,
                position=discarded.position,
                title=discarded.title,
                reasons=list(discarded.reasons),
            )
        )
    session.flush()
