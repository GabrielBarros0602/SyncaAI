"""End at the earlier of planned and completed

Revision ID: 0007
Revises: 0006
Create Date: 2026-08-25

Completing a task early should give the remaining time back (ADR-0022). ``end_at`` becomes
the lesser of the planned end and the moment it was completed, so the exclusion constraint
releases the freed slot with no code that knows about it.

``LEAST`` so completing *late* never extends the booking. A grown range could collide with a
neighbour, and the update would be refused — a completion that fails is worse than one that
is merely imprecise.

``GREATEST`` so completing something before it started yields an empty range rather than an
inverted one, which ``tstzrange`` refuses outright.

``duration_minutes`` keeps meaning the plan. Only the occupancy moves.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PLANNED = "NEW.duration_minutes * interval '1 minute'"
_ELAPSED = "COALESCE(NEW.completed_at, 'infinity'::timestamptz) - NEW.start_at"
_REFIRE = "UPDATE tasks SET duration_minutes = duration_minutes WHERE completed_at IS NOT NULL"


def upgrade() -> None:
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION tasks_set_end_at() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            NEW.end_at := NEW.start_at + LEAST(
                {_PLANNED},
                GREATEST({_ELAPSED}, interval '0')
            );
            RETURN NEW;
        END;
        $$
        """
    )
    # Existing rows keep whatever end_at the old trigger wrote. A no-op UPDATE re-fires it,
    # so every completed task's occupancy is corrected in one pass rather than lazily on
    # whatever happens to be edited next.
    op.execute(_REFIRE)


def downgrade() -> None:
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION tasks_set_end_at() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            NEW.end_at := NEW.start_at + {_PLANNED};
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(_REFIRE)
