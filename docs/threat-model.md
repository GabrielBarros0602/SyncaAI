# Threat model

A record of what is worth protecting in SyncaAI, who would realistically try, what is
already in the way, and what is not. It is written to be falsifiable: every mitigation
points at where it lives, and every gap says when it is dealt with.

Most of the reasoning already exists inside individual ADRs. What did not exist was the
single view, and a decision looks different next to the others than it does alone.

**Reviewed at:** end of S3, 53 commits.

**Next review — two triggers, replacing a date that went stale:**

1. **When item 2 of [`backlog.md`](backlog.md) is finished and the three screens exist.** The
   front end is the surface the old trigger was pointing at, and it is still being built:
   delete, move, settings and address confirmation are not there yet. Reviewing halfway means
   reviewing twice, and the second one is the only one that would have counted.
2. **Before a real provider is wired in S7.** Sending a user's calendar to a paid third party
   is a new class of exposure rather than more of this one. Four rows describe that day and
   not one of them has running code behind it: 12 and 15 are *mitigated by design*, 13 is
   *designed, not built*, and 14 — prompt injection — is *not yet considered* at all. They
   stop being paper together, which is the moment to have read them together.

The trigger this replaces was *end of S5*. S5 finished, the review did not happen, and rows 10
and 13 were amended outside any review — found on 2026-09-02, written on 2026-09-03, with the
account of how below rather than smoothed over. A sprint number is a date in disguise; both
triggers above name a thing that will exist, and one of them is a gate rather than a milestone.

## Method

Assets first, then who would go after them, then what could go wrong, then what stands in
the way. Threats are rated by how likely they are **for this system**, not in general — a
personal calendar with a handful of users attracts different attention than a bank.

## What is worth protecting

| Asset | Why it matters |
|---|---|
| Calendar content | The most sensitive data here. Where someone is, when, and what they are doing. [ADR-0004](adr/0004-context-assembly-policy.md) already treats it as the thing to keep from leaving. |
| Credentials | Passwords and session tokens. Compromise gives everything above. |
| The AI provider key, and the spend behind it | Not just access — money. [ADR-0006](adr/0006-cost-limits-cache-degradation.md) exists because a stolen session spends the owner's balance. |
| Availability | A planning tool nobody can reach is a planning tool nobody uses. Lowest of the four. |

## Who would realistically try

Named honestly, including who would not.

**Automated opportunistic scanning — by far the most likely.** Bots that find any public
host and try known paths, default credentials, and passwords from public breach dumps. It
does not care what SyncaAI is. Everything it does is cheap and untargeted.

**Someone who read the repository.** The repository is public, so an attacker knows the
stack, the endpoints, the token lifetimes and the hashing parameters. This is a premise
rather than a problem: a design that needs those hidden was already broken. It does mean
obscurity is never available as a mitigation here.

**One user against another.** The multi-tenant boundary.
[ADR-0002](adr/0002-mvp-scope-ai-features.md) called this the most likely security failure
of the project, and the reason is that it does not need an attacker at all — one forgotten
`WHERE` produces it.

**Not in scope, and worth saying so:** a targeted attacker willing to spend real money, an
insider (there is one developer), and a supply-chain attack aimed specifically at this
project. Defending against those would cost more than the asset is worth, and pretending
otherwise would make the rest of this document less trustworthy.

## Where each threat stands

