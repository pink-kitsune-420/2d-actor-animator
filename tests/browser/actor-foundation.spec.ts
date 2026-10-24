import { disposePage, showProjects, click as clickControl } from './actor-animator-authoring';
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { ActorProject } from '@actor-animator/types';

interface Evidence {
  matrices: number[][];
  rasters: HTMLCanvasElement[];
  callbacks: FrameRequestCallback[];
  frameTimes: number[];
  imageDrawTimes: number[];
  inputs: number[];
  frames: number;
}
declare global { interface Window { actorEvidence: Evidence } }
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.actorEvidence = { matrices: [], rasters: [], callbacks: [], frameTimes: [], imageDrawTimes: [], inputs: [], frames: 0 };
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    const instrumentedDraw = function(this: CanvasRenderingContext2D, ...args: Parameters<typeof draw>) {
      const start = performance.now();
      if (this.canvas.id === 'actor-preview') {
        const m = this.getTransform(); window.actorEvidence.matrices.push([m.a, m.b, m.c, m.d, m.e, m.f]);
        const raster = args[0] as HTMLCanvasElement; if (!window.actorEvidence.rasters.includes(raster)) window.actorEvidence.rasters.push(raster);
      }
      try { return draw.apply(this, args); } finally { if (this.canvas.id === 'actor-preview') window.actorEvidence.imageDrawTimes.push(performance.now() - start); }
    };
    CanvasRenderingContext2D.prototype.drawImage = instrumentedDraw as typeof draw;
    const request = window.requestAnimationFrame;
    window.requestAnimationFrame = callback => {
      window.actorEvidence.callbacks.push(callback);
      return request.call(window, time => {
        const start = performance.now(); try { callback(time); } finally { window.actorEvidence.frames++; window.actorEvidence.frameTimes.push(performance.now() - start); }
      });
    };
    const add = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      if (this instanceof HTMLCanvasElement && this.id === 'paint' && ['pointerdown', 'pointerup'].includes(type) && typeof listener === 'function') {
        const original = listener; listener = function(this: EventTarget, event: Event) { const start = performance.now(); try { original.call(this, event); } finally { window.actorEvidence.inputs.push(performance.now() - start); } };
      }
      add.call(this, type, listener, options);
    };
  });
});
async function click(page: Page, id: string) { await clickControl(page, id); }
async function field(page: Page, id: string, value: string | number) { await page.locator(`#${id}`).fill(String(value)); }
async function save(page: Page): Promise<{ text: string; source: ActorProject }> {
  const pending = page.waitForEvent('download'); await click(page, 'save'); const path = await (await pending).path(); expect(path).not.toBeNull();
  const text = readFileSync(path!, 'utf8'); return { text, source: JSON.parse(text) as ActorProject };
}
async function open(page: Page, source: ActorProject | string, name = 'combined.actorproject') {
  await page.locator('#open').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(typeof source === 'string' ? source : JSON.stringify(source)) });
  await expect(page.locator('#message')).toHaveText('Opened complete editable source.');
}
async function createPart(page: Page, width = 4, height = 4) {
  await field(page, 'part-name', 'Independently drawn sail'); await field(page, 'width', width); await field(page, 'height', height); await click(page, 'add-part');
}
async function dot(page: Page, x: number, y: number) {
  await page.locator('#paint').scrollIntoViewIfNeeded(); const box = (await page.locator('#paint').boundingBox())!;
  await page.mouse.click(box.x + x * 16 + 8, box.y + y * 16 + 8);
}
async function seek(page: Page, seconds: number) { await field(page, 'seek-time', seconds); await click(page, 'seek'); }
async function matrix(page: Page) { return page.evaluate(() => window.actorEvidence.matrices.at(-1)!); }
function closeMatrix(actual: number[], expected: number[]) { expect(actual).toHaveLength(6); actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 8)); }

