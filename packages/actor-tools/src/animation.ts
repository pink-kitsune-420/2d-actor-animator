import {
  BLEND_STACK_CAP, SAMPLE_TIME, beginPose, checkPose, finishPose, requireResources, sampleClip,
  type ActorPose, type CompiledActorProject, type CompiledAnimator, type CompiledLayer,
} from './evaluator';

/** Outcome of one request. `already-active`: the layer's newest entry is that
 * state (no restart). `rejected-priority`: the newest entry is still fading in
 * with a higher transition priority; dropped, never queued. `out-of-order`:
 * earlier than the previous request or the origin; not recorded. `capacity`:
 * the request history is full; trim it first. */
export type ActorRequestOutcome = 'accepted' | 'already-active' | 'rejected-priority' | 'out-of-order' | 'capacity';
const OUTCOMES: readonly ActorRequestOutcome[] = ['accepted', 'accepted', 'already-active', 'rejected-priority'];
const ACCEPTED = 1, ALREADY = 2, REJECTED = 3;
const TAU = 2 * Math.PI;

/** Per-instance composition state for one animator. Opaque: create with
 * `createActorAnimationPlayer`, drive with requests, sample with
 * `evaluateActorAnimation`. Holds presentation data only; no callbacks. */
export interface ActorAnimationPlayer {
  readonly animatorId: string;
  readonly layerIds: readonly string[];
}

export interface ActorAnimationPlayerOptions {
  /** Time at which every layer enters its initial state (seconds, default 0). */
  origin?: number;
  /** Retained request history capacity (default 1024). */
  maxRequests?: number;
}

/** Diagnostic snapshot for tools (allocates; not for per-frame hot paths). */
export interface ActorAnimationStatus {
  readonly time: number;
  readonly droppedEntries: number;
  readonly layers: readonly {
    readonly id: string;
    /** Bottom to top; weight is the entry's effective share of the layer pose. */
    readonly entries: readonly { readonly stateId: string; readonly start: number; readonly fade: number; readonly weight: number; readonly clipTime: number | null }[];
  }[];
  readonly requests: readonly { readonly time: number; readonly layerId: string; readonly stateId: string; readonly outcome: ActorRequestOutcome | 'pending' }[];
}

interface PlayerData {
  readonly compiled: CompiledActorProject;
  readonly animator: CompiledAnimator;
  origin: number;
  readonly capacity: number;
  readonly reqTime: Float64Array; readonly reqLayer: Int32Array; readonly reqState: Int32Array; readonly reqOutcome: Uint8Array;
  reqCount: number;
  /** Per layer BLEND_STACK_CAP entries, bottom first. */
  readonly state: Int32Array; readonly start: Float64Array; readonly fade: Float64Array; readonly priority: Float64Array; readonly length: Int32Array;
  /** Stacks at the origin (copied by trim; initial states otherwise). */
  readonly originState: Int32Array; readonly originStart: Float64Array; readonly originFade: Float64Array; readonly originPriority: Float64Array; readonly originLength: Int32Array;
  readonly cursor: Int32Array;
  /** [0] target time, [1] processed time; typed so no double crosses a call. */
  readonly clock: Float64Array;
  readonly eventTime: Float64Array;
  readonly dropped: Int32Array;
  readonly acc: Float64Array; readonly entry: Float64Array;
  readonly accParts: Int32Array; readonly entryParts: Int32Array;
  readonly accVisible: Uint8Array; readonly entryVisible: Uint8Array; readonly accOrder: Float64Array; readonly entryOrder: Float64Array;
}
const players = new WeakMap<ActorAnimationPlayer, PlayerData>();

function playerData(player: ActorAnimationPlayer): PlayerData {
  const data = players.get(player);
  if (!data) throw new TypeError('Expected an actor animation player');
  return data;
}
function layerIndex(data: PlayerData, layerId: string): number {
  const index = data.animator.layers.findIndex(l => l.id === layerId);
  if (index < 0) throw new RangeError(`Unknown animator layer ${layerId}`);
  return index;
}

/** One player per actor instance. Every layer starts in its initial state at
 * `origin`, fully weighted. Allocates all retained buffers here. */
