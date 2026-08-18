# ADR-0018: Send mail through a transactional provider, behind an abstraction

**Status:** Accepted
**Date:** 2026-08-18
**Deciders:** Gabriel Barros

## Context

S3 exists to close account enumeration, and the mechanism is a registration response that
says the same thing whether or not the address already has an account
([ADR-0019](0019-account-verification.md)). That response is only honest if an email carries
the real answer to the address's owner.

So this is the project's **first hard external dependency**. Everything before it — the
database, the AI provider — is either ours or deliberately optional
([ADR-0006](0006-cost-limits-cache-degradation.md) made the AI layer additive). Verification
mail is not optional: without it nobody can finish signing up.

The failure mode that matters is not an error. It is **silence**. Mail that is accepted by
the provider and then filtered into spam produces no exception, no log line and no
complaint — the user simply never returns. Deliverability is therefore a design concern
rather than an operational afterthought.

## Decision

**A transactional provider**, reached through one interface with three implementations:
the real client, a console writer for local development, and a fake that records what was
sent for tests.

**Mail is sent from an owned domain**, with SPF, DKIM and DMARC published. Providers
restrict unverified domains to sending only to the account holder's own address, which
would mean nobody but the owner could ever complete registration — the feature would appear
to work and be unusable by anyone else.

**Failing to send does not fail the registration.** The account is created, the failure is
logged at a level that is noticed, and the user can ask for another mail. Losing the
account because a third party had an outage would be worse than an unverified account
sitting there.

## Options Considered

### Option A: transactional provider on an owned domain — chosen

**Pros:** the provider maintains sending-IP reputation, which is the part that decides
whether mail is read. Bounces and complaints come back as data rather than as silence. The
API is a single HTTP call, so the client is small enough to be worth wrapping rather than
adopting a library.
**Cons:** an external dependency with a key to manage, a domain to buy and keep renewed,
and DNS records that must be correct before anything works.

### Option B: transactional provider without a domain

**Pros:** free, and identical in code — the same client, the same abstraction.
**Cons:** sending is restricted to the account holder's address, so registration works for
exactly one person. Acceptable while building, not as an end state, and the difference is
configuration rather than code.

### Option C: SMTP through a personal mailbox

**Pros:** nothing new to sign up for.
**Cons:** volume limits, an app password to store, and mail from a generic consumer sender
is filtered aggressively. It fails in exactly the silent way this record is written to
avoid.

### Option D: no email, keep the 409

Rejected when the leak was scheduled rather than accepted.

## Trade-off Analysis

The abstraction is worth more than usual here. It is not provider portability for its own
sake — it is that **tests must never send mail**, and local development should not depend on
a network call or a key. Three implementations behind one interface gives all of that, and
the fake makes assertions about what would have been sent, which is how the enumeration
guarantee gets tested at all: the two registration *responses* are identical by design, so
the only observable difference is which mail was produced.

Sending from an owned domain looks like polish and is not. Without it the feature is
demonstrable only by its author, which for a portfolio project means it cannot be shown
working.

## Consequences

**Easier**
- Tests assert on messages without a network, a key or a mailbox.
- Local development shows the message in the console, so the verification link is one copy
  away during development.

**Harder**
- A domain to buy and renew, and DNS records that must be right before the first real send.
- A provider key joins the secrets that must never reach a client, alongside the AI key.
- Bounce and complaint handling has no home yet; a hard bounce means an address that will
  never verify and nothing currently notices.

**To revisit**
- Bounce handling, once there is somewhere for it to go.
- Whether sending moves onto the job queue built in S6. It is the same shape of problem as
  the AI call — slow, external, worth retrying — and it would be strange to solve twice.

## Action Items
1. [ ] Register the domain; publish SPF, DKIM and DMARC.
2. [ ] `Mailer` interface with real, console and fake implementations.
3. [ ] Provider key in settings, required in production and absent in tests.
4. [ ] Log a failed send at a level that is actually seen, with the address hashed rather
       than written in the clear.

---

## Português

**Decisão:** provedor transacional atrás de uma interface com três implementações — cliente
real, escrita no console para desenvolvimento local, e dublê que registra o que seria
enviado para os testes. Envio a partir de **domínio próprio**, com SPF, DKIM e DMARC.

**O modo de falha que importa não é erro, é silêncio.** Email aceito pelo provedor e
filtrado como spam não gera exceção, nem log, nem reclamação — o usuário simplesmente não
volta. Por isso deliverabilidade é decisão de projeto e não detalhe de operação.

**Por que domínio próprio não é polimento:** provedor restringe domínio não verificado ao
endereço do próprio dono da conta. Sem domínio, a feature funciona para exatamente uma
pessoa — você — e não pode ser demonstrada.

**Falha de envio não derruba o cadastro.** A conta é criada, a falha é registrada e o
usuário pode pedir outro email. Perder a conta porque um terceiro estava fora seria pior.

**Por que a abstração vale mais que o normal aqui:** não é portabilidade entre provedores.
É que **teste nunca pode enviar email**, e que o dublê é o único jeito de testar a garantia
de não enumeração — as duas respostas de cadastro são idênticas de propósito, então a única
diferença observável é qual mensagem foi produzida.

**Esta é a primeira dependência externa dura do projeto.** O banco é nosso; a camada de IA
foi feita opcional de propósito. Verificação não é: sem ela ninguém termina o cadastro.
