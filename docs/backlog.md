# Backlog

O que está aberto, e em que ordem. Atualizado em 2026-08-26, quando o design voltou e a
execução passou para o Claude Code.

## O critério de ordenação

A tela da semana **foi** redesenhada, e as telas estão em `docs/design/`. O critério que
ordenou a rodada 1 continua valendo para tudo que ainda não é visual:

> **Primeiro o que um redesenho não pode invalidar.**

Lógica de agrupamento, correção de servidor, teste e migration sobrevivem a qualquer mudança
visual. Um botão, um estado de hover e um ícone não sobrevivem.

**Isso pesa mais a partir de 2026-10-22:** o design vai passar por uma terceira rodada, com
mudanças grandes prováveis (brief local em `docs/design-brief-3.md`). Tudo o que é tela pode
ser refeito; servidor, ADR, teste e CI não.

---

## Decisões de 2026-10-22

Fecham perguntas que estavam abertas abaixo. Cada uma diz onde vai parar e se sobrevive ao
redesign.

| # | Pergunta | Decisão | O que exige | Sobrevive ao redesign? |
|---|---|---|---|---|
| 1 | O que a regra do passado recusa | **Correção limitada:** numa tarefa que já começou, a edição pode pôr o início até 24h antes de agora; criar no passado continua proibido | ✅ ADR-0027, serviço e testes | sim |
| 2 | Mover tarefa concluída | **Não oferecer**, como a PR 5 já faz. A correção do horário (1) cobre o caso real | nada | — |
| 3 | A caixa de concluir perde o foco | **Devolver o foco também a ela**, pelo mesmo caminho da PR 5 | front, pequeno | provavelmente não, mas é barato |
| 4 | Paradas de tabulação | **Decidir quando todas as telas estiverem prontas e definitivas.** Provável: padrão grid da ARIA | ADR na hora | — |
| 5 | Etiqueta digitada errado | **Sugerir as existentes enquanto digita e avisar quando a etiqueta é nova** | front (`GET /tags` já existe); entra no redesign | não |
| 6 | Como editar a checklist | **Recurso próprio** (`/tasks/{id}/items`), mais organizado e mais seguro para a API | ✅ ADR-0028, rotas e testes | sim |
| 7 | Conclusão tardia | **Voltar a mostrar o número, e o número é o tempo real decorrido** (`+53h52`). A fórmula do design era um atalho para preencher o protótipo; uma métrica de autoconhecimento sobre planejamento tem que refletir o relógio com exatidão, e um número plausível mas errado destrói a confiança na ferramenta | front; entra no redesign | não |
| 8 | Tema claro e eixos de tema | **Seguir o sistema e ter seletor nas configurações.** Os tokens têm que passar no contraste nos dois temas — acessibilidade não é negociável | ✅ tokens da direção Papel e o teste de contraste (ADR-0026); falta o seletor, que é tela | o teste, sim |
| 9 | Celular | **Visão de um dia**, numa rodada de design. O prazo não pesa contra | redesign | — |
| 10 | Design | **Terceira rodada completa.** O inventário de problemas está no brief local | — | — |
| 11 | Dependabot nos lockfiles do Python | **Um check no CI** que regenera o lockfile com o `uv` e falha se diferir | job de CI | sim |
| 12 | Horário útil | **Uma janela por pessoa** (início e fim). Simples para a maioria; nem todo mundo vai configurar dia a dia, e nem todo dia segue o mesmo plano | ✅ ADR-0029, migration e `PATCH /me`; falta a tela de configurações | sim |
| 14 | Arrumação | `.gitignore` dos arquivos pessoais commitado; branches antigas apagadas | feito | — |
| 15 | O front-end até o redesign voltar | **Congelado.** As PRs 6, 7 e 8 do item 2 estão pausadas, e nenhum componente, teste de UI ou CSS novo é escrito sobre um design system que vai ser refeito. O trabalho segue no que é base | — | — |

### A 13, decidida em seguida

