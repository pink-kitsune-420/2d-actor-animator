import type { ActorCcdChainSettings, ActorProject, ActorRigPoint } from '@actor-animator/types';
import {
  CCD_CHAIN_SOLVER, addCcdConstraint, applyDeletion, deleteConstraint, mirrorSubtree, moveJoint, reparentRigItem, reviewDeletion,
  rigDiagnostics, syncAnimationCapability, syncCelCapability, scaleSegmentOffsets, setConstraintEnabled, setJointLimits, updateCcdConstraint,
  type ActorDeletePolicy, type ActorParentRef, type ActorPreserveMode, type ActorRigItem,
} from '../../../../packages/actor-tools/src/index';
import type { ActorDraft } from './editing';
import type { ActorPreview } from './preview';

export interface SkeletonSelection { rigId: string; kind: 'node' | 'socket' | 'attachment'; itemId: string }
interface SkeletonHost {
  draft: ActorDraft;
  controller: AbortController;
  cancelGesture(): void;
  perform(action: () => void): void;
  changed(): void;
  message(text: string): void;
}

/** Structural skeleton edits for the selected rig item. Every action is one
 * whole-project ActorDraft transaction; rejected edits leave source unchanged.
 * Deletion is two-phase: the confirmed edit is exactly the reviewed one. */
