import type { ActorEmoteRole,ActorProject,ActorTransform } from '@actor-animator/types';
import { syncEmoteCapability } from '../../../../packages/actor-tools/src';
import { readProject } from './editing';
import type { CelHost } from './cel-panel';
import type { ActorPreview } from './preview';
import { EmotePreview } from './emote-preview';
const number=(id:string,label:string,value=0)=>`<label>${label}<input id="${id}" type="number" step="any" value="${value}"></label>`;
const components=['x','y','rotation','scaleX','scaleY']as const;

/** Inert emote source editor and local choreography reference. Secondary
 * projects are preview-only, never silently merged or granted player consent. */
export class EmotePanel {
  readonly preview:EmotePreview;private source:ActorProject|null=null;private secondary:ActorProject|null=null;
  private emoteId='';private roleId='';private prepared=false;private swapped=false;
  constructor(readonly root:HTMLElement,readonly host:CelHost,readonly mainPreview:ActorPreview,readonly selectedClip:()=>string){
    root.innerHTML=`<section id="emote-inspector"><h2>Emote authoring</h2><p>This is an authoring preview with no connected players. It cannot invite players, accept consent, move a world actor or emit gameplay effects. Socket circles are cosmetic markers.</p>
      <details><summary>Definition, roles &amp; socket mappings</summary><label>Namespaced emote ID<input id="emote-id" value="local:gesture"></label><label>Emote label<input id="emote-label" value="Gesture"></label>
      <nav>${number('emote-revision','Definition revision',1)}${number('emote-duration','Choreography duration (s)',2)}<label>Choreography playback<select id="emote-playback"><option value="once">Once</option><option value="loop">Loop</option></select></label>${number('emote-priority','Visual interrupt priority')}</nav>
      <button id="add-emote">Create emote</button><button id="apply-emote">Apply emote details</button><button id="delete-emote">Delete emote</button>
      <h3>Explicit role mappings</h3><p>One solo role or two buddy roles. Role IDs and semantic socket names agree across compatible projects; actual anatomy, clip and socket IDs may differ. Priority is a visual hint and never prevents cancel.</p>
      <label>Emote role<select id="emote-roles"></select></label><label>Role ID<input id="emote-role-id" value="actor"></label><label>Role label<input id="emote-role-label" value="Actor"></label><label>Role clip<select id="emote-role-clip"></select></label><label>Role rig<select id="emote-role-rig"></select></label>
      <nav>${number('emote-role-start','Role clip start (s)')}${number('emote-role-rate','Role clip rate',1)}${components.map((c,i)=>number(`emote-role-${c}`,c==='x'||c==='y'?`Preview ${c.toUpperCase()} (metres)`:c==='rotation'?'Preview rotation (radians)':`Preview ${c}`,i<3?0:1)).join('')}</nav>
      <button id="add-emote-role">Add role</button><button id="apply-emote-role">Apply role</button><button id="delete-emote-role">Delete role</button>
      <label>Semantic socket binding<select id="emote-bindings"></select></label><label>Binding name<input id="emote-binding-name" value="contact"></label><label>Mapped socket<select id="emote-binding-socket"></select></label><button id="write-emote-binding">Add / update binding</button><button id="delete-emote-binding">Remove binding</button><button id="clear-emote-bindings">Clear role bindings</button><pre id="emote-mapping"></pre>
      </details></section><section id="emote-view" aria-label="Emote preview workspace"><h2>Emote preview</h2><label>Authored emote<select id="emotes"></select></label><p id="emote-help">Select an emote, then play or seek. Swap source roles to inspect each actor. Preview placement is cosmetic.</p><details><summary>Second actor &amp; compatibility</summary><label>Optional second actor source<input id="emote-secondary" type="file" accept=".json,.actorproject"></label><button id="clear-emote-secondary">Use primary source for both roles</button><output id="emote-secondary-state">Two independent instances of the primary source.</output></details>
      <nav><button id="configure-emote">Show choreography</button><button id="play-emote">Play choreography</button><button id="pause-emote">Pause choreography</button><button id="cancel-emote">Cancel choreography</button><button id="reset-emote">Reset choreography</button><button id="swap-emote-roles">Swap source roles</button>${number('emote-time','Choreography seek (s)')}<button id="seek-emote">Seek choreography</button></nav>
      <label>Scrub choreography<input id="emote-scrub" type="range" min="0" max="2" step="0.001" value="0"></label><output id="emote-status">No authored emote selected.</output><div class="preview-viewport"><canvas id="emote-preview" width="800" height="400" aria-label="Shared-clock choreography preview"></canvas></div></section>`;
    this.preview=new EmotePreview(this.el<HTMLCanvasElement>('emote-preview'),(text,time)=>{this.el('emote-status').textContent=text;this.set('emote-scrub',time);},m=>host.message(m));
    const signal=host.controller.signal;
    const edit=(f:(s:ActorProject)=>void)=>{host.draft.edit(s=>{f(s);syncEmoteCapability(s);});host.changed();};
    const click=(id:string,f:()=>void)=>this.el(id).addEventListener('click',()=>host.perform(()=>{host.cancelGesture();mainPreview.pause();this.preview.pause();f();}),{signal});
    this.el('emotes').addEventListener('change',()=>host.perform(()=>{this.emoteId=this.value('emotes');this.invalidate();this.render();}),{signal});
    this.el('emote-roles').addEventListener('change',()=>{this.roleId=this.value('emote-roles');this.render();},{signal});
    this.el('emote-role-rig').addEventListener('change',()=>this.socketOptions(),{signal});
    this.el('emote-bindings').addEventListener('change',()=>{const r=this.role();this.set('emote-binding-name',this.value('emote-bindings'));this.set('emote-binding-socket',r.socketBindings[this.value('emote-bindings')]??'');},{signal});
    const details=()=>({id:this.value('emote-id'),label:this.value('emote-label'),revision:this.num('emote-revision'),duration:this.num('emote-duration'),playback:this.value('emote-playback')as'once'|'loop',interruptPriority:this.num('emote-priority')});
    click('add-emote',()=>{const id=this.value('emote-id');edit(s=>{const clipId=selectedClip()||s.clips[0]?.id;if(!clipId)throw new Error('Create a clip first.');(s.emotes??=[]).push({...details(),roles:[{id:'actor',label:'Actor',clipId,rigId:null,socketBindings:{},start:0,rate:1,placement:{x:0,y:0,rotation:0,scaleX:1,scaleY:1}}]});});this.emoteId=id;this.roleId='actor';this.render();});
    click('apply-emote',()=>{const id=this.value('emote-id');edit(s=>Object.assign(this.emote(s),details()));this.emoteId=id;this.render();});
    click('delete-emote',()=>edit(s=>{s.emotes=s.emotes?.filter(e=>e.id!==this.emoteId);}));
    click('add-emote-role',()=>{const id=this.value('emote-role-id');edit(s=>{const e=this.emote(s);if(e.roles.length>=2)throw new Error('This definition already has two roles.');e.roles.push(this.readRole({}));});this.roleId=id;this.render();});
    click('apply-emote-role',()=>{const id=this.value('emote-role-id');edit(s=>{const role=this.role(s),nextRig=this.value('emote-role-rig')||null;if(nextRig!==role.rigId&&Object.keys(role.socketBindings).length)throw new Error('Remove role socket bindings explicitly before changing its rig.');Object.assign(role,this.readRole(role.socketBindings));});this.roleId=id;this.render();});
    click('delete-emote-role',()=>edit(s=>{const e=this.emote(s);if(e.roles.length===1)throw new Error('Keep one role or delete the whole emote.');e.roles=e.roles.filter(r=>r.id!==this.roleId);}));
    click('write-emote-binding',()=>edit(s=>{const r=this.role(s);if(r.rigId===null||r.rigId!==this.value('emote-role-rig'))throw new Error('Apply a role rig before binding a socket.');r.socketBindings={...r.socketBindings,[this.value('emote-binding-name')]:this.value('emote-binding-socket')};}));
    click('delete-emote-binding',()=>edit(s=>{delete this.role(s).socketBindings[this.value('emote-bindings')];}));
    click('clear-emote-bindings',()=>edit(s=>{this.role(s).socketBindings={};}));
    click('configure-emote',()=>{this.invalidate();this.ensure();});click('play-emote',()=>{this.ensure();this.preview.play();});click('pause-emote',()=>this.preview.pause());click('cancel-emote',()=>this.invalidate());click('reset-emote',()=>{this.invalidate();this.ensure();});
    click('swap-emote-roles',()=>{this.swapped=!this.swapped;this.invalidate();this.ensure();});click('seek-emote',()=>{this.ensure();this.preview.seek(this.num('emote-time'));});
    this.el('emote-scrub').addEventListener('input',()=>host.perform(()=>{const time=this.num('emote-scrub');mainPreview.pause();this.ensure();this.preview.seek(time);}),{signal});
    click('clear-emote-secondary',()=>{this.secondary=null;this.invalidate();this.el('emote-secondary-state').textContent='Two independent instances of the primary source.';});
    host.fileInput('emote-secondary',async file=>{if(file.size>4*1024*1024)throw new Error('Secondary source exceeds 4 MiB.');return readProject(await file.text());},source=>{this.secondary=source;this.invalidate();this.el('emote-secondary-state').textContent=`Second source: ${source.name} · revision ${source.version}. Preview reference only; primary source unchanged.`;},false);
  }
  private el<T extends HTMLElement=HTMLElement>(id:string){return this.root.querySelector<T>(`#${id}`)!;}private value(id:string){return this.el<HTMLInputElement>(id).value;}private set(id:string,value:unknown){this.el<HTMLInputElement>(id).value=String(value);}private num(id:string){const t=this.value(id),n=Number(t);if(!t.trim()||!Number.isFinite(n))throw new Error('Enter a finite number.');return n;}
  private emote(s=this.host.draft.source){const e=s.emotes?.find(e=>e.id===this.emoteId);if(!e)throw new Error('No authored emote selected.');return e;}
  private role(s=this.host.draft.source){const r=this.emote(s).roles.find(r=>r.id===this.roleId);if(!r)throw new Error('Select a role.');return r;}
  private readRole(bindings:Record<string,string>):ActorEmoteRole{return{id:this.value('emote-role-id'),label:this.value('emote-role-label'),clipId:this.value('emote-role-clip'),rigId:this.value('emote-role-rig')||null,socketBindings:{...bindings},start:this.num('emote-role-start'),rate:this.num('emote-role-rate'),placement:Object.fromEntries(components.map(c=>[c,this.num(`emote-role-${c}`)]))as unknown as ActorTransform};}
  private options(id:string,values:{id:string;label:string}[],selected:string){const e=this.el<HTMLSelectElement>(id);e.replaceChildren(...values.map(v=>{const o=document.createElement('option');o.value=v.id;o.textContent=v.label;return o;}));e.value=values.some(v=>v.id===selected)?selected:values[0]?.id??'';return e.value;}
  private socketOptions(){const r=this.host.draft.source.rigs.find(r=>r.id===this.value('emote-role-rig'));this.options('emote-binding-socket',(r?.sockets??[]).map(s=>({id:s.id,label:s.name})),this.value('emote-binding-socket'));}
  private ensure(){if(this.prepared)return;try{this.preview.configure(this.host.draft.source,this.secondary,this.emoteId,this.swapped);this.prepared=true;}catch(error){this.el('emote-status').textContent=String(error);throw error;}}
  private invalidate(){this.prepared=false;this.preview.cancel();}
  render(){
    const s=this.host.draft.source;if(s!==this.source){this.invalidate();this.source=s;}
    this.el('emote-help').textContent=(s.emotes?.length??0)?'Select an emote, then play or seek. Swap source roles to inspect each actor. Preview placement is cosmetic.':'No emotes yet. Create a clip in Animate, then open Definition, roles & socket mappings to create your first emote.';
    this.emoteId=this.options('emotes',(s.emotes??[]).map(e=>({id:e.id,label:e.label})),this.emoteId);const e=s.emotes?.find(e=>e.id===this.emoteId);
    if(e){this.set('emote-id',e.id);this.set('emote-label',e.label);this.set('emote-revision',e.revision);this.set('emote-duration',e.duration);this.set('emote-playback',e.playback);this.set('emote-priority',e.interruptPriority);this.el<HTMLInputElement>('emote-scrub').max=String(e.duration);}
    this.roleId=this.options('emote-roles',(e?.roles??[]).map(r=>({id:r.id,label:r.label})),this.roleId);const r=e?.roles.find(r=>r.id===this.roleId);
    this.options('emote-role-clip',s.clips.map(c=>({id:c.id,label:c.name})),r?.clipId??this.selectedClip());this.options('emote-role-rig',[{id:'',label:'No rig / no socket contract'},...s.rigs.map(r=>({id:r.id,label:r.name}))],r?.rigId??'');
    if(r){this.set('emote-role-id',r.id);this.set('emote-role-label',r.label);this.set('emote-role-start',r.start);this.set('emote-role-rate',r.rate);for(const c of components)this.set(`emote-role-${c}`,r.placement[c]);}
    this.options('emote-bindings',Object.keys(r?.socketBindings??{}).map(id=>({id,label:id})),this.value('emote-bindings'));this.socketOptions();
    this.el('emote-mapping').textContent=r?`${r.label} → ${s.clips.find(c=>c.id===r.clipId)?.name}\n${Object.entries(r.socketBindings).map(([name,id])=>`${name} → ${id}`).join('\n')||'No semantic socket requirements.'}`:'No authored roles.';
    for(const id of ['configure-emote','play-emote','seek-emote','reset-emote'])this.el<HTMLButtonElement>(id).disabled=!e;this.el<HTMLButtonElement>('swap-emote-roles').disabled=e?.roles.length!==2;
  }
  pause(){this.preview.pause();}dispose(){this.preview.dispose();this.secondary=null;this.source=null;}
}
