#!/usr/bin/env bash
set -euo pipefail
[[ "$APPROVED_RUN_ID" =~ ^[0-9]+$ ]] || { echo "::error::Invalid CI run ID"; exit 1; }
case "$GITHUB_REPOSITORY" in
  pitinga/azure-pipelines-tasks-git) ci_name="Validate and package Git Tasks VSIX"; artifact=git-tasks-vsix;;
  pitinga/azure-pipelines-tasks-flyway) ci_name="Build Flyway extension VSIX"; artifact=flyway;;
  pitinga/azure-pipelines-tasks-trivy) ci_name="Validate and package VSIX"; artifact=trivy-azure-devops-vsix;;
  pitinga/azure-pipelines-tasks-grype) ci_name="Validate and package Grype + Syft VSIX"; artifact=grype-syft-vsix;;
  *) echo "::error::Repository not authorized"; exit 1;;
esac
sha=$(git rev-parse HEAD)
git fetch --no-tags origin main
if [[ "$sha" != "$(git rev-parse origin/main)" ]]; then
  echo "::notice::CI from superseded main commit; release skipped"
  exit 0
fi
gh api "repos/$GITHUB_REPOSITORY/actions/runs/$APPROVED_RUN_ID" > "$RUNNER_TEMP/approved-ci.json"
CI_NAME="$ci_name" CI_SHA="$sha" python3 - <<'PY'
import json,os
r=json.load(open(os.environ['RUNNER_TEMP']+'/approved-ci.json'))
assert r['status']=='completed' and r['conclusion']=='success','CI not successful'
assert r['name']==os.environ['CI_NAME'],'Wrong CI workflow'
assert r['head_sha']==os.environ['CI_SHA'],'CI SHA mismatch'
assert r['head_branch']=='main' and r['head_repository']['full_name']==os.environ['GITHUB_REPOSITORY']
assert r['event'] in ('push','workflow_dispatch'),'PR jobs cannot publish'
print('Approved run',r['id'],r['head_sha'])
PY
version=$(node -p "require('./vss-extension.json').version")
pkgversion=$(node -p "require('./package.json').version")
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && "$version" == "$pkgversion" ]] || { echo "::error::Version mismatch"; exit 1; }
[[ "$artifact" != flyway ]] || artifact="flyway-tasks-v$version-vsix"
tag="v$version"
if gh release view "$tag" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
  draft=$(gh release view "$tag" --repo "$GITHUB_REPOSITORY" --json isDraft --jq .isDraft)
  prerelease=$(gh release view "$tag" --repo "$GITHUB_REPOSITORY" --json isPrerelease --jq .isPrerelease)
  n=$(gh release view "$tag" --repo "$GITHUB_REPOSITORY" --json assets --jq '.assets | length')
  [[ "$draft" == false && "$prerelease" == false && "$n" -ge 1 ]] || { echo "::error::Existing release draft/pre-release or empty"; exit 1; }
  gh api "repos/$GITHUB_REPOSITORY/git/ref/tags/$tag" >/dev/null
  echo "::notice::Public release $tag already exists. No changes to tag or assets."
  exit 0
fi
if old=$(gh api "repos/$GITHUB_REPOSITORY/git/ref/tags/$tag" --jq .object.sha 2>/dev/null); then
  [[ "$old" == "$sha" ]] || { echo "::error::Tag $tag points to $old; never move existing tags"; exit 1; }
fi
mkdir -p release-assets
gh run download "$APPROVED_RUN_ID" --repo "$GITHUB_REPOSITORY" --name "$artifact" --dir release-assets
[[ $(find release-assets -type f -name '*.vsix' | wc -l) -eq 1 ]] || { echo "::error::Expected exactly one VSIX from approved CI"; exit 1; }
python3 - <<'PY'
import json,pathlib,zipfile,xml.etree.ElementTree as ET
m=json.load(open('vss-extension.json'))
packages=list(pathlib.Path('release-assets').rglob('*.vsix'))
assert len(packages)==1
p=packages[0]
assert p.name==f"{m['publisher']}.{m['id']}-{m['version']}.vsix"
with zipfile.ZipFile(p) as z:
  assert z.read('LICENSE')==pathlib.Path('LICENSE').read_bytes(),'MIT license mismatch'
  xml=z.read('extension.vsixmanifest').decode('utf8')
  root=ET.fromstring(xml)
  identity=next(x for x in root.iter() if x.tag.endswith('Identity'))
  title=next(x for x in root.iter() if x.tag.endswith('DisplayName'))
  assert identity.attrib['Id']==m['id'] and identity.attrib['Publisher']==m['publisher']
  assert identity.attrib['Version']==m['version'] and (title.text or '').strip()==m['name']
  assert 'Microsoft.VisualStudio.Services.Content.License' in xml
  for c in m['contributions']:
    if c['type']!='ms.vss-distributed-task.task':continue
    task=json.loads(z.read(c['properties']['name']+'/task.json'))
    assert list(task['execution'])==['Node24'] and task['minimumAgentVersion']=='4.265.1'
print('VSIX verified',p)
PY
if ! gh api "repos/$GITHUB_REPOSITORY/git/ref/tags/$tag" >/dev/null 2>&1; then
  gh api -X POST "repos/$GITHUB_REPOSITORY/git/refs" -f "ref=refs/tags/$tag" -f "sha=$sha" >/dev/null
fi
asset=$(find release-assets -type f -name '*.vsix' -print -quit)
name=$(node -p "require('./vss-extension.json').name")
printf 'Public GitHub VSIX release: %s %s\n\nCI run: %s\nSource commit: %s\nSHA-256: %s\n\nMarketplace publication is independent and was not performed.\n' \
  "$name" "$version" "$APPROVED_RUN_ID" "$sha" "$(sha256sum "$asset" | cut -d' ' -f1)" > "$RUNNER_TEMP/notes.md"
gh release create "$tag" "$asset" --repo "$GITHUB_REPOSITORY" --target "$sha" --title "$name $version" --notes-file "$RUNNER_TEMP/notes.md" --latest
draft=$(gh release view "$tag" --repo "$GITHUB_REPOSITORY" --json isDraft --jq .isDraft)
prerelease=$(gh release view "$tag" --repo "$GITHUB_REPOSITORY" --json isPrerelease --jq .isPrerelease)
n=$(gh release view "$tag" --repo "$GITHUB_REPOSITORY" --json assets --jq '.assets | length')
[[ "$draft" == false && "$prerelease" == false && "$n" -eq 1 ]]
echo "GitHub Release $tag published; Marketplace untouched."
