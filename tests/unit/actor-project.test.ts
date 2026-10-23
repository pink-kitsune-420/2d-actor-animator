import { describe, expect, it } from 'vitest';
import {
  compileActorProject, DEFAULT_ACTOR_PROJECT_LIMITS, openActorProject,
  saveActorProject, validateActorProject, type ActorProjectLimits,
} from '../../packages/actor-tools/src';
import type { ActorProject } from '@actor-animator/types';
import { actorFixture } from '../helpers/actor-project';
import { markerSource } from '../../examples/modules/actor-project/src/source';

function rejected(raw: unknown, code: string, limits?: Partial<ActorProjectLimits>) {
  const result = validateActorProject(raw, limits);
  expect(result.ok).toBe(false);
  if (!result.ok) { expect(result.diagnostics).toHaveLength(1); expect(result.diagnostics[0]!.code).toBe(code); }
}

describe('actor project source admission and persistence', () => {
  it('admits the public data-only creator example', () => {
    const source = markerSource();
    expect(openActorProject(saveActorProject(source))).toEqual({ ok: true, source });
  });
  it.each(['empty', 'astronaut', 'nonhuman', 'zero-bone'])('round-trips every supported value in %s', name => {
    const source = actorFixture(name), before = structuredClone(source), saved = saveActorProject(source);
    const opened = openActorProject(saved);
    expect(opened).toEqual({ ok: true, source: before });
    expect(source).toEqual(before);
    if (opened.ok) { expect(opened.source).not.toBe(source); expect(saveActorProject(opened.source)).toBe(saved); }
    expect(() => compileActorProject(source)).not.toThrow();
  });

  it('preserves arbitrary IDs, labels, layer source and inert extension JSON including prototype-like keys', () => {
    const source = actorFixture('astronaut');
    source.id = 'my.studio:creature/🪐'; source.name = 'Changed display name';
    source.parts[0]!.name = 'New drawing label'; source.parts.reverse();
    source.actions[0]!.id = 'my.studio:solo/free-spin';
    source.extensions['my.studio:metadata'] = JSON.parse('{"__proto__":{"inert":true},"constructor":[false,null,0,"文字"],"future":{"nodes":[]}}');
    source.extensions['my.studio:negative-zero'] = -0;
    expect(openActorProject(saveActorProject(source))).toEqual({ ok: true, source });
    const opened = openActorProject(saveActorProject(source));
    expect(opened.ok && Object.is(opened.source.extensions['my.studio:negative-zero'], -0)).toBe(true);
    expect(({} as { inert?: boolean }).inert).toBeUndefined();
    expect(source.parts[0]!.artwork.layers[0]!.pixels).toHaveLength(64);
  });

  it('canonicalizes properties while retaining authored array order and detached source', () => {
    const source = actorFixture(), reversed = Object.fromEntries(Object.entries(source).reverse()) as unknown as ActorProject;
    expect(saveActorProject(reversed)).toBe(saveActorProject(source));
    const result = validateActorProject(source);
    if (!result.ok) throw new Error('fixture admission');
    result.source.rigs[0]!.nodes[0]!.name = 'edited';
    expect(source.rigs[0]!.nodes[0]!.name).toBe('Crown');
    expect(saveActorProject(source)).toContain('example:tail-2');
  });

  it('retains arbitrary non-namespaced component IDs, including delimiter and prototype-like names', () => {
    const source = actorFixture('zero-bone');
    source.parts[0]!.id = '__proto__'; source.parts[0]!.artwork.layers[0]!.id = 'Layer / α';
    source.attachments[0]!.partId = '__proto__'; source.attachments[0]!.id = 'constructor';
    source.clips[0]!.id = 'rise / freely named';
    source.clips[0]!.tracks[0]!.id = 'motion';
    source.clips[0]!.tracks[0]!.target = { kind: 'attachment', attachmentId: 'constructor' };
    source.rigs.push({ id: 'arbitrary rig', name: 'Rig', nodes: [{ id: 'a/b:☄', name: 'Root', parentId: null,
      rest: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 } }], sockets: [] });
    expect(openActorProject(saveActorProject(source))).toEqual({ ok: true, source });
    expect(compileActorProject(source).clipIds).toEqual(['rise / freely named']);
  });

  it('rejects unsupported schema/capabilities without replacing or downgrading original data', () => {
    const source = actorFixture();
    const future = JSON.stringify({ ...source, format: 'spacelab-actor-project/2' });
    expect(openActorProject(future)).toMatchObject({ ok: false, diagnostics: [{ path: '/format', code: 'format' }] });
    source.requiredCapabilities.push('vendor:executable-physics/1');
    source.extensions['vendor:executable-physics/1'] = { optional: true };
    const before = structuredClone(source); rejected(source, 'capability'); expect(source).toEqual(before);
    expect(() => saveActorProject(source)).toThrow(/Unsupported required capability/);
    expect(() => compileActorProject(source)).toThrow(/Unsupported required capability/);
  });

  it('checks bytes before parse (including whitespace and multibyte UTF-8) and reports invalid JSON', () => {
    expect(openActorProject('{'.repeat(100), { maxJsonBytes: 20 })).toMatchObject({ ok: false, diagnostics: [{ code: 'limit' }] });
    expect(openActorProject('"🪐"', { maxJsonBytes: 5 })).toMatchObject({ ok: false, diagnostics: [{ code: 'limit' }] });
    expect(openActorProject(' '.repeat(40), { maxJsonBytes: 20 })).toMatchObject({ ok: false, diagnostics: [{ code: 'limit' }] });
    expect(openActorProject('{bad}')).toMatchObject({ ok: false, diagnostics: [{ code: 'json' }] });
  });

  it('bounds raw JSON values, depth, string length and exact canonical bytes', () => {
    const source = actorFixture('empty');
    const bytes = Buffer.byteLength(saveActorProject(source));
    expect(validateActorProject(source, { maxJsonBytes: bytes }).ok).toBe(true);
    rejected(source, 'limit', { maxJsonBytes: bytes - 1 });
    rejected(source, 'limit', { maxJsonValues: 10 });
    rejected(source, 'limit', { maxStringLength: 3 });
    source.extensions['vendor:deep'] = { a: { b: { c: 1 } } };
    rejected(source, 'limit', { maxJsonDepth: 3 });
    expect(() => validateActorProject(source, { maxNodes: -1 })).toThrow(RangeError);
    expect(() => validateActorProject(source, { unknown: 1 } as Partial<ActorProjectLimits>)).toThrow(RangeError);
  });

  it('rejects non-JSON values, getters without invoking them, cycles and sparse arrays', () => {
    const source = actorFixture('empty');
    for (const value of [NaN, Infinity, undefined, () => 1, new Date(), new Uint8Array(2)]) {
      source.extensions['vendor:data'] = value as never; rejected(source, 'json');
    }
    source.extensions['vendor:data'] = source.extensions; rejected(source, 'json');
    source.extensions = {};
    Object.defineProperty(source.extensions, 'vendor:getter', { enumerable: true, get() { throw new Error('Getter executed'); } });
    rejected(source, 'json');
    source.extensions = { 'vendor:data': Array(2) }; rejected(source, 'json');
    source.extensions = { 'vendor:data': Object.assign([1], { extra: 1 }) }; rejected(source, 'json');
  });

  it.each([
    ['unknown core field', 'field', (s: ActorProject) => Object.assign(s, { mass: 10 })],
    ['unknown transform field', 'field', (s: ActorProject) => Object.assign(s.rigs[0]!.nodes[0]!.rest, { force: 1 })],
    ['missing field', 'required', (s: ActorProject) => { delete (s as Partial<ActorProject>).name; }],
    ['duplicate parts', 'duplicate', (s: ActorProject) => s.parts.push(structuredClone(s.parts[0]!))],
    ['duplicate nodes', 'duplicate', (s: ActorProject) => s.rigs[0]!.nodes.push(structuredClone(s.rigs[0]!.nodes[0]!))],
    ['missing parent', 'reference', (s: ActorProject) => { s.rigs[0]!.nodes[0]!.parentId = 'missing:parent'; }],
    ['parent cycle', 'cycle', (s: ActorProject) => { s.rigs[0]!.nodes[0]!.parentId = 'example:tail-2'; }],
    ['missing socket node', 'reference', (s: ActorProject) => { s.rigs[0]!.sockets[0]!.nodeId = 'missing:socket'; }],
    ['missing part', 'reference', (s: ActorProject) => { s.attachments[0]!.partId = 'missing:part'; }],
    ['half attachment reference', 'reference', (s: ActorProject) => { delete s.attachments[0]!.nodeId; }],
    ['missing attachment node', 'reference', (s: ActorProject) => { s.attachments[0]!.nodeId = 'missing:node'; }],
    ['invalid scale units', 'number', (s: ActorProject) => { s.units.metresPerUnit = 0; }],
    ['zero pixel scale', 'number', (s: ActorProject) => { s.parts[0]!.unitsPerPixel = 0; }],
    ['negative duration', 'number', (s: ActorProject) => { s.clips[0]!.duration = -1; }],
    ['reversed key storage', 'time', (s: ActorProject) => s.clips[0]!.tracks[0]!.keys.reverse()],
    ['duplicate key time', 'time', (s: ActorProject) => { s.clips[0]!.tracks[0]!.keys[1]!.time = 0; }],
    ['out-of-duration key', 'time', (s: ActorProject) => { s.clips[0]!.tracks[0]!.keys[1]!.time = 3; }],
    ['empty key track', 'value', (s: ActorProject) => { s.clips[0]!.tracks[0]!.keys = []; }],
    ['duplicate target', 'duplicate', (s: ActorProject) => { const t = structuredClone(s.clips[0]!.tracks[0]!); t.id = 'other:track'; s.clips[0]!.tracks.push(t); }],
    ['missing target', 'reference', (s: ActorProject) => { s.clips[0]!.tracks[0]!.target = { kind: 'attachment', attachmentId: 'missing:art' }; }],
    ['palette colour', 'color', (s: ActorProject) => { s.parts[0]!.artwork.palette[0] = '#000'; }],
    ['palette index', 'range', (s: ActorProject) => { s.parts[0]!.artwork.layers[0]!.pixels[0] = 2; }],
    ['raster dimensions', 'range', (s: ActorProject) => { s.parts[0]!.artwork.width = 1e100; }],
    ['wrong layer length', 'range', (s: ActorProject) => s.parts[0]!.artwork.layers[0]!.pixels.pop()],
    ['opacity', 'range', (s: ActorProject) => { s.parts[0]!.artwork.layers[0]!.opacity = 1.1; }],
  ] as const)('rejects %s', (_name, code, change) => {
    const source = actorFixture(); change(source); rejected(source, code);
  });

  it('uses configurable aggregate admission limits rather than anatomy caps', () => {
    const source = actorFixture();
    for (const limit of ['maxParts', 'maxRigs', 'maxNodes', 'maxSockets', 'maxAttachments', 'maxClips', 'maxTracks', 'maxKeys', 'maxLayers', 'maxPixels', 'maxRigDepth'] as const) rejected(source, 'limit', { [limit]: 0 });
    source.parts.push({ ...structuredClone(source.parts[0]!), id: 'vendor:second-part' });
    rejected(source, 'limit', { maxPixels: 100 }); // two 64-pixel layers, individually below the limit
    expect(validateActorProject(source, { maxPixels: 128 }).ok).toBe(true);
    const rig = source.rigs[0]!;
    rig.nodes.reverse(); rejected(source, 'limit', { maxRigDepth: 2 });
    expect(validateActorProject(source, { maxRigDepth: 3 }).ok).toBe(true);
    expect(DEFAULT_ACTOR_PROJECT_LIMITS.maxNodes).toBeGreaterThan(rig.nodes.length);
  });

  it('supports zero-node rigs, shared IDs scoped per rig, transparent palette zero and finite singular scales', () => {
    const source = actorFixture();
    source.rigs.push({ id: 'vendor:empty-rig', name: 'Empty', nodes: [], sockets: [] });
    const copy = structuredClone(source.rigs[0]!); copy.id = 'vendor:another-rig'; source.rigs.push(copy);
    source.parts[0]!.artwork.palette[0] = '#abcdef80';
    source.rigs[0]!.nodes[0]!.rest.scaleX = 0;
    source.rigs[0]!.nodes[0]!.rest.scaleY = -1;
    expect(validateActorProject(source).ok).toBe(true);
  });
});
