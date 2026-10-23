import { describe, expect, it } from 'vitest';
import type { ActorConstraint, ActorProject, ActorRig, ActorTransform } from '@actor-animator/types';
import {
  ActorEditError, CCD_CHAIN_SOLVER, RIG_CONSTRAINTS_CAPABILITY, addCcdConstraint, applyDeletion, compileActorProject, createActorPose,
  decomposeMatrix, deleteConstraint, evaluateActorPose, mirrorSubtree, moveJoint, openActorProject, reparentRigItem, reviewDeletion,
  rigDiagnostics, saveActorProject, scaleSegmentOffsets, setConstraintEnabled, setJointLimits, setPoseKey, updateCcdConstraint, validateActorProject,
  type ActorConstraintSolver, type CompiledActorProject,
} from '../../packages/actor-tools/src';
import { actorFixture } from '../helpers/actor-project';
import { rigReachSource } from '../../examples/modules/actor-project/src/source';

const I = (o: Partial<ActorTransform> = {}): ActorTransform => ({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, ...o });
const Q = Math.PI / 2;
function project(rig: ActorRig, extra: Partial<ActorProject> = {}): ActorProject {
  const p = actorFixture('empty');
  p.rigs.push(rig);
  p.parts.push({ id: 'dot', name: 'Dot', revision: 1, pivot: [0, 0], unitsPerPixel: 1, artwork: { kind: 'indexed-raster', width: 1, height: 1, palette: ['#ffffffff'], layers: [{ id: 'l', name: 'L', opacity: 1, pixels: [0] }] } });
  return Object.assign(p, extra);
}
/** Transaction semantics used by the editor: mutate a copy, then validate. */
function edit(source: ActorProject, change: (s: ActorProject) => void): ActorProject {
  const copy = structuredClone(source); change(copy);
  return openActorProject(saveActorProject(copy)).ok ? copy : (() => { throw new Error('invalid'); })();
}
function rejects(source: ActorProject, code: string, change: (s: ActorProject) => void) {
  const before = saveActorProject(source);
  let error: unknown; try { edit(source, change); } catch (e) { error = e; }
  expect(error).toBeInstanceOf(ActorEditError); expect((error as ActorEditError).code).toBe(code);
  expect(saveActorProject(source)).toBe(before);
}
function slotOf(c: CompiledActorProject, kind: string, id: string) { const i = c.slots.findIndex(s => s.kind === kind && s.id === id); expect(i).toBeGreaterThanOrEqual(0); return i; }
function world(source: ActorProject, kind: string, id: string, clip: string | null = null, time = 0, constraints = true) {
  const c = compileActorProject(source), pose = createActorPose(c); evaluateActorPose(c, clip, time, pose, constraints);
  const i = slotOf(c, kind, id); return Array.from(pose.worldMatrices.slice(i * 6, i * 6 + 6));
}
function close(actual: ArrayLike<number>, expected: readonly number[], digits = 9) {
  expect(actual.length).toBe(expected.length); expected.forEach((v, i) => expect(actual[i]).toBeCloseTo(v, digits));
}

describe('TRS representability', () => {
  it('decomposes independently constructed matrices, keeps reflections/turns near the reference and rejects shear', () => {
    close(Object.values(decomposeMatrix([0, 2, -3, 0, 5, 6])!), [5, 6, Q, 2, 3]);
    expect(decomposeMatrix([1, 0, 1, 1, 0, 0])).toBeNull(); // shear
    expect(decomposeMatrix([-1, 0, 0, 1, 0, 0], 0)).toEqual({ x: 0, y: 0, rotation: 0, scaleX: -1, scaleY: 1 });
    close(Object.values(decomposeMatrix([-1, 0, 0, 1, 0, 0], Math.PI)!), [0, 0, Math.PI, 1, -1]);
    close(Object.values(decomposeMatrix([Math.cos(.1), Math.sin(.1), -Math.sin(.1), Math.cos(.1), 0, 0], 4 * Math.PI)!), [0, 0, 4 * Math.PI + .1, 1, 1]);
    expect(decomposeMatrix([0, 0, 0, 0, 1, 2], 7)).toEqual({ x: 1, y: 2, rotation: 7, scaleX: 0, scaleY: 0 });
    expect(decomposeMatrix([NaN, 0, 0, 1, 0, 0])).toBeNull();
  });
});