export function createActorAnimationPlayer(compiled: CompiledActorProject, animatorId: string, options: ActorAnimationPlayerOptions = {}): ActorAnimationPlayer {
  const resources = requireResources(compiled), animator = resources.animators.get(animatorId);
  if (!animator) throw new RangeError('Unknown animator; select a fallback explicitly');
  const origin = options.origin ?? 0, capacity = options.maxRequests ?? 1024;
  if (!Number.isFinite(origin)) throw new RangeError('Animation origin must be finite seconds');
  if (!Number.isSafeInteger(capacity) || capacity < 0) throw new RangeError('maxRequests must be a non-negative safe integer');
  const layers = animator.layers.length, entries = layers * BLEND_STACK_CAP, slots = compiled.slots.length;
  const data: PlayerData = { compiled, animator, origin, capacity,
    reqTime: new Float64Array(capacity), reqLayer: new Int32Array(capacity), reqState: new Int32Array(capacity), reqOutcome: new Uint8Array(capacity), reqCount: 0,
    state: new Int32Array(entries), start: new Float64Array(entries), fade: new Float64Array(entries), priority: new Float64Array(entries), length: new Int32Array(layers),
    originState: new Int32Array(entries), originStart: new Float64Array(entries), originFade: new Float64Array(entries), originPriority: new Float64Array(entries), originLength: new Int32Array(layers),
    cursor: new Int32Array(layers), clock: new Float64Array(2), eventTime: new Float64Array(1), dropped: new Int32Array(2),
    acc: new Float64Array(slots * 5), entry: new Float64Array(slots * 5),
    accParts: new Int32Array(slots), entryParts: new Int32Array(slots),
    accVisible: new Uint8Array(slots), entryVisible: new Uint8Array(slots), accOrder: new Float64Array(slots), entryOrder: new Float64Array(slots) };
  animator.layers.forEach((layer, l) => {
    const b = l * BLEND_STACK_CAP;
    data.originState[b] = layer.initialState; data.originStart[b] = origin; data.originFade[b] = 0; data.originPriority[b] = -Infinity; data.originLength[l] = 1;
  });
  rewind(data);
  const player: ActorAnimationPlayer = Object.freeze({ animatorId, layerIds: Object.freeze(animator.layers.map(l => l.id)) });
  players.set(player, data);
  return player;
}

function rewind(data: PlayerData) {
  data.state.set(data.originState); data.start.set(data.originStart); data.fade.set(data.originFade); data.priority.set(data.originPriority);
  data.length.set(data.originLength); data.cursor.fill(0); data.dropped[0] = data.dropped[1]!; data.clock[1] = data.origin;
}

/** Records a state request for one layer at `timeSeconds` and returns its
 * outcome. Requests must be appended in non-decreasing time, not before the
 * origin. Unknown layer/state IDs throw. The outcome is a pure function of the
 * request history, so replays (seeks) reproduce it. */
export function requestActorAnimationState(player: ActorAnimationPlayer, layerId: string, stateId: string, timeSeconds: number): ActorRequestOutcome {
  const data = playerData(player), l = layerIndex(data, layerId), state = data.animator.layers[l]!.stateIndex.get(stateId);
  if (state === undefined) throw new RangeError(`Unknown state ${stateId} in layer ${layerId}`);
  if (!Number.isFinite(timeSeconds)) throw new RangeError('Request time must be finite seconds');
  if (timeSeconds < data.origin || data.reqCount > 0 && timeSeconds < data.reqTime[data.reqCount - 1]!) return 'out-of-order';
  if (data.reqCount === data.capacity) return 'capacity';
  const index = data.reqCount++;
  data.reqTime[index] = timeSeconds; data.reqLayer[index] = l; data.reqState[index] = state; data.reqOutcome[index] = 0;
  data.clock[0] = timeSeconds; advance(data);
  return OUTCOMES[data.reqOutcome[index]!]!;
}

/** Drops processed history so the request capacity is reusable during long
 * play: the current stacks become the new origin at the processed time.
 * Later seeks must not go before that time (they replay from it). */
export function trimActorAnimationHistory(player: ActorAnimationPlayer): void {
  const data = playerData(player), processed = data.clock[1]!;
  let keep = 0;
  while (keep < data.reqCount && data.reqTime[keep]! <= processed) keep++;
  // Pending requests at the processed time were already applied (<=).
  const remaining = data.reqCount - keep;
  data.reqTime.copyWithin(0, keep, data.reqCount); data.reqLayer.copyWithin(0, keep, data.reqCount);
  data.reqState.copyWithin(0, keep, data.reqCount); data.reqOutcome.copyWithin(0, keep, data.reqCount);
  data.reqCount = remaining;
  data.originState.set(data.state); data.originStart.set(data.start); data.originFade.set(data.fade); data.originPriority.set(data.priority);
  data.originLength.set(data.length); data.origin = processed;
  data.dropped[1] = data.dropped[0]!; rewind(data);
}

