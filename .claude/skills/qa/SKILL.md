---
name: qa
description: Roda uma rodada de QA no Furicord com os agentes gerente-qa (define os limites e audita) e refatorador (limpa e modulariza o código). Use quando o usuário pedir QA, limpeza, refatoração ou modularização do código com os agentes.
argument-hint: "[plano] [arquivo, pasta ou objetivo]"
---

# Rodada de QA

Pedido do usuário: $ARGUMENTS

Você orquestra dois subagentes definidos em `.claude/agents/`: o `gerente-qa`, que decide o que pode ser tocado e audita o resultado, e o `refatorador`, que faz a limpeza dentro desses limites. Uma guarda (`.claude/hooks/qa-guarda.mjs`) impõe os limites a cada edição e comando deles. Você não refatora nada por conta própria nesta rodada: seu papel é passar o trabalho de um para o outro e contar ao usuário o que aconteceu.

Os dois agentes começam sem contexto. Tudo que eles precisam saber tem de estar no prompt que você escreve.

## Passos

1. **Limpar a rodada anterior.** Apague `.qa/escopo.json` e `.qa/guarda.log`, se existirem. Sem escopo aberto o refatorador fica travado, que é o estado de repouso correto.

2. **Planejar.** Lance o `gerente-qa` com um prompt que comece por `Modo: PLANEJAR` e traga o alvo pedido pelo usuário (arquivo, pasta ou objetivo), copiado como ele escreveu. Sem alvo, diga ao gerente para escolher o melhor candidato. Espere a ordem de serviço.
   - Se o gerente responder "GUARDA INATIVA" ou disser que o build já está quebrado, pare e relate ao usuário.
   - Se o pedido começou com `plano`, mostre a ordem de serviço e as próximas rodadas sugeridas, apague `.qa/escopo.json` e encerre aqui. Nada foi editado.

3. **Executar.** Mostre ao usuário, em duas ou três linhas, o objetivo e os arquivos liberados. Em seguida lance o `refatorador` com a ordem de serviço do gerente copiada na íntegra, sem resumir nem acrescentar tarefas. Espere o relatório.
   - Se ele responder "GUARDA INATIVA", pare e relate.

4. **Auditar.** Lance o `gerente-qa` com `Modo: AUDITAR` e o relatório do refatorador copiado na íntegra. Espere o veredito.

5. **Ajustar, se preciso.** Com veredito AJUSTES, devolva a lista de ajustes ao refatorador (continue o mesmo agente se puder; se não, lance um novo com a ordem de serviço original mais a lista) e audite de novo. No máximo dois ciclos de ajuste; se ainda não aprovar, trate como REPROVADO.

6. **Encerrar.** Apague `.qa/escopo.json` para travar o refatorador de novo. Não faça commit nem stage: o usuário revisa no VS Code e commita ele mesmo.

## O que contar ao usuário

Em português, curto, começando pelo veredito:

- O que mudou e em quais arquivos.
- O resultado das verificações (build, testes), como o gerente relatou.
- O que a guarda barrou, se barrou algo.
- A lista "Conferir na mão" do gerente.
- As próximas rodadas sugeridas.

Com veredito REPROVADO, não desfaça nada sozinho. Liste os arquivos alterados e criados na rodada e pergunte ao usuário se ele quer descartar essas alterações ou mantê-las para ajustar à mão.

Relate o que os agentes disseram como está, inclusive falhas. Se um agente não terminou ou devolveu algo incompleto, diga isso em vez de preencher a lacuna.
