import { revealDetails } from './actor-animator-authoring';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import type { ActorProject, ActorTransform } from '@actor-animator/types';

const identity = (): ActorTransform => ({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
function specimen(zero = false): ActorProject {
  const s = JSON.parse(readFileSync(new URL('../fixtures/actor-projects/empty.project.json', import.meta.url), 'utf8')) as ActorProject;
  s.name = zero ? 'Floating lantern' : 'Reflected antenna crawler';
  s.extensions['foreign:viewport'] = { untouched: [1, false, { opaque: 'kept' }] };
  s.parts.push({ id: 'p', name: 'Chitin light', revision: 7, pivot: [.5, .5], unitsPerPixel: .25, artwork: { kind: 'indexed-raster', width: 4, height: 4, palette: ['#00000000', '#ffbe55ff'], layers: [{ id: 'l', name: 'Light', opacity: 1, pixels: [0,1,1,0,1,1,1,1,1,1,1,1,0,1,1,0] }] } });
  if (!zero) {
    s.rigs.push({ id: 'r', name: 'Crawler', sockets: [], nodes: [
      { id: 'base', name: 'Reflected base', parentId: null, rest: { ...identity(), x: -2, rotation: Math.PI / 2, scaleX: -2, scaleY: 3 } },
      { id: 'tip', name: 'Antenna', parentId: 'base', rest: { ...identity(), x: 1 } },
      { id: 'free', name: 'Free root', parentId: null, rest: { ...identity(), x: 3, y: 1 } },
    ] });
    s.rigs.push({ id: 'second', name: 'Auxiliary', sockets: [], nodes: [{ id: 'beacon', name: 'Beacon', parentId: null, rest: { ...identity(), x: 3, y: -2 } }] });
  }
  s.attachments.push({ id: 'art', name: 'Antenna light', partId: 'p', drawOrder: 0, transform: { ...identity(), x: zero ? 1 : 0, scaleX: -1 }, ...(zero ? {} : { rigId: 'r', nodeId: 'tip' }) });
  s.clips.push({ id: 'c', name: 'Signal', duration: 2, playback: 'once', tracks: [] }); return s;
}
async function open(page: Page, source: ActorProject) {
  await page.locator('#open').setInputFiles({ name: 'viewport.actorproject', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
  await expect(page.locator('#message')).toHaveText('Opened complete editable source.');
}
async function save(page: Page) {
  const event = page.waitForEvent('download'); await page.locator('#save').click();
  return readFileSync((await (await event).path())!, 'utf8');
}
async function setup(page: Page, s = specimen()) {
  await page.goto('/'); await open(page, s); await page.locator('#task-button-rig').click();
  await page.getByText('View & playback options', { exact: true }).click();
  await page.locator('#preview-zoom').selectOption('16');
  await expect(page.locator('#actor-preview')).toBeVisible();
}
async function pick(page: Page, kind: string, id: string) {
  await page.locator('#item-kind').selectOption(kind); await page.locator('#items').selectOption(id);
}
async function point(page: Page, x: number, y: number, zoom = 16, viewY = 0) {
  await page.locator('#actor-preview').scrollIntoViewIfNeeded(); const b = (await page.locator('#actor-preview').boundingBox())!;
  const fit = Math.min(b.width / 640, b.height / 400), width = fit * 640, height = fit * 400;
  return { x: b.x + (b.width - width) / 2 + (320 + x * zoom) * width / 640, y: b.y + (b.height - height) / 2 + (200 + (viewY - y) * zoom) * height / 400, b: { ...b, width, height } };
}
function nearUnits(actual: number, expected: number, a: { b: { width: number; height: number } }, zoom = 16) {
  // Native engines may quantize pointer coordinates; require <1.1 delivered CSS pixels.
  expect(Math.abs(actual - expected) * zoom * Math.min(a.b.width / 640, a.b.height / 400)).toBeLessThan(1.1);
}
async function drag(page: Page, a: { x: number; y: number }, b: { x: number; y: number }) {
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 4 }); await page.mouse.up();
}
async function keepDemo(page: Page, info: TestInfo, name: string, before: string, after: string) {
  await info.attach(`${name}-before.actorproject`, { body: before, contentType: 'application/json' });
  await info.attach(`${name}-after.actorproject`, { body: after, contentType: 'application/json' });
  await page.locator('#actor-preview').screenshot({ path: info.outputPath(`${name}.png`) });
  if (info.project.name === 'chromium') {
    mkdirSync('test-results/evidence/s2-demo', { recursive: true });
    writeFileSync(`test-results/evidence/s2-demo/${name}-before.actorproject`, before);
    writeFileSync(`test-results/evidence/s2-demo/${name}-after.actorproject`, after);
    await page.locator('#preview-panel').screenshot({ path: `test-results/evidence/s2-demo/${name}.png` });
  }
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const rasters = new Set<CanvasImageSource>(), durations: number[] = [], inputs: number[] = [], matrices: number[][] = [];
    Object.assign(window, { viewportPointerId: -1 });
    window.addEventListener('pointerdown', e => { (window as unknown as { viewportPointerId: number }).viewportPointerId = e.pointerId; }, true);
    let started = 0; window.addEventListener('pointermove', () => { started = performance.now(); }, true);
    window.addEventListener('pointermove', e => { if ((e.target as HTMLElement).id === 'actor-preview' && e.buttons) inputs.push(performance.now() - started); });
    Object.assign(window, { viewportEvidence: { rasters, durations, inputs, matrices } });
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (this: CanvasRenderingContext2D, ...args: Parameters<typeof draw>) { if (this.canvas.id === 'actor-preview') { rasters.add(args[0]); const m = this.getTransform(); matrices.push([m.a,m.b,m.c,m.d,m.e,m.f]); } return draw.apply(this, args); } as typeof draw;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = cb => raf(t => { const start = performance.now(); cb(t); durations.push(performance.now() - start); });
  });
});

