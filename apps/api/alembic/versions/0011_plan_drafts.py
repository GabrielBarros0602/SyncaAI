"""plan drafts

A draft in five tables and the task's link back to it (ADR-0030, ADR-0037). Each table exists
so the database can hold one more rule: a dependency between drafts, a fourth link, a
javascript: URL, a placed step without a start and a second pending draft are all refused here,
whatever code writes them.

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "plan_drafts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("job_id", sa.Uuid(), nullable=False),
        sa.Column("request", sa.Text(), nullable=False),
        sa.Column(
            "status", sa.String(length=16), server_default=sa.text("'pending'"), nullable=False
        ),
        sa.Column("prompt_version", sa.String(length=32), nullable=False),
        sa.Column("first_day", sa.Date(), nullable=False),
        sa.Column("last_day", sa.Date(), nullable=False),
        sa.Column("idempotency_key", sa.String(length=255), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.CheckConstraint(
            "(status = 'approved') = (idempotency_key IS NOT NULL)",
            name=op.f("ck_plan_drafts_key_when_approved"),
        ),
        sa.CheckConstraint(
            "(status = 'pending') = (ended_at IS NULL)",
            name=op.f("ck_plan_drafts_ended_unless_pending"),
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'approved', 'discarded', 'expired')",
            name=op.f("ck_plan_drafts_status"),
        ),
        sa.CheckConstraint(
            "char_length(request) BETWEEN 1 AND 500", name=op.f("ck_plan_drafts_request_length")
        ),
        sa.CheckConstraint(
            "last_day >= first_day AND last_day - first_day < 14",
            name=op.f("ck_plan_drafts_horizon"),
        ),
        sa.ForeignKeyConstraint(
            ["job_id"],
            ["ai_jobs.id"],
            name=op.f("fk_plan_drafts_job_id_ai_jobs"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_plan_drafts_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_plan_drafts")),
        sa.UniqueConstraint("job_id", name=op.f("uq_plan_drafts_job_id")),
    )
    op.create_index(
        "ix_plan_drafts_user_id_created_at", "plan_drafts", ["user_id", "created_at"], unique=False
    )
    op.create_index(
        "ux_plan_drafts_one_pending",
        "plan_drafts",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.create_table(
        "plan_draft_discards",
        sa.Column("draft_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.SmallInteger(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("reasons", postgresql.ARRAY(sa.Text()), nullable=False),
        sa.CheckConstraint(
            "cardinality(reasons) >= 1", name=op.f("ck_plan_draft_discards_has_reasons")
        ),
        sa.CheckConstraint(
            "position >= 0", name=op.f("ck_plan_draft_discards_position_non_negative")
        ),
        sa.ForeignKeyConstraint(
            ["draft_id"],
            ["plan_drafts.id"],
            name=op.f("fk_plan_draft_discards_draft_id_plan_drafts"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("draft_id", "position", name=op.f("pk_plan_draft_discards")),
    )
    op.create_table(
        "plan_draft_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("draft_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.SmallInteger(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), server_default=sa.text("''"), nullable=False),
        sa.Column("minutes", sa.SmallInteger(), nullable=False),
        sa.Column("start_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("placement", sa.String(length=16), nullable=False),
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
        sa.CheckConstraint(
            "(placement = 'placed') = (start_at IS NOT NULL)",
            name=op.f("ck_plan_draft_items_start_when_placed"),
        ),
        sa.CheckConstraint("btrim(title) <> ''", name=op.f("ck_plan_draft_items_title_not_blank")),
        sa.CheckConstraint(
            "placement IN ('placed', 'no_room', 'not_this_week', 'after_unplaced')",
            name=op.f("ck_plan_draft_items_placement"),
        ),
        sa.CheckConstraint(
            "char_length(description) <= 500", name=op.f("ck_plan_draft_items_description_length")
        ),
        sa.CheckConstraint("minutes BETWEEN 1 AND 1440", name=op.f("ck_plan_draft_items_minutes")),
        sa.CheckConstraint("position >= 0", name=op.f("ck_plan_draft_items_position_non_negative")),
        sa.ForeignKeyConstraint(
            ["draft_id"],
            ["plan_drafts.id"],
            name=op.f("fk_plan_draft_items_draft_id_plan_drafts"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_plan_draft_items")),
        sa.UniqueConstraint("draft_id", "id", name=op.f("uq_plan_draft_items_draft_id_id")),
        sa.UniqueConstraint(
            "draft_id", "position", name=op.f("uq_plan_draft_items_draft_id_position")
        ),
    )
    op.create_table(
        "plan_draft_item_links",
        sa.Column("item_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.SmallInteger(), nullable=False),
        sa.Column("label", sa.String(length=80), nullable=False),
        sa.Column("url", sa.String(length=500), nullable=False),
        sa.CheckConstraint(
            "btrim(label) <> ''", name=op.f("ck_plan_draft_item_links_label_not_blank")
        ),
        sa.CheckConstraint("url ~ '^https?://'", name=op.f("ck_plan_draft_item_links_web_address")),
        sa.CheckConstraint(
            "position BETWEEN 0 AND 2", name=op.f("ck_plan_draft_item_links_position")
        ),
        sa.ForeignKeyConstraint(
            ["item_id"],
            ["plan_draft_items.id"],
            name=op.f("fk_plan_draft_item_links_item_id_plan_draft_items"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("item_id", "position", name=op.f("pk_plan_draft_item_links")),
    )
    op.create_table(
        "plan_draft_item_prerequisites",
        sa.Column("draft_id", sa.Uuid(), nullable=False),
        sa.Column("item_id", sa.Uuid(), nullable=False),
        sa.Column("prerequisite_id", sa.Uuid(), nullable=False),
        sa.CheckConstraint(
            "item_id <> prerequisite_id", name=op.f("ck_plan_draft_item_prerequisites_not_itself")
        ),
        sa.ForeignKeyConstraint(
            ["draft_id", "item_id"],
            ["plan_draft_items.draft_id", "plan_draft_items.id"],
            name="fk_plan_draft_item_prerequisites_item",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["draft_id", "prerequisite_id"],
            ["plan_draft_items.draft_id", "plan_draft_items.id"],
            name="fk_plan_draft_item_prerequisites_prerequisite",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "item_id", "prerequisite_id", name=op.f("pk_plan_draft_item_prerequisites")
        ),
    )
    op.create_index(
        "ix_plan_draft_item_prerequisites_prerequisite",
        "plan_draft_item_prerequisites",
        ["draft_id", "prerequisite_id"],
        unique=False,
    )
    op.add_column("tasks", sa.Column("plan_id", sa.Uuid(), nullable=True))
    op.create_index(
        "ix_tasks_plan_id",
        "tasks",
        ["plan_id"],
        unique=False,
        postgresql_where=sa.text("plan_id IS NOT NULL"),
    )
    op.create_foreign_key(
        op.f("fk_tasks_plan_id_plan_drafts"),
        "tasks",
        "plan_drafts",
        ["plan_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(op.f("fk_tasks_plan_id_plan_drafts"), "tasks", type_="foreignkey")
    op.drop_index(
        "ix_tasks_plan_id", table_name="tasks", postgresql_where=sa.text("plan_id IS NOT NULL")
    )
    op.drop_column("tasks", "plan_id")
    op.drop_index(
        "ix_plan_draft_item_prerequisites_prerequisite", table_name="plan_draft_item_prerequisites"
    )
    op.drop_table("plan_draft_item_prerequisites")
    op.drop_table("plan_draft_item_links")
    op.drop_table("plan_draft_items")
    op.drop_table("plan_draft_discards")
    op.drop_index(
        "ux_plan_drafts_one_pending",
        table_name="plan_drafts",
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.drop_index("ix_plan_drafts_user_id_created_at", table_name="plan_drafts")
    op.drop_table("plan_drafts")
