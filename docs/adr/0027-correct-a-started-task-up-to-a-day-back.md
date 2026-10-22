# ADR-0027: A started task's start can be corrected, up to a day back

**Status:** Accepted
**Date:** 2026-10-22
**Deciders:** Gabriel Barros

**Amends:** rule 1 of [ADR-0012](0012-task-time-business-rules.md). Creating a task with a start
in the past stays forbidden, exactly as written there. What changes is editing the start of a
task that has already begun.

## Context

ADR-0012 forbade a start in the past, and the service applied that rule to every change of
`start_at`, not only to creation. A task planned for 09:00 that actually began at 08:00 could
not be corrected, because 08:00 is the past by the time anyone corrects it. The only workaround
anyone could think of, deleting and recreating, hits the same rule, so the record of what
happened stayed wrong.

Decision 1 of 2026-10-22 answered the question: on a task that has already begun, the start
may be corrected as far as 24 hours before now, and creating in the past stays forbidden.
Decision 2 of the same day declined to offer *move* on a completed task, on the grounds that the
correction covers the real case. So the correction has to reach completed tasks too.

That raises a case neither decision named: a correction that puts a completed task's start
after the moment it was completed. The trigger would accept it and record an empty occupancy
(ADR-0022), so nothing in the database would object.

## Decision

The rule now depends on whether the task has begun, judged by its stored start against the
server's clock, read once per request.

| Change | Rule | Refusal |
|---|---|---|
| Create a task | the start is after now — unchanged | 422 `A task cannot start in the past.` |
| Move the start of a task that has not begun | the new start is after now — unchanged | the same |
| Correct the start of a task that has begun, completed or not | the new start is no earlier than 24 hours before now; later, including the future, is fine | 422 `A start can be corrected at most 24 hours back.` |
| …and the task is completed, as the request leaves it | the new start is no later than `completed_at` | 422 `A task cannot start after it was completed.` |

"As the request leaves it" matters when one request both changes completion and corrects the
start: unticking in the same request lifts the bound, and ticking sets it to now.

Everything else stands. A corrected range that overlaps another task is refused by the
exclusion constraint like any other (409), the duration cap holds, and the trigger re-derives
`end_at` from the corrected start.

## Options Considered

### How far back an edit may go

| Option | Assessment |
|--------|------------|
| **Up to 24 hours before now, on a task that has begun — chosen** | Covers the real case, a plan that disagreed with the day by an hour or an evening, and stops where correction turns into history. |
| No limit on edits | Retroactive logging through the back door: create in the future, wait, then move it anywhere. ADR-0012 declined that feature on purpose. |
| No change: refuse, and correct by deleting and recreating | Does not work. Recreating with a start in the past hits the same rule, which is how the question came up. |

### A start after completion

| Option | Assessment |
|--------|------------|
| **Refuse — chosen** | A correction exists to make the record true, and "it began after it ended" never is. It costs one rule, on the correction path only. |
| Accept, and let the trigger record an empty occupancy | One rule fewer, and no error to explain. But the result is a record that cannot be true, and nothing would say so. |

## Trade-off Analysis

**The window is measured from now, not from the planned start.** Measured from the plan, a
task begun twenty hours ago could be pulled back a further day, two days into the past. From
now, the bound is the same for every task and is easy to state on screen.

**A small form of retroactive logging becomes possible.** Schedule a task for later today, let
it begin, then pull it back a day. Accepted: it is bounded at one day, it takes waiting for the
start to pass, and `created_at` still shows the task was made after the time it now claims.

**Ticking early is not a correction.** Marking a task completed before its start still yields
an empty occupancy, as ADR-0022 allows. The completion bound applies only when a started task's
start is being corrected, because only there is the start a claim about what already happened.

**Three rules where one was.** Each one has a test at its boundary, and each refusal has its
own sentence, so the edit panel can show the server's words unchanged.

## Consequences

**Easier**
- A task that began earlier or later than planned can be corrected, so plan against real stays
  true for the AI layer, which reads it (ADR-0022).
- Completed tasks are corrected the same way, which is why *move* does not need to be offered
  for them.

**Harder**
- The edit panel has to show the limit before the server refuses, not only after. That is
  screen work, and it waits for the redesign.

**To revisit**
- Whether 24 hours is the right width, once the correction is in use. The width is one
  constant.

## Action Items

1. [x] The service tells a task that has begun from one that has not, and applies the window
       and the completion bound only to the first.
2. [x] Both refusals mapped to 422 with their own sentence.
3. [x] Tests at each boundary, including that creation an hour back is still refused, and an
       integration test that a corrected range is still held by the exclusion constraint.
4. [ ] The edit panel states the limit before the server refuses (third design round).

---

## Português

**O problema.** O ADR-0012 proíbe início no passado, e o serviço aplicava a regra a toda mudança
de `start_at`. Assim, uma tarefa que começou uma hora antes do planejado não podia ser
corrigida. Excluir e recriar também não resolvia, porque recriar no passado esbarra na mesma
regra.

**A decisão.**
- **Criar no passado continua proibido.** Mover uma tarefa que ainda não começou também
  continua exigindo início no futuro.
- **Numa tarefa que já começou, concluída ou não**, o início pode ir até 24h antes de agora, ou
  para qualquer momento depois disso, inclusive o futuro.
- **Numa tarefa concluída**, a correção não pode pôr o início depois da conclusão. É a resposta
  de 2026-10-22: "começou depois de terminar" nunca é verdade, e o gatilho aceitaria em
  silêncio.
- **Cada recusa tem a sua frase**, e a sobreposição continua barrada pela exclusion constraint.

**Por que contar a janela a partir de agora**, e não do início planejado: a partir do plano, uma
tarefa que começou há 20h poderia voltar mais um dia, dois dias no passado.

**O custo aceito.** Dá para criar uma tarefa para mais tarde, esperar ela começar e puxá-la um
dia para trás, um registro retroativo pequeno. Fica limitado a um dia, e exige esperar o início
passar.
