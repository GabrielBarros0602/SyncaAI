# Claude Design — configuração e prompt

Para as três telas do S5 do SyncaAI.

---

## Parte 1 — Use as ferramentas nesta ordem

O Claude Design tem quatro recursos além do prompt. Usar todos de uma vez atrapalha; a ordem
abaixo importa.

### 1.1 Anexe o codebase — faça isso primeiro

Anexe o repositório do SyncaAI. É o que mais melhora o resultado, por um motivo específico:
o `apps/api/syncaai/schemas/` tem **os campos reais** que a API devolve. Com o codebase
anexado, o designer não precisa acreditar na minha lista — ele lê a fonte.

Ele também pega de graça o `README.md` (contexto do produto) e o `apps/web/` (React 19,
TypeScript estrito, nenhuma biblioteca de componente).

Seguro de anexar: `.env` é ignorado pelo git, então o repositório não carrega segredo. O
`.env.example` só tem valores de exemplo.

### 1.2 Anexe as referências como imagem, recortadas

Recorte o que você quer de cada um dos cinco sites. Recorte fechado comunica melhor que
captura de página inteira — página inteira traz junto tudo o que você **não** quer.

### 1.3 NÃO crie o design system ainda

Contraintuitivo, e é a parte que mais economiza retrabalho.

O design system vira base de todos os projetos da conta. Criado agora, ele só pode ser
extraído das referências — e você herdaria o sistema de um portfólio, que não é o que você
está construindo.

A ordem certa:

1. Peça **só a tela da semana**, com o prompt abaixo mais as imagens.
2. Itere até ela estar certa.
3. **Aí sim** peça para extrair um design system a partir dela.
4. Peça entrar e criar conta **contra o sistema salvo** — saem consistentes de primeira.

Design system extraído do seu próprio resultado é seu. Extraído de referência é de outra
pessoa.

### 1.4 Templates: pule

São ponto de partida genérico. Para a estética que você quer, um template briga em vez de
ajudar. Se abrir por curiosidade, olhe estrutura, não visual.

### 1.5 Peça os botões de ajuste por nome

Ele gera controles ao vivo para espaçamento, cor e layout, mas escolhe quais se você não
disser. Peça três: **densidade**, **peso do acento**, **intensidade do movimento**. E mexa
neles **antes** de comentar qualquer detalhe — os três mudam a percepção de tudo, e comentar
antes é retrabalho garantido.

### 1.6 Refine por comentário no elemento

Mais preciso que reescrever prompt. Depois peça para aplicar a mudança no design inteiro.

---

## Parte 2 — O que sobrevive das referências

O site da Maria João tem oito interações destacadas pelo Awwwards. Só três funcionam numa
ferramenta de uso diário — as outras são de portfólio, e portfólio é visitado uma vez.

| Efeito | Serve? | Por quê |
|---|---|---|
| Directional color blob on hover | **Sim, é o melhor** | Preenchimento que entra pelo lado de onde o cursor veio. Numa linha de tarefa ou célula de dia, faz a lista responder sem pedir atenção |
| Navbar scroll animation | **Sim** | Cabeçalho que condensa. Útil quando a semana é longa |
| Text reveal | **Sim, uma vez** | Ao dado chegar, não ao rolar |
| Cards tilt hover | Com cuidado | Sutil vira resposta tátil; forte vira brinquedo |
| Pills physics | Não | Física divertida numa página "sobre". Num calendário é ruído |
| Particles typography | Não | É o herói de um portfólio. O seu herói é um número |
| Typography scroll animation | Não | Dashboard não é narrativa rolada |
| Project image transition | Não | Você não tem imagem |

A descrição que a própria autora deu do site é o melhor resumo do registro que você quer:
**"calm, typographic, led by decisions and outcomes."**

---

## Parte 3 — O prompt

Cole inteiro.

