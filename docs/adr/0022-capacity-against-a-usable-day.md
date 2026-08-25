# ADR-0022: Capacity is real occupancy, measured against a usable day

**Status:** Accepted
**Date:** 2026-08-25
**Deciders:** Gabriel Barros

**Supersedes:** Rule 3 of [ADR-0012](0012-task-time-business-rules.md). The rest of ADR-0012
stands.

## Context

S5 put the week on a screen, and three things went wrong the moment a person used it.

**A task crossing midnight booked the whole thing against the day it started.** A 23:00 task
lasting two hours took two hours off Monday and nothing off Tuesday. Rule 3 of ADR-0012 chose
that deliberately, and the record even named the consequence: *a day can report more than
1440 minutes occupied*. On paper that read as an acceptable simplification. On screen it
reads as the product lying.

**Finishing early freed nothing.** A task booked 12:00–15:00 and completed at 13:30 still
held the room until 15:00 — both in the capacity figure and in the exclusion constraint, so
the freed hour and a half could not even be booked.

**A day offered 24 hours.** The first person other than the author to see the screen asked
"why is it only full at 24 hours — doesn't he sleep?". That is the whole product's premise
failing at a glance: a tool that says you have 24 hours free is not helping anyone plan.

The three share a cause. Capacity was summing `duration_minutes` — *the plan* — against the
length of a calendar day. It should sum *what is actually occupied*, against *what a person
can actually spend*.

## Decision

### 1. Minutes count on the day they happen

A task's minutes are attributed to whichever local day they fall in, clipped at midnight.
23:00 plus two hours gives one hour to Monday and one to Tuesday.

The capacity query stops being a `GROUP BY` over a derived date and becomes a sum of each
task's overlap with each day's window:

```sql
SUM(LEAST(end_at, window_end) - GREATEST(start_at, window_start))
```

The day windows are built in Python from the user's zone and passed in, rather than derived
in SQL. Same reason as ADR-0009: the conversion between a local day and a UTC range happens
once, at the edge, in the one helper that already handles the awkward cases.

**The predicate keeps its index.** `ix_tasks_user_start_at` covers `(user_id, start_at)`, and
a filter on `end_at` cannot use it. The window therefore also carries
`start_at >= window_start - interval '1 day'`, which is safe *because* of the existing CHECK:
no task exceeds 1440 minutes, so nothing starting more than a day before the window can still
be inside it. A constraint written for correctness turns out to buy a range scan.

### 2. Completing early shortens the occupancy

`end_at` becomes the earlier of the planned end and the moment the task was completed:

```sql
NEW.end_at := NEW.start_at + LEAST(
  NEW.duration_minutes * interval '1 minute',
  GREATEST(COALESCE(NEW.completed_at, 'infinity'::timestamptz) - NEW.start_at, interval '0')
);
```

`LEAST` so completing *late* never extends the booking — an update that grew the range could
collide with a neighbour, and a completion that fails is a worse experience than one that is
merely imprecise. `GREATEST` so completing something before it started yields an empty range
rather than an inverted one.

Two things follow, and both are gains:

**The exclusion constraint frees the time by itself.** The range shrinks, so 13:30–15:00
becomes bookable with no code that knows about it. The rule stays in one place.

**`duration_minutes` and `end_at` split meaning.** The first is the plan, the second is what
happened. The AI layer gets "this person's estimates run 2× long" for free — exactly the kind
of context ADR-0004 wants and could not otherwise have.

### 3. Capacity is measured against a usable day

The day reports two lengths:

| Field | What it is | What it drives |
|---|---|---|
| `total_minutes` | the real length of the local day — 1440, or 1380/1500 on a transition | the geometry: the track under each day |
| `usable_minutes` | `min(960, total_minutes)` | the free figure, and every threshold below |

Sixteen hours, leaving eight for sleep. A server constant (`USABLE_MINUTES_PER_DAY`) and not
yet a column: it becomes a per-user preference alongside the working hours ADR-0004 already
lists, and `GET /me` is the resource it will attach to.

`free_minutes = max(0, usable_minutes - occupied_minutes)`.

### 4. Load is a four-valued state, and nothing is ever refused

| Booked | `load` | What the screen says |
|---|---|---|
| ≤ 16h | `fine` | nothing |
| 16h–18h | `heavy` | "No margin for anything running late." |
| 18h–20h | `strained` | "Extremely heavy day. `X`h unbooked." |
| > 20h | `unsustainable` | "Unsustainable. `X`h unbooked." |

