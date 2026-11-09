'use strict';
const {sha,refName} = require('./runtime');
const ZERO='0'.repeat(40);
function collectionDetails(env=process.env) {
  const address=env.SYSTEM_COLLECTIONURI || env.SYSTEM_TEAMFOUNDATIONCOLLECTIONURI;
  const project=env.SYSTEM_TEAMPROJECTID || env.SYSTEM_TEAMPROJECT;
  const token=env.SYSTEM_ACCESSTOKEN || env.ENDPOINT_AUTH_PARAMETER_SYSTEMVSSCONNECTION_ACCESSTOKEN;
  if (!address || !project) throw new Error('SYSTEM_COLLECTIONURI e SYSTEM_TEAMPROJECT não disponíveis.');
  const parsed=new URL(address);
  if (parsed.protocol!=='https:' ||
     !(parsed.hostname==='dev.azure.com' || /^[a-z0-9-]+\.visualstudio\.com$/.test(parsed.hostname))) {
     throw new Error('Somente organizações hospedadas em Azure DevOps Services (HTTPS) são suportadas.');
  }
  let organization, base, releaseBase;
  if (parsed.hostname==='dev.azure.com') {
    organization=parsed.pathname.split('/').filter(Boolean)[0];
    if (!organization) throw new Error('Organização não encontrada na Collection URI.');
    base='https://dev.azure.com/' + encodeURIComponent(organization);
    releaseBase='https://vsrm.dev.azure.com/' + encodeURIComponent(organization);
  } else {
    organization=parsed.hostname.split('.')[0];
    base='https://' + parsed.hostname;
    releaseBase='https://' + organization + '.vsrm.visualstudio.com';
  }
  if (!token) throw new Error('SYSTEM_ACCESSTOKEN não disponível. Habilite acesso OAuth ao job/release e mapeie env: SYSTEM_ACCESSTOKEN: $(System.AccessToken).');
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
  async commits(repo,base,target,max) {
    const [b,t]=[require('./runtime').versionInput(base),require('./runtime').versionInput(target)];
    // Azure Repos 7.1: commitsbatch is the documented endpoint for
    // enumerating commits reachable from target but not from base.
    return this.request('POST',this.git(repo)+'/commitsbatch',{
      body:{
        itemVersion:{version:t.version,versionType:t.versionType},
        compareVersion:{version:b.version,versionType:b.versionType},
        '$top':max,
        '$skip':0
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
module.exports={AzureClient,collectionDetails,ZERO};
