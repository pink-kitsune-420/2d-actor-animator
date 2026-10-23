import { describe, expect, it } from 'vitest';
import { ActorDraft, emptyProject, identityTransform, ink, newPart, readProject } from '../../apps/web/src/actor-tools/editing';
import { editPartRevision, setTwoKeyTrack } from '../../apps/web/src/actor-tools/assembly';
import { compileActorProject, createActorPose, evaluateActorPose, saveActorProject } from '../../packages/actor-tools/src';
import { actorFixture } from '../helpers/actor-project';

describe('assembly whole-source operations', () => {
  it('keeps accepted artwork immutable until an explicit rebind, round-trips both revisions and undoes atomically', () => {
    const source = actorFixture(), draft = new ActorDraft(source), original = structuredClone(source.parts[0]!);
    const id = editPartRevision(draft, original.id, part => { part.name = 'Unusual \u2604'; ink(part, 0, 0, 0, 1); });
    expect(id).not.toBe(original.id);
    expect(draft.source.parts.find(p => p.id === original.id)).toEqual(original);
    expect(draft.source.parts.find(p => p.id === id)?.revision).toBe(original.revision + 1);
    expect(draft.source.attachments).toEqual(source.attachments);
    expect(draft.source.rigs).toEqual(source.rigs); expect(draft.source.clips).toEqual(source.clips); expect(draft.source.extensions).toEqual(source.extensions);
    const edited = saveActorProject(draft.source); expect(saveActorProject(readProject(edited))).toBe(edited);
    draft.undo(); expect(saveActorProject(draft.source)).toBe(saveActorProject(source)); draft.redo();
    const attachment = source.attachments.find(a => a.partId === original.id)!;
    draft.edit(s => { s.attachments.find(a => a.id === attachment.id)!.partId = id; });
    expect(draft.source.attachments.find(a => a.id === attachment.id)!.partId).toBe(id);
    draft.undo(); expect(saveActorProject(draft.source)).toBe(edited);
  });
  it('does not fork or revise an unchanged attached pixel, and rolls the complete fork back on gesture cancellation', () => {
    const source = actorFixture(), draft = new ActorDraft(source), part = source.parts[0]!;
    const before = saveActorProject(source);
    expect(editPartRevision(draft, part.id, p => { p.name = part.name; })).toBe(part.id);
    expect(draft.canUndo).toBe(false); expect(draft.dirty).toBe(false);
    draft.begin(); const id = editPartRevision(draft, part.id, p => { p.pivot[1] += 1; });
    editPartRevision(draft, id, p => { p.pivot[0] += 3; }); draft.cancel();
    expect(saveActorProject(draft.source)).toBe(before); expect(draft.canUndo).toBe(false);
    expect(() => editPartRevision(draft, part.id, p => { p.unitsPerPixel = 0; })).toThrow(); expect(saveActorProject(draft.source)).toBe(before);
  });
  it('keeps unreferenced part identity while advancing its revision', () => {
    const source = emptyProject(); source.parts.push(newPart('Free', 2, 2)); const draft = new ActorDraft(source), id = source.parts[0]!.id;
    expect(editPartRevision(draft, id, p => { p.pivot[1] = 7; })).toBe(id); expect(draft.source.parts).toHaveLength(1);
    expect(draft.source.parts[0]!.revision).toBe(2);
  });
  it('renames attached parts without changing IDs, artwork revisions or references', () => {
    const source = actorFixture(), draft = new ActorDraft(source), part = source.parts[0]!;
    expect(editPartRevision(draft, part.id, p => { p.name = 'A freely renamed part'; })).toBe(part.id);
    expect(draft.source.parts[0]).toEqual({ ...part, name: 'A freely renamed part' });
    expect(draft.source.attachments).toEqual(source.attachments); expect(draft.source.parts).toHaveLength(source.parts.length);
    draft.undo(); expect(saveActorProject(draft.source)).toBe(saveActorProject(source));
  });
  it('renames and reorders arbitrary-ID nodes without moving numeric poses, and rejects parent cycles atomically', () => {
    const source = actorFixture(), draft = new ActorDraft(source), compiled = compileActorProject(source), rest = createActorPose(compiled);
    draft.edit(s => { const nodes = s.rigs[0]!.nodes; for (const n of nodes) n.name = `Free / ${n.id} \ud83e\udebc`; nodes.reverse(); });
    const after = compileActorProject(draft.source); expect(after.slots).toEqual(compiled.slots); expect(createActorPose(after).worldMatrices).toEqual(rest.worldMatrices);
    const before = saveActorProject(draft.source);
    expect(() => draft.edit(s => { const rig = s.rigs[0]!, root = rig.nodes.find(n => n.parentId === null)!; root.parentId = rig.nodes.find(n => n.parentId === root.id)!.id; })).toThrow();
    expect(saveActorProject(draft.source)).toBe(before);
  });
  it('edits only the selected two-key track and protects rich tracks, duration boundaries and inert data', () => {
    const source = actorFixture(), clip = source.clips[0]!, track = clip.tracks[0]!;
    source.extensions['foreign:opaque'] = { zero: -0, payload: ['retained', { any: true }] };
    const draft = new ActorDraft(source), keys = [{ time: 0, value: identityTransform() }, { time: clip.duration, value: { ...identityTransform(), rotation: 4 * Math.PI, scaleX: -2, scaleY: 0 } }] as const;
    draft.edit(s => setTwoKeyTrack(s, clip.id, track.target, 'step', [structuredClone(keys[0]), structuredClone(keys[1])]));
    expect(draft.source.clips[0]!.tracks[0]!.id).toBe(track.id);
    expect(draft.source.clips[0]!.tracks.slice(1)).toEqual(clip.tracks.slice(1)); expect(draft.source.actions).toEqual(source.actions);
    expect(Object.is(draft.source.extensions['foreign:opaque'] && (draft.source.extensions['foreign:opaque'] as { zero: number }).zero, -0)).toBe(true);
    draft.edit(s => { s.clips[0]!.tracks[0]!.keys.splice(1, 0, { time: clip.duration / 2, value: identityTransform() }); });
    const before = saveActorProject(draft.source);
    expect(() => draft.edit(s => setTwoKeyTrack(s, clip.id, track.target, 'linear', [structuredClone(keys[0]), structuredClone(keys[1])]))).toThrow(/more than two/);
    expect(() => draft.edit(s => { s.clips[0]!.duration = clip.duration / 2; })).toThrow(); expect(saveActorProject(draft.source)).toBe(before);
  });
  it('gives zero-node scene attachments identical two-key animation capability with explicit rest', () => {
    const draft = new ActorDraft(actorFixture('zero-bone')), attachment = draft.source.attachments[0]!, clip = draft.source.clips[0]!;
    draft.edit(s => setTwoKeyTrack(s, clip.id, { kind: 'attachment', attachmentId: attachment.id }, 'linear', [
      { time: 0, value: { ...identityTransform(), x: -2, y: 3 } },
      { time: clip.duration, value: { ...identityTransform(), x: 6, y: 7, rotation: 2 * Math.PI, scaleX: -1 } },
    ]));
    const compiled = compileActorProject(draft.source), pose = createActorPose(compiled);
    evaluateActorPose(compiled, clip.id, clip.duration / 2, pose); expect(Array.from(pose.localTRS)).toEqual([2, 5, Math.PI, 0, 1]);
    evaluateActorPose(compiled, null, 0, pose); expect(Array.from(pose.localTRS)).toEqual([0, 0, 0, 1, 1]);
  });
});
