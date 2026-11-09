'use strict';
const {AzureClient}=require('./azure');
const {issue,finish}=require('./runtime');
const tasks={
  GitTag:'tag',GitBranch:'branch',GitCompare:'compare',GitChangelog:'changelog',
  GitVerify:'verify',GitCommitStatus:'status',GitPullRequest:'pr',GitMerge:'merge'
};
async function run(task) {
  if(!Object.hasOwn(tasks,task))throw new Error('Task desconhecida: '+task);
  try {
    const api=new AzureClient();
    await require('./actions')[tasks[task]](api);
    finish(true,task+' concluída.');
  } catch(err) {
    const message=String(err && err.message || err);
    issue('error',message);
    finish(false,message);
    process.exitCode=1;
  }
}
module.exports={run};