/** Processes automatic end transitions and requests up to clock[0], in time
 * order (automatic first at equal times). Rewinds when time goes backwards. */
function advance(data: PlayerData) {
  const target = data.clock[0]!;
  if (target < data.origin) throw new RangeError('Cannot seek before the animation history origin');
  if (target < data.clock[1]!) rewind(data);
  const layers = data.animator.layers;
  for (let l = 0; l < layers.length; l++) {
    const layer = layers[l]!, b = l * BLEND_STACK_CAP;
    for (;;) {
      let cursor = data.cursor[l]!;
      while (cursor < data.reqCount && data.reqLayer[cursor] !== l) cursor++;
      data.cursor[l] = cursor;
      const requestTime = cursor < data.reqCount ? data.reqTime[cursor]! : Infinity;
      const top = b + data.length[l]! - 1, topState = data.state[top]!, next = layer.stateNext[topState]!;
      let endTime = Infinity;
      if (next >= 0) {
        const rate = layer.stateRates[topState]!;
        endTime = data.start[top]! + layer.stateClips[topState]!.duration / (rate < 0 ? -rate : rate);
      }
      if (endTime <= target && endTime <= requestTime) { data.eventTime[0] = endTime; push(data, layer, l, next, true); continue; }
      if (requestTime <= target) { data.eventTime[0] = requestTime; data.reqOutcome[cursor] = push(data, layer, l, data.reqState[cursor]!, false); data.cursor[l] = cursor + 1; continue; }
      break;
    }
  }
  if (target > data.clock[1]!) data.clock[1] = target;
}

/** Applies one event at time `at`; returns ACCEPTED/ALREADY/REJECTED. */
function push(data: PlayerData, layer: CompiledLayer, l: number, state: number, automatic: boolean): number {
  const at = data.eventTime[0]!;
  const b = l * BLEND_STACK_CAP;
  let length = data.length[l]!;
  // Prune entries hidden by a fade completed at or before `at` (event time only,
  // so the stack never depends on when samples happened).
  for (let k = length - 1; k > 0; k--) {
    if (data.start[b + k]! + data.fade[b + k]! <= at) {
      data.state.copyWithin(b, b + k, b + length); data.start.copyWithin(b, b + k, b + length);
      data.fade.copyWithin(b, b + k, b + length); data.priority.copyWithin(b, b + k, b + length);
      length -= k; break;
    }
  }
  const top = b + length - 1, current = data.state[top]!;
  data.length[l] = length;
  if (current === state) return ALREADY;
  const count = layer.stateIds.length;
  let index = layer.transitions.get((current + 1) * count + state);
  if (index === undefined) index = layer.transitions.get(state);
  const duration = index === undefined ? layer.defaultDuration : layer.transitionDurations[index]!;
  const priority = index === undefined ? layer.defaultPriority : layer.transitionPriorities[index]!;
  const fading = data.start[top]! + data.fade[top]! > at;
  if (!automatic && fading && priority < data.priority[top]!) return REJECTED;
  if (duration === 0) length = 0;
  else if (length === BLEND_STACK_CAP) {
    data.state.copyWithin(b, b + 1, b + length); data.start.copyWithin(b, b + 1, b + length);
    data.fade.copyWithin(b, b + 1, b + length); data.priority.copyWithin(b, b + 1, b + length);
    length--; data.dropped[0]!++;
  }
  data.state[b + length] = state; data.start[b + length] = at; data.fade[b + length] = duration; data.priority[b + length] = priority;
  data.length[l] = length + 1;
  return ACCEPTED;
}

/** Writes the composed pose at `timeSeconds` (player time, same clock as
 * requests): rest, then each layer bottom to top, then B1 constraints in their
 * declared order. Never records requests or emits anything; times at or after the retained
 * history origin may be sampled (backward seeks replay deterministically). Allocation-free on the
 * successful path. Throws before mutation for foreign players/poses or
 * non-finite time; a Float64 overflow throws and the partial pose must not draw. */
