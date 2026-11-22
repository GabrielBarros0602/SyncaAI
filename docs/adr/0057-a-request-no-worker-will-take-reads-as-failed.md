# ADR-0057: A request no worker will take reads as failed

**Status:** Accepted
**Date:** 2026-11-22
**Deciders:** Gabriel Barros

**Amends:** [ADR-0031](0031-a-job-queue-in-postgresql-woken-by-notify.md) §2, where the sweep is
what marks a stale job `failed` and nothing else does: a job now reads as failed as soon as it
can no longer run, and a person's request records their own. **Amends:**
[ADR-0050](0050-plans-and-their-requests-are-listed-and-an-approved-plan-counts-its-tasks.md),
whose rule that the status filtered is the status read held only for plans; it now holds for
requests too. **Builds on:**
[ADR-0033](0033-a-plan-fills-this-week-first-in-its-own-language-one-at-a-time.md), which reads
a plan's status against the clock, the model this follows.

## Context

ADR-0031 gives a job two ways to end without a result:
- **queued for fifteen minutes**, so it does not run late against a calendar that has moved on;
- **running under a lock that ran out on its third attempt**, so a dead worker is not waited
  on for ever.

Both are recorded by the worker's sweep, every five seconds, and by nothing else. Until it
runs, a job reads `queued` or `running`. With a worker that is a tick. Without one it is for
ever, and for the person whose request it is that has three consequences:
- **The polling never ends.** The plan screens follow a request until it is done or failed
  (S8), and this one is neither.
- **The Plan button says "queued" for ever.**
- **One plan at a time holds the place.** It reads the stored status, as the unique index
  behind it does (ADR-0033), so the person can ask for no other plan and, since a plan by hand
  is refused while a request is in progress, cannot write one either. ADR-0006's fallback, a
  plan by hand when the model is unavailable, is closed by the same outage it exists for.

A worker can be down: it is its own process, its own compose service (ADR-0031). Plans had the
same shape of defect, a pending plan whose last day had passed, and it was fixed on
2026-10-26 by recording a person's ended plans before their next request. Requests were not.

Found while planning the S8 screens, and answered on 2026-11-22.

## Decision

**A request reads as failed as soon as it can no longer run,** whether or not the sweep has
recorded it:
- in its own read, `GET /ai/plans/{job_id}`;
- in the listing, `GET /ai/plans`, where a request filtered by status is filtered by the
  status it reads, as plans are (ADR-0050). It is listed under `failed`, never under `queued`
  or `running`.

It reads with the sentence the sweep will write: "The plan waited too long to start. Ask for
it again." for one that never started, and "The plan could not be made in 3 tries. Ask for it
again." for one whose attempts ran out.

**Asking for a plan records the person's own.** By model or by hand, a request first marks as
failed every job of that person's that can no longer run, in the same transaction and before
the check for a plan in progress, as it already marks their ended plans expired. Everyone
else's stay the sweep's.

**The condition is written once.** It sits beside the job repository, and the sweep, the read
and the filter all use it. It is measured with the database's clock, the one `created_at` and
`locked_until` are written with. Recording a job therefore changes how it is stored and never
how it reads.

## Options Considered

| Option | Assessment |
|---|---|
| **Read as failed, recorded before a request — chosen** | The screen's polling always reaches an end, and the person is never held by a job no worker will take. The server's rule stays in one place, read by the server. |
| The screen gives up after a clock of its own | No server change. The screen guesses a bound the server holds, and the person stays held by the `409`, which only the server can release. |
| Nothing: the screen polls, slowly, for as long as it is open | No code. "Queued" stays true while no worker runs, and the person can neither ask again nor write a plan by hand. |
| The read records it, writing on `GET` | One code path for every caller. A read that writes, and a listing that writes once for each request it shows. |

## Trade-off Analysis

**A job can read failed a moment before a worker would have reached it.** The bounds are the
claim's own complements (ADR-0031): a job the read calls failed is one the claim will never
take. Nothing that could still run is called failed.

**A refused request rolls the recording back** with everything else, as the plans' does. That
is harmless: the job reads as failed either way, and the next request records it again.

**The sweep's sentence is chosen in two places,** the sweep's statement and the read of a job
not yet recorded, from the stored status alone. A test reads the job before and after the
sweep and holds the two answers equal.

## Consequences

**Easier**
- A request always ends, as read, within fifteen minutes of being asked or within its last
  lock, whether or not a worker runs.
- With the worker down, the person can still write a plan by hand.

**Harder**
- A job's status is one more thing read rather than stored, and every read of it has to go
  through the condition.

## Action Items

1. [x] The condition beside the job repository, used by the sweep, the read and the filter.
2. [x] Asking for a plan, by model or by hand, records the person's own first.
3. [x] Tests: both ways a job ends, read and listed as failed before the sweep and equal after
       it; a request still inside its time reads as stored; a stranded request makes room
       without the sweep; somebody else's is left to it.

---

## Português

**O problema.** O ADR-0031 dá a um job duas formas de terminar sem resultado: quinze minutos
na fila, ou o lock da terceira tentativa vencido. Só a varredura do worker grava isso. Sem
worker, o job lê `queued` para sempre:
- o polling das telas do S8 nunca termina;
- o botão Plan diz "queued" para sempre;
- a regra de um plano por vez lê o status gravado, e a pessoa não pode pedir outro plano nem
  escrever um à mão.

Os planos tinham o mesmo defeito, corrigido em 2026-10-26. Os pedidos não.

**A decisão.**
- **O pedido lê `failed` assim que não pode mais rodar,** na leitura e na listagem filtrada
  por status, com a frase que a varredura vai gravar.
- **Pedir um plano grava os da própria pessoa,** pelo modelo ou à mão, antes de conferir se há
  um em andamento. Os dos outros continuam com a varredura.
- **A condição é escrita uma vez,** ao lado do repositório de jobs, e a varredura, a leitura e
  o filtro usam a mesma, com o relógio do banco. Gravar muda como o job é guardado, nunca
  como é lido.

**Opções descartadas.**
- **A tela desistir sozinha:** adivinha um limite que é do servidor, e o 409 continua.
- **Não fazer nada:** a pessoa fica presa.
- **Gravar na própria leitura:** um `GET` que escreve.

**O que se aceita.** O status do job passa a ser lido, não só guardado, e a frase da falha é
escolhida em dois lugares, presos um ao outro por um teste.
