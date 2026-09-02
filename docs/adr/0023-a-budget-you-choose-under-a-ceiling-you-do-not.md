# ADR-0023: A budget you choose, under a ceiling you do not

**Status:** Accepted
**Date:** 2026-08-26
**Deciders:** Gabriel Barros

**Amends:** Decisions 3 and 4 of [ADR-0022](0022-capacity-against-a-usable-day.md), which
listed "`USABLE_MINUTES_PER_DAY` becomes a per-user preference" under *To revisit*. This is
that revisit landing. Everything else in ADR-0022 stands.

## Context

ADR-0022 set a day's usable budget at sixteen hours and put three warnings above it, at
sixteen, eighteen and twenty. All four numbers were constants, and while they were constants
they agreed with each other by construction.

Two things then pulled them apart.

**The budget has to become a preference.** ADR-0022 said so itself. Sixteen hours is a
reasonable default and a poor law: somebody planning around a part-time schedule, a chronic
illness, or a second job has a different day, and a tool that insists otherwise is telling
them their life is wrong.

**A design round exposed what happens when it moves.** A preview control that varied the
budget from eight to twenty-four hours produced a screen that contradicted itself. The
thresholds were absolute; the budget was not; and with a budget above eighteen hours a day
could report *extremely heavy* while sitting inside its own budget — a warning about an
extreme day printed beside a figure saying there was room left. The ladder inverted.

Underneath the contradiction was a question the original record never had to answer, because
one number was doing two jobs:

> When the screen says a day is too much, is that a claim about **the plan** or about **the
> person**?

Sixteen hours was both. It was the budget, and it was the first warning. Once the budget can
move, the two meanings separate and each needs its own rule.

## Decision

### 1. The budget is a per-user preference

`usable_minutes` becomes a property of the account, defaulting to sixteen hours. The
constant survives only as that default, renamed `DEFAULT_USABLE_MINUTES` so nothing reads it
as a limit.

`CapacityService` already takes the user's zone; it now takes the user's budget the same
way. The service was always per-user — this is one more field arriving through the seam that
already existed.

### 2. `heavy` is relative. `strained` and `unsustainable` are not

| Booked | `load` | What it claims |
|---|---|---|
| ≤ budget | `fine` | — |
| > budget | `heavy` | **about the plan** — you are past the day you said you have |
| > 18h | `strained` | **about the person** |
| > 20h | `unsustainable` | **about the person** |

The three sentences are unchanged from ADR-0022 and keep their exact wording. Only what
triggers the first one moves.

"No margin for anything running late" was always a description of spending the budget, not
of reaching sixteen hours. Attaching it to the budget puts it back on the thing it describes
and removes sixteen hours as a constant entirely — there is nothing left for it to mean.

The other two do not scale with a preference, and that is the point. A setting that moved
them would let somebody configure their way out of being told, which is the one thing a tool
about overwork must not offer. Eighteen hours booked is a fact about a body.

### 3. The preference is capped at eighteen hours

`MAX_USABLE_MINUTES = STRAINED_ABOVE`. Not an arbitrary safety margin — it is the exact
number that makes the inversion arithmetically impossible, because anything above eighteen
hours is then above *every* budget a person can choose.

It is also defensible on its own terms, without reference to the bug it prevents: a usable
day longer than eighteen hours is not a budget, it is a denial. The product declines to
help somebody write that down as a plan while remaining willing to record it as a fact —
which is decision 5 of ADR-0022, unchanged.

Enforced in three places, deliberately:

| Where | What | Why there |
|---|---|---|
| `CHECK (usable_minutes BETWEEN 60 AND 1080)` | the column | a rule the database can express is a rule the database keeps (ADR-0012) |
| the request schema | the edge | so the answer is a readable 422 and not a driver error |
| `min(...)` in the service | last use | the number decides what somebody is told about their own day, and a second guard costs one call |

### 4. The invariant this buys

> `over_capacity` is exactly `load != "fine"`.

With the ceiling in place the relative step and the absolute steps can never cross: if a day
is above eighteen hours it is above the budget too. So the flag and the ladder can never
disagree.

