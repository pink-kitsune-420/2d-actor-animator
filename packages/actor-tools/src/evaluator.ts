import type { ActorAnimator, ActorConstraint, ActorPart, ActorProject, ActorTrack, ActorTransform } from '@actor-animator/types';
import {
  ACTOR_PROJECT_CAPABILITIES, ActorProjectError, actorProjectLimits, compareActorIds, orderedActorNodes,
  saveActorProject, validateActorProject, type ActorProjectLimits,
} from './project';
import { CCD_CHAIN_CONSTRAINT_SOLVER } from './constraints';

export type ActorReadonly<T> = T extends object ? { readonly [K in keyof T]: ActorReadonly<T[K]> } : T;

/** One fixed matrix/TRS slot. Nodes come first in stable parent-first rig order,
 * then sockets and attachments by stable ID; source order is never rewritten.
 * A parent of -1 means the identity scene frame. */
export interface ActorPoseSlot {
  readonly kind: 'node' | 'socket' | 'attachment';
  readonly id: string;
  readonly rigId?: string;
  readonly partId?: string;
  readonly parent: number;
}

/** Read-only metadata and editable-raster snapshots. Typed-array compilation
 * buffers are private; consumers cannot mutate a shared rig or clip cache. */
export interface CompiledActorProject {
  readonly compilerVersion: string;
  /** Exact canonical cache key (not a hash): source + compiler + options + limits
   * and supported capabilities. Compare whole keys; never use source ID alone. */
  readonly identity: string;
  readonly slots: readonly ActorPoseSlot[];
  readonly parts: readonly ActorReadonly<ActorPart>[];
  /** Attachment slots in painter order, stable ID breaking equal draw orders. */
  readonly drawSlots: readonly number[];
  readonly clipIds: readonly string[];
  /** Every rig constraint, rigs by stable ID then source order: the solve order.
   * Disabled and unsupported constraints are skipped and keep NaN residuals. */
  readonly constraints: readonly ActorConstraintStatus[];
  /** Animator descriptors in source order (layer and state IDs in source order). */
  readonly animators: readonly ActorAnimatorDescriptor[];
  /** Retained private numeric buffers, excluding JS metadata and source text. */
  readonly numericBytes: number;
}

export interface ActorAnimatorDescriptor {
  readonly id: string;
  readonly layers: readonly { readonly id: string; readonly blend: 'override' | 'additive'; readonly initialStateId: string; readonly stateIds: readonly string[] }[];
}

export interface ActorConstraintStatus {
  readonly rigId: string;
  readonly id: string;
  readonly solver: string;
  readonly status: 'active' | 'disabled' | 'unsupported';
}

/** Instance-owned retained buffers. Slot i starts at i*5 in localTRS
 * (x,y,rotation,scaleX,scaleY), i*6 in matrices (a,b,c,d,tx,ty).
 * Every successful evaluation overwrites all entries; callers may read/mutate
 * these arrays but cannot substitute buffers or use them with another compile. */
export interface ActorPose {
  readonly localTRS: Float64Array;
  readonly localMatrices: Float64Array;
  readonly worldMatrices: Float64Array;
  /** Effector-target distance after each compiled constraint (project units),
   * NaN when disabled, unsupported or constraints were not applied. */
  readonly constraintResiduals: Float64Array;
  /** Per slot: own visibility (1/0) from visibility tracks; 1 when untracked. */
  readonly localVisible: Uint8Array;
  /** Per slot: 1 when the slot and every ancestor node are visible. Draw only
   * attachments with 1; matrices are evaluated either way. */
  readonly visible: Uint8Array;
  /** Per slot: current painter order of attachment slots (0 elsewhere). */
  readonly drawOrders: Float64Array;
  /** Attachment slots in painter order: current draw order, then stable ID. */
  readonly drawSequence: Int32Array;
  /** Resolved artwork: index into compiled.parts per attachment slot; -1 for
   * nodes/sockets. Reset on every evaluation; incoming override wins at >=.5. */
  readonly partIndices: Int32Array;
}

/** Compile-time slot lookup for one validated rig. Missing IDs return -1. */
export interface ActorConstraintRig {
  readonly rigId: string;
  nodeSlot(id: string): number;
  socketSlot(id: string): number;
  /** Parent slot, or -1 for the identity scene frame. */
  parentSlot(slot: number): number;
  /** Optional joint limits of a node slot as [min, max] radians. */
  limits(slot: number): readonly [number, number] | null;
}

