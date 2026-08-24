"""Repositories for tasks and their checklist items.

Between them these two cover both ways of reaching an owner, which is the whole reason the
base takes a join rather than assuming a column.
"""

import uuid
from collections.abc import Sequence
from datetime import date, datetime

from sqlalchemy import Date, Row, Select, cast, func, literal, select
from sqlalchemy.orm import selectinload

from syncaai.models import ChecklistItem, Task
from syncaai.repositories.base import OwnedRepository


class TaskRepository(OwnedRepository[Task]):
    """The owner is on the row."""

    model = Task
    owner_column = Task.user_id
    # Soonest first, then id to break a tie. Two tasks cannot share a start for one owner,
    # but the tiebreak costs nothing and the ordering stops depending on that being true.
    default_order = (Task.start_at, Task.id)

    def get_with_items(self, task_id: "uuid.UUID") -> Task | None:
        """Fetch a task and everything a response needs, in two queries rather than many.

        Without the eager load, serialising a page of tasks issues one query per task for
        its items and another for its tag. That is the N+1 that ORMs are famous for, and it
        is invisible until a list has more than a handful of rows.
        """
        statement = (
            self._scoped()
            .where(Task.id == task_id)
            .options(selectinload(Task.items), selectinload(Task.tag))
        )
        return self._session.scalar(statement)

    def list_with_items(
        self,
        *,
        limit: int = 50,
        offset: int = 0,
        starts_at_or_after: datetime | None = None,
        starts_before: datetime | None = None,
    ) -> Sequence[Task]:
        """A page of this owner's tasks, soonest first, optionally inside a window.

        The bounds are instants, not dates. Converting a local day into a UTC range happens
        once, at the edge (ADR-0009), and arrives here already done — which also keeps the
        predicate on the stored column, where ``ix_tasks_user_start_at`` can serve it.

        Half-open, matching ``utc_window``: a task starting exactly at ``starts_before`` is
        the next window's, so two adjacent windows neither overlap nor drop a row.
        """
        statement = (
            self._scoped()
            .options(selectinload(Task.items), selectinload(Task.tag))
            .order_by(Task.start_at, Task.id)
            .limit(limit)
            .offset(offset)
        )
        if starts_at_or_after is not None:
            statement = statement.where(Task.start_at >= starts_at_or_after)
        if starts_before is not None:
            statement = statement.where(Task.start_at < starts_before)
        return self._session.scalars(statement).all()

    def occupied_minutes_by_day(
        self, *, window_start: datetime, window_end: datetime, zone_name: str
    ) -> Sequence[Row[tuple[date, int, int]]]:
        """Run :meth:`capacity_statement` and return its rows."""
        return self._session.execute(
            self.capacity_statement(
                window_start=window_start, window_end=window_end, zone_name=zone_name
            )
        ).all()

    def capacity_statement(
        self, *, window_start: datetime, window_end: datetime, zone_name: str
    ) -> Select[tuple[date, int, int]]:
        """Minutes booked and task count, per local day, for one owner.

        Built and executed separately so a test can run ``EXPLAIN`` over the statement the
        application actually issues. A hand-written copy in the test would drift, and a
        passing plan for a query nobody runs is worse than no test at all.

        Rule 3 of ADR-0012: every minute of a task counts against the day it *starts* on,
        even one that runs past midnight. That is why this is a ``GROUP BY`` over a derived
        date with a plain ``SUM``, rather than a join that clips each task to each day it
        touches — and it is also why a day can report more minutes than it has. The floor at
        zero lives in the service, next to the flag that says so out loud.

        Only days holding something come back. Filling the gaps belongs to the service,
        because the length of an empty day still depends on the time zone and this query
        does not know one.

        The window is the half-open UTC range from ``utc_window``. Filtering on the stored
        column is what lets the predicate ride ``ix_tasks_user_start_at``: an index over
        ``(user_id, start_at)`` is useless to a filter on a *derived* local date, so the
        conversion appears in the grouping and never in the ``WHERE``.
        """
        # AT TIME ZONE on a timestamptz yields the wall clock in that zone; the cast then
        # drops the time. Naming the zone here rather than relying on the session's setting
        # keeps the answer independent of whatever connection happens to run it.
        local_day = cast(func.timezone(literal(zone_name), Task.start_at), Date).label("day")
        statement: Select[tuple[date, int, int]] = (
            select(
                local_day,
                func.sum(Task.duration_minutes).label("occupied_minutes"),
                func.count().label("task_count"),
            )
            .where(
                Task.user_id == self._owner_id,
                Task.start_at >= window_start,
                Task.start_at < window_end,
            )
            .group_by(local_day)
            .order_by(local_day)
        )
        return statement


class ChecklistItemRepository(OwnedRepository[ChecklistItem]):
    """The owner is on the parent task, so reaching it is a join.

    ``ChecklistItem`` has no ``user_id`` on purpose (ADR-0010). Adding one to make this
    simpler would store the same fact twice, and the two copies could disagree the moment an
    item moved between tasks.
    """

    model = ChecklistItem
    owner_join = Task
    owner_column = Task.user_id
