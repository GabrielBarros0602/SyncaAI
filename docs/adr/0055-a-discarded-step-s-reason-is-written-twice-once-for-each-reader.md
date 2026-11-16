# ADR-0055: A discarded step's reason is written twice, once for each reader

**Status:** Accepted
**Date:** 2026-11-16
**Deciders:** Gabriel Barros

**Amends:** [ADR-0037](0037-a-draft-in-five-tables-and-only-an-approved-one-stays.md), whose
`plan_draft_discards` keeps a step's reasons: they are now the sentences a person reads, not
the lines the repair sent. **Builds on:**
[ADR-0035](0035-repair-whenever-a-step-fails-and-keep-the-better-answer.md), whose repair
lines do not change by a character, and
[ADR-0052](0052-the-third-design-round-is-the-specification-and-the-front-end-opens.md), whose
plan screen prints the reasons.

## Context

The validator writes why a step failed for the repair: lower case, no full stop, and numbered
from zero, because that is how the model numbers what it wrote. `items[6]: it depends on
items[8], which does not come before it`. The draft stored the same strings, and the review
the third design round draws prints them under "Step 7".

Checking that screen against the server found the first problem: `items[8]` shown to somebody
who only sees step numbers (`docs/backlog.md`, "Aberto pela conferência dos passos 4 e 6").
Reading the validator for it found the rest. `link 0` counts from zero as well, where the round
draws "Link 1". And the round draws every reason as a sentence, "The title repeats an earlier
step's.", where the server holds a fragment made to follow `items[6]: `.

Two facts narrow what can be done about it.

**The repair's wording is part of the prompt.** ADR-0035 pins it to `PROMPT_VERSION`, and the
golden fixtures of ADR-0048 are labelled against the validator's lines. Rewording what the
model reads is a change of prompt, with a recapture, to fix something the model never
complained about.

**The review and the answer do not number steps alike.** The API keeps each step's position in
the answer, with a gap wherever a step was discarded. The round numbers the steps it kept by
their order on the screen, and the discarded ones by their position in the answer. With a
discard in the middle, nine steps and the fourth one dropped, the screen has a kept "step 4"
and a discarded "Step 4". The round's own example hides this, because its three discards are
the last three. The model can also point at a position nothing holds: `items[12]` of twelve.

Answered on 2026-11-14 (the sentence) and 2026-11-16 (every reason, not only this one).

## Decision

**Every reason is written twice where it is found: a line for the model and a sentence for the
person.** The model's lines are the ones it has always been sent. The draft stores the
person's sentences, and the review prints them as they are. The lines the model was sent stay
where ADR-0035 put them, on the job's answers.

A person's sentence:

- starts with a capital and ends with a full stop;
- counts links from one: `link 0: the label is empty` is "Link 1: the label is empty.";
- names no step by number. A dependency on a later step, or on one that does not exist, reads
  **"It depends on a step that does not come before it."**, once, however many such
  dependencies the step has.

Drafts made before this keep the text they have. Nothing is deployed, so the only ones are on
a developer's machine, and no migration rewrites them.

## Options Considered

| Option | Assessment |
|---|---|
| **Two texts, written together — chosen** | The model reads what it read; the person reads a sentence. Each reason has two texts to keep true. |
| One sentence for both readers | One line of code. The model loses the position it is asked to correct, and the repair's wording moves: a new `PROMPT_VERSION` and a recapture, to tell the model less. |
| The browser rewrites the stored line | Nothing moves on the server. The sentence would be defined in two places, and a reason added later would be shown raw until somebody noticed. |
| Name the step: "It depends on step 7, which does not come before it." | Says more when it is right. Right only if the review numbers every step by its position in the answer plus one, which the round does not; and it says "step 13" of twelve. |

## Trade-off Analysis

**The person is told less than the model.** Not which step. A discarded step cannot be edited:
the review says it will not become a task and offers to add one by hand. Which later step it
waited for changes nothing the person can do, and a wrong number would send them to look at a
step that had nothing to do with it.

**Two texts can drift.** A reason added with only the model's line gets its sentence made from
that line, so the default cannot disagree with it. One that numbers something has to give its
sentence, and a test holds every sentence to the form above.

## Consequences

**Easier**
- The plan screen prints what the server stores, with nothing to parse.
- The model's side is untouched: the same prompt version, the same fixtures.

**Harder**
- A new reason is two decisions: what the model is told, and what the person is shown.

**Open**
- How the review numbers steps is a question for S8 (`docs/backlog.md`). If it comes to number
  them by their position in the answer, a number can come back to this sentence, in a new
  record.

## Action Items

1. [x] The validator writes both, and the draft stores the person's sentences.
2. [x] Tests hold the model's lines as they were and the person's sentences to their form.
3. [ ] S8 decides how the review numbers the steps it kept and the ones it discarded.

---

## Português

**O problema.** O validador escreve o motivo de um descarte para o reparo: minúscula, sem
ponto e contando do zero, como o modelo numera (`items[6]`, `link 0`). O rascunho guardava o
mesmo texto, e a revisão da terceira rodada o imprime embaixo de "Step 7". A pessoa veria
`items[8]` sem nunca ter visto essa numeração.

**O que limita a solução.** A redação do reparo faz parte do prompt (ADR-0035) e as golden
fixtures são rotuladas contra as linhas do validador (ADR-0048). E a revisão não numera como a
resposta: a API guarda a posição na resposta, com buracos; o desenho numera os mantidos pela
ordem na tela e os descartados pela posição na resposta. Com um descarte no meio, a tela tem
um "step 4" mantido e um "Step 4" descartado.

**A decisão.** **Cada motivo é escrito duas vezes onde é achado: uma linha para o modelo e uma
frase para a pessoa.** As linhas do modelo não mudam. O rascunho guarda as frases da pessoa,
que começam com maiúscula, terminam com ponto, contam os links a partir de um e não citam
passo por número. Depender de um passo posterior, ou de um que não existe, vira **"It depends
on a step that does not come before it."**, uma vez só.

**O que se aceita.** A pessoa sabe menos que o modelo: não sabe qual passo. Ela não pode
editar um passo descartado, e um número errado a mandaria olhar o passo errado. Cada motivo
novo passa a ter dois textos para manter verdadeiros.

**O que fica aberto.** Como a revisão numera os passos é pergunta do S8.
