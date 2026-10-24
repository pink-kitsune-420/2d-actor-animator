import type { ActorEditor } from './main';
import { RECOVERY_KEY } from './editing';
import { FocusedSections } from './focused-sections';

type Task = 'parts' | 'rig' | 'animate' | 'emotes' | 'all';
const tasks: { id: Task; label: string; help: string }[] = [
  { id: 'parts', label: 'Parts', help: 'A part is a piece of artwork. Paint it here; use Part setup to create or resize it. Attach it to your actor in Rig.' },
  { id: 'rig', label: 'Rig', help: 'A rig is a hierarchy of joints that move together. Item edits the selection; Hierarchy shows the structure. Artwork accepts painted revisions.' },
  { id: 'animate', label: 'Animate', help: 'A clip is a named motion. A key saves an item’s pose at a time in seconds. Create a clip in Clips, record poses in Keys, or retime them in Timeline.' },
  { id: 'emotes', label: 'Emotes', help: 'Preview a solo gesture or two roles on one clock. Expand the definition to author your own roles and mappings.' },
  { id: 'all', label: 'All tools', help: 'Expanded workspace for precise editing. Parts, rig, animation and emotes share one source and one Undo history.' },
];

/** Presentation-only navigation. Controls remain inside their owning panel root;
 * changing tasks never recompiles, serializes or edits the draft. */
