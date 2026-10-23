"""usable window

Each account's usable day becomes a window it sets, a start and an end (ADR-0029). The
budget is derived from it and never stored, which is why there is no ``usable_minutes``
column: ADR-0023 named one, and this record replaces it before it ever existed.

The defaults are the sixteen hours every account had while the budget was a constant, so
applying this changes no number anybody sees.

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("day_starts_at", sa.Time(), server_default=sa.text("'06:00'"), nullable=False),
    )
    op.add_column(
        "users",
        sa.Column("day_ends_at", sa.Time(), server_default=sa.text("'22:00'"), nullable=False),
    )
    # ADR-0023's floor and ceiling. A reversed window gives a negative interval and fails
    # the same check, so the order needs no constraint of its own.
    op.create_check_constraint(
        op.f("ck_users_usable_window"),
        "users",
        "day_ends_at - day_starts_at BETWEEN interval '1 hour' AND interval '18 hours'",
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_users_usable_window"), "users", type_="check")
    op.drop_column("users", "day_ends_at")
    op.drop_column("users", "day_starts_at")
