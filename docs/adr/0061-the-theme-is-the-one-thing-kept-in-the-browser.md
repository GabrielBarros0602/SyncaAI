# ADR-0061: The theme is the one thing kept in the browser

**Status:** Accepted
**Date:** 2026-11-25
**Deciders:** Gabriel Barros

**Amends:** [ADR-0021](0021-browser-session-and-origin.md), action item 5. The lint rule against
`localStorage` and `sessionStorage` stays, with one exception, at one line, for the theme.
**Completes:** [ADR-0026](0026-adopt-the-papel-tokens-and-test-every-pair.md), action item 6: the
theme selector in settings, which writes or removes the attribute. Supersedes nothing.

## Context

`settings.dc.html` puts the theme under "This device". It offers System, Light and Dark, and
applies the choice as it is tapped: "Only this device, and it applies as you tap". Nothing is
saved on the server. It is the second of the drawing's three ways of saving, each where the
server draws its line, and the server draws none here.

Applying the choice is the attribute on `<html>` that the tokens read (ADR-0026). Keeping it
for the next visit needs somewhere to keep it. ADR-0021 put every credential in memory and
nowhere else, and its action item 5 enforced that with a lint rule against both browser
storages, because the access token is one convenient line away from being written to one.
The rule bans the storage, not the credential, and so it bans the theme with it.

`index.html` fixed the attribute at `dark` until settings could write it. Decision 8 of
2026-10-22 asks for a page that follows the system and a selector in settings.

Answered on 2026-11-23, as recommended.

## Decision

### 1. The theme is kept in `localStorage`

It is kept under one key, `syncaai.theme`, by one module, `src/ui/theme.ts`.
- **Light and Dark** are written there and set as the attribute.
- **System** removes both, since it is the absence of a choice.
- **Storage that refuses,** as a private window may, leaves the choice in force for the page
  and keeps nothing.

**The lint exception is one line.** It is an inline disable on the one function that reaches
the storage, with its reason. The ban stands everywhere else, including on `sessionStorage` in
that same file.

### 2. `index.html` applies it before the first paint

A short inline script reads the key and sets the attribute before any stylesheet or module
loads, so a light choice never flashes dark on the way in. It accepts only `light` and `dark`.
Anything else, nothing at all, or a storage that throws leaves the page to the system. The key
is written there as a literal, since the script runs before any module. A test runs the script
from the file itself, so a key renamed on one side only fails.

### 3. With no choice, the page follows the system

`index.html` no longer writes `dark`. Anybody whose device is light now sees the light theme
for the first time, which is decision 8 of 2026-10-22. Both themes are held to every contrast
pair by the test of ADR-0026.

## Options Considered

| Option | Assessment |
|---|---|
| **`localStorage`, one key, one module — chosen** | What the drawing asks for: on this device, and in force before the first paint. What ADR-0021 protects is a credential, and that does not change. |
| A cookie readable by script | No lint rule catches it, so it gets round the rule instead of amending it. It is also sent to the server with every request, for a value the server never reads. |
| On the server, a `users.theme` column | One theme on every device, against "This device". With the token in memory, the theme arrives only after the refresh and `/me`, so every load would flash the system's theme first. It also needs a migration. |
| Memory only | Nothing kept, and no exception. The choice is lost on every reload, which makes it close to useless. |

## Trade-off Analysis

**A script running in the page can read the theme.** It learns whether somebody prefers a
light screen. ADR-0021's argument was that nothing durable a script can take is worth taking,
and that still holds. The threat model's row on session theft is unchanged.

**An inline script is a cost for the content security policy of S11.** A policy without
`unsafe-inline` will need this script's hash, or a nonce. It is written down here so the S11
work finds it rather than a blank theme.

**The exception is enforced by review, at one line.** A second `eslint-disable` for the
storage would be just as visible in a diff. The alternative was a lint override by file, which
is the same promise made further from the line it is about.

**Nothing here is specific to Python or to the server.** The Spring port of ADR-0001 is not
touched.

## Consequences

**Easier**
- The theme can be chosen, and it holds across visits on the same device.
- The light theme, held to its contrast pairs since ADR-0026, is finally on screen.

**Harder**
- One literal, the key, lives in two files, and a test holds them together.
- S11's content security policy has one inline script to allow.

## Action Items

1. [x] `src/ui/theme.ts`, the inline script in `index.html`, and the attribute no longer fixed
       at `dark`.
2. [x] "This device" in settings, with System saying which way the device is right now.
3. [x] A test that runs the script from `index.html`.
4. [ ] S11: allow the script by its hash in the content security policy.

---

## Português

**O problema.** O desenho põe o tema em "This device", aplicado ao tocar, sem salvar no
servidor. Para durar até a próxima visita ele precisa ficar guardado em algum lugar. O lint do
ADR-0021 proíbe o armazenamento do navegador inteiro, embora o que ele protege seja a
credencial.

**A decisão.**
- **O tema vai no `localStorage`,** numa chave e num módulo só. A exceção do lint é uma linha,
  e a proibição continua valendo no resto, inclusive para o `sessionStorage` no mesmo arquivo.
- **O `index.html` aplica o tema antes da primeira pintura,** com um script curto que aceita só
  `light` e `dark`. Um teste roda esse script a partir do próprio arquivo.
- **Sem escolha, a página segue o sistema.** O `dark` fixo saiu, e quem usa o sistema claro
  passa a ver o tema claro.

**Opções descartadas.**
- **Um cookie** contornaria a regra em vez de emendá-la, e iria ao servidor em todo pedido.
- **No servidor**, o tema seria um só em todo aparelho, e cada carga piscaria até o `/me`
  responder.
- **Só em memória**, a escolha se perderia a cada reload.

**O que se aceita.** Um script na página lê o tema, que não é credencial. O script inline vai
precisar de hash na CSP do S11.

**Respondido em 2026-11-23,** como recomendado.
