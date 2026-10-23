import type { ActorPart, ActorProject } from '@actor-animator/types';
import { CEL_TRACKS_CAPABILITY } from './project';
import { syncAnimationCapability } from './animation-edit';

/** Maintain the optional cel capability only after explicit editing. */
export function syncCelCapability(source: ActorProject): void {
  if (!source.cels?.length) delete source.cels;
  for (const c of source.clips) if (!c.celTracks?.length) delete c.celTracks;
  const used = !!source.cels || source.clips.some(c => c.celTracks?.length);
  if (used && !source.requiredCapabilities.includes(CEL_TRACKS_CAPABILITY)) source.requiredCapabilities.push(CEL_TRACKS_CAPABILITY);
  if (!used) source.requiredCapabilities = source.requiredCapabilities.filter(c => c !== CEL_TRACKS_CAPABILITY);
}

/** Upsert a discrete cel key in a whole-project transaction. Moving onto an
 * existing key rejects; other channels and their absolute times are untouched. */
export function editCelKey(source: ActorProject, clipId: string, attachmentId: string, time: number, celId: string, newId: () => string, previousTime = time): void {
  const c = source.clips.find(c => c.id === clipId); if (!c) throw new Error('Select a clip.');
  let t = c.celTracks?.find(t => t.target.attachmentId === attachmentId);
  if (!t) { t = { id: newId(), target: { kind: 'attachment', attachmentId }, keys: [] }; (c.celTracks ??= []).push(t); }
  if (time !== previousTime && t.keys.some(k => k.time === time)) throw new Error('A cel key already exists at that time.');
  t.keys = t.keys.filter(k => k.time !== previousTime); t.keys.push({ time, celId }); t.keys.sort((a, b) => a.time - b.time); syncCelCapability(source);
}

/** Hold edits move only the next cel key or the clip endpoint. Validation of
 * the enclosing transaction rejects overlaps and conflicts with other keys. */
export function setCelHold(source: ActorProject, clipId: string, attachmentId: string, time: number, hold: number): void {
  if (!Number.isFinite(hold) || hold <= 0) throw new Error('Hold must be positive finite seconds.');
  const c = source.clips.find(c => c.id === clipId), t = c?.celTracks?.find(t => t.target.attachmentId === attachmentId);
  const index = t?.keys.findIndex(k => k.time === time) ?? -1;
  if (!c || !t || index < 0) throw new Error('Select an authored cel key.');
  const next = time + hold;
  if (!Number.isFinite(next) || next <= time) throw new Error('Hold is outside representable clip time.');
  if (index + 1 === t.keys.length) c.duration = next;
  else {
    if (next > c.duration || index + 2 < t.keys.length && next >= t.keys[index + 2]!.time) throw new Error('Hold overlaps a later key or clip end; move that key explicitly first.');
    t.keys[index + 1]!.time = next;
  }
}

/** References must be removed explicitly before deleting a reusable cel. */
export function deleteActorCel(source: ActorProject, id: string): void {
  const refs = source.clips.filter(c => c.celTracks?.some(t => t.keys.some(k => k.celId === id))).map(c => c.name);
  if (refs.length) throw new Error(`Cel is used by clips: ${refs.join(', ')}.`);
  source.cels = source.cels?.filter(c => c.id !== id); syncCelCapability(source);
}

/** Flattened sheet metadata only: does not encode layered source, rigs,
 * continuous transforms, composition, constraints or gameplay. */
export interface ActorSheet {
  format: 'spacelab-actor-sheet/1';
  width: number; height: number; name: string; duration: number;
  playback: 'once' | 'loop' | 'ping-pong';
  sourceProjectId: string; sourceVersion: string;
  /** Source project calibration; importer converts visual units to its project. */
  metresPerUnit: number;
  frames: { x: number; y: number; width: number; height: number; time: number; pivot: [number, number]; unitsPerPixel: number }[];
}

/** Bounded, inert metadata admission before native PNG decoding. No URLs or
 * executable fields. Rectangles must be disjoint; aggregate pixels <=65536. */
