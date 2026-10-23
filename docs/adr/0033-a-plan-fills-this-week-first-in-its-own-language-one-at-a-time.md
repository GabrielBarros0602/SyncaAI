# ADR-0033: A plan fills this week first, in the request's language, one at a time

**Status:** Accepted
**Date:** 2026-10-23
**Deciders:** Gabriel Barros

**Amends:** [ADR-0030](0030-a-plan-is-placed-in-real-free-time-reviewed-and-committed-whole.md),
in four places:
- §2 gains a default horizon;
- §3 stops automatic placement at the end of the current week;
- §4 gains the life of a draft that nobody reviews;
- one plan in progress per person, which ADR-0030 did not limit.

The rest of ADR-0030 stands.

## Context

ADR-0030 decided how a plan is placed, reviewed and committed. Four questions it left open
came up before the draft and the endpoints were built, and each was answered on 2026-10-23
against a concrete scenario:

1. **Language.** The model writes the titles and descriptions of what become a person's own
   tasks. The project writes its interface in English, but a task title is the person's
   content, not interface text.
2. **Horizon.** A request may name 1 to 14 days, and when it names none, something has to be
   assumed.
3. **Age.** A draft nobody reviews goes stale: its starts pass.
4. **Concurrency.** Drafts reserve nothing. Two of them can propose the same free hour.

The answer to the second came with a condition. What does not fit in the week on screen
must not move to the next week on its own: the person is told, and offered the move.

## Decision

### 1. The plan is written in the request's language

The prompt tells the model to write titles and descriptions in the language the request is
written in. A request for "plano de estudos para a prova de Estatística" produces "Revisar
distribuição normal", next to the tasks the person typed by hand in the same language. The
interface stays in English.

### 2. Fourteen days by default, but this week first

When the request names no horizon, it is 14 days from today. The scheduler fills those days
in two steps:

1. **Automatically, up to the Sunday that ends the current week.** "Current" is the
   Monday-to-Sunday week that contains today in the person's zone: the week the screen opens
   on.
2. **Only when asked, the days after that Sunday,** up to the end of the horizon.

An item that does not fit by Sunday is marked **doesn't fit this week**. This is a different
state from **no free time in the plan**, and the draft offers **place next week**: the
scheduler runs again, only for those items and only over the following days. If the horizon
ends before Sunday, there is no following week to offer, and an item that does not fit is
simply unplaced.

| Today | Request | Result |
|---|---|---|
| Thu 22 Oct | 8 steps of 45 min, 4h30 free from Thursday to Sunday | 6 placed this week; 2 marked doesn't fit this week; **place next week** puts them on Monday 26 |
| Sun 25 Oct, evening | the same | 1 placed on Sunday; 7 marked doesn't fit this week |
| Thu 22 Oct, horizon 3 days | the same | 6 placed by Saturday; 2 unplaced, with no next-week offer |

### 3. A stale draft is re-placed, not regenerated

When a draft is read:
- an item whose start has passed is marked **passed**;
- **re-place** runs the scheduler alone over the passed and unplaced items, with the week
  rule above. There is no call to the model, so it costs nothing and keeps every edit made in
  review;
- a pending draft becomes **expired** once the last day of its horizon has ended, when nothing
  is left to place it in. Reading it checks this, and the worker's sweep (ADR-0031) records
  it.

The draft's statuses are now `pending`, `approved`, `discarded` and `expired`.

### 4. One plan in progress per person

While a person has a job `queued` or `running`, or a draft `pending`, a new request answers
409 `Review or discard the plan you have first.`

Each half is held by the database as well as by the service:
- a partial unique index on `ai_jobs (user_id) WHERE status IN ('queued', 'running')`;
- another on `plan_drafts (user_id) WHERE status = 'pending'`.

A double submit then loses the race at the index rather than producing two jobs.

## Options Considered

### Language (answered on 2026-10-23)

| Option | Assessment |
|--------|------------|
| **The request's language — chosen** | The tasks read in the language the person thinks in, beside the ones they wrote. |
| Always English | Uniform with the interface. A person's week then mixes "Academia" and "Chapter 4 exercises". |

### Default horizon (answered on 2026-10-23, with the week condition)

