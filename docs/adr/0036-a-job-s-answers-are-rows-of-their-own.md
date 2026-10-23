# ADR-0036: A job's answers are rows of their own

**Status:** Accepted
**Date:** 2026-10-23
**Deciders:** Gabriel Barros

**Amends:** [ADR-0031](0031-a-job-queue-in-postgresql-woken-by-notify.md), decisions 1 and 5,
where "the raw response" is a column of the job. Everything else in it stands: the four
states, the claim, the visibility timeout, the sweep and the thirty days.

## Context

ADR-0031 gave each job one raw response, kept for thirty days after the job finishes.
[ADR-0035](0035-repair-whenever-a-step-fails-and-keep-the-better-answer.md) then made a job
produce up to two answers, the first and its repair, and decided to keep both, with each
one's errors and which one the draft was built from. A single column cannot hold that.

Answered on 2026-10-23. The scenario: a first answer of 6 KB with three errors, a repair of
7 KB with none, the draft built from the repair, and all of it gone thirty days later except
the job's metadata.

## Decision

### 1. `ai_job_answers`, one row per answer

| Column | Holds |
|---|---|
| `job_id` | the job, `ON DELETE CASCADE` |
| `position` | 0 for the first answer, 1 for the repair |
| `raw` | exactly what came back |
| `errors` | `text[]`, each one addressed as the repair addressed it |
| `model` | the model that answered |

**The primary key is `(job_id, position)`, and a `CHECK` holds `position` to 0 or 1.** Together
they are ADR-0005's "one repair, never two", held by the database: a third answer is refused,
whichever code path tries to write it.

**The job keeps `chosen_answer`,** the position the draft was built from. A `CHECK` ties it to
the job's status: a `done` job has one, and no other job does.

### 2. Thirty days, by deleting rows

The worker deletes the answers of every job that finished more than thirty days ago, and
clears the job's request text, as ADR-0031 already said. The job keeps its status, its
timestamps, its attempts, its `prompt_version` and `chosen_answer`: enough to count how often
a repair won, without anything the person wrote or the model answered.

### 3. The job's other columns, made explicit

ADR-0031 named the columns. Writing them as a schema settled the rest:

- **`request` and `horizon_days`** are stored, because the worker builds the prompt from them
  (ADR-0033). The request may be null only once the job has finished, which is what lets the
  purge clear it and nothing else.
- **`finished_at`** is set exactly when a job becomes `done` or `failed`. It is what the thirty
  days are counted from.
- **The states hold their own facts:** `running` has a `locked_until`; `failed` has a reason, and
  nothing else does.
- **One job in progress per person** is the partial unique index ADR-0033 decided, on
  `(user_id) WHERE status IN ('queued', 'running')`.

## Options Considered

| Option | Assessment |
|---|---|
| **A child table — chosen** | The database holds "at most two" with a key and a `CHECK`, as the project holds every rule it can. Typed columns, a plain table in the Java port (ADR-0001), and the purge is a `DELETE`. Costs a table and a join when debugging. |
| A `jsonb` column on the job | One table, one write, and the purge sets a column to null. The database cannot hold the shape: a misspelt key is accepted without a word, and the Java port needs a JSON converter. |
| Two fixed sets of columns on the job | Matches "at most two" exactly. Parallel columns for one idea, and every new field per answer becomes two more columns. |

## Trade-off Analysis

**A job can make up to six calls, and that is accepted.** ADR-0031 allows three attempts when
a worker dies mid-job, and ADR-0035 allows two calls per attempt. The answers are written once,
when the run finishes, in the same transaction as the draft. A run that dies writes nothing, and
the next attempt starts again from the request. Resuming from the answers of a dead run would
save calls, but it would add a state between "running" and "finished" for a failure that should
be rare. What bounds the spend is ADR-0006: the per-person ceiling and the global kill switch,
checked before every call. If S7 measures crashes that are not rare, resuming is the change to
make, through a new record.

## Consequences

**Easier**
- "How often does the repair win?" is a query over two tables, for thirty days of content and
  for as long as the jobs exist in metadata.
- A third answer cannot be stored, by any code.

**Harder**
- One more table, and a join to read a job's answers.

**To revisit**
- Resuming a run from its stored answers, if crashes in S7 are measured and are not rare.

## Action Items

1. [ ] `ai_jobs` and `ai_job_answers`, by migration, with every `CHECK` above and the two
       indexes.
2. [ ] Enqueue with `NOTIFY` in the same transaction; the claim; the sweep.
3. [ ] The worker writes the answers and `chosen_answer` with the draft, in one transaction.
4. [ ] The purge deletes answers and clears the request after thirty days.

---

## Português

**O problema.** A ADR-0031 guardava uma resposta bruta por job, mas a ADR-0035 passou a
guardar até duas, a primeira e o reparo, com os erros de cada uma e qual delas virou o
rascunho. Uma coluna só não comporta isso.

**A decisão.**
- **Uma tabela filha, `ai_job_answers`, com uma linha por resposta.** A chave primária
  `(job_id, position)` e um `CHECK` de `position` em 0 ou 1 fazem o banco recusar uma terceira
  resposta.
- **O job guarda `chosen_answer`,** e só um job `done` pode ter um.
- **Trinta dias depois de o job terminar, as linhas são apagadas e o pedido é limpo.** O job
  fica só com os metadados.
- **Os estados seguram os próprios fatos:** `running` tem `locked_until`, `failed` tem motivo, e
  só jobs terminados têm `finished_at`.

**O que se aceita.** Um job pode fazer até seis chamadas: três tentativas, se o worker cair,
vezes duas chamadas por tentativa. Quem limita o gasto é a ADR-0006, com o teto por pessoa e o
kill switch global.