| # | Threat | Status | Where |
|---|---|---|---|
| 1 | Password database leak turns into account takeover | mitigated | argon2id, memory-hard, [ADR-0014](adr/0014-password-hashing-with-argon2id.md) |
| 2 | Credential stuffing from public breach dumps | partial | rate limited per address; no breach-list check on chosen passwords. Verification now stops an account being opened on an address nobody controls |
| 3 | Account enumeration | mitigated | registration, resend and password reset all answer identically whether or not the address exists; the mail carries what the response withholds ([ADR-0019](adr/0019-account-verification.md)) |
| 4 | Session theft through cross-site scripting | partial | refresh token is `HttpOnly` and unreadable by script ([ADR-0017](adr/0017-refresh-token-delivery.md)); the access token depends on S5 keeping it in memory |
| 5 | Database leak yields live sessions | mitigated | only the digest is stored, [ADR-0015](adr/0015-session-model.md) |
| 6 | A compromised session cannot be ended | mitigated | refresh tokens are revocable rows |
| 7 | One user reads another's data | mitigated, unexercised | filter lives in a base with no unscoped read ([ADR-0016](adr/0016-ownership-isolation.md)); **no endpoint uses it until S4** |
| 8 | Token forgery | mitigated | HS256, secret refused below 32 bytes at boot, type claim checked, expiry required |
| 9 | Cross-site request forgery | **open** | `SameSite=Strict` helps; no CORS policy exists yet and the naive one is dangerous — S5 |
| 10 | Memory exhaustion through argon2 | mitigated | two bounds, not one: rate limited per caller, **and the input is capped** — `MAX_PASSWORD_LENGTH` is 128 on register, login and reset. Frequency alone would not be enough, because a memory-hard function with unbounded input lets the caller choose how much work one attempt costs |
| 11 | Locking a victim out by failing their logins | accepted | there is no lockout, on purpose — see below |
| 12 | AI provider key reaching a client | mitigated by design | server-side only, [ADR-0001](adr/0001-backend-stack.md); not yet built |
| 13 | AI spend abused | designed, not built | per-user cap and a global kill switch, [ADR-0006](adr/0006-cost-limits-cache-degradation.md). The one piece that exists in code is the 4000-character bound on `notes`: ADR-0004 sends the invoked task's note to the provider, and ADR-0006 estimates spend *before* the call, so without a bound that estimate has no defined worst case |
| 14 | Prompt injection steering the AI layer | **not yet considered** | S6 and S7 |
| 15 | Calendar content leaving to the AI provider | mitigated by design | allowlist, aggregates only, [ADR-0004](adr/0004-context-assembly-policy.md) |
| 16 | Request-volume denial of service | not mitigated | only the auth endpoints are limited; the rest belongs to a proxy — S11 |
| 17 | Secrets committed to the repository | mitigated | `.env` ignored, `.env.example` carries no real value, verified in review |
| 18 | Known-vulnerable dependency | **open** | nothing scans; lockfiles pin versions, which freezes vulnerabilities as reliably as it freezes behaviour |

### How rows 10 and 13 came to be amended — found 2026-09-02, written 2026-09-03

Recorded because a threat model that only ever shows its corrected state is not falsifiable,
which is what the opening paragraph claims this one is.

`MAX_PASSWORD_LENGTH` has been applied on three endpoints since S2, and the comment where it
is defined says exactly why — *a memory-hard function with unbounded input is an amplification
vector; the caller chooses how much work the server does.* It appeared in this document zero
times. Row 10 credited the rate limit and nothing else, so the frequency of an attempt was
recorded as bounded while the cost of one was bounded only in the code.

It surfaced sideways. `notes` was the last free-text field with no limit, the screen was about
to offer a textarea for it, and asking what bounds that field led to asking which other input
bounds this document knows about. The answer was none.

Two things follow, and neither is comfortable. **A mitigation applied but unrecorded is
indistinguishable from one that was never applied** — anybody reading this to decide whether
argon2 was safe here would have got the wrong answer from the row rather than from the code.
And the trigger was luck: the gap was found by writing an unrelated feature, not by the review
this document schedules for itself.

That review is also outstanding. The header still reads *next review: end of S5*, and S5 is
done — the front end that was supposed to prompt it exists, and item 2 of `docs/backlog.md` is
adding to it. This amendment is not that review and does not stand in for it.

## Accepted deliberately

Each of these is a choice, not an oversight.

**No account lockout after failed attempts.** Lockout is itself an attack: anyone who knows
an address can lock its owner out by failing logins on purpose. Rate limiting per caller
slows guessing without handing anyone that lever.

**A user who never receives the mail cannot get in.** Blocking an unverified account is
what stops an address nobody controls from spending the AI budget, and it converts a
delivery problem directly into a support problem. The resend path is the only way out, and
the user has to think to ask for it.

