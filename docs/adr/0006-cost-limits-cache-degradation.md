# ADR-0006: Cost control, rate limiting, caching and graceful degradation

**Status:** Accepted
**Date:** 2026-08-06
**Deciders:** Gabriel Barros

## Context

Provider calls cost money that comes out of a student's pocket, and the bill is not bounded
by anything in the application by default. Three distinct risks:

1. **Abuse** — a user, or a bug, calling the endpoint in a loop.
2. **Cost** — sustained legitimate usage exceeding what can be afforded.
3. **Availability** — the provider will have an outage. What does the product do then?

These are separate problems with separate mechanisms, and their ordering in the request path
determines whether they actually save money.

## Decision

### Placement in the request path

```
authenticate -> rate limit -> cache lookup -> spend cap -> enqueue
```

Rate limiting first because it is the cheapest rejection and also protects the endpoint
itself from being hammered. The cache before the spend cap because a cache hit incurs no
provider cost, so refusing it on budget grounds would be wrong.

### Rate limiting

Per user, two windows: **10 per hour** and **30 per day** for AI jobs. The short window
catches accidents and runaway loops; the long window catches sustained abuse. Fixed window
in v1 — sliding window is nicer and not yet worth it. Rejections return `429` with
`Retry-After`.

### Spend cap

Two ceilings, both backed by an `ai_usage` table written on every completed call (tokens in,
tokens out, computed cost, latency, model, `prompt_version`, job id):

- **Per-user monthly cap.**
- **Global kill switch** across all users. This is the one that actually protects the bank
  account, because the realistic failure is a bug in the project's own front end looping,
  not a malicious stranger.

Cost is **estimated before the call** from the assembled prompt's token count plus the
schema's maximum output size, and the call is refused if the estimate would breach a cap.
Discovering a breach after paying for it is not a control.

### Cache

Key = `hash(model + prompt_version + normalised_request_text + context_fingerprint)`.

The `context_fingerprint` (ADR-0004) is essential: the same request text against a different
calendar must miss the cache, or a stale plan gets served for a changed week.

TTL of a few hours for plan drafts.

**Honest expectation:** with free-text user input, real hit rate will be low. The cache's
actual value here is (a) absorbing double-submits and retry storms, and (b) demos, where the
same prompt is run repeatedly. It is not a cost-reduction strategy and should not be
presented as one. Provider-side prompt caching over the stable system prompt and schema is a
separate, complementary mechanism worth enabling.

### Degradation

**The product works with zero AI.** The calendar, tasks, lists, notes, habits and heatmap are
all fully functional without a provider. AI is strictly additive. Concretely:

- A **circuit breaker** on the provider client. When it opens, `To plan` is disabled with a
  visible explanation; everything else in the product is untouched.
- Jobs already queued stay queued and drain when the provider recovers, or expire after a
  bounded interval with a `failed` status and a readable reason.
- Cached drafts continue to be served.
- **Manual fallback:** "create checklist manually" opens the same draft editor with empty
  items. The feature degrades to a form, not to nothing.

### Infrastructure

PostgreSQL for all three concerns in v1 — job queue (ADR-0003), rate-limit counters, and
cache table. Redis enters when there is a measured need, not before.

## Options Considered

### Where to enforce the spend cap

| Option | Assessment |
|---|---|
| After the call, from recorded usage | Detects the breach after paying for it. Not a control. |
| Before the call, from a pre-call estimate — **chosen** | Requires a token count and a cost model, both cheap. Actually prevents spend. |
| Provider-side budget alerts only | Useful as a backstop but reactive, coarse, and cannot distinguish users. Enable in addition. |

### Rate-limit algorithm

| Option | Pros | Cons |
|---|---|---|
| Fixed window — **chosen** | trivial, one row per user per window | burst at window boundaries |
| Sliding window log | precise | one row per request, more storage and query cost |
| Token bucket | smooth, handles bursts well | more state, more code, unjustified at this scale |

### Cache storage

