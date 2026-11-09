'use strict';
const {sha} = require('./runtime');
function inputEnvironment(env=process.env) {
  const repo=env.BUILD_REPOSITORY_ID||'';
  const commit=env.BUILD_SOURCEVERSION||'';
  const provider=env.BUILD_REPOSITORY_PROVIDER||'TfsGit';
  if(provider!=='TfsGit' && provider!=='Git')throw new Error('Somente Azure Repos Git é suportado, não '+provider);
  if(!repo||!sha(commit))throw new Error('RepositoryId/SourceVersion ausente. Em Classic Release use artifactAlias ou preencha repositoryId e commitSha.');
  return [{repo,commit,alias:'build'}];
}
function releaseVersionName(env=process.env) {return env.RELEASE_RELEASENAME || env.BUILD_BUILDNUMBER || '';}
async function releaseArtifacts(api,aliases='',env=process.env) {
  const releaseId=env.RELEASE_RELEASEID;
  if(!releaseId)throw new Error('RELEASE_RELEASEID não disponível: esta task não está em uma Classic Release.');
  const data=await api.request('GET','release/releases/'+encodeURIComponent(releaseId),{release:true});
  const wanted=aliases.trim()?new Set(aliases.split(/[,\n;]/).map(x=>x.trim()).filter(Boolean)):null;
  const result=[];
  for(const art of data.artifacts||[]) {
    if(wanted && !wanted.has(art.alias))continue;
    if(art.type!=='Build') {
      if(wanted)throw new Error('Artefato '+art.alias+' é tipo '+art.type+', esperado Build Azure Repos Git.');
      console.log('Ignorando artefato '+art.alias+' (tipo '+art.type+').');
      continue;
    }
    const buildId=art.definitionReference?.version?.id;
    if(!buildId)throw new Error('Artefato '+art.alias+' sem build ID.');
    const project=art.definitionReference?.project?.id || api.settings.project;
    // Builds may originate in another project of the same organization.
    const url='build/builds/'+encodeURIComponent(buildId);
    const build=await api.request('GET',url,{query:{projectId:project}});
    const repositoryId=build.repository?.id;
    if(!repositoryId || build.repository.type!=='TfsGit'||!sha(build.sourceVersion)){
      throw new Error('Build '+buildId+' ('+art.alias+') não é Azure Repos Git com sourceVersion válido.');
    }
    if(project!==api.settings.project) {
      throw new Error('Artefato '+art.alias+' pertence a outro projeto. Configure uma task por projeto para não usar o repositório errado.');
    }
    result.push({repo:repositoryId,commit:build.sourceVersion,alias:art.alias,buildId});
  }
  if(wanted)for(const alias of wanted)if(!result.find(x=>x.alias===alias))throw new Error('Artifact alias não encontrado: '+alias);
  if(!result.length)throw new Error('Nenhum artefato Build/Azure Repos Git encontrado na release.');
  // Ambiguous multiple versions of the same repository must be resolved by caller.
  const uniques=new Map();
  for(const item of result) {
    const previous=uniques.get(item.repo.toLowerCase());
    if(previous && previous.commit.toLowerCase()!==item.commit.toLowerCase()) {
      throw new Error('Artefatos '+previous.alias+' e '+item.alias+' apontam para commits diferentes do mesmo repositório. Selecione artifactAliases explicitamente.');
    }
    uniques.set(item.repo.toLowerCase(),item);
  }
  return [...uniques.values()];
}
async function targets(api,opts={},env=process.env) {
  if(opts.repositoryId || opts.commitSha) {
    if(!opts.repositoryId || !sha(opts.commitSha))throw new Error('repositoryId e commitSha (SHA de 40 caracteres) devem ser informados juntos.');
    return [{repo:opts.repositoryId,commit:opts.commitSha,alias:'manual'}];
  }
  if(env.RELEASE_RELEASEID)return releaseArtifacts(api,opts.artifactAliases||'',env);
  return inputEnvironment(env);
}
async function one(api,opts={},env=process.env) {
  const values=await targets(api,opts,env);
  if(values.length!==1)throw new Error('Mais de um repositório nesta release. Informe artifactAliases ou repositoryId/commitSha.');
  return values[0];
}
module.exports={inputEnvironment,releaseVersionName,releaseArtifacts,targets,one};
