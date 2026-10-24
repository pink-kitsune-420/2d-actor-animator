import type { ActorPart } from '@actor-animator/types';
import { saveActorProject, DEFAULT_ACTOR_PROJECT_LIMITS } from '../../../../packages/actor-tools/src/index';
import { ActorDraft, RECOVERY_KEY, emptyProject, ink, movePixels, newPart, readProject, resizePart, transparentIndex, type PixelRect } from './editing';
import { decodePng, rasterCanvas } from './png';
import { editPartRevision } from './assembly';
import { AssemblyPanel } from './assembly-panel';
import classicAstronaut from './classic-astronaut.project.json';
import { ActorWorkspace } from './workspace';
import './style.css';

export class ActorEditor {
  readonly draft = new ActorDraft();
  readonly controller = new AbortController();
  private disposed = false;
  private generation = 0;
  private decoding = false;
  private urls = new Map<string, ReturnType<typeof setTimeout>>();
  private partId = '';
  private layerIndex = 0;
  private color = 1;
  private pointer: { id: number; partId: string; x: number; y: number; lastX: number; lastY: number } | null = null;
  private selection: PixelRect | null = null;
  private lastDownload: string | null = null;
  readonly canvas: HTMLCanvasElement;
  readonly assembly: AssemblyPanel;
  readonly workspace: ActorWorkspace;
  constructor(readonly root: HTMLElement) {
    root.innerHTML = `<header><h1>2D Actor Animator</h1><p>Create parts, build a rig, bring it to life.</p><button id="getting-started" type="button">Help &amp; shortcuts</button></header>
      <nav aria-label="Project"><details id="project-library"><summary>Projects</summary><div role="group" aria-label="Project choices">
      <section aria-labelledby="new-project-title"><h2 id="new-project-title">New project</h2><button id="new">Empty project</button></section>
      <section aria-labelledby="open-project-title"><h2 id="open-project-title">Open project</h2><label class="file">Open source<input id="open" type="file" accept=".json,.actorproject"></label></section>
      <section aria-labelledby="example-projects-title"><h2 id="example-projects-title">Examples</h2><button id="classic-astronaut">Example: classic astronaut</button></section>
      </div></details><button id="save">Download editable source</button><button id="undo">Undo</button><button id="redo">Redo</button><details id="project-options"><summary>Project &amp; recovery</summary><div><button id="retained">I retained this source</button><p>A download starts a file transfer. Confirm retention only after keeping the current file.</p><button id="recover">Recover local draft</button><p id="recovery-help"></p><details id="project-details"><summary>Project details</summary><label>Project name<input id="project-name"></label><label>Project revision<input id="project-version"></label><label>Author<input id="project-author"></label><label>Provenance<input id="project-provenance"></label><button id="apply-project">Apply project details</button></details></div></details></nav>
      <div class="feedback"><p id="state" role="status"></p><p id="message" role="status">Start with the example, open a source file, or create your first part below. Download editable source to keep every layer, rig and clip.</p></div><div class="layout"><aside><h2>Parts</h2><label>Part<select id="parts"></select></label><label>Part name<input id="part-name" value="Tail segment"></label><button id="add-part">Create part</button><button id="rename">Rename part</button>
      <div class="pair"><label>Width<input id="width" type="number" min="1" max="256" value="16"></label><label>Height<input id="height" type="number" min="1" max="256" value="16"></label></div><button id="resize">Apply dimensions</button>
      <details><summary>Pivot &amp; pixel scale</summary><p>Pivot X/Y use project units from the bottom-left of the image. Positive Y points up. Pixel scale is project units per pixel.</p><div class="pair"><label>Pivot X<input id="pivot-x" type="number" step="any" value="0"></label><label>Pivot Y<input id="pivot-y" type="number" step="any" value="0"></label></div><label>Units per pixel<input id="units" type="number" step="any" min="0.000001" value="1"></label><button id="pivot">Apply pivot and scale</button></details>
      <details><summary>Layers &amp; opacity</summary><h2>Layers</h2><label>Layer<select id="layers"></select></label><label>Layer name<input id="layer-name" value="Ink"></label><label>Layer opacity<input id="opacity" type="number" min="0" max="1" step="0.05" value="1"></label><button id="add-layer">Add layer</button><button id="edit-layer">Apply layer</button><button id="layer-up">Raise layer</button><button id="remove-layer">Remove layer</button>
      </details><h2>Palette</h2><label>Palette entry<select id="palette"></select></label><label>Colour<input id="colour" type="color" value="#d5e8ff"></label><label>Alpha (0–255)<input id="alpha" type="number" min="0" max="255" value="255"></label><button id="apply-colour">Apply palette entry</button><button id="add-colour">Add colour</button>
      <details><summary>PNG import &amp; export</summary><h2>Files</h2><label class="file">Import PNG as new part<input id="png" type="file" accept="image/png"></label><button id="export">Download flattened PNG</button><p>PNG is flattened output: no layers, pivot, rig or editable project. Import: ≤4 MiB, ≤256×256, ≤256 palette colours including transparency.</p></details></aside>
      <section><nav aria-label="Painting"><label>Tool<select id="tool"><option value="brush">Brush</option><option value="erase">Erase</option><option value="fill">Fill</option><option value="select">Select rectangle</option></select></label><label>Zoom<select id="zoom"><option>4</option><option>8</option><option selected>16</option><option>24</option><option>32</option></select></label><label><input id="grid" type="checkbox" checked>Grid</label></nav>
      <div class="viewport"><div id="stage"><canvas id="paint" aria-label="Part painting canvas" tabindex="0"></canvas><div id="grid-lines"></div><div id="pivot-marker">+</div><div id="selection"></div></div></div>
      <details><summary>Move a pixel selection</summary><fieldset><legend>Selection move (pixels, positive Y down)</legend><label>Move X<input id="move-x" type="number" value="1"></label><label>Move Y<input id="move-y" type="number" value="0"></label><button id="move">Move selection</button><p id="selected">No selection</p></fieldset>
      </details><p>Brush gestures are one undo step. Cancelled gestures roll back. Ctrl/Cmd Z and Shift Z apply on the canvas; text fields keep native editing.</p><div id="assembly"></div></section></div>`;
    this.canvas = this.el<HTMLCanvasElement>('paint');
    this.assembly = new AssemblyPanel(this.el('assembly'), this);
    this.workspace = new ActorWorkspace(this.root, this);
    const signal = this.controller.signal;
    const click = (id: string, action: () => void) => this.el(id).addEventListener('click', () => this.perform(() => { this.cancelGesture(); this.assembly.pause(); action(); }), { signal });
    click('new', () => { if (this.mayReplace()) { this.generation++; this.draft.replace(emptyProject()); this.partId = ''; this.changed(); } });
    click('classic-astronaut', () => { if (this.mayReplace()) { this.generation++; this.draft.replace(readProject(JSON.stringify(classicAstronaut)), true); this.partId = ''; this.changed(); this.el<HTMLSelectElement>('preview-zoom').value = '128'; this.assembly.preview.zoom(128); this.el<HTMLInputElement>('preview-origin-y').value = '0.8'; this.assembly.preview.aids(1, 0, false, true, 0.8); this.message('Classic astronaut example loaded.'); } });
    click('apply-project', () => { this.draft.edit(s => { s.name = this.value('project-name'); s.version = this.value('project-version'); s.author = this.value('project-author'); s.provenance = this.value('project-provenance'); }); this.changed(); this.el<HTMLDetailsElement>('project-details').open = false; });
    click('save', () => this.downloadSource());
    click('retained', () => { if (this.lastDownload !== saveActorProject(this.draft.source)) throw new Error('Download the current editable source first.'); this.draft.acknowledgeRetained(); this.render(); this.message('You confirmed retaining the current source.'); });
    click('recover', () => { const text = localStorage.getItem(RECOVERY_KEY); if (!text) throw new Error('No local recovery draft.'); const project = readProject(text); if (this.mayReplace()) { this.generation++; this.draft.replace(project, true); this.partId = ''; this.changed(); this.message('Recovered local draft; save editable source to retain a file.'); } });
    click('add-part', () => { const part = newPart(this.value('part-name'), this.num('width'), this.num('height')); this.draft.edit(s => s.parts.push(part)); this.partId = part.id; this.layerIndex = 0; this.changed(); });
    click('rename', () => this.editPart(p => { p.name = this.value('part-name'); }));
    click('resize', () => { const part = this.part(); if ((this.num('width') < part.artwork.width || this.num('height') < part.artwork.height) && !confirm('Smaller dimensions crop pixels on all layers. Continue?')) return; this.editPart(p => resizePart(p, this.num('width'), this.num('height'))); });
    click('pivot', () => this.editPart(p => { p.pivot = [this.num('pivot-x'), this.num('pivot-y')]; p.unitsPerPixel = this.num('units'); }));
    click('add-layer', () => { this.editPart(p => p.artwork.layers.push({ id: crypto.randomUUID(), name: this.value('layer-name'), opacity: 1, pixels: new Array(p.artwork.width * p.artwork.height).fill(transparentIndex(p)) })); this.layerIndex = this.part().artwork.layers.length - 1; this.render(); });
    click('edit-layer', () => this.editPart(p => { const layer = p.artwork.layers[this.layerIndex]; if (!layer) throw new Error('Select a layer.'); layer.name = this.value('layer-name'); layer.opacity = this.num('opacity'); }));
    click('layer-up', () => { const index = this.layerIndex; this.editPart(p => { if (index + 1 < p.artwork.layers.length) { const a = p.artwork.layers; [a[index], a[index + 1]] = [a[index + 1]!, a[index]!]; } }); this.layerIndex = Math.min(index + 1, this.part().artwork.layers.length - 1); this.render(); });
    click('remove-layer', () => this.editPart(p => { p.artwork.layers.splice(this.layerIndex, 1); this.layerIndex = Math.max(0, this.layerIndex - 1); }));
    const colour = () => { const alpha = this.num('alpha'); if (!Number.isInteger(alpha) || alpha < 0 || alpha > 255) throw new Error('Alpha must be 0–255.'); return `${this.value('colour')}${alpha.toString(16).padStart(2, '0')}`; };
    click('apply-colour', () => this.editPart(p => { p.artwork.palette[this.color] = colour(); }));
    click('add-colour', () => { this.editPart(p => p.artwork.palette.push(colour())); this.color = this.part().artwork.palette.length - 1; this.render(); });
    click('move', () => { if (!this.selection) throw new Error('Select a rectangle on the canvas first.'); const rect = this.selection, dx = this.num('move-x'), dy = this.num('move-y'); this.editPart(p => movePixels(p, this.layerIndex, rect, dx, dy)); this.selection = { ...rect, x: rect.x + dx, y: rect.y + dy }; this.draw(); });
    click('undo', () => { this.draft.undo(); this.changed(); }); click('redo', () => { this.draft.redo(); this.changed(); });
    click('export', () => { const canvas = rasterCanvas(this.part()), generation = this.generation, epoch = this.draft.epoch; canvas.toBlob(blob => { canvas.width = canvas.height = 0; if (this.disposed || generation !== this.generation || epoch !== this.draft.epoch) return; if (!blob) { this.message('PNG encoding failed.'); return; } this.download(blob, 'part.flattened.png'); this.message('Flattened PNG download initiated. Editable source is separate; retention is unverified.'); }, 'image/png'); });
    for (const id of ['parts', 'layers', 'palette', 'zoom', 'grid', 'tool']) this.el(id).addEventListener('change', () => this.perform(() => {
      this.cancelGesture(); if (id === 'parts') { this.partId = this.value(id); this.layerIndex = 0; this.color = 1; this.selection = null; }
      if (id === 'layers') this.layerIndex = this.num(id); if (id === 'palette') this.color = this.num(id); this.render();
    }), { signal });
    this.fileInput('open', async file => { if (file.size > DEFAULT_ACTOR_PROJECT_LIMITS.maxJsonBytes) throw new Error('Source exceeds 4 MiB budget.'); return readProject(await file.text()); }, project => { this.draft.replace(project); this.partId = ''; this.changed(); this.message('Opened complete editable source.'); }, true);
    this.fileInput('png', async file => {
      if (this.decoding) throw new Error('A PNG decode is still in progress.'); this.decoding = true;
      try { return await decodePng(file); } finally { this.decoding = false; }
    }, result => { this.draft.edit(s => s.parts.push(result.part)); this.partId = result.part.id; this.layerIndex = 0; this.changed(); this.message(`PNG imported as a new part. Decode and indexing: ${result.milliseconds.toFixed(2)} ms.`); }, false);
    this.canvas.addEventListener('pointerdown', e => this.perform(() => this.down(e)), { signal });
    this.canvas.addEventListener('pointermove', e => this.perform(() => this.motion(e)), { signal });
    this.canvas.addEventListener('pointerup', e => this.perform(() => this.up(e)), { signal });
    for (const name of ['pointercancel', 'lostpointercapture'] as const) this.canvas.addEventListener(name, () => this.cancelGesture(), { signal });
    window.addEventListener('blur', () => { this.cancelGesture(); this.assembly.pause(); }, { signal });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.cancelGesture(); this.assembly.pause(); } }, { signal });
    window.addEventListener('pagehide', () => this.closeView(), { signal });
    window.addEventListener('beforeunload', e => { if (this.draft.dirty) { e.preventDefault(); e.returnValue = ''; } }, { signal });
    this.canvas.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); this.cancelGesture(); e.shiftKey ? this.draft.redo() : this.draft.undo(); this.changed(); } if (e.key === 'Escape') this.cancelGesture(); }, { signal });
    this.render();
  }
  el<T extends HTMLElement = HTMLElement>(id: string): T { return this.root.querySelector<T>(`#${id}`)!; }
  value(id: string) { return this.el<HTMLInputElement>(id).value; }
  num(id: string) { const input = this.el<HTMLInputElement>(id); const n = Number(input.value); if (!input.value.trim() || !Number.isFinite(n)) throw new Error('Enter a finite number.'); return n; }
  message(text: string) { this.el('message').textContent = text; }
  perform(action: () => void) { if (this.disposed) return; try { action(); } catch (error) { this.cancelGesture(); this.message(error instanceof Error ? error.message : String(error)); } }
  part(): ActorPart { const part = this.draft.source.parts.find(p => p.id === this.partId); if (!part) throw new Error('Create or select a part first.'); return part; }
  private changePart(action: (part: ActorPart) => void) {
    const previous = this.part().id; this.partId = editPartRevision(this.draft, previous, action);
    if (this.partId !== previous) this.message('Accepted artwork retained. Editing a new part revision; accept it explicitly on each attachment when ready.');
  }
  editPart(action: (part: ActorPart) => void) { this.changePart(action); this.changed(); }
  changed() {
    this.generation++;
    try { localStorage.setItem(RECOVERY_KEY, saveActorProject(this.draft.source)); } catch { this.message('Local recovery unavailable or full; your current edits remain in memory. Download editable source.'); }
    this.render();
  }
  downloadSource() { const text = saveActorProject(this.draft.source); this.download(new Blob([text], { type: 'application/json' }), 'actor.actorproject'); this.lastDownload = text; this.workspace.render(); this.message('Editable source download initiated. Retention is unverified; dirty state remains until you confirm retaining this exact source.'); }
  get fileGeneration() { return this.generation; }
  mayReplace() { return !this.draft.dirty || confirm('Unsaved source edits remain. Replace this project? Local recovery is a separate draft, not a retained file.'); }
  /** Register a host-owned picker/decode guarded by document generation and epoch. */
  fileInput<T>(id: string, read: (file: File) => Promise<T>, install: (value: T) => void, replaces: boolean) {
    const input = this.el<HTMLInputElement>(id), signal = this.controller.signal; let approvedEpoch = -1;
    input.addEventListener('click', e => { this.cancelGesture(); this.assembly.pause(); this.generation++; this.assembly.cels.fileChanged(); if (replaces && !this.mayReplace()) { e.preventDefault(); return; } approvedEpoch = this.draft.epoch; }, { signal });
    input.addEventListener('cancel', () => { this.cancelGesture(); this.assembly.pause(); this.generation++; this.assembly.cels.fileChanged(); this.message('File selection cancelled; project retained.'); }, { signal });
    input.addEventListener('change', () => {
      this.cancelGesture(); this.assembly.pause(); const file = input.files?.[0]; input.value = ''; const generation = ++this.generation, epoch = this.draft.epoch; this.assembly.cels.fileChanged();
      if (!file) return;
      if (replaces && this.draft.dirty && approvedEpoch !== epoch && !this.mayReplace()) return;
      void read(file).then(result => { if (this.disposed || generation !== this.generation || epoch !== this.draft.epoch) return; install(result); }).catch(error => { if (!this.disposed && generation === this.generation) this.message(error instanceof Error ? error.message : String(error)); });
    }, { signal });
  }
  /** Select shared painter artwork without changing source or retaining a file. */
  selectPart(id: string) { this.workspace.openPainter(); this.partId = id; this.layerIndex = 0; this.selection = null; this.render(); this.canvas.scrollIntoView({ block: 'center' }); }
  /** Encoding is owned by this editor generation; the caller owns the canvas. */
  downloadCanvas(canvas: HTMLCanvasElement, name: string, valid: () => boolean) {
    const generation = this.generation, epoch = this.draft.epoch;
    canvas.toBlob(blob => { if (this.disposed || generation !== this.generation || epoch !== this.draft.epoch || !valid()) return; if (!blob) { this.message('PNG encoding failed.'); return; } this.download(blob, name); this.message('Flattened PNG download initiated. Retention is unverified; editable source remains separate.'); }, 'image/png');
  }
  /** Initiate a tracked object-URL download; retention remains unverified. */
  download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = name; this.root.append(link); link.click(); link.remove();
    this.urls.set(url, setTimeout(() => { URL.revokeObjectURL(url); this.urls.delete(url); }, 30000));
  }
  private point(e: PointerEvent) { const r = this.canvas.getBoundingClientRect(), part = this.part(); return { x: Math.floor((e.clientX - r.left) * part.artwork.width / r.width), y: Math.floor((e.clientY - r.top) * part.artwork.height / r.height) }; }
  private down(e: PointerEvent) {
    if (e.button !== 0 || this.pointer) return; this.part(); e.preventDefault(); this.canvas.focus();
    const p = this.point(e); this.assembly.pause(); this.draft.begin(); this.pointer = { id: e.pointerId, partId: this.partId, ...p, lastX: p.x, lastY: p.y };
    this.canvas.setPointerCapture(e.pointerId); if (this.value('tool') !== 'select') this.paint(p.x, p.y); this.draw();
  }
  private paint(x: number, y: number) {
    const tool = this.value('tool');
    this.changePart(part => ink(part, this.layerIndex, x, y, tool === 'erase' ? transparentIndex(part) : this.color, tool === 'fill'));
  }
  private motion(e: PointerEvent) {
    const pointer = this.pointer; if (!pointer || pointer.id !== e.pointerId || this.value('tool') === 'select' || this.value('tool') === 'fill') return;
    const p = this.point(e), max = Math.max(Math.abs(p.x - pointer.lastX), Math.abs(p.y - pointer.lastY));
    // One validated transaction per event, bounded by viewport crossing length.
    const tool = this.value('tool');
    this.changePart(part => { const color = tool === 'erase' ? transparentIndex(part) : this.color;
      for (let i = 1; i <= Math.min(max, 1024); i++) ink(part, this.layerIndex, Math.round(pointer.lastX + (p.x - pointer.lastX) * i / max), Math.round(pointer.lastY + (p.y - pointer.lastY) * i / max), color);
    });
    pointer.lastX = p.x; pointer.lastY = p.y; this.draw();
  }
  private up(e: PointerEvent) {
    const pointer = this.pointer; if (!pointer || pointer.id !== e.pointerId) return;
    this.motion(e);
    if (this.value('tool') === 'select') { const p = this.point(e), a = this.part().artwork; const x = Math.max(0, Math.min(pointer.x, p.x)), y = Math.max(0, Math.min(pointer.y, p.y)); this.selection = { x, y, width: Math.min(a.width - 1, Math.max(pointer.x, p.x)) - x + 1, height: Math.min(a.height - 1, Math.max(pointer.y, p.y)) - y + 1 }; }
    this.pointer = null; this.draft.commit(); if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId); this.changed();
  }
  cancelGesture() {
    this.assembly?.animation?.curves.cancel();
    this.assembly?.animation?.timeline.cancel();
    this.assembly?.viewport?.cancel();
    if (!this.pointer) return; const { id, partId } = this.pointer; this.pointer = null; this.draft.cancel(); this.partId = partId; if (this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id); this.draw();
  }
  render() {
    const source = this.draft.source; this.el<HTMLInputElement>('project-name').value = source.name; this.el<HTMLInputElement>('project-version').value = source.version; this.el<HTMLInputElement>('project-author').value = source.author; this.el<HTMLInputElement>('project-provenance').value = source.provenance; if (!source.parts.some(p => p.id === this.partId)) this.partId = source.parts[0]?.id ?? '';
    const options = (id: string, values: { value: string; text: string }[], selected: string) => { const select = this.el<HTMLSelectElement>(id); select.replaceChildren(...values.map(v => { const option = document.createElement('option'); option.value = v.value; option.textContent = v.text; return option; })); select.value = selected; };
    options('parts', source.parts.map(p => ({ value: p.id, text: `${p.name} · r${p.revision}` })), this.partId);
    const part = source.parts.find(p => p.id === this.partId);
    if (part) {
      this.layerIndex = Math.max(0, Math.min(this.layerIndex, part.artwork.layers.length - 1)); this.color = Math.max(0, Math.min(this.color, part.artwork.palette.length - 1));
      options('layers', part.artwork.layers.map((l, i) => ({ value: String(i), text: l.name })), String(this.layerIndex));
      options('palette', part.artwork.palette.map((c, i) => ({ value: String(i), text: `${i}: ${c}` })), String(this.color));
      const fields: Record<string, string | number> = { 'part-name': part.name, width: part.artwork.width, height: part.artwork.height, 'pivot-x': part.pivot[0], 'pivot-y': part.pivot[1], units: part.unitsPerPixel,
        'layer-name': part.artwork.layers[this.layerIndex]?.name ?? 'Ink', opacity: part.artwork.layers[this.layerIndex]?.opacity ?? 1, colour: part.artwork.palette[this.color]!.slice(0, 7), alpha: parseInt(part.artwork.palette[this.color]!.slice(7, 9), 16) };
      for (const [id, value] of Object.entries(fields)) this.el<HTMLInputElement>(id).value = String(value);
    } else { options('layers', [], ''); options('palette', [], ''); }
    this.el('state').textContent = `${this.draft.dirty ? 'Unsaved source edits' : 'Source unchanged'} · ${source.parts.length} parts · ${source.rigs.length} rigs · ${source.clips.length} clips`;
    this.el<HTMLButtonElement>('undo').disabled = !this.draft.canUndo; this.el<HTMLButtonElement>('redo').disabled = !this.draft.canRedo;
    this.draw();
    this.assembly.render();
    this.workspace.render();
  }
  draw() {
    const part = this.draft.source.parts.find(p => p.id === this.partId), stage = this.el('stage'); stage.hidden = !part; if (!part) return;
    const zoom = this.num('zoom'), a = part.artwork; this.canvas.width = a.width; this.canvas.height = a.height;
    const flat = rasterCanvas(part); this.canvas.getContext('2d')!.drawImage(flat, 0, 0); flat.width = flat.height = 0;
    stage.style.width = `${a.width * zoom}px`; stage.style.height = `${a.height * zoom}px`;
    this.el('grid-lines').hidden = !this.el<HTMLInputElement>('grid').checked; this.el('grid-lines').style.backgroundSize = `${zoom}px ${zoom}px`;
    const pivot = this.el('pivot-marker'); pivot.style.left = `${part.pivot[0] / part.unitsPerPixel * zoom}px`; pivot.style.top = `${(a.height - part.pivot[1] / part.unitsPerPixel) * zoom}px`;
    const selection = this.el('selection'); selection.hidden = !this.selection;
    if (this.selection) { const r = this.selection; Object.assign(selection.style, { left: `${r.x * zoom}px`, top: `${r.y * zoom}px`, width: `${r.width * zoom}px`, height: `${r.height * zoom}px` }); this.el('selected').textContent = `${r.x},${r.y} · ${r.width}×${r.height}`; }
    else this.el('selected').textContent = 'No selection';
  }
  private closeView() {
    this.dispose(); this.root.innerHTML = '<h1>Actor tools closed</h1><button id="reopen">Reopen editor</button>'; this.root.querySelector('#reopen')!.addEventListener('click', () => new ActorEditor(this.root), { once: true });
  }
  dispose() {
    if (this.disposed) return; this.cancelGesture(); this.assembly.dispose(); this.disposed = true; this.generation++; this.controller.abort();
    for (const [url, timer] of this.urls) { clearTimeout(timer); URL.revokeObjectURL(url); } this.urls.clear(); this.canvas.width = this.canvas.height = 0;
  }
}
new ActorEditor(document.getElementById('actor-tools')!);
