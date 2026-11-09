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
