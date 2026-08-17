# Architecture Decision Records — SyncaAI

SyncaAI is a personal operations dashboard: a calendar, task, habit and note surface with an
AI layer that acts on calendar context. This directory records every non-trivial
architectural decision, in order.

An ADR is immutable once accepted. If a decision changes, write a new ADR that supersedes
the old one and update the status of the old one — never rewrite history.

| ADR | Title | Status |
|-----|-------|--------|
| [0001](0001-backend-stack.md) | Back-end stack: FastAPI now, Spring Boot port as phase 2 | Accepted |
| [0002](0002-mvp-scope-ai-features.md) | MVP scope of the AI layer and its UI entry point | Accepted |
| [0003](0003-ai-request-lifecycle.md) | AI request lifecycle and transport | Accepted |
| [0004](0004-context-assembly-policy.md) | Calendar context assembly policy | Accepted |
| [0005](0005-structured-output-contract.md) | Structured output contract and failure handling | Accepted |
| [0006](0006-cost-limits-cache-degradation.md) | Cost control, rate limiting, caching and degradation | Accepted |
| [0007](0007-synchronous-persistence.md) | Synchronous SQLAlchemy for persistence | Accepted |
| [0008](0008-task-time-block.md) | Task time block: start plus duration, generated end | Accepted |
| [0009](0009-time-and-timezone-storage.md) | Store instants in UTC, derive the local day | Accepted |
| [0010](0010-day-as-a-table-for-day-level-state.md) | A `days` table for day-level state only | Accepted |
| [0011](0011-hard-delete-for-tasks.md) | Hard delete for tasks | Accepted |
| [0012](0012-task-time-business-rules.md) | Business rules for a task's position in time | Accepted |
| [0013](0013-derive-end-at-with-a-trigger.md) | Derive `end_at` with a trigger, not a generated column | Accepted |
| [0014](0014-password-hashing-with-argon2id.md) | Hash passwords with argon2id | Accepted |
| [0015](0015-session-model.md) | Short-lived access token with a revocable refresh token | Accepted |
| [0016](0016-ownership-isolation.md) | Ownership in the repository base, 404 across owners | Accepted |
| [0017](0017-refresh-token-delivery.md) | Refresh token delivery: cookie for browsers, body for native | Accepted |

## Template

New records follow the format in [0001](0001-backend-stack.md): Context, Decision, Options
Considered, Trade-off Analysis, Consequences, Action Items.

---

## Português

O SyncaAI é um painel de operação pessoal — calendário, tarefas, hábitos e notas — com uma
camada de IA que age sobre o contexto do calendário. Este diretório registra toda decisão
arquitetural não trivial, em ordem.

Um ADR é imutável depois de aceito. Se a decisão muda, escreva um novo ADR que supersede o
antigo e atualize o status do antigo — nunca reescreva o histórico.
