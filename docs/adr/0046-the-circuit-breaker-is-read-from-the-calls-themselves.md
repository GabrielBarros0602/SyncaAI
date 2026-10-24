# ADR-0046: The circuit breaker is read from the calls themselves

**Status:** Accepted
**Date:** 2026-10-24
**Deciders:** Gabriel Barros

**Amends:** [ADR-0006](0006-cost-limits-cache-degradation.md), its degradation: "a circuit
breaker on the provider client", whose state, thresholds and failure it left open. What it
asked of the breaker stands: when it opens, planning is refused with an explanation, jobs
already queued wait or expire, and the rest of the product is untouched. **Builds on:**
[ADR-0031](0031-a-job-queue-in-postgresql-woken-by-notify.md), whose queue lets a job wait
fifteen minutes, and [ADR-0041](0041-every-call-is-metered-when-it-ends.md), whose `ai_usage`
records every call with its outcome.

## Context

Without a breaker, a model that is down is found out one job at a time. Each job claimed calls
it, fails at once, is left to its 120-second lock and is tried again, three times, before it
fails; meanwhile the API keeps accepting plans nobody can make. With the local model the
failure is ordinary: Ollama not running refuses the connection immediately.

ADR-0006 put the breaker "on the provider client", which is a process. The API is another
process, and it is the one that has to refuse a plan with an explanation.

Answered on 2026-10-24.

## Decision

### 1. The state is derived from `ai_usage`

No table and no memory: the breaker is a reading of the provider's latest calls, which every
process can make and which survives a restart. The same move as ADR-0042, whose limit is read
from the jobs.

### 2. A failure is a call that raised

A timeout, a refused connection, an error from the provider: a row with outcome `failed`. An
answer that is not usable is the model's quality, not its availability, and is left to the
ladder and to measurement.

### 3. Three in a row open it for sixty seconds

| State | When |
|---|---|
| **Open** | the provider's three latest calls all failed, the latest less than 60 s ago |
| **Half-open** | the same three failures, the latest 60 s ago or more: the next call is let through as a probe |
| **Closed** | anything else — fewer than three calls, or any of the three completed |

A probe that fails is a new latest failure, and the breaker is open for another sixty seconds;
one that completes closes it. Sixty seconds is under the claim's 120-second lock, and a probe a
minute costs nothing anyone notices.

### 4. While it is open

- **The request** is refused with `503` and `Retry-After` until the probe is due. It is the last
  check before the queue: after the rate limit, the plan in progress and the ceilings, so a
  person whose month is spent hears that, which stays true longer.
- **The worker** claims nothing. Jobs already queued wait, and the sweep fails any still queued
  after fifteen minutes (ADR-0031), as ADR-0006 asked.

## Options Considered

### Where the state lives

| Option | Assessment |
|---|---|
| **Derived from `ai_usage` — chosen** | One reading for the API and every worker, nothing more to write. With several workers, two can probe at once when the breaker half-opens. |
| A table of its own | One probe at a time, guaranteed; a write per failure and a state to keep consistent with `ai_usage`. |
| Each worker's memory | The simplest; the API cannot see it, so it can neither refuse nor explain. |

### What counts

| Option | Assessment |
|---|---|
| **A call that raised — chosen** | Availability, which is what a breaker is for. |
| Also an answer with no usable step | A model that plans badly would switch planning off by itself, a decision that belongs to a measurement. |

### The thresholds

| Option | Assessment |
|---|---|
| **Three failures, sixty seconds — chosen** | Opens within seconds when Ollama is down; under the lock. |
| Five failures, thirty seconds | Tolerates a single blip better; more wasted calls per outage. |
| Settings, these as defaults | One more knob, with no measured need. |

### A request while it is open

| Option | Assessment |
|---|---|
| **Refused, `503` — chosen** | The person knows at once that planning is down. |
| Accepted into the queue | If the model does not return, the person learns it fifteen minutes later, from an expired job. |

## Trade-off Analysis

**Two probes can race.** When the breaker half-opens, every worker that ticks sees it closed
enough to claim. With one worker, which is what runs, there is one probe; with more, there are
at most that many.

**A failure older than the provider's last three calls is forgotten.** A model that fails
every other call never opens the breaker. That is a model that works half the time, which the
ladder and the job's attempts already absorb.

## Consequences

**Easier**
- A model that is down is refused in seconds, with a reason, instead of found out per job.
- The breaker has no state of its own to drift.

**Harder**
- The request path reads three rows of `ai_usage` more.

**To revisit**
- A table, if several workers ever race their probes enough to matter.

## Action Items

1. [x] The reading, its thresholds and `Retry-After`.
2. [x] `503` on the request; no claim while open.
3. [x] Tests of open, half-open and closed, against a scripted model.

---

## Português

**O problema.** Sem breaker, um modelo fora do ar é descoberto job a job: cada um falha, fica
preso no lock de 120 s e é tentado três vezes, enquanto a API aceita pedidos que ninguém vai
atender. A ADR-0006 pôs o breaker no cliente, que é um processo; mas quem recusa o pedido é a
API, que é outro.

**A decisão.**
- **O estado é derivado do `ai_usage`:** sem tabela e sem memória, uma leitura das últimas
  chamadas do provedor que a API e os workers fazem igual.
- **Falha é chamada que deu erro** — timeout, conexão recusada, erro do provedor. Resposta ruim
  é qualidade, não disponibilidade.
- **Três falhas seguidas abrem por 60 s;** depois, a próxima chamada passa como teste: se
  falhar, abre de novo; se der certo, fecha.
- **Aberto:** o pedido recebe `503` com `Retry-After`, e o worker não pega job; os da fila
  esperam ou expiram em 15 min.

**O que se aceita.** Com vários workers, dois testes podem acontecer juntos; e um modelo que
falha uma vez sim, outra não, nunca abre o breaker.
