# ADR-0037: A draft is held in five tables, and only an approved one stays

**Status:** Accepted; a draft's job and prompt made optional, for a plan written by hand, by
[ADR-0047](0047-a-plan-can-be-written-by-hand-in-the-same-draft.md)
**Date:** 2026-10-23
**Deciders:** Gabriel Barros

**Builds on:** [ADR-0030](0030-a-plan-is-placed-in-real-free-time-reviewed-and-committed-whole.md)
§4 and §5, which named `plan_drafts`, its items and `tasks.plan_id`;
[ADR-0033](0033-a-plan-fills-this-week-first-in-its-own-language-one-at-a-time.md), which added
the `expired` status, the week a draft fills first, and one pending draft per person; and
[ADR-0035](0035-repair-whenever-a-step-fails-and-keep-the-better-answer.md), which keeps the
discarded steps with their reasons. Supersedes nothing.

## Context

Those records say what a draft holds. Writing it as a schema raised four questions they did not
answer:

- how long a draft that was never approved is kept;
- how the dependencies between items survive an edit that removes one of them;
- whether a step's description and links are kept as they came, or as the note they will become;
- where the discarded steps live.

Answered on 2026-10-23, each with a scenario: a draft for a job interview that is discarded; a
chain of three steps whose middle one is removed in review; a step with two links; and a review
that says "9 items, 3 discarded".

## Decision

### 1. Five tables

| Table | One row per | Holds |
|---|---|---|
| `plan_drafts` | draft | the owner, the job (one draft per job), the request, the status, the `prompt_version`, the horizon's first and last day, the commit's idempotency key, and when it ended |
| `plan_draft_items` | step that can become a task | position, title, description, minutes, start, and how it was placed |
| `plan_draft_item_prerequisites` | dependency | the item, its prerequisite, and the draft both belong to |
| `plan_draft_item_links` | link | position (0 to 2), label, URL |
| `plan_draft_discards` | discarded step | its position in the answer, its title, its reasons |

`tasks.plan_id` references the draft, `ON DELETE SET NULL`, as ADR-0030 decided.

### 2. Only an approved draft outlives thirty days

A draft that was discarded or expired is deleted, whole, thirty days after it ended. That is the
same clock as its job (ADR-0031, ADR-0036). The job's purge promises that nothing the person
wrote survives thirty days, and a copy of the request kept on the draft would break that promise.

An approved draft stays. Its tasks point at it, and its request is the plan's name in "3 of 5
done" (ADR-0002).

`ended_at` is set exactly when a draft leaves `pending`, and the thirty days count from it.

### 3. Dependencies are rows, held to their draft

`plan_draft_item_prerequisites` has a composite foreign key on both sides, `(draft_id, item_id)`
and `(draft_id, prerequisite_id)`, against a unique `(draft_id, id)` on the items. The database
therefore refuses a dependency between items of different drafts. `ON DELETE CASCADE` applies
ADR-0030's rule on its own: when a prerequisite is removed in review, the constraint goes with it
and the dependent step stays, whichever code path removed it.

Only the draft's creation writes dependencies, from an answer whose dependencies point
backwards (ADR-0030), so no cycle can be written. A review can remove a dependency, by removing
its prerequisite, and never add one.

### 4. Description and links are kept as they came

The description is a column, and the links are rows, at most three, each with a label and an
`http` or `https` URL. A `CHECK` holds the scheme, which is the part that matters (ADR-0030):
`javascript:` in a note is a script, not a resource. The note is written at commit by
`note_for`, as ADR-0030 already says. The review screen, still to be designed in the third
round, gets links as links.

### 5. Discarded steps are a table of their own

`plan_draft_items` holds only what can become a task. No query for commit, re-placing or edits
has to remember to leave a discarded step out, and the items' `CHECK`s apply to every row
without conditions.

### 6. What each row holds about itself

- **A draft:** `pending`, `approved`, `discarded` or `expired`; `ended_at` exactly when not
  pending; the idempotency key exactly when approved; at most fourteen days of horizon; one
  pending draft per person, by a partial unique index (ADR-0033).
- **An item:** how it was placed is one of `placed`, `no_room`, `not_this_week` or
  `after_unplaced`, and it has a start exactly when placed. Its minutes are a task's (1 to 1440),
  not the model's: the block bounds what the model proposes, never what the person edits
  (ADR-0032).
