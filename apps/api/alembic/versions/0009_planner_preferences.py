"""planner preferences

Days off and a preferred block length, the two preferences ADR-0004 listed that ADR-0029 did
not store (ADR-0032). The defaults — no days off, sixty minutes — change nothing for an
account that never sets them: the planner does not exist yet, and capacity never reads them.

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "days_off",
            postgresql.ARRAY(sa.SmallInteger()),
            server_default=sa.text("'{}'"),
            nullable=False,
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "preferred_block_minutes",
            sa.SmallInteger(),
            server_default=sa.text("60"),
            nullable=False,
        ),
    )
    # ISO weekdays only, and at least one left to plan in (ADR-0032).
    op.create_check_constraint(
        op.f("ck_users_days_off"),
        "users",
        "days_off <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[] AND cardinality(days_off) < 7",
    )
    op.create_check_constraint(
        op.f("ck_users_preferred_block"),
        "users",
        "preferred_block_minutes BETWEEN 15 AND 240",
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_users_preferred_block"), "users", type_="check")
    op.drop_constraint(op.f("ck_users_days_off"), "users", type_="check")
    op.drop_column("users", "preferred_block_minutes")
    op.drop_column("users", "days_off")
