# SyncaAI

**Personal operations dashboard with a calendar-aware AI layer — turns a goal into scheduled,
trackable tasks using your week's real free capacity.**

SyncaAI is not a calendar app with a chat window attached. The AI layer reads the aggregate
free capacity of your week, decomposes a goal into concrete items, and a deterministic
scheduler places those items on the days that actually have room. The output is reviewable
data in the product's own vocabulary, never a block of text to copy by hand.

> **Status:** in development. Accounts, sessions, the calendar domain and the day-capacity
> query work. The AI layer does not exist yet — which is deliberate: ADR-0006 requires a
> product that still functions when the provider is down, and that is easier to verify now
> than after there is something to degrade from. See the roadmap below.

## Why this is not CRUD

A calendar with checklists is CRUD. What makes this a systems project is the AI layer, and
six problems inside it that are addressed explicitly in the architecture:

| Problem | Where it is decided |
|---|---|
| The provider key must never reach the browser | [ADR-0001](docs/adr/0001-backend-stack.md) |
| Context assembly — what enters the prompt, token budget, privacy | [ADR-0004](docs/adr/0004-context-assembly-policy.md) |
| Structured output that becomes database records, with validation | [ADR-0005](docs/adr/0005-structured-output-contract.md) |
| Latency — block, stream, or enqueue | [ADR-0003](docs/adr/0003-ai-request-lifecycle.md) |
| Cost and abuse — rate limits, spend cap, cache | [ADR-0006](docs/adr/0006-cost-limits-cache-degradation.md) |
| Degradation — the provider will go down | [ADR-0006](docs/adr/0006-cost-limits-cache-degradation.md) |

Two design decisions carry most of the weight:

- **The AI decomposes; application code schedules.** The response schema has no date field.
  A model is bad at "which day has room"; the database knows exactly. This keeps the
  scheduling logic deterministic, testable and explainable.
- **AI output is a proposal, not a fact.** Generated plans land as a reviewable draft.
  Nothing is written to the calendar until the user approves it.

## Stack

