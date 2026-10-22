# ADR-0024: Soften the visual language, in stylesheets only

**Status:** Accepted; its token table and two of its open points superseded by
[ADR-0026](0026-adopt-the-papel-tokens-and-test-every-pair.md)
**Date:** 2026-10-19
**Deciders:** Gabriel Barros

**Amends:** the opening of [`docs/design/README.md`](../design/README.md), which calls the
three design files the specification the front end "has to match". For five properties —
text contrast, field borders, radius, the smallest text size, and the week's layout below
1100px — the implementation now follows this record instead. For structure, content and
behaviour the design files are still the specification.

## Context

A design critique of the sign-in screen and the week, at 1440, 1280 and 390px, found four
things. Each was measured again before anything changed.

**The week had no layout below a desktop.** `Week.module.css` contained no media query, and
the shell pads the week with 128px of side padding. At 375px the document was 844px wide, a
day column was 35px and a task's title button rendered at zero width. At 768px the title had
35px and the chrome ran past the window.

**The language was hard rather than quiet.** Every control was a one-pixel box with square
corners — keys, tags, buttons, inputs, alerts and the frame around them — and sixty-two
declarations set text between 8 and 11px. The smallest was the 8px `+1` that says an end
time belongs to tomorrow, one of the few characters on the screen that changes what a row
means.

**Contrast failed.** `--faint`, which draws most of the small text, read 3.0:1 on the dark
ground and 2.6:1 on the light one, where small text needs 4.5:1. A field's border, drawn in
`--rule2`, read 2.1:1, where a control's boundary needs 3:1.

**Two tokens did not exist.** `Auth.module.css` used `--field` and `--surface`, and nothing
defined either; the inputs fell through to transparent and the panel survived on a literal
fallback tuned for the dark theme.

The design files themselves carry part of this. Their second round had already raised
`--faint` to 0.56 and 0.64, which the tokens never picked up, but it left `--dim` at 0.58 and
0.66 — two greys two points of alpha apart, which is one grey with two names.

## Decision

**Soften the language and fix the defects within the stylesheets, and nowhere else.** The
change touches `tokens.css`, `Week.module.css` and `Auth.module.css`. No component, no
markup, no copy, no class name, no attribute, no shortcut and no test changes, so the
behaviour the suite asserts is the behaviour that ships.

### 1. Tokens

| Token | Dark | Light | Why |
|---|---|---|---|
| `--surface` | 0.04 | 0.04 | a panel set apart without a rule |
| `--field` | 0.05 | 0.05 | the inside of a field, one step further from the page |
| `--field-border` | 0.40 | 0.54 | a field's edge, held to 3:1 |
| `--faint` | 0.52 | 0.64 | text, held to 4.5:1 on every ground it sits on |
| `--dim` | 0.66 | 0.76 | text, kept a clear step above `--faint` |
| `--radius-sm/md/lg` | 6 / 10 / 14px | — | three radii; keycaps take a fixed 4px |
| `--pad` / `--rowpad` | 18 / 13px | — | the default density only; compact and roomy do not move |

Alphas are of the theme's ink. Every contrast figure is composited over the ground the text
actually sits on, the darkest being an opened row inside an overbooked day:

| | `--bg` | `--hover` | opened row, overbooked day |
|---|---|---|---|
| dark `--faint` | 5.18 | 5.04 | 4.73 |
| dark `--dim` | 7.82 | 7.32 | 6.71 |
| light `--faint` | 5.00 | 4.77 | 4.50 |
| light `--dim` | 7.46 | 6.97 | 6.42 |

That last ground holds only because an opened row under the pointer no longer lays its
hover fill over its own tint. The two were the same colour on two layers; doubled, `--faint`
read 4.25:1.

### 2. The language

- **Radius** on buttons, fields, alerts and the frame; 4px on keycaps.
- **Borders that only outlined a control go.** The chrome's ghost buttons take a ground
  instead. Dividers between days and between rows stay, because they are information.
- **Tags are filled pills**, in the case they were typed. Their text moves to `--dim`: on the
  pill's own `--fill`, inside an opened row of an overbooked day, `--faint` reads 4.0:1.
- **Capitals with tracking survive at two levels only**, the weekday and the label over a
  field, at 0.08em.