export function openActorSheet(text: string): ActorSheet {
  if (text.length > 65536 || new TextEncoder().encode(text).length > 65536) throw new Error('Sheet metadata exceeds 64 KiB.');
  let value: unknown; try { value = JSON.parse(text); } catch { throw new Error('Invalid sheet JSON.'); }
  const record = (v: unknown, keys: string[]) => {
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) throw new Error('Unexpected sheet metadata fields.');
    return v as Record<string, unknown>;
  };
  const n = (v: unknown, min: number, max: number, integral = false) => { if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || integral && !Number.isInteger(v)) throw new Error('Invalid sheet number, dimensions or timing.'); return v; };
  const s = record(value, ['format','width','height','name','duration','playback','sourceProjectId','sourceVersion','metresPerUnit','frames']);
  if (s.format !== 'spacelab-actor-sheet/1' || !['once','loop','ping-pong'].includes(String(s.playback))) throw new Error('Unsupported sheet format/playback.');
  n(s.metresPerUnit,Number.MIN_VALUE,Number.MAX_VALUE);
  const width = n(s.width,1,256,true), height = n(s.height,1,256,true), duration = n(s.duration,Number.MIN_VALUE,Number.MAX_VALUE);
  if (s.playback === 'ping-pong' && !Number.isFinite(duration * 2)) throw new Error('Sheet period overflows.');
  for (const key of ['name','sourceProjectId','sourceVersion']) if (typeof s[key] !== 'string' || !(s[key] as string).length || (s[key] as string).length > 1024) throw new Error('Invalid sheet label.');
  if (!Array.isArray(s.frames) || !s.frames.length || s.frames.length > 64) throw new Error('Sheet needs 1–64 frames.');
  let previous = -1, pixels = 0;
  const rectangles: {x:number;y:number;width:number;height:number}[] = [];
  for (const raw of s.frames) {
    const f = record(raw,['x','y','width','height','time','pivot','unitsPerPixel']);
    const x=n(f.x,0,width-1,true),y=n(f.y,0,height-1,true),w=n(f.width,1,width,true),h=n(f.height,1,height,true),t=n(f.time,0,duration);
    if (x+w>width || y+h>height || t<=previous) throw new Error('Sheet rectangles/times are out of bounds or not ordered.'); previous=t;
    if (rectangles.some(r=>x<r.x+r.width && x+w>r.x && y<r.y+r.height && y+h>r.y)) throw new Error('Sheet frames overlap.'); rectangles.push({x,y,width:w,height:h});
    pixels+=w*h; if(pixels>65536) throw new Error('Aggregate sheet pixels exceed budget.');
    if(!Array.isArray(f.pivot)||f.pivot.length!==2) throw new Error('Sheet pivot needs two coordinates.');
    f.pivot.forEach(v=>n(v,-Number.MAX_VALUE,Number.MAX_VALUE)); const scale=n(f.unitsPerPixel,Number.MIN_VALUE,Number.MAX_VALUE);
    if(!Number.isFinite(w*scale)||!Number.isFinite(h*scale))throw new Error('Sheet raster scale overflows.');
  }
  return value as ActorSheet;
}

/** Install validated flattened frames as ordinary layered parts/cels and a
 * zero-bone attachment/clip; the existing project stays otherwise intact. */
export function importActorSheet(source: ActorProject, metadata: ActorSheet, parts: ActorPart[], newId: () => string): string {
  const checked = openActorSheet(JSON.stringify(metadata));
  if (parts.length !== checked.frames.length) throw new Error('Sheet frame count disagrees with metadata.');
  const attachmentId = newId(), clipId = newId(), celIds: string[] = [];
  parts.forEach((p,i) => {
    const f=checked.frames[i]!; if(p.artwork.width!==f.width||p.artwork.height!==f.height)throw new Error('Decoded frame dimensions disagree.');
    const ratio=checked.metresPerUnit/source.units.metresPerUnit;
    p.pivot=[f.pivot[0]*ratio,f.pivot[1]*ratio];p.unitsPerPixel=f.unitsPerPixel*ratio;source.parts.push(p);
    const id=newId();celIds.push(id);(source.cels??=[]).push({id,name:p.name,partId:p.id});
  });
  source.attachments.push({id:attachmentId,name:checked.name,partId:parts[0]!.id,drawOrder:0,transform:{x:0,y:0,rotation:0,scaleX:1,scaleY:1}});
  source.clips.push({id:clipId,name:checked.name,duration:checked.duration,playback:checked.playback,tracks:[],celTracks:[{id:newId(),target:{kind:'attachment',attachmentId},keys:checked.frames.map((f,i)=>({time:f.time,celId:celIds[i]!}))}]});
  syncCelCapability(source);syncAnimationCapability(source);return clipId;
}
