import { test, expect, type Page } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import type { ActorProject, ActorTransform } from '@actor-animator/types';

interface Evidence { matrices: number[][]; frameTimes: number[]; frames: number; callbacks: FrameRequestCallback[] }
declare global { interface Window { skeletonEvidence: Evidence } }
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.skeletonEvidence = { matrices: [], frameTimes: [], frames: 0, callbacks: [] };
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function(this: CanvasRenderingContext2D, ...args: Parameters<typeof draw>) {
      if (this.canvas.id === 'actor-preview') { const m = this.getTransform(); window.skeletonEvidence.matrices.push([m.a, m.b, m.c, m.d, m.e, m.f]); }
      return draw.apply(this, args);
    } as typeof draw;
    const request = window.requestAnimationFrame;
    window.requestAnimationFrame = callback => {
      window.skeletonEvidence.callbacks.push(callback);
      return request.call(window, time => { const start = performance.now(); try { callback(time); } finally { window.skeletonEvidence.frames++; window.skeletonEvidence.frameTimes.push(performance.now() - start); } });
    };
  });
});

// ---- independent test-local affine oracle (does not import actor-tools) -----
type M = [number, number, number, number, number, number];
const trs = (t: ActorTransform): M => [Math.cos(t.rotation) * t.scaleX, Math.sin(t.rotation) * t.scaleX, -Math.sin(t.rotation) * t.scaleY, Math.cos(t.rotation) * t.scaleY, t.x, t.y];
const mul = (p: M, q: M): M => [p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1], p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3], p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5]];
function nodeWorld(source: ActorProject, rigId: string, nodeId: string): M {
  const rig = source.rigs.find(r => r.id === rigId)!; let m: M = [1, 0, 0, 1, 0, 0];
  for (let id: string | null = nodeId; id !== null;) { const n = rig.nodes.find(x => x.id === id)!; m = mul(trs(n.rest), m); id = n.parentId; }
  return m;
}
const byName = <T extends { name: string }>(items: T[], name: string) => { const found = items.find(i => i.name === name); expect(found, name).toBeTruthy(); return found!; };
function attachmentWorld(source: ActorProject, name: string): M {
  const a = byName(source.attachments, name); const local = trs(a.transform);
  return a.rigId === undefined ? local : mul(nodeWorld(source, a.rigId, a.nodeId!), local);
}
function socketWorld(source: ActorProject, name: string): M {
  const rig = source.rigs[0]!, s = byName(rig.sockets, name); return mul(nodeWorld(source, rig.id, s.nodeId), trs(s.transform));
}
const near = (a: readonly number[], b: readonly number[], digits = 9) => { expect(a).toHaveLength(b.length); b.forEach((v, i) => expect(a[i]).toBeCloseTo(v, digits)); };

// ---- real UI helpers ---------------------------------------------------------
async function click(page: Page, id: string) { await page.locator(`#${id}`).click(); }
async function field(page: Page, id: string, value: string | number) { await page.locator(`#${id}`).fill(String(value)); }
async function save(page: Page): Promise<{ text: string; source: ActorProject }> {
  const pending = page.waitForEvent('download'); await click(page, 'save'); const path = await (await pending).path();
  const text = readFileSync(path!, 'utf8'); return { text, source: JSON.parse(text) as ActorProject };
}
async function open(page: Page, source: ActorProject | string) {
  await page.locator('#open').setInputFiles({ name: 'skeleton.actorproject', mimeType: 'application/json', buffer: Buffer.from(typeof source === 'string' ? source : JSON.stringify(source)) });
  await expect(page.locator('#message')).toHaveText('Opened complete editable source.');
}
async function dot(page: Page, x: number, y: number) {
  await page.locator('#paint').scrollIntoViewIfNeeded(); const box = (await page.locator('#paint').boundingBox())!;
  await page.mouse.click(box.x + x * 16 + 8, box.y + y * 16 + 8);
}
async function part(page: Page, name: string) { await field(page, 'part-name', name); await field(page, 'width', 2); await field(page, 'height', 2); await click(page, 'add-part'); await dot(page, 0, 0); await dot(page, 1, 1); }
async function rest(page: Page, t: Partial<ActorTransform>) {
  const full = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, ...t };
  for (const [k, v] of Object.entries(full)) await field(page, `rest-${k}`, v);
}
async function add(page: Page, kind: 'node' | 'socket' | 'attachment', name: string, parent: string | null, t: Partial<ActorTransform> = {}, drawOrder = 0) {
  await page.locator('#item-kind').selectOption(kind); await field(page, 'item-name', name);
  await page.locator('#parent-node').selectOption({ label: parent ?? 'Scene root (no node)' }); await rest(page, t);
  if (kind === 'attachment') await field(page, 'draw-order', drawOrder);
  await click(page, 'add-item');
}
async function pick(page: Page, kind: 'node' | 'socket' | 'attachment', label: string) { await page.locator('#item-kind').selectOption(kind); await page.locator('#items').selectOption({ label }); }
async function message(page: Page) { return (await page.locator('#message').textContent()) ?? ''; }

