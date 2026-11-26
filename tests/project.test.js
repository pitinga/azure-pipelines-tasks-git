'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
test('Node24 and current Actions in CI',()=>{
 const workflow=fs.readFileSync(path.join(root,'.github/workflows/validate-and-package.yml'),'utf8');
 assert.match(workflow,/checkout@v7/);
 assert.match(workflow,/setup-node@v7/);
 assert.match(workflow,/upload-artifact@v7/);
 assert.match(workflow,/node-version: '24'/);
 assert.ok(!/Node20|@v4|@v5|@v6/.test(workflow));
 assert.equal(require('../package.json').engines.node,'>=24');
});
test('Every task contributes to Marketplace and is Node24 only',()=>{
 const manifest=require('../vss-extension.json');
 const names=manifest.contributions.map(x=>x.properties.name);
 assert.equal(new Set(names).size,8);
 assert.deepEqual(manifest.files.filter(x=>x.path!=='LICENSE').map(x=>x.path),names);
 for(const name of names) {
   const task=require('../tasks/'+name+'/task.json');
   assert.deepEqual(Object.keys(task.execution),['Node24']);
   assert.equal(task.minimumAgentVersion,'4.265.1');
 }
});

test('Git extension preserves existing task GUIDs and API majors',()=>{
 const manifest=require('../vss-extension.json');
 assert.equal(manifest.public,true);
 assert.equal(manifest.version,'1.0.2');
 assert.equal(require('../package.json').version,'1.0.2');
 assert.equal(manifest.publisher,'pitinga');
 assert.equal(manifest.id,'azure-pipelines-tasks-git');
 const ids=['8d52d722-a311-449d-a2b3-7a12dd96a101','8d52d722-a311-449d-a2b3-7a12dd96a102','8d52d722-a311-449d-a2b3-7a12dd96a103','8d52d722-a311-449d-a2b3-7a12dd96a104','8d52d722-a311-449d-a2b3-7a12dd96a105','8d52d722-a311-449d-a2b3-7a12dd96a106','8d52d722-a311-449d-a2b3-7a12dd96a107','8d52d722-a311-449d-a2b3-7a12dd96a108'];
 assert.deepEqual(manifest.contributions.map(c=>require('../tasks/'+c.properties.name+'/task.json').id),ids);
 assert.ok(manifest.contributions.every(c=>require('../tasks/'+c.properties.name+'/task.json').version.Major===1));
 assert.equal(manifest.content.details.path,'overview.md');
 assert.equal(manifest.content.license.path,'LICENSE');
 const listing=fs.readFileSync(path.join(root,'overview.md'),'utf8');
 assert.ok(listing.includes('Classic Release'));
 assert.ok(listing.includes('GitMerge@1'));
 assert.ok(listing.includes('Node.js 24'));
});

test('Marketplace publication stays manual and does not modify GitHub Releases',()=>{
 const wf=fs.readFileSync(path.join(root,'.github/workflows/publish-marketplace.yml'),'utf8');
 assert.match(wf,/workflow_dispatch:/);
 assert.match(wf,/VS_MARKETPLACE_TOKEN/);
 assert.match(wf,/name: Publish to Marketplace/);
 assert.doesNotMatch(wf,/gh release (create|edit|upload)/);
});
test('Public GitHub Release uses approved CI, immutable tags, VSIX and no Marketplace',()=>{
 const wf=fs.readFileSync(path.join(root,'.github/workflows/github-release.yml'),'utf8');
 const script=fs.readFileSync(path.join(root,'.github/scripts/github-release.sh'),'utf8');
 assert.match(wf,/workflow_run:/);
 assert.match(wf,/Validate and package Git Tasks VSIX/);
 assert.match(wf,/contents: write/);
 assert.match(script,/gh run download/);
 assert.match(script,/gh release create/);
 assert.match(script,/gh release view/);
 assert.match(script,/Tag .* never move existing tags|never move existing tags/);
 assert.match(script,/z.read\('LICENSE'\)/);
 assert.doesNotMatch(script,/extension publish|VS_MARKETPLACE_TOKEN/);
});

test('MIT license is included explicitly and protected by VSIX verification',()=>{
 const m=require('../vss-extension.json');
 assert.equal(m.content.license.path,'LICENSE');
 assert.ok(m.files.some(f=>f.path==='LICENSE'&&f.addressable===true));
 assert.equal(require('../package.json').version,m.version);
 assert.match(fs.readFileSync(path.join(root,'LICENSE'),'utf8'),/MIT License/);
 const workflow=fs.readFileSync(path.join(root,'.github/workflows/validate-and-package.yml'),'utf8');
 assert.match(workflow,/z.read\('LICENSE'\)/);
});


test('Marketplace extension name is updated without changing IDs or task majors',()=>{
 const manifest=require('../vss-extension.json');
 assert.equal(manifest.name,'Git - Tasks for Azure Pipelines');
 assert.equal(manifest.publisher,'pitinga');
 assert.equal(manifest.id,'azure-pipelines-tasks-git');
 assert.equal(manifest.version,'1.0.2');
 const workflow=fs.readFileSync(path.join(root,'.github/scripts/github-release.sh'),'utf8');
 assert.ok(workflow.includes('--title "$name $version"'));
 assert.match(workflow,/require\('\.\/vss-extension\.json'\)\.name/);
});
