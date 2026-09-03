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

### 1.2 A lista e a contagem discordavam sobre em que dia a tarefa está — ✅ concluído

`occupied_minutes` é o que cai no dia; `task_count` é o que **começa** nele. Os dois discordam
de propósito sobre uma tarefa que atravessa a meia-noite. O join alargou para
`end_at > window_start OR start_at >= window_start`, o cliente busca desde o dia anterior, e
`carried.ts` monta o que cada dia herda.

**A metade visual entrou na PR 2 do item 2:** a faixa herdada na coluna que recebe — nomeando
a tarefa, de onde veio, quando acaba e quanto do dia ela toma, sem verbo nenhum — e o `+1` com
a divisão na linha que a possui. A faixa carrega um rodapé dizendo que esses minutos **já
estão** na figura do topo, porque sem ele ela lê como soma e quem soma duas vezes erra para o
lado que superlota.

Uma contradição foi junto: um dia que só herda minutos não tem tarefa própria, então ele
anunciava dia vazio logo abaixo de um cabeçalho reportando quatro horas reservadas.

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

**Dividido em oito PRs em 2026-09-02**, nesta ordem. Cada uma deixa a aplicação funcionando e
nenhuma existe só para a seguinte fazer sentido. As duas últimas não dependem de nenhuma
anterior e podem entrar em qualquer ponto.

| # | O que | Depende de | Back-end |
|---|---|---|---|
| 1 | ✅ O cabeçalho do dia, invertido: reservado grande, `3h free of 16h` embaixo, tique do orçamento, hoje marcado, `this week`/`T` | — | não |
| 2 | ✅ A faixa herdada, o `+1` e a linha de split — fecha a metade visual do 1.2 | — | não |
| 3 | ✅ A caixa sai do conjunto e vira permanente; a linha vira grupo que abre; a linha de conclusão | — | não |
| 4 | ✅ Verbos `edit` e `note` | 3 | não |
| 5 | Verbos `move` e `delete` com undo | 3 | não |
| 6 | A oferta de mover, do dia pesado | 5 | não |
| 7 | Confirmar endereço, três estados | — | não |
| 8 | Configurações — endereço, fuso, sair | — | `PATCH /me` |

**O 409 que nomeia a tarefa não é pré-requisito de nada disto.** A rodada 2 o registra como
bloqueio para "mover, encurtar ou substituir", e a leitura do design desfez isso: o painel de
mover calcula a disponibilidade no cliente, com as tarefas que a tela já tem, e o edit mostra
a frase do servidor no conflito. Nenhuma das três telas precisa desse dado. Ele continua
valendo por si — só não bloqueia o item 2.

### Aberto pela PR 3, com gatilho: **depois da PR 6**

**Quantas paradas de tabulação uma semana tem.** A PR 3 tirou o `role="group"` com
`tabIndex` e `aria-expanded` da linha, porque o `eslint-plugin-jsx-a11y` mostrou que `group`
não suporta `aria-expanded` — o estado aberto estava sendo anunciado para ninguém. No lugar
entraram dois botões de verdade, a caixa e o título. Correto, e custa **duas paradas por
linha** onde o desenho previa uma.

Com 31 tarefas numa semana cheia isso é ordem de 60 paradas para atravessar a tela, e as PRs
4 a 6 acrescentam cinco verbos e um painel dentro de cada linha aberta.

**Por que esperar a PR 6 e não decidir agora:** hoje não dá para medir. Com dois controles por
linha e nada aberto, a conta é aritmética; com os cinco verbos, o painel de mover e o de
edição existindo, dá para pegar o teclado e atravessar uma semana de verdade. Decisão tomada
antes disso é palpite sobre o próprio palpite.

**A resposta provável não é mexer na linha — é o padrão `grid` da ARIA.** Coluna do dia como
`grid`, linha como `row`, controles como `gridcell`; **uma** parada de tabulação para a semana
inteira e as setas navegando dentro dela. Isso muda a navegação da tela toda, não a estrutura
de uma linha, e o `docs/design/` não especificou navegação por teclado além das teclas de
atalho — então **é pergunta nova, não implementação faltando**. Provavelmente merece ADR
próprio, porque decide como a semana inteira é percorrida.

