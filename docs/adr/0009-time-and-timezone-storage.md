# ADR-0009: Store instants in UTC and derive the local day

**Status:** Accepted
**Date:** 2026-08-11
**Deciders:** Gabriel Barros

## Context

SyncaAI is a calendar. Two different questions have to be answerable about the same task:

- *When did it happen?* — an instant, comparable and orderable across zones.
- *Which day is it on?* — a local calendar date, which is what the agenda, the heatmap and the
  capacity query group by.

A local date is not derivable from an instant without the user's timezone, and an instant is
not derivable from a local wall-clock time without it either. So the timezone has to live
somewhere explicitly.

One point of PostgreSQL semantics decides most of this, and it is widely misread:
**`timestamptz` does not store a timezone.** It stores a UTC instant and converts on input and
output using the session `TimeZone`. `timestamp` without time zone stores wall-clock with no
instant meaning at all.

## Decision

Store instants as `timestamptz`. Store the user's IANA zone name on `User.timezone`.
Do **not** materialise a local date column.

To query a local window, compute the corresponding UTC range at the edge from the user's zone
and use a range predicate:

```sql
WHERE user_id = $1 AND start_at >= $2 AND start_at < $3
```

That uses an ordinary `(user_id, start_at)` index. Grouping by local date happens after the
filter, over the rows the range already narrowed.

## Options Considered

### Option A: `timestamptz` only, local day derived — chosen

**Pros:** one source of truth; nothing can drift; daylight saving handled by PostgreSQL;
changing a user's timezone changes every derived answer immediately and correctly, because
nothing was precomputed.
**Cons:** day grouping lives in queries rather than in a column. A local-date expression cannot
be indexed, so windows must be expressed as UTC ranges — which is a discipline, not a
limitation.

### Option B: `timestamptz` plus a materialised `local_date`

**Pros:** `(user_id, local_date)` makes grouping and filtering directly indexable.
**Cons:** the column cannot be a generated column, because `AT TIME ZONE` is `STABLE` and not
`IMMUTABLE` — timezone definitions can change. So it must be maintained by application code or
a trigger, and hand-maintained denormalisation drifts. Worse, changing a user's timezone
invalidates every stored row and requires a backfill.

### Option C: naive `timestamp` holding local wall-clock time

**Pros:** what the user typed is what is stored; `start_at::date` groups trivially.
**Cons:** the value has no instant meaning. Durations crossing a daylight-saving boundary are
wrong, global ordering is meaningless, and there is no way to compute when a reminder should
fire. This is the classic calendar trap.

## Trade-off Analysis

Option B trades a correctness liability for an index that this workload does not need. The
heaviest read is the year-long heatmap: for a single user that is a few thousand rows, one
indexed range scan, then an aggregation. The index advantage is real and irrelevant at this
scale; the drift risk is real and permanent.

Option A's cost is that "which local day is this" becomes a computation rather than a column.
That computation belongs at the edge anyway, next to the user's zone, which is where the
context assembler in [ADR-0004](0004-context-assembly-policy.md) already works.

This supersedes the suggestion in the roadmap that both representations would probably be
needed. They are not.

## Consequences

**Easier**
- No backfill when a user changes timezone.
- Daylight saving correctness is PostgreSQL's problem, not the application's.
- One representation to reason about in every query.

**Harder**
- Every query over a local window must convert that window to a UTC range first. A single
  helper should own this so it is not reimplemented per query.
- Grouping by local date requires passing the zone into the query.

**To revisit**
- If a measured aggregation over a multi-year window becomes slow. The trigger is a measurement,
  not a suspicion.

## Action Items
1. [ ] `User.timezone` as a non-null IANA zone name, defaulting to `America/Sao_Paulo`.
2. [ ] One helper converting (local date range, zone) into a UTC range; used by every windowed
       query.
3. [ ] Index `(user_id, start_at)`.
4. [ ] Test the conversion helper across a daylight-saving boundary.

---

## Português

**Decisão:** instantes em `timestamptz`, zona IANA em `User.timezone`, e **nenhuma coluna de
data local materializada**. Janela local é convertida para intervalo UTC na borda e filtrada
por predicado de range, que usa índice normal.

**Por que não materializar:** `local_date` não pode ser coluna gerada, porque `AT TIME ZONE` é
`STABLE` e não `IMMUTABLE`. Seria denormalização mantida à mão — e trocar o fuso do usuário
invalidaria todas as linhas.

**Por que não `timestamp` ingênuo:** perde o significado de instante. Duração atravessando
horário de verão erra, ordenação global não vale, e notificação fica impossível de calcular.

Isto supersede a sugestão do roteiro de que precisaríamos das duas representações.
