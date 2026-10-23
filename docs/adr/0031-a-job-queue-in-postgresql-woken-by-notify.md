# ADR-0031: A job queue in PostgreSQL, woken by NOTIFY and swept for what it misses

**Status:** Accepted
**Date:** 2026-10-23
**Deciders:** Gabriel Barros

**Builds on:** [ADR-0003](0003-ai-request-lifecycle.md), which chose a queued job with polling
and a PostgreSQL queue using `SELECT ... FOR UPDATE SKIP LOCKED`, and
[ADR-0006](0006-cost-limits-cache-degradation.md), which asked queued jobs to drain when the
provider recovers or expire after a bounded interval. Supersedes nothing. It settles the
retention ADR-0003 left under *To revisit*, and gives a home to the purge of expired rows the
roadmap tied to the worker.

## Context

ADR-0003 chose the queue and left its mechanics open:
- how a worker learns there is work;
- what happens to a job whose worker dies;
- how many times a job is tried;
- how long a job and the provider's raw response are kept. ADR-0005 says the raw response is
  always recorded, but not where.

Separately, four tables accumulate expired rows nobody removes: `refresh_tokens`,
`verification_tokens`, `password_reset_tokens` and `rate_limit_counters`. The roadmap parked
the purge until a scheduled process existed, and the worker is that process.

The two choices that are not engineering defaults were answered on 2026-10-23: how the worker
is woken, and where the raw response lives.

## Decision

### 1. One table, four states

`ai_jobs` holds:
- the owner, the kind (`plan`), the request and the `prompt_version`;
- the status: `queued`, `running`, `done` or `failed`;
- the attempts, and a `locked_until`;
- a readable failure reason;
- the raw response;
- the timestamps.

Usage and cost belong to `ai_usage` in S7 (ADR-0006), not here.

### 2. Claiming a job

One statement:

```sql
UPDATE ai_jobs
SET status = 'running', attempts = attempts + 1, locked_until = now() + interval '120 seconds'
WHERE id = (
    SELECT id FROM ai_jobs
    WHERE (status = 'queued' AND created_at > now() - interval '15 minutes')
       OR (status = 'running' AND locked_until < now() AND attempts < 3)
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
)
RETURNING *;
```

It is committed at once, and the provider call happens outside any transaction. A lock never
spans a network call.

**A worker that dies** leaves its job `running` with a `locked_until` in the past. The next
claim takes it back. That is the visibility timeout ADR-0003 asked for, and the extra attempt
is counted.

**Three attempts, then `failed`,** with a sentence a person can read and the manual retry
ADR-0005 promises.

**A job still `queued` after fifteen minutes** becomes `failed` instead of running late against
a calendar that has moved on. These are the bounded interval and the drain of ADR-0006: a
queue that waits out a provider outage, but not for ever.

The claim never picks up either kind of job: a stale `queued` job, or a `running` job whose
lock expired on its third attempt. The sweep (below) is what marks them `failed`. That way the
claim stays a single question, which job is ready, and does not also have to decide which job
is dead.

### 3. Waking the worker: NOTIFY, and a sweep

The API runs `NOTIFY ai_jobs` in the same transaction as the insert. PostgreSQL delivers it
only on commit, so the worker cannot wake for a job it cannot yet see. The worker `LISTEN`s
and claims until the queue is empty.

**Every five seconds it also sweeps.** That covers:
- a notification sent while it was restarting;
- a job whose lock expired;
- a queued job past its fifteen minutes.

**The notification carries no payload.** It is a knock on the door, never data. Nothing about
a person's request travels on the channel.

**Several workers can run.** `SKIP LOCKED` is what makes that safe, and every one of them
hears the same notification.

### 4. The worker process

`python -m syncaai.worker`, from the same image, as its own service in `docker-compose.yml`
(ADR-0003). On SIGTERM it finishes the job in hand and then exits. A job it cannot finish in
time is simply left to its lock, which the visibility timeout already handles.

### 5. What is kept, and for how long

**The raw response is stored on the job.** Thirty days after a job finishes, the worker
clears it and the request text, so the job keeps only its metadata: status, timestamps,
attempts, `prompt_version`. This holds the debugging record ADR-0005 asks for and the source
of S7's golden fixtures. What is stored is what came back for the person's own request, never
their calendar (ADR-0004).

