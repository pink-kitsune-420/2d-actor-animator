import type {
  ActorCcdChainSettings, ActorConstraint, ActorJointLimits, ActorNode, ActorProject, ActorRig, ActorRigPoint,
  ActorTrack, ActorTrackTarget, ActorTransform,
} from '@actor-animator/types';
import { CCD_CHAIN_SOLVER, RIG_CONSTRAINTS_CAPABILITY, validateActorProject } from './project';

/** Pure source operations for skeleton editing. Each mutates the given
 * project in place (callers pass a transaction copy) and throws ActorEditError
 * before returning when the edit cannot be represented; callers discard the
 * copy, so a rejected edit never changes the original. Rest poses define
 * structure; evaluated poses never feed these operations. */

/** Affine `[a,b,c,d,tx,ty]`, mapping (x,y) to (a*x+c*y+tx, b*x+d*y+ty). */
export type ActorMatrix = [number, number, number, number, number, number];
export type ActorRigItem = { kind: 'node' | 'socket'; rigId: string; id: string } | { kind: 'attachment'; id: string };
/** A rig node, or null for the rig root level (nodes) / scene root (attachments). */
export type ActorParentRef = { rigId: string; nodeId: string } | null;
export type ActorPreserveMode = 'local' | 'world';
export type ActorDeletePolicy = 'lift-world' | 'lift-local' | 'subtree';

export class ActorEditError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'ActorEditError'; }
}
const fail = (code: string, message: string): never => { throw new ActorEditError(code, message); };

/** Relative orthogonality/equal-length tolerance for TRS representability. */
export const REPRESENTABLE_TOLERANCE = 1e-9;

export function transformMatrix(t: ActorTransform): ActorMatrix {
  const cos = Math.cos(t.rotation), sin = Math.sin(t.rotation);
  return [cos * t.scaleX, sin * t.scaleX, -sin * t.scaleY, cos * t.scaleY, t.x, t.y];
}
/** Returns p * q (q applied first). */
export function multiplyMatrices(p: ActorMatrix, q: ActorMatrix): ActorMatrix {
  return [p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1], p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3],
    p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5]];
}
const IDENTITY: ActorMatrix = [1, 0, 0, 1, 0, 0];
function singular(m: ActorMatrix): boolean {
  const scale = Math.max(1, Math.abs(m[0]), Math.abs(m[1]), Math.abs(m[2]), Math.abs(m[3]));
  return Math.abs(m[0] * m[3] - m[1] * m[2]) <= 1e-12 * scale * scale;
}
/** Null for a singular (collapsed) linear part. */
export function invertMatrix(m: ActorMatrix): ActorMatrix | null {
  if (singular(m)) return null;
  const det = m[0] * m[3] - m[1] * m[2], a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}
/** Similarity: orthogonal, equal-length, nonzero columns (reflection allowed). */
export function isSimilarity(m: ActorMatrix): boolean {
  const n1 = Math.hypot(m[0], m[1]), n2 = Math.hypot(m[2], m[3]);
  return n1 > 0 && n2 > 0 && Math.abs(m[0] * m[2] + m[1] * m[3]) <= REPRESENTABLE_TOLERANCE * n1 * n2
    && Math.abs(n1 - n2) <= REPRESENTABLE_TOLERANCE * Math.max(n1, n2);
}
const TAU = 2 * Math.PI;
const unwrapNear = (rotation: number, reference: number) => rotation + TAU * Math.round((reference - rotation) / TAU);
function matches(m: ActorMatrix, t: ActorTransform): boolean {
  const back = transformMatrix(t), tolerance = REPRESENTABLE_TOLERANCE * (1 + Math.max(...m.map(Math.abs)));
  return back.every((v, i) => Math.abs(v - m[i]!) <= tolerance);
}
/** Local TRS for a matrix, or null when it needs shear (non-orthogonal
 * columns) or is not finite. Of the equivalent (θ,sx,sy)/(θ+π,-sx,-sy) forms,
 * unwrapped near `reference`, the rotation nearest the reference wins. */