This matters beyond tidiness. The screen drives its accent colour from one of the two. Were
they able to diverge it would render a warning with no chip beside it, or a chip with
nothing said — and the accent, which ADR-0022 spent its trade-off section protecting, means
trouble and only trouble. The invariant is asserted across every budget rather than assumed.

### 5. No fifth message

An earlier draft of this decision added a fourth warning for "past your budget but under
sixteen hours", keeping sixteen as a level of its own. It was dropped: with `heavy` attached
to the budget, that state *is* `heavy`, and a separate sentence for it would be two ways of
saying one thing.

## Options Considered

| Option | Assessment |
|--------|------------|
| **A budget you choose under a fixed ceiling — chosen** | Separates the plan from the person, keeps every existing sentence, and removes one constant rather than adding one. |
| Thresholds scale with the budget (`budget + 2h`, `budget + 4h`) | The ladder cannot invert, and "unsustainable" stops meaning anything: a twenty-hour budget would reach it at twenty-four, where the day is physically full. The words become relative to the very preference they exist to overrule. |
| Keep all four absolute, no preference | The status quo, and the simplest thing that works — until the preference lands, which ADR-0022 already committed to. Postponing is not deciding. |
| Preference with no ceiling | Honest about autonomy and dishonest on screen. Produces the exact contradiction that started this record. |
| A fifth level between the budget and sixteen hours | Considered and dropped. Two sentences for one state, and it keeps sixteen hours alive as a number with no remaining meaning. |

## Trade-off Analysis

**This removes a constant.** Sixteen hours stops being a threshold and becomes only a
default. Fewer numbers with opinions is the direction this part of the model should keep
moving.

**The ceiling is a real refusal, and it is the only one here.** The product will not let a
person *plan* a nineteen-hour day, while still recording one without complaint if it
happens. That line — refusing the plan, accepting the fact — is worth stating because the
opposite would be much easier to build and much worse.

**Three enforcement points is not belt-and-braces for its own sake.** The `CHECK` is the
only one that survives a bug in the other two, and the service clamp is the only one that
survives a row written before the `CHECK` existed. The schema validator earns its place by
turning a violation into a sentence a person can read.

**This work has a known expiry.** ADR-0022 also lists working hours as a *window*
(06:00–22:00) rather than a budget, and a window supersedes decision 3 of that record
entirely. When it lands, `usable_minutes` becomes `end − start` and this column is derived
rather than stored. Accepted knowingly: the ceiling, the invariant and the split between
relative and absolute all survive that change. Only the column moves.

## Consequences

**Easier**
- A person whose day is not sixteen hours gets a tool that agrees with them.
- The screen can take its accent from either signal without checking the other.
- `heavy` finally describes what its sentence says.
- The AI layer in S6 plans against a budget that belongs to the user rather than to the code.

**Harder**
- The preference needs `PATCH /me`, which does not exist, and a settings screen, which does
  not exist. The full feature is blocked on both; the seam is not.
- A migration adds a column with a `CHECK`, and the default has to be right for every
  existing row.
- Two of the four `load` steps now come from a constant and one from a row. A test that
  varies the budget is the only thing that keeps that honest.

**To revisit**
- Working hours as a window supersede the budget, per ADR-0022.
- Whether the ceiling should be *below* eighteen hours. Eighteen is the number that makes
  the arithmetic work; it is not obviously the number that makes the product kind.

## Action Items

1. [x] `USABLE_MINUTES_PER_DAY` renamed `DEFAULT_USABLE_MINUTES`; it is a default, not a law.
2. [x] `MAX_USABLE_MINUTES` named, set to `STRAINED_ABOVE`, and clamped in the service.
3. [x] `CapacityService` takes the budget per user, alongside the zone.
4. [x] A test that `heavy` fires against a smaller budget rather than against sixteen hours.
5. [x] A test that the two loud levels ignore the budget at every value.
6. [x] The invariant asserted across every budget and every load, not assumed.
7. [ ] Column `users.usable_minutes` with `CHECK (usable_minutes BETWEEN 60 AND 1080)`.
8. [ ] `PATCH /me` accepts it, with a 422 that names the ceiling.
9. [ ] The settings screen exposes it, and `GET /me` reports it.

