# ADR-0049: A step that waits for itself loses only that

**Status:** Accepted
**Date:** 2026-10-24
**Deciders:** Gabriel Barros

**Amends:** [ADR-0030](0030-a-plan-is-placed-in-real-free-time-reviewed-and-committed-whole.md),
which discards a step when "a dependency points at itself or later". A dependency on a later
step still discards it. **Builds on:**
[ADR-0048](0048-golden-fixtures-are-captured-by-a-script-and-labelled-by-a-person.md), whose
first batch is the evidence.

## Context

The first golden batch, twenty requests through `qwen3.5:4b`, had three answers that needed a
repair. Two of them were the same mistake: a step listing itself among its prerequisites —
"Confirmar reservas finais" waiting for steps 5 and 6, being step 6. Both times the repair
sent the mistake back, once word for word. The message was correct, "it depends on items[6],
which does not come before it", and the model did not act on it.

A dependency on itself carries no order. It is not a cycle the list could express, nor a step
promised later; it is a step waiting for itself, which says nothing the step's place does not
already say. ADR-0030 discards it for the same reason it discards a forward dependency, that
only backwards keeps cycles unwritable, but a self-reference is not a cycle once it is ignored.

Answered on 2026-10-24.

## Decision

**A dependency of a step on itself is dropped; the step and its other dependencies stay.** It
is not a reason, so it does not ask for a repair on its own and does not count as a discard.
A dependency on a later step, or on a position that does not exist, still discards the step,
as before.

The two golden fixtures that held the old rule are captured again: their answers are now kept
whole, with a label naming the dependency the validator drops.

## Options Considered

| Option | Assessment |
|---|---|
| **Drop only the self-dependency — chosen** | No step lost and no repair spent; nothing about order is given up, because a self-reference had none. |
| A reason of its own in the repair ("it depends on itself") | Bets that the model understands a clearer sentence; it did not act on a correct one twice, and the wording change would need every fixture recaptured. |
| Accept it | One step lost in six or eleven, and a repair spent that changes nothing. |

## Trade-off Analysis

**The model's mistake is no longer seen in the review.** A discarded step was listed with its
reason; a dropped self-dependency is silent. Nothing it said was true, so there is nothing for
a person to act on.

**The rule is narrower than "be lenient".** Only the one dependency with no meaning is dropped.
A forward dependency may be a real intent about order, which only a person can untangle, and
it still discards.

## Consequences

**Easier**
- Fewer repairs, and fewer steps lost to a mistake that meant nothing.

**Harder**
- The validator has one more case: a dependency that is neither kept nor a reason.

## Action Items

1. [x] The validator drops a self-dependency without a reason.
2. [x] The two fixtures recaptured and relabelled; the batch's rates measured again.

---

## Português

**O problema.** No primeiro lote de golden fixtures, dois dos três reparos foram pelo mesmo
erro: um passo dependendo de si mesmo. Nas duas vezes o reparo devolveu o erro, uma delas
palavra por palavra, embora a mensagem estivesse correta.

**A decisão.** **Dependência de um passo em si mesmo é descartada; o passo e as outras
dependências ficam.** Não vira motivo, não pede reparo e não conta como descarte. Dependência
de um passo posterior continua descartando o passo, porque pode ser uma intenção real de ordem
que só a pessoa desembaraça.

**O que se aceita.** O erro do modelo deixa de aparecer na revisão — mas ele não dizia nada em
que a pessoa pudesse agir.
