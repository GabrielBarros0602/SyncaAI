# ADR-0026: Adopt the Papel tokens, and test every pair they promise

**Status:** Accepted
**Date:** 2026-10-22
**Deciders:** Gabriel Barros

**Supersedes in part:** [ADR-0024](0024-soften-the-visual-language-in-stylesheets-only.md) —
its token table (§1: contrast, field border, radius) and two of its open points, the light
theme's accent and the theme attribute on a `div`. Its rules inside the modules (§2, including
11px keycaps), the narrow layouts (§3) and the shell override stand.

**Amends:** [`docs/design/README.md`](../design/README.md) again. Colour, type, spacing, radius,
focus and motion now come from the third design round's design system, not from the second
round's files; structure, content and behaviour are still decided there.

## Context

ADR-0024 corrected the tokens where they stood: greys and fills as alpha over the ink. That
made a contrast figure depend on how many layers happened to stack — an opened row inside an
overbooked day read 3.88:1 until a hover fill stopped doubling its tint. Two defects were left
open on purpose. The accent in the light theme failed on its own tints, 4.35:1 on the
over-budget chip and 3.88:1 on that opened row, and choosing the signal colour was a design
decision. And the light theme could not be switched on at all, because `App.tsx` put
`data-theme` on a `div` while the page background resolves against `:root`.

The third design round returned its first step, the design system, in two directions with the
same token names and the same rules: every colour opaque, every ground that text can sit on a
token of its own, and the accent split into `alert` for graphics, `alert-ink` for text and
`alert-solid` for a filled flag.

- **1a, Papel:** warm paper, corners of 6, 10, 14 and 20px, days as separate sheets with a gap,
  Atkinson Hyperlegible Next and Mono throughout, a damped spring on the completion box.
- **1b, Mostrador:** cold neutrals, corners of 3 to 14px, days glued into a grid with a rule
  for a gap, Archivo at 125% width for weekdays and figures, IBM Plex Mono for times, dry
  motion.

Each came with a tokens file and a list of every text/ground and edge/ground pair the screens
use. Both were recomputed outside the design tool, and both pass every listed pair in both
themes, along with four pairs the list missed:

| | worst text (4.5) | worst edge (3.0) | alert text on alert tint | grey steps, ΔL |
|---|---|---|---|---|
| Papel, light | 4.84 | 3.35 | 6.29 | 0.135 / 0.115 |
| Papel, dark | 4.89 | 3.18 | 8.28 | 0.155 / 0.125 |
| Mostrador, light | 4.65 | 3.03 | 6.39 | 0.168 / 0.141 |
| Mostrador, dark | 5.08 | 3.19 | 7.89 | 0.176 / 0.126 |

The second round's two lighter greys were 0.017 apart, one grey with two names.

## Decision

**Adopt direction 1a, Papel, as the token file now, and hold every pair it promises with a
test.**

### 1. The file

`tokens.css` is Papel's file with its values unchanged. A legacy block maps the old names
(`--dim`, `--faint`, `--fill`, `--accent`, `--pad`, `--num`, …) onto the new ones, so every
module keeps rendering with the corrected colours before any of them moves; the block goes in
the change that moves the last one.

### 2. The theme lives on `<html>`, fixed at dark for now

`index.html` writes `data-theme="dark"` on `<html>`, so nothing changes for anybody until the
settings screen can write `light` or `dark`, or remove the attribute to follow the system
(decision 8 of 2026-10-22). The file already carries the block for a page with no attribute.

`App.tsx` stops writing `data-theme`, `data-density`, `data-accent` and `data-motion` on its
`div`. The last three were controls of the design tool, not settings of the product — it always
wrote `default` — and their rules went with the old file. Motion is still governed by
`prefers-reduced-motion`. The shell override loses `[data-theme]` from its selector and keeps
matching the inline padding.

### 3. Fonts

Atkinson Hyperlegible Next and Mono, as variable fonts from 400 to 800, loaded from Google
Fonts exactly as Archivo and Plex were. How fonts are delivered is not changed here.

