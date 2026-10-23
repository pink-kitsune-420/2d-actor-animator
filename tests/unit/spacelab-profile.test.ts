import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SPACELAB_ACTOR_SOURCE_PROFILE as profile, inspectSpaceLabActorSource as inspect, exportSpaceLabActorSource as original } from '../../packages/adapters/spacelab/src/index';
import { compileActorProject, createActorPose, evaluateActorPose, saveActorProject } from '../../packages/runtime/src/index';
const options = { profile: profile.id };
const text = readFileSync(new URL('../../examples/spacelab/beacon.actorproject', import.meta.url), 'utf8');

describe('optional historical source profile', () => {
  it('preserves exact original text, layered revisions and detached editable data', () => {
    const input = text.replace('"rotation": 0', '"rotation": -0');
    const result = original(input, options);
    expect(result.ok).toBe(true);
    if (!result.ok) throw Error('admission');
    expect(result.text).toBe(input);
    expect(Object.is(result.source.attachments[0]!.transform.rotation, -0)).toBe(true);
    expect(result.source.parts.map(p => p.revision)).toEqual([7, 9]);
    expect(result.source.parts[0]!.artwork.palette[0]).toBe('#12345600');
    expect(result.report).toMatchObject({ editableSource: 'preserved', liveGame: 'unverified', gameProvider: 'not-implemented' });
    result.source.parts[0]!.revision = 100;
    expect(original(input, options)).toMatchObject({ text: input, source: { parts: [{ revision: 7 }, { revision: 9 }] } });
    const reopened = inspect(saveActorProject(JSON.parse(text)), options);
    expect(reopened.ok && reopened.source).toEqual(JSON.parse(text));
  });
  it('refuses profile/format/capability/units/limits without changing input', () => {
    expect(inspect('invalid JSON', { profile: 'actor-animator:spacelab-source/2' })).toMatchObject({ ok: false, diagnostics: [{ path: '/profile', code: 'profile-version' }] });
    for (const limits of [{ maxParts: 1 }, { maxJsonBytes: 10 }]) expect(inspect(text, { ...options, limits }).ok).toBe(false);
    for (const limits of [{ maxParts: 257 }, { maxParts: -1 }, { maxParts: 1.5 }, { 'bad/~': 1 }]) {
      const result = inspect(text, { ...options, limits });
      expect(result).toMatchObject({ ok: false, diagnostics: [{ code: 'profile-limit' }] });
    }
    const value = JSON.parse(text);
    for (const changed of [ { ...value, format: 'spacelab-actor-project/2' }, { ...value, requiredCapabilities: [...value.requiredCapabilities, 'future:shader/1'] }, { ...value, units: { ...value.units, time: 'frames' } } ]) {
      const input = JSON.stringify(changed), snapshot = input;
      expect(original(input, options).ok).toBe(false); expect(input).toBe(snapshot);
    }
    expect(Object.isFrozen(profile)).toBe(true); expect(Object.isFrozen(profile.capabilities)).toBe(true); expect(Object.isFrozen(profile.limits)).toBe(true);
  });
  it('preserves unknown solvers and extensions without claiming execution', () => {
    const value = JSON.parse(text);
    value.requiredCapabilities.push('spacelab:rig-constraints/1');
    value.rigs = [{ id: 'unknown:rig', name: 'Empty', nodes: [], sockets: [], constraints: [{ id: 'unknown:constraint', name: 'Inert', solver: 'unknown:solver/2', enabled: true, settings: { url: 'https://invalid.example/code', nested: [null, false] } }] }];
    const result = original(JSON.stringify(value), options);
    expect(result.ok).toBe(true);
    if (!result.ok) throw Error('admission');
    expect(result.source).toEqual(value);
    expect(result.report.warnings).toMatchObject([{ path: '/rigs/0/constraints/0/solver', code: 'unsupported-solver' }]);
    expect(compileActorProject(result.source).constraints[0]!.status).toBe('unsupported');
  });
  it('keeps fractional step/cel/visibility/order and ping-pong endpoints independent of source IO', () => {
    const result = inspect(text, options); if (!result.ok) throw Error('admission');
    const c = compileActorProject(result.source), a = createActorPose(c), b = createActorPose(c);
    const slot = c.slots.findIndex(s => s.kind === 'attachment');
    for (const [time, x, part, visible] of [[.499, 1.25, 'profile:ink', 1], [.5, 3.25, 'profile:ink', 1], [.75, 3.25, 'profile:alternate', 1], [.875, 3.25, 'profile:alternate', 0], [1.5, 3.25, 'profile:ink', 1], [2, 1.25, 'profile:ink', 1], [-.25, 1.25, 'profile:ink', 1]] as const) {
      evaluateActorPose(c, 'profile:pulse', time, a);
      expect(a.worldMatrices[slot*6+4]).toBe(x); expect(c.parts[a.partIndices[slot]!]!.id).toBe(part); expect(a.visible[slot]).toBe(visible);
    }
    evaluateActorPose(c, 'profile:pulse', .25, a); evaluateActorPose(c, null, 0, b);
    expect(a.drawOrders[slot]).toBe(-3); expect(b.drawOrders[slot]).toBe(4);
    expect(a.worldMatrices).not.toBe(b.worldMatrices);
  });
});