- **No informative text under 12px.** Keycaps may stay at 11px.
- **The completion box** is 16px with a 24px hit area, and its edge is `--field-border`,
  because that hairline is the only thing saying a control is there.
- **The focus ring** is 55% of the ink — 5.7:1 dark, 3.8:1 light — and a field takes focus on
  its own edge instead of a second ring outside it.

### 3. The week below a desktop

| Width | Layout |
|---|---|
| ≥ 1100px | seven columns, never narrower than 150px |
| 700–1099px | a strip of days at least 230px wide, scrolling sideways and snapping to a day |
| ≤ 699px | one column; the rule between days turns horizontal |

The chrome wraps from 1099px down. On a device with no hover and a coarse pointer, the
shortcut keys and their legend are hidden. The shell's inline padding is overridden from
`tokens.css` — 24px, then 16px — with a selector that matches the inline value itself, so the
sign-in screen's zero padding is never touched and the override stops applying the day
`App.tsx` stops writing that value.

### 4. What does not move

The accent still means trouble and only trouble. Today keeps its 2px rail. The track, the
bar and the budget tick keep their geometry, which is computed in percentages. The motion
variables and `prefers-reduced-motion` are untouched.

### 5. Where this now departs from `docs/design/`

Radius everywhere the design drew a square corner; filled tags where it drew ruled ones;
lowercase where it drew capitals on the day's index, the carried band's origin and the tags;
12px where it drew 8 to 11; the contrast values above; and layouts below 1100px that the
design never drew.

One of these reverses a recorded call. The first pull request of item 2 kept the day's
`TODAY` in capitals because the design drew it that way, under the rule that the design wins
on appearance. The source string has always been `today`; the capitals came from the
stylesheet, and without them it renders as written. This record is what narrows that rule.

## Options Considered

| Option | Assessment |
|--------|------------|
| **A. Fix the defects only** | Define the two tokens, raise contrast, add one breakpoint, and keep the design's square, ruled, small-type language. Cheapest and the most faithful to the files. It answers three of the four findings and leaves the one the critique led with: the screen still reads as hard. |
| **B. Soften within stylesheets only — chosen** | Answers all four, and the restriction is the point: a change that cannot touch markup cannot change behaviour, so the existing suite still proves what it proved, and each commit reverts on its own. It cannot do anything that needs markup or script — a day view with navigation, collapsible days, scrolling the strip to today. |
| **C. A new design round, then a component redesign** | Potentially the best phone experience, since a day view with its own navigation is the natural answer below 700px. Blocks on design work that has not been done, touches components and tests, and puts a visual change and a behavioural change in the same review — which is how a regression hides inside a restyle. |

## Trade-off Analysis

**Fidelity is traded for legibility, on five properties and no others.** The design files
stop being a pixel specification for radius, contrast, type size, field borders and narrow
layouts. Everything they decided about structure — a task belongs to the day it begins on,
the five verbs live in the opened row, booked is the big number — stands, and a reader
checking the code against them should still find it there.

**Restricting to CSS is a constraint chosen for review, not for elegance.** It forced two
workarounds a component change would not need: an `!important` against an inline style, and
a selector that matches that style's text. Both are written down where they live, and the
second is fragile on purpose, in the direction that fails safe.

**The strip hides days.** Between 700 and 1099px the week no longer fits on screen at once,
and nothing scrolls it to today, because that takes script. Seven columns at that width
would have been 89 to 128px each — the failure this record started from.

**Larger type costs height and some width.** Rows are taller, a task's duration drops under
its range when the two do not fit one line, and between 1100 and about 1180px the week
scrolls a little sideways, because a crossing task's range is 108px of unbreakable type.

**Verification is measurement, not tests.** The suite cannot see a stylesheet. The contrast
tables were computed by compositing each colour over its ground, and the worst case of each
was then confirmed in a browser against the computed colours of every text element on the
screen, in both themes. Layout was measured the same way — document width, and every text
element against the edge of its column — at 1440, 1280, 1100, 1024, 768 and 390px, with the
week seeded across every state.

## Consequences

**Easier**
- The week is usable on a phone and a tablet, and the document is never wider than the
  window at any width measured.
- Every piece of text clears 4.5:1 on every ground it sits on, except the accent in the light
  theme, below.
- A field, a control and a container no longer look alike.

