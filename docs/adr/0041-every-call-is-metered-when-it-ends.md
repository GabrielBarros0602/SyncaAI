# ADR-0041: Every call is metered when it ends

**Status:** Accepted
**Date:** 2026-10-24
**Deciders:** Gabriel Barros

**Amends:** [ADR-0006](0006-cost-limits-cache-degradation.md), the spend cap's `ai_usage`
table, "written on every completed call". What it records stands: tokens in and out, the
computed cost, latency, model, `prompt_version` and job. This record says when a row is
written, which calls get one, where prices come from, and what outlives an account.
**Builds on:** [ADR-0031](0031-a-job-queue-in-postgresql-woken-by-notify.md) and
[ADR-0036](0036-a-job-s-answers-are-rows-of-their-own.md), under which a job can be claimed
three times and make two calls each time.

## Context

`ai_usage` is the first thing S7 builds, because the monthly cap and the global kill switch
are sums over it (ADR-0006). A sum is only a control if every call that can cost money is in
it. Four gaps in ADR-0006's wording would let calls escape it:

1. **Where the row is written.** A job writes its answers in one transaction at the end
   (ADR-0036). A worker that dies after a call, or finds its claim taken by another worker,
   writes nothing, and a job can be claimed three times: up to six calls, of which only the
   last attempt's would be counted. A bug that crashes the worker on every job is exactly
   the loop the kill switch exists for.
2. **Which calls.** "Every completed call" leaves out a call that timed out on this side. A
   paid provider can still bill it: the model kept generating after the connection closed.
3. **Where prices live.** ADR-0006 says configuration, not code, and leaves the form open.
4. **What a deleted account takes with it.** Every table that refers to a person cascades.
   If usage did, deleting an account would take its spend out of the month, and the global
   ceiling would open again.

Answered on 2026-10-24.

## Decision

### 1. One row per call, written when the call ends, in its own transaction

The generator a job uses is wrapped. When a call returns or raises, the wrapper writes its
row and commits it before the ladder goes on. A worker that dies after a call has already
counted it; a worker that lost its claim counted its calls too. The job's own write phase is
untouched.

### 2. Every call, with its outcome

A call that raises — a timeout, a refused connection — is recorded as `failed`, with how
long it took and the type of the error, and no tokens. Its cost is empty until the estimate
before the call exists; from then on, a failed call is charged at its estimate, which is the
most it could have cost.

### 3. Prices in a versioned file, cost written with the row

`syncaai/planning/prices.toml` holds what a million input and output tokens cost, per
provider and model, with the date each price was read. A change of price is a pull request.
The cost is computed when the row is written and stored with it, in US dollars as
`numeric(12, 8)`, so a later price never rewrites a past month.

The sample, a model running locally and the test double cost nothing, by rule rather than by
a row of zeros. A paid provider's model missing from the file has no price, and asking for
one is an error, never zero; the paid client will refuse such a model at boot.

### 4. Usage outlives the account

`user_id` and `job_id` are set to null when the person or the job is deleted, and the row
stays. It holds numbers only — no request, no answer — so it is not content the thirty-day
purge exists for, and once the person is gone it no longer says whose it was.

### The table

| Column | Holds |
|---|---|
| `user_id`, `job_id` | who and which job; null once deleted |
| `attempt`, `position` | which claim of the job, and whether the answer (0) or its repair (1) |
| `provider`, `model` | who answered; for a failed call, the model that was asked |
| `prompt_version` | the prompt the call was built from |
| `outcome`, `error` | `completed` or `failed`, and for a failed call the error's type |
| `input_tokens`, `output_tokens`, `cost_usd` | what a completed call used and cost |
| `latency_ms` | from the call to its return or its error |
| `created_at` | when the call ended; the month a ceiling counts it in |

CHECKs hold the shape: a completed call has its tokens and its cost, a failed one has an
error and no tokens.

## Options Considered

### When the row is written

| Option | Assessment |
|---|---|
| **Per call, in its own transaction — chosen** | Calls from attempts that died or lost the claim are counted. One more short transaction per call. |
| In the job's write phase, with the answers | One transaction, and the answers and their usage always agree. Loses every call of an attempt that did not write, which is the failure a ceiling has to see. |

### Which calls

| Option | Assessment |
|---|---|
| **Every call, with its outcome — chosen** | A timeout that a provider bills is counted, and the circuit breaker and latency percentiles see failures. |
| Completed calls only | ADR-0006's wording. The ceilings would assume a timeout is free. |

### Where prices live

| Option | Assessment |
|---|---|
| **A versioned file, cost stored per row — chosen** | Prices are public; a change is reviewed and dated. Stored costs keep the history without keeping old prices. |
| An environment variable holding JSON | Adjustable per deployment, invisible in the history, easy to get wrong. |
| A table with validity dates | Price history in the database; changing a price needs a migration or a screen, and stored costs already keep the history. |

### A deleted account's usage

| Option | Assessment |
|---|---|
| **Null the person, keep the row — chosen** | The month's spend stays counted; the row becomes anonymous. |
| Delete it with the person | Consistent with every other table, and deleting an account would reopen the global ceiling. |
| Null the person and purge after some months | Bounded growth, one more purge to maintain. One row per call is small; revisit when it is measured. |

## Trade-off Analysis

**Counting more than was spent is the safe side.** A row written for a call whose answer was
then lost still describes money that left; a ceiling that over-counts refuses a little early,
and one that under-counts does not refuse at all.

**The usage and the answers can disagree.** A job that lost its claim has usage rows and no
answers. That is the record being right about two different things: what was spent, and what
was kept.

## Consequences

**Easier**
- The ceilings are sums over one table that sees every call.
- The README's metrics — cost per plan, latency percentiles, repair rate — come from the same
  rows.

**Harder**
- Each call costs one more short transaction.
- The table grows for ever, by a row per call.

**To revisit**
- A purge of old usage, if the table's size is ever measured to matter.
- The cost of a failed call, once the estimate exists.

## Action Items

1. [x] `prices.toml` and the cost of a call from it.
2. [x] The `ai_usage` table, with its CHECKs and indexes.
3. [x] The wrapper, writing one row per call from every job.

---

## Português

**O problema.** O `ai_usage` é a base dos tetos da ADR-0006, e uma soma só controla se toda
chamada que pode custar estiver nela. A redação da ADR-0006 deixava escapar quatro casos:
- a chamada de uma tentativa que morreu ou perdeu o lock;
- a chamada que estourou o tempo, que um provedor pago pode cobrar;
- onde fica a tabela de preços;
- o gasto de uma conta apagada.

**A decisão.**
- **Uma linha por chamada, gravada quando ela termina,** numa transação própria, por um
  invólucro em volta do gerador.
- **Toda chamada, com o resultado.** A que falha fica sem tokens e, quando a estimativa
  existir, é cobrada por ela.
- **Preços num arquivo versionado,** `prices.toml`. O custo é gravado em cada linha em
  `numeric(12, 8)` dólares, então mudar um preço não reescreve o passado. Local, exemplo e o
  dublê custam zero por regra; modelo pago fora do arquivo é erro, nunca zero.
- **O uso sobrevive à conta:** `user_id` e `job_id` viram nulos e a linha fica, só com
  números.

**O que se aceita.** Uma transação curta a mais por chamada, uma tabela que só cresce, e uso
e respostas que podem discordar quando um job perde o lock — o uso conta o que foi gasto, as
respostas o que foi guardado.
