# ADR-0030: A plan is placed in real free time, reviewed item by item, and committed whole

**Status:** Accepted; amended by
[ADR-0033](0033-a-plan-fills-this-week-first-in-its-own-language-one-at-a-time.md) — a default
horizon, this week first, the life of an unreviewed draft, and one plan at a time — and by
[ADR-0049](0049-a-step-that-waits-for-itself-loses-only-that.md), which drops a dependency on
itself instead of discarding the step
**Date:** 2026-10-23
**Deciders:** Gabriel Barros

**Amends:** decision 1 of [ADR-0005](0005-structured-output-contract.md), which has the
scheduler assign each item "to a date". It assigns a start time. The rest of ADR-0005 — the
model decomposes and the code schedules, two validation layers, one repair, salvage only
where a person reviews — stands, and this record fills in what it left open. It builds on the
draft of [ADR-0002](0002-mvp-scope-ai-features.md), the path of
[ADR-0003](0003-ai-request-lifecycle.md), the window of
[ADR-0029](0029-the-usable-day-is-a-window-each-person-sets.md) and the preferences of
[ADR-0032](0032-days-off-and-a-preferred-block-length.md).

## Context

ADRs 0002 to 0006 designed the plan pipeline before any of it existed, and they stop short of
the points where it meets the calendar:

- **Where in a day an item goes.** A task needs a start time, and ADR-0005 only said "a date".
- **What an approved task keeps of its plan.**
- **Where the links and materials the model suggests are stored.**
- **What the review can change before approving.**
- **How large a request and a plan may be.**

Each was answered on 2026-10-23.

## Decision

### 1. The contract the model fills

A Pydantic model, with the provider's JSON schema generated from it, so there is one source.
Flat, as ADR-0005 asks: a plan holds items, and an item holds links, and nothing nests further.

| Field | Shape |
|---|---|
| `items` | 1 to 12 |
| `items[].title` | text |
| `items[].description` | text, up to 500 characters |
| `items[].estimated_minutes` | integer |
| `items[].depends_on` | positions of earlier items in the list |
| `items[].links` | up to 3 of `{label, url}` |

**Layer 1, the schema,** checks types, required fields and array bounds. A response that
fails it is not a plan at all.

**Layer 2, the domain,** checks each item on its own. An item fails when any of these is
true:
- its title is blank, longer than a task title can be, or repeats another's title, ignoring
  case;
- its minutes fall outside 15 to the person's preferred block (ADR-0032), which is at most
  240;
- a dependency points at itself or later;
- a link is not an absolute `http` or `https` URL, or has a blank label.

Because the errors belong to items, the ladder of ADR-0005 can salvage: a failed item is
discarded with its reasons and the rest of the plan stays.

**Dependencies only point backwards,** so the order of the list is already a valid order and
no cycle can be expressed. ADR-0005's "acyclic" becomes a property of the shape instead of a
check. When a prerequisite is discarded, the constraint goes with it and the dependent item
stays: it is still a step worth doing, and nothing is left to order it against.

### 2. The request

The request is text from 1 to 500 characters, plus a horizon of 1 to 14 days starting today
(the window ADR-0004 named). These limits are deliberately conservative:
- twelve items still make a review somebody actually reads;
- a bounded output is what lets S7 estimate the cost before the call.

### 3. Each item gets a real start time

The scheduler is a pure function: the day slots and the items go in, placements come out.
The slots are built from the database; titles are never read for this, and the model never
sees them (ADR-0004).

**For each day of the horizon that is not a day off,** there are two limits, and an item has
to fit inside both:

| Limit | What it is | Why it is needed |
|---|---|---|
| the free intervals | the usable window (ADR-0029), minus every occupied range (ADR-0022), minus the past | a 45-minute item needs 45 contiguous minutes; 90 free minutes in three pieces of 30 do not hold it |
| the free minutes left | `usable − occupied`, as the capacity query reports it | a task booked outside the window still spends the day's budget, and without this limit the plan could make a day heavy |