- **Hospedagem: tudo num host só, no Fly.io** — API, worker e front juntos, que é a forma
  natural de manter a origem única do ADR-0021. *A premissa de custo precisa ser conferida
  antes do ADR:* a decisão partiu de o Fly.io ser a única das três que roda um processo
  contínuo de graça, e fontes de 2026 (de terceiros, não a página oficial) dizem que a cota
  gratuita para contas novas acabou em 2024 e que hoje é cobrança por uso — da ordem de
  US$ 2/mês por máquina pequena. A escolha de um host só continua de pé de qualquer jeito; o
  que pode mudar é qual, se o custo pesar. ADR no S11.
- **Autenticação: a própria, mantida.** Trocar argon2id, sessão revogável, cookie `HttpOnly` e
  as respostas genéricas pelo Supabase Auth apagaria a parte mais forte do portfólio de
  back-end e superaria seis ADRs.
- **Banco: Supabase, só como host do PostgreSQL**, com a condição de suportar `btree_gist`, de
  que a exclusion constraint depende. A documentação do Supabase lista a extensão entre as
  suportadas; falta confirmar no projeto quando ele for criado.
- **Domínio: em aberto**, para quando o site estiver pronto e for aberto ao cadastro de outras
  pessoas. Uma restrição segue valendo e precisa entrar nessa conversa: sem domínio verificado,
  um provedor transacional como o Resend só entrega para o dono da conta — ou seja, ninguém
  além do autor completa o cadastro.
- **Provedor de IA: no S7**, contra os critérios que os ADRs já impõem — não treinar com os
  dados do usuário (ADR-0004), saída estruturada nativa (ADR-0005), teto de gasto rígido
  (ADR-0006). O S6 roda contra um dublê e não depende dessa escolha.

### O trabalho de base, na ordem

O que o redesign não pode invalidar, e por isso segue enquanto o front está congelado:

1. ~~Check de lockfile no CI (decisão 11).~~ ✅ O job da API regenera os dois lockfiles com o
   `uv` fixado e falha se algum mudar. Conferido reproduzindo o defeito que motivou a decisão:
   sem o marcador do `uvloop`, o check reprova.
2. ~~ADR e serviço da correção de horário até 24h (decisão 1).~~ ✅ ADR-0027. A janela é contada
   a partir de agora, vale também para tarefa concluída, e uma correção não pode pôr o início
   depois da conclusão (respondido em 2026-10-22).
3. ~~ADR e rotas da checklist como recurso próprio (decisão 6).~~ ✅ ADR-0028: adicionar no fim,
   mudar (renomear, marcar), remover fechando o buraco, e reordenar com a lista inteira de ids
   numa transação — uma lista que não seja exatamente os itens atuais recebe 409 (respondido
   em 2026-10-22).
4. ~~ADR, migration e `PATCH /me` da janela do dia útil (decisão 12).~~ ✅ ADR-0029. Duas
   colunas no usuário (`day_starts_at`, `day_ends_at`), com padrão 06:00–22:00, as mesmas 16h
   de antes. O orçamento de cada dia é o tempo real entre os dois horários, com teto de 18h. A
   ocupação continua contada no dia inteiro. A janela não cruza a meia-noite. `GET /me` mostra a
   janela, e `PATCH /me` a altera, julgando o par.

**O trabalho de base está completo.** O que segue é o redesign, quando a semana voltar do
Claude Design com as correções pedidas.
5. ~~Teste automático de contraste dos tokens (decisão 8).~~ ✅ Feito junto com a troca dos
   tokens pela direção Papel do design system (ADR-0026). O teste lê o `tokens.css` como ele é
   entregue; um par novo que as telas passem a usar tem que entrar no `contrast-pairs.json`,
   senão o teste não sabe que ele existe.

O foco da caixa de concluir (decisão 3) é front e espera o descongelamento.

