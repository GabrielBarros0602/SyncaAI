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

---

## Pendências abertas

Questões conhecidas que não estão resolvidas. Vivem aqui para não depender de ninguém lembrar.
Fechar uma pendência é removê-la desta tabela no mesmo commit que a resolve.

| Pendência | Onde resolver |
|---|---|
| Unicidade de email recai sobre o valor gravado, normalizado pelo serviço. Um escritor que passe por fora do serviço poderia gravar variante de caixa. Índice funcional sobre `lower(email)` resolveria, ao custo de o `alembic check` não comparar índice de expressão de forma confiável | S4 |
| `get_engine` ainda lê `get_settings()` por dentro, então o motor de banco não é substituível por injeção — só por variável de ambiente. Aceitável enquanto é decisão de processo e não de requisição, mas é a última leitura implícita que sobrou | quando incomodar |
| Tarefa não tem `tag`, que o protótipo mostra. String livre convida dado inconsistente; tabela de tags é decisão de design ainda não tomada | S4 |
| `(task_id, position)` não é único, então dois itens podem dividir a mesma posição e a ordem do checklist fica não determinística. Tornar único tem custo em reordenação — é decisão, não conserto óbvio | S4 |
| Entidade de **período** para atividades multi-dia — o `Up next` do protótipo. Não é tarefa e não consome capacidade de dia ([ADR-0012](adr/0012-task-time-business-rules.md)) | S9 ou stretch |
| Semântica do heatmap: como intensidade derivada e marca explícita se combinam numa cor só ([ADR-0010](adr/0010-day-as-a-table-for-day-level-state.md)) | S9 |
| Horas reais gastas por sprint não estão sendo anotadas, então a estimativa do [ADR-0001](adr/0001-backend-stack.md) segue não validada | contínuo |
| Conector do GitHub não autorizado, então o CI não é visível de dentro das sessões de trabalho | quando incomodar |

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

## S2 — Autenticação e isolamento por dono · ⏳ Em andamento

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
- [ ] Dependência `get_current_user`
- [ ] **Classe base de repositório com escopo por dono**, sem nenhum acessor sem escopo —
      a query sem filtro não deve ser expressável
- [ ] Caminho até o dono declarado por modelo, para `ChecklistItem` escopar via `tasks`
- [ ] Rate limit no endpoint de login, separado do rate limit de IA do S7
- [ ] Rate limit no endpoint de cadastro — ele faz um hash argon2 de 64 MiB por
      chamada, então sem limite é vetor de exaustão de memória, independente de
      enumeração
- [x] Teste provando que refresh revogado não emite access token
- [x] `User.timezone` validado contra `zoneinfo` antes de gravar
- [x] Email normalizado antes de gravar; a unicidade recai sobre o valor já normalizado

**Dívida que o S5 tem que honrar:** o access token vive só em memória no cliente. O refresh
já está fora do alcance de script pelo ADR-0017, mas se o front-end guardar o **access** token
em `localStorage`, um XSS ganha 30 minutos que não precisava ganhar.

---

## S3 — Verificação de email e respostas genéricas de autenticação

Existe porque o cadastro respondendo 409 revela quais endereços têm conta. Verificação de
email é o que torna **honesta** uma resposta genérica no cadastro.

O ponto que decide se este sprint funciona: fechar a brecha exige que **toda** resposta de
autenticação fique genérica. Se uma escapar, o vazamento só muda de porta.

- [ ] **Decidir:** provedor de email — serviço transacional ou SMTP direto → merece ADR
- [ ] **Decidir:** conta não verificada faz login, ou fica bloqueada até verificar
- [ ] Abstração de envio com dublê para teste, mesmo padrão do `PlanGenerator` do S6
- [ ] Modelo de token de verificação: dono, hash do token, expiração, usado em
- [ ] Cadastro sempre responde 202; o **email** decide a mensagem — link de verificação para
      endereço novo, aviso de tentativa para endereço que já tem conta
- [ ] Endpoint de verificação com uso único e expiração
- [ ] Reenvio com rate limit próprio — sem ele é vetor de email bombing
- [ ] Login não distingue conta não verificada de conta inexistente
- [ ] Recuperação de senha com resposta genérica, exista a conta ou não
- [ ] Degradação: o que a aplicação faz quando o provedor de email está fora
- [ ] **Teste provando que cadastro de endereço novo e de endereço existente devolvem
      respostas idênticas** — é a asserção que justifica o sprint, no mesmo formato do teste
      byte a byte do login

---

## S4 — CRUD do domínio e a query de capacidade

- [ ] Schemas Pydantic `Create` / `Update` / `Read` por entidade
- [ ] Repositórios SQLAlchemy herdando a base com escopo por dono do S2, injetados
      via `Depends` — nascem filtrados por `user_id`, sem retrofit
- [ ] Teste que prova o isolamento em cada endpoint que recebe um id: usuário A
      pedindo recurso de B não recebe o recurso
- [ ] Serviços com as regras de verdade
- [ ] Routers conectados em `api/v1/router.py`
- [ ] Exceções de domínio mapeadas para status HTTP num lugar só — não `HTTPException`
      espalhado pelos serviços
- [ ] Paginação nos endpoints de listagem
- [ ] **A query de capacidade livre por dia numa janela** — por dia: minutos ocupados, minutos
      livres, contagem de tarefas. É a fundação da camada de IA (ADR-0004) e precisa estar
      testada antes de qualquer linha de código de IA existir
