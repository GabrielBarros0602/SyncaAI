# ADR-0038: A job and its plan are two resources, linked by id

**Status:** Accepted; `POST /plans` and adding a step to a plan by
[ADR-0047](0047-a-plan-can-be-written-by-hand-in-the-same-draft.md), and a listing of each
resource by [ADR-0050](0050-plans-and-their-requests-are-listed-and-an-approved-plan-counts-its-tasks.md)
**Date:** 2026-10-23
**Deciders:** Gabriel Barros

**Builds on:** [ADR-0003](0003-ai-request-lifecycle.md), which named `POST /ai/plans`,
`GET /ai/plans/{job_id}` and `POST /plans/{id}/commit`;
[ADR-0030](0030-a-plan-is-placed-in-real-free-time-reviewed-and-committed-whole.md), which made
a draft's items a resource; and
[ADR-0033](0033-a-plan-fills-this-week-first-in-its-own-language-one-at-a-time.md), which added
re-placing, the next week and one plan at a time. Supersedes nothing.

## Context

A person asks for a plan, the screen waits for it, shows the review, edits a step and commits.
That spans two rows: the job that waits in the queue, and the draft it produces. ADR-0003 named
paths for both but not how a client gets from one to the other. And ADR-0006 already plans a
draft with no job behind it: when the AI is down, the same editor opens empty, so the feature
degrades to a form.

Answered on 2026-10-23, with the scenario above.

## Decision

### 1. Two resources, and the job links to its plan

| Request | Answer |
|---|---|
| `POST /ai/plans` `{request, horizon_days}` | `202` `{job_id, status}` |
| `GET /ai/plans/{job_id}` | `{job_id, status, failure_reason, plan_id}`, the last two only once they exist |
| `GET /plans/{plan_id}` | the draft, for review |

Everything a person does to a plan happens under `/plans/{plan_id}`. The plan has an identity of
its own, so the draft ADR-0006 opens without a job fits later without changing a path.

### 2. The rest of the surface, as it follows

- **`horizon_days` defaults to 14** and is 1 to 14; the request is 1 to 500 characters
  (ADR-0030, ADR-0033).
- **One plan at a time** answers `409` *"Review or discard the plan you have first."* while a job
  is queued or running or a draft is pending (ADR-0033). The service checks first, and the
  partial unique indexes still refuse a race.
- **A job or a plan that is not yours** is `404`, as for every other resource (ADR-0016).
- **An item's state is read, not only stored.** A placed step whose start has passed reads as
  `passed` (ADR-0033); the others read as stored: `placed`, `no_room`, `not_this_week`,
  `after_unplaced`.
- **The plan says where its week ends**, so a screen can offer "place next week" without
  computing the week itself.
- **Actions are `POST`s under the plan:** `commit` (with `Idempotency-Key`), `discard`,
  `replace` and `next-week`. Discarding is not `DELETE`: the draft stays thirty days (ADR-0037).
  Items are `PATCH` and `DELETE` under `/plans/{plan_id}/items/{item_id}`, as the checklist's are
  (ADR-0028).
- **Acting on a plan that is no longer pending** is `409`, except a repeated commit with the
  same key, which answers what the first one did (ADR-0030).

## Options Considered

| Option | Assessment |
|---|---|
| **Two resources, the job linking to its plan — chosen** | ADR-0003's paths unchanged. The plan has its own id, so a draft with no job fits later. Costs one more request when the job finishes, and the client holds two ids. |
| One resource, the plan | One id from request to commit, and the queue hidden. The id would have to be the job's, since the draft does not exist when the request arrives, so ADR-0006's draft without a job would have no id. |
| Two resources, the draft embedded in the job | Saves the first read of the plan. The same draft then has two representations to keep alike, and editing still needs its id. |

## Consequences

**Easier**
- The fallback editor of ADR-0006 is a new way to create a plan, not a new shape for it.
- Each endpoint answers about one row, and its ownership check is that row's.

**Harder**
- A client polls one resource and then reads another.

## Action Items

1. [ ] `POST /ai/plans`, `GET /ai/plans/{job_id}`, `GET /plans/{plan_id}`.
2. [ ] Items: `PATCH` and `DELETE`, each start checked as a task's would be (ADR-0030).
3. [ ] `commit`, `discard`, `replace`, `next-week`.

---

## Português

**O problema.** Pedir um plano envolve duas linhas, o job da fila e o rascunho que ele produz. A
ADR-0003 deu caminhos para os dois, mas não disse como o cliente vai de um ao outro. E a
ADR-0006 já prevê um rascunho sem job, para quando a IA estiver fora do ar.

**A decisão.**
- **São dois recursos.** `POST /ai/plans` devolve o id do job. `GET /ai/plans/{job_id}` devolve o
  status e, quando o job termina, o `plan_id`. Todo o resto acontece em `/plans/{plan_id}`.
- **O resto da superfície decorre disso:**
  - o 409 de um plano por vez;
  - o 404 para o que não é seu;
  - o estado `passed` calculado na leitura;
  - o fim da semana informado pelo plano;
  - as ações como `POST` (descartar não é `DELETE`, porque o rascunho dura mais 30 dias);
  - os itens com `PATCH` e `DELETE`, como os da checklist.

**O que se aceita.** O cliente consulta um recurso e depois lê outro.