/** Matrix maintenance for solvers. Both throw RangeError on Float64 overflow
 * and expect the slot's parent world matrix to be current. */
export interface ActorPoseUpdater {
  /** Recomputes the local matrix from localTRS, then the world matrix. */
  recompose(pose: ActorPose, slot: number): void;
  /** Recomputes only the world matrix from the current local matrix. */
  refreshWorld(pose: ActorPose, slot: number): void;
}

/** Prepared once at compile. `solve` runs on every evaluation and must not
 * allocate (no returned doubles, closures or Math.hypot). It may change
 * localTRS of slots at or after `firstSlot` and must `recompose` each slot it
 * changes; it writes its residual (NaN when not meaningful) to
 * `pose.constraintResiduals[residualIndex]`. The evaluator then refreshes
 * world matrices from `firstSlot` onward. */
export interface ActorPreparedConstraint {
  readonly firstSlot: number;
  solve(pose: ActorPose, update: ActorPoseUpdater, residualIndex: number): void;
}

/** Replaceable visual solver keyed by the source `solver` ID. Built-in source
 * validation still applies; a solver for another ID receives inert settings
 * and must validate them itself (throw ActorProjectError to reject compile). */
export interface ActorConstraintSolver {
  readonly id: string;
  /** Included in compiled identity so caches change with solver behaviour. */
  readonly version: string;
  /** `constraint` is a detached, deeply frozen copy of validated source. */
  prepare(constraint: ActorConstraint, rig: ActorConstraintRig): ActorPreparedConstraint;
}

export interface ActorCompileOptions {
  /** Added to, or replacing by ID, the built-in `spacelab:ccd-chain/1` solver. */
  solvers?: readonly ActorConstraintSolver[];
}

/** Per-key segment curve codes; null `curves` means the A1 track path. */
const STEP = 1, LINEAR = 2, BEZIER = 3;
const PRESETS: Readonly<Record<string, readonly [number, number, number, number]>> = Object.freeze({
  'ease-in': [0.42, 0, 1, 1], 'ease-out': [0, 0, 0.58, 1], 'ease-in-out': [0.42, 0, 0.58, 1],
});
const TAU = 2 * Math.PI;
/** Clip playback modes. */
export const ONCE = 0, LOOP = 1, PING_PONG = 2;
/** @internal */
export interface CompiledTrack {
  slot: number; step: boolean; times: Float64Array; values: Float64Array;
  /** Per key: STEP/LINEAR/BEZIER for the segment starting there, or null (A1). */
  curves: Uint8Array | null;
  /** Per key: cubic polynomial coefficients ax,bx,cx,ay,by,cy (BEZIER only). */
  bezier: Float64Array | null;
  /** Per key: shortest-arc rotation delta to the next key, plus explicit turns. */
  deltas: Float64Array | null;
}
/** @internal Step-only discrete track (visibility 0/1 or draw order). */
export interface CompiledDiscreteTrack { slot: number; times: Float64Array; values: Float64Array }
/** @internal */
export interface CompiledClip {
  readonly index: number; readonly duration: number; readonly mode: number;
  readonly tracks: readonly CompiledTrack[]; readonly visibility: readonly CompiledDiscreteTrack[]; readonly drawOrder: readonly CompiledDiscreteTrack[];
  /** Per slot: 1 when this clip writes that slot's channel. */
  readonly trackedTRS: Uint8Array; readonly trackedVisible: Uint8Array; readonly trackedOrder: Uint8Array; readonly trackedParts: Uint8Array;
  readonly cels: readonly CompiledDiscreteTrack[];
}
/** @internal */
export interface CompiledLayer {
  readonly id: string; readonly additive: boolean; readonly weight: number;
  /** Sorted unique node/attachment slots the layer may write. */
  readonly maskSlots: Int32Array;
  /** Additive reference local TRS (slots*5), sampled from rest at compile. */
  readonly reference: Float64Array | null;
  readonly stateIds: readonly string[]; readonly stateIndex: ReadonlyMap<string, number>;
  /** Per state: compiled clip or null (pass-through). */
  readonly stateClips: readonly (CompiledClip | null)[];
  readonly stateRates: Float64Array; readonly stateNext: Int32Array;
  readonly initialState: number;
  /** Key (from + 1) * states + to, with from -1 for any state, to an index of
   * transitionDurations/transitionPriorities. */
  readonly transitions: ReadonlyMap<number, number>;
  readonly transitionDurations: Float64Array; readonly transitionPriorities: Float64Array;
  readonly defaultDuration: number; readonly defaultPriority: number;
}
/** @internal */
export interface CompiledAnimator { readonly id: string; readonly layers: readonly CompiledLayer[] }
/** @internal */
export interface ActorResources {
  rest: Float64Array; restDrawOrders: Float64Array; restParts: Int32Array; clips: ReadonlyMap<string, CompiledClip>; parents: Int32Array;
  prepared: readonly (ActorPreparedConstraint | null)[]; update: ActorPoseUpdater;
  animators: ReadonlyMap<string, CompiledAnimator>; attachmentCount: number;
}
const resources = new WeakMap<CompiledActorProject, ActorResources>();
const owners = new WeakMap<ActorPose, CompiledActorProject>();
const COMPILER_VERSION = 'spacelab-actor-compiler/5';
/** Results depend on these; they are part of compiled identity. */
export const BLEND_STACK_CAP = 8;
const CURVE_SOLVER = 'newton8-bisect64-1e-12/1';
/** @internal Clip time handed to sampleClip without boxing a double argument. */
export const SAMPLE_TIME = new Float64Array(1);

