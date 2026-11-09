# Pipeline de integração Azure DevOps — 8 Git Tasks

O arquivo [azure-pipelines-test-all.yml](../azure-pipelines-test-all.yml) exercita as oito tasks num agente Azure Pipelines real. **Nao precisa informar repositorio ou SHA**: usa a propria fonte do pipeline, que precisa ser um repositorio **Azure Repos Git na branch develop**.

## Pré-requisitos

1. Instalar o VSIX Git Tasks for Azure Pipelines na organizacao Azure DevOps.
2. Usar agent >= 4.265.1 (Node24). Pool configurado: `managed-agent-pool-linux`.
3. Usar **um repositorio Azure Repos Git exclusivo para testes**, com branch `develop` e pelo menos dois commits. Nao usar producao.
4. Copiar o arquivo `azure-pipelines-test-all.yml` deste repositorio GitHub **para a branch `develop` do repositorio Azure Repos de exemplo**, e configurar a pipeline Azure DevOps com esse repositorio como **fonte `self`**. Se a fonte da pipeline continuar sendo GitHub, a validacao inicial bloqueara a execucao.
5. Conceder a identidade Build Service permissoes de leitura, criacao de tags e branches, status e Pull Requests no repo de exemplo. `System.AccessToken` e mapeado em `env`, sem PAT.

## Execucao

Azure DevOps → Pipelines → New pipeline → Azure Repos Git → escolha o **repositorio de exemplo** → Existing Azure Pipelines YAML file → branch **develop** → caminho `/azure-pipelines-test-all.yml`.

Em **Run pipeline**, selecione `develop` e marque somente **`allowTestWrites: true`**. O valor padrao e `false`; sem confirmar, nenhuma operacao remota de escrita ocorrera. Nao ha parametros de GUID ou SHA.

## Como a origem e obtida

- A pipeline verifica `Build.Repository.Provider = TfsGit` e `Build.SourceBranch = refs/heads/develop`.
- Usa `Build.Repository.ID` e `Build.SourceVersion` fornecidos pelo Azure Pipelines.
- A etapa de preparo consulta **GET Git Commits** pela API REST do Azure Repos para buscar `parents[0]`, salvando como `$(E2EBaseSha)` para as comparacoes e para a branch de destino.
- O pipeline utiliza `checkout: none`; as tasks operam remotamente usando a REST API, sem dependencia do checkout local.
- A pipeline deve usar um commit recente com mudancas em relacao ao anterior. Um commit inicial sem pai nao serve para o teste.

## Cobertura e efeitos

| Task | Teste | Efeito |
| --- | --- | --- |
| GitTag | Simulacao, criacao e idempotencia | Cria tag `git-tasks-e2e/<BuildId>` |
| GitVerify | Confirma SHA da tag e branch | Somente leitura |
| GitBranch | Cria branch origem no SHA atual e destino no SHA anterior | Cria duas branches temporarias |
| GitCompare | Compara SHA anterior e atual | Grava `GitCompare.md` no agente |
| GitChangelog | Compara commits anterior e atual | Grava `CHANGELOG.md` no agente |
| GitCommitStatus | Publica status de homologacao | Cria status de commit com contexto especifico |
| GitPullRequest | Cria um PR draft entre as branches temporarias | Cria PR de teste |
| GitMerge | Verifica PR e simula merge | **Nao realiza merge** (`dryRun=true`) |

Os dois relatorios sao publicados como artifacts do pipeline.

## Protecoes e limpeza

- `trigger: none` e `pr: none`: somente execucao manual.
- A preparacao recusa fontes que nao sejam Azure Repos Git, branch diferente de develop e commits sem pai.
- Cria somente tags/branches com prefixo `git-tasks-e2e/<BuildId>` e PR `draft`.
- GitMerge usa `confirmMerge: false` e `dryRun: true`; nao faz merge, mesmo quando autorizado a executar os demais testes.
- **A limpeza e manual**: abandone o PR draft e exclua as branches e a tag de teste quando terminar.
- Essa pipeline nao prova a descoberta de artefatos Classic Release e nao exercita conclusao real de PR.

Os testes estruturais do GitHub Actions validam o YAML, mas nao substituem uma execucao efetiva no Azure DevOps.
