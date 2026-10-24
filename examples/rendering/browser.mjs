import { openActorProject, saveActorProject, compileActorProject, createActorPose, evaluateActorPose } from '@actor-animator/runtime';
import { createActorWebGL2Renderer } from '@actor-animator/runtime/webgl2';
import { createActorCanvas2DRenderer } from '@actor-animator/runtime/canvas2d';
const $ = id => document.getElementById(id);
export let current = null;
let generation = 0;
const numericBytes = pose => Object.values(pose).reduce((n,a) => n + a.byteLength,0);
export function draw() {
  if (!current) throw new Error('Resources disposed; reopen the original.');
  const c = current, scale = Number($('scale').value), clip = $('clip').value || null;
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Scale must be positive finite pixels per unit.');
  evaluateActorPose(c.compiled,clip,Number($('time-a').value),c.poses[0]);
  evaluateActorPose(c.compiled,clip,Number($('time-b').value),c.poses[1]);
  if (c.mode === 'webgl2') c.renderer.clear();
  else { c.context.setTransform(1,0,0,1,0,0); c.context.clearRect(0,0,c.canvas.width,c.canvas.height); }
  c.views[0][0] = c.views[1][0] = scale; c.views[0][3] = c.views[1][3] = -scale;
  for (let i=0;i<2;i++) {
    if (c.mode === 'webgl2') c.bindings[i].draw(c.views[i]); else c.bindings[i].draw(c.context,c.views[i]);
  }
  const snapshot = {
    backend:c.mode, sourceUnchanged:saveActorProject(c.source)===c.canonical,
    sourceCounts:{parts:c.source.parts.length,rigs:c.source.rigs.length,roots:c.source.rigs.reduce((n,r)=>n+r.nodes.filter(x=>x.parentId===null).length,0),clips:c.source.clips.length},
    calibration:c.source.units, compiledNumericBytes:c.compiled.numericBytes, poseNumericBytes:c.poses.map(numericBytes),
    independentBuffers:c.poses[0].worldMatrices!==c.poses[1].worldMatrices, metrics:c.renderer.metrics,
    matrices:c.poses.map(p=>c.compiled.drawSlots.map(s=>Array.from(p.worldMatrices.slice(s*6,s*6+6)))),
    parts:c.poses.map(p=>c.compiled.drawSlots.map(s=>c.compiled.parts[p.partIndices[s]].id)),
    visible:c.poses.map(p=>c.compiled.drawSlots.map(s=>p.visible[s])), constraints:c.compiled.constraints,
  };
  $('report').textContent=JSON.stringify(snapshot,null,2); $('status').textContent=`Prepared ${c.mode}; explicit samples drawn. Source unchanged: ${snapshot.sourceUnchanged}.`;
  return snapshot;
}
export function openText(text, mode = $('backend').value) {
  const opened = openActorProject(text); if (!opened.ok) throw new Error(opened.diagnostics[0].message);
  const source=opened.source,compiled=compileActorProject(source),poses=[createActorPose(compiled),createActorPose(compiled)];
  const canvas=document.createElement('canvas');canvas.width=900;canvas.height=360;canvas.setAttribute('aria-label','Two independent actors');
  let renderer=null;
  try {
    renderer=mode==='webgl2'?createActorWebGL2Renderer(compiled,canvas):createActorCanvas2DRenderer(compiled);
    const context=mode==='canvas2d'?canvas.getContext('2d'):null;if(mode==='canvas2d'&&!context)throw new Error('Canvas2D unavailable');
    const next={source,compiled,poses,canvas,context,renderer,mode,canonical:saveActorProject(source),bindings:poses.map(p=>renderer.bind(p)),views:[[40,0,0,-40,50,200],[40,0,0,-40,430,200]]};
    const previous=current;current=next;if(previous)previous.renderer.dispose();
    $('stage').replaceChildren(canvas);$('source').value=text;
    $('clip').replaceChildren(new Option('Rest',''),...source.clips.map(c=>new Option(c.name,c.id)));
    $('clip').value=source.clips[0]?.id??'';return draw();
  }catch(error){if(renderer&&current?.renderer!==renderer)renderer.dispose();throw error;}
}
function run(fn){try{fn();}catch(error){$('status').textContent=String(error);}}
async function example() {
  const token=++generation,name=$('example').value;
  try {
    const response=await fetch(`${name}.actorproject`);if(!response.ok)throw new Error('Example unavailable');
    const text=await response.text();if(token!==generation)return;
    $('scale').value=name==='character'?'100':name==='nonhuman'?'30':'40';run(()=>openText(text));
  }catch(error){if(token===generation)$('status').textContent=String(error);}
}
$('sample').onclick=()=>run(draw);
$('backend').onchange=()=>{generation++;run(()=>openText($('source').value));};
$('example').onchange=example;
$('apply').onclick=$('reopen').onclick=()=>{generation++;run(()=>openText($('source').value));};
$('dispose').onclick=()=>{generation++;if(current){current.renderer.dispose();$('report').textContent=JSON.stringify(current.renderer.metrics,null,2);current=null;}$('status').textContent='Resources disposed. Reopen original to prepare again.';};
addEventListener('pagehide',()=>{generation++;if(current)current.renderer.dispose();current=null;});
await example();
