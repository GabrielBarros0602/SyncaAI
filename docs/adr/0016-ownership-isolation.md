# ADR-0016: Enforce ownership in the repository base, and answer 404 across owners

**Status:** Accepted
**Date:** 2026-08-17
**Deciders:** Gabriel Barros

## Context

[ADR-0002](0002-mvp-scope-ai-features.md) named the most likely security failure of this
project: user A reading `/tasks/42`, which belongs to user B. It is likely because it does not
require an attacker to do anything clever — it happens when one query out of forty forgets a
`WHERE user_id = ...`, and nothing about the code looks wrong.

Two questions follow. Where does the filter live, and what does the API say when a resource
exists but belongs to someone else.

The sprint order was changed for this reason: authentication now comes before the domain CRUD,
so the enforcement point exists before the repositories that must use it, rather than being
retrofitted into each one afterwards.

## Decision

**A base repository owns the filter.** Every concrete repository inherits from it and receives
the current user's id at construction. It has no method that returns rows without scoping, so
forgetting the filter is not something a caller can do — the unscoped query is simply not
expressible.

`ChecklistItem` deliberately has no `user_id` ([ADR-0010](0010-day-as-a-table-for-day-level-state.md)
records the principle: a fact is stored once, in the row that owns it). Its scoping is therefore
a join through `tasks`, which the base handles by declaring the path from the model to its
owner rather than assuming a column.

**A resource belonging to another owner answers 404**, with the real reason logged
server-side.

## Options Considered

### Where the filter lives

| Option | Assessment |
|---|---|
| Base repository — **chosen** | One place to audit. A new repository is scoped by inheriting. The unscoped query has no API. |
| Each service remembers | Every new endpoint is a new chance to forget, and the omission is invisible in review. |
| Row-level security in PostgreSQL | Strongest — enforced even for a manual query — but requires setting a session variable per request and makes migrations and debugging harder. Worth revisiting if the service ever grows past a single writer. |

### What to answer across owners

| Option | Assessment |
|---|---|
| 404 — **chosen** | Indistinguishable from absence, so it confirms nothing. Debuggability is recovered by logging the distinction. |
| 403 | Clearer to the client and easier to support, at the cost of confirming the resource exists. |

## Trade-off Analysis

Row-level security is the better mechanism and was not chosen. That is worth being honest
about: it enforces the rule below the application, so even a hand-written query in a migration
obeys it. It was rejected because it moves the rule into a place that is harder to test and to
reason about at this stage, and because the base repository is enough while every write goes
through one service. The trigger for revisiting is a second writer — a worker, a script, an
analytics job — reaching the same tables.

On 404 versus 403: with UUID primary keys, enumeration is already impractical, so the
information leak 403 permits is small. This is defence in depth rather than the primary
control, and it is cheap. The cost is a support answer that sounds wrong — "it does not
exist" when the user can see it on another account — which is why the server logs which of the
two actually happened.

## Consequences

**Easier**
- One file to review when asking "can a user read another user's data".
- A new entity is scoped correctly by inheriting, not by remembering.

**Harder**
- The base has to express "how do I reach the owner from this model", which for checklist items
  is a join rather than a column.
- Anything that bypasses the repository — a raw query, a migration, a future worker — is
  outside the guarantee, and that is exactly what row-level security would have covered.
- 404 makes a real support case harder to diagnose without reading logs.

**To revisit**
- Row-level security, when a second writer touches these tables.

## Action Items
1. [ ] Base repository taking the owner id, with no unscoped accessor.
2. [ ] Declare the owner path per model, so checklist items scope through their task.
3. [ ] A cross-owner test for every endpoint that accepts an id: user A requesting user B's
       resource gets 404. This is the assertion that the whole record exists to guarantee.
4. [ ] Log the distinction between absent and not-yours, at a level that survives production.

---

## Português

**Decisão:** uma **classe base de repositório** carrega o filtro por dono. Todo repositório
concreto herda dela e recebe o id do usuário atual na construção. Ela não tem método que
devolva linha sem escopo — então esquecer o filtro não é algo que o chamador consiga fazer, a
query sem escopo simplesmente não é expressável.

`ChecklistItem` não tem `user_id` de propósito. O escopo dele é um join por `tasks`, e a base
lida com isso declarando o caminho do modelo até o dono em vez de assumir que existe coluna.

**Recurso de outro dono responde 404**, com o motivo real no log do servidor.

**O que eu recusei e por quê:** row-level security do PostgreSQL é o mecanismo melhor — vale
até para query escrita à mão numa migration. Recusei porque move a regra para um lugar mais
difícil de testar e de raciocinar neste estágio, e porque a base de repositório basta enquanto
toda escrita passa por um serviço. **O gatilho para revisar é um segundo escritor** — worker,
script, job de analytics — tocando as mesmas tabelas.

**Custo aceito:** o que passa por fora do repositório fica fora da garantia. E o 404 torna caso
de suporte legítimo mais difícil de diagnosticar sem ler log.

**Motivo da reordenação do roteiro:** a autenticação passou a vir antes do CRUD justamente para
o ponto de imposição existir antes dos repositórios que precisam usá-lo, em vez de ser retrofit
em cada um depois.
