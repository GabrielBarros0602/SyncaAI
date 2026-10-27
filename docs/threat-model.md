# Threat model

A record of what is worth protecting in SyncaAI, who would realistically try, what is
already in the way, and what is not. It is written to be falsifiable: every mitigation
points at where it lives, and every gap says when it is dealt with.

Most of the reasoning already exists inside individual ADRs. What did not exist was the
single view, and a decision looks different next to the others than it does alone.

**Reviewed at:** end of S3, 53 commits; the AI surface on 2026-10-23, at the end of S6 and
before any provider is wired in (trigger 2 below). That review is recorded at the end of this
document, with the rows it changed.

**Next review — two triggers, replacing a date that went stale:**

1. **When item 2 of [`backlog.md`](backlog.md) is finished and the three screens exist.** The
   front end is the surface the old trigger was pointing at, and it is still being built:
   delete, move, settings and address confirmation are not there yet. Reviewing halfway means
   reviewing twice, and the second one is the only one that would have counted.
2. ~~**Before a real provider is wired in S7.**~~ **Done on 2026-10-23,** at the end of S6:
   rows 12 to 15 read together, and rows 19 to 22 added for what S6 built. See *The AI surface,
   reviewed before S7* below.
3. **Before UC1 sends a task's own text (S9).** UC1 widens what reaches the provider from
   aggregates to the invoked task's title and note (ADR-0004). Rows 14 and 15 rest on there
   being no such text in a prompt today, so they are read again before that changes.

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
| 4 | Session theft through cross-site scripting | partial | refresh token is `HttpOnly` and unreadable by script ([ADR-0017](adr/0017-refresh-token-delivery.md)); the access token lives in memory only, and a lint rule refuses `localStorage` and `sessionStorage` ([ADR-0021](adr/0021-browser-session-and-origin.md)). Partial, because script running in the page can still use the token while the tab is open |
| 5 | Database leak yields live sessions | mitigated | only the digest is stored, [ADR-0015](adr/0015-session-model.md) |
| 6 | A compromised session cannot be ended | mitigated | refresh tokens are revocable rows; a reset ends every session, and a password change every one but the session it was made from ([ADR-0051](adr/0051-a-password-change-keeps-this-session-and-a-reset-keeps-none.md)) |
| 7 | One user reads another's data | mitigated | filter lives in a base with no unscoped read ([ADR-0016](adr/0016-ownership-isolation.md)); exercised over HTTP with two real accounts (`tests/test_task_isolation.py`), and every plan endpoint answers `404` for another person's job, plan or step (`tests/test_plan_endpoints.py`) |
| 8 | Token forgery | mitigated | HS256, secret refused below 32 bytes at boot, type claim checked, expiry required |
| 9 | Cross-site request forgery | mitigated by design | the browser talks to one origin and the API has no CORS middleware at all ([ADR-0021](adr/0021-browser-session-and-origin.md)); the refresh cookie is `SameSite=Strict`. Production keeps one origin by serving the front from the same host (backlog, decision 13) |
| 10 | Memory exhaustion through argon2 | mitigated | two bounds, not one: rate limited per caller, **and the input is capped** — `MAX_PASSWORD_LENGTH` is 128 on register, login, reset and change, and a change's guesses at the current password are limited per person like a login's. Frequency alone would not be enough, because a memory-hard function with unbounded input lets the caller choose how much work one attempt costs |
| 11 | Locking a victim out by failing their logins | accepted | there is no lockout, on purpose — see below |
| 12 | AI provider key reaching a client | mitigated by design | server-side only, [ADR-0001](adr/0001-backend-stack.md). Only the worker calls a model; what an endpoint returns of an answer is a plan's steps and the titles of the ones it discarded, as data. No key exists: the local model needs none, and the paid provider waits for a decision to pay ([ADR-0039](adr/0039-a-local-open-model-until-a-provider-is-paid-for.md)), which is when this row is read again |
| 13 | AI spend abused | mitigated | every job has a worst case: one plan in progress per person, by an index (ADR-0033); a request of 500 characters, an answer of 12 steps, one repair carrying at most 30 error lines, and three claims, so six calls at most (ADR-0035, ADR-0036). The number of jobs is bounded per person by a moving rate limit, ten an hour and thirty a day ([ADR-0042](adr/0042-plan-requests-are-limited-over-moving-windows-of-jobs.md)); the spend by a monthly ceiling per person and a global kill switch, checked before the queue and before every call against an estimate that over-counts ([ADR-0044](adr/0044-the-spend-ceilings-are-checked-before-the-queue-and-before-each-call.md)), over every call metered, failures included ([ADR-0041](adr/0041-every-call-is-metered-when-it-ends.md)). Nothing costs money while the model is local. The 4000-character bound on `notes` stays, for UC1 |
| 14 | Prompt injection steering the AI layer | mitigated by design | the only text a person controls in a prompt is their own request, sent as a JSON string so it cannot pose as context; no third party's text reaches a prompt. Whatever the model answers can only become a draft in the requester's own account, which is validated, reviewed and committed by them: there are no tools, nothing fetches a URL, and nothing executes or renders the answer as markup. See the review below. Read again before UC1 (trigger 3) |
| 15 | Calendar content leaving to the AI provider | mitigated | allowlist, aggregates only, [ADR-0004](adr/0004-context-assembly-policy.md) as amended by [ADR-0034](adr/0034-the-model-sees-the-room-each-day-has-and-nothing-it-cannot-use.md). Built in S6 and held by `tests/test_plan_privacy.py`: private strings stay out of the prompt, and no statement the assembly sends selects a title, a note, a tag or a checklist item. What leaves is the request and the week's free minutes; what the provider then keeps is row 22 |
| 16 | Request-volume denial of service | not mitigated | only the auth endpoints are limited; the rest belongs to a proxy — S11 |
| 17 | Secrets committed to the repository | mitigated | `.env` ignored, `.env.example` carries no real value, verified in review |
| 18 | Known-vulnerable dependency | mitigated | Dependabot alerts are enabled for the repository (checked through the API on 2026-10-23: none open, every past one fixed), and CI refuses a lockfile that does not match its `.in` file. Pins move with `uv pip compile --upgrade`, never through Dependabot pull requests (`.github/dependabot.yml`) |
| 19 | Plan requests flood the queue or the worker | partial | one plan in progress per person, held by partial unique indexes on jobs and drafts (ADR-0033); a job waiting fifteen minutes fails rather than piling up (ADR-0031). Each account is held to the rate limit (ADR-0042), and a model that is down stops the worker claiming (ADR-0046); many accounts each asking within its limit are bounded only by verification |
| 20 | A model's answer reaching a page as active content | mitigated in the API | links must be labelled `http` or `https` addresses, checked by validation and by a `CHECK` on the table, so `javascript:` and `data:` cannot be stored (ADR-0030, ADR-0037); a task's note is written by code from validated fields, never copied (ADR-0030). One field is the model's text unvalidated: the title of a discarded step, returned so the review can say what was dropped. The screens that will show plans do not exist yet; rendering every field as text, that one above all, is trigger 1's to check |
| 21 | AI content kept longer than promised | mitigated | requests and answers go thirty days after a job ends, and unapproved drafts thirty days after they end, by an hourly purge (ADR-0031, ADR-0036, ADR-0037), held by `tests/test_purge.py`, including a search of every column a request is written to |
| 22 | The provider keeps or trains on what it is sent | **closed while the model is local** | nothing is sent: the worker asks a model on the developer's own machine, and any deployment answers with the sample ([ADR-0039](adr/0039-a-local-open-model-until-a-provider-is-paid-for.md)). The one way out found is closed: Ollama also runs models on its own servers, reached through the same local address (checked on 2026-10-24), and a model name whose tag ends in `cloud` is refused at boot, with `OLLAMA_NO_CLOUD=1` documented as the switch that makes Ollama refuse them all ([ADR-0040](adr/0040-what-the-local-model-is-held-to-measured.md)). Reopens with a paid provider: ADR-0039 chose Anthropic in theory for terms that rule out training on API data and delete it within thirty days, to be read again against that day's pages before the first paid call. Row 15 limits what is sent; it cannot limit what happens to it after |

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

