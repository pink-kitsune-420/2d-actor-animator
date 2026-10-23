import type { ActorNode, ActorProject, ActorTrackTarget, ActorTransform } from '@actor-animator/types';
import { identityTransform } from './editing';
import { restForTarget, sameTarget, setTwoKeyTrack } from './assembly';
import { ActorPreview } from './preview';
import { RigViewport } from './rig-viewport';
import type { ViewTool } from './viewport-math';
import { SkeletonControls } from './skeleton-panel';
import { AnimationPanel } from './animation-panel';
import { CelPanel, type CelHost } from './cel-panel';
import { EmotePanel } from './emote-panel';
import { keyedClipNames, setPoseKey, syncAnimationCapability, syncCelCapability } from '../../../../packages/actor-tools/src/index';

interface EditorHost extends CelHost {}

const components = ['x', 'y', 'rotation', 'scaleX', 'scaleY'] as const;
const labels = ['X', 'Y', 'Rotation (radians)', 'Scale X', 'Scale Y'];
function transformFields(prefix: string, label: string) {
  return `<fieldset class="transform"><legend id="${prefix}-legend">${label}</legend>${components.map((key, i) => `<label>${label} ${labels[i]}<input id="${prefix}-${key}" type="number" step="any" value="${i < 3 ? 0 : 1}"></label>`).join('')}</fieldset>`;
}

/** Host-local adapter over whole-project transactions. Selection is UI state;
 * IDs/references, all other tracks and inert extension data remain source data. */
