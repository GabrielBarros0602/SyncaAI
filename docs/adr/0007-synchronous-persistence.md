# ADR-0007: Synchronous SQLAlchemy for persistence

**Status:** Accepted
**Date:** 2026-08-07
**Deciders:** Gabriel Barros

## Context

FastAPI supports both synchronous and asynchronous database access. The choice has to be made
before the first repository exists, because it propagates into every repository, service, test
fixture and the AI worker. Reversing it later means rewriting all of them.

The relevant load characteristics of SyncaAI are unusual and decide the question:

- It is a personal operations tool. Realistic concurrency is one user, occasionally a handful.
- The expensive operation in the system is the AI provider call, at 3-20 seconds — but
  [ADR-0003](0003-ai-request-lifecycle.md) already moved it off the request path into a queued
  worker. The HTTP request that starts a generation returns `202` immediately.
- The remaining request path is short: authentication, a few indexed queries, a capacity
  aggregation over at most a few hundred rows.

## Decision

Use synchronous SQLAlchemy: `Session`, `sessionmaker`, and a synchronous `get_session`
dependency. FastAPI executes synchronous dependencies and path operations in a threadpool.

## Options Considered

### Option A: Synchronous — chosen

| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Concurrency ceiling | Threadpool-bound; ample at this scale |
| Testability | High — no event loop in fixtures |
| Ecosystem friction | Minimal; most SQLAlchemy material is synchronous |

**Pros:** lazy loading behaves as documented; sessions and transactions are easy to reason
about; test fixtures are plain functions; the worker is a plain loop. Debugging a failed query
means reading a stack trace, not untangling a greenlet.
**Cons:** the threadpool is a real ceiling under high concurrency. Asynchronous SQLAlchemy also
appears in job descriptions, so choosing synchronous forgoes that talking point.

### Option B: Asynchronous

| Dimension | Assessment |
|---|---|
| Complexity | Medium-high |
| Concurrency ceiling | Much higher |
| Testability | Lower — async fixtures, event loop management |
| Ecosystem friction | Notable; lazy loading semantics differ |

**Pros:** higher concurrency per process, and the more current FastAPI idiom.
**Cons:** lazy loading raises instead of emitting a query, so every relationship needs eager
loading or explicit awaiting; `MissingGreenlet` errors are opaque and cost hours the first
time; every repository, service, fixture and the worker becomes `async`, adding friction to
every subsequent sprint.

## Trade-off Analysis

Asynchronous I/O pays off when a process spends its time waiting on many concurrent slow
calls. In SyncaAI the one genuinely slow call — the AI provider — is deliberately *not* on the
request path. [ADR-0003](0003-ai-request-lifecycle.md) queues it precisely so a slow provider
cannot occupy a request.

**Asynchronous persistence would therefore solve a problem this architecture already avoided
by design.** Paying its complexity cost across every sprint, to raise a ceiling nowhere near
being reached, would be optimising the wrong axis — and the cost would be taken out of the AI
layer, which is what the project is judged on.

The résumé argument for asynchronous is real but weak here: being able to explain *why*
synchronous was correct for this workload demonstrates more judgement than having used
`AsyncSession` without a reason.

## Consequences

**Easier**
- Repositories, services and tests are ordinary functions.
- Integration tests wrap each test in a transaction and roll back, with no event loop plumbing.
- The AI worker is a plain loop, matching the `FOR UPDATE SKIP LOCKED` pattern in ADR-0003.

**Harder**
- Concurrency is bounded by FastAPI's threadpool. If a single endpoint ever needs to fan out
  to many slow external calls, it will need its own solution rather than the default path.
- Mixing in an asynchronous library later requires care at the boundary.

**To revisit**
- If measured request latency shows threadpool saturation rather than query time. Speculation
  does not count; the trigger is a measurement.

## Action Items

1. [ ] `get_engine`, `get_session_factory` and `get_session` in `syncaai/db.py`, all synchronous.
2. [ ] `pool_pre_ping=True` so a recycled or dropped connection is replaced rather than raising.
3. [ ] Revisit only against measured evidence of threadpool saturation.

---

## Português

**Decisão:** SQLAlchemy síncrono — `Session`, `sessionmaker` e dependência `get_session`
síncrona. O FastAPI roda dependência síncrona num threadpool.

**Razão central:** I/O assíncrono compensa quando o processo passa o tempo esperando muitas
chamadas lentas concorrentes. No SyncaAI a única chamada realmente lenta — o provedor de IA —
está deliberadamente **fora** do caminho da requisição, porque o ADR-0003 a colocou numa fila
com worker. Então persistência assíncrona resolveria um problema que esta arquitetura já
evitou por desenho, e o custo de complexidade sairia da camada de IA, que é o que o projeto
tem de diferencial.

**Custo aceito:** a concorrência fica limitada pelo threadpool do FastAPI. Revisar só com
medição de saturação, não com especulação.

**Sobre currículo:** saber explicar por que síncrono é correto para esta carga demonstra mais
julgamento do que ter usado `AsyncSession` sem motivo.