describe('reparenting', () => {
  // A: root at (2,0) turned 90°; B: root scaled 2; C: child of A at (1,0).
  const rig = (): ActorRig => ({ id: 'r', name: 'Free rig', sockets: [{ id: 'port', name: 'Port', nodeId: 'C', transform: I({ x: 1 }) }], nodes: [
    { id: 'A', name: 'A', parentId: null, rest: I({ x: 2, rotation: Q }) },
    { id: 'B', name: 'B', parentId: null, rest: I({ scaleX: 2, scaleY: 2 }) },
    { id: 'C', name: 'C', parentId: 'A', rest: I({ x: 1 }) },
  ] });
  const keyed = () => project(rig(), {
    attachments: [{ id: 'art', name: 'Art', partId: 'dot', rigId: 'r', nodeId: 'C', drawOrder: 0, transform: I({ y: 1 }) }],
    clips: [{ id: 'swing', name: 'Swing', duration: 2, playback: 'once', tracks: [{ id: 'tc', target: { kind: 'node', rigId: 'r', nodeId: 'C' }, interpolation: 'linear', keys: [{ time: 0, value: I({ x: 1 }) }, { time: 2, value: I({ x: 1, rotation: Math.PI }) }] }] }],
  });
  it('preserve-world keeps rest and keyed-clip worlds with an exact similarity correction; IDs and other data are untouched', () => {
    const source = keyed(), after = edit(source, s => reparentRigItem(s, { kind: 'node', rigId: 'r', id: 'C' }, { rigId: 'r', nodeId: 'B' }, 'world'));
    // Hand-derived: C world origin (2,1), turned 90°; inside B (scale 2) => local (1,.5), 90°, scale .5.
    close(Object.values(after.rigs[0]!.nodes[2]!.rest), [1, .5, Q, .5, .5]);
    expect(after.rigs[0]!.nodes[2]!.parentId).toBe('B');
    expect(after.clips[0]!.tracks[0]!.keys.map(k => k.value.rotation)).toEqual([Q, Q + Math.PI]);
    close(world(after, 'node', 'C'), [0, 1, -1, 0, 2, 1]);
    for (const t of [0, .5, 1, 1.5, 2]) for (const [kind, id] of [['node', 'C'], ['socket', 'port'], ['attachment', 'art']] as const) close(world(after, kind, id, 'swing', t), world(source, kind, id, 'swing', t));
    expect(after.rigs[0]!.nodes.map(n => n.id)).toEqual(['A', 'B', 'C']); expect(after.clips[0]!.tracks[0]!.id).toBe('tc');
    expect(after.attachments).toEqual(source.attachments); expect(after.parts).toEqual(source.parts);
  });
  it('preserve-local keeps source transforms verbatim and moves the world with the new parent', () => {
    const source = keyed(), after = edit(source, s => reparentRigItem(s, { kind: 'node', rigId: 'r', id: 'C' }, { rigId: 'r', nodeId: 'B' }, 'local'));
    expect(after.rigs[0]!.nodes[2]!.rest).toEqual(source.rigs[0]!.nodes[2]!.rest); expect(after.clips).toEqual(source.clips);
    close(world(after, 'node', 'C'), [2, 0, 0, 2, 2, 0]);
  });
  it('rejects cycles, stale IDs, cross-rig nodes, singular parents, shear and non-uniform keyed corrections atomically', () => {
    const source = keyed();
    rejects(source, 'cycle', s => reparentRigItem(s, { kind: 'node', rigId: 'r', id: 'A' }, { rigId: 'r', nodeId: 'C' }, 'local'));
    rejects(source, 'cycle', s => reparentRigItem(s, { kind: 'node', rigId: 'r', id: 'A' }, { rigId: 'r', nodeId: 'A' }, 'world'));
    rejects(source, 'stale', s => reparentRigItem(s, { kind: 'node', rigId: 'r', id: 'gone' }, null, 'world'));
    rejects(source, 'stale', s => reparentRigItem(s, { kind: 'node', rigId: 'r', id: 'C' }, { rigId: 'r', nodeId: 'gone' }, 'world'));
    rejects(source, 'rig', s => reparentRigItem(s, { kind: 'node', rigId: 'r', id: 'C' }, { rigId: 'other', nodeId: 'A' }, 'local'));
    const flat = edit(source, s => { s.rigs[0]!.nodes[1]!.rest = I({ scaleX: 0 }); });
    rejects(flat, 'singular', s => reparentRigItem(s, { kind: 'node', rigId: 'r', id: 'C' }, { rigId: 'r', nodeId: 'B' }, 'world'));
    expect(() => edit(flat, s => reparentRigItem(s, { kind: 'node', rigId: 'r', id: 'C' }, { rigId: 'r', nodeId: 'B' }, 'local'))).not.toThrow();
    // inverse(S(2,1)) * R(45°) has columns (.3536,.7071) and (-.3536,.7071): dot .375, not orthogonal.
    const stretched = edit(source, s => { s.rigs[0]!.nodes[1]!.rest = I({ scaleX: 2 }); s.rigs[0]!.nodes[0]!.rest = I({ rotation: Math.PI / 4 }); s.clips = []; });
    rejects(stretched, 'shear', s => reparentRigItem(s, { kind: 'node', rigId: 'r', id: 'C' }, { rigId: 'r', nodeId: 'B' }, 'world'));
    const axisAligned = edit(stretched, s => { s.rigs[0]!.nodes[0]!.rest = I(); });
    const moved = edit(axisAligned, s => reparentRigItem(s, { kind: 'node', rigId: 'r', id: 'C' }, { rigId: 'r', nodeId: 'B' }, 'world'));
    close(Object.values(moved.rigs[0]!.nodes[2]!.rest), [.5, 0, 0, .5, 1]);
    rejects(edit(axisAligned, s => { s.clips = keyed().clips; }), 'keys', s => reparentRigItem(s, { kind: 'node', rigId: 'r', id: 'C' }, { rigId: 'r', nodeId: 'B' }, 'world'));
  });
  it('keeps reflection under a mirrored parent rather than discarding it', () => {
    const source = keyed(); source.rigs[0]!.nodes[1]!.rest = I({ scaleX: -1 });
    const after = edit(source, s => reparentRigItem(s, { kind: 'node', rigId: 'r', id: 'C' }, { rigId: 'r', nodeId: 'B' }, 'world'));
    const r = after.rigs[0]!.nodes[2]!.rest; expect(r.scaleX * r.scaleY).toBeCloseTo(-1, 12);
    for (const t of [0, .7, 2]) close(world(after, 'attachment', 'art', 'swing', t), world(source, 'attachment', 'art', 'swing', t));
  });
  it('detaches an accessory to the scene root and moves sockets between nodes in either mode', () => {
    const source = keyed();
    const detached = edit(source, s => reparentRigItem(s, { kind: 'attachment', id: 'art' }, null, 'world'));
    expect(detached.attachments[0]!.rigId).toBeUndefined(); expect(detached.attachments[0]!.nodeId).toBeUndefined();
    close(world(detached, 'attachment', 'art'), world(source, 'attachment', 'art')); close(Object.values(detached.attachments[0]!.transform), [1, 1, Q, 1, 1]);
    const socket = edit(source, s => reparentRigItem(s, { kind: 'socket', rigId: 'r', id: 'port' }, { rigId: 'r', nodeId: 'B' }, 'world'));
    close(world(socket, 'socket', 'port'), world(source, 'socket', 'port'));
    rejects(source, 'reference', s => reparentRigItem(s, { kind: 'socket', rigId: 'r', id: 'port' }, null, 'world'));
  });
});

