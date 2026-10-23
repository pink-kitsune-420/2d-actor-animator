import { describe, expect, it } from 'vitest';
import { ActorDraft, emptyProject, identityTransform } from '../../apps/web/src/actor-tools/editing';
import { RigGesture, inversePoint, localPointer, screenPoint, segmentDistance, type GestureIntent, type ViewFrame } from '../../apps/web/src/actor-tools/viewport-math';
import { compileActorProject, createActorPose, evaluateActorPose, saveActorProject } from '../../packages/actor-tools/src';

const I = [1, 0, 0, 1, 0, 0];
const frame: ViewFrame = { width: 640, height: 400, cssWidth: 320, cssHeight: 200, scale: 16, viewY: 2, placement: I };
function fixture() {
  const s = emptyProject(); s.extensions['foreign:kept'] = { zero: -0, arbitrary: [1, true] };
  s.rigs.push({ id: 'r', name: 'Six leg base', sockets: [], nodes: [
    { id: 'n', name: 'Central joint', parentId: null, rest: { ...identityTransform(), x: 1, y: 2 } },
    { id: 'child', name: 'Antenna', parentId: 'n', rest: { ...identityTransform(), x: 2 } },
  ] });
  s.clips.push({ id: 'c', name: 'Unconventional', duration: 2, playback: 'once', tracks: [] }); return s;
}
const intent: GestureIntent = { selection: { kind: 'node', id: 'n', rigId: 'r' }, mode: 'rest', tool: 'move', clip: null, time: 0 };
const initial = { ...identityTransform(), x: 1, y: 2 };
const text = (d: ActorDraft) => saveActorProject(d.source);

