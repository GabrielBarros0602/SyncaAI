# ADR-0025: Undo is a recreate, so it is offered only where recreating is faithful

**Status:** Accepted
**Date:** 2026-10-21
**Deciders:** Gabriel Barros

**Supersedes nothing.** [ADR-0011](0011-hard-delete-for-tasks.md) (hard delete),
[ADR-0012](0012-task-time-business-rules.md) (no task starts in the past) and
[ADR-0022](0022-capacity-against-a-usable-day.md) (`end_at` shortens on completion) all stand
exactly as written. This record decides what the screen may promise inside them.

## Context

The week's design deletes a task in one press and offers `undo` for nine seconds. The API
cannot undo anything: ADR-0011 chose a physical delete, with the checklist going in cascade,
and wrote down the cost — *"No undo. If a user deletes a task with its checklist items, it is
gone."*

The division of item 2 already settled the order of operations. The `DELETE` is sent at once,
not held until the nine seconds run out, because the exclusion constraint would keep holding
the slot during the window: somebody deleting a task **to free its time** would then be
refused that time by a task the screen said was gone. Undo is therefore a second request, a
`POST /tasks` carrying what the deleted task held.

That makes undo a **recreate**, and a recreate can only bring back what a create can carry:

| What the deleted task had | Can a `POST /tasks` restore it? |
|---|---|
| title, note, duration, tag by name, checklist labels | yes |
| its id | no — a new row gets a new id |
| a start in the past | no — ADR-0012 refuses `start_at <= now` on create |
| `completed_at` | no — the create schema has no such field |
| a checked checklist item | no — items are created unchecked |
| an `end_at` shortened by completing early | no — the trigger derives it from the duration (ADR-0022) |

For a future, untouched task, the recreate is the same task in every way a person can see,
apart from the id. For anything else, the "undo" would either be refused by the server at the
moment somebody relies on it, or would quietly bring back a different task: a finished one
reopened, a checklist unticked, and a plan-versus-actual record that S6 reads from rewritten
as if it had never been worked on.

## Decision

**Offer undo only when the recreate is faithful, judged at the moment of the delete.** A task
can be put back when, at that instant:

- `completed_at` is null,
- `start_at` is strictly after now, and
- no checklist item has `completed_at`.

One pure function, `canBeRestored`, owns the rule, with `restoreBlocker` naming which condition
failed so the screen can say it.

**When it holds**, the delete goes out at once, the row leaves, and the day shows
`deleted · <title>` with `undo` for nine seconds. Undo posts the snapshot taken before the
delete. The start can pass during those nine seconds, so the server can still refuse it; its
sentence is shown once, and nothing retries.

**When it does not hold**, deleting asks inside the row — no modal, no browser dialog — and
says why it cannot come back. The `DELETE` is sent only on the second press, and there is no
undo to offer, so none is shown.

**The id changes, and nothing may depend on the old one.** The open row, the toast and the
focus all follow the task that exists now, which after an undo is the one the server just
created.

## Options Considered

| Option | Assessment |
|--------|------------|
| **A. Undo only where the recreate is faithful — chosen** | Every undo the screen offers does what it says. Costs a second path, an in-row confirmation, for the tasks where undo would have lied, and the id of a restored task. |
| B. Allow a past start when restoring | A restore flag or endpoint exempt from rule 1 of ADR-0012. Fixes "already started" only: `completed_at` and checked items still cannot be carried unless the endpoint accepts them, and an endpoint that accepts a past start with a completion time is the retroactive logging ADR-0012 refused, arriving through a side door. A contract change for half a fix. |
| C. Logical delete | The only faithful undo: same row, same id, same history. It is ADR-0011's option B, which that record rejected for putting a `deleted_at IS NULL` filter on every query. It would also need the exclusion constraint to skip deleted rows, or the slot stays held during the window — the failure the division chose the immediate delete to avoid. Supersedes ADR-0011 for a nine-second feature. |
| D. Offer undo always | The design as drawn. The undo of a started task is refused by the server exactly when someone presses it, and the undo of a finished one silently brings back a different task — open, unchecked, with its plan-versus-actual erased. An undo that sometimes lies is worse than a confirmation that never does. |

## Trade-off Analysis

**The rule is narrow on purpose.** It does not try to be clever about which differences
matter. A task that is finished, begun or partly ticked has a history a create cannot hold,
and the three conditions are exactly the three fields of that history. Any looser rule would
have to argue that some of the history is safe to lose, and that argument belongs to a record
that changes what a task is.