/** Local T*R*S, then parent-world composition for one slot; shared by the
 * evaluation pass and solver recomposition. */
function composeSlot(parents: Int32Array, trs: Float64Array, local: Float64Array, world: Float64Array, i: number) {
  const t = i * 5, m = i * 6, cos = Math.cos(trs[t + 2]!), sin = Math.sin(trs[t + 2]!);
  local[m] = cos * trs[t + 3]!; local[m + 1] = sin * trs[t + 3]!; local[m + 2] = -sin * trs[t + 4]!; local[m + 3] = cos * trs[t + 4]!;
  local[m + 4] = trs[t]!; local[m + 5] = trs[t + 1]!;
  composeWorld(parents, local, world, i);
}
/** World = parent world * current local (identity scene frame for roots). */
function composeWorld(parents: Int32Array, local: Float64Array, world: Float64Array, i: number) {
  const m = i * 6, a = local[m]!, b = local[m + 1]!, c = local[m + 2]!, d = local[m + 3]!, x = local[m + 4]!, y = local[m + 5]!;
  const parent = parents[i]!;
  if (parent < 0) {
    world[m] = a; world[m + 1] = b; world[m + 2] = c; world[m + 3] = d; world[m + 4] = x; world[m + 5] = y;
  } else {
    const p = parent * 6;
    world[m] = world[p]! * a + world[p + 2]! * b;
    world[m + 1] = world[p + 1]! * a + world[p + 3]! * b;
    world[m + 2] = world[p]! * c + world[p + 2]! * d;
    world[m + 3] = world[p + 1]! * c + world[p + 3]! * d;
    world[m + 4] = world[p]! * x + world[p + 2]! * y + world[p + 4]!;
    world[m + 5] = world[p + 1]! * x + world[p + 3]! * y + world[p + 5]!;
  }
  for (let k = 0; k < 6; k++) if (!Number.isFinite(world[m + k]) || !Number.isFinite(local[m + k])) throw new RangeError('Actor affine transform exceeds Float64 range');
}

function freeze<T>(value: T): ActorReadonly<T> {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as ActorReadonly<T>;
}
function writeTRS(out: Float64Array, offset: number, value: ActorTransform) {
  out[offset] = value.x; out[offset + 1] = value.y; out[offset + 2] = value.rotation;
  out[offset + 3] = value.scaleX; out[offset + 4] = value.scaleY;
}
/** @internal */
export function requireResources(compiled: CompiledActorProject): ActorResources {
  const data = resources.get(compiled);
  if (!data) throw new TypeError('Expected an actor-tools compiled project');
  return data;
}

/** Pure compilation: validates and snapshots source, then allocates topology
 * and tracks once. No DOM, asset fetch, module evaluation or world access.
 * Rejected source throws ActorProjectError with the same validation diagnostic. */