**A token outlives the account it names by up to thirty minutes.** The price of not touching
the database on every request. Ending a session sooner is what the revocable refresh token
is for.

**Fixed windows allow a burst of twice the limit across a boundary.** A sliding window costs
more to store and does not change what an attacker achieves against a memory-hard hash.

**The `client` field on login is self-declared.** A browser could claim to be native and
receive the refresh token in the body. It would be a deliberate change to its own request
rather than a convenient default, which is the property that mattered.

## What this document does not cover

The deployment environment — host hardening, TLS termination, security headers, network
exposure — is S11 and has no decisions yet. The front end is S5 and will bring its own
surface, which is why the next review is scheduled there rather than at a date.

## What to do, in order

1. ~~S3 closes threat 3.~~ **Done.** Registration, resend and reset all answer identically,
   and a test asserts the two registration responses are byte for byte the same.
2. **S5 must decide CORS in an ADR**, not by copying a snippet. With an `HttpOnly` cookie in
   play, a permissive policy lets any site make authenticated requests as the user. Reflecting
   the request's origin is the common form of this mistake.
3. **S5 must keep the access token out of storage**, or threat 4 reopens wider than before.
4. **Enable dependency scanning now.** It is cheap, it addresses threat 18, and it is the only
   item on this list that does not need a sprint.
5. **S6 and S7 address threat 14** when the AI layer exists.

---

## Português

Este documento registra o que vale proteger no SyncaAI, quem realisticamente tentaria, o que
já está no caminho e o que não está. Boa parte do raciocínio já existia dentro dos ADRs; o
que faltava era a visão única — e uma decisão parece diferente ao lado das outras.

**Ativos:** conteúdo do calendário, credenciais, a chave do provedor de IA e o gasto atrás
dela, e disponibilidade.

**Atacante realista:** varredura automatizada e oportunista, muito acima de qualquer outro.
Depois, alguém que leu o repositório — que é público, então obscuridade nunca esteve
disponível como mitigação. E um usuário contra outro, que o ADR-0002 chamou de falha mais
provável do projeto.

**Fora de escopo, dito de propósito:** atacante direcionado com dinheiro, ameaça interna, e
ataque de cadeia de suprimentos mirado neste projeto. Fingir que estão cobertos tornaria o
resto menos confiável.

**Brechas abertas agora são duas:** ausência de política de CORS, que o S5 precisa decidir em
ADR e não copiando trecho pronto; e a ameaça 7 — isolamento por dono — que está mitigada mas
**não exercitada**, porque nenhum endpoint a usa até o S4. A enumeração de conta foi fechada
no S3.

**Aceito de propósito, com motivo:** não há bloqueio de conta, porque bloqueio é alavanca para
travar a vítima; o token sobrevive à conta apagada por até 30 minutos, que é o preço de não
consultar o banco a cada requisição; e janela fixa permite rajada do dobro na virada.

**Limites de entrada — achados em 2026-09-02, corrigidos em 2026-09-03.** As linhas 10 e 13
creditavam só a frequência.
O `MAX_PASSWORD_LENGTH` está aplicado em cadastro, login e redefinição desde o S2 e não
aparecia neste documento nenhuma vez — a frequência de uma tentativa estava registrada como
limitada, e o custo de uma estava limitado no código e em lugar nenhum aqui. Apareceu de lado,
ao limitar o campo `notes` para a tela que passou a oferecer um textarea. **Mitigação aplicada
e não registrada é indistinguível de mitigação inexistente** para quem lê isto para decidir se
o sistema está protegido.

**Próxima revisão: dois gatilhos, no lugar de uma data que venceu.** O antigo era "fim do S5";
o S5 terminou, a revisão não aconteceu, e a correção acima foi achada escrevendo outra coisa.
Os novos são **(1)** o fim do item 2, quando as três telas existirem — o front-end é a
superfície que o gatilho antigo mirava e ainda está sendo construído, e revisar no meio é
revisar duas vezes; e **(2)** antes de ligar um provedor real no S7, porque mandar o calendário
de alguém para um terceiro pago é classe nova de exposição e não continuação desta. Número de
sprint é data disfarçada; os dois nomeiam coisa que vai existir.
