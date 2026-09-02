# Working on SyncaAI

Gabriel Barros — software engineering student at FIAP, back-end focus, graduating December
2027. This repository is the centrepiece of a portfolio for internship and junior back-end
applications, so it is held to production standards on purpose: every non-trivial decision is
written down, every rule the database can enforce is enforced there, and no commit lands
without a reason attached to it.

**Gabriel writes in Portuguese. Reply in Portuguese.** Code, comments, commit messages,
documentation and UI copy are English (see Conventions).

---

## Read these before doing anything

| File | What it holds |
|---|---|
| `docs/adr/README.md` | index of 23 architecture decision records — the reasoning behind every structural choice |
| `docs/backlog.md` | what is open, in order, and the rule that orders it |
| `docs/design/README.md` | the three screens as designed, and what was decided in them |
| `docs/ROADMAP.md` | sprints S0–S11, what is done and what is next |
| `CONTRIBUTING.md` | commit format, dependency workflow, test commands |
| `docs/threat-model.md` | the security decisions and what they address |

When a change touches an area an ADR covers, read that ADR first. They are immutable once
accepted: a decision that changes gets a **new** record that supersedes or amends the old one.
Never rewrite one.

---

## The division of labour

Gabriel studies the reasoning in a separate long-context conversation that carries the whole
project history. **Here, prioritise the quality of the work over explaining it in chat.** Do
not narrate an implementation at length, teach the concepts behind it, or produce a tutorial
after every change. A short summary of the outcome and the decisions that need his answer is
enough.

**This works only because the reasoning is still recorded — in the commit message and in the
ADR, not in chat.** If anything those carry more weight now, because they become the only
trace. Thinning them out to save effort is the one way this arrangement fails.

So:

- A commit body says **why**, not what. The diff already says what.
- A non-trivial decision gets an ADR, in the format the existing 23 use.
- A comment in code explains the reason a line is surprising, not the mechanics of the line.
- Anything discovered while working — a defect, an assumption that turned out false, a
  constraint nobody had noticed — belongs in the commit body or in `docs/backlog.md`, not only
  in the reply.

---

## How Gabriel works

- **Architecture decisions are his.** Present options with trade-offs and an explicit
  recommendation, then wait. Do not choose and proceed.
- **Separate theory from practice.** When explanation is genuinely needed, one section for the
  concept and another for the steps to run. Mixing them in a paragraph loses him.
- **You write the code; review like a senior reviews a PR** — comments and questions, not a
  rewrite. If he asks "how do I do X", explain the concept and show a short illustrative
  fragment.
- **Show configuration files whole.** Describing a position in prose ("in the block below",
  "inside the service") has caused repeated errors.
- **Be direct and short.** If he has understood something wrongly, correct it immediately and
  name which part of his reasoning was wrong — not just the result.
- **When he reports an error, ask for the raw output including the prompt line.** His summary
  usually removes the clue.
- **Flag reversible decisions *before* the action line, never after.** He acts while reading.

---

## Verification — the reason this runs on his machine

CI is not the first check. It is the second.

```powershell
docker compose up -d db            # integration tests need a reachable PostgreSQL

cd apps\api
ruff format .
ruff check . ; mypy ; pytest       # pytest includes the tests marked `integration`

cd ..\web
npm run lint ; npm run typecheck ; npm test
```

Rules:

- **Never claim something is done without having run the suite.** Not "CI will check it".
- **The integration tests are the ones that matter most**, because they assert what only
  PostgreSQL can prove: the exclusion constraint, the `end_at` trigger, the capacity query's
  clipping, and that the query still reaches its rows through `ix_tasks_user_start_at`. They
  are marked `integration` and skip silently without a database — a green run that skipped
  them is not a green run.
- **When something cannot be verified, say so plainly** and name what would verify it.
- A test that only passes because it asserts what the code happens to do is worse than no
  test. Assert the behaviour the record claims.

---

## Conventions

- **English** for code, comments, commit messages, UI copy and documentation. `README.md` is
  English first with a Portuguese section below; ADRs follow the same shape.
- **Conventional Commits** — `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`,
  `build:`, `ci:` — imperative mood, small and frequent. The history has to show the project
  evolving; a single commit containing a finished feature is a failure of the record.
- **Branch per change**, pull request per branch. Always cut from a fresh `main`:
  `git checkout main ; git pull --ff-only`.
- **ADRs in `docs/adr/`** for every non-trivial architectural decision, numbered in sequence,
  added to `docs/adr/README.md`.
- **Secrets never in a versioned file.** `.env` is ignored; `.env.example` is committed and
  carries example values only.
- **Python dependencies never move through Dependabot** — see the comment in
  `.github/dependabot.yml`. They move with `uv pip compile --upgrade` against the `.in` files.
  The plain form updates nothing and reports nothing.

---

## Environment

- Windows, **PowerShell**: the command separator is `;`, not `&&`.
- Docker Desktop for PostgreSQL 16. The API and web run on the host during development.
- Python 3.12, Node 22.

---

## Where the project is

**Done:** S0–S4 (repository, domain and schema, authentication and owner isolation, email
verification, domain CRUD and the capacity query) and most of S5.

**The current shape.** The API is FastAPI + SQLAlchemy 2.0 + PostgreSQL 16, with the rules the
database can hold held there: a GiST exclusion constraint refuses overlapping bookings, a
trigger derives `end_at`, and a CHECK caps a task at one day. The web app is Vite + React 19 +
TypeScript in strict mode, CSS Modules, no component library. The AI layer is designed
(ADR-0002 to ADR-0006) and not yet built.

**Open, in the order `docs/backlog.md` sets** — first what a redesign cannot invalidate:

1. The signed-in path has no integration test: register → read the token from `RecordingMailer`
   → verify → sign in as `web` → refresh using **only** the cookie → `/me`. The cheapest thing
   left and the last one that is pure back-end.
2. The three screens in `docs/design/` are not implemented. This is the large one, and it
   carries most of rounds 2 and 3 of the backlog: the five verbs in an opened row, the
   inherited band, today marked, delete with undo, the move panel. Read
   `docs/design/README.md` before opening the HTML — it records what was decided and why, and
   the files themselves are large.
3. Items 7–9 of ADR-0023: the `users.usable_minutes` column with
   `CHECK (usable_minutes BETWEEN 60 AND 1080)`, `PATCH /me`, and the settings screen.
4. S6 — the AI pipeline against a test double, no provider.

**Further out:** a Java 21 + Spring Boot port of the core (ADR-0001, phase 2). It is on the
roadmap deliberately, so prefer designs that do not depend on something Python-specific when
the choice is otherwise even.
