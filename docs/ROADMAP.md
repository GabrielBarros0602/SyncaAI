# SyncaAI — checklist de desenvolvimento

Documento de trabalho. Governa a ordem do desenvolvimento e o que conta como pronto.

Regras: nenhum sprint começa antes do anterior estar no `origin` e verde no CI. Item que
começa com **Decidir:** só está pronto quando o ADR está escrito e commitado — não quando o
código funciona.

**Um item só é marcado quando está no `origin`.** Escrito no disco não conta. O checkbox vira
no mesmo commit que fecha o item, então este arquivo é sempre verdadeiro e
`git log -p docs/ROADMAP.md` mostra exatamente quando cada coisa fechou.

Convenções de commit em [`../CONTRIBUTING.md`](../CONTRIBUTING.md). Decisões em
[`adr/`](adr/README.md).

**Repositório:** https://github.com/GabrielBarros0602/SyncaAI
**Modelo de ameaças:** [`threat-model.md`](threat-model.md)

## Esforço por sprint

O git mede só o que foi commitado. Decisão, leitura e revisão não produzem commit, e a
janela de calendário abaixo não as enxerga — o S2 fechou em 1,1 dia de commits depois de
dias de conversa que não aparecem em lugar nenhum.

Horas passam a ser anotadas a partir do S3, com registro feito na hora e não reconstruído
depois.

| Sprint | Calendário (git) | Horas |
|---|---|---|
| S0 | 4,4 dias | — |
| S1 | 6,1 dias | — |
| S2 | 1,1 dia | — |

---

## Pendências abertas

Questões conhecidas que não estão resolvidas. Vivem aqui para não depender de ninguém lembrar.
Fechar uma pendência é removê-la desta tabela no mesmo commit que a resolve.

| Pendência | Onde resolver |
|---|---|
| Domínio próprio com SPF, DKIM e DMARC, e conta no provedor. Sem isso o envio fica restrito ao próprio dono da conta, então ninguém mais completa o cadastro. O código está pronto e testado contra o dublê — falta a decisão | antes de demonstrar ou publicar |
| Cliente real do provedor de email. Um arquivo e uma entrada no mapa de backends, quando houver domínio | junto com o item acima |
| Quatro tabelas acumulam linhas expiradas que ninguém remove: `rate_limit_counters`, `refresh_tokens`, `verification_tokens` e `password_reset_tokens`. O expurgo precisa de um agendador, que nasce com o worker. Decidido no [ADR-0031](adr/0031-a-job-queue-in-postgresql-woken-by-notify.md): de hora em hora, no worker | S6 |
| Rate limit usa `request.client.host`, que atrás de um proxy é o endereço do proxy — o limite viraria global. Exige uvicorn com proxy headers e lista de encaminhadores confiáveis; confiar em `X-Forwarded-For` sem isso seria pior que não limitar. **O [ADR-0021](adr/0021-browser-session-and-origin.md) tornou isso certo em vez de hipotético:** uma origem só em desenvolvimento significa um proxy em produção | S11, no deploy |
| **Entrar com o Google.** É bom material de back-end — OAuth 2.0 / OpenID Connect e federação de identidade —, mas o vínculo entre contas exige ADR próprio: casar por email de forma ingênua é caminho de **sequestro de conta** (o atacante cadastra o seu endereço antes de você, e o vínculo entrega a conta dele para você). Só vincular com a conta existente já verificada, o `email_verified` do provedor confirmado, e ainda assim pedindo a senha uma vez. O segredo do cliente nunca chega ao navegador (mesma regra da chave de IA, [ADR-0001](adr/0001-backend-stack.md)) | mesmo gatilho do domínio: **antes de demonstrar ou publicar**. É quando "crie uma conta com senha" vira atrito para quem não é você |
| **Recuperação de senha não tem tela.** Os dois endpoints existem e funcionam; nenhum tem interface, e link que não vai a lugar nenhum é pior que link ausente — por isso a tela de entrar não oferece "forgot your password". É também a primeira coisa que justifica um roteador de verdade, porque o link do email carrega token na URL | S8, ou antes de publicar, o que vier primeiro |
| O caminho **logado** nunca foi exercitado de ponta a ponta: conta real, cookie real, token de 30 minutos que expirou de verdade. O que existe hoje prova o caminho **deslogado** — o `401` atravessando o proxy foi verificado com os dois processos no ar. Metade disso vira teste de CI permanente (cadastro → token do `RecordingMailer` → verificação → login `web` → `/refresh` **só com o cookie** → `/me`, tudo no `TestClient`, que guarda cookie). A outra metade exige navegador de verdade e fica manual: uma passada sua com `docker compose up -d db` | teste de CI **no PR das telas**; a passada manual, uma vez, no mesmo PR |
| ✅ **Horário útil por usuário como preferência** — feito como janela no [ADR-0029](adr/0029-the-usable-day-is-a-window-each-person-sets.md); os dias de folga e o bloco vêm no [ADR-0032](adr/0032-days-off-and-a-preferred-block-length.md). A constante de 16h já existe ([ADR-0022](adr/0022-capacity-against-a-usable-day.md)); falta virar coluna e tela. O `GET /me` é a casa | A capacidade livre é medida contra o dia inteiro, então às 3 da manhã existem 60 minutos livres e nada impede o agendador de usá-los. Numa demo isso não parece arredondamento errado, parece produto quebrado. Exige ADR quando chegar: muda schema (preferências por usuário) e muda o que "capacidade livre" significa. O `GET /me` já é a casa disso, e o ADR-0004 já lista as três preferências que o planejador precisa — duração de bloco preferida, dias de folga, horário útil | **S6**, antes do agendador |
| Serviço `web` no `docker-compose.yml`. Hoje a demo exige dois terminais. Adiado de propósito: Vite em container costuma quebrar o HMR por sincronia de arquivos, e a decisão pertence à mesma conversa de proxy reverso que o [ADR-0021](adr/0021-browser-session-and-origin.md) empurrou para lá | S11, no deploy |
| Entidade de **período** para atividades multi-dia — o `Up next` do protótipo. Não é tarefa e não consome capacidade de dia ([ADR-0012](adr/0012-task-time-business-rules.md)) | S10 ou stretch |
| Semântica do heatmap: como intensidade derivada e marca explícita se combinam numa cor só ([ADR-0010](adr/0010-day-as-a-table-for-day-level-state.md)) | S10 |
| Eu não enxergo o CI de dentro das sessões de trabalho, então o resultado sempre precisa ser colado. O conector do GitHub resolveria; o `gh` já resolveu o atrito de abrir PR, que era a parte que incomodava você | quando incomodar |

