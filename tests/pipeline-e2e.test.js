'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const yml=fs.readFileSync(path.resolve(__dirname,'../azure-pipelines-test-all.yml'),'utf8');
test('E2E Azure Pipelines includes all eight Git Tasks',()=>{
 for(const name of ['GitTag','GitBranch','GitCompare','GitChangelog','GitVerify','GitCommitStatus','GitPullRequest','GitMerge'])
   assert.match(yml,new RegExp('task: '+name+'@1\\b'),name);
});
test('E2E is manual, uses no checkout, and requires explicit write consent',()=>{
 assert.match(yml,/trigger: none/);
 assert.match(yml,/pr: none/);
 assert.match(yml,/checkout: none/);
 assert.match(yml,/name: allowTestWrites/);
 assert.match(yml,/allowTestWrites.*\}\}/);
 assert.match(yml,/SYSTEM_ACCESSTOKEN: \$\(System.AccessToken\)/);
});
test('GitMerge is only used in safe mode',()=>{
 const start=yml.indexOf('  - task: GitMerge@1');
 const end=yml.indexOf('  - task: PublishPipelineArtifact@1');
 assert.ok(start>0&&end>start);
 const merge=yml.slice(start,end);
 assert.match(merge,/dryRun: 'true'/);
 assert.match(merge,/confirmMerge: 'false'/);
 assert.doesNotMatch(merge,/dryRun: 'false'/);
});
test('E2E uses explicit repo/SHAs and publishes reports',()=>{
 assert.match(yml,/name: testRepositoryId/);
 assert.match(yml,/name: baseCommitSha/);
 assert.match(yml,/name: sourceCommitSha/);
 assert.match(yml,/git-tasks-e2e\/\$\(Build.BuildId\)/);
 assert.match(yml,/GitCompare\.md/);
 assert.match(yml,/CHANGELOG\.md/);
 assert.match(yml,/PublishPipelineArtifact@1/);
});