export function decomposeMatrix(m: ActorMatrix, reference = 0): ActorTransform | null {
  if (!m.every(Number.isFinite)) return null;
  const [a, b, c, d, x, y] = m, n1 = Math.hypot(a, b), n2 = Math.hypot(c, d);
  if (n1 > 0 && n2 > 0 && Math.abs(a * c + b * d) > REPRESENTABLE_TOLERANCE * n1 * n2) return null;
  let rotation = reference, sx = 0, sy = 0;
  if (n1 > 0) { rotation = Math.atan2(b, a); sx = n1; sy = (a * d - b * c) / n1; }
  else if (n2 > 0) { rotation = Math.atan2(-c, d); sy = n2; }
  const r1 = unwrapNear(rotation, reference), r2 = unwrapNear(rotation + Math.PI, reference);
  const t = Math.abs(r2 - reference) < Math.abs(r1 - reference)
    ? { x, y, rotation: r2, scaleX: 0 - sx, scaleY: 0 - sy } : { x, y, rotation: r1, scaleX: sx, scaleY: sy };
  return matches(m, t) ? t : null;
}
/** `C * T(t)` as TRS. A similarity composes exactly (rotation +/- its angle,
 * scales times its length), so linear key interpolation commutes with it.
 * Reflected: C = s*R(φ)*diag(1,-1), so C*R(θ)*S = R(φ-θ)*diag(s*sx, -s*sy). */
function correct(c: ActorMatrix, t: ActorTransform): ActorTransform | null {
  const target = multiplyMatrices(c, transformMatrix(t));
  if (isSimilarity(c)) {
    const s = Math.hypot(c[0], c[1]), angle = Math.atan2(c[1], c[0]), reflected = c[0] * c[3] - c[1] * c[2] < 0;
    const result = reflected
      ? { x: target[4], y: target[5], rotation: angle - t.rotation, scaleX: s * t.scaleX, scaleY: -s * t.scaleY }
      : { x: target[4], y: target[5], rotation: angle + t.rotation, scaleX: s * t.scaleX, scaleY: s * t.scaleY };
    return matches(target, result) ? result : null;
  }
  const reflected = c[0] * c[3] - c[1] * c[2] < 0;
  return decomposeMatrix(target, (reflected ? -t.rotation : t.rotation) + Math.atan2(c[1], c[0]));
}

// ---- lookup -----------------------------------------------------------------

function rigOf(source: ActorProject, rigId: string): ActorRig {
  return source.rigs.find(r => r.id === rigId) ?? fail('stale', 'The selected rig no longer exists; reselect it.');
}
function nodeOf(rig: ActorRig, id: string): ActorNode {
  return rig.nodes.find(n => n.id === id) ?? fail('stale', `Node ${id} no longer exists in ${rig.name}; reselect it.`);
}
/** True when `ancestorId` is `nodeId` or one of its parents. */
export function isAncestorOrSelf(rig: ActorRig, ancestorId: string, nodeId: string | null): boolean {
  const byId = new Map(rig.nodes.map(n => [n.id, n]));
  for (let cursor = nodeId, steps = 0; cursor !== null && steps <= rig.nodes.length; cursor = byId.get(cursor)?.parentId ?? null, steps++) if (cursor === ancestorId) return true;
  return false;
}
/** Descendants (excluding the node) in parent-first source order. */
export function subtreeOf(rig: ActorRig, nodeId: string): string[] {
  const found = [nodeId], set = new Set(found);
  for (let grew = true; grew;) {
    grew = false;
    for (const n of rig.nodes) if (n.parentId !== null && set.has(n.parentId) && !set.has(n.id)) { set.add(n.id); found.push(n.id); grew = true; }
  }
  return found.slice(1);
}
/** Rest-pose world matrix of a node (identity scene frame for null). */
export function restWorld(rig: ActorRig, nodeId: string | null): ActorMatrix {
  let m = IDENTITY;
  for (let cursor = nodeId, steps = 0; cursor !== null && steps <= rig.nodes.length; steps++) {
    const node = nodeOf(rig, cursor); m = multiplyMatrices(transformMatrix(node.rest), m); cursor = node.parentId;
  }
  return m;
}
const sameTarget = (a: ActorTrackTarget, b: ActorTrackTarget) => a.kind === 'attachment'
  ? b.kind === 'attachment' && a.attachmentId === b.attachmentId : b.kind === 'node' && a.rigId === b.rigId && a.nodeId === b.nodeId;
