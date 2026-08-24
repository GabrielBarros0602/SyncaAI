# ADR-0021: Browser session handling and origin strategy

**Status:** Accepted
**Date:** 2026-08-24
**Deciders:** Gabriel Barros

> **Correction.** This record says refresh tokens are single-use and that a second
> concurrent exchange would revoke the first. That is wrong today: `POST /auth/refresh`
> does not rotate the token, and [ADR-0015](0015-session-model.md) explicitly leaves
> "rotation with reuse detection" as a later step. A second concurrent exchange is
> currently wasteful, not destructive. The decision to share one in-flight refresh stands,
> for a different reason: it is what keeps the client correct on the day rotation lands,
> when the second exchange *would* present a consumed token and sign the user out.

## Context

S5 is the first sprint with a browser in it. Two questions have to be answered before a
single component is written, and they are the same question wearing two hats: **what can a
script running on the page get hold of?**

[ADR-0017](0017-refresh-token-delivery.md) already answered half of it for the refresh
token. A web client never receives that token in a response body; it arrives as a cookie
that is `HttpOnly`, `SameSite=Strict`, and `Path`-scoped to the auth endpoints. The reason
given there was blunt: handing a browser a thirty-day credential a script can read cancels
the reason the access token is short.

That leaves the access token itself, and it leaves the question of what origin the browser
talks to — which turns out to constrain the first one, because `SameSite=Strict` only holds
if the request is same-site to begin with.

A third force is worth naming, because it argues the other way throughout: **this front end
is disposable.** The roadmap says so — S8 replaces it wholesale when the full prototype
lands. Every paragraph below is spending effort on code with a known expiry date.

## Decision

### The browser talks to one origin

The Vite dev server proxies `/api/*` to the API. The browser only ever sees
`http://localhost:5173`; it never issues a cross-origin request.

**The API gains no CORS middleware.** It has none today, and S5 does not add one.

### The access token lives in memory only

It is held in application state and written to no browser storage — not `localStorage`, not
`sessionStorage`, not a cookie the page can read. On boot, and after any `401`, the client
calls `POST /api/v1/auth/refresh`, which succeeds on the strength of the `HttpOnly` cookie
and returns a fresh access token.

## Options Considered

### Reaching the API

| Option | Assessment |
|--------|------------|
| **Vite proxy, one origin — chosen** | No CORS anywhere. `SameSite=Strict` holds without an exception. Six lines of config. |
| CORS with credentials | Flexible deployment across domains, at the cost of `allow_credentials` plus an explicit origin list that must be right in three environments — and if the two hosts ever stop being same-site, the cookie has to become `SameSite=None`, which reopens CSRF and requires an anti-CSRF token that does not exist. |
| FastAPI serving the built assets | Same origin for free, one process, no proxy. Loses hot reload, so every CSS change becomes a build — slow in exactly the phase where iterating quickly matters. |

### Where the access token lives

| Option | Assessment |
|--------|------------|
| **Memory only — chosen** | Nothing durable for a script to read. Costs a round trip per page load and a real "session unknown" state. |
| `localStorage` | Free page refresh, no silent refresh code. A script can copy a thirty-minute bearer token and use it from another machine. |
| `sessionStorage` | Same exposure to a script on the page as `localStorage`; the only thing it buys is a token that does not outlive the tab on a shared computer. |

## Trade-off Analysis

**What memory-only does not buy, stated plainly.** It does not stop a script that is already
executing on the page. With the cookie present, that script can call `POST /auth/refresh`
itself — the cookie rides along, same-origin, `SameSite=Strict` satisfied — and get a valid
access token. Anyone claiming this design "prevents XSS" is wrong.

What it does buy is narrower and real: **the attacker cannot take a working credential off
the victim's browser.** Both the refresh token and the access token stay unreadable to
script, so an attack has to be conducted live, through the open tab, proxied by the victim's
own machine. That is a materially harder attack than copying a string out of `localStorage`
and replaying it later from anywhere.

**The client complexity is a cost absorbed on purpose.** Memory-only is the expensive choice
by a clear margin — it is the only genuine complexity in the whole S5 front end. It buys a
session state with three values rather than two (`loading`, `authenticated`, `anonymous`), a
refresh-on-boot before anything can render, a retry-once-after-`401` wrapper around every
call, and de-duplication so two concurrent requests failing at the same moment do not fire
two refreshes. Roughly forty lines that would otherwise be zero.

That cost is accepted deliberately, to preserve the property ADR-0017 paid for: **no durable
script-readable credential, anywhere.** Storing the access token on disk after having
refused to store the refresh token would leave this project holding an inconsistency at its
most examined seam — the one a reviewer reaches first. The consistency is the asset, and
forty lines is the price of not breaking it.