describe('viewport coordinate and source contract', () => {
  it('converts backing/CSS pixels, view Y, zoom and affine placement using independent numeric expectations', () => {
    // Project (3,4) -> placement reflected quarter turn (-7,-4), then screen (104,148).
    const f = { ...frame, placement: [0, -2, -3, 0, 5, 2] }, out = new Float64Array(2);
    screenPoint(f, 3, 4, out); expect([...out]).toEqual([104, 148]);
    expect(localPointer(f, I, 104, 148)).toEqual([3, 4]);
    // Parent x'= -2y+1, y'=3x-4. Local (2,3) -> project(-5,2) -> CSS(120,100).
    expect(localPointer(frame, [0, 3, -2, 0, 1, -4], 120, 100)).toEqual([2, 3]);
    expect(segmentDistance(4, 3, 0, 0, 8, 0)).toBe(3); expect(segmentDistance(3, 4, 0, 0, 0, 0)).toBe(5);
  });
  it('includes object-fit content offsets independently of the element bounds', () => {
    const f = { ...frame, cssWidth: 256, cssHeight: 160, offsetX: 72, offsetY: 0 }, out = new Float64Array(2);
    screenPoint(f, 3, 4, out); expect([...out]).toEqual([219.2, 67.2]);
    const local = localPointer(f, I, 219.2, 67.2); expect(local[0]).toBeCloseTo(3, 12); expect(local[1]).toBeCloseTo(4, 12);
  });
  it('uses the full sheared/reflected affine inverse without decomposing it', () => {
    expect(inversePoint([-2, 1, 3, 4, 5, -6], 13, 1)).toEqual([-1, 2]);
    const d = new ActorDraft(fixture()), g = new RigGesture(d, intent, frame, [-2, 1, 3, 4, 5, -6], initial, [1, 2]);
    // Local delta(2,-1) -> world delta(-7,-2), -> CSS delta(-56,+16).
    // Start world(9,3) -> CSS(232,92); end CSS(176,108).
    g.update(176, 108); g.finish();
    expect(d.source.rigs[0]!.nodes[0]!.rest).toEqual({ ...initial, x: 3, y: 1 });
  });
  it('one drag is one exact whole-source undo/redo including negative zero and unrelated metadata', () => {
    const d = new ActorDraft(fixture()), before = text(d), g = new RigGesture(d, intent, frame, I, initial, [1, 2]);
    g.update(176, 100); g.update(184, 92); expect(d.canUndo).toBe(false); g.finish();
    expect(d.source.rigs[0]!.nodes[0]!.rest).toEqual({ ...initial, x: 3, y: 3 });
    expect(d.source.rigs[0]!.nodes[1]!.rest.x).toBe(2); const after = text(d);
    d.undo(); expect(text(d)).toBe(before); expect(d.canUndo).toBe(false); d.redo(); expect(text(d)).toBe(after);
  });
  it('cancellation preserves redo and canonical source; late input/finish are inert', () => {
    const d = new ActorDraft(fixture()); d.edit(s => { s.name = 'changed'; }); d.undo(); const before = text(d);
    const g = new RigGesture(d, intent, frame, I, initial, [1, 2]); g.update(200, 100); g.cancel();
    expect(text(d)).toBe(before); expect(d.canUndo).toBe(false); expect(d.canRedo).toBe(true); expect(g.update(220, 100)).toBe(false); expect(g.finish()).toBe(false);
  });
  it('a replaced document and stale finish cannot overwrite newer source', () => {
    const d = new ActorDraft(fixture()), g = new RigGesture(d, intent, frame, I, initial, [1, 2]); g.update(200, 100);
    const replacement = emptyProject(); replacement.name = 'New document'; d.replace(replacement); const before = text(d);
    expect(g.update(220, 100)).toBe(false); expect(g.finish()).toBe(false); g.cancel(); expect(text(d)).toBe(before); expect(d.canUndo).toBe(false);
  });
  it('rotation measures unwrapped local angles under reflected nonuniform parents, retaining scale', () => {
    const d = new ActorDraft(fixture()), parent = [-2, 0, 0, 3, 0, 0];
    // Initial local handle (2,2); end local(1,3) -> project(-2,9) -> CSS(144,44).
    const g = new RigGesture(d, { ...intent, tool: 'rotate' }, frame, parent, initial, [2, 2]);
    g.update(144, 44); g.finish(); expect(d.source.rigs[0]!.nodes[0]!.rest.rotation).toBeCloseTo(Math.PI / 2, 12);
    expect(d.source.rigs[0]!.nodes[0]!.rest.scaleX).toBe(1);
  });
  it('joint operation preserves independent child world point and keyed offsets', () => {
    const d = new ActorDraft(fixture()), g = new RigGesture(d, { ...intent, tool: 'joint' }, frame, I, initial, [1, 2]);
    g.update(184, 92); g.update(192, 84); g.finish();
    const [root, child] = d.source.rigs[0]!.nodes;
    expect(root!.rest.x + child!.rest.x).toBe(3); expect(root!.rest.y + child!.rest.y).toBe(2);
    expect(root!.rest).toEqual({ ...initial, x: 4, y: 4 });
  });
  it('keys exact fractional seconds, preserves rich key metadata and all unrelated source', () => {
    const s = fixture(); s.clips[0]!.tracks.push({ id: 't', target: { kind: 'node', rigId: 'r', nodeId: 'n' }, interpolation: 'linear', angle: 'shortest', keys: [
      { time: .125, value: initial, curve: 'ease-in', turns: 2 }, { time: 2, value: initial },
    ] }); s.requiredCapabilities.push('spacelab:animation-composition/1');
    const d = new ActorDraft(s), g = new RigGesture(d, { ...intent, mode: 'pose', clip: 'c', time: .125 }, frame, I, initial, [1, 2]);
    g.update(184, 92); g.finish(); const t = d.source.clips[0]!.tracks[0]!;
    expect(t.keys[0]).toEqual({ time: .125, value: { ...initial, x: 3, y: 3 }, curve: 'ease-in', turns: 2 });
    expect(t.keys[1]).toEqual(s.clips[0]!.tracks[0]!.keys[1]); expect(d.source.rigs).toEqual(s.rigs); expect(d.source.extensions).toEqual(s.extensions);
  });
  it('zero-bone attachments with zero/reflected own scales remain editable and portable', () => {
    const s = fixture(); s.rigs = []; s.parts.push({ id: 'p', name: 'Light', revision: 4, pivot: [0, 0], unitsPerPixel: 1, artwork: { kind: 'indexed-raster', width: 1, height: 1, palette: ['#ffffffff'], layers: [{ id: 'l', name: 'Ink', opacity: 1, pixels: [0] }] } });
    const t = { ...initial, scaleX: 0, scaleY: -2 }; s.attachments.push({ id: 'a', name: 'Light', partId: 'p', drawOrder: 0, transform: t });
    const d = new ActorDraft(s), g = new RigGesture(d, { ...intent, selection: { kind: 'attachment', id: 'a' }, mode: 'pose', clip: 'c', time: .375 }, frame, I, t, [1, 2]);
    g.update(184, 92); g.finish(); const c = compileActorProject(d.source), p = createActorPose(c); evaluateActorPose(c, 'c', .375, p, false);
    expect([...p.localTRS]).toEqual([3, 3, 0, 0, -2]); expect(d.source.parts).toEqual(s.parts); expect(d.source.attachments).toEqual(s.attachments);
  });
  it('singular parent rejects before starting a transaction; joint zero scale rejects atomically', () => {
    const d = new ActorDraft(fixture()), before = text(d);
    expect(() => new RigGesture(d, intent, frame, [0, 0, 0, 1, 0, 0], initial, [1, 2])).toThrow(/collapses/); expect(text(d)).toBe(before);
    d.edit(s => { s.rigs[0]!.nodes[0]!.rest.scaleX = 0; }); const zero = text(d);
    const g = new RigGesture(d, { ...intent, tool: 'joint' }, frame, I, { ...initial, scaleX: 0 }, [1, 2]);
    expect(() => g.update(184, 92)).toThrow(/zero rest scale/); g.cancel(); expect(text(d)).toBe(zero);
  });
});
