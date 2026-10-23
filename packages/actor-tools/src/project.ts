import type { ActorProject, ActorRig } from '@actor-animator/types';

/** Local admission profile, not anatomy rules or a network protocol. Aggregate
 * limits apply across the document (pixels include every editable layer).
 * Defaults are a prototype envelope; shipping profiles need measured review. */
export interface ActorProjectLimits {
  maxJsonBytes: number;
  maxJsonDepth: number;
  maxJsonValues: number;
  maxStringLength: number;
  maxParts: number;
  maxRigs: number;
  maxNodes: number;
  maxSockets: number;
  maxAttachments: number;
  maxClips: number;
  maxTracks: number;
  maxKeys: number;
  maxLayers: number;
  maxPixels: number;
  maxDimension: number;
  maxPalette: number;
  maxRigDepth: number;
  maxConstraints: number;
  maxConstraintIterations: number;
  /** Per-evaluation solver work estimate: sum of iterations*(joints+1)^2 plus
   * one recomposition of every slot per constraint. */
  maxConstraintWork: number;
  maxAnimators: number;
  /** Aggregate over all animators, like the other collection limits. */
  maxAnimatorLayers: number;
  maxAnimatorStates: number;
  maxAnimatorTransitions: number;
  maxMaskEntries: number;
  /** Per-animator blend work estimate: layers * 9 * slots * 5 (9 = blend stack
   * cap plus the layer base), slots = nodes + sockets + attachments. */
  maxAnimationWork: number;
}

export const DEFAULT_ACTOR_PROJECT_LIMITS: Readonly<ActorProjectLimits> = Object.freeze({
  maxJsonBytes: 4 * 1024 * 1024, maxJsonDepth: 48, maxJsonValues: 1_000_000, maxStringLength: 16_384,
  maxParts: 256, maxRigs: 32, maxNodes: 4096, maxSockets: 4096, maxAttachments: 4096,
  maxClips: 256, maxTracks: 8192, maxKeys: 65_536, maxLayers: 1024,
  maxPixels: 262_144, maxDimension: 1024, maxPalette: 256, maxRigDepth: 256,
  maxConstraints: 1024, maxConstraintIterations: 64, maxConstraintWork: 4_000_000,
  maxAnimators: 64, maxAnimatorLayers: 256, maxAnimatorStates: 4096, maxAnimatorTransitions: 16_384, maxMaskEntries: 8192,
  maxAnimationWork: 4_000_000,
});
export const ACTOR_PROJECT_CAPABILITIES: readonly string[] = Object.freeze([
  'spacelab:indexed-raster/1', 'spacelab:transform-clips/1', 'spacelab:rig-constraints/1', 'spacelab:animation-composition/1', 'spacelab:cel-tracks/1', 'spacelab:emote-authoring/1',
]);
/** Gates optional node limits and rig constraints; absent from older projects. */
export const RIG_CONSTRAINTS_CAPABILITY = 'spacelab:rig-constraints/1';
/** Gates curves, angle modes, discrete visibility/draw-order tracks,
 * ping-pong playback and animators; absent from older projects. */
export const ANIMATION_COMPOSITION_CAPABILITY = 'spacelab:animation-composition/1';
/** Gates reusable layered cels and per-attachment step cel tracks. */
export const CEL_TRACKS_CAPABILITY = 'spacelab:cel-tracks/1';
/** Gates inert solo/two-role source definitions, not player consent. */
export const EMOTE_AUTHORING_CAPABILITY = 'spacelab:emote-authoring/1';
/** Segment curves; presets are fixed cubic Béziers (see game-api ActorCurve). */
export const ACTOR_CURVES: readonly string[] = Object.freeze(['step', 'linear', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier']);
/** Built-in visual CCD chain solver identity. */
export const CCD_CHAIN_SOLVER = 'spacelab:ccd-chain/1';

/** JSON-pointer path, stable machine code and human-readable cause. The first
 * failure stops work, bounding diagnostics even for a hostile document. */
export interface ActorProjectDiagnostic { readonly path: string; readonly code: string; readonly message: string }
export type ActorProjectResult = { ok: true; source: ActorProject } | { ok: false; diagnostics: readonly ActorProjectDiagnostic[] };

export class ActorProjectError extends Error {
  readonly diagnostic: ActorProjectDiagnostic;
  constructor(path: string, code: string, message: string) {
    super(`${path || '/'}: ${message}`);
    this.name = 'ActorProjectError';
    this.diagnostic = Object.freeze({ path, code, message });
  }
}
function fail(path: string, code: string, message: string): never { throw new ActorProjectError(path, code, message); }
const pointer = (path: string, key: string | number) => `${path}/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`;
type RecordValue = Record<string, unknown>;

/** Invalid caller configuration throws; invalid source returns diagnostics. */
export function actorProjectLimits(overrides: Partial<ActorProjectLimits> = {}): Readonly<ActorProjectLimits> {
  for (const key of Object.keys(overrides)) if (!Object.hasOwn(DEFAULT_ACTOR_PROJECT_LIMITS, key)) throw new RangeError(`Unknown actor limit ${key}`);
  const limits = { ...DEFAULT_ACTOR_PROJECT_LIMITS, ...overrides };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`Invalid actor limit ${key}`);
  }
  return Object.freeze(limits);
}

/** UTF-8 length without allocating an encoded copy; unpaired surrogates use the
 * replacement character, matching browser file encoders. */
