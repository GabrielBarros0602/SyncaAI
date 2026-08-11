# ADR-0010: A `days` table for day-level state only, not referenced by tasks

**Status:** Accepted
**Date:** 2026-08-11
**Deciders:** Gabriel Barros

## Context

The prototype treats a day as a first-class thing: notes link to a day, the heatmap draws one
square per day, and a streak counts consecutive days. The question is whether a day needs a row
in the database, or whether it is a grouping produced by a query.

An initial framing in the roadmap claimed the table would become necessary in a later sprint,
when notes arrive. **That was wrong and is corrected here.** A note that belongs to a day stores
`user_id` and a local date on itself; the link is a date value, not a foreign key to a day
record. Habit entries are the same. Streaks and the heatmap are aggregations over dates. None of
them require a `days` table.

The table is justified by exactly one thing: state that belongs to the day itself and cannot be
derived from what happened on it. The prototype has one candidate — the heatmap's
`71% marked`. The product decision is that a day can be marked **both** as a consequence of
activity and by an explicit action of the user. The derived half needs no storage. The explicit
half has nowhere else to live.

## Decision

Create a `days` table holding day-level state, keyed by `(user_id, local_date)` with a unique
constraint.

**Tasks do not reference it.** A task's day remains implied by its `start_at`
([ADR-0009](0009-time-and-timezone-storage.md)), and is never stored a second time.

## Options Considered

### Option A: no `days` table; days are query results

**Pros:** nothing to keep in sync; no join; a day costs nothing until something happens on it.
**Cons:** no home for an explicitly marked day, which the product decision requires.

### Option B: `days` table, and tasks reference it via `day_id` — rejected

**Pros:** a task's day is a foreign key, so joining tasks to day-level state is direct.
**Cons:** the task's day would be stored twice — implied by `start_at` and explicit in `day_id` —
and updating `start_at` without updating `day_id` silently produces a task whose day disagrees
with its own timestamp. This is precisely the drift that ADR-0009 rejected a materialised
`local_date` to avoid, reintroduced in a different shape. It also forces a get-or-create of a
day row on every task write.

### Option C: `days` table for day-level state, tasks do not reference it — chosen

**Pros:** the explicit mark has a home; no value is duplicated, so nothing can drift; task
writes are unaffected; joined by `(user_id, local_date)` only when a day attribute is actually
needed, which is rarely.
**Cons:** a table that the minimum scope does not yet read, since the heatmap arrives in S9.
Two ways to reach a day — a row for its own state, an aggregation for its activity — which has
to be understood rather than guessed.

## Trade-off Analysis

Option B is the naive reading of "create the table now", and it quietly contradicts ADR-0009.
Recognising that is the substance of this record: the objection to duplication is not about
timezones specifically, it is about storing the same fact twice in two forms that can disagree.

Between A and C the honest position is that C carries a small cost now — an unread table — in
exchange for not needing an additive migration later. That cost is acceptable because the
product decision is already made: an explicitly marked day is a feature, not a maybe. Had the
answer been "marked is purely derived", A would have been correct and the table would never have
been needed.

Worth stating plainly: an empty table is a mild smell, but unlike a configuration value that
nothing reads, it does not misrepresent behaviour. It is inert until S9.

## Consequences

**Easier**
- Day-level state has a home the moment the heatmap needs it, with no migration mid-sprint.
- Task reads and writes stay free of day bookkeeping.

**Harder**
- The `days` table is written by nothing until S9, so it must not be mistaken for the source of
  a task's day.
- Two access paths to a day have to be documented, or someone will join tasks to `days` and
  assume it filters.

**To revisit**
- How the derived intensity and the explicit mark combine into one heatmap colour. That is a
  product and interface decision for S9, deliberately not settled here.
- Whether `days` accumulates further day-level attributes, such as a daily note.

## Action Items
1. [ ] `days` with `user_id`, `local_date`, `marked_at timestamptz NULL`, unique on
       `(user_id, local_date)`.
2. [ ] No `day_id` on `tasks` — assert this in review, it is the whole point.
3. [ ] Document both access paths in the model docstring.

---

## Português

**Decisão:** tabela `days` para estado **do próprio dia**, única em `(user_id, local_date)`. As
tarefas **não** apontam para ela — o dia da tarefa continua implícito no `start_at`.

**Correção de uma premissa que eu havia passado:** notas e hábitos **não** exigem a tabela. Nota
vinculada a um dia guarda a data nela mesma; o vínculo é um valor, não chave estrangeira. Não
era verdade que a tabela apareceria no S8.

**O que justifica a tabela:** a decisão de produto de que um dia pode ser marcado tanto por
consequência da atividade quanto por ação explícita. A metade derivada não precisa de
armazenamento; a explícita não tem outro lugar.

**Por que sem `day_id` nas tarefas:** guardaria o dia duas vezes, e mudar o `start_at` sem
atualizar o `day_id` produziria tarefa em desacordo com o próprio horário. É a divergência que o
ADR-0009 recusou, em outra forma.

**Pendência de produto para o S9:** a legenda do protótipo diz `Less | More`, ou seja
intensidade. Como intensidade derivada e marca explícita se combinam numa cor só não está
decidido aqui.
