// Independent original math/pixel/lifecycle proofs for the installed consumer.
// Expected matrices and pixels are not calculated by renderer code.
import { compileActorProject, createActorPose, evaluateActorPose, saveActorProject, createActorAnimationPlayer, requestActorAnimationState, evaluateActorAnimation } from './package/runtime.js';
import { createActorCanvas2DRenderer } from './package/canvas2d.js';
import { createActorWebGL2Renderer } from './package/webgl2.js';
const T=(x=0,y=0,rotation=0,scaleX=1,scaleY=1)=>({x,y,rotation,scaleX,scaleY});
function make(mode,compiled,width=900,height=360){
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const renderer=mode==='webgl2'?createActorWebGL2Renderer(compiled,canvas):createActorCanvas2DRenderer(compiled);
  const context=canvas.getContext(mode==='webgl2'?'webgl2':'2d');
  return {canvas,renderer,context,clear(){if(mode==='webgl2')renderer.clear();else context.clearRect(0,0,width,height);},
    draw(binding,view){if(mode==='webgl2')binding.draw(view);else binding.draw(context,view);},
    read(points){return points.map(([x,y])=>{
      if(mode==='canvas2d')return [...context.getImageData(x,y,1,1).data];
      const rgba=new Uint8Array(4);context.readPixels(x,height-y-1,1,1,context.RGBA,context.UNSIGNED_BYTE,rgba);
      // WebGL framebuffer is premultiplied; convert only this oracle readback to straight RGBA.
      return rgba[3]?[Math.round(rgba[0]*255/rgba[3]),Math.round(rgba[1]*255/rgba[3]),Math.round(rgba[2]*255/rgba[3]),rgba[3]]:[0,0,0,0];
    })},info(){return mode==='webgl2'?{version:context.getParameter(context.VERSION),vendor:context.getParameter(context.VENDOR),renderer:context.getParameter(context.RENDERER)}:{backend:'Canvas2D'};}};
}
function guard(fn){try{fn();return null;}catch(error){return String(error);}}
export function layered(mode,source){
  const before=saveActorProject(source),compiled=compileActorProject(source),a=createActorPose(compiled),b=createActorPose(compiled),r=make(mode,compiled),first=r.renderer.bind(a),second=r.renderer.bind(b);
  try{
    evaluateActorPose(compiled,'profile:pulse',.375,a);evaluateActorPose(compiled,'profile:pulse',.75,b);
    r.clear();r.draw(first,[40,0,0,-40,50,200]);r.draw(second,[40,0,0,-40,430,200]);
    const points=[[100,170],[120,170],[100,190],[120,190],[580,190]],pixels=r.read(points);
    const metrics=r.renderer.metrics,info=r.info(),world=a.worldMatrices,parts=b.partIndices,sequence=b.drawSequence;
    // Explicit fractional holds and independent modes, expected positions/parts by source schedule.
    const samples=[];
    for(const [mode,t]of [['once',1.5],['loop',1.5],['ping-pong',1.5],['ping-pong',-.25]]){
      const s=structuredClone(source);s.clips[0].playback=mode;const c=compileActorProject(s),p=createActorPose(c);evaluateActorPose(c,'profile:pulse',t,p);
      samples.push({mode,time:t,x:p.worldMatrices[4],visible:p.visible[0],part:c.parts[p.partIndices[0]].id});
    }
    // Hot draw/evaluation must not create raster nodes/upload/decode/serialize.
    let creates=0,uploads=0;const create=document.createElement,upload=mode==='webgl2'?r.context.texImage2D:null;
    document.createElement=function(...args){creates++;return create.apply(this,args);};
    if(upload)r.context.texImage2D=function(...args){uploads++;return upload.apply(this,args);};
    const stringify=JSON.stringify,parse=JSON.parse;JSON.stringify=JSON.parse=()=>{throw new Error('hot serialization');};
    try{for(let i=0;i<1000;i++){evaluateActorPose(compiled,'profile:pulse',i/2000,a);r.draw(first,[40,0,0,-40,50,200]);}}finally{document.createElement=create;if(upload)r.context.texImage2D=upload;JSON.stringify=stringify;JSON.parse=parse;}
    const foreign=guard(()=>r.renderer.bind(createActorPose(compileActorProject(source)))),forged=guard(()=>r.renderer.bind({...a}));
    const changed=structuredClone(source);changed.parts[0].revision++;changed.parts[0].artwork.palette[1]='#ffffffff';
    const revision=guard(()=>r.renderer.bind(createActorPose(compileActorProject(changed))));
    evaluateActorPose(compiled,'profile:pulse',.875,a);r.clear();r.draw(first,[40,0,0,-40,50,200]);const hidden=r.read([[100,170]]);
    first.dispose();const afterBinding=r.renderer.metrics;r.renderer.dispose();r.renderer.dispose();
    return {points,pixels,metrics,info,samples,hidden,creates,uploads,foreign,forged,revision,afterBinding,disposed:r.renderer.metrics,afterDispose:guard(()=>r.draw(second,[40,0,0,-40,430,200])),retained:world===a.worldMatrices&&parts===b.partIndices&&sequence===b.drawSequence,sourceUnchanged:before===saveActorProject(source)};
  }finally{r.renderer.dispose();}
}
export function affine(mode,source){
  source=structuredClone(source);source.parts=source.parts.slice(0,1);const part=source.parts[0];part.artwork.palette=['#12345600','#ff0000ff','#00ff00ff'];part.artwork.layers=part.artwork.layers.slice(0,1);part.artwork.layers[0].pixels=[1,0,2,1];
  source.rigs=[{id:'rig',name:'Affine',sockets:[],nodes:[{id:'root',name:'Root',parentId:null,rest:T(0,0,0,2,1)},{id:'child',name:'Child',parentId:'root',rest:T(0,0,Math.PI/4)}]}];
  source.attachments=[{id:'affine',name:'Affine',partId:part.id,rigId:'rig',nodeId:'child',drawOrder:0,transform:T(0,0,0,-1,1)},{id:'front',name:'Front',partId:part.id,drawOrder:-1,transform:T(0,0,0,-1,1)}];
  source.clips=[{id:'order',name:'Order',duration:1,playback:'once',tracks:[],drawOrderTracks:[{id:'order',target:{kind:'attachment',attachmentId:'front'},keys:[{time:0,drawOrder:-1},{time:.5,drawOrder:1}]}]}];delete source.cels;source.actions=[];
  const c=compileActorProject(source),p=createActorPose(c),r=make(mode,c,16,16),b=r.renderer.bind(p),results=[];
  try{
    // Independent literal screen matrices for S(2,1)*R(pi/4)*S(-1,1) and reflected marker.
    const A=[-6*Math.SQRT2,6*Math.SQRT1_2,6*Math.SQRT2,6*Math.SQRT1_2,8,8-6*Math.SQRT1_2],B=[-6,0,0,6,11,5];
    function sample(m,x,y){const det=m[0]*m[3]-m[1]*m[2],dx=x-m[4],dy=y-m[5],u=(m[3]*dx-m[2]*dy)/det,v=(-m[1]*dx+m[0]*dy)/det;
      // Exclude raster edges/ties to compare independent interior pixel centres across backends.
      if(Math.abs(u-Math.round(u))<.13||Math.abs(v-Math.round(v))<.13)return null;
      if(u<0||v<0||u>=2||v>=2)return [0,0,0,0];return [[255,0,0,255],[0,0,0,0],[0,255,0,255],[255,0,0,255]][Math.floor(v)*2+Math.floor(u)];}
    for(const t of [0,.5]){
      evaluateActorPose(c,'order',t,p);r.clear();r.draw(b,[12,0,0,-12,8,8]);const points=[],expected=[];
      for(let y=0;y<16;y++)for(let x=0;x<16;x++){const a=sample(A,x+.5,y+.5),b=sample(B,x+.5,y+.5);if(!a||!b)continue;points.push([x,y]);const back=t===0?b:a,front=t===0?a:b;expected.push(front[3]?front:back);}
      const actual=r.read(points);let mismatch=0;for(let i=0;i<actual.length;i++)for(let k=0;k<4;k++)if(Math.abs(actual[i][k]-expected[i][k])>1)mismatch++;
      results.push({time:t,checked:points.length,mismatch,actual,expected,points});
    }
    evaluateActorPose(c,null,0,p);p.worldMatrices.fill(0);r.clear();r.draw(b,[12,0,0,-12,8,8]);const degenerate=r.read([[8,8],[0,0]]);
    evaluateActorPose(c,null,0,p);const slot=c.slots.findIndex(s=>s.id==='affine'),actualWorld=Array.from(p.worldMatrices.slice(slot*6,slot*6+6));
    return {source,results,degenerate,actualWorld,expectedWorld:[-Math.SQRT2,-Math.SQRT1_2,-Math.SQRT2,Math.SQRT1_2,0,0]};
  }finally{r.renderer.dispose();}
}
export function composition(mode,source){
  source=structuredClone(source);source.actions=[];source.clips=[];delete source.cels;
  const target={kind:'attachment',attachmentId:source.attachments[0].id};
  for(let i=0;i<3;i++)source.clips.push({id:`c${i}`,name:`Clip ${i}`,duration:2,playback:'once',tracks:[{id:'move',target,interpolation:'linear',keys:[{time:0,value:T(i*10),curve:'cubic-bezier',bezier:[1/3,0,2/3,1]},{time:2,value:T(i*10+2)}]}]});
  source.animators=[{id:'a',name:'A',layers:[{id:'base',name:'Base',blend:'override',weight:1,initialStateId:'s0',defaultTransition:{duration:2,priority:0},states:source.clips.map((c,i)=>({id:`s${i}`,name:`S${i}`,clipId:c.id,rate:1})),transitions:[]},
    {id:'add',name:'Add',blend:'additive',weight:.5,reference:{clipId:'c1',time:1},mask:[target],initialStateId:'s2',defaultTransition:{duration:0,priority:0},states:[{id:'s2',name:'S2',clipId:'c2',rate:0}],transitions:[]}]}];
  const before=saveActorProject(source),c=compileActorProject(source),p=createActorPose(c),player=createActorAnimationPlayer(c,'a'),r=make(mode,c,512,128),binding=r.renderer.bind(p);
  try{
    requestActorAnimationState(player,'base','s1',0);evaluateActorAnimation(c,player,1,p);
    // Cubic y(.5)=.5: override .5*1+.5*11=6; additive .5*(20-11)=4.5 => 10.5.
    const x=p.worldMatrices[4];r.clear();r.draw(binding,[20,0,0,-20,0,80]);const pixels=r.read([[210,80]]);
    return {source,x,expectedX:10.5,pixels,sourceUnchanged:before===saveActorProject(source)};
  }finally{r.renderer.dispose();}
}
export function curves(mode,source){
  source=structuredClone(source);source.actions=[];delete source.cels;
  const target={kind:'attachment',attachmentId:source.attachments[0].id};
  source.clips=[{id:'angle',name:'Angles',duration:2,playback:'once',tracks:[{id:'angle',target,interpolation:'linear',angle:'shortest',keys:[{time:0,value:T(),curve:'cubic-bezier',bezier:[1/3,0,2/3,1],turns:1},{time:2,value:T()}]}]}];
  const c=compileActorProject(source),p=createActorPose(c),r=make(mode,c,128,128),b=r.renderer.bind(p);
  try{
    evaluateActorPose(c,'angle',.5,p);r.clear();r.draw(b,[30,0,0,-30,64,64]);
    // x(u)=u; y(.25)=3*.75*.25^2+.25^3=.15625, shortest delta0 + one turn.
    const angle=.15625*2*Math.PI,expected=[Math.cos(angle),Math.sin(angle),-Math.sin(angle),Math.cos(angle),0,0];
    const actual=Array.from(p.worldMatrices);delete source.clips[0].tracks[0].angle;delete source.clips[0].tracks[0].keys[0].turns;source.clips[0].tracks[0].keys[1].value.rotation=4*Math.PI;
    const unwrapped=compileActorProject(source),up=createActorPose(unwrapped);evaluateActorPose(unwrapped,'angle',.5,up);
    return {source,actual,expected,unwrappedRotation:up.localTRS[2],expectedUnwrapped:.15625*4*Math.PI};
  }finally{r.renderer.dispose();}
}
export function refusals(mode,source){
  const before=saveActorProject(source),c=compileActorProject(source),p=createActorPose(c),r=make(mode,c),b=r.renderer.bind(p);
  try{
    const nonfinite=guard(()=>r.draw(b,[NaN,0,0,-1,0,0]));
    p.worldMatrices[0]=Number.MAX_VALUE;const overflow=guard(()=>r.draw(b,[40,0,0,-40,0,0]));evaluateActorPose(c,null,0,p);
    p.partIndices[0]=999;const foreignPart=guard(()=>r.draw(b,[1,0,0,-1,0,0]));evaluateActorPose(c,null,0,p);
    const float32=mode==='webgl2'?guard(()=>r.draw(b,[1e44,0,0,-1e44,0,0])):null;
    let nativeFailure=null,restored=null;
    if(mode==='canvas2d'){
      const ctx=r.context;ctx.globalAlpha=.25;ctx.globalCompositeOperation='xor';ctx.setTransform(2,3,4,5,6,7);ctx.imageSmoothingEnabled=true;ctx.shadowColor='red';ctx.shadowBlur=2;ctx.filter='blur(1px)';ctx.beginPath();ctx.rect(0,0,1,1);ctx.clip();
      const snapshot=()=>({alpha:ctx.globalAlpha,composite:ctx.globalCompositeOperation,matrix:[ctx.getTransform().a,ctx.getTransform().b,ctx.getTransform().c,ctx.getTransform().d,ctx.getTransform().e,ctx.getTransform().f],smoothing:ctx.imageSmoothingEnabled,shadow:ctx.shadowColor,blur:ctx.shadowBlur,filter:ctx.filter});
      const state=JSON.stringify(snapshot()),native=ctx.drawImage;ctx.drawImage=()=>{throw new Error('injected native draw failure');};
      try{nativeFailure=guard(()=>r.draw(b,[40,0,0,-40,50,200]));}finally{ctx.drawImage=native;}restored=state===JSON.stringify(snapshot());
    }
    const unsupported=structuredClone(source);unsupported.requiredCapabilities.push('future:required/99');const capability=guard(()=>compileActorProject(unsupported));
    return {nonfinite,overflow,foreignPart,float32,nativeFailure,restored,capability,sourceUnchanged:before===saveActorProject(source)};
  }finally{r.renderer.dispose();}
}
export function constraints(mode,source){
  source=structuredClone(source);source.actions=[];source.clips=[];delete source.cels;source.requiredCapabilities.push('spacelab:rig-constraints/1');
  source.rigs=[{id:'r',name:'Arm',sockets:[],nodes:[{id:'a',name:'A',parentId:null,rest:T()},{id:'b',name:'B',parentId:'a',rest:T(1)},{id:'tip',name:'Tip',parentId:'b',rest:T(1)},{id:'target',name:'Target',parentId:null,rest:T(1,1)}],constraints:[{id:'reach',name:'Reach',solver:'spacelab:ccd-chain/1',enabled:true,settings:{effector:{kind:'node',id:'tip'},chainRootId:'a',target:{kind:'node',id:'target'},iterations:32,tolerance:.00001}},{id:'future',name:'Future',solver:'future:solver/9',enabled:true,settings:{never:'execute'}}]}];
  Object.assign(source.attachments[0],{rigId:'r',nodeId:'tip',transform:T()});
  const c=compileActorProject(source),p=createActorPose(c),r=make(mode,c,128,128),b=r.renderer.bind(p),slot=c.slots.findIndex(s=>s.kind==='attachment'),m=slot*6;
  try{
    evaluateActorPose(c,null,0,p,false);const raw=[p.worldMatrices[m+4],p.worldMatrices[m+5]];
    evaluateActorPose(c,null,0,p,true);const solved=[p.worldMatrices[m+4],p.worldMatrices[m+5]];
    r.clear();r.draw(b,[20,0,0,-20,20,100]);const ink=r.read([[40,80],[40,85],[45,80],[45,85]]);
    return {source,raw,solved,residual:p.constraintResiduals[0],unknown:c.constraints[1].status,unknownResidual:Number.isNaN(p.constraintResiduals[1]),ink};
  }finally{r.renderer.dispose();}
}
export function setupFailure(source){
  const c=compileActorProject(source),old=make('webgl2',c),canvas=document.createElement('canvas');canvas.width=canvas.height=64;
  const gl=canvas.getContext('webgl2',{alpha:true,premultipliedAlpha:true,antialias:false}),created=[],deleted=[],methods=['Texture','Program','VertexArray','Shader'],originals=[];let n=0;
  for(const name of methods)for(const kind of ['create','delete']){
    const key=kind+name,original=gl[key];originals.push([key,original]);gl[key]=function(...args){if(key==='createTexture'&&++n===2)return null;const result=original.apply(this,args);if(kind==='create'&&result)created.push(result);if(kind==='delete'&&args[0])deleted.push(args[0]);return result;};
  }
  const native=canvas.getContext.bind(canvas);canvas.getContext=()=>gl;
  try{const error=guard(()=>createActorWebGL2Renderer(c,canvas));old.renderer.clear();return {error,created:created.length,deleted:deleted.length,balanced:created.every(x=>deleted.includes(x)),oldReady:old.renderer.status};}
  finally{for(const [key,original]of originals)gl[key]=original;canvas.getContext=native;old.renderer.dispose();}
}
export async function contextLoss(source){
  const c=compileActorProject(source),p=createActorPose(c),r=make('webgl2',c),b=r.renderer.bind(p),extension=r.context.getExtension('WEBGL_lose_context');
  if(!extension){r.renderer.dispose();throw new Error('Required native context-loss test extension unavailable');}
  try{
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Native context loss event unavailable')),3000);r.canvas.addEventListener('webglcontextlost',()=>{clearTimeout(timer);resolve();},{once:true});extension.loseContext();});
    const status=r.renderer.status,draw=guard(()=>b.draw([1,0,0,-1,0,0])),clear=guard(()=>r.renderer.clear()),bind=guard(()=>r.renderer.bind(p));r.renderer.dispose();
    const backup=make('canvas2d',c);backup.draw(backup.renderer.bind(p),[40,0,0,-40,50,200]);const pixels=backup.read([[100,170]]);backup.renderer.dispose();
    return {status,draw,clear,bind,disposed:r.renderer.metrics,pixels};
  }finally{r.renderer.dispose();}
}
