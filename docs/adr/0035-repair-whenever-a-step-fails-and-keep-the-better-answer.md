# ADR-0035: Repair whenever a step fails, and keep the better of the two answers

**Status:** Accepted
**Date:** 2026-10-23
**Deciders:** Gabriel Barros

**Amends:** decision 4 of [ADR-0005](0005-structured-output-contract.md), the disobedience
ladder, in two places it left open. Its order (repair once, salvage, fail visibly, log the raw
response) stands.

## Context

ADR-0005 says to repair "if invalid", once, then salvage what is valid, then fail visibly. It
was written before [ADR-0030](0030-a-plan-is-placed-in-real-free-time-reviewed-and-committed-whole.md)
made the domain check per item. Read together, they leave two questions open.

**What counts as invalid.** A response can fail the schema and not be a plan at all. Or it can
be a plan in which some steps fail: a repeated title, more minutes than the person's block, a
step that depends on itself. Salvage alone would keep the rest of such a plan, so a repair is
not strictly needed to have a draft.

**What happens when the repair is worse.** The repair is a second answer, and nothing makes it
better than the first. It can keep fewer steps, or not be a plan at all.

Both answers matter for S7, where each call costs money. Here they set the order the pipeline
runs in. Answered on 2026-10-23 with this scenario: a request to learn SQL in two weeks comes
back with twelve steps, three of them invalid.

## Decision

### 1. Any failure asks for the one repair

The pipeline repairs when the first answer is not a plan, **and** when any step of it is
discarded. This is ADR-0005's order taken literally: repair first, then salvage what the repair
left. A repeated title or a step past the block is the kind of error a model corrects most
reliably once it is named.

A first answer with nothing discarded is used as it is, with one call.

### 2. What the repair carries

- The first answer, verbatim, as the model's own previous turn.
- One line per error, addressed by position as the model addresses steps in `depends_on`:
  `items[6]: the title repeats an earlier step's`. A schema failure is reported the same way,
  by the path that failed.
- An instruction to send the whole plan again, keeping the steps that were right as they were.

**At most thirty error lines are sent,** then one line saying how many more there were. A
garbled answer can fail the schema hundreds of times. Without a cap, the repair's input would
have no worst case, and ADR-0006 estimates spend before a call from exactly that.

The repair's wording is part of the prompt. The same test that pins the instructions to
`PROMPT_VERSION` (ADR-0034) pins it too.

### 3. The better of the two answers is kept

| First answer | Repair | Draft built from |
|---|---|---|
| 9 of 12 steps kept | 12 of 12 | the repair |
| 9 of 12 | 7 of 12 | the first |
| 9 of 12 | not a plan | the first |
| 9 of 12 | 9 of 12 | the repair: a tie goes to the attempt that set out to correct |
| not a plan | 10 of 12 | the repair |
| not a plan, or nothing kept | not a plan, or nothing kept | nothing: the job fails visibly |

"Better" is the number of steps kept, and nothing else. It is the quantity the person sees in
the review ("9 items, 3 discarded").

The draft records which answer it was built from, and, as ADR-0030 already requires, every step
it discarded with its reasons.

### 4. Every attempt is kept on the job

Both raw answers, each one's errors, and which one was used stay on the job, under ADR-0031's
thirty days. ADR-0005 asked for the raw response to be logged. With two answers there are two,
and a regression in the repair's wording only shows if both are there.

### 5. The interface the ladder runs against

`PlanGenerator.generate(prompt, repair=None)` returns the raw text, the model's name and the
tokens in and out. The usage fields exist now, although the test double reports zeros. That
way S7 adds a client and leaves the interface alone (ADR-0003). `FakeGenerator` answers from a
script and records every call, so a test can assert what the repair carried, and that no third
call was ever made.

## Options Considered

### When to repair

| Option | Assessment |
|---|---|
| **Whenever a step is discarded — chosen** | Twelve of twelve in the scenario, at the cost of a second call only when the first answer was imperfect. |
| Only when nothing usable is left | One call, a draft of 9 with 3 discarded, and the person writes the missing steps by hand, in a case one cheap call would usually fix. |
| Above a share of discards | A threshold to justify and test. Three of twelve would not repair and four would: the same quality of answer, two behaviours, one step apart. |

### When the repair is worse

| Option | Assessment |
|---|---|
| **The better of the two — chosen** | The person never gets less than the first call had already achieved. Costs one rule of choice, tested at its edges. |
| Always the repair, if it is a plan | "The last valid answer wins" is easier to say, and it can deliver 7 steps when 9 were in hand. |
| Only the repair, failing if it fails | ADR-0005 at its most literal. It throws away a usable draft and makes the person ask again: one more call, and the 9 steps lost. |

## Trade-off Analysis

**The worst case is two calls, and it was already two.** Every option repairs a response that
is not a plan, so the pre-call estimate of ADR-0006 always has to budget for a second call. The
choice moves the average cost, not the ceiling.

**Choosing between answers is not merging them.** Taking the first answer's good steps and the
repair's corrected ones would keep more, but the two lists number their steps independently, and
the dependencies of one mean nothing in the other. Choosing a whole answer keeps every
`depends_on` meaningful.

## Consequences

**Easier**
- A draft is as complete as one correction can make it, and never less complete than the first
  answer was.
- A failed repair costs the person nothing they already had.

**Harder**
- Imperfect answers take two calls and a few more seconds.
- The job keeps two raw answers instead of one.

**To revisit**
- In S7, with real answers: how often a repair is needed, and how often it wins. If repairs
  rarely help, the trigger narrows through a new record. The golden fixtures ADR-0005 asks for are
  where to measure it.

## Action Items

1. [ ] `PlanGenerator`, `Generation` and `Repair`; `FakeGenerator` scripted, recording calls.
2. [ ] The ladder: check, repair on any failure, keep the better, fail visibly when nothing is
       kept.
3. [ ] The repair's wording, pinned with the prompt; error lines capped at thirty.
4. [ ] Both attempts and the choice stored on the job, when the job table exists (ADR-0031).

---

## Português

**O problema.** A ADR-0005 manda reparar "se inválido", uma vez, e depois aproveitar o que
der. Com a validação por item da ADR-0030, ficou em aberto o que conta como inválido, e o que
fazer quando o reparo vem pior que a primeira resposta.

**A decisão.**
- **Qualquer falha pede o reparo:** resposta que não é plano, ou qualquer item descartado. Uma
  resposta sem descarte é usada direto, com uma chamada só.
- **O reparo leva a primeira resposta, uma linha por erro e o pedido de mandar o plano
  inteiro de novo, mantendo os passos certos.** São no máximo 30 linhas de erro, para que o
  custo do reparo tenha teto. O texto do reparo é fixado na mesma versão do prompt.
- **Fica a melhor das duas, medida em itens mantidos.** Empate vai para o reparo. Se nenhuma
  das duas mantém um item, o job falha de forma visível.
- **As duas respostas brutas, os erros de cada uma e a escolha ficam no job,** pelos 30 dias
  da ADR-0031.

**O que se aceita.** Resposta imperfeita custa duas chamadas. O teto já era de duas, porque
toda opção repara quando a resposta nem é plano.