describe('deletion review', () => {
  const chain = () => project({ id: 'r', name: 'Tail rig', nodes: [
    { id: 't0', name: 'Tail base', parentId: null, rest: I({ x: 1, rotation: Q }) },
    { id: 't1', name: 'Tail mid', parentId: 't0', rest: I({ x: 2, scaleX: 3, scaleY: 3 }) },
    { id: 't2', name: 'Tail tip', parentId: 't1', rest: I({ x: 1 }) },
    { id: 'goal', name: 'Goal', parentId: null, rest: I({ x: -5 }) },
  ], sockets: [{ id: 's1', name: 'Mid port', nodeId: 't1', transform: I({ y: 1 }) }, { id: 's0', name: 'Base port', nodeId: 't0', transform: I() }] }, {
    requiredCapabilities: ['spacelab:indexed-raster/1', 'spacelab:transform-clips/1', RIG_CONSTRAINTS_CAPABILITY],
    attachments: [{ id: 'a1', name: 'Mid art', partId: 'dot', rigId: 'r', nodeId: 't1', drawOrder: 0, transform: I() }],
    clips: [{ id: 'c', name: 'Wag', duration: 1, playback: 'loop', tracks: [
      { id: 'k1', target: { kind: 'node', rigId: 'r', nodeId: 't1' }, interpolation: 'step', keys: [{ time: 0, value: I({ x: 2, scaleX: 3, scaleY: 3 }) }] },
      { id: 'k2', target: { kind: 'attachment', attachmentId: 'a1' }, interpolation: 'step', keys: [{ time: 0, value: I() }] },
    ] }],
  });
  it('lifts children/sockets/attachments preserving world, removes only the listed tracks and never mutates on review', () => {
    const source = chain(), before = saveActorProject(source);
    const review = reviewDeletion(source, { kind: 'node', rigId: 'r', id: 't1' }, 'lift-world');
    expect(saveActorProject(source)).toBe(before);
    expect(review).toContain('Remove track k1 (1 keys) from clip Wag; the clip itself stays.');
    expect(review.join('\n')).toMatch(/Tail tip: moved to Tail base \(preserve world\)/);
    const after = edit(source, s => applyDeletion(s, { kind: 'node', rigId: 'r', id: 't1' }, 'lift-world'));
    expect(after.rigs[0]!.nodes.map(n => n.id)).toEqual(['t0', 't2', 'goal']); expect(after.clips).toHaveLength(1);
    expect(after.clips[0]!.tracks.map(t => t.id)).toEqual(['k2']);
    // Tail tip world origin: base (1,0) + R90 * ((2,0) + 3*(1,0)) = (1,5).
    close(world(after, 'node', 't2'), [0, 3, -3, 0, 1, 5]);
    for (const [kind, id] of [['socket', 's1'], ['attachment', 'a1']] as const) close(world(after, kind, id), world(source, kind, id));
  });
  it('subtree deletion removes descendants, their sockets, attachments, tracks and dependent constraints but keeps parts, clips and opaque records', () => {
    const source = chain(), opaque: ActorConstraint = { id: 'foreign', name: 'Foreign spring', solver: 'vendor:spring/1', enabled: true, settings: { bone: 't2', note: ['opaque', -0] } };
    source.rigs[0]!.constraints = [{ id: 'ik', name: 'Tail reach', solver: CCD_CHAIN_SOLVER, enabled: true, settings: { effector: { kind: 'node', id: 't2' }, chainRootId: 't0', target: { kind: 'node', id: 'goal' }, iterations: 8, tolerance: .01 } }, opaque];
    const review = reviewDeletion(source, { kind: 'node', rigId: 'r', id: 't1' }, 'subtree');
    expect(review).toEqual(expect.arrayContaining(['Delete 2 node(s): Tail mid, Tail tip.', 'Delete socket Mid port.', 'Delete attachment Mid art (part stays).',
      'Remove constraint Tail reach (its chain root, effector or target is removed).', '1 constraint(s) use unsupported solvers; their settings are not interpreted and are preserved unchanged.']));
    const after = edit(source, s => applyDeletion(s, { kind: 'node', rigId: 'r', id: 't1' }, 'subtree'));
    expect(after.rigs[0]!.nodes.map(n => n.id)).toEqual(['t0', 'goal']); expect(after.rigs[0]!.sockets.map(s => s.id)).toEqual(['s0']);
    expect(after.attachments).toEqual([]); expect(after.parts).toEqual(source.parts); expect(after.clips[0]!.tracks).toEqual([]);
    expect(after.rigs[0]!.constraints).toEqual([opaque]); expect(Object.is((after.rigs[0]!.constraints![0]!.settings as { note: number[] }).note[1], -0)).toBe(true);
    expect(after.requiredCapabilities).toContain(RIG_CONSTRAINTS_CAPABILITY);
  });
  it('a deleted root drops its sockets with an explicit line and lifts attachments to the scene', () => {
    const source = chain(), after = edit(source, s => applyDeletion(s, { kind: 'node', rigId: 'r', id: 't0' }, 'lift-local'));
    expect(reviewDeletion(source, { kind: 'node', rigId: 'r', id: 't0' }, 'lift-local')).toContain('Delete socket Base port (a root has no parent node to carry it).');
    expect(after.rigs[0]!.nodes.find(n => n.id === 't1')!.parentId).toBeNull(); expect(after.rigs[0]!.nodes.find(n => n.id === 't1')!.rest).toEqual(source.rigs[0]!.nodes[1]!.rest);
    rejects(source, 'stale', s => applyDeletion(s, { kind: 'socket', rigId: 'r', id: 'nope' }));
  });
  it('removing the last constraint or limit drops the capability so older builds can open the project; declared-but-unused stays', () => {
    const source = chain(); source.requiredCapabilities.pop();
    expect(validateActorProject({ ...structuredClone(source), rigs: [{ ...structuredClone(source.rigs[0]!), constraints: [] }] }).ok).toBe(false);
    const limited = edit(source, s => setJointLimits(s, 'r', 't1', { minRotation: -1, maxRotation: 1 }));
    expect(limited.requiredCapabilities).toContain(RIG_CONSTRAINTS_CAPABILITY); expect(limited.rigs[0]!.nodes[1]!.limits).toEqual({ minRotation: -1, maxRotation: 1 });
    const ik = edit(limited, s => addCcdConstraint(s, 'r', 'ik', 'Reach', { effector: { kind: 'node', id: 't2' }, chainRootId: 't0', target: { kind: 'node', id: 'goal' }, iterations: 4, tolerance: .1 }));
    const cleared = edit(edit(ik, s => setJointLimits(s, 'r', 't1', null)), s => deleteConstraint(s, 'r', 'ik'));
    expect(saveActorProject(cleared)).toBe(saveActorProject(source));
    const declared = chain(), untouched = edit(declared, s => mirrorSubtree(s, 'r', 't2', (() => { let i = 0; return () => `m${i++}`; })()));
    expect(untouched.requiredCapabilities).toEqual(declared.requiredCapabilities);
    rejects(source, 'value', s => setJointLimits(s, 'r', 't1', { minRotation: 1, maxRotation: -1 }));
  });
});