test('six-limb creature with segmented tail, tool socket and detached accessory: authored, revised, saved and reopened in the real editor', async ({ page }, info) => {
  // Generated end-to-end authoring includes dozens of validated source operations.
  test.setTimeout(120_000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/actor-tools.html'); await page.getByRole('button', { name: 'All tools', exact: true }).click(); await part(page, 'Chitin plate');
  await field(page, 'rig-name', 'Skitterling'); await click(page, 'add-rig');
  await add(page, 'node', 'Carapace', null, { rotation: .1 });
  for (let i = 0; i < 3; i++) {
    await add(page, 'node', `Leg ${i}`, 'Carapace', { x: .8, y: .6 - .6 * i, rotation: .5 - .5 * i });
    await add(page, 'node', `Foot ${i}`, `Leg ${i}`, { x: 1.2, rotation: -.6 });
    await add(page, 'attachment', `Foot art ${i}`, `Foot ${i}`, { x: .2 }, 1);
  }
  await add(page, 'socket', 'Tool grip', 'Foot 0', { x: 1, rotation: .25 });
  for (let i = 1; i <= 4; i++) await add(page, 'node', `Tail ${i}`, i === 1 ? 'Carapace' : `Tail ${i - 1}`, i === 1 ? { x: -.9, rotation: Math.PI } : { x: .7, rotation: .15 });
  await add(page, 'attachment', 'Carapace art', 'Carapace', {}, 0);
  await add(page, 'attachment', 'Lantern accessory', 'Tail 4', { x: .4, y: .1, rotation: .3, scaleX: 1.5, scaleY: 1.5 }, 99);
  await add(page, 'node', 'Tail goal', null, { x: -3.5, y: -1.5 }); // a second root in the same rig
  // Six limbs: mirror each authored leg across the carapace's vertical axis.
  for (let i = 0; i < 3; i++) { await pick(page, 'node', `Child · Leg ${i}`); await click(page, 'mirror'); expect(await message(page)).toContain('Mirrored 2 node(s)'); }
  let authored = (await save(page)).source; const rig = authored.rigs[0]!;
  expect(rig.nodes.filter(n => /^Leg \d( \(mirror\))?$/.test(n.name))).toHaveLength(6);
  expect(rig.nodes.filter(n => n.parentId === null).map(n => n.name)).toEqual(['Carapace', 'Tail goal']);
  expect(authored.attachments.filter(a => a.name.startsWith('Foot art'))).toHaveLength(6);
  // Independent oracle: mirrored foot art is the carapace-space reflection of the original.
  const carapace = nodeWorld(authored, rig.id, byName(rig.nodes, 'Carapace').id), invCarapace = (() => { const [a, b, c, d, e, f] = carapace, det = a * d - b * c; return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det] as M; })();
  near(mul(invCarapace, attachmentWorld(authored, 'Foot art 1 (mirror)')), mul([-1, 0, 0, 1, 0, 0], mul(invCarapace, attachmentWorld(authored, 'Foot art 1'))));

  // Detach the accessory, preserving its rest world placement.
  const lanternBefore = attachmentWorld(authored, 'Lantern accessory');
  await pick(page, 'attachment', 'Lantern accessory'); await page.locator('#reparent-parent').selectOption({ label: 'Scene root (detached)' }); await page.locator('#reparent-mode').selectOption('world'); await click(page, 'reparent');
  expect(await message(page)).toContain('moved to the scene root (preserve world)');
  authored = (await save(page)).source; expect(byName(authored.attachments, 'Lantern accessory').rigId).toBeUndefined();
  near(attachmentWorld(authored, 'Lantern accessory'), lanternBefore);
  // Canvas oracle: the accessory (highest draw order) draws last at rest with the same matrix after detaching.
  await click(page, 'rest'); const drawnDetached = await page.evaluate(() => window.skeletonEvidence.matrices.at(-1)!);
  await add(page, 'attachment', 'Tail tip art', 'Tail 4', { x: .3 }, 98); // draws second to last
  const fkTip = await page.evaluate(() => window.skeletonEvidence.matrices.at(-2)!);

  // Optional joint limits and a visual CCD constraint toward the second root.
  await pick(page, 'node', 'Child · Tail 2'); await field(page, 'limit-min', -.8); await field(page, 'limit-max', .8); await click(page, 'apply-limits');
  await field(page, 'constraint-name', 'Tail reach'); await page.locator('#constraint-effector').selectOption({ label: 'Node · Tail 4' });
  await page.locator('#constraint-root').selectOption({ label: 'Tail 1' }); await page.locator('#constraint-target').selectOption({ label: 'Node · Tail goal' });
  await field(page, 'constraint-iterations', 24); await field(page, 'constraint-tolerance', .001); await click(page, 'add-constraint');
  await expect(page.locator('#constraint-status')).toContainText('active · residual');
  const withIk = await page.evaluate(() => window.skeletonEvidence.matrices.slice(-2));
  expect(Math.hypot(withIk[0]![4]! - fkTip[4]!, withIk[0]![5]! - fkTip[5]!)).toBeGreaterThan(1); // the solver moved the tail tip
  near(withIk[1]!, drawnDetached, 4); // the detached accessory is not part of any chain
  await page.locator('#apply-constraints').uncheck(); await expect(page.locator('#constraint-status')).toHaveText('active');
  near(await page.evaluate(() => window.skeletonEvidence.matrices.at(-2)!), fkTip, 4); // raw FK pose
  await page.locator('#apply-constraints').check(); near(await page.evaluate(() => window.skeletonEvidence.matrices.at(-2)!), withIk[0]!, 6);
  const ikId = (await save(page)).source.rigs[0]!.constraints![0]!.id;
  await field(page, 'constraint-iterations', 32); await click(page, 'update-constraint'); // revise in place
  authored = (await save(page)).source;
  expect(authored.rigs[0]!.constraints).toEqual([expect.objectContaining({ id: ikId, name: 'Tail reach', enabled: true, settings: expect.objectContaining({ iterations: 32, tolerance: .001 }) })]);
  expect(authored.requiredCapabilities).toContain('spacelab:rig-constraints/1'); expect(byName(authored.rigs[0]!.nodes, 'Tail 2').limits).toEqual({ minRotation: -.8, maxRotation: .8 });

  // Clip, two keys on a leg, and a pose key at the preview time (rest untouched).
  await field(page, 'clip-name', 'Scuttle'); await field(page, 'duration', 2); await page.locator('#playback').selectOption('loop'); await click(page, 'add-clip');
  await page.locator('#track-target').selectOption({ label: 'Skitterling / Leg 0' }); await field(page, 'key-b-rotation', 1.1); await click(page, 'apply-keys');
  await page.locator('#edit-mode').selectOption('pose'); await field(page, 'seek-time', 1); await click(page, 'seek');
  await pick(page, 'node', 'Child · Tail 1'); await expect(page.locator('#rest-legend')).toContainText('Local pose at 1 s');
  await field(page, 'rest-rotation', Math.PI + .4); await click(page, 'apply-item'); expect(await message(page)).toContain('Pose key created at 1 s; rest unchanged.');
  await page.locator('#edit-mode').selectOption('rest');
  authored = (await save(page)).source;
  const tail1 = byName(authored.rigs[0]!.nodes, 'Tail 1'); expect(tail1.rest.rotation).toBe(Math.PI);
  expect(authored.clips[0]!.tracks.find(t => t.target.kind === 'node' && t.target.nodeId === tail1.id)!.keys).toEqual([{ time: 1, value: { ...tail1.rest, rotation: Math.PI + .4 } }]);

  // Revisions: rename, preserve-world reparent, proportions, joint move, reviewed deletion with undo/redo.
  await pick(page, 'node', 'Child · Leg 1'); await field(page, 'item-name', 'Ridge leg'); await click(page, 'apply-item');
  const footBefore = attachmentWorld(authored, 'Foot art 2'), gripBefore = socketWorld(authored, 'Tool grip');
  await pick(page, 'node', 'Child · Foot 2'); await page.locator('#reparent-parent').selectOption({ label: 'Tail 1' }); await page.locator('#reparent-mode').selectOption('world'); await click(page, 'reparent');
  await pick(page, 'node', 'Child · Tail 2'); await field(page, 'proportion-factor', 1.25); await click(page, 'scale-offsets');
  await pick(page, 'node', 'Child · Foot 0'); await field(page, 'joint-dx', .1); await field(page, 'joint-dy', -.2); await click(page, 'move-joint');
  const beforeDelete = await save(page);
  near(attachmentWorld(beforeDelete.source, 'Foot art 2'), footBefore); // independent Float64 oracle
  near(socketWorld(beforeDelete.source, 'Tool grip').slice(4), gripBefore.slice(4)); // joint moved, socket kept place
  const tipBefore = nodeWorld(beforeDelete.source, rig.id, byName(beforeDelete.source.rigs[0]!.nodes, 'Tail 4').id);
  await pick(page, 'node', 'Child · Tail 3'); await page.locator('#delete-policy').selectOption('lift-world'); await click(page, 'review-delete');
  await expect(page.locator('#delete-review')).toContainText('Delete node Tail 3; lift its children to Tail 2.');
  await expect(page.locator('#delete-review')).toContainText('Tail 4: moved to Tail 2 (preserve world).');
  await expect(page.locator('#confirm-delete')).toBeEnabled(); await click(page, 'confirm-delete');
  await expect(page.locator('#delete-review')).toHaveText('Nothing reviewed.'); await expect(page.locator('#confirm-delete')).toBeDisabled(); // no stale review after applying
  const deleted = await save(page); expect(deleted.source.rigs[0]!.nodes.some(n => n.name === 'Tail 3')).toBe(false);
  near(nodeWorld(deleted.source, rig.id, byName(deleted.source.rigs[0]!.nodes, 'Tail 4').id), tipBefore);
  expect(deleted.source.rigs[0]!.constraints![0]!.settings).toMatchObject({ chainRootId: tail1.id }); // chain still valid, one joint shorter
  await click(page, 'undo'); expect((await save(page)).text).toBe(beforeDelete.text); await click(page, 'redo'); expect((await save(page)).text).toBe(deleted.text);

  // Arbitrary data stays ordinary: IDs are unchanged by rename/reparent; no anatomy fields appeared.
  const ids = (s: ActorProject) => s.rigs[0]!.nodes.map(n => n.id).sort();
  expect(ids(deleted.source)).toEqual(ids(authored).filter(id => id !== byName(authored.rigs[0]!.nodes, 'Tail 3').id).sort());
  expect(byName(deleted.source.rigs[0]!.nodes, 'Ridge leg').id).toBe(byName(authored.rigs[0]!.nodes, 'Leg 1').id);

  // Save, close, reopen: byte-identical source and identical drawn poses (constraint + clip at t=1).
  await field(page, 'seek-time', 1); await click(page, 'seek'); const drawn = await page.evaluate(() => window.skeletonEvidence.matrices.slice(-7));
  await click(page, 'retained'); await click(page, 'close'); await click(page, 'reopen'); await page.getByRole('button', { name: 'All tools', exact: true }).click(); await open(page, deleted.text);
  expect((await save(page)).text).toBe(deleted.text);
  await page.locator('#clips').selectOption({ label: 'Scuttle' }); await field(page, 'seek-time', 1); await click(page, 'seek');
  expect(await page.evaluate(() => window.skeletonEvidence.matrices.slice(-7))).toEqual(drawn);
  await expect(page.locator('#constraints')).toHaveValue(ikId); // reopened constraint settings are shown, not creation defaults
  await expect(page.locator('#constraint-effector option:checked')).toHaveText('Node · Tail 4'); await expect(page.locator('#constraint-iterations')).toHaveValue('32');
  await page.locator('#assembly').screenshot({ path: info.outputPath('six-limb-creature-editor.png') });
  await page.locator('#actor-preview').screenshot({ path: info.outputPath('six-limb-creature-preview.png') });
  expect(errors).toEqual([]);
  await info.attach('six-limb-creature.actorproject', { body: deleted.text, contentType: 'application/json' });
  console.log(JSON.stringify({ observation: 'B1 nonhuman acceptance', nodes: deleted.source.rigs[0]!.nodes.length, roots: deleted.source.rigs[0]!.nodes.filter(n => n.parentId === null).length,
    attachments: deleted.source.attachments.length, sockets: deleted.source.rigs[0]!.sockets.length, constraints: deleted.source.rigs[0]!.constraints!.length, bytes: deleted.text.length }));
});