**Harder**
- The design files and the screen now disagree on purpose, and this record is what says
  which wins where. A future design round has to be read against it.
- The shell's padding lives in two places until `App.tsx` moves it into a stylesheet.

**To revisit**
- `--accent` in the light theme fails on the tints it is drawn over: 4.35:1 on the
  over-budget chip, 3.88:1 on an opened row of an overbooked day. It is the one signal
  colour, so changing it is a design decision this record does not make.
- The light theme still cannot be switched on from the interface. `App.tsx` puts
  `data-theme` on a `div` inside `<body>` while the page's own background resolves against
  `:root`, so setting the attribute on that `div` draws dark ink on a dark page. It was
  checked here with the attribute on `<html>`.
- Scrolling the strip to today, and a day view with navigation on phones, both need script
  and are option C's territory.

## Action Items

1. [x] `--surface`, `--field` and `--field-border` defined; the literal fallback removed.
2. [x] `--faint` and `--dim` raised, with every ground measured in both themes.
3. [x] An opened row stops doubling its tint under the pointer.
4. [x] Radius tokens, softened controls, filled tags, two levels of capitals, softer focus.
5. [x] No informative text under 12px; the completion box at 16px with a 24px hit area.
6. [x] Three layouts for the week, the chrome wrapping, shortcut keys hidden on touch.
7. [x] The sign-in panel actually hidden below 900px. Its rule had always lost the cascade.
8. [ ] Move the shell's padding out of the inline style in `App.tsx`, and delete the override
       in `tokens.css` in the same change.
9. [ ] Decide `--accent` for the light theme.
10. [ ] `CLAUDE.md` counts 23 records; this is the 24th. It sits outside the files this change
        was allowed to touch.

---

## Português

**O problema.** Uma crítica de design da tela de entrar e da semana encontrou quatro coisas,
e cada uma foi medida de novo antes de mudar algo:

- A semana não tinha nenhum `@media`. A 375px o documento tinha 844px de largura e o botão do
  título de uma tarefa renderizava com largura zero.
- A linguagem era dura: tudo era caixa de um pixel com canto reto, e 62 declarações punham
  texto entre 8 e 11px — a menor delas era o `+1` de 8px, que diz que a hora de fim é do dia
  seguinte.
- O `--faint` dava 3,0:1 e 2,6:1, e a borda de campo 2,1:1.
- Os tokens `--field` e `--surface` eram usados e nunca definidos.

**A decisão.** Suavizar e corrigir **só nas folhas de estilo**. Nada de componente, markup,
texto, classe, atributo, atalho ou teste — então o comportamento que a suíte prova é o
comportamento que vai para o ar, e cada commit reverte sozinho.

- **Contraste:** todo texto a 4,5:1 contra cada fundo em que ele cai, sendo o pior uma linha
  aberta num dia estourado. O `--dim` subiu junto, para continuar um degrau acima do `--faint`.
- **Linguagem:** raio nos controles, borda só onde ela informa, tag como pílula preenchida,
  maiúscula só em dois níveis e nenhum texto informativo abaixo de 12px.
- **Semana:** três faixas — sete colunas a partir de 1100px, uma faixa rolável com snap entre
  700 e 1099px, e uma coluna abaixo disso.

**O que essa decisão muda no registro.** Os HTML de `docs/design/` deixam de ser
especificação de pixel para raio, contraste, tamanho mínimo de texto, borda de campo e layout
estreito. Para estrutura, conteúdo e comportamento eles continuam valendo. Uma decisão
anterior é revertida de propósito: o `TODAY` em maiúsculas, mantido na PR 1 porque o design o
desenhava assim, volta a ser `today`, que é como a string sempre foi escrita.

**Opções descartadas.** Corrigir só os defeitos (A) deixava de pé o principal achado da
crítica. Uma rodada de design seguida de redesenho de componentes (C) seria o melhor celular
possível, mas bloqueia em trabalho de design não feito e mistura mudança visual com mudança de
comportamento numa revisão só.

**O que fica em aberto:**
- O `--accent` do tema claro reprova sobre os tons de alarme.
- O tema claro não liga pela interface, porque o atributo está no `div` errado.
- Rolar a faixa até hoje precisa de script.
- O padding do shell mora em dois lugares até o `App.tsx` passar ele para uma folha de estilo.
