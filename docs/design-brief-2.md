# Claude Design — segunda rodada

A primeira rodada trouxe a semana 2.0 e a entrada 2.1, que estão implementadas. Esta pede a
tela completa: os verbos que faltam, e as duas telas pequenas que ainda não existem.

## Antes de colar

1. **Anexe o design system salvo.** Se você não chegou a extrair um na primeira rodada,
   extraia agora a partir da semana 2.0 antes de pedir qualquer coisa nova — senão as telas
   voltam com outra escala tipográfica e outro espaçamento.
2. **Anexe o codebase de novo.** Os campos mudaram desde a primeira rodada: `usable_minutes`,
   `load`, `unbooked_minutes` e o `end_at` que encurta quando a tarefa é concluída cedo.
3. **Não peça as três telas de uma vez.** A semana primeiro, sozinha. As duas pequenas depois,
   contra o resultado dela.

---

## O prompt

```
Iteração sobre o design que você já fez para o SyncaAI — a semana 2.0 e a entrada
2.1 estão implementadas e funcionando. Anexei o design system salvo: use ele, não
crie outro.

## O problema

A tela ficou boa e está incompleta, e a causa não é visual. A API sabe fazer oito
coisas; a tela oferece três: criar tarefa, listar, marcar como concluída. Falta
verbo, não decoração.

Não preencha espaço. O que agradou foi "poucos elementos e nenhuma decoração", e
densidade visual quebra exatamente isso. O trabalho é caber mais ação dentro da
mesma calma.

## A pergunta central

Uma linha de tarefa precisa aceitar seis ações — concluir, editar, mover de dia,
excluir, abrir nota, abrir checklist — sem virar barra de ferramentas. São sete
colunas lado a lado, cada uma com várias linhas.

Me mostre duas ou três respostas diferentes para isso, não uma. Revelar no hover ou
no foco é resposta válida, desde que o teclado alcance tudo.

## A semana — o que precisa caber

Por linha de tarefa:
- título, hora de início, hora de fim, duração (já existem)
- etiqueta opcional (já existe)
- concluir e reabrir (já existe)
- quando foi concluída, e quanto tempo levou de fato contra o planejado. Uma tarefa
  de 3h concluída em 1h30 é o dado mais interessante desta tela e hoje ele some
- nota opcional, texto livre
- checklist opcional: cada item tem rótulo e está concluído ou não
- editar título, horário e duração
- excluir

Por coluna de dia:
- qual dia é hoje. Nada na tela diz isso hoje, e é o pior buraco que ela tem
- minutos livres, ocupados, quantidade de tarefas (já existem)
- os avisos de dia pesado (já existem)
- ao lado do aviso, uma ação de mover algo daqui para o dia mais leve da semana

No cabeçalho:
- voltar para a semana atual. Hoje dá para andar entre semanas e não dá para voltar
- email e fuso (já existem)

## O caso que ninguém desenhou ainda

Uma tarefa pode atravessar a meia-noite: começa 19:00 de quarta e termina 04:00 de
quinta. Os minutos contam nos dois dias — a quinta fica com 4h ocupadas por causa
dela. Hoje a quinta mostra "1 task · 4h booked" com a coluna vazia, porque a lista
só mostra a tarefa no dia em que ela começa.

Como a quinta mostra isso? Repete a linha nos dois dias com marca de continuação?
Uma faixa presa no topo do dia? Outra coisa? É decisão sua e é a que eu mais quero
ver resolvida.

O mesmo problema em escala menor: a linha lê "19:00 – 04:00" sem nada dizendo que
as 04:00 são de amanhã.

## Duas telas pequenas, depois da semana

**Configurações** — email, fuso horário editável, trocar senha, sair da conta.
Mesmo sistema, sem novidade estética. Precisa de estado de salvo e de erro por
campo.

**Confirmar endereço** — o usuário chega por um link de email que carrega um
código. A tela confirma sozinha ao abrir e diz o resultado. Três estados e nenhum
formulário: confirmando, confirmado, e link inválido ou já usado.

## Não desenhe

Prioridade, cor por tarefa, recorrência, lembrete, participantes, anexos, meta,
progresso percentual, sequência de dias, pontuação. Nenhum desses campos existe no
banco e desenhar um deles cria trabalho que eu não vou fazer.

Sem chat e sem campo de prompt. A camada de IA ainda não existe. O único lugar em
que ela encosta é a ação de mover algo daqui, e hoje isso é aritmética sobre dados
que a tela já tem, não modelo.

## Entregue

A semana completa em três estados: um dia normal, um dia acima da capacidade, e um
dia recebendo a metade de uma tarefa que veio da véspera.

Código, não só imagem.
```

---

## Depois que a semana voltar

Peça as duas telas pequenas em uma segunda mensagem, contra o resultado já aprovado. Pedir
tudo junto faz ele gastar atenção nas telas fáceis e entregar a difícil pela metade.

## O que trazer de volta

1. As duas ou três respostas para a densidade da linha, não só a escolhida.
2. A resposta para a meia-noite, em código.
3. Os estados novos: nota aberta, checklist aberta, linha em edição.
4. Os tokens, se algum nasceu nesta rodada.
