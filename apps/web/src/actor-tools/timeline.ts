import type { ActorTrackTarget } from '@actor-animator/types';
import type { ActorDraft } from './editing';
import type { ActorPreview } from './preview';
import { CHANNELS, channelNames, copyKeys, dragOffset, deleteKeys, pasteKeys, rangeKeys, refId, rowsFor, sheetPoint, TimelineMove,
  type Channel, type KeyClipboard, type KeyRef, type SheetGeometry, type TimelineRow } from './timeline-model';

interface Host { draft: ActorDraft; controller: AbortController; perform(f: () => void): void; changed(): void; cancelGesture(): void; message(s: string): void }
interface Binding { clip(): string; target(): ActorTrackTarget; select(row: TimelineRow, time?: number): void }
const LABEL = 184, ROW = 32, RULER = 32;
type Pointer = { id: number; kind: 'move' | 'range' | 'scrub'; start: { time: number; row: number }; g: SheetGeometry; epoch: number; context: string; delta: number; anchor: number; clicked?: KeyRef; move?: TimelineMove; add: KeyRef[]; rect: DOMRect };
/** DOM rows are retained during playback and staged drags; only the playhead
 * follows the existing preview clock. All input geometry is CSS/layout pixels. */
export class ActorTimeline {
  private rows: TimelineRow[] = [];
  private selection: KeyRef[] = [];
  private clipboard: { data: KeyClipboard; documentEpoch: number } | null = null;
  private stamp = '';
  private pointer: Pointer | null = null;
  private observer: ResizeObserver;
  private disposed = false;
  private readonly sheet: HTMLElement;
  private readonly content: HTMLElement;
  private readonly line: HTMLElement;
  private readonly box: HTMLElement;
  private zoom = 160;
  constructor(readonly root: HTMLElement, readonly host: Host, readonly preview: ActorPreview, readonly binding: Binding) {
    root.innerHTML = `<p>Seconds · drag keys to retime; Shift-click toggles keys. Drag empty rows to select a range. Drag the ruler to seek. Cel holds run until the next key or clip end.</p>
      <nav><label>Pixels / second<select id="sheet-zoom"><option>80</option><option selected>160</option><option>320</option><option>640</option></select></label>
      <label>Rows<select id="sheet-filter"><option value="all">All channels</option><option value="keyed">Authored tracks</option>${CHANNELS.map(c => `<option value="${c}">${channelNames[c]}</option>`).join('')}</select></label>
      <label>Snap interval (seconds; 0 = off)<input id="sheet-snap" type="number" step="any" min="0" value="0"></label></nav>
      <div id="dope-sheet" tabindex="0" role="group" aria-label="Actor dope sheet" aria-describedby="sheet-help"><div id="sheet-content"><div id="sheet-ruler"></div><div id="sheet-rows"></div><div id="sheet-playhead"></div><div id="sheet-range-box" hidden></div></div></div>
      <p id="sheet-help">Focus the sheet: Ctrl/Cmd A selects all, C copies, V pastes at the playhead, Delete removes keys, Z / Shift Z undoes/redoes. Arrows seek one snap interval (or 0.01 s); Shift arrows move selected keys. Escape cancels. Exact controls follow.</p>
      <output id="sheet-clock"></output><output id="dope-status" role="status"></output>
      <nav><button id="sheet-all">Select all keys</button><button id="sheet-clear">Clear selection</button><button id="sheet-copy">Copy keys</button><button id="sheet-paste">Paste at playhead</button><button id="sheet-delete">Delete selected keys</button></nav>
      <nav><label>Range start (s)<input id="sheet-range-a" type="number" step="any" value="0"></label><label>Range end (s)<input id="sheet-range-b" type="number" step="any" value="1"></label><button id="sheet-range">Select inclusive range</button></nav>
      <nav><label>Move offset (s)<input id="sheet-offset" type="number" step="any" value="0.1"></label><button id="sheet-move">Move selected keys</button><label>Paste origin (s)<input id="sheet-paste-time" type="number" step="any" value="0"></label><button id="sheet-paste-exact">Paste at exact time</button></nav>`;
    this.sheet = this.el('dope-sheet'); this.content = this.el('sheet-content'); this.line = this.el('sheet-playhead'); this.box = this.el('sheet-range-box');
    const signal = host.controller.signal;
    const click = (id: string, f: () => void) => this.el(id).addEventListener('click', () => host.perform(() => { host.cancelGesture(); preview.pause(); f(); }), { signal });
    click('sheet-all', () => this.setSelection(rangeKeys(this.rows, 0, this.duration())));
    click('sheet-clear', () => this.setSelection([])); click('sheet-copy', () => this.copy()); click('sheet-delete', () => this.remove());
    click('sheet-paste', () => this.paste(preview.clipId === binding.clip() ? preview.clipTime() : 0));
    click('sheet-paste-exact', () => this.paste(this.num('sheet-paste-time')));
    click('sheet-move', () => this.move(this.num('sheet-offset')));
    click('sheet-range', () => this.setSelection(rangeKeys(this.rows, this.num('sheet-range-a'), this.num('sheet-range-b'))));
    for (const id of ['sheet-zoom', 'sheet-filter']) this.el(id).addEventListener('change', () => { this.cancel(); this.zoom = this.num('sheet-zoom'); this.render(true); }, { signal });
    this.sheet.addEventListener('pointerdown', e => host.perform(() => this.down(e)), { signal });
    this.sheet.addEventListener('pointermove', e => host.perform(() => this.motion(e)), { signal });
    this.sheet.addEventListener('pointerup', e => host.perform(() => this.up(e)), { signal });
    for (const event of ['pointercancel', 'lostpointercapture'] as const) this.sheet.addEventListener(event, e => { if (e.pointerId === this.pointer?.id) this.cancel(); }, { signal });
    this.sheet.addEventListener('keydown', e => host.perform(() => this.key(e)), { signal });
    this.sheet.addEventListener('click', e => { if (e.detail !== 0) return; const el = e.target as HTMLElement; host.perform(() => { if (el.dataset.key) this.choose(el, false); else if (el.dataset.label !== undefined) { const row = this.rows[Number(el.dataset.label)]; if (row) this.binding.select(row); } this.sheet.focus({preventScroll:true}); }); }, { signal });
    this.sheet.addEventListener('scroll', () => this.cancel(), { signal });
    document.addEventListener('pointerdown', e => { if (!this.sheet.contains(e.target as Node)) this.cancel(); }, { capture: true, signal });
    document.addEventListener('focusin', e => { if (!this.sheet.contains(e.target as Node)) this.cancel(); }, { signal });
    document.addEventListener('change', () => this.cancel(), { capture: true, signal });
    // Scrolling an ancestor changes the captured screen origin too.
    document.addEventListener('scroll', e => { if (e.target !== this.sheet) this.cancel(); }, { capture: true, signal });
    this.observer = new ResizeObserver(() => this.cancel()); this.observer.observe(this.sheet);
  }
  private el<T extends HTMLElement = HTMLElement>(id: string) { return this.root.querySelector<T>(`#${id}`)!; }
  private num(id: string) { const v = this.el<HTMLInputElement>(id).value, n = Number(v); if (!v.trim() || !Number.isFinite(n)) throw new Error('Enter finite seconds.'); return n; }
  private duration() { return this.host.draft.source.clips.find(c => c.id === this.binding.clip())?.duration ?? 0; }
  private context() { let target = ''; try { target = JSON.stringify(this.binding.target()); } catch { /* Empty source. */ } return JSON.stringify([this.binding.clip(), target]); }
  private geometry(): SheetGeometry {
    const r = this.sheet.getBoundingClientRect(), style = getComputedStyle(this.sheet);
    const scaleX = r.width / parseFloat(style.width), scaleY = r.height / parseFloat(style.height);
    return { left: r.left + this.sheet.clientLeft * scaleX, top: r.top + this.sheet.clientTop * scaleY,
      scaleX, scaleY, scrollLeft: this.sheet.scrollLeft, scrollTop: this.sheet.scrollTop, label: LABEL, ruler: RULER, row: ROW, zoom: this.zoom };
  }
  render(force = false) {
    if (this.disposed) return;
    const stamp = `${this.host.draft.epoch}:${this.context()}`;
    if (stamp === this.stamp && !force) { this.time(); return; }
    this.cancel(); if (stamp !== this.stamp) this.selection = [];
    this.stamp = stamp;
    if (this.clipboard?.documentEpoch !== this.host.draft.documentEpoch) this.clipboard = null;
    const s = this.host.draft.source, clip = s.clips.find(c => c.id === this.binding.clip());
    const filter = this.el<HTMLSelectElement>('sheet-filter').value;
    this.rows = rowsFor(s, clip).filter(r => filter === 'all' || filter === 'keyed' && !!r.track || filter === r.channel);
    const width = LABEL + this.duration() * this.zoom + 24;
    this.content.style.width = `${Math.max(LABEL + 80, width)}px`;
    const ruler = this.el('sheet-ruler'); ruler.replaceChildren();
    const title = document.createElement('span'); title.className = 'sheet-corner'; title.textContent = clip ? 'Target / channel · seconds' : 'Create a clip to animate'; ruler.append(title);
    // Bound tick count even for very long clips. Ticks do not quantize source.
    const step = Math.max(1 / 8, 2 ** Math.ceil(Math.log2(Math.max(1 / 8, this.duration() / 128, 64 / this.zoom))));
    for (let t = 0; t <= this.duration(); t += step) { const tick = document.createElement('span'); tick.textContent = `${t} s`; tick.style.left = `${LABEL + t * this.zoom}px`; ruler.append(tick); }
    const body = this.el('sheet-rows'); body.replaceChildren(...this.rows.map((row, i) => {
      const el = document.createElement('div'); el.className = 'sheet-row'; el.dataset.row = String(i);
      const label = document.createElement('button'); label.className = 'sheet-label'; label.dataset.label = String(i);
      const metadata = row.track && 'interpolation' in row.track ? ` · ${row.track.interpolation} / ${row.track.angle ?? 'legacy-unwrapped'}` : '';
      label.textContent = `${row.label} · ${channelNames[row.channel]}`; label.title = label.textContent + metadata; el.append(label);
      const keys = row.track?.keys ?? [];
      for (let ki = 0; ki < keys.length; ki++) { const k = keys[ki]!;
        const key = document.createElement('button'); key.className = 'sheet-key'; key.dataset.key = refId({ channel: row.channel, trackId: row.track!.id, time: k.time }); key.dataset.row = String(i);
        key.style.left = `${LABEL + k.time * this.zoom}px`;
        const detail = 'value' in k ? `${k.curve ?? 'track default'}${k.turns ? ` · ${k.turns} turns` : ''}` : 'visible' in k ? String(k.visible) : 'drawOrder' in k ? String(k.drawOrder) : `${s.cels?.find(c => c.id === k.celId)?.name ?? k.celId}; hold to ${keys[ki + 1]?.time ?? clip?.duration} s`;
        key.title = `${row.label} · ${channelNames[row.channel]} · ${k.time} s · ${detail}${'bezier' in k ? ` · Bézier ${k.bezier}` : ''}`;
        key.setAttribute('aria-label', key.title); key.textContent = row.channel === 'tracks' ? '◆' : row.channel === 'celTracks' ? '▣' : '●'; el.append(key);
      }
      return el;
    }));
    if (!this.rows.length) { const empty = document.createElement('p'); empty.textContent = 'No rows in this view. Create a node or scene attachment, or choose All channels.'; body.append(empty); }
    this.paintSelection(); this.time();
  }
  /** Called by the existing preview clock only; O(1), no key/source traversal. */
  time() {
    if (this.disposed) return;
    const single = this.preview.clipId === this.binding.clip(), effective = single ? this.preview.clipTime() : 0;
    this.line.hidden = !single; this.line.style.transform = `translateX(${LABEL + effective * this.zoom}px)`;
    this.el('sheet-clock').textContent = single ? `Clip ${effective.toFixed(4)} s · clock ${this.preview.currentTime.toFixed(4)} s` : 'Show the selected single clip to follow its playhead. Ruler seeks that clip.';
  }
  selectPrecise(channel: Channel, target: ActorTrackTarget, time?: number) {
    const r = this.rows.find(r => r.channel === channel && JSON.stringify(r.target) === JSON.stringify(target));
    this.setSelection(time === undefined || !r?.track?.keys.some(k => k.time === time) ? [] : [{ channel, trackId: r.track.id, time }]);
  }
  private setSelection(refs: KeyRef[]) { this.selection = [...new Map(refs.map(r => [refId(r), r])).values()]; this.paintSelection(); }
  private paintSelection() {
    const selected = new Set(this.selection.map(refId));
    for (const el of this.sheet.querySelectorAll<HTMLElement>('[data-key]')) { const on = selected.has(el.dataset.key!); el.setAttribute('aria-pressed', String(on)); el.style.setProperty('--key-delta', '0px'); }
    this.el('dope-status').textContent = `${this.selection.length} selected key${this.selection.length === 1 ? '' : 's'}. ${this.selection.length === 1 ? this.sheet.querySelector<HTMLElement>('[data-key][aria-pressed=true]')?.title ?? '' : 'Move/copy retains relative offsets and all channel metadata.'}`;
  }
  private choose(el: HTMLElement, toggle: boolean, preserveGroup = false) {
    const row = this.rows[Number(el.dataset.row)]; if (!row || !el.dataset.key) return;
    const [channel, trackId, time] = JSON.parse(el.dataset.key) as [Channel, string, number], ref = { channel, trackId, time };
    const old = this.selection;
    this.binding.select(row, time);
    this.setSelection(toggle ? old.some(r => refId(r) === refId(ref)) ? old.filter(r => refId(r) !== refId(ref)) : [...old, ref] : preserveGroup && old.some(r => refId(r) === refId(ref)) ? old : [ref]);
    this.seek(time);
  }
  private seek(t: number) { if (!this.binding.clip()) return; if (this.preview.clipId !== this.binding.clip()) this.preview.select(this.binding.clip()); this.preview.seek(Math.max(0, Math.min(this.duration(), t))); }
  private snap(t: number) { const n = this.num('sheet-snap'); if (n < 0) throw new Error('Snap interval must be zero (off) or positive seconds.'); return n ? Math.round(t / n) * n : t; }
  private down(e: PointerEvent) {
    if (e.button !== 0 || this.pointer || !this.binding.clip()) return;
    this.host.cancelGesture(); this.preview.pause(); e.preventDefault(); this.sheet.focus({ preventScroll: true });
    const g = this.geometry(), point = sheetPoint(g, e.clientX, e.clientY), target = e.target as HTMLElement;
    // Sticky labels/ruler are hit in viewport space, not scrolled content space.
    if (target.dataset.label !== undefined) { const r = this.rows[Number(target.dataset.label)]; if (r) this.binding.select(r); this.setSelection([]); return; }
    let kind: Pointer['kind'] = target.closest('#sheet-ruler') ? 'scrub' : 'range';
    let hit = target.closest<HTMLElement>('[data-key]');
    if (e.altKey && kind !== 'scrub' && point.row >= 0) {
      const candidates = [...this.sheet.querySelectorAll<HTMLElement>(`[data-key][data-row="${point.row}"]`)].filter(k => { const b = k.getBoundingClientRect(); return Math.abs(e.clientX - b.x - b.width / 2) <= 10 * g.scaleX; });
      if (candidates.length) { const at = candidates.findIndex(k => this.selection.some(r => refId(r) === k.dataset.key)); hit = candidates[(at + 1) % candidates.length]!; }
    }
    if (hit) { this.choose(hit, e.shiftKey, true); if (e.shiftKey) return; kind = 'move'; }
    const identity = hit?.dataset.key ? JSON.parse(hit.dataset.key) as [Channel, string, number] : undefined;
    const clicked = identity ? { channel: identity[0], trackId: identity[1], time: identity[2] } : undefined, anchor = clicked?.time ?? 0;
    const move = kind === 'move' && this.selection.length ? new TimelineMove(this.host.draft, this.binding.clip(), structuredClone(this.selection)) : undefined;
    this.pointer = { id: e.pointerId, kind, start: point, g, epoch: this.host.draft.epoch, context: this.context(), delta: 0, anchor, clicked, move, add: e.shiftKey ? this.selection : [], rect: this.sheet.getBoundingClientRect() };
    this.sheet.setPointerCapture(e.pointerId); if (kind === 'scrub') this.seek(this.snap(point.time));
  }
  private motion(e: PointerEvent) {
    const p = this.pointer; if (!p || p.id !== e.pointerId) return;
    const r = this.sheet.getBoundingClientRect();
    if (this.host.draft.epoch !== p.epoch || this.context() !== p.context || r.x !== p.rect.x || r.y !== p.rect.y || r.width !== p.rect.width || r.height !== p.rect.height) { this.cancel(); return; }
    const end = sheetPoint(p.g, e.clientX, e.clientY);
    if (p.kind === 'scrub') this.seek(this.snap(end.time));
    if (p.kind === 'move') {
      // Snap the grabbed key, then apply that one delta to the whole group.
      const anchor = p.anchor;
      const delta = end.time - p.start.time; p.delta = dragOffset(anchor, delta, this.num('sheet-snap'));
      for (const el of this.sheet.querySelectorAll<HTMLElement>('[data-key][aria-pressed=true]')) el.style.setProperty('--key-delta', `${p.delta * this.zoom}px`);
      this.el('dope-status').textContent = `Staged offset ${p.delta} s · release to validate all destinations; Escape cancels.`;
    }
    if (p.kind === 'range') {
      const x = LABEL + Math.min(p.start.time, end.time) * this.zoom, y = RULER + Math.max(0, Math.min(p.start.row, end.row)) * ROW;
      this.box.hidden = false; Object.assign(this.box.style, { left: `${x}px`, top: `${y}px`, width: `${Math.abs(end.time - p.start.time) * this.zoom}px`, height: `${(Math.abs(end.row - p.start.row) + 1) * ROW}px` });
      this.setSelection([...p.add, ...rangeKeys(this.rows, p.start.time, end.time, p.start.row, end.row)]);
    }
  }
  private up(e: PointerEvent) {
    if (this.pointer?.id !== e.pointerId) return;
    this.motion(e); const p = this.pointer; if (!p) return;
    this.pointer = null; this.box.hidden = true; this.release(p.id);
    try { if (p.move) { const refs = p.move.finish(p.delta); if (refs && p.delta !== 0) { this.afterEdit(refs); this.host.message('Retimed keys in one source transaction. Adjacent cel holds follow their new boundaries.'); } else if (refs && p.clicked) this.setSelection([p.clicked]); } }
    finally { this.paintSelection(); }
  }
  private release(id: number) { if (this.sheet.hasPointerCapture(id)) this.sheet.releasePointerCapture(id); }
  cancel() { const p = this.pointer; if (!p) return; this.pointer = null; p.move?.cancel(); this.box.hidden = true; this.release(p.id); this.paintSelection(); }
  private copy() { this.clipboard = { data: copyKeys(this.host.draft.source, this.binding.clip(), this.selection), documentEpoch: this.host.draft.documentEpoch }; this.host.message('Copied full key records to this project’s internal clipboard.'); }
  private paste(time: number) {
    if (!this.clipboard || this.clipboard.documentEpoch !== this.host.draft.documentEpoch) throw new Error('Copy keys in this project first.');
    let refs: KeyRef[] = []; this.host.draft.edit(s => { refs = pasteKeys(s, this.binding.clip(), this.clipboard!.data, time, () => crypto.randomUUID()); }); this.afterEdit(refs);
  }
  private move(delta: number) { const g = new TimelineMove(this.host.draft, this.binding.clip(), this.selection), refs = g.finish(delta); this.afterEdit(refs ?? []); }
  private afterEdit(refs: KeyRef[]) {
    this.host.changed(); const first = refs[0], row = first && this.rows.find(r => r.channel === first.channel && r.track?.id === first.trackId);
    if (row && first) { this.binding.select(row, first.time); this.seek(first.time); }
    this.setSelection(refs);
  }
  private remove() { this.host.draft.edit(s => deleteKeys(s, this.binding.clip(), this.selection)); this.host.changed(); this.setSelection([]); }
  private key(e: KeyboardEvent) {
    if (e.key === 'Escape') { this.cancel(); return; }
    if (e.target !== this.sheet) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && ['a','c','v','z'].includes(k)) {
      e.preventDefault(); this.cancel();
      if (k === 'a') this.setSelection(rangeKeys(this.rows, 0, this.duration()));
      if (k === 'c') this.copy(); if (k === 'v') this.paste(this.preview.clipId === this.binding.clip() ? this.preview.clipTime() : 0);
      if (k === 'z') { e.shiftKey ? this.host.draft.redo() : this.host.draft.undo(); this.host.changed(); }
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.cancel(); this.remove(); }
    if (!mod && !e.altKey && ['ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); this.cancel(); const step = this.num('sheet-snap') || .01, delta = e.key === 'ArrowLeft' ? -step : step; if (e.shiftKey) this.move(delta); else this.seek((this.preview.clipId === this.binding.clip() ? this.preview.clipTime() : 0) + delta); }
  }
  dispose() { this.cancel(); this.disposed = true; this.observer.disconnect(); }
}