export class SkeletonControls {
  private constraintId = '';
  private shownConstraint = '';
  private review: { epoch: number; item: ActorRigItem; policy: ActorDeletePolicy } | null = null;
  constructor(readonly root: HTMLElement, readonly host: SkeletonHost, readonly preview: ActorPreview,
    readonly selection: () => SkeletonSelection, readonly select: (kind: SkeletonSelection['kind'], id: string) => void) {
    const number = (id: string, value: string, step = 'any') => `<input id="${id}" type="number" step="${step}" value="${value}">`;
    root.innerHTML = `<h3>Skeleton structure</h3><p>Structural edits act on rest poses in both modes. Preserve world keeps the rest-pose world placement and corrects that item's keys by the same similarity; preserve local keeps its numbers. Shear or a collapsed parent is rejected, never approximated.</p>
      <label>New parent<select id="reparent-parent"></select></label><label>Reparent mode<select id="reparent-mode"><option value="world">Preserve world (rest)</option><option value="local">Preserve local</option></select></label><button id="reparent">Reparent selected item</button>
      <label>Delete policy<select id="delete-policy"><option value="lift-world">Lift children to parent (preserve world)</option><option value="lift-local">Lift children to parent (preserve local)</option><option value="subtree">Delete node subtree</option></select></label>
      <button id="review-delete">Review deletion</button><button id="confirm-delete" disabled>Confirm reviewed deletion</button><pre id="delete-review" aria-label="Deletion review">Nothing reviewed.</pre>
      <button id="mirror">Mirror copy subtree</button><label>Offset factor${number('proportion-factor', '1.5')}</label><button id="scale-offsets">Scale segment offsets</button>
      <label>Joint move X${number('joint-dx', '0')}</label><label>Joint move Y${number('joint-dy', '0')}</label><button id="move-joint">Move joint, keep children</button>
      <h3>Optional joint limits</h3><p>Editing aid in local radians. Authored rest and keys are reported, never clamped; constraint solving clamps joints it moves.</p>
      <label>Minimum rotation (radians)${number('limit-min', '-1')}</label><label>Maximum rotation (radians)${number('limit-max', '1')}</label><button id="apply-limits">Apply limits</button><button id="clear-limits">Clear limits</button>
      <h3>Visual constraints</h3><p>Cyclic coordinate descent chains, solved after clip sampling in this rig's list order with a fixed iteration budget. Visual only: no collision, reach or movement.</p>
      <label>Constraint<select id="constraints"></select></label><p id="constraint-status" role="status"></p><label>Constraint name<input id="constraint-name" value="Reach"></label>
      <label>Effector<select id="constraint-effector"></select></label><label>Chain root<select id="constraint-root"></select></label><label>Target<select id="constraint-target"></select></label>
      <label>Iterations${number('constraint-iterations', '16', '1')}</label><label>Tolerance (units)${number('constraint-tolerance', '0.01')}</label>
      <button id="add-constraint">Add CCD constraint</button><button id="update-constraint">Update selected constraint</button><button id="toggle-constraint">Enable or disable constraint</button><button id="delete-constraint">Delete constraint</button>
      <label><input id="apply-constraints" type="checkbox" checked>Apply visual constraints in preview</label><h3>Rig diagnostics</h3><pre id="rig-diagnostics" aria-label="Rig diagnostics"></pre>`;
    const signal = host.controller.signal;
    const click = (id: string, action: () => void) => this.el(id).addEventListener('click', () => host.perform(() => { host.cancelGesture(); this.preview.pause(); action(); }), { signal });
    const mutate = (action: (source: ActorProject) => void) => { host.draft.edit(s => { action(s); syncAnimationCapability(s); syncCelCapability(s); }); host.changed(); };
    let lines: string[] = [];
    click('reparent', () => { mutate(s => { lines = [reparentRigItem(s, this.item(), this.parent(), this.value('reparent-mode') as ActorPreserveMode)]; }); host.message(lines.join(' ')); });
    click('review-delete', () => {
      const item = this.item(), policy = this.value('delete-policy') as ActorDeletePolicy;
      this.review = null; this.el('delete-review').textContent = 'Nothing reviewed.';
      const review = reviewDeletion(host.draft.source, item, policy);
      this.review = { epoch: host.draft.epoch, item, policy };
      this.el('delete-review').textContent = review.join('\n'); this.render();
    });
    click('confirm-delete', () => {
      const review = this.review;
      if (!review || review.epoch !== host.draft.epoch) throw new Error('Source changed since the review; review the deletion again.');
      this.review = null; this.el('delete-review').textContent = 'Nothing reviewed.';
      mutate(s => { lines = applyDeletion(s, review.item, review.policy); });
      this.select(this.selection().kind, ''); host.message(`Deleted after review: ${lines.length} change(s). Undo restores everything.`);
    });
    click('mirror', () => {
      const { rigId, itemId } = this.node(); let copy = '';
      mutate(s => { const result = mirrorSubtree(s, rigId, itemId, () => crypto.randomUUID()); copy = result.rootId; lines = result.lines; });
      this.select('node', copy); host.message(lines.join(' '));
    });
    click('scale-offsets', () => { const { rigId, itemId } = this.node(), factor = this.num('proportion-factor'); mutate(s => { lines = scaleSegmentOffsets(s, rigId, itemId, factor); }); host.message(lines.join(' ')); });
    click('move-joint', () => { const { rigId, itemId } = this.node(), dx = this.num('joint-dx'), dy = this.num('joint-dy'); mutate(s => { lines = moveJoint(s, rigId, itemId, dx, dy); }); host.message(lines.join(' ')); });
    click('apply-limits', () => { const { rigId, itemId } = this.node(), limits = { minRotation: this.num('limit-min'), maxRotation: this.num('limit-max') }; mutate(s => setJointLimits(s, rigId, itemId, limits)); });
    click('clear-limits', () => { const { rigId, itemId } = this.node(); mutate(s => setJointLimits(s, rigId, itemId, null)); });
    click('add-constraint', () => {
      const rigId = this.selection().rigId, id = crypto.randomUUID(), name = this.value('constraint-name'), settings = this.settings();
      mutate(s => addCcdConstraint(s, rigId, id, name, settings)); this.constraintId = id; this.render();
    });
    click('update-constraint', () => {
      const rigId = this.selection().rigId, id = this.constraintId, name = this.value('constraint-name'), settings = this.settings();
      if (!id) throw new Error('Select a constraint.');
      mutate(s => updateCcdConstraint(s, rigId, id, name, settings));
    });
    click('toggle-constraint', () => { const rigId = this.selection().rigId, id = this.constraintId, c = this.rigOf(host.draft.source)?.constraints?.find(x => x.id === id); if (!c) throw new Error('Select a constraint.'); mutate(s => setConstraintEnabled(s, rigId, id, !c.enabled)); });
    click('delete-constraint', () => { const rigId = this.selection().rigId, id = this.constraintId; if (!id) throw new Error('Select a constraint.'); mutate(s => deleteConstraint(s, rigId, id)); });
    this.el('constraints').addEventListener('change', () => host.perform(() => { this.constraintId = this.value('constraints'); this.render(); }), { signal });
    this.el('apply-constraints').addEventListener('change', () => host.perform(() => { this.preview.setConstraints(this.el<HTMLInputElement>('apply-constraints').checked); this.status(); }), { signal });
  }
  private el<T extends HTMLElement = HTMLElement>(id: string) { return this.root.querySelector<T>(`#${id}`)!; }
  private value(id: string) { return this.el<HTMLInputElement>(id).value; }
  private num(id: string) { const text = this.value(id), n = Number(text); if (!text.trim() || !Number.isFinite(n)) throw new Error('Enter a finite number.'); return n; }
  private point(id: string): ActorRigPoint { const value = this.value(id); if (!value) throw new Error('Choose a node or socket.'); return JSON.parse(value) as ActorRigPoint; }
  private settings(): ActorCcdChainSettings {
    const settings = { effector: this.point('constraint-effector'), chainRootId: this.value('constraint-root'), target: this.point('constraint-target'),
      iterations: this.num('constraint-iterations'), tolerance: this.num('constraint-tolerance') };
    if (!settings.chainRootId) throw new Error('Choose a chain root node.');
    return settings;
  }
  private rigOf(source: ActorProject) { return source.rigs.find(r => r.id === this.selection().rigId); }
  private item(): ActorRigItem {
    const { rigId, kind, itemId } = this.selection();
    if (!itemId) throw new Error('Select a node, socket or attachment.');
    return kind === 'attachment' ? { kind, id: itemId } : { kind, rigId, id: itemId };
  }
  private node() { const s = this.selection(); if (s.kind !== 'node' || !s.itemId) throw new Error('Select a node.'); return s; }
  private parent(): ActorParentRef { const value = this.value('reparent-parent'); return value ? JSON.parse(value) as ActorParentRef : null; }
  private options(id: string, values: { value: string; text: string }[], selected: string) {
    const select = this.el<HTMLSelectElement>(id);
    select.replaceChildren(...values.map(v => { const option = document.createElement('option'); option.value = v.value; option.textContent = v.text; return option; }));
    select.value = values.some(v => v.value === selected) ? selected : values[0]?.value ?? '';
    return select.value;
  }
  /** Residual/status text; cheap enough to refresh from the preview clock. */
  status() {
    const rigId = this.selection().rigId, c = this.constraintId ? this.preview.constraint(rigId, this.constraintId) : null;
    this.el('constraint-status').textContent = !c ? 'No constraint selected.' : `${c.status}${Number.isNaN(c.residual) ? '' : ` · residual ${c.residual.toFixed(6)} units`}`;
  }
  render() {
    const source = this.host.draft.source, rig = this.rigOf(source), { kind } = this.selection();
    if (this.review && this.review.epoch !== this.host.draft.epoch) { this.review = null; this.el('delete-review').textContent = 'Source changed; review again before deleting.'; }
    this.el<HTMLButtonElement>('confirm-delete').disabled = !this.review;
    const nodes = rig?.nodes ?? [], parents = kind === 'attachment'
      ? source.rigs.flatMap(r => r.nodes.map(n => ({ value: JSON.stringify({ rigId: r.id, nodeId: n.id }), text: `${r.name} / ${n.name}` })))
      : nodes.map(n => ({ value: JSON.stringify({ rigId: rig!.id, nodeId: n.id }), text: n.name }));
    this.options('reparent-parent', [{ value: '', text: kind === 'attachment' ? 'Scene root (detached)' : 'Rig root level' }, ...parents], this.value('reparent-parent'));
    const points = [...nodes.map(n => ({ value: JSON.stringify({ kind: 'node', id: n.id }), text: `Node · ${n.name}` })), ...(rig?.sockets ?? []).map(s => ({ value: JSON.stringify({ kind: 'socket', id: s.id }), text: `Socket · ${s.name}` }))];
    this.options('constraint-effector', points, this.value('constraint-effector'));
    this.options('constraint-target', points, this.value('constraint-target'));
    this.options('constraint-root', nodes.map(n => ({ value: n.id, text: n.name })), this.value('constraint-root'));
    this.constraintId = this.options('constraints', (rig?.constraints ?? []).map(c => ({ value: c.id, text: `${c.name}${c.solver === CCD_CHAIN_SOLVER ? '' : ` (${c.solver}, unsupported)`}${c.enabled ? '' : ' · disabled'}` })), this.constraintId);
    // Show a newly selected built-in constraint's settings once; never overwrite typing on re-render.
    const selected = rig?.constraints?.find(c => c.id === this.constraintId);
    if (selected && selected.id !== this.shownConstraint) {
      this.el<HTMLInputElement>('constraint-name').value = selected.name;
      if (selected.solver === CCD_CHAIN_SOLVER) {
        const s = selected.settings as ActorCcdChainSettings;
        this.el<HTMLSelectElement>('constraint-effector').value = JSON.stringify({ kind: s.effector.kind, id: s.effector.id });
        this.el<HTMLSelectElement>('constraint-target').value = JSON.stringify({ kind: s.target.kind, id: s.target.id });
        this.el<HTMLSelectElement>('constraint-root').value = s.chainRootId;
        this.el<HTMLInputElement>('constraint-iterations').value = String(s.iterations); this.el<HTMLInputElement>('constraint-tolerance').value = String(s.tolerance);
      }
    }
    this.shownConstraint = selected?.id ?? '';
    const node = kind === 'node' ? nodes.find(n => n.id === this.selection().itemId) : undefined;
    if (node?.limits) { this.el<HTMLInputElement>('limit-min').value = String(node.limits.minRotation); this.el<HTMLInputElement>('limit-max').value = String(node.limits.maxRotation); }
    this.el('rig-diagnostics').textContent = rigDiagnostics(source).join('\n') || 'No diagnostics.';
    this.status();
  }
}
