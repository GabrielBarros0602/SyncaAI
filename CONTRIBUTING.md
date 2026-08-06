# Contributing to SyncaAI

Solo project, but the conventions are enforced as if they were not. The commit history is
part of the deliverable: it should be possible to read it end to end and understand both what
the system does and why it was built that way.

## Commit convention

[Conventional Commits](https://www.conventionalcommits.org/), with the type set below.

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

| Type | Use for |
|---|---|
| `feat` | new behaviour visible to a user or an API consumer |
| `fix` | corrects broken behaviour |
| `refactor` | changes structure without changing behaviour |
| `perf` | changes behaviour only in how fast or cheap it is |
| `test` | adds or changes tests, nothing else |
| `docs` | documentation, including ADRs and the roadmap |
| `build` | Dockerfile, dependency manifests, build configuration |
| `ci` | GitHub Actions workflows |
| `style` | formatting only, zero logic change |
| `chore` | anything that fits none of the above — repository plumbing |
| `revert` | reverts a previous commit |

`build`, `ci`, `perf`, `style` and `revert` extend the original set. The distinction that
matters most in practice is `build` versus `ci`: `build` is how the artifact is produced,
`ci` is what verifies it.

### Scopes

The scope is the part of the monorepo affected. Required whenever a single area is touched.

| Scope | Area |
|---|---|
| `api` | FastAPI service, general |
| `web` | front end |
| `db` | models, migrations, queries |
| `auth` | authentication, authorization, ownership isolation |
| `ai` | context assembly, provider client, validation, scheduler, guardrails |
| `deps` | dependency manifests |
| `adr` | architecture decision records |
| `roadmap` | sprint checklist |

Omit the scope only when a change genuinely spans the repository.

### Subject line

- Imperative mood: `add`, not `added` or `adds`
- Lowercase after the colon
- No trailing period
- 72 characters maximum
- English

### Body

Optional. Use it to say **why**, not what — the diff already says what. Wrap at 80 columns.

### Footer

Reference the architecture decision a commit implements:

```
Refs: ADR-0005
```

This is the mechanism that keeps the code connected to its reasoning. Any commit
implementing a recorded decision carries the reference, so `git log --grep "ADR-0005"` shows
every change that decision produced.

Breaking changes use `!` after the scope and a footer:

```
feat(api)!: replace date field with local_date on task payloads

BREAKING CHANGE: clients sending "date" must send "local_date" instead.
```

### Examples

```
feat(ai): add plan draft schema with domain invariant validation

The provider guarantees syntax through native structured output but not
semantics, so durations, item counts and horizon bounds are checked
separately before anything reaches the database.

Refs: ADR-0005
```

```
build(deps): pin api dependencies with pip-compile
test(db): add capacity query integration tests against real postgres
ci: run ruff, mypy and pytest on push and pull request
docs(adr): record time block representation decision
fix(auth): filter tasks by owner in the repository layer
```

### Anti-patterns

- `wip`, `update files`, `changes`, `fix stuff` — say what changed
- One commit mixing a refactor with a feature — split it; the refactor goes first
- A commit that leaves the test suite red
- A single commit containing a whole sprint

## Sprint discipline

Development is governed by [`docs/ROADMAP.md`](docs/ROADMAP.md).

- One checklist item is roughly one to three commits. If an item needs ten, it was two items.
- A `Decidir:` item is not done when the code works. It is done when the ADR is written and
  committed.
- A sprint closes with its own commit flipping the checkboxes:
  `docs(roadmap): close S1`. The log then narrates sprint progression on its own.
- No sprint starts before the previous one is pushed and green in CI.

## Before every commit

```bash
cd apps/api
ruff format .
ruff check . && mypy && pytest
```

CI runs `ruff format --check`, so unformatted code fails the build rather than being fixed
silently.

---

## Português

**Convenção de commits:** Conventional Commits com o conjunto de tipos acima. A base original
(`feat`, `fix`, `chore`, `docs`, `test`, `refactor`) foi ampliada com `build`, `ci`, `perf`,
`style` e `revert`. A distinção que mais importa na prática é `build` contra `ci`: `build` é
como o artefato é produzido, `ci` é o que o verifica.

**Escopos** foram adicionados porque isto é um monorepo — `api`, `web`, `db`, `auth`, `ai`,
`deps`, `adr`, `roadmap`. Sem escopo só quando a mudança atravessa o repositório todo.

**Rodapé `Refs: ADR-0005`** em todo commit que implementa uma decisão registrada. É o
mecanismo que mantém o código ligado ao raciocínio: `git log --grep "ADR-0005"` mostra tudo
que aquela decisão produziu. Serve diretamente ao objetivo de conseguir explicar o projeto
inteiro depois.

**Disciplina de sprint:** um item de checklist são um a três commits. Item `Decidir:` só está
pronto quando o ADR está escrito e commitado, não quando o código funciona. Sprint fecha com
um commit próprio virando os checkboxes — `docs(roadmap): close S1` — e assim o log narra a
progressão sozinho. Nenhum sprint começa antes do anterior estar no origin e verde no CI.

Mensagens de commit, código e comentários em inglês; este documento e o roadmap em português
porque são instrumentos de trabalho.
