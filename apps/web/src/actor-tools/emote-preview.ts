import type { ActorEmote,ActorEmoteRole,ActorProject } from '@actor-animator/types';
import { actorEmoteCompatibility,sampleActorEmoteTime } from '../../../../packages/actor-tools/src';
import { ActorPreview } from './preview';

interface Instance { preview:ActorPreview; emote:ActorEmote; role:ActorEmoteRole; time:Float64Array; sockets:Int32Array; points:Float64Array }

/** Two independent source/pose instances, one presentation clock. No player,
 * session, consent, world transform or event dispatch exists in this preview. */
export class EmotePreview {
  private instances:Instance[]=[];private definition:ActorEmote|null=null;private frame:number|null=null;private generation=0;private disposed=false;
  private time=0;private started=0;private origin=0;
  readonly context:CanvasRenderingContext2D;
  constructor(readonly canvas:HTMLCanvasElement,readonly status:(text:string,time:number,playing:boolean)=>void,readonly error:(text:string)=>void){this.context=canvas.getContext('2d')!;}
  configure(primary:ActorProject,secondary:ActorProject|null,id:string,swap:boolean){
    this.cancel();const e=primary.emotes?.find(e=>e.id===id);if(!e)throw new Error('Missing optional emote definition.');
    const other=secondary??primary;
    if(e.roles.length===2){const result=actorEmoteCompatibility(primary,other,id);if(!result.ok)throw new Error(`${result.code}: ${result.message}`);}
    const created:Instance[]=[];
    try{
      for(let i=0;i<e.roles.length;i++){
        const source=i===0?primary:other,definition=source.emotes!.find(x=>x.id===id)!,roleId=e.roles[e.roles.length===2&&swap?1-i:i]!.id,role=definition.roles.find(r=>r.id===roleId)!;
        const canvas=document.createElement('canvas');canvas.width=this.canvas.width;canvas.height=this.canvas.height;canvas.id=`emote-instance-${i}`;canvas.dataset.role=role.id;canvas.dataset.source=source.id;
        const preview=new ActorPreview(canvas,()=>{},m=>{throw new Error(m);},true);
        // Register ownership before setup, so even partial setup failures dispose.
        const sockets=new Int32Array(Object.keys(role.socketBindings).length),instance:Instance={preview,emote:definition,role,time:new Float64Array(2),sockets,points:new Float64Array(sockets.length*2)};created.push(instance);
        preview.sync(source);preview.zoom(96);preview.aids(1,0,false,false,.8);preview.setPlacement({...role.placement,scaleX:role.placement.scaleX*source.units.metresPerUnit,scaleY:role.placement.scaleY*source.units.metresPerUnit});preview.select(role.clipId);
        let index=0;for(const socket of Object.values(role.socketBindings)){const slot=preview.socketSlot(role.rigId!,socket);if(slot<0)throw new Error('Missing mapped cosmetic socket.');sockets[index++]=slot;}
      }
    }catch(error){for(const i of created)i.preview.dispose();throw error;}
    this.instances=created;this.canvas.dataset.roles=created.map(i=>i.role.id).join(',');this.definition=e;this.time=0;this.draw(false);
  }
  seek(time:number){if(!Number.isFinite(time))throw new Error('Emote seek must be finite.');this.pause();this.time=time;this.draw(false);}
  play(){
    if(this.disposed||!this.definition)throw new Error('Configure a compatible choreography first.');
    this.pause();if(this.definition.playback==='once'&&this.time>=this.definition.duration)this.time=0;
    this.started=performance.now();this.origin=this.time;const generation=this.generation;
    const tick=(now:number)=>{
      if(this.disposed||generation!==this.generation)return;this.frame=null;
      this.time=this.origin+Math.max(0,now-this.started)/1000;
      const end=this.definition!.playback==='once'&&this.time>=this.definition!.duration;if(end)this.time=this.definition!.duration;
      try{this.draw(!end);}catch(error){this.pause();this.error(String(error));return;}
      if(!end&&generation===this.generation&&!this.disposed)this.frame=requestAnimationFrame(tick);
    };this.frame=requestAnimationFrame(tick);
  }
  pause(){this.generation++;if(this.frame!==null)cancelAnimationFrame(this.frame);this.frame=null;if(this.definition)this.status(`Paused choreography · ${this.time.toFixed(3)} s`,this.time,false);}
  cancel(){this.pause();for(const i of this.instances)i.preview.dispose();this.instances=[];this.definition=null;this.time=0;if(!this.disposed){this.context.setTransform(1,0,0,1,0,0);this.context.clearRect(0,0,this.canvas.width,this.canvas.height);this.status('Choreography cancelled · no consent or gameplay effect',0,false);}}
  private draw(playing:boolean){
    if(this.disposed||!this.definition)return;
    // Finish both independent samples before compositing either into the stage.
    for(let i=0;i<this.instances.length;i++){const p=this.instances[i]!;sampleActorEmoteTime(p.emote,p.role,this.time,p.time);p.preview.seek(p.time[0]!);for(let s=0;s<p.sockets.length;s++)p.preview.worldPoint(p.sockets[s]!,p.points,s*2);}
    const c=this.context,w=this.canvas.width,h=this.canvas.height;c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,w,h);c.fillStyle='#0b131b';c.fillRect(0,0,w,h);c.strokeStyle='#344656';c.beginPath();c.moveTo(0,h/2+.8*96);c.lineTo(w,h/2+.8*96);c.stroke();
    let text=`${playing?'Playing':'Paused'} choreography · ${this.time.toFixed(3)} s`;
    for(let i=0;i<this.instances.length;i++){const p=this.instances[i]!;c.drawImage(p.preview.canvas,0,0);text+=` · ${p.role.label}: clip ${p.time[0]!.toFixed(3)} s`;}
    for(let i=0;i<this.instances.length;i++){const p=this.instances[i]!;c.strokeStyle=i?'#75c7e6':'#ffbe55';c.lineWidth=1;for(let s=0;s<p.sockets.length;s++){c.beginPath();c.arc(w/2+p.points[s*2]!*96,h/2+(.8-p.points[s*2+1]!)*96,3,0,2*Math.PI);c.stroke();}}
    this.canvas.dataset.time=String(this.time);this.status(text,this.time,playing);
  }
  dispose(){if(this.disposed)return;this.cancel();this.disposed=true;this.canvas.width=this.canvas.height=0;}
}
