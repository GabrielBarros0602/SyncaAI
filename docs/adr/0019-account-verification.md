# ADR-0019: Verify addresses, and make every authentication response generic

**Status:** Accepted
**Date:** 2026-08-18
**Deciders:** Gabriel Barros

## Context

Registration currently answers `409` when an address already has an account, which tells
any caller which addresses are registered. That is the same information login spends argon2
time to conceal, and threat 3 of the [threat model](../threat-model.md).

The fix is not a vaguer error message. A generic registration response — *"if this address
is new, check your mail"* — is a lie unless mail actually goes out, and a lie that also
strands a legitimate user who mistyped nothing and simply already has an account.

**Closing the leak requires every authentication response to be generic, not just this
one.** Password reset asks the same question in a different shape. So does login, once
accounts have a verified state and an unverified one could be reported differently. If a
single path stays specific, the leak has only changed door and the sprint bought nothing.

## Decision

### Registration always answers 202

Identical body, identical status, whether the address is new or already registered. The
mail decides what the owner learns: a verification link for a new address, or a note that
someone tried to register with theirs.

That second message is not padding. An address that receives it has just learned that
somebody is probing it, which is information its owner is entitled to and an attacker
cannot see.

### Verification tokens

Random, opaque, stored as a digest, single use, expiring in 24 hours. Same reasoning as the
refresh token ([ADR-0015](0015-session-model.md)): high entropy means guessing is not the
threat, a database leak is, and a digest answers that.

Single use and a short life matter more here than for a session token, because **the token
travels in a URL**. It lands in browser history, and it is exposed in a `Referer` header to
anything the verification page loads. Neither is preventable from the server; both are
survivable if the token is spent within a day and dies on first use.

### An unverified account cannot log in

Wrong credentials answer the generic `401` they always did. **Correct** credentials for an
unverified account answer `403`, saying plainly that the address needs verifying.

That distinction leaks nothing, and the reason is worth stating because it looks like it
should. It is only reachable *after* authentication succeeds — and a caller holding the
right password already knows the account exists. There is nothing left to disclose.

Blocking rather than degrading also closes the most expensive abuse: an account opened with
an address nobody controls, spending the AI budget that
[ADR-0006](0006-cost-limits-cache-degradation.md) caps per user.

### Password reset answers the same way regardless

One response whether or not the address has an account, for the same reason as
registration.

## Options Considered

### Whether an unverified account may log in

| Option | Assessment |
|---|---|
| Blocked — **chosen** | Simplest to reason about and closes the budget abuse. Costs a user who never received the mail a dead end, mitigated by resending. |
| Allowed, with the AI layer withheld | Ties the control to the asset that costs money, which is the threat model's framing. But it introduces a second permission level that every later authorisation decision has to carry. |
| Allowed with no restriction | No friction, and verification becomes a formality — an account with an address nobody owns keeps consuming resources. |

### What the second message says

| Option | Assessment |
|---|---|
| Tell the owner someone tried — **chosen** | The owner learns their address is being probed. Costs one more template. |
| Send nothing to an existing address | Fewer messages, and an address that is being probed never finds out. Also makes the two paths differ in observable cost, which is a weaker version of the leak. |

## Trade-off Analysis

The expensive part of this decision is not the code. It is that a user who does not receive
the mail is completely stuck: they cannot log in, and the only way out is a resend they must
think to ask for. That is the cost of blocking, and it converts a deliverability problem
directly into a support problem — which is why [ADR-0018](0018-email-delivery.md) treats
deliverability as a design concern rather than an operational one.

The resend endpoint is the pressure valve and is itself an attack surface: unlimited, it
sends mail to any address on demand, which is a way to use this service to harass someone
else's inbox. It gets its own limit, tighter than login's.

## Consequences

**Easier**
- Registration, login and password reset stop being oracles for which addresses exist.
- An address that is being probed hears about it.

**Harder**
- A user who does not receive the mail cannot get in at all.
- Three flows must be kept generic forever; a future endpoint that reports "no such
  account" quietly reopens all of this.
- Verification state joins every account, and the login path grows a branch.

**To revisit**
- Whether the verification link should be consumed by a `POST` from a page rather than a
  `GET`, once there is a front end. It would keep the token out of the `Referer` header
  entirely, at the cost of an extra click.

## Action Items
1. [ ] Registration answers 202 with the same body in both cases.
2. [ ] A test asserting the two responses are byte-for-byte identical, and that the
       difference is only in which mail the fake mailer recorded.
3. [ ] Verification tokens: digest at rest, single use, 24-hour expiry.
4. [ ] Login returns 403 for correct credentials on an unverified account, and the generic
       401 for everything else.
5. [ ] Resend endpoint with a limit tighter than login's.
6. [ ] Password reset answers identically whether or not the address exists.

---

## Português

**Cadastro sempre responde 202**, mesmo corpo e mesmo status, exista ou não a conta. O
**email** decide o que o dono descobre: link de verificação para endereço novo, ou aviso de
que alguém tentou se cadastrar com o dele. O segundo não é enfeite — quem recebe acabou de
saber que está sendo sondado, e o atacante não vê isso.

**Fechar o vazamento exige que todas as respostas de autenticação fiquem genéricas.**
Recuperação de senha faz a mesma pergunta em outra forma; login também, quando passa a
existir estado de verificação. Se um caminho continuar específico, o vazamento só mudou de
porta e o sprint não comprou nada.

**Token de verificação:** opaco, guardado como digest, uso único, 24 horas. Uso único e vida
curta importam mais aqui que num token de sessão porque **ele viaja numa URL** — entra no
histórico do navegador e vaza por `Referer` para o que a página carregar. Nada disso é
evitável do servidor; tudo é sobrevivível se o token morre no primeiro uso e expira em um dia.

**Conta não verificada não faz login.** Credencial errada continua no 401 genérico;
credencial **certa** em conta não verificada recebe 403 dizendo o motivo. Isso não vaza nada:
só é alcançável depois da autenticação dar certo, e quem tem a senha correta já sabia que a
conta existe.

**O custo real não é código.** É que quem não recebe o email fica preso, e a única saída é um
reenvio que a pessoa precisa lembrar de pedir. Problema de entrega vira problema de suporte —
por isso o ADR-0018 trata deliverabilidade como decisão de projeto.

**O reenvio é a válvula de escape e é superfície de ataque:** sem limite, ele manda email para
qualquer endereço sob demanda, ou seja, permite usar este serviço para incomodar a caixa de
entrada de outra pessoa. Limite próprio, mais apertado que o do login.