**Uma correção ao que estava escrito na PR 4**, sobre a regra do passado. Duas das três opções
estavam erradas. "Manter e consertar excluindo e recriando" não funcionava, porque recriar com
início no passado esbarra na mesma regra. E "recusar só quando o novo início se afasta mais do
agora" não resolvia o próprio exemplo que motivou a pergunta (corrigir 09:00 para 08:00 é se
afastar do agora). A decisão 1 é a versão que resolve o exemplo.

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
| 5 | ✅ Verbos `move` e `delete` com undo — o undo é recriação, só onde ela é fiel ([ADR-0025](adr/0025-undo-is-a-recreate.md)) | 3 | não |
| 6 | ⏸ A oferta de mover, do dia pesado — pausada até a terceira rodada de design | 5 | não |
| 7 | ⏸ Confirmar endereço, três estados — pausada até a terceira rodada de design | — | não |
| 8 | ⏸ Configurações — endereço, fuso, sair — pausada até a terceira rodada de design | — | `PATCH /me` |

**O 409 que nomeia a tarefa não é pré-requisito de nada disto.** A rodada 2 o registra como
bloqueio para "mover, encurtar ou substituir", e a leitura do design desfez isso: o painel de
mover calcula a disponibilidade no cliente, com as tarefas que a tela já tem, e o edit mostra
a frase do servidor no conflito. Nenhuma das três telas precisa desse dado. Ele continua
valendo por si — só não bloqueia o item 2.

### Aberto pela PR 3 — gatilho mudado em 2026-10-22: **quando todas as telas estiverem prontas e definitivas** (decisão 4)

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

### Aberto pela PR 5 — decidido em 2026-10-22: não oferecer (decisão 2)

**Mover uma tarefa já concluída.** A PR 5 não oferece o verbo numa linha concluída. Concluir
cedo encurta o `end_at` para o momento da conclusão (ADR-0022); movida para um dia depois desse
momento, a tarefa ganha um intervalo vazio — parece mudar de lugar e não ocupa nada, e o
plano-contra-real que o S6 vai ler deixa de significar alguma coisa. As opções:

- **Manter como está:** concluída não se move. Corrigir o dia de uma tarefa já feita vira editar
  o horário, que esbarra na regra do passado (acima).
- **Mover só para antes do `completed_at`**, onde o intervalo continua de pé. Exige o cliente
  saber disso e o servidor concordar, e o caso é raro.
- **Permitir e aceitar o intervalo vazio**, tratando a concluída como registro e não como
  reserva. Muda o que o `end_at` significa para o S6.

### Achados da PR 5

- **Toda escrita recarrega a semana inteira pelo esqueleto.** O `refetch` muda a janela, o
  status volta a `loading`, e o `WeekScreen` troca a tela toda pelo `WeekSkeleton` até a resposta
  chegar — então o elemento focado some, em qualquer verbo. A PR 5 devolve o foco depois da
  recarga para `edit`, `note`, `move`, excluir e desfazer. **A caixa de concluir, o verbo mais
  usado, continua perdendo o foco.** Consertar de vez pede manter a semana anterior na tela
  enquanto a nova chega, o que esbarra de propósito no `WeekUnreachable`, que prefere não mostrar
  número velho. É decisão, não detalhe.
- **A oferta do dia pesado sugere dia que já passou.** Numa quarta, a sexta estourada dizia
  "Mon has 16h free". O `lightestDay` do `load.ts` não olha o relógio. É a PR 6, que vai
  transformar a frase em botão — e um botão para mover algo para segunda-feira passada seria
  recusado pelo servidor.
- **Região viva inserida já com texto.** O aviso `deleted · título` é `role="status"` e
  `aria-live="polite"`, e nasce junto com o texto, porque a semana inteira é remontada depois da
  recarga. Leitores de tela anunciam esse caso de forma inconsistente. O jsdom confirma o papel e
  o texto, não o que um leitor fala: falta uma passada com NVDA ou VoiceOver.
- **O brief dizia que o projeto não usa `autoFocus`.** Usa: o `NewTaskForm` foca o título ao
  abrir, com o `eslint-disable` justificado. A convenção de foco programático que existe é a do
  `WeekScreen` — focar o título da linha pelo id —, e foi essa que a PR 5 seguiu.

