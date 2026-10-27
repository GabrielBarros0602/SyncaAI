"""Asking for a plan and reading what came of it (ADR-0033, ADR-0038)."""

import math
import uuid
from collections.abc import Collection, Sequence
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from syncaai.errors import (
    PlanCommitRaceError,
    PlanCommitRefusedError,
    PlanEmptyError,
    PlanFullError,
    PlanInProgressError,
    PlanItemNotFoundError,
    PlanJobNotFoundError,
    PlanNotFoundError,
    PlanNotPendingError,
    PlanRateLimitedError,
    StepOverlapsStepError,
    StepOverlapsTaskError,
    StepStartsInThePastError,
)
from syncaai.models import AiJob, PlanDraft, PlanDraftItem, Task, User
from syncaai.planning.contract import MAX_PLAN_ITEMS
from syncaai.planning.notes import compose_note
from syncaai.planning.scheduler import (
    Step,
    Unplaced,
    schedule_next_week,
    schedule_this_week,
    week_end,
)
from syncaai.repositories.plans import AiJobRepository, PlanDraftRepository
from syncaai.repositories.tasks import TaskRepository
from syncaai.schemas.plans import (
    ItemState,
    JobRead,
    PlanCommitRead,
    PlanDiscardRead,
    PlanItemCreate,
    PlanItemRead,
    PlanItemUpdate,
    PlanLinkRead,
    PlanProgressRead,
    PlanRead,
)
from syncaai.services.ai_breaker import refuse_while_open
from syncaai.services.ai_queue import enqueue_plan
from syncaai.services.ai_spend import DEFAULT_CEILINGS, Ceilings, refuse_past_the_ceilings
from syncaai.services.plan_context import plannable_days
from syncaai.services.plan_drafts import expire_drafts
from syncaai.services.plan_jobs import ONE_PENDING_DRAFT, PLACED
from syncaai.services.tasks import MAX_PAGE_SIZE, OVERLAP_CONSTRAINT

# What a step sent on carries until it is placed again (ADR-0033).
NOT_THIS_WEEK = Unplaced.NOT_THIS_WEEK.value

# ADR-0006's numbers, over moving windows of a person's own jobs (ADR-0042): the window, how
# many jobs it holds, and how the refusal names it.
PLAN_LIMITS = (
    (timedelta(hours=1), 10, "an hour"),
    (timedelta(hours=24), 30, "in 24 hours"),
)