export function evaluateActorAnimation(compiled: CompiledActorProject, player: ActorAnimationPlayer, timeSeconds: number, into: ActorPose, applyConstraints = true): void {
  const resources = requireResources(compiled), data = playerData(player);
  if (data.compiled !== compiled) throw new TypeError('Animation player belongs to another compiled actor');
  if (!Number.isFinite(timeSeconds)) throw new RangeError('Actor time must be finite seconds');
  checkPose(compiled, resources, into);
  beginPose(into);
  data.clock[0] = timeSeconds; advance(data);
  into.localTRS.set(resources.rest); into.localVisible.fill(1); into.drawOrders.set(resources.restDrawOrders); into.partIndices.set(resources.restParts);
  const layers = data.animator.layers;
  for (let l = 0; l < layers.length; l++) blendLayer(data, l, into);
  finishPose(compiled, resources, into, applyConstraints);
}

/** Samples a stack entry's clip into the given buffers (tracked slots only). */
function sampleEntry(data: PlayerData, layer: CompiledLayer, k: number, trs: Float64Array, visible: Uint8Array, orders: Float64Array, parts: Int32Array) {
  const state = data.state[k]!, clip = layer.stateClips[state];
  if (!clip) return;
  const rate = layer.stateRates[state]!, elapsed = (data.clock[0]! - data.start[k]!) * rate;
  const time = rate >= 0 ? elapsed : clip.duration + elapsed;
  if (!Number.isFinite(time)) throw new RangeError('Animation clip time exceeds Float64 range');
  SAMPLE_TIME[0] = time;
  sampleClip(clip, trs, visible, orders, parts);
}

function blendLayer(data: PlayerData, l: number, into: ActorPose) {
  const layer = data.animator.layers[l]!, weight = layer.weight;
  if (weight <= 0) return;
  const t = data.clock[0]!, b = l * BLEND_STACK_CAP, length = data.length[l]!;
  const mask = layer.maskSlots, additive = layer.additive, reference = layer.reference!;
  const trs = into.localTRS, localVisible = into.localVisible, drawOrders = into.drawOrders;
  const base = additive ? reference : trs, acc = data.acc, entry = data.entry;
  const accParts = data.accParts, entryParts = data.entryParts, parts = into.partIndices;
  const accVisible = data.accVisible, accOrder = data.accOrder, entryVisible = data.entryVisible, entryOrder = data.entryOrder;
  // The newest fully faded-in entry hides everything below it.
  let bottom = 0;
  for (let k = length - 1; k > 0; k--) {
    const fade = data.fade[b + k]!;
    if (fade <= 0 || t - data.start[b + k]! >= fade) { bottom = k; break; }
  }
  for (let m = 0; m < mask.length; m++) {
    const s = mask[m]!, o = s * 5;
    acc[o] = base[o]!; acc[o + 1] = base[o + 1]!; acc[o + 2] = base[o + 2]!; acc[o + 3] = base[o + 3]!; acc[o + 4] = base[o + 4]!;
    accVisible[s] = localVisible[s]!; accOrder[s] = drawOrders[s]!; accParts[s] = parts[s]!;
  }
  // Additive layers ignore discrete channels: sample those into scratch.
  sampleEntry(data, layer, b + bottom, acc, additive ? entryVisible : accVisible, additive ? entryOrder : accOrder, additive ? entryParts : accParts);
  for (let k = bottom + 1; k < length; k++) {
    const fade = data.fade[b + k]!;
    let r = (t - data.start[b + k]!) / fade;
    if (r < 0) r = 0; else if (r > 1) r = 1;
    const clip = layer.stateClips[data.state[b + k]!];
    sampleEntry(data, layer, b + k, entry, entryVisible, entryOrder, entryParts);
    for (let m = 0; m < mask.length; m++) {
      const s = mask[m]!, o = s * 5, tracked = clip != null && clip.trackedTRS[s] === 1, src = tracked ? entry : base;
      if (r >= 1) { acc[o] = src[o]!; acc[o + 1] = src[o + 1]!; acc[o + 2] = src[o + 2]!; acc[o + 3] = src[o + 3]!; acc[o + 4] = src[o + 4]!; }
      else if (r > 0) {
        acc[o] = acc[o]! + (src[o]! - acc[o]!) * r; acc[o + 1] = acc[o + 1]! + (src[o + 1]! - acc[o + 1]!) * r;
        const d = src[o + 2]! - acc[o + 2]!; acc[o + 2] = acc[o + 2]! + (d - TAU * Math.floor((d + Math.PI) / TAU)) * r;
        acc[o + 3] = acc[o + 3]! + (src[o + 3]! - acc[o + 3]!) * r; acc[o + 4] = acc[o + 4]! + (src[o + 4]! - acc[o + 4]!) * r;
      }
      if (!additive && r >= 0.5) {
        accVisible[s] = clip != null && clip.trackedVisible[s] === 1 ? entryVisible[s]! : localVisible[s]!;
        accOrder[s] = clip != null && clip.trackedOrder[s] === 1 ? entryOrder[s]! : drawOrders[s]!;
        accParts[s] = clip != null && clip.trackedParts[s] === 1 ? entryParts[s]! : parts[s]!;
      }
    }
  }
  for (let m = 0; m < mask.length; m++) {
    const s = mask[m]!, o = s * 5;
    if (additive) {
      for (let c = 0; c < 5; c++) trs[o + c] = trs[o + c]! + weight * (acc[o + c]! - reference[o + c]!);
    } else if (weight >= 1) {
      trs[o] = acc[o]!; trs[o + 1] = acc[o + 1]!; trs[o + 2] = acc[o + 2]!; trs[o + 3] = acc[o + 3]!; trs[o + 4] = acc[o + 4]!;
      localVisible[s] = accVisible[s]!; drawOrders[s] = accOrder[s]!; parts[s] = accParts[s]!;
    } else {
      trs[o] = trs[o]! + (acc[o]! - trs[o]!) * weight; trs[o + 1] = trs[o + 1]! + (acc[o + 1]! - trs[o + 1]!) * weight;
      const d = acc[o + 2]! - trs[o + 2]!; trs[o + 2] = trs[o + 2]! + (d - TAU * Math.floor((d + Math.PI) / TAU)) * weight;
      trs[o + 3] = trs[o + 3]! + (acc[o + 3]! - trs[o + 3]!) * weight; trs[o + 4] = trs[o + 4]! + (acc[o + 4]! - trs[o + 4]!) * weight;
      if (weight >= 0.5) { localVisible[s] = accVisible[s]!; drawOrders[s] = accOrder[s]!; parts[s] = accParts[s]!; }
    }
  }
}

