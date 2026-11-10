# Publicação Git Tasks 1.0.0 — Visual Studio Marketplace

Manifesto público preparado em `main` com `pitinga.azure-pipelines-tasks-git` e `version: 1.0.0`. O campo `public: true` **não realiza upload ao Marketplace**.

## Publicação autenticada

1. Abra [Marketplace Publishing Portal](https://marketplace.visualstudio.com/manage) com uma conta autorizada no publisher **pitinga**; confira elegibilidade para publicação pública.
2. Baixe o artefato `git-tasks-vsix` da execução aprovada da branch `main` em [GitHub Actions](https://github.com/pitinga/azure-pipelines-tasks-git/actions). Extraia o arquivo `pitinga.azure-pipelines-tasks-git-1.0.0.vsix`.
3. No portal, selecione o publisher `pitinga`, localize `azure-pipelines-tasks-git` e escolha **Update**. Não crie outra extensão, pois isso perderia a continuidade dos GUIDs.
4. Faça upload do VSIX, conclua as verificações do portal e aguarde o processamento de segurança da Microsoft.
5. Confirme a visibilidade pública da extensão, as oito tasks e a atualização na organização GrupoZaffari.

Alternativa: `tfx extension publish --publisher pitinga --vsix .\pitinga.azure-pipelines-tasks-git-1.0.0.vsix --share-with GrupoZaffari`, com autenticação Microsoft Entra ou um PAT de escopo Marketplace (publish). Consulte a [documentação oficial](https://learn.microsoft.com/en-us/azure/devops/extend/publish/command-line?view=azure-devops). Não compartilhe tokens no chat, repositório ou logs.

## Compatibilidade

- Extension ID: `azure-pipelines-tasks-git`; publisher: `pitinga`.
- Oito GUIDs de tasks inalterados e invocações `GitTag@1` a `GitMerge@1` mantidas.
- `GitChangelog@1`: versão interna 1.0.3; outras sete tasks: versão interna 1.0.1.
- Node24 e agent >= 4.265.1.

Para novas alterações, incremente `vss-extension.json` e, quando mudar código de task, a versão do respectivo `task.json`. A Microsoft recomenda considerar uma extensão privada de desenvolvimento separada para as próximas versões.
