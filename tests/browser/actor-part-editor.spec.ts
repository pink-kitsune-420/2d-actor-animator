import { test, expect, type Page, type Download } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { showProjects, showProjectOptions } from './actor-animator-authoring';
import type { ActorProject } from '@actor-animator/types';

async function downloadText(download: Download) { const path = await download.path(); expect(path).not.toBeNull(); return readFileSync(path!, 'utf8'); }
async function save(page: Page) { const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download editable source', exact: true }).click(); return downloadText(await pending); }
async function create(page: Page, name: string) { await page.getByLabel('Part name', { exact: true }).fill(name); await page.getByRole('button', { name: 'Create part', exact: true }).click(); }
async function dot(page: Page, x: number, y: number) { await page.locator('#paint').scrollIntoViewIfNeeded(); const box = (await page.locator('#paint').boundingBox())!; await page.mouse.click(box.x + x * 16 + 8, box.y + y * 16 + 8); }

test('tail and antenna draw → undo → save → close → reopen → reuse, without world startup', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const requests: string[] = []; page.on('request', r => requests.push(r.url()));
  await page.goto('/actor-tools.html'); await page.getByRole('button', { name: 'All tools', exact: true }).click(); await create(page, 'Tail segment'); await dot(page, 1, 1); await dot(page, 2, 1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  let source = JSON.parse(await save(page)) as ActorProject; expect(source.parts[0]!.artwork.layers[0]!.pixels[17]).toBe(1); expect(source.parts[0]!.artwork.layers[0]!.pixels[18]).toBe(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await create(page, 'Antenna'); await dot(page, 4, 2); await page.getByRole('button', { name: 'Undo', exact: true }).click(); await page.getByRole('button', { name: 'Redo', exact: true }).click();
  const text = await save(page); source = JSON.parse(text); await expect(page.locator('#state')).toContainText('Unsaved'); await expect(page.locator('#message')).toContainText('Retention is unverified');
  await showProjectOptions(page); await page.getByRole('button', { name: 'I retained this source', exact: true }).click(); await page.locator('#project-options > summary').click(); await expect(page.locator('#state')).toContainText('unchanged');
  await page.reload(); await page.getByRole('button', { name: 'All tools', exact: true }).click();
  await page.locator('#open').setInputFiles({ name: 'parts.actorproject', mimeType: 'application/json', buffer: Buffer.from(text) });
  await expect(page.locator('#parts option')).toHaveCount(2); expect(JSON.parse(await save(page))).toEqual(source);
  await page.locator('#parts').selectOption(source.parts[0]!.id); await dot(page, 3, 1);
  const reused = JSON.parse(await save(page)) as ActorProject; expect(reused.parts[0]!.id).toBe(source.parts[0]!.id); expect(reused.parts[0]!.artwork.layers[0]!.pixels[19]).toBe(1); expect(reused.parts[1]).toEqual(source.parts[1]);
  expect(errors).toEqual([]); expect(requests.some(u => /universe|\.wasm|world-save/.test(u))).toBe(false); await expect(page.locator('#flight-view')).toHaveCount(0);
});

test('layers, palette alpha, fill, selection move, pivot, dimensions and grid survive source', async ({ page }) => {
  await page.goto('/actor-tools.html'); await page.getByRole('button', { name: 'All tools', exact: true }).click(); await create(page, 'Free form');
  await page.getByLabel('Alpha (0–255)', { exact: true }).fill('127'); await page.getByRole('button', { name: 'Apply palette entry', exact: true }).click();
  await dot(page, 1, 1); await page.getByRole('combobox', { name: 'Tool', exact: true }).selectOption('select');
  await dot(page, 1, 1); await page.getByRole('button', { name: 'Move selection', exact: true }).click();
  await page.getByLabel('Layer name', { exact: true }).fill('Glow'); await page.getByRole('button', { name: 'Add layer', exact: true }).click();
  await page.getByLabel('Layer opacity', { exact: true }).fill('.5'); await page.getByRole('button', { name: 'Apply layer', exact: true }).click();
  await page.getByRole('combobox', { name: 'Tool', exact: true }).selectOption('fill'); await dot(page, 0, 0);
  await page.getByLabel('Pivot X', { exact: true }).fill('2.5'); await page.getByLabel('Pivot Y', { exact: true }).fill('-1'); await page.getByRole('button', { name: 'Apply pivot and scale', exact: true }).click();
  await page.getByLabel('Width', { exact: true }).fill('20'); await page.getByRole('button', { name: 'Apply dimensions', exact: true }).click(); await page.getByLabel('Grid', { exact: true }).uncheck(); await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('8');
  const sidebar = (await page.locator('aside').boundingBox())!, pivotField = (await page.locator('#pivot-y').boundingBox())!; expect(pivotField.x + pivotField.width).toBeLessThanOrEqual(sidebar.x + sidebar.width);
  const p = (JSON.parse(await save(page)) as ActorProject).parts[0]!; expect(p.pivot).toEqual([2.5, -1]); expect(p.artwork.width).toBe(20); expect(p.artwork.palette[1]).toBe('#d5e8ff7f'); expect(p.artwork.layers[0]!.pixels[22]).toBe(1); expect(p.artwork.layers[0]!.pixels[21]).toBe(0); expect(p.artwork.layers[1]!.opacity).toBe(.5); expect(p.artwork.layers[1]!.pixels[0]).toBe(1);
});

test('pointer cancel, blur, picker cancel and disposal roll back owned gestures', async ({ page }) => {
  await page.goto('/actor-tools.html'); await page.getByRole('button', { name: 'All tools', exact: true }).click(); await create(page, 'Tail'); const baseline = JSON.parse(await save(page));
  for (const event of ['pointercancel', 'blur', 'cancel']) {
    const box = (await page.locator('#paint').boundingBox())!; await page.mouse.move(box.x + 24, box.y + 24); await page.mouse.down();
    if (event === 'pointercancel') await page.locator('#paint').dispatchEvent('pointercancel');
    if (event === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    if (event === 'cancel') await page.locator('#open').dispatchEvent('cancel');
    await page.mouse.up(); expect(JSON.parse(await save(page))).toEqual(baseline);
  }
  page.once('dialog', d => d.accept()); const box = (await page.locator('#paint').boundingBox())!; await page.mouse.move(box.x + 24, box.y + 24); await page.mouse.down();
  // pagehide uses the production disposal path while the pointer is captured.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await page.mouse.up();
  await expect(page.locator('#paint')).toHaveCount(0); await page.getByRole('button', { name: 'Reopen editor', exact: true }).click(); await page.getByRole('button', { name: 'All tools', exact: true }).click(); await expect(page.locator('#paint')).toHaveCount(1);
});

test('native text focus/undo and unsaved replacement decisions remain local', async ({ page }) => {
  await page.goto('/actor-tools.html'); await page.getByRole('button', { name: 'All tools', exact: true }).click(); await create(page, 'Tail');
  const name = page.getByLabel('Part name', { exact: true }); await name.fill(''); await name.pressSequentially('Typed name'); await name.press('Control+z'); await expect(name).toBeFocused(); await expect(name).not.toHaveValue('Typed name');
  expect((JSON.parse(await save(page)) as ActorProject).parts[0]!.name).toBe('Tail');
  page.once('dialog', d => d.dismiss()); await showProjects(page); await page.getByRole('button', { name: 'Empty project', exact: true }).click(); await expect(page.locator('#parts option')).toHaveCount(1);
  let dialogType = '';
  page.once('dialog', async d => { dialogType = d.type(); await d.dismiss(); });
  await page.close({ runBeforeUnload: true }); await expect.poll(() => dialogType).toBe('beforeunload');
  expect(page.isClosed()).toBe(false); await expect(page.locator('#paint')).toBeVisible();
  const context = page.context(), closed = page.waitForEvent('close');
  page.once('dialog', d => d.accept()); await page.close({ runBeforeUnload: true }); await closed;
  const reopened = await context.newPage(); await reopened.goto('/actor-tools.html');
  await reopened.getByRole('button', { name: 'All tools', exact: true }).click(); await showProjectOptions(reopened); await reopened.getByRole('button', { name: 'Recover local draft', exact: true }).click();
  await expect(reopened.locator('#parts option')).toHaveCount(1); await expect(reopened.locator('#state')).toContainText('Unsaved');
  await reopened.close();
});

test('complete foreign project preserved; invalid source and stale source callbacks cannot overwrite edits', async ({ page }) => {
  const fixture = readFileSync(new URL('../fixtures/actor-projects/nonhuman.project.json', import.meta.url), 'utf8');
  await page.addInitScript(() => { const text = Blob.prototype.text; Blob.prototype.text = async function() { if ((this as File).name === 'slow.actorproject') await new Promise(r => setTimeout(r, 500)); return text.call(this); }; });
  await page.goto('/actor-tools.html'); await page.getByRole('button', { name: 'All tools', exact: true }).click(); await page.locator('#open').setInputFiles({ name: 'valid.actorproject', mimeType: 'application/json', buffer: Buffer.from(fixture) }); await expect(page.locator('#state')).toContainText('1 rigs');
  await page.getByLabel('Part name', { exact: true }).fill('Changed art only'); await page.getByRole('button', { name: 'Rename part', exact: true }).click();
  const edited = JSON.parse(await save(page)); const original = JSON.parse(fixture); expect(edited.rigs).toEqual(original.rigs); expect(edited.clips).toEqual(original.clips); expect(edited.extensions).toEqual(original.extensions);
  page.once('dialog', d => d.accept()); await page.locator('#open').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{}') }); await expect(page.locator('#message')).toContainText('Missing required field'); expect(JSON.parse(await save(page))).toEqual(edited);
  expect(edited.parts[0]!.id).toBe(original.parts[0]!.id); expect(edited.parts[0]!.revision).toBe(original.parts[0]!.revision); expect(edited.attachments).toEqual(original.attachments);
  page.once('dialog', d => d.accept()); await page.locator('#open').setInputFiles({ name: 'slow.actorproject', mimeType: 'application/json', buffer: Buffer.from(fixture) }); await create(page, 'Antenna during load'); await page.waitForTimeout(650); await expect(page.locator('#parts option')).toHaveCount(original.parts.length + 1);
});

test('PNG export/import and measured production editing; oversized headers rejected before decode', async ({ page, browserName }, testInfo) => {
  await page.addInitScript(() => {
    (window as unknown as { actorInputTimes: number[] }).actorInputTimes = [];
    const add = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      if (this instanceof HTMLCanvasElement && this.id === 'paint' && ['pointerdown', 'pointerup'].includes(type) && typeof listener === 'function') {
        const original = listener; listener = function(this: EventTarget, event: Event) { const start = performance.now(); try { original.call(this, event); } finally { (window as unknown as { actorInputTimes: number[] }).actorInputTimes.push(performance.now() - start); } };
      }
      add.call(this, type, listener, options);
    };
  });
  await page.goto('/actor-tools.html'); await page.getByRole('button', { name: 'All tools', exact: true }).click(); await create(page, 'Antenna'); await dot(page, 1, 1);
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download flattened PNG', exact: true }).click(); const png = readFileSync((await (await download).path())!); await expect(page.locator('#message')).toContainText('Flattened PNG');
  await page.locator('#png').setInputFiles({ name: 'reused.png', mimeType: 'image/png', buffer: png }); await expect(page.locator('#parts option')).toHaveCount(2); await expect(page.locator('#message')).toContainText('Decode and indexing'); const decode = await page.locator('#message').textContent();
  const p = (JSON.parse(await save(page)) as ActorProject).parts; expect(p[1]!.artwork.layers[0]!.pixels).toEqual(p[0]!.artwork.layers[0]!.pixels);
  const header = Buffer.from(png); header.writeUInt32BE(100000, 16); await page.locator('#png').setInputFiles({ name: 'oversized.png', mimeType: 'image/png', buffer: header }); await expect(page.locator('#message')).toContainText('decode budget'); await expect(page.locator('#parts option')).toHaveCount(2);
  await page.evaluate(() => { (window as unknown as { actorInputTimes: number[] }).actorInputTimes = []; });
  const start = performance.now(); for (let i = 0; i < 12; i++) await dot(page, i, 4); const elapsed = performance.now() - start;
  const editingCallbacks = await page.evaluate(() => { const samples = (window as unknown as { actorInputTimes: number[] }).actorInputTimes.sort((a, b) => a - b); return { count: samples.length, medianMs: samples[Math.floor(samples.length * .5)], p95Ms: samples[Math.min(samples.length - 1, Math.floor(samples.length * .95))], p99Ms: samples[Math.min(samples.length - 1, Math.floor(samples.length * .99))] }; });
  await page.screenshot({ path: testInfo.outputPath('actor-parts.png'), fullPage: true });
  console.log(JSON.stringify({ observation: 'A2 local production browser', browserName, browser: await page.evaluate(() => navigator.userAgent), viewport: page.viewportSize(), decode, editingCallbacks, twelvePlaywrightClicksMs: elapsed }));
});

test('late PNG decode and file result after disposal are ignored', async ({ page }) => {
  await page.addInitScript(() => { const decode = window.createImageBitmap; window.createImageBitmap = ((...args: Parameters<typeof createImageBitmap>) => new Promise<ImageBitmap>((resolve, reject) => setTimeout(() => { (decode as Function)(...args).then(resolve, reject); }, 700))) as typeof createImageBitmap; });
  await page.goto('/actor-tools.html'); await page.getByRole('button', { name: 'All tools', exact: true }).click(); await create(page, 'Tail'); await dot(page, 1, 1); const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download flattened PNG', exact: true }).click(); const png = readFileSync((await (await pending).path())!);
  await page.locator('#png').setInputFiles({ name: 'late.png', mimeType: 'image/png', buffer: png }); await create(page, 'Newer antenna'); await page.waitForTimeout(850); await expect(page.locator('#parts option')).toHaveCount(2);
  await page.locator('#png').setInputFiles({ name: 'late.png', mimeType: 'image/png', buffer: png }); await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await page.waitForTimeout(850); await expect(page.getByRole('heading', { name: 'Actor tools closed' })).toBeVisible();
});

test('real file chooser empty selection releases input and preserves document', async ({ page }) => {
  await page.goto('/actor-tools.html'); await page.getByRole('button', { name: 'All tools', exact: true }).click(); await create(page, 'Retained tail'); const before = JSON.parse(await save(page));
  const chooser = page.waitForEvent('filechooser'); await page.locator('#png').click(); await (await chooser).setFiles([]);
  expect(JSON.parse(await save(page))).toEqual(before); await dot(page, 1, 1); expect((JSON.parse(await save(page)) as ActorProject).parts[0]!.artwork.layers[0]!.pixels[17]).toBe(1);
});

test('decode timeout rejects import and closes a late bitmap', async ({ page }) => {
  await page.addInitScript(() => { const decode = window.createImageBitmap; const close = ImageBitmap.prototype.close; (window as unknown as { bitmapCloses: number }).bitmapCloses = 0;
    ImageBitmap.prototype.close = function() { (window as unknown as { bitmapCloses: number }).bitmapCloses++; close.call(this); };
    window.createImageBitmap = ((...args: Parameters<typeof createImageBitmap>) => new Promise<ImageBitmap>((resolve, reject) => setTimeout(() => { (decode as Function)(...args).then(resolve, reject); }, 1800))) as typeof createImageBitmap;
  });
  await page.goto('/actor-tools.html'); await page.getByRole('button', { name: 'All tools', exact: true }).click(); await create(page, 'Antenna'); const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download flattened PNG', exact: true }).click(); const png = readFileSync((await (await pending).path())!);
  await page.locator('#png').setInputFiles({ name: 'timed-out.png', mimeType: 'image/png', buffer: png }); await expect(page.locator('#message')).toContainText('1500 ms');
  await expect.poll(() => page.evaluate(() => (window as unknown as { bitmapCloses: number }).bitmapCloses)).toBe(1); await expect(page.locator('#parts option')).toHaveCount(1);
});
