# Git Tasks for Azure Pipelines

**Eight Node.js 24 tasks for Azure Repos Git**, available for Azure Pipelines YAML builds and Classic Releases.
Create and verify remote Git references, compare versions, generate release notes and manage pull requests. The tasks use Azure DevOps REST APIs; a local Git checkout is not required.

## Included tasks

| Task | Operation |
| --- | --- |
| **GitTag@1** | Creates lightweight tags on the source commits of builds or Classic Release artifacts |
| **GitBranch@1** | Creates remote Git branches |
| **GitCompare@1** | Compares two Git versions and writes Markdown or JSON |
| **GitChangelog@1** | Generates Markdown release notes, grouping Features, Fixes and Other commits |
| **GitVerify@1** | Confirms that a tag or branch points to the expected SHA |
| **GitCommitStatus@1** | Publishes validation or deployment status on a commit |
| **GitPullRequest@1** | Creates a pull request without duplicating an existing active one |
| **GitMerge@1** | Requests a merge of an existing PR with explicit confirmation; branch policies are not bypassed |

## YAML build: create and verify a tag

~~~yaml
steps:
- task: GitTag@1
  inputs:
    tagName: 'release/v1.2.3'
    dryRun: false

- task: GitVerify@1
  inputs:
    refName: 'release/v1.2.3'
    refType: 'tag'
    expectedSha: '$(Build.SourceVersion)'
~~~

Use `dryRun: true` to simulate an operation before committing changes. `false` is the default.

## Classic Release: discover the artifact automatically

1. Attach an **Azure Repos Git Build artifact** to your Classic Release.
2. Add **GitTag@1** to the stage's Agent Job and enable **Allow scripts to access the OAuth token**.
3. Set `tagName` (for example, `release/$(Release.ReleaseId)`). Leave `repositoryId` and `commitSha` empty.
4. Use `dryRun: true` for validation, then `dryRun: false` to create the tag.
5. Add **GitVerify@1** with the same tag and leave `expectedSha` empty to confirm the artifact commit.

The source repository and commit are discovered from the build metadata, not from files downloaded on the agent. Use `artifactAliases` when a release contains multiple Build artifacts.

## Compare and document versions

~~~yaml
- task: GitCompare@1
  inputs:
    baseVersion: 'tag:v1.2.2'
    targetVersion: 'tag:v1.2.3'
    format: markdown
    outputFile: '$(Build.ArtifactStagingDirectory)/GitCompare.md'

- task: GitChangelog@1
  inputs:
    baseVersion: 'tag:v1.2.2'
    targetVersion: 'tag:v1.2.3'
    outputFile: '$(Build.ArtifactStagingDirectory)/CHANGELOG.md'
~~~

References accept full SHA hashes, `tag:NAME`, `branch:NAME`, `refs/tags/NAME`, or `refs/heads/NAME`. Messages starting with `feat:` and `fix:` are grouped separately; other commit messages appear under **Other**.

## Security and requirements

- **Azure DevOps Services / Azure Repos Git** only; not GitHub repositories or Azure DevOps Server.
- **Node.js 24** task handler; **Azure Pipelines agent 4.265.1+**.
- Uses the job OAuth identity. The tasks try the internal job token automatically. Where unavailable, map `SYSTEM_ACCESSTOKEN` from `$(System.AccessToken)` to the task. No embedded PAT.
- Grant the appropriate Azure Repos permissions to the Build Service identity (such as Create tag, Create branch and Contribute to pull requests).
- Existing tags/branches pointing to another SHA are never force-updated.
- GitMerge requires an existing active pull request, `confirmMerge: true`, and does not request bypass of branch policies or deletion of the source branch.
- GitMerge may report `requested` while completion runs asynchronously. Confirm PR status `completed` before declaring a deployment successful.
- GitChangelog is bounded by `maxCommits` and does not implement complete pagination; verify complex histories with merges or divergent branches.
- Classic Release discovery is limited to Azure Repos Git Build artifacts in the release project. Lightweight tags only.

## Documentation and support

- [Documentation, examples and limitations](https://github.com/pitinga/azure-pipelines-tasks-git)
- [Release history](https://github.com/pitinga/azure-pipelines-tasks-git/blob/main/CHANGELOG.md)
- [Report an issue](https://github.com/pitinga/azure-pipelines-tasks-git/issues)

**MIT License.** Independently developed; distinct IDs from historical Tag Artifacts extensions.
