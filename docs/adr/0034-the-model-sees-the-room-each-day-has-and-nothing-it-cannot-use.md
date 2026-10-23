# ADR-0034: The model sees the room each day has, and nothing it cannot use

**Status:** Accepted
**Date:** 2026-10-23
**Deciders:** Gabriel Barros

**Amends:** [ADR-0004](0004-context-assembly-policy.md), in two places: the list of fields that
reach the provider, and what the context fingerprint is computed over. Its rule (allowlist,
never denylist, aggregates and never content) stands, and so does everything it excludes.

## Context

ADR-0004 chose the context's fields on 2026-08-06: per day, the minutes booked, the minutes
free and the number of tasks, plus the timezone and the working hours. ADR-0005 had already
taken the placement away from the model on the same day: it breaks a request into steps and
says how long each takes, and code decides when. So the context exists for one job, sizing the
steps, and the question for every field is whether it changes that job.

ADR-0030 then defined what the scheduler can actually use, and ADR-0032 bounded a step by the
person's block. Read against them, ADR-0004's list has two kinds of problem.

**Its number for free time is not the room the scheduler has.** "Minutes free" is usable minus
occupied over the whole day: the figure the week screen shows. It ignores the part of today
that has passed, and it ignores contiguity. On a Thursday at 21:00, with a window of 06:00 to
22:00 and nothing booked, it says 960 minutes; the scheduler can use 55. On a Saturday with
four free hours in pieces of thirty minutes, it says 240; a step of an hour fits nowhere. A
model sized by that number proposes a plan whose second half the scheduler cannot place, and
the person sees steps marked as not fitting with no way to tell why.

**The fingerprint covers less than the prompt.** ADR-0004 computes it over the day-capacity
vector, and ADR-0006 puts it in the cache key. But the prompt also carries the block length
and the days off. A person who changes the block from 60 to 30 minutes and repeats a request
two minutes later would get the cached answer: steps of an hour, every one of which the
domain layer now refuses.

Answered on 2026-10-23, with the scenarios above.

## Decision

### 1. What the model is given

The allowlist is what sizing the steps uses, and nothing else.

| Field | Why the model needs it |
|---|---|
| `today` | to read "by Friday" or "on Saturday" in the request |
| per day of the horizon: `date` and `weekday` | the same, for every day the plan may use |
| per day: `plannable_minutes` | how much that day can still take |
| per day: `longest_free_minutes` | the longest step that fits in that day |
| per day: `day_off` | a day off takes nothing, and saying so keeps "Sunday" in the request from reading as a day with room |
| `step_minutes`: from 15 to the person's block | the bounds the domain layer holds a step to (ADR-0030, ADR-0032) |
| the request | the person's own words, as typed |

**Out, from ADR-0004's list:** the timezone, the working hours, the minutes booked and the
number of tasks. The plannable figure already accounts for the window, the past and what is
booked, so none of them changes what the model should propose. They would only tell a third
party how many commitments a person has each day, where they live and when their day starts.

**Everything ADR-0004 excluded stays out:** titles, descriptions, notes, checklist items,
internal identifiers. No history enters the context either: plan-against-actual is a later
decision, and the backlog already records which column it must come from.

### 2. The two numbers come from the scheduler

Both are computed by the scheduler's module, over the same day slots it places steps in
(ADR-0030):

- **`plannable_minutes`**: the sum of the free pieces, each measured from the first start the
  scheduler would give it, on a five-minute mark and after now, capped by the minutes the day
  has left.
- **`longest_free_minutes`**: the longest of those pieces, under the same cap.

A step of `longest_free_minutes` is placed on that day, and a step one minute longer is not.
A test holds this, so the prompt and the scheduler cannot drift apart.

### 3. The fingerprint covers everything the model is shown

It is a SHA-256 over the context, serialised canonically: sorted keys, no whitespace. Two parts
of the prompt are left out because the cache key already carries them on their own
(ADR-0006):
- the request text, which the key holds normalised;
- the fixed instructions, which `prompt_version` names.

Any change to what the model sees therefore misses the cache.

### 4. The prompt is versioned by a test

The instructions and the shape of the message are pinned by a hash in a test, next to
`PROMPT_VERSION`. Changing either without a new version fails the suite, which is what
ADR-0005's "every job and every cache key carries `prompt_version`" needs in order to mean
anything.

## Options Considered

### The number for a day's free time

