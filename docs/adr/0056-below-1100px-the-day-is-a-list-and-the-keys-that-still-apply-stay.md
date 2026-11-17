# ADR-0056: Below 1100px the day is a list, and the keys that still apply stay

**Status:** Accepted
**Date:** 2026-11-17
**Deciders:** Gabriel Barros

**Records:** two of the three questions the day view's drawing left open, decided on
2026-11-17 (`docs/backlog.md`, "A visão de um dia abaixo de 1100px").
**Amends:** [ADR-0053](0053-the-week-is-one-grid-with-one-tab-stop.md), its consequence that
"the grid is the desktop's and the day beside the week's, not the phone's". From 1100px,
ADR-0053 holds as written.

## Context

ADR-0053 made the week one ARIA grid with one tab stop. Each day is a row drawn as a column,
and ← and → change day. It expected the phone's day to be a list. It also said the grid would
hold the day beside the week, from 640 to 1099px.

`day-phone.dc.html` draws something else: the same list in both bands. Each task is a box that
completes it and a button that opens it. The band carried from the night before has a button
back to the task that owns it.

The first pull request of the day view kept the grid with one day in it, and showed what that
costs. A grid of one row has nowhere for ← and → to go, so they did nothing.

A keyboard still arrives below 1100px. A desktop zoomed to 200% has 640px to lay out, and so
does a narrow window. The drawing says only that shortcuts and their legend are hidden under
touch. It says nothing of a keyboard on a narrow screen.

## Decision

### 1. The day on screen is a list, in both bands

Below 1100px, nothing on the day is a grid:

- **A task** is a list item with two controls:
  - the completion box, a checkbox always in the tab order;
  - a button that opens and closes the row, with `aria-expanded`.
- **The band carried from the night before** is a list item. Its way back to the owning task is
  a button.
- **The day's heading** takes focus when "go to date" lands on the day, without adding a tab
  stop.
- **Tab** walks all of these in reading order.

From 1100px the week stays the grid of ADR-0053.

### 2. The keys that still apply in a list stay

- **On a row's button:**
  - Enter and Space open and close the row, as any button does;
  - E, M, O, C and ⌫ reach a verb without opening first, as on the desktop's row.
- **On the box:** Space completes, as any checkbox does.
- **Anywhere on the screen:** N, T, `[` and `]`, Esc and Ctrl+Z. Inside a checklist, Alt+↑ and
  Alt+↓.

The arrows and Home and End are not offered, because they walk a grid and there is none. ← and →
do not change the day either. The bar between days and the week at a glance already do that,
and the drawing gives the arrows no other job.

### 3. The legend lists only those keys

Below 1100px the legend leaves out the arrows and Home and End. Under touch it stays hidden at
every width, as before.

## Options Considered

### How the day is walked

| Option | Assessment |
|---|---|
| **A list in both bands — chosen** | What the drawing draws. Plain HTML: Tab reaches every control, and no roving tab stop is managed below 1100px. Two stops per task instead of one. |
| The grid from 640px and a list below, as ADR-0053 had it | One stop per day. With one day on screen, ← and → have nowhere to go, and the keyboard model changes between 639 and 640px, where nothing on screen tells anybody it did. |
| The grid, with ← and → changing the day on screen | Keeps one stop and gives the arrows a job. Not drawn. A screen reader would hear one row's name change under it, and the bar would do the same thing a second way. |

### Which keys stay

| Option | Assessment |
|---|---|
| **The keys that apply in a list, and a legend of only those — chosen** | A desktop zoomed to 200% keeps the shortcuts the wider screen taught. The legend promises nothing that does nothing. |
| No letters below 1100px: Tab, Enter and Space only | The smallest model. The same person loses E, M and N by zooming in. |
| Every key, and the legend as on a desktop | No new code. The legend would list four keys that do nothing. |

## Trade-off Analysis

**Two tab stops per task.** A day of a dozen tasks is about twenty-four stops. ADR-0053 counted
sixty to cross a whole week, and that count is why the week is a grid. One day at a time is a
much smaller walk, and the bar between days moves the person a day at once.

**Space does a different thing on each side of 1100px.** On the desktop's row, Space completes.
On the list's row button, Space opens the row, because that is what Space does on a button.
Completing is Space on the box beside it, one Tab back. The legend's "Space — mark done" is
true on the box, and the row button's own name says it opens.

## Consequences

**Easier**
- Below 1100px the keyboard model is the browser's own: no roving tab stop, no arrow handling.
  The only focus code left is putting focus back on a row's button when the row closes.
- The arrows no longer sit dead on a day with nowhere to go.

**Harder**
- The app has two keyboard models, one on each side of 1100px. Somebody who resizes across it
  moves between them, and the legend is what says which one holds.
- A row has two shapes, a grid cell and a list item. They share their verbs and panels
  (`RowPanels`), so only how a row is drawn and reached differs between them.

---

## Português

**O problema.** O ADR-0053 previa o grid também para o dia ao lado da semana, de 640 a 1099px. O
desenho do celular usa a mesma lista nas duas faixas. A primeira PR da visão de um dia mostrou o
custo do grid: com um dia só, ← e → não têm para onde ir. E um teclado ainda chega abaixo de
1100px, num desktop com zoom de 200%.

**A decisão.**
- **Abaixo de 1100px o dia é uma lista**, nas duas faixas. Cada tarefa tem a caixa que conclui e
  um botão que abre. A faixa herdada tem um botão de volta à dona. O Tab percorre tudo em ordem.
- **Ficam as teclas que fazem sentido numa lista:**
  - no botão da linha, Enter e Espaço abrem e fecham, e E, M, O, C e ⌫ chegam a um verbo;
  - na caixa, Espaço conclui;
  - em qualquer lugar, N, T, `[` `]`, Esc e Ctrl+Z.
  - Saem as setas e Home e End.
- **A legenda lista só essas.**
- **A partir de 1100px nada muda.**

**O custo.**
- Duas paradas de Tab por tarefa, num dia só, e não numa semana.
- Espaço abre a linha na lista e conclui no grid. Na lista, quem conclui é a caixa ao lado.