### 4. The contrast test

`tests/contrast.test.ts` reads `tokens.css` as the browser receives it and the pairs from
`contrast-pairs.json`, and asserts:

- every pair at its minimum — text 4.5:1, edges and graphics 3:1 — in both themes;
- every colour token an opaque hex;
- the dark block declares every token the light one does — `:root` carries the light values
  whatever the attribute says, so a token missing from dark is not missing, it is silently
  light;
- the copy of the dark block for a dark system equals the dark block;
- the formula gives WCAG's known answers, because a wrong formula passes everything.

The pairs file is the design's list without its second copy of the palette, plus two pairs it
missed: `ink` on `tag` (the active verb, and `::selection`) and `line-strong` on
`alert-pressed` (a pressed row in an overbooked day). The colours are read from the stylesheet,
so there is one palette and the test measures the one that ships.

### 5. One rule the design did not have

`::placeholder` takes `--ink-3`. Several fields of the week are named only by a placeholder and
an `aria-label`, so the placeholder is the label somebody reads. Left to the browser it was
`#757575`, 3.96:1 on the dark field; it now reads 6.15:1 dark and 6.60:1 light. The pair was
already on the list as `ink-3` on `field`.

## Options Considered

| Option | Assessment |
|--------|------------|
| **A. Papel — chosen** | Its deliverable demonstrates what it claims. It removes both of the language problems ADR-0024 only softened — no tracked capitals anywhere, soft corners — and continues where that record already went: 6, 10 and 14px are the same radii. Atkinson Hyperlegible was drawn for low vision, so `1h` and `11h`, `0` and `O` do not blur, which serves the accessibility requirement beyond contrast. It has the widest margins in the worst cases. It costs a font change on every screen. |
| **B. Mostrador** | Continuity: Archivo and Plex are the fonts already loaded, and dark as home suits a screen used at night. But the glued grid, the trait that defines the direction, is not drawn anywhere in its deliverable — its example week uses the same 8px gap as Papel — and one of its own explanations is false for its own values, describing the opened row in an overbooked day as neutral where its `alert-open` is tinted. Its corners of 3px and its tracked capitals on the weekday go back toward the hard language ADR-0024 started from. |
| **C. Keep ADR-0024's tokens until the week (step 2) returns** | One swap instead of perhaps two, if step 2 adjusts a value. But the contrast test needs opaque tokens to have anything to test, the light accent stays failing, and every later step would land without the test watching it. |

## Trade-off Analysis

**The tokens arrive before the screens drawn on them.** The legacy block is the price: two
names for each token for a while, and modules still written in the old vocabulary. If step 2
moves a value, the change is a diff the test checks rather than a second migration.

**A font change touches every screen.** Atkinson Hyperlegible Mono is wider than Plex Mono, so
in a 150–185px column a row's index and its time range, which shared a line, now take two.
Measured against `main` with the same seeded week, the page grows 16px at 1440, 37px at 1280,
26px at 1100 and 4px at 768, and shrinks 34px at 390. At all five widths no text crosses the
edge of its column and the document is never wider than the window, as on `main`.

**The base rules come with the file.** Controls take `font: inherit`, so a button without a
font of its own now inherits the body's 15px instead of the browser's 13.33px; the body sets a
22px line height. Some legacy values move with the mapping: `--num` 34 → 28px, `--pad` 18 →
20px, `--rowpad` 13 → 12px, `--dur` 180 → 200ms, `--rev` 550 → 380ms. The focus ring is the
full ink instead of 55% of it.

**The pairs file is kept by hand.** The test proves the pairs it is given. A ground the screens
start using without adding it to the file is a ground the test does not know about — which is
why the file says what it is for, and why the browser measurement below was done once by hand.

**Verification is the test plus a measurement.** In a browser, every element with text was
measured against the ground it actually sits on: the week at rest, an opened row inside an
overbooked day, the move panel, and the sign-in screen. Week: worst 5.54:1 dark, 5.40:1 light.
Sign-in: 6.36:1 and 5.86:1. The only pairs below 4.5:1 are disabled controls, which the
criterion exempts. The light theme was measured by setting the attribute on `<html>`, which now
works.

