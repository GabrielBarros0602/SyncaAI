# ADR-0051: A password change keeps this session, a reset keeps none, and both are told

**Status:** Accepted
**Date:** 2026-10-27
**Deciders:** Gabriel Barros

**Builds on:** [ADR-0015](0015-session-model.md), whose sessions are revocable refresh tokens
beside a stateless thirty-minute access token;
[ADR-0017](0017-refresh-token-delivery.md), which sends a browser's refresh token only to
`/api/v1/auth`; [ADR-0018](0018-email-delivery.md), whose mail never fails the action that
sends it; and [ADR-0019](0019-account-verification.md), under which a reset answers the same
whether or not the address has an account. Supersedes nothing.

## Context

A reset by emailed link exists: it sets the password and ends every open session, because
otherwise whoever knew the old password would keep a live session for up to thirty days. No
record says so; the service does. Changing the password while signed in does not exist yet,
and the settings screen as designed says "Changing it does not sign the browser out".

That is two behaviours for the same column. The difference is defensible, since whoever
follows a reset link may not be the owner, while whoever types the current password has just
proved they are. The backlog held both routes until a record said which behaviour each one
has, and why.

Answered on 2026-10-27.

## Decision

### 1. A change keeps this session and ends every other one

`POST /api/v1/auth/change-password` takes the current password and a new one, under the same
rules as registration. It sits under `/auth` because that is where a browser sends its
refresh cookie: the session that cookie names stays, and every other session of the person
ends. A native client names its session in the body, as it does to sign out. With no session
named, every one ends, as a reset does, so a change can only end more sessions than it
meant to, never fewer.

A wrong current password is refused as a field error, and attempts are limited per person on
the login limiter's budget, answering `429` with `Retry-After`. A session holder guessing the
current password is guessing a password.

### 2. A reset keeps none and opens none

`POST /api/v1/auth/reset-password` stays as it is: it ends every session and answers `204`. It
does not sign anybody in. The screen sends the person to sign in with the new password.

### 3. Both are told by email

After a change and after a reset, a short message goes to the address: the password of this
account was changed, and what to do if it was not them. It carries no link. As with every
mail here, failing to send it does not undo the change (ADR-0018).

### Where the screens go

The change belongs to settings, step 5 of the third design round. Asking for a reset link and
setting the new password from it belong to step 6, with signing in. Signing in with Google
stays out of the round: it needs a record of its own on linking an address that already has a
password.

## Options Considered

### What a change does to the sessions

| Option | Assessment |
|---|---|
| **Keep this one, end the others — chosen** | Whoever changes a password usually suspects something, and this ends any session opened with the old one while keeping the person where they are. |
| Keep every session | The design's words read literally. A stolen session outlives the change, which then secures nothing. |
| End every session, this one too | One rule for both routes. It signs the person out of the screen they just used, against the design. |
| Ask on every change | A choice most people cannot weigh, and its default still has to be picked. |

### What a reset does afterwards

| Option | Assessment |
|---|---|
| **Sign in nobody — chosen** | Signing in proves the new password works, and a link that travelled by email never becomes a session on its own. One step more. |
| Open a session | One step fewer, and whoever holds the link gets a session without ever typing the password. |

### Telling the owner

| Option | Assessment |
|---|---|
| **A message after both — chosen** | A change made by somebody else is seen at once. One more message, through the mailer that exists. |
| Nothing | Less to build, and an unwanted change goes unnoticed until the owner cannot sign in. |

## Trade-off Analysis

**The other devices keep working for up to thirty minutes.** Ending a session revokes its
refresh token; the access token already issued stays valid until it expires, because it is
checked without the database (ADR-0015). A reset has the same window, and closing it would
mean a lookup on every request.

**The change route lives under `/auth`, not beside `/me`.** It edits the person, but the only
way for the server to know which session is "this one" is the refresh cookie, and the cookie
is sent nowhere else.

**The notification is a message a stranger can trigger only with the password.** A change
needs the current password and a reset needs the link from the inbox, so the message cannot
be used to flood somebody else's address.

## Consequences

**Easier**
- Settings and the recovery screens can be designed against behaviour already decided.
- A suspected leak is answered by changing the password, without signing out of the screen.

**Harder**
- One route under `/auth` that needs both a signed-in person and their refresh token.
- One message to keep, and a test that the reset and the change both send it.

## Action Items

1. [ ] `POST /auth/change-password`: the current password, this session kept, the others
       ended, limited like login.
2. [ ] The message after a change and after a reset.
3. [ ] The settings brief (step 5) and the sign-in brief (step 6) written against this record.

---

## Português

**O problema.** O reset pelo link do e-mail já existe e encerra todas as sessões. A troca de
senha logado ainda não existe, e o desenho das configurações diz que ela não desloga o
navegador. São dois comportamentos para a mesma coluna, e o backlog pedia um ADR antes das
rotas.

**A decisão.**
- **A troca mantém esta sessão e encerra as outras.** `POST /api/v1/auth/change-password`, com
  a senha atual. Fica sob `/auth` porque é para lá que o navegador manda o cookie de refresh,
  que diz qual sessão é "esta". Sem sessão informada, encerra todas. Senha atual errada é erro
  de campo, com limite de tentativas igual ao do login.
- **O reset não mantém nenhuma e não abre nenhuma.** A tela manda a pessoa entrar com a senha
  nova.
- **Os dois avisam por e-mail,** sem link. Falhar o envio não desfaz a troca.
- **As telas:** a troca nas configurações (passo 5); pedir o link e definir a senha nova no
  passo 6, junto com entrar. Entrar com o Google fica fora da rodada.

**O que se aceita.** Os outros aparelhos ainda funcionam por até 30 minutos, até o access token
vencer, como no reset; e uma rota que mexe na pessoa mora em `/auth`, porque só lá chega o
cookie.