---

## S0 — Estrutura do repositório e walking skeleton · ✅ Concluído

- [x] Repositório criado no GitHub
- [x] Monorepo: `apps/api`, `apps/web`, `docs/adr`
- [x] ADR-0001 a ADR-0006 — stack, recorte do produto, camada de IA
- [x] README com definição do problema, em inglês com seção em português
- [x] `.gitignore`, `LICENSE`, `.env.example`
- [x] `pyproject.toml` com ruff, mypy strict e pytest
- [x] `Dockerfile` e `docker-compose.yml` com PostgreSQL
- [x] Workflow de CI: ruff, ruff format, mypy, pytest
- [x] `CONTRIBUTING.md` com a convenção de commits ampliada
- [x] `requirements.in` compilado para `requirements.txt` com `uv pip compile --universal`,
      alvo 3.12 — resolvedor uv, instalação pip, motivo no `CONTRIBUTING.md`
- [x] `config.py`: `Settings` via pydantic-settings, injetado com `get_settings`
- [x] `db.py`: engine, sessionmaker e dependência `get_session`
- [x] `GET /health` — liveness, sem dependência nenhuma
- [x] `GET /health/ready` — readiness, `SELECT 1` no banco
- [x] Testes dos dois endpoints
- [x] `docker compose up` sobe API e banco num comando
- [x] `git init`, remote `origin`, histórico atômico empurrado

**Por que dois endpoints de saúde e não um:** o orquestrador *reinicia* o container quando
liveness falha, e apenas *para de rotear tráfego* quando readiness falha. Um endpoint único
que consulta o banco faz uma oscilação de rede no Postgres reiniciar a aplicação sem motivo.
É o princípio do ADR-0006 em miniatura.

---

## S1 — Modelagem de domínio e banco de dados · ✅ Concluído

Escopo mínimo decidido: `User`, `Day`, `Task`, `ChecklistItem`. Hábitos, Listas, Heatmap e
Tabela semanal ficam para S10; Notas entram no S9, junto com o caso de uso que precisa delas.

- [x] Modelar `User`, `Day`, `Task`, `ChecklistItem`. O `User` já nasce com `email`,
      `password_hash` e `timezone`, porque o S2 depende deles. `Task` **não** tem `day_id`
- [x] **Decidido:** bloco de tempo é `start_at` + `duration_minutes`, com `end_at` como coluna
      gerada pelo banco → [ADR-0008](adr/0008-task-time-block.md)
