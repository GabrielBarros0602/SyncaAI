# ADR-0043: The local model is qwen3.5:4b

**Status:** Accepted
**Date:** 2026-10-24
**Deciders:** Gabriel Barros

**Amends:** decision 2 of [ADR-0039](0039-a-local-open-model-until-a-provider-is-paid-for.md),
which left the model out of the record: "which one is picked once Ollama is installed".
`OLLAMA_MODEL` stays a setting; this records the model the project is developed, measured
and fixtured with. **Builds on:**
[ADR-0040](0040-what-the-local-model-is-held-to-measured.md), whose limits both candidates
were held to, and the comparison recorded in `docs/backlog.md` on 2026-10-24.

## Context

Two open models were run on the development machine — an RTX 4060 with 8 GB, 32 GB of RAM —
through the generator ADR-0040 left, on the same six requests:

| | qwen3.5:4b | qwen3.5:9b |
|---|---|---|
| Size, quantized Q4_K_M | 3.3 GB | 6.6 GB |
| Memory with a 16,384-token context | 3.65 GB, all on the GPU | 6.7 GB, 5.6 GB on the GPU and the rest on the CPU |
| Plans | 6 of 6 | 6 of 6 |
| Repairs | 1 | 1 |
| Longest call, of the 50 s allowed | 29 s | 41 s |
| Worst job, of the claim's 120 s | 47 s | 80 s |

Neither crossed a limit ADR-0039 and ADR-0040 set. What the 9b crosses is the GPU: it does not
fit, part of it runs on the CPU, and that is why it spends most of the time it is allowed.

Answered on 2026-10-24.

## Decision

**The local model is `qwen3.5:4b`.** `.env.example` names it; golden fixtures are captured from
it and labelled with it (ADR-0039); the measurements a step up to a paid model will be judged
against are its.

The 9b is not chosen because it is slower without being better:

- **Better in one case.** Asked to organise a move, the 4b hands over the keys and inspects the
  new apartment before moving into it; the 9b keeps the order a move has.
- **Worse in another, the one that matters most.** Asked for a beginner's basic guitar chords,
  the 9b was more specific and wrong. It lists F minor, B minor and G minor, barre chords a
  beginner cannot yet play, among the basics. It gives C major a barre it does not need. It
  repeats chords from one step to the next, and splits one technique across two near-identical
  steps. The repeat cost a repair, and the plan took 80 s against the 4b's 13 s. The 4b's plan
  was vaguer, but not wrong. A vague step is read and adjusted; a specific wrong step is
  followed.
- **Close to the limit.** One call took 41 of its 50 s. A longer plan on this machine runs past
  the timeout and fails the attempt, where the 4b has room.

## Options Considered

| Option | Assessment |
|---|---|
| **qwen3.5:4b — chosen** | Fits on the GPU with the context ADR-0040 set; every measured call well inside the timeout; plans coherent, generic, sometimes mis-ordered. |
| qwen3.5:9b | Orders steps better in some plans and states wrong things more specifically in others; does not fit on an 8 GB GPU, and runs close to the timeout. |
| No model named | ADR-0039 as written. Every measurement and fixture would be against whatever model a machine happened to have. |

## Trade-off Analysis

**More detail is not more quality.** The 9b's plans read as more expert, which is what makes
its mistakes harder to see. A review that trusts a specific step is a review that misses it.

**The comparison is six requests on one machine.** It decides between two models of the same
family for this machine. It says nothing about how a hosted model would plan, which is still
unmeasured, and a machine with a larger GPU could run the 9b without the CPU and decide again.

## Consequences

**Easier**
- Measurements and fixtures are comparable, because they come from one named model.
- Every measured call kept at least 20 of its 50 seconds spare.

**Harder**
- Plans stay generic and sometimes out of order; the review exists for that.

**To revisit**
- A larger model on a machine where it fits on the GPU.
- A hosted model, when one is measured.

## Action Items

1. [x] `.env.example` names `qwen3.5:4b`.
2. [x] The 9b removed from the development machine.

---

## Português

**A decisão.** O modelo local do projeto é o `qwen3.5:4b`: é dele que saem as medições e as
golden fixtures. O `OLLAMA_MODEL` continua sendo configuração.

**Por que não o 9b.** Ele não ultrapassou os limites que definimos — a chamada mais longa usou
41 dos 50 s, e o pior pedido 80 dos 120 s — mas não cabe na GPU de 8 GB: parte roda na CPU, e
é por isso que fica perto do limite. E não é significativamente melhor:
- **Melhor num caso:** na mudança de apartamento, o 4b entrega as chaves antes de se mudar; o 9b
  segue a ordem certa.
- **Pior em outro:** nos acordes básicos de violão, o 9b foi mais específico e errado. Pôs Fá
  menor, Si menor e Sol menor — acordes com pestana, difíceis para iniciante — entre os básicos,
  pôs pestana no Dó maior, repetiu acordes entre passos e levou 80 s, contra 13 s do 4b, cujo
  plano era mais vago mas não errado. Um passo vago a pessoa ajusta; um passo específico e
  errado ela segue.

**O que se aceita.** Planos genéricos e às vezes fora de ordem, que a revisão existe para
corrigir.
