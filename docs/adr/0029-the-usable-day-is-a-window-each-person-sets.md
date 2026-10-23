# ADR-0029: The usable day is a window each person sets

**Status:** Accepted
**Date:** 2026-10-23
**Deciders:** Gabriel Barros

**Supersedes:** decision 3 of [ADR-0022](0022-capacity-against-a-usable-day.md), which set the
usable day at `min(960, total_minutes)`.

**Amends:** [ADR-0023](0023-a-budget-you-choose-under-a-ceiling-you-do-not.md). Its action items
7 to 9 — a `usable_minutes` column, `PATCH /me`, and a settings control — are redefined: the
preference is stored as a window, and the budget is derived from it. Its ceiling, its floor and
its ladder stand exactly as written.

## Context

ADR-0022 measured each day against a fixed sixteen hours. ADR-0023 made that budget a
preference capped at eighteen hours, and the service already takes it per user — but the
column it named never landed, so every account still runs on the constant. ADR-0023 saw this
coming: "a window supersedes decision 3 of that record entirely. When it lands,
`usable_minutes` becomes `end − start` and this column is derived rather than stored."

Decision 12 of 2026-10-22 chose that window: one per person, a start and an end. It is simple
for most people, and not everyone will configure each day separately. Two questions were
answered the same day:

- **The window sets only the budget's length.** Occupancy is still counted across the whole
  day, and the hours are kept for the AI to plan inside them.
- **The window does not cross midnight**, for now.

A third question was raised twice and not overturned: what the budget is on a day whose clock
changes inside the window.

## Decision

### 1. Two columns on `users`

`day_starts_at` and `day_ends_at`, as `TIME` without a zone, and read in the account's own
`timezone`.

They default to 06:00 and 22:00. That is sixteen hours, exactly the budget every account has
today, so no number on anybody's screen moves when this lands.

### 2. The bounds are ADR-0023's, applied to the window

The window ends after it starts, on the same day, and lasts between one and eighteen hours. As
ADR-0023 asked, there are three places that enforce this:

| Where | What |
|---|---|
| the column | `CHECK (day_ends_at - day_starts_at BETWEEN '1 hour' AND '18 hours')` — a reversed window gives a negative interval and fails the same check |
| `PATCH /me` | the window as the request leaves it, refused with 422 and a sentence per rule |
| `CapacityService` | the derived budget, clamped at eighteen hours |

### 3. A day's budget is the real time between the two moments

The budget is the minutes from the start to the end on that local day, in that zone, clamped at
eighteen hours.

On almost every day that is the nominal length. It differs only when a clock change falls
inside the window: a window from 00:00 to 18:00 is seventeen real hours on the day the clock
jumps forward, and nineteen on the day it falls back, which the clamp brings to eighteen. The
default window, 06:00 to 22:00, stays clear of the change in every zone this project has met,
all of which move the clock between midnight and three in the morning.

### 4. Occupancy does not change

Minutes still count on the day they happen, across the whole day (decision 1 of ADR-0022).

A task booked outside the window still counts as booked, and free is still
`max(0, usable − occupied)`. The capacity query is untouched.

### 5. The API

- **`GET /me`** reports both times.
- **`PATCH /me`** takes either or both. The resulting window is judged as a whole, so moving
  one end is checked against the stored other end.
- **Each refusal has its own sentence:**
  - `The usable day has to end after it starts, on the same day.`
  - `The usable day has to be at least 1 hour long.`
  - `The usable day can be at most 18 hours long.`
- **Times are whole minutes and carry no zone.** A time with an offset names an instant, and a
  window that repeats every day is not an instant.

### 6. No `usable_minutes` column

The budget is derived and never stored, so it cannot disagree with the hours it comes from.
`DayCapacity.usable_minutes` still reports it, per day, which is where the screen already
reads it.

## Options Considered

### What the window means

| Option | Assessment |
|--------|------------|
| **Only the budget's length — chosen** (answered on 2026-10-22) | Exactly the change ADR-0023 predicted. The query, the ladder, the invariant and every figure on the frozen screen stay as they are, and the hours are there for the planner. |
| A region of the day: free is the window minus what falls inside it | More faithful to how a day is lived. It changes the capacity query and the meaning of "free" on a screen that is frozen until the redesign returns. |

