"""Repositories for tasks and their checklist items.

Between them these two cover both ways of reaching an owner, which is the whole reason the
base takes a join rather than assuming a column.
"""

import uuid
from collections.abc import Sequence
from datetime import date, datetime, timedelta

from sqlalchemy import (
    Date,
    DateTime,
    Row,
    Select,
    and_,
    case,
    column,
    func,
    select,
    values,
)
from sqlalchemy.orm import selectinload

from syncaai.models import MINUTES_IN_A_DAY, ChecklistItem, Task
from syncaai.repositories.base import OwnedRepository

SECONDS_IN_A_MINUTE = 60

# The CHECK constraint caps a task at one day, so nothing starting earlier than this can
# still be running inside a window. It is what lets the scan stay on `start_at`.
MAX_TASK_LENGTH = timedelta(minutes=MINUTES_IN_A_DAY)


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
        self, *, windows: Sequence[tuple[date, datetime, datetime]]
    ) -> Sequence[Row[tuple[date, int, int]]]:
        """Run :meth:`capacity_statement` and return its rows."""
        return self._session.execute(self.capacity_statement(windows=windows)).all()

    def capacity_statement(
        self, *, windows: Sequence[tuple[date, datetime, datetime]]
    ) -> Select[tuple[date, int, int]]:
        """Minutes occupied and task count, per local day.

        A sum of each task's overlap with each day's window, rather than a ``GROUP BY`` over
        a derived date with a plain ``SUM``. That is what makes a task crossing midnight give
        one hour to Monday and one to Tuesday (ADR-0022), and it is why ``end_at`` matters
        here: a task completed early holds a shorter range, so the freed minutes stop being
        counted without anything asking whether it was completed.

        The windows arrive already converted. Turning a local day into a UTC range is
        ``utc_window``'s job and happens once, at the edge (ADR-0009) — a query that did its
        own conversion would be a second place for daylight saving to be got wrong.

        **The margin is what keeps the index.** ``ix_tasks_user_start_at`` covers
        ``(user_id, start_at)`` and cannot serve a filter on ``end_at``. So the scan is
        bounded by ``start_at`` alone, reaching back one day before the window — safe
        precisely because the CHECK constraint caps a task at 1440 minutes, so nothing
        starting earlier than that can still be running inside the window. A constraint
        written for correctness turns out to buy a plan.
        """
        first_start = min(start for _, start, _ in windows)
        last_end = max(end for _, _, end in windows)

        day_windows = values(
            column("day", Date),
            column("window_start", DateTime(timezone=True)),
            column("window_end", DateTime(timezone=True)),
            name="day_windows",
        ).data(list(windows))

        overlap = func.least(Task.end_at, day_windows.c.window_end) - func.greatest(
            Task.start_at, day_windows.c.window_start
        )

        # `LEAST` and `GREATEST` skip NULLs in PostgreSQL, unlike almost every other
        # function. On the outer join's unmatched row that means LEAST(NULL, window_end)
        # is window_end and GREATEST(NULL, window_start) is window_start — so an empty day
        # reports the whole window as occupied. COALESCE around the SUM does not help: the
        # sum is not null, it is 1440. The absent task has to be excluded explicitly.
        minutes = case(
            (Task.id.is_(None), 0),
            else_=func.extract("epoch", overlap) / SECONDS_IN_A_MINUTE,
        )

        statement: Select[tuple[date, int, int]] = (
            select(
                day_windows.c.day,
                func.coalesce(func.sum(minutes), 0).label("occupied_minutes"),
                func.count(Task.id).label("task_count"),
            )
            .select_from(day_windows)
            .outerjoin(
                Task,
                and_(
                    Task.user_id == self._owner_id,
                    Task.start_at >= first_start - MAX_TASK_LENGTH,
                    Task.start_at < last_end,
                    Task.start_at < day_windows.c.window_end,
                    Task.end_at > day_windows.c.window_start,
                ),
            )
            .group_by(day_windows.c.day)
            .order_by(day_windows.c.day)
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
