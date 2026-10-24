import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { ActorProject } from '@actor-animator/types';

async function task(page: Page, name: string) { await page.getByRole('button', { name, exact: true }).click(); }
async function save(page: Page) {
  const download = page.waitForEvent('download'); await task(page, 'Download editable source');
  return readFileSync((await (await download).path())!, 'utf8');
}
async function open(page: Page, text: string) {
  await page.getByLabel('Open source', { exact: true }).setInputFiles({ name: 'editable.actorproject', mimeType: 'application/json', buffer: Buffer.from(text) });
  await expect(page.locator('#message')).toHaveText('Opened complete editable source.');
}
async function inViewport(page: Page, id: string) {
  const box = (await page.locator(`#${id}`).boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
}

test('first-use astronaut: visible playback, keyboard scrub, edit/undo, download and exact reopen', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 720 }); await page.goto('/actor-tools.html');
  await expect(page.locator('#message')).toContainText('Start with the example');
  await task(page, 'Example: classic astronaut'); const baseline = await save(page);
  for (const id of ['clips', 'actor-preview', 'play', 'scrub', 'preview-state']) await inViewport(page, id);
  await page.getByRole('combobox', { name: 'Clip', exact: true }).selectOption({ label: 'Walk' });
  await task(page, 'Play clip'); await expect(page.locator('#preview-state')).toContainText('Playing'); await task(page, 'Pause');
  const scrub = page.getByLabel('Scrub clip', { exact: true }); await scrub.focus(); await scrub.press('Home'); await scrub.press('ArrowRight');
  await expect(scrub).toBeFocused(); await expect(page.locator('#actor-preview')).toHaveAttribute('data-time', '0.001');
  const previewBox = await page.locator('#actor-preview').boundingBox();
  const painting = page.locator('#paint'); await painting.scrollIntoViewIfNeeded(); const paintBox = (await painting.boundingBox())!;
  await page.mouse.click(paintBox.x + 8, paintBox.y + 8);
  await expect(page.locator('#message')).toContainText('accept it explicitly');
  const edited = JSON.parse(await save(page)) as ActorProject;
  // An accepted attachment keeps the original artwork while a new revision is painted.
  expect(edited.parts.length).toBe(JSON.parse(baseline).parts.length + 1);
  expect(edited.attachments).toEqual(JSON.parse(baseline).attachments);
  await task(page, 'Undo'); expect(await save(page)).toBe(baseline);
  expect(await page.locator('#actor-preview').boundingBox()).toEqual(previewBox);
  await expect(page.locator('#message')).toContainText('Retention is unverified');
  await page.getByText('Project & recovery', { exact: true }).click(); await task(page, 'I retained this source');
  await expect(page.locator('#state')).toContainText('unchanged'); await page.reload();
  await open(page, baseline); expect(await save(page)).toBe(baseline);
  await info.attach('editable-source.actorproject', { body: baseline, contentType: 'application/json' });
  await page.screenshot({ path: info.outputPath('approachable-parts-1280.png') }); expect(errors).toEqual([]);
});