/** Every clip's track for a target (at most one per clip). */
export function tracksFor(source: ActorProject, target: ActorTrackTarget): { clipName: string; track: ActorTrack }[] {
  return source.clips.flatMap(c => c.tracks.filter(t => sameTarget(t.target, target)).map(track => ({ clipName: c.name, track })));
}
function itemTarget(item: ActorRigItem): ActorTrackTarget | null {
  return item.kind === 'node' ? { kind: 'node', rigId: item.rigId, nodeId: item.id } : item.kind === 'attachment' ? { kind: 'attachment', attachmentId: item.id } : null;
}
function holder(source: ActorProject, item: ActorRigItem): { name: string; get(): ActorTransform; set(t: ActorTransform): void; parent: ActorParentRef } {
  if (item.kind === 'attachment') {
    const a = source.attachments.find(x => x.id === item.id) ?? fail('stale', 'The selected attachment no longer exists; reselect it.');
    return { name: a.name, get: () => a.transform, set: t => { a.transform = t; }, parent: a.rigId === undefined ? null : { rigId: a.rigId, nodeId: a.nodeId! } };
  }
  const rig = rigOf(source, item.rigId);
  if (item.kind === 'node') { const n = nodeOf(rig, item.id); return { name: n.name, get: () => n.rest, set: t => { n.rest = t; }, parent: n.parentId === null ? null : { rigId: rig.id, nodeId: n.parentId } }; }
  const s = rig.sockets.find(x => x.id === item.id) ?? fail('stale', 'The selected socket no longer exists; reselect it.');
  return { name: s.name, get: () => s.transform, set: t => { s.transform = t; }, parent: { rigId: rig.id, nodeId: s.nodeId } };
}
function parentWorld(source: ActorProject, parent: ActorParentRef): ActorMatrix {
  return parent === null ? IDENTITY : restWorld(rigOf(source, parent.rigId), parent.nodeId);
}

// ---- reparenting ------------------------------------------------------------

/** Moves a node (within its rig), socket (to a node of its rig) or attachment
 * (to any rig node or the scene root). `local` keeps rest and keys verbatim.
 * `world` keeps the rest-pose world placement: C = inverse(newParent) * oldParent
 * is applied to rest and to every key of the item's tracks. Keys require C to be
 * a similarity so interpolated poses are preserved too. Shear, singular new
 * parents and cycles reject. Returns a one-line summary. */
export function reparentRigItem(source: ActorProject, item: ActorRigItem, parent: ActorParentRef, mode: ActorPreserveMode): string {
  const h = holder(source, item), old = h.parent;
  if (item.kind !== 'attachment') {
    if (parent !== null && parent.rigId !== item.rigId) fail('rig', 'Nodes and sockets stay within their rig; choose a node of the same rig.');
    if (item.kind === 'socket' && parent === null) fail('reference', 'A cosmetic socket needs a parent node.');
  }
  if (parent !== null) nodeOf(rigOf(source, parent.rigId), parent.nodeId);
  if (item.kind === 'node' && parent !== null && isAncestorOrSelf(rigOf(source, item.rigId), item.id, parent.nodeId)) fail('cycle', `${h.name} cannot become a child of itself or its own descendant.`);
  if (old?.rigId === parent?.rigId && old?.nodeId === parent?.nodeId) return `${h.name}: parent unchanged.`;
  if (mode === 'world') {
    const inverse = invertMatrix(parentWorld(source, parent)) ?? fail('singular', 'The new parent collapses space (zero scale in its rest chain); use preserve local or give it non-zero scale.');
    const c = multiplyMatrices(inverse, parentWorld(source, old));
    applyCorrection(source, item, h, c);
  }
  if (item.kind === 'attachment') {
    const a = source.attachments.find(x => x.id === item.id)!;
    if (parent === null) { delete a.rigId; delete a.nodeId; } else { a.rigId = parent.rigId; a.nodeId = parent.nodeId; }
  } else if (item.kind === 'node') nodeOf(rigOf(source, item.rigId), item.id).parentId = parent?.nodeId ?? null;
  else rigOf(source, item.rigId).sockets.find(s => s.id === item.id)!.nodeId = parent!.nodeId;
  return `${h.name}: moved to ${parent === null ? item.kind === 'attachment' ? 'the scene root' : 'the rig root level' : nodeOf(rigOf(source, parent.rigId), parent.nodeId).name} (preserve ${mode}).`;
}
function applyCorrection(source: ActorProject, item: ActorRigItem, h: ReturnType<typeof holder>, c: ActorMatrix) {
  const target = itemTarget(item), keyed = target ? tracksFor(source, target) : [];
  if (keyed.length && !isSimilarity(c)) fail('keys', `${h.name} is keyed in ${keyed.map(k => k.clipName).join(', ')}; preserve world would need a non-uniform correction that changes interpolated poses. Use preserve local, or make the parents' scales uniform.`);
  const reflected = c[0] * c[3] - c[1] * c[2] < 0;
  if (reflected) for (const { track } of keyed) if (track.angle === 'shortest') {
    for (let i = 0; i + 1 < track.keys.length; i++) {
      const d = track.keys[i + 1]!.value.rotation - track.keys[i]!.value.rotation;
      const wrapped = d - 2 * Math.PI * Math.floor((d + Math.PI) / (2 * Math.PI));
      if (Math.abs(wrapped) === Math.PI) fail('keys', 'Reflected shortest-angle half turns are ambiguous; use preserve local.');
    }
    for (const k of track.keys) if (k.turns !== undefined) k.turns = -k.turns;
  }
  h.set(correct(c, h.get()) ?? fail('shear', `${h.name}: the preserved world placement needs shear, which a local TRS cannot represent. Use preserve local or adjust the parents' scales.`));
  for (const { clipName, track } of keyed) track.keys.forEach((key, i) => {
    key.value = correct(c, key.value) ?? fail('shear', `${h.name}: key ${i} in ${clipName} would need shear.`);
  });
}