export function compileActorProject(raw: ActorProject, overrides: Partial<ActorProjectLimits> = {}, options: ActorCompileOptions = {}): CompiledActorProject {
  const limits = actorProjectLimits(overrides), checked = validateActorProject(raw, limits);
  if (!checked.ok) {
    const d = checked.diagnostics[0]!;
    throw new ActorProjectError(d.path, d.code, d.message);
  }
  const source = checked.source;
  const slots: ActorPoseSlot[] = [], transforms: ActorTransform[] = [];
  const nodeSlots = new Map<string, Map<string, number>>(), attachmentSlots = new Map<string, number>();
  const rigs = [...source.rigs].sort((a, b) => compareActorIds(a.id, b.id));
  for (const rig of rigs) {
    const indices = new Map<string, number>(); nodeSlots.set(rig.id, indices);
    for (const node of orderedActorNodes(rig)) {
      indices.set(node.id, slots.length);
      slots.push({ kind: 'node', rigId: rig.id, id: node.id, parent: node.parentId === null ? -1 : indices.get(node.parentId)! });
      transforms.push(node.rest);
    }
  }
  for (const rig of rigs) {
    for (const socket of [...rig.sockets].sort((a, b) => compareActorIds(a.id, b.id))) {
      slots.push({ kind: 'socket', rigId: rig.id, id: socket.id, parent: nodeSlots.get(rig.id)!.get(socket.nodeId)! });
      transforms.push(socket.transform);
    }
  }
  for (const attachment of [...source.attachments].sort((a, b) => compareActorIds(a.id, b.id))) {
    attachmentSlots.set(attachment.id, slots.length);
    slots.push({ kind: 'attachment', id: attachment.id, partId: attachment.partId,
      parent: attachment.rigId === undefined ? -1 : nodeSlots.get(attachment.rigId)!.get(attachment.nodeId!)! });
    transforms.push(attachment.transform);
  }
  const rest = new Float64Array(slots.length * 5), restDrawOrders = new Float64Array(slots.length);
  transforms.forEach((t, i) => writeTRS(rest, i * 5, t));
  for (const a of source.attachments) restDrawOrders[attachmentSlots.get(a.id)!] = a.drawOrder;
  const partMap = new Map(source.parts.map((p, i) => [p.id, i])), celMap = new Map((source.cels ?? []).map(c => [c.id, partMap.get(c.partId)!]));
  const restParts = new Int32Array(slots.length); restParts.fill(-1);
  for (const a of source.attachments) restParts[attachmentSlots.get(a.id)!] = partMap.get(a.partId)!;
  let numericBytes = rest.byteLength + restDrawOrders.byteLength + restParts.byteLength;
  const targetSlot = (target: ActorTrack['target']) => target.kind === 'node'
    ? nodeSlots.get(target.rigId)!.get(target.nodeId)! : attachmentSlots.get(target.attachmentId)!;
  const clips = new Map<string, CompiledClip>();
  source.clips.forEach((clip, index) => {
    const trackedTRS = new Uint8Array(slots.length), trackedVisible = new Uint8Array(slots.length), trackedOrder = new Uint8Array(slots.length), trackedParts = new Uint8Array(slots.length);
    const tracks = clip.tracks.map(track => compileTrack(track, targetSlot(track.target)));
    for (const t of tracks) { trackedTRS[t.slot] = 1; numericBytes += t.times.byteLength + t.values.byteLength + (t.curves?.byteLength ?? 0) + (t.bezier?.byteLength ?? 0) + (t.deltas?.byteLength ?? 0); }
    const discrete = (track: { target: ActorTrack['target']; keys: readonly { time: number }[] }, value: (key: never) => number, tracked: Uint8Array): CompiledDiscreteTrack => {
      const slot = targetSlot(track.target), times = Float64Array.from(track.keys, k => k.time), values = Float64Array.from(track.keys as never[], value);
      tracked[slot] = 1; numericBytes += times.byteLength + values.byteLength;
      return { slot, times, values };
    };
    const visibility = (clip.visibilityTracks ?? []).map(t => discrete(t, (k: { visible: boolean }) => k.visible ? 1 : 0, trackedVisible));
    const drawOrder = (clip.drawOrderTracks ?? []).map(t => discrete(t, (k: { drawOrder: number }) => k.drawOrder, trackedOrder));
    const cels = (clip.celTracks ?? []).map(t => discrete(t, (k: { celId: string }) => celMap.get(k.celId)!, trackedParts));
    numericBytes += slots.length * 4;
    clips.set(clip.id, Object.freeze({ index, duration: clip.duration, mode: clip.playback === 'loop' ? LOOP : clip.playback === 'ping-pong' ? PING_PONG : ONCE,
      tracks, visibility, drawOrder, cels, trackedTRS, trackedVisible, trackedOrder, trackedParts }));
  });
  const parents = Int32Array.from(slots, slot => slot.parent);
  numericBytes += parents.byteLength;
  const registry = new Map<string, ActorConstraintSolver>([[CCD_CHAIN_CONSTRAINT_SOLVER.id, CCD_CHAIN_CONSTRAINT_SOLVER]]);
  for (const solver of options.solvers ?? []) registry.set(solver.id, solver);
  const socketSlots = new Map<string, Map<string, number>>();
  slots.forEach((slot, i) => { if (slot.kind === 'socket') { const m = socketSlots.get(slot.rigId!) ?? new Map<string, number>(); m.set(slot.id, i); socketSlots.set(slot.rigId!, m); } });
  const statuses: ActorConstraintStatus[] = [], prepared: (ActorPreparedConstraint | null)[] = [];
  for (const rig of rigs) {
    const nodeLimits = new Map<number, readonly [number, number]>();
    for (const node of rig.nodes) if (node.limits) nodeLimits.set(nodeSlots.get(rig.id)!.get(node.id)!, Object.freeze([node.limits.minRotation, node.limits.maxRotation] as const));
    const view: ActorConstraintRig = Object.freeze({ rigId: rig.id,
      nodeSlot: (id: string) => nodeSlots.get(rig.id)!.get(id) ?? -1, socketSlot: (id: string) => socketSlots.get(rig.id)?.get(id) ?? -1,
      parentSlot: (slot: number) => parents[slot] ?? -1, limits: (slot: number) => nodeLimits.get(slot) ?? null });
    for (const constraint of rig.constraints ?? []) {
      const solver = registry.get(constraint.solver), status = !solver ? 'unsupported' : constraint.enabled ? 'active' : 'disabled';
      statuses.push(Object.freeze({ rigId: rig.id, id: constraint.id, solver: constraint.solver, status }));
      prepared.push(status === 'active' ? solver!.prepare(freeze(structuredClone(constraint)) as ActorConstraint, view) : null);
    }
  }
  const animators = new Map<string, CompiledAnimator>();
  const nodeSubtree = (rigId: string, nodeId: string) => {
    const rig = source.rigs.find(r => r.id === rigId)!, found = new Set([nodeId]);
    for (let grew = true; grew;) { grew = false; for (const n of rig.nodes) if (n.parentId !== null && found.has(n.parentId) && !found.has(n.id)) { found.add(n.id); grew = true; } }
    return found;
  };
  for (const animator of source.animators ?? []) {
    const layers = animator.layers.map(layer => {
      const mask = new Set<number>();
      if (!layer.mask) slots.forEach((slot, i) => { if (slot.kind !== 'socket') mask.add(i); });
      else for (const entry of layer.mask) {
        if (entry.kind === 'attachment') { mask.add(attachmentSlots.get(entry.attachmentId)!); continue; }
        const members = entry.descendants ? nodeSubtree(entry.rigId, entry.nodeId) : new Set([entry.nodeId]);
        for (const id of members) mask.add(nodeSlots.get(entry.rigId)!.get(id)!);
        if (entry.descendants) for (const a of source.attachments) if (a.rigId === entry.rigId && members.has(a.nodeId!)) mask.add(attachmentSlots.get(a.id)!);
      }
      const maskSlots = Int32Array.from([...mask].sort((a, b) => a - b));
      let reference: Float64Array | null = null;
      if (layer.reference) {
        reference = Float64Array.from(rest);
        SAMPLE_TIME[0] = layer.reference.time;
        sampleClip(clips.get(layer.reference.clipId)!, reference, new Uint8Array(slots.length), new Float64Array(slots.length), new Int32Array(slots.length));
      }
      const stateIndex = new Map(layer.states.map((st, i) => [st.id, i] as const)), count = layer.states.length;
      const transitions = new Map<number, number>();
      layer.transitions.forEach((t, i) => transitions.set((t.from === null ? 0 : stateIndex.get(t.from)! + 1) * count + stateIndex.get(t.to)!, i));
      const compiledLayer: CompiledLayer = Object.freeze({ id: layer.id, additive: layer.blend === 'additive', weight: layer.weight, maskSlots, reference,
        stateIds: Object.freeze(layer.states.map(st => st.id)), stateIndex, stateClips: Object.freeze(layer.states.map(st => st.clipId === null ? null : clips.get(st.clipId)!)),
        stateRates: Float64Array.from(layer.states, st => st.rate), stateNext: Int32Array.from(layer.states, st => st.next === undefined ? -1 : stateIndex.get(st.next)!),
        initialState: stateIndex.get(layer.initialStateId)!, transitions,
        transitionDurations: Float64Array.from(layer.transitions, t => t.duration), transitionPriorities: Float64Array.from(layer.transitions, t => t.priority),
        defaultDuration: layer.defaultTransition.duration, defaultPriority: layer.defaultTransition.priority });
      numericBytes += maskSlots.byteLength + (reference?.byteLength ?? 0) + count * 12 + layer.transitions.length * 16;
      return compiledLayer;
    });
    animators.set(animator.id, Object.freeze({ id: animator.id, layers: Object.freeze(layers) }));
  }
  const solverIdentity = [...registry.values()].map(s => `${s.id}@${s.version}`).sort(compareActorIds);
  const identity = JSON.stringify({ compiler: COMPILER_VERSION,
    options: { matrices: 'float64-affine/1', capabilities: ACTOR_PROJECT_CAPABILITIES, solvers: solverIdentity,
      animation: { curveSolver: CURVE_SOLVER, blendStackCap: BLEND_STACK_CAP } },
    limits, source: saveActorProject(source, limits) });
  const compiled: CompiledActorProject = Object.freeze({
    compilerVersion: COMPILER_VERSION, identity, slots: freeze(slots), parts: freeze(source.parts),
    drawSlots: Object.freeze([...source.attachments].sort((a, b) => a.drawOrder < b.drawOrder ? -1 : a.drawOrder > b.drawOrder ? 1 : compareActorIds(a.id, b.id)).map(a => attachmentSlots.get(a.id)!)),
    clipIds: Object.freeze([...clips.keys()].sort(compareActorIds)), constraints: Object.freeze(statuses),
    animators: freeze((source.animators ?? []).map((a: ActorAnimator) => ({ id: a.id, layers: a.layers.map(l => ({ id: l.id, blend: l.blend, initialStateId: l.initialStateId, stateIds: l.states.map(st => st.id) })) }))),
    numericBytes,
  });
  const update: ActorPoseUpdater = Object.freeze({
    recompose: (pose: ActorPose, slot: number) => composeSlot(parents, pose.localTRS, pose.localMatrices, pose.worldMatrices, slot),
    refreshWorld: (pose: ActorPose, slot: number) => composeWorld(parents, pose.localMatrices, pose.worldMatrices, slot),
  });
  resources.set(compiled, { rest, restDrawOrders, restParts, clips, parents, prepared: Object.freeze(prepared), update, animators, attachmentCount: source.attachments.length });
  return compiled;
}

