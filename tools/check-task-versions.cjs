'use strict';
// Governance: vss-extension.json controls the package; each task.json controls task @Major.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const run = (...args) => cp.execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'vss-extension.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const project = pkg.name;
const isGit = project === 'azure-pipelines-tasks-git';
const sharedPrefix = isGit ? 'src/' : project === 'pitinga-database-migration-tasks' ? 'shared/' : 'lib/';
const tasks = manifest.contributions.filter(c => c.type === 'ms.vss-distributed-task.task').map(c => c.properties.name);
const readOld = (sha, file) => {
  try { return cp.execFileSync('git', ['show', sha + ':' + file], {cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}); }
  catch { return null; }
};
const taskFile = name => (isGit ? 'tasks/' : '') + name + '/task.json';
const components = v => {
  if (typeof v === 'string') {
    if (!/^\d+\.\d+\.\d+$/.test(v)) throw Error('Versão inválida: ' + v);
    return v.split('.').map(Number);
  }
  if (!v || !['Major','Minor','Patch'].every(k => Number.isInteger(Number(v[k])) && Number(v[k]) >= 0)) {
    throw Error('Versão de task inválida');
  }
  return ['Major','Minor','Patch'].map(k => Number(v[k]));
};
const compare = (a,b) => {
  const x=components(a), y=components(b);
  for(let i=0;i<3;i++) if(x[i]!==y[i]) return x[i]>y[i]?1:-1;
  return 0;
};
const taskSource = (p,name) => {
  const prefix = (isGit ? 'tasks/' : '') + name + '/';
  return p === prefix + 'task.json' || p === prefix + 'index.js' ||
    p === prefix + 'index.cjs' || p.startsWith(prefix + 'lib/') ||
    p.startsWith(sharedPrefix);
};
const packageSource = p =>
  p === 'vss-extension.json' || p === 'LICENSE' || p === 'overview.md' ||
  p.startsWith('images/') || p.startsWith(sharedPrefix) ||
  p === 'scripts/build.js' || p === 'scripts/build.cjs' || p === 'tools/prepare.js' ||
  tasks.some(name => {
    const prefix = (isGit ? 'tasks/' : '') + name + '/';
    return p === prefix + 'task.json' || p === prefix + 'index.js' ||
      p === prefix + 'index.cjs' || p === prefix + 'icon.png' || p.startsWith(prefix + 'lib/');
  });
function incompatible(oldTask,newTask) {
  const oldInputs = Array.isArray(oldTask.inputs) ? oldTask.inputs : [];
  const next = new Map((newTask.inputs || []).map(x=>[x.name,x]));
  const removed = [];
  for(const input of oldInputs) {
    const n=next.get(input.name);
    if(!n) removed.push(input.name+' removido');
    else if(n.type!==input.type) removed.push(input.name+' mudou de tipo');
    else if(!input.required && n.required) removed.push(input.name+' tornou-se obrigatório');
    else if(input.options && n.options && Object.keys(input.options).some(k=>!Object.hasOwn(n.options,k)))
      removed.push(input.name+' perdeu opções');
  }
  return removed;
}
function selfTest() {
  assert.equal(compare('1.2.3','1.2.2'),1);
  assert.equal(compare('1.2.2','1.2.2'),0);
  assert.equal(compare({Major:0,Minor:2,Patch:0},{Major:0,Minor:1,Patch:9}),1);
  assert.equal(compare('1.0.0','0.99.99'),1);
  assert.ok(taskSource((isGit?'tasks/':'')+tasks[0]+'/task.json',tasks[0]));
  assert.ok(!packageSource('README.md'));
  assert.ok(packageSource('LICENSE'));
  assert.deepEqual(incompatible({inputs:[{name:'a',type:'string',required:false}]},{inputs:[]}),['a removido']);
  console.log('OK: 8 verificações internas de governança');
}
if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  if (pkg.version !== manifest.version) throw Error('package.json.version deve corresponder ao vss-extension.json.version');
  const before = process.env.VERSION_BASE_SHA || '';
  let base = /^[0-9a-f]{40}$/i.test(before) && !/^0{40}$/.test(before) ? before : '';
  if (!base) {
    try { base=run('rev-parse','HEAD^'); } catch { console.log('Commit inicial, sem base histórica.'); process.exit(0); }
  }
  try { run('cat-file','-e',base+'^{commit}'); }
  catch { throw Error('Commit de comparação não encontrado: '+base+'. Confira checkout fetch-depth: 0.'); }
  const changes = run('diff','--no-renames','--name-only',base,'HEAD').split('\n').filter(Boolean);
  const oldManifestText = readOld(base,'vss-extension.json');
  if (!oldManifestText) { console.log('Manifesto não existia no commit-base.'); process.exit(0); }
  const oldManifest=JSON.parse(oldManifestText);
  if (oldManifest.publisher!==manifest.publisher || oldManifest.id!==manifest.id)
    throw Error('Identidade publicada (publisher/id) foi alterada. Faça revisão manual.');
  let errorCount=0;
  const fail = message => { console.error('::error::'+message); errorCount++; };
  const currentNames = new Set(tasks);
  const previousNames = new Set(oldManifest.contributions.filter(c=>c.type==='ms.vss-distributed-task.task').map(c=>c.properties.name));
  for(const name of previousNames) if(!currentNames.has(name)) fail('Task removida do manifesto sem revisão: '+name);
  for(const name of tasks) {
    const current = JSON.parse(fs.readFileSync(path.join(root,taskFile(name)),'utf8'));
    const oldText = readOld(base,taskFile(name));
    if (!oldText) continue; // Task nova: atualização de extensão será exigida abaixo.
    const old=JSON.parse(oldText);
    if (old.id !== current.id || old.name !== current.name)
      fail(name+': GUID ou nome da task alterado. Preserve a identidade.');
    const bump=compare(current.version,old.version);
    const changed=changes.some(p=>taskSource(p,name));
    if(bump<0) fail(name+': downgrade de versão interna não permitido.');
    if(changed && bump<=0) fail(name+': código ou task.json alterado sem incrementar version.Major/Minor/Patch.');
    if(incompatible(old,current).length && components(current.version)[0] <= components(old.version)[0])
      fail(name+': mudança incompatível em inputs exige novo Major (@N): '+incompatible(old,current).join(', '));
    if(bump>0) console.log(name+': '+components(old.version).join('.')+' => '+components(current.version).join('.'));
  }
  const oldPackageText=readOld(base,'package.json');
  if(oldPackageText && JSON.parse(oldPackageText).version !== oldManifest.version) fail('Versões divergentes no commit-base.');
  const packageChanged=changes.some(packageSource);
  const extBump=compare(manifest.version,oldManifest.version);
  if(extBump<0) fail('Downgrade da versão da extensão não permitido.');
  if(packageChanged && extBump<=0)
    fail('Arquivos que integram o VSIX mudaram sem atualizar vss-extension.json.version e package.json.version.');
  if(errorCount) process.exit(1);
  console.log('OK: governança de versões; baseline '+base.slice(0,12)+'; '+changes.length+' arquivos alterados; VSIX '+oldManifest.version+' => '+manifest.version);
}