| Option | Pros | Cons |
|---|---|---|
| Postgres table — **chosen** | no new service; keyed rows with a TTL column and a sweeper | manual expiry |
| Redis | native TTL, faster | one more service for a low-hit-rate cache |

## Trade-off Analysis

The ordering of these three mechanisms is the substantive decision, and it is where an
implementation usually gets it wrong. Putting the spend cap before the cache means rejecting
free requests. Putting the cache before the rate limit means an abusive client can still
generate unbounded database load. The order above is the only one where each mechanism
rejects at its true cost.

On infrastructure: three Postgres tables instead of Redis is deliberate under-engineering.
Rate limiting means one write per request, which at this scale is nothing, and the cache is
a keyed table with a TTL column. Both are defensible with a measured trigger for revisiting,
which is a better position than adding a service the load does not justify.

Degradation is the strongest thing in this ADR from a portfolio standpoint, because it is
the question an interviewer reliably asks about any AI feature. The answer — the product is
a working personal operations tool and the AI is additive — is only credible if it was
designed that way from the start, which is why it is recorded before any code is written.

## Consequences

**Easier**
- Cost is bounded by construction, with a global kill switch as the backstop.
- `ai_usage` doubles as the metrics source for the README: cost per generation, p50/p95
  latency, repair rate, cache hit rate.
- The AI outage story is a paragraph, not a scramble.

**Harder**
- A cost model per provider and per model must be maintained by hand, and it goes stale when
  providers change pricing.
- Pre-call estimation requires a tokeniser for the chosen model.
- The circuit breaker needs its own tests, including the half-open transition.
- The cache sweeper is a scheduled job that has to exist and be monitored.

**To revisit**
- Rate-limit numbers, once real usage exists. 10/hour is a guess.
- Cache TTL and whether the cache earns its keep at all — if measured hit rate stays near
  zero outside demos, removing it is the honest call.
- Redis, if per-request counter writes show up in database load.

## Action Items

1. [ ] Model `ai_usage` and write to it on every completed call, before anything depends on
       it.
2. [ ] Implement the middleware chain in the decided order and add an integration test that
       asserts the order — specifically that a cache hit is served while over the spend cap.
3. [ ] Implement the pre-call cost estimate with the model's tokeniser; put the price table
       in configuration, not in code.
4. [ ] Implement the circuit breaker in the `PlanGenerator` client; test the open and
       half-open paths against `FakeGenerator`.
5. [ ] Build the manual checklist path in the same editor as the AI draft, so the fallback is
       the same code path with an empty payload.
6. [ ] Set a global monthly ceiling and a provider-side budget alert below it.

---

## Português

**Ordem no caminho da requisição:** `auth -> rate limit -> cache -> teto de custo -> enfileira`.
Rate limit primeiro por ser a rejeição mais barata e por proteger o endpoint; cache antes do
teto porque cache hit não custa nada e barrá-lo por orçamento seria errado.

**Rate limit:** por usuário, duas janelas — 10/hora e 30/dia. A curta pega acidente e loop;
a longa pega abuso sustentado. Janela fixa na v1. `429` com `Retry-After`.

**Teto de custo:** dois. Mensal por usuário, e um **kill switch global** — esse é o que
salva o dinheiro, porque a falha realista é um bug no seu próprio front-end em loop.
Estimativa de custo **antes** da chamada; descobrir o estouro depois de pagar não é
controle.

**Cache:** chave = hash(modelo + `prompt_version` + pedido normalizado + **fingerprint do
contexto**). Sem o fingerprint você serve plano velho para semana mudada. Sem overselling:
com texto livre o hit rate real é baixo — o valor é blindar contra duplo submit e servir a
demo. Prompt caching do provedor é mecanismo diferente e complementar.

**Degradação:** o produto inteiro funciona com zero IA. Circuit breaker abre → `To plan`
desabilita com aviso, todo o resto funciona; jobs na fila drenam quando o provedor volta;
drafts em cache continuam servindo; e o fallback manual abre o mesmo editor de draft vazio —
a feature degrada para formulário, não para nada.

**Infra:** PostgreSQL para fila, rate limit e cache na v1. Redis entra com necessidade
medida.
