"""ORM models for the SyncaAI domain.

Every non-obvious choice here is recorded in an ADR, and the schema is where those
decisions become enforceable:

- Instants are ``timestamptz``; the local day is derived and never stored, so nothing can
  drift when a user changes timezone (ADR-0009).
- A task stores its start and its duration; ``end_at`` is maintained by a database
  trigger, not by the application (ADR-0008, mechanism corrected by ADR-0013).
- ``days`` holds state belonging to the day itself. Tasks deliberately do **not**
  reference it — a task's day is implied by ``start_at`` and is never stored twice
  (ADR-0010).
- Tasks are deleted physically (ADR-0011).
- Duration is bounded to one day, and a task's minutes count entirely on the day it starts
  (ADR-0012).

Primary keys are UUIDs so that identifiers are neither enumerable nor a signal of how many
rows exist. Ownership is stored once, on the row that owns it: a checklist item has no
``user_id``, because its owner is its task's owner. Scoping child queries by owner is a
join, not a duplicated column.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    String,
    Text,
    UniqueConstraint,
    column,
    func,
)
from sqlalchemy.dialects.postgresql import ExcludeConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.schema import FetchedValue

MINUTES_IN_A_DAY = 1440

# Deterministic constraint names. Without them PostgreSQL invents names, which means a
# downgrade cannot drop what an upgrade created and every future ALTER becomes guesswork.
# Short names are given at the definition site; the convention expands them.
NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    """Declarative base shared by every ORM model."""

    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class TimestampMixin:
    """Row lifecycle timestamps.

    ``updated_at`` is maintained by the ORM, not by a database trigger, so a write that
    bypasses the ORM will not refresh it. Acceptable while every write goes through the
    application; if that stops being true, this moves to a trigger.
    """

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class User(Base, TimestampMixin):
    """An account.

    ``timezone`` is an IANA zone name and is the only place the user's local calendar is
    defined. It is validated against ``zoneinfo`` in the service layer; the database only
    enforces that it is present, since a list of valid zones would go stale.
    """

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    timezone: Mapped[str] = mapped_column(
        String(64), nullable=False, server_default="America/Sao_Paulo"
    )

    days: Mapped[list[Day]] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )
    tasks: Mapped[list[Task]] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )


class Day(Base, TimestampMixin):
    """State that belongs to a calendar day itself, rather than to what happened on it.

    A row exists only when there is something to record about the day. The day of a task
    is **not** here — that is derived from the task's ``start_at`` (ADR-0010). Joining
    tasks to this table would therefore not filter anything; it is reached by
    ``(user_id, local_date)`` when a day-level attribute is needed.

    ``marked_at`` is the explicit half of the heatmap: a day the user marked deliberately.
    The derived half — activity on the day — is computed and never stored.
    """

    __tablename__ = "days"
    __table_args__ = (UniqueConstraint("user_id", "local_date"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    local_date: Mapped[date] = mapped_column(Date, nullable=False)
    marked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User] = relationship(back_populates="days")


class Task(Base, TimestampMixin):
    """A block of time the user has committed.

    ``duration_minutes`` is the primary value because it is what the AI returns; the
    scheduler assigns ``start_at`` (ADR-0008).

    ``end_at`` is written by a ``BEFORE INSERT OR UPDATE`` trigger defined in the migration,
    so it cannot disagree with the columns it derives from and cannot be set by hand. It
    could not be a generated column: PostgreSQL requires those expressions to be
    ``IMMUTABLE`` and ``timestamptz + interval`` is only ``STABLE``, because interval
    arithmetic consults the session time zone (ADR-0013).

    Because the trigger owns the column, it is declared here as server-populated and is
    never included in an INSERT or UPDATE the ORM emits.

    The exclusion constraint makes overlapping tasks impossible for a given user in any
    code path, including a manual ``INSERT``. It relies on ``btree_gist``, enabled by the
    first migration.

    ``completed_at`` rather than a boolean: a timestamp answers "is it done" and "when",
    and the second question is needed by the heatmap.
    """

    __tablename__ = "tasks"
    __table_args__ = (
        CheckConstraint(
            f"duration_minutes > 0 AND duration_minutes <= {MINUTES_IN_A_DAY}",
            name="duration_within_one_day",
        ),
        ExcludeConstraint(
            ("user_id", "="),
            (func.tstzrange(column("start_at"), column("end_at")), "&&"),
            using="gist",
            name="ex_tasks_no_overlap_per_user",
        ),
        # The capacity query filters by owner and a UTC range computed at the edge
        # (ADR-0009), which is exactly this index.
        Index("ix_tasks_user_start_at", "user_id", "start_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    end_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        FetchedValue(),
        server_onupdate=FetchedValue(),
        nullable=False,
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User] = relationship(back_populates="tasks")
    items: Mapped[list[ChecklistItem]] = relationship(
        back_populates="task",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="ChecklistItem.position",
    )


class ChecklistItem(Base, TimestampMixin):
    """One tracked step of a task.

    This is the shape the AI produces: a task decomposed into items, which is what the
    prototype's "3 of 5 preparations done" renders (ADR-0002).

    No ``user_id`` column. The owner is the task's owner, stored once; scoping a query
    here is a join to ``tasks``, not a duplicated column that could disagree.
    """

    __tablename__ = "checklist_items"
    __table_args__ = (
        Index("ix_checklist_items_task_position", "task_id", "position"),
        CheckConstraint("position >= 0", name="position_non_negative"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False
    )
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    task: Mapped[Task] = relationship(back_populates="items")
