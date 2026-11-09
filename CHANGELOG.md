# Histórico de versões

## 0.1.1 — Correção GitChangelog

- `GitChangelog@1` versão `1.0.1`: consulta `POST /commitsbatch` com as duas referências e limite de commits, conforme API Azure Repos 7.1.
- Evita relatório silenciosamente vazio quando a comparação remota indica commits novos.
- Relatório informa explicitamente quando não há commits novos.
- Novos testes de regressão para commit filho/pai, comparação por tags e respostas vazias ou inesperadas.
- Mantém os GUIDs e as versões major de todas as tasks; outras tasks continuam em `1.0.0`.

## 0.1.0 — Primeira versão

- Oito tasks Git para Azure Pipelines com execução exclusiva Node24.