### Crossing midnight

| Option | Assessment |
|--------|------------|
| **No, for now — chosen** (answered on 2026-10-22) | One CHECK, and a person's day is the calendar day the whole screen is drawn in. It leaves out whoever lives past midnight, until this is revisited. |
| Yes, an end before the start means the next day | Serves someone working nights. The person's day and the calendar day stop coinciding, and every per-day figure has to decide which one it means. |

### A day whose clock changes inside the window

| Option | Assessment |
|--------|------------|
| **The real minutes, clamped — chosen** | The same rule as `total_minutes` and as `unbooked_minutes`: a budget that included the hour the clock skipped would offer time that does not exist, which is the lie ADR-0022 was written to remove. |
| The nominal length, the same every day | Simpler, with no zone arithmetic. Wrong by an hour twice a year for anyone whose window contains the change, in the direction of offering time that is not there. |

## Trade-off Analysis

**A boundary inside the skipped hour is read the way the zone database reads it.** If the
window starts at 02:30 on the day the clock jumps from 02:00 to 03:00, that start does not
exist. It is resolved with the offset in force before the change. The budget can then be off
by up to the length of the gap, on that one day, for that window. Accepted: it needs a window
boundary inside a missing hour, and the alternative is a rule for a case nobody will meet.

**This removes a constant.** `DEFAULT_USABLE_MINUTES` goes, and a default window takes its
place. Sixteen hours stays only as the length of that default, which is the direction ADR-0023
set: fewer numbers with opinions.

**Nothing here is specific to Python.** `TIME` maps to `LocalTime`, and turning a local time
into an instant in a zone is what `java.time` does too, so the port in ADR-0001 inherits the
rule as it stands.

**The screen cannot set it yet.** The settings screen is frozen with the rest of the front end,
so the window is reachable through the API only, for now.

## Consequences

**Easier**
- The budget belongs to each person, as ADR-0023 decided.
- The planner in S6 knows when a person's day runs, not only how long it is (ADR-0004).

**Harder**
- Two times to validate instead of one number, and the window is judged as a pair.
- The budget varies from day to day for anyone whose window contains a clock change, so a test
  that assumes it is constant is now wrong for those days.

**To revisit**
- Crossing midnight.
- A window per weekday, if one per person turns out to be too blunt.

## Action Items

1. [x] Columns with the defaults and the CHECK, by migration.
2. [x] `CapacityService` derives the budget from the window, per day, clamped.
3. [x] `GET /me` reports the window; `PATCH /me` changes it, with the three refusals.
4. [x] Tests: the real-minute budget across both clock changes, the clamp, the window judged as
       a pair, and the CHECK against PostgreSQL.
5. [ ] The settings screen sets it (third design round, step 4).

---

## Português

**O problema.** O orçamento do dia era uma constante de 16h. O ADR-0023 o tornou preferência,
mas a coluna dele nunca chegou a existir.

**A decisão.**
- **Duas colunas no usuário,** `day_starts_at` e `day_ends_at`, com padrão 06:00 e 22:00 — as
  mesmas 16h de hoje, então nenhum número muda quando isto entra.
- **Os limites do ADR-0023 valem para a janela:** ela termina depois de começar, no mesmo dia, e
  dura de 1h a 18h. Ficam garantidos no banco, no `PATCH /me` e no serviço.
- **O orçamento de cada dia é o tempo real entre os dois horários,** com teto de 18h. Só muda
  quando a troca de horário de verão cai dentro da janela.
- **A ocupação continua contada no dia inteiro.** A consulta de capacidade não muda.
- **O `GET /me` mostra a janela, e o `PATCH /me` a altera.** Cada recusa tem a sua frase, e a
  janela é julgada inteira: mudar uma ponta é conferido contra a outra.

**Opções descartadas.**
- **Janela como região do dia:** mudaria a consulta e o sentido de "livre" numa tela congelada.
- **Cruzar a meia-noite:** fica para depois.
- **Comprimento nominal:** ofereceria uma hora que não existe no dia em que o relógio pula.

**O que fica aberto.**
- A tela de configurações.
- Cruzar a meia-noite.
- Uma janela por dia da semana.
