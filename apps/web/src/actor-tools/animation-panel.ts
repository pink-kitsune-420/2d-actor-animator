import type { ActorAnimator, ActorAnimatorLayer, ActorProject, ActorTrackTarget, ActorTransform, ActorCurve } from '@actor-animator/types';
import { ACTOR_CURVES, deleteActorClip, editTransformKey, syncAnimationCapability, syncCelCapability } from '../../../../packages/actor-tools/src';
import type { ActorDraft } from './editing';
import type { ActorPreview } from './preview';
import { restForTarget, sameTarget } from './assembly';
import { ActorTimeline } from './timeline';
import type { Channel, TimelineRow } from './timeline-model';

interface Host { draft: ActorDraft; controller: AbortController; perform(f: () => void): void; changed(): void; cancelGesture(): void; message(s: string): void }
const components = ['x', 'y', 'rotation', 'scaleX', 'scaleY'] as const;
const input = (id: string, label: string, value = 0) => `<label>${label}<input id="${id}" type="number" step="any" value="${value}"></label>`;
const select = (id: string, label: string, values: string[]) => `<label>${label}<select id="${id}">${values.map(v => `<option>${v}</option>`).join('')}</select></label>`;

/** Timeline/composition controls. Every source mutation uses the existing
 * whole-project draft; preview requests are local tool state, never events. */