| Option | Assessment |
|---|---|
| **Plannable minutes and the longest piece — chosen** | The model sizes against the room the scheduler has, including how fragmented it is. In the Thursday scenario, eight of eight steps land before the exam. Costs a few tokens and reveals that a day is fragmented, but no times. |
| Plannable minutes only | The total is right, the shape is not: on the fragmented Saturday the model proposes steps of an hour that fit nowhere, and four of ten end up after the exam. |
| Capacity's free minutes (ADR-0004 as written) | The most stable figure, so the cache would hit more often. Wrong in both directions above: half the plan does not fit, and nothing tells the person why. |

### What the fingerprint is computed over

| Option | Assessment |
|---|---|
| **Everything the model is shown, minus the request and the fixed text — chosen** | Any change to what the model sees misses the cache. The request keeps its normalisation as a separate part of the key. |
| The day-capacity vector (ADR-0004 as written) | Hits more often, and serves a response made for preferences that no longer hold. |
| The whole prompt as text | Simple, and also correct. It hashes the request as typed, so "Plano de estudos" and "plano de estudos " stop matching, and it folds `prompt_version` into a key that ADR-0006 keeps separate for measuring versions. |

### What stays on the list

| Option | Assessment |
|---|---|
| **Only what sizing uses — chosen** | Smaller exposure for the same plan. A field that turns out to matter is added on purpose and shows in the diff. |
| ADR-0004's whole list, plus the two new numbers | About sixty tokens more over fourteen days, which is nothing. The cost is privacy: tasks per day, week after week, draw a routine, and the timezone says where someone lives, for no change in the answer. |

## Trade-off Analysis

**The cache gets narrower, and that is accepted.** Today's plannable minutes fall as the clock
runs, so today's figure changes every few minutes and the same request against the same
calendar matches only within that time. ADR-0006 already says the cache is not a cost
strategy: its value was double submits and demos. Since ADR-0033, a double submit is refused
by an index before it reaches the cache, so the narrower hit rate costs little. A plan sized
against the wrong figure costs the person a plan.

**The scheduler's module now owns a number the prompt shows.** That couples the context to
the scheduler, on purpose: the alternative is two pieces of code each with its own idea of a
day's room, and a disagreement between them is invisible until a plan fails to fit.

## Consequences

**Easier**
- A plan the model proposes fits what the scheduler can place, on the first try, more often.
- The privacy claim is narrower and easier to check: two numbers and a flag per day, a date,
  two bounds and the request.
- Changing the prompt without changing its version is caught by the suite.

**Harder**
- The context depends on now, not only on the calendar.
- The cache hits less, as above.

**To revisit**
- A field the model turns out to need, which joins the allowlist through a new record.
- Whether a person who discards a plan and asks again should get the cached plan back. That
  question belongs to S7, where the cache is built, and the backlog records it.

## Action Items

1. [ ] The scheduler's module reports each day's room: plannable minutes and longest piece.
2. [ ] The assembler builds the prompt from the allowlist, with the fingerprint and
       `PROMPT_VERSION`, and a test holds the emitted keys to the allowlist.
3. [ ] A test pins the prompt's text and shape to its version.
4. [ ] The privacy test of ADR-0004, through the database: sensitive titles, notes and
       checklist items in, none of them in the prompt.

---

## Português

**O problema.** A lista de campos da ADR-0004 foi escolhida antes de a ADR-0030 dizer o que o
agendador consegue usar de fato. O número de "livre" que ela envia é o da tela: ignora o que
já passou do dia e se o tempo está picado. Às 21:00 de quinta, ele diz 960 minutos, e o
agendador tem 55. Além disso, o fingerprint cobre só a capacidade, e o cache serviria uma
resposta feita para um bloco que a pessoa acabou de mudar.

**A decisão.**
- **O modelo recebe só o que usa para dimensionar os passos:** a data de hoje; por dia, a data,
  o dia da semana, os minutos planejáveis, o maior trecho e a marca de folga; os limites de um
  passo; e o pedido.
- **Saem o fuso, a janela, os minutos ocupados e a contagem de tarefas.** O planejável já
  desconta tudo isso, e o resto só contaria a rotina da pessoa a um terceiro.
- **Os dois números saem do módulo do agendador,** sobre os mesmos slots onde ele coloca os
  passos. Um passo do tamanho do maior trecho cabe no dia, e um minuto a mais não cabe.
- **O fingerprint cobre tudo o que o modelo vê,** menos o pedido e o texto fixo, que já são
  partes próprias da chave de cache.
- **Um teste prende o texto do prompt à versão,** para que mudar um sem mudar o outro quebre a
  suíte.

**O que se aceita.** O cache acerta menos, porque o planejável de hoje muda com o relógio. Desde
a ADR-0033, o duplo envio já é barrado antes do cache, então custa pouco.
