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

## Branches and pull requests

`main` is protected: it requires a pull request and a green `API — lint, type check, test`
check. Nothing is committed to `main` directly.

Branch names use the commit types as prefixes:

```
feat/task-model
fix/env-file-discovery
docs/adr-0012-business-rules
build/multi-stage-dockerfile
```

The pull request title follows the commit convention, so the merged history reads the same as
the log: `feat(db): add domain models for user, day, task and checklist item`.

**Merge with rebase, never squash.** Squashing collapses a branch into one commit, which
destroys the atomic history this project treats as a deliverable — a four-commit branch becomes
one opaque change. Rebase keeps each commit and keeps the history linear. Enable
*Allow rebase merging* and disable *Allow squash merging* in the repository settings so the
wrong button is not there to press.

Do not enable *Require approvals* on a solo repository: GitHub refuses to let an author approve
their own pull request, so it would make every merge impossible or force an admin bypass, which
turns the rule into theatre.

## Dependencies

Declared in `requirements.in` and `requirements-dev.in`. Never edit the `.txt` files by hand —
they are generated.

```bash
cd apps/api
uv pip compile --universal --python-version 3.12 requirements.in -o requirements.txt
uv pip compile --universal --python-version 3.12 requirements-dev.in -o requirements-dev.txt
pip install -r requirements.txt -r requirements-dev.txt
```

**That command does not update versions, and the failure is silent.** `uv pip compile` reads
the existing `.txt` as a preference and keeps every pin that still satisfies the `.in`, so
rerunning it after adding a package resolves the new one and leaves the rest exactly where
they were. Run it expecting an update and you get an empty diff and no error — which reads
like "already current" and means "never asked".

Updating versions is a different command:

```bash
uv pip compile --universal --python-version 3.12 --upgrade requirements.in -o requirements.txt
uv pip compile --universal --python-version 3.12 --upgrade requirements-dev.in -o requirements-dev.txt
```

Use the plain form when the `.in` changed. Use `--upgrade` when the point is to move.

**Why uv resolves but pip installs.** Development happens on Windows; Docker and CI run Linux.
`pip-compile` resolves only for the interpreter and platform it runs on, so a lockfile
generated on Windows pins `colorama` unconditionally and omits Linux-only transitive
dependencies — the same file then produces a different environment in the container. That is
precisely the divergence a lockfile exists to prevent.

`uv pip compile --universal` emits environment markers instead, so one file is correct on both
platforms:

```
colorama==0.4.6 ; sys_platform == 'win32'
```

`--python-version 3.12` targets the version declared in `pyproject.toml` and the Dockerfile,
independently of which interpreter runs the resolver.

Installation is unchanged: plain `pip install -r`. `uv` is pinned in `requirements-dev.in`, so
it arrives with the dev dependencies and no global install is needed.

## Sprint discipline

Development is governed by [`docs/ROADMAP.md`](docs/ROADMAP.md).

- One checklist item is roughly one to three commits. If an item needs ten, it was two items.
- A `Decidir:` item is not done when the code works. It is done when the ADR is written and
  committed.
- **A checklist item is ticked in the same commit that completes it**, and only once the work
  is on `origin` — written on disk does not count. This keeps the roadmap true at every point
  in history, so `git log -p docs/ROADMAP.md` shows exactly when each item closed.
- A sprint closes with its own commit updating the sprint header status:
  `docs(roadmap): close S1`.
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
pronto quando o ADR está escrito e commitado, não quando o código funciona. **O checkbox vira
no mesmo commit que fecha o item, e só quando o trabalho está no `origin`** — escrito no disco
não conta. Assim o roadmap é verdadeiro em qualquer ponto do histórico. Sprint fecha com um
commit próprio atualizando o status no cabeçalho — `docs(roadmap): close S1`. Nenhum sprint começa antes do anterior estar no origin e verde no CI.

**Branches e pull requests:** a `main` é protegida e exige PR mais o check
`API — lint, type check, test` verde. Nome de branch usa os tipos de commit como prefixo —
`feat/task-model`, `docs/adr-0012-business-rules`. Título do PR segue a convenção de commit.

**Merge com rebase, nunca squash.** Squash colapsa a branch num commit só e destrói o histórico
atômico que este projeto trata como entregável. Desabilite *Allow squash merging* nas
configurações para o botão errado não existir.

Não habilite *Require approvals* em repositório solo: o GitHub não deixa o autor aprovar o
próprio PR, então todo merge ficaria impossível ou dependeria de bypass de admin.

**Dependências:** declaradas em `requirements.in` e `requirements-dev.in`; os `.txt` são
gerados e nunca editados à mão. O resolvedor é o `uv` em modo universal com alvo 3.12, e a
instalação continua `pip install -r`.

Por quê: você desenvolve em Windows e o runtime é Linux. O `pip-compile` resolve só para o
interpretador e o sistema em que roda, então um lockfile gerado no Windows pina `colorama` sem
condição e omite dependências transitivas que só existem no Linux — o mesmo arquivo produz
ambiente diferente no container, que é exatamente a divergência que lockfile existe para
evitar. O modo universal emite marcadores de ambiente e um arquivo só serve às duas
plataformas.

Mensagens de commit, código e comentários em inglês; este documento e o roadmap em português
porque são instrumentos de trabalho.
