"""plans written by hand

A draft's job and prompt version become optional, and a CHECK holds them together: a model's
draft has both, one written by hand has neither (ADR-0047).

Going down deletes the drafts written by hand, which the older schema has no way to hold.
A task committed from one stays, and only forgets which plan it came from (ADR-0037).

Revision ID: 0015
Revises: 0014
Create Date: 2026-10-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("plan_drafts", "job_id", existing_type=sa.UUID(), nullable=True)
    op.alter_column(
        "plan_drafts", "prompt_version", existing_type=sa.VARCHAR(length=32), nullable=True
    )
    op.create_check_constraint(
        op.f("ck_plan_drafts_job_with_its_prompt"),
        "plan_drafts",
        "(job_id IS NULL) = (prompt_version IS NULL)",
    )


def downgrade() -> None:
    op.execute("DELETE FROM plan_drafts WHERE job_id IS NULL")
    op.drop_constraint(op.f("ck_plan_drafts_job_with_its_prompt"), "plan_drafts", type_="check")
    op.alter_column(
        "plan_drafts", "prompt_version", existing_type=sa.VARCHAR(length=32), nullable=False
    )
    op.alter_column("plan_drafts", "job_id", existing_type=sa.UUID(), nullable=False)