/** Precomputes curve codes, Bézier polynomial coefficients and shortest-arc
 * rotation deltas. Tracks without B2 fields keep null arrays (A1 path). */
function compileTrack(track: ActorTrack, slot: number): CompiledTrack {
  const n = track.keys.length, times = new Float64Array(n), values = new Float64Array(n * 5);
  track.keys.forEach((key, i) => { times[i] = key.time; writeTRS(values, i * 5, key.value); });
  const step = track.interpolation === 'step';
  let curves: Uint8Array | null = null, bezier: Float64Array | null = null, deltas: Float64Array | null = null;
  if (track.keys.some(k => k.curve !== undefined)) {
    curves = new Uint8Array(n);
    track.keys.forEach((key, i) => {
      const curve = key.curve ?? (step ? 'step' : 'linear');
      if (curve === 'step') { curves![i] = STEP; return; }
      if (curve === 'linear') { curves![i] = LINEAR; return; }
      curves![i] = BEZIER; bezier ??= new Float64Array(n * 6);
      const [x1, y1, x2, y2] = curve === 'cubic-bezier' ? key.bezier! : PRESETS[curve]!;
      // B(s) = 3(1-s)^2 s p1 + 3(1-s) s^2 p2 + s^3 = ((a s + b) s + c) s
      const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, cy = 3 * y1, by = 3 * (y2 - y1) - cy;
      bezier.set([1 - cx - bx, bx, cx, 1 - cy - by, by, cy], i * 6);
    });
  }
  if (track.angle === 'shortest') {
    deltas = new Float64Array(n);
    for (let i = 0; i + 1 < n; i++) {
      const d = track.keys[i + 1]!.value.rotation - track.keys[i]!.value.rotation;
      deltas[i] = d - TAU * Math.floor((d + Math.PI) / TAU) + TAU * (track.keys[i]!.turns ?? 0);
    }
  }
  return { slot, step, times, values, curves, bezier, deltas };
}