function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes++;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
    else bytes += 3;
  }
  return bytes;
}

/** Check JSON shape/work before canonical cloning or typed-array allocation. */
function checkJson(raw: unknown, limits: Readonly<ActorProjectLimits>): void {
  let values = 0, bytes = 0;
  const ancestors = new Set<object>();
  function budget(path: string, size: number) {
    bytes += size;
    if (bytes > limits.maxJsonBytes) fail(path, 'limit', 'JSON byte budget exceeded');
  }
  function string(value: string, path: string) {
    if (value.length > limits.maxStringLength) fail(path, 'limit', 'String length budget exceeded');
    // Escaping can expand a string; calculate its exact serialized length.
    budget(path, utf8Bytes(JSON.stringify(value)));
  }
  function visit(value: unknown, path: string, depth: number): void {
    if (++values > limits.maxJsonValues || depth > limits.maxJsonDepth) fail(path, 'limit', 'JSON work/depth budget exceeded');
    if (typeof value === 'string') { string(value, path); return; }
    if (value === null || typeof value === 'boolean') { budget(path, value === null || value === true ? 4 : 5); return; }
    if (typeof value === 'number' && Number.isFinite(value)) { budget(path, Object.is(value, -0) ? 2 : String(value).length); return; }
    if (!value || typeof value !== 'object') fail(path, 'json', 'Expected a finite JSON value');
    if (ancestors.has(value)) fail(path, 'json', 'Cyclic JSON value');
    const array = Array.isArray(value);
    if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) fail(path, 'json', 'Expected a plain JSON object');
    if (array && value.length > limits.maxJsonValues - values) fail(path, 'limit', 'Array work budget exceeded');
    ancestors.add(value);
    const keys = Reflect.ownKeys(value);
    if (keys.length > limits.maxJsonValues - values + 1) fail(path, 'limit', 'Object work budget exceeded');
    budget(path, 2);
    let count = 0;
    for (const key of keys) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string' || array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) fail(path, 'json', 'Unsupported JSON property');
      const childPath = pointer(path, key), descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!descriptor.enumerable || !('value' in descriptor)) fail(childPath, 'json', 'JSON properties must be enumerable data');
      if (count++) budget(path, 1);
      if (!array) { string(key, childPath); budget(path, 1); }
      visit(descriptor.value, childPath, depth + 1);
    }
    if (array && count !== value.length) fail(path, 'json', 'Sparse arrays are not JSON source');
    ancestors.delete(value);
  }
  visit(raw, '', 0);
}

/** Canonical key ordering is independent of source property insertion order.
 * Arrays retain authoring order; this is not a whitespace-preserving format. */
function canonical(value: unknown): string {
  if (Object.is(value, -0)) return '-0';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as RecordValue;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}

function object(value: unknown, path: string, required: readonly string[], optional: readonly string[] = []): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'type', 'Expected object');
  const record = value as RecordValue;
  for (const key of Object.keys(record)) if (!required.includes(key) && !optional.includes(key)) fail(pointer(path, key), 'field', 'Unknown core field; use an inert namespaced extension');
  for (const key of required) if (!Object.hasOwn(record, key)) fail(pointer(path, key), 'required', 'Missing required field');
  return record;
}
function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.length) fail(path, 'type', 'Expected nonempty string');
  return value;
}
function id(value: unknown, path: string): string {
  const s = text(value, path);
  if (!/^[^\s:]+:[^\s]+$/u.test(s)) fail(path, 'id', 'Expected namespaced ID');
  return s;
}
function number(value: unknown, path: string, positive = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || positive && value <= 0) fail(path, 'number', positive ? 'Expected positive finite number' : 'Expected finite number');
  return value;
}
function integer(value: unknown, path: string, min: number, max: number): number {
  const n = number(value, path);
  if (!Number.isSafeInteger(n) || n < min || n > max) fail(path, 'range', `Expected integer in [${min}, ${max}]`);
  return n;
}
function choice(value: unknown, path: string, allowed: readonly unknown[]) {
  if (!allowed.includes(value)) fail(path, 'value', `Expected ${allowed.join(' or ')}`);
}
function array(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value)) fail(path, 'type', 'Expected array');
  if (value.length > max) fail(path, 'limit', 'Collection budget exceeded');
  return value;
}
function transform(value: unknown, path: string) {
  const t = object(value, path, ['x', 'y', 'rotation', 'scaleX', 'scaleY']);
  for (const key of Object.keys(t)) number(t[key], pointer(path, key));
}
function named(value: unknown, path: string, keys: readonly string[], optional: readonly string[] = []): RecordValue {
  const r = object(value, path, ['id', 'name', ...keys], optional);
  text(r.id, `${path}/id`); text(r.name, `${path}/name`);
  return r;
}
function unique(records: unknown[], path: string): Map<string, RecordValue> {
  const found = new Map<string, RecordValue>();
  records.forEach((value, i) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(pointer(path, i), 'type', 'Expected record');
    const r = value as RecordValue, key = text(r.id, `${path}/${i}/id`);
    if (found.has(key)) fail(`${path}/${i}/id`, 'duplicate', 'Duplicate ID in collection');
    found.set(key, r);
  });
  return found;
}
function reference(map: ReadonlyMap<string, unknown>, value: unknown, path: string) {
  if (!map.has(text(value, path))) fail(path, 'reference', 'Unresolved reference');
}