test('navigation preserves source, selections and pending text; advanced controls and native focus remain reachable', async ({ page }) => {
  await page.goto('/actor-tools.html'); await task(page, 'Example: classic astronaut'); const baseline = await save(page);
  const name = page.getByLabel('Part name', { exact: true }); await name.fill(''); await name.pressSequentially('Unapplied name');
  await name.press('Control+z'); await expect(name).toBeFocused(); await expect(name).not.toHaveValue('Unapplied name');
  await name.fill('Pending name');
  await task(page, 'Rig'); await page.getByRole('combobox', { name: 'Assembly item', exact: true }).selectOption({ index: 2 }); const item = await page.locator('#items').inputValue();
  await page.getByText('Structure, joints & constraints', { exact: true }).click(); await expect(page.locator('#constraints')).toBeVisible();
  await task(page, 'Animate'); await expect(page.locator('#timeline-time')).toBeVisible();
  for (const label of ['Cels & flipbooks', 'Composition: layers, states & transitions', 'Preview aids: speed, grid & onion skins']) {
    await page.getByText(label, { exact: true }).click();
  }
  await expect(page.locator('#animators')).toBeVisible(); await expect(page.locator('#cels')).toBeVisible();
  await task(page, 'Rig'); await expect(page.locator('#items')).toHaveValue(item);
  await task(page, 'Parts'); await expect(name).toHaveValue('Pending name'); expect(await save(page)).toBe(baseline);
  const rigButton = page.getByRole('button', { name: 'Rig', exact: true }); await rigButton.focus(); await rigButton.press('Enter');
  await expect(rigButton).toBeFocused(); await expect(rigButton).toHaveAttribute('aria-pressed', 'true');
  expect(await rigButton.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
  await rigButton.press('Tab'); await expect(page.getByRole('button', { name: 'Animate', exact: true })).toBeFocused();
  await task(page, 'All tools');
  for (const id of ['pivot-x', 'constraints', 'animators', 'cels', 'emote-binding-name']) await expect(page.locator(`#${id}`)).toBeVisible();
  expect(await save(page)).toBe(baseline);
});

test('nonhuman editing and a zero-bone scene are authored through task flows', async ({ page }, info) => {
  await page.goto('/actor-tools.html');
  const fixture = readFileSync(new URL('../fixtures/actor-projects/nonhuman.project.json', import.meta.url), 'utf8'); await open(page, fixture);
  const baseline = await save(page); await task(page, 'Rig');
  await page.getByRole('combobox', { name: 'Assembly item', exact: true }).selectOption({ label: 'Child · Feeler 0' });
  await page.getByLabel('Item name', { exact: true }).fill('Luminous feeler'); await task(page, 'Apply name, draw order and transform');
  const creature = JSON.parse(await save(page)) as ActorProject;
  expect(creature.rigs[0]!.nodes.some(n => n.name === 'Luminous feeler')).toBe(true);
  expect(creature.rigs[0]!.nodes.length).toBe(JSON.parse(fixture).rigs[0].nodes.length);
  await task(page, 'Undo'); expect(await save(page)).toBe(baseline);
  await page.screenshot({ path: info.outputPath('nonhuman-rig.png') });
  await task(page, 'Empty project'); await task(page, 'Parts');
  await page.getByLabel('Part name', { exact: true }).fill('Floating lantern'); await page.getByLabel('Width', { exact: true }).fill('16'); await page.getByLabel('Height', { exact: true }).fill('16'); await task(page, 'Create part');
  const canvas = page.locator('#paint'); await canvas.scrollIntoViewIfNeeded(); const box = (await canvas.boundingBox())!; await page.mouse.click(box.x + 24, box.y + 24);
  await task(page, 'Rig'); await page.getByRole('combobox', { name: 'Item kind', exact: true }).selectOption('attachment'); await task(page, 'Create item');
  await task(page, 'Animate'); await page.getByLabel('Clip name', { exact: true }).fill('Glow'); await task(page, 'Create clip');
  await page.getByText('Two-key shortcut', { exact: true }).click(); await page.getByLabel('Key B X', { exact: true }).fill('2'); await task(page, 'Apply two keys');
  await task(page, 'Play clip'); await task(page, 'Pause'); const lantern = JSON.parse(await save(page)) as ActorProject;
  expect(lantern.rigs).toEqual([]); expect(lantern.attachments).toHaveLength(1); expect(lantern.clips[0]!.tracks[0]!.keys[1]!.value.x).toBe(2);
  expect(lantern.parts[0]!.artwork.layers[0]!.pixels[17]).toBe(1);
});

test('emote select/seek/swap, independent viewport and task changes own their clocks and gestures', async ({ page }, info) => {
  await page.goto('/actor-tools.html'); await task(page, 'Example: classic astronaut'); const before = await save(page);
  await task(page, 'Emotes'); await page.getByRole('combobox', { name: 'Authored emote', exact: true }).selectOption({ label: 'High five' });
  await page.getByLabel('Choreography seek (s)', { exact: true }).fill('1'); await task(page, 'Seek choreography');
  await expect(page.locator('#emote-preview')).toHaveAttribute('data-time', '1'); await expect(page.locator('#emote-preview')).toHaveAttribute('data-roles', 'initiator,receiver');
  await task(page, 'Swap source roles'); await task(page, 'Seek choreography'); await expect(page.locator('#emote-preview')).toHaveAttribute('data-roles', 'receiver,initiator');
  await page.screenshot({ path: info.outputPath('approachable-emotes.png') });
  await task(page, 'Play choreography'); await expect(page.locator('#emote-status')).toContainText('Playing'); await task(page, 'Parts');
  const time = await page.locator('#emote-preview').getAttribute('data-time'); await page.waitForTimeout(100); await expect(page.locator('#emote-preview')).toHaveAttribute('data-time', time!);
  const canvas = page.locator('#paint'); const box = (await canvas.boundingBox())!; await page.mouse.move(box.x + 24, box.y + 24); await page.mouse.down();
  // A keyboard task activation while the canvas owns a pointer must roll the gesture back.
  await page.getByRole('button', { name: 'Animate', exact: true }).focus(); await page.keyboard.press('Enter'); await page.mouse.up();
  expect(await save(page)).toBe(before);
  await task(page, 'Play clip'); await task(page, 'Rig'); const clipTime = await page.locator('#actor-preview').getAttribute('data-time');
  await page.waitForTimeout(100); await expect(page.locator('#actor-preview')).toHaveAttribute('data-time', clipTime!);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await expect(page.locator('#actor-preview')).toHaveCount(0);
});

test('practical window sizes keep tasks and previews usable without document overflow', async ({ page }, info) => {
  await page.goto('/actor-tools.html'); await task(page, 'Example: classic astronaut');
  for (const [width, height] of [[1280, 720], [1024, 768], [800, 700], [390, 844]]) {
    await page.setViewportSize({ width: width!, height: height! }); await task(page, 'Animate');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width!);
    await expect(page.getByRole('button', { name: 'Parts', exact: true })).toBeVisible(); await expect(page.getByLabel('Scrub clip', { exact: true })).toBeVisible();
    if (width! >= 1024) {
      for (const id of ['actor-preview', 'play', 'scrub']) await inViewport(page, id);
      const rect = await page.locator('#actor-preview').boundingBox(); await page.locator('#workspace-inspectors').evaluate(el => { el.scrollTop = el.scrollHeight; });
      expect(await page.locator('#actor-preview').boundingBox()).toEqual(rect);
    }
    await page.screenshot({ path: info.outputPath(`animate-${width}x${height}.png`) });
  }
});
