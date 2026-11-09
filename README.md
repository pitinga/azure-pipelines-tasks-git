# Git Tasks for Azure Pipelines

Extensão Azure DevOps com 8 tasks Azure Repos Git, **Node.js 24 exclusivamente**. Não é um fork da extensão `jabbera`; é uma implementação nova com IDs próprios.

| Task | Propósito | Inputs principais |
| --- | --- | --- |
| `GitTag@1` | Criação de tags leves e idempotentes | `tagName`, `searchRegex`, `artifactAliases`, `dryRun` |
| `GitBranch@1` | Criação de branches nos commits da release | `branchName`, `artifactAliases`, `dryRun` |
| `GitCompare@1` | Diff de arquivos/ref entre versões | `baseVersion`, `targetVersion`, `format`, `outputFile` |
| `GitChangelog@1` | Changelog por Conventional Commits | `baseVersion`, `targetVersion`, `outputFile` |
| `GitVerify@1` | Validação SHA de tag ou branch | `refName`, `refType`, `expectedSha` |
| `GitCommitStatus@1` | Status no commit Azure Repos | `statusName`, `state`, `statusGenre`, `targetUrl` |
| `GitPullRequest@1` | PR automático sem duplicar existente | `sourceBranch`, `targetBranch`, `title`, `draft`, `reviewers` |
| `GitMerge@1` | Conclusão explícita de PR ativo | `sourceBranch`, `targetBranch`, `mergeStrategy`, `confirmMerge` |

## Teste completo no Azure DevOps

Arquivo [azure-pipelines-test-all.yml](azure-pipelines-test-all.yml): pipeline manual para **testar as oito tasks** no próprio repositório Azure Repos de exemplo, na branch `develop`. Cria tags/branches, um status e um PR draft de teste; `GitMerge` executa somente `dryRun` e não realiza merge.

O repositório e os SHAs são detectados automaticamente; somente `allowTestWrites` precisa ser confirmado. **Copie o YAML para a branch `develop` do repositório Azure Repos de exemplo e cadastre a pipeline apontando para ele.**

**Segurança:** `allowTestWrites` inicia como `false`, impedindo modificações sem autorização explícita. Consulte [as instruções de integração](docs/TESTE-INTEGRACAO.md) para configurar repositório de teste, commits e permissões.
## Requisitos

- Azure DevOps Services e repositórios **Azure Repos Git** (não GitHub/TFVC).
- Agent **>= 4.265.1** com executor **Node24**. Build local Node.js **>= 24**.
- `System.AccessToken` com permissões Git do Build Service para cada operação.
- Em Classic Release, habilitar **Allow scripts to access the OAuth token** no agent job.
- Em YAML, injetar token por `env: SYSTEM_ACCESSTOKEN: $(System.AccessToken)`; nunca colocar PAT no YAML.

## Exemplo 1 — Classic Release: substituir Tag Artifacts

Coloque `GitTag@1` no ambiente da release. Sem `repositoryId`, a task usa a API de Releases para consultar artefatos `Build`, encontra os repositórios TfsGit e os commits publicados. Aplica `tagName` ou usa `Release.ReleaseName` (espaços viram hífens).

- `artifactAliases`: lista de aliases; deixe vazio para todos os artefatos Build de Azure Repos Git.
- `searchRegex`, `regexFlags`, `replacePattern`: transformação regex sobre o nome da release.
- `dryRun: true`: consultar e validar sem criar tags.
- `GitBranch@1` também descobre artefatos; nome padrão: `release/Release-Name`.
- **Múltiplas versões do mesmo repositório na mesma release:** a task falha por segurança. Informe um alias específico.

## Exemplo 2 — YAML: tag e verificação

```yaml
steps:
- task: GitTag@1
  displayName: 'Git | Create release tag'
  inputs:
    tagName: 'v1.2.3'
    dryRun: 'true'
  env:
    SYSTEM_ACCESSTOKEN: $(System.AccessToken)

- task: GitVerify@1
  displayName: 'Git | Verify approved commit'
  inputs:
    refName: 'v1.2.3'
    expectedSha: '$(Build.SourceVersion)'
  env:
    SYSTEM_ACCESSTOKEN: $(System.AccessToken)
```

