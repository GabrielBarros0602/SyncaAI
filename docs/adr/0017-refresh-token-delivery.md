# ADR-0017: Deliver the refresh token by cookie to browsers and in the body to native clients

**Status:** Accepted
**Date:** 2026-08-17
**Deciders:** Gabriel Barros
**Extends:** [ADR-0015](0015-session-model.md)

## Context

[ADR-0015](0015-session-model.md) decided the session shape — a 30-minute access token and
a revocable 30-day refresh token — and said the access token is never written to browser
storage, so that a cross-site scripting flaw captures at most half an hour of access.

**It did not say where the refresh token goes, and that omission undoes the reasoning.** A
refresh token must survive a page reload, or it serves no purpose. The only place a browser
can keep something across reloads and still read it from JavaScript is `localStorage`. So
returning the refresh token in the response body means a script-based compromise yields a
thirty-day credential — strictly worse than the thirty-minute token the decision went out of
its way to keep out of storage.

ADR-0015 listed exactly this as a thing to revisit. It is being decided now rather than after
S5 builds a front end against the body contract, because the retrofit would then include a
client.

A second requirement arrived with the decision: the project is a web application today, but
the API should not foreclose a mobile or desktop client. Those have somewhere genuinely safer
than a browser to put a long-lived credential — the platform keychain — so forcing them
through a cookie would be worse, not better.

## Decision

The client states what it is, and the server chooses the delivery.

`POST /api/v1/auth/login` takes `client`, one of `web` or `native`, defaulting to `web`.

- **`web`** — the refresh token is set as a cookie: `HttpOnly`, `SameSite=Strict`, `Path`
  scoped to the auth endpoints, `Secure` outside local development. It is **absent from the
  response body**.
- **`native`** — the refresh token is returned in the body. No cookie is set.

`POST /api/v1/auth/refresh` accepts the token from either the cookie or the body, so each
client uses the channel it was given.

## Options Considered

### Option A: body only, as ADR-0015 implied

**Pros:** one contract, and a `curl` demo needs no cookie jar.
**Cons:** hands a browser client a thirty-day credential that a script can read, which
cancels the reason the access token is short.

### Option B: cookie only

**Pros:** the strongest single answer for a browser. Nothing script-readable at any point.
**Cons:** a native client would have to implement cookie handling to reach an API it could
otherwise call with a header, and store the credential somewhere less appropriate than the
platform keychain.

### Option C: both, chosen by the client — chosen

**Pros:** each client gets the channel that is safest for it. A future mobile or desktop
client is not blocked, which was the requirement.
**Cons:** two delivery paths to audit. And the obvious failure mode is a browser client
taking the body path because it is more convenient, which would silently reduce this to
Option A.

## Trade-off Analysis

Option C's weakness is real, and the design answers it by making delivery **exclusive rather
than additive**. The response never contains both. A browser that wanted the body would have
to declare itself native, which is a deliberate change to its request rather than a
convenient default — visible in code review and in a request log, instead of being a field
somebody happened to read.

That is the whole reason `client` is a request field rather than the response carrying both
and letting the caller pick.

`Secure` is disabled in local development only, and that is the one place in the application
where `app_env` changes a security property. It is worth naming as a risk: an environment
misconfigured as `local` in production would ship a cookie without `Secure`. The mitigation
is that the flag is asserted by a test at the production setting, not merely at the default.

Rotation and reuse detection remain out of scope, as ADR-0015 recorded.

## Consequences

**Easier**
- A browser compromise through script no longer reaches the long-lived credential.
- A native client is a supported case rather than a future migration.

**Harder**
- Two paths, so a change to session handling has to be reasoned about twice.
- The `curl` demo in S11 needs `-c` and `-b` for the browser path, or has to declare itself
  native.
- `SameSite=Strict` means a refresh will not happen on a cross-site navigation into the app.
  Acceptable: the access token in memory is gone after a reload anyway, and the client
  refreshes on its first authenticated call.

**To revisit**
- Rotation with reuse detection, which neither this record nor ADR-0015 provides.
- Whether `native` should require something stronger than a self-declared field once there
  is an actual native client.

---

## Português

**O que eu encontrei:** o ADR-0015 disse que o access token nunca vai para storage do
navegador, para um XSS capturar no máximo 30 minutos. **Mas não disse onde o refresh token
fica** — e o refresh precisa sobreviver a reload, então num navegador o único lugar
legível por script é o `localStorage`. Devolver no corpo entregaria uma credencial de **30
dias**, pior que os 30 minutos que a decisão evitou. A omissão anulava o raciocínio.

**Decisão:** o cliente declara o que é, e o servidor escolhe a entrega. `client: "web"`
recebe cookie `HttpOnly`, `SameSite=Strict`, com `Path` restrito aos endpoints de auth e
`Secure` fora do desenvolvimento local — e o refresh **não aparece no corpo**.
`client: "native"` recebe no corpo e não recebe cookie, porque Keychain e Keystore são
lugares melhores que qualquer coisa que um navegador ofereça.

**A entrega é exclusiva, não somada.** A resposta nunca traz os dois. Um cliente de
navegador que quisesse o corpo teria que se declarar nativo — ato deliberado, visível em
revisão e em log, em vez de um campo que alguém leu por conveniência. É por isso que
`client` é campo de requisição e não a resposta trazendo ambos.

**Risco nomeado:** `Secure` desligado só em local é o único ponto do sistema onde `app_env`
muda propriedade de segurança. Ambiente mal configurado como `local` em produção enviaria
cookie sem `Secure`. A mitigação é um teste afirmando a flag no ajuste de produção, não
apenas no padrão.
