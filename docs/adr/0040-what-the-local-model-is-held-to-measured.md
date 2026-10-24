# ADR-0040: What the local model is held to, measured

**Status:** Accepted
**Date:** 2026-10-24
**Deciders:** Gabriel Barros

**Amends:** decision 2 of [ADR-0039](0039-a-local-open-model-until-a-provider-is-paid-for.md),
which put an open model behind `PlanGenerator` through Ollama and left one claim unverified:
a real answer from a real model. **Builds on:**
[ADR-0031](0031-a-job-queue-in-postgresql-woken-by-notify.md), whose 120-second claim bounds a
job's calls; [ADR-0035](0035-repair-whenever-a-step-fails-and-keep-the-better-answer.md), whose
repair is the longest conversation a job sends; and row 22 of `docs/threat-model.md`.
Supersedes nothing.

## Context

The local generator merged before any model ran against it. Ollama was installed on the
development machine on 2026-10-24 (version 0.40.10, an RTX 4060 with 8 GB, 32 GB of RAM) and
`qwen3.5:4b` was pulled: 4.2 billion parameters, Q4_K_M, 3.3 GB, held entirely on the GPU.
Six requests, four in Portuguese and two in English, were sent over seven days of free time
through `OllamaGenerator` exactly as merged, then with one setting changed at a time.

| | first answer usable | repaired | longest call | worst job |
|---|---|---|---|---|
| as merged | 0 of 6 | — | 50 s, timed out | — |
| `think: false` | 4 of 6 | 2 | 24 s | 46 s |
| `think: false`, schema in the instructions | 6 of 6 | 0 | 19 s | 19 s |
| as decided below, all four together | 5 of 6 | 1 | 29 s, 6 s of it loading | 47 s |

The last row is the generator this record leaves. Its one repair was a ten-minute step under
the fifteen-minute floor, and the repaired plan kept all twelve steps.

Four findings came out of those runs.

1. **The model reasons first, by default.** Ollama reports `thinking.default: true` for it,
   and the generator did not say otherwise. Every call spent its fifty seconds producing about
   2,700 tokens of reasoning and no answer.
2. **The context Ollama opens is sized from the GPU.** On 8 GB it is 4096 tokens. A repair
   built at the contract's limits, 4,102 tokens long, was read as 3,724, and its answer stopped
   at 372 tokens with `done_reason: "length"`. No error was returned; the ladder saw cut-off
   JSON and read it as the model's fault. With 16,384 tokens the same repair was read whole.
3. **`format` holds the shape and hides the descriptions.** The schema's field descriptions
   say a link is an absolute URL; the model never saw them. Two of six plans came back with
   links such as `/verificar-espaço-novo` and `#start`, so every step was discarded and only
   the repair saved the plan.
4. **A cloud model answers at the local address.** Asked for `gemma4:cloud`, the local server
   described a 32-billion-parameter model it does not hold: Ollama runs it on its own servers.
   `OLLAMA_MODEL` set to that name would send the prompt off the machine, which ADR-0039 says
   never happens. Ollama's own documentation adds that its cloud has no structured output.

Six requests are a small sample. The numbers decide between options here; they set no
threshold for judging a model.

Decided on 2026-10-24.

## Decision

### 1. Every call asks for no reasoning

`think: false` is sent on every call. Ollama's documentation gives `false` as the one value a
model without reasoning reports, so the setting is valid for such a model too. A model that
does not let reasoning be turned off would still time out; the first measurement of such a
model would show it.

### 2. The context and the answer are both bounded, and a test holds the relation

Every call sends `num_ctx` of 16,384 and `num_predict` of 4,096. A test builds the longest
conversation a job can send — a 500-character request in a script that costs a token per
byte, fourteen days of context, a first answer as long as `num_predict` allows, the longest
correction the code writes — and holds it, with room for the second answer, inside
`num_ctx`. It uses 13,491 of the 16,384 tokens.

On this machine the timeout ends a long answer first: between about 35 and 48 tokens a second
were measured, so fifty seconds hold under 2,500. `num_predict` is what bounds the answer on a
faster GPU, where fifty seconds would hold more than the context has room for.

### 3. The schema is shown to the model, by this generator only

`OllamaGenerator` appends the response schema to the instructions it sends. Providers with
native structured output show the model the schema themselves; here the generator does what
the provider would. The instructions are unchanged, so the prompt stays at `plan-1`, and a paid
provider will not be sent the schema twice.

### 4. A cloud model name is refused at boot

`AI_PROVIDER=ollama` with an `OLLAMA_MODEL` whose tag ends in `cloud` — `gemma4:cloud`,
`gpt-oss:120b-cloud` — is refused when the settings load, as a missing model already is.
`.env.example` documents `OLLAMA_NO_CLOUD=1`, set where Ollama runs, as the switch that makes
Ollama refuse every cloud model itself. The check rests on Ollama's naming, so it is the
switch, not the check, that holds if the naming changes.

## Options Considered

### Reasoning

