import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { click, save, showProjects } from './actor-animator-authoring';

test.beforeEach(async ({ browser }, info) => console.log(`${info.project.name} actual browser ${browser.version()}`));

test('Projects groups actions, dismisses with keyboard or outside pointer, and never edits source', async ({ page }, info) => {
  await page.setViewportSize({ width: 1350, height: 768 }); await page.goto('/');
  const baseline = await save(page), menu = page.locator('#project-library'), summary = menu.locator(':scope > summary');
  await expect(summary).toHaveText('Projects');
  await expect(page.locator('#classic-astronaut')).toBeHidden(); await expect(page.locator('#open')).toBeHidden();
  for (const id of ['save', 'undo', 'redo']) await expect(page.locator(`#${id}`)).toBeVisible();
  await summary.focus(); await page.keyboard.press('Enter');
  for (const title of ['New project', 'Open project', 'Examples']) await expect(menu.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await page.keyboard.press('Tab'); await expect(page.locator('#new')).toBeFocused();
  await page.keyboard.press('Escape'); await expect(menu).not.toHaveAttribute('open'); await expect(summary).toBeFocused();
  expect(await save(page)).toBe(baseline);
  await showProjects(page); await page.getByRole('heading', { name: 'Actor Animator', exact: true }).click(); await expect(menu).not.toHaveAttribute('open');
  await click(page, 'task-button-all'); await expect(menu).not.toHaveAttribute('open');
  expect(await save(page)).toBe(baseline);
  if (info.project.name === 'chromium') {
    mkdirSync('test-results/evidence/project-menu-demo', { recursive: true });
    await click(page, 'classic-astronaut'); await click(page, 'task-button-rig');
    await page.screenshot({ path: 'test-results/evidence/project-menu-demo/toolbar.png' });
    await showProjects(page); await page.screenshot({ path: 'test-results/evidence/project-menu-demo/projects-open.png' });
  }
});

test('example, cancelled replacement and native source-file opening preserve authoritative originals', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await click(page, 'classic-astronaut');
  await expect(page.locator('#project-library')).not.toHaveAttribute('open');
  await expect(page.locator('#project-library > summary')).toBeFocused();
  const before = await save(page);
  expect(JSON.parse(before)).toEqual(JSON.parse(readFileSync('apps/web/src/actor-tools/classic-astronaut.project.json', 'utf8')));
  page.once('dialog', dialog => dialog.dismiss()); await click(page, 'new');
  expect(await save(page)).toBe(before);
  page.on('dialog', dialog => dialog.accept());
  const source = JSON.parse(readFileSync('tests/fixtures/actor-projects/nonhuman.project.json', 'utf8'));
  source.extensions['foreign:project-menu'] = { untouched: [1, true, 'retain'] };
  await showProjects(page); const chooser = page.waitForEvent('filechooser'); await page.locator('#open').click();
  await (await chooser).setFiles({ name: 'creature.actorproject', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
  await expect(page.locator('#message')).toHaveText('Opened complete editable source.');
  await expect(page.locator('#project-library')).not.toHaveAttribute('open');
  expect(JSON.parse(await save(page))).toEqual(source);
  await click(page, 'new'); expect(JSON.parse(await save(page)).parts).toEqual([]);
  expect(errors).toEqual([]);
});

test('project choices fit small and short windows without moving the preview', async ({ page }, info) => {
  await page.goto('/'); await click(page, 'classic-astronaut'); await click(page, 'task-button-rig');
  const source = await save(page);
  for (const [width, height] of [[1350, 768], [1024, 768], [390, 844], [683, 384]]) {
    await page.setViewportSize({ width: width!, height: height! });
    const preview = await page.locator('#actor-preview').boundingBox(); await showProjects(page);
    const panel = (await page.locator('#project-library > div').boundingBox())!;
    expect(panel.x).toBeGreaterThanOrEqual(0); expect(panel.y).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(width!); expect(panel.y + panel.height).toBeLessThanOrEqual(height!);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width!);
    await page.locator('#classic-astronaut').focus(); await expect(page.locator('#classic-astronaut')).toBeInViewport();
    await page.keyboard.press('Escape'); await expect(page.locator('#project-library > summary')).toBeFocused();
    expect(await page.locator('#actor-preview').boundingBox()).toEqual(preview);
    if (info.project.name === 'chromium' && width === 390) {
      await showProjects(page); await page.screenshot({ path: info.outputPath('projects-390.png') }); await page.keyboard.press('Escape');
    }
  }
  expect(await save(page)).toBe(source);
});