Thresholds are strictly greater, so 16h exactly is still `fine` — the same convention
`over_capacity` already uses.

`X` is measured against the **whole day**, not against the usable budget. Past 16h booked the
budget is already spent, so a figure against it would read `0h` at every level and say
nothing.

Alongside any of the three, one offer:

> **This day is heavier than the rest of your week.** Tuesday has 9h free. — [Move something]

Deterministic. The screen already fetches all seven days' capacity, so the lighter day is
data rather than a model. The AI improves it later by choosing *which* task should move; it
is not needed for the sentence to be true today.

### 5. Nothing above any threshold is blocked

Not a limit, only a statement. A 21-hour day is a real thing — a flight, a shift, a night in
a hospital — and a product that refuses to record it is not being kind, it is being less
useful. The day gets recorded somewhere else, and then this tool holds an incomplete picture,
which is worse for the person and worse for the AI layer that plans against it.

There is a technical argument in the same direction. "The sum of durations in a local day is
at most 1200" is an aggregate constraint across rows. `CHECK` cannot express it; a trigger
running a query can be raced. It would be the first rule in this project the database could
not actually guarantee, and that is a bad trade for a rule that should not exist.

## Options Considered

### Attributing minutes across midnight

| Option | Assessment |
|--------|------------|
| **Clip at midnight — chosen** | Physically true. Costs a range-clipping sum instead of a plain one, which is the cost ADR-0012 declined to pay when there was no screen to show it being wrong. |
| Keep all minutes on the start day | The status quo. Simple, and visibly false to anyone who looks at a Tuesday morning that a Monday evening has consumed. |
| Forbid crossing midnight | Coherent, and refuses to record a 22:00 study block. Refusing to describe reality is the failure mode this whole record is about. |

### Freeing time when a task is completed early

| Option | Assessment |
|--------|------------|
| **Shorten `end_at`, keep `duration_minutes` — chosen** | One line in a trigger. The exclusion constraint follows for free, and plan-versus-actual becomes recorded data. |
| Truncate `duration_minutes` | Simpler to read, and destroys the estimate. "I planned three hours and took ninety minutes" is exactly what the planner will want to know. |
| Free it visually only | Two numbers that disagree, and a slot the interface shows as free and the database refuses to book. |

### What a day offers

| Option | Assessment |
|--------|------------|
| **A usable budget, reported next to the real day — chosen** | The figure becomes plausible without the geometry losing the one fact that changes it. |
| Replace `total_minutes` with the budget | Every day would render 16h and the daylight-saving day would stop being visible — the second time in this project a change nearly erased that. |
| Working hours as a window, e.g. 06:00–22:00 | Richer, and says *which* hours. Needs the capacity query to clip against a window as well as against the day, and needs a schema decision this record is not ready to make. It supersedes this one when it comes. |

## Trade-off Analysis

**The three changes are one change.** All of them replace `SUM(duration_minutes)` with a sum
over the real `[start_at, end_at)` range, clipped to a day. Split into three pull requests
they would be three rewrites of the same query, each invalidating the last one's tests.

**`over_capacity` survives only because of the budget.** With minutes clipped at midnight and
overlaps already impossible, a day can never exceed its own length — the flag would have
become unreachable, and the accent colour, which means trouble and only trouble, would have
lost its meaning. The 16-hour budget is what makes "over capacity" a statement about a person
rather than an artefact of an attribution rule. That is the second time a decision here has
nearly deleted something the previous one paid for, and the reason both are written down.

**Un-completing a task can now fail.** Marking something done frees its remaining time, and
that time can be booked by something else. Un-marking it tries to grow the range back into
occupied space, and the exclusion constraint refuses. That is correct behaviour and needs a
readable message rather than a driver error — it joins the overlap translation that already
exists.

**The messages state facts and never judge.** They escalate by number, not by adverb. An
earlier draft read "This isn't sustainable" as a middle step; a tool that has opinions about
your life is a tool people close. The one remaining judgement word, "unsustainable", is
carried by a figure that makes it arithmetic.

## Consequences

**Easier**
- The screen stops being wrong about where a late task's minutes went.
- Finishing early actually frees the room, with no code path that knows about it.
- A day's free figure is a number somebody can act on.
- The planner in S6 has a real budget to place against, and plan-versus-actual to learn from.

