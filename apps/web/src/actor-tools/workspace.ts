import type { ActorEditor } from './main';
import { RECOVERY_KEY } from './editing';

type Task = 'parts' | 'rig' | 'animate' | 'emotes' | 'all';
const tasks: { id: Task; label: string; help: string }[] = [
  { id: 'parts', label: 'Parts', help: 'Create or select a part, then paint it. In Rig, attach artwork to the scene or to any body structure.' },
  { id: 'rig', label: 'Rig', help: 'Build any body structure, or use scene attachments with no bones. Choose Rest for the base shape and Pose to key the selected clip.' },
  { id: 'animate', label: 'Animate', help: 'Choose a clip in Preview. Create clips and edit keys here; expand Cels or Composition for more animation tools.' },
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
  constructor(readonly root: HTMLElement, readonly host: ActorEditor) {
    const el = (id: string) => host.el(id);
    const guide = document.createElement('dialog'); guide.id = 'creator-guide';
    guide.setAttribute('aria-labelledby', 'guide-title');
    guide.innerHTML = `<h2 id="guide-title">Create your first animation</h2><form method="dialog"><button autofocus>Close help</button></form>
      <ol><li><strong>Parts:</strong> start with Example: classic astronaut, or name a part and choose Create part. Paint with the selected palette colour.</li>
      <li><strong>Rig:</strong> create a rig and joints, or attach a part directly to the scene with no bones. Rest edits the base shape; Pose keys the selected clip. Numeric transforms are available beside the viewport.</li>
      <li><strong>Animate:</strong> create or choose a clip, select an item and insert keys in seconds. Play and scrub in Preview. Emotes previews solo or paired gestures on a separate clock.</li>
      <li><strong>Keep your original:</strong> Download editable source saves every layer, rig and clip as .actorproject. Reopen with Open source. Confirm “I retained this source” only after keeping the current file.</li>
      <li><strong>Export:</strong> Animate → Cels &amp; flipbooks → Flattened sheet and PNG. Prepare the sheet, then download both PNG and metadata. These are lossy copies; keep the editable source too.</li></ol>
      <h3>Shortcuts &amp; units</h3><p>Tab / Shift+Tab moves between controls; Enter / Space activates buttons. On painting, rig and timeline surfaces, Ctrl/Cmd+Z undoes and Ctrl/Cmd+Shift+Z redoes. Text fields keep native text undo. Escape cancels a gesture; outside the rig canvas it restores an expanded view. Arrow keys scrub a focused time slider. Numeric fields provide precise transforms and key times; painting and rectangle selection require a pointer.</p>
      <p>Scene X points right, Y up; rotations use counterclockwise radians and clip times use seconds. Artwork dimensions and selection moves use pixels, with pixel Y down.</p>
      <h3>Local files &amp; recovery</h3><p>Project files are processed in your browser. Recovery is best effort, namespaced browser storage, shared across tabs on this origin; it is not a file backup or cloud sync. The hosted app loads its code from the site. The separate offline HTML needs no network. Download source before clearing browser data, changing browsers or closing unsaved work.</p>`;
    root.append(guide);
    el('getting-started').addEventListener('click', () => {
      host.cancelGesture(); host.assembly.pause(); guide.showModal();
    }, { signal: host.controller.signal });
    root.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || guide.open) return;
      for (const id of ['project-options', 'rig-view-help']) {
        const details = el(id) as HTMLDetailsElement;
        if (details.open && details.contains(document.activeElement)) {
          details.open = false; details.querySelector('summary')!.focus(); event.preventDefault(); return;
        }
      }
    }, { signal: host.controller.signal });
    const assembly = el('assembly');
    const layout = root.querySelector<HTMLElement>('.layout')!;
    const aside = layout.querySelector('aside')!;
    const painter = layout.lastElementChild!;
    root.append(assembly);
    // Remove the old sequential workspace introduction; task help replaces it.
    assembly.querySelector(':scope > h2')!.remove();
    assembly.querySelector(':scope > p')!.remove();
    assembly.insertAdjacentHTML('afterbegin', `<nav aria-label="Authoring tasks" id="task-navigation"></nav><p id="task-help"></p><p id="selection-context"></p><div id="workspace-body"><div id="workspace-inspectors"></div></div>`);
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
    this.expand(false);
    if (this.task === 'all' && task !== 'all') this.host.el<HTMLDetailsElement>('project-options').open = false;
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
    if (task === 'all') for (const details of this.root.querySelectorAll('details')) if (details.id !== 'project-details' && details.id !== 'rig-view-help') details.open = true;
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
    this.host.el('selection-context').textContent = `${source.name} · Part: ${name('parts')} · Rig: ${name('rigs')} · Clip: ${name('clips')} · Edit: ${this.host.value('edit-mode') === 'pose' ? 'Pose key' : 'Rest shape'}`;
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