- **Whether a start has passed** is not stored. It is read against the clock when the draft is
  read (ADR-0033).
- **Two placed items of one draft overlapping** is refused by the service when a start is set.
  The database would need a trigger-kept end for it, as tasks have (ADR-0013). At commit, the
  tasks' exclusion constraint has the final word, as everywhere else.

## Options Considered

### How long an unapproved draft lives

| Option | Assessment |
|---|---|
| **Deleted thirty days after it ends — chosen** | The job's purge keeps its promise. Thirty days to investigate a complaint. How many plans are discarded is still counted from the jobs, without content. |
| Kept forever | Lets anyone measure what is discarded and why. The request the job's purge deleted survives whole on the draft, so the purge protects nothing. |
| Deleted when discarded | Leanest. A mistaken discard cannot be undone, and the raw answers keep the same steps for thirty days anyway. |

### Dependencies

| Option | Assessment |
|---|---|
| **A table, with composite keys — chosen** | Same-draft is held by the keys, and removing a prerequisite removes its constraint by cascade. One more table and a join. |
| An array of ids on the item | Simple to read. Nothing checks the array: a removed item stays in its dependants' arrays unless the code remembers to take it out. |
| The model's positions | No translation. Every removal shifts the positions after it, and a renumbering mistake links a step to the wrong prerequisite without an error. |

### Description and links

| Option | Assessment |
|---|---|
| **Kept as they came, the note written at commit — chosen** | The database holds "at most three" and the scheme, by ADR-0036's reasoning. The redesign is free to show links however it likes. |
| The note written when the draft is made | One column, and the review shows exactly what the task will get. The screen can only find the links by parsing text, and the redesign is tied to that format. |

### Discarded steps

| Option | Assessment |
|---|---|
| **Their own table — chosen** | Nothing to filter, and unconditional `CHECK`s. One small table more. |
| Flagged rows among the items | One table fewer. Every query needs a filter, the checks become conditional, and a forgotten filter commits a discarded step. |

## Trade-off Analysis

**Five tables for one draft is the cost, and each one exists because the database can then hold
a rule.** A third link, a cross-draft dependency, a `javascript:` URL, a placed step without a
start, and a second pending draft are each refused by the database itself. The alternative in
every case was a rule the code has to remember on every path, which is the kind of rule this
project has learned to distrust.

## Consequences

**Easier**
- Commit, re-place and edit read the items with no filter.
- A review's removal cannot leave a dangling dependency.
- No copy of a request outlives the thirty days, unless the person approved the plan.

**Harder**
- Assembling a draft for the API is a read across five tables.
- Overlap between a draft's own items is the service's to check, until commit.

**To revisit**
- Overlap between draft items held by the database, if a trigger-kept end becomes worth it.

## Action Items

1. [ ] The five tables and `tasks.plan_id`, by migration, with every `CHECK`, key and index
       above.
2. [ ] The worker writes a draft and its job's answers in one transaction.
3. [ ] The purge deletes discarded and expired drafts thirty days after they end.

---

## Português

**O problema.** As ADRs 0030, 0033 e 0035 dizem o que um rascunho guarda, mas não dizem por
quanto tempo, nem como as dependências sobrevivem a uma edição, nem como ficam os links, nem
onde ficam os itens descartados.

**A decisão.**
- **Cinco tabelas:** o rascunho, os itens, os pré-requisitos, os links e os descartados, além
  do `tasks.plan_id`.
- **Só o rascunho aprovado dura.** O descartado e o expirado são apagados 30 dias depois de
  terminar, no mesmo relógio do job, para que nenhuma cópia do pedido sobreviva ao expurgo.
- **As dependências são linhas com chave composta,** então o banco recusa dependência entre
  rascunhos diferentes. Remover um pré-requisito apaga a restrição em cascata.
- **A descrição e os links ficam como vieram,** com no máximo três links e um CHECK no esquema
  `http`/`https`. A nota só é escrita no commit.
- **Os descartados têm tabela própria,** então nenhuma consulta precisa filtrá-los.

**O que se aceita.** São cinco tabelas para um rascunho, e cada uma existe porque assim o banco
consegue segurar uma regra.