A primeira execução deve usar `dryRun=true`. Desative a simulação antes de usar `GitVerify`, que verifica uma tag já criada.

## Exemplo 3 — GitCompare e GitChangelog

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
- task: PublishPipelineArtifact@1
  condition: always()
  inputs:
    targetPath: '$(Build.ArtifactStagingDirectory)'
    artifact: 'git-reports'
```

Versões precisam de sintaxe explícita: `tag:NOME`, `branch:NOME`, `refs/tags/NOME`, `refs/heads/NOME` ou SHA completo.

## Exemplo 4 — Pull Request e Merge

```yaml
- task: GitPullRequest@1
  inputs:
    sourceBranch: 'release/1.2.3'
    targetBranch: 'main'
    title: 'Release 1.2.3'
    draft: 'true'
    dryRun: 'true'
  env:
    SYSTEM_ACCESSTOKEN: $(System.AccessToken)

# Em um job de aprovação separado, depois de aprovar o PR:
- task: GitMerge@1
  inputs:
    sourceBranch: 'release/1.2.3'
    targetBranch: 'main'
    mergeStrategy: 'noFastForward'
    confirmMerge: 'true'
    dryRun: 'true'
  env:
    SYSTEM_ACCESSTOKEN: $(System.AccessToken)
```

**GitMerge requer exatamente um PR ativo** para origem e destino. Não realiza merge Git local, não ignora políticas e não exclui a branch de origem. Uma requisição de conclusão pode ser processada de forma assíncrona; verifique o status final do PR no Azure DevOps.

## Autenticação, segurança e limitações

- Nenhuma credencial é impressa. As APIs usam somente Bearer do token do job, não um PAT fixo.
- Permissões: Read/Contribute, Create tag, Create branch, Contribute to pull requests, conforme a operação. Permissões do Build Service variam por projeto.
- `repositoryId` e `commitSha` são **opcionais, mas devem ser preenchidos juntos** para seleção manual. Isso evita repos/SHAs implícitos incorretos.
- Em Classic Release, `GitCompare`, `GitVerify`, `GitChangelog` e operações de PR/merge exigem uma seleção sem ambiguidades. Use `artifactAliases` para selecionar um artefato de build por vez.
- **Apenas artefatos de tipo Build com repository.type=TfsGit** são descobertos automaticamente na Release. Artefatos externos ou de outros projetos precisam de uma task/configuração apropriada.
- GitTag cria **lightweight tags**, não annotated/signed tags.
- O changelog limita a consulta a `maxCommits` e agrupa mensagens começando com `feat:` e `fix:`. Outros commits vão em Other. Não faz paginação completa nesta primeira versão.
- O compare limita resultados a `maxChanges` e inclui indicadores de truncamento.
- O projeto não executa checkout, merge local nem force-push; GitMerge usa a API de Pull Requests para respeitar branch policies.
- A versão de extensão é **0.1.0**; as tasks usam **@1** (Major=1). Não publique no Marketplace antes de homologar em DEV/QAS.

## Desenvolvimento e testes

```powershell
npm test
npm run build
npx --yes tfx-cli@0.24.2 extension create --manifest-globs vss-extension.json --output-path dist
```

`npm test` usa Node Test Runner, sem dependências runtime. Build copia o código para 8 packages isolados e gera ícones PNG de 128px. O GitHub Actions verifica as oito tasks, os recursos do Marketplace e produz o VSIX como artifact.

### Links

- [API de atualização de refs](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/refs/update-refs?view=azure-devops-rest-7.1)
- [API de Pull Requests](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-requests/create?view=azure-devops-rest-7.1)
- [Classic Release artifacts](https://learn.microsoft.com/en-us/azure/devops/pipelines/release/variables?view=azure-devops)
- [Reportar problemas](https://github.com/pitinga/azure-pipelines-tasks-git/issues)

MIT License; copyright do autor do repositório. Projeto independente da extensão histórica.
