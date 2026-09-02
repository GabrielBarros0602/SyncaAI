# Backlog

O que está aberto, e em que ordem. Atualizado em 2026-08-26, quando o design voltou e a
execução passou para o Claude Code.

## O critério de ordenação

A tela da semana **foi** redesenhada, e as telas estão em `docs/design/`. O critério que
ordenou a rodada 1 continua valendo para tudo que ainda não é visual:

> **Primeiro o que um redesenho não pode invalidar.**

Lógica de agrupamento, correção de servidor, teste e migration sobrevivem a qualquer mudança
visual. Um botão, um estado de hover e um ícone não sobrevivem.

---

## Rodada 1 — o que estava errado

### 1.1 O link de verificação não abria nada — ✅ concluído

O email mandava `/verify?token=...` e a aplicação não tinha rota `/verify`, então o token na
URL nunca era lido. A tela passou a ler `?token=` de `window.location.search` no boot e
confirmar sozinha, e a barra de endereço é limpa antes da primeira requisição.

### 1.2 A lista e a contagem discordavam sobre em que dia a tarefa está — ✅ a metade lógica

`occupied_minutes` é o que cai no dia; `task_count` é o que **começa** nele. Os dois discordam
de propósito sobre uma tarefa que atravessa a meia-noite. O join alargou para
`end_at > window_start OR start_at >= window_start`, o cliente busca desde o dia anterior, e
`carried.ts` monta o que cada dia herda.

**Falta a metade visual**, e ela faz parte do item 2 abaixo: a faixa herdada na coluna que
recebe, e o `+1` na linha que diz que `04:00` é de amanhã. Está desenhado em
`docs/design/week.html`.

### 1.3 O caminho logado não tem teste de integração — ✅ concluído

Registrar → ler o token do `RecordingMailer` → verificar → entrar como `web` → renovar usando
**só o cookie** → `/me`. Está em `tests/test_signed_in_path.py`, e é o único teste da suíte em
que nada entre a requisição HTTP e o PostgreSQL é dublê — só os dois rate limiters, porque os
contadores são linhas que sobrevivem ao teste e o teto de cinco registros por hora derrubaria
a sexta execução da suíte dentro da mesma hora.

Três asserções guardam a principal: sem o cookie a renovação dá 401 (senão o passo passaria
com qualquer outra credencial que o cliente carregasse por acaso), entrar antes de confirmar dá
403, e o token de confirmação não pode ser gasto duas vezes — esta última é a que pegaria uma
rota que esqueceu o `commit`, porque contra repositório falso ela passa de graça.

**O que isso mudou de fato:** `verification_tokens` foi de 64% para 100% de cobertura,
`repositories/users` de 86% para 100%, e o total de 96,43% para 97,45%. Os `integration`
passaram de 40 para 44 — o número está no `CLAUDE.md` e foi atualizado junto.

---

## Item 2 — as três telas, contra `docs/design/`

O maior pedaço aberto, e ele carrega quase inteiras as rodadas 2 e 3 abaixo. O
`docs/design/README.md` registra o que foi decidido em cada uma e por quê; o que segue é o que
ainda precisa existir em código.

---

## Rodada 2 — os verbos que faltam

A API sabe fazer oito coisas. A tela oferece três.

| Ação | API | Tela | Precisa de back-end? |
|---|---|---|---|
| Criar tarefa | `POST /tasks` | sim | — |
| Listar | `GET /tasks` | sim | — |
| Concluir e reabrir | `PATCH /tasks/{id}` | sim | — |
| **Editar** título, horário, duração | `PATCH /tasks/{id}` | **não** | não |
| **Excluir** | `DELETE /tasks/{id}` | **não** | não |
| **Nota** | `notes`, já no schema | **não** | não |
| **Checklist** | `items[]`, já vem na resposta | **não** | leitura não; editar sim |
| **Etiquetas** | `GET /tags` | **não** | não |

Quatro dessas são puramente front-end e agora estão desenhadas: os cinco verbos vivem na
**linha aberta**, com nota e checklist no mesmo painel. Concluir sai do conjunto e vira caixa
permanente antes do título, porque é o verbo frequente e não deve custar uma abertura.

Duas precisam de servidor e não dependem de tela nenhuma:

- **Conflito com saídas.** O 409 de sobreposição não diz **qual** tarefa ocupa o horário. Sem
  esse dado a tela não consegue oferecer mover, encurtar ou substituir. Substituir tem que ser
  atômico no servidor — excluir e criar em duas chamadas deixa o horário livre no meio.
- **Editar a checklist.** `TaskUpdate` não tem campo de itens e nenhuma rota toca em
  `ChecklistItem`. Decisão de API pendente: itens dentro do `PATCH` da tarefa, ou recurso
  próprio em `/tasks/{id}/items`.

---

## Rodada 3 — orientação

Barato, visível, e tudo já resolvido em `docs/design/week.html`.

- **Hoje não está marcado.** Não existe a palavra `today` em `apps/web/src/week/`. Nada na
  tela diz qual dia é agora. Desenhado como um filete de 2px no topo da coluna, a palavra
  `today` onde fica o índice, e as datas passadas caindo para o cinza fraco.
- **Não dá para voltar para a semana atual.** `[` e `]` andam, nada volta. Desenhado como
  `this week` no cabeçalho, tecla `T`.
- **Uma tarefa concluída não diz quando.** A tela mostra `done`. O `completed_at` existe, e a
  diferença entre ele e o planejado é o dado que o ADR-0022 criou para o S6 usar. Desenhado
  como `done 15:00 · 1h30 of 3h · −1h30`, em tinta neutra: passar da estimativa é informação,
  não falha.
- **O número grande do dia é o livre, e ele tem piso em zero**, então um dia de 16h, um de 19h
  e um de 24h leem `0m` no mesmo corpo. Invertido no desenho: o grande passa a ser o
  reservado, e o livre vai para a linha de baixo com o denominador — `3h free of 16h`.

---

## Rodada 4 — telas que não existem

- **Configurações.** Desenhada em `docs/design/settings.html`. O fuso aparece no cabeçalho e
  não pode ser mudado, e não existe `PATCH /me`. Carrega junto os itens 7–9 do **ADR-0023**: a
  coluna `users.usable_minutes` com `CHECK (usable_minutes BETWEEN 60 AND 1080)`, o `PATCH /me`
  que a aceita com um 422 que nomeia o teto, e o `GET /me` que a reporta.
- **Confirmar endereço.** Desenhada em `docs/design/confirm-address.html`, em três estados.
  O comportamento já existe dentro do `AuthScreen`; falta a tela.
- **Trocar e recuperar senha.** Gatilho registrado: S8, ou antes de publicar.
- **Entrar com o Google.** Gatilho registrado: antes de demonstrar ou publicar. Precisa de ADR
  próprio para vinculação de conta — o que acontece quando o endereço do Google já tem conta
  com senha.

---

## Depois

**S6 — a camada de IA**, contra um dublê de teste. É a tese do produto e ainda é invisível na
tela. O `end_at` que encurta ao concluir cedo já está guardando o dado que ela vai usar.

O ADR-0022 deixou dois itens para revisitar: `USABLE_MINUTES_PER_DAY` como preferência por
usuário, e horas de trabalho como **janela** em vez de orçamento — o que substitui a decisão 3
quando chegar.
