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
  private readonly panels = new Map<Task, HTMLElement>();
  private readonly buttons = new Map<Task, HTMLButtonElement>();
  constructor(readonly root: HTMLElement, readonly host: ActorEditor) {
    const el = (id: string) => host.el(id);
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
    this.host.cancelGesture(); this.host.assembly.pause();
    this.host.assembly.viewport.setEnabled(task === 'rig' || task === 'all');
    this.host.el('rig-viewport-tools').hidden = task !== 'rig' && task !== 'all';
    this.task = task; this.root.classList.toggle('all-tools', task === 'all');
    this.host.el('assembly').dataset.task = task;
    for (const [id, panel] of this.panels) panel.hidden = task !== 'all' && id !== task;
    this.host.el('workspace-inspectors').hidden = task === 'emotes';
    this.host.el('preview-panel').hidden = task === 'emotes';
    for (const [id, button] of this.buttons) button.setAttribute('aria-pressed', String(id === task));
    this.host.el('task-help').textContent = tasks.find(t => t.id === task)!.help;
    if (task === 'all') for (const details of this.root.querySelectorAll('details')) if (details.id !== 'project-details') details.open = true;
    this.host.el('workspace-inspectors').scrollTop = 0;
    this.render();
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
    } catch { help.textContent = 'Local recovery is unavailable. Download editable source to keep your work.'; }
    const hasPart = source.parts.length > 0;
    for (const id of ['rename', 'resize', 'pivot', 'add-layer', 'edit-layer', 'layer-up', 'remove-layer', 'apply-colour', 'add-colour', 'export', 'move']) this.host.el<HTMLButtonElement>(id).disabled = !hasPart;
  }
}