**A person can steer their own plan with their request.** Instructions typed into a request
reach the model, and the model may follow them. Whatever it answers lands only in that
person's own draft, passes the same validation, and becomes nothing until they commit it.
Steering one's own plan is using the product.

**A job can cost up to six calls.** Three claims, when a worker dies mid-job, times two calls
per claim (ADR-0036). The ceilings of ADR-0006, checked before every call, are what bound the
spend; resuming a run from its stored answers is listed to revisit if S7 measures crashes that
are not rare.

## The AI surface, reviewed before S7 — 2026-10-23

The review trigger 2 scheduled. Rows 12 to 15 were read together, against the code S6 built
rather than the ADRs that described it, and four rows were added for what S6 brought.

**What reaches a prompt.** The instructions, which are fixed and versioned (ADR-0034); the
week's free minutes per day, two numbers and a flag; the bounds of a step; and the request,
which is the person's own text, at most 500 characters, inside a JSON string. Nothing anyone
else wrote: no title, note or item, the person's own or another's. That is why row 14 is about
self-injection only, and why it is accepted rather than mitigated further.

**What an answer can do.** Become rows of a draft in its requester's account, after the schema
and the domain have checked every field. It cannot call anything, fetch anything or reach
another account. A link is stored only if it is a labelled web address, and a note is written
by code. The worst an adversarial answer achieves is a bad plan, which the review shows before
anything is committed.