/** Allocates this instance's buffers once and initializes the rest pose. */
export function createActorPose(compiled: CompiledActorProject): ActorPose {
  const data = requireResources(compiled);
  const count = compiled.slots.length;
  const pose: ActorPose = Object.freeze({ localTRS: new Float64Array(count * 5),
    localMatrices: new Float64Array(count * 6), worldMatrices: new Float64Array(count * 6),
    constraintResiduals: new Float64Array(compiled.constraints.length),
    localVisible: new Uint8Array(count), visible: new Uint8Array(count), drawOrders: new Float64Array(count),
    drawSequence: Int32Array.from(compiled.drawSlots), partIndices: new Int32Array(count) });
  if (pose.drawSequence.length !== data.attachmentCount) throw new TypeError('Inconsistent compiled attachments');
  owners.set(pose, compiled);
  evaluateActorPose(compiled, null, 0, pose);
  return pose;
}

/** @internal Throws before mutation when the pose belongs to another compile. */
export function checkPose(compiled: CompiledActorProject, data: ActorResources, into: ActorPose) {
  const count = compiled.slots.length;
  if (owners.get(into) !== compiled || into.localTRS.length !== count * 5 || into.localMatrices.length !== count * 6 || into.worldMatrices.length !== count * 6
    || into.constraintResiduals.length !== data.prepared.length || into.localVisible.length !== count || into.visible.length !== count
    || into.drawOrders.length !== count || into.partIndices.length !== count || into.drawSequence.length !== data.attachmentCount) throw new TypeError('Pose buffers do not belong to this compiled actor');
}