- [x] **Decidido:** instantes em `timestamptz` e dia local derivado; nenhuma `local_date`
      materializada → [ADR-0009](adr/0009-time-and-timezone-storage.md)
- [x] **Decidido:** `days` existe para estado do próprio dia, e as tarefas não a referenciam
      → [ADR-0010](adr/0010-day-as-a-table-for-day-level-state.md)
- [x] **Decidido:** delete físico em `Task`; a métrica de IA vem de `draft_item`, não de tarefa
      apagada → [ADR-0011](adr/0011-hard-delete-for-tasks.md)
- [x] Extensão `btree_gist` habilitada na primeira migration
- [x] Restrições no schema, não só no Python: foreign keys, `NOT NULL`,
      `CHECK (duration_minutes > 0)`, único em `(user_id, local_date)` em `days`,
      `ON DELETE CASCADE` de `Task` para `ChecklistItem`
- [x] Constraint de exclusão GiST proibindo sobreposição de tarefas do mesmo usuário
- [x] Índice `(user_id, start_at)` — é ele que a query de capacidade usa, via predicado de
      range em UTC calculado na borda
- [x] Helper único convertendo (janela em data local, zona) para intervalo UTC, com teste
      atravessando mudança de horário de verão — e `minutes_in_local_day`, porque um dia
      local dura 1380 ou 1500 minutos nas viradas de horário de verão
- [x] `CHECK (duration_minutes > 0 AND duration_minutes <= 1440)`
      → [ADR-0012](adr/0012-task-time-business-rules.md)
- [x] Alembic inicializado, primeira migration escrita e aplicada pelo CI
- [x] Migration verificada nos dois sentidos: o CI roda `upgrade`, `downgrade` e `upgrade`

**Regras de negócio já resolvidas pelos ADRs:** duração zero é inválida (`CHECK > 0`), duas
tarefas do mesmo usuário não podem se sobrepor (constraint de exclusão), apagar `Task` apaga os
`ChecklistItem` (`ON DELETE CASCADE`).

**Regras de tempo resolvidas:** sem criação no passado, máximo de 1440 minutos, e os
minutos contam no dia em que a tarefa começa → [ADR-0012](adr/0012-task-time-business-rules.md)

---

## S2 — Autenticação e isolamento por dono · ✅ Concluído

- [x] **Decidido:** hash de senha com argon2id, padrões `m=65536, t=3, p=4`
      → [ADR-0014](adr/0014-password-hashing-with-argon2id.md)
- [x] **Decidido:** access token JWT de 30 min mais refresh opaco de 30 dias, guardado
      hasheado e revogável → [ADR-0015](adr/0015-session-model.md)
- [x] **Decidido:** recurso de outro dono responde 404, com o motivo real no log
      → [ADR-0016](adr/0016-ownership-isolation.md)
- [x] `JWT_SECRET`, `ACCESS_TOKEN_MINUTES` e `REFRESH_TOKEN_DAYS` em settings — o segredo
      obrigatório, sem default, e recusado abaixo de 32 bytes, que é o mínimo da RFC 7518
      para HS256
- [x] Par de funções de hash isolando o algoritmo num lugar só, com limite de tamanho de
      senha antes de hashear, e verificação-isca para o caso de conta inexistente
- [x] Emissão e verificação de access token JWT, com tipo de token checado e `exp`
      obrigatório
- [x] Cadastro e login, com hash de custo comparável mesmo quando o email não existe, para
      não vazar a existência da conta por tempo de resposta
- [x] Erros de domínio mapeados para HTTP num lugar só — nenhum serviço importa
      `HTTPException`
- [x] Tabela `refresh_tokens`: dono, token hasheado, expiração, revogado em, criado em
- [x] Endpoint de refresh recusando expirado, revogado e desconhecido com a **mesma**
      resposta, para não revelar qual dos três
- [x] **Decidido:** refresh entregue por cookie `HttpOnly` a cliente web e no corpo a
      cliente nativo, de forma exclusiva → [ADR-0017](adr/0017-refresh-token-delivery.md)
- [x] Logout revoga o refresh token apresentado, e responde igual para token inexistente
- [x] Dependência `get_current_user_id`, que não toca no banco, e `get_current_user` para
      os endpoints que precisam da linha inteira
- [x] **Classe base de repositório com escopo por dono**, sem nenhum acessor sem escopo —
      a query sem filtro não é expressável
