import type { ActorTransform } from '@actor-animator/types';
import { moveJoint, setPoseKey, syncAnimationCapability } from '../../../../packages/actor-tools/src';
import type { ActorDraft } from './editing';

export interface ViewFrame { width: number; height: number; cssWidth: number; cssHeight: number; offsetX?: number; offsetY?: number; scale: number; viewY: number; placement: ArrayLike<number> }
export interface RigSelection { kind: 'node' | 'socket' | 'attachment'; id: string; rigId?: string }
export type ViewTool = 'move' | 'rotate' | 'joint';
export function screenPoint(frame: ViewFrame, x: number, y: number, out: Float64Array, offset = 0) {
  const p = frame.placement, px = p[0]! * x + p[2]! * y + p[4]!, py = p[1]! * x + p[3]! * y + p[5]!;
  out[offset] = (frame.offsetX ?? 0) + (frame.width / 2 + px * frame.scale) * frame.cssWidth / frame.width;
  out[offset + 1] = (frame.offsetY ?? 0) + (frame.height / 2 + (frame.viewY - py) * frame.scale) * frame.cssHeight / frame.height;
}
export function inversePoint(m: ArrayLike<number>, x: number, y: number): [number, number] {
  const det = m[0]! * m[3]! - m[1]! * m[2]!;
  if (!Number.isFinite(det) || det === 0) throw new Error('Parent or preview placement collapses space (zero scale); use numeric local controls.');
  const dx = x - m[4]!, dy = y - m[5]!;
  const a = (m[3]! * dx - m[2]! * dy) / det, b = (m[0]! * dy - m[1]! * dx) / det;
  if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error('Pointer conversion exceeds Float64 range.');
  return [a, b];
}
export function localPointer(frame: ViewFrame, parent: ArrayLike<number>, x: number, y: number): [number, number] {
  const project = inversePoint(frame.placement, ((x - (frame.offsetX ?? 0)) * frame.width / frame.cssWidth - frame.width / 2) / frame.scale,
    frame.viewY - ((y - (frame.offsetY ?? 0)) * frame.height / frame.cssHeight - frame.height / 2) / frame.scale);
  return inversePoint(parent, project[0], project[1]);
}
export function segmentDistance(x: number, y: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length)) : 0;
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}
export interface GestureIntent { selection: RigSelection; tool: ViewTool; mode: 'rest' | 'pose'; clip: string | null; time: number }
/** UI-event transaction only. ActorDraft remains the sole source/history owner. */
export class RigGesture {
  private epoch: number;
  private active = true;
  private angle: number;
  private rotation: number;
  private trackId = crypto.randomUUID();
  constructor(readonly draft: ActorDraft, readonly intent: GestureIntent, readonly frame: ViewFrame,
    readonly parent: ArrayLike<number>, readonly initial: ActorTransform, readonly start: [number, number]) {
    if (intent.mode === 'pose' && (!intent.clip || intent.selection.kind === 'socket')) throw new Error('Pose needs a shown clip and a node or attachment. Sockets use Rest.');
    if (intent.tool === 'joint' && (intent.mode !== 'rest' || intent.selection.kind !== 'node')) throw new Error('Move joint preserving children requires a node in Rest mode.');
    inversePoint(parent, 0, 0); inversePoint(frame.placement, 0, 0);
    this.angle = Math.atan2(start[1] - initial.y, start[0] - initial.x); this.rotation = initial.rotation;
    draft.begin(); this.epoch = draft.epoch;
  }
  get valid() { return this.active && this.epoch === this.draft.epoch; }
  update(x: number, y: number) {
    if (!this.valid) { this.active = false; return false; }
    const point = localPointer(this.frame, this.parent, x, y), t = { ...this.initial };
    if (this.intent.tool === 'rotate') {
      const angle = Math.atan2(point[1] - t.y, point[0] - t.x);
      if (Math.hypot(point[0] - t.x, point[1] - t.y) < 1e-12) return true;
      let delta = angle - this.angle; if (delta > Math.PI) delta -= 2 * Math.PI; if (delta < -Math.PI) delta += 2 * Math.PI;
      this.rotation += delta; this.angle = angle; t.rotation = this.rotation;
    } else { t.x += point[0] - this.start[0]; t.y += point[1] - this.start[1]; }
    this.draft.edit(source => {
      const { selection: s, mode, tool, clip, time } = this.intent;
      const rig = source.rigs.find(r => r.id === s.rigId);
      const item = s.kind === 'attachment' ? source.attachments.find(a => a.id === s.id) : s.kind === 'node' ? rig?.nodes.find(n => n.id === s.id) : rig?.sockets.find(n => n.id === s.id);
      if (!item) throw new Error('Selection no longer exists.');
      if (mode === 'pose') {
        setPoseKey(source, clip!, s.kind === 'node' ? { kind: 'node', rigId: s.rigId!, nodeId: s.id } : { kind: 'attachment', attachmentId: s.id }, time, t, () => this.trackId);
        syncAnimationCapability(source);
      } else if (tool === 'joint' && 'rest' in item) moveJoint(source, s.rigId!, s.id, t.x - item.rest.x, t.y - item.rest.y);
      else if ('rest' in item) item.rest = t; else item.transform = t;
    });
    this.epoch = this.draft.epoch; return true;
  }
  finish() { const valid = this.valid; if (valid) this.draft.commit(); this.active = false; return valid; }
  cancel() { if (this.valid) this.draft.cancel(); this.active = false; }
}
