# ADR-0044: The spend ceilings are checked before the queue and before each call

**Status:** Accepted
**Date:** 2026-10-24
**Deciders:** Gabriel Barros

**Amends:** [ADR-0006](0006-cost-limits-cache-degradation.md), its spend cap: the values, the
month, where the ceilings are checked, and how a call is estimated — "from the assembled
prompt's token count", which assumed a tokenizer per model. **Builds on:**
[ADR-0041](0041-every-call-is-metered-when-it-ends.md), whose `ai_usage` the ceilings sum and
whose failed calls are charged at their estimate from here on, and
[ADR-0042](0042-plan-requests-are-limited-over-moving-windows-of-jobs.md), which bounds how
many jobs a person can have.

## Context

ADR-0006 set two monthly ceilings — one per person, one global, the kill switch — and said a
call is refused when its estimate would cross one. It left open what the ceilings are, when a
month turns, and whether the check happens when a plan is asked for or when a model is about
to be called. A job is asked for once and makes up to six calls (ADR-0036), sometimes minutes
later.

Nothing costs money yet: the local model and the sample are free (ADR-0039, ADR-0041). The
ceilings exist so that the day a provider is paid for, they are already there and tested.

Answered on 2026-10-24.

## Decision

### 1. US$ 0.50 per person, US$ 5 for everyone, per UTC month

Settings, `AI_CEILING_PER_PERSON_USD` and `AI_CEILING_EVERYONE_USD`, defaulting to these. The
month is the calendar month in UTC for both: the global ceiling needs one month for everyone,
and a person's in UTC turns at 21:00 on the last day in São Paulo, which nobody notices.

With Claude Haiku 5.5 the rate limit already holds a person to about US$ 0.50 a month (930
plans at about US$ 0.00054); the personal ceiling binds only on a costlier model, where
Sonnet 5.5 reaches it at about the 47th plan. US$ 5 is what a bug may lose in a month before
everything stops, about one minimum top-up.

### 2. Checked when a plan is asked for, and before each call

- **The request** is refused while the month's spend has reached a ceiling: `503` with
  `Retry-After` until the month turns when the global one has, `429` with the same when the
  person's has. It is the last check before the queue, after the rate limit (ADR-0006).
- **The worker** asks before each call whether the month's spend and the call's estimate stay
  under both ceilings. If not, no call is made and the job fails with a sentence saying which
  ceiling, rather than being left to its lock and tried again.

A call is made only while, with it, the month stays under the ceiling. Several workers check
on their own, so the most the month can pass a ceiling by is one call per worker.

### 3. The estimate is a bound, not a count

Text the code writes — the instructions, the schema, the message around the request, a
correction — is counted at two characters a token, under the three qwen3.5 measured
(ADR-0040). Text a person or a model wrote — the request, a first answer sent back — is
counted by its bytes, since it can be in any script and a byte-level tokenizer never spends
more than a token on one. The answer is counted at its cap, `MAX_ANSWER_TOKENS`. The price
comes from `prices.toml`, and a free provider's estimate is zero.

A bound over-counts, which is the safe side of a ceiling. A provider's exact count, such as
Anthropic's `count_tokens`, can replace it with the paid client.

### 4. A failed call is charged at its estimate

As ADR-0041 set out: the estimate now exists, so a call that raises is recorded with it as its
cost, the most it could have been billed.

## Options Considered

### The month

| Option | Assessment |
|---|---|
| **UTC for both — chosen** | One month, one query shape; the person's turns a few hours off their midnight. |
| The person's month in their zone, the global one in UTC | Reads more naturally; two notions of a month to keep. |

### Where the ceilings are checked

| Option | Assessment |
|---|---|
| **The request and each call — chosen** | Immediate answer when the month is spent, and no job runs past a ceiling it reached while queued. |
| The request only | Simpler; a job accepted just under a ceiling still spends its worst case past it. |
| Each call only | Never passes a ceiling; the person waits for the job to fail instead of hearing at once. |

### The estimate

| Option | Assessment |
|---|---|
| **A bound from characters and bytes — chosen** | No dependency, holds for any byte-level tokenizer, over-counts. |
| A tokenizer per model | ADR-0006's wording. Exact, and one more dependency per model, none of which is paid for. |
| The provider's count endpoint | Exact; one more call per call, and only once a provider is paid. |

## Trade-off Analysis

**A ceiling refuses a little early.** The bound over-counts a call several times over: the
week's prompt qwen3.5 read as about 1,170 tokens is bounded at 1,923, and with the answer at
its cap a Haiku call costing about US$ 0.0005 is estimated at US$ 0.0022. Against a US$ 0.50
ceiling that is the last few plans of the month.

**A job stopped at its repair loses its first answer.** The ceiling is checked before the
repair as before any call, and a refusal fails the job; the first answer's usage is kept, the
answer is not. It happens only at a ceiling's edge, and the person is told which.

**Free calls are still refused at a ceiling.** If the month was spent on a paid model and the
setting moved to a free one, the request is refused anyway. The kill switch stays a switch.

## Consequences

**Easier**
- The day a provider is paid for, its spend is bounded by construction.
- A person learns at once that their month is spent, and when it renews.

**Harder**
- Two sums over `ai_usage` per request and per call, both through their indexes.

**To revisit**
- The values, once spend is measured in money.
- The bound, against the provider's own count, with the paid client.

## Action Items

1. [x] The bound and the estimate; a failed call charged at it.
2. [x] The ceilings as settings, checked on the request and before each call.
3. [x] `429` and `503` with `Retry-After` until the month turns.
4. [x] Integration tests for both ceilings at both checks, the order, and the indexes.

---

## Português

**A decisão.**
- **US$ 0,50 por pessoa e US$ 5 no global, por mês UTC,** como configuração. Com o Haiku o
  rate limit já segura uma pessoa em ~US$ 0,50; o teto pessoal só morde num modelo mais caro.
- **Checado no pedido e antes de cada chamada.** O pedido é recusado quando o mês já bateu um
  teto — `503` para o global, `429` para o pessoal, com `Retry-After` até virar o mês. O worker
  só chama o modelo se, com a estimativa da chamada, o mês continua abaixo dos dois; se não,
  o job falha dizendo qual teto.
- **A estimativa é um limite, não uma contagem:** texto do código a 2 caracteres por token,
  texto de pessoa ou de modelo pelos bytes, a resposta no máximo permitido, ao preço do
  `prices.toml`. Modelo gratuito estima zero.
- **Chamada que falha é cobrada pela estimativa,** como a ADR-0041 previa.

**O que se aceita.** O teto recusa um pouco antes, porque a estimativa conta a mais; um job
parado no reparo perde a primeira resposta; e no mês em que um teto foi atingido nem chamada
gratuita passa.