| Option | Assessment |
|---|---|
| **Off on every call — chosen** | Measured: from no plan in six to six in six, calls of 8 to 24 seconds. A model that forbids turning it off still times out. |
| A setting, off by default | Would let reasoning be tried on a faster machine. On this one the setting has a value known to break every job. |
| On, with a longer timeout | Reasoning had not finished after fifty seconds. Two calls would no longer fit the 120-second claim of ADR-0031, and the queue would be held for minutes per request. |

### Context

| Option | Assessment |
|---|---|
| **Fixed `num_ctx` and `num_predict`, held by a test — chosen** | The longest repair is never cut silently, on any GPU. Costs memory: with 16,384 tokens the model takes 3.65 GB, all of it on this GPU. |
| `num_ctx` as a setting | Fits each machine, and a low value brings the silent cut back. |
| Keep 4096 and treat `done_reason: "length"` as an error | Catches the answer that is cut, not the input that is: the 3,724 of 4,102 tokens came back without a sign. |

### The schema in the prompt

| Option | Assessment |
|---|---|
| **Appended by this generator only — chosen** | Measured: repairs from two in six to none. The prompt grows from about 650 tokens to about 1,165. |
| In the instructions for every generator, as `plan-2` | One prompt for all, and a paid provider would be sent the schema twice and charged for it on every call. |
| Unchanged | The repair recovers, and the repair rate ADR-0039 reads a model by would count against the model what the generator hid from it. |

### Cloud model names

| Option | Assessment |
|---|---|
| **Refused at boot, and Ollama's own switch documented — chosen** | A name copied from Ollama's quickstart stops the worker with a reason instead of sending the prompt away. Rests on the naming, which the switch does not. |
| The switch documented only | No code, and it holds only if whoever configures the machine remembers it. |
| Ask the server at boot whether the model is remote | `/api/show` documents no such field; it would be fragile and put a network call in boot. |
| Accept it | The cloud lacks structured output and would likely fail, but the prompt has left before the call fails. |

## Trade-off Analysis

**What was measured is one model on one machine.** The settings are the generator's, so a
different model meets them unchanged; what changes with it is whether reasoning can be turned
off and how fast it answers, and both show in the first run of it.

**Appending the schema makes what the model sees depend on the generator.** That is already
true of a provider's structured output, which shapes its model's input in ways the request does
not show. The cost is that the prompt's version no longer names everything the model read.

## Consequences

**Easier**
- The local model answers: six requests became six plans, one after a repair, the slowest
  in 47 s for both calls.
- Row 22 of the threat model holds again: no setting sends the prompt off the machine.

**Harder**
- Every call carries about 500 more tokens of schema.
- The context costs memory a smaller GPU might not have; a model that does not fit shows it as
  a slow first call.

**To revisit**
- The cache of ADR-0006 keys on `prompt_version` and the context fingerprint. The schema note
  is outside both, so whether the model and the generator belong in that key is for S7 to
  decide when the cache is built.
- A model that forbids turning reasoning off, if one is ever wanted.
- The slowest call measured used 29 of its 50 seconds. A longer plan on this machine reaches
  the timeout, and a call that times out fails the attempt instead of returning what it had
  written; the golden fixtures of S7 will show how often that happens.

## Action Items

1. [x] `think: false`, `num_ctx` and `num_predict` on every call, with the test of the longest
       repair.
2. [x] The schema appended to the instructions by `OllamaGenerator`.
3. [x] A cloud model name refused at boot; `OLLAMA_NO_CLOUD` documented in `.env.example`.
4. [x] Row 22 of `docs/threat-model.md` says the way out is closed.

---

## Português

**O problema.** O gerador local foi mesclado sem rodar contra um modelo real. Medido em
2026-10-24 com o `qwen3.5:4b` numa RTX 4060 de 8 GB, ele não respondeu a nenhum dos seis
pedidos. Saíram quatro achados:
- o modelo pensa por padrão e gastava os 50 s pensando;
- o contexto padrão de 4096 tokens cortava um reparo longo sem avisar;
- o `format` impõe a forma, mas o modelo não via as descrições do schema;
- um nome de modelo de nuvem (`gemma4:cloud`) passa pelo mesmo `localhost` e manda o prompt
  para os servidores do Ollama.

**A decisão.**
- **`think: false`** em toda chamada.
- **`num_ctx` de 16.384 e `num_predict` de 4.096,** com um teste que mantém o pior reparo
  dentro do contexto.
- **O schema anexado às instruções,** só neste gerador. O `plan-1` não muda, e um provedor
  pago não recebe o schema duas vezes.
- **Nome de modelo de nuvem recusado no boot.** O `OLLAMA_NO_CLOUD=1` fica documentado como a
  trava do próprio Ollama.

**Medido depois, com as quatro juntas:** seis planos em seis pedidos, um deles depois de um
reparo, e o pior pedido em 47 s somando as duas chamadas.

**O que se aceita.** Uns 500 tokens a mais por chamada, um contexto que custa memória, e uma
recusa que depende da convenção de nomes do Ollama, por isso a trava do próprio Ollama é a que
vale.
