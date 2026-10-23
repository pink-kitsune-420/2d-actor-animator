import type { ActorProject } from '@actor-animator/types';
import { openActorSheet, type ActorSheet } from '../../../../packages/actor-tools/src/cels';

/** Editor-local choices, not additions to the sheet /1 contract. Seconds and
 * project units are explicit; changing a recipe never changes authored keys. */
export interface SheetRecipe {
  mode: 'uniform' | 'explicit'; times: string; count: number; columns: number;
  width: number; height: number; scale: number; centreX: number; centreY: number;
}
export function sheetRecipe(source: ActorProject, clipId: string, r: SheetRecipe): ActorSheet {
  const clip = source.clips.find(c => c.id === clipId);
  if (!clip) throw new Error('Select a clip.');
  if (![r.width,r.height,r.columns].every(Number.isInteger) || r.width < 1 || r.height < 1 || r.columns < 1 || r.width > 256 || r.height > 256 || r.columns > 64)
    throw new Error('Use integral frame dimensions and columns within 256×256.');
  if (![r.scale,r.centreX,r.centreY,1/r.scale,r.centreX*r.scale,r.centreY*r.scale].every(Number.isFinite) || r.scale <= 0 || 1/r.scale <= 0)
    throw new Error('Framing and positive density must fit finite project/pixel units.');
  let times: number[];
  if (r.mode === 'uniform') {
    if (!Number.isInteger(r.count) || r.count < 1 || r.count > 64) throw new Error('Use 1–64 uniform samples.');
    times = Array.from({length:r.count}, (_,i) => i/r.count*clip.duration);
  } else {
    // Bound input before splitting; never silently sort, deduplicate or trim a schedule.
    if (r.times.length > 4096) throw new Error('Sample schedule is too long.');
    const tokens = r.times.split(',');
    if (tokens.length > 64 || tokens.some(t => !t.trim())) throw new Error('Enter 1–64 comma-separated sample seconds.');
    times = tokens.map(t => Number(t));
  }
  if (times[0] !== 0 || times.some((t,i) => !Number.isFinite(t) || t < 0 || t >= clip.duration || i > 0 && t <= times[i-1]!))
    throw new Error('Samples must start at 0, increase strictly, and end before clip duration (seconds).');
  const width = r.columns*r.width, height = Math.ceil(times.length/r.columns)*r.height;
  if (r.columns > times.length || width > 256 || height > 256 || width*height > 65536)
    throw new Error('Sheet needs 1–64 frames fitting 256×256 / 65536 pixels.');
  const pivot: [number,number] = [r.width/2/r.scale-r.centreX, r.height/2/r.scale-r.centreY];
  if (!pivot.every(Number.isFinite)) throw new Error('Frame pivot exceeds finite project units.');
  return openActorSheet(JSON.stringify({format:'spacelab-actor-sheet/1',width,height,name:`${clip.name} flattened`,duration:clip.duration,playback:clip.playback,
    sourceProjectId:source.id,sourceVersion:source.version,metresPerUnit:source.units.metresPerUnit,
    frames:times.map((time,i) => ({x:i%r.columns*r.width,y:Math.floor(i/r.columns)*r.height,width:r.width,height:r.height,time,pivot,unitsPerPixel:1/r.scale}))}));
}
