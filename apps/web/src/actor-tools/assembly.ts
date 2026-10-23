import type { ActorPart, ActorProject, ActorTrackTarget, ActorTransform, ActorTransformKey } from '@actor-animator/types';
import { saveActorProject } from '../../../../packages/actor-tools/src/index';
import { ActorDraft } from './editing';

/** Attached artwork stays immutable. A changed working copy gets a new ID;
 * accepting it is a separate attachment edit. Fork and pixels share one undo.
 * Renaming is label metadata: it preserves the part ID and artwork revision. */
export function editPartRevision(draft: ActorDraft, id: string, change: (part: ActorPart) => void): string {
  let selected = id;
  draft.edit(source => {
    const index = source.parts.findIndex(p => p.id === id);
    if (index < 0) throw new Error('Select a part.');
    const before = saveActorProject(source), original = structuredClone(source.parts[index]!);
    const part = source.parts[index]!; change(part);
    if (before === saveActorProject(source)) return;
    const name = part.name; part.name = original.name;
    const artworkChanged = before !== saveActorProject(source); part.name = name;
    if (!artworkChanged) return;
    part.revision++;
    if (source.attachments.some(a => a.partId === id) || source.cels?.some(c => c.partId === id)) {
      part.id = crypto.randomUUID(); selected = part.id;
      source.parts[index] = original; source.parts.push(part);
    }
  });
  return selected;
}

export function sameTarget(a: ActorTrackTarget, b: ActorTrackTarget): boolean {
  return a.kind === 'attachment' ? b.kind === 'attachment' && a.attachmentId === b.attachmentId
    : b.kind === 'node' && a.rigId === b.rigId && a.nodeId === b.nodeId;
}

/** The small editor never truncates a richer imported track. Other targets,
 * actions and inert extensions are untouched; validation is atomic in ActorDraft. */
export function setTwoKeyTrack(source: ActorProject, clipId: string, target: ActorTrackTarget,
  interpolation: 'step' | 'linear', keys: [ActorTransformKey, ActorTransformKey]) {
  const clip = source.clips.find(c => c.id === clipId);
  if (!clip) throw new Error('Create or select a clip.');
  const existing = clip.tracks.find(t => sameTarget(t.target, target));
  if (existing && (existing.keys.length > 2 || existing.angle !== undefined || existing.keys.some(k => k.curve !== undefined || k.turns !== undefined))) throw new Error(`${existing.keys.length > 2 ? 'This track has more than two keys.' : 'This track uses timeline features.'} Preview is supported; edit it in the timeline. Source is preserved.`);
  if (existing) { existing.interpolation = interpolation; existing.keys = structuredClone(keys); }
  else clip.tracks.push({ id: crypto.randomUUID(), target: structuredClone(target), interpolation, keys: structuredClone(keys) });
}

export function restForTarget(source: ActorProject, target: ActorTrackTarget): ActorTransform {
  const value = target.kind === 'attachment' ? source.attachments.find(a => a.id === target.attachmentId)?.transform
    : source.rigs.find(r => r.id === target.rigId)?.nodes.find(n => n.id === target.nodeId)?.rest;
  if (!value) throw new Error('Select an animation target.');
  return value;
}
