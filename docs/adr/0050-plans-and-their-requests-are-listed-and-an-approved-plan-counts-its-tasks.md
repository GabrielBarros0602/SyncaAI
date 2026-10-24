# ADR-0050: Plans and their requests are listed, and an approved plan counts its tasks

**Status:** Accepted
**Date:** 2026-10-24
**Deciders:** Gabriel Barros

**Amends:** [ADR-0038](0038-a-job-and-its-plan-are-two-resources-linked-by-id.md), whose two
resources were read only by id, with a listing of each. **Builds on:**
[ADR-0020](0020-domain-surface-choices.md), whose pagination the listings use;
[ADR-0033](0033-a-plan-fills-this-week-first-in-its-own-language-one-at-a-time.md), which holds
one plan at a time and reads a plan's status against the clock; and
[ADR-0030](0030-a-plan-is-placed-in-real-free-time-reviewed-and-committed-whole.md) §5, which
put `plan_id` on the task so that "3 of 5 done" could be counted. Supersedes nothing.

## Context

A plan could be read only by whoever already held its id. The job's id comes once, in the
answer to `POST /ai/plans`; the plan's comes from the job. Both lived in the screen's state, so
a reload, a second tab or another device lost them, and with them every way back:

- the job could not be followed, nor the plan reviewed;
- the plan could not be discarded, since discarding takes its id;
- no other plan could be asked for, because one plan at a time refuses while a draft is
  pending, and the refusal names no plan.

The draft only let go once its horizon ended, up to fourteen days later, and only through the
worker's sweep. A plan written by hand needs no worker, so where none ran it never let go.

The "3 of 5 preparations done" of S8 had nothing to read either. A task did not say which plan
it came from, and a plan did not count its tasks. Counting on the screen would count only the
week it shows, and a plan's horizon is two weeks.

Found in the audit of 2026-10-24, before S8, and answered the same day.

## Decision

### 1. `GET /ai/plans` lists the person's plan requests

Newest first, filtered by `status` when given: `queued`, `running`, `done`, `failed`, repeated
for more than one. Paged by `limit` and `offset` as tasks are (ADR-0020), answering
`{items, limit, offset}`, with no total. Each item is what `GET /ai/plans/{job_id}` answers.

`?status=queued&status=running&limit=1` finds the request to follow. `?limit=1` finds the
latest, so a request that failed is still seen after a reload.

### 2. `GET /plans` lists the person's plans

Newest first, paged the same way, filtered by `status` when given: `pending`, `approved`,
`discarded`, `expired`. Each item is what `GET /plans/{plan_id}` answers.

**The status filtered is the status read.** A pending plan whose last day has ended in its
owner's zone reads `expired` (ADR-0033), and it is listed as `expired`, never as `pending`,
whether or not the sweep has recorded it yet. A listing and a read never disagree.

### 3. An approved plan counts its tasks

A plan's read gains `progress`, `{done, total}` for an approved plan and null for any other.
It is counted as it is read, over `tasks.plan_id`: `total` is the plan's tasks that still
exist, and `done` those completed. A deleted task leaves the total; a moved one stays in it.

### 4. A task names its plan

A task's read gains `plan_id`, null for a task not made by a plan, so a task can lead to its
plan and its progress.

The `409` of one plan at a time and `GET /me` stay as they are.

## Options Considered

### How a plan is found without its id

| Option | Assessment |
|---|---|
| **Listings, paged and filtered by status — chosen** | The plan in progress, the latest failure and the history come from the same two routes. Loading takes two requests, and the client relies on ADR-0033 for there being at most one open of each. |
| `GET /plans/current` | One request that mirrors ADR-0033's rule. Nothing else: no history, and a request that failed before a reload is not there. |
| The ids in the `409` and on `/me` | The smallest change. It puts planning state on the person, and the `409` is reached only by trying to make a plan. |
| The ids kept by the screen, in `localStorage` | Lost with another device or a cleared browser, when the server already knows. |

### How progress is read

| Option | Assessment |
|---|---|
| **Counted by the server — chosen** | A two-week plan is counted whole, in one grouped count per page. |
| Only `plan_id` on the task | The screen counts what it loaded, and a week sees part of a two-week plan. |
| Left to S8 | The count does not depend on the design; only where it is shown does. |

### What a listed plan carries

| Option | Assessment |
|---|---|
| **The same shape as reading one — chosen** | One shape to learn, and the pending plan is reviewed from the listing with no second request. A page of history carries every step, bounded by twelve steps a plan and the page size. |
| A summary of each | A lighter history page, and a second request to open the plan in review. |

## Trade-off Analysis

**The open plan is found, not handed over.** The client asks both listings for what can be
open, with `limit=1`. ADR-0033 guarantees at most one of each, and the partial unique indexes
hold it, so the first item is the only one.

**The filter maps a status read against the clock to SQL.** Filtering by the stored status
would have been simpler, and would have listed as `pending` a plan that reads `expired`, which
is the very disagreement ADR-0033 avoids by reading. `pending` becomes stored pending with a
last day that has not ended; `expired` takes in stored pending whose last day has.

**Progress counts what exists now.** Deleting one of five tasks makes the plan "of 4", not a
step undone. That is what the plan holds today, and the only count the rows can give without a
second record of what was committed.

**Offset over plans shares tasks' cost.** A plan made between two pages moves the second by
one. A person makes a plan at a time, and ADR-0020's trigger for a cursor is a measurement.

## Consequences

**Easier**
- S8's review card, polling, error states and "3 of 5" are reads of rows that already exist.
- A failed request is still visible after a reload.

**Harder**
- Two more routes, a count per page, and a filter that has to agree with the read.

**To revisit**
- Letting a plan whose last day has ended go without the sweep. One plan at a time and the
  unique index both read the stored status, so until the sweep records it the plan still
  holds the place, though it reads `expired` (`docs/backlog.md`).

## Action Items

1. [ ] `GET /ai/plans`.
2. [ ] `GET /plans`, filtered by the status as read.
3. [ ] `progress` on the plan and `plan_id` on the task.

---

## Português

**O problema.** Um plano só era encontrado por quem já tinha o id. Um reload, outra aba ou
outro aparelho perdiam o id do job e o do plano, e com eles o acompanhamento, a revisão e o
descarte; e como o 409 de um plano por vez não dizia qual plano, a pessoa ficava sem poder
pedir outro até o rascunho expirar, em até 14 dias. O "3 of 5" do S8 também não tinha de onde
ler: nem a tarefa dizia de que plano vinha, nem o plano contava as suas.

**A decisão.**
- **`GET /ai/plans`** lista os pedidos da pessoa, do mais novo ao mais antigo, filtráveis por
  status e paginados como as tarefas (ADR-0020). Acha o pedido em andamento e o último que
  falhou.
- **`GET /plans`** lista os planos, do mesmo jeito. **O status filtrado é o status lido:** um
  pendente cujo último dia já terminou aparece como `expired`, como na leitura.
- **Um plano aprovado conta suas tarefas:** `progress` com `done` e `total`, contado no
  servidor sobre `tasks.plan_id`. Uma tarefa apagada sai do total.
- **A tarefa diz de que plano veio:** `plan_id` na leitura.

**Opções descartadas.** `GET /plans/current`, que acha só o aberto; ids no 409 e no `/me`, que
põe estado de planejamento na pessoa; ids no `localStorage`, que se perdem com outro aparelho;
contar no cliente, que vê só a semana; e um resumo por plano na listagem, que pede uma segunda
requisição para abrir o pendente.

**O que se aceita.** Duas requisições ao carregar, e uma contagem que reflete o que existe
hoje, não o que foi aprovado.
