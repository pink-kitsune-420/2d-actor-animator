import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { SPACELAB_ACTOR_SOURCE_PROFILE as profile, inspectSpaceLabActorSource, exportSpaceLabActorSource } from '@actor-animator/runtime/spacelab';
import { compileActorProject, createActorPose, evaluateActorPose, saveActorProject, openActorProject } from '@actor-animator/runtime';
import { createActors } from './actors.mjs';
const options = { profile: profile.id }, beacon = readFileSync(new URL('./beacon.actorproject', import.meta.url), 'utf8');
test('installed optional profile preserves full original sources and source-value round trips', () => {
  for (const input of [beacon, JSON.stringify(createActors().creature), ...['astronaut', 'classic-astronaut-b3', 'nonhuman', 'zero-bone'].map(name => readFileSync(new URL(`./fixtures/${name}.project.json`, import.meta.url), 'utf8'))]) {
    const start = performance.now(), result = exportSpaceLabActorSource(input, options), exported = performance.now();
    assert.equal(result.ok, true); assert.equal(result.text, input);
    assert.deepEqual(openActorProject(saveActorProject(result.source)).source, result.source);
    assert.equal(result.report.liveGame, 'unverified'); assert.equal(result.report.gameProvider, 'not-implemented');
    const compileStart = performance.now(), compiled = compileActorProject(result.source), compiledAt = performance.now(), a = createActorPose(compiled), b = createActorPose(compiled);
    evaluateActorPose(compiled, null, 0, a); evaluateActorPose(compiled, null, 0, b);
    assert.notEqual(a.worldMatrices, b.worldMatrices);
    console.log(JSON.stringify({ id: result.source.id, utf8Bytes: Buffer.byteLength(input), parts: result.source.parts.length, rigs: result.source.rigs.length, clips: result.source.clips.length, exportAdmissionMs: exported-start, compileMs: compiledAt-compileStart, numericBytes: compiled.numericBytes }));
  }
});
test('installed profile refuses unknown required contracts and limits atomically', () => {
  assert.equal(inspectSpaceLabActorSource('invalid', { profile: 'live-game/1' }).diagnostics[0].code, 'profile-version');
  for (const change of [s => s.format = 'spacelab-actor-project/2', s => s.requiredCapabilities.push('future:mesh/1'), s => s.units.angle = 'degrees']) {
    const source = JSON.parse(beacon); change(source); const input = JSON.stringify(source);
    const result = exportSpaceLabActorSource(input, options); assert.equal(result.ok, false); assert.equal('text' in result, false); assert.equal(JSON.stringify(source), input);
  }
  assert.equal(inspectSpaceLabActorSource(beacon, { ...options, limits: { maxParts: 1 } }).ok, false);
});
test('installed profile and runtime reproduce independent fractional cel and asymmetric transform samples', () => {
  const result = inspectSpaceLabActorSource(beacon, options); assert.equal(result.ok, true);
  const c = compileActorProject(result.source), a = createActorPose(c), b = createActorPose(c), slot = c.slots.findIndex(s => s.kind === 'attachment');
  evaluateActorPose(c, 'profile:pulse', .75, a); evaluateActorPose(c, 'profile:pulse', .499, b);
  assert.deepEqual(Array.from(a.worldMatrices.slice(slot*6, slot*6+6)), [1, 0, -0, 1, 3.25, .75]);
  assert.equal(b.worldMatrices[slot*6+4], 1.25); assert.equal(c.parts[a.partIndices[slot]].id, 'profile:alternate');
  const creature = inspectSpaceLabActorSource(JSON.stringify(createActors().creature), options), n = compileActorProject(creature.source), pose = createActorPose(n);
  evaluateActorPose(n, 'demo:orbit', .5, pose);
  const tip = n.slots.findIndex(s => s.id === 'demo:tip')*6;
  assert.ok(Math.abs(pose.worldMatrices[tip+4] - (1+Math.SQRT2)) < 1e-12);
  assert.ok(Math.abs(pose.worldMatrices[tip+5] - (2+Math.SQRT2)) < 1e-12);
});
test('installed profile retains curved turns, masks, additive reference and emote definitions', () => {
  const s = JSON.parse(beacon), track = s.clips[0].tracks[0];
  track.interpolation = 'linear'; track.angle = 'shortest';
  track.keys = [
    { time: .125, value: { x: 1.25, y: .75, rotation: 0, scaleX: 1, scaleY: 1 }, curve: 'cubic-bezier', bezier: [.9,2,.1,2], turns: 1 },
    { time: .625, value: { x: 3.25, y: .75, rotation: 0, scaleX: 1, scaleY: 1 } },
  ];
  s.requiredCapabilities.push('spacelab:emote-authoring/1');
  s.emotes = [{ id: 'profile:emote', label: 'Signal', revision: 4, duration: 1, playback: 'once', interruptPriority: 0,
    roles: [{ id: 'profile:role', label: 'Beacon', clipId: 'profile:pulse', rigId: null, socketBindings: {}, start: .125, rate: .5, placement: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 } }] }];
  s.animators = [{ id: 'profile:stack', name: 'Stack', layers: [{
    id: 'profile:add', name: 'Add', blend: 'additive', weight: .25,
    mask: [{ kind: 'attachment', attachmentId: 'profile:art' }], reference: { clipId: 'profile:pulse', time: .125 },
    initialStateId: 'profile:state', defaultTransition: { duration: .125, priority: 2 },
    states: [{ id: 'profile:state', name: 'Pulse', clipId: 'profile:pulse', rate: .5 }], transitions: [],
  }] }];
  const text = JSON.stringify(s), result = exportSpaceLabActorSource(text, options);
  assert.equal(result.ok, true); assert.equal(result.text, text); assert.deepEqual(result.source, s);
  const compiled = compileActorProject(result.source), pose = createActorPose(compiled), slot = compiled.slots.findIndex(s => s.kind === 'attachment');
  evaluateActorPose(compiled, 'profile:pulse', .375, pose);
  // Crossed symmetric X has s=.5 at elapsed .5. Y=.75*2+.125=1.625.
  assert.ok(Math.abs(pose.localTRS[slot*5] - 4.5) < 1e-10);
  assert.ok(Math.abs(pose.localTRS[slot*5+2] - 3.25*Math.PI) < 1e-10);
  evaluateActorPose(compiled, 'profile:pulse', .625, pose);
  assert.equal(pose.localTRS[slot*5+2], 0); // exact authored endpoint, extra turns do not rewrite keys
});
