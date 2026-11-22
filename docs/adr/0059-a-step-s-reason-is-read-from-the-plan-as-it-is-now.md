# ADR-0059: A step's reason is read from the plan as it is now

**Status:** Accepted
**Date:** 2026-11-22
**Deciders:** Gabriel Barros

**Amends:** [ADR-0058](0058-a-request-says-what-it-asked-and-a-plan-s-tasks-are-listed-by-the-plan.md),
whose plan read gave each step its state and not the sentence the review shows under it.
**Builds on:**
[ADR-0030](0030-a-plan-is-placed-in-real-free-time-reviewed-and-committed-whole.md), where a
step the scheduler cannot place "stays unplaced, with its reason", and the draft shows it; and
[ADR-0033](0033-a-plan-fills-this-week-first-in-its-own-language-one-at-a-time.md), which reads
`passed` against the clock instead of storing it, the model this follows.

## Context

`plan.dc.html` shows a sentence under every step with no usable time, and each one says what
to change: "No free time in the plan's days holds 60 minutes in one piece.", "A step it
depends on has no time yet. Place that first."

The scheduler writes those sentences, on each placement, and nothing keeps them. The draft
stores one word per step (ADR-0037), and the read gave that word as `state`. Building the
review against it found two gaps:

- **The sentences would have lived twice.** The screen would have had to write them again
  from the state, in a second language, and the Java port a third time (ADR-0001).
- **`not_this_week` is two cases.** A step that does not fit before Sunday, and a step that
  goes next week because a step it depends on does. The word is the same, and only the
  sentence tells them apart.

Answered on 2026-11-22, before the review's PR.

## Decision

### 1. Each step of a plan's read says why it has no time ahead of it

Each item of `GET /plans/{plan_id}` and of `GET /plans` gains **`reason`**, and so does the step
that adding or changing one answers with. It is null for a step placed ahead. Otherwise it is
one of these:

| State | Reason |
|---|---|
| `passed` | Its start has passed. Move it, or remove it. |
| `no_room` | No free time in the plan's days holds *N* minutes in one piece. |
| `after_unplaced` | A step it depends on has no time yet. Place that first. |
| `after_unplaced`, nothing it depends on is still without a time | It has no time yet. Give it one, or remove it. |
| `not_this_week` | It does not fit before Sunday. It can go next week. |
| `not_this_week`, a step it depends on goes next week too | A step it depends on goes next week, so this one does too. |

### 2. Derived when read, never stored

It is read from the step's state, its minutes and the steps it depends on, as they are at the
moment of the read. This is how `passed` is already read from the clock. It needs no column and
no migration.

Reading it from the plan as it is now keeps it true after the plan changes. A step's
prerequisite can be given a time or removed in review. From then on, a step left waiting for it
says that only its own missing time is in the way.

### 3. Each sentence is written once

The scheduler's four sentences are constants of the scheduler, used both by its placements
and by the read. The sentences for a passed start and for a step with no time are shared by
the read and the commit's refusal. The review therefore warns in the same words that Approve
would refuse with.

## Options Considered

### Who writes the sentence

| Option | Assessment |
|---|---|
| **The plan's read — chosen** | One place, beside the scheduler that knows the cases. The screen and the port show what they are given. |
| The screen, from the state | No change on the server. The sentences would live in two places, and the split inside `not_this_week` would be inferred on the screen. |

### Where the read finds it

| Option | Assessment |
|---|---|
| **Derived from the plan as it is now — chosen** | No migration. Stays true after the plan's steps are edited or removed. |
| A column, written when the step is placed | The scheduler's own sentence, exactly. It needs a migration, and it goes stale with the first edit: a step whose prerequisite was given a time by hand would still say it waits for one with no time. |

## Trade-off Analysis

**`no_room` names the step's minutes now.** A step's length can be changed in review, and the
step is not placed again until the person asks. In the meantime the sentence names the new
length, which was never measured against the days. "Place again" measures it.

**The read does not look for tasks booked since.** The commit does, and it refuses with "A
task was booked on its time since. Move it, or remove it." The read would have to query
every placed step's time on every read. Instead the sentence arrives with the refusal, which
names each step.

**Every listed step carries a sentence.** That is a few dozen bytes for each step without a
time, and nothing for a step that has one.

## Consequences

**Easier**
- The review shows every reason from the server alone, and tells the two cases of not this
  week apart.
- A changed sentence changes in one file, for the scheduler, the read and the refusal.

**Harder**
- One more field on the plan's read.

## Action Items

1. [x] `reason` on each step of a plan's read, derived when read.
2. [x] The scheduler's sentences as constants, used by its placements and by the read.
3. [x] Tests that each state reads its sentence, that a step stops waiting once the step it
       depended on is removed, and that both cases of not this week are told apart.

---

## Português

**O problema.** O `plan.dc.html` mostra uma frase sob cada passo sem horário, dizendo o que
mudar. O scheduler escreve essas frases, mas elas não são guardadas: o rascunho grava só uma
palavra por passo, e a leitura dava essa palavra como `state`. Com isso, as frases teriam de
ser escritas de novo na tela, e uma terceira vez no port em Java. Além disso, o
`not_this_week` junta dois casos, o passo que não cabe antes de domingo e o que vai junto com
um passo de que depende. Só a frase os separa.

**A decisão.**
- **Cada passo da leitura do plano** ganha `reason`. Ele é null para um passo com horário à
  frente e, nos outros casos, traz uma das frases da tabela acima.
- **A frase é derivada na leitura e nunca guardada.** Ela vem do estado, dos minutos e dos
  pré-requisitos como estão agora, como o `passed` já vem do relógio. Por isso não precisa de
  migration. Um passo cujo pré-requisito ganhou horário ou foi removido para de dizer que
  espera por ele.
- **Cada frase existe uma vez.** As do scheduler viram constantes dele. As de início passado e
  de passo sem horário são compartilhadas com a recusa do commit.

**Opções descartadas.**
- **A tela escrever as frases a partir do `state`:** as frases ficariam em dois lugares.
- **Uma coluna gravada ao posicionar o passo:** pede uma migration e envelhece na primeira
  edição.

**O que se aceita.**
- **Depois de uma edição da duração,** o `no_room` cita os minutos novos, que ainda não foram
  medidos contra os dias.
- **A leitura não procura tarefas marcadas depois.** O commit faz isso e recusa nomeando cada
  passo.
