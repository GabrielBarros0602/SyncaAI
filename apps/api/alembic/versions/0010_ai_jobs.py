"""ai jobs

The queue of ADR-0031 and the answers of ADR-0036. Every rule the states imply is a CHECK, and
"one job in progress per person" (ADR-0033) is a partial unique index, so none of them depends
on the code that writes a job being right. A third answer for a job has no key to take.

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

IN_PROGRESS = sa.text("status IN ('queued', 'running')")


def upgrade() -> None:
    op.create_table(
        "ai_jobs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=16), server_default=sa.text("'plan'"), nullable=False),
        sa.Column(
            "status", sa.String(length=16), server_default=sa.text("'queued'"), nullable=False
        ),
        sa.Column("request", sa.Text(), nullable=True),
        sa.Column("horizon_days", sa.SmallInteger(), nullable=False),
        sa.Column("prompt_version", sa.String(length=32), nullable=False),
        sa.Column("attempts", sa.SmallInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failure_reason", sa.Text(), nullable=True),
        sa.Column("chosen_answer", sa.SmallInteger(), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("kind IN ('plan')", name=op.f("ck_ai_jobs_kind")),
        sa.CheckConstraint(
            "status IN ('queued', 'running', 'done', 'failed')", name=op.f("ck_ai_jobs_status")
        ),
        sa.CheckConstraint("horizon_days BETWEEN 1 AND 14", name=op.f("ck_ai_jobs_horizon")),
        sa.CheckConstraint("attempts BETWEEN 0 AND 3", name=op.f("ck_ai_jobs_attempts")),
        sa.CheckConstraint(
            "request IS NULL OR char_length(request) BETWEEN 1 AND 500",
            name=op.f("ck_ai_jobs_request_length"),
        ),
        sa.CheckConstraint(
            "request IS NOT NULL OR finished_at IS NOT NULL",
            name=op.f("ck_ai_jobs_request_kept_until_finished"),
        ),
        sa.CheckConstraint(
            "status <> 'running' OR locked_until IS NOT NULL",
            name=op.f("ck_ai_jobs_running_is_locked"),
        ),
        sa.CheckConstraint(
            "(status IN ('done', 'failed')) = (finished_at IS NOT NULL)",
            name=op.f("ck_ai_jobs_finished_when_done_or_failed"),
        ),
        sa.CheckConstraint(
            "(status = 'failed') = (failure_reason IS NOT NULL)",
            name=op.f("ck_ai_jobs_reason_when_failed"),
        ),
        sa.CheckConstraint(
            "(status = 'done') = (chosen_answer IS NOT NULL)",
            name=op.f("ck_ai_jobs_answer_when_done"),
        ),
        sa.CheckConstraint("chosen_answer IN (0, 1)", name=op.f("ck_ai_jobs_chosen_answer")),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_ai_jobs_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ai_jobs")),
    )
    op.create_index(
        "ux_ai_jobs_one_in_progress",
        "ai_jobs",
        ["user_id"],
        unique=True,
        postgresql_where=IN_PROGRESS,
    )
    op.create_index("ix_ai_jobs_claimable", "ai_jobs", ["created_at"], postgresql_where=IN_PROGRESS)
    op.create_index("ix_ai_jobs_user_id_created_at", "ai_jobs", ["user_id", "created_at"])

    op.create_table(
        "ai_job_answers",
        sa.Column("job_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.SmallInteger(), nullable=False),
        sa.Column("raw", sa.Text(), nullable=False),
        sa.Column(
            "errors", postgresql.ARRAY(sa.Text()), server_default=sa.text("'{}'"), nullable=False
        ),
        sa.Column("model", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("position IN (0, 1)", name=op.f("ck_ai_job_answers_position")),
        sa.ForeignKeyConstraint(
            ["job_id"],
            ["ai_jobs.id"],
            name=op.f("fk_ai_job_answers_job_id_ai_jobs"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("job_id", "position", name=op.f("pk_ai_job_answers")),
    )


def downgrade() -> None:
    op.drop_table("ai_job_answers")
    op.drop_index("ix_ai_jobs_user_id_created_at", table_name="ai_jobs")
    op.drop_index("ix_ai_jobs_claimable", table_name="ai_jobs")
    op.drop_index("ux_ai_jobs_one_in_progress", table_name="ai_jobs")
    op.drop_table("ai_jobs")