export class AnimationPanel {
  readonly timeline: ActorTimeline;
  private animatorId = ''; private layerId = ''; private stateId = ''; private transitionId = '';
  private keyTime: number | undefined;
  private keyContext = '';
  private script: { time: number; layerId: string; stateId: string }[] = [];
  constructor(readonly root: HTMLElement, readonly host: Host, readonly preview: ActorPreview,
    readonly selectedClip: () => string, readonly selectedTarget: () => ActorTrackTarget,
    readonly refresh: () => void, readonly selectTarget: (target: ActorTrackTarget) => void, readonly selectCel: (attachmentId: string, time?: number) => void) {
    root.innerHTML = `<h2>Timeline</h2><p>Uses the clip and animation target above. Select an authored key to revise it, or “New key” to insert. Values are absolute local transforms.</p>
      <div id="visual-timeline"></div><nav><button id="duplicate-clip">Duplicate clip</button><button id="delete-clip">Delete clip</button></nav>
      ${select('key-channel', 'Channel', ['transform', 'visibility', 'draw-order'])}<label>Authored keys<select id="timeline-keys"></select></label><button id="new-key">New key</button>
      ${input('timeline-time', 'Key time (s)')}
      <div class="transform">${components.map((c, i) => input(`timeline-${c}`, c === 'rotation' ? 'Rotation (radians)' : c, i < 3 ? 0 : 1)).join('')}</div>
      ${select('key-curve', 'Outgoing curve', ['track-default', ...ACTOR_CURVES])}${select('key-angle', 'Track angle mode', ['legacy-unwrapped', 'unwrapped', 'shortest'])}
      <label>Cubic Bézier x1,y1,x2,y2<input id="key-bezier" value="0.42,0,0.58,1"></label>${input('key-turns', 'Extra full turns (shortest mode only)')}
      <label><input id="key-visible" type="checkbox" checked>Visible</label>${input('key-order', 'Painter order')}
      <nav><button id="write-key">Insert / revise key</button><button id="delete-key">Delete key</button><button id="previous-key">Previous key</button><button id="next-key">Next key</button><button id="step-back">−1/60 s</button><button id="step-forward">+1/60 s</button></nav>
      <pre id="timeline-summary"></pre>
      <details><summary>Composition: layers, states &amp; transitions</summary><h2>Composition</h2><p>Layers run bottom to top. Fades use shortest rotation arcs; additive layers use an explicit reference pose and ignore discrete channels. Incoming discrete values win at weight ≥ 0.5. Automatic next states require once clips and acyclic chains.</p>
      <div class="assembly-columns"><section><label>Animator<select id="animators"></select></label><label>Animator name<input id="animator-name" value="Locomotion"></label><button id="add-animator">Create animator</button><button id="rename-animator">Rename animator</button><button id="delete-animator">Delete animator</button>
      <label>Animation layer<select id="animator-layers"></select></label><label>Animation layer name<input id="layer-name-animation" value="Base"></label>
      ${select('layer-blend', 'Blend', ['override', 'additive'])}${input('layer-weight', 'Weight (0–1)', 1)}${input('layer-duration', 'Default fade (s)', .2)}${input('layer-priority', 'Default priority')}
      <label>Reference clip<select id="reference-clip"></select></label>${input('reference-time', 'Reference time (s)')}
      <label>Mask mode<select id="mask-mode"><option value="all">All slots</option><option value="selected">Selected slots (none = no effect)</option></select></label><label>Mask slots<select id="layer-mask" multiple size="6"></select></label><label><input id="mask-descendants" type="checkbox" checked>Include node descendants and carried artwork</label>
      <button id="add-animation-layer">Add animation layer</button><button id="apply-animation-layer">Apply animation layer</button><button id="layer-earlier">Move layer earlier</button><button id="delete-animation-layer">Delete animation layer</button></section>
      <section><label>State<select id="animation-states"></select></label><label>State name<input id="state-name" value="Idle"></label><label>State clip<select id="state-clip"></select></label>${input('state-rate', 'Playback rate', 1)}<label>Automatic next<select id="state-next"></select></label>
      <button id="add-animation-state">Add state</button><button id="apply-animation-state">Apply state</button><button id="initial-state">Make initial state</button><button id="delete-animation-state">Delete state</button>
      <label>Transition<select id="animation-transitions"></select></label><label>From<select id="transition-from"></select></label><label>To<select id="transition-to"></select></label>${input('transition-duration', 'Fade duration (s)', .2)}${input('transition-priority', 'Interrupt priority')}
      <button id="add-transition">Add transition</button><button id="apply-transition">Apply transition</button><button id="delete-transition">Delete transition</button></section></div>
      <h3>Scripted transition preview</h3><p>Append requests using the selected layer and state. Time is absolute seconds from preview origin. Equal times keep entry order. Scrubbing emits no requests.</p>
      ${input('request-time', 'Request time (s)')}<button id="append-request">Append selected state request</button><button id="clear-requests">Clear requests</button><pre id="request-script"></pre>
      <nav><button id="preview-animator">Show animator</button><button id="play-animator">Play animator</button><button id="seek-animator">Seek animator</button>${input('animator-time', 'Animator seek time (s)')}</nav>
      <label>Scrub animator (0–10 s)<input id="animator-scrub" type="range" min="0" max="10" step="0.001" value="0"></label><output id="composition-status"></output></details><details><summary>Preview aids: speed, grid &amp; onion skins</summary><h3>Preview aids</h3><nav>${input('preview-speed', 'Preview speed', 1)}${input('preview-grid', 'Grid spacing (project units; 0 disables)')}${input('preview-origin-y', 'View centre Y (project units)')}
      <label><input id="onion" type="checkbox">Onion skins ±1/12 s</label><label><input id="preview-markers" type="checkbox" checked>Show joints</label><button id="apply-preview-aids">Apply preview aids</button></nav></details>`;
    this.timeline = new ActorTimeline(this.el('visual-timeline'), host, preview, { clip: selectedClip, target: selectedTarget, select: (row, time) => this.selectRow(row, time) });
    const signal = host.controller.signal;
    const click = (id: string, fn: () => void) => this.el(id).addEventListener('click', () => host.perform(() => { host.cancelGesture(); preview.pause(); fn(); }), { signal });
    const edit = (fn: (s: ActorProject) => void) => { host.draft.edit(s => { fn(s); syncAnimationCapability(s); syncCelCapability(s); }); host.changed(); };
    for (const id of ['animators', 'animator-layers', 'animation-states', 'animation-transitions', 'key-channel']) this.el(id).addEventListener('change', () => host.perform(() => {
      preview.pause(); if (id === 'animators') { this.animatorId = this.value(id); this.script = []; }
      if (id === 'animator-layers') this.layerId = this.value(id);
      if (id === 'animation-states') this.stateId = this.value(id);
      if (id === 'animation-transitions') this.transitionId = this.value(id);
      this.keyTime = undefined; this.render(); this.syncPrecise();
    }), { signal });
    this.el('timeline-keys').addEventListener('change', () => host.perform(() => { this.keyTime = this.value('timeline-keys') === '' ? undefined : this.num('timeline-keys'); this.showKey(); this.syncPrecise(); }), { signal });
    click('new-key', () => { this.keyTime = undefined; this.showKey(); this.syncPrecise(); });
    click('write-key', () => {
      const time = this.num('timeline-time'), previous = this.keyTime ?? time, channel = this.value('key-channel'), target = this.selectedTarget();
      edit(s => {
        const clip = s.clips.find(c => c.id === selectedClip()); if (!clip) throw new Error('Select a clip.');
        if (channel === 'transform') {
          const value = Object.fromEntries(components.map(c => [c, this.num(`timeline-${c}`)])) as unknown as ActorTransform;
          const curve = this.value('key-curve'), angle = this.value('key-angle');
          const turns = this.num('key-turns');
          if (angle !== 'shortest' && turns !== 0) throw new Error('Extra turns require shortest angle mode.');
          editTransformKey(s, clip.id, target, { time, value, ...(curve === 'track-default' ? {} : { curve: curve as ActorCurve }), ...(curve === 'cubic-bezier' ? { bezier: this.value('key-bezier').split(',').map(Number) as [number, number, number, number] } : {}), ...(angle === 'shortest' && turns !== 0 ? { turns } : {}) }, angle === 'legacy-unwrapped' ? undefined : angle as 'unwrapped' | 'shortest', () => crypto.randomUUID(), previous);
        } else {
          if (channel === 'draw-order' && target.kind !== 'attachment') throw new Error('Painter order needs an attachment target.');
          const field = channel === 'visibility' ? 'visibilityTracks' : 'drawOrderTracks';
          // The branch below keeps the public discriminated track types intact.
          if (field === 'visibilityTracks') {
            clip.visibilityTracks ??= []; let t = clip.visibilityTracks.find(t => sameTarget(t.target, target));
            if (!t) { t = { id: crypto.randomUUID(), target, keys: [] }; clip.visibilityTracks.push(t); }
            if (time !== previous && t.keys.some(k => k.time === time)) throw new Error('A key already exists at the destination time.');
            t.keys = t.keys.filter(k => k.time !== previous); t.keys.push({ time, visible: this.el<HTMLInputElement>('key-visible').checked }); t.keys.sort((a, b) => a.time - b.time);
          } else if (target.kind === 'attachment') {
            clip.drawOrderTracks ??= []; let t = clip.drawOrderTracks.find(t => sameTarget(t.target, target));
            if (!t) { t = { id: crypto.randomUUID(), target, keys: [] }; clip.drawOrderTracks.push(t); }
            if (time !== previous && t.keys.some(k => k.time === time)) throw new Error('A key already exists at the destination time.');
            t.keys = t.keys.filter(k => k.time !== previous); t.keys.push({ time, drawOrder: this.num('key-order') }); t.keys.sort((a, b) => a.time - b.time);
          }
        }
      }); this.keyTime = time; this.render(); this.syncPrecise(); preview.select(selectedClip()); preview.seek(time);
    });
    click('delete-key', () => edit(s => {
      const c = s.clips.find(c => c.id === selectedClip()); if (!c || this.keyTime === undefined) throw new Error('Select an authored key.');
      for (const field of [this.value('key-channel') === 'transform' ? 'tracks' : this.value('key-channel') === 'visibility' ? 'visibilityTracks' : 'drawOrderTracks'] as const) {
        const tracks = c[field]; if (!tracks) continue;
        for (const t of tracks) if (sameTarget(t.target, selectedTarget())) t.keys = t.keys.filter(k => k.time !== this.keyTime) as typeof t.keys;
        // Retain the separate arrays' static types while removing empty tracks.
        if (field === 'tracks') c.tracks = c.tracks.filter(t => t.keys.length);
        if (field === 'visibilityTracks') c.visibilityTracks = c.visibilityTracks?.filter(t => t.keys.length);
        if (field === 'drawOrderTracks') c.drawOrderTracks = c.drawOrderTracks?.filter(t => t.keys.length);
      }
      this.keyTime = undefined;
    }));
    for (const direction of [-1, 1]) {
      click(direction < 0 ? 'step-back' : 'step-forward', () => preview.seek(preview.currentTime + direction / 60));
      click(direction < 0 ? 'previous-key' : 'next-key', () => { const keys = this.track()?.keys ?? [], time = preview.clipTime(); const k = direction < 0 ? [...keys].reverse().find(k => k.time < time) : keys.find(k => k.time > time); if (k) { preview.select(selectedClip()); preview.seek(k.time); this.keyTime = k.time; this.showKey(); this.syncPrecise(); } });
    }
    click('duplicate-clip', () => { edit(s => { const c = s.clips.find(c => c.id === selectedClip()); if (!c) throw new Error('Select a clip.'); const copy = structuredClone(c); copy.id = crypto.randomUUID(); copy.name += ' copy'; s.clips.push(copy); }); });
    click('delete-clip', () => edit(s => deleteActorClip(s, selectedClip())));
    click('add-animator', () => { const id = crypto.randomUUID(); edit(s => { (s.animators ??= []).push({ id, name: this.value('animator-name'), layers: [] }); }); this.animatorId = id; this.render(); });
    click('rename-animator', () => edit(s => { this.animator(s).name = this.value('animator-name'); }));
    click('delete-animator', () => edit(s => { s.animators = s.animators?.filter(a => a.id !== this.animatorId); this.script = []; }));
    click('add-animation-layer', () => {
      const id = crypto.randomUUID(), stateId = crypto.randomUUID(); edit(s => this.animator(s).layers.push({ id, name: this.value('layer-name-animation'), blend: 'override', weight: 1, initialStateId: stateId, defaultTransition: { duration: .2, priority: 0 }, states: [{ id: stateId, name: 'Rest', clipId: null, rate: 1 }], transitions: [] })); this.layerId = id; this.stateId = stateId; this.render();
    });
    click('apply-animation-layer', () => edit(s => {
      const l = this.layer(s); l.name = this.value('layer-name-animation'); l.blend = this.value('layer-blend') as typeof l.blend; l.weight = this.num('layer-weight'); l.defaultTransition = { duration: this.num('layer-duration'), priority: this.num('layer-priority') };
      if (l.blend === 'additive') l.reference = { clipId: this.value('reference-clip'), time: this.num('reference-time') }; else delete l.reference;
      if (this.value('mask-mode') === 'all') delete l.mask;
      else l.mask = [...this.el<HTMLSelectElement>('layer-mask').selectedOptions].map(o => { const t = JSON.parse(o.value) as ActorTrackTarget; return t.kind === 'node' ? { ...t, descendants: this.el<HTMLInputElement>('mask-descendants').checked } : t; });
    }));
    click('layer-earlier', () => edit(s => { const a = this.animator(s), i = a.layers.findIndex(l => l.id === this.layerId); if (i > 0) [a.layers[i - 1], a.layers[i]] = [a.layers[i]!, a.layers[i - 1]!]; }));
    click('delete-animation-layer', () => edit(s => { const a = this.animator(s); a.layers = a.layers.filter(l => l.id !== this.layerId); this.script = this.script.filter(r => r.layerId !== this.layerId); }));
    click('add-animation-state', () => { const id = crypto.randomUUID(); edit(s => this.layer(s).states.push({ id, name: this.value('state-name'), clipId: this.value('state-clip') || null, rate: this.num('state-rate') })); this.stateId = id; this.render(); });
    click('apply-animation-state', () => edit(s => { const st = this.layer(s).states.find(st => st.id === this.stateId); if (!st) throw new Error('Select a state.'); st.name = this.value('state-name'); st.clipId = this.value('state-clip') || null; st.rate = this.num('state-rate'); if (this.value('state-next')) st.next = this.value('state-next'); else delete st.next; }));
    click('initial-state', () => edit(s => { this.layer(s).initialStateId = this.stateId; }));
    click('delete-animation-state', () => edit(s => {
      const l = this.layer(s); if (l.initialStateId === this.stateId || l.states.some(st => st.next === this.stateId) || l.transitions.some(t => t.from === this.stateId || t.to === this.stateId)) throw new Error('Remove initial, next and transition references before deleting this state.');
      l.states = l.states.filter(st => st.id !== this.stateId); this.script = this.script.filter(r => r.layerId !== l.id || r.stateId !== this.stateId);
    }));
    const transition = () => ({ from: this.value('transition-from') || null, to: this.value('transition-to'), duration: this.num('transition-duration'), priority: this.num('transition-priority') });
    click('add-transition', () => { const id = crypto.randomUUID(); edit(s => this.layer(s).transitions.push({ id, ...transition() })); this.transitionId = id; this.render(); });
    click('apply-transition', () => edit(s => { const t = this.layer(s).transitions.find(t => t.id === this.transitionId); if (!t) throw new Error('Select a transition.'); Object.assign(t, transition()); }));
    click('delete-transition', () => edit(s => { const l = this.layer(s); l.transitions = l.transitions.filter(t => t.id !== this.transitionId); }));
    click('append-request', () => { const time = this.num('request-time'); if (time < 0 || time < (this.script.at(-1)?.time ?? 0)) throw new Error('Append requests in non-decreasing time from zero.'); this.layer(); this.script.push({ time, layerId: this.layerId, stateId: this.stateId }); this.render(); });
    click('clear-requests', () => { this.script = []; this.render(); });
    const configure = () => { const a = this.animator(); const valid = this.script.filter(r => a.layers.some(l => l.id === r.layerId && l.states.some(s => s.id === r.stateId))); preview.configureAnimator(a.id, valid); this.el('composition-status').textContent = preview.animationStatus(this.num('animator-time')); };
    this.el('animator-scrub').addEventListener('input', () => host.perform(() => { this.set('animator-time', this.num('animator-scrub')); configure(); preview.seek(this.num('animator-time')); }), { signal });
    click('preview-animator', () => { configure(); preview.seek(0); });
    click('seek-animator', () => { configure(); preview.seek(this.num('animator-time')); });
    click('play-animator', () => { configure(); preview.playAnimation(); });
    click('apply-preview-aids', () => { preview.aids(this.num('preview-speed'), this.num('preview-grid'), this.el<HTMLInputElement>('onion').checked, this.el<HTMLInputElement>('preview-markers').checked, this.num('preview-origin-y'));  });
  }
  private el<T extends HTMLElement = HTMLElement>(id: string) { return this.root.querySelector<T>(`#${id}`)!; }
  private value(id: string) { return this.el<HTMLInputElement>(id).value; }
  private num(id: string) { const t = this.value(id), n = Number(t); if (!t.trim() || !Number.isFinite(n)) throw new Error('Enter a finite number.'); return n; }
  private set(id: string, value: unknown) { this.el<HTMLInputElement>(id).value = String(value); }
  private options(id: string, entries: { id: string; name: string }[], selected: string) {
    const el = this.el<HTMLSelectElement>(id); el.replaceChildren(...entries.map(e => { const o = document.createElement('option'); o.value = e.id; o.textContent = e.name; return o; })); el.value = entries.some(e => e.id === selected) ? selected : entries[0]?.id ?? ''; return el.value;
  }
  private animator(s = this.host.draft.source): ActorAnimator { const a = s.animators?.find(a => a.id === this.animatorId); if (!a) throw new Error('Create or select an animator.'); return a; }
  private layer(s = this.host.draft.source): ActorAnimatorLayer { const l = this.animator(s).layers.find(l => l.id === this.layerId); if (!l) throw new Error('Create or select a layer.'); return l; }
  private selectRow(row: TimelineRow, time?: number) {
    this.selectTarget(row.target);
    if (row.channel === 'celTracks') { if (row.target.kind === 'attachment') this.selectCel(row.target.attachmentId, time); }
    else {
      this.set('key-channel', row.channel === 'tracks' ? 'transform' : row.channel === 'visibilityTracks' ? 'visibility' : 'draw-order');
      this.render(); this.keyTime = time; this.showKey();
      this.set('timeline-keys', time === undefined ? '' : time);
    }
  }
  private syncPrecise() { let target: ActorTrackTarget; try { target = this.selectedTarget(); } catch { return; }
    const channel: Channel = this.value('key-channel') === 'transform' ? 'tracks' : this.value('key-channel') === 'visibility' ? 'visibilityTracks' : 'drawOrderTracks';
    this.timeline.selectPrecise(channel, target, this.keyTime);
  }
  private track() { const c = this.host.draft.source.clips.find(c => c.id === this.selectedClip()); let target: ActorTrackTarget; try { target = this.selectedTarget(); } catch { return; } return (this.value('key-channel') === 'transform' ? c?.tracks : this.value('key-channel') === 'visibility' ? c?.visibilityTracks : c?.drawOrderTracks)?.find(t => sameTarget(t.target, target)); }
  private showKey() {
    const k = this.track()?.keys.find(k => k.time === this.keyTime); this.set('timeline-time', k?.time ?? this.preview.clipTime());
    let value: ActorTransform | undefined; try { value = restForTarget(this.host.draft.source, this.selectedTarget()); } catch { /* no targets */ }
    if (k && 'value' in k) value = k.value;
    if (value) for (const c of components) this.set(`timeline-${c}`, value[c]);
    this.set('key-curve', k && 'curve' in k ? k.curve ?? 'track-default' : 'track-default');
    this.set('key-turns', k && 'turns' in k ? k.turns ?? 0 : 0);
    this.set('key-bezier', k && 'bezier' in k ? k.bezier?.join(',') ?? '0.42,0,0.58,1' : '0.42,0,0.58,1');
    const t = this.track(); this.set('key-angle', t && 'angle' in t ? t.angle ?? 'legacy-unwrapped' : 'legacy-unwrapped');
    this.el<HTMLInputElement>('key-visible').checked = k && 'visible' in k ? k.visible : true; this.set('key-order', k && 'drawOrder' in k ? k.drawOrder : 0);
  }
  render() {
    let targetKey = ''; try { targetKey = JSON.stringify(this.selectedTarget()); } catch { /* empty */ }
    const context = this.selectedClip() + this.value('key-channel') + targetKey; if (context !== this.keyContext) { this.keyTime = undefined; this.keyContext = context; }
    this.timeline.render();
    const s = this.host.draft.source, track = this.track();
    this.options('timeline-keys', [{ id: '', name: 'New key' }, ...(track?.keys ?? []).map(k => ({ id: String(k.time), name: `${k.time} s` }))], this.keyTime === undefined ? '' : String(this.keyTime));
    this.el('timeline-summary').textContent = (track?.keys ?? []).map(k => `${k.time} s${'curve' in k ? ` · ${k.curve ?? 'track default'}` : ''}`).join(' → ') || 'No keys for this target/channel.';
    this.showKey();
    this.animatorId = this.options('animators', s.animators ?? [], this.animatorId); const a = s.animators?.find(a => a.id === this.animatorId);
    this.layerId = this.options('animator-layers', a?.layers ?? [], this.layerId); const l = a?.layers.find(l => l.id === this.layerId);
    if (a) this.set('animator-name', a.name);
    this.options('reference-clip', s.clips, l?.reference?.clipId ?? '');
    this.options('state-clip', [{ id: '', name: 'Pass through' }, ...s.clips], '');
    this.stateId = this.options('animation-states', l?.states ?? [], this.stateId); const st = l?.states.find(st => st.id === this.stateId);
    this.options('state-next', [{ id: '', name: 'None' }, ...(l?.states ?? [])], st?.next ?? '');
    if (st) { this.set('state-name', st.name); this.set('state-clip', st.clipId ?? ''); this.set('state-rate', st.rate); }
    this.options('transition-from', [{ id: '', name: 'Any state' }, ...(l?.states ?? [])], ''); this.options('transition-to', l?.states ?? [], '');
    this.transitionId = this.options('animation-transitions', (l?.transitions ?? []).map(t => ({ id: t.id, name: `${l?.states.find(s => s.id === t.from)?.name ?? '*'} → ${l?.states.find(s => s.id === t.to)?.name}` })), this.transitionId);
    const tr = l?.transitions.find(t => t.id === this.transitionId); if (tr) { this.set('transition-from', tr.from ?? ''); this.set('transition-to', tr.to); this.set('transition-duration', tr.duration); this.set('transition-priority', tr.priority); }
    const entries = [...s.rigs.flatMap(r => r.nodes.map(n => ({ id: JSON.stringify({ kind: 'node', rigId: r.id, nodeId: n.id }), name: `${r.name}/${n.name}` }))), ...s.attachments.map(a => ({ id: JSON.stringify({ kind: 'attachment', attachmentId: a.id }), name: `Attachment/${a.name}` }))];
    this.options('layer-mask', entries, '');
    if (l) {
      this.set('layer-name-animation', l.name); this.set('layer-blend', l.blend); this.set('layer-weight', l.weight); this.set('layer-duration', l.defaultTransition.duration); this.set('layer-priority', l.defaultTransition.priority); this.set('reference-time', l.reference?.time ?? 0); this.set('mask-mode', l.mask ? 'selected' : 'all');
      for (const o of this.el<HTMLSelectElement>('layer-mask').options) o.selected = !!l.mask?.some(m => sameTarget(m, JSON.parse(o.value)));
      this.el<HTMLInputElement>('mask-descendants').checked = l.mask?.filter(m => m.kind === 'node').every(m => m.descendants) ?? true;
    }
    this.el('request-script').textContent = this.script.map(r => `${r.time}s · ${a?.layers.find(l => l.id === r.layerId)?.name ?? r.layerId} → ${a?.layers.flatMap(l => l.states).find(s => s.id === r.stateId)?.name ?? r.stateId}`).join('\n') || 'No requests. Initial states play from zero.';
  }
}
