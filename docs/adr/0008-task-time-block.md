# ADR-0008: Represent a task's time block as start plus duration, with a generated end

**Status:** Accepted — mechanism superseded by [ADR-0013](0013-derive-end-at-with-a-trigger.md)
**Date:** 2026-08-11
**Deciders:** Gabriel Barros

> **Correction.** This record claims `timestamptz + interval` is `IMMUTABLE` and uses that to
> justify a generated column. The claim is false: the operator is `STABLE`, and PostgreSQL
> rejected the migration. What is stored is unchanged; `end_at` is maintained by a trigger.
> See [ADR-0013](0013-derive-end-at-with-a-trigger.md).

## Context

Every task occupies a block of time. Two queries depend on how that block is stored, and they
pull in different directions:

- **The capacity query** — the foundation of the whole AI layer
  ([ADR-0004](0004-context-assembly-policy.md)) — sums occupied minutes per day.
- **Overlap detection** — whether two tasks collide — needs a range.

One product fact decides which value is primary: by
[ADR-0005](0005-structured-output-contract.md), the AI returns an **estimated duration** per
item and no dates. The scheduler assigns the start. Duration is therefore the value the system
receives, and the start is the value it computes.

Instants are `timestamptz` per [ADR-0009](0009-time-and-timezone-storage.md).

## Decision

```
start_at         timestamptz  NOT NULL
duration_minutes integer      NOT NULL CHECK (duration_minutes > 0)
end_at           timestamptz  GENERATED ALWAYS AS
                              (start_at + duration_minutes * interval '1 minute') STORED
```

Overlap is forbidden by the schema rather than remembered by a service:

```sql
EXCLUDE USING gist (user_id WITH =, tstzrange(start_at, end_at) WITH &&)
```

## Options Considered

### Option A: `start_at` and `end_at`, both stored

**Pros:** overlap works directly on a range; no generated column.
**Cons:** the capacity sum needs a subtraction per row; duration — the value the AI actually
produces — becomes derived rather than stored, so every write has to convert it first.

### Option B: `start_at` and `duration_minutes` only

**Pros:** simplest; the capacity sum is `SUM(duration_minutes)`.
**Cons:** with no real end column there is no exclusion constraint, so "tasks must not overlap"
becomes an application rule — the kind that is forgotten on the third code path.

### Option C: `start_at`, `duration_minutes`, generated `end_at` — chosen

**Pros:** the capacity sum stays a plain `SUM` over an integer column; duration is stored in the
form it arrives in; and the exclusion constraint becomes available because `end_at` is a real
stored column. `timestamptz + interval` is `IMMUTABLE`, so it is legal in a generated
expression — unlike `AT TIME ZONE`, which is why ADR-0009 could not materialise a local date.
**Cons:** one derived column to explain; requires the `btree_gist` extension for the exclusion
constraint.

## Trade-off Analysis

Option C is not a compromise between A and B — it takes the primary value from B and the
constraint capability from A, and pays only the cost of a database-maintained column. Because
PostgreSQL generates `end_at`, it cannot drift, which is the objection that ruled out
hand-maintained denormalisation in ADR-0009. The distinction is immutability of the expression,
and it is the same test in both records.

Pushing overlap into an exclusion constraint matters more than it looks. The S1 checklist
requires constraints in the schema rather than only in Python, and overlap is the one business
rule here that the database can enforce absolutely.

## Consequences

**Easier**
- Capacity aggregation is an integer sum over an indexed range.
- Overlapping tasks are impossible, in any code path, including a bad migration or a manual
  `INSERT`.

**Harder**
- `btree_gist` must be enabled by the first migration.
- The exclusion constraint will reject writes that the application thought were fine, so the
  violation must be mapped to a readable domain error rather than surfacing as a raw driver
  exception.

**To revisit**
- If tasks ever need to be allowed to overlap — for example a task representing an all-day
  context rather than a booked block. That would be a product decision with its own record.

## Action Items
1. [ ] Enable `btree_gist` in the first migration.
2. [ ] `CHECK (duration_minutes > 0)`; decide whether an upper bound is also wanted.
3. [ ] Map the exclusion violation to a domain error, in the one place errors are translated.
4. [ ] Test the constraint directly: two overlapping inserts must fail at the database.

---

## Português

**Decisão:** `start_at` mais `duration_minutes`, e `end_at` como **coluna gerada** pelo banco.
Sobreposição proibida por constraint de exclusão GiST, não por regra de serviço.

**Por que duração é o valor primário:** pelo ADR-0005 a IA devolve duração estimada e nenhuma
data; o agendador atribui o início. Duração é o que o sistema recebe.

**Por que `end_at` pode ser gerada e `local_date` não podia:** `timestamptz + interval` é
`IMMUTABLE`; `AT TIME ZONE` é `STABLE`. É o mesmo teste nos dois ADRs, com respostas opostas —
e é por isso que aqui não há risco de divergência.

**Custo aceito:** precisa da extensão `btree_gist`, e a violação da constraint tem que ser
traduzida para erro de domínio legível em vez de vazar exceção do driver.