// ---- deletion ---------------------------------------------------------------

function pointRemoved(p: ActorRigPoint, nodes: ReadonlySet<string>, sockets: ReadonlySet<string>) {
  return p.kind === 'node' ? nodes.has(p.id) : sockets.has(p.id);
}
function removeConstraints(rig: ActorRig, nodes: ReadonlySet<string>, sockets: ReadonlySet<string>, lines: string[]) {
  if (!rig.constraints) return;
  const opaque = rig.constraints.filter(c => c.solver !== CCD_CHAIN_SOLVER).length;
  rig.constraints = rig.constraints.filter(c => {
    if (c.solver !== CCD_CHAIN_SOLVER) return true;
    const s = c.settings as ActorCcdChainSettings;
    const removed = nodes.has(s.chainRootId) || pointRemoved(s.effector, nodes, sockets) || pointRemoved(s.target, nodes, sockets);
    if (removed) lines.push(`Remove constraint ${c.name} (its chain root, effector or target is removed).`);
    return !removed;
  });
  if (!rig.constraints.length) delete rig.constraints;
  if (opaque) lines.push(`${opaque} constraint(s) use unsupported solvers; their settings are not interpreted and are preserved unchanged.`);
}
function removeTracks(source: ActorProject, removed: (t: ActorTrackTarget) => boolean, lines: string[]) {
  for (const clip of source.clips) {
    const filter = <T extends { id: string; target: ActorTrackTarget; keys: unknown[] }>(ts: T[]) => ts.filter(t => {
      if (!removed(t.target)) return true;
      lines.push(`Remove track ${t.id} (${t.keys.length} keys) from clip ${clip.name}; the clip itself stays.`); return false;
    });
    clip.tracks = filter(clip.tracks);
    if (clip.visibilityTracks) clip.visibilityTracks = filter(clip.visibilityTracks);
    if (clip.drawOrderTracks) clip.drawOrderTracks = filter(clip.drawOrderTracks);
    if (clip.celTracks) clip.celTracks = filter(clip.celTracks);
  }
  for (const a of source.animators ?? []) for (const l of a.layers) if (l.mask) l.mask = l.mask.filter(m => {
    if (!removed(m)) return true;
    lines.push(`Remove mask entry from ${a.name}/${l.name}.`); return false;
  });
}

function checkEmoteSocketDeletion(source: ActorProject, rigId: string, sockets: ReadonlySet<string>) {
  for (const e of source.emotes ?? []) for (const r of e.roles) if (r.rigId === rigId && Object.values(r.socketBindings).some(s => sockets.has(s))) fail('reference', `Socket is bound by emote ${e.label}/${r.label}; remove its emote binding explicitly first.`);
}

