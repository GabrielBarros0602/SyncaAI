# ADR-0020: Tags, checklist ordering and pagination

**Status:** Accepted
**Date:** 2026-08-25
**Deciders:** Gabriel Barros

## Context

S4 puts an API in front of the domain model. Three choices shape that surface, all small
enough that a separate record each would obscure rather than clarify — the same reasoning
that grouped the time rules into [ADR-0012](0012-task-time-business-rules.md).

They share a constraint worth stating: the milestone that matters commercially is S5, the
first screen anybody other than the author can look at. Anything that inflates S4 delays
that, and the project exists to be shown.

## Decision

### Tags are rows, created on demand

A `tags` table, owned per user, unique on `(user_id, name)`. A task references at most one.

**No CRUD surface for tags.** A tag comes into existence when a task names one, through a
get-or-create scoped to the owner, and there is a single endpoint to list the ones a user
has. No colours, no icons, no rename, no delete — those are S10, with the rest of the
prototype's surface.

### Checklist positions are unique, deferred

```sql
UNIQUE (task_id, position) DEFERRABLE INITIALLY DEFERRED
```

Reordering writes several rows whose positions collide midway through. Deferring the check
to commit means a reorder is an ordinary batch update inside one transaction, with no
temporary values and no two-phase shuffle.

### Pagination is `LIMIT` and `OFFSET`

With a keyset cursor recorded as the alternative and a written trigger for revisiting.

## Options Considered

### Tags

| Option | Assessment |
|---|---|
| Table, created on demand — **chosen** | Consistent data and a reusable tag, without a feature to build. Costs one table, one relation and a get-or-create. |
| Free normalised string | One column and a validator. `work` and `trabalho` coexist as different things forever, and the migration out needs a backfill. |
| Table with full CRUD | What the prototype eventually wants. Endpoints, colours, rename and delete — a feature competing with the sprint that reaches the first screen. |
| No tag | Smallest surface, and the first screen ships without something the author's own prototype has. |

### Checklist position

| Option | Assessment |
|---|---|
| Unique, deferred — **chosen** | Determinism enforced by the database, in the same spirit as the exclusion constraint on tasks. Postgres makes the reorder case cheap. |
| No constraint, order by `(position, id)` | Deterministic output without a constraint, and cheaper. But duplicate positions are accepted, so the tiebreak is arbitrary rather than meaningful. |
| No constraint, no tiebreak | Two identical requests can return different orders — the kind of bug nobody reproduces and everybody notices. |

### Pagination

| Option | Assessment |
|---|---|
| Offset — **chosen** | Simple, allows jumping to any page, and the data is per user: hundreds of rows, not millions. |
| Keyset cursor | Does not degrade on deep pages because it seeks rather than scanning and discarding. Real work for a problem this volume does not have. |

## Trade-off Analysis

The tag decision was made against the recommendation, and the reasoning is worth recording
because it is a genuine disagreement rather than an oversight. A free string is cheaper now
and permanently lossy: nothing can later tell whether two spellings meant the same thing.
A table costs a get-or-create and buys data that stays answerable. Cutting the CRUD surface
is what keeps that from becoming a feature — a tag nobody can rename is still a tag that
means one thing.

Offset pagination is deliberate under-engineering, in the same shape as choosing PostgreSQL
over Redis for the queue. The trigger for revisiting is a measurement, not a suspicion:
latency that grows with the page number.

## Consequences

**Easier**
- Tags stay answerable — "how much time went to this tag" is a query rather than a guess.
- A reorder is one update statement inside one transaction.
- Listing endpoints are three lines.

**Harder**
- A tag that nobody can delete accumulates. A typo becomes a permanent entry in the user's
  tag list until S10 gives it a delete.
- Deferred constraints only defer inside a transaction; a reorder split across two requests
  still collides. The service has to do it in one.
- Deep pages will get slower. Nobody will notice at this size, which is exactly why the
  trigger has to be written down rather than remembered.

**To revisit**
- Tag CRUD, colours and rename, in S10 with the rest of the prototype.
- Keyset pagination, if page latency ever tracks page number.

## Action Items
1. [ ] `tags` table, owner-scoped, unique on `(user_id, name)`, name normalised.
2. [ ] Get-or-create scoped to the owner, so naming a tag on a task cannot reach another
       user's row.
3. [ ] `UNIQUE (task_id, position) DEFERRABLE INITIALLY DEFERRED`, with a test that a batch
       reorder inside one transaction succeeds.
4. [ ] Pagination bounded by a maximum page size, so a caller cannot ask for everything.

---

## Português

**Três escolhas pequenas do S4, agrupadas** pelo mesmo motivo que agrupou as regras de tempo
no ADR-0012: um registro separado para cada obscureceria em vez de esclarecer.

**Tags são linhas, criadas sob demanda.** Tabela `tags` por usuário, única em
`(user_id, name)`. **Sem CRUD de tag** — ela nasce quando uma tarefa a nomeia, e existe um
endpoint só para listar as suas. Cor, ícone, renomear e apagar ficam para o S10.

Esta decisão foi tomada **contra a minha recomendação**, e o registro diz isso porque é
discordância real e não descuido. String livre é mais barata agora e perde informação para
sempre: nada consegue depois dizer se `work` e `trabalho` queriam dizer a mesma coisa. A
tabela custa um get-or-create e compra dado que continua respondível. Cortar o CRUD é o que
impede isso de virar feature.

**Posição do item é única, com verificação adiada.** `DEFERRABLE INITIALLY DEFERRED` faz a
checagem acontecer no commit, então reordenar é um update em lote dentro de uma transação,
sem valores temporários.

**Paginação por `OFFSET`.** Subengenharia deliberada, na mesma forma que escolher PostgreSQL
em vez de Redis para a fila. O gatilho para revisar é medição, não suspeita: latência que
cresce com o número da página.

**Custo aceito:** tag com erro de digitação fica na lista do usuário até o S10 dar um delete.
E constraint adiada só adia dentro de uma transação — reordenação partida em duas requisições
ainda colide, então o serviço precisa fazer numa só.
