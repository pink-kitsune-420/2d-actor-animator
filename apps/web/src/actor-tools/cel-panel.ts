import type { ActorProject } from '@actor-animator/types';
import { deleteActorCel, editCelKey, importActorSheet, openActorSheet, setCelHold, syncAnimationCapability, syncCelCapability, type ActorSheet } from '../../../../packages/actor-tools/src';
import type { ActorDraft } from './editing';
import { newPart } from './editing';
import { decodePngFrames } from './png';
import { ActorPreview } from './preview';

/** Host-owned file generations, source history, downloads and painter selection. */
export interface CelHost {
  draft: ActorDraft; controller: AbortController;
  part(): { id: string }; selectPart(id: string): void;
  perform(f: () => void): void; changed(): void; cancelGesture(): void; message(s: string): void;
  download(blob: Blob, name: string): void;
  downloadCanvas(canvas: HTMLCanvasElement, name: string, valid: () => boolean): void;
  fileInput<T>(id: string, read: (file: File) => Promise<T>, install: (value: T) => void, replaces: boolean): void;
}
const number = (id: string, name: string, value: number) => `<label>${name}<input id="${id}" type="number" step="any" value="${value}"></label>`;
interface Prepared { canvas: HTMLCanvasElement; metadata: ActorSheet; epoch: number }