/** Deletes a node, socket or attachment and every reference that would
 * dangle, returning one line per affected record. Node policies lift direct
 * children, sockets and attachments to the deleted node's parent (sockets of a
 * deleted root are removed) or delete the whole subtree. Parts, clips and
 * actions are never removed. Run on a copy first to review; see reviewDeletion. */
export function applyDeletion(source: ActorProject, item: ActorRigItem, policy: ActorDeletePolicy = 'lift-world'): string[] {
  const lines: string[] = [], usedBefore = constraintFieldsUsed(source);
  if (item.kind === 'attachment') {
    const a = source.attachments.find(x => x.id === item.id) ?? fail('stale', 'The selected attachment no longer exists; reselect it.');
    lines.push(`Delete attachment ${a.name} (part ${a.partId} stays in the project).`);
    source.attachments = source.attachments.filter(x => x !== a);
    removeTracks(source, t => t.kind === 'attachment' && t.attachmentId === a.id, lines);
    return lines;
  }
  const rig = rigOf(source, item.rigId);
  if (item.kind === 'socket') {
    const s = rig.sockets.find(x => x.id === item.id) ?? fail('stale', 'The selected socket no longer exists; reselect it.');
    checkEmoteSocketDeletion(source, rig.id, new Set([s.id]));
    lines.push(`Delete socket ${s.name}.`); rig.sockets = rig.sockets.filter(x => x !== s);
    removeConstraints(rig, new Set(), new Set([s.id]), lines);
    maintainCapability(source, usedBefore); return lines;
  }
  const node = nodeOf(rig, item.id), removedNodes = new Set([node.id]), removedSockets = new Set<string>();
  if (policy === 'subtree') {
    for (const id of subtreeOf(rig, node.id)) removedNodes.add(id);
    lines.push(`Delete ${removedNodes.size} node(s): ${rig.nodes.filter(n => removedNodes.has(n.id)).map(n => n.name).join(', ')}.`);
    for (const s of rig.sockets) if (removedNodes.has(s.nodeId)) { removedSockets.add(s.id); lines.push(`Delete socket ${s.name}.`); }
    const attachments = new Set(source.attachments.filter(a => a.rigId === rig.id && removedNodes.has(a.nodeId!)).map(a => a.id));
    for (const a of source.attachments) if (attachments.has(a.id)) lines.push(`Delete attachment ${a.name} (part stays).`);
    source.attachments = source.attachments.filter(a => !attachments.has(a.id));
    removeTracks(source, t => t.kind === 'attachment' && attachments.has(t.attachmentId), lines);
  } else {
    const mode: ActorPreserveMode = policy === 'lift-world' ? 'world' : 'local', up: ActorParentRef = node.parentId === null ? null : { rigId: rig.id, nodeId: node.parentId };
    lines.push(`Delete node ${node.name}; lift its children to ${up === null ? 'the rig root level' : nodeOf(rig, up.nodeId).name}.`);
    for (const child of rig.nodes.filter(n => n.parentId === node.id)) lines.push(reparentRigItem(source, { kind: 'node', rigId: rig.id, id: child.id }, up, mode));
    for (const s of rig.sockets.filter(x => x.nodeId === node.id)) {
      if (up === null) { removedSockets.add(s.id); lines.push(`Delete socket ${s.name} (a root has no parent node to carry it).`); }
      else lines.push(reparentRigItem(source, { kind: 'socket', rigId: rig.id, id: s.id }, up, mode));
    }
    for (const a of source.attachments.filter(x => x.rigId === rig.id && x.nodeId === node.id)) lines.push(reparentRigItem(source, { kind: 'attachment', id: a.id }, up, mode));
  }
  checkEmoteSocketDeletion(source, rig.id, removedSockets);
  rig.sockets = rig.sockets.filter(s => !removedSockets.has(s.id));
  removeTracks(source, t => t.kind === 'node' && t.rigId === rig.id && removedNodes.has(t.nodeId), lines);
  removeConstraints(rig, removedNodes, removedSockets, lines);
  rig.nodes = rig.nodes.filter(n => !removedNodes.has(n.id));
  maintainCapability(source, usedBefore);
  return lines;
}

/** Applies the deletion to a copy and validates it, returning the exact lines
 * a confirmation will apply, or throwing the rejection. Never mutates source. */
