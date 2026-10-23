import { describe, expect, it } from 'vitest';
import type { ActorAnimatorLayer, ActorProject, ActorTransform } from '@actor-animator/types';
import { markerSource, rigReachSource } from '../../examples/modules/actor-project/src/source';
import { compileActorProject, createActorPose, evaluateActorPose, createActorAnimationPlayer, evaluateActorAnimation,
  requestActorAnimationState, describeActorAnimation, trimActorAnimationHistory, validateActorProject,
  saveActorProject, syncAnimationCapability, editTransformKey, deleteActorClip, applyDeletion } from '../../packages/actor-tools/src';

const T = (x = 0, rotation = 0): ActorTransform => ({ x, y: 0, rotation, scaleX: 1, scaleY: 1 });
const target = { kind: 'attachment' as const, attachmentId: 'example:drawing' };
function source(): ActorProject {
  const s = markerSource(); s.actions = []; s.clips = [];
  for (let i = 0; i < 3; i++) s.clips.push({ id: `c${i}`, name: `C${i}`, duration: 2, playback: 'once', tracks: [{ id: 't', target, interpolation: 'linear', keys: [{ time: 0, value: T(i * 10) }, { time: 2, value: T(i * 10 + 2) }] }] });
  s.animators = [{ id: 'a', name: 'A', layers: [{ id: 'l', name: 'L', blend: 'override', weight: 1, initialStateId: 's0', defaultTransition: { duration: 2, priority: 0 }, states: s.clips.map((c, i) => ({ id: `s${i}`, name: `S${i}`, clipId: c.id, rate: 1 })), transitions: [] }] }];
  syncAnimationCapability(s); return s;
}
const layer = (s: ActorProject) => s.animators![0]!.layers[0]!;
function setup(s = source()) {
  const c = compileActorProject(s), p = createActorPose(c), a = createActorAnimationPlayer(c, 'a');
  return { c, p, a, at(t: number) { evaluateActorAnimation(c, a, t, p); return p.localTRS[0]!; } };
}
function clipAt(s: ActorProject, t: number) { const c = compileActorProject(s), p = createActorPose(c); evaluateActorPose(c, 'c0', t, p); return p; }

