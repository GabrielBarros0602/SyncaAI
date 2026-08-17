# ADR-0015: Short-lived access token with a revocable opaque refresh token

**Status:** Accepted
**Date:** 2026-08-17
**Deciders:** Gabriel Barros

## Context

A session has to survive a page reload, because the interface arriving in S4 is useless
otherwise. It also has to be cancellable, and the reason is specific to this product rather
than generic security hygiene: [ADR-0006](0006-cost-limits-cache-degradation.md) puts a
monthly spend cap on the AI layer per user. A stolen credential here is not only read access
to a calendar — it is somebody spending money on the owner's provider account. A credential
that cannot be revoked means the only remedy is rotating a global signing secret and logging
everyone out.

That pulls against the appeal of a stateless token, which is that no database is consulted per
request.

## Decision

Two credentials with different jobs.

**Access token** — a JWT, 30 minutes, signed HS256, sent in the `Authorization` header.
Stateless: no database lookup per request. Never written to browser storage.

**Refresh token** — an opaque random string, 30 days, returned to the client and stored in the
database **hashed**, alongside its user, expiry and revocation state. Exchanged at a refresh
endpoint for a new access token.

The refresh token is hashed at rest for the same reason passwords are
([ADR-0014](0014-password-hashing-with-argon2id.md)): a database leak should not hand over live
sessions. A fast hash suffices, because unlike a password it is high-entropy random and not
guessable.

HS256 rather than RS256: there is one service issuing and one verifying, so an asymmetric key
pair buys nothing and adds key management.

## Options Considered

### Option A: short access token plus revocable refresh token — chosen

**Pros:** the common path — verifying a request — touches no database. Revocation exists, and
its blast radius is one session rather than everyone. A 30-minute access token bounds the
damage of a leak even before revocation. The `Authorization` header keeps the `curl` demo in
the README straightforward.
**Cons:** two credentials, a refresh endpoint, and a table. The client must handle a 401 by
refreshing and retrying, which is real front-end work in S4.

### Option B: one long-lived JWT, no refresh

**Pros:** the simplest thing that works. No table, no refresh endpoint, trivial demo.
**Cons:** a stolen token is valid until it expires and **cannot be revoked**. The usual fix is
a blocklist — which is the table this option existed to avoid, arrived at by a worse route.
Given the spend cap, "wait a week for it to expire" is not an acceptable incident response.

### Option C: access and refresh both in httpOnly cookies

**Pros:** strongest against token theft by cross-site scripting, since JavaScript cannot read
the cookie.
**Cons:** requires CSRF protection for every state-changing request, which is machinery this
project does not otherwise need. It also makes the `curl` demo awkward, and the demo is a
deliverable in S10.

## Trade-off Analysis

The choice is not really "stateless versus stateful" — Option A is both, splitting the two
concerns so each gets the property it needs. Requests are hot and need to be cheap, so the
access token is stateless. Sessions are long and need to be cancellable, so the refresh token
is a database row.

Option C is defensible and was rejected on cost, not on merit. Its advantage — immunity to
script-based theft — is real, and it becomes the right answer if the front end ever holds the
access token somewhere a script can reach. The mitigation chosen instead is that the access
token lives in memory only and is short-lived; S4 must honour that, or this decision quietly
becomes worse than Option C.

Rotation and reuse detection — issuing a new refresh token on each use and revoking the whole
family if an old one reappears — is deliberately out of scope. It is the correct next step and
it is recorded as such, but the value of this record is revocability, which rotation does not
provide.

## Consequences

**Easier**
- A compromised session can be ended without touching anyone else.
- Verifying a request stays a signature check.
- The 30-minute window limits exposure even with no action taken.

**Harder**
- A refresh endpoint, a table, and expiry cleanup.
- The front end must implement refresh-on-401 and avoid a refresh storm when several requests
  fail at once.
- The signing secret becomes a real secret: it must come from configuration, never be
  committed, and rotating it invalidates every access token in flight.

**To revisit**
- Refresh token rotation with reuse detection.
- Cookie delivery for the refresh token specifically, which would keep the header for the API
  and remove the refresh token from script reach.

## Action Items
1. [ ] `JWT_SECRET`, `ACCESS_TOKEN_MINUTES` and `REFRESH_TOKEN_DAYS` in settings, with the
       secret required and no default, matching how `database_url` fails at boot when absent.
2. [ ] `refresh_tokens` table: user, hashed token, expiry, revoked-at, created-at.
3. [ ] Refresh endpoint rejecting expired, revoked and unknown tokens with the same response,
       so it reveals nothing about which.
4. [ ] Logout revokes the presented refresh token.
5. [ ] A test asserting a revoked refresh token cannot mint an access token.

---

## Português

**Decisão:** dois credenciais com funções diferentes.

**Access token** — JWT de 30 minutos, HS256, no header `Authorization`. Sem consulta ao banco
por requisição, e nunca gravado em storage do navegador.

**Refresh token** — string opaca aleatória de 30 dias, guardada **hasheada** no banco com dono,
expiração e estado de revogação. Trocada por access token novo num endpoint de refresh.

**Por que revogável, e o motivo é deste produto:** o ADR-0006 põe teto de gasto mensal por
usuário na camada de IA. Credencial roubada aqui não é só leitura de calendário — é alguém
gastando dinheiro na conta do provedor. Sem revogação, a única saída seria rotacionar o segredo
global e derrubar a sessão de todo mundo.

**Por que hashear o refresh no banco:** mesma razão da senha — vazamento de banco não deve
entregar sessão viva. Hash rápido basta, porque diferente de senha ele é aleatório de alta
entropia e não é chutável.

**HS256 e não RS256:** um serviço emite e um verifica. Par de chaves assimétrico não compra
nada e adiciona gestão de chave.

**Rotação com detecção de reuso ficou fora de propósito.** É o próximo passo correto e está
registrado como tal, mas o valor deste registro é revogabilidade, que rotação não fornece.

**Uma dívida que o S4 tem que honrar:** o access token vive só em memória. Se o front-end
guardá-lo onde script alcança, esta decisão fica pior que a opção de cookie que eu recusei.
