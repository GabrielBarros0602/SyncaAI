# ADR-0013: Derive `end_at` with a trigger, not a generated column

**Status:** Accepted
**Date:** 2026-08-14
**Deciders:** Gabriel Barros
**Supersedes:** the mechanism chosen in [ADR-0008](0008-task-time-block.md)

## Context

[ADR-0008](0008-task-time-block.md) decided that a task stores `start_at` and
`duration_minutes`, with `end_at` materialised so that a GiST exclusion constraint can
forbid overlapping tasks. It specified a **generated column** for `end_at`, justified by the
claim that `timestamptz + interval` is `IMMUTABLE` — and contrasted this with ADR-0009,
where `AT TIME ZONE` being `STABLE` was the reason a local date could not be generated.

That claim was wrong. PostgreSQL rejected the migration:

```
psycopg.errors.InvalidObjectDefinition: generation expression is not immutable
```

`timestamptz + interval` is `STABLE`, not `IMMUTABLE`. Interval arithmetic on a
`timestamptz` consults the session time zone, because adding an interval across a daylight
saving transition does not produce a fixed offset. Volatility is declared per function
signature, so it makes no difference that the interval here contains only minutes.

The error was found by CI applying the migration to a real PostgreSQL, which is the check
that existed precisely because the claim could not be verified where it was written.

## Decision

Keep everything ADR-0008 decided about *what* is stored. Change only *how* `end_at` is
maintained:

```sql
CREATE FUNCTION tasks_set_end_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.end_at := NEW.start_at + NEW.duration_minutes * interval '1 minute';
    RETURN NEW;
END;
$$;

CREATE TRIGGER tasks_set_end_at
BEFORE INSERT OR UPDATE ON tasks
FOR EACH ROW EXECUTE FUNCTION tasks_set_end_at();
```

The trigger fires on every insert and update rather than only when `start_at` or
`duration_minutes` change, so `end_at` cannot be set by hand and cannot drift.

## Options Considered

### Option A: trigger — chosen

**Pros:** trigger functions carry no immutability requirement, so the `STABLE` operator is
allowed. Every guarantee from ADR-0008 survives: duration stays the stored primary value,
the capacity sum stays `SUM(duration_minutes)`, and the exclusion constraint operates on two
plain stored columns.
**Cons:** less declarative than a generated column, and invisible in the ORM model — the
rule lives only in the migration, so a reader of `models.py` has to be told it exists.

### Option B: store `start_at` and `end_at`, drop `duration_minutes`

**Pros:** no derivation at all, so no trigger and no immutability question.
**Cons:** reverses ADR-0008's central reasoning. The AI returns durations
([ADR-0005](0005-structured-output-contract.md)), so every write would convert first, and
the capacity query would subtract per row instead of summing an integer.

### Option C: store both, with a `CHECK` that they agree

**Pros:** keeps duration and end explicit, with a declared invariant.
**Cons:** a `CHECK` would contain the same `STABLE` expression that was just rejected. It
trades one immutability problem for the same one in a different clause.

## Trade-off Analysis

The decision is narrow because the failure was narrow: a factual error about one operator's
volatility, not a flaw in the design. Options B and C both react by reopening the storage
question, which the error gives no reason to reopen.

What the trigger costs is legibility. A generated column announces itself in the schema and
in the model; a trigger does not. That is answered with tests rather than comments —
`test_task_end_is_owned_by_the_database_not_the_orm` asserts the ORM never writes the
column, and two integration tests assert the database actually derives it, including after
an update.

The wider lesson is about the claim, not the mechanism. ADR-0008 stated the immutability of
two operators as established fact and drew a contrast between them, and half of it was
false. Both halves were unverifiable in the environment where they were written. The
migration step in CI was added in the same change that carried the error, and it caught it
before merge — which is the argument for putting unverifiable claims behind an automated
gate rather than behind a promise to check later.

## Consequences

**Easier**
- The migration applies. `end_at` is still database-owned, so it cannot disagree with the
  columns it derives from.

**Harder**
- The derivation is not visible in `models.py`. It is documented there and asserted by
  tests, but a reader who skips both will not find it.
- A future change to how `end_at` is computed means a migration, not a model edit.
- Bulk loading data with `COPY` will fire the trigger per row, which is slower than a
  generated column would have been. Irrelevant at this scale, worth knowing before a backfill.

**To revisit**
- If PostgreSQL ever marks the operator `IMMUTABLE`, or if the schema stops needing
  `end_at` as a real column.

## Action Items
1. [x] Replace the generated column with a trigger in the initial migration.
2. [x] Declare `end_at` as server-populated in the model so the ORM never writes it.
3. [x] Integration tests asserting derivation on insert, derivation after update, and that
       overlapping tasks are rejected per user but allowed across users.
4. [ ] Confirm through CI that PostgreSQL accepts the exclusion constraint — the failure
       happened before that statement was reached, so it remains unproven.

---

## Português

**O que aconteceu:** o ADR-0008 afirmou que `timestamptz + interval` é `IMMUTABLE` e usou
isso para justificar coluna gerada. **A afirmação era falsa** — o operador é `STABLE`, porque
aritmética de intervalo sobre `timestamptz` consulta o fuso da sessão para tratar horário de
verão. O Postgres recusou a migration com `generation expression is not immutable`.

**O que muda:** só o mecanismo. Tudo que o ADR-0008 decidiu sobre *o que* é armazenado
continua — duração como valor primário, `end_at` materializado, sobreposição proibida por
constraint de exclusão. `end_at` passa a ser escrito por um **trigger** `BEFORE INSERT OR
UPDATE`, que não tem exigência de imutabilidade.

**Custo aceito:** a derivação some do `models.py` e passa a viver só na migration. Compensado
com testes, não com comentário: um teste afirma que o ORM nunca escreve a coluna, e dois de
integração afirmam que o banco de fato deriva, inclusive depois de um update.

**A lição não é sobre o mecanismo.** Duas afirmações sobre volatilidade de operador foram
escritas como fato estabelecido, e uma era falsa — as duas sem possibilidade de verificação
no ambiente onde foram escritas. O passo de migration no CI entrou na mesma mudança que
carregava o erro, e pegou antes do merge. É o argumento para colocar afirmação não
verificável atrás de portão automatizado, e não atrás de promessa de conferir depois.