describe('mirroring, proportions, joints and pose keys', () => {
  const limb = () => project({ id: 'r', name: 'Body', nodes: [
    { id: 'body', name: 'Body', parentId: null, rest: I({ x: 3, y: 1, rotation: .3 }) },
    { id: 'u', name: 'Upper', parentId: 'body', rest: I({ x: 1, y: .5, rotation: .4 }), limits: { minRotation: -.2, maxRotation: .9 } },
    { id: 'l', name: 'Lower', parentId: 'u', rest: I({ x: 2, rotation: -.7, scaleX: 1.5 }) },
  ], sockets: [{ id: 'tool', name: 'Tool socket', nodeId: 'l', transform: I({ x: 1, rotation: .2 }) }] }, {
    requiredCapabilities: ['spacelab:indexed-raster/1', 'spacelab:transform-clips/1', RIG_CONSTRAINTS_CAPABILITY],
    attachments: [{ id: 'paw', name: 'Paw', partId: 'dot', rigId: 'r', nodeId: 'l', drawOrder: 2, transform: I({ x: .5, y: .25, rotation: .1, scaleX: 2 }) }],
    clips: [{ id: 'c', name: 'Reach', duration: 2, playback: 'once', tracks: [{ id: 'tl', target: { kind: 'node', rigId: 'r', nodeId: 'l' }, interpolation: 'linear', keys: [{ time: 0, value: I({ x: 2 }) }, { time: 2, value: I({ x: 2, rotation: 1 }) }] }] }],
  });
  it('mirror-copies a subtree across the parent vertical axis with mirrored artwork, new IDs and untouched originals', () => {
    const source = limb(); let n = 0;
    const after = edit(source, s => mirrorSubtree(s, 'r', 'u', () => `copy-${n++}`));
    expect(after.rigs[0]!.nodes.slice(0, 3)).toEqual(source.rigs[0]!.nodes); expect(after.rigs[0]!.nodes).toHaveLength(5);
    const copy = after.rigs[0]!.nodes[3]!; expect(copy).toEqual({ id: 'copy-0', name: 'Upper (mirror)', parentId: 'body', rest: I({ x: -1, y: .5, rotation: -.4 }), limits: { minRotation: -.9, maxRotation: .2 } });
    // Mirror image in body space: body^-1 * W' == F * body^-1 * W for every point.
    const body = world(source, 'node', 'body'), inv = (m: number[]) => { const d = m[0]! * m[3]! - m[1]! * m[2]!; return [m[3]! / d, -m[1]! / d, -m[2]! / d, m[0]! / d, (m[2]! * m[5]! - m[3]! * m[4]!) / d, (m[1]! * m[4]! - m[0]! * m[5]!) / d]; };
    const mul = (p: number[], q: number[]) => [p[0]! * q[0]! + p[2]! * q[1]!, p[1]! * q[0]! + p[3]! * q[1]!, p[0]! * q[2]! + p[2]! * q[3]!, p[1]! * q[2]! + p[3]! * q[3]!, p[0]! * q[4]! + p[2]! * q[5]! + p[4]!, p[1]! * q[4]! + p[3]! * q[5]! + p[5]!];
    const F = [-1, 0, 0, 1, 0, 0];
    close(mul(inv(body), world(after, 'attachment', after.attachments[1]!.id)), mul(F, mul(inv(body), world(source, 'attachment', 'paw'))));
    const socket = after.rigs[0]!.sockets[1]!, original = mul(inv(body), world(source, 'socket', 'tool')), mirrored = mul(inv(body), world(after, 'socket', socket.id));
    close([mirrored[4]!, mirrored[5]!], [-original[4]!, original[5]!]);
    expect(after.clips).toEqual(source.clips); expect(new Set([...after.rigs[0]!.nodes.map(x => x.id)]).size).toBe(5);
  });
  it('scales segment offsets and keyed translations, and moves a joint while children keep rest world positions', () => {
    const source = limb(), scaled = edit(source, s => scaleSegmentOffsets(s, 'r', 'u', 2));
    expect(scaled.rigs[0]!.nodes[2]!.rest).toEqual(I({ x: 4, rotation: -.7, scaleX: 1.5 })); expect(scaled.rigs[0]!.nodes[1]!.rest).toEqual(source.rigs[0]!.nodes[1]!.rest);
    expect(scaled.rigs[0]!.sockets[0]!.transform.x).toBe(2); expect(scaled.attachments[0]!.transform).toEqual(I({ x: 1, y: .5, rotation: .1, scaleX: 2 }));
    expect(scaled.clips[0]!.tracks[0]!.keys.map(k => k.value.x)).toEqual([4, 4]);
    expect(() => edit(source, s => scaleSegmentOffsets(s, 'r', 'u', 0))).toThrow(ActorEditError);
    const moved = edit(source, s => moveJoint(s, 'r', 'l', .25, -.5));
    expect(moved.rigs[0]!.nodes[2]!.rest.x).toBe(2.25); expect(moved.clips[0]!.tracks[0]!.keys.map(k => k.value.y)).toEqual([-.5, -.5]);
    for (const [kind, id] of [['socket', 'tool'], ['attachment', 'paw']] as const) { const a = world(moved, kind, id), b = world(source, kind, id); close([a[4]!, a[5]!], [b[4]!, b[5]!]); }
    rejects(edit(source, s => { s.rigs[0]!.nodes[2]!.rest.scaleX = 0; }), 'singular', s => moveJoint(s, 'r', 'l', 1, 0));
  });
  it('pose keys replace, insert in order or create a track without touching rest or other keys', () => {
    const source = limb(), value = I({ x: 9, rotation: 4 * Math.PI });
    const replaced = edit(source, s => expect(setPoseKey(s, 'c', { kind: 'node', rigId: 'r', nodeId: 'l' }, 2, value, () => 'x')).toBe('replaced'));
    expect(replaced.clips[0]!.tracks[0]!.keys[1]!.value).toEqual(value); expect(replaced.rigs).toEqual(source.rigs);
    const inserted = edit(source, s => setPoseKey(s, 'c', { kind: 'node', rigId: 'r', nodeId: 'l' }, .5, value, () => 'x'));
    expect(inserted.clips[0]!.tracks[0]!.keys.map(k => k.time)).toEqual([0, .5, 2]);
    const created = edit(source, s => setPoseKey(s, 'c', { kind: 'attachment', attachmentId: 'paw' }, 1, value, () => 'new-track'));
    expect(created.clips[0]!.tracks[1]).toEqual({ id: 'new-track', target: { kind: 'attachment', attachmentId: 'paw' }, interpolation: 'linear', keys: [{ time: 1, value }] });
    rejects(source, 'time', s => setPoseKey(s, 'c', { kind: 'node', rigId: 'r', nodeId: 'l' }, 3, value, () => 'x'));
  });
  it('reports values outside optional limits without clamping authored data', () => {
    const source = limb(); source.rigs[0]!.nodes[1]!.rest.rotation = 2;
    source.clips[0]!.tracks.push({ id: 'tu', target: { kind: 'node', rigId: 'r', nodeId: 'u' }, interpolation: 'step', keys: [{ time: 0, value: I({ rotation: -1 }) }] });
    expect(rigDiagnostics(source)).toEqual(['Body / Upper: rest rotation 2 is outside its limits.', 'Body / Upper: key 0 in Reach is outside its limits (kept as authored).']);
    const c = compileActorProject(source), pose = createActorPose(c); evaluateActorPose(c, 'c', 0, pose);
    expect(pose.localTRS[slotOf(c, 'node', 'u') * 5 + 2]).toBe(-1);
  });
});