/** True when `ancestorId` is `nodeId` or one of its parents. Validated rigs
 * have bounded depth, so the walk is bounded. */
function isAncestorOrSelf(nodes: ReadonlyMap<string, RecordValue>, ancestorId: string, nodeId: string): boolean {
  for (let cursor: string | null = nodeId; cursor !== null; cursor = nodes.get(cursor)!.parentId as string | null) if (cursor === ancestorId) return true;
  return false;
}

/** Returns the solver work estimate. Unknown namespaced solvers keep inert
 * JSON settings (already budgeted by checkJson) and contribute no work. */
function checkConstraint(value: unknown, path: string, nodes: ReadonlyMap<string, RecordValue>, sockets: ReadonlyMap<string, RecordValue>, limits: Readonly<ActorProjectLimits>): number {
  const c = named(value, path, ['solver', 'enabled', 'settings']);
  id(c.solver, `${path}/solver`);
  if (typeof c.enabled !== 'boolean') fail(`${path}/enabled`, 'type', 'Expected boolean');
  if (c.solver !== CCD_CHAIN_SOLVER) return 0;
  const s = object(c.settings, `${path}/settings`, ['effector', 'chainRootId', 'target', 'iterations', 'tolerance']);
  const point = (raw: unknown, p: string) => {
    const pt = object(raw, p, ['kind', 'id']); choice(pt.kind, `${p}/kind`, ['node', 'socket']);
    reference(pt.kind === 'node' ? nodes : sockets, pt.id, `${p}/id`);
    // Joints and descendants are judged from the node carrying the point.
    return { kind: pt.kind as 'node' | 'socket', node: pt.kind === 'node' ? pt.id as string : sockets.get(pt.id as string)!.nodeId as string };
  };
  const effector = point(s.effector, `${path}/settings/effector`), target = point(s.target, `${path}/settings/target`);
  reference(nodes, s.chainRootId, `${path}/settings/chainRootId`);
  const root = s.chainRootId as string;
  const lowest = effector.kind === 'node' ? nodes.get(effector.node)!.parentId as string | null : effector.node;
  if (lowest === null || !isAncestorOrSelf(nodes, root, lowest)) fail(`${path}/settings/chainRootId`, 'reference', 'Chain root must be an ancestor of the effector node, or the socket effector\'s node');
  if (isAncestorOrSelf(nodes, root, target.node)) fail(`${path}/settings/target`, 'reference', 'Target must lie outside the chain root subtree');
  const iterations = integer(s.iterations, `${path}/settings/iterations`, 1, limits.maxConstraintIterations);
  number(s.tolerance, `${path}/settings/tolerance`, true);
  let joints = 0;
  for (let cursor: string | null = lowest; cursor !== null && joints <= limits.maxRigDepth; cursor = cursor === root ? null : nodes.get(cursor)!.parentId as string | null) joints++;
  return iterations * (joints + 1) * (joints + 1);
}

/** Animator layers, states, transitions, masks and references. Each layer's
 * `next` links must form acyclic chains, so automatic end transitions are
 * bounded by the state count between requests. */
