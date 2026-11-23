# ADR-0060: A refused setting names its fields, and the week can be measured against a window not saved

**Status:** Accepted
**Date:** 2026-11-23
**Deciders:** Gabriel Barros

**Amends:** [ADR-0029](0029-the-usable-day-is-a-window-each-person-sets.md) §5, the API of the
usable window. `GET /capacity` also measures the days against a window that is not stored, and
the refusals of `PATCH /me` say which fields they are about. The same goes for the two
preferences of [ADR-0032](0032-days-off-and-a-preferred-block-length.md) §3. Their sentences
stand word for word. Supersedes nothing.

## Context

The settings screen, `settings.dc.html`, saves the usable day, the days off and the block with
one Save, because `PATCH /me` judges them as one request and writes none of them when one part
is refused (ADR-0029, ADR-0032). The drawing asks the API for two things it does not give.

**It puts the refusal under the field it is about.** It also writes a line above Save naming
that field: "Nothing was saved. Fix the usable day and save again". The refusal is
`{"detail": sentence}` and nothing else. A screen could only place it by recognising the
sentence, and the day a sentence is reworded it would land under the wrong field, or under
none, without any test on either side noticing.

**It shows what a change does before it is made.** Under the two times it lists the week: each
day's booked figure, free "of 16h → of 14h", and "Becomes heavy" on a day the new budget moves
up the ladder. The level of a day is the server's and is never recomputed on the screen.
`load.ts` says so, because the round's first drawing used thresholds of its own and was sent
back for it. The budget behind the level is the real time between the two ends on that day, in
the account's zone (ADR-0029 §3), and that differs from the nominal length on the days the
clock changes. `/capacity` reads only the stored window, so the "after" has no source.

Both were found while planning the settings screens, and answered on 2026-11-23, as
recommended. Gabriel's principle from the plan screens applies to the second: what a change
does must be in view before it is made.

## Decision

### 1. A refusal of a setting names its fields

Each of the six refusals of `PATCH /me` carries `fields`, beside `detail`, in the request's own
names:

| Refusal | `fields` |
|---|---|
| ends before it starts, under 1 hour, over 18 hours | `["day_starts_at", "day_ends_at"]` |
| no day to plan in, a weekday out of range | `["days_off"]` |
| a block out of range | `["preferred_block_minutes"]` |

The window names both ends even when one was sent. It is judged as a pair, against the stored
other end, so the stored end is half of what was refused.

**The first refusal is the one named,** in the order the service checks: the window, the days
off, the block. The drawing shows one refusal at a time, and this keeps it that way.

### 2. `GET /capacity` measures the days against a window not saved

`day_starts_at` and `day_ends_at` are optional query parameters on `GET /capacity`. With
either, the same days are measured against that window instead of the stored one. The usable
minutes, free minutes and load come from the same rules and the same zone, and nothing is
written.

**It is judged exactly as `PATCH /me` judges it.** One end alone is paired with the stored
other. A window the account may not have is refused with the same sentence and the same
`fields`, and an end with seconds or an offset is refused by the same validator. The week a
screen shows before Save is the week Save would leave, or else it is the same refusal.

## Options Considered

### Placing a refusal

| Option | Assessment |
|---|---|
| **The refusal names its fields — chosen** | The server already knows which part failed. One more key per refusal, and the sentence stays the server's. |
| The screen recognises the sentence | No server change. The screen then depends on the API's wording, and a rewording moves the sentence under the wrong field silently. |

### The week after a change

| Option | Assessment |
|---|---|
| **`/capacity` with a window not saved — chosen** | The ladder and the clock change stay on the server. It costs one read for each change of the hours. |
| The screen computes it | No server change. It breaks the rule in `load.ts`, and it is an hour wrong on the days the clock changes inside the window. |
| No "after" | Nothing to build. A change's effect is seen only once it has been made, against the principle above. |

## Trade-off Analysis

**A read that takes a hypothetical.** `/capacity` answers about a state that does not exist.
This is bounded: only the window can be supposed, only for the caller's own days, and nothing
is written. Days off and the block are not parameters, because neither changes capacity
(ADR-0032). They change only what the planner proposes.

**One read per change of the hours.** The screen asks again as a time is typed, after a short
pause. It reads seven days, which is far under the 90 a caller may ask for at once.

**Field names in a response tie the screen to the request's vocabulary.** It is the vocabulary
the screen already writes in, so there is nothing new to keep in step. A field renamed in the
request would have to be renamed here too, in the same mapping.

**Nothing here is specific to Python.** A query parameter and a key in an error body carry over
to the Spring port as they stand (ADR-0001).

## Consequences

**Easier**
- The settings screen places each refusal by field, and the line above Save names that field.
- The week under the hours shows the server's figures for the change being typed.

**Harder**
- `/capacity` has two more parameters to keep honest, and they are judged by the code that
  judges a change.

## Action Items

1. [x] `fields` on the six refusals, with a test that each names its own.
2. [x] `day_starts_at` and `day_ends_at` on `GET /capacity`, judged as `PATCH /me` judges them,
       with a test against PostgreSQL that the row is left as it was.
3. [ ] The settings screen reads both (S8).

---

## Português

**O problema.** A tela de configurações põe a recusa sob o campo recusado, e o 422 do
`PATCH /me` traz só a frase. Ela também mostra a semana com a janela nova antes do Save, e o
`/capacity` só mede com a janela guardada. O nível de cada dia é do servidor, e a tela nunca o
recalcula.

**A decisão.**
- **Cada uma das seis recusas traz `fields`,** com os nomes do pedido: as duas pontas para a
  janela, `days_off` e `preferred_block_minutes`. A primeira recusa é a nomeada, como o
  desenho mostra uma por vez.
- **O `GET /capacity` aceita `day_starts_at` e `day_ends_at`** e mede os mesmos dias contra
  essa janela, sem gravar nada. Ela é julgada como o `PATCH /me` a julgaria: uma ponta sozinha
  vai com a guardada, e a recusa tem a mesma frase e os mesmos campos.

**Opções descartadas.**
- **A tela reconhecer a frase:** quando a frase mudasse, ela iria parar no campo errado sem
  ninguém ver.
- **A tela calcular o depois:** quebraria a regra do `load.ts`, e erraria por uma hora no dia
  da troca de horário.
- **Sem o depois:** o efeito de uma mudança só apareceria depois de feita.

**Respondido em 2026-11-23,** como recomendado.