/** Snapshot of the processed stacks at `timeSeconds` and of the recorded
 * requests, for editor display. Advances processing like a sample would. */
export function describeActorAnimation(player: ActorAnimationPlayer, timeSeconds: number): ActorAnimationStatus {
  const data = playerData(player);
  if (!Number.isFinite(timeSeconds)) throw new RangeError('Actor time must be finite seconds');
  data.clock[0] = timeSeconds; advance(data);
  const layers = data.animator.layers.map((layer, l) => {
    const b = l * BLEND_STACK_CAP, length = data.length[l]!;
    let bottom = 0;
    for (let k = length - 1; k > 0; k--) { const fade = data.fade[b + k]!; if (fade <= 0 || timeSeconds - data.start[b + k]! >= fade) { bottom = k; break; } }
    const ramps = Array.from({ length }, (_, k) => k <= bottom ? (k === bottom ? 1 : 0) : Math.min(1, Math.max(0, (timeSeconds - data.start[b + k]!) / data.fade[b + k]!)));
    const entries = ramps.map((r, k) => {
      let weight = r;
      for (let j = k + 1; j < length; j++) weight *= 1 - ramps[j]!;
      const state = data.state[b + k]!, clip = layer.stateClips[state], rate = layer.stateRates[state]!, elapsed = (timeSeconds - data.start[b + k]!) * rate;
      return { stateId: layer.stateIds[state]!, start: data.start[b + k]!, fade: data.fade[b + k]!, weight, clipTime: clip ? rate >= 0 ? elapsed : clip.duration + elapsed : null };
    });
    return { id: layer.id, entries };
  });
  const requests = Array.from({ length: data.reqCount }, (_, i) => ({ time: data.reqTime[i]!, layerId: data.animator.layers[data.reqLayer[i]!]!.id,
    stateId: data.animator.layers[data.reqLayer[i]!]!.stateIds[data.reqState[i]!]!, outcome: data.reqTime[i]! <= data.clock[1]! ? OUTCOMES[data.reqOutcome[i]!]! : 'pending' as const }));
  return { time: timeSeconds, droppedEntries: data.dropped[0]!, layers, requests };
}
