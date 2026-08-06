# ADR-0002: MVP scope of the AI layer and its UI entry point

**Status:** Accepted
**Date:** 2026-08-06
**Deciders:** Gabriel Barros

## Context

Two AI use cases were specified:

- **UC1 — task assistance.** The user triggers AI from an existing task ("prepare a special
  lunch on Saturday"). The AI receives context (what it is, when, what else is on that day,
  how much time is left) and returns something actionable: recipes, a shopping list, a prep
  order.
- **UC2 — structured plan generation.** The user asks for a study checklist on a topic. The
  AI returns items with links and materials, and those items become **real tasks** on the
  calendar, distributed across available days.

The interface prototype has no AI entry point designed. Two observations from the prototype
constrain the options:

1. The `⌘K` palette currently only navigates — `Go to`, with `label` + `hint` per entry. An
   *action* command there is a new pattern.
2. **Quick capture** is already a free-text input with destination routing:
   `To notes` / `To list`.
3. The `Up next` widget already renders "8 days · 3 of 5 preparations done" — a task
   decomposed into tracked items. That is UC2's output shape, already designed.

## Decision

**Scope:** both use cases are in the MVP.

**Execution order is fixed: UC2 first, UC1 second.** This is not negotiable within this
decision — UC2 builds the pipeline UC1 needs.

**Entry point:** trigger and result surface are treated as two separate concerns.

- **Trigger:** a third destination on Quick capture — `To notes` / `To list` / **`To plan`**
  — mirrored as an action command in `⌘K`.
- **Result:** a first-class **plan draft** entity, rendered in the main area as a card
  listing the proposed items, each with its suggested day, editable, with **Approve** /
  **Discard**. On approve, the items become real tasks. The approved draft renders as the
  existing `3 of 5 preparations done` widget.
- **UC1, added second:** an action on the task itself, with the result persisted as a note
  attached to the day.

No chat metaphor anywhere in the product.

## Options Considered

### Which use case first

| | UC1 (task assistance) | UC2 (plan generation) |
|---|---|---|
| Output shape | prose | validated object that becomes DB rows |
| Requires structured output | not really | **mandatory** |
| Requires deterministic logic of my own | little | **yes** — day distribution algorithm |
| Teaches | prompting, streaming UX | context assembly, schema validation, scheduling, idempotency, partial failure |
| Demonstrates | "AI that reads my calendar" — reads as a wrapper | 12 real tasks appear on the right days after review |
| Writes to DB | almost nothing | centrally |

Both axes — "teaches more" and "demonstrates more" — point at UC2. There is no tension to
manage here.

The decisive argument is a different one: **UC2 subsumes UC1's infrastructure; the reverse
is not true.** Context assembler, provider client, rate limiting, caching, spend cap and
fallback are shared. Building UC2 first makes UC1 a matter of changing the prompt and the
output format. Building UC1 first means building most of the pipeline again for UC2.

Second argument: UC2 forces the **"AI output is a proposal, not a fact"** boundary early.
Starting with UC1 allows that boundary to be skipped, and it would then have to be
retrofitted.

### Where AI appears in the UI

| Option | Pros | Cons |
|---|---|---|
| Button inside the task | context unambiguous, no new UI | serves UC1 only; in UC2 there is no task to click yet |
| Dedicated panel | room for preview and editing | becomes the chat sidebar that was explicitly rejected; highest front-end cost |
| `⌘K` only | already exists; fits the "personal operations", keyboard-first positioning | a palette is a poor container for a *result* that needs review |
| Quick capture `To plan` + `⌘K`, result as reviewable draft — **chosen** | reuses a routing component that already exists; result lives in the product's own vocabulary; review makes writes safe; approved draft becomes an already-designed widget | needs a new entity and view (the draft) |

## Trade-off Analysis

The UI question felt hard because trigger and result were being treated as one decision.
Separating them dissolves it: the cheapest trigger (`To plan`, an existing pattern with one
more button) can be paired with the surface the output actually needs (a reviewable draft),
without either compromising the other.

**Scope risk, stated explicitly.** Putting both use cases in the MVP adds roughly **+25h to
+35h** over UC2 alone: the streaming transport for prose output (see ADR-0003), the
task-level entry point, and note persistence. On a ~155h project that is a ~20% increase.
The mitigation is the fixed execution order — UC2 ships complete and publishable on its own,
so if the calendar slips, UC1 is cut without leaving the MVP broken. UC1 must not begin
before UC2 is merged and deployed.

## Consequences

**Easier**
- The generic AI pipeline is designed once, against the harder of the two cases.
- The `Up next` widget gets real data instead of placeholder data.
- The draft-review step gives a natural place to show token cost and latency per generation
  — the measurable metrics the portfolio needs.

**Harder**
- A new entity pair (`plan_draft`, `draft_item`) and a new view, neither in the prototype.
- The day-distribution algorithm is real work and belongs to the application, not the AI
  (see ADR-0005).
- Two transports must be supported, since the two use cases have different output shapes
  (see ADR-0003).

**To revisit**
- If UC2 lands over its estimate, cut UC1 from the MVP rather than shipping both partially.
- The `⌘K` action-command pattern: if `To plan` proves sufficient in practice, the palette
  command can be dropped.

## Action Items

1. [ ] Model `plan_draft` and `draft_item`, with `status` covering pending/approved/discarded.
2. [ ] Design the draft review card against the existing design system in `_ds/`.
3. [ ] Add the third destination to Quick capture.
4. [ ] Build UC2 end to end, deploy, and only then start UC1.
5. [ ] Specify the day-distribution algorithm as a pure function with unit tests before
       wiring it to anything.

---

## Português

**Decisão:** os dois casos entram no MVP, mas em ordem fixa — **caso 2 (geração de plano)
primeiro**, caso 1 (assistência a tarefa) depois. Motivo: o caso 2 subsume a infraestrutura
do caso 1 (montador de contexto, cliente do provedor, rate limit, cache, fallback); o
inverso não. E o caso 2 força cedo a fronteira "saída de IA é proposta, não fato".

**Entrada na UI:** gatilho e superfície de resultado são decisões separadas. Gatilho =
terceiro destino do Quick capture (`To plan`), espelhado no `⌘K`. Resultado = entidade
`plan draft` renderizada como card revisável com Approve/Discard; ao aprovar, vira tarefas
reais e o widget `3 of 5 preparations done`. Nenhuma metáfora de chat.

**Risco de escopo registrado:** os dois casos custam +25h a +35h sobre só o caso 2 (~20% do
projeto). Mitigação = a ordem fixa. O caso 2 é publicável sozinho; se o calendário apertar,
corte o caso 1 sem quebrar o MVP.
