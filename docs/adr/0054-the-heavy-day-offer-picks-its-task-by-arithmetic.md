# ADR-0054: The heavy-day offer picks its task by arithmetic, and keeps doing so

**Status:** Accepted
**Date:** 2026-11-01
**Deciders:** Gabriel Barros

**Records:** the rule decided on 2026-10-22 in the review of the third round's week
(`docs/backlog.md`, "A oferta do dia pesado passa a escolher a tarefa"), which was to become a
record once the screen was built, and the offer `week-desktop.dc.html` draws (item 20 of the
round).
**Amends:** [ADR-0022](0022-capacity-against-a-usable-day.md), decision 4, where "the AI improves
it later by choosing *which* task should move".

## Context

ADR-0022 put one offer beside a day booked past its budget: a lighter day exists, so move
something. It left the choice of *what* to move to the AI layer, later.

The third round drew the offer as a button that names both, "Move “Gym” to Sat 31 →", with a
line under it showing the arithmetic. Reviewing it on 2026-10-22, the choice was made a rule,
"until S6, when the choice passes to the AI".

S6 closed on 2026-10-23, but what it built is UC2: a whole plan, asked for, queued and
reviewed (ADR-0002, ADR-0003). ADR-0002 scopes the MVP's AI to UC2 and UC1, and neither picks
one task to take off a day. Handing the offer to the model would be a third use case, which
means:
- a record amending ADR-0002;
- a route and a prompt;
- a queued job that the button would wait on;
- metering in `ai_usage` against the spending ceilings.

All of that for a choice the rule already makes correctly, and the button would no longer
answer at once.

## Decision

The offer is chosen by arithmetic, in the client, from the data the week already holds. No
handover to the model is planned. Reopening that is a new record.

**When a day shows it.** The day is past its budget (`over_capacity`, the server's), it is today
or later, and the rule below finds a move. This applies in this week and in any later week. A
week that has gone offers nothing, because every day in it has.

**Which day it goes to.** The days of the same week after today, not counting the heavy day:
- the most free minutes first, by the server's figure (ADR-0022);
- the earlier day first on a tie.

**Which task.** The heavy day's own tasks that have not started and are not done:
1. First, the smallest task that alone brings the day back within its budget.
2. Then, if none does, the largest that does not, so the day is left as light as one move can
   make it.

What a task takes off its day is its minutes up to midnight, not its whole length. A task that
crosses midnight is only partly on the day it starts.

**The move.** It is the same clock time on the receiving day, as the move panel's are. The first
day in that order where some task's slot is free gives the offer. A slot is free when it is not
taken and not in the past, the move panel's own test (`moveOptions`).

**What it says.**
- **The button:** "Move “Gym” to Sat 31", which names the task and the day.
- **The line under it:** the arithmetic. "Same time, 14:00–15:30. Sat is the lightest day left
  this week, 9h free. Fri would drop to 15h."
  - When the lightest day's slot was taken and the offer had to go to another day, the line says
    "Sat has 9h free" instead. The round's sentence would otherwise call it the lightest when it
    is not.
  - In a later week, the line says "the lightest day that week".
- **Pressing it** moves the task as the move panel does. The status region names the new day and
  time, and focus follows the row. A refusal is shown under the button.

## Options Considered

| Option | Assessment |
|---|---|
| **Arithmetic, for good — chosen** | Instant, free and testable. It is the rule already decided, now without a handover nobody has scoped. |
| Arithmetic now, the model later | The same code, but the record keeps a promise open with no use case, no estimate and no trigger behind it. |
| The model now, as a third use case | An amendment to ADR-0002, a route, a prompt, a queued job and metering, for one choice per heavy day. The button would wait on a worker, and S8 would wait on all of it. |
| Only in this week, as the prototype draws it | The prototype holds one week of data, so its guard says nothing about other weeks. A day overbooked next week is the easiest one to fix, and it would get only the warning. |

## Trade-off Analysis

**The rule can make the receiving day heavy.** It sends a task to the lightest day without
asking whether the task fits there. The line under the button shows that day's free time, so the
arithmetic is in front of the person before they press. A rule that refused such moves would be
a second judgement about what a heavy day is, which ADR-0022 left to the person.

**One move, never a plan.** A day overbooked by eight hours may need three moves, and the offer
proposes one at a time. After each move the week is read again, and the next offer is computed
against the new figures. Rebalancing a whole week is what a plan does, and plans are UC2's.

## Consequences

**Easier**
- The offer appears with the week, costs nothing, and its choice can be tested at every
  boundary, with no model in the loop.
- `move.ts` keeps one definition of where a task can go, used by the panel and the offer alike.

**Harder**
- The offer only knows the week on screen and the evening before it. A slot it calls free can
  still be taken by a task in the next week; the server's 409 then shows under the button, as it
  does in the move panel.
- ADR-0022's sentence about the AI no longer holds. Its index line says so.

---

## Português

**O problema.** O ADR-0022 deixou para a IA escolher qual tarefa sai de um dia estourado. Em
22/10, a escolha virou uma regra aritmética "até o S6". Mas o S6 construiu a UC2, o plano
inteiro, e o ADR-0002 não tem caso de uso que escolha uma tarefa para mover.

**A decisão.** A oferta é aritmética, no cliente, e não há passagem prevista para o modelo.
- **Quando aparece:** num dia acima do orçamento, de hoje em diante, nesta semana ou nas
  seguintes.
- **Para onde vai:** o dia mais livre depois de hoje, na mesma semana, pela folga que o servidor
  calcula.
- **Qual tarefa:** a menor ainda não começada que, sozinha, devolve o dia ao orçamento. Se
  nenhuma basta, a maior que não basta. Conta só a parte da tarefa antes da meia-noite.
- **O horário:** o mesmo. O primeiro dia, nessa ordem, em que o horário de alguma tarefa está
  livre dá a oferta.

**O custo.** A regra pode deixar o dia que recebe a tarefa pesado. A linha sob o botão mostra a
folga desse dia antes de alguém apertar. A oferta propõe um movimento por vez, nunca um plano.