export class AssemblyPanel {
  readonly preview: ActorPreview;
  readonly viewport: RigViewport;
  readonly skeleton: SkeletonControls;
  readonly animation: AnimationPanel;
  readonly cels: CelPanel;
  readonly emotes: EmotePanel;
  private rigId = '';
  private itemId = '';
  private clipId = '';
  private source: ActorProject | null = null;
  constructor(readonly root: HTMLElement, readonly host: EditorHost) {
    root.innerHTML = `<h2>Assembly and animation</h2><p>Names are free. Translation uses x-right/y-up project units; angles are unwrapped CCW radians. Sockets are cosmetic. Scene attachments work with no rig or nodes.</p>
      <div class="assembly-columns"><section id="rig-editor"><h3>Rig</h3><label>Rig<select id="rigs"></select></label><label>Rig name<input id="rig-name" value="My rig"></label><button id="add-rig">Create rig</button><button id="apply-rig">Rename rig</button><pre id="node-tree" aria-label="Node tree"></pre>
      <h3>Assembly item</h3><p>Rest changes the base shape. Pose writes a key into the selected clip at the preview time. Angles are CCW radians; positions use project units.</p><label>Item kind<select id="item-kind"><option value="node">Node</option><option value="socket">Cosmetic socket</option><option value="attachment">Part attachment</option></select></label>
      <label>Edit mode<select id="edit-mode"><option value="rest">Rest: edit source rest/transform</option><option value="pose">Pose: key the selected clip at the preview time</option></select></label>
      <label>Assembly item<select id="items"></select></label><p id="item-id" class="identity"></p><label>Item name<input id="item-name" value="New item"></label><label>Parent node<select id="parent-node"></select></label>
      ${transformFields('rest', 'Local rest')}<label>Draw order<input id="draw-order" type="number" value="0" step="1"></label>
      <button id="add-item">Create item</button><button id="apply-item">Apply name, draw order and transform</button><button id="item-earlier">Move earlier in source</button><p id="revision" class="identity"></p><button id="accept-part">Accept selected painted part revision</button><p>Editing attached artwork creates a new editable part. Existing attachments retain the accepted part until explicitly updated here.</p></section>
      <section id="skeleton" aria-label="Skeleton structure"></section>
      <section id="clip-editor"><h3>Clip settings</h3><label id="clip-choice">Clip<select id="clips"></select></label><label>Clip name<input id="clip-name" value="Two poses"></label><label>Duration (seconds)<input id="duration" type="number" step="any" min="0" value="2"></label><label>Playback<select id="playback"><option value="once">Once</option><option value="loop">Loop</option><option value="ping-pong">Ping-pong</option></select></label><button id="add-clip">Create clip</button><button id="apply-clip">Apply clip settings</button>
      <label>Animation target<select id="track-target"></select></label><label>Interpolation<select id="interpolation"><option value="linear">Linear</option><option value="step">Step</option></select></label><p id="track-info"></p>
      <details><summary>Two-key shortcut</summary><label>Key A time<input id="key-a-time" type="number" step="any" value="0"></label>${transformFields('key-a', 'Key A')}
      <label>Key B time<input id="key-b-time" type="number" step="any" value="2"></label>${transformFields('key-b', 'Key B')}
      <button id="apply-keys">Apply two keys</button><p>Complete local absolute transforms. Other tracks and clips stay intact. Tracks with more than two keys can be previewed; this small editor preserves them.</p></details></section></div>
      <div id="animation-panel"></div><div id="cel-panel"></div><div id="emote-panel"></div><section id="preview-panel" aria-label="Actor preview workspace"><h2>Preview</h2><p id="preview-help"></p><nav aria-label="Preview"><button id="play">Play clip</button><button id="pause">Pause</button><button id="rest">Show rest pose</button><button id="reset">Reset clip to start</button><label>Preview pixels per unit<select id="preview-zoom"><option>1</option><option>4</option><option selected>16</option><option>64</option><option>128</option></select></label></nav>
      <div id="rig-viewport-tools"><label>Viewport tool<select id="viewport-tool"><option value="move">Move transform (children follow)</option><option value="rotate">Rotate local transform</option><option value="joint">Move rest joint (preserve children)</option></select></label><p>Click joints, bones or artwork to select. Drag a pivot to move; Rotate uses the circle to its right. Alt-click cycles overlaps. Arrow keys move 1 CSS pixel; Shift moves 10. Escape cancels. Numeric controls remain available.</p><output id="viewport-status" role="status">Rest edits the base shape; Pose keys the selected clip. Positions: project units, x right / y up. Rotation: CCW radians.</output></div>
      <div class="preview-viewport"><canvas id="actor-preview" tabindex="0" width="640" height="400" aria-label="Actor preview"></canvas></div>
      <label>Scrub clip<input id="scrub" type="range" min="0" max="2" step="0.001" value="0"></label><label>Seek seconds<input id="seek-time" type="number" step="any" value="0"></label><button id="seek">Seek clip</button><output id="preview-state">Rest · 0 s</output></section>`;
    this.preview = new ActorPreview(this.el<HTMLCanvasElement>('actor-preview'), (time, playing) => {
      this.el<HTMLInputElement>('scrub').value = String(time);
      this.el('preview-state').textContent = `${this.el('actor-preview').dataset.clip === 'rest' ? 'Rest' : playing ? 'Playing' : 'Paused'} · ${time.toFixed(3)} s`;
      this.el('seek-time').setAttribute('placeholder', time.toFixed(3));
      this.skeleton?.status();
      this.animation?.timeline.time();
      this.animation?.curves.time();
    }, message => host.message(message));
    this.skeleton = new SkeletonControls(this.el('skeleton'), host, this.preview,
      () => ({ rigId: this.rigId, kind: this.value('item-kind') as 'node' | 'socket' | 'attachment', itemId: this.itemId }),
      (kind, id) => { this.el<HTMLSelectElement>('item-kind').value = kind; this.itemId = id; this.render(); });
    this.animation = new AnimationPanel(this.el('animation-panel'), host, this.preview, () => this.clipId, () => this.target(), () => this.render(), target => this.selectTarget(target), (id, time) => this.cels.selectKey(id, time));
    this.cels = new CelPanel(this.el('cel-panel'), host, this.preview, () => this.clipId, (id, time) => { const target = { kind: 'attachment' as const, attachmentId: id }; this.selectTarget(target); this.animation.timeline.selectPrecise('celTracks', target, time); this.animation.clearCurveSelection(); });
    this.emotes = new EmotePanel(this.el('emote-panel'), host, this.preview, () => this.clipId);
    this.viewport = new RigViewport(this.preview, host, {
      selection: () => ({ kind: this.value('item-kind') as 'node' | 'socket' | 'attachment', id: this.itemId, rigId: this.rigId }),
      select: s => { if (s.kind === 'node') this.selectTarget({ kind: 'node', rigId: s.rigId!, nodeId: s.id }); else if (s.kind === 'attachment') this.selectTarget({ kind: 'attachment', attachmentId: s.id }); else { this.el<HTMLSelectElement>('item-kind').value = s.kind; if (s.rigId) this.rigId = s.rigId; this.itemId = s.id; this.render(); } },
      intent: () => ({ mode: this.value('edit-mode') as 'rest' | 'pose', tool: this.value('viewport-tool') as ViewTool, clip: this.clipId || null, time: this.preview.clipTime() }),
      refresh: () => this.showTransform(),
    }, this.el('viewport-status'));
    const signal = host.controller.signal;
    const click = (id: string, action: () => void) => this.el(id).addEventListener('click', () => host.perform(() => { host.cancelGesture(); this.emotes.pause(); action(); }), { signal });
    const mutate = (action: (source: ActorProject) => void) => { host.draft.edit(s => { action(s); syncAnimationCapability(s); syncCelCapability(s); }); host.changed(); };
    click('add-rig', () => { const id = crypto.randomUUID(); mutate(s => s.rigs.push({ id, name: this.value('rig-name'), nodes: [], sockets: [] })); this.rigId = id; this.itemId = ''; this.render(); });
    click('apply-rig', () => mutate(s => { this.rig(s).name = this.value('rig-name'); }));
    click('add-item', () => {
      const kind = this.value('item-kind'), id = crypto.randomUUID(), name = this.value('item-name'), transform = this.transform('rest'), parentId = this.value('parent-node');
      mutate(s => {
        if (kind === 'node') this.rig(s).nodes.push({ id, name, parentId: parentId || null, rest: transform });
        else if (kind === 'socket') { if (!parentId) throw new Error('A cosmetic socket needs a parent node.'); this.rig(s).sockets.push({ id, name, nodeId: parentId, transform }); }
        else { const partId = host.part().id; s.attachments.push({ id, name, partId, drawOrder: this.num('draw-order'), transform, ...(parentId ? { rigId: this.rig(s).id, nodeId: parentId } : {}) }); }
      });
      this.itemId = id; this.render();
    });
    click('apply-item', () => {
      const pose = this.value('edit-mode') === 'pose', time = this.preview.clipTime(), name = this.value('item-name'), parent = this.value('parent-node'), transform = this.transform('rest');
      let note = '';
      mutate(s => {
        const item = this.item(s); if (!item) throw new Error('Create or select an item.');
        const current = 'rest' in item ? item.parentId ?? '' : 'partId' in item ? item.rigId === undefined ? '' : item.rigId === this.rigId ? item.nodeId! : null : item.nodeId;
        if (parent !== current) throw new Error('Use Reparent with an explicit preserve mode to change the parent.');
        item.name = name;
        if ('partId' in item) item.drawOrder = this.num('draw-order');
        const target: ActorTrackTarget | null = 'rest' in item ? { kind: 'node', rigId: this.rigId, nodeId: item.id } : 'partId' in item ? { kind: 'attachment', attachmentId: item.id } : null;
        if (pose) {
          if (!target) throw new Error('Sockets have no tracks; edit their transform in Rest mode.');
          if (!this.clipId || this.preview.clipId !== this.clipId) throw new Error('Select a clip and show it in the preview for pose editing.');
          note = `Pose key ${setPoseKey(s, this.clipId, target, time, transform, () => crypto.randomUUID())} at ${time} s; rest unchanged.`;
        } else {
          if ('rest' in item) item.rest = transform; else item.transform = transform;
          const keyed = target ? keyedClipNames(s, target) : [];
          note = keyed.length ? `Rest updated. Keyed in ${keyed.join(', ')}: those clips show their keys for this item.` : 'Rest updated.';
        }
      });
      host.message(note);
    });
    this.el('viewport-tool').addEventListener('change', () => this.viewport.refresh(), { signal });
    this.el('edit-mode').addEventListener('change', () => host.perform(() => {
      host.cancelGesture();
      if (this.value('edit-mode') === 'pose') { if (!this.clipId) { this.el<HTMLSelectElement>('edit-mode').value = 'rest'; throw new Error('Create or select a clip before pose editing.'); } this.preview.select(this.clipId); }
      else this.preview.rest();
      this.render();
    }), { signal });
    click('item-earlier', () => mutate(s => {
      const items = this.items(s), index = items.findIndex(i => i.id === this.itemId);
      if (index > 0) [items[index - 1], items[index]] = [items[index]!, items[index - 1]!];
    }));
    click('accept-part', () => mutate(s => {
      if (this.value('item-kind') !== 'attachment') throw new Error('Select a part attachment.');
      const attachment = s.attachments.find(a => a.id === this.itemId); if (!attachment) throw new Error('Select an attachment.');
      attachment.partId = host.part().id;
    }));
    click('add-clip', () => {
      const id = crypto.randomUUID(); mutate(s => s.clips.push({ id, name: this.value('clip-name'), duration: this.num('duration'), playback: this.playback(), tracks: [] }));
      this.clipId = id; this.render(); this.preview.select(id);
    });
    click('apply-clip', () => mutate(s => {
      const clip = s.clips.find(c => c.id === this.clipId); if (!clip) throw new Error('Create or select a clip.');
      clip.name = this.value('clip-name'); clip.duration = this.num('duration'); clip.playback = this.playback();
    }));
    click('apply-keys', () => mutate(s => setTwoKeyTrack(s, this.clipId, this.target(), this.value('interpolation') as 'step' | 'linear', [
      { time: this.num('key-a-time'), value: this.transform('key-a') }, { time: this.num('key-b-time'), value: this.transform('key-b') },
    ])));
    click('play', () => this.preview.play(this.clipId)); click('pause', () => this.preview.pause());
    click('rest', () => this.preview.rest()); click('reset', () => this.preview.reset(this.clipId));
    click('seek', () => { this.preview.select(this.clipId || null); this.preview.seek(this.num('seek-time')); this.showTransform(); });
    this.el('scrub').addEventListener('input', () => host.perform(() => { const time = this.num('scrub'); this.preview.select(this.clipId || null); this.preview.seek(time); this.showTransform(); }), { signal });
    this.el('preview-zoom').addEventListener('change', () => host.perform(() => { this.preview.zoom(this.num('preview-zoom')); this.viewport.refresh(); }), { signal });
    for (const id of ['rigs', 'item-kind', 'items', 'clips', 'track-target']) this.el(id).addEventListener('change', () => host.perform(() => {
      host.cancelGesture(); this.preview.pause();
      if (id === 'rigs') { this.rigId = this.value(id); this.itemId = ''; }
      if (id === 'item-kind') this.itemId = '';
      if (id === 'items') this.itemId = this.value(id);
      if ((id === 'items' || id === 'item-kind') && this.value('item-kind') === 'attachment') {
        const attachment = host.draft.source.attachments.find(a => a.id === this.itemId) ?? host.draft.source.attachments[0];
        if (attachment?.rigId) this.rigId = attachment.rigId;
      }
      if (id === 'clips') this.clipId = this.value(id);
      if (id === 'track-target') { this.selectTarget(this.target()); return; }
      this.render(); if (id === 'clips') this.preview.select(this.clipId || null);
    }), { signal });
  }
  private selectTarget(target: ActorTrackTarget) {
    this.el<HTMLSelectElement>('track-target').value = JSON.stringify(target);
    this.el<HTMLSelectElement>('item-kind').value = target.kind;
    if (target.kind === 'node') { this.rigId = target.rigId; this.itemId = target.nodeId; }
    else { this.itemId = target.attachmentId; const a = this.host.draft.source.attachments.find(a => a.id === target.attachmentId); if (a?.rigId) this.rigId = a.rigId; }
    this.render();
  }
  private el<T extends HTMLElement = HTMLElement>(id: string) { return this.root.querySelector<T>(`#${id}`)!; }
  private value(id: string) { return this.el<HTMLInputElement>(id).value; }
  private num(id: string) { const text = this.value(id), n = Number(text); if (!text.trim() || !Number.isFinite(n)) throw new Error('Enter a finite number.'); return n; }
  private transform(prefix: string): ActorTransform { return { x: this.num(`${prefix}-x`), y: this.num(`${prefix}-y`), rotation: this.num(`${prefix}-rotation`), scaleX: this.num(`${prefix}-scaleX`), scaleY: this.num(`${prefix}-scaleY`) }; }
  private writeTransform(prefix: string, transform: ActorTransform) { for (const key of components) this.el<HTMLInputElement>(`${prefix}-${key}`).value = Object.is(transform[key], -0) ? '-0' : String(transform[key]); }
  private playback() { return this.value('playback') as 'once' | 'loop' | 'ping-pong'; }
  private target(): ActorTrackTarget { const value = this.value('track-target'); if (!value) throw new Error('Create or select a node or attachment target.'); return JSON.parse(value) as ActorTrackTarget; }
  private rig(s = this.host.draft.source) { const rig = s.rigs.find(r => r.id === this.rigId); if (!rig) throw new Error('Create or select a rig.'); return rig; }
  private items(s = this.host.draft.source) {
    const kind = this.value('item-kind'); if (kind === 'attachment') return s.attachments;
    const rig = s.rigs.find(r => r.id === this.rigId); return kind === 'node' ? rig?.nodes ?? [] : rig?.sockets ?? [];
  }
  private item(s = this.host.draft.source) { return this.items(s).find(i => i.id === this.itemId); }
  /** Rest mode shows source; pose mode shows the evaluated local pose at the
   * preview time (including enabled constraints), which Apply keys. */
  private showTransform() {
    const item = this.item(), pose = this.value('edit-mode') === 'pose';
    this.el('rest-legend').textContent = pose ? `Local pose at ${this.preview.clipTime()} s (keys the selected clip)` : 'Local rest';
    if (!item) { this.writeTransform('rest', identityTransform()); return; }
    const kind = 'rest' in item ? 'node' : 'partId' in item ? 'attachment' : 'socket';
    const posed = pose && kind !== 'socket' ? this.preview.localTransform(kind, item.id, this.rigId) : null;
    this.writeTransform('rest', posed ?? ('rest' in item ? item.rest : item.transform));
  }
  private options(id: string, values: { id: string; name: string }[], selected: string) {
    const select = this.el<HTMLSelectElement>(id);
    select.replaceChildren(...values.map(value => { const option = document.createElement('option'); option.value = value.id; option.textContent = value.name; return option; }));
    select.value = values.some(v => v.id === selected) ? selected : values[0]?.id ?? '';
    return select.value;
  }
  /** Recompiles only after source identity changes; native input is never polled
   * or rewritten by the playback clock. All text uses textContent/DOM values. */
  render() {
    const source = this.host.draft.source, replaced = this.source !== source;
    if (replaced) { this.preview.sync(source); this.source = source; }
    this.rigId = this.options('rigs', source.rigs, this.rigId);
    const rig = source.rigs.find(r => r.id === this.rigId);
    if (rig) this.el<HTMLInputElement>('rig-name').value = rig.name;
    const children = new Map<string | null, ActorNode[]>();
    for (const node of rig?.nodes ?? []) {
      const siblings = children.get(node.parentId) ?? []; siblings.push(node); children.set(node.parentId, siblings);
    }
    const stack = [...(children.get(null) ?? [])].reverse().map(node => ({ node, depth: 0 })), lines: string[] = [];
    while (stack.length) {
      const { node, depth } = stack.pop()!; lines.push(`${'  '.repeat(depth)}${depth ? '↳ ' : ''}${node.name}`);
      const descendants = children.get(node.id) ?? [];
      for (let i = descendants.length - 1; i >= 0; i--) stack.push({ node: descendants[i]!, depth: depth + 1 });
    }
    this.el('node-tree').textContent = lines.join('\n') || 'No nodes. Scene attachments are available.';
    const items = this.items(); this.itemId = this.options('items', items.map(i => ({ id: i.id, name: 'parentId' in i ? `${i.parentId === null ? 'Root' : 'Child'} · ${i.name}` : i.name })), this.itemId);
    const item = this.item();
    this.options('parent-node', [{ id: '', name: 'Scene root (no node)' }, ...(rig?.nodes ?? []).map(n => ({ id: n.id, name: n.name }))],
      item ? 'parentId' in item ? item.parentId ?? '' : 'nodeId' in item ? item.nodeId ?? '' : '' : '');
    this.el('item-id').textContent = item ? `ID: ${item.id}` : 'No item selected';
    if (item) {
      this.el<HTMLInputElement>('item-name').value = item.name;
      this.el<HTMLInputElement>('draw-order').value = String('drawOrder' in item ? item.drawOrder : 0);
    }
    this.showTransform();
    const accepted = item && 'partId' in item ? source.parts.find(p => p.id === item.partId) : undefined;
    this.el('revision').textContent = accepted ? `Accepted: ${accepted.name} · r${accepted.revision} · ${accepted.id}` : 'Select a part attachment to see or update its accepted artwork.';
    this.el<HTMLButtonElement>('accept-part').disabled = !accepted;
    this.clipId = this.options('clips', source.clips, this.clipId);
    const clip = source.clips.find(c => c.id === this.clipId);
    if (clip) {
      this.el<HTMLInputElement>('clip-name').value = clip.name; this.el<HTMLInputElement>('duration').value = String(clip.duration);
      this.el<HTMLSelectElement>('playback').value = clip.playback; this.el<HTMLInputElement>('scrub').max = String(clip.duration);
    }
    const targets: { id: string; name: string }[] = [];
    for (const r of source.rigs) for (const n of r.nodes) targets.push({ id: JSON.stringify({ kind: 'node', rigId: r.id, nodeId: n.id }), name: `${r.name} / ${n.name}` });
    for (const a of source.attachments) targets.push({ id: JSON.stringify({ kind: 'attachment', attachmentId: a.id }), name: `Attachment / ${a.name}` });
    const target = this.options('track-target', targets, this.value('track-target'));
    const track = target ? clip?.tracks.find(t => sameTarget(t.target, this.target())) : undefined;
    const rich = track && (track.keys.length > 2 || track.angle !== undefined || track.keys.some(k => k.curve !== undefined || k.turns !== undefined));
    this.el('track-info').textContent = rich ? `${track.keys.length} keys retained. Preview supported; two-key editing is disabled for this track.` : track ? `${track.keys.length} authored keys · ${track.id}` : 'No track yet. Apply two keys to this target.';
    this.el<HTMLButtonElement>('apply-keys').disabled = !clip || !target || !!rich;
    if (target && !rich) {
      const rest = restForTarget(source, this.target());
      this.el<HTMLInputElement>('key-a-time').value = String(track?.keys[0]?.time ?? 0);
      this.el<HTMLInputElement>('key-b-time').value = String(track?.keys[1]?.time ?? clip?.duration ?? 2);
      this.writeTransform('key-a', track?.keys[0]?.value ?? rest); this.writeTransform('key-b', track?.keys[1]?.value ?? rest);
      this.el<HTMLSelectElement>('interpolation').value = track?.interpolation ?? 'linear';
    }
    for (const id of ['play', 'reset', 'seek']) this.el<HTMLButtonElement>(id).disabled = !clip;
    this.el<HTMLInputElement>('scrub').disabled = !clip;
    this.el('preview-help').textContent = !source.attachments.length ? 'No assembled artwork yet. In Rig, choose Part attachment and Create item. Scene attachments need no bones.' : !clip ? 'Artwork is ready. In Animate, name and create a clip; then play or scrub it here.' : 'Choose a clip, then play or drag the time slider. Show rest pose returns to the base shape.';
    this.skeleton.render(); this.animation.render(); this.cels.render(); this.emotes.render(); this.viewport.refresh();
  }
  pause() { this.preview.pause(); this.emotes.pause(); }
  dispose() { this.animation.curves.dispose(); this.animation.timeline.dispose(); this.viewport.dispose(); this.emotes.dispose(); this.cels.dispose(); this.preview.dispose(); }
}