test('native nonhuman rest move/rotate, reflected parent math, one undo/redo and retained artwork', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await setup(page); await pick(page, 'node', 'tip'); const before = await save(page);
  // Antenna starts at project(-2,-2). Parent affine maps local delta(.5,-.25) -> world(.75,-1).
  let a = await point(page, -2, -2); await drag(page, a, { x: a.x + .75 * 16 * a.b.width / 640, y: a.y + 16 * a.b.height / 400 });
  await expect(page.locator('#viewport-status')).toContainText('one source transaction');
  let s = JSON.parse(await save(page)) as ActorProject;
  nearUnits(s.rigs[0]!.nodes[1]!.rest.x, 1.5, a); nearUnits(s.rigs[0]!.nodes[1]!.rest.y, -.25, a);
  expect(s.parts).toEqual(specimen().parts); expect(s.extensions).toEqual(specimen().extensions);
  const moved = await save(page); await page.locator('#undo').click(); expect(await save(page)).toBe(before); await page.locator('#redo').click(); expect(await save(page)).toBe(moved);
  await page.locator('#viewport-tool').selectOption('rotate'); a = await point(page, -1.25, -3);
  // Handle local vector(0,-k) under parent [0,-2,-3,0] rotates CCW to (+k,0).
  await drag(page, { x: a.x + 36, y: a.y }, { x: a.x, y: a.y + 24 * (a.b.height / 400) / (a.b.width / 640) });
  s = JSON.parse(await save(page)) as ActorProject;
  expect(s.rigs[0]!.nodes[1]!.rest.rotation).toBeCloseTo(Math.PI / 2, 1);
  expect(s.rigs[0]!.nodes[1]!.rest.scaleX).toBe(1);
  const drawn = await page.evaluate(() => (window as unknown as { viewportEvidence: { matrices: number[][] } }).viewportEvidence.matrices.at(-1)!);
  // Independent raster affine: reflected parent + local quarter turn + artwork reflection/pivot/density.
  [12, 0, 0, 8, 276, 232].forEach((v, i) => expect(Math.abs(drawn[i]! - v)).toBeLessThan(i < 4 ? .8 : 2));
  const after = await save(page); await keepDemo(page, info, 'nonhuman', before, after);
  // Selection across rigs via actual canvas; numeric options reflect that rig.
  await page.locator('#viewport-tool').selectOption('move'); a = await point(page, 3, -2); await page.mouse.click(a.x, a.y);
  await expect(page.locator('#rigs')).toHaveValue('second'); await expect(page.locator('#items')).toHaveValue('beacon');
  const resources = await page.evaluate(() => (window as unknown as { viewportEvidence: { rasters: Set<unknown> } }).viewportEvidence.rasters.size);
  expect(resources).toBe(1); expect(errors).toEqual([]);
});