- [x] Caminho até o dono declarado por modelo, para `ChecklistItem` escopar via `tasks`
- [x] Rate limit no endpoint de login, separado do rate limit de IA do S7
- [x] Rate limit no endpoint de cadastro — ele faz um hash argon2 de 64 MiB por
      chamada, então sem limite é vetor de exaustão de memória, independente de
      enumeração
- [x] Teste provando que refresh revogado não emite access token
- [x] `User.timezone` validado contra `zoneinfo` antes de gravar
- [x] Email normalizado antes de gravar; a unicidade recai sobre o valor já normalizado

**Dívida que o S5 tem que honrar:** o access token vive só em memória no cliente. O refresh
já está fora do alcance de script pelo ADR-0017, mas se o front-end guardar o **access** token
em `localStorage`, um XSS ganha 30 minutos que não precisava ganhar.

---

## S3 — Verificação de email e respostas genéricas de autenticação · ✅ Concluído

Existe porque o cadastro respondendo 409 revela quais endereços têm conta. Verificação de
email é o que torna **honesta** uma resposta genérica no cadastro.

O ponto que decide se este sprint funciona: fechar a brecha exige que **toda** resposta de
autenticação fique genérica. Se uma escapar, o vazamento só muda de porta.

- [x] **Decidido:** provedor transacional atrás de abstração com dublê, enviando de domínio
      próprio com SPF, DKIM e DMARC → [ADR-0018](adr/0018-email-delivery.md)
- [x] **Decidido:** conta não verificada não faz login. Credencial certa em conta não
      verificada responde 403; todo o resto continua no 401 genérico
      → [ADR-0019](adr/0019-account-verification.md)
- [x] Abstração de envio com dublê para teste, mesmo padrão do `PlanGenerator` do S6 —
      interface, implementação de console e implementação que grava em memória
- [x] Modelo de token de verificação: dono, hash do token, expiração, usado em
- [x] Cadastro sempre responde 202; o **email** decide a mensagem — link de verificação para
      endereço novo, aviso de tentativa para endereço que já tem conta
- [x] Endpoint de verificação com uso único e expiração — `POST`, não link com `GET`,
      porque scanner de email seguiria o link e gastaria o token antes do dono clicar
- [x] Reenvio com rate limit próprio — sem ele é vetor de email bombing
- [x] Login não distingue conta não verificada de conta inexistente — o 403 só é
      alcançável depois de a senha bater
- [x] Recuperação de senha com resposta genérica, exista a conta ou não — e o reset
      revoga todas as sessões abertas, senão quem sabia a senha antiga continuaria dentro
- [x] Degradação: falha de envio não derruba a operação, é registrada em log com o
      endereço em digest, e o usuário tem o caminho de reenvio
- [x] **Teste provando que cadastro de endereço novo e de endereço existente devolvem
      respostas idênticas** — é a asserção que justifica o sprint, no mesmo formato do teste
      byte a byte do login

---

## S4 — CRUD do domínio e a query de capacidade · ✅ Concluído

- [x] **Decidido:** tags são linhas por usuário, criadas sob demanda, **sem CRUD próprio**
      → [ADR-0020](adr/0020-domain-surface-choices.md)
- [x] **Decidido:** `(task_id, position)` é único com verificação adiada ao commit
      → [ADR-0020](adr/0020-domain-surface-choices.md)
- [x] **Decidido:** paginação por `LIMIT` e `OFFSET`, com teto de tamanho de página
      → [ADR-0020](adr/0020-domain-surface-choices.md)
- [x] Tabela `tags` por usuário, única em `(user_id, name)`, e a relação opcional com `Task`
      que limpa em vez de cascatear
- [x] `UNIQUE (task_id, position) DEFERRABLE INITIALLY DEFERRED` aplicada no schema
- [x] Unicidade de email sobre o valor normalizado, imposta pelo schema — índice funcional
      sobre `lower(email)`. **Se o `alembic check` passar a acusar divergência em todo PR, é
      porque ele não compara índice de expressão de forma confiável, e aí a exclusão entra
      no `env.py` com o motivo escrito**
- [x] Schemas Pydantic `Create` / `Update` / `Read` por entidade
- [x] Repositórios SQLAlchemy herdando a base com escopo por dono do S2, injetados
      via `Depends` — nascem filtrados por `user_id`, sem retrofit
- [x] Teste que prova o isolamento em cada endpoint que recebe um id: usuário A
      pedindo recurso de B não recebe o recurso
- [x] Serviços com as regras de verdade
- [x] Routers conectados em `api/v1/router.py`
- [x] Exceções de domínio mapeadas para status HTTP num lugar só — não `HTTPException`
      espalhado pelos serviços