function checkAnimators(animators: unknown[], clips: ReadonlyMap<string, RecordValue>, attachments: ReadonlyMap<string, RecordValue>,
  nodeReference: (rig: unknown, node: unknown, path: string) => void, slots: number, limits: Readonly<ActorProjectLimits>) {
  unique(animators, '/animators');
  let layers = 0, states = 0, transitions = 0, masks = 0;
  const timing = (value: unknown, path: string) => {
    const t = object(value, path, ['duration', 'priority']);
    if (number(t.duration, `${path}/duration`) < 0) fail(`${path}/duration`, 'range', 'Transition duration must be >= 0 seconds');
    integer(t.priority, `${path}/priority`, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  };
  animators.forEach((value, i) => {
    const path = `/animators/${i}`, a = named(value, path, ['layers']);
    const ls = array(a.layers, `${path}/layers`, limits.maxAnimatorLayers - layers); layers += ls.length; unique(ls, `${path}/layers`);
    if (ls.length * 9 * slots * 5 > limits.maxAnimationWork) fail(`${path}/layers`, 'limit', 'Animation blend work budget exceeded');
    ls.forEach((v, j) => {
      const lp = `${path}/layers/${j}`, l = named(v, lp, ['blend', 'weight', 'initialStateId', 'defaultTransition', 'states', 'transitions'], ['mask', 'reference']);
      choice(l.blend, `${lp}/blend`, ['override', 'additive']);
      const weight = number(l.weight, `${lp}/weight`);
      if (weight < 0 || weight > 1) fail(`${lp}/weight`, 'range', 'Layer weight must be in [0,1]');
      timing(l.defaultTransition, `${lp}/defaultTransition`);
      if ((l.blend === 'additive') !== Object.hasOwn(l, 'reference')) fail(`${lp}/reference`, 'value', 'Additive layers need a reference pose; override layers have none');
      if (Object.hasOwn(l, 'reference')) {
        const r = object(l.reference, `${lp}/reference`, ['clipId', 'time']);
        reference(clips, r.clipId, `${lp}/reference/clipId`); number(r.time, `${lp}/reference/time`);
      }
      if (Object.hasOwn(l, 'mask')) {
        const ms = array(l.mask, `${lp}/mask`, limits.maxMaskEntries - masks); masks += ms.length;
        const seen = new Set<string>();
        ms.forEach((m, k) => {
          const mp = `${lp}/mask/${k}`, kind = (m as RecordValue | null)?.kind;
          const entry = kind === 'node' ? object(m, mp, ['kind', 'rigId', 'nodeId', 'descendants']) : object(m, mp, ['kind', 'attachmentId']);
          choice(entry.kind, `${mp}/kind`, ['node', 'attachment']);
          if (entry.kind === 'node') {
            nodeReference(entry.rigId, entry.nodeId, mp);
            if (typeof entry.descendants !== 'boolean') fail(`${mp}/descendants`, 'type', 'Expected boolean');
          } else reference(attachments, entry.attachmentId, `${mp}/attachmentId`);
          const key = canonical(entry);
          if (seen.has(key)) fail(mp, 'duplicate', 'Duplicate mask entry'); seen.add(key);
        });
      }
      const ss = array(l.states, `${lp}/states`, limits.maxAnimatorStates - states); states += ss.length;
      const stateMap = unique(ss, `${lp}/states`);
      ss.forEach((sv, k) => {
        const sp = `${lp}/states/${k}`, st = named(sv, sp, ['clipId', 'rate'], ['next']);
        if (st.clipId !== null) reference(clips, st.clipId, `${sp}/clipId`);
        const rate = number(st.rate, `${sp}/rate`);
        if (Object.hasOwn(st, 'next')) {
          reference(stateMap, st.next, `${sp}/next`);
          if (st.next === st.id) fail(`${sp}/next`, 'value', 'A state cannot follow itself; use a loop clip');
          if (st.clipId === null || clips.get(st.clipId as string)!.playback !== 'once' || rate === 0) fail(`${sp}/next`, 'value', 'next needs a once clip and a nonzero rate, so the clip ends');
        }
      });
      for (const start of stateMap.keys()) {
        const seen = new Set<string>();
        for (let cursor: string | undefined = start; cursor !== undefined; cursor = stateMap.get(cursor)!.next as string | undefined) {
          if (seen.has(cursor)) fail(`${lp}/states`, 'cycle', 'next links form a cycle; automatic end transitions must terminate');
          seen.add(cursor);
        }
      }
      reference(stateMap, l.initialStateId, `${lp}/initialStateId`);
      const ts = array(l.transitions, `${lp}/transitions`, limits.maxAnimatorTransitions - transitions); transitions += ts.length;
      unique(ts, `${lp}/transitions`);
      const pairs = new Set<string>();
      ts.forEach((tv, k) => {
        const tp = `${lp}/transitions/${k}`, t = object(tv, tp, ['id', 'from', 'to', 'duration', 'priority']);
        if (t.from !== null) reference(stateMap, t.from, `${tp}/from`);
        reference(stateMap, t.to, `${tp}/to`);
        if (t.from === t.to) fail(`${tp}/to`, 'value', 'A transition needs a different target state');
        timing({ duration: t.duration, priority: t.priority }, tp);
        const pair = JSON.stringify([t.from, t.to]);
        if (pairs.has(pair)) fail(tp, 'duplicate', 'Duplicate (from, to) transition'); pairs.add(pair);
      });
    });
  });
}

function checkSource(raw: unknown, limits: Readonly<ActorProjectLimits>): ActorProject {
  checkJson(raw, limits);
  const root = object(raw, '', ['format', 'version', 'id', 'name', 'author', 'license', 'provenance', 'units', 'requiredCapabilities', 'parts', 'rigs', 'attachments', 'clips', 'actions', 'extensions'], ['animators', 'cels', 'emotes']);
  if (root.format !== 'spacelab-actor-project/1') fail('/format', 'format', 'Unsupported source schema; retain the original, never resave as version 1');
  id(root.id, '/id');
  for (const key of ['name', 'author', 'license', 'provenance']) text(root[key], `/${key}`);
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/.test(text(root.version, '/version'))) fail('/version', 'version', 'Expected semantic project revision');
  const units = object(root.units, '/units', ['metresPerUnit', 'coordinates', 'angle', 'time', 'origin']);
  number(units.metresPerUnit, '/units/metresPerUnit', true);
  choice(units.coordinates, '/units/coordinates', ['x-right-y-up']); choice(units.angle, '/units/angle', ['radians-ccw']); choice(units.time, '/units/time', ['seconds']);
  const origin = array(units.origin, '/units/origin', 2);
  if (origin.length !== 2 || origin[0] !== 0 || origin[1] !== 0) fail('/units/origin', 'value', 'Scene origin must be [0,0]');
  const capabilities = array(root.requiredCapabilities, '/requiredCapabilities', limits.maxJsonValues), seenCapabilities = new Set<string>();
  capabilities.forEach((c, i) => {
    const key = id(c, `/requiredCapabilities/${i}`);
    if (!ACTOR_PROJECT_CAPABILITIES.includes(key)) fail(`/requiredCapabilities/${i}`, 'capability', 'Unsupported required capability');
    if (seenCapabilities.has(key)) fail(`/requiredCapabilities/${i}`, 'duplicate', 'Duplicate capability');
    seenCapabilities.add(key);
  });
  const parts = array(root.parts, '/parts', limits.maxParts), rigs = array(root.rigs, '/rigs', limits.maxRigs);
  const attachments = array(root.attachments, '/attachments', limits.maxAttachments), clips = array(root.clips, '/clips', limits.maxClips);
  const partMap = unique(parts, '/parts'), rigMap = unique(rigs, '/rigs'), attachmentMap = unique(attachments, '/attachments'), clipMap = unique(clips, '/clips');
  let layers = 0, pixels = 0, nodes = 0, sockets = 0, tracks = 0, keys = 0, constraints = 0, constraintWork = 0;
  const constraintsAllowed = seenCapabilities.has(RIG_CONSTRAINTS_CAPABILITY), animationAllowed = seenCapabilities.has(ANIMATION_COMPOSITION_CAPABILITY);
  function gated(path: string) {
    if (!constraintsAllowed) fail(path, 'capability', `Joint limits and constraints require ${RIG_CONSTRAINTS_CAPABILITY} in requiredCapabilities`);
  }
  function animated(path: string) {
    if (!animationAllowed) fail(path, 'capability', `Curves, angle modes, discrete tracks, ping-pong and animators require ${ANIMATION_COMPOSITION_CAPABILITY} in requiredCapabilities`);
  }
  let celMap = new Map<string, RecordValue>();
  if (Object.hasOwn(root, 'cels')) {
    if (!seenCapabilities.has(CEL_TRACKS_CAPABILITY)) fail('/cels', 'capability', `Cels require ${CEL_TRACKS_CAPABILITY}`);
    const cels = array(root.cels, '/cels', limits.maxParts); celMap = unique(cels, '/cels');
    cels.forEach((v, i) => { const cp = `/cels/${i}`, c = named(v, cp, ['partId']); reference(partMap, c.partId, `${cp}/partId`); });
  }
  parts.forEach((value, i) => {
    const path = `/parts/${i}`, p = named(value, path, ['revision', 'pivot', 'unitsPerPixel', 'artwork']);
    integer(p.revision, `${path}/revision`, 1, Number.MAX_SAFE_INTEGER);
    const pivot = array(p.pivot, `${path}/pivot`, 2);
    if (pivot.length !== 2) fail(`${path}/pivot`, 'value', 'Expected two project-unit coordinates');
    pivot.forEach((v, j) => number(v, `${path}/pivot/${j}`));
    const scale = number(p.unitsPerPixel, `${path}/unitsPerPixel`, true);
    const a = object(p.artwork, `${path}/artwork`, ['kind', 'width', 'height', 'palette', 'layers']);
    choice(a.kind, `${path}/artwork/kind`, ['indexed-raster']);
    const w = integer(a.width, `${path}/artwork/width`, 1, limits.maxDimension), h = integer(a.height, `${path}/artwork/height`, 1, limits.maxDimension);
    if (!Number.isSafeInteger(w * h) || !Number.isFinite(w * scale) || !Number.isFinite(h * scale)) fail(`${path}/artwork`, 'range', 'Unsafe raster dimensions or scale');
    const palette = array(a.palette, `${path}/artwork/palette`, limits.maxPalette);
    if (!palette.length) fail(`${path}/artwork/palette`, 'value', 'Expected at least one RGBA colour');
    palette.forEach((color, j) => { if (typeof color !== 'string' || !/^#[\da-fA-F]{8}$/.test(color)) fail(`${path}/artwork/palette/${j}`, 'color', 'Expected eight-digit RGBA hex'); });
    const ls = array(a.layers, `${path}/artwork/layers`, limits.maxLayers - layers); layers += ls.length;
    unique(ls, `${path}/artwork/layers`);
    ls.forEach((v, j) => {
      const lp = `${path}/artwork/layers/${j}`, layer = named(v, lp, ['opacity', 'pixels']);
      const opacity = number(layer.opacity, `${lp}/opacity`);
      if (opacity < 0 || opacity > 1) fail(`${lp}/opacity`, 'range', 'Opacity must be in [0,1]');
      // Check aggregate work before walking or copying any pixel array.
      if (w * h > limits.maxPixels - pixels) fail(`${lp}/pixels`, 'limit', 'Aggregate layer pixel budget exceeded');
      pixels += w * h;
      const ps = array(layer.pixels, `${lp}/pixels`, w * h);
      if (ps.length !== w * h) fail(`${lp}/pixels`, 'range', 'Pixel count must match width * height');
      ps.forEach((v, k) => integer(v, `${lp}/pixels/${k}`, 0, palette.length - 1));
    });
  });
  const nodeMaps = new Map<string, Map<string, RecordValue>>();
  rigs.forEach((value, i) => {
    const path = `/rigs/${i}`, r = named(value, path, ['nodes', 'sockets'], ['constraints']);
    const ns = array(r.nodes, `${path}/nodes`, limits.maxNodes - nodes); nodes += ns.length;
    const ss = array(r.sockets, `${path}/sockets`, limits.maxSockets - sockets); sockets += ss.length;
    const nm = unique(ns, `${path}/nodes`); nodeMaps.set(r.id as string, nm); unique(ss, `${path}/sockets`);
    ns.forEach((v, j) => {
      const np = `${path}/nodes/${j}`, n = named(v, np, ['parentId', 'rest'], ['limits']);
      if (n.parentId !== null) reference(nm, n.parentId, `${np}/parentId`);
      transform(n.rest, `${np}/rest`);
      if (Object.hasOwn(n, 'limits')) {
        gated(`${np}/limits`);
        const l = object(n.limits, `${np}/limits`, ['minRotation', 'maxRotation']);
        if (number(l.minRotation, `${np}/limits/minRotation`) > number(l.maxRotation, `${np}/limits/maxRotation`)) fail(`${np}/limits`, 'range', 'minRotation must not exceed maxRotation');
      }
    });
    // Iterative parent walk: no recursion on authored hierarchy, each node
    // resolved once. Depth limits bound later graph work and matrix chains.
    const depths = new Map<string, number>();
    for (const start of nm.keys()) {
      const chain: string[] = [], visiting = new Set<string>(); let cursor: string | null = start;
      while (cursor !== null && !depths.has(cursor)) {
        if (visiting.has(cursor)) fail(`${path}/nodes`, 'cycle', 'Cyclic rig parents');
        if (chain.length >= limits.maxRigDepth) fail(`${path}/nodes`, 'limit', 'Rig depth budget exceeded');
        visiting.add(cursor); chain.push(cursor); cursor = nm.get(cursor)!.parentId as string | null;
      }
      let depth = cursor === null ? 0 : depths.get(cursor)!;
      for (let k = chain.length - 1; k >= 0; k--) {
        if (++depth > limits.maxRigDepth) fail(`${path}/nodes`, 'limit', 'Rig depth budget exceeded');
        depths.set(chain[k]!, depth);
      }
    }
    const sm = new Map<string, RecordValue>();
    ss.forEach((v, j) => {
      const sp = `${path}/sockets/${j}`, s = named(v, sp, ['nodeId', 'transform']);
      reference(nm, s.nodeId, `${sp}/nodeId`); transform(s.transform, `${sp}/transform`); sm.set(s.id as string, s);
    });
    if (Object.hasOwn(r, 'constraints')) {
      gated(`${path}/constraints`);
      const cs = array(r.constraints, `${path}/constraints`, limits.maxConstraints - constraints); constraints += cs.length;
      unique(cs, `${path}/constraints`);
      cs.forEach((v, j) => { constraintWork += checkConstraint(v, `${path}/constraints/${j}`, nm, sm, limits); });
    }
  });
  function nodeReference(rig: unknown, node: unknown, path: string) {
    reference(rigMap, rig, `${path}/rigId`); reference(nodeMaps.get(rig as string)!, node, `${path}/nodeId`);
  }
  if (constraints * (nodes + sockets + attachments.length) > limits.maxConstraintWork - constraintWork) fail('/rigs', 'limit', 'Constraint work budget exceeded');
  attachments.forEach((value, i) => {
    const path = `/attachments/${i}`, a = named(value, path, ['partId', 'drawOrder', 'transform'], ['rigId', 'nodeId']);
    reference(partMap, a.partId, `${path}/partId`); integer(a.drawOrder, `${path}/drawOrder`, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER); transform(a.transform, `${path}/transform`);
    if (Object.hasOwn(a, 'rigId') !== Object.hasOwn(a, 'nodeId')) fail(path, 'reference', 'rigId and nodeId must appear together');
    if (Object.hasOwn(a, 'rigId')) nodeReference(a.rigId, a.nodeId, path);
  });
  function keyTimes(ks: unknown[], tp: string, duration: number, extra: (key: RecordValue, kp: string, k: number) => void) {
    if (!ks.length) fail(`${tp}/keys`, 'value', 'Expected at least one key');
    let previous = -1;
    ks.forEach((v, k) => {
      const kp = `${tp}/keys/${k}`, key = v as RecordValue, time = number(key?.time, `${kp}/time`);
      if (time < 0 || time > duration || time <= previous) fail(`${kp}/time`, 'time', 'Key times must strictly increase within [0,duration]');
      previous = time; extra(key, kp, k);
    });
  }
  function trackTarget(raw: unknown, tp: string, attachmentOnly = false): RecordValue {
    const targetRaw = raw as RecordValue | null;
    const target = targetRaw?.kind === 'node' && !attachmentOnly
      ? object(targetRaw, `${tp}/target`, ['kind', 'rigId', 'nodeId'])
      : object(targetRaw, `${tp}/target`, ['kind', 'attachmentId']);
    choice(target.kind, `${tp}/target/kind`, attachmentOnly ? ['attachment'] : ['node', 'attachment']);
    if (target.kind === 'node') nodeReference(target.rigId, target.nodeId, `${tp}/target`);
    else reference(attachmentMap, target.attachmentId, `${tp}/target/attachmentId`);
    return target;
  }
  clips.forEach((value, i) => {
    const path = `/clips/${i}`, c = named(value, path, ['duration', 'playback', 'tracks'], ['visibilityTracks', 'drawOrderTracks', 'celTracks']);
    const duration = number(c.duration, `${path}/duration`, true); choice(c.playback, `${path}/playback`, ['once', 'loop', 'ping-pong']);
    if (c.playback === 'ping-pong') { animated(`${path}/playback`); if (!Number.isFinite(duration * 2)) fail(`${path}/duration`, 'range', 'Ping-pong period exceeds Float64 range'); }
    const ts = array(c.tracks, `${path}/tracks`, limits.maxTracks - tracks); tracks += ts.length;
    const trackIds = new Set<string>();
    const trackId = (v: unknown, tp: string) => {
      const key = text((v as RecordValue | null)?.id, `${tp}/id`);
      if (trackIds.has(key)) fail(`${tp}/id`, 'duplicate', 'Duplicate track ID in clip'); trackIds.add(key);
    };
    const targets = new Set<string>();
    ts.forEach((v, j) => {
      const tp = `${path}/tracks/${j}`, t = object(v, tp, ['id', 'target', 'interpolation', 'keys'], ['angle']);
      trackId(t, tp);
      const targetKey = canonical(trackTarget(t.target, tp));
      if (targets.has(targetKey)) fail(`${tp}/target`, 'duplicate', 'Duplicate track target'); targets.add(targetKey);
      choice(t.interpolation, `${tp}/interpolation`, ['step', 'linear']);
      if (Object.hasOwn(t, 'angle')) { animated(`${tp}/angle`); choice(t.angle, `${tp}/angle`, ['unwrapped', 'shortest']); }
      const ks = array(t.keys, `${tp}/keys`, limits.maxKeys - keys); keys += ks.length;
      keyTimes(ks, tp, duration, (raw, kp) => {
        const key = object(raw, kp, ['time', 'value'], ['curve', 'bezier', 'turns']); transform(key.value, `${kp}/value`);
        if (Object.hasOwn(key, 'curve')) { animated(`${kp}/curve`); choice(key.curve, `${kp}/curve`, ACTOR_CURVES); }
        if ((key.curve === 'cubic-bezier') !== Object.hasOwn(key, 'bezier')) fail(`${kp}/bezier`, 'value', 'bezier is required exactly when curve is cubic-bezier');
        if (Object.hasOwn(key, 'bezier')) {
          const b = array(key.bezier, `${kp}/bezier`, 4);
          if (b.length !== 4) fail(`${kp}/bezier`, 'value', 'Expected [x1, y1, x2, y2]');
          b.forEach((n, q) => { const v = number(n, `${kp}/bezier/${q}`); if (q % 2 === 0 && (v < 0 || v > 1)) fail(`${kp}/bezier/${q}`, 'range', 'Bezier x control values must lie in [0,1]'); });
        }
        if (Object.hasOwn(key, 'turns')) {
          animated(`${kp}/turns`); integer(key.turns, `${kp}/turns`, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
          if (t.angle !== 'shortest') fail(`${kp}/turns`, 'value', 'turns apply only to shortest-angle tracks; unwrapped tracks author turns as values');
        }
      });
    });
    const discrete = (field: 'visibilityTracks' | 'drawOrderTracks') => {
      if (!Object.hasOwn(c, field)) return;
      animated(`${path}/${field}`);
      const ds = array(c[field], `${path}/${field}`, limits.maxTracks - tracks); tracks += ds.length;
      const seen = new Set<string>();
      ds.forEach((v, j) => {
        const tp = `${path}/${field}/${j}`, t = object(v, tp, ['id', 'target', 'keys']);
        trackId(t, tp);
        const targetKey = canonical(trackTarget(t.target, tp, field === 'drawOrderTracks'));
        if (seen.has(targetKey)) fail(`${tp}/target`, 'duplicate', 'Duplicate track target'); seen.add(targetKey);
        const ks = array(t.keys, `${tp}/keys`, limits.maxKeys - keys); keys += ks.length;
        keyTimes(ks, tp, duration, (raw, kp) => {
          if (field === 'visibilityTracks') {
            const key = object(raw, kp, ['time', 'visible']);
            if (typeof key.visible !== 'boolean') fail(`${kp}/visible`, 'type', 'Expected boolean');
          } else integer(object(raw, kp, ['time', 'drawOrder']).drawOrder, `${kp}/drawOrder`, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
        });
      });
    };
    discrete('visibilityTracks'); discrete('drawOrderTracks');
    if (Object.hasOwn(c, 'celTracks')) {
      if (!seenCapabilities.has(CEL_TRACKS_CAPABILITY)) fail(`${path}/celTracks`, 'capability', `Cel tracks require ${CEL_TRACKS_CAPABILITY}`);
      const cs = array(c.celTracks, `${path}/celTracks`, limits.maxTracks - tracks); tracks += cs.length;
      const seen = new Set<string>();
      cs.forEach((v, j) => {
        const tp = `${path}/celTracks/${j}`, t = object(v, tp, ['id', 'target', 'keys']); trackId(t, tp);
        const target = canonical(trackTarget(t.target, tp, true));
        if (seen.has(target)) fail(`${tp}/target`, 'duplicate', 'Duplicate cel track target'); seen.add(target);
        const ks = array(t.keys, `${tp}/keys`, limits.maxKeys - keys); keys += ks.length;
        keyTimes(ks, tp, duration, (raw, kp) => { const k = object(raw, kp, ['time', 'celId']); reference(celMap, k.celId, `${kp}/celId`); });
      });
    }
  });
  const actions = array(root.actions, '/actions', limits.maxJsonValues); unique(actions, '/actions');
  actions.forEach((value, i) => {
    const path = `/actions/${i}`, a = object(value, path, ['id', 'label', 'clipId', 'category']);
    id(a.id, `${path}/id`);
    text(a.label, `${path}/label`); text(a.category, `${path}/category`); reference(clipMap, a.clipId, `${path}/clipId`);
  });
  if (Object.hasOwn(root, 'animators')) {
    animated('/animators');
    checkAnimators(array(root.animators, '/animators', limits.maxAnimators), clipMap, attachmentMap, (rig, node, p) => nodeReference(rig, node, p),
      nodes + sockets + attachments.length, limits);
  }
  if (Object.hasOwn(root, 'emotes')) {
    if (!seenCapabilities.has(EMOTE_AUTHORING_CAPABILITY)) fail('/emotes','capability',`Emotes require ${EMOTE_AUTHORING_CAPABILITY}`);
    const es=array(root.emotes,'/emotes',limits.maxClips);unique(es,'/emotes');
    es.forEach((v,i)=>{
      const ep=`/emotes/${i}`,e=object(v,ep,['id','label','revision','duration','playback','interruptPriority','roles']);
      id(e.id,`${ep}/id`);text(e.label,`${ep}/label`);integer(e.revision,`${ep}/revision`,1,Number.MAX_SAFE_INTEGER);number(e.duration,`${ep}/duration`,true);choice(e.playback,`${ep}/playback`,['once','loop']);integer(e.interruptPriority,`${ep}/interruptPriority`,-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER);
      const rs=array(e.roles,`${ep}/roles`,2);if(!rs.length)fail(`${ep}/roles`,'value','An emote needs one solo role or two buddy roles');unique(rs,`${ep}/roles`);
      rs.forEach((raw,j)=>{
        const rp=`${ep}/roles/${j}`,r=object(raw,rp,['id','label','clipId','rigId','socketBindings','start','rate','placement']);
        text(r.id,`${rp}/id`);text(r.label,`${rp}/label`);reference(clipMap,r.clipId,`${rp}/clipId`);number(r.start,`${rp}/start`);number(r.rate,`${rp}/rate`);transform(r.placement,`${rp}/placement`);
        if(r.rigId!==null)reference(rigMap,r.rigId,`${rp}/rigId`);
        const b=r.socketBindings;if(!b||typeof b!=='object'||Array.isArray(b))fail(`${rp}/socketBindings`,'type','Expected semantic socket binding record');
        const entries=Object.entries(b as RecordValue);if(entries.length>limits.maxSockets)fail(`${rp}/socketBindings`,'limit','Socket binding budget exceeded');
        if(r.rigId===null&&entries.length)fail(`${rp}/socketBindings`,'reference','A zero-bone role has no rig sockets');
        const sockets=r.rigId===null?new Map<string,RecordValue>():unique(rigMap.get(r.rigId as string)!.sockets as unknown[],`${rp}/socketBindings`);
        for(const[k,value]of entries){text(k,`${rp}/socketBindings`);reference(sockets,value,pointer(`${rp}/socketBindings`,k));}
      });
    });
  }
  if (!root.extensions || typeof root.extensions !== 'object' || Array.isArray(root.extensions)) fail('/extensions', 'type', 'Expected namespaced JSON extension record');
  for (const key of Object.keys(root.extensions)) id(key, pointer('/extensions', key));
  return JSON.parse(canonical(raw)) as ActorProject;
}

function result(run: () => ActorProject): ActorProjectResult {
  try { return { ok: true, source: run() }; }
  catch (error) {
    if (!(error instanceof ActorProjectError)) throw error;
    return { ok: false, diagnostics: [error.diagnostic] };
  }
}

/** Validates and returns a detached editable copy. Never rewrites rejected input.
 * Structured objects must already be plain data; use open for untrusted bytes. */
export function validateActorProject(raw: unknown, overrides: Partial<ActorProjectLimits> = {}): ActorProjectResult {
  const limits = actorProjectLimits(overrides);
  return result(() => checkSource(raw, limits));
}

/** Size admission precedes JSON.parse, then shape/depth/work admission precedes
 * cloning. On failure the caller retains its original bytes for recovery. */
export function openActorProject(sourceText: string, overrides: Partial<ActorProjectLimits> = {}): ActorProjectResult {
  const limits = actorProjectLimits(overrides);
  return result(() => {
    if (sourceText.length > limits.maxJsonBytes || utf8Bytes(sourceText) > limits.maxJsonBytes) fail('', 'limit', 'Source byte budget exceeded before parse');
    let raw: unknown;
    try { raw = JSON.parse(sourceText); } catch { return fail('', 'json', 'Invalid JSON source'); }
    return checkSource(raw, limits);
  });
}

/** Canonical JSON save; throws ActorProjectError rather than emitting a partial,
 * flattened or downgraded project. Supported JSON values and array order survive. */
export function saveActorProject(source: ActorProject, overrides: Partial<ActorProjectLimits> = {}): string {
  return canonical(checkSource(source, actorProjectLimits(overrides)));
}

/** Stable comparison without locale or environment-dependent collation. */
export function compareActorIds(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

/** Deterministic parent-first traversal; caller must have validated the rig. */
export function orderedActorNodes(rig: ActorRig) {
  const children = new Map<string | null, typeof rig.nodes>();
  for (const node of rig.nodes) {
    const siblings = children.get(node.parentId) ?? [];
    if (!children.has(node.parentId)) children.set(node.parentId, siblings);
    siblings.push(node);
  }
  for (const siblings of children.values()) siblings.sort((a, b) => compareActorIds(a.id, b.id));
  const ordered: typeof rig.nodes = [], stack = [...(children.get(null) ?? [])].reverse();
  while (stack.length) {
    const node = stack.pop()!; ordered.push(node);
    const descendants = children.get(node.id);
    if (descendants) for (let i = descendants.length - 1; i >= 0; i--) stack.push(descendants[i]!);
  }
  return ordered;
}