- [ ] Violação da constraint de exclusão traduzida para erro de domínio legível
- [ ] Regra de serviço recusando início no passado, com erro de domínio e teste na fronteira:
      um minuto atrás recusa, um minuto à frente aceita
- [ ] Capacidade livre calculada com `minutes_in_local_day`, não com 1440, e com piso em zero
      — um dia pode reportar mais minutos ocupados do que tem
- [ ] Testes de integração dos repositórios contra PostgreSQL real
- [ ] Query de capacidade medida com `EXPLAIN ANALYZE` numa janela de 14 dias, com os índices
      do S1 confirmados em uso

**Marco:** ao fim do S4 existe um produto que já funciona sem nenhuma IA. Isso não é efeito
colateral — é o requisito de degradação do ADR-0006, verificado na prática antes de existir
algo de que degradar.

---

## S5 — Primeira fatia visível

Antecipado de propósito. Sem esta fatia, nada do produto é visível antes do S7, e o vazio
entre S1 e S7 é onde a motivação morre. Depende do S2 e do S4 e de mais nada — nenhuma IA.

- [ ] Tela de login e cadastro, consumindo os endpoints do S2
- [ ] Sessão persistida no cliente e rota protegida
- [ ] Tela única: a semana com capacidade livre por dia, alimentada pela query do S4
- [ ] Criar e concluir tarefa pela interface
- [ ] Estados vazios e de erro visíveis, não tela branca

**Marco:** ao fim do S5 o projeto é apresentável para qualquer pessoa, não só para quem lê
código. Login de verdade, dado de verdade, a tese do produto na tela — "sua terça tem 90
minutos livres". A camada de IA ainda não existe, e o produto já se explica sozinho.

**O que fica devendo:** este front-end é deliberadamente mínimo e será substituído no S8,
quando o protótipo inteiro entra. Trate como vitrine funcional, não como base definitiva.

---

## S6 — Pipeline de IA sem provedor

Sprint inteiro construído contra um dublê. Se qualquer coisa aqui custar dinheiro, algo está
errado.

- [ ] Interface `PlanGenerator` e `FakeGenerator` — antes do cliente real, não depois
- [ ] Modelo `ai_job` e fila em PostgreSQL com `SELECT ... FOR UPDATE SKIP LOCKED`
- [ ] Visibility timeout: job de worker que morreu volta para a fila
- [ ] Worker como serviço separado no compose
- [ ] Montador de contexto como função pura (ADR-0004)
- [ ] **O teste que prova a privacidade:** fixture de calendário com títulos sensíveis,
      asserção de que essas strings não aparecem no prompt montado. Esse teste *é* a garantia
      de privacidade — sem ele a política do ADR-0004 é só texto
- [ ] Modelo Pydantic da resposta; JSON schema gerado a partir dele, fonte única
- [ ] Validação de invariantes de domínio separada da validação de schema (ADR-0005)
- [ ] Uma tentativa de reparo, alimentada pelos erros de validação
- [ ] Agendador como função pura: itens e capacidades entram, atribuições saem. Fronteiras
      primeiro — capacidade insuficiente, zero dias livres, item maior que qualquer bloco
- [ ] `plan_draft` e `draft_item`
- [ ] Endpoint de commit do draft: uma transação e idempotency key
- [ ] `prompt_version` no job e na chave de cache desde o primeiro commit deste sprint
- [ ] Salvamento parcial: draft com 9 de 12 itens válidos é utilizável e mostra o descarte

**Por que o dublê primeiro:** o agendador e o validador são as partes mais arriscadas e as
mais testáveis do projeto — funções puras sobre fixture. Construídas contra `FakeGenerator`,
ficam cobertas por testes rápidos, determinísticos e gratuitos. É também o que fecha a lacuna
de "nenhum projeto com testes automatizados publicados".

---

## S7 — Provedor real, guardrails e degradação

- [ ] Cliente real com structured output nativo do provedor
- [ ] Tabela `ai_usage` escrita em toda chamada concluída: tokens de entrada e saída, custo
      calculado, latência, modelo, `prompt_version`, id do job
- [ ] Estimativa de custo **antes** da chamada; recusa se a estimativa estoura o teto
- [ ] Rate limit por usuário, duas janelas: 10/hora e 30/dia, `429` com `Retry-After`
- [ ] Teto mensal por usuário
- [ ] Kill switch global de gasto — é este que protege a conta bancária, porque a falha
      realista é um bug no próprio front-end em loop
- [ ] Cache com chave incluindo `context_fingerprint`
- [ ] **Teste de integração que prova a ordem** `rate limit → cache → teto`: especificamente,
      um cache hit é servido mesmo com o usuário acima do teto
- [ ] Circuit breaker no cliente; testar aberto e half-open
- [ ] Fallback manual: criar checklist à mão, no mesmo editor do draft gerado
- [ ] Golden fixtures de respostas reais, incluindo pelo menos duas inválidas
- [ ] Alerta de orçamento do lado do provedor, abaixo do teto global

---

## S8 — Front-end ligado à API

- [ ] Protótipo migrado do HTML estático para build real, preservando o design system em `_ds/`
- [ ] Fluxo de autenticação
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