- [x] Paginação nos endpoints de listagem
- [x] **A query de capacidade livre por dia numa janela** — por dia: minutos ocupados, minutos
      livres, contagem de tarefas. É a fundação da camada de IA (ADR-0004) e precisa estar
      testada antes de qualquer linha de código de IA existir
- [x] Violação da constraint de exclusão traduzida para erro de domínio legível
- [x] Regra de serviço recusando início no passado, com erro de domínio e teste na fronteira:
      um minuto atrás recusa, um minuto à frente aceita
- [x] `PATCH` distingue campo ausente de `null` explícito — sem isso uma nota podia ser
      escrita e nunca removida
- [x] Capacidade livre calculada com `minutes_in_local_day`, não com 1440, e com piso em zero
      — um dia pode reportar mais minutos ocupados do que tem
- [x] Testes de integração dos repositórios contra PostgreSQL real
- [x] Query de capacidade medida com `EXPLAIN ANALYZE` numa janela de 14 dias, com os índices
      do S1 confirmados em uso

**Marco:** ao fim do S4 existe um produto que já funciona sem nenhuma IA. Isso não é efeito
colateral — é o requisito de degradação do ADR-0006, verificado na prática antes de existir
algo de que degradar.

---

## S5 — Primeira fatia visível

Antecipado de propósito. Sem esta fatia, nada do produto é visível antes do S7, e o vazio
entre S1 e S7 é onde a motivação morre. Depende do S2 e do S4 e de mais nada — nenhuma IA.

- [x] **Decidido:** Vite + React + TypeScript, três telas, sem biblioteca de estado
      → vitrine funcional, substituída no S8 — **revisto em 2026-10-21, ver o fim desta seção**
- [x] **Decidido:** o navegador fala com **uma origem só** — o Vite encaminha `/api/*` para a
      API, e a API **não ganha CORS** → [ADR-0021](adr/0021-browser-session-and-origin.md)
- [x] **Decidido:** access token **só em memória**, com refresh silencioso pelo cookie
      `HttpOnly`. Nada em `localStorage` nem em `sessionStorage`
      → [ADR-0021](adr/0021-browser-session-and-origin.md)
- [x] `vite.config.ts` com o proxy, e lint que proíbe qualquer acesso a storage do navegador
- [x] Estado de sessão com três valores; nada renderiza antes do refresh de boot resolver
- [x] Um único wrapper de HTTP dono do retry após `401`, com refresh em voo compartilhado
- [x] Teste: dois `401` simultâneos causam **exatamente uma** chamada a `/auth/refresh`
- [x] `GET /me` — a tela precisa do fuso **armazenado**, não do fuso do navegador; os dois
      podem divergir e a divergência é silenciosa
- [x] Janela `first_day`/`last_day` em `GET /tasks`, mesmo vocabulário do `/capacity`
- [x] Pedido sem token responde "Not authenticated." em vez de "Incorrect email or password."
- [x] Cliente lê `detail` em lista, que é a forma que um erro de validação do Pydantic tem
- [x] Tela de login e cadastro, consumindo os endpoints do S2
- [x] Sessão persistida no cliente e rota protegida
- [x] Tela única: a semana com capacidade livre por dia, alimentada pela query do S4
- [x] Criar e concluir tarefa pela interface
- [x] Estados vazios e de erro visíveis, não tela branca

**Marco:** ao fim do S5 o projeto é apresentável para qualquer pessoa, não só para quem lê
código. Login de verdade, dado de verdade, a tese do produto na tela — "sua terça tem 90
minutos livres". A camada de IA ainda não existe, e o produto já se explica sozinho.

**O que fica devendo:** ~~este front-end é deliberadamente mínimo e será substituído no S8,
quando o protótipo inteiro entra. Trate como vitrine funcional, não como base definitiva.~~

> **Revisto em 2026-10-21: o front-end não é substituído no S8. Ele é a base.**
>
> A frase acima foi escrita quando este front-end era uma vitrine de três telas e o protótipo
> em `docs/prototype/` era o destino. Desde então o item 2 do backlog está reconstruindo a
> semana a partir da **segunda** rodada de design (`docs/design/`) — quatro das oito PRs
> entraram —, as duas telas que faltam, confirmar endereço e configurações, vêm dessa mesma
> rodada, a suíte do web tem 173 testes, e o
> [ADR-0024](adr/0024-soften-the-visual-language-in-stylesheets-only.md) ajustou a linguagem
> visual por cima. O protótipo é a primeira rodada, com outro design system (`_ds/modernist`).
> Migrá-lo inteiro no S8 seria jogar fora esse trabalho para voltar a um estado já alcançado,
> justamente no sprint cujo marco é ir para o currículo.
>
> Fica assim: o S8 acrescenta as superfícies da IA a este front-end. O protótipo continua sendo
> referência para o que só ele desenha — as superfícies do S10 —, e cada uma entra no código
> atual quando o sprint dela chegar, não numa migração em bloco.

