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
 assert.deepEqual(manifest.files.map(x=>x.path),names);
 for(const name of names) {
   const task=require('../tasks/'+name+'/task.json');
   assert.deepEqual(Object.keys(task.execution),['Node24']);
   assert.equal(task.minimumAgentVersion,'4.265.1');
 }
});

test('Public 1.0.0 release preserves existing task GUIDs and API majors',()=>{
 const manifest=require('../vss-extension.json');
 assert.equal(manifest.public,true);
 assert.equal(manifest.version,'1.0.0');
 assert.equal(require('../package.json').version,'1.0.0');
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
