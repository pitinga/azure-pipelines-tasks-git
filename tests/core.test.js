'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {refName,versionInput,tagFromRelease,sha}=require('../src/runtime');
const {collectionDetails,AzureClient,ZERO}=require('../src/azure');
const {inputEnvironment,releaseArtifacts,targets,one}=require('../src/releases');
const actions=require('../src/actions');
const ROOT=path.resolve(__dirname,'..');
const SHA1='a'.repeat(40),SHA2='b'.repeat(40);
function fake(fn) {
 const calls=[];
 const api=new AzureClient({base:'https://dev.azure.com/org',releaseBase:'https://vsrm.dev.azure.com/org',
   project:'dev',token:'TEST_TOKEN',fetch:async(url,init)=>{
      const record={url:new URL(url),method:init.method,body:init.body?JSON.parse(init.body):null};
      calls.push(record);
      const result=await fn(record);
      const status=typeof result?.status==='number' ? result.status : 200;
      return {ok:status>=200&&status<300,status,text:async()=>JSON.stringify(result?.body??result??{})};
   }});
 return {api,calls};
}
function inputs(data) {
 const old={};
 for(const [key,value] of Object.entries(data)) {
   const env='INPUT_'+key.toUpperCase();old[env]=process.env[env];process.env[env]=String(value);
 }
 return ()=>{for(const [key,value] of Object.entries(old)){if(value===undefined)delete process.env[key];else process.env[key]=value;}};
}
test('task manifests contain 8 unique Node24-only handlers',()=>{
 const names=['GitTag','GitBranch','GitCompare','GitChangelog','GitVerify','GitCommitStatus','GitPullRequest','GitMerge'];
 const ids=new Set();
 for(const name of names) {
   const task=JSON.parse(fs.readFileSync(path.join(ROOT,'tasks',name,'task.json'),'utf8'));
   assert.equal(task.name,name);
   assert.deepEqual(Object.keys(task.execution),['Node24']);
   assert.equal(task.execution.Node24.target,'index.js');
   assert.equal(task.minimumAgentVersion,'4.265.1');
   assert.equal(task.version.Major,1);
   assert.ok(!ids.has(task.id));ids.add(task.id);
   assert.ok(task.inputs.every(i=>i.type),'undefined input type '+name);
 }
 const manifest=JSON.parse(fs.readFileSync(path.join(ROOT,'vss-extension.json')));
 assert.equal(manifest.publisher,'pitinga');
 assert.equal(manifest.public,true);
 assert.equal(manifest.version,'1.0.0');
 assert.equal(manifest.contributions.length,8);
});
test('validates Git refs including injection and whitespace',()=>{
 assert.equal(refName('v1.2.3','tag'),'refs/tags/v1.2.3');
 assert.equal(refName('release/1.0','branch'),'refs/heads/release/1.0');
 for(const val of ['','abc def','bad..name','a.lock','~bad','a@{x','a//b'])assert.throws(()=>refName(val,'tag'));
});
test('version syntax is explicit and safe',()=>{
 assert.deepEqual(versionInput('tag:v1'),{version:'v1',versionType:'tag'});
 assert.deepEqual(versionInput('refs/heads/main'),{version:'main',versionType:'branch'});
 assert.deepEqual(versionInput(SHA1),{version:SHA1,versionType:'commit'});
 assert.throws(()=>versionInput('main'));
});
test('release name transformation regex matches expected semantics',()=>{
 assert.equal(tagFromRelease('Release 10','','',''),'Release-10');
 assert.equal(tagFromRelease('Release-v3.1-4','Release-(v[0-9.]+)-[0-9]+','g','$1'),'v3.1');
 assert.throws(()=>tagFromRelease('Release 10','v[0-9]+','g','$1'));
});
test('Azure collection URI and token enforcement',()=>{
 const data=collectionDetails({SYSTEM_COLLECTIONURI:'https://dev.azure.com/acme/',
 SYSTEM_TEAMPROJECT:'sample',SYSTEM_ACCESSTOKEN:'TOKEN'});
 assert.equal(data.base,'https://dev.azure.com/acme');
 assert.equal(data.releaseBase,'https://vsrm.dev.azure.com/acme');
 assert.throws(()=>collectionDetails({SYSTEM_COLLECTIONURI:'http://dev.azure.com/acme/',SYSTEM_TEAMPROJECT:'dev',SYSTEM_ACCESSTOKEN:'x'}));
 assert.throws(()=>collectionDetails({SYSTEM_COLLECTIONURI:'https://example.com/',SYSTEM_TEAMPROJECT:'dev',SYSTEM_ACCESSTOKEN:'x'}));
 assert.throws(()=>collectionDetails({SYSTEM_COLLECTIONURI:'https://dev.azure.com/acme/',SYSTEM_TEAMPROJECT:'dev'}));
});
test('Azure refs create uses concurrency-safe ZERO oldObjectId and deduplicates',async()=>{
 const {api,calls}=fake(({url,method})=>{
   if(method==='GET'&&url.pathname.endsWith('/commits/'+SHA1))return {commitId:SHA1};
   if(method==='GET'&&url.pathname.endsWith('/refs'))return {value:[]};
   if(method==='POST'&&url.pathname.endsWith('/refs'))return {value:[{success:true,updateStatus:'succeeded'}]};
   throw new Error('Unexpected request: '+method+' '+url);
 });
 assert.equal((await api.createRef('repo','refs/tags/v1',SHA1,false)).status,'created');
 const post=calls.find(x=>x.method==='POST');
 assert.deepEqual(post.body,[{name:'refs/tags/v1',oldObjectId:ZERO,newObjectId:SHA1}]);
});
test('existing tag same SHA is idempotent; different SHA fails without write',async()=>{
 const {api,calls}=fake(({url,method})=>{
   if(method==='GET'&&url.pathname.endsWith('/commits/'+SHA1))return {commitId:SHA1};
   if(method==='GET'&&url.pathname.endsWith('/refs'))return {value:[{name:'refs/tags/v1',objectId:SHA1}]};
   throw new Error('Unexpected request');
 });
 assert.equal((await api.createRef('repo','refs/tags/v1',SHA1,false)).status,'unchanged');
 assert.equal(calls.some(c=>c.method==='POST'),false);
 const {api:other}=fake(({url})=>url.pathname.endsWith('/refs')?{value:[{name:'refs/tags/v1',objectId:SHA2}]}:{commitId:SHA1});
 await assert.rejects(()=>other.createRef('repo','refs/tags/v1',SHA1,false),/outro commit/);
});
test('dryRun performs reads but does not write',async()=>{
 const {api,calls}=fake(({url})=>url.pathname.endsWith('/refs')?{value:[]}:{commitId:SHA1});
 assert.equal((await api.createRef('repo','refs/heads/release/v1',SHA1,true)).status,'dry-run');
 assert.equal(calls.some(c=>c.method==='POST'),false);
});
test('Azure API errors are surfaced without leaking token',async()=>{
 const {api}=fake(()=>({status:403,body:{message:'access denied'}}));
 await assert.rejects(()=>api.ref('repo','refs/tags/v1'),/403.*access denied/);
});
test('Classic Release maps Build artifacts to Git repository and commit',async()=>{
 const {api,calls}=fake(({url})=>{
   if(url.pathname.includes('/release/releases/42'))return {artifacts:[
     {alias:'api',type:'Build',definitionReference:{version:{id:'77'}}},
     {alias:'other',type:'Jenkins'}
   ]};
   if(url.pathname.includes('/build/builds/77'))return {repository:{id:'git-repo',type:'TfsGit'},sourceVersion:SHA1};
   throw new Error('Unexpected request: '+url);
 });
 const result=await releaseArtifacts(api,'',{RELEASE_RELEASEID:'42'});
 assert.deepEqual(result,[{repo:'git-repo',commit:SHA1,alias:'api',buildId:'77'}]);
 assert.equal(calls[0].url.hostname,'vsrm.dev.azure.com');
});
test('Classic Release refuses different SHAs for one repository',async()=>{
 const {api}=fake(({url})=>{
   if(url.pathname.includes('release/releases/42'))return {artifacts:[1,2].map(i=>({alias:'api'+i,type:'Build',definitionReference:{version:{id:String(i)}}}))};
   if(url.pathname.includes('build/builds/1'))return {repository:{id:'repo',type:'TfsGit'},sourceVersion:SHA1};
   if(url.pathname.includes('build/builds/2'))return {repository:{id:'repo',type:'TfsGit'},sourceVersion:SHA2};
   throw new Error('Unexpected request');
 });
 await assert.rejects(()=>releaseArtifacts(api,'',{RELEASE_RELEASEID:'42'}),/commits diferentes/);
});
test('build context derives correct repository and commit',()=>{
 assert.deepEqual(inputEnvironment({BUILD_REPOSITORY_ID:'repo',BUILD_SOURCEVERSION:SHA1,BUILD_REPOSITORY_PROVIDER:'TfsGit'}),
  [{repo:'repo',commit:SHA1,alias:'build'}]);
 assert.throws(()=>inputEnvironment({BUILD_REPOSITORY_ID:'repo',BUILD_SOURCEVERSION:SHA1,BUILD_REPOSITORY_PROVIDER:'GitHub'}));
});
test('manual context requires repository and commit together',async()=>{
 const {api}=fake(()=>{throw new Error('Should not request')});
 assert.deepEqual(await targets(api,{repositoryId:'manual',commitSha:SHA1}),[{repo:'manual',commit:SHA1,alias:'manual'}]);
 await assert.rejects(()=>targets(api,{repositoryId:'repo'}),/juntos/);
});
test('GitCompare uses Azure Repos diff API',async()=>{
 const {api,calls}=fake(()=>({changes:[{changeType:'add',item:{path:'/README.md'}}],aheadCount:2,behindCount:0,changeCounts:{Add:1}}));
 const restore=inputs({repositoryId:'repo',commitSha:SHA1,baseVersion:'tag:v1',targetVersion:'tag:v2',outputFile:'',maxChanges:'25',format:'json'});
 try {
  const result=await actions.compare(api);
  assert.equal(result.changes[0].path,'/README.md');
  assert.equal(calls[0].url.searchParams.get('baseVersionType'),'tag');
  assert.equal(calls[0].url.searchParams.get('targetVersionType'),'tag');
 } finally {restore()}
});
test('GitVerify refuses mismatched tag commits',async()=>{
 const {api}=fake(()=>({value:[{name:'refs/tags/v1',objectId:SHA2}]}));
 const restore=inputs({repositoryId:'repo',commitSha:SHA1,refName:'v1',refType:'tag'});
 try {await assert.rejects(()=>actions.verify(api),/esperado/);} finally{restore()}
});
test('GitCommitStatus supports dry-run without writes',async()=>{
 const {api,calls}=fake(()=>{throw new Error('Should not request')});
 const restore=inputs({repositoryId:'repo',commitSha:SHA1,statusName:'deploy-qa',state:'succeeded',dryRun:'true'});
 try {const result=await actions.status(api);assert.equal(result.status,'dry-run');assert.equal(calls.length,0);}finally{restore()}
});
test('Pull Request idempotency avoids a second PR',async()=>{
 const {api,calls}=fake(({url,method})=>{
  if(method==='GET' && url.pathname.endsWith('/refs'))return {value:[{name:'refs/heads/feature/a',objectId:SHA1},{name:'refs/heads/main',objectId:SHA2}]};
  if(method==='GET' && url.pathname.endsWith('/pullrequests'))return {value:[{pullRequestId:123,status:'active',sourceRefName:'refs/heads/feature/a',targetRefName:'refs/heads/main'}]};
  throw new Error('Unexpected request');
 });
 const restore=inputs({repositoryId:'repo',commitSha:SHA1,sourceBranch:'feature/a',targetBranch:'main',title:'Test PR'});
 try {const result=await actions.pr(api);assert.equal(result.status,'existing');assert.equal(calls.some(x=>x.method==='POST'),false);}finally{restore()}
});
test('GitMerge will not update PR unless confirmMerge=true',async()=>{
 const {api,calls}=fake(({url})=>url.pathname.endsWith('/pullrequests')?{value:[{
  pullRequestId:12,status:'active',sourceRefName:'refs/heads/feature/a',targetRefName:'refs/heads/main',lastMergeSourceCommit:{commitId:SHA1}}]}:{});
 const restore=inputs({repositoryId:'repo',commitSha:SHA1,sourceBranch:'feature/a',targetBranch:'main',confirmMerge:'false',dryRun:'false'});
 try {await assert.rejects(()=>actions.merge(api),/confirmMerge=true/);assert.equal(calls.some(x=>x.method==='PATCH'),false);}finally{restore()}
});
test('GitMerge explicitly enforces policy without bypass flag',async()=>{
 const {api,calls}=fake(({url,method})=>{
  if(method==='GET')return {value:[{pullRequestId:12,status:'active',
   sourceRefName:'refs/heads/feature/a',targetRefName:'refs/heads/main',lastMergeSourceCommit:{commitId:SHA1}}]};
  if(method==='PATCH')return {status:'completed'};
  throw new Error('Unexpected request');
 });
 const restore=inputs({repositoryId:'repo',commitSha:SHA1,sourceBranch:'feature/a',targetBranch:'main',confirmMerge:'true',dryRun:'false'});
 try{
   const result=await actions.merge(api);assert.equal(result.status,'completed');
   const update=calls.find(x=>x.method==='PATCH');
   assert.equal(update.body.completionOptions.bypassPolicy,false);
   assert.equal(update.body.completionOptions.deleteSourceBranch,false);
 }finally{restore()}
});
test('group changelog by Conventional Commits',()=>{
 const grouped=actions.groupCommits([{comment:'feat: new API',commitId:SHA1},{comment:'fix(parser): bug',commitId:SHA2},{comment:'docs: update',commitId:SHA1}]);
 assert.equal(grouped.Features.length,1);assert.equal(grouped.Fixes.length,1);assert.equal(grouped.Other.length,1);
});
test('GitChangelog compares commits independently of REST history filter',async()=>{
 const {api,calls}=fake(({url,method})=>{
   if(method==='GET'&&url.pathname.endsWith('/diffs/commits'))return {aheadCount:1,behindCount:0,commonCommit:SHA1,changes:[]};
   if(method==='GET'&&url.pathname.endsWith('/commits'))return {count:2,value:[{comment:'feat: clean API',commitId:SHA2},{comment:'old base',commitId:SHA1}]};
   throw new Error('Unexpected REST API call');
 });
 const restore=inputs({repositoryId:'repo',commitSha:SHA2,baseVersion:SHA1,targetVersion:SHA2,maxCommits:'50',outputFile:''});
 try {
   const result=await actions.changelog(api);
   assert.equal(result.count,1);
   assert.equal(result.aheadCount,1);
   assert.equal(result.isTruncated,false);
   assert.equal(result.groups.Features[0].sha,SHA2);
   assert.deepEqual(calls.map(x=>x.method),['GET','GET']);
   assert.equal(calls[1].url.searchParams.get('searchCriteria.itemVersion.version'),SHA2);
   assert.equal(calls[1].url.searchParams.get('searchCriteria.itemVersion.versionType'),'commit');
   assert.equal(calls[1].url.searchParams.has('searchCriteria.compareVersion.version'),false);
 }finally{restore()}
});
test('GitChangelog writes parent-child commit to Markdown',async()=>{
 const os=require('node:os');
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'git-changelog-'));
 const report=path.join(tmp,'CHANGELOG.md');
 const {api}=fake(({url})=>url.pathname.endsWith('/diffs/commits')?
  {aheadCount:1,behindCount:0,commonCommit:SHA1}:
  {count:1,value:[{comment:'fix: update test pipeline',commitId:SHA2}]});
 const restore=inputs({repositoryId:'repo',commitSha:SHA2,baseVersion:SHA1,targetVersion:SHA2,maxCommits:'200',outputFile:report});
 try {
   const result=await actions.changelog(api);
   assert.equal(result.count,1);
   const content=fs.readFileSync(report,'utf8');
   assert.match(content,/## Fixes/);
   assert.match(content,/fix: update test pipeline/);
   assert.match(content,/bbbbbbbb/);
 }finally{restore();fs.rmSync(tmp,{recursive:true,force:true});}
});
test('GitChangelog does not silently generate an empty report when diff is ahead',async()=>{
 const {api,calls}=fake(({url})=>url.pathname.endsWith('/diffs/commits')?
   {aheadCount:1,behindCount:0}:
   {value:[],count:0});
 const restore=inputs({repositoryId:'repo',commitSha:SHA2,baseVersion:SHA1,targetVersion:SHA2,outputFile:''});
 try{
   await assert.rejects(()=>actions.changelog(api),/esperado\(s\) 1/);
   assert.equal(calls.length,2);
 }finally{restore()}
});
test('GitChangelog returns clear empty result when target is not ahead',async()=>{
 const {api,calls}=fake(()=>({aheadCount:0,behindCount:1}));
 const restore=inputs({repositoryId:'repo',commitSha:SHA1,baseVersion:SHA2,targetVersion:SHA1,outputFile:''});
 try{
   const result=await actions.changelog(api);
   assert.equal(result.count,0);
   assert.match(result.markdown,/Nenhum commit novo/);
   assert.equal(calls.length,1);
 }finally{restore()}
});
test('GitChangelog limits output to ahead commits and marks truncation',async()=>{
 const third='c'.repeat(40);
 const {api}=fake(({url})=>url.pathname.endsWith('/diffs/commits')?
  {aheadCount:3,behindCount:0}:
  {count:2,value:[{commitId:third,comment:'feat: third'},{commitId:SHA2,comment:'fix: second'}]});
 const restore=inputs({repositoryId:'repo',commitSha:third,baseVersion:SHA1,targetVersion:third,maxCommits:'2',outputFile:''});
 try{
   const result=await actions.changelog(api);
   assert.equal(result.count,2);
   assert.equal(result.isTruncated,true);
   assert.match(result.markdown,/2 de 3 commits/);
 }finally{restore()}
});
test('GitChangelog refuses an unrelated first commit for SHA target',async()=>{
 const {api}=fake(({url})=>url.pathname.endsWith('/diffs/commits')?
  {aheadCount:1,behindCount:0}:
  {count:1,value:[{commitId:SHA1,comment:'wrong history'}]});
 const restore=inputs({repositoryId:'repo',commitSha:SHA2,baseVersion:SHA1,targetVersion:SHA2,outputFile:''});
 try{await assert.rejects(()=>actions.changelog(api),/difere do SHA de destino/);}finally{restore()}
});
test('GitChangelog refuses missing aheadCount',async()=>{
 const {api}=fake(()=>({changes:[]}));
 const restore=inputs({repositoryId:'repo',commitSha:SHA2,baseVersion:SHA1,targetVersion:SHA2,outputFile:''});
 try{await assert.rejects(()=>actions.changelog(api),/aheadCount válido/);}finally{restore()}
});

