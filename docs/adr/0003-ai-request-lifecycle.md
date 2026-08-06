# ADR-0003: AI request lifecycle and transport

**Status:** Accepted
**Date:** 2026-08-06
**Deciders:** Gabriel Barros

## Context

Provider calls take seconds — typically 3-20s for a decomposition of a dozen items. Three
transports are available: block the HTTP request, stream the response, or enqueue a job and
report status separately.

The two MVP use cases (ADR-0002) have different output shapes:

- UC2 returns a **structured object** that is validated and persisted, then reviewed by the
  user before it becomes real tasks.
- UC1 returns **prose** the user reads.

The AI provider key must never reach the browser, which forces a real back end regardless of
transport.

## Decision

**Transport follows the shape of the output.**

- **Structured output (UC2) → queued job with polling.** `POST` returns `202` and a job id;
  a worker processes it; the front end polls for status.
- **Prose output (UC1) → server-sent events.** Streamed straight to the client over a
  long-lived response.

**Queue implementation:** PostgreSQL, using `SELECT ... FOR UPDATE SKIP LOCKED`. No Redis,
no broker, in v1.

**Provider access is behind one interface** (`PlanGenerator`) with a real implementation and
a `FakeGenerator` used by tests and by local development.

### Full path for UC2

```
POST /ai/plans  {prompt, horizon_days}
  1. authenticate
  2. rate limit check          (cheapest rejection first)
  3. cache lookup              (a hit costs nothing and returns immediately)
  4. spend cap check           (after the cache: a hit is free, no reason to block it)
  5. insert job row (status=queued)  -> 202 {job_id}

worker  (SELECT ... FOR UPDATE SKIP LOCKED)
  6. assemble context           (ADR-0004)
  7. call provider              (schema + timeout + backoff retry + circuit breaker)
  8. validate: schema, then domain invariants   (ADR-0005)
  9. one repair attempt if invalid              (ADR-0005)
 10. record usage: tokens in/out, cost, latency, model, prompt_version   (ADR-0006)
 11. assign items to days       — deterministic application code, not the AI (ADR-0005)
 12. persist plan_draft + draft_items -> job status=done

GET  /ai/plans/{job_id}      -> front end renders the review card
POST /plans/{id}/commit      -> single transaction + idempotency key -> real tasks
```

The ordering of steps 2-4 is reasoned, not arbitrary. Rate limiting precedes the cache
because it also protects against hammering the endpoint itself. The spend cap follows the
cache because a cache hit incurs no provider cost, so rejecting it on budget grounds would
be wrong.

## Options Considered

### Option A: Synchronous — block the HTTP request

| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Robustness | Poor |
| Fit for structured output | Poor |

**Pros:** simplest possible implementation; no worker process, no job table, no polling.
**Cons:** proxy and load-balancer timeouts kill long connections; a page refresh loses the
work; there is no room in the time budget for the repair retry (ADR-0005) without doubling
an already long wait; no retry visibility, no cancellation, no per-job cost accounting.
Blocking for 20s is precisely what a reviewer criticises.

### Option B: Server-sent events / streaming for everything

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Perceived latency | Best |
| Fit for structured output | Wrong |

**Pros:** best perceived latency; text appears as it is produced.
**Cons:** streaming JSON token by token is useless — nobody reads half a schema, and the
partial object cannot be validated until it is complete. It also complicates the
invalid-output repair path, because the client has already been shown output that may be
discarded.

### Option C: Queued job with polling — **chosen for UC2**

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Robustness | Good |
| Fit for structured output | Correct |

**Pros:** survives refresh; retries and cancellation are natural; per-job cost and latency
accounting comes free, which is what makes the spend cap and the README metrics real;
degradation is clean — queued jobs drain when the provider recovers.
**Cons:** requires a worker process and a job table; the front end needs polling; more
moving parts to deploy.

### Option D: Both, chosen per use case — **chosen overall**

Adds the cost of maintaining two transports (~+8h) in exchange for each use case getting the
transport its output shape actually requires.

### Queue backend: Postgres vs Redis

| | Postgres `SKIP LOCKED` | Redis (RQ/Celery) |
|---|---|---|
| New infrastructure | none | one service |
| Durability | transactional with the domain data | needs configuration |
| Ceiling | thousands of jobs/day, ample here | much higher |
| Portfolio value | demonstrates real SQL concurrency knowledge | demonstrates a common tool |

Postgres wins on both fewer moving parts and interview value at this scale. `FOR UPDATE SKIP
LOCKED` is a topic that comes up in interviews, and using it deliberately is worth more than
adding a broker that the load does not justify.

## Trade-off Analysis

The central insight is that transport is not a global choice — it is a consequence of what
the endpoint returns. Forcing one transport on both use cases means either streaming JSON
(useless) or polling for prose (needlessly slow to first byte).

The queue also happens to be the enabler for three other decisions: usage accounting
(ADR-0006), the repair retry (ADR-0005), and graceful degradation (ADR-0006). None are
practical inside a blocking request.

Choosing Postgres over Redis is deliberate under-engineering. The trigger for revisiting is
measured, not speculative: sustained job latency from queue wait rather than provider
latency, or the worker polling loop showing up in database load.

## Consequences

**Easier**
- Every AI call has a durable record with cost, latency and outcome — the metrics the
  portfolio needs and the substrate for the spend cap.
- Provider outages become a queue that drains rather than a wall of failed requests.
- The `FakeGenerator` seam makes the entire pipeline testable without spending money.

**Harder**
- A worker process must be run and supervised alongside the API — one more container in
  `docker-compose`.
- The front end needs polling with backoff, and a job-status state machine in the UI.
- Two transports means two sets of error paths.

**To revisit**
- Queue backend, if wait time (not provider time) becomes the dominant latency.
- Polling versus SSE for job status, if polling proves noisy.
- Job retention: decide how long completed jobs and their raw responses are kept.

## Action Items

1. [ ] Model `ai_job` with status, prompt_version, timestamps, error reason, usage fields.
2. [ ] Implement the claim query with `FOR UPDATE SKIP LOCKED` and a visibility timeout for
       crashed workers.
3. [ ] Define the `PlanGenerator` interface and the `FakeGenerator` before the real client.
4. [ ] Set an explicit provider timeout and a bounded backoff retry policy for 429/5xx only.
5. [ ] Add the worker as a separate service in `docker-compose.yml`.

---

## Português

**Decisão:** o transporte segue o formato da saída. Saída estruturada (caso 2) → **job em
fila com polling**: `POST` devolve 202 + job_id, worker processa, front consulta status.
Saída em prosa (caso 1) → **SSE / streaming**.

**Fila em PostgreSQL** com `SELECT ... FOR UPDATE SKIP LOCKED`. Sem Redis, sem broker na v1
— menos peça móvel, e `SKIP LOCKED` demonstra conhecimento real de concorrência em SQL.

**Por que não bloquear a requisição:** timeout de proxy, refresh perde o trabalho, e não
sobra orçamento de tempo para a tentativa de reparo. **Por que não streaming no caso 2:**
ninguém lê meio JSON, e não se valida objeto parcial.

**Ordem de 2 a 4 é raciocinada:** rate limit antes do cache porque também protege o
endpoint; teto de custo depois do cache porque cache hit não custa nada.