export function reviewDeletion(source: ActorProject, item: ActorRigItem, policy: ActorDeletePolicy): string[] {
  const copy = structuredClone(source), lines = applyDeletion(copy, item, policy), checked = validateActorProject(copy);
  if (!checked.ok) fail('invalid', `Deletion would leave invalid source: ${checked.diagnostics[0]!.path} ${checked.diagnostics[0]!.message}`);
  return lines;
}

// ---- mirroring, proportions and joints --------------------------------------

/** Reflection across the parent's local y axis, F*L*F; never introduces -0. */
const mirrorFrame = (t: ActorTransform): ActorTransform => ({ x: 0 - t.x, y: t.y, rotation: 0 - t.rotation, scaleX: t.scaleX, scaleY: t.scaleY });

/** Copies a node subtree, its sockets and attachments as a reflected sibling
 * with new IDs (F*L*F frames; artwork F*A, i.e. scaleX negated). Limits mirror
 * to [-max,-min]. Tracks and constraints are not copied. Optional aid only. */
export function mirrorSubtree(source: ActorProject, rigId: string, nodeId: string, newId: () => string, suffix = ' (mirror)'): { rootId: string; lines: string[] } {
  const rig = rigOf(source, rigId), root = nodeOf(rig, nodeId), ids = new Map<string, string>();
  const members = [root.id, ...subtreeOf(rig, root.id)];
  for (const id of members) ids.set(id, newId());
  for (const id of members) {
    const n = nodeOf(rig, id), copy: ActorNode = { id: ids.get(id)!, name: `${n.name}${suffix}`, parentId: id === root.id ? n.parentId : ids.get(n.parentId!)!, rest: mirrorFrame(n.rest) };
    if (n.limits) copy.limits = { minRotation: 0 - n.limits.maxRotation, maxRotation: 0 - n.limits.minRotation };
    rig.nodes.push(copy);
  }
  const sockets = rig.sockets.filter(s => ids.has(s.nodeId));
  for (const s of sockets) rig.sockets.push({ id: newId(), name: `${s.name}${suffix}`, nodeId: ids.get(s.nodeId)!, transform: mirrorFrame(s.transform) });
  const attachments = source.attachments.filter(a => a.rigId === rigId && ids.has(a.nodeId!));
  for (const a of attachments) source.attachments.push({ ...structuredClone(a), id: newId(), name: `${a.name}${suffix}`, nodeId: ids.get(a.nodeId!)!, transform: { ...mirrorFrame(a.transform), scaleX: 0 - a.transform.scaleX } });
  const tracks = source.clips.reduce((n, c) => n + c.tracks.filter(t => t.target.kind === 'node' ? t.target.rigId === rigId && ids.has(t.target.nodeId) : attachments.some(a => a.id === (t.target as { attachmentId: string }).attachmentId)).length, 0);
  return { rootId: ids.get(root.id)!, lines: [`Mirrored ${members.length} node(s), ${sockets.length} socket(s) and ${attachments.length} attachment(s) across ${root.parentId === null ? 'the rig' : nodeOf(rig, root.parentId).name}'s vertical axis.`,
    `${tracks} track(s) and any constraints were not copied; the mirror uses rest until animated.`] };
}

function scaleTranslation(t: ActorTransform, factor: number) { t.x *= factor; t.y *= factor; }

/** Multiplies the rest offsets of strict descendants and of sockets and
 * attachments on the node and its descendants, plus the translation of their
 * keys. Rotations, scales and artwork are unchanged. */
export function scaleSegmentOffsets(source: ActorProject, rigId: string, nodeId: string, factor: number): string[] {
  if (!Number.isFinite(factor) || factor <= 0) fail('value', 'Proportion factor must be a positive finite number.');
  const rig = rigOf(source, rigId), node = nodeOf(rig, nodeId), descendants = new Set(subtreeOf(rig, node.id)), carriers = new Set([node.id, ...descendants]);
  let keys = 0;
  const keyed = (target: ActorTrackTarget) => { for (const { track } of tracksFor(source, target)) for (const k of track.keys) { scaleTranslation(k.value, factor); keys++; } };
  for (const n of rig.nodes) if (descendants.has(n.id)) { scaleTranslation(n.rest, factor); keyed({ kind: 'node', rigId, nodeId: n.id }); }
  const sockets = rig.sockets.filter(s => carriers.has(s.nodeId)), attachments = source.attachments.filter(a => a.rigId === rigId && carriers.has(a.nodeId!));
  for (const s of sockets) scaleTranslation(s.transform, factor);
  for (const a of attachments) { scaleTranslation(a.transform, factor); keyed({ kind: 'attachment', attachmentId: a.id }); }
  return [`Scaled offsets of ${descendants.size} descendant node(s), ${sockets.length} socket(s) and ${attachments.length} attachment(s) of ${node.name} by ${factor}; ${keys} key translation(s) scaled with them.`];
}

