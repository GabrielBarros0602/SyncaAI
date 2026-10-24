# ADR-0039: A local open model until a provider is paid for

**Status:** Accepted; decision 2 amended by
[ADR-0040](0040-what-the-local-model-is-held-to-measured.md)
**Date:** 2026-10-23
**Deciders:** Gabriel Barros

**Builds on:** [ADR-0003](0003-ai-request-lifecycle.md), which put every model behind one
`PlanGenerator` interface; [ADR-0006](0006-cost-limits-cache-degradation.md), whose ceilings
and estimate before the call this keeps; and the provider criteria recorded with decision 13
of `docs/backlog.md`. Answers the open row 22 of `docs/threat-model.md` for local use.
Supersedes nothing.

## Context

S7 was planned as "the real provider": a paid client, golden fixtures captured from real
answers, and cost measured on every call. Choosing that provider was the step before any
client code. It met a constraint the roadmap had not written down: this is a portfolio
project, and no money will be spent on it for now.

The criteria for a provider were already set: no training on what it is sent (ADR-0004),
native structured output (ADR-0005), and a hard spend ceiling (ADR-0006). On 2026-10-23
three providers were compared against each provider's own pages. Anthropic, OpenAI and Google
each meet the first two on their paid tiers. They differ on the third, and on estimating a
call's cost before making it.

Answered on 2026-10-23.

## Decision

### 1. No paid provider now; in theory, Anthropic

**If a provider is ever paid for, it is Anthropic.** As checked on its pages on 2026-10-23:
- a spend limit per organization and per workspace stops requests when it is reached, so
  SyncaAI can live in a workspace with a ceiling of its own;
- `count_tokens` gives the exact estimate ADR-0006 asks for before a call;
- API inputs and outputs are deleted within thirty days and are not used for training.

**Within it, the cheapest current model, measured.** That is Claude Haiku 5.5, at US$ 0.10 and
US$ 0.50 per million input and output tokens, about a tenth of a cent per plan. Golden
fixtures and `ai_usage` measure:
- how many plans need a repair;
- how many steps are discarded;
- what a completed plan costs.

A move to a larger model is a new record, made on those numbers. The example thresholds were a
repair rate above 30% or a discard rate above 20%. They are confirmed or replaced when the
first measurements exist.

Nothing is wired to a paid provider until that decision is made again.

### 2. Now, a local open model

`PlanGenerator` gains a second real implementation. It calls a model with open weights through
Ollama on the developer's own machine, with the response schema passed as Ollama's `format`, so
the answer is held to `PlanResponse` as a provider's structured output would be.

| `AI_PROVIDER` | What answers | Where it is used |
|---|---|---|
| `sample` (default) | the fixed three-step plan | tests of the pipeline, CI, and any deployment |
| `ollama` | the model named by `OLLAMA_MODEL`, at `OLLAMA_URL` | development, with real answers at no cost |

**The model is a setting, not part of this record.** The machine this was decided on has 8 GB
of GPU memory and 32 GB of RAM, which suits an open model of about eight billion parameters,
quantized. Which one is picked once Ollama is installed, and changing it is a change to `.env`.

**`ollama` without `OLLAMA_MODEL` is refused at boot.** Otherwise the first job would fail with
an obscure error, which is the failure the settings exist to prevent.

**Each call waits at most fifty seconds.** A job with a repair makes two calls, and both have to
fit inside the claim's 120-second lock (ADR-0031). A call that runs longer fails, and the job
is left to its lock like any job that did not finish.

### 3. What this changes in S7

**Built now, because none of it needs money:**
- the per-person rate limit;
- the monthly ceiling and the global kill switch, priced from a table where a local model
  costs nothing;
- the estimate before the call;
- the circuit breaker;
- the manual fallback;
- golden fixtures captured from the local model, each labelled with the model that produced
  it.

**Waits for a paid provider:**
- the Anthropic client;
- fixtures from the model production would use;
- cost measured in money;
- the provider-side budget alert.

### 4. What it settles in the threat model

**Row 22, what a provider keeps of what it is sent, is closed for local use by construction:**
the prompt never leaves the machine. It reopens the day a paid provider is wired in, against
the terms above.

