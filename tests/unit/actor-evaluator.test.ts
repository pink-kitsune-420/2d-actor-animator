import { describe, expect, it } from 'vitest';
import {
  compileActorProject, createActorPose, evaluateActorPose,
  type ActorPose, type CompiledActorProject,
} from '../../packages/actor-tools/src';
import { actorFixture } from '../helpers/actor-project';

function matrix(compiled: CompiledActorProject, pose: ActorPose, id: string): number[] {
  const slot = compiled.slots.findIndex(s => s.id === id);
  expect(slot).toBeGreaterThanOrEqual(0);
  return Array.from(pose.worldMatrices.subarray(slot * 6, slot * 6 + 6));
}
function close(actual: readonly number[], expected: readonly number[]) {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((v, i) => expect(actual[i]).toBeCloseTo(v, 12));
}

describe('pure retained actor pose evaluation', () => {
  it('matches an independent tail oracle at rest, midpoint, once-end and loop boundary', () => {
    const source = actorFixture(), compiled = compileActorProject(source), pose = createActorPose(compiled);
    close(matrix(compiled, pose, 'example:tail-2'), [1, 0, 0, 1, 4, 3]);
    evaluateActorPose(compiled, 'example:turn', 1, pose);
    close(matrix(compiled, pose, 'example:tail-2'), [0, 1, -1, 0, 2, 5]);
    evaluateActorPose(compiled, 'example:turn', 2, pose);
    close(matrix(compiled, pose, 'example:tail-2'), [-1, 0, 0, -1, 0, 3]);
    source.clips[0]!.playback = 'loop';
    const looping = compileActorProject(source), loopPose = createActorPose(looping);
    evaluateActorPose(looping, 'example:turn', 2, loopPose);
    close(matrix(looping, loopPose, 'example:tail-2'), [1, 0, 0, 1, 4, 3]);
    evaluateActorPose(looping, 'example:turn', -1, loopPose);
    close(matrix(looping, loopPose, 'example:tail-2'), [0, 1, -1, 0, 2, 5]);
  });

  it('preserves geometry/slots after renaming and reordering nodes, parts and attachments', () => {
    const source = actorFixture('astronaut'), original = compileActorProject(source), a = createActorPose(original);
    source.name = 'Another label'; source.parts.reverse(); source.rigs[0]!.nodes.reverse(); source.attachments.reverse();
    source.rigs[0]!.nodes.forEach(n => { n.name = 'Renamed'; });
    const reordered = compileActorProject(source), b = createActorPose(reordered);
    expect(reordered.slots).toEqual(original.slots); expect(reordered.drawSlots).toEqual(original.drawSlots);
    evaluateActorPose(original, 'example:wave', 0.7, a); evaluateActorPose(reordered, 'example:wave', 0.7, b);
    expect(a.worldMatrices).toEqual(b.worldMatrices);
  });

  it('composes T*R*S in parent frames, including shear without decomposing', () => {
    const source = actorFixture(), rig = source.rigs[0]!;
    rig.nodes[0]!.rest = { x: 10, y: 20, rotation: Math.PI / 2, scaleX: 2, scaleY: 3 };
    rig.nodes.find(n => n.id === 'example:tail-1')!.rest = { x: 1, y: 2, rotation: Math.PI / 4, scaleX: 1, scaleY: 1 };
    const compiled = compileActorProject(source), pose = createActorPose(compiled), s = Math.SQRT1_2;
    close(matrix(compiled, pose, 'example:tail-1'), [-3 * s, 2 * s, -3 * s, -2 * s, 4, 22]);
    // Dot product of columns is nonzero: inherited nonuniform scale retains shear.
    const m = matrix(compiled, pose, 'example:tail-1'); expect(m[0]! * m[2]! + m[1]! * m[3]!).toBeCloseTo(2.5, 12);
  });

  it('composes cosmetic sockets and attached artwork independently of separate roots', () => {
    const source = actorFixture(), compiled = compileActorProject(source), pose = createActorPose(compiled);
    evaluateActorPose(compiled, 'example:turn', 1, pose);
    close(matrix(compiled, pose, 'example:tool-socket'), [0, 1, -1, 0, 2, 4]);
    close(matrix(compiled, pose, 'example:art-tail-2'), [0, 1, -1, 0, 2, 5]);
    close(matrix(compiled, pose, 'example:detached'), [1, 0, 0, 1, -1, 1]);
  });

  it('animates zero-bone scene artwork and admits completely empty projects', () => {
    const compiled = compileActorProject(actorFixture('zero-bone')), pose = createActorPose(compiled);
    expect(compiled.slots).toEqual([{ kind: 'attachment', id: 'example:marker', partId: 'example:segment', parent: -1 }]);
    evaluateActorPose(compiled, 'example:pulse', 1, pose);
    close(matrix(compiled, pose, 'example:marker'), [1, 0, 0, 1, 0, 0.5]);
    const empty = compileActorProject(actorFixture('empty')), emptyPose = createActorPose(empty);
    evaluateActorPose(empty, null, -5, emptyPose); expect(emptyPose.worldMatrices.length).toBe(0);
  });

  it('holds missing endpoints, clamps once, selects exact step keys and has no invented loop seam', () => {
    const source = actorFixture('zero-bone'), clip = source.clips[0]!, keys = clip.tracks[0]!.keys;
    keys[0]!.time = 0.5; keys[1]!.time = 1.5;
    clip.tracks[0]!.interpolation = 'step';
    let compiled = compileActorProject(source), pose = createActorPose(compiled);
    for (const [time, y] of [[0, 0], [1.49, 0], [1.5, 1], [1.99, 1], [2, 0], [-0.25, 1]]) {
      evaluateActorPose(compiled, clip.id, time!, pose); expect(pose.localTRS[1]).toBe(y);
    }
    clip.playback = 'once'; clip.tracks[0]!.interpolation = 'linear';
    compiled = compileActorProject(source); pose = createActorPose(compiled);
    for (const [time, y] of [[-100, 0], [0, 0], [1, 0.5], [2, 1], [100, 1]]) {
      evaluateActorPose(compiled, clip.id, time!, pose); expect(pose.localTRS[1]).toBe(y);
    }
  });

  it('interpolates every component and preserves authored full turns, negative and zero scale', () => {
    const source = actorFixture('zero-bone');
    source.clips[0]!.tracks[0]!.keys[1]!.value = { x: 4, y: 2, rotation: 4 * Math.PI, scaleX: -1, scaleY: 3 };
    const compiled = compileActorProject(source), pose = createActorPose(compiled);
    evaluateActorPose(compiled, 'example:pulse', 1, pose);
    close(Array.from(pose.localTRS), [2, 1, 2 * Math.PI, 0, 2]);
    close(matrix(compiled, pose, 'example:marker'), [0, 0, 0, 2, 2, 1]);
  });

  it('resets missing tracks, all buffers and backward seeks instead of leaking prior poses', () => {
    const source = actorFixture(); source.clips.push({ id: 'other:idle', name: 'No tracks', duration: 1, playback: 'loop', tracks: [] });
    const compiled = compileActorProject(source), pose = createActorPose(compiled), rest = Array.from(pose.worldMatrices);
    evaluateActorPose(compiled, 'example:turn', 1.5, pose); evaluateActorPose(compiled, 'example:turn', 0, pose);
    expect(Array.from(pose.worldMatrices)).toEqual(rest);
    pose.localTRS.fill(NaN); pose.localMatrices.fill(NaN); pose.worldMatrices.fill(NaN);
    evaluateActorPose(compiled, 'other:idle', 10, pose); expect(Array.from(pose.worldMatrices)).toEqual(rest);
    evaluateActorPose(compiled, 'example:turn', 1, pose); evaluateActorPose(compiled, null, 0, pose);
    expect(Array.from(pose.worldMatrices)).toEqual(rest);
  });

  it('snapshots immutable compiled resources and keeps instances independent', () => {
    const source = actorFixture(), compiled = compileActorProject(source), a = createActorPose(compiled), b = createActorPose(compiled);
    const before = Array.from(b.worldMatrices), arrays = [a.localTRS, a.localMatrices, a.worldMatrices];
    source.rigs[0]!.nodes[0]!.rest.x = 100; source.clips[0]!.tracks[0]!.keys[1]!.value.x = 100;
    expect(Object.isFrozen(compiled)).toBe(true); expect(Object.isFrozen(compiled.slots[0])).toBe(true);
    expect(Object.isFrozen(compiled.parts[0]!.artwork.layers[0]!.pixels)).toBe(true);
    for (let i = 0; i < 1000; i++) evaluateActorPose(compiled, 'example:turn', i / 500, a);
    expect([a.localTRS, a.localMatrices, a.worldMatrices]).toEqual(arrays);
    expect(Array.from(b.worldMatrices)).toEqual(before); expect(a.localTRS.buffer).not.toBe(b.localTRS.buffer);
    evaluateActorPose(compiled, 'example:turn', 1, a); close(matrix(compiled, a, 'example:tail-2'), [0, 1, -1, 0, 2, 5]);
    expect(Object.values(compiled).some(v => ArrayBuffer.isView(v))).toBe(false);
  });

  it('binds cache identity to source, compiler/options and admission profile', () => {
    const source = actorFixture(), a = compileActorProject(source), b = compileActorProject(source);
    expect(a.identity).toBe(b.identity);
    expect(compileActorProject(source, { maxParts: 255 }).identity).not.toBe(a.identity);
    source.extensions['vendor:metadata'] = { label: 'changed' };
    expect(compileActorProject(source).identity).not.toBe(a.identity);
    const identity = JSON.parse(a.identity); expect(identity.compiler).toBe(a.compilerVersion); expect(identity.options.matrices).toBe('float64-affine/1');
  });

  it('rejects unknown clips, invalid times, forged compiles and foreign instances before mutation', () => {
    const compiled = compileActorProject(actorFixture()), pose = createActorPose(compiled), before = Array.from(pose.worldMatrices);
    expect(() => evaluateActorPose(compiled, 'missing:clip', 0, pose)).toThrow(/Unknown actor clip/);
    for (const t of [NaN, Infinity, -Infinity]) expect(() => evaluateActorPose(compiled, null, t, pose)).toThrow(/finite seconds/);
    expect(() => evaluateActorPose(compileActorProject(actorFixture()), null, 0, pose)).toThrow(/belong/);
    expect(() => createActorPose({ ...compiled })).toThrow(/compiled project/);
    expect(Array.from(pose.worldMatrices)).toEqual(before);
  });

  it('handles extreme finite seek times and reports numerical composition overflow', () => {
    const source = actorFixture('zero-bone'); source.clips[0]!.duration = Number.MAX_VALUE;
    const compiled = compileActorProject(source), pose = createActorPose(compiled);
    evaluateActorPose(compiled, 'example:pulse', Number.MAX_VALUE, pose); expect(pose.localTRS[1]).toBe(0);
    evaluateActorPose(compiled, 'example:pulse', -2, pose); expect(pose.worldMatrices.every(Number.isFinite)).toBe(true);
    const huge = actorFixture(); huge.rigs[0]!.nodes[0]!.rest.scaleX = Number.MAX_VALUE;
    huge.rigs[0]!.nodes.find(n => n.id === 'example:tail-1')!.rest.scaleX = 2;
    expect(() => createActorPose(compileActorProject(huge))).toThrow(/Float64 range/);
  });
});
