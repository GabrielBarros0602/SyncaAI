# ADR-0042: Plan requests are limited over moving windows, counted from jobs

**Status:** Accepted
**Date:** 2026-10-24
**Deciders:** Gabriel Barros

**Amends:** [ADR-0006](0006-cost-limits-cache-degradation.md), its rate limiting. The numbers
stand — ten an hour and thirty a day, per person, answered with `429` and `Retry-After` — and
so does its place, first in the request path. What changes is what spends the allowance and
how the windows are measured. **Builds on:**
[ADR-0031](0031-a-job-queue-in-postgresql-woken-by-notify.md), whose jobs are kept as rows
after they finish, and [ADR-0033](0033-a-plan-fills-this-week-first-in-its-own-language-one-at-a-time.md),
whose index lets a person have one job in progress.

## Context

ADR-0006 chose fixed windows, a counter per person per window, because a moving window would
need a row per request. The limiter the sign-in already uses is that design: it counts every
attempt, including refused ones, so that guessing a password costs the guesser.

Two things are different for plans. A refused plan request is usually an honest one: a double
click answered "a plan is already being made", or a person over the limit trying again. And a
plan request that is accepted already leaves a row per request: its job, kept with its
`created_at` long after it finishes (ADR-0031, ADR-0036).

A fixed window also has an edge. Cut at the hour, ten requests at 13:59 and ten more at 14:00
are twenty in two minutes; cut at the UTC day, the day turns at 21:00 in São Paulo, and thirty
at 20:00 and thirty at 21:00 are sixty in two hours.

Answered on 2026-10-24.

## Decision

### 1. Only a request that becomes a job spends the allowance

The limit is checked first, as ADR-0006 orders, but what it counts is the person's jobs. A
refused request — over the limit, a plan already in progress, and later a ceiling — leaves no
job and spends nothing, so trying again after a refusal does not push the wait further away.

### 2. Both windows move, and they are read from `ai_jobs`

At most ten jobs created in any hour, and thirty in any twenty-four hours, counted from the
person's own jobs by `created_at`. No counter table: the jobs are the log ADR-0006 did not
want to keep, and it is kept anyway. `ix_ai_jobs_user_id_created_at` already covers the
predicate, and an integration test holds that the count reaches its rows through it.

A day is twenty-four hours from now, not a calendar day in any zone, so where a person lives
does not change their limit.

### 3. `Retry-After` says when the window has room again

For a full window, the job that keeps it full is the one with as many newer as the limit
allows; the wait is until it leaves the window. When both windows are full, the longer wait is
the one given.

### 4. Two requests at once cannot overshoot

The count and the insert are separate statements, so two requests can both see room for one
more. Both cannot become jobs: the index of ADR-0033 admits one job in progress per person, and
the second is refused as a plan already in progress.

## Options Considered

### What spends the allowance

| Option | Assessment |
|---|---|
| **A request that becomes a job — chosen** | A double click or a retry after a refusal costs nothing. The count is the jobs themselves. |
| Every authenticated attempt, as at sign-in | Protects the endpoint more, and punishes the honest retry, which for plans is the usual one. |

### How the windows are measured

| Option | Assessment |
|---|---|
| **Moving windows over the jobs — chosen** | No edge to burst across, no zone to choose, no new table. |
| Fixed hour, day at the person's midnight | Ends the 21:00 edge in São Paulo, keeps the 13:59–14:00 one, and needs the person's zone in the count. |
| Fixed hour and UTC day, ADR-0006 as written | One counter row per window, the same for everyone, and both edges. |

## Trade-off Analysis

**The limit is only as good as the jobs it reads.** It holds because nothing deletes a job
younger than a day: the purge empties a finished job's request after thirty days and keeps
the row (ADR-0036), and only deleting the account deletes jobs, which ends the limit's purpose.
A purge that ever deletes recent jobs has to read this record first.

**A refused request still costs a query.** Two indexed counts per request, which is the
cheapest rejection ADR-0006 wanted and no longer a write.

## Consequences

**Easier**
- A refused request does not lengthen its own wait.
- No table, no window arithmetic, no zone.

**Harder**
- The limit depends on jobs being kept for at least a day.

**To revisit**
- The numbers, once real use exists (ADR-0006 already says ten an hour is a guess).

## Action Items

1. [x] The count over both windows, before anything else a plan request does.
2. [x] `429` with `Retry-After` and a sentence a person can read.
3. [x] Integration tests for both windows, a refusal that spends nothing, another person's
       jobs, and the index.

---

## Português

**O problema.** A ADR-0006 escolheu janela fixa para não guardar uma linha por pedido. Mas no
pedido de plano essa linha já existe: o job. E a janela fixa tem borda — dez às 13h59 e dez às
14h00 são vinte em dois minutos; o dia UTC vira às 21h em São Paulo.

**A decisão.**
- **Só o pedido que vira job gasta a cota.** Recusa — limite, plano em andamento, teto — não
  gasta, e tentar de novo não empurra a espera.
- **As duas janelas são móveis, contadas em `ai_jobs`:** no máximo dez jobs em qualquer hora e
  trinta em quaisquer 24 horas, pelo índice que já existe, sem tabela nova e sem fuso.
- **`Retry-After`** é o tempo até o job que mantém a janela cheia sair dela; com as duas cheias,
  vale a espera maior.
- **Dois pedidos ao mesmo tempo não estouram:** o índice de um job em andamento por pessoa só
  deixa um entrar.

**O que se aceita.** O limite depende de nenhum job com menos de um dia ser apagado — hoje só a
exclusão da conta apaga jobs.