**Row 12 has no key to protect while no provider is paid for.**

## Options Considered

### Which provider, in theory

| Option | Assessment |
|---|---|
| **Anthropic — chosen** | Hard spend limit per organization and per workspace, an exact token count before the call, deletion within thirty days, no training on API data. The cheapest current model costs about US$ 0.001 a plan. |
| OpenAI | Close on every criterion: a hard spend limit per organization and per project since 2026, no training without opt-in, logs kept up to thirty days, and a cheapest current model at the same price. An endpoint to count tokens before a call was not confirmed. |
| Google Gemini | No training only on the paid tier. The current Flash model costs about seven times as much, and doubles in 2027. No hard spend ceiling for the API was confirmed; Cloud budgets alert by default, which is the weak point against ADR-0006. |

### How S7 moves without spending

| Option | Assessment |
|---|---|
| **A local open model — chosen** | Real answers for free, and nothing leaves the machine. Needs local hardware, quality is likely lower, its fixtures come from a model production would not use, and a small hosted machine cannot run it. |
| The paid client, written and switched off | The production client exists and is tested against a fake transport, at no cost. Every answer stays the sample's until a key exists, so no fixture is real. |
| S7 paused | Costs nothing. The other fronts are blocked too: the front end is frozen, S8 depends on it, and S9 is AI as well. |

## Trade-off Analysis

**The local model is the real thing for the pipeline, not for the plans.** Everything S6 built,
including the ladder, the repair, the discards, the placing and the review, now meets answers
that were not written to pass. What those answers cannot tell is how a production model would
plan. Fixtures carry the model's name so that nobody reads one as the other.

**A deployment cannot run it.** A small hosted machine has no room for an eight-billion-
parameter model, so a published SyncaAI answers with the sample and says so. That is ADR-0006's
degradation working as designed, not a gap: the product works with the provider absent.

## Consequences

**Easier**
- Real answers in development, at no cost, with nothing sent anywhere.
- A second implementation proves the interface is not shaped around one provider, which the
  Java port also wants (ADR-0001).

**Harder**
- Setting up development now includes installing Ollama and pulling a model, for anyone who
  wants real answers.
- Golden fixtures describe a local model, not the production one.

**To revisit**
- Paying for a provider. When it happens: the Anthropic client, fixtures from its model,
  measured cost, and the step-up rule, all through a new record.

## Action Items

1. [ ] `OllamaGenerator` behind `PlanGenerator`, held to the response schema; `AI_PROVIDER`,
       `OLLAMA_URL`, `OLLAMA_MODEL`; the worker built from them.
2. [ ] Rate limit, ceilings priced by a model table, the estimate before the call, circuit
       breaker, and manual fallback.
3. [ ] Golden fixtures from the local model, labelled with it.

---

## Português

**O problema.** O S7 foi planejado como o provedor real, com cliente pago, golden fixtures de
respostas reais e custo medido. Na hora de escolher o provedor, apareceu uma restrição que o
roadmap não tinha escrito: o projeto é de portfólio, e por enquanto não vai haver gasto.

**A decisão.**
- **Nenhum provedor pago agora. Na teoria, Anthropic.** Ela tem limite rígido de gasto por
  workspace e `count_tokens` para a estimativa antes da chamada; apaga entrada e saída em até
  30 dias e não treina com dados da API. Começaria no Claude Haiku 5.5, o mais barato, e só
  subiria de modelo por ADR nova, com base em medição.
- **Agora, um modelo aberto local, via Ollama,** como segunda implementação da
  `PlanGenerator`, preso ao mesmo schema. O `AI_PROVIDER` escolhe entre `sample`, que é o
  padrão e o que o deploy usa, e `ollama`, que é o da máquina de desenvolvimento.
- **O modelo é configuração, não decisão desta ADR.** Com 8 GB de VRAM, cabe um modelo de uns
  8B parâmetros quantizado.
- **Cada chamada espera no máximo 50 s,** para que duas caibam no lock de 120 s.

**O que se aceita.** As fixtures vêm de um modelo que a produção não usaria, e um deploy
pequeno responde com o exemplo. Os guardrails do S7 que não dependem de dinheiro são feitos
agora.