**Hourly, the same worker purges:**
- tokens that expired more than seven days ago;
- rate-limit windows that ended more than a day ago.

The margins keep a short trail for investigating something that just happened, and nothing
past it.

## Options Considered

### Waking the worker (answered on 2026-10-23)

| Option | Assessment |
|--------|------------|
| **LISTEN/NOTIFY, plus a sweep — chosen** | A job starts the moment its request commits, and an idle queue costs nothing between sweeps. The sweep exists because NOTIFY is not durable: a notification sent while nobody listens is gone. |
| Polling only | Simpler. Latency up to the interval, and a query every second or two with the queue empty. |

### The raw response (answered on 2026-10-23)

| Option | Assessment |
|--------|------------|
| **On the job, cleared after 30 days — chosen** | It can be queried per job while debugging, and it becomes a golden fixture. Retention is bounded and enforced by the same process that writes it. |
| Application log only | Nothing more in the database. It disappears with log rotation, cannot be found by job, and leaves S7 nothing to build fixtures from. |

### A lock held across the provider call

| Option | Assessment |
|--------|------------|
| **Claim, commit, call, then record — chosen** | A slow provider never holds a row lock or a connection, and a dead worker is recovered by the timeout. |
| `FOR UPDATE` held for the whole job | No timeout needed. A twenty-second call holds a transaction and a connection open, and a hung provider holds them indefinitely. |

## Trade-off Analysis

**The numbers are defaults, each one a constant:** 120 seconds of visibility, three attempts,
fifteen minutes queued, a five-second sweep, thirty days of content, seven days and one day
of margin. The visibility timeout must outlast the provider timeout of S7 with room to
spare, and that is the only one with a hard constraint behind it.

**A job can run twice.** A worker that is slow but alive past its 120 seconds can have its job
claimed again. Writing the draft is therefore guarded by the job's own state: only the
attempt that still holds the job may record a result. A duplicate costs one wasted call, not
a duplicate draft.

**Purging from the worker ties two unrelated jobs to one process.** Accepted, because a
second scheduled process for four `DELETE` statements is more to run and supervise than it
saves. If the worker is ever split, the purge moves with whichever side keeps the schedule.

## Consequences

**Easier**
- A job starts within a moment of being requested, with no queue polling at idle.
- Every job has a durable record, and a provider outage drains instead of failing in bulk.
- The four token and counter tables stop growing.

**Harder**
- A second process to run and supervise, now in the compose file.
- The worker holds a dedicated connection for `LISTEN`, outside the request pool.

**To revisit**
- Redis, only with a measured reason (ADR-0003).
- How long job metadata is kept, once S7's usage table shows what it is used for.

## Action Items

1. [ ] `ai_jobs`, with the claim, the timeout, the attempts and the expiry.
2. [ ] `NOTIFY` on enqueue, `LISTEN` plus the sweep in the worker.
3. [ ] The worker as a compose service, stopping cleanly on SIGTERM.
4. [ ] The retention and the purge, hourly, each with a test against PostgreSQL.
5. [ ] An integration test that two workers never claim the same job.

---

## Português

**O problema.** O ADR-0003 escolheu a fila no PostgreSQL e deixou a mecânica em aberto.

**A decisão.**
- **Uma tabela, `ai_jobs`, com quatro estados.**
- **O claim é um `UPDATE` sobre um `SELECT ... FOR UPDATE SKIP LOCKED`**, comitado na hora. A
  chamada ao provedor nunca acontece com lock aberto.
- **Visibility timeout de 120 s:** se o worker morre, o job volta para a fila.
- **Três tentativas e o job vira `failed`,** com uma frase legível. Na fila há mais de 15
  minutos, também vira `failed`.
- **O worker acorda por `NOTIFY`** e faz uma varredura a cada 5 s, porque o `NOTIFY` não é
  durável. O canal não carrega dado nenhum.
- **A resposta bruta fica no job,** e depois de 30 dias o worker apaga ela e o texto do pedido.
- **De hora em hora, o mesmo worker expurga** tokens vencidos há mais de 7 dias e janelas de
  rate limit encerradas há mais de 1 dia.

**Opções descartadas.**
- **Só polling:** latência e consulta constante.
- **Só log:** some na rotação e não serve de fixture.
- **Lock durante a chamada:** prende conexão enquanto o provedor demora.
