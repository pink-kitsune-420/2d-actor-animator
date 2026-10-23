import { describe, expect, it } from 'vitest';
import { ActorDraft, emptyProject, identityTransform } from '../../apps/web/src/actor-tools/editing';
import { copyKeys, deleteKeys, dragOffset, moveKeys, pasteKeys, rangeKeys, rowsFor, sheetPoint, TimelineMove, type KeyRef } from '../../apps/web/src/actor-tools/timeline-model';
import { compileActorProject, createActorPose, evaluateActorPose, saveActorProject, syncAnimationCapability, syncCelCapability, deleteActorClip } from '../../packages/actor-tools/src';

function specimen() {
  const s = emptyProject(); s.id = 'local:timeline'; s.extensions['foreign:timeline'] = { arbitrary: [true, -0, { keep: 'opaque' }] };
  s.parts.push({ id: 'p', name: 'Lantern', revision: 8, pivot: [.25,.5], unitsPerPixel: .125, artwork: { kind: 'indexed-raster', width: 1, height: 1, palette: ['#ffffffff'], layers: [{ id: 'l', name: 'Ink', opacity: 1, pixels: [0] }] } });
  s.rigs.push({ id: 'r', name: 'Crawler', sockets: [], nodes: [{ id: 'n', name: 'Antenna', parentId: null, rest: identityTransform() }, { id: 'root2', name: 'Free root', parentId: null, rest: identityTransform() }] });
  s.rigs.push({ id: 'other', name: 'Second rig', sockets: [], nodes: [{ id: 'n', name: 'Same scoped ID', parentId: null, rest: identityTransform() }] });
  s.attachments.push({ id: 'a', name: 'Scene lantern', partId: 'p', drawOrder: 0, transform: identityTransform() });
  s.cels = [{ id: 'cel', name: 'Glow', partId: 'p' }];
  s.clips.push({ id: 'c', name: 'Signal', duration: 2, playback: 'once', tracks: [
    { id: 't', target: { kind: 'node', rigId: 'r', nodeId: 'n' }, interpolation: 'linear', angle: 'shortest', keys: [
      { time: .125, value: { ...identityTransform(), x: 1, scaleX: -0 }, curve: 'cubic-bezier', bezier: [.2,-.5,.8,1.5], turns: 2 },
      { time: .375, value: { ...identityTransform(), x: 3 } }, { time: 1.75, value: { ...identityTransform(), x: 7 } },
    ] },
    { id: 'simple', target: { kind: 'node', rigId: 'other', nodeId: 'n' }, interpolation: 'linear', keys: [{ time: .25, value: identityTransform() }, { time: 1.25, value: { ...identityTransform(), x: 4 } }] },
  ], visibilityTracks: [{ id: 'v', target: { kind: 'attachment', attachmentId: 'a' }, keys: [{ time: .125, visible: true }, { time: 1, visible: false }] }],
  drawOrderTracks: [{ id: 'o', target: { kind: 'attachment', attachmentId: 'a' }, keys: [{ time: .375, drawOrder: 3 }] }],
  celTracks: [{ id: 'celtrack', target: { kind: 'attachment', attachmentId: 'a' }, keys: [{ time: .125, celId: 'cel' }, { time: 1, celId: 'cel' }] }] });
  s.clips.push({ id: 'dest', name: 'Another clip', duration: 3, playback: 'ping-pong', tracks: [] });
  syncAnimationCapability(s); syncCelCapability(s); return s;
}
const refs: KeyRef[] = [{ channel: 'tracks', trackId: 't', time: .125 }, { channel: 'tracks', trackId: 't', time: .375 }, { channel: 'visibilityTracks', trackId: 'v', time: .125 }, { channel: 'drawOrderTracks', trackId: 'o', time: .375 }, { channel: 'celTracks', trackId: 'celtrack', time: .125 }];
const text = (d: ActorDraft) => saveActorProject(d.source);

