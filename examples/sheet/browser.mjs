// Original MIT example. Deliberately no runtime/editor/exporter imports.
const el=id=>document.getElementById(id);
let metadata=null,bitmap=null,generation=0,disposed=false;
function release(){bitmap?.close();bitmap=null;el('view').getContext('2d').clearRect(0,0,512,384);el('report').textContent='';}
function fail(e){el('status').textContent=String(e.message??e);}
function admit(text){
  if(new TextEncoder().encode(text).length>65536)throw Error('Metadata exceeds 64 KiB.');
  const m=JSON.parse(text),keys=(o,ks)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===ks.length&&ks.every(k=>Object.hasOwn(o,k));
  const finite=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max,integer=(n,min,max)=>Number.isInteger(n)&&finite(n,min,max);
  if(!keys(m,['format','width','height','name','duration','playback','sourceProjectId','sourceVersion','metresPerUnit','frames'])||m.format!=='spacelab-actor-sheet/1'||!integer(m.width,1,256)||!integer(m.height,1,256)||!finite(m.duration,Number.MIN_VALUE,Infinity)||!['once','loop','ping-pong'].includes(m.playback)||!finite(m.metresPerUnit,Number.MIN_VALUE,Infinity)||!['name','sourceProjectId','sourceVersion'].every(k=>typeof m[k]==='string')||!Array.isArray(m.frames)||m.frames.length<1||m.frames.length>64)throw Error('Unsupported or invalid sheet /1 metadata.');
  let pixels=0;
  m.frames.forEach((f,i)=>{
    if(!keys(f,['x','y','width','height','time','pivot','unitsPerPixel'])||!integer(f.x,0,m.width)||!integer(f.y,0,m.height)||!integer(f.width,1,m.width)||!integer(f.height,1,m.height)||f.x+f.width>m.width||f.y+f.height>m.height||!finite(f.time,0,m.duration)||i>0&&f.time<=m.frames[i-1].time||!Array.isArray(f.pivot)||f.pivot.length!==2||!f.pivot.every(Number.isFinite)||!finite(f.unitsPerPixel,Number.MIN_VALUE,Infinity))throw Error('Invalid frame geometry, timing or pivot.');
    for(let j=0;j<i;j++){const p=m.frames[j];if(f.x<p.x+p.width&&f.x+f.width>p.x&&f.y<p.y+p.height&&f.y+f.height>p.y)throw Error('Overlapping sheet frames.');}
    pixels+=f.width*f.height;
  });
  if(pixels>65536)throw Error('Aggregate frame pixels exceed budget.');return m;
}
el('metadata').addEventListener('change',async()=>{
  const gen=++generation,file=el('metadata').files[0];metadata=null;release();if(!file)return;
  try{if(file.size>65536)throw Error('Metadata exceeds 64 KiB.');const m=admit(await file.text());if(gen!==generation||disposed)return;metadata=m;el('status').textContent=`${m.name}: ${m.frames.length} frames admitted; load matching PNG.`;}
  catch(e){if(gen===generation&&!disposed)fail(e);}
});
el('png').addEventListener('change',async()=>{
  const gen=++generation,file=el('png').files[0],m=metadata;release();if(!file)return;
  let image;
  try{
    if(!m)throw Error('Load metadata first.');if(file.size>4*1024*1024)throw Error('PNG exceeds 4 MiB.');
    const bytes=new Uint8Array(await file.slice(0,33).arrayBuffer()),v=new DataView(bytes.buffer);
    if(bytes.length<33||[137,80,78,71,13,10,26,10].some((b,i)=>bytes[i]!==b)||v.getUint32(8)!==13||v.getUint32(12)!==0x49484452||v.getUint32(16)!==m.width||v.getUint32(20)!==m.height)throw Error('PNG and metadata dimensions disagree.');
    let expired=false,timer;const decode=createImageBitmap(file,{premultiplyAlpha:'none',colorSpaceConversion:'none'}).then(b=>{if(expired){b.close();throw Error('Late decode discarded.');}return b;});
    try{image=await Promise.race([decode,new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(Error('Decode exceeded 1500 ms.'));},1500);})]);}finally{clearTimeout(timer);}
    if(gen!==generation||disposed){image.close();return;}if(image.width!==m.width||image.height!==m.height)throw Error('Decoded dimensions disagree.');
    bitmap=image;image=null;el('status').textContent='Matching dimensions loaded; retention/pairing unverified.';sample();
  }catch(e){image?.close();if(gen===generation&&!disposed)fail(e);}
});
function sample(){
  try{
    if(!metadata||!bitmap)throw Error('Load metadata and PNG first.');
    const t=Number(el('time').value),scale=Number(el('scale').value),m=metadata;
    if(!el('time').value.trim()||!el('scale').value.trim()||!Number.isFinite(t)||!Number.isFinite(scale)||scale<=0)throw Error('Finite seconds and positive view scale required.');
    let time;
    if(m.playback==='once')time=Math.min(m.duration,Math.max(0,t));
    else if(m.playback==='loop')time=((t%m.duration)+m.duration)%m.duration;
    else {const period=2*m.duration;if(!Number.isFinite(period))throw Error('Ping-pong period exceeds numeric range.');const phase=((t%period)+period)%period;time=phase<=m.duration?phase:period-phase;}
    let index=0;for(let i=1;i<m.frames.length;i++){if(m.frames[i].time>time)break;index=i;}
    const f=m.frames[index],x=256-f.pivot[0]*scale,y=192+(f.pivot[1]-f.height*f.unitsPerPixel)*scale,w=f.width*f.unitsPerPixel*scale,h=f.height*f.unitsPerPixel*scale;
    if(![x,y,w,h,x+w,y+h].every(Number.isFinite))throw Error('View geometry exceeds numeric range.');
    const c=el('view').getContext('2d');c.clearRect(0,0,512,384);c.imageSmoothingEnabled=false;c.drawImage(bitmap,f.x,f.y,f.width,f.height,x,y,w,h);
    c.strokeStyle='#ffbf65';c.beginPath();c.moveTo(250,192);c.lineTo(262,192);c.moveTo(256,186);c.lineTo(256,198);c.stroke();
    el('report').textContent=JSON.stringify({frame:index,sampleSeconds:f.time,clipSeconds:time,holdSeconds:(m.frames[index+1]?.time??m.duration)-f.time,pivot:f.pivot,unitsPerPixel:f.unitsPerPixel,metresPerUnit:m.metresPerUnit,rect:[x,y,w,h]},null,2);
  }catch(e){fail(e);}
}
el('sample').addEventListener('click',sample);
window.addEventListener('pagehide',()=>{disposed=true;generation++;release();});