test('zero-bone artwork pose at fractional seconds, cancel and native keyboard/text focus', async ({ page }, info) => {
  await setup(page, specimen(true)); await pick(page, 'attachment', 'art'); const before = await save(page);
  await page.locator('#edit-mode').selectOption('pose'); await page.locator('#seek-time').fill('.375'); await page.locator('#seek').click();
  let a = await point(page, 1, 0); await drag(page, a, { x: a.x + 16 * a.b.width / 640, y: a.y - 32 * a.b.height / 400 });
  let s = JSON.parse(await save(page)) as ActorProject;
  expect(s.rigs).toEqual([]); expect(s.attachments).toEqual(specimen(true).attachments);
  expect(s.clips[0]!.tracks[0]!.keys).toHaveLength(1);
  const key = s.clips[0]!.tracks[0]!.keys[0]!; expect(key.time).toBe(.375);
  expect(key.value).toMatchObject({ rotation: 0, scaleX: -1, scaleY: 1 }); nearUnits(key.value.x, 2, a); nearUnits(key.value.y, 2, a);
  await page.locator('#viewport-tool').selectOption('rotate'); a = await point(page, 2, 2);
  await drag(page, { x: a.x + 36, y: a.y }, { x: a.x, y: a.y - 36 * (a.b.height / 400) / (a.b.width / 640) });
  s = JSON.parse(await save(page)) as ActorProject; expect(s.clips[0]!.tracks[0]!.keys[0]!.value.rotation).toBeCloseTo(Math.PI / 2, 1);
  const after = await save(page); await keepDemo(page, info, 'zero-bone', before, after);
  await page.locator('#actor-preview').focus(); await page.keyboard.press('Control+z');
  expect((JSON.parse(await save(page)) as ActorProject).clips[0]!.tracks[0]!.keys[0]!.value.rotation).toBe(0);
  await page.locator('#actor-preview').focus(); await page.keyboard.press('Control+Shift+z'); expect(await save(page)).toBe(after);
  await page.locator('#viewport-tool').selectOption('move'); await page.locator('#actor-preview').focus(); await page.keyboard.press('ArrowRight');
  const keyboard = JSON.parse(await save(page)) as ActorProject; expect(keyboard.clips[0]!.tracks[0]!.keys[0]!.value.x).toBeGreaterThan(key.value.x);
  const nativeBefore = await save(page); await page.locator('#item-name').fill('Native text'); await page.locator('#item-name').press('Control+z'); expect(await save(page)).toBe(nativeBefore);
  await page.locator('#undo').click(); expect(await save(page)).toBe(after);
});