### Aberto pela PR 4, e é decisão sua

**O que a regra do passado deveria recusar.** Hoje `_refuse_the_past` recusa qualquer
`start_at` no passado, tanto ao criar quanto ao atualizar. A PR 4 contornou o efeito colateral
mandando só o que mudou, o que é o certo por outras razões — mas não tocou na regra, e ela
ainda tem uma consequência: **um horário digitado errado numa tarefa que já começou não tem
conserto**. Corrigir `09:00` para `08:00` numa tarefa das nove desta manhã é recusado, porque
oito da manhã de hoje já passou.

As opções, e nenhuma foi escolhida:

- **Recusar *agendar para* o passado, não *ter* início no passado.** Na atualização, comparar
  o `start_at` novo com o antigo e recusar só quando ele se afasta mais do agora do que já
  estava. Permite corrigir, continua impedindo criar tarefa retroativa.
- **Recusar só na criação.** Mais simples: `update` para de chamar a regra. Abre registro
  retroativo por edição, que o ADR-0012 recusou de propósito na criação.
- **Manter como está** e aceitar que horário errado em tarefa começada se conserta excluindo e
  recriando — o que a PR 5 vai tornar possível, e que perde a nota, a checklist e o id.

O ADR-0012 registra a regra 1 como "recusada na camada de serviço" e diz que a variante
"permitir quando já concluída" supersede aquele registro se o registro retroativo fizer falta.
Esta é a mesma discussão chegando por outra porta.

### Aberto pela PR 3, e é decisão sua

**Marcar uma tarefa antiga.** A caixa permanente tornou isso um clique: esquece a tarefa de
segunda, marca na quarta. Medido literalmente, a linha diz `done 22:22 · 56h22 of 2h30 ·
+53h52` — verdade sobre o relógio, mentira sobre o trabalho, justamente na linha de onde o S6
vai ler plano-contra-real. O design não alcança esse caso porque calcula em minutos desde a
meia-noite e dá uma volta só.

A PR 3 **derruba a comparação** passado um dia e deixa só data e hora, porque o que uma marca
tardia registra é quando alguém lembrou. O limite de um dia é o que o schema já usa. As
alternativas, se você preferir outra: limitar o número em vez de escondê-lo, seguir o design
ao pé da letra e aceitar um número plausível e errado, ou recusar a marcação fora da janela.

### Decisões tomadas na divisão

- **Undo depois de excluir: apaga já, e o undo recria com `POST`.** A alternativa era
  otimista — sumir da tela e só mandar o `DELETE` quando a janela de 9s fechasse —, e ela tem
  uma falha pior: a exclusion constraint continua segurando o horário durante a janela
  inteira, então quem exclui **para liberar o horário** toma 409 contra uma tarefa que a tela
  já disse que sumiu. Esse é o caso de uso comum de excluir, não um caso de borda. O custo
  aceito de recriar é outro: id novo, e o undo pode falhar se o horário foi tomado no meio.
- **Link de confirmação: um estado só.** O estado ao vivo do `confirm-address.html` separa
  "já usado" de "expirado", e a API não separa de propósito (ADR-0019). O próprio design se
  contradiz — o terceiro card do 7b junta os dois. Vale o card: separar exigiria a API
  distinguir e um ADR emendando o 0019, para ganhar uma frase.
- **Checklist segue pendente** e mantém o verbo `list` fora dos oito. A decisão de API não
  mudou: itens dentro do `PATCH` da tarefa, ou recurso próprio em `/tasks/{id}/items`.

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

**Etiqueta é texto livre, e o `GET /tags` nunca foi chamado por ninguém.** Verificado no
`docs/design/week.html` na PR 4: os dois campos de etiqueta — o do painel de edição e o do
formulário de nova tarefa — são `<input>` simples com `placeholder="Tag, optional"`, sem
`datalist`, sem lista, sem nada que referencie as etiquetas existentes. Então a tela ficou como
está e a rota segue sem cliente.

