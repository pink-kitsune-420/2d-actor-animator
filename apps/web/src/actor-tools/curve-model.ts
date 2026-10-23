import type { ActorCurve, ActorProject, ActorTrack, ActorTransformKey } from '@actor-animator/types';
import { ANIMATION_COMPOSITION_CAPABILITY } from '../../../../packages/actor-tools/src';
import type { ActorDraft } from './editing';

export type Controls = [number, number, number, number];
export interface SegmentRef { clipId: string; trackId: string; time: number; next: number }
export function segment(source: ActorProject, ref: SegmentRef) {
  const track = source.clips.find(c => c.id === ref.clipId)?.tracks.find(t => t.id === ref.trackId);
  const i = track?.keys.findIndex(k => k.time === ref.time) ?? -1;
  if (!track || i < 0 || track.keys[i + 1]?.time !== ref.next) throw new Error('Select a current outgoing transform segment.');
  return { track, key: track.keys[i]!, end: track.keys[i + 1]! };
}
export function controls(curve: string, key?: ActorTransformKey): Controls {
  if (curve === 'cubic-bezier' && key?.bezier) return [...key.bezier];
  if (curve === 'ease-in') return [.42, 0, 1, 1];
  if (curve === 'ease-out') return [0, 0, .58, 1];
  if (curve === 'ease-in-out') return [.42, 0, .58, 1];
  return [1 / 3, 1 / 3, 2 / 3, 2 / 3];
}
export function effectiveCurve(track: ActorTrack, key: ActorTransformKey) { return key.curve ?? track.interpolation; }
export function validateControls(b: Controls) {
  if (b.length !== 4 || !b.every(Number.isFinite) || b[0] < 0 || b[0] > 1 || b[2] < 0 || b[2] > 1) throw new Error('Controls need finite x1,y1,x2,y2; each x must be in [0,1]. Y may overshoot.');
}
/** UI-only source operation: no reconstructed TRS, track normalization or bake. */
export function changeCurve(source: ActorProject, ref: SegmentRef, curve: ActorCurve | undefined, b?: Controls) {
  const { key } = segment(source, ref);
  if (curve === 'cubic-bezier') { if (!b) throw new Error('Enter four controls.'); validateControls(b); }
  delete key.curve; delete key.bezier;
  if (curve !== undefined) key.curve = curve;
  if (curve === 'cubic-bezier') key.bezier = [...b!];
  // Curve-only edits preserve unrelated empty arrays and capability metadata.
  if (curve !== undefined && !source.requiredCapabilities.includes(ANIMATION_COMPOSITION_CAPABILITY)) source.requiredCapabilities.push(ANIMATION_COMPOSITION_CAPABILITY);
}
/** Captured epoch rejects callbacks after undo/retime/document replacement. */
export class CurveEdit {
  private epoch: number;
  private active = true;
  constructor(readonly draft: ActorDraft, readonly ref: SegmentRef) { segment(draft.source, ref); this.epoch = draft.epoch; }
  cancel() { this.active = false; }
  finish(curve: ActorCurve | undefined, b?: Controls) {
    if (!this.active) return false;
    this.active = false;
    if (this.draft.epoch !== this.epoch) throw new Error('Curve selection changed; gesture cancelled.');
    this.draft.edit(s => changeCurve(s, this.ref, curve, b)); return this.draft.epoch !== this.epoch;
  }
}

export const PLOT = { left: 48, right: 352, top: 24, bottom: 228, width: 400, height: 280 };
export function fitControls(b: Controls) { const lo = Math.min(0, b[1], b[3]), hi = Math.max(1, b[1], b[3]), padding = (hi - lo) * .1; return { lo: lo - padding, hi: hi + padding }; }
export interface YRange { lo: number; hi: number }
export function plotPoint(x: number, y: number, range: YRange) { return { x: PLOT.left + x * (PLOT.right - PLOT.left), y: PLOT.bottom - (y - range.lo) / (range.hi - range.lo) * (PLOT.bottom - PLOT.top) }; }
export function controlAt(rect: { x: number; y: number; width: number; height: number }, clientX: number, clientY: number, range: YRange) {
  const x = ((clientX - rect.x) * PLOT.width / rect.width - PLOT.left) / (PLOT.right - PLOT.left);
  const y = (PLOT.bottom - (clientY - rect.y) * PLOT.height / rect.height) / (PLOT.bottom - PLOT.top);
  return { x: Math.max(0, Math.min(1, x)), y: range.lo + Math.max(0, Math.min(1, y)) * (range.hi - range.lo) };
}
/** Parametric X(s),Y(s) is exactly the easing graph, including asymmetric X. */
export function curvePath(curve: string, b: Controls, range: YRange) {
  const a = plotPoint(0, 0, range), z = plotPoint(1, 1, range);
  if (curve === 'step') return `M${a.x},${a.y} H${z.x} M${z.x},${a.y} V${z.y}`;
  if (curve === 'linear') return `M${a.x},${a.y} L${z.x},${z.y}`;
  const c = plotPoint(b[0], b[1], range), d = plotPoint(b[2], b[3], range);
  return `M${a.x},${a.y} C${c.x},${c.y} ${d.x},${d.y} ${z.x},${z.y}`;
}