## Consequences

**Easier**
- Every text and edge pair the screens use is checked in both themes on every build; a token
  change that breaks one fails CI.
- The light accent passes: `alert-ink` reads 6.29:1 on `alert-surface`. The ground ADR-0024
  measured at 3.88:1 now reads 5.54:1.
- The light theme renders correctly the moment the attribute says so.

**Harder**
- Two names per token until the modules move.
- `contrast-pairs.json` has to grow with the screens.

**To revisit**
- The keycaps stay at 11px, as ADR-0024 allowed, until the modules move to the new names; the
  new scale's floor is 12px with no exception.
- The saving state the design system draws is a moving line marked `aria-hidden`, which stops
  under reduced motion. When it is built it needs words or `aria-busy`: motion cannot be the
  only signal any more than colour can.

## Action Items

1. [x] `tokens.css` replaced by Papel; the legacy block in place.
2. [x] `data-theme` on `<html>`, fixed at dark; the four attributes gone from `App.tsx`.
3. [x] Atkinson Hyperlegible Next and Mono loaded.
4. [x] `contrast-pairs.json` and the test; Vitest told to process `tokens.css`, which it would
       otherwise empty.
5. [x] `::placeholder` held to the text minimum.
6. [ ] The theme selector in settings, which writes or removes the attribute.
7. [ ] Move each module to the new names; delete the legacy block; keycaps to 12px.

---

## Português

**O contexto.** O ADR-0024 corrigiu os tokens onde eles estavam: cinzas e fundos como alfa
sobre a tinta. Assim o contraste dependia de quantas camadas se empilhavam. Ficaram dois
defeitos abertos de propósito: o acento do tema claro reprovava sobre os próprios tons (4,35:1
e 3,88:1), e o tema claro nem ligava, porque o atributo estava num `div`. A terceira rodada de
design devolveu o design system em duas direções, com os mesmos nomes de token. Recalculadas
fora da ferramenta, as duas passam em todos os pares nos dois temas.

**A decisão.** Adotar a direção 1a, Papel, já, e prender cada par num teste.

- O `tokens.css` é o arquivo do Papel, sem mudar valor. Um bloco de nomes antigos mantém os
  módulos funcionando até cada um migrar.
- O tema vai no `<html>`, fixo em escuro até as configurações escreverem o atributo. O
  `App.tsx` para de escrever os quatro atributos; densidade, peso do acento e movimento eram
  controles da ferramenta de design, não do produto.
- As fontes passam a ser Atkinson Hyperlegible Next e Mono, pelo mesmo Google Fonts de antes.
- O teste lê o `tokens.css` como ele é entregue e os pares do `contrast-pairs.json`. Ele confere
  cada par no mínimo dele, que toda cor é opaca, que o tema escuro declara todos os tokens do
  claro, que a cópia para o sistema escuro é igual ao escuro e que a fórmula dá as respostas
  conhecidas.
- Uma regra que o design não tinha: o `::placeholder` usa `--ink-3`. Vários campos só têm
  placeholder e `aria-label` como nome, e o padrão do navegador dava 3,96:1.

**Opções descartadas.**
- O Mostrador não desenhou a grade colada, que é o traço que o define, e uma explicação dele é
  falsa para os próprios valores.
- Esperar o passo 2 deixaria o teste sem token opaco para testar, e o acento do claro
  reprovando.

**Custos.**
- A mono nova é mais larga: o índice e o horário de uma linha quebram em duas nas colunas
  estreitas.
- Medido contra a `main`, nenhum texto passa da coluna e o documento nunca fica mais largo que a
  janela, nas cinco larguras.
- O arquivo de pares é mantido à mão.

**O que fica aberto.**
- As teclas de 11px até os módulos migrarem.
- O seletor de tema nas configurações.
- O estado de salvando desenhado só com movimento, que vai precisar de texto ou `aria-busy`.
