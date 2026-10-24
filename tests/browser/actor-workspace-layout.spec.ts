import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ActorProject } from '@actor-animator/types';
import { click, open, save, showProjectDetails, showProjectOptions } from './actor-animator-authoring';

test.beforeEach(async ({ browser }, info) => console.log(`${info.project.name} actual browser ${browser.version()}`));
async function box(page: Page, id: string) { return (await page.locator(`#${id}`).boundingBox())!; }
async function screenshot(page: Page, name: string, engine: string) {
  if (engine === 'chromium') {
    mkdirSync('test-results/evidence/workspace-layout-demo', { recursive: true });
    await page.screenshot({ path: `test-results/evidence/workspace-layout-demo/${name}.png` });
  }
}
function zoomSpecimen(): ActorProject {
  const source = JSON.parse(readFileSync('tests/fixtures/actor-projects/empty.project.json', 'utf8')) as ActorProject;
  source.name = 'Independent preview scale specimen';
  source.parts = [{ id: 'zoom:part', name: 'Half-unit square', revision: 1, pivot: [.25, .25], unitsPerPixel: .25,
    artwork: { kind: 'indexed-raster', width: 2, height: 2, palette: ['#00000000', '#ff00ffff'], layers: [{ id: 'zoom:layer', name: 'Ink', opacity: 1, pixels: [1, 1, 1, 1] }] } }];
  source.attachments = [{ id: 'zoom:art', name: 'Square', partId: 'zoom:part', drawOrder: 0, transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 } }];
  source.extensions['foreign:zoom'] = { untouched: [true, .125, 'retain'] };
  return source;
}
test('preview starts at128, keeps64 and renders larger zooms without source or raster churn', async ({ page }) => {
  await page.addInitScript(() => {
    const rasters = new Set<CanvasImageSource>(); Object.assign(window, { zoomRasters: rasters });
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function(this: CanvasRenderingContext2D, ...args: Parameters<typeof draw>) {
      if (this.canvas.id === 'actor-preview') rasters.add(args[0]);
      return draw.apply(this, args);
    } as typeof draw;
  });
  await page.goto('/'); await expect(page).toHaveTitle('2D Actor Animator');
  await expect(page.getByRole('heading', { name: '2D Actor Animator', exact: true })).toBeVisible();
  await expect(page.locator('#preview-zoom')).toHaveValue('128');
  await open(page, JSON.stringify(zoomSpecimen()));
  const source = await save(page), undo = await page.locator('#undo').isEnabled();
  const recovery = await page.evaluate(() => localStorage.getItem('actor-animator:draft:1'));
  const coloured = () => page.locator('#actor-preview').evaluate((c: HTMLCanvasElement) => {
    const pixels = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data; let count = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === 255 && pixels[i + 1] === 0 && pixels[i + 2] === 255 && pixels[i + 3] === 255) count++;
    return count;
  });
  // Independent physical size:2pixels × .25project units/pixel = .5unit square.
  expect(await coloured()).toBe(64 * 64);
  await page.getByText('View & playback options', { exact: true }).click();
  const scale = page.getByRole('combobox', { name: 'Preview pixels per unit', exact: true });
  for (const value of ['1', '4', '16', '32', '64', '128', '256', '512', '1024']) await expect(scale.locator('option').filter({ hasText: new RegExp(`^${value}$`) })).toHaveCount(1);
  for (const value of [64, 256, 512, 1024, 128]) {
    await scale.selectOption(String(value));
    expect(await coloured()).toBe(Math.min(value / 2, 640) * Math.min(value / 2, 400));
    expect(await page.locator('#undo').isEnabled()).toBe(undo);
  }
  expect(await page.evaluate(() => (window as unknown as { zoomRasters: Set<CanvasImageSource> }).zoomRasters.size)).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem('actor-animator:draft:1'))).toBe(recovery);
  expect(await save(page)).toBe(source);
});
test('64,128and256 keep viewport hit mapping and exact source undo while showing useful closeups', async ({ page }, info) => {
  await page.setViewportSize({ width: 1366, height: 768 }); await page.goto('/'); await open(page, JSON.stringify(zoomSpecimen()));
  await click(page, 'task-button-rig'); await page.locator('#item-kind').selectOption('attachment');
  await page.getByText('View & playback options', { exact: true }).click();
  const source = await save(page), scale = page.locator('#preview-zoom');
  for (const value of [64, 128, 256]) {
    await scale.selectOption(String(value));
    await page.locator('#actor-preview').scrollIntoViewIfNeeded();
    await page.locator('#preview-panel').evaluate(el => { el.scrollTop = 0; });
    const r = (await page.locator('#actor-preview').boundingBox())!, fit = Math.min(r.width / 640, r.height / 400);
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 20, y - 12, { steps: 3 }); await page.mouse.up();
    const edited = await save(page), t = (JSON.parse(edited) as ActorProject).attachments[0]!.transform;
    expect(Math.abs(t.x - 20 / (value * fit)) * value * fit).toBeLessThan(.01);
    expect(Math.abs(t.y - 12 / (value * fit)) * value * fit).toBeLessThan(.01);
    await click(page, 'undo'); expect(await save(page)).toBe(source);
    await click(page, 'redo'); expect(await save(page)).toBe(edited); await click(page, 'undo');
  }
  await save(page); await click(page, 'retained'); await click(page, 'classic-astronaut');
  if (info.project.name === 'chromium') {
    mkdirSync('test-results/evidence/preview-usability-demo', { recursive: true });
    for (const value of [64, 128, 256]) {
      await scale.selectOption(String(value));
      await page.screenshot({ path: `test-results/evidence/preview-usability-demo/actor-${value}.png` });
    }
  }
});
test('project toolbar keeps its geometry and disclosure state across All tools and other tasks', async ({ page }, info) => {
  await page.setViewportSize({ width: 1366, height: 768 }); await page.goto('/'); await click(page, 'classic-astronaut');
  const source = await save(page), toolbar = page.locator('nav[aria-label=Project]');
  const original = await toolbar.boundingBox(), saveBox = await box(page, 'save');
  const options = page.locator('#project-options'), summary = options.locator(':scope > summary');
  for (const task of ['all', 'rig', 'animate', 'emotes', 'parts', 'all']) {
    await click(page, `task-button-${task}`);
    expect(await toolbar.boundingBox(), task).toEqual(original); expect(await box(page, 'save'), task).toEqual(saveBox);
    await expect(summary).toBeVisible(); await expect(options).not.toHaveAttribute('open');
    await expect(page.locator('#retained')).toBeHidden(); await expect(page.locator('#project-library')).not.toHaveAttribute('open');
  }
  await showProjectOptions(page); expect(await toolbar.boundingBox()).toEqual(original);
  await expect(page.locator('#retained')).toBeVisible();
  // Keyboard task activation leaves an explicitly opened menu untouched.
  await page.locator('#task-button-parts').focus(); await page.keyboard.press('Enter');
  await expect(options).toHaveAttribute('open'); expect(await toolbar.boundingBox()).toEqual(original);
  await summary.focus(); await page.keyboard.press('Escape'); await expect(options).not.toHaveAttribute('open'); await expect(summary).toBeFocused();
  expect(await save(page)).toBe(source);
  await click(page, 'task-button-all'); await screenshot(page, 'stable-all-tools-toolbar', info.project.name);
});
test('All tools project details remain editable and recovery dropdown stays inside small windows', async ({ page }) => {
  await page.goto('/'); await click(page, 'classic-astronaut'); const before = await save(page);
  await click(page, 'task-button-all'); await showProjectDetails(page);
  await page.locator('#project-name').fill('Toolbar regression project'); await click(page, 'apply-project');
  const edited = JSON.parse(await save(page)); expect(edited).toEqual({ ...JSON.parse(before), name: 'Toolbar regression project' });
  await click(page, 'undo'); expect(await save(page)).toBe(before);
  for (const [width, height] of [[1366, 768], [800, 768], [390, 844], [683, 384]]) {
    await page.setViewportSize({ width: width!, height: height! }); await showProjectOptions(page);
    const menu = (await page.locator('#project-options > div').boundingBox())!;
    expect(menu.x).toBeGreaterThanOrEqual(0); expect(menu.y).toBeGreaterThanOrEqual(0);
    expect(menu.x + menu.width).toBeLessThanOrEqual(width!); expect(menu.y + menu.height).toBeLessThanOrEqual(height!);
    await page.locator('#retained').focus(); await page.keyboard.press('Escape');
    await expect(page.locator('#project-options')).not.toHaveAttribute('open');
    await expect(page.locator('#project-options > summary')).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width!);
  }
  expect(await save(page)).toBe(before);
});
test('desktop toolbar and All tools keep a persistent preview beside scrolling inspectors', async ({ page }, info) => {
  await page.setViewportSize({ width: 1357, height: 592 }); await page.goto('/'); await click(page, 'classic-astronaut');
  await click(page, 'task-button-all'); const baseline = await save(page);
  await expect(page.locator('#astronaut, #close')).toHaveCount(0);
  await expect(page.getByText('Independent local authoring, with no running world.', { exact: false })).toHaveCount(0);
  const project = await page.locator('nav[aria-label=Project]').boundingBox(); expect(project!.height).toBeLessThan(130);
  const inspector = await box(page, 'workspace-inspectors'), preview = await box(page, 'preview-panel');
  expect(preview.x).toBeGreaterThanOrEqual(inspector.x + inspector.width); expect(preview.y).toBeLessThan(320);
  expect(preview.height).toBeGreaterThan(220);
  const canvas = await box(page, 'actor-preview'); expect(canvas.y + canvas.height).toBeLessThanOrEqual(592);
  await page.locator('#workspace-inspectors').evaluate(el => { el.scrollTop = el.scrollHeight; });
  expect(await box(page, 'preview-panel')).toEqual(preview); expect(await save(page)).toBe(baseline);
  await page.locator('#workspace-inspectors').evaluate(el => { el.scrollTop = 0; });
  await screenshot(page, 'all-tools-1357x592', info.project.name);
  for (const width of [1024, 800, 390]) {
    await page.setViewportSize({ width, height: 768 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    for (const id of ['task-button-parts', 'task-button-rig', 'task-button-animate', 'task-button-emotes', 'task-button-all']) await expect(page.locator(`#${id}`)).toBeVisible();
  }
  await click(page, 'task-button-rig'); await page.locator('#project-options > summary').click();
  const menu = await page.locator('#project-options > div').boundingBox();
  expect(menu!.x).toBeGreaterThanOrEqual(0); expect(menu!.x + menu!.width).toBeLessThanOrEqual(390);
});
test('rigging gets a larger default canvas and expandable view without source, focus or gesture drift', async ({ page }, info) => {
  await page.setViewportSize({ width: 1366, height: 646 }); await page.goto('/');
  const source = readFileSync('examples/spacelab/beacon.actorproject', 'utf8'); await click(page, 'task-button-all'); await open(page, source);
  await page.locator('#preview-zoom').selectOption('64'); await click(page, 'task-button-rig');
  const baseline = await save(page), inspector = await box(page, 'workspace-inspectors'), normal = await box(page, 'actor-preview');
  expect(inspector.width).toBeLessThanOrEqual(340); expect(normal.width).toBeGreaterThan(2 * inspector.width); expect(normal.height).toBeGreaterThanOrEqual(160);
  expect(normal.y + normal.height).toBeLessThanOrEqual(646);
  await screenshot(page, 'rig-1366x646', info.project.name);
  await page.locator('#item-name').fill('Pending rig name'); await click(page, 'expand-rig-view');
  await expect(page.locator('#workspace-inspectors')).toBeHidden(); await expect(page.locator('#expand-rig-view')).toBeFocused();
  const expanded = await box(page, 'actor-preview'); expect(expanded.height).toBeGreaterThan(normal.height * 1.4); expect(expanded.width).toBeGreaterThan(normal.width);
  expect(expanded.y + expanded.height).toBeLessThanOrEqual(646);
  await screenshot(page, 'rig-expanded-1366x646', info.project.name);
  await page.keyboard.press('Escape'); await expect(page.locator('#expand-rig-view')).toBeFocused(); await expect(page.locator('#workspace-inspectors')).toBeVisible();
  await expect(page.locator('#item-name')).toHaveValue('Pending rig name'); expect(await save(page)).toBe(baseline);
  await click(page, 'expand-rig-view');
  // Independent object-fit mapping: original640x400,64px/unit, source pivot at(1.25,.75).
  const r = await box(page, 'actor-preview'), fit = Math.min(r.width / 640, r.height / 400);
  const x = r.x + (r.width - 640 * fit) / 2 + (320 + 64 * 1.25) * fit;
  const y = r.y + (r.height - 400 * fit) / 2 + (200 - 64 * .75) * fit;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 24, y - 16); await page.mouse.up();
  await click(page, 'expand-rig-view');
  const edited = JSON.parse(await save(page));
  // Browser pointer/bounding-box protocols have their own subpixel precision.
  // Keep the independent oracle within one hundredth of a CSS pixel.
  expect(Math.abs(edited.attachments[0].transform.x - (1.25 + 24 / (64 * fit))) * 64 * fit).toBeLessThan(.01);
  expect(Math.abs(edited.attachments[0].transform.y - (.75 + 16 / (64 * fit))) * 64 * fit).toBeLessThan(.01);
  await click(page, 'undo'); expect(await save(page)).toBe(baseline);
});
test('offline HTML includes the roomy rig view and restores the regular task workspace', async ({ page }, info) => {
  await page.setViewportSize({ width: 1366, height: 646 });
  await page.goto(pathToFileURL(resolve('dist/2D Actor Animator.html')).href); await click(page, 'classic-astronaut');
  await expect(page.locator('#astronaut, #close')).toHaveCount(0);
  await click(page, 'task-button-rig'); const baseline = await save(page);
  expect((await box(page, 'actor-preview')).height).toBeGreaterThanOrEqual(160);
  await screenshot(page, 'offline-rig', info.project.name);
  await click(page, 'expand-rig-view'); await expect(page.locator('#expand-rig-view')).toHaveText('Restore split view');
  await screenshot(page, 'offline-rig-expanded', info.project.name);
  await page.locator('#expand-rig-view').press('Escape'); await click(page, 'task-button-parts');
  await expect(page.locator('#task-parts')).toBeVisible(); await expect(page.locator('#expand-rig-view')).toBeHidden(); expect(await save(page)).toBe(baseline);
  await screenshot(page, 'offline-workspace', info.project.name);
});
