# Git Tasks for Azure Pipelines

Extensão para **Azure Repos Git** com **8 tasks independentes**, todas usando exclusivamente **Node.js 24** (agente Azure Pipelines >= 4.265.1).

| Task | Operação |
| --- | --- |
| `GitTag@1` | Cria tags Git leves nos commits dos artefatos de builds ou Classic Releases |
| `GitBranch@1` | Cria branches de release/hotfix a partir dos commits publicados |
| `GitCompare@1` | Compara duas referências e gera JSON ou Markdown |
| `GitChangelog@1` | Cria changelog Markdown baseado nos commits de duas versões |
| `GitVerify@1` | Valida que uma tag/branch aponta para o SHA esperado |
| `GitCommitStatus@1` | Publica status de commit para rastreabilidade de deploy |
| `GitPullRequest@1` | Cria PR idempotente, opcionalmente como rascunho |
| `GitMerge@1` | Solicita conclusão de PR existente sem ignorar políticas |

## Exemplo — criar tag no Classic Release

Adicione **GitTag** ao job de implantação. Com parâmetros padrão, a task descobre os artefatos `Build` de origem **Azure Repos Git** na release e cria tags nos commits correspondentes. É possível limitar a operação usando `artifactAliases`.

Para um build YAML, exemplo:

```yaml
steps:
- task: GitTag@1
  displayName: 'Git | Tag da versão'
  inputs:
    tagName: 'v1.2.3'
    dryRun: 'true'   # Primeiro teste
  env:
    SYSTEM_ACCESSTOKEN: $(System.AccessToken)
```

**Autenticação:** conceda `Contribute`/permissão de criar tags ao Build Service, conforme a operação. Em Classic Releases, habilite **Allow scripts to access the OAuth token** no agent job. Para YAML, mapeie `SYSTEM_ACCESSTOKEN` via `env`.

## GitVerify — conferir commit aprovado

```yaml
- task: GitVerify@1
  inputs:
    refName: 'v1.2.3'
    refType: 'tag'
    # expectedSha vazio = Build.SourceVersion
  env:
    SYSTEM_ACCESSTOKEN: $(System.AccessToken)
```

## GitCompare e GitChangelog

```yaml
- task: GitCompare@1
  inputs:
    baseVersion: 'tag:v1.2.2'
    targetVersion: 'tag:v1.2.3'
    format: 'markdown'
    outputFile: '$(Build.ArtifactStagingDirectory)/compare.md'
  env:
    SYSTEM_ACCESSTOKEN: $(System.AccessToken)
- task: GitChangelog@1
  inputs:
    baseVersion: 'tag:v1.2.2'
    targetVersion: 'tag:v1.2.3'
    outputFile: '$(Build.ArtifactStagingDirectory)/CHANGELOG.md'
  env:
    SYSTEM_ACCESSTOKEN: $(System.AccessToken)
```

## Proteções

- Apenas Azure Repos Git; requisições HTTPS para a organização Azure DevOps do job.
- Nenhuma tag/branch existente é movida automaticamente: se aponta para outro SHA, a task falha.
- `GitMerge` exige PR existente e `confirmMerge=true`; nunca solicita bypass de política ou exclusão automática da branch.
- `dryRun=true` simula operações de escrita.
- Artefatos de uma mesma release que apontem para commits conflitantes do mesmo repositório são recusados.
- Tasks novas possuem identificadores próprios e podem coexistir com a extensão legada de Michael Barry.

**[Documentação detalhada, segurança e exemplos](https://github.com/pitinga/azure-pipelines-tasks-git)**.