describe('visual CCD constraints', () => {
  const ccd = (o: Partial<ActorRig> = {}, settings: Record<string, unknown> = {}): ActorProject => project({ id: 'r', name: 'Arm', nodes: [
    { id: 'j0', name: 'Shoulder', parentId: null, rest: I() },
    { id: 'j1', name: 'Elbow', parentId: 'j0', rest: I({ x: 1 }) },
    { id: 'tip', name: 'Tip', parentId: 'j1', rest: I({ x: 1 }) },
    { id: 'goal', name: 'Goal', parentId: null, rest: I({ x: 1, y: 1 }) },
  ], sockets: [], constraints: [{ id: 'ik', name: 'Reach', solver: CCD_CHAIN_SOLVER, enabled: true, settings: { effector: { kind: 'node', id: 'tip' }, chainRootId: 'j0', target: { kind: 'node', id: 'goal' }, iterations: 32, tolerance: 1e-6, ...settings } as never }], ...o },
  { requiredCapabilities: ['spacelab:indexed-raster/1', 'spacelab:transform-clips/1', RIG_CONSTRAINTS_CAPABILITY] });
  function solved(source: ActorProject, constraints = true) {
    const c = compileActorProject(source), pose = createActorPose(c); evaluateActorPose(c, null, 0, pose, constraints);
    const at = (id: string) => { const i = slotOf(c, 'node', id) * 6; return [pose.worldMatrices[i + 4]!, pose.worldMatrices[i + 5]!]; };
    return { c, pose, at };
  }
  it('reaches a reachable target: independent two-link geometry (elbow at (1,0) or (0,1)) and tolerance residual', () => {
    const { pose, at } = solved(ccd()), tip = at('tip'), elbow = at('j1');
    close(tip, [1, 1], 5); expect(pose.constraintResiduals[0]).toBeLessThanOrEqual(1e-6);
    expect(Math.hypot(elbow[0]!, elbow[1]!)).toBeCloseTo(1, 9); expect(Math.hypot(tip[0]! - elbow[0]!, tip[1]! - elbow[1]!)).toBeCloseTo(1, 9);
    expect(Math.min(Math.hypot(elbow[0]! - 1, elbow[1]!), Math.hypot(elbow[0]!, elbow[1]! - 1))).toBeLessThan(1e-4);
  });
  it('stretches toward an unreachable target, reports the residual and keeps the final iterate deterministic', () => {
    const source = ccd(); source.rigs[0]!.nodes[3]!.rest = I({ y: 5 });
    const a = solved(source), b = solved(source);
    close(a.at('tip'), [0, 2], 6); expect(a.pose.constraintResiduals[0]).toBeCloseTo(3, 6);
    expect(Array.from(a.pose.worldMatrices)).toEqual(Array.from(b.pose.worldMatrices)); expect(Array.from(a.pose.localTRS)).toEqual(Array.from(b.pose.localTRS));
  });
  it('clamps only joints it moves to optional limits; disabled, raw and unsupported paths leave the FK pose with NaN residuals', () => {
    const limited = ccd(); limited.rigs[0]!.nodes[0]!.limits = { minRotation: 0, maxRotation: Math.PI / 8 }; limited.rigs[0]!.nodes[1]!.limits = { minRotation: 0, maxRotation: 0 };
    limited.rigs[0]!.nodes[3]!.rest = I({ y: 2 });
    const l = solved(limited); expect(l.pose.localTRS[slotOf(l.c, 'node', 'j0') * 5 + 2]).toBeCloseTo(Math.PI / 8, 12); expect(l.pose.localTRS[slotOf(l.c, 'node', 'j1') * 5 + 2]).toBe(0);
    close(l.at('tip'), [2 * Math.cos(Math.PI / 8), 2 * Math.sin(Math.PI / 8)]);
    const raw = solved(ccd(), false); close(raw.at('tip'), [2, 0]); expect(raw.pose.constraintResiduals[0]).toBeNaN();
    const disabled = ccd(); disabled.rigs[0]!.constraints![0]!.enabled = false;
    const d = solved(disabled); close(d.at('tip'), [2, 0]); expect(d.pose.constraintResiduals[0]).toBeNaN(); expect(d.c.constraints[0]!.status).toBe('disabled');
    const foreign = ccd(); foreign.rigs[0]!.constraints![0] = { id: 'spring', name: 'Spring', solver: 'vendor:spring/1', enabled: true, settings: { anything: [1, { nested: true }] } };
    const f = solved(foreign); close(f.at('tip'), [2, 0]); expect(f.c.constraints[0]).toEqual({ rigId: 'r', id: 'spring', solver: 'vendor:spring/1', status: 'unsupported' });
    const reopened = openActorProject(saveActorProject(foreign)); expect(reopened.ok && saveActorProject(reopened.source)).toBe(saveActorProject(foreign));
    expect(validateActorProject({ ...foreign, requiredCapabilities: [...foreign.requiredCapabilities, 'vendor:spring/1'] }).ok).toBe(false);
  });
  it('revises a built-in constraint in place (ID, order, enabled kept) and refuses to rewrite unsupported settings', () => {
    const source = ccd(); source.rigs[0]!.constraints!.push({ id: 'spring', name: 'Spring', solver: 'vendor:spring/1', enabled: false, settings: [1, 2] });
    const after = edit(edit(source, s => setConstraintEnabled(s, 'r', 'ik', false)), s => updateCcdConstraint(s, 'r', 'ik', 'Reach again', { effector: { kind: 'node', id: 'tip' }, chainRootId: 'j1', target: { kind: 'node', id: 'goal' }, iterations: 3, tolerance: .5 }));
    expect(after.rigs[0]!.constraints!.map(c => [c.id, c.name, c.enabled])).toEqual([['ik', 'Reach again', false], ['spring', 'Spring', false]]);
    expect(after.rigs[0]!.constraints![0]!.settings).toMatchObject({ chainRootId: 'j1', iterations: 3 });
    rejects(source, 'unsupported', s => updateCcdConstraint(s, 'r', 'spring', 'x', after.rigs[0]!.constraints![0]!.settings as never));
    expect(() => edit(source, s => updateCcdConstraint(s, 'r', 'ik', 'Bad', { effector: { kind: 'node', id: 'tip' }, chainRootId: 'tip', target: { kind: 'node', id: 'goal' }, iterations: 3, tolerance: .5 }))).toThrow();
  });
  it('accepts a replacement solver through the registry and binds it into compiled identity', () => {
    const foreign = ccd(); foreign.rigs[0]!.constraints![0] = { id: 'spin', name: 'Spin', solver: 'vendor:spin/1', enabled: true, settings: { turn: Q } };
    const spin: ActorConstraintSolver = { id: 'vendor:spin/1', version: '3', prepare: (constraint, rig) => {
      const slot = rig.nodeSlot('j0'), turn = (constraint.settings as { turn: number }).turn;
      return { firstSlot: slot, solve: (pose, update, residual) => { pose.localTRS[slot * 5 + 2] = turn; update.recompose(pose, slot); pose.constraintResiduals[residual] = 0; } };
    } };
    const c = compileActorProject(foreign, {}, { solvers: [spin] }), pose = createActorPose(c); evaluateActorPose(c, null, 0, pose);
    expect(c.constraints[0]!.status).toBe('active'); close(Array.from(pose.worldMatrices.slice(slotOf(c, 'node', 'tip') * 6 + 4, slotOf(c, 'node', 'tip') * 6 + 6)), [0, 2]);
    expect(c.identity).not.toBe(compileActorProject(foreign).identity); expect(JSON.parse(c.identity).options.solvers).toContain('vendor:spin/1@3');
  });
  it('handles reflected and singular parents, zero-length segments and socket effectors without NaN', () => {
    const mirrored = ccd(); mirrored.rigs[0]!.nodes.unshift({ id: 'flip', name: 'Flip', parentId: null, rest: I({ scaleX: -1 }) }); mirrored.rigs[0]!.nodes[1]!.parentId = 'flip';
    mirrored.rigs[0]!.nodes[4]!.rest = I({ x: -1, y: 1 });
    const m = solved(mirrored); close(m.at('tip'), [-1, 1], 5); expect(m.pose.constraintResiduals[0]).toBeLessThanOrEqual(1e-6);
    const collapsed = structuredClone(mirrored); collapsed.rigs[0]!.nodes[0]!.rest = I({ scaleX: 0 });
    const s = solved(collapsed); expect(Array.from(s.pose.localTRS)).toEqual(Array.from(solved(collapsed, false).pose.localTRS)); expect(s.pose.constraintResiduals[0]).toBeCloseTo(Math.SQRT2, 12);
    const zero = ccd(); zero.rigs[0]!.nodes[1]!.rest = I(); zero.rigs[0]!.nodes[2]!.rest = I();
    const z = solved(zero); expect(Array.from(z.pose.worldMatrices).every(Number.isFinite)).toBe(true); expect(z.pose.constraintResiduals[0]).toBeCloseTo(Math.SQRT2, 12);
    const socket = ccd({ sockets: [{ id: 'claw', name: 'Claw', nodeId: 'j1', transform: I({ x: 1 }) }] }, { effector: { kind: 'socket', id: 'claw' }, chainRootId: 'j0' });
    const k = solved(socket), i = slotOf(k.c, 'socket', 'claw') * 6; close([k.pose.worldMatrices[i + 4]!, k.pose.worldMatrices[i + 5]!], [1, 1], 5);
  });
  it('solves in declared order: rigs by stable ID, then source order, each seeing earlier results', () => {
    const source = ccd(); source.rigs[0]!.nodes.push({ id: 'arm2', name: 'Second', parentId: null, rest: I({ x: 5 }) }, { id: 'tip2', name: 'Tip 2', parentId: 'arm2', rest: I({ x: 1 }) });
    source.rigs[0]!.constraints!.push({ id: 'follow', name: 'Follow first tip', solver: CCD_CHAIN_SOLVER, enabled: true, settings: { effector: { kind: 'node', id: 'tip2' }, chainRootId: 'arm2', target: { kind: 'node', id: 'tip' }, iterations: 16, tolerance: 1e-9 } });
    const s = solved(source); expect(s.c.constraints.map(x => x.id)).toEqual(['ik', 'follow']);
    // After "ik" the tip is at (1,1); "follow" then points tip2 from (5,0) toward it.
    const tip2 = s.at('tip2'), dir = [1 - 5, 1 - 0], len = Math.hypot(dir[0]!, dir[1]!);
    close(tip2, [5 + dir[0]! / len, dir[1]! / len], 6);
  });
  it('public data example: the limited elbow turns +π/2 so the hand lands on the separate goal root', () => {
    const source = rigReachSource(); expect(validateActorProject(source).ok).toBe(true);
    const c = compileActorProject(source), pose = createActorPose(c); evaluateActorPose(c, null, 0, pose);
    const hand = slotOf(c, 'node', 'example:hand') * 6; close([pose.worldMatrices[hand + 4]!, pose.worldMatrices[hand + 5]!], [1, 1], 12);
    expect(pose.localTRS[slotOf(c, 'node', 'example:elbow') * 5 + 2]).toBeCloseTo(Q, 12); expect(pose.constraintResiduals[0]).toBeLessThanOrEqual(.001);
  });
  it('validates chain references, capability, budgets and keeps every pre-B1 project valid and canonical', () => {
    const bad = (mutate: (p: ActorProject) => void) => { const p = ccd(); mutate(p); return validateActorProject(p); };
    expect(bad(p => { (p.rigs[0]!.constraints![0]!.settings as { chainRootId: string }).chainRootId = 'tip'; })).toMatchObject({ ok: false, diagnostics: [{ code: 'reference' }] });
    expect(bad(p => { (p.rigs[0]!.constraints![0]!.settings as { target: unknown }).target = { kind: 'node', id: 'j1' }; })).toMatchObject({ ok: false, diagnostics: [{ code: 'reference' }] });
    expect(bad(p => { (p.rigs[0]!.constraints![0]!.settings as { iterations: number }).iterations = 65; })).toMatchObject({ ok: false, diagnostics: [{ code: 'range' }] });
    expect(bad(p => { p.requiredCapabilities.pop(); })).toMatchObject({ ok: false, diagnostics: [{ code: 'capability' }] });
    expect(validateActorProject(ccd(), { maxConstraintWork: 100 })).toMatchObject({ ok: false, diagnostics: [{ code: 'limit' }] });
    expect(bad(p => { (p.rigs[0]!.constraints![0]! as { enabled: unknown }).enabled = 1; })).toMatchObject({ ok: false });
    for (const name of ['empty', 'nonhuman', 'zero-bone', 'astronaut']) {
      const fixture = actorFixture(name); expect(validateActorProject(fixture).ok).toBe(true);
      expect(saveActorProject(fixture)).not.toContain('constraints'); expect(compileActorProject(fixture).constraints).toEqual([]);
    }
  });
});