test('draw → arbitrary three-node assembly/socket → two poses → intentional revision → combined reopen', async ({ page }, info) => {
  const errors: string[] = [], requests: string[] = []; page.on('pageerror', e => errors.push(e.message)); page.on('request', r => requests.push(r.url()));
  await page.goto('/actor-tools.html'); await page.getByRole('button', { name: 'All tools', exact: true }).click(); await createPart(page); await dot(page, 1, 0); await dot(page, 1, 1); await dot(page, 2, 1);
  await field(page, 'pivot-x', .5); await field(page, 'pivot-y', .5); await field(page, 'units', .25); await click(page, 'pivot');
  await field(page, 'rig-name', 'Kite colony'); await click(page, 'add-rig');
  await field(page, 'item-name', 'Whorl / 🪼'); await field(page, 'rest-x', 2); await field(page, 'rest-y', 3); await click(page, 'add-item'); const root = await page.locator('#items').inputValue();
  await field(page, 'item-name', 'Copper sail'); await page.locator('#parent-node').selectOption(root); await field(page, 'rest-x', 1); await field(page, 'rest-y', 0); await click(page, 'add-item'); const child = await page.locator('#items').inputValue();
  await field(page, 'item-name', 'Glass tail'); await page.locator('#parent-node').selectOption(child); await click(page, 'add-item'); const tail = await page.locator('#items').inputValue();
  await page.locator('#item-kind').selectOption('socket'); await field(page, 'item-name', 'Lantern port'); await page.locator('#parent-node').selectOption(tail); await field(page, 'rest-x', .25); await field(page, 'rest-y', -.5); await click(page, 'add-item');
  await page.locator('#item-kind').selectOption('attachment'); await field(page, 'item-name', 'Sail artwork'); await page.locator('#parent-node').selectOption(tail); await click(page, 'add-item');
  await field(page, 'clip-name', 'Turn the colony'); await click(page, 'add-clip');
  await page.locator('#track-target').selectOption({ label: 'Kite colony / Whorl / 🪼' }); await field(page, 'key-b-rotation', Math.PI); await click(page, 'apply-keys');
  await seek(page, 1); closeMatrix(await matrix(page), [0, -4, 4, 0, 344, 128]);
  await page.locator('#item-kind').selectOption('node'); await page.locator('#items').selectOption(root); await field(page, 'item-name', 'Nebula hub'); await click(page, 'apply-item');
  await page.locator('#items').selectOption(tail); await click(page, 'item-earlier'); await seek(page, 1); closeMatrix(await matrix(page), [0, -4, 4, 0, 344, 128]);
  await expect(page.locator('#node-tree')).toHaveText('Nebula hub\n  ↳ Copper sail\n    ↳ Glass tail');
  const assembled = (await save(page)).source, original = assembled.parts[0]!;
  expect(assembled.rigs[0]!.nodes.map(n => n.id)).toEqual([root, tail, child]); expect(assembled.rigs[0]!.nodes.find(n => n.id === tail)!.parentId).toBe(child);
  expect(assembled.rigs[0]!.sockets[0]!.nodeId).toBe(tail); expect(assembled.attachments[0]!.nodeId).toBe(tail);
  await dot(page, 3, 2); const edited = (await save(page)).source;
  expect(edited.parts[0]).toEqual(original); expect(edited.parts).toHaveLength(2); expect(edited.attachments).toEqual(assembled.attachments);
  await page.locator('#item-kind').selectOption('attachment'); await expect(page.locator('#revision')).toContainText(`r${original.revision}`); await click(page, 'accept-part');
  const combined = await save(page); expect(combined.source.attachments[0]!.partId).toBe(edited.parts[1]!.id); expect(combined.source.parts[1]!.revision).toBe(original.revision + 1);
  await expect(page.locator('#state')).toContainText('Unsaved'); await click(page, 'retained'); await disposePage(page); await click(page, 'reopen'); await page.getByRole('button', { name: 'All tools', exact: true }).click(); await open(page, combined.text);
  expect((await save(page)).text).toBe(combined.text); await seek(page, 1); closeMatrix(await matrix(page), [0, -4, 4, 0, 344, 128]);
  await page.locator('#assembly').screenshot({ path: info.outputPath('unconventional-assembly.png') });
  expect(errors).toEqual([]); expect(requests.some(u => /universe|world-save|\.wasm/.test(u))).toBe(false); await expect(page.locator('#flight-view')).toHaveCount(0);
  console.log(JSON.stringify({ observation: 'A3 three-node midpoint', matrix: await matrix(page), independentlyExpectedWorldAttachmentOrigin: [2, 5] }));
});

