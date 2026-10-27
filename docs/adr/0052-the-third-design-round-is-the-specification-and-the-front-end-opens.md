# ADR-0052: The third design round is the specification, and the front end opens

**Status:** Accepted
**Date:** 2026-10-27
**Deciders:** Gabriel Barros

**Supersedes:** [ADR-0024](0024-soften-the-visual-language-in-stylesheets-only.md), whose
remaining parts patched the second round's design in stylesheets only: the language, the
layouts below 1100px, and the list of departures from `docs/design/`. Its token table had
already gone to [ADR-0026](0026-adopt-the-papel-tokens-and-test-every-pair.md). **Ends:** the
freeze of 2026-10-22 (backlog, decision 15). **Builds on:** ADR-0026, whose tokens the round
was drawn in, and the records whose behaviour the screens draw: the week (ADR-0022, ADR-0025,
ADR-0027, ADR-0028), the plan (ADR-0030 to ADR-0050), the settings (ADR-0029, ADR-0032) and
the account (ADR-0019, ADR-0051).

## Context

The front end was frozen on 2026-10-22, while a third design round redrew it. That round is
back. Six steps ran in order:

1. the design system;
2. the week on a desktop;
3. the day on a phone;
4. the plan screens S8 needs;
5. settings;
6. signing in and recovering a password.

Each screen was checked outside the design tool:

- contrast recomputed from the delivered tokens;
- widths and 200% text measured in the rendered page, at 320, 375, 768 and 667px and on the
  desktop;
- every sentence matched against the server's;
- the numbers checked against the week they sit in.

What was left to decide is how the screens become code: where the specification lives, how a
person moves between pages that the app does not have today, in what order the work lands,
and how the screens are tested once tests on screens resume.

Answered on 2026-10-27.

## Decision

### 1. The round's screens are the specification

The five screens replace the second round's three in `docs/design/`:

- the week on a desktop;
- the day on a phone;
- the plan;
- settings;
- signing in.

They come with the runtime that renders them and a copy of the tokens. They are the
specification for structure, behaviour, copy and appearance alike, so ADR-0024's rule that a
stylesheet may depart from the drawing ends here. The tokens' source stays
`apps/web/src/styles/tokens.css`, under its contrast test.

Where a screen assumed something only a prototype needs, the server's rules win:

- creating a task is open on every future day, in any week;
- a person's usable day and days off are their own;
- a discarded step's reasons are shown sentence-cased.

### 2. The layout follows the round's breakpoints

| Width | Layout |
|---|---|
| below 640px | one day, the week as a strip of seven cells above it |
| 640 to 1099px | one day beside the week as a column of seven rows |
| 1100px and up | the week in seven columns |

This replaces ADR-0024's table, whose sideways strip could leave today out of view.

### 3. Pages are routed with `react-router`

The app switches screens on the session's state and has no routes. The round needs pages a
person can go back from and links that open one: settings, a plan, and the two links that
arrive by email, `/verify?token=` and `/reset?token=`. `react-router` routes them. Moving
focus to a new page's heading stays our code, as the round's screens draw it.

### 4. The work lands in this order

1. **Base:**
   - the token the round added, `--alert-solid-pressed`, with its contrast pair;
   - the router;
   - the header with Plan and Menu, and the shortcut legend;
   - the status region;
   - the breakpoints.
2. **The week:** the desktop and the phone, with creating a task.
3. **The plan, S8.** The three server problems the round found are fixed first: a discard reason
   written for the model, a reset link refused with the confirmation link's sentence, and an
   email without the code the code mode asks for.
4. **Settings.**
5. **Signing in and recovering a password.**

Each module moves to the round's token names as it is rebuilt, and the legacy block in
`tokens.css` goes with the last one.

### 5. Screens are tested with Testing Library and axe

Tests on screens resume with the pattern that exists: Vitest and Testing Library. Every screen
also gets an automated accessibility check with `axe-core`, as a development dependency. Widths
and 200% text are measured in the browser on each pull request, as the round's checks were.
End-to-end tests wait for S11.

