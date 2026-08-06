# ADR-0005: Structured output contract and failure handling

**Status:** Accepted
**Date:** 2026-08-06
**Deciders:** Gabriel Barros

## Context

In UC2 the provider's response becomes rows in the database: a plan draft with items that,
once approved, are real tasks on the user's calendar. Free text is not an acceptable output
format — it cannot be persisted, validated, or partially rejected.

Language models are unreliable in a specific way that matters here. They are good at
decomposing a topic into steps and at naming materials. They are bad at arithmetic over a
set of constraints — "which day has room for a 45-minute block given what is already
booked". Handing them the second job produces plausible-looking assignments that violate the
calendar.

## Decision

### 1. The AI decomposes; application code schedules

The response schema **deliberately excludes day assignment**. The provider returns items
with an estimated duration and an ordering dependency; a deterministic scheduler in
application code assigns each item to a date, using the real capacity data from the
database.

This narrows the model's job to what it is good at and keeps the load-balancing logic
testable, explainable and correct.

### 2. Two validation layers, always

Provider-native structured output (tool/function calling or a JSON-schema response format)
is used, **and** the result is validated again on arrival. Native structured output
guarantees *syntax* — valid JSON conforming to the schema. It guarantees nothing about
*semantics*.

- **Layer 1 — schema.** Pydantic model. Types, required fields, enum membership, array
  bounds.
- **Layer 2 — domain invariants.** Durations positive and within a per-item maximum; total
  estimated duration within the horizon's real free capacity; item count within bounds; no
  duplicate titles; URLs well-formed; ordering dependencies acyclic and referencing existing
  items.

A schema-valid response can still claim a duration of -30 minutes, or return 47 items when
at most 12 were requested.

### 3. Schema design rules

Flat and boring. No unions, no deep nesting, explicit `maxItems` on every array, enums
instead of free strings for any field the code will branch on, descriptive field names that
carry their own documentation. Every union added is a place where the model gets creative.

### 4. The disobedience ladder

1. **Repair, once.** Send back the validation error messages plus the original request and
   ask for a corrected object. Cheap, high success rate. Stop at one — a second attempt
   rarely helps and doubles the cost.
2. **Partial salvage.** If 9 of 12 items are valid, that is a usable draft, because the user
   reviews it anyway. Surface it honestly: "9 items, 3 discarded". Partial salvage is
   permitted *only* where a human review step exists; anything that writes without review
   must be all-or-nothing.
3. **Fail visibly.** Job status `failed`, with a user-readable reason and a manual retry.
   Never persist malformed data silently; never return nothing silently.
4. **Always log the raw response**, with the prompt hash and the validation errors. This is
   how prompt regressions get debugged.

### 5. Prompt versioning from day one

Every job row and every cache key carries `prompt_version`. Changing the prompt invalidates
stale cache entries automatically and makes outputs comparable across versions. Cheap now,
painful to retrofit.

## Options Considered

### Option A: Ask for JSON in the prompt, parse what comes back

**Pros:** works with any provider; no dependency on provider-specific features.
**Cons:** the weakest guarantee available. Preambles, trailing prose, markdown fences and
trailing commas all occur. Retry rate high enough to matter for cost.

### Option B: Provider-native structured output, trusted

**Pros:** near-perfect syntactic compliance; no parsing defence needed.
**Cons:** guarantees shape, not meaning. Trusting it means domain-invalid data reaches the
database. Also couples the code to one provider's feature set, which conflicts with the
degradation requirement in ADR-0006.

### Option C: Native structured output plus independent validation — **chosen**

**Pros:** the provider handles syntax cheaply; the application owns semantics, which is
where the real risk is. Validation lives behind the `PlanGenerator` interface, so a fallback
provider without native structured output still works — it just fails validation more often
and repairs more often.
**Cons:** two layers to maintain; schema defined in two places unless the JSON schema is
generated from the Pydantic model (it should be).

### Should the AI assign days?

| | AI assigns | Code assigns (**chosen**) |
|---|---|---|
| Correctness | plausible but unverifiable | provably respects real capacity |
| Testability | requires a provider call | pure function, fixture-driven |
| Explainability to a reviewer | "the model decided" | "here is the algorithm" |
| Prompt complexity | must carry scheduling rules | carries only decomposition |

## Trade-off Analysis

The design principle running through this ADR: **give the model the smallest job it can do
well, and own everything else.** Decomposition and content are genuinely hard for code and
easy for a model. Constraint satisfaction over a calendar is the reverse. Splitting the
responsibility along that line is what separates a system from a wrapper, and it is the
answer to give when asked what the AI actually does here.

There is a secondary benefit that addresses a known portfolio gap. **The validator and the
scheduler are the most testable components in the entire project** — pure functions over
fixture JSON, with a `FakeGenerator` standing in for the provider. No network, no cost,
deterministic. Golden-file fixtures captured from real provider responses make these tests
meaningful rather than tautological. This is how an AI feature gets real automated test
coverage.

## Consequences

**Easier**
- Day assignment is provably correct and can be explained line by line.
- Meaningful, fast, free unit tests over the riskiest logic.
- Swapping providers affects one implementation of one interface.

**Harder**
- The scheduler is a real algorithm that has to be specified and tested, not a prompt.
- Two validation layers and a repair path is more code than parsing a blob.
- Golden fixtures need refreshing when the prompt version changes.

**To revisit**
- The one-repair-attempt cap, once the real invalid-response rate is measured.
- Whether partial salvage confuses users more than it helps; the review card makes it
  defensible, but that is an assumption to test.
- Scheduler sophistication: v1 is greedy first-fit respecting capacity and preferences.
  Anything smarter needs a measured reason.

## Action Items

1. [ ] Define the Pydantic response model; generate the provider JSON schema from it so
       there is a single source of truth.
2. [ ] Implement domain invariant validation separately from schema validation, returning a
       structured list of errors suitable for feeding into the repair attempt.
3. [ ] Implement the scheduler as a pure function: items plus day capacities in, assignments
       out. Unit-test the boundary cases first — insufficient capacity, zero free days,
       single oversized item.
4. [ ] Capture 5-10 real provider responses as golden fixtures, including at least two
       invalid ones.
5. [ ] Add `prompt_version` to the job model and the cache key before the first real call.

---

## Português

**Decisão central: a IA decompõe, o seu código agenda.** O schema de resposta
**deliberadamente não tem atribuição de dia** — a IA devolve itens com duração estimada e
dependência de ordem; um agendador determinístico em código atribui as datas usando a
capacidade real do banco. A IA é ruim em "qual dia tem espaço"; o banco sabe exatamente.

**Duas camadas de validação, sempre.** Structured output nativo do provedor garante
*sintaxe*, não *semântica* — um objeto válido pelo schema ainda pode dizer duração -30, data
fora da janela, ou 47 itens quando você pediu 12. Camada 1 = Pydantic. Camada 2 =
invariantes de domínio.

**Schema chato e raso:** sem união, sem aninhamento profundo, `maxItems` explícito, enum em
vez de string livre em tudo que vai virar `switch`.

**Escada de desobediência:** (1) reparo uma vez, devolvendo os erros de validação; (2)
salvamento parcial, só onde existe revisão humana; (3) falhar visível com motivo legível;
(4) sempre logar a resposta bruta.

**Gancho com a lacuna de testes:** validador e agendador são a parte mais testável do
projeto — função pura, fixture JSON, provider fake. Zero rede, zero custo. É assim que uma
feature de IA ganha teste automatizado de verdade.