/** Moves a joint by `d` (parent space) while every direct child, socket and
 * attachment keeps its rest world position: their offsets shift by
 * -inverse(R*S of the joint's rest) d. Keys shift identically. */
export function moveJoint(source: ActorProject, rigId: string, nodeId: string, dx: number, dy: number): string[] {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) fail('value', 'Joint offset must be finite.');
  const rig = rigOf(source, rigId), node = nodeOf(rig, nodeId);
  const inverse = invertMatrix([...transformMatrix(node.rest).slice(0, 4), 0, 0] as ActorMatrix) ?? fail('singular', `${node.name} has zero rest scale, so its children cannot keep their places.`);
  const ex = inverse[0] * dx + inverse[2] * dy, ey = inverse[1] * dx + inverse[3] * dy;
  const shift = (t: ActorTransform, x: number, y: number) => { t.x += x; t.y += y; };
  const keyed = (target: ActorTrackTarget, x: number, y: number) => { for (const { track } of tracksFor(source, target)) for (const k of track.keys) shift(k.value, x, y); };
  shift(node.rest, dx, dy); keyed({ kind: 'node', rigId, nodeId }, dx, dy);
  const children = rig.nodes.filter(n => n.parentId === nodeId), sockets = rig.sockets.filter(s => s.nodeId === nodeId), attachments = source.attachments.filter(a => a.rigId === rigId && a.nodeId === nodeId);
  for (const c of children) { shift(c.rest, -ex, -ey); keyed({ kind: 'node', rigId, nodeId: c.id }, -ex, -ey); }
  for (const s of sockets) shift(s.transform, -ex, -ey);
  for (const a of attachments) { shift(a.transform, -ex, -ey); keyed({ kind: 'attachment', attachmentId: a.id }, -ex, -ey); }
  return [`Moved joint ${node.name} by (${dx}, ${dy}); ${children.length} child node(s), ${sockets.length} socket(s) and ${attachments.length} attachment(s) kept their rest positions.`];
}

// ---- posed keys -------------------------------------------------------------

/** Writes one complete local key at exactly `time`: replaces a key at that
 * time, inserts in time order, or creates a linear one-key track. Rest, other
 * keys, tracks and interpolation are untouched. */
export function setPoseKey(source: ActorProject, clipId: string, target: ActorTrackTarget, time: number, value: ActorTransform, newId: () => string): 'replaced' | 'inserted' | 'created' {
  const clip = source.clips.find(c => c.id === clipId) ?? fail('stale', 'Select a clip for pose editing.');
  if (!Number.isFinite(time) || time < 0 || time > clip.duration) fail('time', `Pose time must lie within [0, ${clip.duration}] seconds.`);
  const track = clip.tracks.find(t => sameTarget(t.target, target));
  if (!track) { clip.tracks.push({ id: newId(), target: structuredClone(target), interpolation: 'linear', keys: [{ time, value: { ...value } }] }); return 'created'; }
  const at = track.keys.findIndex(k => k.time >= time);
  if (at >= 0 && track.keys[at]!.time === time) { track.keys[at]!.value = { ...value }; return 'replaced'; }
  track.keys.splice(at < 0 ? track.keys.length : at, 0, { time, value: { ...value } }); return 'inserted';
}

// ---- limits, constraints and capability -------------------------------------

export function constraintFieldsUsed(source: ActorProject): boolean {
  return source.rigs.some(r => r.constraints !== undefined || r.nodes.some(n => n.limits !== undefined));
}
/** Declares the capability when limits/constraints are in use; when an edit
 * removes the last of them, drops the capability so the project stays readable
 * by builds without it. A capability declared but never used is left alone. */
