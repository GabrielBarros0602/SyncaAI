# ADR-0045: No response cache until one is measured to pay

**Status:** Accepted
**Date:** 2026-10-24
**Deciders:** Gabriel Barros

**Amends:** [ADR-0006](0006-cost-limits-cache-degradation.md), its cache and the cache step of
its request path, which wait. Its own "to revisit" anticipated this: "if measured hit rate stays
near zero outside demos, removing it is the honest call". **Builds on:**
[ADR-0033](0033-a-plan-fills-this-week-first-in-its-own-language-one-at-a-time.md), whose index
refuses a second plan in progress; [ADR-0034](0034-the-model-sees-the-room-each-day-has-and-nothing-it-cannot-use.md),
whose fingerprint the key would carry; and
[ADR-0042](0042-plan-requests-are-limited-over-moving-windows-of-jobs.md), whose rate limit
bounds repeated requests. Answers the open item of `docs/backlog.md` about asking again after
discarding, and leaves ADR-0040's question about the cache key with nothing to key.

## Context

ADR-0006 keyed its cache on the model, the prompt version, the normalised request and the
context fingerprint, and named what it was for: absorbing double submits and retry storms, and
demos. Reading the code S6 and S7 built against those purposes:

- **The key moves every five minutes.** The fingerprint covers each day's room, and today's
  room is counted from the next five-minute mark (ADR-0034). Inside a person's usable window —
  06:00 to 22:00 by default — the same request misses the cache five minutes later. It holds
  still only outside the window.
- **Double submits are already refused.** The index of ADR-0033 admits one plan in progress per
  person; the second request is answered 409 without reaching any cache.
- **Retry storms are already bounded.** The same index, and ADR-0042's ten an hour.
- **What would hit is mostly unwanted.** A person who discards a plan and asks again in the
  same five minutes, or at night, gets the plan they just discarded back — the defect the
  backlog recorded against ADR-0034.
- **Demos would hit only across people,** which a cache scoped to its owner cannot do, and a
  shared one would answer one person with a plan made for another's request and reveal, by
  its speed, that someone asked the same.

Building it is a table, a sweep, an eviction on discard, a path in the worker that skips the
model, and a test of the order — for hits that are rare and, when they happen, mostly wrong.

Answered on 2026-10-24.

## Decision

### 1. No response cache now

The request path is `authenticate → rate limit → spend ceilings → enqueue`. ADR-0006's cache
step, and its test that a cache hit is served above the ceiling, wait for the measurement
below.

### 2. Measure what it would have answered

Each job records the context fingerprint its prompt was built from, in
`ai_jobs.context_fingerprint`. It is cleared with the request when the purge empties the job
at thirty days, and a CHECK holds that it never outlives the request: it is a digest of a
person's free time, and of no use without the request it went with.

`would_be_cache_hits` counts, over the jobs still holding their request, how many an earlier
one would have answered: same person, same prompt version, same request once trimmed, spaced
and lowercased, same fingerprint, the earlier one done and finished within the window before
the later was asked. The window ADR-0006 named was "a few hours"; six is the default. The model
is not compared: ADR-0043 names one, so a period measured is one model's, and a measurement
across a change of model is split at the change.

A cache is proposed again with that number, in a new record.

### 3. Cost is reduced at the provider

What a cache was never going to do — make calls cheaper — is the provider's prompt cache, over
the instructions and the schema that open every call unchanged. It is enabled with the paid
client, as ADR-0006 already called it complementary.

## Options Considered

| Option | Assessment |
|---|---|
| **No cache, measure first — chosen** | Nothing to build or keep for hits that are rare and mostly unwanted; the number that would justify one is collected from now on. |
| Build ADR-0006's cache, scoped to its owner | A table, a sweep, eviction on discard, a worker path and a test, for the re-ask after a discard and little else. |
| A cache shared across people, for demos | Hits demos with identical empty calendars; breaks owner isolation (ADR-0016) and opens a timing side channel. |

## Trade-off Analysis

**The cost of waiting is small.** Nothing paid is running, so no call a cache would have
saved costs money; when one does, the ceilings of ADR-0044 bound it either way.

**The measurement is only as long as thirty days.** It needs the request, and the request goes
at thirty days. A measurement is a reading of the last month, which is what deciding needs.

## Consequences

**Easier**
- No eviction to get right, and no plan served twice to someone who discarded it.
- ADR-0006's metric "cache hit rate" exists before the cache, as what the rate would have been.

**Harder**
- A demo run twice calls the model twice.

**To revisit**
- A cache, when `would_be_cache_hits` says enough requests repeat.

## Action Items

1. [x] `ai_jobs.context_fingerprint`, written when the job runs and purged with its request.
2. [x] `would_be_cache_hits`, with its tests.
3. [ ] The provider's prompt cache, with the paid client.

---

## Português

**O problema.** O cache da ADR-0006 existia para absorver duplo clique, rajadas de retry e
demos. No código que existe hoje:
- **a chave muda a cada 5 minutos** dentro da janela do dia, porque o espaço de hoje é contado
  a partir da próxima marca de 5 minutos;
- **o duplo clique já é recusado** pelo índice de um plano em andamento por pessoa, e as rajadas
  pelo rate limit;
- **o que acertaria é quase sempre indesejado:** pedir de novo depois de descartar devolveria o
  plano descartado;
- **demos só acertariam entre pessoas,** o que quebra o isolamento por dono.

**A decisão.**
- **Sem cache de respostas agora.** O caminho do pedido fica `auth → rate limit → tetos → fila`.
- **Medir antes:** cada job guarda a impressão digital do contexto, apagada junto com o pedido
  aos 30 dias, e `would_be_cache_hits` conta quantos pedidos um job anterior teria respondido.
  O cache volta a ser proposto com esse número, numa ADR nova.
- **A economia de custo fica com o cache de prompt do provedor,** com o cliente pago.

**O que se aceita.** Uma demo repetida chama o modelo duas vezes.
