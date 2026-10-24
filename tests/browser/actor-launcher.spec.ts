import { test, expect, type Page } from '@playwright/test';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { click, open, save } from './actor-animator-authoring';

let scratch: string;
test.beforeEach(async ({ browser }, info) => {
  console.log(`${info.project.name} actual browser ${browser.version()}, isolated file:// HTML`);
  scratch = mkdtempSync(join(tmpdir(), 'actor-html-launcher-'));
  cpSync('dist/Actor Animator.html', join(scratch, 'Launch Actor Animator.html'));
});
test.afterEach(() => rmSync(scratch, { recursive: true, force: true }));
async function launch(page: Page) {
  const url = pathToFileURL(join(scratch, 'Launch Actor Animator.html')).href;
  const errors: string[] = [], dependencies: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (r.url() !== url && !r.url().startsWith('blob:')) dependencies.push(r.url()); });
  await page.goto(url);
  await expect(page.getByRole('button', { name: 'Example: classic astronaut', exact: true })).toBeVisible();
  expect(await page.evaluate(() => [...document.scripts].map(s => [s.type, s.src]))).toEqual([['', '']]);
  return { errors, dependencies };
}
test('relocated HTML launches offline and preserves character edit, undo, redo and downloaded source reopen', async ({ page }, info) => {
  const observed = await launch(page);
  await click(page, 'classic-astronaut');
  const before = await save(page);
  expect(JSON.parse(before)).toEqual(JSON.parse(readFileSync('apps/web/src/actor-tools/classic-astronaut.project.json', 'utf8')));
  const selected = await page.locator('#parts').inputValue();
  await page.locator('#part-name').fill('Offline edited part'); await click(page, 'rename');
  const edited = await save(page);
  expect(JSON.parse(edited).parts.find((p: { id: string }) => p.id === selected).name).toBe('Offline edited part');
  await click(page, 'undo'); expect(await save(page)).toBe(before);
  await click(page, 'redo'); expect(await save(page)).toBe(edited);
  await page.getByRole('button', { name: 'All tools', exact: true }).click();
  await click(page, 'retained'); await open(page, edited); expect(await save(page)).toBe(edited);
  const ink = await page.locator('#actor-preview').evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let n = 0; for (let i = 3; i < data.length; i += 4) if (data[i]) n++; return n;
  }); expect(ink).toBeGreaterThan(100);
  if (info.project.name === 'chromium') {
    mkdirSync('private-docs/html-launcher-demo', { recursive: true });
    await page.locator('#preview-panel').screenshot({ path: 'private-docs/html-launcher-demo/offline-character.png' });
  }
  expect(observed.errors).toEqual([]); expect(observed.dependencies).toEqual([]);
});
test('local HTML works without recovery storage and preserves zero-bone RGBA and multiple-rig originals', async ({ page }, info) => {
  await page.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage disabled', 'SecurityError'); } }));
  const observed = await launch(page);
  await page.getByRole('button', { name: 'All tools', exact: true }).click();
  const text = readFileSync('examples/spacelab/beacon.actorproject', 'utf8');
  await open(page, text); expect(JSON.parse(await save(page))).toEqual(JSON.parse(text));
  await page.locator('#preview-zoom').selectOption('64');
  await page.getByRole('button', { name: 'Animate', exact: true }).click();
  const pixels = await page.locator('#actor-preview').evaluate((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d')!, x = canvas.width / 2, y = canvas.height / 2;
    // World pixel centres (1.25,.75),(1.75,.75),(1.25,.25),(1.75,.25), 64px/unit.
    return [[80,-48],[112,-48],[80,-16],[112,-16]].map(([dx,dy]) => [...ctx.getImageData(x + dx!, y + dy!, 1, 1).data]);
  });
  for (let k = 0; k < 4; k++) expect(Math.abs(pixels[0]![k]! - [191,64,0,255][k]!)).toBeLessThanOrEqual(1);
  // Preview background is opaque #0b131b; green alpha128 composites over it.
  expect(pixels.slice(1)).toEqual([[11,19,27,255],[5,137,13,255],[255,0,0,255]]);
  const nonhuman = readFileSync(resolve('dist/rendering-example/nonhuman.actorproject'), 'utf8');
  await click(page, 'retained'); await open(page, nonhuman); const reopened = JSON.parse(await save(page));
  expect(reopened).toEqual(JSON.parse(nonhuman)); expect(reopened.rigs).toHaveLength(2);
  if (info.project.name === 'chromium') await page.locator('#preview-panel').screenshot({ path: 'private-docs/html-launcher-demo/offline-nonhuman.png' });
  expect(observed.errors).toEqual([]); expect(observed.dependencies).toEqual([]);
});
