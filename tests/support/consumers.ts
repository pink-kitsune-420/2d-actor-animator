// Test-only independent consumers. These routes/files never enter a build/site.
import { test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
const files: Record<string, { file: URL; contentType: string }> = {
  'sheet/index.html': { file: new URL('./sheet-consumer/index.html', import.meta.url), contentType: 'text/html' },
  'sheet/browser.mjs': { file: new URL('./sheet-consumer/browser.mjs', import.meta.url), contentType: 'text/javascript' },
  'runtime/index.html': { file: new URL('./runtime-oracle/index.html', import.meta.url), contentType: 'text/html' },
  'runtime/browser.mjs': { file: new URL('./runtime-oracle/browser.mjs', import.meta.url), contentType: 'text/javascript' },
  'runtime/analytic-fixtures.mjs': { file: new URL('../runtime/analytic-fixtures.mjs', import.meta.url), contentType: 'text/javascript' },
};
const prepared = new WeakSet<Page>();
async function openConsumer(page: Page, name: 'sheet' | 'runtime') {
  if (!prepared.has(page)) {
    await page.route('**/__actor-test/**', async route => {
      const path = new URL(route.request().url()).pathname.split('/__actor-test/')[1] ?? '';
      const entry = files[path.endsWith('/') ? path + 'index.html' : path];
      if (!entry) { await route.fulfill({ status:404, body:'Unknown test fixture' }); return; }
      await route.fulfill({ status:200, contentType:entry.contentType, body:readFileSync(entry.file) });
    });
    prepared.add(page);
  }
  const base = test.info().project.use.baseURL;
  if (!base) throw new Error('A production test baseURL is required');
  await page.goto(new URL(`__actor-test/${name}/`, base).href);
}
export const openSheetConsumer = (page: Page) => openConsumer(page, 'sheet');
export const openRuntimeOracle = (page: Page) => openConsumer(page, 'runtime');
