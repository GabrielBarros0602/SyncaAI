"""Repositories for the AI layer's jobs and the plans they produce (ADR-0016, ADR-0038).

Both carry their owner on the row, so both are scoped by the base, and a job or a plan that
belongs to somebody else is simply not found.
"""

import uuid
from collections import defaultdict
from collections.abc import Collection, Sequence
from datetime import datetime, timedelta

from sqlalchemy import Select, exists, func, select
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

    def newest_first(
        self, *, statuses: Collection[str], limit: int, offset: int
    ) -> Sequence[AiJob]:
        """A page of the owner's jobs in any of ``statuses``, or in any status when none is
        given (ADR-0050). The id breaks a tie, so a page never shows a row twice."""
        statement = (
            self._scoped()
            .order_by(AiJob.created_at.desc(), AiJob.id.desc())
            .limit(limit)
            .offset(offset)
        )
        if statuses:
            statement = statement.where(AiJob.status.in_(statuses))
        return self._session.scalars(statement).all()

    def holding_statement(self, *, window: timedelta, limit: int) -> Select[tuple[datetime]]:
        """The job that keeps a moving window full: the ``limit``-th newest in it, or no row
        while the window has room (ADR-0042). Measured with the database's clock, the one
        ``created_at`` is written with."""
        return (
            self._scoped()
            .with_only_columns(AiJob.created_at)
            .where(AiJob.created_at > func.now() - window)
            .order_by(AiJob.created_at.desc())
            .offset(limit - 1)
            .limit(1)
        )

    def seconds_until_room(self, *, window: timedelta, limit: int) -> float | None:
        """How long until fewer than ``limit`` of the person's jobs fall in the window; None
        while they already do."""
        holding = self.holding_statement(window=window, limit=limit).scalar_subquery()
        wait = self._session.scalar(select(func.extract("epoch", holding + window - func.now())))
        return None if wait is None else float(wait)


class PlanDraftRepository(OwnedRepository[PlanDraft]):
    model = PlanDraft
    owner_column = PlanDraft.user_id

    def any_pending(self) -> bool:
        statement = self._scoped().where(PlanDraft.status == "pending")
        return bool(self._session.scalar(select(exists(statement))))

    def for_job(self, job_id: uuid.UUID) -> PlanDraft | None:
        return self._session.scalar(self._scoped().where(PlanDraft.job_id == job_id))

    def ids_for_jobs(self, job_ids: Collection[uuid.UUID]) -> dict[uuid.UUID, uuid.UUID]:
        """The plan each job produced, for the jobs that produced one."""
        rows = self._session.execute(
            self._scoped()
            .with_only_columns(PlanDraft.job_id, PlanDraft.id)
            .where(PlanDraft.job_id.in_(job_ids))
        )
        # Nullable in the model, for a plan by hand; every row here was found by its job.
        return {job_id: plan_id for job_id, plan_id in rows if job_id is not None}

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