### Aberto pela PR 4 — decidido em 2026-10-22: correção limitada a 24h (decisão 1) — ✅ ADR-0027

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

### Aberto pela PR 3 — decidido em 2026-10-22: voltar a mostrar o número, o tempo real decorrido (decisão 7)

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

### A semana no desktop da terceira rodada — revisada em 2026-10-22

O Claude Design entregou a semana no desktop sobre o Papel, e a revisão está no brief local
(`docs/design-brief-3-passo-2.md`). Duas escolhas da tela mudam comportamento, e foram
decididas:

- **A oferta do dia pesado passa a escolher a tarefa.** A regra é aritmética: a menor tarefa
  ainda não começada que, sozinha, tira o dia do excesso, levada para o dia mais leve depois de
  hoje. Ela vale até o S6, quando a escolha passa para a IA, a quem o ADR-0022 a tinha
  reservado. A regra vira ADR quando a tela for implementada.
- **Concluir continua sendo Espaço, e a legenda de atalhos continua visível.** A tela tinha
  trocado para X e escondido a legenda, o que deixava os atalhos invisíveis para quem não usa
  leitor de tela. Entra a tecla C, que abre a checklist.

Dois pontos voltaram para correção. A escada de carga: a tela a recalculava com limites
próprios (12h, 14h, 16h), em vez de usar o `load` do servidor. E o criar tarefa, que faltava.

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
campo, e o `docs/design/` desenhou o campo sem nenhuma delas. **Decidido em 2026-10-22:
sugerir e avisar** (decisão 5), na terceira rodada de design.

Duas precisam de servidor e não dependem de tela nenhuma:

- **Conflito com saídas.** O 409 de sobreposição não diz **qual** tarefa ocupa o horário. Sem
  esse dado a tela não consegue oferecer mover, encurtar ou substituir. Substituir tem que ser
  atômico no servidor — excluir e criar em duas chamadas deixa o horário livre no meio.
- **Editar a checklist.** `TaskUpdate` não tem campo de itens e nenhuma rota toca em
  `ChecklistItem`. **Decidido em 2026-10-22: recurso próprio em `/tasks/{id}/items`**
  (decisão 6). Falta o ADR e as rotas.

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
  não pode ser mudado. ~~Carrega junto os itens 7–9 do ADR-0023: a coluna
  `users.usable_minutes`…~~ O ADR-0029 trocou esses itens por uma janela: o `PATCH /me` e o
  `GET /me` já existem para ela, e falta só a tela que a altera, desenhada no passo 4 da
  terceira rodada.
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

## Aberto pelo ADR-0024 — a suavização da interface, 2026-10-19

A mudança foi restrita às folhas de estilo de propósito, e quatro coisas ficaram do lado de
fora dessa linha:

- ~~**O `--accent` do tema claro reprova sobre os próprios tons de alarme**: 4,35:1 no chip
  `over by`, 3,88:1 numa linha aberta de dia estourado.~~ ✅ Resolvido pelo ADR-0026: o texto
  de problema passou a ser `alert-ink`, a 6,29:1 sobre `alert-surface` no claro.
- **O tema claro não liga pela interface.** ~~O `App.tsx` põe `data-theme` num `div`.~~ O
  atributo foi para o `<html>`, fixo em `dark`, e o claro renderiza certo quando ele muda
  (ADR-0026). Falta o seletor nas configurações, que é tela.
- **O padding do shell mora em dois lugares.** O `App.tsx` escreve `56px 64px` inline e o
  `tokens.css` sobrescreve com `!important` abaixo de 1100px. Quando o padding sair do inline,
  o override sai junto — o seletor casa com o próprio valor inline, então ele para de valer
  sozinho, mas continua lá até alguém apagar.
- **A faixa de 700–1099px começa na segunda-feira**, e numa sexta o dia de hoje fica fora da
  tela até alguém arrastar. Rolar até hoje precisa de script.

~~E uma fora do `docs/`: o `CLAUDE.md` diz que são 23 ADRs, e agora são 24.~~ Corrigido na
PR 5, que levou a contagem a 25.

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