export function maintainCapability(source: ActorProject, usedBefore: boolean) {
  const used = constraintFieldsUsed(source), declared = source.requiredCapabilities.includes(RIG_CONSTRAINTS_CAPABILITY);
  if (used && !declared) source.requiredCapabilities.push(RIG_CONSTRAINTS_CAPABILITY);
  if (!used && usedBefore && declared) source.requiredCapabilities = source.requiredCapabilities.filter(c => c !== RIG_CONSTRAINTS_CAPABILITY);
}
export function setJointLimits(source: ActorProject, rigId: string, nodeId: string, limits: ActorJointLimits | null) {
  const usedBefore = constraintFieldsUsed(source), node = nodeOf(rigOf(source, rigId), nodeId);
  if (limits === null) delete node.limits;
  else {
    if (!Number.isFinite(limits.minRotation) || !Number.isFinite(limits.maxRotation) || limits.minRotation > limits.maxRotation) fail('value', 'Limits need finite radians with minimum <= maximum.');
    node.limits = { minRotation: limits.minRotation, maxRotation: limits.maxRotation };
  }
  maintainCapability(source, usedBefore);
}
export function addCcdConstraint(source: ActorProject, rigId: string, id: string, name: string, settings: ActorCcdChainSettings) {
  const usedBefore = constraintFieldsUsed(source), rig = rigOf(source, rigId);
  (rig.constraints ??= []).push({ id, name, solver: CCD_CHAIN_SOLVER, enabled: true, settings: structuredClone(settings) });
  maintainCapability(source, usedBefore);
}
/** Replaces a built-in constraint's name and settings, keeping its ID, list
 * position and enabled state. Unsupported solvers' settings are never rewritten. */
export function updateCcdConstraint(source: ActorProject, rigId: string, id: string, name: string, settings: ActorCcdChainSettings) {
  const c = constraintOf(rigOf(source, rigId), id);
  if (c.solver !== CCD_CHAIN_SOLVER) fail('unsupported', `${c.name} uses ${c.solver}; its settings are preserved and cannot be edited here.`);
  c.name = name; c.settings = structuredClone(settings);
}
function constraintOf(rig: ActorRig, id: string): ActorConstraint {
  return rig.constraints?.find(c => c.id === id) ?? fail('stale', 'The selected constraint no longer exists; reselect it.');
}
export function setConstraintEnabled(source: ActorProject, rigId: string, id: string, enabled: boolean) { constraintOf(rigOf(source, rigId), id).enabled = enabled; }
/** Removes one constraint record, including an unsupported one (explicit). */
export function deleteConstraint(source: ActorProject, rigId: string, id: string) {
  const usedBefore = constraintFieldsUsed(source), rig = rigOf(source, rigId), c = constraintOf(rig, id);
  rig.constraints = rig.constraints!.filter(x => x !== c);
  if (!rig.constraints.length) delete rig.constraints;
  maintainCapability(source, usedBefore);
}

/** Editing diagnostics: values outside optional limits (never rewritten) and
 * constraints that will be skipped. Bounded to `max` lines plus a summary. */
export function rigDiagnostics(source: ActorProject, max = 40): string[] {
  const lines: string[] = [];
  let hidden = 0;
  const add = (line: string) => { if (lines.length < max) lines.push(line); else hidden++; };
  for (const rig of source.rigs) {
    for (const n of rig.nodes) {
      if (!n.limits) continue;
      const out = (r: number) => r < n.limits!.minRotation || r > n.limits!.maxRotation;
      if (out(n.rest.rotation)) add(`${rig.name} / ${n.name}: rest rotation ${n.rest.rotation} is outside its limits.`);
      for (const { clipName, track } of tracksFor(source, { kind: 'node', rigId: rig.id, nodeId: n.id })) track.keys.forEach((k, i) => {
        if (out(k.value.rotation)) add(`${rig.name} / ${n.name}: key ${i} in ${clipName} is outside its limits (kept as authored).`);
      });
    }
    for (const c of rig.constraints ?? []) {
      if (c.solver !== CCD_CHAIN_SOLVER) add(`${rig.name} / ${c.name}: solver ${c.solver} is unsupported here; preserved and skipped.`);
      else if (!c.enabled) add(`${rig.name} / ${c.name}: disabled.`);
    }
  }
  if (hidden) lines.push(`…and ${hidden} more.`);
  return lines;
}
/** Clips in which a rest edit of this target is hidden by a track. */
export function keyedClipNames(source: ActorProject, target: ActorTrackTarget): string[] { return tracksFor(source, target).map(t => t.clipName); }
