import type { ActorPart, ActorProject } from '@actor-animator/types';
import { openActorProject, saveActorProject } from '../../../../packages/actor-tools/src/index';

export const RECOVERY_KEY = 'actor-animator:draft:1';
export const identityTransform = () => ({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
export function emptyProject(): ActorProject {
  return { format: 'spacelab-actor-project/1', version: '0.1.0', id: `local:${crypto.randomUUID()}`,
    name: 'Untitled actor', author: 'Local creator', license: 'MIT', provenance: 'Created locally with Space Lab actor tools',
    units: { metresPerUnit: 1, coordinates: 'x-right-y-up', angle: 'radians-ccw', time: 'seconds', origin: [0, 0] },
    requiredCapabilities: ['spacelab:indexed-raster/1', 'spacelab:transform-clips/1'],
    parts: [], rigs: [], attachments: [], clips: [], actions: [], extensions: {} };
}
export function readProject(text: string): ActorProject {
  const result = openActorProject(text);
  if (!result.ok) throw new Error(result.diagnostics.map(d => `${d.path}: ${d.message}`).join('\n'));
  return result.source;
}
/** Whole-project, validated transactions. History is bounded by both canonical
 * UTF-16 storage bytes and count; rejected edits leave the document untouched. */
export class ActorDraft {
  source: ActorProject;
  private baseline: string;
  private past: string[] = [];
  private future: string[] = [];
  private pending: string | null = null;
  epoch = 0;
  constructor(source = emptyProject(), readonly maxHistoryBytes = 8 * 1024 * 1024, readonly maxHistoryCount = 32) {
    this.baseline = saveActorProject(source); this.source = readProject(this.baseline);
  }
  get dirty() { return saveActorProject(this.source) !== this.baseline; }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  get historyBytes() { return [...this.past, ...this.future].reduce((n, s) => n + s.length * 2, 0); }
  private bound() {
    while (this.past.length + this.future.length > this.maxHistoryCount || this.historyBytes > this.maxHistoryBytes) {
      if (this.past.length) this.past.shift(); else this.future.shift();
    }
  }
  begin() { this.cancel(); this.pending = saveActorProject(this.source); this.epoch++; }
  edit(change: (source: ActorProject) => void, partId?: string) {
    const previous = saveActorProject(this.source), next = structuredClone(this.source); change(next);
    if (saveActorProject(next) === previous) return;
    if (partId) { const part = next.parts.find(p => p.id === partId); if (part) part.revision++; }
    const text = saveActorProject(next);
    if (text === saveActorProject(this.source)) return;
    if (this.pending === null) { this.past.push(saveActorProject(this.source)); this.future = []; }
    this.source = readProject(text); this.epoch++; this.bound();
  }
  commit() {
    if (this.pending !== null && this.pending !== saveActorProject(this.source)) { this.past.push(this.pending); this.future = []; this.bound(); }
    this.pending = null;
  }
  cancel() {
    if (this.pending !== null) { this.source = readProject(this.pending); this.pending = null; this.epoch++; }
  }
  undo() { this.cancel(); const text = this.past.pop(); if (text !== undefined) { this.future.push(saveActorProject(this.source)); this.source = readProject(text); this.epoch++; this.bound(); } }
  redo() { this.cancel(); const text = this.future.pop(); if (text !== undefined) { this.past.push(saveActorProject(this.source)); this.source = readProject(text); this.epoch++; this.bound(); } }
  replace(source: ActorProject, recovered = false) {
    const text = saveActorProject(source); this.cancel(); this.source = readProject(text);
    this.past = []; this.future = []; this.baseline = recovered ? '' : text; this.epoch++;
  }
  acknowledgeRetained() { this.commit(); this.baseline = saveActorProject(this.source); }
}
export function newPart(name: string, width: number, height: number): ActorPart {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 256 || height > 256) throw new Error('Painter dimensions must be 1–256.');
  return { id: crypto.randomUUID(), name, revision: 1, pivot: [0, 0], unitsPerPixel: 1,
    artwork: { kind: 'indexed-raster', width, height, palette: ['#00000000', '#d5e8ffff', '#ffbe55ff'],
      layers: [{ id: crypto.randomUUID(), name: 'Ink', opacity: 1, pixels: new Array(width * height).fill(0) }] } };
}
export function transparentIndex(part: ActorPart) {
  let index = part.artwork.palette.findIndex(c => c.slice(7, 9) === '00');
  if (index < 0) {
    if (part.artwork.palette.length >= 256) throw new Error('Palette is full; add a transparent colour before erasing.');
    index = part.artwork.palette.push('#00000000') - 1;
  }
  return index;
}
export function resizePart(part: ActorPart, width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 256 || height > 256) throw new Error('Painter dimensions must be 1–256.');
  const art = part.artwork, blank = transparentIndex(part);
  for (const layer of art.layers) {
    const pixels = new Array<number>(width * height).fill(blank);
    for (let y = 0; y < Math.min(height, art.height); y++) for (let x = 0; x < Math.min(width, art.width); x++) pixels[y * width + x] = layer.pixels[y * art.width + x]!;
    layer.pixels = pixels;
  }
  art.width = width; art.height = height;
}
export interface PixelRect { x: number; y: number; width: number; height: number }
export function movePixels(part: ActorPart, layerIndex: number, rect: PixelRect, dx: number, dy: number) {
  if (![rect.x, rect.y, rect.width, rect.height, dx, dy].every(Number.isInteger)) throw new Error('Selection must use integer pixels.');
  const { width, height, layers } = part.artwork, layer = layers[layerIndex]; if (!layer) throw new Error('Select a layer.');
  if (rect.x < 0 || rect.y < 0 || rect.width < 1 || rect.height < 1 || rect.x + rect.width > width || rect.y + rect.height > height) throw new Error('Selection lies outside the part.');
  if (rect.x + dx < 0 || rect.y + dy < 0 || rect.x + rect.width + dx > width || rect.y + rect.height + dy > height) throw new Error('Move would crop pixels; resize the part first.');
  const before = layer.pixels.slice(), blank = transparentIndex(part);
  for (let y = 0; y < rect.height; y++) for (let x = 0; x < rect.width; x++) layer.pixels[(rect.y + y) * width + rect.x + x] = blank;
  for (let y = 0; y < rect.height; y++) for (let x = 0; x < rect.width; x++) layer.pixels[(rect.y + y + dy) * width + rect.x + x + dx] = before[(rect.y + y) * width + rect.x + x]!;
}
export function ink(part: ActorPart, layerIndex: number, x: number, y: number, color: number, fill = false) {
  const { width, height, layers } = part.artwork, pixels = layers[layerIndex]?.pixels;
  if (!pixels) throw new Error('Select a layer.');
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) return;
  const start = y * width + x, previous = pixels[start]; if (previous === color) return;
  pixels[start] = color;
  if (!fill) return;
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i]!, px = p % width;
    const visit = (n: number) => { if (pixels[n] === previous) { pixels[n] = color; queue.push(n); } };
    if (px) visit(p - 1); if (px + 1 < width) visit(p + 1); if (p >= width) visit(p - width); if (p + width < pixels.length) visit(p + width);
  }
}