| Layer | Choice |
|---|---|
| API | Python 3.12, FastAPI, Pydantic |
| Database | PostgreSQL 16, SQLAlchemy, Alembic |
| Passwords | argon2id, memory-hard ([ADR-0014](docs/adr/0014-password-hashing-with-argon2id.md)) |
| Sessions | short-lived JWT plus a revocable opaque refresh token ([ADR-0015](docs/adr/0015-session-model.md)) |
| Mail | one interface, console and recording implementations ([ADR-0018](docs/adr/0018-email-delivery.md)) |
| Dependencies | pip, with `uv` as the resolver ([why](CONTRIBUTING.md#dependencies)) |
| Web | Vite, React 19, TypeScript strict ([ADR-0021](docs/adr/0021-browser-session-and-origin.md)) |
| Quality | ruff, mypy (strict), pytest; eslint, tsc, vitest |
| Runtime | Docker Compose |

Planned but not built: the job queue on PostgreSQL with `SELECT ... FOR UPDATE SKIP LOCKED`
([ADR-0003](docs/adr/0003-ai-request-lifecycle.md)), and the AI layer it carries.

Stack rationale, including the estimated cost of the alternative, is in
[ADR-0001](docs/adr/0001-backend-stack.md).

## Repository layout

```
.
├── apps/
│   ├── api/                  FastAPI service
│   └── web/                  Vite + React + TypeScript client
├── docs/
│   ├── adr/                  architecture decision records
│   ├── prototype/            the original static mockup, kept as a visual reference
│   ├── ROADMAP.md            sprint checklist and open questions
│   └── threat-model.md       assets, attackers, what is and is not mitigated
├── .github/                  CI, dependency scanning, pull request template
└── docker-compose.yml
```

## What the API does today

| Endpoint | |
|---|---|
| `POST /api/v1/auth/register` | Answers `202` identically whether or not the address has an account. Which of the two happened is visible only to whoever reads the mailbox ([ADR-0019](docs/adr/0019-account-verification.md)). |
| `POST /api/v1/auth/verify` | Spends a single-use confirmation token. A `POST`, not a link, because mail scanners follow links and would spend it first. |
| `POST /api/v1/auth/resend-verification` | Another link, rate limited more tightly than login. |
| `POST /api/v1/auth/login` | Returns an access token, and a refresh token by cookie or body depending on the client ([ADR-0017](docs/adr/0017-refresh-token-delivery.md)). Refuses an unverified account. |
| `POST /api/v1/auth/refresh` | Exchanges a live session for a new access token. |
| `POST /api/v1/auth/logout` | Revokes the session presented. |
| `POST /api/v1/auth/forgot-password` | Answers `202` identically whether or not there is an account. |
| `POST /api/v1/auth/reset-password` | Sets a new password and signs every device out. |
| `GET /api/v1/me` | The signed-in user, including the **time zone the server stores**. Every local date a client sends is read in that zone, not the browser's, and the two can differ. |
| `POST /api/v1/tasks` | Schedules a block of time with an optional checklist and tag. Overlapping an existing task answers `409` — the refusal comes from a database exclusion constraint, so it holds for any code path including a manual `INSERT`. |
| `GET /api/v1/tasks` | Your tasks, soonest first, paginated. Takes an optional `first_day`/`last_day` window in the same local-date vocabulary as `/capacity`, so a week view asks both for the same seven days. |
| `GET`, `PATCH`, `DELETE /api/v1/tasks/{id}` | An id that belongs to somebody else answers `404`, byte for byte identical to an id that never existed ([ADR-0016](docs/adr/0016-ownership-isolation.md)). |
| `GET /api/v1/tags` | Read-only. A tag exists because a task named it ([ADR-0020](docs/adr/0020-domain-surface-choices.md)). |
| `GET /api/v1/capacity` | **Free and booked minutes per local day.** The foundation of the AI layer ([ADR-0004](docs/adr/0004-context-assembly-policy.md)) — it is what a generated plan is placed against, and it exists and is tested before any AI code does. |
| `GET /health`, `GET /health/ready` | Liveness and readiness, separate on purpose. |

Interactive documentation is at `/docs` outside production.

The capacity endpoint is the one worth reading the tests for. A day is not 1440 minutes on
a daylight-saving transition, and a task starting at 23:30 books all of its minutes into
the day it starts on ([ADR-0012](docs/adr/0012-task-time-business-rules.md)) — so a day can
be booked past its own length, reports zero free minutes, and says `over_capacity` rather
than returning a negative number.

## Running locally

Requires Docker and Docker Compose.

```bash
git clone https://github.com/GabrielBarros0602/SyncaAI.git
cd SyncaAI
cp .env.example .env      # then edit POSTGRES_PASSWORD
docker compose up --build
```

The API is served at `http://localhost:8000`, with interactive docs at
`http://localhost:8000/docs`.

### Working on the API without Docker

```powershell
cd apps/api
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt -r requirements-dev.txt
uvicorn syncaai.main:app --reload
```

`DATABASE_URL` already points at `localhost:5433`, which is where compose publishes the
database, so nothing needs overriding. The api container gets `db:5432` from compose
instead.

### Changing dependencies

Edit the `.in` file, never the `.txt`, then regenerate the lockfile:

```bash
cd apps/api
uv pip compile --universal --python-version 3.12 requirements.in -o requirements.txt
uv pip compile --universal --python-version 3.12 requirements-dev.in -o requirements-dev.txt
```

To move versions rather than change the set, add `--upgrade` — the plain form keeps every pin
it can and reports nothing when it does.

Installation stays on pip — `uv` is used only as the resolver, because development happens on
Windows while the runtime is Linux. See [CONTRIBUTING.md](CONTRIBUTING.md#dependencies).

### Working on the web client

```bash
cd apps/web
npm install
npm run dev          # http://localhost:5173
```

The dev server proxies `/api` to `http://localhost:8000`, so the browser only ever sees one
origin ([ADR-0021](docs/adr/0021-browser-session-and-origin.md)). The API therefore needs no
CORS configuration, and the `SameSite=Strict` refresh cookie works untouched. Start the API
first, or every call answers `404`.

```bash
npm run lint         # includes the ban on writing credentials to browser storage
npm run typecheck
npm test
```

The access token is held in memory and written to no browser storage, so a page reload
renews it silently from the `HttpOnly` cookie. That is why the interface has a third state
between "signed in" and "signed out", and why nothing renders until it resolves.

### Database migrations

```bash
cd apps/api
alembic upgrade head        # apply
alembic downgrade base      # reverse
alembic current             # which revision is applied
```

Migrations are not applied on container start. Run them explicitly, so a deploy never
mutates a schema as a side effect of a restart.

### Checks

```bash
cd apps/api
ruff check . && ruff format --check . && mypy && pytest
```

Tests marked `integration` need a reachable PostgreSQL. Start one with
`docker compose up -d db` and they run as-is. Without one, deselect them:

```bash
pytest -m "not integration"
```

## Architecture decisions

Every non-trivial decision is recorded in [`docs/adr/`](docs/adr/README.md) before the code
that implements it. Records are immutable once accepted; a change means a new record that
supersedes the old one.

## Roadmap

Development is governed by [`docs/ROADMAP.md`](docs/ROADMAP.md) — a sprint checklist where
every architectural decision is a first-class item that is only closed once its ADR is
written.

| Sprint | Scope | Status |
|---|---|---|
| S0 | Repository structure and walking skeleton | done |
| S1 | Domain model and database | done |
| S2 | Authentication and owner-scoped repository base | done |
| S3 | Email verification and generic authentication responses | done |
| S4 | Domain CRUD and the day-capacity query | done |
| S5 | First visible slice — login and the week's free capacity | next |
| S6 | AI pipeline against a test double, zero provider cost | |
| S7 | Real provider, guardrails, degradation | |
| S8 | Front end wired to the API — plan generation complete | |
| S9 | Task assistance, streamed | |
| S10 | Remaining prototype surfaces | |
| S11 | Tests, polish, publication | |
| Phase 2 | Core reimplemented in Java 21 / Spring Boot | |

## Security

[`docs/threat-model.md`](docs/threat-model.md) records what is worth protecting, who would
realistically try, what is already in the way and what is not — including what is accepted
on purpose, and why. Reviewed at the end of a sprint that changes the attack surface.

## Contributing

Conventions — commit format, scopes, ADR references, sprint discipline — are in
[`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).

---

## Português

**SyncaAI é um painel de operação pessoal com uma camada de IA que age sobre o contexto do
calendário** — transforma um objetivo em tarefas agendadas e rastreáveis usando a capacidade
livre real da sua semana.

Não é um calendário com uma janela de chat colada ao lado. A IA lê a capacidade livre
agregada da semana, decompõe o objetivo em itens concretos, e um agendador determinístico
coloca esses itens nos dias que de fato têm espaço. A saída é dado revisável no vocabulário
do próprio produto, nunca um bloco de texto para copiar à mão.

### Por que isso não é CRUD

Calendário com checklist é CRUD. O que faz disto um projeto de sistemas é a camada de IA e
seis problemas dentro dela, todos tratados explicitamente nos ADRs — chave do provedor fora
do navegador, montagem de contexto com orçamento de token e limite de privacidade, saída
estruturada validada que vira registro no banco, latência, custo e abuso, e degradação
quando o provedor cai.

Duas decisões carregam o peso:

- **A IA decompõe; o código agenda.** O schema de resposta não tem campo de data. O modelo é
  ruim em "qual dia tem espaço"; o banco sabe exatamente.
- **Saída de IA é proposta, não fato.** Planos gerados chegam como draft revisável. Nada é
  escrito no calendário antes da aprovação.

### O que a API faz hoje

Contas, sessões e isolamento por dono. Cadastro e recuperação de senha respondem **igual**
exista ou não a conta — o que a resposta esconde, a caixa de entrada revela, e só para o
dono do endereço. Sessão é revogável, senha é hasheada com argon2id, e toda leitura de
recurso passa por uma base de repositório que não expõe query sem filtro de dono.

O calendário existe: tarefas com checklist e tag, e a **query de capacidade livre por dia**
— minutos ocupados, minutos livres e contagem de tarefas por dia local. É a fundação da
camada de IA e está pronta e testada antes de existir qualquer linha de IA.

Dois detalhes que o teste cobre e a prosa esconderia: um dia não tem 1440 minutos na virada
do horário de verão, e uma tarefa que começa às 23:30 lança todos os seus minutos no dia em
que começa. Por isso um dia pode ficar acima da própria capacidade — reporta zero minutos
livres e marca `over_capacity`, em vez de devolver número negativo.

### Rodando localmente

```bash
cp .env.example .env      # edite POSTGRES_PASSWORD
docker compose up --build
```

API em `http://localhost:8000`, documentação interativa em `http://localhost:8000/docs`.

Em desenvolvimento o email é escrito no log em vez de enviado, então o link de verificação
aparece no terminal.

### Segurança

O [`docs/threat-model.md`](docs/threat-model.md) registra o que vale proteger, quem
realisticamente tentaria, o que já está no caminho e o que não está — incluindo o que foi
aceito de propósito, e por quê.

### Decisões arquiteturais

Toda decisão não trivial é registrada em [`docs/adr/`](docs/adr/README.md) antes do código
que a implementa. Registros são imutáveis depois de aceitos; mudança significa novo registro
que supersede o antigo.

### Desenvolvimento

O desenvolvimento é regido por [`docs/ROADMAP.md`](docs/ROADMAP.md), um checklist por sprint
onde cada decisão arquitetural é um item de primeira classe, fechado só quando o ADR
correspondente está escrito. Convenções de commit em [`CONTRIBUTING.md`](CONTRIBUTING.md).
