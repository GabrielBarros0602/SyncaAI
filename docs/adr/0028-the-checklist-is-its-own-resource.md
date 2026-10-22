# ADR-0028: The checklist is its own resource

**Status:** Accepted
**Date:** 2026-10-22
**Deciders:** Gabriel Barros

**Supersedes nothing.** It builds on [ADR-0020](0020-domain-surface-choices.md), whose deferred
`UNIQUE (task_id, position)` was chosen so that a reorder could be one transaction, and on
[ADR-0016](0016-ownership-isolation.md), whose 404 across owners extends to the items.

## Context

A task's checklist can be written once, inside `POST /tasks`, and never touched again. There is
no way to tick an item, add one, rename one, remove one or change their order. The design drew
ticking and adding, and the screen could build neither. The table has carried `completed_at`
per item from the start; nothing could ever set it.

Decision 6 of 2026-10-22 chose a resource of its own, `/tasks/{id}/items`, over widening
`PATCH /tasks` to carry the list: more organised, and safer for the API, because each change
names the one item it touches instead of resending all of them.

That left one choice open, and it was answered the same day: how a reorder is expressed.

## Decision

Four routes, all under the task, all taking the owner from the token:

| Route | Does | Refuses |
|---|---|---|
| `POST /tasks/{id}/items` `{label}` | appends an item at the end | 422 when the task already holds 50 |
| `PATCH /tasks/{id}/items/{item_id}` `{label?, completed?}` | renames, ticks or unticks | 422 for an explicit `null` |
| `DELETE /tasks/{id}/items/{item_id}` | removes it; the items after it move up | — |
| `PUT /tasks/{id}/items/order` `{item_ids}` | sets the whole order at once | 409 unless `item_ids` is exactly the current items |

**A reorder sends the whole list.** The service checks that the ids are exactly the task's
items, each once, then writes every position in one transaction. A client whose list is out of
date — an item added or removed elsewhere since it last read — gets 409 and reloads, instead of
having two orders merged into one that neither of them chose.

**Positions stay `0…n−1`.** Adding takes the next one, and removing closes the gap, so a
position always means "this is the n-th item" and never just "somewhere after that one".

**Ticking is a timestamp**, like completing a task: `completed: true` writes the moment,
`false` clears it.

**404 means the same thing it means for tasks.** A task that is not the caller's answers
`No such task.`, and an item id that does not belong to that task answers
`No such checklist item.`, so no route can confirm that someone else's item exists.

`POST /tasks` still takes an initial list, unchanged. `PATCH /tasks` still does not touch the
items.

## Options Considered

### Where the checklist is edited

| Option | Assessment |
|--------|------------|
| **Its own resource — chosen** (decision 6) | Every change names one item. A rename cannot drop a tick written by another tab in the meantime, because nothing else is resent. |
| The whole list inside `PATCH /tasks` | One route. Every edit resends every item, so two tabs overwrite each other, and the service has to diff the list to find what changed. |

### How a reorder is expressed

| Option | Assessment |
|--------|------------|
| **The whole order, in one request — chosen** (answered on 2026-10-22) | The case ADR-0020's deferred constraint was built for: positions collide mid-way and are checked at commit. A stale list is refused rather than merged. |
| Move one item to a new position, and shift the neighbours | A smaller request. But two stale clients each move "item 3 to position 0" against different lists, and the server merges both into an order no one asked for, without telling either. |

## Trade-off Analysis

**409 costs a reload.** A client that reorders after someone else added an item has to read
the list again. That is the point: the alternative is an order the person never saw.

**Closing the gap on delete rewrites the positions after it.** For a list capped at fifty that
is at most forty-nine updates, in the same transaction. The deferred constraint is what makes
this possible without temporary values.

**Ticking an item now exists, and ADR-0025 already accounts for it.** A task with a ticked item
cannot be restored faithfully, because a recreate cannot carry the tick, so its delete asks for
confirmation instead of offering undo. That rule was written when ticking had no API; it now
has one, and the rule does not change.

## Consequences

**Easier**
- The screen can tick, add, rename, remove and reorder — the checklist the design drew.
- ADR-0020's own action item, a test that a batch reorder in one transaction succeeds, now
  exists against PostgreSQL.

**Harder**
- Four routes instead of none, each with its own 404.

**To revisit**
- Moving an item from one task to another. Not drawn, not asked for, and it would need the
  item's owner check to cover two tasks.

## Action Items

1. [x] The four routes, scoped through the task.
2. [x] Positions assigned on add, closed on delete, and written in one transaction on reorder.
3. [x] 409 for a stale order; 404 across owners and across tasks.
4. [x] Integration tests: a full reorder and a delete both pass the deferred constraint, and a
       stranger cannot reach an item.
5. [ ] The opened row edits the checklist (third design round).

---

## Português

**O problema.** A checklist só podia ser escrita uma vez, dentro do `POST /tasks`. Não dava
para marcar, adicionar, renomear, remover nem reordenar um item, e a coluna `completed_at` de
cada item nunca tinha sido escrita.

**A decisão.** Quatro rotas debaixo da tarefa:
- **Adicionar** põe o item no fim, até 50.
- **Mudar** renomeia, marca ou desmarca.
- **Remover** fecha o buraco: os itens seguintes sobem uma posição.
- **Reordenar** recebe a lista inteira de ids numa transação, a resposta de 2026-10-22. Se a
  lista não for exatamente os itens atuais, a resposta é 409, e o cliente desatualizado recarrega
  em vez de ter duas ordens mescladas.

O 404 vale como nas tarefas: nenhuma rota confirma que o item de outra pessoa existe.

**Opções descartadas.**
- **A lista inteira no `PATCH /tasks`:** duas abas se sobrescreveriam.
- **Mover um item por vez:** dois clientes desatualizados mesclariam uma ordem que ninguém
  escolheu.

**O que fica aberto.**
- A linha aberta editar a checklist, que é tela e espera o redesign.
- Mover um item de uma tarefa para outra, que não foi pedido.
