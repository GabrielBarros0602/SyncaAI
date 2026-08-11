# ADR-0011: Hard delete for tasks

**Status:** Accepted
**Date:** 2026-08-11
**Deciders:** Gabriel Barros

## Context

The roadmap leaned toward a logical delete, on the reasoning that a history of discarded tasks
would measure how good the AI's generated plans are — a metric the portfolio wants.

That reasoning does not hold. The acceptance metric concerns **generated items**, and it lives
on `draft_item.status` in the draft tables introduced in S5
([ADR-0005](0005-structured-output-contract.md)). An item the user discards in the review card
never becomes a task at all, so no deleted task records it. The metric is available with hard
delete.

## Decision

Delete tasks physically. No `deleted_at` column.

## Options Considered

### Option A: hard delete — chosen

**Pros:** no filter to add to every query, and therefore no class of bug where forgetting the
filter exposes deleted rows. Simpler repositories and simpler tests.
**Cons:** an accidental delete is unrecoverable. No user-visible history of what was removed.

### Option B: logical delete with `deleted_at`

**Pros:** supports a trash view and an undo, and preserves history.
**Cons:** every query must filter `deleted_at IS NULL`. That is the same shape of bug as missing
owner scoping, and it would be solved the same way — in the repository base — but it is one more
invariant that base has to guarantee, and one more thing that silently fails open rather than
closed.

## Trade-off Analysis

The decision turns entirely on the premise being false. With the metric argument removed, what
remains is a trash feature, and no one has asked for one. Adding an invariant to every query in
the system to support an unrequested feature is the wrong trade.

The asymmetry worth noting: a missing owner filter and a missing deleted filter both fail open,
but the first is a security breach and the second is a cosmetic bug. That is why owner scoping
justifies living in a base class and this does not justify existing at all.

## Consequences

**Easier**
- Repositories and their tests stay smaller; one fewer invariant for the owner-scoped base to
  enforce.

**Harder**
- No undo. If a user deletes a task with its checklist items, it is gone.
- Introducing a trash later means a migration plus auditing every existing query.

**To revisit**
- If a trash or undo becomes a product requirement. That would supersede this record, and the
  cost of the retrofit should be stated then rather than pre-paid now.

## Action Items
1. [ ] Decide the cascade: deleting a task deletes its checklist items, enforced by
       `ON DELETE CASCADE` in the schema rather than by application code.
2. [ ] Test that deleting a task removes its items and touches nothing belonging to another user.

---

## Português

**Decisão:** delete físico em `Task`. Sem `deleted_at`.

**A premissa que eu havia escrito no roteiro estava errada:** o histórico de descarte não vem de
tarefas apagadas. A métrica de aceitação vive em `draft_item.status`, e item descartado no card
de revisão **nunca virou tarefa**. Com delete físico a métrica continua disponível.

**Assimetria que fecha o argumento:** filtro de dono ausente e filtro de `deleted_at` ausente
falham do mesmo jeito — abrindo. Mas o primeiro é falha de segurança e o segundo é bug
cosmético. É por isso que escopo por dono merece viver na classe base e isto não merece existir.

**Custo aceito:** sem desfazer. Apagou, foi.
