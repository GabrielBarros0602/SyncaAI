"""Tests that the schema says what the architecture decisions require.

These assert on rendered DDL rather than on a live database, so they run anywhere and
cost nothing. They exist because the first version of the exclusion constraint compiled
the column names as string literals — ``tstzrange('start_at', 'end_at')`` — which
PostgreSQL would have rejected at migration time rather than at review time.

Two of these tests assert the *absence* of a column. That is deliberate: ADR-0010 and the
ownership rule in the models docstring are both about not storing the same fact twice, and
an assertion is a more durable guard than a note asking a reviewer to check.
"""

from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateIndex, CreateTable

from syncaai.models import ChecklistItem, Day, Tag, Task, User


def _ddl(model: type) -> str:
    return str(CreateTable(model.__table__).compile(dialect=postgresql.dialect()))


def test_task_end_is_owned_by_the_database_not_the_orm() -> None:
    """A trigger writes end_at, so the ORM must never include it in an INSERT.

    It cannot be a generated column: PostgreSQL requires those expressions to be
    IMMUTABLE and timestamptz + interval is STABLE (ADR-0013).
    """
    end_at = Task.__table__.columns["end_at"]

    assert end_at.server_default is not None
    assert not end_at.nullable
    assert "GENERATED ALWAYS AS" not in _ddl(Task)


def test_task_duration_is_bounded_to_one_day() -> None:
    assert "duration_minutes > 0 AND duration_minutes <= 1440" in _ddl(Task)


def test_task_overlap_constraint_references_columns_not_literals() -> None:
    ddl = _ddl(Task)

    assert "EXCLUDE USING gist (user_id WITH =, tstzrange(start_at, end_at) WITH &&)" in ddl
    assert "tstzrange('start_at'" not in ddl


def test_tasks_do_not_reference_the_days_table() -> None:
    """ADR-0010: a task's day is implied by start_at and is never stored a second time."""
    assert "day_id" not in Task.__table__.columns
    assert not any(fk.column.table.name == "days" for fk in Task.__table__.foreign_keys)


def test_checklist_items_do_not_duplicate_the_owner() -> None:
    """Ownership is stored once, on the task. Scoping a child query is a join."""
    assert "user_id" not in ChecklistItem.__table__.columns


def test_a_day_is_unique_per_user_and_local_date() -> None:
    assert "CONSTRAINT uq_days_user_id_local_date UNIQUE (user_id, local_date)" in _ddl(Day)


def test_capacity_query_index_exists_on_owner_and_start() -> None:
    index_columns = {
        index.name: [c.name for c in index.columns] for index in Task.__table__.indexes
    }

    assert index_columns["ix_tasks_user_start_at"] == ["user_id", "start_at"]


def test_deleting_a_user_cascades_in_the_schema() -> None:
    """Only the foreign keys that point at a user. A task also points at a tag, and that
    one deliberately clears instead of cascading."""
    for model in (Day, Task, Tag):
        to_users = [fk for fk in model.__table__.foreign_keys if fk.column.table.name == "users"]
        assert [fk.ondelete for fk in to_users] == ["CASCADE"], model.__tablename__

    assert {fk.ondelete for fk in ChecklistItem.__table__.foreign_keys} == {"CASCADE"}


def test_email_is_unique_on_the_normalised_value() -> None:
    """On lower(email), not on the column.

    A plain constraint accepts a case variant as a different address, which the service
    happens to prevent and the schema did not. lower() is IMMUTABLE, so unlike the local
    date in ADR-0009 this one can be indexed.
    """
    index = next(i for i in User.__table__.indexes if i.name == "uq_users_email_lower")

    assert index.unique
    assert "lower(email)" in str(CreateIndex(index).compile(dialect=postgresql.dialect()))
    assert "UNIQUE (email)" not in _ddl(User)


def test_checklist_positions_are_unique_within_a_task() -> None:
    """Deferred, so a reorder is a batch update rather than a shuffle (ADR-0020)."""
    ddl = _ddl(ChecklistItem)

    assert "UNIQUE (task_id, position) DEFERRABLE INITIALLY DEFERRED" in ddl


def test_a_task_keeps_its_tag_optional_and_loses_it_rather_than_cascading() -> None:
    """Losing a task because its label was removed would be the wrong loss."""
    tag_fk = next(fk for fk in Task.__table__.foreign_keys if fk.column.table.name == "tags")

    assert Task.__table__.columns["tag_id"].nullable
    assert tag_fk.ondelete == "SET NULL"


def test_a_tag_belongs_to_one_user_and_is_unique_for_them() -> None:
    assert "CONSTRAINT uq_tags_user_id_name UNIQUE (user_id, name)" in _ddl(Tag)
