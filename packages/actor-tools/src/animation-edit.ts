import type { ActorProject, ActorTrackTarget, ActorTransformKey } from '@actor-animator/types';
import { ANIMATION_COMPOSITION_CAPABILITY } from './project';

const same = (a: ActorTrackTarget, b: ActorTrackTarget) => a.kind === 'node' ? b.kind === 'node' && a.rigId === b.rigId && a.nodeId === b.nodeId : b.kind === 'attachment' && a.attachmentId === b.attachmentId;

/** Maintain the optional composition capability after an explicit source edit.
 * Does not normalize projects merely opened or saved. Empty optional arrays
 * created by these editing operations are removed for older-reader compatibility. */
export function syncAnimationCapability(source: ActorProject): void {
  if (!source.animators?.length) delete source.animators;
  for (const c of source.clips) {
    if (!c.visibilityTracks?.length) delete c.visibilityTracks;
    if (!c.drawOrderTracks?.length) delete c.drawOrderTracks;
  }
  const used = !!source.animators || source.clips.some(c => c.playback === 'ping-pong' || c.visibilityTracks || c.drawOrderTracks || c.tracks.some(t => t.angle !== undefined || t.keys.some(k => k.curve !== undefined || k.turns !== undefined || k.bezier !== undefined)));
  const present = source.requiredCapabilities.includes(ANIMATION_COMPOSITION_CAPABILITY);
  if (used && !present) source.requiredCapabilities.push(ANIMATION_COMPOSITION_CAPABILITY);
  if (!used && present) source.requiredCapabilities = source.requiredCapabilities.filter(c => c !== ANIMATION_COMPOSITION_CAPABILITY);
}

/** Upsert one complete local transform key, optionally moving an existing key.
 * Duplicate times reject rather than silently deleting a different pose. Call
 * within the editor's validated whole-project transaction. */
export function editTransformKey(source: ActorProject, clipId: string, target: ActorTrackTarget, key: ActorTransformKey,
  angle: 'unwrapped' | 'shortest' | undefined, newId: () => string, previousTime = key.time): void {
  const clip = source.clips.find(c => c.id === clipId);
  if (!clip) throw new Error('Select a clip.');
  let track = clip.tracks.find(t => same(t.target, target));
  if (!track) { track = { id: newId(), target: structuredClone(target), interpolation: 'linear', keys: [] }; clip.tracks.push(track); }
  if (key.time !== previousTime && track.keys.some(k => k.time === key.time)) throw new Error('A key already exists at the destination time.');
  track.keys = track.keys.filter(k => k.time !== previousTime);
  track.keys.push(structuredClone(key)); track.keys.sort((a, b) => a.time - b.time);
  if (angle === undefined) delete track.angle; else track.angle = angle;
  syncAnimationCapability(source);
}

/** Remove a clip only after its source references have been removed explicitly. */
export function deleteActorClip(source: ActorProject, clipId: string): void {
  const references: string[] = source.actions.filter(a => a.clipId === clipId).map(a => `action ${a.label}`);
  for (const e of source.emotes ?? []) for (const r of e.roles) if (r.clipId === clipId) references.push(`emote ${e.label}/${r.label}`);
  for (const a of source.animators ?? []) for (const l of a.layers) {
    for (const s of l.states) if (s.clipId === clipId) references.push(`state ${a.name}/${l.name}/${s.name}`);
    if (l.reference?.clipId === clipId) references.push(`reference ${a.name}/${l.name}`);
  }
  if (references.length) throw new Error(`Clip is used by ${references.join(', ')}.`);
  source.clips = source.clips.filter(c => c.id !== clipId); syncAnimationCapability(source);
}