/** Writes all slots, first resetting to rest. Null clip explicitly requests rest;
 * unknown clips/non-finite times/foreign buffers fail before mutation. No events,
 * wall clock or per-evaluation allocations on the successful path. A transform
 * chain overflowing Float64 throws RangeError; that partial pose must not draw.
 * Active visual constraints then run in `compiled.constraints` order unless
 * `applyConstraints` is false (raw clip/rest pose with NaN residuals).
 * `timeSeconds` is clip time: once clamps, loop wraps, ping-pong reflects. */
export function evaluateActorPose(compiled: CompiledActorProject, clipId: string | null, timeSeconds: number, into: ActorPose, applyConstraints = true): void {
  const data = requireResources(compiled);
  const clip = clipId === null ? undefined : data.clips.get(clipId);
  if (clipId !== null && !clip) throw new RangeError('Unknown actor clip; select a fallback explicitly');
  if (!Number.isFinite(timeSeconds)) throw new RangeError('Actor time must be finite seconds');
  checkPose(compiled, data, into);
  into.localTRS.set(data.rest); into.localVisible.fill(1); into.drawOrders.set(data.restDrawOrders); into.partIndices.set(data.restParts);
  if (clip) { SAMPLE_TIME[0] = timeSeconds; sampleClip(clip, into.localTRS, into.localVisible, into.drawOrders, into.partIndices); }
  finishPose(compiled, data, into, applyConstraints);
}

/** @internal Samples `clip` at SAMPLE_TIME[0] (clip seconds before the playback
 * mapping) and overwrites only the slots/channels the clip tracks. Arithmetic
 * only: no allocation, no double arguments or return values. */
