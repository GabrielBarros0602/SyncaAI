# ADR-0048: Golden fixtures are captured by a script and labelled by a person

**Status:** Accepted
**Date:** 2026-10-24
**Deciders:** Gabriel Barros

**Builds on:** [ADR-0005](0005-structured-output-contract.md), which asked for five to ten
real answers as golden fixtures, at least two of them invalid, refreshed when the prompt
changes, so that the validator's and the scheduler's tests are "meaningful rather than
tautological"; [ADR-0039](0039-a-local-open-model-until-a-provider-is-paid-for.md) and
[ADR-0043](0043-the-local-model-is-qwen3-5-4b.md), which name the model they come from and ask
for each to carry its name; and [ADR-0035](0035-repair-whenever-a-step-fails-and-keep-the-better-answer.md),
which names them as where a repair's worth is measured. Supersedes nothing.

## Context

Every test of the ladder, the validator and the scheduler so far runs on answers written by
hand, which are only as varied as whoever wrote them. A model writes things nobody types: a
relative URL, a ten-minute step under the floor, a title repeated two steps later. ADR-0005
settled how many fixtures and what they are for; it left open how they are made, where the
invalid ones come from, what a test of one asserts, and what happens to one when the prompt
moves on.

ADR-0031 keeps every raw answer on its job for thirty days so S7 can build fixtures from them,
but those are answers to a person's own request, which do not belong in a repository.

Answered on 2026-10-24.

## Decision

### 1. A versioned script captures them, from synthetic requests

`scripts/capture_golden.py` sends twenty requests — written for it, in both languages, for a
week and for two, with several block lengths — against a synthetic week through the real
generator and the ladder, exactly as a job would. Each request becomes a file with the request,
the week, every answer, and what produced it: the model, the Ollama version, the generator's
settings, the prompt version and a digest of the prompt. Nothing a person wrote is captured.

### 2. The invalid ones are captured, not provoked

The batch is captured until it holds at least two invalid answers, as they come. With the
generator of ADR-0040 about one plan in six needs a repair, so twenty requests are expected to
hold several. The batch's repair and discard rates are printed as it ends: the measurement
ADR-0035 and ADR-0039 wait for, taken from the same run.

### 3. A person labels each one, and the test holds the code to the label

Between five and ten files are kept in `tests/golden`, all the invalid ones among them, and
each gets a `label`: for every answer, whether it parses, which steps are discarded and a few
words of the reason; which answer is chosen; and a note on why. The labels are written by
whoever captures and reviewed in the pull request, like any other claim.

The test replays the answers through the ladder with no model and asserts that the validator
agrees with the label, and that the plan kept is placed where a plan may be: inside free time,
with no two steps overlapping, after the steps it depends on, and after now. It never
snapshots the output.

### 4. A fixture fails once the prompt it came from is gone

Each fixture's prompt is rebuilt from its request and week by the code as it is, and compared
with the digest captured. A change to the prompt, which already needs a new `PROMPT_VERSION`,
fails every fixture until they are captured again, in the same pull request.

## Options Considered

### How they are captured

| Option | Assessment |
|---|---|
| **A script, synthetic requests — chosen** | Reproducible; nothing personal in the repository; run again with any change of prompt or model. |
| Copied from jobs in a development database | Quick; not reproducible, and a real request has no place in the repository. |

### The invalid ones

| Option | Assessment |
|---|---|
| **Captured as they come — chosen** | Real failures, and the same batch measures how often they happen. |
| Provoked: a short answer cap, the schema note removed | Real text, a failure chosen in advance; the fixture would have to say so. |

### What a test asserts

| Option | Assessment |
|---|---|
| **A person's label, and properties of the placement — chosen** | The validator is held to a judgement about a real answer, not to what it already did. |
| A snapshot of the output | Breaks on every legitimate change and asserts only that the code still does what it did. |
| That nothing raises | Proves almost nothing. |

### A changed prompt

| Option | Assessment |
|---|---|
| **The fixture fails until recaptured — chosen** | ADR-0005's "refreshed when the prompt changes", enforced. |
| Skipped with a warning | Comfortable, and fixtures age without anyone noticing. |

## Trade-off Analysis

**A label is a claim like any other.** It is written by whoever captures and can be wrong. It
is reviewed where every other claim is, in the pull request, and the test makes a wrong label
visible the moment the validator disagrees with it.

**A changed prompt costs a recapture.** About five minutes of the local model, in the pull
request that changes the prompt. That is the price of fixtures that describe the prompt in use.

## Consequences

**Easier**
- The validator and the scheduler are tested on what a model actually writes.
- A change of prompt or model carries its own evidence: a recaptured batch and its rates.

**Harder**
- Changing the prompt needs Ollama and the model on the machine that changes it.

**To revisit**
- Fixtures from the paid model, when one is paid for (ADR-0039), labelled with its name beside
  these.

## Action Items

1. [x] `scripts/capture_golden.py`.
2. [x] The first batch, its rates, and between five and ten labelled fixtures.
3. [x] `tests/test_golden.py`: the prompt, the label, the placement.

---

## Português

**O problema.** Os testes da escada, do validador e do agendador rodam com respostas escritas
à mão, tão variadas quanto quem as escreveu. Um modelo escreve coisas que ninguém digita. A
ADR-0005 já decidiu quantas fixtures e para quê; faltava como fazê-las, de onde vêm as
inválidas, o que o teste afirma e o que acontece quando o prompt muda.

**A decisão.**
- **Um script versionado captura,** com pedidos sintéticos contra uma semana sintética, pelo
  gerador real e pela escada; cada arquivo guarda modelo, versão do Ollama, ajustes do gerador,
  versão e digest do prompt. Nada pessoal entra no repositório.
- **As inválidas são capturadas como vierem,** e o mesmo lote mede as taxas de reparo e
  descarte.
- **Uma pessoa rotula cada fixture,** e o teste exige que o validador concorde com o rótulo e
  que o plano mantido caia em tempo livre, sem sobreposição, depois das dependências e depois
  de agora. Nunca um snapshot.
- **Prompt mudou, fixture falha** até ser recapturada, na mesma PR.

**O que se aceita.** O rótulo pode estar errado, e é revisado na PR como qualquer afirmação; e
mudar o prompt passa a exigir o Ollama na máquina de quem muda.