| Option | Assessment |
|--------|------------|
| **14 days, this week first — chosen** | Nothing lands outside the week on screen without the person choosing it, and the second week is one action away instead of a new request. |
| 7 days | Never past next week. Items that do not fit stay unplaced even with free time the day after. |
| No default | Nothing implicit. The request card would need a selector nobody has drawn. |

### Where "this week" ends (answered on 2026-10-23)

| Option | Assessment |
|--------|------------|
| **The calendar week on screen, Monday to Sunday — chosen** | The boundary the person can see. A request on a Sunday places little automatically; the offer makes the rest one click. |
| Seven days from today | Fills a week's worth from any day. Part of it lands on the next screen without a word, which is what the condition was written to prevent. |

### A stale draft (answered on 2026-10-23)

| Option | Assessment |
|--------|------------|
| **Mark, re-place, expire with the horizon — chosen** | Edits survive, re-placing costs no call, and a draft stops pretending once its days are gone. |
| Expire after 24 hours | Simple. Edits are lost, and in S7 each new generation is a paid call. |
| Never expire | Nothing disappears. Every passed start is refused at commit and moved by hand. |

### Concurrency (answered on 2026-10-23)

| Option | Assessment |
|--------|------------|
| **One at a time — chosen** | Two drafts never compete for the same hour, and the next plan is generated against a calendar that already holds the last one. |
| Several, conflicts at commit | Freer. The second draft's items fail at commit wherever the first took the time. |

## Trade-off Analysis

**A Sunday request mostly overflows.** That is the boundary working as asked: the person is
looking at a week with one evening left, and the plan says so instead of quietly filling next
week's screen.

**The week is the person's, not the server's.** Monday and Sunday are read in the account's
zone, the same conversion every local day in this project goes through (ADR-0009). A person in
Tokyo and a person in São Paulo planning at the same instant can be in different weeks.

**One plan at a time can block a person who forgot a draft.** The refusal says what to do. A
forgotten draft also expires with its horizon, so the block never outlives the draft's days.

**Language is followed, not enforced.** Nothing checks the model's choice of language. A
response in the wrong language is still a valid plan, and the review is where the person
notices. A check would mean detecting language, which is a model of its own.

## Consequences

**Easier**
- The plan never surprises the person on a screen they were not looking at.
- A stale draft is fixed with one action that costs nothing.
- At most one draft per person, so placement never has to resolve two drafts against each
  other.

**Harder**
- Two unplaced states and two placement actions (re-place, place next week) instead of one.
- An `expired` status, and a sweep that records it.

**To revisit**
- Planning a future week the person is viewing, rather than the one containing today. Today
  the horizon starts today, so the first week is always the current one.

## Action Items

1. [ ] The prompt asks for the request's language.
2. [ ] A 14-day default; automatic placement up to the current week's Sunday; *doesn't fit
       this week* and **place next week**.
3. [ ] *Passed*, **re-place**, and `expired` at the end of the horizon.
4. [ ] One plan in progress, held by two partial unique indexes and refused with 409.

---

## Português

**O problema.** Ficaram quatro perguntas do ADR-0030 para antes do rascunho e das rotas.
Cada uma foi respondida em 2026-10-23, contra um cenário concreto.

**A decisão.**
- **Idioma:** o plano é escrito no idioma do pedido. Quem pede em português recebe tarefas em
  português.
- **Horizonte:** 14 dias por padrão, mas o plano só ocupa sozinho até o domingo da semana
  atual, na zona da pessoa. O que não couber vira "não cabe nesta semana", com o botão "levar
  para a próxima semana", que roda o agendador só nos dias seguintes.
- **Rascunho velho:** itens com horário vencido aparecem marcados. "Reposicionar" roda só o
  agendador, sem chamar o modelo e sem perder as edições. O rascunho expira quando o último
  dia do horizonte termina.
- **Um plano por vez:** com job na fila ou rascunho pendente, um novo pedido recebe 409. Dois
  índices únicos parciais seguram isso no banco.

**O custo aceito.**
- Um pedido feito no domingo quase todo transborda para "não cabe nesta semana".
- O idioma é seguido, mas não verificado: a revisão é onde a pessoa percebe.