test('rejected structural edits are atomic with useful diagnostics; stale reviews and cancelled files change nothing', async ({ page }) => {
  await page.goto('/actor-tools.html'); await page.getByRole('button', { name: 'All tools', exact: true }).click(); await part(page, 'Shard');
  await click(page, 'add-rig');
  await add(page, 'node', 'Stretch', null, { scaleX: 2 });
  await add(page, 'node', 'Turned', null, { rotation: Math.PI / 4 });
  await add(page, 'node', 'Leaf', 'Turned', { x: 1 });
  await add(page, 'node', 'Flat', null, { scaleY: 0 });
  const before = await save(page);
  const attempt = async (label: string, parent: string, mode: 'world' | 'local', expected: RegExp) => {
    await pick(page, 'node', label); await page.locator('#reparent-parent').selectOption({ label: parent }); await page.locator('#reparent-mode').selectOption(mode);
    await click(page, 'reparent'); expect(await message(page)).toMatch(expected); expect((await save(page)).text).toBe(before.text);
  };
  await attempt('Root · Turned', 'Leaf', 'local', /cannot become a child of itself or its own descendant/);
  await attempt('Child · Leaf', 'Stretch', 'world', /needs shear, which a local TRS cannot represent/);
  await attempt('Child · Leaf', 'Flat', 'world', /collapses space/);
  await pick(page, 'node', 'Child · Leaf'); await page.locator('#parent-node').selectOption({ label: 'Stretch' }); await click(page, 'apply-item');
  expect(await message(page)).toContain('Use Reparent with an explicit preserve mode'); expect((await save(page)).text).toBe(before.text);
  // Preserve local is always representable and explicit.
  await pick(page, 'node', 'Child · Leaf'); await page.locator('#reparent-parent').selectOption({ label: 'Stretch' }); await page.locator('#reparent-mode').selectOption('local'); await click(page, 'reparent');
  const local = (await save(page)).source; expect(byName(local.rigs[0]!.nodes, 'Leaf').rest).toEqual(byName(before.source.rigs[0]!.nodes, 'Leaf').rest);
  await click(page, 'undo'); expect((await save(page)).text).toBe(before.text);
  // A review is invalidated by any later edit; confirming it then changes nothing.
  await pick(page, 'node', 'Root · Turned'); await page.locator('#delete-policy').selectOption('subtree'); await click(page, 'review-delete');
  await expect(page.locator('#delete-review')).toContainText('Delete 2 node(s): Turned, Leaf.');
  await pick(page, 'node', 'Root · Stretch'); await field(page, 'item-name', 'Stretched'); await click(page, 'apply-item');
  await expect(page.locator('#confirm-delete')).toBeDisabled(); await expect(page.locator('#delete-review')).toContainText('review again');
  const renamed = await save(page); expect(renamed.source.rigs[0]!.nodes).toHaveLength(4);
  // Pose editing without a clip is refused; sockets have no tracks.
  await page.locator('#edit-mode').selectOption('pose'); expect(await message(page)).toContain('Create or select a clip'); await expect(page.locator('#edit-mode')).toHaveValue('rest');
  // A cancelled open keeps the project; the dirty state remains truthful.
  const chooser = page.waitForEvent('filechooser'); page.once('dialog', d => d.accept()); await page.locator('#open').click(); await (await chooser).setFiles([]);
  expect((await save(page)).text).toBe(renamed.text); await expect(page.locator('#state')).toContainText('Unsaved');
});

