"""tags and schema constraints

Three changes that all move a rule from the application into the schema: tags become rows,
checklist positions become unique, and email uniqueness moves onto the normalised value.

Revision ID: 0006
Revises: 0005
Create Date: 2026-08-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tags",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=50), nullable=False),
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
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_tags_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_tags")),
        sa.UniqueConstraint("user_id", "name", name=op.f("uq_tags_user_id_name")),
    )

    op.add_column("tasks", sa.Column("tag_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        op.f("fk_tasks_tag_id_tags"), "tasks", "tags", ["tag_id"], ["id"], ondelete="SET NULL"
    )

    # Deferred to commit, so a reorder is one batch update rather than a shuffle through
    # temporary values (ADR-0020).
    op.create_unique_constraint(
        op.f("uq_checklist_items_task_id_position"),
        "checklist_items",
        ["task_id", "position"],
        deferrable=True,
        initially="DEFERRED",
    )

    # Uniqueness moves onto the normalised value. The plain constraint accepted a case
    # variant as a different address, which the service happened to prevent and the schema
    # did not. Creating the index fails if such a pair already exists, which is the right
    # outcome: it means data that has to be reconciled by a person, not silently by a
    # migration.
    op.drop_constraint(op.f("uq_users_email"), "users", type_="unique")
    op.create_index("uq_users_email_lower", "users", [sa.text("lower(email)")], unique=True)


def downgrade() -> None:
    op.drop_index("uq_users_email_lower", table_name="users")
    op.create_unique_constraint(op.f("uq_users_email"), "users", ["email"])
    op.drop_constraint(
        op.f("uq_checklist_items_task_id_position"), "checklist_items", type_="unique"
    )
    op.drop_constraint(op.f("fk_tasks_tag_id_tags"), "tasks", type_="foreignkey")
    op.drop_column("tasks", "tag_id")
    op.drop_table("tags")
