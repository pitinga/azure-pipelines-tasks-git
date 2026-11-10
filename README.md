# Git Tasks for Azure Pipelines

Extensão pública Azure DevOps com 8 tasks Azure Repos Git, **Node.js 24 exclusivamente**. Implementação independente, com IDs próprios e licença MIT.

**Versão pública 1.0.0** — os nomes, GUIDs e versões major das oito tasks continuam compatíveis com os pipelines já homologados.

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

## Requisitos

- Azure DevOps Services e repositórios **Azure Repos Git** (não GitHub/TFVC).
- Agent **>= 4.265.1** com executor **Node24**. Build local Node.js **>= 24**.
- `System.AccessToken` com permissões Git do Build Service para cada operação.
- Em Classic Release, habilitar **Allow scripts to access the OAuth token** no Agent Job. A task usa o endereço de coleção oficial para Git/Build e o endpoint de Releases para identificar os artefatos; nenhuma URL precisa ser informada manualmente.
- Em YAML, as tasks tentam obter o token OAuth do job automaticamente. Se o agente não expuser a credencial interna, mapeie `env: SYSTEM_ACCESSTOKEN: $(System.AccessToken)`. Nunca coloque PAT no YAML.

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
    dryRun: false

- task: GitVerify@1
  displayName: 'Git | Verify approved commit'
  inputs:
    refName: 'v1.2.3'
    expectedSha: '$(Build.SourceVersion)'
```

Para simular antes da execução real, altere temporariamente `dryRun: true`. `GitVerify` exige uma tag já existente.

## Exemplo 3 — GitCompare e GitChangelog

```yaml
- task: GitCompare@1
  inputs:
    baseVersion: 'tag:v1.2.2'
    targetVersion: 'tag:v1.2.3'
    format: 'markdown'
    outputFile: '$(Build.ArtifactStagingDirectory)/compare.md'
- task: GitChangelog@1
  inputs:
    baseVersion: 'tag:v1.2.2'
    targetVersion: 'tag:v1.2.3'
    outputFile: '$(Build.ArtifactStagingDirectory)/CHANGELOG.md'
- task: PublishPipelineArtifact@1
  condition: always()
  inputs:
    targetPath: '$(Build.ArtifactStagingDirectory)'
    artifact: 'git-reports'
```

O token interno costuma dispensar `env: SYSTEM_ACCESSTOKEN` nas Git Tasks; quando indisponível, mapeie essa variável explicitamente como descrito nos requisitos.

Versões precisam de sintaxe explícita: `tag:NOME`, `branch:NOME`, `refs/tags/NOME`, `refs/heads/NOME` ou SHA completo.

## Exemplo 4 — Pull Request e Merge

```yaml
- task: GitPullRequest@1
  inputs:
    sourceBranch: 'release/1.2.3'
    targetBranch: 'main'
    title: 'Release 1.2.3'
    draft: true
    dryRun: true

# Em um job de aprovação separado, depois de aprovar o PR:
- task: GitMerge@1
  inputs:
    sourceBranch: 'release/1.2.3'
    targetBranch: 'main'
    mergeStrategy: 'noFastForward'
    confirmMerge: true
    dryRun: true  # Altere para false apenas após aprovar o PR
```

**GitMerge requer exatamente um PR ativo** para origem e destino. No exemplo acima, `dryRun: true` simula o merge. Para concluir um PR autorizado, defina `confirmMerge: true` e `dryRun: false`. Não realiza merge Git local, não ignora políticas e não exclui a branch de origem. Uma requisição de conclusão pode ser processada de forma assíncrona; verifique o status final do PR no Azure DevOps.

## Autenticação, segurança e limitações

- Nenhuma credencial é impressa. As APIs usam somente Bearer do token do job, não um PAT fixo.
- Permissões: Read/Contribute, Create tag, Create branch, Contribute to pull requests, conforme a operação. Permissões do Build Service variam por projeto.
- `repositoryId` e `commitSha` são **opcionais, mas devem ser preenchidos juntos** para seleção manual. Isso evita repos/SHAs implícitos incorretos.
- Em Classic Release, `GitCompare`, `GitVerify`, `GitChangelog` e operações de PR/merge exigem uma seleção sem ambiguidades. Use `artifactAliases` para selecionar um artefato de build por vez.
- **Apenas artefatos de tipo Build com repository.type=TfsGit** são descobertos automaticamente na Release. Artefatos externos ou de outros projetos precisam de uma task/configuração apropriada.
- GitTag cria **lightweight tags**, não annotated/signed tags.
- O changelog usa o indicador `aheadCount` de `diffs/commits` e consulta o histórico do destino separadamente por `GET /commits`, evitando a comparação com filtro que retornava lista vazia no Azure Repos. Limita a `maxCommits`; agrupa `feat:` e `fix:` e coloca os demais em Other. Uma lista incompleta gera erro; a paginação completa ainda não é suportada.
- O compare limita resultados a `maxChanges` e inclui indicadores de truncamento.
- As tasks não executam checkout, merge local nem force-push; GitMerge usa a API de Pull Requests para respeitar branch policies. Um pipeline pode fazer checkout normalmente em etapas separadas.
- A versão pública da extensão é **1.0.0**. As tasks usam **@1** (Major 1); `GitChangelog` está em **1.0.3** e as demais em **1.0.1**. Mantidos os IDs e contratos existentes.
- A homologação abrangeu tag/branch, verificação de SHA, GitCompare, GitChangelog com múltiplos commits, commit status, PR idempotente, merge real entre branches de teste e identificação automática de Build em Classic Release.
- Para cada atualização do Marketplace, incremente a versão da extensão; para qualquer alteração de código da task, incremente também sua versão no `task.json`.

## Desenvolvimento e testes

```powershell
npm test
npm run build
npx --yes tfx-cli@0.24.2 extension create --manifest-globs vss-extension.json --output-path dist
```

`npm test` usa Node Test Runner, sem dependências runtime. Build copia o código para 8 packages isolados e gera ícones PNG de 128px. O GitHub Actions verifica as oito tasks, os recursos do Marketplace e produz o VSIX como artifact.

### Publicação no Marketplace

O manifesto está preparado com `public: true`, mas essa alteração não torna a extensão automaticamente pública: é necessário fazer o upload autenticado do VSIX no Marketplace. Consulte [o guia de publicação](docs/PUBLICACAO.md).

### Links

- [API de atualização de refs](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/refs/update-refs?view=azure-devops-rest-7.1)
- [API de Pull Requests](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-requests/create?view=azure-devops-rest-7.1)
- [Classic Release artifacts](https://learn.microsoft.com/en-us/azure/devops/pipelines/release/variables?view=azure-devops)
- [Reportar problemas](https://github.com/pitinga/azure-pipelines-tasks-git/issues)

MIT License; copyright do autor do repositório. Projeto independente da extensão histórica.

## GitHub Tags e Releases

A criação de versões é rastreável: [release.yml](.github/workflows/release.yml) obtém o VSIX de um **GitHub Actions aprovado**, valida o commit e cria a tag `vX.Y.Z` e uma **GitHub Release draft** sem declarar publicação antecipada. A [publicação no Marketplace](.github/workflows/publish-marketplace.yml) exige confirmação `PUBLICAR` e um secret `VS_MARKETPLACE_TOKEN` no environment `marketplace-production`. **Somente se o Marketplace aceitar o VSIX**, a release é publicada no GitHub, anexando o mesmo pacote. Se a publicação for manual pelo portal, o workflow `release.yml` permite finalizar a draft com a opção `publish` após informar `PUBLICADO`.
