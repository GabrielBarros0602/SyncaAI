# SyncaAI

**Personal operations dashboard with a calendar-aware AI layer — turns a goal into scheduled,
trackable tasks using your week's real free capacity.**

SyncaAI is not a calendar app with a chat window attached. The AI layer reads the aggregate
free capacity of your week, decomposes a goal into concrete items, and a deterministic
scheduler places those items on the days that actually have room. The output is reviewable
data in the product's own vocabulary, never a block of text to copy by hand.

> Status: early development. The walking skeleton is the current milestone.

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
| Job queue | PostgreSQL, `SELECT ... FOR UPDATE SKIP LOCKED` |
| Dependencies | pip + pip-tools |
| Quality | ruff, mypy (strict), pytest |
| Runtime | Docker Compose |

Stack rationale, including the estimated cost of the alternative, is in
[ADR-0001](docs/adr/0001-backend-stack.md).

## Repository layout

```
.
├── apps/
│   ├── api/       FastAPI service
│   └── web/       interface prototype (visual baseline)
├── docs/adr/      architecture decision records
└── docker-compose.yml
```

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

`DATABASE_URL` already points at `localhost:5433`, which is where compose publishes the database, so nothing needs overriding. The api container gets `db:5432` from compose instead.

### Changing dependencies

Edit the `.in` file, never the `.txt`, then regenerate the lockfile:

```bash
cd apps/api
uv pip compile --universal --python-version 3.12 requirements.in -o requirements.txt
uv pip compile --universal --python-version 3.12 requirements-dev.in -o requirements-dev.txt
```

Installation stays on pip — `uv` is used only as the resolver, because development happens on
Windows while the runtime is Linux. See [CONTRIBUTING.md](CONTRIBUTING.md#dependencies).

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
| S2 | Authentication and owner-scoped repository base | in progress |
| S3 | Email verification and generic authentication responses | |
| S4 | Domain CRUD and the day-capacity query | |
| S5 | First visible slice — login and the week's free capacity | |
| S6 | AI pipeline against a test double, zero provider cost | |
| S7 | Real provider, guardrails, degradation | |
| S8 | Front end wired to the API — plan generation complete | |
| S9 | Task assistance, streamed | |
| S10 | Remaining prototype surfaces | |
| S11 | Tests, polish, publication | |
| Phase 2 | Core reimplemented in Java 21 / Spring Boot | |

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

### Rodando localmente

```bash
cp .env.example .env      # edite POSTGRES_PASSWORD
docker compose up --build
```

API em `http://localhost:8000`, documentação interativa em `http://localhost:8000/docs`.

### Decisões arquiteturais

Toda decisão não trivial é registrada em [`docs/adr/`](docs/adr/README.md) antes do código
que a implementa. Registros são imutáveis depois de aceitos; mudança significa novo registro
que supersede o antigo.

### Desenvolvimento

O desenvolvimento é regido por [`docs/ROADMAP.md`](docs/ROADMAP.md), um checklist por sprint
onde cada decisão arquitetural é um item de primeira classe, fechado só quando o ADR
correspondente está escrito. Convenções de commit em [`CONTRIBUTING.md`](CONTRIBUTING.md).