**What was found stale, and corrected here.** Rows 4, 7, 9 and 18 described a project before
S4 and S5: CORS was decided in ADR-0021, the access token stays in memory, isolation is
exercised over HTTP, and dependency alerts are on. None of that is new work; it is this
document catching up with it, which is what a review is for. The front end's own surface is
still trigger 1's, and is not reviewed here.

**What stays open.** Row 13's ceilings and row 22's provider terms, both S7, and both before
the first real call.

## What this document does not cover

The deployment environment — host hardening, TLS termination, security headers, network
exposure — is S11 and has no decisions yet. The front end is S5 and will bring its own
surface, which is why the next review is scheduled there rather than at a date.

## What to do, in order

1. ~~S3 closes threat 3.~~ **Done.** Registration, resend and reset all answer identically,
   and a test asserts the two registration responses are byte for byte the same.
2. ~~S5 must decide CORS in an ADR.~~ **Done** in ADR-0021: one origin, no CORS middleware.
3. ~~S5 must keep the access token out of storage.~~ **Done** in ADR-0021, with a lint rule.
4. ~~Enable dependency scanning now.~~ **Done:** Dependabot alerts, and the lockfile check.
5. ~~S6 and S7 address threat 14.~~ **Done for S6;** read again before UC1 (trigger 3).
6. ~~S7 closes row 22 when it chooses the provider.~~ **Closed while the model is local**
   (ADR-0039); it reopens when a provider is paid for. ~~S7 builds what row 13 is missing.~~
   **Done:** the rate limit (ADR-0042), the monthly ceiling and the kill switch (ADR-0044),
   before any paid call.
7. **Trigger 1 checks that the screens render a plan's text as text**, which is row 20's open
   half.

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

**A revisão da superfície de IA — 2026-10-23, gatilho 2.**
- **O que entra num prompt:** o texto fixo, os minutos livres por dia e o pedido da própria
  pessoa, como string JSON. Nada que outra pessoa tenha escrito.
- **O que uma resposta pode fazer:** virar um rascunho na conta de quem pediu, validado e
  revisado antes de qualquer commit. Ela não chama nada, não busca nada e não alcança outra
  conta.
- **Prompt injection (linha 14):** fica restrito a alguém conduzir o próprio plano, o que é
  aceito de propósito.
- **Linhas novas:**
  - 19: inundação da fila;
  - 20: resposta virando conteúdo ativo numa página;
  - 21: conteúdo guardado além do prometido;
  - 22: o que o provedor guarda ou usa para treinar, que fica aberta até a escolha do provedor
    no S7.
- **Linhas desatualizadas corrigidas:** 4, 7, 9 e 18, que descreviam o projeto antes do S4 e
  do S5.
- **Gatilho novo (3):** reler as linhas 14 e 15 antes de a UC1 mandar o texto de uma tarefa
  para o provedor.
