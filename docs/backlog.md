# Backlog

O que está aberto, e em que ordem. Atualizado em 2026-08-25, ao fim da validação manual do
ADR-0022.

## O critério de ordenação

A tela da semana vai ser redesenhada — a segunda rodada com o Claude Design está em curso
(`design-brief-2.md`). Isso decide a ordem sozinho:

> **Primeiro o que um redesenho não pode invalidar.**

Lógica de agrupamento, correção de servidor, teste e migration sobrevivem a qualquer mudança
visual. Um botão, um estado de hover e um ícone não sobrevivem. Construir pixel agora é
construir duas vezes.

---

## Rodada 1 — o que está errado hoje

Nada aqui é funcionalidade nova. São afirmações falsas na tela ou caminhos que não fecham.

### 1.1 O link de verificação não abre nada

O email manda `http://localhost:5173/verify?token=...`. A aplicação não tem rota `/verify`,
então o Vite serve o `index.html`, o app chama `/auth/refresh`, toma 401 e mostra a entrada.
O token na URL nunca é lido.

A tela aceita o token colado, mas o email não diz isso — ele diz "clique aqui". As duas metades
nunca se falaram.

**Correção:** ler `?token=` de `window.location.search` no boot e ir direto para o estado de
confirmação. Sem roteador: `AuthScreen` já tem o estado, falta só a leitura da URL.

### 1.2 A lista e a contagem discordam sobre em que dia a tarefa está

Dois endpoints, duas noções de "neste dia":

| | Regra | Origem |
|---|---|---|
| `/capacity` | a tarefa **encosta** no dia — sobreposição de intervalo | `capacity_statement` |
| `/tasks` | a tarefa **começa** no dia — filtro em `start_at` | `list_with_items` |

Três sintomas, um tronco:

- Uma tarefa que atravessa a meia-noite conta os minutos nos dois dias e só aparece no
  primeiro. O segundo dia mostra `1 task · 4h booked` com a coluna vazia.
- Uma tarefa concluída antes de começar colapsa o `end_at` exatamente na meia-noite;
  `end_at > window_start` vira `00:00 > 00:00`, falso. Some da contagem e fica na lista.
- A primeira segunda da janela perde as linhas que vêm do domingo anterior, porque a busca
  de tarefas começa na segunda.

**Correção (parte lógica, agora):** a busca de `/tasks` passa a começar um dia antes da
janela, e o agrupamento por dia deixa de ser `zonedDay(start_at)` e passa a ser a interseção
com o dia — a mesma regra que a capacidade já usa.

**Correção (parte visual, depois do redesenho):** como o segundo dia mostra a metade que
recebeu, e como a linha diz que `04:00` é de amanhã. É a pergunta central do
`design-brief-2.md`.

### 1.3 O caminho logado não tem teste de integração

Registrar → ler o token do `RecordingMailer` → verificar → entrar como `web` → renovar usando
**só o cookie** → `/me`. É o teste que torna seguro mexer em 1.1 e 1.2 depois.

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

Quatro dessas são puramente front-end e estão bloqueadas só pelo redesenho.

Duas precisam de servidor e podem começar agora:

- **Conflito com saídas.** O 409 de sobreposição não diz **qual** tarefa ocupa o horário. Sem
  esse dado a tela não consegue oferecer mover, encurtar ou substituir. Substituir tem que ser
  atômico no servidor — excluir e criar em duas chamadas deixa o horário livre no meio.
- **Editar a checklist.** `TaskUpdate` não tem campo de itens e nenhuma rota toca em
  `ChecklistItem`. Decisão de API pendente: itens dentro do `PATCH` da tarefa, ou recurso
  próprio em `/tasks/{id}/items`.

---

## Rodada 3 — orientação

Barato, visível, e inteiramente dentro do redesenho.

- **Hoje não está marcado.** Não existe a palavra `today` em `apps/web/src/week/`. Nada na
  tela diz qual dia é agora.
- **Não dá para voltar para a semana atual.** `[` e `]` andam, nada volta.
- **Uma tarefa concluída não diz quando.** A tela mostra `done`. O `completed_at` existe, e a
  diferença entre ele e o planejado é o dado que o ADR-0022 criou para o S6 usar.

---

## Rodada 4 — telas que não existem

- **Configurações.** O fuso aparece no cabeçalho e não pode ser mudado. Não existe
  `PATCH /me` — esta precisa de back-end antes do desenho.
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
