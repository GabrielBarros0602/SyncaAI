"""Asking for a plan and reading what came of it (ADR-0033, ADR-0038)."""

import uuid
from datetime import datetime

from sqlalchemy.orm import Session

from syncaai.errors import PlanInProgressError, PlanJobNotFoundError, PlanNotFoundError
from syncaai.models import AiJob, PlanDraft, PlanDraftItem
from syncaai.planning.scheduler import week_end
from syncaai.repositories.plans import AiJobRepository, PlanDraftRepository
from syncaai.schemas.plans import (
    ItemState,
    JobRead,
    PlanDiscardRead,
    PlanItemRead,
    PlanLinkRead,
    PlanRead,
)
from syncaai.services.ai_queue import enqueue_plan


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
