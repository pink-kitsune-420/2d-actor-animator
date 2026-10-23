import type { ActorTransform } from '@actor-animator/types';
import type { CelHost } from './cel-panel';
import type { ActorPreview } from './preview';
import { inversePoint, localPointer, RigGesture, screenPoint, segmentDistance, type GestureIntent, type RigSelection, type ViewFrame } from './viewport-math';

interface ViewportBinding {
  selection(): RigSelection;
  select(s: RigSelection): void;
  intent(): Omit<GestureIntent, 'selection'>;
  refresh(): void;
}
const identity = new Float64Array([1, 0, 0, 1, 0, 0]);
/** Native input/overlay adapter. Input events may compile, playback never does. */
export class RigViewport {
  private enabled = false;
  private disposed = false;
  private frame: ViewFrame;
  private points = new Float64Array(0);
  private pointer: { id: number; gesture: RigGesture; left: number; top: number; x: number; y: number; width: number; height: number } | null = null;
  private observer: ResizeObserver;
  private selectionKey = '';
  private selected = -1;
  private rotateTool = false;
  constructor(readonly preview: ActorPreview, readonly host: CelHost, readonly binding: ViewportBinding, readonly status: HTMLElement) {
    const canvas = preview.canvas, signal = host.controller.signal;
    this.frame = preview.viewFrame();
    preview.overlay = () => this.draw();
    canvas.addEventListener('pointerdown', e => host.perform(() => this.down(e)), { signal });
    canvas.addEventListener('pointermove', e => host.perform(() => this.motion(e)), { signal });
    canvas.addEventListener('pointerup', e => host.perform(() => this.up(e)), { signal });
    for (const event of ['pointercancel', 'lostpointercapture'] as const) canvas.addEventListener(event, e => { if (e.pointerId === this.pointer?.id) this.cancel(); }, { signal });
    canvas.addEventListener('keydown', e => host.perform(() => this.key(e)), { signal });
    // Any other control ends a transient edit before it can own source/history.
    document.addEventListener('pointerdown', e => { if (e.target !== canvas) this.cancel(); }, { capture: true, signal });
    document.addEventListener('focusin', e => { if (e.target !== canvas) this.cancel(); }, { signal });
    document.addEventListener('change', () => this.cancel(), { capture: true, signal });
    this.observer = new ResizeObserver(() => { this.cancel(); this.frame = preview.viewFrame(); preview.draw(); });
    this.observer.observe(canvas);
  }
  setEnabled(on: boolean) { this.cancel(); this.enabled = on; this.preview.canvas.setAttribute('aria-disabled', String(!on)); this.refresh(); }
  refresh() {
    if (this.disposed) return;
    const key = JSON.stringify(this.binding.selection());
    if (key !== this.selectionKey) { this.cancel(); this.selectionKey = key; }
    if (this.pointer && !this.pointer.gesture.valid) this.abandon();
    this.frame = this.preview.viewFrame();
    const length = (this.preview.rigCompiled?.slots.length ?? 0) * 2;
    if (length !== this.points.length) this.points = new Float64Array(length);
    this.selected = this.selectedIndex(); this.rotateTool = this.binding.intent().tool === 'rotate';
    this.preview.draw();
  }
  private selectedIndex() {
    const s = this.binding.selection(); return this.preview.rigCompiled?.slots.findIndex(v => v.kind === s.kind && v.id === s.id && (s.kind === 'attachment' || v.rigId === s.rigId)) ?? -1;
  }
  private draw() {
    if (!this.enabled || this.disposed) return;
    const compiled = this.preview.rigCompiled, pose = this.preview.rigPose; if (!compiled || !pose) return;
    const c = this.preview.context, f = this.frame, w = pose.worldMatrices, selected = this.selected;
    this.preview.updateViewFrame(f);
    if (!f.cssWidth || !f.cssHeight) return;
    c.save(); c.setTransform(f.width / f.cssWidth, 0, 0, f.height / f.cssHeight, -(f.offsetX ?? 0) * f.width / f.cssWidth, -(f.offsetY ?? 0) * f.height / f.cssHeight); c.lineWidth = 2;
    for (let i = 0; i < compiled.slots.length; i++) screenPoint(f, w[i * 6 + 4]!, w[i * 6 + 5]!, this.points, i * 2);
    for (let i = 0; i < compiled.slots.length; i++) {
      const slot = compiled.slots[i]!, x = this.points[i * 2]!, y = this.points[i * 2 + 1]!;
      c.strokeStyle = i === selected ? '#ffce84' : slot.kind === 'attachment' ? '#bbaaee' : slot.kind === 'socket' ? '#ffbe55' : '#83c8ef';
      c.fillStyle = '#101820'; c.beginPath();
      if (slot.kind !== 'attachment' && slot.parent >= 0) { c.moveTo(this.points[slot.parent * 2]!, this.points[slot.parent * 2 + 1]!); c.lineTo(x, y); c.stroke(); c.beginPath(); }
      if (slot.kind === 'attachment') c.rect(x - 5, y - 5, 10, 10);
      else if (slot.kind === 'socket') { c.moveTo(x, y - 6); c.lineTo(x + 6, y); c.lineTo(x, y + 6); c.lineTo(x - 6, y); c.closePath(); }
      else c.arc(x, y, i === selected ? 6 : 4, 0, 2 * Math.PI);
      c.fill(); c.stroke();
      if (i === selected) {
        c.beginPath(); c.arc(x, y, 11, 0, 2 * Math.PI); c.stroke();
        if (this.rotateTool) { c.beginPath(); c.moveTo(x + 12, y); c.lineTo(x + 36, y); c.stroke(); c.beginPath(); c.arc(x + 36, y, 7, 0, 2 * Math.PI); c.fill(); c.stroke(); }
      }
    }
    c.restore();
  }
  private hit(x: number, y: number, cycle: boolean) {
    const slots = this.preview.rigCompiled!.slots, selected = this.selectedIndex();
    const hits: { i: number; distance: number }[] = [];
    for (let i = 0; i < slots.length; i++) { const d = Math.hypot(x - this.points[i * 2]!, y - this.points[i * 2 + 1]!); if (d <= 12) hits.push({ i, distance: d }); }
    if (hits.length) {
      hits.sort((a, b) => a.distance - b.distance || a.i - b.i);
      const at = hits.findIndex(h => h.i === selected);
      return cycle ? hits[(at + 1) % hits.length]!.i : at >= 0 ? selected : hits[0]!.i;
    }
    // Artwork in actual displayed painter order, with the same affine used to draw.
    const pose = this.preview.rigPose!, compiled = this.preview.rigCompiled!;
    const px = localPointer(this.frame, identity, x, y);
    for (let n = pose.drawSequence.length - 1; n >= 0; n--) {
      const i = pose.drawSequence[n]!, part = compiled.parts[pose.partIndices[i]!]; if (!pose.visible[i] || !part) continue;
      try { const [lx, ly] = inversePoint(pose.worldMatrices.subarray(i * 6, i * 6 + 6), px[0], px[1]);
        if (lx >= -part.pivot[0] && lx <= part.artwork.width * part.unitsPerPixel - part.pivot[0] && ly >= -part.pivot[1] && ly <= part.artwork.height * part.unitsPerPixel - part.pivot[1]) return i;
      } catch { /* A collapsed image has no area; its pivot remains selectable. */ }
    }
    let best = -1, distance = 7;
    for (let i = 0; i < slots.length; i++) { const s = slots[i]!; if (s.kind !== 'node' || s.parent < 0) continue;
      const d = segmentDistance(x, y, this.points[i * 2]!, this.points[i * 2 + 1]!, this.points[s.parent * 2]!, this.points[s.parent * 2 + 1]!);
      if (d < distance) { best = i; distance = d; }
    }
    return best;
  }
  private prepare(index: number, x: number, y: number) {
    const intent = this.binding.intent(), selection = this.binding.selection(), preview = this.preview;
    if (intent.mode === 'rest' && preview.clipId !== null) throw new Error('Rest editing requires Show rest pose. Pose mode writes the selected clip.');
    if (intent.mode === 'pose' && (!intent.clip || preview.clipId !== intent.clip)) throw new Error('Select and show a single clip for Pose editing.');
    const raw = preview.authoringPose(), slot = preview.rigCompiled!.slots[index]!, t = raw.localTRS, o = index * 5;
    const initial: ActorTransform = { x: t[o]!, y: t[o + 1]!, rotation: t[o + 2]!, scaleX: t[o + 3]!, scaleY: t[o + 4]! };
    const parent = slot.parent < 0 ? identity : raw.worldMatrices.slice(slot.parent * 6, slot.parent * 6 + 6);
    const frame = preview.viewFrame();
    return new RigGesture(this.host.draft, { ...intent, selection }, frame, parent, initial, localPointer(frame, parent, x, y));
  }
  private down(e: PointerEvent) {
    if (!this.enabled || this.pointer || e.button !== 0 || !this.preview.rigCompiled) return;
    this.host.cancelGesture(); this.preview.pause(); this.preview.canvas.focus(); e.preventDefault(); this.refresh();
    const r = this.preview.canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, selected = this.selectedIndex();
    const rotate = selected >= 0 && this.binding.intent().tool === 'rotate' && Math.hypot(x - this.points[selected * 2]! - 36, y - this.points[selected * 2 + 1]!) <= 12;
    const index = rotate ? selected : this.hit(x, y, e.altKey); if (index < 0) return;
    const slot = this.preview.rigCompiled.slots[index]!;
    this.binding.select({ kind: slot.kind, id: slot.id, rigId: slot.rigId });
    if (this.binding.intent().tool === 'rotate' && !rotate) { this.status.textContent = 'Selected. Drag the circular handle to rotate in local parent space.'; return; }
    const gesture = this.prepare(index, x, y);
    this.pointer = { id: e.pointerId, gesture, left: r.left, top: r.top, x: e.clientX, y: e.clientY, width: r.width, height: r.height }; this.preview.canvas.setPointerCapture(e.pointerId);
    this.status.textContent = `${this.preview.rigCompiled!.slots[index]!.kind}: ${this.preview.rigCompiled!.slots[index]!.id}. ${gesture.intent.mode === 'pose' ? `Pose key in ${gesture.intent.clip} at ${gesture.intent.time} s` : gesture.intent.tool === 'joint' ? 'Rest joint; preserve children' : 'Rest transform; descendants follow'}. Drag; Escape cancels. Display: ${this.preview.constraintsApplied ? 'solved constraints' : 'raw FK'}; edits use raw authored TRS.`;
  }
  private motion(e: PointerEvent) {
    const p = this.pointer; if (!p || p.id !== e.pointerId) return;
    const r = this.preview.canvas.getBoundingClientRect();
    if (r.left !== p.left || r.top !== p.top || r.width !== p.width || r.height !== p.height) { this.cancel(); return; }
    if (p.x === e.clientX && p.y === e.clientY) return;
    p.x = e.clientX; p.y = e.clientY;
    if (!p.gesture.update(e.clientX - p.left, e.clientY - p.top)) { this.abandon(); return; }
    this.preview.sync(this.host.draft.source); this.binding.refresh();
  }
  private up(e: PointerEvent) {
    if (!this.pointer || this.pointer.id !== e.pointerId) return;
    this.motion(e); const p = this.pointer; if (!p) return;
    this.pointer = null; const committed = p.gesture.finish(); this.release(p.id);
    if (committed) { this.host.changed(); this.status.textContent = 'Applied one source transaction. Undo restores the exact previous source.'; }
  }
  private release(id: number) { if (this.preview.canvas.hasPointerCapture(id)) this.preview.canvas.releasePointerCapture(id); }
  private abandon() { const p = this.pointer; this.pointer = null; if (p) this.release(p.id); }
  cancel() {
    const p = this.pointer; if (!p) return;
    this.pointer = null; p.gesture.cancel(); this.release(p.id);
    if (!this.disposed) { this.preview.sync(this.host.draft.source); this.binding.refresh(); this.status.textContent = 'Gesture cancelled; source and history retained.'; }
  }
  private key(e: KeyboardEvent) {
    if (e.key === 'Escape') { this.cancel(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault(); this.cancel(); e.shiftKey ? this.host.draft.redo() : this.host.draft.undo(); this.host.changed(); return;
    }
    if (!this.enabled || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault(); this.cancel(); this.preview.pause(); this.refresh(); const i = this.selectedIndex(); if (i < 0) return;
    if (this.binding.intent().tool === 'rotate') throw new Error('Use the rotation handle or numeric radians for rotation. Arrow keys move with the Move tools.');
    const x = this.points[i * 2]!, y = this.points[i * 2 + 1]!, amount = e.shiftKey ? 10 : 1;
    const gesture = this.prepare(i, x, y);
    try { gesture.update(x + (e.key === 'ArrowRight' ? amount : e.key === 'ArrowLeft' ? -amount : 0), y + (e.key === 'ArrowDown' ? amount : e.key === 'ArrowUp' ? -amount : 0)); gesture.finish(); this.host.changed(); }
    catch (error) { gesture.cancel(); throw error; }
  }
  dispose() { if (this.disposed) return; this.cancel(); this.disposed = true; this.observer.disconnect(); this.preview.overlay = null; }
}
