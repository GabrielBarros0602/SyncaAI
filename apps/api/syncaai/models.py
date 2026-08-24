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
- A session is a row, so revoking one does not touch any other (ADR-0015).
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

from syncaai.security.opaque import TOKEN_HASH_LENGTH

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
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)

    # Null until the address is proven reachable. An account cannot log in before this is
    # set (ADR-0019), so it is the gate rather than a label.
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    timezone: Mapped[str] = mapped_column(
        String(64), nullable=False, server_default="America/Sao_Paulo"
    )

    days: Mapped[list[Day]] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )
    tasks: Mapped[list[Task]] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )


# Declared after the class because the mapped attribute only becomes an expression once the
# class exists. Unique on the normalised value rather than on the column: the service
# lowercases before writing, but a writer that skipped it could store a case variant and a
# plain constraint would accept it as a different address. ``lower()`` is IMMUTABLE, so
# unlike the local date in ADR-0009 this expression can be indexed.
Index("uq_users_email_lower", func.lower(User.email), unique=True)


class Tag(Base, TimestampMixin):
    """A label a user puts on tasks.

    Created when a task first names it, and never deleted — there is no CRUD for tags
    (ADR-0020). Names are stored normalised, so ``Deep Work`` and ``deep work`` are one tag
    rather than two, which is the whole reason this is a row instead of a string.
    """

    __tablename__ = "tags"
    __table_args__ = (UniqueConstraint("user_id", "name"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(50), nullable=False)


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

    # Optional, and cleared rather than cascading if the tag ever goes: losing a task
    # because its label was removed would be the wrong loss.
    tag_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("tags.id", ondelete="SET NULL"), nullable=True
    )

    user: Mapped[User] = relationship(back_populates="tasks")
    tag: Mapped[Tag | None] = relationship()
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
        # Deferred to commit, so reordering is one batch update inside a transaction rather
        # than a shuffle through temporary values. Deferral only holds within a transaction:
        # a reorder split across two requests still collides (ADR-0020).
        UniqueConstraint("task_id", "position", deferrable=True, initially="DEFERRED"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False
    )
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    task: Mapped[Task] = relationship(back_populates="items")


class RefreshToken(Base, TimestampMixin):
    """One long-lived session.

    A row rather than a claim inside a token, so that revoking a single session is a write
    instead of rotating a signing secret and ending everybody else's session too. That
    matters here beyond general hygiene: ADR-0006 puts a spend cap per user on the AI layer,
    so a stolen credential spends the owner's money and "wait for it to expire" is not an
    answer.

    Only the digest is stored. A database leak should not hand over live sessions, which is
    the same reason passwords are hashed — but a fast digest suffices, because the value is
    random rather than human-chosen (see ``syncaai.security.refresh``).

    ``revoked_at`` rather than deleting the row: a revoked session that is presented again is
    worth being able to see, and it is what reuse detection will need if rotation is added.
    """

    __tablename__ = "refresh_tokens"
    __table_args__ = (Index("ix_refresh_tokens_user_id", "user_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(TOKEN_HASH_LENGTH), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User] = relationship()


class RateLimitCounter(Base, TimestampMixin):
    """Hits inside one fixed window, for one bucket.

    A counter per window rather than a row per request: an endpoint that is being brute
    forced is exactly the one where writing a row per attempt costs most, and the count is
    all the decision needs.

    Fixed windows let a caller spend a full allowance at the end of one window and another
    at the start of the next, so a burst of twice the limit is possible across a boundary.
    Accepted here for the same reason ADR-0006 accepted it for the AI limit: a sliding
    window costs more to store and the difference does not change what an attacker can
    achieve against argon2.
    """

    __tablename__ = "rate_limit_counters"
    __table_args__ = (UniqueConstraint("bucket", "window_start"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    bucket: Mapped[str] = mapped_column(String(200), nullable=False)
    window_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    hits: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class VerificationToken(Base, TimestampMixin):
    """A single use of a link that proves someone reads an address.

    Only the digest is stored, for the same reason as a session: a database leak should not
    hand over the ability to verify somebody else's address.

    Single use and a short life matter more here than for a session token, because this one
    **travels in a URL**. It lands in browser history and is exposed through ``Referer`` to
    whatever the landing page loads. Neither is preventable from the server; both are
    survivable if the token dies on first use and expires within a day (ADR-0019).

    ``used_at`` rather than deleting the row: a link presented twice is worth being able to
    see, and the second presentation is the interesting one.
    """

    __tablename__ = "verification_tokens"
    __table_args__ = (Index("ix_verification_tokens_user_id", "user_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(TOKEN_HASH_LENGTH), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User] = relationship()


class PasswordResetToken(Base, TimestampMixin):
    """A single use of a link that sets a new password.

    A separate table from ``verification_tokens`` rather than one table with a purpose
    column. The two grant different powers, and sharing storage means a check somewhere has
    to keep them apart — which is a check that can be forgotten. If a third kind appears,
    collapsing all of them into one table behind a purpose-scoped repository becomes the
    better trade; two does not justify it yet.

    Shorter-lived than a verification token because it is worth more: verification proves an
    address is read, a reset takes over the account.
    """

    __tablename__ = "password_reset_tokens"
    __table_args__ = (Index("ix_password_reset_tokens_user_id", "user_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(TOKEN_HASH_LENGTH), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User] = relationship()
