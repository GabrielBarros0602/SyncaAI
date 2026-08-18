# ADR-0001: Back-end stack — FastAPI now, Spring Boot port as phase 2

**Status:** Accepted — estimate no longer measurable, see note
**Date:** 2026-08-06
**Deciders:** Gabriel Barros

> **The hour estimate lost its basis.** It assumed the developer writes the code, and the
> working arrangement changed during S1 to one where the code is written for review. Hours
> spent now measure different work and cannot be compared against the figures below. They
> are tracked from S3 onward in `docs/ROADMAP.md` anyway, because they say what the project
> costs its owner — recorded as the work happens, since reconstructing them afterwards
> produced a number too unreliable to keep. The comparison this record was built on, Python
> against Java for the same person, is what decided the stack and is untestable now for the
> same reason.

## Context

SyncaAI is a full-stack project: front end, back end, database, authentication, and an AI
provider key that must stay on the server. The AI layer is the reason the project exists —
a calendar with checklists is CRUD and does not differentiate a portfolio.

Two forces pull in opposite directions:

1. **Skill inventory.** Python and FastAPI are known — SmartBudget API already uses
   FastAPI, PostgreSQL, SQLAlchemy, Alembic and a layered architecture. Spring Boot has
   never been written.
2. **Target employers.** Itaú and Vivo are Java shops. Java appears on the résumé with no
   project backing it. This is the most expensive gap in the profile.

A reference MVP was estimated in hours: authentication, domain CRUD, one complete AI
feature (schema validation, rate limit, cache, fallback), front end wired to the API,
tests, documentation and deploy.

| Block | FastAPI | Spring Boot (first time) |
|---|---|---|
| Skeleton, Docker, Postgres, migrations | 8h | 32h |
| JWT authentication | 12h | 42h |
| Domain (days, tasks, items, lists, notes) | 25h | 70h |
| AI layer | 40h | 72h |
| Front end wired to API | 35h | 35h |
| Tests | 20h | 40h |
| Docs, ADRs, deploy | 15h | 20h |
| Slow edit-compile-run loop tax | — | 15h |
| Unknown unknowns (greenfield in unfamiliar framework) | — | 25h |
| **Total** | **~155h** | **~350h** |

The delta is **+200h to +240h**. Its largest components are JPA/Hibernate (+45h: lazy
loading, `LazyInitializationException`, N+1, `@Transactional` proxy boundaries, DTO
projection) and Spring Security (+30h: `SecurityFilterChain`, JWT filter, silent 403s).
Together those two are a third of the delta.

At 15h/week that is ~10 weeks versus ~23 weeks to the same MVP.

## Decision

Build SyncaAI on **Python 3.12 / FastAPI / PostgreSQL / SQLAlchemy / Alembic / Docker**.

Plan a **phase 2**: once SyncaAI ships and is published, reimplement the core back end
(authentication + domain + persistence, excluding the AI layer) in Java 21 / Spring Boot as
a second, deliberate implementation of the same system.

The Java gap is closed by phase 2, not by phase 1.

## Options Considered

### Option A: FastAPI only, no port planned

| Dimension | Assessment |
|---|---|
| Effort to MVP | ~155h |
| Framework familiarity | High |
| Risk to the AI layer | Low — effort concentrates on the differentiator |
| Java gap | Left open |

**Pros:** fastest path to a finished, deep project. Every hour of framework friction saved
goes into the AI layer, which is what the project is judged on.
**Cons:** does nothing for the most expensive gap in the profile.

### Option B: Spring Boot only

| Dimension | Assessment |
|---|---|
| Effort to MVP | ~350h |
| Framework familiarity | None |
| Risk to the AI layer | High — ~55% of effort becomes framework friction |
| Java gap | Closed immediately, on the exact target stack |

**Pros:** directly addresses Itaú/Vivo. Spring Security, JPA and Testcontainers are what a
Java interview probes, and all would be exercised for real.
**Cons:** the AI layer — the differentiator — comes out shallow, because attention is split
between "what should this system do" and "how does Spring do this". A half-finished SyncaAI
in Java is worth less in an interview than a finished SyncaAI in Python. Internship
applications are active now; a project presentable in ~10 weeks beats one presentable in
~23.

### Option C: Hybrid — FastAPI core, Spring Boot AI worker

| Dimension | Assessment |
|---|---|
| Effort to MVP | ~225h |
| Framework familiarity | Partial |
| Risk to the AI layer | Medium |
| Java gap | Partially closed, shallowly |