export class ActorWorkspace {
  private task: Task = 'parts';
  private expanded = false;
  private readonly expandButton: HTMLButtonElement;
  private readonly panels = new Map<Task, HTMLElement>();
  private readonly buttons = new Map<Task, HTMLButtonElement>();
  private readonly sections = new Map<Task, FocusedSections>();
  private readonly disclosures = new Map<HTMLDetailsElement, boolean>();
  constructor(readonly root: HTMLElement, readonly host: ActorEditor) {
    const el = (id: string) => host.el(id);
    const guide = document.createElement('dialog'); guide.id = 'creator-guide';
    guide.setAttribute('aria-labelledby', 'guide-title');
    guide.innerHTML = `<h2 id="guide-title">Create your first animation</h2><form method="dialog"><button autofocus>Close help</button></form>
      <ol><li><strong>Projects:</strong> choose Empty project, Open source, or Example: classic astronaut under Examples.</li>
      <li><strong>Parts → Part setup:</strong> name a part and choose Create part. Choose Paint to work on it. Click a swatch or choose Paint color, then paint. Eraser removes pixels. Edit existing colors is for deliberate recoloring and exact transparency.</li>
      <li><strong>Rig:</strong> create a rig in Hierarchy and joints in Item, or attach a part directly to the scene with no bones. Rest edits the base shape; Pose keys the selected clip. Numeric transforms are available beside the viewport.</li>
      <li><strong>Animate:</strong> create a motion in Clips, then select a target and insert timed poses in Keys. Play and scrub in Preview. Emotes previews solo or paired gestures on a separate clock.</li>
      <li><strong>Keep your original:</strong> Download editable source saves every layer, rig and clip as .actorproject. Reopen with Projects → Open source. Confirm “I retained this source” only after keeping the current file.</li>
      <li><strong>Export:</strong> Animate → Cels &amp; export → Cels &amp; flipbooks → Flattened sheet and PNG. Prepare the sheet, then download both PNG and metadata. These are lossy copies; keep the editable source too.</li></ol>
      <h3>Rigging in plain language</h3><p>A part is painted artwork. A joint (called a Node in Item kind) is a pivot that carries its children. The line between joints is a bone. An attachment places artwork on a joint or directly in the scene. A socket is a cosmetic marker. A rig groups joints; you can animate artwork without any bones.</p><p>Rest is the starting shape. Pose saves a key in a clip at the preview time. A clip is a named motion; keys are saved poses that the software blends between. A curve controls how quickly that blend happens.</p>
      <h3>Try one small motion</h3><p>Load the example, choose Rig → Item, then select a joint in the canvas. Select a clip and choose Pose. Seek to a time and drag the joint to record a key. Play the clip; Undo reverses the edit. For a new actor, use Parts → Part setup, then Rig → Item → Part attachment → Create item.</p>
      <h3>Shortcuts &amp; units</h3><p>Tab / Shift+Tab moves between controls; Enter / Space activates buttons. On painting, rig and timeline surfaces, Ctrl/Cmd+Z undoes and Ctrl/Cmd+Shift+Z redoes. Text fields keep native text undo. Escape cancels a gesture; outside the rig canvas it restores an expanded view. Arrow keys scrub a focused time slider. Numeric fields provide precise transforms and key times; painting and rectangle selection require a pointer.</p>
      <p>Scene X points right, Y up; rotations use counterclockwise radians and clip times use seconds. Artwork dimensions and selection moves use pixels, with pixel Y down.</p>
      <h3>Local files &amp; recovery</h3><p>Project files are processed in your browser. Recovery is best effort, namespaced browser storage, shared across tabs on this origin; it is not a file backup or cloud sync. The hosted app loads its code from the site. The separate offline HTML needs no network. Download source before clearing browser data, changing browsers or closing unsaved work.</p>`;
    root.append(guide);
    el('getting-started').addEventListener('click', () => {
      host.cancelGesture(); host.assembly.pause(); guide.showModal();
    }, { signal: host.controller.signal });
    root.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || guide.open) return;
      for (const id of ['project-library', 'project-options', 'rig-view-help']) {
        const details = el(id) as HTMLDetailsElement;
        if (details.open && details.contains(document.activeElement)) {
          details.open = false; details.querySelector('summary')!.focus(); event.preventDefault(); return;
        }
      }
    }, { signal: host.controller.signal });
    const projects = el('project-library') as HTMLDetailsElement;
    const closeProjects = (focus = false) => {
      projects.open = false;
      if (focus) projects.querySelector('summary')!.focus({ preventScroll: true });
    };
    projects.addEventListener('click', event => {
      if (event.target instanceof Element && event.target.closest('button')) closeProjects(true);
    }, { signal: host.controller.signal });
    el('open').addEventListener('change', () => closeProjects(true), { signal: host.controller.signal });
    document.addEventListener('pointerdown', event => {
      if (projects.open && event.target instanceof Node && !projects.contains(event.target)) closeProjects();
    }, { signal: host.controller.signal });
    const assembly = el('assembly');
    const layout = root.querySelector<HTMLElement>('.layout')!;
    const aside = layout.querySelector('aside')!;
    const painter = layout.lastElementChild!;
    root.append(assembly);
    // Remove the old sequential workspace introduction; task help replaces it.
    assembly.querySelector(':scope > h2')!.remove();
    assembly.querySelector(':scope > p')!.remove();
    assembly.insertAdjacentHTML('afterbegin', `<nav aria-label="Authoring tasks" id="task-navigation"></nav><p id="task-help"></p><div id="next-step"><span></span><button type="button" id="next-step-action"></button></div><p id="selection-context"></p><div id="workspace-body"><div id="workspace-inspectors"></div></div>`);
    const body = el('workspace-body'), inspectors = el('workspace-inspectors');
    const panel = (id: Task, label: string) => {
      const p = document.createElement('section'); p.id = `task-${id}`; p.setAttribute('aria-label', `${label} tools`);
      inspectors.append(p); this.panels.set(id, p); return p;
    };
    const parts = panel('parts', 'Parts'); parts.className = 'parts-workspace'; parts.append(aside, painter);
    layout.remove();
    const rig = panel('rig', 'Rig'); rig.append(el('rig-editor'));
    const advanced = document.createElement('details');
    const summary = document.createElement('summary'); summary.textContent = 'Structure, joints & constraints';
    advanced.append(summary, el('skeleton')); rig.append(advanced);
    const animate = panel('animate', 'Animate'); animate.append(el('animation-panel'), el('clip-editor'), el('cel-panel'));
    // Hide sections in place: each owning panel keeps its controls and listeners.
    advanced.dataset.workspaceSection = 'advanced';
    const rigSelection = document.createElement('div'); rigSelection.className = 'rig-selection';
    el('rig-editor').prepend(rigSelection); rigSelection.append(el('rigs').closest('label')!, el('item-kind').closest('label')!, el('items').closest('label')!);
    el('rest-x').closest('fieldset')!.append(el('draw-order').closest('label')!);
    const itemNames = document.createElement('div'); itemNames.className = 'pair';
    el('item-name').closest('label')!.before(itemNames); itemNames.append(el('item-name').closest('label')!, el('parent-node').closest('label')!);
    for (const child of el('animation-panel').children) (child as HTMLElement).dataset.workspaceSection = 'keys';
    el('visual-timeline').dataset.workspaceSection = 'timeline';
    el('curve-editor').dataset.workspaceSection = 'curves';
    el('timeline-keys').closest('.key-selection-row')!.setAttribute('data-workspace-section', 'keys curves');
    el('animators').closest('details')!.dataset.workspaceSection = 'compose';
    el('duplicate-clip').parentElement!.dataset.workspaceSection = 'clips';
    el('clip-editor').dataset.workspaceSection = 'clips'; el('cel-panel').dataset.workspaceSection = 'cels';
    el('track-info').dataset.workspaceSection = 'clips';
    el('animation-panel').prepend(el('track-target').closest('label')!, el('track-info'));
    const curveHint = document.createElement('p'); curveHint.className = 'section-hint';
    curveHint.textContent = 'Choose a transform key above or in Timeline, then adjust how it blends into the next pose. The last key has no next pose.';
    el('curve-editor').prepend(curveHint);
    this.sections.set('parts', new FocusedSections(parts, inspectors, host, [
      { id: 'paint', label: 'Paint' }, { id: 'setup', label: 'Part setup' }, { id: 'layers', label: 'Layers' }, { id: 'files', label: 'PNG files' },
    ], 'Parts'));
    this.sections.set('rig', new FocusedSections(rig, inspectors, host, [
      { id: 'item', label: 'Item' }, { id: 'hierarchy', label: 'Hierarchy' }, { id: 'artwork', label: 'Artwork' }, { id: 'advanced', label: 'Advanced' },
    ], 'Rig'));
    this.sections.set('animate', new FocusedSections(animate, inspectors, host, [
      { id: 'keys', label: 'Keys' }, { id: 'timeline', label: 'Timeline' }, { id: 'clips', label: 'Clips' }, { id: 'curves', label: 'Curves' }, { id: 'compose', label: 'Compose' }, { id: 'cels', label: 'Cels & export' },
    ], 'Animate'));
    el('next-step-action').addEventListener('click', () => {
      const source = host.draft.source;
      if (!source.parts.length) { this.activate('parts'); this.sections.get('parts')!.show('setup'); el('part-name').focus(); }
      else if (!source.attachments.length) { this.activate('rig'); this.sections.get('rig')!.show('item'); host.el<HTMLSelectElement>('item-kind').value = 'attachment'; el('item-kind').dispatchEvent(new Event('change', { bubbles: true })); el('item-name').focus(); }
      else { this.activate('animate'); this.sections.get('animate')!.show('clips'); el('clip-name').focus(); }
    }, { signal: host.controller.signal });
    assembly.querySelector(':scope > .assembly-columns')!.remove();
    body.prepend(el('preview-panel'));
    el('preview-panel').querySelector('h2')!.after(el('clip-choice'));
    const preview = el('preview-panel');
    const previewHeader = document.createElement('div'); previewHeader.id = 'preview-header';
    this.expandButton = document.createElement('button'); this.expandButton.id = 'expand-rig-view';
    this.expandButton.type = 'button'; this.expandButton.setAttribute('aria-controls', 'preview-panel');
    preview.prepend(previewHeader); previewHeader.append(preview.querySelector('h2')!, el('preview-state'), this.expandButton);
    const selectors = document.createElement('div'); selectors.id = 'preview-selectors'; previewHeader.after(selectors);
    const rigTools = el('rig-viewport-tools'); selectors.append(el('clip-choice'), rigTools);
    const rigHelp = document.createElement('details'); rigHelp.id = 'rig-view-help';
    const rigHelpTitle = document.createElement('summary'); rigHelpTitle.textContent = 'Rig controls help';
    const rigHelpContent = document.createElement('div'); rigHelpContent.append(rigTools.querySelector('p')!, el('viewport-status'));
    rigHelp.append(rigHelpTitle, rigHelpContent); previewHeader.insertBefore(rigHelp, this.expandButton);
    this.expandButton.addEventListener('click', () => this.expand(!this.expanded, true), { signal: host.controller.signal });
    window.addEventListener('keydown', event => {
      // Escape on the canvas belongs to its existing gesture-cancel handler.
      if (event.key === 'Escape' && this.expanded && event.target !== el('actor-preview')) {
        event.preventDefault(); this.expand(false, true);
      }
    }, { signal: host.controller.signal });
    const view = document.createElement('details'); const viewSummary = document.createElement('summary'); viewSummary.textContent = 'View & playback options';
    view.append(viewSummary, el('preview-zoom').closest('label')!, el('reset')); preview.append(view);
    preview.querySelector('nav')!.before(el('actor-preview').parentElement!);
    const seek = document.createElement('nav'); seek.setAttribute('aria-label', 'Precise clip time');
    el('scrub').closest('label')!.after(seek); seek.append(el('seek-time').closest('label')!, el('seek'));
    const emoteView = el('emote-view');
    el('emote-help').after(el('emote-preview').parentElement!);
    const emoteControls = emoteView.querySelector('nav')!;
    const options = document.createElement('details'); const optionsSummary = document.createElement('summary'); optionsSummary.textContent = 'Reset, cancel & second actor';
    options.append(optionsSummary, el('configure-emote'), el('cancel-emote'), el('reset-emote'), el('emote-secondary').closest('details')!);
    emoteControls.after(el('emote-scrub').closest('label')!);
    const emoteSeek = document.createElement('nav'); emoteSeek.setAttribute('aria-label', 'Precise emote time');
    el('emote-scrub').closest('label')!.after(emoteSeek); emoteSeek.append(el('emote-time').closest('label')!, el('seek-emote'));
    emoteView.append(options);

    body.append(el('emote-panel')); this.panels.set('emotes', el('emote-panel'));
    assembly.dataset.task = this.task;
    for (const task of tasks) {
      const button = document.createElement('button'); button.textContent = task.label;
      button.id = `task-button-${task.id}`; button.setAttribute('aria-controls', task.id === 'all' ? 'workspace-body' : task.id === 'emotes' ? 'emote-panel' : `task-${task.id}`);
      button.addEventListener('click', () => this.activate(task.id), { signal: host.controller.signal });
      el('task-navigation').append(button); this.buttons.set(task.id, button);
    }
    // Keep selection context up to date after the owning controls handle changes.
    root.addEventListener('change', () => this.render(), { signal: host.controller.signal });
    this.activate('parts');
  }
  activate(task: Task) {
    if (this.task === 'all' && task !== 'all') {
      for (const [details, open] of this.disclosures) details.open = open;
      this.disclosures.clear();
    }
    this.expand(false);
    this.host.cancelGesture(); this.host.assembly.pause();
    this.host.assembly.viewport.setEnabled(task === 'rig' || task === 'all');
    this.host.el('rig-viewport-tools').hidden = task !== 'rig' && task !== 'all';
    this.task = task; this.root.classList.toggle('all-tools', task === 'all');
    const emotes = this.host.el('emote-panel'), parent = task === 'all' ? this.host.el('workspace-inspectors') : this.host.el('workspace-body');
    if (emotes.parentElement !== parent) parent.append(emotes);
    this.host.el('assembly').dataset.task = task;
    for (const [id, panel] of this.panels) panel.hidden = task !== 'all' && id !== task;
    this.host.el('workspace-inspectors').hidden = task === 'emotes';
    this.expandButton.hidden = task !== 'rig' && task !== 'all';
    this.host.el('rig-view-help').hidden = task !== 'rig' && task !== 'all';
    this.host.el('preview-panel').hidden = task === 'emotes';
    for (const [id, button] of this.buttons) button.setAttribute('aria-pressed', String(id === task));
    this.host.el('task-help').textContent = tasks.find(t => t.id === task)!.help;
    for (const sections of this.sections.values()) sections.showAll(task === 'all');
    if (task === 'all') for (const details of this.host.el('assembly').querySelectorAll('details')) if (details.id !== 'rig-view-help') {
      if (!this.disclosures.has(details)) this.disclosures.set(details, details.open);
      details.open = true;
    }
    this.host.el('workspace-inspectors').scrollTop = 0;
    this.render();
  }
  private expand(on: boolean, focus = false) {
    this.host.cancelGesture();
    this.expanded = on; this.root.classList.toggle('preview-expanded', on);
    this.expandButton.textContent = on ? 'Restore split view' : 'Expand rig view';
    this.expandButton.setAttribute('aria-pressed', String(on));
    this.host.el('workspace-inspectors').hidden = on || this.task === 'emotes';
    // Keep the exit control in view and focused; no modal/fullscreen API or
    // source/player changes. ResizeObserver refreshes existing pointer geometry.
    if (focus) { this.root.scrollIntoView({ block: 'start' }); this.expandButton.focus({ preventScroll: true }); }
  }
  openPainter() { if (this.task !== 'all') this.activate('parts'); }
  render() {
    const source = this.host.draft.source;
    const name = (id: string) => this.host.el<HTMLSelectElement>(id).selectedOptions[0]?.textContent ?? 'None';
    this.host.el('selection-context').textContent = this.task === 'parts' ? `Part: ${name('parts')}` : this.task === 'rig' ? `Rig: ${name('rigs')} · ${this.host.value('edit-mode') === 'pose' ? 'Recording pose keys' : 'Editing rest shape'}` : `Clip: ${name('clips')}`;
    const next = this.host.el('next-step'); next.hidden = this.task === 'emotes' || this.task === 'all' || source.parts.length > 0 && source.attachments.length > 0 && source.clips.length > 0;
    next.querySelector('span')!.textContent = !source.parts.length ? 'Start with one piece of artwork.' : !source.attachments.length ? 'Your part is ready. Place it in the actor to see it here.' : 'Your actor is ready. Create a clip to save its motion.';
    this.host.el('next-step-action').textContent = !source.parts.length ? 'Create a part' : !source.attachments.length ? 'Attach a part' : 'Create a clip';
    this.host.el('preview-help').hidden = source.attachments.length > 0 && source.clips.length > 0;
    const help = this.host.el('recovery-help');
    try {
      const available = localStorage.getItem(RECOVERY_KEY) !== null;
      this.host.el<HTMLButtonElement>('recover').disabled = !available;
      help.textContent = available ? 'A local recovery draft is available in this browser. It is separate from your downloaded files.' : 'No local recovery draft yet. Edits are recovered in this browser when storage is available.';
    } catch {
      this.host.el<HTMLButtonElement>('recover').disabled = true;
      help.textContent = 'Local recovery is unavailable. Download editable source to keep your work.';
    }
    const hasPart = source.parts.length > 0;
    for (const id of ['rename', 'resize', 'pivot', 'add-layer', 'edit-layer', 'layer-up', 'remove-layer', 'apply-colour', 'add-colour', 'export', 'move']) this.host.el<HTMLButtonElement>(id).disabled = !hasPart;
  }
}
