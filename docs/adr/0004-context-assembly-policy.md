# ADR-0004: Calendar context assembly policy

**Status:** Accepted
**Date:** 2026-08-06
**Deciders:** Gabriel Barros

## Context

The point of SyncaAI's AI layer is that it acts on calendar context rather than being a
generic chat window bolted to the side. That raises three coupled questions:

1. What calendar data enters the prompt?
2. What is the token budget?
3. What must never leave the database for privacy reasons?

The user's calendar contains the most sensitive data in the product: appointment titles,
personal notes, list items. A naive implementation would serialise the next two weeks in
full and send it, which is both a privacy problem and a cost problem.

## Decision

**Allowlist, never denylist.** The context assembler declares explicitly which fields it
includes. A new column added to the `tasks` table does not reach the provider until someone
adds it to the assembler on purpose.

**Day capacity is sent as an aggregate, never as content.**

Included for UC2 (plan generation):

- today's date, weekday, and the user's timezone
- the horizon window (e.g. the next 14 days)
- **per day, aggregates only**: date, weekday, minutes already booked, minutes free, task
  count
- the user's own request text
- user preferences: preferred block length, days off, working hours
- the output schema (ADR-0005)

Excluded:

- titles and contents of any task, note or list item not related to the request
- notes entirely, unless the user explicitly attaches one to the request
- internal identifiers — days are referenced by date, and mapped back to IDs after the
  response is validated

For UC1 (task assistance), the invoked task is in scope by definition: its title,
description, scheduled time and duration. Same-day context is still aggregate-only — free
minutes and the boundaries of surrounding blocks, not their titles. Any widening beyond
this requires an explicit user action, not an inference by the assembler.

**Context is fingerprinted.** The assembler returns a hash over the day-capacity vector
alongside the prompt, for use in the cache key (ADR-0006).

## Options Considered

### Option A: Send the full calendar for the horizon window

**Pros:** maximum context; the model could in principle reason about thematic conflicts
("you already have a Kubernetes task on Tuesday").
**Cons:** sends the most sensitive data in the product to a third party on every call;
token cost grows with how busy the user is, so the heaviest users pay most; and it buys
almost nothing for the actual task, which is capacity planning.

### Option B: Aggregates only — **chosen**

**Pros:** the model does not need to know that Tuesday 15:00 is "therapy" in order to know
Tuesday has 90 free minutes. Cost is flat and predictable regardless of how full the
calendar is. The privacy boundary is a property of the assembler, testable in isolation.
**Cons:** the model cannot detect semantic conflicts or duplicated topics. Accepted: that
belongs to deterministic code, which can query the database directly and does not need the
model's help.

### Option C: Aggregates plus a summarisation pass over titles

**Pros:** some semantic awareness with less exposure than Option A.
**Cons:** doubles the number of provider calls and therefore latency and cost; the
summarisation pass still receives the raw titles, so it does not actually solve the privacy
problem — it moves it.

## Trade-off Analysis

The notable result is that **the privacy rule and the token-budget rule give the same
answer.** Fourteen days of aggregates is a few hundred tokens; the same window with full
content is thousands and unbounded. There is no trade-off to manage between the two
constraints, which is unusual and worth stating plainly rather than presenting a tension
that does not exist.

Allowlist over denylist is the same reasoning applied to API serialisation: with a denylist,
a field added later leaks by default; with an allowlist, it stays put until someone decides
otherwise. In this case the thing that leaks is not an internal ID but the user's private
calendar, so the default matters more than usual.

## Consequences

**Easier**
- The assembler is a pure function — user id, window, request text in; prompt plus
  fingerprint out — so it is unit-testable with no provider call and no cost.
- Token cost per generation is predictable, which makes the pre-call spend estimate in
  ADR-0006 accurate.
- The privacy claim is demonstrable: point at one function and one test.

**Harder**
- The model cannot reason about the semantic content of the existing calendar. Any such
  feature must be built in application code.
- UC1 needs its own assembler variant with a wider but still explicit allowlist, rather
  than reusing UC2's.

**To revisit**
- If a feature genuinely requires task titles, it gets its own ADR and an explicit,
  user-visible consent step. It does not get added quietly to this assembler.
- Whether preferences should be inferred from history rather than configured.

## Action Items

1. [ ] Implement `build_plan_context(user_id, window, request_text)` returning
       `(prompt, context_fingerprint)`.
2. [ ] Unit-test the assembler with a fixture calendar containing sensitive titles, and
       assert those strings are absent from the output prompt. This test is the privacy
       guarantee.
3. [ ] Document the allowlist as a constant in the code, so a diff shows when it changes.
4. [ ] Log the assembled prompt with a hash rather than in full, for the same reason.

---

## Português

**Decisão:** **allowlist, nunca denylist** — o montador declara explicitamente o que entra;
coluna nova no banco não chega ao provedor até alguém incluir de propósito.

**Entra:** data/timezone/dia da semana de hoje, a janela de horizonte, **por dia só
agregado** (data, dia da semana, minutos ocupados, minutos livres, contagem de tarefas), o
texto do pedido, preferências do usuário, e o schema de saída.

**Fica fora:** títulos e conteúdo de qualquer tarefa, nota ou item não relacionado; notas
integralmente, salvo anexo explícito; IDs internos — referencie por data e mapeie na volta.

**Resultado notável:** a regra de privacidade e a de orçamento de token dão a **mesma**
resposta. 14 dias de agregado custa algumas centenas de tokens; com conteúdo completo,
milhares e ilimitado. Não há trade-off a administrar entre as duas.

O teste que prova a privacidade: fixture de calendário com títulos sensíveis, asserção de
que essas strings não aparecem no prompt montado.