**Pros:** produces a real Java artifact for ~+70h instead of ~+200h. Polyglot services are
a legitimate pattern, and the AI layer wants a worker process anyway.
**Cons:** a worker that calls an HTTP API and writes a row touches neither JPA, nor Spring
Security, nor transaction management — exactly the areas a Java interviewer probes. It buys
less credibility than it appears to. It also invites the reading that two languages were
used for one application without justification.

### Option D: FastAPI now, Spring Boot port as phase 2 — **chosen**

| Dimension | Assessment |
|---|---|
| Effort to MVP | ~155h |
| Effort to phase 2 | ~90-120h |
| Framework familiarity | High now, built deliberately later |
| Risk to the AI layer | Low |
| Java gap | Closed in phase 2, at roughly half price |

**Pros:** ships the differentiator first. The port is cheaper than greenfield Spring
because the design questions are already answered — there is a settled schema, a reference
implementation, and a test suite that acts as a specification. Only framework learning
remains; the design thrash is gone. It also produces a strong interview narrative: the same
system implemented in both ecosystems, compared with evidence rather than opinion.
**Cons:** Java credibility arrives months later than in Option B. The port is real work
(~90-120h), not a weekend, and it can be deferred indefinitely under pressure — which would
collapse this option into Option A.

## Trade-off Analysis

The decision hinges on a single asymmetry: **the same Java learning costs roughly half as
much once the design is settled.** Learning Spring on a greenfield project means paying
twice per hour — once for the framework, once for the design. Learning it against a working
reference implementation removes the second cost.

Option B pays full price and spends it on the wrong thing: the framework, not the AI layer
that makes the project worth showing. Option C pays a smaller price but buys a Java
artifact that avoids every Java topic an interview actually covers.

Option D is not a retreat from Java. It is a decision about sequencing: publish the
differentiator, then buy Java at a discount.

**Open verification.** Before treating this as final, read the stated requirements on three
current Itaú and Vivo internship postings. Brazilian internship processes typically test
logic, SQL and Git with Java as a differentiator, while an explicit Spring requirement
tends to appear at junior/mid level. If the target postings demand Spring outright, Option
B returns to the table and this ADR should be superseded.

## Consequences

**Easier**
- Domain modelling, migrations and JWT authentication reuse patterns already proven in
  SmartBudget API.
- The AI layer receives the majority of the project's engineering attention.
- The Python ecosystem has the smoothest path for structured-output work: Pydantic is both
  the validation layer and the schema source.

**Harder**
- Java remains unproven on the résumé for the duration of phase 1. Interviews in that
  window must be handled by talking about the design, not the language.
- Phase 2 requires deliberate scheduling or it will not happen.

**To revisit**
- After reading the target job postings (see above).
- At the end of phase 1: confirm phase 2 scope and estimate against the real schema rather
  than against this projection.

## Action Items

1. [ ] Read requirements on three current Itaú/Vivo internship postings; supersede this ADR
       if Spring is an explicit requirement.
2. [ ] Scaffold the FastAPI project with a layered architecture mirroring SmartBudget API.
3. [ ] Keep the domain schema and the API contract framework-agnostic, so phase 2 can port
       against them instead of redesigning.
4. [ ] Record phase 2 in the project roadmap with an explicit trigger: "SyncaAI v1 published".

---

## Português

**Decisão:** SyncaAI em Python/FastAPI/PostgreSQL. A lacuna de Java é fechada numa fase 2 —
reimplementar o núcleo (auth + domínio) em Spring Boot depois do SyncaAI publicado.

**Números:** MVP em FastAPI ~155h; em Spring Boot pela primeira vez ~350h (delta de +200h a
+240h, sendo Hibernate +45h e Spring Security +30h um terço dele). A 15h/semana, ~10
semanas contra ~23.

**Razão central:** o mesmo aprendizado de Spring custa cerca de metade quando o design já
está resolvido — no port existem schema, implementação de referência e testes servindo de
especificação, então sobra só o framework. Fazer o SyncaAI em Spring agora pagaria o preço
cheio e gastaria no lugar errado: o framework, não a camada de IA que é o diferencial.

**Pendência:** ler os requisitos de três vagas reais de estágio no Itaú e na Vivo. Se
exigirem Spring explicitamente, este ADR deve ser superseded pela opção B.
