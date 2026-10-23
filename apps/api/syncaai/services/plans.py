"""Asking for a plan and reading what came of it (ADR-0033, ADR-0038)."""

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from syncaai.errors import (
    PlanInProgressError,
    PlanItemNotFoundError,
    PlanJobNotFoundError,
    PlanNotFoundError,
    PlanNotPendingError,
    StepOverlapsStepError,
    StepOverlapsTaskError,
    StepStartsInThePastError,
)
from syncaai.models import AiJob, PlanDraft, PlanDraftItem
from syncaai.planning.scheduler import week_end
from syncaai.repositories.plans import AiJobRepository, PlanDraftRepository
from syncaai.repositories.tasks import TaskRepository
from syncaai.schemas.plans import (
    ItemState,
    JobRead,
    PlanDiscardRead,
    PlanItemRead,
    PlanItemUpdate,
    PlanLinkRead,
    PlanRead,
)
from syncaai.services.ai_queue import enqueue_plan
from syncaai.services.plan_jobs import PLACED


class PlanService:
    def __init__(self, session: Session, user_id: uuid.UUID) -> None:
        self._session = session
        self._jobs = AiJobRepository(session, user_id)
        self._drafts = PlanDraftRepository(session, user_id)

    def request(self, request: str, *, horizon_days: int) -> AiJob:
        """Queue a plan, or refuse while another is still being made or reviewed.

        Checked here so the answer is a sentence, and held by the partial unique index on jobs
        either way: a double submit loses the race there (ADR-0033). A draft left pending in
        the same race is caught when the job writes its own, and the job fails with the same
        sentence.
        """
        if self._jobs.any_in_progress() or self._drafts.any_pending():
            raise PlanInProgressError
        return enqueue_plan(self._session, self._jobs.owner_id, request, horizon_days=horizon_days)

    def job(self, job_id: uuid.UUID) -> JobRead:
        job = self._jobs.get(job_id)
        if job is None:
            raise PlanJobNotFoundError
        draft = self._drafts.for_job(job.id)
        return JobRead(
            job_id=job.id,
            status=job.status,
            failure_reason=job.failure_reason,
            plan_id=draft.id if draft else None,
        )

    def plan(self, plan_id: uuid.UUID, *, now: datetime) -> PlanRead:
        draft = self._drafts.get_for_review(plan_id)
        if draft is None:
            raise PlanNotFoundError
        prerequisites = self._drafts.prerequisites(draft.id)
        return PlanRead(
            id=draft.id,
            status=draft.status,
            request=draft.request,
            first_day=draft.first_day,
            last_day=draft.last_day,
            week_ends_on=week_end(draft.first_day),
            items=[_item(item, prerequisites.get(item.id, []), draft, now) for item in draft.items],
            discarded=[
                PlanDiscardRead(position=d.position, title=d.title, reasons=d.reasons)
                for d in draft.discards
            ],
        )

    def update_item(
        self, plan_id: uuid.UUID, item_id: uuid.UUID, changes: PlanItemUpdate, *, now: datetime
    ) -> PlanItemRead:
        """Rename, resize or move one step, checked as a task's change would be (ADR-0030).

        A new start must lie ahead and its range must be free of every task and every other
        step of the plan. A new length re-checks the range of a step that has a start, since
        its end moves. The order the dependencies set is not imposed: a person reordering by
        hand is deciding, and ADR-0030 checks a step only against the rules of a task.
        """
        draft = self._pending(plan_id)
        item = _step_of(draft, item_id)
        if changes.start_at is not None and changes.start_at <= now:
            raise StepStartsInThePastError
        start = changes.start_at if changes.start_at is not None else item.start_at
        minutes = changes.minutes if changes.minutes is not None else item.minutes
        if start is not None and (changes.start_at is not None or changes.minutes is not None):
            self._refuse_overlap(draft, item, start, minutes)

        if changes.title is not None:
            item.title = changes.title
        item.minutes = minutes
        if changes.start_at is not None:
            # In UTC, as every instant is stored and read back (ADR-0009): the answer to this
            # change then says what the next read will.
            item.start_at = changes.start_at.astimezone(timezone.utc)
            item.placement = PLACED
        self._session.flush()
        return _item(item, self._drafts.prerequisites(draft.id).get(item.id, []), draft, now)

    def remove_item(self, plan_id: uuid.UUID, item_id: uuid.UUID) -> None:
        """Remove a step. Its dependants stay, and lose the constraint (ADR-0030, ADR-0037)."""
        draft = self._pending(plan_id)
        self._session.delete(_step_of(draft, item_id))
        self._session.flush()

    def discard(self, plan_id: uuid.UUID) -> None:
        """Set the plan aside. It stays thirty days, and then goes whole (ADR-0037)."""
        draft = self._pending(plan_id)
        draft.status = "discarded"
        draft.ended_at = func.now()
        self._session.flush()

    def _pending(self, plan_id: uuid.UUID) -> PlanDraft:
        draft = self._drafts.get_for_change(plan_id)
        if draft is None:
            raise PlanNotFoundError
        if draft.status != "pending":
            raise PlanNotPendingError
        return draft

    def _refuse_overlap(
        self, draft: PlanDraft, item: PlanDraftItem, start: datetime, minutes: int
    ) -> None:
        end = start + timedelta(minutes=minutes)
        tasks = TaskRepository(self._session, self._jobs.owner_id)
        # An empty range is a task completed before it began: it holds no time, and the
        # exclusion constraint lets anything be booked across it.
        if any(ends > starts for starts, ends in tasks.occupied_ranges(starts=start, ends=end)):
            raise StepOverlapsTaskError
        for other in draft.items:
            if other.id == item.id or other.start_at is None:
                continue
            if other.start_at < end and other.start_at + timedelta(minutes=other.minutes) > start:
                raise StepOverlapsStepError


def _step_of(draft: PlanDraft, item_id: uuid.UUID) -> PlanDraftItem:
    for item in draft.items:
        if item.id == item_id:
            return item
    raise PlanItemNotFoundError


def _item(
    item: PlanDraftItem, prerequisites: list[uuid.UUID], draft: PlanDraft, now: datetime
) -> PlanItemRead:
    return PlanItemRead(
        id=item.id,
        position=item.position,
        title=item.title,
        description=item.description,
        minutes=item.minutes,
        start_at=item.start_at,
        state=_state(item, draft, now),
        prerequisites=prerequisites,
        links=[PlanLinkRead(label=link.label, url=link.url) for link in item.links],
    )


def _state(item: PlanDraftItem, draft: PlanDraft, now: datetime) -> ItemState:
    """Read against the clock, never stored (ADR-0033). Only a pending plan's steps can be
    late: an approved plan's are tasks now, and the others will not be placed again."""
    if (
        draft.status == "pending"
        and item.placement == "placed"
        and item.start_at is not None
        and item.start_at <= now
    ):
        return "passed"
    return item.placement  # type: ignore[return-value]
