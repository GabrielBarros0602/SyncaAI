# ADR-0058: A request says what it asked, and a plan's tasks are listed by the plan

**Status:** Accepted
**Date:** 2026-11-22
**Deciders:** Gabriel Barros

**Amends:** [ADR-0038](0038-a-job-and-its-plan-are-two-resources-linked-by-id.md), whose job
read gave an id, a status, a failure and a plan, and whose plan read did not name its job;
and [ADR-0050](0050-plans-and-their-requests-are-listed-and-an-approved-plan-counts-its-tasks.md),
whose count of a plan's tasks had no listing to match it. **Builds on:**
[ADR-0052](0052-the-third-design-round-is-the-specification-and-the-front-end-opens.md), whose
plan screen is what these reads serve, and
[ADR-0020](0020-domain-surface-choices.md), whose task listing gains a filter.

## Context

ADR-0050 moved what the plan screens follow to the server, so that a reload, a second tab or
another device finds it again. Reading `plan.dc.html` against those reads, before building it,
found three things the screen shows that the server did not give:

- **The wait and the failure show the request.** "Asked at 14:20, for 14 days", under the text
  that was asked. The job holds all three, and its read gave none. After a reload the screen
  would have a status and nothing to say about it.
- **A plan by hand and a model's plan read alike.** The screen says "ready to review" for one
  and "draft" for the other, "You asked" for one and "What it's for" for the other. A model's
  plan with nothing discarded and a plan by hand were the same shape. The Plan button also has
  to know whether the latest failed request came after the latest plan, and no status says
  that.
- **The plan's page lists the tasks its "3 of 5" counts.** The count is the server's, over
  `tasks.plan_id`, and it counts a task wherever it was moved (ADR-0050). The tasks could only
  be read by their days, so the screen would read the plan's days and list fewer tasks than
  the count says.

Answered on 2026-11-22, with the screens' PR split.

## Decision

### 1. A request's read says what was asked

`GET /ai/plans/{job_id}`, and each item of `GET /ai/plans`, gain:
- **`request`**, as the person wrote it. Null once the purge has cleared it, thirty days after
  the job ended (ADR-0031).
- **`horizon_days`**.
- **`created_at`**, the instant it was asked.

`POST /ai/plans` answers with the request as reading it answers, rather than a second shape
built by hand. A worker may already hold it by then, and the answer says so.

### 2. A plan's read names its request

`GET /plans/{plan_id}`, and each item of `GET /plans`, gain:
- **`job_id`**, null for a plan written by hand (ADR-0047);
- **`created_at`**.

### 3. A plan's tasks are listed by the plan

`GET /tasks` takes **`plan_id`**, alone or with the window of days. It lists the plan's tasks
that exist now, wherever they were moved, which is what the plan's `progress` counts.

It is scoped to the owner, as every read is. Somebody else's plan lists nothing: the same
empty page a plan that does not exist gets, so the answer does not say whether the plan is
real (ADR-0016). The partial index on `tasks.plan_id`, which the count already uses, serves it.

## Options Considered

### Telling a plan by hand from a model's

| Option | Assessment |
|---|---|
| **The plan names its job — chosen** | A column the draft already has. It says which kind a plan is, and leads back to its request. |
| A `written_by` field | Says the kind and nothing else, and it is derived from the same column. |
| The screen infers it: no discards means by hand | No change. Wrong for a model's plan where every step passed the check. |

### Listing a plan's tasks

| Option | Assessment |
|---|---|
| **`plan_id` on `GET /tasks` — chosen** | One filter on a listing that exists, and the list matches the count. |
| The plan's days, filtered on the screen | No change. Misses a task moved out of the plan's days, which the count still holds. |
| The tasks embedded in the plan's read | One request for the page. Every listed plan would carry its tasks, and a task would have two representations to keep alike. |

## Trade-off Analysis

**Every request's read carries its text.** A listing page holds as many requests as the page
size, each up to 500 characters (ADR-0030). That is the person's own text, sent only to that
person, and kept no longer than it already was.

**`created_at` is the database's clock.** The job's and the plan's are both written by it, so
comparing them is safe. The screen does not compare them with its own clock.

## Consequences

**Easier**
- After a reload, the plan screen shows every state it draws from the server alone.
- The plan's page and its count agree by construction.

**Harder**
- Three more fields on two reads, and one more filter on the task listing.

## Action Items

1. [x] `request`, `horizon_days` and `created_at` on a request's read.
2. [x] `job_id` and `created_at` on a plan's read.
3. [x] `plan_id` on `GET /tasks`, with tests that a moved task is listed and that somebody
       else's plan lists nothing.

---

## Português

**O problema.** Lendo o `plan.dc.html` contra as leituras do ADR-0050, antes de construir a
tela, apareceram três coisas que a tela mostra e o servidor não dava:
- **a espera e a falha mostram o pedido,** "Asked at 14:20, for 14 days", e o job não dizia
  nada disso;
- **um plano à mão e um plano do modelo sem descartes eram iguais,** e a tela diz "draft" para
  um e "ready to review" para o outro;
- **a página do plano lista as tarefas que o "3 of 5" conta,** e as tarefas só eram lidas
  pelos dias. Lendo os dias do plano, a tela listaria menos tarefas do que a contagem diz.

**A decisão.**
- **A leitura do pedido** ganha `request` (null depois do expurgo), `horizon_days` e
  `created_at`. O `POST /ai/plans` responde com a mesma leitura.
- **A leitura do plano** ganha `job_id` (null no plano à mão) e `created_at`.
- **`GET /tasks` aceita `plan_id`,** sozinho ou com a janela de dias, limitado ao dono. O plano
  de outra pessoa lista nada, como um plano que não existe.

**Opções descartadas.**
- **Um campo `written_by`:** só diz o tipo.
- **Deduzir o tipo pelos descartes:** erra no plano do modelo sem descartes.
- **Filtrar os dias do plano na tela:** perde a tarefa movida.
- **As tarefas dentro da leitura do plano:** duas representações da mesma tarefa.

**O que se aceita.** Cada pedido listado leva o seu texto, que é da própria pessoa e não é
guardado por mais tempo do que já era.