test('native drag cancellation, capture loss, blur, task/selection/file/source replacement and disposal are atomic', async ({ page }) => {
  await setup(page); await pick(page, 'node', 'free'); const before = await save(page);
  const begin = async () => { await page.locator('#actor-preview').focus(); const a = await point(page, 3, 1); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(a.x + 20, a.y - 10, { steps: 3 }); await expect(page.locator('#rest-x')).not.toHaveValue('3'); };
  for (const reason of ['escape', 'pointercancel', 'lostpointercapture', 'blur', 'task', 'selection', 'file', 'resize']) {
    await begin();
    if (reason === 'escape') await page.keyboard.press('Escape');
    if (reason === 'pointercancel' || reason === 'lostpointercapture') await page.locator('#actor-preview').evaluate((c, type) => { const el = c as HTMLCanvasElement, id = (window as unknown as { viewportPointerId: number }).viewportPointerId;
      if (!el.hasPointerCapture(id)) throw new Error('Expected native drag capture before cancellation');
      if (type === 'lostpointercapture') el.releasePointerCapture(id); else el.dispatchEvent(new PointerEvent(type, { pointerId: id })); }, reason);
    if (reason === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    if (reason === 'task') { await page.locator('#task-button-parts').focus(); await page.mouse.up(); await page.keyboard.press('Enter'); await page.locator('#task-button-rig').focus(); await page.keyboard.press('Enter'); }
    if (reason === 'selection') { await page.locator('#items').selectOption('base'); await page.locator('#items').selectOption('free'); }
    if (reason === 'file') { const chooser = page.waitForEvent('filechooser'); page.once('dialog', d => d.accept()); await page.locator('#project-library > summary').focus(); await page.keyboard.press('Enter'); await page.locator('#open').focus(); await page.mouse.up(); await page.keyboard.press('Enter'); await (await chooser).setFiles([]); }
    if (reason === 'resize') await page.setViewportSize({ width: 1100, height: 800 });
    await page.mouse.up(); expect(await save(page), reason).toBe(before); await expect(page.locator('#undo')).toBeDisabled();
    await page.setViewportSize({ width: 1280, height: 720 });
  }
  await begin(); await open(page, specimen(true)); await page.mouse.up(); expect((JSON.parse(await save(page)) as ActorProject).rigs).toEqual([]);
  await open(page, specimen()); await pick(page, 'node', 'free'); await begin();
  await page.getByText('Project & recovery', { exact: true }).focus(); await page.mouse.up(); await page.keyboard.press('Enter'); await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await page.mouse.up();
  await expect(page.locator('#actor-preview')).toHaveCount(0); await page.locator('#reopen').click(); await expect(page.locator('#state')).not.toContainText('Unsaved');
});

test('singular parents refuse edits, joint move preserves children, hidden settings survive and CSS-scale hit targets stay usable', async ({ page }) => {
  const s = specimen(); s.rigs[0]!.nodes[0]!.rest.scaleX = 0;
  await setup(page, s); await pick(page, 'node', 'tip'); const before = await save(page); let a = await point(page, -2, 0);
  await drag(page, a, { x: a.x + 30, y: a.y }); await expect(page.locator('#message')).toContainText('collapses space'); expect(await save(page)).toBe(before);
  await open(page, specimen()); await pick(page, 'node', 'base'); await page.locator('#viewport-tool').selectOption('joint'); a = await point(page, -2, 0);
  await drag(page, a, { x: a.x + 16 * a.b.width / 640, y: a.y });
  const moved = JSON.parse(await save(page)) as ActorProject;
  nearUnits(moved.rigs[0]!.nodes[0]!.rest.x, -1, a);
  nearUnits(moved.rigs[0]!.nodes[1]!.rest.x, 1, a); nearUnits(moved.rigs[0]!.nodes[1]!.rest.y, 1 / 3, a);
  await page.locator('#viewport-tool').selectOption('move'); await page.setViewportSize({ width: 1000, height: 780 });
  await page.locator('#preview-zoom').selectOption('64'); a = await point(page, 3, -2, 64); await page.mouse.click(a.x + 8, a.y);
  await expect(page.locator('#rigs')).toHaveValue('second'); await expect(page.locator('#items')).toHaveValue('beacon');
  await expect(page.locator('#viewport-tool')).toHaveValue('move');
});

test('classic character visible native rest and pose edits, exact source history and preview-clock measurement', async ({ page }, info) => {
  await page.goto('/'); await page.locator('#project-library > summary').click(); await page.locator('#classic-astronaut').click(); await page.locator('#task-button-rig').click();
  const original = JSON.parse(await save(page)) as ActorProject, root = original.rigs[0]!.nodes[0]!;
  await pick(page, 'node', root.id); const before = await save(page);
  let a = await point(page, 0, .8, 128, .8); await drag(page, a, { x: a.x + .125 * 128 * a.b.width / 640, y: a.y });
  let edited = JSON.parse(await save(page)) as ActorProject; nearUnits(edited.rigs[0]!.nodes[0]!.rest.x, .125, a, 128);
  await page.locator('#viewport-tool').selectOption('rotate'); a = await point(page, .125, .8, 128, .8);
  await drag(page, { x: a.x + 36, y: a.y }, { x: a.x, y: a.y - 36 * (a.b.height / 400) / (a.b.width / 640) });
  edited = JSON.parse(await save(page)) as ActorProject; expect(edited.rigs[0]!.nodes[0]!.rest.rotation).toBeCloseTo(Math.PI / 2, 1);
  const after = await save(page); await keepDemo(page, info, 'character', before, after);
  await page.locator('#edit-mode').selectOption('pose'); await page.locator('#seek-time').fill('.375'); await page.locator('#seek').click();
  await page.locator('#viewport-tool').selectOption('move'); await page.locator('#actor-preview').focus(); await page.keyboard.press('ArrowRight');
  const posed = JSON.parse(await save(page)) as ActorProject; expect(posed.rigs).toEqual(edited.rigs); expect(posed.clips[0]!.tracks.some(t => t.target.kind === 'node' && t.target.nodeId === root.id && t.keys.some(k => k.time === .375))).toBe(true);
  await page.locator('#play').click(); await expect.poll(() => page.evaluate(() => (window as unknown as { viewportEvidence: { durations: number[] } }).viewportEvidence.durations.length)).toBeGreaterThan(30);
  await page.locator('#pause').click();
  const metrics = await page.evaluate(() => { const e = (window as unknown as { viewportEvidence: { durations: number[]; inputs: number[]; rasters: Set<unknown> } }).viewportEvidence, v = [...e.durations].sort((a,b) => a-b); return { count: v.length, p50: v[Math.floor(v.length*.5)], p95: v[Math.floor(v.length*.95)], rasters: e.rasters.size, inputEvents: e.inputs.length, inputMaxMs: Math.max(0, ...e.inputs), browser: navigator.userAgent }; });
  await info.attach('viewport-playback-measurement.json', { body: JSON.stringify({ ...metrics, boundary: 'rAF callback including sample, canvas artwork/overlay, DOM status and instrumentation; excludes scheduling; inputMaxMs separately measures pointermove propagation including source clone/validation/compile/draw' }), contentType: 'application/json' });
  console.log(JSON.stringify({ observation: 'S2 overlay playback', ...metrics }));
});

test('pose dragging preserves raw keys while limits/constraints remain optional solved feedback', async ({ page }) => {
  const s = specimen(); s.requiredCapabilities.push('spacelab:rig-constraints/1');
  s.rigs[0]!.nodes = [
    { id: 'base', name: 'Base', parentId: null, rest: identity(), limits: { minRotation: -1, maxRotation: 1 } },
    { id: 'tip', name: 'Tip', parentId: 'base', rest: { ...identity(), x: 2 } },
    { id: 'goal', name: 'Goal', parentId: null, rest: { ...identity(), x: 1, y: 2 } },
  ];
  s.rigs[0]!.constraints = [{ id: 'ik', name: 'Reach', solver: 'spacelab:ccd-chain/1', enabled: true, settings: { chainRootId: 'base', effector: { kind: 'node', id: 'tip' }, target: { kind: 'node', id: 'goal' }, iterations: 16, tolerance: .001 } }];
  await setup(page, s); await pick(page, 'node', 'base'); await page.locator('#edit-mode').selectOption('pose');
  await page.locator('#seek-time').fill('.625'); await page.locator('#seek').click();
  // Solver rotates the base toward goal. Translation must key raw rotation zero.
  expect(Number(await page.locator('#rest-rotation').inputValue())).toBeGreaterThan(.5);
  const a = await point(page, 0, 0); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(a.x + 16 * a.b.width / 640, a.y);
  await expect(page.locator('#viewport-status')).toContainText('edits use raw authored TRS'); await page.mouse.up();
  const edited = JSON.parse(await save(page)) as ActorProject;
  expect(edited.clips[0]!.tracks[0]!.keys).toHaveLength(1);
  expect(edited.clips[0]!.tracks[0]!.keys[0]).toMatchObject({ time: .625, value: { rotation: 0, scaleX: 1, scaleY: 1, y: 0 } }); nearUnits(edited.clips[0]!.tracks[0]!.keys[0]!.value.x, 1, a);
  expect(edited.rigs).toEqual(s.rigs); expect(edited.parts).toEqual(s.parts);
  await page.locator('#section-rig-advanced').click(); await revealDetails(page, 'Structure, joints & constraints'); await page.locator('#apply-constraints').uncheck();
  const before = await save(page); await page.locator('#actor-preview').focus(); await page.keyboard.press('ArrowUp');
  const raw = JSON.parse(await save(page)) as ActorProject; expect(raw.clips[0]!.tracks[0]!.keys[0]!.value.rotation).toBe(0);
  await page.locator('#undo').click(); expect(await save(page)).toBe(before); await expect(page.locator('#apply-constraints')).not.toBeChecked();
});