test('Classic Release accepts both modern Azure DevOps collection and VSRM URLs',()=>{
 const {normalizeAzureAddress}=require('../src/azure');
 for(const url of ['https://dev.azure.com/GrupoZaffari/','https://vsrm.dev.azure.com/GrupoZaffari/']) {
  const d=normalizeAzureAddress(url);
  assert.equal(d.organization,'GrupoZaffari');
  assert.equal(d.base,'https://dev.azure.com/GrupoZaffari');
  assert.equal(d.releaseBase,'https://vsrm.dev.azure.com/GrupoZaffari');
 }
});
test('Classic Release accepts legacy organization and VSRM domains',()=>{
 const {normalizeAzureAddress}=require('../src/azure');
 for(const url of ['https://GrupoZaffari.visualstudio.com/','https://GrupoZaffari.vsrm.visualstudio.com/']) {
  const d=normalizeAzureAddress(url);
  assert.equal(d.organization.toLowerCase(),'grupozaffari');
  assert.equal(d.base,'https://grupozaffari.visualstudio.com');
  assert.equal(d.releaseBase,'https://grupozaffari.vsrm.visualstudio.com');
 }
});
test('Classic Release prefers System.TeamFoundationCollectionUri and resolves both API origins',()=>{
 const d=collectionDetails({
  SYSTEM_COLLECTIONURI:'https://vsrm.dev.azure.com/AnotherOrg/',
  SYSTEM_TEAMFOUNDATIONCOLLECTIONURI:'https://dev.azure.com/GrupoZaffari/',
  SYSTEM_TEAMPROJECTID:'24a7ea9f-71ca-412e-8918-24fafc173967',
  ENDPOINT_AUTH_PARAMETER_SYSTEMVSSCONNECTION_ACCESSTOKEN:'OAUTH_TOKEN'
 });
 assert.equal(d.organization,'GrupoZaffari');
 assert.equal(d.base,'https://dev.azure.com/GrupoZaffari');
 assert.equal(d.releaseBase,'https://vsrm.dev.azure.com/GrupoZaffari');
 assert.equal(d.token,'OAUTH_TOKEN');
 const client=new AzureClient({...d,fetch:async()=>({ok:true,status:200,text:async()=>JSON.stringify({artifacts:[]})})});
 assert.equal(client.base,'https://dev.azure.com/GrupoZaffari/24a7ea9f-71ca-412e-8918-24fafc173967');
 assert.equal(client.releaseBase,'https://vsrm.dev.azure.com/GrupoZaffari/24a7ea9f-71ca-412e-8918-24fafc173967');
});
test('Classic Release falls back to release service URI if collection URI is unavailable',()=>{
 const d=collectionDetails({SYSTEM_TEAMFOUNDATIONSERVERURI:'https://vsrm.dev.azure.com/GrupoZaffari/',SYSTEM_TEAMPROJECT:'Applications',SYSTEM_ACCESSTOKEN:'TEST'});
 assert.equal(d.base,'https://dev.azure.com/GrupoZaffari');
 assert.equal(d.releaseBase,'https://vsrm.dev.azure.com/GrupoZaffari');
});
test('Azure DevOps URL validation refuses untrusted or non-HTTPS endpoints',()=>{
 const {normalizeAzureAddress}=require('../src/azure');
 for(const url of ['http://dev.azure.com/GrupoZaffari/','https://dev.azure.com.evil.test/GrupoZaffari','https://attacker.vsrm.visualstudio.com.evil.test/','https://vsrm.dev.azure.com/','https://dev.azure.com:8443/GrupoZaffari','https://user:pass@dev.azure.com/GrupoZaffari']) {
  assert.throws(()=>normalizeAzureAddress(url));
 }
});
