# ADR-0047: A plan can be written by hand, in the same draft

**Status:** Accepted
**Date:** 2026-10-24
**Deciders:** Gabriel Barros

**Amends:** [ADR-0037](0037-a-draft-in-five-tables-and-only-an-approved-one-stays.md), where
every draft has a job and a prompt version, and
[ADR-0038](0038-a-job-and-its-plan-are-two-resources-linked-by-id.md), whose endpoints edit a
draft's steps but cannot add one. Builds the manual fallback of
[ADR-0006](0006-cost-limits-cache-degradation.md): "create checklist manually opens the same
draft editor with empty items. The feature degrades to a form, not to nothing."

## Context

Every way the AI layer can be unavailable is now built: the rate limit, the ceilings and the
circuit breaker (ADR-0042, ADR-0044, ADR-0046). What a person can do when it is has not been:
a draft exists only as a model's answer, `plan_drafts.job_id` and `prompt_version` are
required, and the review can rename, resize, move and remove a step but never add one.

ADR-0006 asked for the fallback to be the same code path with an empty payload, so that the
review, the placement and the commit a person relies on are the ones already tested.

Answered on 2026-10-24.

## Decision

### 1. A draft written by hand has no job and no prompt

`plan_drafts.job_id` and `prompt_version` become optional, and a CHECK holds them together: a
model's draft has both, a person's has neither. Everything else holds for both alike — one
pending plan per person, the review, the commit, the expiry and the thirty-day purge.

`POST /plans` creates one, empty, from a name and a horizon, as `POST /ai/plans` is asked
with a request and a horizon. It is refused while a plan is being made or reviewed, as a
request is (ADR-0033). It is not a job, so neither the rate limit, the ceilings nor the breaker
read it: none of them has anything to protect here.

### 2. A step can be added to any pending draft

`POST /plans/{id}/items` appends a step with a title, a length and an optional description,
and places it at once with the scheduler that places a plan again (ADR-0033): the earliest
free time, the plan's other steps held where they are. A draft a model wrote gains it too — the
step the model left out.

### 3. Always available

The API does not gate the manual path on the AI being down. When to offer it is the screens'
to decide, which wait for the third design round; meanwhile the path is exercised every day,
not only during the incident it exists for.

### 4. Twelve steps, whoever writes them

A draft holds at most `MAX_PLAN_ITEMS` steps, the model's limit, for ADR-0030's reason: a
review a person actually reads. It bounds the commit's size as well.

## Options Considered

### How a manual draft exists

| Option | Assessment |
|---|---|
| **Job and prompt optional, together — chosen** | One table, one editor, one commit; a CHECK says which kind a draft is. |
| A job of kind `manual` | Keeps the columns required; the job would count in the AI rate limit (ADR-0042), in the metrics and in the queue, and every one of them would have to filter it out. |
| A table for manual plans | Duplicates the editor, the opposite of ADR-0006's same path. |

### How steps get in

| Option | Assessment |
|---|---|
| **An endpoint that adds one, to any pending draft — chosen** | A manual plan grows step by step; a model's plan can be completed. |
| All steps in the request that creates the plan | No new endpoint; nothing can be added afterwards, to either kind. |

### When it is available

| Option | Assessment |
|---|---|
| **Always — chosen** | Tested by use; the screens decide when to offer it. |
| Only while the AI is unavailable | True to the word fallback, and exercised only in an incident. |

## Trade-off Analysis

**A step added by hand has no prerequisites.** It is placed by time alone. Ordering it against
the model's steps is a move, which the review already allows, and ADR-0030 checks a moved step
only as a task would be.

**The count is held by the service, not the database.** A row count is not a CHECK. The draft
is locked for an addition as it is for every edit, so two additions cannot both see room for
the twelfth.

## Consequences

**Easier**
- Planning degrades to a form: with the model down, a plan is still written, reviewed and
  committed the same way.
- A model's plan can be completed instead of discarded for one missing step.

**Harder**
- A draft is now one of two kinds, and code that reads a draft's job has to expect none.

## Action Items

1. [x] `job_id` and `prompt_version` optional, held together by a CHECK.
2. [x] `POST /plans` and `POST /plans/{id}/items`, with their refusals.
3. [x] Tests: a manual plan from creation to commit, a step added to a model's plan, the
       twelfth and the thirteenth step.

---

## Português

**O problema.** Todas as formas de a IA ficar indisponível já existem — rate limit, tetos,
breaker — mas o que a pessoa faz nessa hora não existia: rascunho só nascia de uma resposta do
modelo, e a revisão não acrescentava passo.

**A decisão.**
- **Rascunho escrito à mão não tem job nem prompt:** as duas colunas ficam opcionais, presas
  por um CHECK. `POST /plans` cria um vazio, com nome e horizonte, recusado enquanto houver
  plano em andamento. Não é job, então rate limit, tetos e breaker não o leem.
- **Acrescentar passo, em qualquer rascunho pendente:** `POST /plans/{id}/items`, posicionado
  na hora pelo mesmo agendador do "posicionar de novo". O plano da IA também ganha.
- **Sempre disponível:** a tela decide quando oferecer.
- **Doze passos, quem quer que escreva**, pela razão da ADR-0030.

**O que se aceita.** Passo acrescentado à mão não tem pré-requisito; e o limite de doze é
garantido pelo serviço, com o rascunho travado, não por um CHECK.
