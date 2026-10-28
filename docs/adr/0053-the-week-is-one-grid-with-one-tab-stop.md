# ADR-0053: The week is one grid with one tab stop

**Status:** Accepted
**Date:** 2026-10-28
**Deciders:** Gabriel Barros, in the third design round

**Records:** the keyboard model `week-desktop.dc.html` draws (item 6 of the round), adopted as
specification by [ADR-0052](0052-the-third-design-round-is-the-specification-and-the-front-end-opens.md).
**Answers:** the backlog question "how many tab stops a week has", left open on 2026-10-22
until every screen was final, with a note that the answer probably deserved a record of its own.

## Context

The second round's rows had two tab stops each: the completion box and the title, which was
the disclosure. An earlier row that took focus itself had been refused, and rightly: it was a
`group`, which cannot carry `aria-expanded`, so the open state was announced to nobody.

Two stops a row is about sixty to cross a full week of thirty tasks, before any row is open.
Nothing in the second round's drawings said how the week should be walked by keyboard beyond
the letter shortcuts, so the question waited for the third round. That round drew it.

## Decision

The week is one ARIA `grid`, named "Week of 26 Oct – 1 Nov 2026":

- **Rows and cells.** Each day is a `row` drawn as a column, named by its weekday and date,
  with ", today" or ", past" after it. Its cells, top to bottom, are:
  - the header;
  - the band it inherits from the night before, when there is one;
  - its rows;
  - the way to a new task, when the day can take one.
- **One tab stop.** The grid holds one tab stop for the whole week (roving `tabindex`). It
  starts on today's header, or Monday's in another week, and stays where the person left it.
- **Moving.** ← and → change day, keeping the place in the day as far down as the other day
  goes. ↑ and ↓ walk the day's cells. Home and End jump to its first and last cell.
- **A row is its own disclosure.** Enter opens and closes it, and Space completes it, the same
  press as the box it stands for. E, M, O and ⌫ reach a verb without opening first. The box
  leaves the tab order while the row is shut.
- **Inside an open row.** Tab walks the row's controls, and keys pressed on them are theirs.
  Esc closes the row and puts focus back on it, however the row was closed.
- **The way to a new task** is a button that is itself the stop of its cell, since it is the one
  thing in it. N opens a new task on the day holding the stop, never on a day that has gone.
- **The focus ring** sits inside a cell's edge, since cells are 4px apart, and outside an
  opened row.

## Options Considered

| Option | Assessment |
|---|---|
| **One grid, days as rows drawn as columns — chosen** | One stop for the week, and the arrows go where the eye does. A screen reader hears "row" for a day that looks like a column. |
| One grid, days as columns | Matches the look, but a grid's rows would then hold the nth task of every day, which are unrelated to each other. The semantics would be false. |
| Seven lists, Tab between days and arrows inside each | Seven stops instead of one, and no way to move sideways between days with the arrows. |
| Two buttons per row, as the second round had it | No new code. About sixty stops to cross a full week. |

## Trade-off Analysis

**Left and right change rows.** In a grid, the arrows across move between cells of a row. Here
they move between days, which the grid calls rows. A sighted keyboard user sees the arrow go
where the week is drawn. A screen reader user hears the day's name with each move, from the
row's label, but the grid's row and column counts read sideways. The round chose the direction
the eye takes, and the label is what makes the other reading usable.

**A row that takes focus has to own its keys.** Enter, Space and the letters are handled on the
row, only when the key was pressed on the row itself, so the controls of an opened row keep
theirs. The grid handles the arrows, Home and End, again only from a cell.

## Consequences

**Easier**
- The week is crossed in one Tab, and every key the legend lists works from where focus is.
- A row's open state is announced: `aria-expanded` on a `gridcell`, which supports it.

**Harder**
- Focus is this code's to manage. Every write that moves or removes a row puts focus somewhere
  on purpose, and a row that closes takes focus back.
- The round's phone view walks one day as a list. When it lands, the grid is the desktop's and
  the day beside the week's, not the phone's.

---

## Português

**O problema.** As linhas da segunda rodada tinham duas paradas de Tab cada, a caixa e o título.
Isso dá umas sessenta para atravessar uma semana cheia. A pergunta ficou no backlog até as telas
ficarem definitivas, e a terceira rodada a desenhou.

**A decisão.** A semana é um `grid` da ARIA com uma parada de Tab só (roving `tabindex`).
- **Linhas e células:** cada dia é uma `row` desenhada como coluna. As células, de cima para
  baixo, são o cabeçalho, a faixa herdada da noite anterior, as linhas e o "+ new task".
- **Movimento:** ← → trocam de dia, ↑ ↓ andam pelas células do dia, e Home e End vão à primeira
  e à última.
- **A linha:** é a própria disclosure. Enter abre e fecha, Espaço conclui, e E, M, O e ⌫ abrem um
  verbo sem abrir antes.
- **Dentro da linha aberta:** Tab percorre os controles, e Esc fecha e devolve o foco à linha.
- **N:** abre uma tarefa no dia que tem a parada, nunca num dia que já passou.

**O custo.** ← → trocam de "linha" da grade, o que um leitor de tela lê de lado. O rótulo de cada
dia é o que torna essa leitura usável. O foco passa a ser responsabilidade do código.
