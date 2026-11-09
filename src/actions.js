'use strict';
const {input,required,yes,number,variable,save,refName,versionInput,sha,tagFromRelease}=require('./runtime');
const {releaseVersionName,targets,one}=require('./releases');
function opts() {
  return {repositoryId:input('repositoryId'),commitSha:input('commitSha'),artifactAliases:input('artifactAliases')};
}
function defaultCommit(value,target) { return value || target.commit; }
function output(operation,result) {
  console.log(JSON.stringify({operation,...result},null,2));
  return result;
}
async function tag(api) {
  const dryRun=yes('dryRun');
  const picked=await targets(api,opts());
  const name=input('tagName') || tagFromRelease(releaseVersionName(),input('searchRegex'),input('regexFlags','g'),input('replacePattern'));
  const ref=refName(name,'tag');
  const results=[];
  for (const target of picked) {
    const record=await api.createRef(target.repo,ref,target.commit,dryRun);
    results.push({...record,repo:target.repo,alias:target.alias});
  }
  variable('GitTagName',ref);
  return output('GitTag',{results});
}
async function branch(api) {
  const dryRun=yes('dryRun');
  const picked=await targets(api,opts());
  const name=input('branchName') || 'release/'+tagFromRelease(releaseVersionName(),input('searchRegex'),input('regexFlags','g'),input('replacePattern'));
  const ref=refName(name,'branch');
  const results=[];
  for (const target of picked) {
    const record=await api.createRef(target.repo,ref,target.commit,dryRun);
    results.push({...record,repo:target.repo,alias:target.alias});
  }
  variable('GitBranchName',ref);
  return output('GitBranch',{results});
}
async function verify(api) {
  const target=await one(api,opts());
  const kind=input('refType','tag');
  if(!['tag','branch'].includes(kind))throw new Error('refType deve ser tag ou branch');
  const name=refName(required('refName'),kind);
  const expected=input('expectedSha') || target.commit;
  if(!sha(expected))throw new Error('expectedSha deve conter 40 caracteres hexadecimais.');
  const current=await api.ref(target.repo,name);
  if(!current)throw new Error('Ref não existe: '+name);
  if(current.objectId.toLowerCase()!==expected.toLowerCase()) {
    throw new Error(name+' aponta para '+current.objectId+', esperado '+expected);
  }
  variable('GitVerifiedSha',expected);
  return output('GitVerify',{name,expected,match:true,repositoryId:target.repo});
}
function reportDiff(diff,base,target,max) {
  const changes=(diff.changes||[]).slice(0,max).map(c=>({
    changeType:c.changeType||'',
    path:c.item?.path||c.sourceServerItem||''
  }));
  return {base,target,aheadCount:diff.aheadCount||0,behindCount:diff.behindCount||0,
    changeCounts:diff.changeCounts||{},changes,
    isTruncated:!!diff.isTruncated||((diff.changes||[]).length>=max)};
}
async function compare(api) {
  const target=await one(api,opts());
  const base=required('baseVersion');
  const version=input('targetVersion')||target.commit;
  const max=number('maxChanges',200,1000);
  const diff=await api.diff(target.repo,base,version,max);
  const report=reportDiff(diff,base,version,max);
  const format=input('format','json');
  if(format==='markdown') {
    const lines=['# Git Compare','','- Base: '+base,'- Target: '+version,
      '- Commits ahead: '+report.aheadCount,'- Commits behind: '+report.behindCount,'',
      '| Change | File |','| --- | --- |'];
    for(const c of report.changes) lines.push('| '+c.changeType+' | '+c.path.replace(/\|/g,'\\|')+' |');
    if(report.isTruncated)lines.push('','> Resultado limitado a '+max+' alterações.');
    save(input('outputFile'),lines.join('\n')+'\n');
  } else if(format==='json')save(input('outputFile'),JSON.stringify(report,null,2)+'\n');
  else throw new Error('format deve ser json ou markdown.');
  variable('GitCompareAheadCount',report.aheadCount);
  return output('GitCompare',report);
}
function groupCommits(commits) {
  const groups={Features:[],Fixes:[],Other:[]};
  for(const c of commits) {
    const message=(c.comment||c.message||'(no message)').split('\n')[0].replace(/[\r\n]/g,' ').slice(0,250);
    const subject=/^feat(?:\(.+\))?!?:/.test(message) ? 'Features' :
      /^fix(?:\(.+\))?!?:/.test(message) ? 'Fixes' : 'Other';
    groups[subject].push({sha:c.commitId||c.commit?.commitId||'',message});
  }
  return groups;
}
async function changelog(api) {
  const target=await one(api,opts());
  const base=required('baseVersion');
  const version=input('targetVersion')||target.commit;
  const limit=number('maxCommits',200,500);
  // The previous commitsbatch compareVersion query returned no commits
  // for valid parent -> child pairs in Azure Repos. Use the validated diff
  // aheadCount and request target history independently instead.
  const diff=await api.diff(target.repo,base,version,1);
  const ahead=diff?.aheadCount;
  if(!Number.isSafeInteger(ahead)||ahead<0)throw new Error('GitChangelog: comparação não retornou aheadCount válido.');
  const requested=Math.min(limit,ahead);
  let commits=[];
  if(requested>0) {
    const raw=await api.commits(target.repo,version,requested);
    const fetched=Array.isArray(raw)?raw:raw?.value;
    if(!Array.isArray(fetched)||fetched.length<requested) {
      throw new Error('GitChangelog: histórico retornou '+(Array.isArray(fetched)?fetched.length:'dados inválidos')+' commit(s), esperado(s) '+requested+'. Relatório não gerado.');
    }
    commits=fetched.slice(0,requested);
    if(commits.some(c=>!sha(c.commitId))) {
      throw new Error('GitChangelog: histórico contém commitId ausente ou inválido.');
    }
    // For explicit SHA targets, the first item must be the exact target,
    // not a stale branch HEAD or a different part of the history.
    if(sha(version)&&commits[0].commitId.toLowerCase()!==version.toLowerCase()) {
      throw new Error('GitChangelog: o primeiro commit retornado difere do SHA de destino.');
    }
  }
  const groups=groupCommits(commits);
  const lines=['# Changelog','','**Base:** '+base+'  ','**Target:** '+version,''];
  if(!commits.length)lines.push('_Nenhum commit novo entre as versões._','');
  for(const [group,items] of Object.entries(groups)) {
    if(!items.length)continue;
    lines.push('## '+group,'');
    for(const c of items)lines.push('- '+c.message+' ('+(c.sha?c.sha.slice(0,8):'no SHA')+')');
    lines.push('');
  }
  if(ahead>commits.length)lines.push('> Resultado limitado aos primeiros '+commits.length+' de '+ahead+' commits à frente.','','');
  const md=lines.join('\n')+'\n';
  save(input('outputFile'),md);
  variable('GitChangelogCount',commits.length);
  return output('GitChangelog',{base,target:version,count:commits.length,aheadCount:ahead,
    isTruncated:ahead>commits.length,groups,markdown:input('outputFile')?'saved':md});
}
async function status(api) {
  const target=await one(api,opts());
  const state=input('state','succeeded');
  if(!['succeeded','failed','pending','error','notApplicable'].includes(state)) {
    throw new Error('state inválido.');
  }
  const name=required('statusName');
  if(name.length>100)throw new Error('statusName muito longo.');
  const genre=input('statusGenre','deployment');
  const description=input('description','Git Tasks for Azure Pipelines').slice(0,255);
  const url=input('targetUrl');
  if(url && (!/^https:\/\//i.test(url)||url.length>2048))throw new Error('targetUrl deve ser HTTPS.');
  const body={state,description,context:{name,genre}};
  if(url)body.targetUrl=url;
  if(yes('dryRun'))return output('GitCommitStatus',{status:'dry-run',repo:target.repo,commit:target.commit,body});
  const result=await api.request('POST',api.git(target.repo)+'/commits/'+target.commit+'/statuses',{body});
  return output('GitCommitStatus',{status:'created',repo:target.repo,commit:target.commit,id:result.id,state});
}
function reviewers(value) {
  if(!value.trim())return [];
  return value.split(/[,\n;]/).map(s=>s.trim()).filter(Boolean).map(id=>{
    if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id))throw new Error('reviewers: informe IDs GUID do Azure DevOps.');
    return {id};
  });
}
async function pr(api) {
  const target=await one(api,opts());
  const source=refName(required('sourceBranch'),'branch'),destination=refName(required('targetBranch'),'branch');
  if(source===destination)throw new Error('Branch origem e destino devem ser diferentes.');
  await Promise.all([api.ref(target.repo,source),api.ref(target.repo,destination)]).then(values=>{
    if(values.some(v=>!v))throw new Error('Branch origem ou destino não encontrado.');
  });
  const active=await api.prs(target.repo,source,destination);
  if(active.length)return output('GitPullRequest',{status:'existing',pullRequestId:active[0].pullRequestId,url:active[0].url});
  const body={sourceRefName:source,targetRefName:destination,
    title:required('title').slice(0,250),description:input('description').slice(0,4000),
    isDraft:yes('draft',true),reviewers:reviewers(input('reviewers'))};
  const result=await api.createPr(target.repo,body,yes('dryRun'));
  if(result.pullRequestId)variable('GitPullRequestId',result.pullRequestId);
  return output('GitPullRequest',{status:result.status||'created',pullRequestId:result.pullRequestId||null,
    source,target:destination,url:result.url||null});
}
async function merge(api) {
  const target=await one(api,opts());
  const source=refName(required('sourceBranch'),'branch'),destination=refName(required('targetBranch'),'branch');
  if(source===destination)throw new Error('Branches devem ser diferentes.');
  const found=await api.prs(target.repo,source,destination);
  if(found.length!==1)throw new Error('GitMerge exige exatamente um PR ativo da origem para o destino. Use GitPullRequest primeiro.');
  const pr=found[0];
  const strategy=input('mergeStrategy','noFastForward');
  if(!['noFastForward','squash','rebase','rebaseMerge'].includes(strategy))throw new Error('Estratégia de merge inválida.');
  if(yes('dryRun'))return output('GitMerge',{status:'dry-run',pullRequestId:pr.pullRequestId,strategy});
  if(!yes('confirmMerge'))throw new Error('Defina confirmMerge=true para solicitar a conclusão do PR. A task nunca ignora políticas.');
  if(!pr.lastMergeSourceCommit?.commitId)throw new Error('PR sem lastMergeSourceCommit; aguarde as validações.');
  const result=await api.request('PATCH',api.git(target.repo)+'/pullrequests/'+pr.pullRequestId,{
    body:{status:'completed',lastMergeSourceCommit:{commitId:pr.lastMergeSourceCommit.commitId},
      completionOptions:{mergeStrategy:strategy,deleteSourceBranch:false,bypassPolicy:false,transitionWorkItems:false}}
  });
  if(result.status==='completed')return output('GitMerge',{status:'completed',pullRequestId:pr.pullRequestId});
  // Merges are sometimes processed asynchronously; do not claim completion.
  return output('GitMerge',{status:'requested',pullRequestId:pr.pullRequestId,serverStatus:result.status,mergeStatus:result.mergeStatus});
}
module.exports={tag,branch,compare,changelog,verify,status,pr,merge,groupCommits,reportDiff};
