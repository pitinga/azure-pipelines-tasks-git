# Pipeline de integração Azure DevOps — 8 Git Tasks

O arquivo [azure-pipelines-test-all.yml](../azure-pipelines-test-all.yml) invoca **todas as oito tasks** em um agente Azure DevOps real. Não é o mesmo que os testes unitários do GitHub Actions.

## Pré-requisitos

1. Instalar o VSIX **Git Tasks for Azure Pipelines** na organização Azure DevOps.
2. Ter agente >= 4.265.1 (Node24) no pool `managed-agent-pool-linux` ou ajustar o campo `pool`.
3. Criar ou escolher um **repositório Azure Repos Git exclusivamente de testes**, no **mesmo projeto Azure DevOps** da pipeline. Não utilize um repositório de produção.
4. Separar os SHAs completos de 40 caracteres de dois commits nesse repositório. `sourceCommitSha` deve ser descendente de `baseCommitSha`, com pelo menos uma alteração, para permitir a criação de um Pull Request.
5. Garantir que a identidade Build Service possua permissões para ler os commits, criar tags e branches, publicar status e criar Pull Requests no repositório de testes.
6. Acesso ao `System.AccessToken`: o arquivo o mapeia explicitamente em `env` para tornar o teste reproduzível. Não exige PAT.

## Como criar e executar

1. Azure DevOps → **Pipelines → New pipeline → GitHub** e selecione `pitinga/azure-pipelines-tasks-git`.
2. Escolha **Existing Azure Pipelines YAML file** e indique `/azure-pipelines-test-all.yml` na branch `main`.
3. Execute manualmente com **Run pipeline**. O pipeline possui `trigger: none` e `pr: none`, portanto não inicia automaticamente.
4. Informe `testRepositoryId` (GUID do repositório Azure Repos), `baseCommitSha` e `sourceCommitSha`.
5. Marque `allowTestWrites: true` somente depois de revisar o repositório selecionado. Seu valor padrão é `false` e o pré-teste bloqueará qualquer gravação.

## Cobertura

| Task | Teste | Efeito remoto |
| --- | --- | --- |
| `GitTag@1` | Dry-run, criação da tag e repetição idempotente | Cria uma tag temporária |
| `GitVerify@1` | Verifica a tag e a branch no SHA esperado | Leitura |
| `GitBranch@1` | Cria duas branches temporárias em commits diferentes | Cria branches |
| `GitCompare@1` | Compara os dois SHAs e gera relatório Markdown | Leitura; arquivo no agente |
| `GitChangelog@1` | Consulta commits e gera CHANGELOG.md | Leitura; arquivo no agente |
| `GitCommitStatus@1` | Publica um contexto de validação exclusivo do run | Cria status de commit |
| `GitPullRequest@1` | Cria PR draft da branch source para a target | Cria um PR de teste |
| `GitMerge@1` | Confere o PR e simula a tentativa de merge | **Não faz merge** |

Os relatórios `GitCompare.md` e `CHANGELOG.md` ficam nos artifacts da execução do pipeline.

## Segurança e limites do teste

- **Nenhum merge real é realizado**. `GitMerge@1` é executada com `dryRun: 'true'` e `confirmMerge: 'false'`.
- Os nomes de tag e branches têm o prefixo `git-tasks-e2e/<Build.BuildId>` para evitar colisões. O contexto de status também identifica o build.
- O PR é criado como **draft**, sem tentativa de aprovação ou conclusão.
- **Não há limpeza automática**: após conferir o resultado, abandone o PR e exclua a tag e branches de teste no Azure Repos.
- O pipeline configura `checkout: none` e fornece `repositoryId` e `commitSha` explicitamente: isso demonstra que o código local do agente não é necessário.
- A descoberta automática de artefatos de **Classic Releases** não é testada nesse YAML e precisa de um teste adicional em uma Classic Release.
- A descoberta automática do token sem mapeamento `env` também não é testada aqui, deliberadamente. Nosso teste usa o token explícito para isolar problemas de autenticação.
- As tasks GitCompare/Changelog podem limitar a contagem de alterações/commits conforme os parâmetros respectivos.

Importante: os testes unitários e o build VSIX no GitHub Actions não executam as tasks no Azure DevOps. Este YAML só será de fato executado quando configurado e disparado em Azure Pipelines.