---

## S6 — Pipeline de IA sem provedor · ✅ Concluído

Sprint inteiro construído contra um dublê. Se qualquer coisa aqui custar dinheiro, algo está
errado.

- [x] **Decidido:** cada item ganha um horário concreto, dentro dos intervalos livres reais e
      dos minutos livres do dia; o rascunho tem itens editáveis; a tarefa aprovada guarda o
      `plan_id`; os links vão para a nota; o commit é tudo ou nada, com idempotency key; e
      limites de 500 caracteres, 12 itens, 14 dias e 15 a 240 minutos
      → [ADR-0030](adr/0030-a-plan-is-placed-in-real-free-time-reviewed-and-committed-whole.md)
- [x] **Decidido:** a fila acorda o worker por `NOTIFY` e faz varredura a cada 5 s, com
      visibility timeout de 120 s e três tentativas; a resposta bruta fica no job por 30 dias;
      o mesmo worker expurga as tabelas de token e de rate limit
      → [ADR-0031](adr/0031-a-job-queue-in-postgresql-woken-by-notify.md)
- [x] **Decidido:** dias de folga e duração de bloco preferida como preferências do planejador,
      sem mexer na capacidade → [ADR-0032](adr/0032-days-off-and-a-preferred-block-length.md)
- [x] Colunas `days_off` e `preferred_block_minutes`, no `GET` e no `PATCH /me`
- [x] Interface `PlanGenerator` e `FakeGenerator` — antes do cliente real, não depois
- [x] **Decidido:** as respostas do modelo ficam numa tabela própria, `ai_job_answers`, no
      máximo duas por job, e somem trinta dias depois de o job terminar
      → [ADR-0036](adr/0036-a-job-s-answers-are-rows-of-their-own.md)
- [x] Modelo `ai_job` e fila em PostgreSQL com `SELECT ... FOR UPDATE SKIP LOCKED`
- [x] Visibility timeout: job de worker que morreu volta para a fila
- [x] Worker como serviço separado no compose
- [x] **Decidido:** o modelo vê, por dia, os minutos planejáveis e o maior trecho, calculados
      pelo agendador; saem o fuso, a janela, os minutos ocupados e a contagem de tarefas; o
      fingerprint cobre tudo o que o modelo vê
      → [ADR-0034](adr/0034-the-model-sees-the-room-each-day-has-and-nothing-it-cannot-use.md)
- [x] Montador de contexto como função pura (ADR-0004)
- [x] **O teste que prova a privacidade:** fixture de calendário com títulos sensíveis,
      asserção de que essas strings não aparecem no prompt montado. Esse teste *é* a garantia
      de privacidade — sem ele a política do ADR-0004 é só texto
- [x] Modelo Pydantic da resposta; JSON schema gerado a partir dele, fonte única
- [x] Validação de invariantes de domínio separada da validação de schema (ADR-0005)
- [x] **Decidido:** qualquer item descartado pede o reparo, e fica a resposta que manteve mais
      itens, com empate para o reparo
      → [ADR-0035](adr/0035-repair-whenever-a-step-fails-and-keep-the-better-answer.md)
- [x] Uma tentativa de reparo, alimentada pelos erros de validação
- [x] **Decidido:** capacidade é ocupação real medida contra um dia útil de 16h, com quatro
      níveis de carga e nada bloqueado → [ADR-0022](adr/0022-capacity-against-a-usable-day.md)
- [x] Implementado: trigger, query com recorte por dia, `usable_minutes`, `load` e as três
      mensagens. Falta só o botão de mover, que precisa da interação, não do dado
- [x] **Horário útil por usuário, antes do agendador.** Sem isso o agendador distribui nos
      minutos livres que existirem, e às 3 da manhã existem 60. Feito como uma janela por
      pessoa → [ADR-0029](adr/0029-the-usable-day-is-a-window-each-person-sets.md)
- [x] Agendador como função pura: itens e capacidades entram, atribuições saem. Fronteiras
      primeiro — capacidade insuficiente, zero dias livres, item maior que qualquer bloco