**Harder**
- The capacity query gains per-day clipping and a window with a deliberate one-day margin.
  The `EXPLAIN` test from S4 has to keep passing, and it is the thing that will catch the
  margin being dropped.
- A migration replaces the `end_at` trigger. No column changes.
- Un-completing needs its own error.
- Four `load` values are four visual weights the design has to carry without becoming noisy.

**To revisit**
- `USABLE_MINUTES_PER_DAY` becomes a per-user preference, with working hours (ADR-0004).
- Working hours as a *window* rather than a budget supersedes decision 3 when it lands.
- The scheduler must not place work that pushes a day past `heavy`. Recorded for S6.

## Action Items

1. [x] Trigger derives `end_at` as the lesser of planned and completed, never negative.
2. [x] Capacity sums the clipped range per local day, windows built at the edge.
3. [x] The window keeps `start_at >= first - 1 day` so the index is still usable.
4. [x] `DayCapacity` gains `usable_minutes` and `load`; `total_minutes` stays.
5. [x] Un-completing into occupied time answers a readable 409.
6. [x] The "move something" box, from capacity the screen already has.
7. [x] A test that a 23:00 task lasting two hours books one hour on each of two days.
8. [x] A test that completing at 13:30 makes 13:30–15:00 bookable.

---

## Português

**Três coisas quebraram assim que uma pessoa usou a tela**, e as três têm a mesma causa: a
capacidade somava `duration_minutes` — o **plano** — contra o comprimento de um dia de
calendário. Passa a somar **o que está de fato ocupado**, contra **o que uma pessoa consegue
gastar**.

**Minuto cai no dia em que acontece.** Tarefa das 23:00 com duas horas dá uma hora para
segunda e uma para terça. A query deixa de ser `GROUP BY` sobre data derivada e vira soma do
recorte de cada tarefa com a janela de cada dia. As janelas são montadas em Python a partir
do fuso do usuário — mesma razão do ADR-0009, a conversão acontece uma vez, na borda.

O predicado **mantém o índice**: como nenhuma tarefa passa de 1440 minutos, a janela carrega
`start_at >= início - 1 dia` e continua sendo varredura por range. Uma constraint escrita por
correção acabou comprando desempenho.

**Concluir cedo encurta a ocupação.** O `end_at` vira o menor entre o planejado e o
concluído. `LEAST` para concluir tarde nunca esticar a reserva — um update que cresce o range
pode colidir com o vizinho, e conclusão que falha é pior que conclusão imprecisa. A exclusion
constraint libera o horário sozinha, e `duration_minutes` continua sendo o plano enquanto
`end_at` passa a ser o real — o que dá de graça, para a IA do S6, "as estimativas desta
pessoa esticam 2×".

**O dia reporta dois comprimentos.** `total_minutes` é o dia real e alimenta a trilha, então
o horário de verão continua visível. `usable_minutes` é 960 — dezesseis horas, oito para
dormir — e alimenta o número livre e todos os limiares. Constante no servidor por ora;
preferência por usuário depois, com o `GET /me` como casa.

**Quatro níveis, e nada é bloqueado.** `fine` até 16h, `heavy` até 18h, `strained` até 20h,
`unsustainable` acima. As frases afirmam fato e não julgam; a escalada está no número, não no
advérbio. E o `X` das mensagens é medido contra o dia inteiro, não contra o orçamento — a
partir de 16h ocupadas o orçamento já é zero e o número não diria nada.

Não bloquear é decisão de produto: dia de 21 horas existe — voo, plantão, hospital —, e um
produto que se recusa a registrar não é mais gentil, é menos útil. Também é decisão técnica:
"a soma das durações de um dia ≤ 1200" é restrição agregada entre linhas, que `CHECK` não
expressa e trigger com query não garante sob concorrência. Seria a primeira regra do projeto
que o banco não consegue sustentar.

**O `over_capacity` sobrevive por causa do orçamento.** Com os minutos recortados e a
sobreposição já impossível, um dia nunca passaria do próprio tamanho e a flag ficaria
inalcançável — levando junto o único significado da cor de acento. O orçamento de dezesseis
horas é o que faz "acima da capacidade" voltar a ser afirmação sobre uma pessoa em vez de
artefato de uma regra de atribuição.