```
Desenhe a interface do SyncaAI. Comece pela tela da semana; ela carrega a tese do
produto, e se ela não funcionar as outras duas não importam.

## O produto

Painel de operação pessoal. O usuário registra tarefas com hora de início e
duração; a tela principal mostra, por dia da semana, quantos minutos já estão
ocupados e quantos sobram livres. A frase que resume tudo é "sua terça tem 90
minutos livres".

Há uma camada de IA planejada que ainda não existe. Não desenhe nada dela: sem
chat, sem campo de prompt, sem botão de gerar.

## Idioma

Inglês. Sentence case sempre, nunca Title Case.

## Direção estética

Calmo, tipográfico, conduzido pelo dado. Minimalista de verdade — não "poucos
elementos com muita decoração", mas poucos elementos e nenhuma decoração. O que
está na tela ou é dado, ou é uma ação, ou não deveria existir.

Isto é um instrumento, não um aplicativo de produtividade fofo. O produto trata
tempo como contrato: a capacidade de um dia é um número que o banco de dados
conhece, não uma sugestão. A interface deve soar assim — precisa, sem ser fria.

Cinco decisões concretas:

1. Tipografia carrega a hierarquia. Tamanho e peso fazem o trabalho que caixa,
   borda e sombra fariam. Se um elemento precisa de caixa para se separar do
   vizinho, o espaçamento está errado antes da caixa.

2. Uma cor de acento só, e ela significa alguma coisa. O resto neutro. Superfície
   escura como padrão, quase preta e não cinza-azulada; o modo claro existe e
   funciona, mas o escuro é a identidade.

3. Monoespaçada para todo número — minutos, horas, datas. Proporcional para
   texto. Número é o conteúdo aqui, e ele merece um tipo que alinha.

4. Numeração como estrutura, no estilo de documento técnico. Os dias e os itens
   podem ser numerados. Orientação, não enfeite.

5. Atalho de teclado visível ao lado de cada ação principal. Numa ferramenta
   aberta todo dia, atalho é função — e mostrá-lo faz a interface parecer o que
   ela é.

## Movimento

Suave e curto. Três momentos, e só:

- o dado chegando: os números da semana revelam uma vez, não a cada scroll
- o ponteiro sobre uma linha de tarefa ou célula de dia: um preenchimento que
  entra pelo lado de onde o cursor veio, direcional
- concluir uma tarefa: transição de estado, não celebração

Nada de scroll-jacking, cursor customizado, preloader, partículas, física,
WebGL, ou animação de entrada longa. Isto é aberto toda manhã: o que impressiona
na primeira visita irrita na décima. Respeite prefers-reduced-motion.

Interatividade que vale: resposta imediata ao ponteiro e ao teclado. Estados de
foco visíveis e bonitos, porque metade do uso vai ser por teclado.

## Os dados que existem de verdade

Estão no codebase anexado, em apps/api/syncaai/schemas/. Não invente campos.

Por dia:
- data, dia da semana
- total de minutos que o dia tem — normalmente 1440, mas 1380 ou 1500 nos dias
  de virada de horário de verão. A geometria precisa aguentar dias de tamanhos
  diferentes; se assumir que todo dia é igual, quebra duas vezes por ano
- minutos ocupados, minutos livres
- quantidade de tarefas
- se o dia está acima da capacidade

Por tarefa:
- título, hora de início, hora de fim, duração em minutos
- uma etiqueta opcional, texto
- itens de checklist opcionais, com rótulo e se está concluído
- se está concluída, e quando

Do usuário: email, fuso horário.

NÃO existe: prioridade, cor por tarefa, sequência de dias, pontuação, categoria
fixa, participantes, anexos, recorrência, lembrete, progresso percentual, meta.

## As três telas

**1. A semana** — principal.
- os sete dias, minutos livres por dia em destaque
- as tarefas de cada dia
- criar tarefa: título, dia, hora de início, duração, etiqueta opcional, itens
  de checklist opcionais
- marcar tarefa como concluída
- ir para a semana anterior e a próxima
- sair da conta

**2. Entrar** — email e senha, link para criar conta, link para recuperar senha.
Erros que precisam de lugar, com este texto exato:
- "Incorrect email or password."
- "Confirm your address before signing in."
- "Too many attempts. Try again later."

**3. Criar conta** — email, senha, fuso horário. A resposta é sempre a mesma
exista ou não a conta: uma tela pedindo para checar a caixa de entrada, sem
revelar se o endereço já estava cadastrado. Precisa de erro por campo.

## Estados que precisam ser desenhados

Metade do trabalho de implementação está aqui, e é o que sempre falta:

- carregando, antes de saber se o usuário está logado. Não pode piscar a tela de
  login para quem já está logado
- semana inteira sem nenhuma tarefa
- um dia vazio no meio de uma semana cheia
- um dia acima da capacidade: zero minutos livres, e precisa dizer que passou,
  sem número negativo
- conflito ao criar tarefa: "That time is already taken by another task."
- falha de rede

## Restrições técnicas

- React com CSS. Sem biblioteca de componentes.
- Modo claro e escuro, ambos funcionais. Escuro é o padrão.
- Desktop primeiro, responsivo até tablet.
- Contraste AA.

## Entregue

Só a tela da semana, nos três estados: cheia, vazia, e com um dia acima da
capacidade. As outras duas telas eu peço depois.

Gere botões de ajuste para densidade, peso do acento e intensidade do movimento.
```

---

## Parte 4 — Ordem de iteração

1. Mexa nos botões de ajuste antes de comentar qualquer coisa.
2. Peça os três estados da semana, se não vieram.
3. Comente nos elementos, um por vez; peça para aplicar no design inteiro.
4. Quando a semana estiver certa, **peça para extrair o design system a partir dela**.
5. Peça entrar e criar conta contra o sistema salvo.
6. Por último, a semana em largura de tablet.

---

## Parte 5 — O que trazer de volta

1. **Código exportado**, não só imagem. HTML e CSS servem — eu converto para React.
2. **Os tokens**: cores nos dois modos, escala tipográfica, escala de espaçamento, raio,
   durações. Como variáveis CSS, de preferência.
3. **Os estados**, não só o caso feliz.
4. **Duas larguras** da semana.

Só imagem funciona, mas custa mais e sai menos fiel.

---

## O que fica decidido aqui e não lá

Engenharia, não design. Continua sendo sua decisão:

- **Como escrever estilo.** Recomendação: CSS Modules, que o Vite já suporta sem instalar
  nada. Tailwind aparece mais em vaga, mas é configuração extra num front-end que o S8
  substitui.
- **Biblioteca de animação.** Os três movimentos pedidos acima são CSS puro. O blob
  direcional é duas variáveis CSS atualizadas no `mousemove` — não precisa de biblioteca.
  Motion só passa a valer com transição de rota e orquestração de lista, provavelmente S8.
- **Roteador.** Decidir quando as telas existirem.