/** Shared part painter + discrete timeline. No separate artwork store or clock. */
export class CelPanel {
  private celId = ''; private attachmentId = ''; private time: number | undefined; private context = '';
  private metadata: ActorSheet | null = null; private prepared: Prepared | null = null; private disposed = false;
  constructor(readonly root: HTMLElement, readonly host: CelHost, readonly preview: ActorPreview, readonly clipId: () => string) {
    root.innerHTML = `<details><summary>Cels &amp; flipbooks</summary><h2>Cels and flipbooks</h2><p>Cels reference editable layered parts. Whole-actor flipbooks use a scene attachment with no bones. Incoming override artwork wins at weight ≥ 0.5; additive layers ignore artwork. Each cel keeps its own pivot and pixel density.</p>
      <label>Reusable cel<select id="cels"></select></label><label>Cel name<input id="cel-name" value="New cel"></label>
      <nav><button id="new-blank-cel">New blank cel in painter</button><button id="new-cel">Create cel from selected part</button><button id="duplicate-cel">Duplicate cel reference</button><button id="rename-cel">Rename cel</button><button id="delete-cel">Delete cel</button><button id="edit-cel">Open cel in painter</button><button id="copy-cel-art">Copy cel artwork for editing</button><button id="accept-cel-part">Use selected part in cel</button></nav>
      <p>Painting accepted cel artwork creates a separate part revision. Use “Use selected part in cel” to accept it explicitly. Duplication reuses layered artwork until you accept a different part.</p><output id="cel-part-status"></output>
      <label>Cel attachment<select id="cel-attachment"></select></label><label>Cel keys in selected clip<select id="cel-keys"></select></label><button id="new-cel-key">New cel key</button>
      <label>Key cel<select id="cel-key-cel"></select></label>${number('cel-key-time','Cel key time (s)',0)}${number('cel-key-hold','Cel hold (s)',.5)}
      <nav><button id="write-cel-key">Insert / revise cel key</button><button id="apply-cel-hold">Apply hold</button><button id="delete-cel-key">Delete cel key</button><button id="preview-cel">Preview selected clip</button></nav>
      <pre id="cel-timeline"></pre><p>A hold ends at the next key or clip end. Hold edits move only that next key/end; overlaps or conflicts reject without trimming other channels. Use the shared onion/step/scrub controls above.</p>
      <h3>Flattened sheet and PNG</h3><p id="sheet-warning">Flattened output is lossy: no editable layers, rig, continuous transforms, composition or constraints. It samples the selected clip at fixed frame holds. Download complete editable source separately; export never changes that source. Metadata preserves sampled timing, pivots and density.</p>
      <nav>${number('sheet-frames','Sheet frame count (1–64)',4)}${number('sheet-columns','Sheet columns',2)}${number('sheet-frame-width','Frame width (pixels)',64)}${number('sheet-frame-height','Frame height (pixels)',64)}${number('sheet-scale','Pixels per project unit',32)}${number('sheet-centre-y','Sheet view centre Y',.95)}</nav>
      <nav><button id="prepare-sheet">Prepare flattened sheet</button><button id="download-sheet">Download sheet PNG</button><button id="download-sheet-metadata">Download sheet metadata</button></nav><output id="sheet-status"></output>
      <nav><label>Open sheet metadata<input id="sheet-metadata" type="file" accept=".json"></label><label>Import sheet PNG with metadata<input id="sheet-png" type="file" accept="image/png"></label></nav><output id="sheet-import-status">Load metadata before its PNG. Sheets are bounded to 256×256; each frame has its own palette, without quantization.</output></details>`;
    const signal=host.controller.signal;
    const edit=(action:(s:ActorProject)=>void)=>{host.draft.edit(s=>{action(s);syncCelCapability(s);syncAnimationCapability(s);});host.changed();};
    const click=(id:string,fn:()=>void)=>this.el(id).addEventListener('click',()=>host.perform(()=>{host.cancelGesture();preview.pause();fn();}),{signal});
    for(const id of ['cels','cel-attachment'])this.el(id).addEventListener('change',()=>host.perform(()=>{host.cancelGesture();preview.pause();if(id==='cels')this.celId=this.value(id);else this.attachmentId=this.value(id);this.render();}),{signal});
    this.el('cel-keys').addEventListener('change',()=>host.perform(()=>{this.time=this.value('cel-keys')===''?undefined:this.num('cel-keys');this.showKey();}),{signal});
    const create=(blank:boolean)=>{
      const id=crypto.randomUUID();let partId=host.part.bind(host);let selected='';
      edit(s=>{if(blank){const p=newPart(this.value('cel-name'),16,16);s.parts.push(p);selected=p.id;}else selected=partId().id;(s.cels??=[]).push({id,name:this.value('cel-name'),partId:selected});});
      this.celId=id;this.render();host.selectPart(selected);
    };
    click('new-blank-cel',()=>create(true));click('new-cel',()=>create(false));
    click('duplicate-cel',()=>{const id=crypto.randomUUID();edit(s=>{const c=this.cel(s);s.cels!.push({...c,id,name:`${c.name} copy`});});this.celId=id;this.render();});
    click('rename-cel',()=>edit(s=>{this.cel(s).name=this.value('cel-name');}));
    click('delete-cel',()=>edit(s=>deleteActorCel(s,this.celId)));
    click('edit-cel',()=>host.selectPart(this.cel().partId));
    click('copy-cel-art',()=>{let id='';edit(s=>{const c=this.cel(s),p=structuredClone(s.parts.find(p=>p.id===c.partId)!);p.id=id=crypto.randomUUID();p.name+=' copy';p.revision=1;s.parts.push(p);});host.selectPart(id);host.message('Copied layered artwork. Paint it, then accept the selected part in the desired cel.');});
    click('accept-cel-part',()=>edit(s=>{this.cel(s).partId=host.part().id;}));
    click('new-cel-key',()=>{this.time=undefined;this.showKey();});
    click('write-cel-key',()=>{const time=this.num('cel-key-time');edit(s=>editCelKey(s,clipId(),this.attachmentId,time,this.value('cel-key-cel'),()=>crypto.randomUUID(),this.time??time));this.time=time;this.render();preview.select(clipId());preview.seek(time);});
    click('apply-cel-hold',()=>edit(s=>{if(this.time===undefined)throw new Error('Select an authored cel key.');setCelHold(s,clipId(),this.attachmentId,this.time,this.num('cel-key-hold'));}));
    click('delete-cel-key',()=>edit(s=>{if(this.time===undefined)throw new Error('Select an authored cel key.');const c=s.clips.find(c=>c.id===clipId());if(!c)return;for(const t of c.celTracks??[])if(t.target.attachmentId===this.attachmentId)t.keys=t.keys.filter(k=>k.time!==this.time);c.celTracks=c.celTracks?.filter(t=>t.keys.length);this.time=undefined;}));
    click('preview-cel',()=>{preview.select(clipId());preview.seek(this.num('cel-key-time'));});
    click('prepare-sheet',()=>this.prepare());
    click('download-sheet',()=>{const p=this.requirePrepared();host.downloadCanvas(p.canvas,'actor.flattened.png',()=>this.prepared===p&&!this.disposed&&p.epoch===host.draft.epoch);});
    click('download-sheet-metadata',()=>host.download(new Blob([JSON.stringify(this.requirePrepared().metadata,null,2)],{type:'application/json'}),'actor.sheet.json'));
    host.fileInput('sheet-metadata',async file=>{if(file.size>65536)throw new Error('Sheet metadata exceeds 64 KiB.');return openActorSheet(await file.text());},metadata=>{this.metadata=metadata;this.el('sheet-import-status').textContent=`${metadata.name}: ${metadata.frames.length} admitted frames. Select its PNG.`;},false);
    host.fileInput('sheet-png',async file=>{if(!this.metadata)throw new Error('Load sheet metadata first.');const metadata=structuredClone(this.metadata),parts=await decodePngFrames(file,metadata.width,metadata.height,metadata.frames);return{metadata,parts};},result=>{edit(s=>{importActorSheet(s,result.metadata,result.parts,()=>crypto.randomUUID());});host.message('Flattened sheet imported as ordinary layered parts, reusable cels and a zero-bone clip. Original source stays intact.');},false);
  }
  private el<T extends HTMLElement=HTMLElement>(id:string){return this.root.querySelector<T>(`#${id}`)!;}
  private value(id:string){return this.el<HTMLInputElement>(id).value;}
  private num(id:string){const t=this.value(id),n=Number(t);if(!t.trim()||!Number.isFinite(n))throw new Error('Enter a finite number.');return n;}
  private set(id:string,value:unknown){this.el<HTMLInputElement>(id).value=String(value);}
  private cel(s=this.host.draft.source){const c=s.cels?.find(c=>c.id===this.celId);if(!c)throw new Error('Create or select a cel.');return c;}
  private track(){return this.host.draft.source.clips.find(c=>c.id===this.clipId())?.celTracks?.find(t=>t.target.attachmentId===this.attachmentId);}
  private options(id:string,values:{id:string;name:string}[],selected:string){const e=this.el<HTMLSelectElement>(id);e.replaceChildren(...values.map(v=>{const o=document.createElement('option');o.value=v.id;o.textContent=v.name;return o;}));e.value=values.some(v=>v.id===selected)?selected:values[0]?.id??'';return e.value;}
  private showKey(){const keys=this.track()?.keys??[],index=keys.findIndex(k=>k.time===this.time),k=keys[index],c=this.host.draft.source.clips.find(c=>c.id===this.clipId());this.set('cel-key-time',k?.time??this.preview.clipTime());this.set('cel-key-cel',k?.celId??this.celId);this.set('cel-key-hold',k?(keys[index+1]?.time??c!.duration)-k.time:.5);}
  private clearPrepared(){if(this.prepared)this.prepared.canvas.width=this.prepared.canvas.height=0;this.prepared=null;}
  private requirePrepared(){const p=this.prepared;if(!p||p.epoch!==this.host.draft.epoch)throw new Error('Prepare the current source sheet first.');return p;}
  private prepare(){
    const source=this.host.draft.source,clip=source.clips.find(c=>c.id===this.clipId());if(!clip)throw new Error('Select a clip.');
    const count=this.num('sheet-frames'),cols=this.num('sheet-columns'),fw=this.num('sheet-frame-width'),fh=this.num('sheet-frame-height'),scale=this.num('sheet-scale'),centre=this.num('sheet-centre-y');
    if(![count,cols,fw,fh].every(Number.isInteger)||count<1||count>64||cols<1||cols>count||fw<1||fh<1||cols*fw>256||Math.ceil(count/cols)*fh>256||scale<=0)throw new Error('Sheet needs 1–64 frames fitting 256×256 with positive density.');
    const metadata:ActorSheet={format:'spacelab-actor-sheet/1',width:cols*fw,height:Math.ceil(count/cols)*fh,name:`${clip.name} flattened`,duration:clip.duration,playback:clip.playback,sourceProjectId:source.id,sourceVersion:source.version,metresPerUnit:source.units.metresPerUnit,frames:Array.from({length:count},(_,i)=>({x:i%cols*fw,y:Math.floor(i/cols)*fh,width:fw,height:fh,time:(i/count)*clip.duration,pivot:[fw/(2*scale),fh/(2*scale)-centre],unitsPerPixel:1/scale}))};
    openActorSheet(JSON.stringify(metadata));
    const canvas=document.createElement('canvas');canvas.width=metadata.width;canvas.height=metadata.height;const frame=document.createElement('canvas');frame.width=fw;frame.height=fh;
    const preview=new ActorPreview(frame,()=>{},m=>{throw new Error(m);},true);
    try{preview.sync(source);preview.zoom(scale);preview.aids(1,0,false,false,centre);preview.select(clip.id);const c=canvas.getContext('2d')!;c.imageSmoothingEnabled=false;for(const f of metadata.frames){preview.seek(f.time);c.drawImage(frame,f.x,f.y);}}
    catch(error){canvas.width=canvas.height=0;throw error;}finally{preview.dispose();}
    this.clearPrepared();this.prepared={canvas,metadata,epoch:this.host.draft.epoch};this.el('sheet-status').textContent=`Prepared ${count} flattened frames. Editable source is unchanged. PNG and metadata are separate downloads.`;this.render();
  }
  render(){
    if(this.prepared&&this.prepared.epoch!==this.host.draft.epoch){this.clearPrepared();this.el('sheet-status').textContent='Source changed; prepare a new sheet.';}
    const s=this.host.draft.source;this.celId=this.options('cels',s.cels??[],this.celId);this.attachmentId=this.options('cel-attachment',s.attachments,this.attachmentId);
    const context=this.clipId()+this.attachmentId;if(context!==this.context){this.context=context;this.time=undefined;}
    const cel=s.cels?.find(c=>c.id===this.celId),part=s.parts.find(p=>p.id===cel?.partId);if(cel)this.set('cel-name',cel.name);
    this.el('cel-part-status').textContent=part?`Accepted cel art: ${part.name} · r${part.revision} · ${part.id}`:'Create a cel from a selected part, or a blank cel in the painter.';
    const keys=this.track()?.keys??[];this.options('cel-key-cel',s.cels??[],this.value('cel-key-cel')||this.celId);
    this.options('cel-keys',[{id:'',name:'New cel key'},...keys.map(k=>({id:String(k.time),name:`${k.time}s · ${s.cels?.find(c=>c.id===k.celId)?.name}`}))],this.time===undefined?'':String(this.time));this.showKey();
    this.el('cel-timeline').textContent=keys.map(k=>`${k.time}s: ${s.cels?.find(c=>c.id===k.celId)?.name}`).join(' → ')||'No cel keys in this attachment/clip.';
    this.el<HTMLButtonElement>('download-sheet').disabled=this.el<HTMLButtonElement>('download-sheet-metadata').disabled=!this.prepared;
  }
  dispose(){this.disposed=true;this.clearPrepared();this.metadata=null;}
}