**The confirmation is the honest half, and it costs a press.** Deleting a past or finished
task takes two clicks instead of one. That is the price of not promising a return the server
cannot keep. The text says what is lost rather than asking "are you sure", because the person
already is; what they may not know is that this one does not come back.

**The window can still close under somebody.** A task starting in five minutes passes the rule
at delete time and fails it four minutes later. The server is the authority, as it is for
every other write on this screen, and its refusal is shown rather than retried. Retrying would
fail the same way.

**The new id is a real cost and an accepted one.** Anything outside this screen that held the
old id — a link, a future AI draft pointing at the task — loses it. Today nothing does, which
is why the cost is accepted now and recorded rather than paid for.

## Consequences

**Easier**
- Every undo the screen shows will work, short of the start passing during the window.
- Deleting to free a slot frees it at once, as the division decided.
- No schema change, no new endpoint, no new invariant on any query.

**Harder**
- Two delete paths in the interface, and a rule that has to be evaluated at the instant of the
  press rather than when the row was drawn.
- A restored task is a new task. Its id and its `created_at` are new, and so are the rows of
  its checklist items.

**To revisit**
- If a trash or a longer undo is ever wanted, option C is the record to write, and it
  supersedes ADR-0011 explicitly.
- If retroactive logging is allowed (the open question on rule 1 of ADR-0012), "already
  started" may stop being a blocker. Completion and checked items would still be.

## Action Items

1. [x] `canBeRestored` and `restoreBlocker`, pure, tested over every case.
2. [x] Delete sends at once when restorable, and shows `undo` for nine seconds.
3. [x] Undo posts the snapshot taken before the delete, and shows the server's refusal once.
4. [x] Otherwise an in-row confirmation that does not promise a return, and no `DELETE` before
       the second press.
5. [x] Focus never left on a removed element; after undo it lands on the restored row.

---

## Português

**O problema.** O design exclui uma tarefa com um toque e oferece `undo` por nove segundos. A
API não desfaz nada: o ADR-0011 escolheu delete físico, com a checklist indo em cascata. A
divisão do item 2 já decidiu a ordem — o `DELETE` sai na hora, porque a exclusion constraint
seguraria o horário durante a janela e quem exclui para liberar tomaria 409. Então o undo é um
segundo pedido, um `POST /tasks` com o que a tarefa tinha: **uma recriação**.

E uma recriação só devolve o que um create carrega. Título, nota, duração, etiqueta pelo nome e
os rótulos da checklist, sim. O id, não. Um início no passado, não, porque o ADR-0012 recusa. O
`completed_at` também não, e nem item marcado, nem o `end_at` encurtado por concluir cedo (ADR-0022).
Para uma tarefa futura e intocada, a recriação é a mesma tarefa, salvo o id. Para qualquer outra,
o "desfazer" ou seria recusado na hora em que a pessoa conta com ele, ou traria de volta outra
tarefa: uma concluída reaberta, uma checklist desmarcada, o plano-contra-real do S6 apagado.

**A decisão.** O undo só é oferecido quando a recriação é fiel, julgada no instante da exclusão:
sem `completed_at`, com `start_at` estritamente no futuro, e sem item marcado. Uma função pura,
`canBeRestored`, é dona da regra. Quando vale, o `DELETE` sai na hora e o dia mostra
`deleted · título` com `undo` por nove segundos; se o servidor recusar a recriação, a frase dele
aparece uma vez, sem nova tentativa. Quando não vale, excluir pede confirmação dentro da própria
linha, diz por que a tarefa não volta, e o `DELETE` só sai no segundo clique. O id muda, e nada
na tela depende do antigo.

**As opções descartadas.** Permitir início no passado na restauração (B) resolve só "já
começou", e um endpoint que aceita passado com hora de conclusão é o registro retroativo que o
ADR-0012 recusou, entrando por outra porta. Exclusão lógica (C) é o único undo fiel, mas é
exatamente a opção que o ADR-0011 rejeitou, e ainda seguraria o horário na janela. Oferecer
sempre (D) é o design ao pé da letra, e um undo que às vezes mente é pior que uma confirmação
que nunca mente.

**Não supera nenhum registro.** O 0011, o 0012 e o 0022 continuam valendo como estão.