A consequência é silenciosa e vale registrar antes de alguém tropeçar nela: **erro de digitação
cria etiqueta nova sem avisar.** O servidor normaliza espaço e caixa (`_normalise_tag`), então
`Faculdade` e `faculdade` são a mesma linha — mas `facudade` é outra, e a tela não tem como
mostrar que ela é nova. Com o tempo a lista de etiquetas de um usuário acumula quase-duplicatas
que só ele consegue distinguir.

Resolver isso é decisão de design, não de implementação: sugerir enquanto digita, oferecer as
existentes num menu, ou avisar quando a etiqueta digitada não existe ainda. As três mudam o
campo, e o `docs/design/` desenhou o campo sem nenhuma delas.

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
  O comportamento já existe dentro do `AuthScreen`; falta a tela. **É a PR 7 do item 2.**

  **Leva junto o último `jsx-a11y/no-autofocus` da base.** A PR 3 ligou o plugin e achou três,
  todos no `autoFocus`. Dois seguem ação explícita — formulário aberto com `N`, campo que
  apareceu porque pediram — e ficam com a razão escrita no lugar, que é o caso que a regra
  existe para proteger. O terceiro é o endereço na tela de entrar, que recebe foco no
  carregamento sem ninguém ter pedido: o mais fraco dos três, mantido só porque mudar onde uma
  página de entrada começa é assunto de uma mudança sobre ela. **A PR 7 é essa mudança**, então
  ou o `disable` cai junto ou a justificativa passa a valer por escolha e não por adiamento.
  Fechada essa, a base não tem `disable` de acessibilidade pendente.
- **Trocar e recuperar senha.** Gatilho registrado: S8, ou antes de publicar. **Precisa de ADR
  antes do endpoint**, e o motivo apareceu ao ler o design: a seção 03 da
  `docs/design/settings.html` diz explicitamente que trocar a senha **não** desloga o
  navegador, enquanto o `reset-password` que já existe revoga todas as sessões — e o ADR-0019
  registra isso como parte do que um reset é. São dois comportamentos opostos para a mesma
  coluna, e a diferença é defensável: quem faz reset por link pode não ser o dono da conta, e
  quem digita a senha atual provou que é. Mas isso é decisão, não detalhe de implementação, e
  o ADR tem que vir antes de escrever a rota.
- **Entrar com o Google.** Gatilho registrado: antes de demonstrar ou publicar. Precisa de ADR
  próprio para vinculação de conta — o que acontece quando o endereço do Google já tem conta
  com senha.

---

## Depois

**S6 — a camada de IA**, contra um dublê de teste. É a tese do produto e ainda é invisível na
tela. O `end_at` que encurta ao concluir cedo já está guardando o dado que ela vai usar.

> **A mesma armadilha da PR 3 espera aqui.** O ADR-0022 diz que a camada de IA ganha
> plano-contra-real de graça. Ganha — mas **não** por `completed_at - start_at`. Essa derivada
> é tempo de relógio até alguém lembrar de marcar: uma tarefa de 2h30 marcada dois dias depois
> vira 53 horas, e o modelo aprende que a pessoa estoura a estimativa em vinte vezes.
>
> O `end_at` **armazenado** está certo e é a fonte a usar: o trigger o define como
> `LEAST(planejado, concluído − início)`, então ele nunca passa do plano e nunca conta o
> esquecimento. O que é derivado dele também está certo; o que é derivado de `completed_at`
> não está.
>
> A tela resolveu isso escondendo a comparação passado um dia (PR 3). O S6 não pode esconder —
> ele precisa decidir *qual* dado alimenta o contexto. Registrado antes de existir código para
> consertar depois.

O ADR-0022 deixou dois itens para revisitar: `USABLE_MINUTES_PER_DAY` como preferência por
usuário, e horas de trabalho como **janela** em vez de orçamento — o que substitui a decisão 3
quando chegar.