**The disposability argument, and why it loses.** This front end is replaced in S8, so
spending on it is spending on something with an expiry date. The counter is that the
*decision* is not disposable even though the code is: S8 inherits whichever posture is
established here, and a security posture is far more expensive to tighten later than to
start correct. The forty lines are also the part most likely to survive verbatim.

**The proxy pushes a problem into deployment.** One origin in development means one origin in
production, so the two have to be served behind the same host — a reverse proxy, or FastAPI
serving the built assets. That is S11 work, and it collides with a pending question already
recorded there: behind a proxy, `request.client.host` is the proxy's address and the rate
limiter collapses into a single global bucket. The proxy decision makes that pendency
certain rather than hypothetical, which is an argument for it being written down now.

## Consequences

**Easier**
- The API needs no change at all for S5. The front end is structurally incapable of forcing
  a security regression into it, because there is no origin list to widen and no
  `allow_credentials` to turn on.
- `SameSite=Strict` survives untouched, so cross-site CSRF stays closed by construction
  rather than by a token the code has to remember to check.
- A stolen access token is not a thing that exists at rest, so there is no revocation story
  to invent for one.

**Harder**
- A page refresh costs a round trip before anything renders, and the "session unknown" state
  has to be handled or the login screen flashes on every reload.
- Two concurrent requests failing on the same expired token must not trigger two refreshes.
  See the correction above: harmless today, a forced sign-out once rotation exists.
- Development now depends on a proxy being configured correctly. A misconfigured one fails
  as a 404 on `/api/...`, which reads like a missing endpoint rather than a missing rewrite.

**To revisit**
- Production must serve both from one host (S11), which makes proxy-aware rate limiting a
  requirement rather than a nice-to-have.
- If a native client is ever built, it takes the `native` path of ADR-0017 and none of this
  applies to it.

## Action Items

1. [ ] `vite.config.ts` proxies `/api` to `http://localhost:8000`.
2. [ ] Session state has three values, and nothing renders until refresh-on-boot settles.
3. [ ] One HTTP wrapper owns retry-after-`401`, and a single in-flight refresh is shared.
4. [ ] A test that two simultaneous `401`s cause exactly one call to `/auth/refresh`.
5. [ ] No `localStorage` or `sessionStorage` call anywhere in `apps/web`, enforced by lint
   rather than by review.

---

## Português

**Duas perguntas, uma só pergunta de fato: o que um script rodando na página consegue
pegar?**

**O navegador fala com uma origem só.** O Vite encaminha `/api/*` para a API. Nenhum pedido
cross-origin, e portanto **nenhum CORS na API** — ela não tem hoje e o S5 não adiciona. O
`SameSite=Strict` do cookie continua valendo sem exceção.

**O access token vive só em memória.** Nada em `localStorage` nem em `sessionStorage`. No
boot e após qualquer `401`, o cliente chama `POST /auth/refresh`, que funciona por causa do
cookie `HttpOnly`.

**O que isso não compra, dito sem enfeite.** Não impede um XSS que já está executando: com o
cookie presente, o próprio script chama `/auth/refresh` e recebe um token válido. Quem disser
que este desenho "previne XSS" está errado.

**O que compra é mais estreito e é real:** o atacante não consegue tirar credencial usável de
dentro do navegador da vítima. Nem o refresh nem o access token são legíveis por script, então
o ataque tem que ser conduzido ao vivo, pela aba aberta, com a máquina da vítima no meio. É
bem mais caro que copiar uma string do `localStorage` e reusar depois de qualquer lugar.

**A complexidade do cliente foi custo absorvido de propósito.** Memória é a escolha cara — é
a única complexidade de verdade no front-end inteiro do S5. Cobra estado de sessão com três
valores em vez de dois, refresh no boot antes de renderizar qualquer coisa, repetição após
`401` em toda chamada, e deduplicação para dois pedidos simultâneos não dispararem dois
refreshes. Umas quarenta linhas que seriam zero.

Esse custo foi aceito para preservar a propriedade que o ADR-0017 comprou: **nenhuma
credencial durável legível por script, em lugar nenhum.** Guardar o access token em disco
depois de ter recusado guardar o refresh token deixaria o projeto com uma incoerência
justamente na costura mais examinada — a primeira que um revisor alcança. A coerência é o
ativo; quarenta linhas é o preço de não quebrá-la.

**O argumento do descartável, e por que ele perde.** Este front-end morre no S8. Mas a
*decisão* não é descartável mesmo que o código seja: o S8 herda a postura estabelecida aqui,
e postura de segurança é muito mais cara de apertar depois do que de começar certa.

**O proxy empurra um problema para o deploy.** Uma origem em desenvolvimento significa uma
origem em produção, então os dois precisam ficar atrás do mesmo host. Isso é S11, e esbarra
numa pendência já registrada lá: atrás de proxy, `request.client.host` é o endereço do proxy
e o rate limit vira um balde global. Esta decisão torna aquela pendência certa em vez de
hipotética.
