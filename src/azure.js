'use strict';
const {sha,refName} = require('./runtime');
const ZERO='0'.repeat(40);
function normalizeAzureAddress(address) {
  let parsed;
  try { parsed=new URL(String(address||'').trim()); }
  catch { throw new Error('URL da coleção Azure DevOps ausente ou inválida.'); }
  const hostname=parsed.hostname.toLowerCase();
  if(parsed.protocol!=='https:' || parsed.username || parsed.password || parsed.port) {
    throw new Error('Somente URLs HTTPS oficiais do Azure DevOps Services são suportadas.');
  }
  let organization,base,releaseBase;
  // Classic Releases can expose vsrm.dev.azure.com (or *.vsrm.visualstudio.com)
  // as their service URI. The normal Git/Build API must still use the
  // organization collection endpoint, never the Release Management host.
  if(hostname==='dev.azure.com' || hostname==='vsrm.dev.azure.com') {
    organization=parsed.pathname.split('/').filter(Boolean)[0];
    if(!organization || !/^[a-z0-9-]+$/i.test(organization)) {
      throw new Error('Organização não encontrada na URI Azure DevOps.');
    }
    base='https://dev.azure.com/' + organization;
    releaseBase='https://vsrm.dev.azure.com/' + organization;
  } else {
    const legacy=hostname.match(/^([a-z0-9-]+)(?:\.vsrm)?\.visualstudio\.com$/);
    if(!legacy)throw new Error('Host Azure DevOps não suportado: '+hostname+'. Use a URL da coleção oficial.');
    organization=legacy[1];
    base='https://' + organization + '.visualstudio.com';
    releaseBase='https://' + organization + '.vsrm.visualstudio.com';
  }
  return {organization,base,releaseBase};
}
function collectionDetails(env=process.env) {
  // Microsoft documents TeamFoundationCollectionUri as the canonical URL for
  // Git/Build APIs in Classic Releases. Prefer it over the release-service
  // URL exposed in some job contexts.
  const address=env.SYSTEM_TEAMFOUNDATIONCOLLECTIONURI ||
    env.SYSTEM_COLLECTIONURI || env.SYSTEM_TEAMFOUNDATIONSERVERURI;
  const project=env.SYSTEM_TEAMPROJECTID || env.SYSTEM_TEAMPROJECT;
  const token=env.SYSTEM_ACCESSTOKEN || env.ENDPOINT_AUTH_PARAMETER_SYSTEMVSSCONNECTION_ACCESSTOKEN;
  if(!address || !project) {
    throw new Error('URI da coleção e/ou SYSTEM_TEAMPROJECT não disponíveis na task.');
  }
  const {base,releaseBase,organization}=normalizeAzureAddress(address);
  if(!token)throw new Error('Token OAuth não disponível. Verifique o acesso ao token OAuth no Agent Job da Classic Release.');
  return {base,releaseBase,project,organization,token};
}
class AzureClient {
  constructor(options=collectionDetails()) {
    this.settings=options;
    this.base=options.base.replace(/\/$/,'') + '/' + encodeURIComponent(options.project);
    this.releaseBase=options.releaseBase.replace(/\/$/,'') + '/' + encodeURIComponent(options.project);
    this.requestImpl=options.fetch || globalThis.fetch;
  }
  async request(method, path, options={}) {
    const qs=new URLSearchParams(options.query||{});
    qs.set('api-version','7.1');
    const prefix=options.release ? this.releaseBase : this.base;
    const url=prefix + '/_apis/' + path + '?' + qs.toString();
    let response;
    try {
      response=await this.requestImpl(url,{
        method,headers:{Authorization:'Bearer '+this.settings.token,'Content-Type':'application/json','Accept':'application/json'},
        body:options.body===undefined?undefined:JSON.stringify(options.body),
        signal:AbortSignal.timeout(30000)
      });
    } catch(err) {
      throw new Error('Falha de conexão Azure DevOps ('+method+' '+path+'): '+err.message);
    }
    const text=await response.text();
    if(!response.ok) {
      let detail='HTTP '+response.status;
      try {const j=JSON.parse(text);detail+=': '+String(j.message||j.typeKey||'').slice(0,350);} catch {}
      throw new Error('Azure DevOps '+method+' '+path+': '+detail);
    }
    return text ? JSON.parse(text) : {};
  }
  git(repo) {if(!repo)throw new Error('Repository ID não definido.');return 'git/repositories/'+encodeURIComponent(repo);}
  async ref(repo,name) {
    const type=name.startsWith('refs/tags/')?'tags/':'heads/';
    const fragment=name.slice(5);
    const resp=await this.request('GET',this.git(repo)+'/refs',{query:{filter:fragment,'$top':'1000'}});
    return (resp.value||[]).find(x=>x.name===name)||null;
  }
  async commit(repo,id) {
    if(!sha(id))throw new Error('SHA deve ter 40 caracteres hexadecimais.');
    return this.request('GET',this.git(repo)+'/commits/'+id);
  }
  async resolve(repo,version) {
    const v=typeof version==='string' ? require('./runtime').versionInput(version):version;
    if (v.versionType==='commit') {await this.commit(repo,v.version);return v.version.toLowerCase();}
    const ref=await this.ref(repo,refName(v.version,v.versionType==='tag'?'tag':'branch'));
    if(!ref)throw new Error('Referência Git não encontrada: '+v.versionType+':'+v.version);
    if(!sha(ref.objectId))throw new Error('A referência Git não aponta para um SHA válido.');
    return ref.objectId.toLowerCase();
  }
  async createRef(repo,name,commitId,dryRun) {
    if(!sha(commitId))throw new Error('Commit SHA inválido.');
    await this.commit(repo,commitId);
    const exists=await this.ref(repo,name);
    if(exists) {
      if(exists.objectId.toLowerCase()===commitId.toLowerCase())return {status:'unchanged',name,commit:commitId};
      throw new Error('Ref já existe e aponta para outro commit: '+name+' ('+exists.objectId+'). Nenhuma alteração realizada.');
    }
    if(dryRun)return {status:'dry-run',name,commit:commitId};
    const result=await this.request('POST',this.git(repo)+'/refs',{body:[{name,oldObjectId:ZERO,newObjectId:commitId}]});
    const update=Array.isArray(result)?result[0]:(result.value||[])[0];
    if(!update || !update.success)throw new Error('Falha ao criar '+name+': '+String(update?.updateStatus||update?.customMessage||'resposta desconhecida'));
    return {status:'created',name,commit:commitId};
  }
  async diff(repo,base,target,max) {
    const [b,t]=[require('./runtime').versionInput(base),require('./runtime').versionInput(target)];
    return this.request('GET',this.git(repo)+'/diffs/commits',{
      query:{baseVersion:b.version,baseVersionType:b.versionType,targetVersion:t.version,targetVersionType:t.versionType,
       diffCommonCommit:'false','$top':String(max),'$skip':'0'}
    });
  }
  async commits(repo,target,max) {
    // Query only target history. Azure Repos accepts a SHA, tag or branch as
    // itemVersion; comparisons are independently validated via diffs/commits.
    const t=require('./runtime').versionInput(target);
    return this.request('GET',this.git(repo)+'/commits',{
      query:{
        'searchCriteria.itemVersion.version':t.version,
        'searchCriteria.itemVersion.versionType':t.versionType,
        'searchCriteria.$top':String(max),
        'searchCriteria.$skip':'0'
      }
    });
  }
  async prs(repo,source,target) {
    const response=await this.request('GET',this.git(repo)+'/pullrequests',{
      query:{'searchCriteria.status':'active','searchCriteria.sourceRefName':source,
        'searchCriteria.targetRefName':target,'$top':'100'}});
    return (response.value||[]).filter(pr=>pr.status==='active' && pr.sourceRefName===source && pr.targetRefName===target);
  }
  async createPr(repo,data,dryRun) {
    if(dryRun)return {status:'dry-run',sourceRefName:data.sourceRefName,targetRefName:data.targetRefName};
    return this.request('POST',this.git(repo)+'/pullrequests',{body:data});
  }
}
module.exports={AzureClient,collectionDetails,normalizeAzureAddress,ZERO};