test('multiple rigs/roots and a zero-bone project use the same tools; old Phase 1 sources reopen unchanged', async ({ page }, info) => {
  await page.goto('/actor-tools.html'); await page.getByRole('button', { name: 'All tools', exact: true }).click(); await part(page, 'Glow');
  // Zero-bone: scene attachments only, pose-mode keying works without a rig.
  await add(page, 'attachment', 'Free glow', null, { x: 1 }); await add(page, 'attachment', 'Second glow', null, { x: -1 }, 1);
  await click(page, 'add-clip'); await page.locator('#edit-mode').selectOption('pose');
  await pick(page, 'attachment', 'Free glow'); await field(page, 'seek-time', .5); await click(page, 'seek');
  await field(page, 'rest-y', 2); await click(page, 'apply-item'); expect(await message(page)).toContain('Pose key created at 0.5 s');
  await expect(page.locator('#reparent-parent option')).toHaveText(['Scene root (detached)']);
  const zero = await save(page); expect(zero.source.rigs).toEqual([]); expect(zero.source.requiredCapabilities).not.toContain('spacelab:rig-constraints/1');
  await click(page, 'retained'); await click(page, 'new'); await open(page, zero.text); expect((await save(page)).text).toBe(zero.text);
  // Two rigs, two roots each; an attachment moves between rigs preserving world, then a whole rig empties to zero nodes.
  await page.locator('#edit-mode').selectOption('rest');
  await field(page, 'rig-name', 'Swarm A'); await click(page, 'add-rig'); await add(page, 'node', 'Alpha', null, { x: 2, rotation: .4 }); await add(page, 'node', 'Beta', null, { y: 2 });
  await field(page, 'rig-name', 'Swarm B'); await click(page, 'add-rig'); await add(page, 'node', 'Gamma', null, { x: -2, scaleX: 3, scaleY: 3 }); await add(page, 'node', 'Delta', null, { y: -2 });
  await page.locator('#rigs').selectOption({ label: 'Swarm A' }); await pick(page, 'attachment', 'Free glow');
  const glowBefore = attachmentWorld((await save(page)).source, 'Free glow');
  await page.locator('#reparent-parent').selectOption({ label: 'Swarm B / Gamma' }); await click(page, 'reparent');
  const moved = (await save(page)).source; expect(byName(moved.attachments, 'Free glow').nodeId).toBe(byName(moved.rigs[1]!.nodes, 'Gamma').id);
  near(attachmentWorld(moved, 'Free glow'), glowBefore);
  await page.locator('#rigs').selectOption({ label: 'Swarm A' });
  for (const label of ['Root · Alpha', 'Root · Beta']) { await pick(page, 'node', label); await page.locator('#delete-policy').selectOption('subtree'); await click(page, 'review-delete'); await click(page, 'confirm-delete'); }
  const emptied = (await save(page)).source; expect(emptied.rigs[0]!.nodes).toEqual([]); expect(emptied.rigs[1]!.nodes.filter(n => n.parentId === null)).toHaveLength(2);
  await expect(page.locator('#node-tree')).toHaveText('No nodes. Scene attachments are available.');
  await expect(page.locator('#delete-review')).toHaveText('Nothing reviewed.');
  // Accepted Phase 1 fixtures (no capability) round-trip byte-identically through the B1 editor.
  for (const name of ['nonhuman', 'astronaut', 'zero-bone']) {
    const text = readFileSync(new URL(`../fixtures/actor-projects/${name}.project.json`, import.meta.url), 'utf8');
    await click(page, 'retained'); await click(page, 'new'); await open(page, text);
    const reopened = await save(page); expect(reopened.source).toEqual(JSON.parse(text)); expect(reopened.text).not.toContain('rig-constraints');
  }
  await page.locator('#assembly').screenshot({ path: info.outputPath('multi-root-zero-bone.png') });
});

