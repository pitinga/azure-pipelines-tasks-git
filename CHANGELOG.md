# Histórico de versões

## 1.0.0 — Preparação para a primeira publicação pública

- Manifesto da extensão marcado como público e versão de lançamento atualizada.
- Identidade `pitinga.azure-pipelines-tasks-git` e GUIDs das oito tasks preservados.
- Documentação do Marketplace e exemplos YAML atualizados para a autenticação automática e booleanos corretos.
- Funcionalidades homologadas em Azure Pipelines e Classic Releases, com agentes Linux / Node24.

## 0.1.3 — URLs de Classic Release / Azure DevOps

- Normaliza URLs oficiais de coleções Azure DevOps (`dev.azure.com`, `*.visualstudio.com`) e URLs do serviço de Releases (`vsrm.dev.azure.com`, `*.vsrm.visualstudio.com`) para seus respectivos endpoints Git/Build e Release.
- Prioriza `SYSTEM_TEAMFOUNDATIONCOLLECTIONURI` nas Classic Releases, com compatibilidade para os nomes alternativos de variável de sistema.
- Mantém validação estrita HTTPS de host oficial, sem aceitar domínios arbitrários.
- Corrige informação sobre OAuth nos metadados das oito tasks.
- Atualiza versões patch das oito tasks para garantir a substituição dos arquivos armazenados em cache nos agentes.
- Acrescenta testes para formatos de endereço moderno/legado, fallback e rejeição de URLs inválidas.

## 0.1.2 — GitChangelog: consulta independente do histórico

- Calcula quantidade de commits novos pelo endpoint `diffs/commits`, já homologado pela task GitCompare.
- Recupera os commits da versão de destino via `GET /commits`, sem filtro `compareVersion`, que retornou vazio no Azure Repos real para commit-pai e filho.
- Gera o changelog usando no máximo a quantidade de commits à frente, respeitando `maxCommits`, e mostra aviso de truncamento.
- Bloqueia relatórios falsos quando faltam commits ou o SHA inicial do histórico diverge do destino.
- Testes cobrindo commits consecutivos, saída Markdown, limites, histórico vazio e SHA divergente.

## 0.1.1 — Correção GitChangelog (substituída)

- Proteção contra resultado vazio do `commitsbatch`. A validação em Azure Repos demonstrou que a consulta ainda retornava vazio em um commit filho.

## 0.1.0 — Primeira versão

- Oito tasks Git para Azure Pipelines, Node24, IDs próprios e extensão privada.