describe('visual timeline independent source/coordinate oracles', () => {
  it('maps fractional seconds and row endpoints with native scroll and CSS scaling, independently', () => {
    const g = { left: 10, top: 20, scaleX: .5, scaleY: 2, scrollLeft: 80, scrollTop: 64, label: 184, ruler: 32, row: 32, zoom: 160 };
    // client110 -> layout200+scroll80-label184 =96 -> .6s.
    expect(sheetPoint(g, 110, 84)).toEqual({ time: .6, row: 2 });
    expect(sheetPoint(g, 62, 20)).toEqual({ time: 0, row: 1 });
    expect(sheetPoint(g, 72, 19.999).row).toBe(0);
    expect(sheetPoint({ ...g, zoom: 320 }, 110, 84).time).toBe(.3);
  });
  it('never snaps selection clicks and preserves exact unsnapped deltas', () => {
    expect(dragOffset(.125,0,.1)).toBe(0); expect(dragOffset(.26,0,.1)).toBe(0);
    expect(dragOffset(.125,.075,.1)).toBeCloseTo(.075,15); expect(dragOffset(.26,.125,0)).toBe(.125);
    expect(()=>dragOffset(.26,.1,-.1)).toThrow(/Snap/); expect(()=>dragOffset(.26,.1,Infinity)).toThrow(/finite/);
  });
  it('retains rig-scoped nodes, multiple roots and empty/discrete/zero-bone rows without source edits', () => {
    const s = specimen(), before = saveActorProject(s), rows = rowsFor(s, s.clips[0]);
    expect(rows).toHaveLength(10); expect(rows[0]!.label).toBe('Crawler / Antenna'); expect(rows[4]!.target).toEqual({ kind: 'node', rigId: 'other', nodeId: 'n' });
    expect(new Set(rows.map(r => r.id)).size).toBe(10); expect(rows[2]!.track).toBeUndefined(); expect(saveActorProject(s)).toBe(before);
    s.rigs = []; s.clips[0]!.tracks = []; expect(rowsFor(s, s.clips[0])).toHaveLength(4);
    expect(rowsFor(emptyProject())).toEqual([]);
  });
  it('inclusive range selection is fractional, reversible and bounded by rows, not overlapping screen pixels', () => {
    const s = specimen(), rows = rowsFor(s, s.clips[0]);
    expect(rangeKeys(rows, .375, .125, 0, 0)).toEqual(refs.slice(0,2));
    expect(rangeKeys(rows, .125, .125, 0, 9)).toHaveLength(3);
    expect(rangeKeys(rows, .12500001, .37499999, 0, 0)).toEqual([]);
  });
  it('moves groups through their own old positions, preserving exact full records and unrelated source', () => {
    const d = new ActorDraft(specimen()), before = text(d), expected = structuredClone(d.source);
    expected.clips[0]!.tracks[0]!.keys[0]!.time = .375; expected.clips[0]!.tracks[0]!.keys[1]!.time = .625;
    expected.clips[0]!.visibilityTracks![0]!.keys[0]!.time = .375; expected.clips[0]!.drawOrderTracks![0]!.keys[0]!.time = .625; expected.clips[0]!.celTracks![0]!.keys[0]!.time = .375;
    const gesture = new TimelineMove(d, 'c', refs); expect(text(d)).toBe(before); expect(d.canUndo).toBe(false);
    const moved = gesture.finish(.25); expect(moved![0]!.time).toBe(.375); expect(text(d)).toBe(saveActorProject(expected));
    const after = text(d); d.undo(); expect(text(d)).toBe(before); expect(d.canUndo).toBe(false); d.redo(); expect(text(d)).toBe(after);
  });
  it('sorts negative moves and handles zero/end times without clamping or extending duration', () => {
    const s = specimen(); moveKeys(s, 'c', [refs[0]!], -.125); expect(s.clips[0]!.tracks[0]!.keys[0]!.time).toBe(0);
    moveKeys(s, 'c', [{ channel: 'tracks', trackId: 't', time: 1.75 }], .25); expect(s.clips[0]!.tracks[0]!.keys.at(-1)!.time).toBe(2); expect(s.clips[0]!.duration).toBe(2);
  });
  it('refuses collision/bounds/nonfinite/stale key groups atomically, including after earlier valid entries', () => {
    for (const [selection, delta, error] of [[refs, -.25, /within/], [refs, 1.625, /collision/], [refs, 2, /within/], [refs, NaN, /finite/], [[...refs, { channel: 'tracks', trackId: 't', time: .5 }], .1, /stale/]] as const) {
      const s = specimen(), before = saveActorProject(s); expect(() => moveKeys(s, 'c', [...selection], delta)).toThrow(error); expect(saveActorProject(s)).toBe(before);
    }
    const d = new ActorDraft(specimen()), before = text(d), g = new TimelineMove(d, 'c', refs); expect(() => g.finish(-1)).toThrow(/within/); expect(text(d)).toBe(before); expect(d.canUndo).toBe(false);
  });
  it('cancels/noops without changing source, history or redo; rejects late epochs and repeated finish', () => {
    const d = new ActorDraft(specimen()); d.edit(s => { s.name = 'changed'; }); d.undo(); const before = text(d);
    const cancelled = new TimelineMove(d, 'c', refs); cancelled.cancel(); expect(cancelled.finish(.25)).toBeNull(); expect(text(d)).toBe(before); expect(d.canRedo).toBe(true);
    new TimelineMove(d, 'c', refs).finish(0); expect(d.canUndo).toBe(false); expect(d.canRedo).toBe(true);
    const stale = new TimelineMove(d, 'c', refs); d.replace(emptyProject()); const replacement = text(d); expect(stale.finish(.25)).toBeNull(); stale.cancel(); expect(text(d)).toBe(replacement); expect(d.documentEpoch).toBe(1);
    const fresh = new ActorDraft(specimen()), g = new TimelineMove(fresh, 'c', refs); fresh.edit(s => { s.author = 'new author'; }); expect(g.finish(.25)).toBeNull(); expect(fresh.source.author).toBe('new author');
  });
  it('pastes the earliest key at the exact requested decimal origin and moves from each captured time', () => {
    const s = specimen(), data = copyKeys(s,'c',[{channel:'tracks',trackId:'t',time:1.75}]);
    pasteKeys(s,'dest',data,.1,()=> 'decimal'); expect(Object.is(s.clips[1]!.tracks[0]!.keys[0]!.time,.1)).toBe(true);
    moveKeys(s,'c',refs.slice(0,2),.1); expect(s.clips[0]!.tracks[0]!.keys.slice(0,2).map(k=>k.time)).toEqual([.225,.475]);
  });
  it('copies complete rich keys and metadata across clips in the same project, using clip-wide unique track IDs', () => {
    const s = specimen(), data = copyKeys(s, 'c', refs), source = structuredClone(s.clips[0]!), parts = structuredClone(s.parts); let id = 0;
    const pasted = pasteKeys(s, 'dest', data, .5, () => `new-${++id}`), c = s.clips[1]!;
    expect(pasted.map(r => r.time)).toEqual([.5,.75,.5,.75,.5]); expect(c.tracks[0]).toEqual({ ...source.tracks[0], id: 'new-1', keys: source.tracks[0]!.keys.slice(0,2).map(k => ({ ...k, time: k.time + .375 })) });
    expect(c.visibilityTracks![0]!.keys).toEqual([{ time: .5, visible: true }]); expect(c.drawOrderTracks![0]!.keys).toEqual([{ time: .75, drawOrder: 3 }]); expect(c.celTracks![0]!.keys).toEqual([{ time: .5, celId: 'cel' }]);
    expect(s.clips[0]).toEqual(source); expect(s.parts).toEqual(parts);
    data.entries[0]!.keys[0]!.time = 99; expect(c.tracks[0]!.keys[0]!.time).toBe(.5);
  });
  it('clipboard rejects cross-project/removed targets/cels, incompatible destination metadata and ID collisions atomically', () => {
    for (const reason of ['project','target','cel','metadata','id','bounds']) {
      const s = specimen(), data = copyKeys(s, 'c', refs);
      if (reason === 'project') data.projectId = 'different'; if (reason === 'target') s.rigs = [];
      if (reason === 'cel') s.cels = [];
      if (reason === 'metadata') s.clips[1]!.tracks = [{ ...structuredClone(s.clips[0]!.tracks[0]!), angle: 'unwrapped', keys: [] }];
      const before = JSON.stringify(s);
      expect(() => pasteKeys(s, 'dest', data, reason === 'bounds' ? 4 : .5, () => 'same-id')).toThrow(); expect(JSON.stringify(s)).toBe(before);
    }
  });
  it('deletes every channel once and exact undo restores capabilities, cels and outgoing metadata', () => {
    const d = new ActorDraft(specimen()), before = text(d); d.edit(s => deleteKeys(s, 'c', refs));
    expect(d.source.clips[0]!.tracks[0]!.keys.map(k => k.time)).toEqual([1.75]); expect(d.source.clips[0]!.drawOrderTracks).toBeUndefined(); expect(d.source.cels).toEqual(specimen().cels);
    d.undo(); expect(text(d)).toBe(before); expect(d.canUndo).toBe(false);
  });
  it('retimed transform sampling has independent linear/step/hold boundary expectations and retained buffers', () => {
    const s = specimen(); moveKeys(s, 'c', [{ channel: 'tracks', trackId: 'simple', time: .25 }, { channel: 'tracks', trackId: 'simple', time: 1.25 }], .25);
    moveKeys(s, 'c', [{ channel: 'visibilityTracks', trackId: 'v', time: 1 }], .25);
    const c = compileActorProject(s), p = createActorPose(c), buffer = p.localTRS, slot = c.slots.findIndex(s => s.kind === 'node' && s.rigId === 'other');
    evaluateActorPose(c, 'c', 1, p, false); expect(p.localTRS[slot*5]).toBe(2); expect(p.localTRS).toBe(buffer);
    const a = c.slots.findIndex(s => s.kind === 'attachment'); evaluateActorPose(c, 'c', 1.24999, p, false); expect(p.visible[a]).toBe(1); evaluateActorPose(c, 'c', 1.25, p, false); expect(p.visible[a]).toBe(0);
    expect(s.clips[0]!.celTracks![0]!.keys.map(k => k.time)).toEqual([.125,1]);
  });
  it('synchronizes optional empty metadata only after deliberate edits, retaining a valid source', () => {
    const s = specimen(); s.animators = []; s.cels = []; delete s.clips[0]!.celTracks;
    for (const c of s.clips) { c.playback = 'once'; c.visibilityTracks = []; c.drawOrderTracks = []; for (const t of c.tracks) { delete t.angle; for (const k of t.keys) { delete k.curve; delete k.bezier; delete k.turns; } } }
    const d = new ActorDraft(s), before = text(d); rowsFor(d.source,d.source.clips[0]); expect(text(d)).toBe(before);
    new TimelineMove(d, 'c', refs.slice(0,2)).finish(.25); expect(d.source.cels).toBeUndefined(); expect(d.source.animators).toBeUndefined(); expect(d.source.requiredCapabilities).not.toContain('spacelab:animation-composition/1'); expect(d.source.requiredCapabilities).not.toContain('spacelab:cel-tracks/1'); expect(() => saveActorProject(d.source)).not.toThrow(); d.undo(); expect(text(d)).toBe(before);
  });
  it('clip deletion preserves explicit reference guards', () => {
    const s = specimen(); s.actions.push({ id: 'local:action', label: 'Signal', category: 'custom', clipId: 'c' }); const before = saveActorProject(s); expect(() => deleteActorClip(s, 'c')).toThrow(/used/); expect(saveActorProject(s)).toBe(before);
  });
});