**Items are placed in list order, first fit** (ADR-0005's v1). Each one goes at the earliest
start that satisfies all of these:
- it is on a five-minute mark;
- it is after now;
- it is after every placed prerequisite ends;
- the item fits there whole, inside both limits.

**An item that fits nowhere, or whose prerequisite was not placed, stays unplaced**, with its
reason. The draft shows it, and the review can place it by hand.

### 4. The draft, and a review that can change it

`plan_drafts` holds the owner, the request, the status (`pending`, `approved`, `discarded`),
the `prompt_version` and the job that produced it. `draft_items` holds, per item:
- its position, title, description, links and minutes;
- its start, which is null while unplaced;
- for a discarded item, the reasons it was discarded, kept so the review can say "9 items, 3
  discarded" honestly.

**The items are a resource of the draft**, as the checklist is of a task (ADR-0028). An item's
title, minutes and start can change, and an item can be removed.

A new start is checked when it is set, against the same rules a task is created under:
- it is in the future;
- the item lasts at most one day;
- it overlaps no task and no other placed item of the same draft.

That way the review cannot build a plan that will fail to commit.

### 5. What a task keeps of its plan

`tasks.plan_id` is a nullable reference to the draft, `ON DELETE SET NULL`. It is what the
"3 of 5 done" view of ADR-0002 counts, and what lets S7 measure how much of a plan was carried
out. Deleting a draft never deletes a task.

The note is written by code, never copied from the model: the description, then a `Links`
list of `label — url`, each URL already validated. By construction it fits the note's
4000-character bound.

### 6. Commit is one transaction, all or nothing

`POST /plans/{id}/commit` carries an `Idempotency-Key` header. In one transaction:
- every kept, placed item becomes a task with the draft's `plan_id`;
- the draft becomes `approved`;
- the key is stored on the draft.

**It refuses, and writes nothing,** when:
- an item is still unplaced: place it or remove it first;
- a start has passed since the draft was made;
- a start overlaps a task booked since then. The exclusion constraint is the final word, as
  everywhere else.

The answer names each item and its reason.

**A repeat with the same key** answers the result of the first commit. Any other commit of an
approved or discarded draft answers 409.

## Options Considered

### Where an item goes (answered on 2026-10-23)

| Option | Assessment |
|--------|------------|
| **A concrete start time — chosen** | The draft shows exactly what will happen, and every item is already a valid task. It is the only reading under which the aggregate does not lie about fragmentation. |
| A day only, the time chosen at commit | Less code now. The draft promises days an item may not fit into, and the person learns it only when approving. |

### What a task keeps of its plan (answered on 2026-10-23)

| Option | Assessment |
|--------|------------|
| **`plan_id` on the task — chosen** | One nullable column. It enables the progress view and the S7 measure. Adding it later would mean guessing where the existing tasks came from. |
| Nothing | No schema change, and no way to ever say "3 of 5". |

### Where links live (answered on 2026-10-23)

| Option | Assessment |
|--------|------------|
| **The note, written by code — chosen** | A field that exists and already has a screen. The model's text never reaches the database except through validated fields. |
| A resources table | Queryable per link, but it is a table, routes and a screen nobody designed, for data that is only read. |

### What the review can change (answered on 2026-10-23)

| Option | Assessment |
|--------|------------|
| **Items as a resource, now — chosen** | It is what makes the model's output a proposal and not a verdict. It is back-end, so the redesign cannot invalidate it, and it follows ADR-0028's pattern. |
| Approve or discard the whole draft | Fewer routes. It turns the review into all or nothing, which is the case ADR-0005 used to justify salvage in the first place. |

### Limits (answered on 2026-10-23)

| Option | Assessment |
|--------|------------|
| **500 characters, 12 items, 14 days, 15–240 minutes — chosen** | A review a person reads, and an output size the cost estimate can bound. |
| 2000 characters, 25 items, 30 days | Larger plans, a longer review, and more than double the maximum output S7 has to budget for. |

## Trade-off Analysis

**A draft can go stale.** The draft is made at one moment and approved at another, and in
between the time can be booked or pass. The commit checks again and refuses with reasons
rather than guessing a new slot: moving somebody's plan without asking is the model's job
being done by stealth.

**First fit fills the earliest days.** It packs the plan forward instead of spreading it
across the horizon. ADR-0005 chose that for v1 and asked for a measured reason before
anything smarter, and the free-minutes limit is what stops it from making those early days
heavy.

**The five-minute mark costs up to four minutes per item,** in exchange for starts a person
reads as a plan rather than as arithmetic, such as 14:20 instead of 14:17:42.

**The scheduler reads real occupancy, and the model still sees only aggregates.** Both hold
because the scheduler is our code. ADR-0004 kept semantic and arithmetic work in application
code precisely so this would be possible.

## Consequences

**Easier**
- Approving a draft creates valid tasks, or says exactly which item would not be one.
- The scheduler and the validator are pure functions over fixtures, the most testable parts
  of the project, as ADR-0005 predicted.
- Plan progress is a count over `plan_id`.

**Harder**
- Two entities, an editable item resource, an idempotent commit, and a column on `tasks`.
- The scheduler needs the occupied ranges for the horizon, which is a query of its own.

**To revisit**
- Spreading instead of packing, once real plans show first fit crowding the first days.
- Whether unplaced items should be offered a slot automatically during review.

## Action Items

1. [ ] The response model, its generated schema, and the per-item domain validation.
2. [ ] The scheduler as a pure function, with the boundaries first: no free day, an item
       larger than every slot, a prerequisite that does not fit, the budget limit binding
       before the window does.
3. [ ] `plan_drafts`, `draft_items`, and `tasks.plan_id`.
4. [ ] The editable item resource, checked against the creation rules.
5. [ ] The commit, all or nothing, idempotent by key.

---

## Português

**O problema.** Os ADRs 0002 a 0006 desenharam o pipeline do plano antes de ele existir, e
pararam antes dos pontos em que ele encosta no calendário.

**A decisão.**
- **O contrato:** de 1 a 12 itens, cada um com título, descrição, minutos, dependências e até 3
  links. A segunda camada valida item por item, e é isso que permite salvar o resto quando um
  falha. As dependências só apontam para trás, então ciclo nem pode ser escrito.
- **O agendador** põe cada item num horário concreto, num dia que não é folga. O item tem que
  caber num intervalo livre real da janela do dia útil e nos minutos livres que restam no dia,
  para o plano nunca deixar um dia pesado. Primeiro encaixe, em marcas de 5 minutos, depois de
  agora e depois dos pré-requisitos. O que não couber fica sem lugar, com o motivo.
- **O rascunho** tem itens editáveis: título, minutos e horário, revalidados contra as regras
  de criar tarefa, além de remover. A tarefa aprovada guarda o `plan_id`.
- **Os links** vão para a nota da tarefa, escritos pelo código.
- **O commit** é uma transação, tudo ou nada, com `Idempotency-Key`. Se um horário passou ou
  foi tomado, recusa dizendo qual item e por quê.
- **Os limites:** 500 caracteres, 12 itens, 14 dias, de 15 a 240 minutos por item.

**Opções descartadas.**
- **Só o dia:** o rascunho prometeria o que pode não caber.
- **Sem `plan_id`:** o "3 de 5" não teria de onde sair.
- **Tabela de recursos:** estrutura sem tela.
- **Aprovar ou descartar inteiro:** revisão de tudo ou nada.
- **Limites folgados:** revisão longa e custo menos previsível.