test('zero-bone attachments have linear/step boundaries, scrub, authored turns, loop, rest and reset', async ({ page }) => {
  await page.goto('/actor-tools.html'); await page.getByRole('button', { name: 'All tools', exact: true }).click(); await createPart(page, 2, 2); await dot(page, 0, 0);
  await page.locator('#item-kind').selectOption('attachment'); await field(page, 'item-name', 'Free lantern'); await click(page, 'add-item'); await click(page, 'add-clip');
  await field(page, 'key-b-x', 4); await field(page, 'key-b-y', 2); await field(page, 'key-b-rotation', 2 * Math.PI); await click(page, 'apply-keys');
  await seek(page, 1); closeMatrix(await matrix(page), [-16, 0, 0, -16, 352, 216]);
  await page.locator('#scrub').evaluate((el: HTMLInputElement) => { el.value = '.5'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  closeMatrix(await matrix(page), [0, -16, 16, 0, 304, 192]);
  await page.locator('#interpolation').selectOption('step'); await click(page, 'apply-keys'); await seek(page, 1.999); closeMatrix(await matrix(page), [16, 0, 0, 16, 320, 168]);
  await seek(page, 2); closeMatrix(await matrix(page), [16, 0, 0, 16, 384, 136]);
  await page.locator('#playback').selectOption('loop'); await click(page, 'apply-clip'); await seek(page, 2); closeMatrix(await matrix(page), [16, 0, 0, 16, 320, 168]);
  await click(page, 'rest'); await expect(page.locator('#actor-preview')).toHaveAttribute('data-clip', 'rest'); closeMatrix(await matrix(page), [16, 0, 0, 16, 320, 168]);
  await click(page, 'reset'); await expect(page.locator('#actor-preview')).toHaveAttribute('data-time', '0'); await expect(page.locator('#actor-preview')).not.toHaveAttribute('data-clip', 'rest');
  await click(page, 'play'); await expect.poll(() => page.evaluate(() => window.actorEvidence.frames)).toBeGreaterThan(4); await click(page, 'pause');
  const combined = await save(page); expect(combined.source.rigs).toEqual([]); expect(combined.source.clips[0]!.tracks[0]!.keys[1]!.value.rotation).toBe(2 * Math.PI);
  await click(page, 'retained'); await click(page, 'new'); await open(page, combined.text); expect((await save(page)).text).toBe(combined.text);
});

test('independent raster orientation, pivot and full affine shear oracle', async ({ page }, info) => {
  const source = JSON.parse(readFileSync(new URL('../fixtures/actor-projects/empty.project.json', import.meta.url), 'utf8')) as ActorProject;
  source.parts.push({ id: '🪼 / pixels', name: 'Independent colour corners', revision: 1, pivot: [.5, 1], unitsPerPixel: 2,
    artwork: { kind: 'indexed-raster', width: 2, height: 2, palette: ['#ff0000ff', '#00ff00ff', '#0000ffff', '#ffffffff'], layers: [{ id: 'ink', name: 'Corners', opacity: 1, pixels: [0, 1, 2, 3] }] } });
  source.attachments.push({ id: '__proto__', name: 'Free raster', partId: source.parts[0]!.id, drawOrder: 0, transform: { x: 3, y: -2, rotation: Math.PI / 2, scaleX: 2, scaleY: .5 } });
  await page.goto('/actor-tools.html'); await page.getByRole('button', { name: 'All tools', exact: true }).click(); await open(page, source); closeMatrix(await matrix(page), [0, -64, 16, 0, 344, 248]);
  const pixels = await page.locator('#actor-preview').evaluate((canvas: HTMLCanvasElement) => { const c = canvas.getContext('2d')!; return [[352, 216], [352, 152], [368, 216]].map(([x, y]) => Array.from(c.getImageData(x!, y!, 1, 1).data)); });
  expect(pixels).toEqual([[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]]);
  await page.locator('#actor-preview').screenshot({ path: info.outputPath('raster-orientation.png') });
  const identity = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  source.parts[0]!.pivot = [0, 0]; source.parts[0]!.unitsPerPixel = 1;
  source.rigs.push({ id: 'arbitrary rig', name: 'Shear', nodes: [{ id: 'root', name: 'Stretch', parentId: null, rest: { ...identity, scaleX: 2 } }, { id: 'child', name: 'Turn', parentId: 'root', rest: { ...identity, rotation: Math.PI / 4 } }], sockets: [] });
  Object.assign(source.attachments[0]!, { rigId: 'arbitrary rig', nodeId: 'child', transform: identity });
  // Chromium quantizes setTransform coefficients to float32, then composes
  // translate in double precision. This is a graphics-boundary oracle, separate
  // from the unchanged Float64 pose tests; the tolerance remains 1e-8.
  await open(page, source); const a = Math.fround(16 * Math.SQRT2), b = Math.fround(8 * Math.SQRT2);
  closeMatrix(await matrix(page), [a, -b, a, b, 320 - 2 * a, 200 - 2 * b]);
});

test('historical schematic and richer source stay intact; no silent truncation or extension rewriting', async ({ page }, info) => {
  await page.goto('/actor-tools.html'); await page.getByRole('button', { name: 'All tools', exact: true }).click(); await open(page, JSON.parse(readFileSync(new URL('../fixtures/actor-projects/astronaut.project.json', import.meta.url), 'utf8')));
  const schematic = (await save(page)).source; expect(schematic.rigs[0]!.nodes).toHaveLength(6); expect(schematic.provenance).toContain('First-party schematic');
  await page.locator('#preview-zoom').selectOption('128'); await click(page, 'play'); await expect.poll(() => page.evaluate(() => window.actorEvidence.frames)).toBeGreaterThan(2); await click(page, 'pause');
  await page.locator('#actor-preview').screenshot({ path: info.outputPath('schematic-starter.png') });
  await click(page, 'retained'); const track = schematic.clips[0]!.tracks[0]!; track.keys.splice(1, 0, { time: 1, value: { ...track.keys[0]!.value, rotation: 7 } });
  schematic.extensions['other:inert'] = { prototype: '__proto__', keep: [1, true, null, { nesting: 'unchanged' }] };
  await open(page, schematic); await page.locator('#track-target').selectOption({ label: 'Astronaut / Wave arm' }); await expect(page.locator('#apply-keys')).toBeDisabled(); await expect(page.locator('#track-info')).toContainText('3 keys retained');
  await field(page, 'duration', .5); await click(page, 'apply-clip'); await expect(page.locator('#message')).toContainText('Key times must strictly increase');
  const before = await save(page); expect(before.source.clips).toEqual(schematic.clips);
  await field(page, 'part-name', 'Renamed schematic helmet'); await click(page, 'rename'); const after = (await save(page)).source;
  expect(after.parts[0]).toEqual({ ...schematic.parts[0], name: 'Renamed schematic helmet' }); expect(after.parts).toHaveLength(schematic.parts.length);
  expect(after.clips).toEqual(schematic.clips); expect(after.actions).toEqual(schematic.actions); expect(after.extensions).toEqual(schematic.extensions); expect(after.attachments).toEqual(schematic.attachments);
  const input = page.locator('#item-name'); await input.fill(''); await input.pressSequentially('Native typing'); await input.press('Control+z'); await expect(input).toBeFocused(); await expect(input).not.toHaveValue('Native typing'); expect((await save(page)).source).toEqual(after);
});

test('clock, raster resources and stale callbacks stop on blur, picker, replacement and close', async ({ page }) => {
  await page.goto('/actor-tools.html'); await page.getByRole('button', { name: 'All tools', exact: true }).click(); await open(page, JSON.parse(readFileSync(new URL('../fixtures/actor-projects/astronaut.project.json', import.meta.url), 'utf8')));
  // Use the production unsaved decisions throughout this lifecycle test.
  page.on('dialog', dialog => dialog.accept());
  await click(page, 'play'); await expect.poll(() => page.evaluate(() => window.actorEvidence.frames)).toBeGreaterThan(2);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  let count = await page.evaluate(() => window.actorEvidence.matrices.length);
  await page.evaluate(() => { for (const callback of window.actorEvidence.callbacks) callback(performance.now() + 5000); });
  expect(await page.evaluate(() => window.actorEvidence.matrices.length)).toBe(count);
  await click(page, 'play'); const chooser = page.waitForEvent('filechooser'); await showProjects(page); await page.locator('#open').click(); await (await chooser).setFiles([]);
  count = await page.evaluate(() => window.actorEvidence.matrices.length);
  await page.evaluate(() => { for (const callback of window.actorEvidence.callbacks) callback(performance.now() + 5000); }); expect(await page.evaluate(() => window.actorEvidence.matrices.length)).toBe(count);
  await click(page, 'new'); expect(await page.evaluate(() => window.actorEvidence.rasters.every(c => c.width === 0 && c.height === 0))).toBe(true);
  await open(page, JSON.parse(readFileSync(new URL('../fixtures/actor-projects/astronaut.project.json', import.meta.url), 'utf8'))); await click(page, 'play'); await disposePage(page); await expect(page.locator('#actor-preview')).toHaveCount(0);
  count = await page.evaluate(() => window.actorEvidence.matrices.length);
  await page.evaluate(() => { for (const callback of window.actorEvidence.callbacks) callback(performance.now() + 5000); });
  expect(await page.evaluate(() => window.actorEvidence.matrices.length)).toBe(count); expect(await page.evaluate(() => window.actorEvidence.rasters.every(c => c.width === 0 && c.height === 0))).toBe(true);
  await click(page, 'reopen'); await page.getByRole('button', { name: 'All tools', exact: true }).click(); await expect(page.locator('#actor-preview')).toHaveAttribute('data-clip', 'rest');
});

test('attributable production preview/input measurements, retained rasters and independent source graph', async ({ page }, info) => {
  await page.goto('/actor-tools.html'); await page.getByRole('button', { name: 'All tools', exact: true }).click(); await open(page, JSON.parse(readFileSync(new URL('../fixtures/actor-projects/astronaut.project.json', import.meta.url), 'utf8')));
  await page.evaluate(() => { window.actorEvidence.frameTimes = []; window.actorEvidence.imageDrawTimes = []; });
  await click(page, 'play'); await expect.poll(() => page.evaluate(() => window.actorEvidence.frameTimes.length)).toBeGreaterThanOrEqual(90); await click(page, 'pause');
  expect(await page.evaluate(() => window.actorEvidence.rasters.length)).toBe(2);
  await page.locator('#parts').selectOption('example:helmet'); await page.locator('#zoom').selectOption('16');
  const begin = performance.now(); for (let i = 0; i < 6; i++) await dot(page, i, 4); const automationMs = performance.now() - begin;
  const measurements = await page.evaluate(() => {
    const stats = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return { count: sorted.length, p50Ms: sorted[Math.floor(sorted.length * .5)], p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))], p99Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .99))] }; };
    return { frameCallback: stats(window.actorEvidence.frameTimes), imageDrawCalls: stats(window.actorEvidence.imageDrawTimes), pointerHandlers: stats(window.actorEvidence.inputs), browser: navigator.userAgent };
  });
  const source = (await save(page)).source;
  expect(source.parts).toHaveLength(3); // one retained original and one working copy
  await info.attach('preview-measurements.json', { body: JSON.stringify({ ...measurements, viewport: page.viewportSize(), workload: 'schematic: 6 nodes, 1 socket, 6 attachments, 2 retained rasters; 6 pointer gestures create one working copy', sixAutomationClicksMs: automationMs, sourceBytes: JSON.stringify(source).length }), contentType: 'application/json' });
  console.log(JSON.stringify({ observation: 'A3 local production preview', ...measurements, viewport: page.viewportSize(), sixAutomationClicksMs: automationMs }));
  const paths = ['main.ts', 'assembly.ts', 'assembly-panel.ts', 'editing.ts', 'preview.ts', 'png.ts'].map(f => `../../apps/web/src/actor-tools/${f}`);
  paths.push(...['index.ts', 'project.ts', 'evaluator.ts'].map(f => `../../packages/actor-tools/src/${f}`));
  const files = paths.map(f => readFileSync(new URL(f, import.meta.url), 'utf8'));
  expect(files.some(s => /from\s+['"][^'"]*(?:sim-core|game-runtime|session|world|render-2d)/.test(s))).toBe(false);
  expect(files.some(s => /\b(?:new World|stepWorld|fixedUpdate|stepPhysics)\s*\(/.test(s))).toBe(false);
  console.log(JSON.stringify({ observation: 'inspected complete actor-tools host dependency graph', sourceFiles: paths, worldPhysicsImportCount: files.flatMap(s => s.match(/from\s+['"][^'"]*(?:sim-core|game-runtime|session|world|render-2d)/g) ?? []).length, steppingCallCount: files.flatMap(s => s.match(/\b(?:new World|stepWorld|fixedUpdate|stepPhysics)\s*\(/g) ?? []).length }));
});

test('layerless and unreferenced source is preserved without allocating a preview raster for every part', async ({ page }) => {
  const source = JSON.parse(readFileSync(new URL('../fixtures/actor-projects/empty.project.json', import.meta.url), 'utf8')) as ActorProject;
  for (let i = 0; i < 128; i++) {
    source.parts.push({ id: `blank/${i}`, name: `Blank ${i}`, revision: 1, pivot: [0, 0], unitsPerPixel: 1, artwork: { kind: 'indexed-raster', width: 1024, height: 1024, palette: ['#00000000'], layers: [] } });
    source.attachments.push({ id: `draw/${i}`, name: `Blank ${i}`, partId: `blank/${i}`, drawOrder: i, transform: { x: i, y: 0, rotation: 0, scaleX: 1, scaleY: 1 } });
  }
  await page.goto('/actor-tools.html'); await page.getByRole('button', { name: 'All tools', exact: true }).click();
  await page.evaluate(() => {
    const create = document.createElement; let canvases = 0;
    const instrumented = function(this: Document, ...args: Parameters<typeof create>) { if (args[0] === 'canvas') canvases++; return create.apply(this, args); };
    document.createElement = instrumented as typeof create;
    Object.defineProperty(window, 'newRasterCanvases', { get: () => canvases });
  });
  await open(page, source); expect((await save(page)).source).toEqual(source);
  expect(await page.evaluate(() => (window as unknown as { newRasterCanvases: number }).newRasterCanvases)).toBe(2); // one temporary painter composite/layer pair
  expect(await page.evaluate(() => window.actorEvidence.rasters.length)).toBe(0);
});
