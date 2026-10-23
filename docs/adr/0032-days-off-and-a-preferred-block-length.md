# ADR-0032: Days off and a preferred block length, for the planner

**Status:** Accepted
**Date:** 2026-10-23
**Deciders:** Gabriel Barros

**Builds on:** [ADR-0004](0004-context-assembly-policy.md), which lists three preferences the
planner needs (preferred block length, days off, working hours), and
[ADR-0029](0029-the-usable-day-is-a-window-each-person-sets.md), which stored the third as the
usable window. Supersedes nothing.

## Context

The planner of ADR-0030 places items in each person's free time. The window says when a day
runs. Nothing yet says which days a person does not want planned, or how long a block of
focused work should be for them. Without the first, a study plan lands on a Sunday kept free
on purpose. Without the second, the model sizes items by its own idea of a sensible step.

Both were chosen for now, on 2026-10-23, over adding only days off or neither.

## Decision

### 1. Two columns on `users`

| Column | Type | Default | Constraint |
|---|---|---|---|
| `days_off` | `smallint[]`, ISO weekdays (Monday is 1) | empty | every element between 1 and 7, fewer than seven of them |
| `preferred_block_minutes` | `smallint` | 60 | between 15 and 240 |

**At least one working day** is a `CHECK`. A week with no day to plan in is not a preference,
it is a planner that can never answer.

**`PATCH /me` stores `days_off` sorted and without repeats,** so the same set always has one
spelling.

### 2. They change the planner, and nothing else

- **The scheduler skips days off** (ADR-0030).
- **The model is told the block length,** and the domain layer refuses an item longer than it:
  `estimated_minutes` must be between 15 and the block.

**A day off is still a day.** The week screen measures it against the window like any other,
and a person can book whatever they like on it. A preference about what the planner may
propose does not get to make a day's capacity zero, because that would be the tool deciding
how somebody spends their own Sunday.

### 3. The API

`GET /me` reports both. `PATCH /me` accepts either, alongside the window. Each refusal has its
own sentence:
- `There has to be at least one day to plan in.`
- `A weekday is a number from 1 (Monday) to 7 (Sunday).`
- `A block lasts from 15 minutes to 4 hours.`

## Options Considered

| Option | Assessment |
|--------|------------|
| **Both now — chosen** (answered on 2026-10-23) | The planner arrives complete as ADR-0004 described it. Every preference it reads exists before the first plan is generated. |
| Days off only | The preference that changes the result most. Item size would rest on the fixed per-item ceiling alone. |
| Neither | Less schema. A plan can land on a day the person does not work. |

### How to store days off

| Option | Assessment |
|--------|------------|
| **`smallint[]` of ISO weekdays — chosen** | It reads as what it is. The bounds are a `CHECK` with `<@`, and it maps to a list of integers in the Java port (ADR-0001). |
| A seven-bit mask | Compact and portable. Unreadable in SQL and in a review, and every query has to decode it. |
| Seven boolean columns | Explicit. Seven columns for one idea, and a `CHECK` across all of them to say at least one is false. |

## Trade-off Analysis

**Days off do not touch capacity.** The alternative, zero budget on a day off, would make the
screen say "over budget" for one errand on a Saturday. A preference about planning would then
be judging the person's own week.

**The block bounds the model, not the person.** Tasks a person creates keep the limits they
always had (ADR-0012). Only items the model proposes are held to the block.

## Consequences

**Easier**
- The planner respects the days and the rhythm a person chose.
- The context ADR-0004 described is complete.

**Harder**
- Two more fields on `PATCH /me` and two more constraints on `users`.

**To revisit**
- A block per kind of work, if one length turns out to be too blunt.
- Inferring either preference from history, which ADR-0004 already lists to revisit.

## Action Items

1. [ ] Columns, defaults and `CHECK`s, by migration.
2. [ ] `GET` and `PATCH /me`, with the three sentences and the normalised set.
3. [ ] The scheduler skips days off; the domain layer bounds items by the block.

---

## Português

**O problema.** O planejador sabe quando o dia de cada pessoa começa e termina, mas não sabe
em que dias ela não quer nada planejado, nem o tamanho de um bloco de trabalho para ela.

**A decisão.**
- **Duas colunas no usuário:** `days_off`, dias ISO da semana, vazio por padrão, com pelo menos
  um dia para planejar, e `preferred_block_minutes`, de 15 a 240, 60 por padrão.
- **Elas só mudam o planejador.** O agendador pula os dias de folga, e nenhum item proposto
  passa do bloco.
- **Dia de folga continua sendo dia:** a tela mede ele normalmente e a pessoa marca o que
  quiser nele.

**Opções descartadas.**
- **Só a folga, ou nenhuma das duas:** o planejador ficaria incompleto.
- **Máscara de bits ou sete colunas:** ilegíveis, ou uma ideia espalhada em sete lugares.
