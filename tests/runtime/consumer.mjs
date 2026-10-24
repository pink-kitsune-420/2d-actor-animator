// Executed only from a fresh installed package, outside this repository.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import * as runtime from '@actor-animator/runtime';
import { createActors, transform } from './analytic-fixtures.mjs';
const {
  compileActorProject, createActorPose, evaluateActorPose, openActorProject, saveActorProject,
  validateActorProject, ActorProjectError, createActorAnimationPlayer, evaluateActorAnimation,
  requestActorAnimationState, trimActorAnimationHistory, describeActorAnimation,
} = runtime;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
const slot = (compiled, id) => {
  const i = compiled.slots.findIndex(s => s.id === id);
  assert.ok(i >= 0, `Missing ${id}`); return i;
};

test('selected exports only; no deep imports', async () => {
  assert.deepEqual(Object.keys(runtime).sort(), [
    'ACTOR_CURVES', 'ACTOR_PROJECT_CAPABILITIES', 'ANIMATION_COMPOSITION_CAPABILITY',
    'ActorProjectError', 'BLEND_STACK_CAP', 'CCD_CHAIN_SOLVER', 'CEL_TRACKS_CAPABILITY',
    'DEFAULT_ACTOR_PROJECT_LIMITS', 'EMOTE_AUTHORING_CAPABILITY', 'RIG_CONSTRAINTS_CAPABILITY',
    'actorEmoteCompatibility', 'compileActorProject', 'createActorAnimationPlayer', 'createActorPose',
    'describeActorAnimation', 'evaluateActorAnimation', 'evaluateActorPose', 'openActorProject',
    'requestActorAnimationState', 'sampleActorEmoteTime', 'saveActorProject',
    'trimActorAnimationHistory', 'validateActorProject',
  ].sort());
  await assert.rejects(import('@actor-animator/runtime/types/actor-tools/src/evaluator.js'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
});

test('independent closed-form world poses, multiple roots/rigs and retained buffers', () => {
  const { creature } = createActors(), compiled = compileActorProject(creature);
  const a = createActorPose(compiled), b = createActorPose(compiled);
  const buffers = Object.values(a), tip = slot(compiled, 'demo:tip'), root = slot(compiled, 'demo:hub');
  assert.equal(compiled.slots.length, 5);
  assert.equal(compiled.slots[slot(compiled, 'demo:free-root')].parent, -1);
  assert.equal(compiled.slots[slot(compiled, 'demo:spark')].parent, -1);
  assert.equal(compiled.compilerVersion, 'spacelab-actor-compiler/5');
  assert.ok(Object.isFrozen(compiled) && Object.isFrozen(compiled.parts[0].artwork.layers));
  assert.ok(a.worldMatrices instanceof Float64Array);
  evaluateActorPose(compiled, 'demo:orbit', 0.5, a);
  evaluateActorPose(compiled, 'demo:orbit', 1.5, b);
  // Independently derived: root=(1,2), tip at local (2,0), rotation pi*t/2.
  close(a.worldMatrices[tip * 6 + 4], 1 + Math.SQRT2);
  close(a.worldMatrices[tip * 6 + 5], 2 + Math.SQRT2);
  close(b.worldMatrices[tip * 6 + 4], 1 - Math.SQRT2);
  close(b.worldMatrices[tip * 6 + 5], 2 + Math.SQRT2);
  close(a.worldMatrices[root * 6], Math.SQRT1_2);
  close(a.worldMatrices[root * 6 + 1], Math.SQRT1_2);
  const untouched = b.worldMatrices.slice();
  for (let i = 0; i < 1000; i++) evaluateActorPose(compiled, 'demo:orbit', (i % 201) / 100, a);
  assert.deepEqual(b.worldMatrices, untouched);
  Object.values(a).forEach((buffer, i) => assert.equal(buffer, buffers[i]));
  assert.equal(buffers.reduce((n, buffer) => n + buffer.byteLength, 0), 754);
  console.log(JSON.stringify({ sample: 'antenna', slots: compiled.slots.length, compiledNumericBytes: compiled.numericBytes, poseNumericBytes: 754 }));
});

test('canonical editable source is independent of compile; layers, revision, alpha and extensions survive', () => {
  const { creature } = createActors();
  creature.extensions['demo:future'].signedZero = -0;
  const before = saveActorProject(creature), compiled = compileActorProject(creature);
  assert.equal(saveActorProject(creature), before);
  const opened = openActorProject(before); assert.equal(opened.ok, true);
  assert.deepEqual(opened.source, creature);
  assert.equal(saveActorProject(opened.source), before);
  assert.equal(Object.is(opened.source.extensions['demo:future'].signedZero, -0), true);
  opened.source.parts[0].artwork.layers[0].pixels[0] = 2;
  assert.equal(creature.parts[0].artwork.layers[0].pixels[0], 1);
  creature.parts[0].revision = 2; creature.parts[0].artwork.palette[1] = '#ffffff80';
  assert.equal(compiled.parts[0].revision, 1);
  assert.equal(compiled.parts[0].artwork.palette[1], '#f6ba45ff');
  assert.notEqual(compileActorProject(creature).identity, compiled.identity);
});

test('all frozen legacy project fixtures round trip without migration', () => {
  for (const name of readdirSync(new URL('./fixtures/', import.meta.url))) {
    const text = readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
    const original = JSON.parse(text), result = openActorProject(text);
    assert.equal(result.ok, true, name);
    assert.deepEqual(result.source, original, name);
    const saved = saveActorProject(result.source);
    assert.deepEqual(JSON.parse(saved), original, name);
    assert.equal(compileActorProject(result.source).compilerVersion, 'spacelab-actor-compiler/5');
  }
});

test('zero-bone and fully empty actors, negative loop times, explicit rest', () => {
  const { marker } = createActors(), compiled = compileActorProject(marker), pose = createActorPose(compiled);
  assert.deepEqual(compiled.slots.map(s => s.kind), ['attachment']);
  evaluateActorPose(compiled, 'demo:rise', -0.5, pose); close(pose.worldMatrices[5], 1.5);
  evaluateActorPose(compiled, 'demo:rise', 2, pose); close(pose.worldMatrices[5], 0);
  evaluateActorPose(compiled, null, 9, pose); close(pose.worldMatrices[5], 0);
  marker.parts = []; marker.attachments = []; marker.clips = [];
  const empty = compileActorProject(marker), emptyPose = createActorPose(empty);
  evaluateActorPose(empty, null, 0, emptyPose); assert.equal(emptyPose.worldMatrices.length, 0);
});

test('capability/format/limit diagnostics and foreign buffer errors are useful', () => {
  const { creature } = createActors();
  const bad = structuredClone(creature); bad.requiredCapabilities.push('future:unsupported/1');
  const result = validateActorProject(bad); assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, 'capability');
  assert.equal(result.diagnostics[0].path, '/requiredCapabilities/2');
  assert.throws(() => compileActorProject(bad), error => error instanceof ActorProjectError && error.diagnostic.code === 'capability');
  bad.format = 'future:project/2'; assert.equal(validateActorProject(bad).diagnostics[0].code, 'format');
  assert.equal(openActorProject('{').diagnostics[0].code, 'json');
  assert.equal(validateActorProject(creature, { maxNodes: 1 }).diagnostics[0].code, 'limit');
  assert.throws(() => validateActorProject(creature, { maxNodes: -1 }), RangeError);
  const c = compileActorProject(creature), pose = createActorPose(c), original = pose.worldMatrices.slice();
  assert.throws(() => evaluateActorPose(c, 'demo:missing', 0, pose), RangeError);
  assert.throws(() => evaluateActorPose(c, null, NaN, pose), RangeError);
  assert.throws(() => evaluateActorPose(compileActorProject(creature), null, 0, pose), TypeError);
  assert.deepEqual(pose.worldMatrices, original);
});

test('unknown solver stays inert with explicit unsupported status', () => {
  const { creature } = createActors();
  creature.requiredCapabilities.push('spacelab:rig-constraints/1');
  creature.rigs[0].constraints = [{ id: 'demo:future', name: 'Unknown visual constraint', enabled: true,
    solver: 'future:solver/1', settings: { kept: [3, 'no executable code'] } }];
  const text = saveActorProject(creature), c = compileActorProject(creature), pose = createActorPose(c);
  assert.equal(c.constraints[0].status, 'unsupported');
  assert.equal(Number.isNaN(pose.constraintResiduals[0]), true);
  assert.equal(saveActorProject(creature), text);
});

test('animation instances own history and capacity, can trim and seek from explicit origin', () => {
  const { creature } = createActors(); creature.requiredCapabilities.push('spacelab:animation-composition/1');
  creature.animators = [{ id: 'demo:animator', name: 'Motion', layers: [{ id: 'demo:layer', name: 'Base', blend: 'override',
    weight: 1, initialStateId: 'demo:moving', defaultTransition: { duration: 0, priority: 0 }, transitions: [], states: [
      { id: 'demo:moving', name: 'Moving', clipId: 'demo:orbit', rate: 1 },
      { id: 'demo:rest', name: 'Rest', clipId: null, rate: 1 },
    ] }] }];
  const c = compileActorProject(creature), a = createActorPose(c), b = createActorPose(c);
  const pa = createActorAnimationPlayer(c, 'demo:animator', { maxRequests: 1 }), pb = createActorAnimationPlayer(c, 'demo:animator');
  assert.equal(requestActorAnimationState(pa, 'demo:layer', 'demo:rest', 0.25), 'accepted');
  assert.equal(requestActorAnimationState(pa, 'demo:layer', 'demo:moving', 0.5), 'capacity');
  evaluateActorAnimation(c, pa, 0.5, a); evaluateActorAnimation(c, pb, 0.5, b);
  const tip = slot(c, 'demo:tip') * 6;
  close(a.worldMatrices[tip + 4], 3); close(a.worldMatrices[tip + 5], 2);
  close(b.worldMatrices[tip + 4], 1 + Math.SQRT2);
  assert.equal(describeActorAnimation(pb, 0.5).requests.length, 0);
  trimActorAnimationHistory(pa);
  assert.equal(requestActorAnimationState(pa, 'demo:layer', 'demo:moving', 0.75), 'accepted');
  assert.throws(() => evaluateActorAnimation(c, pa, 0.1, a), RangeError);
  assert.throws(() => evaluateActorAnimation(compileActorProject(creature), pb, 1, b), TypeError);
});

test('registered visual solver snapshots inert settings and identifies its host version', () => {
  const { creature } = createActors(); creature.requiredCapabilities.push('spacelab:rig-constraints/1');
  creature.rigs[0].constraints = [{ id: 'demo:offset', name: 'Visual offset', enabled: true, solver: 'demo:offset/1', settings: { offset: 3 } }];
  let prepared = 0;
  const solver = {
    id: 'demo:offset/1', version: '1',
    prepare(constraint, rig) {
      prepared++; assert.ok(Object.isFrozen(constraint.settings));
      const root = rig.nodeSlot('demo:hub'), offset = constraint.settings.offset;
      return { firstSlot: root, solve(pose, update, residual) {
        pose.localTRS[root * 5] += offset; update.recompose(pose, root); pose.constraintResiduals[residual] = 0;
      } };
    },
  };
  const c = compileActorProject(creature, {}, { solvers: [solver] }), pose = createActorPose(c);
  assert.equal(prepared, 1); assert.equal(c.constraints[0].status, 'active');
  const tip = slot(c, 'demo:tip') * 6;
  close(pose.worldMatrices[tip + 4], 6); close(pose.worldMatrices[tip + 5], 2);
  creature.rigs[0].constraints[0].settings.offset = 99;
  evaluateActorPose(c, null, 0, pose); close(pose.worldMatrices[tip + 4], 6);
  evaluateActorPose(c, null, 0, pose, false); close(pose.worldMatrices[tip + 4], 3);
  assert.equal(Number.isNaN(pose.constraintResiduals[0]), true);
  const original = createActors().creature; original.requiredCapabilities.push('spacelab:rig-constraints/1');
  original.rigs[0].constraints = [{ id: 'demo:offset', name: 'Visual offset', enabled: true, solver: 'demo:offset/1', settings: { offset: 3 } }];
  const versionTwo = compileActorProject(original, {}, { solvers: [{ ...solver, version: '2' }] });
  assert.notEqual(c.identity, versionTwo.identity);
});

test('optional choreography helper uses explicit seconds and retained output', () => {
  const { creature } = createActors();
  assert.equal(runtime.actorEmoteCompatibility(creature, creature, 'demo:signal').code, 'missing-emote');
  creature.requiredCapabilities.push('spacelab:emote-authoring/1');
  const role = { id: 'demo:solo', label: 'Solo', clipId: 'demo:orbit', rigId: 'demo:antenna', socketBindings: {}, start: 0.25, rate: 2, placement: transform() };
  const emote = { id: 'demo:signal', label: 'Antenna signal', revision: 1, duration: 2, playback: 'loop', interruptPriority: 0, roles: [role] };
  creature.emotes = [emote]; assert.equal(validateActorProject(creature).ok, true);
  assert.equal(runtime.actorEmoteCompatibility(creature, structuredClone(creature), emote.id).ok, true);
  const into = new Float64Array(2);
  runtime.sampleActorEmoteTime(emote, role, -0.5, into);
  assert.deepEqual(Array.from(into), [3.25, 1.5]);
  assert.throws(() => runtime.sampleActorEmoteTime(emote, role, Infinity, into), RangeError);
});

test('zero and negative scales are representable in scene artwork', () => {
  const { marker } = createActors(); marker.attachments[0].transform = { ...transform(3, 4), scaleX: -2, scaleY: 0 };
  const c = compileActorProject(marker), pose = createActorPose(c);
  assert.deepEqual(Array.from(pose.worldMatrices), [-2, -0, -0, 0, 3, 4]);
});