test('constraint preview clock, blur and disposal; measured edited/constraint workload', async ({ page }, info) => {
  // Generated workload: 16 independent 8-segment chains, each with a CCD constraint and limits.
  const source = JSON.parse(readFileSync(new URL('../fixtures/actor-projects/empty.project.json', import.meta.url), 'utf8')) as ActorProject;
  source.requiredCapabilities.push('spacelab:rig-constraints/1');
  source.parts.push({ id: 'p', name: 'Segment', revision: 1, pivot: [0, .5], unitsPerPixel: .25, artwork: { kind: 'indexed-raster', width: 4, height: 4, palette: ['#00000000', '#76a6c8ff'], layers: [{ id: 'l', name: 'L', opacity: 1, pixels: [1, 1, 1, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1, 1] }] } });
  const rig = { id: 'swarm', name: 'Swarm', nodes: [] as ActorProject['rigs'][0]['nodes'], sockets: [], constraints: [] as NonNullable<ActorProject['rigs'][0]['constraints']> };
  const clipTracks: ActorProject['clips'][0]['tracks'] = [];
  for (let c = 0; c < 16; c++) {
    rig.nodes.push({ id: `goal-${c}`, name: `Goal ${c}`, parentId: null, rest: { x: 6 * Math.cos(c), y: 6 * Math.sin(c), rotation: 0, scaleX: 1, scaleY: 1 } });
    for (let s = 0; s < 8; s++) {
      rig.nodes.push({ id: `c${c}s${s}`, name: `Chain ${c} segment ${s}`, parentId: s ? `c${c}s${s - 1}` : null, rest: { x: s ? 1 : 0, y: 0, rotation: s ? .2 : c * Math.PI / 8, scaleX: 1, scaleY: 1 }, ...(s ? { limits: { minRotation: -1.2, maxRotation: 1.2 } } : {}) });
      source.attachments.push({ id: `a${c}s${s}`, name: `Art ${c}/${s}`, partId: 'p', rigId: 'swarm', nodeId: `c${c}s${s}`, drawOrder: s, transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 } });
    }
    rig.constraints.push({ id: `ik-${c}`, name: `Reach ${c}`, solver: 'spacelab:ccd-chain/1', enabled: true, settings: { effector: { kind: 'node', id: `c${c}s7` }, chainRootId: `c${c}s0`, target: { kind: 'node', id: `goal-${c}` }, iterations: 16, tolerance: .001 } });
    clipTracks.push({ id: `t${c}`, target: { kind: 'node', rigId: 'swarm', nodeId: `goal-${c}` }, interpolation: 'linear', keys: [{ time: 0, value: rig.nodes.at(-9)!.rest }, { time: 4, value: { ...rig.nodes.at(-9)!.rest, x: -rig.nodes.at(-9)!.rest.x } }] });
  }
  source.rigs.push(rig); source.clips.push({ id: 'orbit', name: 'Orbit goals', duration: 4, playback: 'loop', tracks: clipTracks });
  await page.goto('/actor-tools.html'); await page.getByRole('button', { name: 'All tools', exact: true }).click(); await open(page, source); await page.locator('#clips').selectOption({ label: 'Orbit goals' });
  await page.evaluate(() => { window.skeletonEvidence.frameTimes = []; });
  await click(page, 'play'); await expect.poll(() => page.evaluate(() => window.skeletonEvidence.frameTimes.length)).toBeGreaterThanOrEqual(90);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const count = await page.evaluate(() => window.skeletonEvidence.matrices.length);
  await page.evaluate(() => { for (const callback of window.skeletonEvidence.callbacks) callback(performance.now() + 5000); });
  expect(await page.evaluate(() => window.skeletonEvidence.matrices.length)).toBe(count); // stale frames cannot draw after blur
  const stats = await page.evaluate(() => { const v = [...window.skeletonEvidence.frameTimes].sort((a, b) => a - b); const q = (p: number) => v[Math.min(v.length - 1, Math.floor(v.length * p))]; return { count: v.length, p50Ms: q(.5), p95Ms: q(.95), p99Ms: q(.99), browser: navigator.userAgent }; });
  await page.locator('#constraints').selectOption({ label: 'Reach 3' }); await expect(page.locator('#constraint-status')).toContainText('active');
  const reopened = await save(page); expect(reopened.source).toEqual(source);
  await page.locator('#actor-preview').screenshot({ path: info.outputPath('constraint-workload.png') });
  await click(page, 'retained'); await click(page, 'close'); await expect(page.locator('#actor-preview')).toHaveCount(0);
  const workload = { chains: 16, segmentsPerChain: 8, nodes: rig.nodes.length, attachments: source.attachments.length, constraints: 16, iterations: 16, viewport: page.viewportSize() };
  await info.attach('constraint-preview-measurements.json', { body: JSON.stringify({ ...stats, workload, boundary: 'requestAnimationFrame callback: clip sample + 16 CCD solves + full Canvas2D draw + DOM status/output + instrumentation; excludes scheduling and automation' }), contentType: 'application/json' });
  console.log(JSON.stringify({ observation: 'B1 constraint preview workload', ...stats, workload }));
  // Every host and core source file (including B1's rig, constraint and skeleton modules): no world/physics/session/renderer imports or stepping.
  const dirs = ['../../apps/web/src/actor-tools/', '../../packages/actor-tools/src/'], files = dirs.flatMap(d => readdirSync(new URL(d, import.meta.url)).filter(f => f.endsWith('.ts')).map(f => d + f));
  expect(files).toEqual(expect.arrayContaining(['../../apps/web/src/actor-tools/skeleton-panel.ts', '../../packages/actor-tools/src/rig.ts', '../../packages/actor-tools/src/constraints.ts']));
  const sources = files.map(f => readFileSync(new URL(f, import.meta.url), 'utf8'));
  const imports = sources.flatMap(s => s.match(/from\s+['"][^'"]*(?:sim-core|game-runtime|session|world|render-2d)/g) ?? []), stepping = sources.flatMap(s => s.match(/\b(?:new World|stepWorld|fixedUpdate|stepPhysics|stepAvatars)\s*\(/g) ?? []);
  expect(imports).toEqual([]); expect(stepping).toEqual([]);
  console.log(JSON.stringify({ observation: 'B1 complete actor-tools source graph audit', files: files.length, worldPhysicsImportCount: imports.length, steppingCallCount: stepping.length }));
});
