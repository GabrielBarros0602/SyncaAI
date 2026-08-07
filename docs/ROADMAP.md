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

## S1 — Modelagem de domínio e banco de dados · ⏳ Próximo

Escopo mínimo decidido: `User`, `Day`, `Task`, `ChecklistItem`. Hábitos, Listas, Heatmap e
Tabela semanal ficam para S8; Notas entram no S7, junto com o caso de uso que precisa delas.

- [ ] Modelar `User`, `Day`, `Task`, `ChecklistItem`
- [ ] **Decidir: como representar um bloco de tempo.** `start` + `end` em `timestamptz`, ou
      `start` + duração em minutos inteiros? A query de capacidade livre — da qual a camada
      de IA inteira depende — soma minutos ocupados por dia. Com início e fim, sobreposição é
      detectável diretamente e a soma exige subtração por linha; com início e duração, a soma
      é trivial e sobreposição exige recalcular o fim. Não é escolha cosmética: define a
      forma da query mais importante do sistema. → merece **ADR-0008**
- [ ] **Decidir: fuso horário — e aqui a resposta padrão não basta.** "UTC no banco, converter
      na borda" está certo para *instantes*, mas um calendário agrupa por *dia local*, e dia
      local não é derivável de UTC sem o fuso do usuário. Provavelmente precisa dos dois:
      `timestamptz` para o instante mais uma `local_date` materializada para agrupar, mais
      `User.timezone`. Guardando só UTC, heatmap e contador de sequência erram perto da
      meia-noite; guardando só data local, ordenação e duração atravessando dias quebram.
      → merece **ADR-0009**
- [ ] **Decidir: `Day` é entidade ou visão derivada?** O protótipo linka nota a um dia, tem um
      quadrado por dia no heatmap e contador de sequência — tudo sugere linha por dia. Mas dia
      vazio não precisa existir. Materializar sob demanda ou derivar por agregação muda o
      custo da query do heatmap: 365 leituras indexadas contra varredura com `GROUP BY`.
      → merece **ADR-0010**
- [ ] **Decidir: delete físico ou lógico em `Task`.** A IA vai propor tarefas que o usuário
      descarta. Histórico de descarte mede a qualidade das gerações, o que é justamente a
      métrica que o portfólio quer apresentar — isso pesa para lógico.
- [ ] Restrições no schema, não só no Python: foreign keys, `NOT NULL`, `CHECK` garantindo
      fim posterior ao início, `CHECK` de duração positiva
- [ ] Índices no que a query de capacidade vai filtrar: `(user_id, local_date)`
- [ ] Alembic inicializado, primeira migration gerada e aplicada
- [ ] Migration verificada nos dois sentidos: `upgrade` e `downgrade` rodam limpos

**Regras de negócio a definir:** duração zero é válida? tarefa pode ser agendada no passado?
duas tarefas do mesmo usuário podem se sobrepor no tempo? apagar `Task` apaga os
`ChecklistItem`, ou eles ficam órfãos?

---

## S2 — CRUD do domínio e a query de capacidade

- [ ] Schemas Pydantic `Create` / `Update` / `Read` por entidade
- [ ] Repositórios SQLAlchemy, injetados via `Depends`
- [ ] Serviços com as regras de verdade
- [ ] Routers conectados em `api/v1/router.py`
- [ ] Exceções de domínio mapeadas para status HTTP num lugar só — não `HTTPException`
      espalhado pelos serviços
- [ ] Paginação nos endpoints de listagem
- [ ] **A query de capacidade livre por dia numa janela** — por dia: minutos ocupados, minutos
      livres, contagem de tarefas. É a fundação da camada de IA (ADR-0004) e precisa estar
      testada antes de qualquer linha de código de IA existir
- [ ] Testes de integração dos repositórios contra PostgreSQL real
- [ ] Query de capacidade medida com `EXPLAIN ANALYZE` numa janela de 14 dias, com os índices
      do S1 confirmados em uso

**Marco:** ao fim do S2 existe um produto que já funciona sem nenhuma IA. Isso não é efeito
colateral — é o requisito de degradação do ADR-0006, verificado na prática antes de existir
algo de que degradar.

---

## S3 — Autenticação e isolamento por dono

- [ ] **Decidir: algoritmo de hash de senha** — bcrypt ou argon2. Nunca um SHA puro: hashes de
      uso geral são rápidos, e rápido é exatamente o errado aqui
- [ ] Emissão e verificação de JWT
- [ ] Dependência `get_current_user`
- [ ] **Isolamento por dono em toda query.** A falha de segurança mais provável deste projeto:
      o usuário A ler `/tasks/42`, que pertence ao usuário B. O filtro por `user_id` precisa
      viver no repositório, não ser lembrado por cada serviço
- [ ] Teste que prova o isolamento em cada endpoint que recebe um id
- [ ] **Decidir: recurso de outro dono responde 404 ou 403.** 403 confirma que o recurso
      existe, o que é vazamento de informação. 404 não distingue "não existe" de "não é seu"
- [ ] **Decidir: tempo de vida do token e estratégia de refresh**
- [ ] Rate limit no endpoint de login, separado do rate limit de IA do S5

---

## S4 — Pipeline de IA sem provedor

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

## S5 — Provedor real, guardrails e degradação

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

## S6 — Front-end ligado à API

- [ ] Protótipo migrado do HTML estático para build real, preservando o design system em `_ds/`
- [ ] Fluxo de autenticação
- [ ] Terceiro destino `To plan` na Captura rápida, e o comando equivalente no `⌘K`
- [ ] Card de revisão do draft: itens, dia sugerido de cada um, edição, Approve e Discard
- [ ] Polling do status do job com backoff
- [ ] Draft aprovado renderizado como o componente `3 of 5 preparations done`
- [ ] Estados de erro visíveis: job falhou, provedor fora, acima do teto, rate limit

**Marco:** ao fim do S6 o caso de uso 2 está completo e publicável. É o ponto em que o projeto
pode ir para o currículo.

---

## S7 — Assistência a tarefa específica

Não começa antes do S6 estar publicado. Regra do ADR-0002.

- [ ] Entidades `Note` e o vínculo "link to a day"
- [ ] Variante do montador de contexto com allowlist mais larga e explícita
- [ ] Streaming via SSE — transporte diferente porque a saída é prosa, não objeto (ADR-0003)
- [ ] Ponto de entrada na própria tarefa
- [ ] Resultado persistido como nota anexada ao dia
- [ ] Reuso confirmado: rate limit, teto, cache e circuit breaker sem reimplementação

**Verificação da tese do ADR-0002:** este sprint deveria ser curto porque o caso 2 já
construiu a infraestrutura. Se ele custar tanto quanto o S4 e o S5 somados, a premissa estava
errada e vale registrar isso num ADR — errar previsão documentada é material melhor de
entrevista do que acertar sem registro.

---

## S8 — Superfícies restantes do protótipo · primeiro sprint a cortar

- [ ] Listas e itens de lista, com o destino `To list` da Captura rápida
- [ ] Hábitos e contagem de sequência
- [ ] Heatmap anual
- [ ] Tabela semanal em figuras
- [ ] `⌘K` completo, incluindo navegação e busca
- [ ] `Up next` com contagem regressiva e preparações rastreadas

---

## S9 — Testes, acabamento e publicação

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