class PlanService:
    def __init__(
        self,
        session: Session,
        user_id: uuid.UUID,
        *,
        ceilings: Ceilings = DEFAULT_CEILINGS,
        provider: str = "sample",
    ) -> None:
        self._session = session
        self._jobs = AiJobRepository(session, user_id)
        self._drafts = PlanDraftRepository(session, user_id)
        self._ceilings = ceilings
        self._provider = provider

    def request(self, request: str, *, horizon_days: int) -> AiJob:
        """Queue a plan, or refuse it: past the rate limit first, the cheapest refusal
        (ADR-0006); then while another plan is still being made or reviewed; then once the
        month's spend has reached a ceiling (ADR-0044); then while the model is down, the
        last check before the queue (ADR-0046).

        No refusal leaves a job, so none spends the allowance (ADR-0042). The second is
        checked here so the answer is a sentence, and held by the partial unique index on jobs
        either way: a double submit loses the race there (ADR-0033). A draft left pending in
        the same race is caught when the job writes its own, and the job fails with the same
        sentence.
        """
        self._refuse_past_the_rate_limit()
        self._let_an_ended_plan_go()
        if self._jobs.any_in_progress() or self._drafts.any_pending():
            raise PlanInProgressError
        refuse_past_the_ceilings(self._session, self._jobs.owner_id, self._ceilings)
        refuse_while_open(self._session, self._provider)
        return enqueue_plan(self._session, self._jobs.owner_id, request, horizon_days=horizon_days)

    def _let_an_ended_plan_go(self) -> None:
        """Record as expired a plan of this person's whose last day has ended, before asking
        whether one is pending. Reading already calls it expired (ADR-0033), but the check
        below and the unique index read the stored status, so until the sweep recorded it
        the plan held the place: for a tick with a worker, for ever without one, and a plan
        by hand needs none (ADR-0047, ADR-0050)."""
        expire_drafts(self._session, owner=self._jobs.owner_id)

    def _refuse_past_the_rate_limit(self) -> None:
        full = []
        for window, limit, per in PLAN_LIMITS:
            wait = self._jobs.seconds_until_room(window=window, limit=limit)
            if wait is not None:
                full.append((wait, limit, per))
        if full:
            # With both windows full, the longer wait is the one that is true.
            wait, limit, per = max(full)
            raise PlanRateLimitedError(max(1, math.ceil(wait)), limit=limit, per=per)

    def write(self, request: str, *, horizon_days: int, now: datetime) -> PlanRead:
        """An empty plan to write by hand: pending, with no job and no prompt (ADR-0047).

        Refused while a plan is being made or reviewed, as a request is (ADR-0033), and held
        by the same index on drafts if two arrive at once. Not a job, so neither the rate
        limit, the ceilings nor the breaker read it: there is no model to protect.
        """
        self._let_an_ended_plan_go()
        if self._jobs.any_in_progress() or self._drafts.any_pending():
            raise PlanInProgressError
        today = self._today(now)
        draft = PlanDraft(
            user_id=self._jobs.owner_id,
            request=request,
            first_day=today,
            last_day=today + timedelta(days=horizon_days - 1),
        )
        try:
            with self._session.begin_nested():
                self._session.add(draft)
                self._session.flush()
        except IntegrityError as error:
            diagnostics = getattr(error.orig, "diag", None)
            if getattr(diagnostics, "constraint_name", None) == ONE_PENDING_DRAFT:
                raise PlanInProgressError from error
            raise
        return self.plan(draft.id, now=now)

    def add_item(self, plan_id: uuid.UUID, new: PlanItemCreate, *, now: datetime) -> PlanItemRead:
        """Add a step after the plan's last, and place it as placing the plan again would: the
        earliest free time, the other steps held where they are (ADR-0033, ADR-0047).

        The plan is locked first, as for every edit, so two additions cannot both see room
        for the last step a plan may hold.
        """
        draft = self._pending(plan_id, now)
        if len(draft.items) >= MAX_PLAN_ITEMS:
            raise PlanFullError
        item = PlanDraftItem(
            id=uuid.uuid4(),
            position=max((step.position for step in draft.items), default=-1) + 1,
            title=new.title,
            description=new.description,
            minutes=new.minutes,
            start_at=None,
            # Until the scheduler below says where it goes.
            placement=Unplaced.NO_ROOM.value,
        )
        draft.items.append(item)
        self._session.flush()
        self._place(draft, [item], now=now, next_week=False)
        return _item(item, [], draft, now)

    def job(self, job_id: uuid.UUID) -> JobRead:
        job = self._jobs.get(job_id)
        if job is None:
            raise PlanJobNotFoundError
        draft = self._drafts.for_job(job.id)
        return _job(job, draft.id if draft else None)

    def jobs(self, *, statuses: Collection[str], limit: int, offset: int) -> list[JobRead]:
        """The person's plan requests, newest first (ADR-0050): the one to follow after a
        reload, and the last that failed."""
        jobs = self._jobs.newest_first(
            statuses=statuses, limit=min(limit, MAX_PAGE_SIZE), offset=offset
        )
        plans = self._drafts.ids_for_jobs([job.id for job in jobs])
        return [_job(job, plans.get(job.id)) for job in jobs]

    def plan(self, plan_id: uuid.UUID, *, now: datetime) -> PlanRead:
        draft = self._drafts.get_for_review(plan_id)
        if draft is None:
            raise PlanNotFoundError
        (read,) = self._read([draft], now)
        return read

    def plans(
        self, *, statuses: Collection[str], limit: int, offset: int, now: datetime
    ) -> list[PlanRead]:
        """The person's plans, newest first, each as reading it answers (ADR-0050)."""
        drafts = self._drafts.newest_first_for_review(
            statuses=statuses,
            today=self._today(now),
            limit=min(limit, MAX_PAGE_SIZE),
            offset=offset,
        )
        return self._read(drafts, now)

    def _read(self, drafts: Sequence[PlanDraft], now: datetime) -> list[PlanRead]:
        prerequisites = self._drafts.prerequisites_of([draft.id for draft in drafts])
        approved = [draft.id for draft in drafts if draft.status == "approved"]
        progress = self._tasks().progress_by_plan(approved)
        return [
            PlanRead(
                id=draft.id,
                # Expired once its last day has ended where its owner lives, whether or not
                # the sweep has recorded it yet (ADR-0033).
                status="expired" if self._ended(draft, now) else draft.status,
                request=draft.request,
                first_day=draft.first_day,
                last_day=draft.last_day,
                week_ends_on=week_end(draft.first_day),
                items=[
                    _item(item, prerequisites.get(item.id, []), draft, now) for item in draft.items
                ],
                discarded=[
                    PlanDiscardRead(position=d.position, title=d.title, reasons=d.reasons)
                    for d in draft.discards
                ],
                progress=_progress(draft, progress),
            )
            for draft in drafts
        ]

    def update_item(
        self, plan_id: uuid.UUID, item_id: uuid.UUID, changes: PlanItemUpdate, *, now: datetime
    ) -> PlanItemRead:
        """Rename, resize or move one step, checked as a task's change would be (ADR-0030).

        A new start must lie ahead and its range must be free of every task and every other
        step of the plan. A new length re-checks the range of a step that has a start, since
        its end moves. The order the dependencies set is not imposed: a person reordering by
        hand is deciding, and ADR-0030 checks a step only against the rules of a task.
        """
        draft = self._pending(plan_id, now)
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

    def remove_item(self, plan_id: uuid.UUID, item_id: uuid.UUID, *, now: datetime) -> None:
        """Remove a step. Its dependants stay, and lose the constraint (ADR-0030, ADR-0037)."""
        draft = self._pending(plan_id, now)
        self._session.delete(_step_of(draft, item_id))
        self._session.flush()

    def discard(self, plan_id: uuid.UUID, *, now: datetime) -> None:
        """Set the plan aside. It stays thirty days, and then goes whole (ADR-0037)."""
        draft = self._pending(plan_id, now)
        draft.status = "discarded"
        draft.ended_at = func.now()
        self._session.flush()

    def commit(self, plan_id: uuid.UUID, *, key: str, now: datetime) -> PlanCommitRead:
        """Turn every step into a task, in one transaction, or write nothing (ADR-0030).

        Refused while a step has no time, has a start that passed, or sits on time a task
        took since the draft was made; the answer names each step and why. A repeat with the
        same key answers what the first did, and any other commit of a plan that is no longer
        pending is refused. The plan is locked first, so two commits of one plan are one
        commit and one repeat.
        """
        draft = self._drafts.get_for_change(plan_id)
        if draft is None:
            raise PlanNotFoundError
        if draft.status == "approved" and draft.idempotency_key == key:
            return PlanCommitRead(plan_id=draft.id, task_ids=self._tasks().ids_from_plan(draft.id))
        if draft.status != "pending" or self._ended(draft, now):
            raise PlanNotPendingError
        if not draft.items:
            raise PlanEmptyError
        problems = self._commit_problems(draft, now)
        if problems:
            raise PlanCommitRefusedError(problems)

        tasks = [
            Task(
                user_id=draft.user_id,
                title=item.title,
                start_at=item.start_at,
                duration_minutes=item.minutes,
                notes=compose_note(item.description, [(lk.label, lk.url) for lk in item.links]),
                plan_id=draft.id,
            )
            for item in draft.items
        ]
        self._session.add_all(tasks)
        try:
            self._session.flush()
        except IntegrityError as error:
            # Booked between the check above and this insert: the exclusion constraint has
            # the final word, as everywhere else, and the whole commit goes with it.
            diagnostics = getattr(error.orig, "diag", None)
            if getattr(diagnostics, "constraint_name", None) == OVERLAP_CONSTRAINT:
                raise PlanCommitRaceError from error
            raise
        draft.status = "approved"
        draft.ended_at = func.now()
        draft.idempotency_key = key
        self._session.flush()
        return PlanCommitRead(plan_id=draft.id, task_ids=[task.id for task in tasks])

    def _commit_problems(self, draft: PlanDraft, now: datetime) -> list[tuple[str, str, str]]:
        problems: list[tuple[str, str, str]] = []
        tasks = self._tasks()
        for item in draft.items:
            if item.start_at is None:
                reason = "It has no time yet. Give it one, or remove it."
            elif item.start_at <= now:
                reason = "Its start has passed. Move it, or remove it."
            elif _holds_time(tasks, item.start_at, item.minutes):
                reason = "A task was booked on its time since. Move it, or remove it."
            else:
                continue
            problems.append((str(item.id), item.title, reason))
        return problems

    def _tasks(self) -> TaskRepository:
        return TaskRepository(self._session, self._jobs.owner_id)

    def replace(self, plan_id: uuid.UUID, *, now: datetime) -> PlanRead:
        """Place again every step with no time ahead of it: passed, without a time, or waiting
        for next week. This week first, as a new plan is (ADR-0033).

        The scheduler alone, with no call to a model: it costs nothing, and every edit made in
        review stays. The steps that keep their time hold it, as tasks would.
        """
        draft = self._pending(plan_id, now)
        moving = [item for item in draft.items if not _ahead(item, now)]
        self._place(draft, moving, now=now, next_week=False)
        return self.plan(plan_id, now=now)

    def next_week(self, plan_id: uuid.UUID, *, now: datetime) -> PlanRead:
        """Send the steps that did not fit to the days after the plan's first week (ADR-0033).

        The week is the one the plan was made in, not today's: pressed the Tuesday after,
        "next week" is still the days after that first Sunday, not a week further on.
        """
        draft = self._pending(plan_id, now)
        moving = [item for item in draft.items if item.placement == NOT_THIS_WEEK]
        self._place(draft, moving, now=now, next_week=True)
        return self.plan(plan_id, now=now)

    def _place(
        self, draft: PlanDraft, moving: list[PlanDraftItem], *, now: datetime, next_week: bool
    ) -> None:
        if not moving:
            return
        user = self._owner()
        moving_ids = {item.id for item in moving}
        staying = [i for i in draft.items if i.id not in moving_ids and i.start_at is not None]
        held = [_span(item) for item in staying]
        today = self._today(now)
        days = plannable_days(
            self._session,
            user,
            horizon_days=(draft.last_day - today).days + 1,
            now=now,
            held=held,
        )
        positions = {item.id: item.position for item in draft.items}
        prerequisites = self._drafts.prerequisites(draft.id)
        steps = [
            Step(
                item.position,
                item.minutes,
                tuple(positions[p] for p in prerequisites.get(item.id, [])),
            )
            for item in sorted(moving, key=lambda item: item.position)
        ]
        ends = {item.position: end for item, (_, end) in zip(staying, held, strict=True)}
        if next_week:
            placements = schedule_next_week(
                steps, days, now=now, week_ends=week_end(draft.first_day), placed=ends
            )
        else:
            placements = schedule_this_week(
                steps, days, now=now, week_ends=week_end(today), placed=ends
            )
        by_position = {placement.key: placement for placement in placements}
        for item in moving:
            placement = by_position[item.position]
            item.start_at = placement.start
            item.placement = placement.unplaced.value if placement.unplaced else PLACED
        self._session.flush()

    def _pending(self, plan_id: uuid.UUID, now: datetime) -> PlanDraft:
        draft = self._drafts.get_for_change(plan_id)
        if draft is None:
            raise PlanNotFoundError
        if draft.status != "pending" or self._ended(draft, now):
            raise PlanNotPendingError
        return draft

    def _ended(self, draft: PlanDraft, now: datetime) -> bool:
        """A pending plan whose last day has ended in its owner's zone has nothing left to be
        placed in (ADR-0033). The sweep records it; until then this is what notices."""
        return draft.status == "pending" and draft.last_day < self._today(now)

    def _today(self, now: datetime) -> date:
        return now.astimezone(ZoneInfo(self._owner().timezone)).date()

    def _owner(self) -> User:
        return self._session.get_one(User, self._jobs.owner_id)

    def _refuse_overlap(
        self, draft: PlanDraft, item: PlanDraftItem, start: datetime, minutes: int
    ) -> None:
        end = start + timedelta(minutes=minutes)
        if _holds_time(self._tasks(), start, minutes):
            raise StepOverlapsTaskError
        for other in draft.items:
            if other.id == item.id or other.start_at is None:
                continue
            if other.start_at < end and other.start_at + timedelta(minutes=other.minutes) > start:
                raise StepOverlapsStepError