Two defects found in the round are fixed in the implementation rather than in another round.
Both are lines that do not wrap at 200% text: the late completion line on the phone, and the
day field when a plan's step is edited at 320px.

## Options Considered

### Where the specification lives

| Option | Assessment |
|---|---|
| **Replacing the second round's files — chosen** | One specification, the one that holds. The second round stays in git's history. |
| Side by side, by round | Both in view, and whoever reads has to know which one holds. |

### How pages are routed

| Option | Assessment |
|---|---|
| **`react-router` — chosen** | The routing library a reader of the code already knows. A large dependency for five routes, with API changes between major versions. |
| A router of our own over the History API | About 150 lines and their tests, in keeping with no component library. Code to own for a solved problem. |
| No routes, by state | No new code. The browser's back button and a link to a page do not work. |

### The order

| Option | Assessment |
|---|---|
| **Base, week, the plan, settings, signing in — chosen** | S8 is the milestone that can be published, and it needs only the base and the week. |
| Existing screens first, the plan last | Finishes what exists before adding what is new, and delays the milestone. |

### Testing screens

| Option | Assessment |
|---|---|
| **Testing Library and axe — chosen** | The pattern in use, with an automated accessibility check per screen. |
| Testing Library alone | No new dependency; accessibility rests on review and the contrast test. |
| Testing Library and Playwright now | Widths and 200% text in the suite, at the cost of a browser in CI and a second suite before the screens exist. |

## Trade-off Analysis

**The specification renders through the design tool's runtime.** Each screen loads
`support.js` and a copy of the tokens beside it, so the folder carries a script nobody here
wrote. It is needed to open the screens at all, and it never reaches the app.

**The router is a dependency for five routes.** A router of our own would have been smaller.
The deciding weight is that `react-router` is what a reviewer of the code expects to find, and
the parts the round cares about, focus and the back button, are ours to get right either way.

**Two known defects ship into the first pull requests that touch them.** Another design round
for two lines that do not wrap would cost more than fixing them where the stylesheet is
written, and each fix is checked at 320px and 200% text like everything else.

## Consequences

**Easier**
- Every screen is built against a drawing that has already been checked against the server.
- A person can go back, bookmark settings, and open the links that arrive by email.

**Harder**
- A dependency on `react-router`, and `axe-core` in development.
- `docs/design/` holds a third-party runtime script, there only to render the specification.

## Action Items

1. [x] The round's screens in `docs/design/`, and its README rewritten.
2. [ ] Base.
3. [ ] The week.
4. [ ] The three server fixes, then the plan.
5. [ ] Settings.
6. [ ] Signing in and recovering a password; the legacy tokens removed.

---

## Português

**O problema.** O front estava congelado desde 2026-10-22, à espera da terceira rodada de
design. A rodada voltou com seis passos conferidos fora da ferramenta. Faltava decidir como as
telas viram código.

**A decisão.**
- **A especificação:** as cinco telas da rodada substituem as três da segunda em
  `docs/design/`, e valem para estrutura, comportamento, texto e aparência. Onde a tela supôs
  algo de protótipo, valem as regras do servidor.
- **Os pontos de corte:** abaixo de 640px, um dia; de 640 a 1099px, um dia ao lado da semana; a
  partir de 1100px, a semana. Isso substitui a tabela do ADR-0024.
- **As rotas:** `react-router`, para configurações, o plano e os dois links que chegam por
  e-mail.
- **A ordem:**
  1. a base;
  2. a semana;
  3. o S8, depois de corrigir os três problemas do servidor;
  4. configurações;
  5. entrar.
- **Os testes:** Testing Library, com `axe-core` em cada tela; larguras e texto a 200% medidos
  no navegador a cada PR.

**O que se aceita.** Uma dependência grande para cinco rotas, um script de terceiros na pasta da
especificação, e dois defeitos de quebra de linha corrigidos na implementação.
