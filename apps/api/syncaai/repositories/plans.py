"""Repositories for the AI layer's jobs and the plans they produce (ADR-0016, ADR-0038).

Both carry their owner on the row, so both are scoped by the base, and a job or a plan that
belongs to somebody else is simply not found.
"""

import uuid
from collections import defaultdict

from sqlalchemy import exists, select
from sqlalchemy.orm import selectinload

from syncaai.models import AiJob, PlanDraft, PlanDraftItem, PlanDraftItemPrerequisite
from syncaai.repositories.base import OwnedRepository

IN_PROGRESS = ("queued", "running")


class AiJobRepository(OwnedRepository[AiJob]):
    model = AiJob
    owner_column = AiJob.user_id

    def any_in_progress(self) -> bool:
        statement = self._scoped().where(AiJob.status.in_(IN_PROGRESS))
        return bool(self._session.scalar(select(exists(statement))))


class PlanDraftRepository(OwnedRepository[PlanDraft]):
    model = PlanDraft
    owner_column = PlanDraft.user_id

    def any_pending(self) -> bool:
        statement = self._scoped().where(PlanDraft.status == "pending")
        return bool(self._session.scalar(select(exists(statement))))

    def for_job(self, job_id: uuid.UUID) -> PlanDraft | None:
        return self._session.scalar(self._scoped().where(PlanDraft.job_id == job_id))

    def get_for_review(self, plan_id: uuid.UUID) -> PlanDraft | None:
        """The plan with everything a review shows, in a fixed number of queries."""
        statement = (
            self._scoped()
            .where(PlanDraft.id == plan_id)
            .options(
                selectinload(PlanDraft.items).selectinload(PlanDraftItem.links),
                selectinload(PlanDraft.discards),
            )
        )
        return self._session.scalar(statement)

    def get_for_change(self, plan_id: uuid.UUID) -> PlanDraft | None:
        """The plan, locked until the transaction ends. Two edits of one plan wait for each
        other, so neither can place a step on time the other has just taken."""
        statement = self._scoped().where(PlanDraft.id == plan_id).with_for_update()
        return self._session.scalar(statement)

    def prerequisites(self, plan_id: uuid.UUID) -> dict[uuid.UUID, list[uuid.UUID]]:
        """Each item's prerequisites. Reached through a plan already read through the owner
        filter, and held to that plan by the table's own composite keys (ADR-0037)."""
        rows = self._session.execute(
            select(PlanDraftItemPrerequisite.item_id, PlanDraftItemPrerequisite.prerequisite_id)
            .where(PlanDraftItemPrerequisite.draft_id == plan_id)
            .order_by(PlanDraftItemPrerequisite.item_id)
        )
        found: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
        for item_id, prerequisite_id in rows:
            found[item_id].append(prerequisite_id)
        return found