def _progress(
    draft: PlanDraft, counted: dict[uuid.UUID, tuple[int, int]]
) -> PlanProgressRead | None:
    if draft.status != "approved":
        return None
    done, total = counted.get(draft.id, (0, 0))
    return PlanProgressRead(done=done, total=total)


def _job(job: AiJob, plan_id: uuid.UUID | None) -> JobRead:
    return JobRead(
        job_id=job.id,
        status=job.status,
        failure_reason=job.failure_reason,
        plan_id=plan_id,
    )


def _span(item: PlanDraftItem) -> tuple[datetime, datetime]:
    """The time a placed step holds."""
    assert item.start_at is not None, "only a step with a start holds time"
    return item.start_at, item.start_at + timedelta(minutes=item.minutes)


def _ahead(item: PlanDraftItem, now: datetime) -> bool:
    return item.placement == PLACED and item.start_at is not None and item.start_at > now


def _holds_time(tasks: TaskRepository, start: datetime, minutes: int) -> bool:
    """Whether any task holds time inside ``[start, start + minutes)``. An empty range is a
    task completed before it began: it holds none, and the exclusion constraint lets
    anything be booked across it."""
    end = start + timedelta(minutes=minutes)
    return any(ends > starts for starts, ends in tasks.occupied_ranges(starts=start, ends=end))


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