export function sampleClip(clip: CompiledClip, trs: Float64Array, visible: Uint8Array, orders: Float64Array, parts: Int32Array): void {
  const duration = clip.duration;
  let time = SAMPLE_TIME[0]!;
  if (clip.mode === LOOP) {
    // Adding duration before modulo can overflow even for finite input.
    time = time % duration;
    if (time < 0) time += duration;
    if (time >= duration) time = 0;
  } else if (clip.mode === PING_PONG) {
    const period = duration + duration;
    time = time % period;
    if (time < 0) time += period;
    if (time >= period) time = 0;
    if (time > duration) time = period - time;
  } else time = Math.max(0, Math.min(duration, time));
  const tracks = clip.tracks;
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i]!, times = track.times, values = track.values, curves = track.curves;
    // Upper bound gives the latest key <= time, including exact step keys.
    let low = 0, high = times.length;
    while (low < high) { const mid = (low + high) >>> 1; if (times[mid]! <= time) low = mid + 1; else high = mid; }
    const left = Math.max(0, low - 1), right = Math.min(times.length - 1, low);
    let fraction = 0;
    if (left !== right && time > times[left]!) {
      const code = curves === null ? (track.step ? STEP : LINEAR) : curves[left]!;
      if (code !== STEP) fraction = (time - times[left]!) / (times[right]! - times[left]!);
      if (code === BEZIER && fraction !== 0) {
        const c = track.bezier!, q = left * 6, ax = c[q]!, bx = c[q + 1]!, cx = c[q + 2]!, u = fraction;
        // Solve X(s) = u on [0, 1] (monotonic for x1, x2 in [0, 1]): Newton,
        // then bisection if Newton stalls or leaves the interval.
        let s = u, solved = false;
        for (let it = 0; it < 8; it++) {
          const e = ((ax * s + bx) * s + cx) * s - u;
          if (e <= 1e-12 && e >= -1e-12) { solved = true; break; }
          const d = (3 * ax * s + 2 * bx) * s + cx;
          if (d <= 1e-9 && d >= -1e-9) break;
          s -= e / d;
          if (s < 0 || s > 1) break;
        }
        if (!solved) {
          let lo = 0, hi = 1; s = u;
          for (let it = 0; it < 64; it++) {
            const e = ((ax * s + bx) * s + cx) * s - u;
            if (e <= 1e-12 && e >= -1e-12) break;
            if (e < 0) lo = s; else hi = s;
            s = (lo + hi) * 0.5;
          }
        }
        fraction = ((c[q + 3]! * s + c[q + 4]!) * s + c[q + 5]!) * s;
      }
    }
    const offset = track.slot * 5, a = left * 5, b = right * 5, deltas = track.deltas;
    for (let k = 0; k < 5; k++) trs[offset + k] = fraction === 0 ? values[a + k]! : values[a + k]! * (1 - fraction) + values[b + k]! * fraction;
    if (deltas !== null && fraction !== 0) trs[offset + 2] = values[a + 2]! + deltas[left]! * fraction;
  }
  const visibility = clip.visibility;
  for (let i = 0; i < visibility.length; i++) {
    const track = visibility[i]!, times = track.times;
    let low = 0, high = times.length;
    while (low < high) { const mid = (low + high) >>> 1; if (times[mid]! <= time) low = mid + 1; else high = mid; }
    visible[track.slot] = track.values[low > 0 ? low - 1 : 0]!;
  }
  const order = clip.drawOrder;
  for (let i = 0; i < order.length; i++) {
    const track = order[i]!, times = track.times;
    let low = 0, high = times.length;
    while (low < high) { const mid = (low + high) >>> 1; if (times[mid]! <= time) low = mid + 1; else high = mid; }
    orders[track.slot] = track.values[low > 0 ? low - 1 : 0]!;
  }
  const cels = clip.cels;
  for (let i = 0; i < cels.length; i++) {
    const track = cels[i]!, times = track.times;
    let low = 0, high = times.length;
    while (low < high) { const mid = (low + high) >>> 1; if (times[mid]! <= time) low = mid + 1; else high = mid; }
    parts[track.slot] = track.values[low > 0 ? low - 1 : 0]!;
  }
}

/** @internal Composes matrices, solves constraints in declared order, then
 * derives effective visibility and the painter sequence. */
export function finishPose(compiled: CompiledActorProject, data: ActorResources, into: ActorPose, applyConstraints: boolean): void {
  const count = compiled.slots.length, trs = into.localTRS, local = into.localMatrices, world = into.worldMatrices;
  const parents = data.parents, residuals = into.constraintResiduals, prepared = data.prepared;
  for (let i = 0; i < count; i++) composeSlot(parents, trs, local, world, i);
  for (let k = 0; k < prepared.length; k++) {
    const constraint = prepared[k];
    if (!applyConstraints || !constraint) { residuals[k] = NaN; continue; }
    constraint.solve(into, data.update, k);
    for (let i = constraint.firstSlot; i < count; i++) composeWorld(parents, local, world, i);
  }
  // Parents precede children in slot order (nodes parent-first, then sockets, then attachments).
  const own = into.localVisible, visible = into.visible;
  for (let i = 0; i < count; i++) { const parent = parents[i]!; visible[i] = own[i]! !== 0 && (parent < 0 || visible[parent]! !== 0) ? 1 : 0; }
  // Reset caller-mutable output before sorting; successful evaluation overwrites
  // every output, even after callers inspect or modify pose buffers.
  into.drawSequence.set(compiled.drawSlots);
  // Insertion sort of the retained sequence: the order is total (draw order,
  // then slot index = stable ID order), so the result never depends on the
  // previous frame; unchanged/default painter order keeps it linear.
  const sequence = into.drawSequence, orders = into.drawOrders;
  for (let i = 1; i < sequence.length; i++) {
    const slot = sequence[i]!, order = orders[slot]!;
    let j = i - 1;
    while (j >= 0) {
      const other = sequence[j]!, otherOrder = orders[other]!;
      if (otherOrder < order || otherOrder === order && other < slot) break;
      sequence[j + 1] = other; j--;
    }
    sequence[j + 1] = slot;
  }
}