- [x] **Decidido:** o rascunho são cinco tabelas, com dependências e links como linhas e os
      descartados à parte; só o aprovado dura, e o resto some trinta dias depois de terminar
      → [ADR-0037](adr/0037-a-draft-in-five-tables-and-only-an-approved-one-stays.md)
- [x] `plan_draft` e `draft_item`
- [x] **Decidido:** o job e o plano são dois recursos; o job aponta para o plano pelo
      `plan_id`, e tudo o que se faz com o plano acontece em `/plans/{plan_id}`
      → [ADR-0038](adr/0038-a-job-and-its-plan-are-two-resources-linked-by-id.md)
- [x] Pedir um plano (`POST /ai/plans`, 409 de um por vez), ver o job e ler o plano
- [x] Endpoint de commit do draft: uma transação e idempotency key
- [x] `prompt_version` no job desde o primeiro commit deste sprint. A chave de cache, que
      também o leva, nasce com o cache no S7
- [x] Salvamento parcial: draft com 9 de 12 itens válidos é utilizável e mostra o descarte
- [x] Itens do rascunho editáveis — título, minutos, horário, remover — revalidados contra as
      regras de criar tarefa ([ADR-0030](adr/0030-a-plan-is-placed-in-real-free-time-reviewed-and-committed-whole.md))
- [x] Expurgo, de hora em hora no worker, das tabelas de token e de rate limit, e do conteúdo
      dos jobs com mais de 30 dias ([ADR-0031](adr/0031-a-job-queue-in-postgresql-woken-by-notify.md))
- [x] **Decidido:** o plano é escrito no idioma do pedido; o horizonte padrão é de 14 dias,
      mas o plano só ocupa sozinho até o domingo da semana atual, e o resto vira "não cabe
      nesta semana" com a opção de levar para a próxima; o rascunho velho é reposicionado sem
      chamar o modelo e expira com o horizonte; um plano por vez
      → [ADR-0033](adr/0033-a-plan-fills-this-week-first-in-its-own-language-one-at-a-time.md)
- [x] "Não cabe nesta semana" e "levar para a próxima semana"
- [x] Itens vencidos marcados, "reposicionar" sem chamar o modelo, e `expired` no fim do horizonte
- [x] Um plano em andamento por pessoa: dois índices únicos parciais e 409

**Por que o dublê primeiro:** o agendador e o validador são as partes mais arriscadas e as
mais testáveis do projeto — funções puras sobre fixture. Construídas contra `FakeGenerator`,
ficam cobertas por testes rápidos, determinísticos e gratuitos. É também o que fecha a lacuna
de "nenhum projeto com testes automatizados publicados".

---

## S7 — Provedor real, guardrails e degradação

- [x] **Decidido:** nenhum provedor pago por ora. Na teoria, a Anthropic, começando no
      Claude Haiku 5.5 e medindo; agora, um modelo aberto local via Ollama, e o gerador de
      exemplo em qualquer deploy
      → [ADR-0039](adr/0039-a-local-open-model-until-a-provider-is-paid-for.md)
- [x] Gerador real local (Ollama), preso ao schema do contrato, escolhido por `AI_PROVIDER`
- [x] Corrigir o gerador local com o que a primeira medição contra um modelo real achou:
      sem raciocínio, contexto e resposta limitados, o schema visível ao modelo, nome de
      nuvem recusado → [ADR-0040](adr/0040-what-the-local-model-is-held-to-measured.md)
- [ ] Cliente do provedor pago (Anthropic, Haiku 5.5): **aguarda a decisão de pagar**
- [x] Tabela `ai_usage` escrita em toda chamada, concluída ou não, quando ela termina: tokens
      de entrada e saída, custo calculado de `prices.toml`, latência, modelo,
      `prompt_version`, id do job → [ADR-0041](adr/0041-every-call-is-metered-when-it-ends.md)
- [ ] Estimativa de custo **antes** da chamada; recusa se a estimativa estoura o teto
- [ ] Rate limit por usuário, duas janelas: 10/hora e 30/dia, `429` com `Retry-After`
- [ ] Teto mensal por usuário
- [ ] Kill switch global de gasto — é este que protege a conta bancária, porque a falha
      realista é um bug no próprio front-end em loop
- [ ] Cache com chave incluindo `prompt_version` e `context_fingerprint` (ADR-0006, ADR-0034)
- [ ] **Teste de integração que prova a ordem** `rate limit → cache → teto`: especificamente,
      um cache hit é servido mesmo com o usuário acima do teto
