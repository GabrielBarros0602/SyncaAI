"""ai job context fingerprint

What a response cache would have keyed on beside the request, kept on each job so the hits it
would have had can be counted before one is built (ADR-0045). Its shape is a CHECK, and so is
its life: it never outlives the request, which the thirty-day purge clears with it.

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("ai_jobs", sa.Column("context_fingerprint", sa.String(length=64), nullable=True))
    op.create_check_constraint(
        op.f("ck_ai_jobs_context_fingerprint_shape"),
        "ai_jobs",
        "context_fingerprint ~ '^[0-9a-f]{64}$'",
    )
    op.create_check_constraint(
        op.f("ck_ai_jobs_context_fingerprint_with_its_request"),
        "ai_jobs",
        "context_fingerprint IS NULL OR request IS NOT NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("ck_ai_jobs_context_fingerprint_with_its_request"), "ai_jobs", type_="check"
    )
    op.drop_constraint(op.f("ck_ai_jobs_context_fingerprint_shape"), "ai_jobs", type_="check")
    op.drop_column("ai_jobs", "context_fingerprint")
