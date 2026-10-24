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
| [0004](0004-context-assembly-policy.md) | Calendar context assembly policy | Accepted; field list and fingerprint amended by 0034 |
| [0005](0005-structured-output-contract.md) | Structured output contract and failure handling | Accepted; decision 1 amended by 0030, decision 4 by 0035 |
| [0006](0006-cost-limits-cache-degradation.md) | Cost control, rate limiting, caching and degradation | Accepted; `ai_usage` amended by 0041, rate limiting by 0042 |
| [0007](0007-synchronous-persistence.md) | Synchronous SQLAlchemy for persistence | Accepted |
| [0008](0008-task-time-block.md) | Task time block: start plus duration, generated end | Accepted |
| [0009](0009-time-and-timezone-storage.md) | Store instants in UTC, derive the local day | Accepted |
| [0010](0010-day-as-a-table-for-day-level-state.md) | A `days` table for day-level state only | Accepted |
| [0011](0011-hard-delete-for-tasks.md) | Hard delete for tasks | Accepted |
| [0012](0012-task-time-business-rules.md) | Business rules for a task's position in time | Accepted; rule 1 amended by 0027 |
| [0013](0013-derive-end-at-with-a-trigger.md) | Derive `end_at` with a trigger, not a generated column | Accepted |
| [0014](0014-password-hashing-with-argon2id.md) | Hash passwords with argon2id | Accepted |
| [0015](0015-session-model.md) | Short-lived access token with a revocable refresh token | Accepted |
| [0016](0016-ownership-isolation.md) | Ownership in the repository base, 404 across owners | Accepted |
| [0017](0017-refresh-token-delivery.md) | Refresh token delivery: cookie for browsers, body for native | Accepted |
| [0018](0018-email-delivery.md) | Send mail through a transactional provider, behind an abstraction | Accepted |
| [0019](0019-account-verification.md) | Verify addresses, and make every authentication response generic | Accepted |
| [0020](0020-domain-surface-choices.md) | Tags, checklist ordering and pagination | Accepted |
| [0021](0021-browser-session-and-origin.md) | Browser session handling and origin strategy | Accepted |
| [0022](0022-capacity-against-a-usable-day.md) | Capacity is real occupancy, measured against a usable day | Accepted; decision 3 superseded by 0029 |
| [0023](0023-a-budget-you-choose-under-a-ceiling-you-do-not.md) | A budget you choose, under a ceiling you do not | Accepted; items 7–9 redefined by 0029 |
| [0024](0024-soften-the-visual-language-in-stylesheets-only.md) | Soften the visual language, in stylesheets only | Accepted; tokens superseded by 0026 |
| [0025](0025-undo-is-a-recreate.md) | Undo is a recreate, so it is offered only where recreating is faithful | Accepted |
| [0026](0026-adopt-the-papel-tokens-and-test-every-pair.md) | Adopt the Papel tokens, and test every pair they promise | Accepted |
| [0027](0027-correct-a-started-task-up-to-a-day-back.md) | A started task's start can be corrected, up to a day back | Accepted |
| [0028](0028-the-checklist-is-its-own-resource.md) | The checklist is its own resource | Accepted |
| [0029](0029-the-usable-day-is-a-window-each-person-sets.md) | The usable day is a window each person sets | Accepted |
| [0030](0030-a-plan-is-placed-in-real-free-time-reviewed-and-committed-whole.md) | A plan is placed in real free time, reviewed item by item, and committed whole | Accepted; amended by 0033 |
| [0031](0031-a-job-queue-in-postgresql-woken-by-notify.md) | A job queue in PostgreSQL, woken by NOTIFY and swept for what it misses | Accepted; decisions 1 and 5 amended by 0036 |
| [0032](0032-days-off-and-a-preferred-block-length.md) | Days off and a preferred block length, for the planner | Accepted |
| [0033](0033-a-plan-fills-this-week-first-in-its-own-language-one-at-a-time.md) | A plan fills this week first, in the request's language, one at a time | Accepted |
| [0034](0034-the-model-sees-the-room-each-day-has-and-nothing-it-cannot-use.md) | The model sees the room each day has, and nothing it cannot use | Accepted |
| [0035](0035-repair-whenever-a-step-fails-and-keep-the-better-answer.md) | Repair whenever a step fails, and keep the better of the two answers | Accepted |
| [0036](0036-a-job-s-answers-are-rows-of-their-own.md) | A job's answers are rows of their own | Accepted |
| [0037](0037-a-draft-in-five-tables-and-only-an-approved-one-stays.md) | A draft is held in five tables, and only an approved one stays | Accepted |
| [0038](0038-a-job-and-its-plan-are-two-resources-linked-by-id.md) | A job and its plan are two resources, linked by id | Accepted |
| [0039](0039-a-local-open-model-until-a-provider-is-paid-for.md) | A local open model until a provider is paid for | Accepted; decision 2 amended by 0040, its model named by 0043 |
| [0040](0040-what-the-local-model-is-held-to-measured.md) | What the local model is held to, measured | Accepted |
| [0041](0041-every-call-is-metered-when-it-ends.md) | Every call is metered when it ends | Accepted |
| [0042](0042-plan-requests-are-limited-over-moving-windows-of-jobs.md) | Plan requests are limited over moving windows, counted from jobs | Accepted |
| [0043](0043-the-local-model-is-qwen3-5-4b.md) | The local model is qwen3.5:4b | Accepted |

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