> **Items 7–9 lost their home, 2026-09-02.** The second design round drew the settings
> screen with four sections — address, time zone, password, session — and no budget control
> anywhere. Item 9 assumed a screen that now does not have the field, and 7 and 8 exist to
> feed it, so all three are open against a surface that was not drawn.
>
> The budget did not stop being per-user in principle: `DEFAULT_USABLE_MINUTES` is still a
> default and `CapacityService` still takes the value per user, which is items 1–6 and they
> are done. What is missing is only the way a person changes it. The design does carry a
> `budgetHours` control, but as a design-time prop for viewing the screen at other budgets —
> not as a field of the account.
>
> These stay open and unstarted rather than being folded into the settings work, because
> deciding where the field goes is a design decision and the round that would have made it
> went the other way. Whatever resolves it supersedes this note.

---

## Português

**O problema.** O ADR-0022 fixou o orçamento do dia em dezesseis horas e pôs três avisos
acima dele, em dezesseis, dezoito e vinte. Enquanto os quatro números eram constantes, eles
concordavam entre si por construção. Duas coisas separaram os quatro.

O orçamento **precisa** virar preferência — o próprio ADR-0022 registrou isso. Dezesseis
horas é padrão razoável e lei ruim: quem planeja em torno de meio período, de doença crônica
ou de um segundo emprego tem um dia diferente, e uma ferramenta que insiste no contrário está
dizendo que a vida da pessoa está errada.

E uma rodada de design expôs o que acontece quando ele se move. Um controle que variava o
orçamento de oito a vinte e quatro horas produziu uma tela que se contradizia: com orçamento
acima de dezoito horas, um dia reportava *extremamente pesado* estando **dentro** do próprio
orçamento. A escada invertia.

Embaixo da contradição estava uma pergunta que o registro original nunca precisou responder,
porque um número fazia dois trabalhos: **quando a tela diz que um dia é demais, isso é
afirmação sobre o plano ou sobre a pessoa?**

**A decisão.** O orçamento vira preferência por usuário, com padrão de dezesseis horas.
O `heavy` passa a ser medido contra ele — "No margin for anything running late." sempre
descreveu gastar o orçamento, não chegar às dezesseis horas, e prendê-la ao orçamento devolve
a frase ao que ela descreve. As dezesseis horas somem como constante, porque não sobrou nada
para elas significarem.

Os outros dois níveis **ignoram o orçamento**, e isso é o ponto. Uma configuração que os
movesse deixaria a pessoa se configurar para fora de ser avisada, que é a única coisa que uma
ferramenta sobre sobrecarga não pode oferecer. Dezoito horas reservadas é fato sobre um corpo.

**O teto é dezoito horas**, e não é margem de segurança arbitrária: é exatamente o número que
torna a inversão aritmeticamente impossível, porque acima de dezoito está acima de *qualquer*
orçamento escolhível. E se defende sozinho: um "dia útil" de mais de dezoito horas não é
orçamento, é negação. O produto se recusa a deixar alguém **planejar** isso, e continua
disposto a **registrar** quando acontece — a decisão 5 do ADR-0022, intacta.

Guardado em três lugares de propósito: `CHECK` na coluna, porque regra que o banco expressa é
regra que o banco garante (ADR-0012); validação no schema, para a resposta ser um 422 legível
em vez de erro de driver; e `min(...)` no serviço, porque é o último ponto antes de o número
decidir o que uma pessoa ouve sobre o próprio dia.

**A invariante que o teto compra:** `over_capacity` é exatamente `load != "fine"`. Como nada
acima de dezoito horas pode estar abaixo do orçamento, a etiqueta e a escada nunca discordam
— e a tela pode tirar a cor de acento de qualquer uma das duas sem checar a outra. Está
asserida em todos os orçamentos, não assumida.

**Validade conhecida.** O ADR-0022 também prevê horas de trabalho como **janela**
(06:00–22:00) em vez de orçamento, e a janela substitui a decisão 3 daquele registro inteira.
Quando chegar, `usable_minutes` vira `fim − início` e a coluna passa a ser derivada. Aceito
sabendo: o teto, a invariante e a separação entre relativo e absoluto sobrevivem à mudança.
Só a coluna muda de dono.
