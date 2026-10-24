"""ai usage

One row per call to a model, written when the call ends, failed calls included (ADR-0041). The
CHECKs hold the shape of each outcome. The person and the job are set to null when they go, so
a month's spend stays counted after an account is deleted; the indexes are what the ceilings
of ADR-0006 will sum over, and what those nulls are found by.

Revision ID: 0013
Revises: 0012
Create Date: 2026-10-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ai_usage",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("job_id", sa.Uuid(), nullable=True),
        sa.Column("attempt", sa.SmallInteger(), nullable=False),
        sa.Column("position", sa.SmallInteger(), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("model", sa.String(length=64), nullable=False),
        sa.Column("prompt_version", sa.String(length=32), nullable=False),
        sa.Column("outcome", sa.String(length=16), nullable=False),
        sa.Column("error", sa.String(length=64), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column("cost_usd", sa.Numeric(precision=12, scale=8), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "(outcome = 'failed') = (error IS NOT NULL)", name=op.f("ck_ai_usage_error_when_failed")
        ),
        sa.CheckConstraint(
            "outcome <> 'completed' OR (input_tokens IS NOT NULL AND output_tokens IS NOT NULL"
            " AND cost_usd IS NOT NULL)",
            name=op.f("ck_ai_usage_measured_when_completed"),
        ),
        sa.CheckConstraint(
            "outcome <> 'failed' OR (input_tokens IS NULL AND output_tokens IS NULL)",
            name=op.f("ck_ai_usage_no_tokens_when_failed"),
        ),
        sa.CheckConstraint("outcome IN ('completed', 'failed')", name=op.f("ck_ai_usage_outcome")),
        sa.CheckConstraint("attempt BETWEEN 1 AND 3", name=op.f("ck_ai_usage_attempt")),
        sa.CheckConstraint(
            "input_tokens >= 0 AND output_tokens >= 0 AND cost_usd >= 0 AND latency_ms >= 0",
            name=op.f("ck_ai_usage_not_negative"),
        ),
        sa.CheckConstraint("position IN (0, 1)", name=op.f("ck_ai_usage_position")),
        sa.ForeignKeyConstraint(
            ["job_id"], ["ai_jobs.id"], name=op.f("fk_ai_usage_job_id_ai_jobs"), ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_ai_usage_user_id_users"), ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ai_usage")),
    )
    op.create_index("ix_ai_usage_created_at", "ai_usage", ["created_at"], unique=False)
    op.create_index("ix_ai_usage_job_id", "ai_usage", ["job_id"], unique=False)
    op.create_index(
        "ix_ai_usage_user_id_created_at", "ai_usage", ["user_id", "created_at"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_ai_usage_user_id_created_at", table_name="ai_usage")
    op.drop_index("ix_ai_usage_job_id", table_name="ai_usage")
    op.drop_index("ix_ai_usage_created_at", table_name="ai_usage")
    op.drop_table("ai_usage")
