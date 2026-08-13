# ADR-0012: Business rules for a task's position in time

**Status:** Accepted — one consequence corrected below
**Date:** 2026-08-11
**Deciders:** Gabriel Barros

> **Correction.** This record states that free capacity is `max(0, 1440 - occupied)`. A local
> day is not always 1440 minutes: where daylight saving applies it can be 1380 or 1500. Use
> `syncaai.time_windows.minutes_in_local_day` instead of the constant. The rules themselves
> are unaffected; the maximum duration of 1440 remains the right bound for a single task.

## Context

Three rules about where a task may sit in time were left open by S1. Each one changes either a
schema constraint or the capacity query that the whole AI layer depends on
([ADR-0004](0004-context-assembly-policy.md)), so none can be deferred silently.

A distinction had to be cleared up first, because it looked like a conflict and was not.
**History** is tasks that already happened; they stay in the database and nothing removes them.
**Creating a task dated in the past** is a separate action — retroactive logging, or a typo.
History is never at risk either way.

## Decision

### 1. A task may not be created with a start in the past

Rejected at the service layer. Not a `CHECK` constraint: `now()` is not `IMMUTABLE`, so the rule
cannot live in the schema. The AI scheduler is additionally forbidden from proposing a start in
the past, as a domain invariant under
[ADR-0005](0005-structured-output-contract.md).

### 2. Maximum duration of a single task is 1440 minutes

`CHECK (duration_minutes > 0 AND duration_minutes <= 1440)`.

The ceiling follows from rule 3 rather than from taste: because every minute of a task is
attributed to the day it starts on, a task longer than 1440 minutes would claim to occupy more
minutes than a day contains.

### 3. A task's minutes count entirely on the day it starts

A task beginning at 23:00 with a four-hour duration contributes 240 minutes to that day, not 120
to each of two days.

## Options Considered

### Rule 1 — past-dated tasks

| Option | Assessment |
|---|---|
| Forbid entirely — **chosen** | Simple to explain, test and enforce. Costs retroactive logging. |
| Allow only when already completed | Separates *scheduling* in the past, which is meaningless, from *recording* in the past, which is normal. More expressive, one more service rule. |
| Allow freely | No code, but a typo creates a pending task on a date that will never arrive, and it hangs forever. |

### Rule 2 — maximum duration

| Option | Assessment |
|---|---|
| 1440 minutes — **chosen** | The largest value consistent with rule 3. |
| 480 minutes | Keeps capacity arithmetic comfortable, but forces splitting any longer block. |
| No limit | A single generated item could claim 30 hours and the day's capacity would stop meaning anything. |

Activities that genuinely exceed 24 hours — a trip, a conference — are **not tasks**. A
three-day trip is not 72 hours of occupied time; the traveller still sleeps and does other
things. Modelling it as one task would consume three full days of capacity, which is false. The
prototype already names the right concept: `Lisbon — depart 14 Aug · 8 days · 3 of 5
preparations done` is a period with tracked preparations, a separate entity that does not
consume day capacity. It is outside the minimum scope and recorded as a pending question.

### Rule 3 — tasks crossing midnight

| Option | Assessment |
|---|---|
| All minutes on the start day — **chosen** | Matches how a user reasons: what matters for planning is when something begins. Simple `GROUP BY` on the local date of `start_at`. |
| Split across both days | Physically accurate per-day capacity, at the cost of a materially more complex query with per-day clipping. |
| Forbid crossing midnight | Always coherent, but requires timezone-aware validation and forces splitting an evening event into two tasks. |

## Trade-off Analysis

Rule 3 is a product decision that buys clarity and pays in arithmetic. The consequence, accepted
explicitly: **a day can report more than 1440 minutes occupied**, because a task starting late
attributes all of its minutes to that day. Free capacity is therefore computed as
`max(0, 1440 - occupied)`, and the interface shows "over capacity" rather than a negative
number.

That consequence is bounded and visible, which is why it is acceptable. The alternative —
splitting minutes across days — would make the capacity query the most complex piece of SQL in
the project before the AI layer even exists.

Rule 1 chose the simpler option over the more expressive one. The cost is real and worth naming
plainly: retroactive logging is impossible, so a day missed is a day lost from the heatmap. If
that becomes annoying in practice, the "allow only when completed" variant supersedes this
record — the rule lives in one service method, so the change is contained.

## Consequences

**Easier**
- The capacity query stays a `GROUP BY` on one derived date with an integer `SUM`.
- The duration bound gives the AI response schema a concrete limit to declare, as ADR-0005
  requires.

**Harder**
- No retroactive logging. Forgetting to record yesterday means it is lost.
- A day may report over 1440 minutes occupied, so every consumer of capacity must floor free
  minutes at zero rather than trusting subtraction.
- Multi-day activities have no representation until the period entity exists.

**To revisit**
- Rule 1, if retroactive logging is missed in real use.
- Rule 3, if the scheduler starts placing tasks badly because a day looked free while its early
  hours were already occupied by a task that began the night before.

## Action Items
1. [ ] `CHECK (duration_minutes > 0 AND duration_minutes <= 1440)` in the first migration.
2. [ ] Service rule rejecting a start in the past, with a domain error, and a test at the
       boundary — one minute ago rejected, one minute ahead accepted.
3. [ ] Capacity helper floors free minutes at zero; test with a day deliberately over 1440.

---

## Português

**Regra 1 — tarefa não pode ser criada com início no passado.** Recusada na camada de serviço,
não no schema, porque `now()` não é `IMMUTABLE` e não cabe num `CHECK`. O agendador da IA também
não propõe nada no passado. **Consequência aceita: não existe registro retroativo.** Esqueceu de
anotar ontem, perdeu.

Antes disso, uma confusão desfeita: **histórico** são tarefas que já aconteceram e continuam no
banco, e não depende desta decisão. A decisão é só sobre **criar** tarefa datada no passado.

**Regra 2 — máximo de 1440 minutos.** O teto vem da regra 3, não de gosto: como todos os minutos
caem no dia de início, acima de 1440 a tarefa alegaria ocupar mais minutos do que um dia tem.

Atividades que passam de 24h — viagem, congresso — **não são tarefas**. Viagem de três dias não é
72 horas de tempo ocupado. O conceito certo já está no protótipo: `Lisbon — depart 14 Aug ·
8 days · 3 of 5 preparations done` é um período com preparações, entidade separada que não
consome capacidade de dia. Fora do escopo mínimo, registrada como pendência.

**Regra 3 — os minutos contam todos no dia em que a tarefa começa.** Decisão de produto: o que
importa para se organizar é quando a coisa começa.

**Consequência aceita:** um dia pode reportar **mais de 1440 minutos ocupados**. Capacidade livre
passa a ser `max(0, 1440 − ocupado)`, e a interface mostra "acima da capacidade" em vez de número
negativo.
