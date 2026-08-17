# ADR-0014: Hash passwords with argon2id

**Status:** Accepted
**Date:** 2026-08-17
**Deciders:** Gabriel Barros

## Context

Passwords must be stored so that a database leak does not hand over accounts. The property
that matters is not secrecy of the algorithm but **cost per guess**: a general-purpose hash
like SHA-256 is designed to be fast, and fast is exactly wrong here — an attacker with the
leaked table wants to try billions of candidates.

Modern attacks run on GPUs and ASICs, which parallelise cheaply as long as each guess needs
little memory. That is the axis on which the two credible candidates differ.

## Decision

Hash with **argon2id** via `argon2-cffi`, using the library defaults: `m=65536` (64 MiB),
`t=3`, `p=4`.

The parameters are stored inside the hash string, so they can be raised later without
invalidating existing hashes — a login can verify against the old cost and rehash at the new
one transparently.

## Options Considered

### Option A: argon2id — chosen

| Dimension | Assessment |
|---|---|
| Resistance to GPU/ASIC | High — memory-hard, 64 MiB per hash |
| Password length limit | None |
| Parameter migration | Parameters live in the hash |
| Dependency | C extension via cffi; wheels available for the target platform |

**Pros:** memory-hardness is the reason it wins. An attacker must provide 64 MiB per parallel
guess, which collapses the advantage of running thousands of GPU cores. It is the Password
Hashing Competition winner and OWASP's first recommendation. No input length ceiling, so a
long passphrase — which is a strong password — is accepted.
**Cons:** a compiled dependency rather than pure Python. And it is not the default in the Java
ecosystem, so phase 2 ([ADR-0001](0001-backend-stack.md)) must reach for
`Argon2PasswordEncoder` rather than Spring Security's default encoder.

### Option B: bcrypt

| Dimension | Assessment |
|---|---|
| Resistance to GPU/ASIC | Moderate — CPU-hard but cheap on memory |
| Password length limit | 72 bytes, rejected outright |
| Parameter migration | Cost factor lives in the hash |
| Dependency | Simpler |

**Pros:** longer track record, simpler dependency, and it is Spring Security's default
`PasswordEncoder`, which would be the shorter path in phase 2.
**Cons:** not memory-hard, so it parallelises well on hardware built for that. And it refuses
passwords over 72 bytes — verified against `bcrypt==5.0.0`, which raises `ValueError` rather
than truncating silently as older versions did. The loud failure is an improvement, but it
still forces a length cap that rules out long passphrases.

### Option C: any SHA variant — rejected outright

General-purpose digests are built to be fast. Salting fixes rainbow tables and does nothing
about throughput. This is not a trade-off, it is a mistake.

## Trade-off Analysis

The decision is memory-hardness against ecosystem familiarity. Memory-hardness addresses the
attack that actually happens to leaked password tables; the familiarity argument concerns how
convenient one line of a future port will be.

The phase 2 objection is weaker than it looks: Spring Security ships an argon2 encoder, so the
stored hashes remain portable either way. What changes is which encoder is instantiated.

## Consequences

**Easier**
- Cost parameters can be raised as hardware improves, without a forced password reset.
- No password length ceiling to explain to a user.

**Harder**
- A compiled dependency, so the image needs a wheel for the platform. Verified present for
  Linux and CPython 3.12.
- Each verification costs 64 MiB briefly. Concurrent logins are memory-bound, which is a
  denial-of-service surface that the rate limit on the login endpoint has to cover.
- Phase 2 must configure argon2 explicitly instead of taking Spring's default.

**To revisit**
- Cost parameters, when hardware or measured login latency justifies it.

## Action Items
1. [ ] Wrap hashing behind one function pair, so the algorithm is replaceable in one place.
2. [ ] Cap password length at a sane maximum before hashing. A memory-hard function with
       unbounded input is an amplification vector.
3. [ ] On login for an address that does not exist, still perform a hash of comparable cost.
       Returning early leaks whether the account exists through response timing — the same
       information the 404 decision in [ADR-0016](0016-ownership-isolation.md) refuses to give
       away explicitly.
4. [ ] Rate limit the login endpoint. Memory-hard hashing makes brute force expensive for the
       attacker and for the server.

---

## Português

**Decisão:** argon2id via `argon2-cffi`, com os padrões `m=65536, t=3, p=4`. Os parâmetros
ficam dentro da string do hash, então dá para endurecer depois sem invalidar hash existente.

**A razão é memory-hardness.** Ataque a tabela de senhas vazada roda em GPU e ASIC, que
paralelizam barato desde que cada tentativa precise de pouca memória. Exigir 64 MiB por
tentativa derruba essa vantagem. O bcrypt é caro em CPU e barato em memória.

**Verifiquei antes de afirmar:** o `bcrypt==5.0.0` **levanta erro** em senha acima de 72 bytes,
não trunca em silêncio como versões antigas. Falha alta é melhor, mas ainda obriga a limitar o
tamanho, o que exclui passphrase longa — que é senha forte.

**Nunca SHA puro.** Digest de uso geral é feito para ser rápido. Salt resolve rainbow table e
não faz nada contra throughput. Não é trade-off, é erro.

**Custo aceito:** cada verificação usa 64 MiB por um instante, então login concorrente é
limitado por memória — o que é superfície de negação de serviço e precisa do rate limit no
endpoint de login.
