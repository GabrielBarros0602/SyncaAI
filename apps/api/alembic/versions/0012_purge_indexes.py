"""purge indexes

What the hourly purge reads, and nothing else. ai_jobs and approved drafts grow for ever, the
jobs in metadata; each index covers only the rows that may still be purged, so it stays the size
of thirty days of content however long the tables become (ADR-0036, ADR-0037).

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(
        "ix_ai_jobs_purgeable",
        "ai_jobs",
        ["finished_at"],
        postgresql_where=sa.text("request IS NOT NULL"),
    )
    op.create_index(
        "ix_plan_drafts_purgeable",
        "plan_drafts",
        ["ended_at"],
        postgresql_where=sa.text("status IN ('discarded', 'expired')"),
    )


def downgrade() -> None:
    op.drop_index("ix_plan_drafts_purgeable", table_name="plan_drafts")
    op.drop_index("ix_ai_jobs_purgeable", table_name="ai_jobs")
