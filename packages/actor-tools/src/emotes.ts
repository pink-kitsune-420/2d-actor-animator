import type { ActorEmote, ActorEmoteRole, ActorProject } from '@actor-animator/types';
import { EMOTE_AUTHORING_CAPABILITY } from './project';

/** Explicit editing only; optional/legacy source is never rewritten on open. */
export function syncEmoteCapability(source: ActorProject): void {
  if (!source.emotes?.length) delete source.emotes;
  if (source.emotes && !source.requiredCapabilities.includes(EMOTE_AUTHORING_CAPABILITY)) source.requiredCapabilities.push(EMOTE_AUTHORING_CAPABILITY);
  if (!source.emotes) source.requiredCapabilities = source.requiredCapabilities.filter(c => c !== EMOTE_AUTHORING_CAPABILITY);
}

/** Compatibility is a presentation contract, never consent or a contact test. */
export interface ActorEmoteCompatibility { readonly ok: boolean; readonly code: string; readonly message: string }

/** Compare independent source mappings. Actual rig/clip/socket IDs may differ;
 * shared definition revision/timing/role names and semantic socket names agree.
 * Missing optional definitions remain a diagnostic, not a fabricated action. */
export function actorEmoteCompatibility(a: ActorProject, b: ActorProject, emoteId: string): ActorEmoteCompatibility {
  const x=a.emotes?.find(e=>e.id===emoteId),y=b.emotes?.find(e=>e.id===emoteId);
  if(!x||!y)return{ok:false,code:'missing-emote',message:'An actor has no matching optional emote definition.'};
  if(x.revision!==y.revision||x.duration!==y.duration||x.playback!==y.playback||x.interruptPriority!==y.interruptPriority||x.roles.length!==y.roles.length)return{ok:false,code:'definition-mismatch',message:'Emote revision, timing, interrupt or role-count contracts disagree.'};
  for(const r of x.roles){
    const other=y.roles.find(s=>s.id===r.id);if(!other)return{ok:false,code:'missing-role',message:`Missing compatible role ${r.id}.`};
    const names=Object.keys(r.socketBindings).sort(),theirs=Object.keys(other.socketBindings).sort();
    if(names.length!==theirs.length||names.some((n,i)=>n!==theirs[i]))return{ok:false,code:'socket-contract',message:`Semantic socket contracts disagree for role ${r.label}.`};
  }
  for(const [source,emote]of [[a,x],[b,y]]as const)for(const role of emote.roles){
    const rig=source.rigs.find(r=>r.id===role.rigId);
    if(role.rigId!==null&&!rig||!source.clips.some(c=>c.id===role.clipId)||Object.values(role.socketBindings).some(s=>!rig?.sockets.some(p=>p.id===s)))return{ok:false,code:'mapping-missing',message:`Unresolved rig/clip/socket mapping for ${role.label}.`};
  }
  return{ok:true,code:'compatible',message:'Compatible explicit role mappings. Choreography only; no consent or gameplay effect.'};
}

/** Writes clip seconds to into[0], shared phase to into[1]. No callbacks,
 * allocations, world state or completion events. Caller retains the buffer.
 * Negative seeks use the same explicit once/positive-modulo loop policy. */
export function sampleActorEmoteTime(emote: ActorEmote, role: ActorEmoteRole, seconds: number, into: Float64Array): void {
  if(!Number.isFinite(seconds)||into.length<2)throw new RangeError('Finite emote time and a retained two-value buffer are required.');
  let phase=seconds;
  if(emote.playback==='once')phase=Math.max(0,Math.min(emote.duration,phase));
  else{phase%=emote.duration;if(phase<0)phase+=emote.duration;if(phase>=emote.duration)phase=0;}
  const time=role.start+phase*role.rate;if(!Number.isFinite(time))throw new RangeError('Emote clip time overflows Float64.');
  into[0]=time;into[1]=phase;
}