- [ ] Circuit breaker no cliente; testar aberto e half-open
- [ ] Fallback manual: criar checklist à mão, no mesmo editor do draft gerado
- [ ] Golden fixtures de respostas reais, incluindo pelo menos duas inválidas — do modelo
      local por ora, cada uma marcada com o modelo que a produziu (ADR-0039)
- [ ] Alerta de orçamento do lado do provedor, abaixo do teto global: **aguarda a decisão
      de pagar**

---

## S8 — Front-end ligado à API

- ~~Protótipo migrado do HTML estático para build real, preservando o design system em `_ds/`~~
  — fora do plano desde 2026-10-21; o S8 constrói sobre o front-end atual (nota no fim do S5)
- [ ] Fluxo de autenticação completo. Entrar, cadastrar e confirmar o endereço existem desde o
      S5; faltam recuperar e trocar a senha, e as duas pedem ADR antes do endpoint, porque o
      reset atual desloga todas as sessões e a troca desenhada em `docs/design/settings.html`
      não desloga (backlog, rodada 4)
- [ ] Terceiro destino `To plan` na Captura rápida, e o comando equivalente no `⌘K`
- [ ] Card de revisão do draft: itens, dia sugerido de cada um, edição, Approve e Discard
- [ ] Polling do status do job com backoff
- [ ] Draft aprovado renderizado como o componente `3 of 5 preparations done`
- [ ] Estados de erro visíveis: job falhou, provedor fora, acima do teto, rate limit

**Marco:** ao fim do S8 o caso de uso 2 está completo e publicável. É o ponto em que o projeto
pode ir para o currículo.

---

## S9 — Assistência a tarefa específica

Não começa antes do S8 estar publicado. Regra do ADR-0002.

- [ ] Entidades `Note` e o vínculo "link to a day"
- [ ] Variante do montador de contexto com allowlist mais larga e explícita
- [ ] Streaming via SSE — transporte diferente porque a saída é prosa, não objeto (ADR-0003)
- [ ] Ponto de entrada na própria tarefa
- [ ] Resultado persistido como nota anexada ao dia
- [ ] Reuso confirmado: rate limit, teto, cache e circuit breaker sem reimplementação

**Verificação da tese do ADR-0002:** este sprint deveria ser curto porque o caso 2 já
construiu a infraestrutura. Se ele custar tanto quanto o S6 e o S7 somados, a premissa estava
errada e vale registrar isso num ADR — errar previsão documentada é material melhor de
entrevista do que acertar sem registro.

---

## S10 — Superfícies restantes do protótipo · primeiro sprint a cortar

- [ ] Listas e itens de lista, com o destino `To list` da Captura rápida
- [ ] Hábitos e contagem de sequência
- [ ] Heatmap anual
- [ ] Tabela semanal em figuras
- [ ] `⌘K` completo, incluindo navegação e busca
- [ ] `Up next` com contagem regressiva e preparações rastreadas

---

## S11 — Testes, acabamento e publicação

- [ ] Pirâmide de testes: unitários para serviços, agendador e validador com repositórios
      falsos; integração para repositórios contra PostgreSQL real; camada fina de ponta a ponta
- [ ] Cobertura medida e reportada, com meta escolhida e justificada
- [ ] `Dockerfile` multi-stage separando build de runtime, usuário não-root
- [ ] Deploy com a chave do provedor em variável de ambiente do servidor
- [ ] README: badges, roteiro de demo de 5 minutos, screenshot
- [ ] **Métricas reais extraídas de `ai_usage`**: custo por geração, p50 e p95 de latência,
      taxa de reparo, hit rate do cache. Número medido no próprio sistema, não estimativa
- [ ] Auditoria final: sem placeholder, sem código morto, sem bloco comentado

---

## Fase 2 — Port do núcleo para Java 21 e Spring Boot

Gatilho: SyncaAI v1 publicado. Justificativa e estimativa no
[ADR-0001](adr/0001-backend-stack.md).

- [ ] `apps/api-java` como serviço irmão
- [ ] Núcleo: autenticação, domínio e persistência. A camada de IA fica em Python
- [ ] Spring Data JPA, Spring Security, Flyway
- [ ] Testcontainers
- [ ] Suíte de testes do Python portada como especificação executável
- [ ] Seção comparativa no README, com dados dos dois ecossistemas

---

## Stretch — primeiro a cortar se o prazo apertar

- [ ] Sugestão de reagendamento quando o dia estoura a capacidade
- [ ] Importação de calendário externo, ICS ou Google Calendar
- [ ] Notificações
- [ ] Estimativa de duração aprendida do histórico do usuário, substituindo a da IA
