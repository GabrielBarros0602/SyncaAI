"""The migrated schema against the models, read from PostgreSQL's own catalog.

``alembic check`` compares tables, columns, types and defaults, and a CHECK only by its name.
It does not compare what a CHECK says, what an exclusion constraint excludes, or which rows a
partial index covers: a model changed in any of those without a migration passes it, and the
database keeps enforcing the old rule (the audit of 2026-10-24, item 4).

Here the models are created in a scratch schema, inside a transaction that is rolled back,
and every constraint and index of every table is compared with the migrated one by the
definition PostgreSQL prints for each. Both sides are parsed and printed by the same server,
so how either was spelled does not matter. The trigger that derives ``end_at`` lives only in
a migration, so there is no model to compare it with; its behaviour is tested on its own.
"""

from collections.abc import Iterator

import pytest
from sqlalchemy import Connection, text

from syncaai.db import get_engine
from syncaai.models import Base

pytestmark = pytest.mark.integration

SCRATCH = "model_drift"

CONSTRAINTS = text(
    """
    SELECT c.conname, pg_get_constraintdef(c.oid)
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = :schema AND t.relname = :table
    """
)
INDEXES = text(
    "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = :schema AND tablename = :table"
)


@pytest.fixture
def connection() -> Iterator[Connection]:
    """The migrated schema and, beside it, the one the models describe, gone at the end."""
    with get_engine().connect() as connection:
        transaction = connection.begin()
        connection.execute(text(f"CREATE SCHEMA {SCRATCH}"))
        # Not checkfirst: it would look for each table in the migrated schema, find it, and
        # create nothing here.
        Base.metadata.create_all(
            connection.execution_options(schema_translate_map={None: SCRATCH}),
            checkfirst=False,
        )
        try:
            yield connection
        finally:
            transaction.rollback()


def _definitions(connection: Connection, schema: str, table: str) -> dict[str, str]:
    """Every constraint and index of ``table``, by name, as PostgreSQL prints it, with the
    schema taken out so the two sides can be compared."""
    found: dict[str, str] = {}
    for query, kind in ((CONSTRAINTS, "constraint"), (INDEXES, "index")):
        for name, definition in connection.execute(query, {"schema": schema, "table": table}):
            unqualified = definition.replace(f"{schema}.", "")
            found[f"{kind} {name}"] = unqualified
    return found


@pytest.mark.parametrize("table", sorted(Base.metadata.tables))
def test_the_migrated_table_enforces_what_its_model_declares(
    connection: Connection, table: str
) -> None:
    migrated = _definitions(connection, "public", table)
    modelled = _definitions(connection, SCRATCH, table)

    assert migrated == modelled, (
        f"{table}: the migrations and the models disagree. Only in the migrations: "
        f"{sorted(migrated.items() - modelled.items())}. Only in the models: "
        f"{sorted(modelled.items() - migrated.items())}."
    )
