'use strict';
const fs=require('node:fs');
const path=require('node:path');
const zlib=require('node:zlib');
const root=path.resolve(__dirname,'..');
const taskNames=['GitTag','GitBranch','GitCompare','GitChangelog','GitVerify','GitCommitStatus','GitPullRequest','GitMerge'];
function crc32(buf) {
  let crc=0xffffffff;
  for(const b of buf) {crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^(crc&1?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}
function chunk(type,data) {
  const t=Buffer.from(type),size=Buffer.alloc(4),sum=Buffer.alloc(4);
  size.writeUInt32BE(data.length);sum.writeUInt32BE(crc32(Buffer.concat([t,data])));
  return Buffer.concat([size,t,data,sum]);
}
function icon() {
  const w=128,h=128,data=Buffer.alloc(h*(1+w*4));
  for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
    const pos=y*(1+w*4)+1+x*4;
    const gradient=y/128;data[pos]=Math.round(12+12*gradient);
    data[pos+1]=Math.round(42+10*gradient);data[pos+2]=Math.round(69+12*gradient);data[pos+3]=255;
  }
  function dot(cx,cy,r,color) {
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)if((x-cx)**2+(y-cy)**2<=r*r){
      const n=y*(1+w*4)+1+x*4;for(let a=0;a<4;a++)data[n+a]=color[a];
    }
  }
  function line(x1,y1,x2,y2,r,color) {
    for(let i=0;i<=140;i++){const t=i/140;dot(Math.round(x1+(x2-x1)*t),Math.round(y1+(y2-y1)*t),r,color);}
  }
  const white=[246,249,253,255],green=[61,212,167,255];
  line(42,35,42,96,5,white);line(42,50,89,50,5,white);line(89,50,89,83,5,white);
  dot(42,34,12,green);dot(42,96,12,green);dot(89,83,12,green);
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(data)),chunk('IEND',Buffer.alloc(0))]);
}
const png=icon();
fs.mkdirSync(path.join(root,'images'),{recursive:true});
fs.writeFileSync(path.join(root,'images','extension-icon.png'),png);
for(const task of taskNames) {
  const out=path.join(root,task);
  fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
  const source=path.join(root,'tasks',task);
  for(const file of ['task.json','index.js'])fs.copyFileSync(path.join(source,file),path.join(out,file));
  for(const file of ['runtime.js','azure.js','releases.js','actions.js','runner.js'])
    fs.copyFileSync(path.join(root,'src',file),path.join(out,file));
  fs.writeFileSync(path.join(out,'icon.png'),png);
  const config=JSON.parse(fs.readFileSync(path.join(out,'task.json'),'utf8'));
  if(Object.keys(config.execution).join()!=='Node24'||config.minimumAgentVersion!=='4.265.1')
    throw new Error('Task não é Node24: '+task);
  console.log('Prepared '+task+' (Node24)');
}