describe('B2 independent timing and blend oracles', () => {
  it('retains legacy fixtures exactly and gates every additive field', () => {
    const old = markerSource(), text = saveActorProject(old); expect(saveActorProject(JSON.parse(text))).toBe(text);
    const s = source(); s.requiredCapabilities = old.requiredCapabilities;
    expect(validateActorProject(s)).toMatchObject({ ok: false, diagnostics: [{ code: 'capability' }] });
  });
  it('samples preset easing and a known parametric cubic, including overshoot', () => {
    const s = source(), k = s.clips[0]!.tracks[0]!.keys[0]!;
    k.curve = 'ease-in-out'; expect(clipAt(s, 1).localTRS[0]).toBeCloseTo(1, 10);
    k.curve = 'cubic-bezier'; k.bezier = [1 / 3, 2, 2 / 3, 2];
    // x(u)=u; y(.5)=.125 + 2*(.375+.375)=1.625.
    expect(clipAt(s, 1).localTRS[0]).toBeCloseTo(3.25, 10);
    expect(clipAt(s, 0).localTRS[0]).toBe(0); expect(clipAt(s, 2).localTRS[0]).toBe(2);
    k.curve = 'step'; delete k.bezier; expect(clipAt(s, 1.9).localTRS[0]).toBe(0);
  });
  it('uses authored unwrapped values by default; shortest and explicit turns are opt-in', () => {
    const s = source(), t = s.clips[0]!.tracks[0]!; t.keys[0]!.value.rotation = 3; t.keys[1]!.value.rotation = -3;
    expect(clipAt(s, 1).localTRS[2]).toBe(0);
    t.angle = 'shortest'; expect(clipAt(s, 1).localTRS[2]).toBeCloseTo(Math.PI);
    t.keys[0]!.turns = 1; expect(clipAt(s, 1).localTRS[2]).toBeCloseTo(2 * Math.PI);
    expect(clipAt(s, 2).localTRS[2]).toBe(-3);
    t.keys[0]!.value.rotation = 0; t.keys[1]!.value.rotation = Math.PI; delete t.keys[0]!.turns;
    expect(clipAt(s, 1).localTRS[2]).toBe(-Math.PI / 2);
  });
  it('handles negative loop seeks and ping-pong endpoints without seam interpolation', () => {
    const s = source(), clip = s.clips[0]!;
    for (const [mode, cases] of [['once', [[-1, 0], [3, 2]]], ['loop', [[-1, 1], [2, 0], [4, 0]]], ['ping-pong', [[-1, 1], [2, 2], [3, 1], [4, 0], [5, 1]]]] as const) {
      clip.playback = mode; for (const [time, x] of cases) expect(clipAt(s, time).localTRS[0]).toBe(x);
    }
  });
  it('holds discrete keys, inherits visibility and sorts current painter order by stable ID', () => {
    const s = source(); s.rigs = [{ id: 'r', name: 'R', sockets: [], nodes: [{ id: 'n', name: 'N', parentId: null, rest: T() }] }];
    Object.assign(s.attachments[0]!, { rigId: 'r', nodeId: 'n' });
    s.attachments.push({ ...s.attachments[0]!, id: 'z' });
    s.clips[0]!.visibilityTracks = [{ id: 'v', target: { kind: 'node', rigId: 'r', nodeId: 'n' }, keys: [{ time: .5, visible: false }, { time: 1, visible: true }] }];
    s.clips[0]!.drawOrderTracks = [{ id: 'o', target, keys: [{ time: 0, drawOrder: 2 }, { time: 1, drawOrder: 0 }] }];
    let p = clipAt(s, 0); expect([...p.visible]).toEqual([0, 0, 0]); expect([...p.drawSequence]).toEqual([2, 1]);
    p = clipAt(s, 1); expect([...p.visible]).toEqual([1, 1, 1]); expect([...p.drawSequence]).toEqual([1, 2]);
  });
  it('overwrites caller-mutated painter output rather than carrying corrupted slots forward', () => {
    const s = source(); s.attachments.push({ ...s.attachments[0]!, id: 'z', drawOrder: -1 });
    const v = setup(s); v.p.drawSequence.fill(999); v.at(0); expect([...v.p.drawSequence]).toEqual([1,0]);
    v.p.drawSequence.fill(0); evaluateActorPose(v.c, null, 0, v.p); expect([...v.p.drawSequence]).toEqual([1,0]);
  });
  it('matches clip evaluation bit for bit for an unblended layer', () => {
    const { c, p, a } = setup(), raw = createActorPose(c);
    for (const t of [0, .1, .7, 2, 4]) { evaluateActorAnimation(c, a, t, p); evaluateActorPose(c, 'c0', t, raw); expect(p).toEqual(raw); }
  });
  it('crossfades nested entries using independent products of weights', () => {
    const v = setup(); expect(requestActorAnimationState(v.a, 'l', 's1', 0)).toBe('accepted');
    expect(requestActorAnimationState(v.a, 'l', 's2', .5)).toBe('accepted');
    // At 1s: first fade=.5, second=.25. (1*.5 + 11*.5)*.75 + 20.5*.25
    expect(v.at(1)).toBe(9.625);
    const status = describeActorAnimation(v.a, 1); expect(status.layers[0]!.entries.map(e => e.weight)).toEqual([.375, .375, .25]);
  });
  it('selects exact, any and default transitions; rejects lower priority interruptions and same-state restart', () => {
    const s = source(); layer(s).transitions = [{ id: 'x', from: 's0', to: 's1', duration: 2, priority: 4 }, { id: 'y', from: null, to: 's2', duration: 0, priority: 3 }];
    const v = setup(s); expect(requestActorAnimationState(v.a, 'l', 's1', 0)).toBe('accepted');
    expect(requestActorAnimationState(v.a, 'l', 's1', .1)).toBe('already-active');
    expect(requestActorAnimationState(v.a, 'l', 's2', .5)).toBe('rejected-priority');
    expect(requestActorAnimationState(v.a, 'l', 's2', 2)).toBe('accepted'); expect(v.at(2)).toBe(20);
    expect(requestActorAnimationState(v.a, 'l', 's0', 1)).toBe('out-of-order');
  });
  it('processes automatic next before a request at the same time, including reverse rate', () => {
    const s = source(); layer(s).states[0]!.rate = -2; layer(s).states[0]!.next = 's1'; layer(s).defaultTransition.duration = 0;
    const v = setup(s); expect(v.at(0)).toBe(2); expect(v.at(.5)).toBe(1);
    expect(requestActorAnimationState(v.a, 'l', 's1', 1)).toBe('already-active'); expect(v.at(1)).toBe(10);
  });
  it('supports zero rates, masks and component additive references', () => {
    const s = source(); layer(s).states[0]!.rate = 0;
    const extra: ActorAnimatorLayer = { ...structuredClone(layer(s)), id: 'extra', blend: 'additive', weight: .5, reference: { clipId: 'c1', time: 1 }, initialStateId: 's2', mask: [target] };
    s.animators![0]!.layers.push(extra); const v = setup(s); expect(v.at(.5)).toBe(4.75);
    extra.mask = []; expect(setup(s).at(.5)).toBe(0);
  });
  it('fades untracked slots back to the lower pose; switches discrete values at .5', () => {
    const s = source(); s.clips[0]!.visibilityTracks = [{ id: 'v', target, keys: [{ time: 0, visible: false }] }]; s.clips[1]!.tracks = [];
    const v = setup(s); requestActorAnimationState(v.a, 'l', 's1', 0);
    expect(v.at(.5)).toBe(.375); expect(v.p.visible[0]).toBe(0);
    expect(v.at(1)).toBe(.5); expect(v.p.visible[0]).toBe(1);
    expect(v.at(2)).toBe(0);
  });
  it('replays exactly after backward seeks and independent frame spacing', () => {
    const first = setup(), second = setup();
    for (const v of [first, second]) { requestActorAnimationState(v.a, 'l', 's1', .2); requestActorAnimationState(v.a, 'l', 's2', .7); }
    for (let t = 0; t < 4; t += .013) first.at(t);
    first.at(1.1); second.at(1.1); expect(first.p).toEqual(second.p); first.at(4); second.at(4); expect(first.p).toEqual(second.p);
  });
  it('solves visual constraints after every layer, and raw preview skips them', () => {
    const s = source(), rig = rigReachSource().rigs[0]!;
    s.requiredCapabilities.push('spacelab:rig-constraints/1'); s.rigs.push(rig);
    rig.constraints![0]!.solver = 'test:observe';
    let seen = NaN;
    const c = compileActorProject(s, {}, { solvers: [{ id: 'test:observe', version: '1', prepare: () => ({ firstSlot: 0, solve(pose) { seen = pose.localTRS[20]!; } }) }] });
    const p = createActorPose(c), a = createActorAnimationPlayer(c, 'a');
    requestActorAnimationState(a, 'l', 's1', 0); evaluateActorAnimation(c, a, 1, p); expect(seen).toBe(6);
    seen = -1; evaluateActorAnimation(c, a, 1, p, false); expect(seen).toBe(-1); expect(Number.isNaN(p.constraintResiduals[0])).toBe(true);
  });
  it('caps overlapping stacks, exposes drops, and trims history without changing the pose', () => {
    const s = source(); layer(s).defaultTransition.duration = 20; const v = setup(s);
    for (let i = 0; i < 20; i++) requestActorAnimationState(v.a, 'l', `s${(i + 1) % 3}`, i * .1);
    expect(describeActorAnimation(v.a, 2).droppedEntries).toBe(13); v.at(2); const before = [...v.p.localTRS];
    trimActorAnimationHistory(v.a); v.at(2); expect([...v.p.localTRS]).toEqual(before); v.at(3); v.at(2); expect(describeActorAnimation(v.a, 2).droppedEntries).toBe(13); expect(() => v.at(1)).toThrow('history origin');
  });
  it('bounds requests and rejects invalid references, cycles and work limits', () => {
    const v = setup(), a = createActorAnimationPlayer(v.c, 'a', { maxRequests: 0 }); expect(requestActorAnimationState(a, 'l', 's1', 0)).toBe('capacity');
    const s = source(); layer(s).states[0]!.next = 's1'; layer(s).states[1]!.next = 's0'; expect(validateActorProject(s)).toMatchObject({ ok: false, diagnostics: [{ code: 'cycle' }] });
    expect(validateActorProject(source(), { maxAnimationWork: 0 }).ok).toBe(false);
    expect(() => evaluateActorAnimation(compileActorProject(source()), v.a, 0, v.p)).toThrow('another compiled');
  });
  it('edits keys atomically through transactions, preserves metadata and reviews clip references', () => {
    const s = source(); editTransformKey(s, 'c0', target, { time: .5, value: T(5), curve: 'ease-in' }, 'shortest', () => 'new');
    expect(s.clips[0]!.tracks[0]!.keys.map(k => k.time)).toEqual([0, .5, 2]);
    expect(() => editTransformKey(s, 'c0', target, { time: 2, value: T() }, undefined, () => 'n', .5)).toThrow('destination');
    expect(() => deleteActorClip(s, 'c0')).toThrow('state A/L/S0');
    delete s.animators; deleteActorClip(s, 'c0'); syncAnimationCapability(s); expect(s.requiredCapabilities).not.toContain('spacelab:animation-composition/1');
  });
  it('deletion removes discrete tracks and masks along with transform tracks', () => {
    const s = source(); s.clips[0]!.visibilityTracks = [{ id: 'v', target, keys: [{ time: 0, visible: false }] }]; layer(s).mask = [target];
    const lines = applyDeletion(s, { kind: 'attachment', id: target.attachmentId });
    expect(lines.join('\n')).toContain('mask'); expect(s.clips[0]!.visibilityTracks).toEqual([]); expect(validateActorProject(s).ok).toBe(true);
  });
});
