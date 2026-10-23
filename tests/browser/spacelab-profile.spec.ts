import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

test.beforeEach(async ({ browser }, info) => { console.log(`${info.project.name} actual browser ${browser.version()}`); });
test('historical profile installed consumer draws independent RGBA/pivot samples and exports exact original', async ({ page }, info) => {
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (new URL(r.url()).hostname !== '127.0.0.1') external.push(r.url()); });
  await page.goto('/spacelab-example/'); await expect(page.locator('#result')).toContainText('Accepted by historical');
  const original = await page.locator('#source').inputValue();
  expect(original).toBe(readFileSync('examples/spacelab/beacon.actorproject', 'utf8'));
  expect(JSON.parse((await page.locator('#report').textContent())!).independentBuffers).toBe(true);
  const pixels = await page.locator('canvas').evaluate(canvas => {
    const ctx = (canvas as HTMLCanvasElement).getContext('2d')!;
    return [[130,130],[150,130],[130,150],[150,150]].map(([x,y]) => Array.from(ctx.getImageData(x!,y!,1,1).data));
  });
  // TL: green alpha128/255 * opacity .5 over red => [191,64,0,255].
  // TR: coloured transparent index0. BL: green alpha128. BR: opaque red.
  for (let c=0;c<4;c++) expect(Math.abs(pixels[0]![c]!-[191,64,0,255][c]!)).toBeLessThanOrEqual(1);
  expect(pixels[1]).toEqual([0,0,0,0]); expect(pixels[2]).toEqual([0,255,0,128]); expect(pixels[3]).toEqual([255,0,0,255]);
  await page.locator('#zoom').fill('80');
  const enlarged = await page.locator('canvas').evaluate(canvas => Array.from((canvas as HTMLCanvasElement).getContext('2d')!.getImageData(180,100,1,1).data));
  expect(enlarged).toEqual(pixels[0]); expect(await page.locator('#source').inputValue()).toBe(original);
  await page.locator('#zoom').fill('40');
  await page.locator('#clip').selectOption('profile:pulse'); await page.locator('#time').fill('0.75');
  let report = JSON.parse((await page.locator('#report').textContent())!);
  expect(report.attachmentMatrices[0]).toEqual([1,0,0,1,3.25,.75]); expect(report.parts).toEqual(['profile:alternate']);
  await page.locator('#time').fill('0.875'); report = JSON.parse((await page.locator('#report').textContent())!); expect(report.visible).toEqual([0]);
  await page.locator('#time').fill('0'); await page.locator('#clip').selectOption('');
  const download = page.waitForEvent('download'); await page.locator('#download').click();
  const downloaded = readFileSync((await (await download).path())!, 'utf8'); expect(downloaded).toBe(original);
  if (info.project.name === 'chromium') {
    mkdirSync('private-docs/s5-demo', { recursive: true }); writeFileSync('private-docs/s5-demo/zero-bone.actorproject', downloaded);
    writeFileSync('private-docs/s5-demo/rgba-evidence.json', JSON.stringify({ pixels, report }, null, 2));
    await page.screenshot({ path: 'private-docs/s5-demo/zero-bone-consumer.png', fullPage: true });
  }
  expect(errors).toEqual([]); expect(external).toEqual([]);
});

test('historical profile character, bound-art multi-rig and zero-bone source stays editable in native workspace', async ({ page }, info) => {
  test.setTimeout(90_000); await page.goto('/spacelab-example/'); await expect(page.locator('#download')).toBeEnabled();
  for (const name of ['nonhuman','character','zero-bone']) {
    await page.locator('#example').selectOption(name === 'zero-bone' ? 'beacon.actorproject' : `${name}.actorproject`);
    await expect(page.locator('#result')).toContainText('Accepted by historical');
    await expect.poll(() => page.locator('#source').inputValue()).toContain(name === 'character' ? 'astronaut' : name === 'nonhuman' ? 'antenna' : 'beacon');
    const text = await page.locator('#source').inputValue(), s = JSON.parse(text);
    expect(s.rigs.length).toBe(name === 'nonhuman' ? 2 : name === 'character' ? 1 : 0);
    const ink = await page.locator('canvas').evaluate(canvas => {
      const element = canvas as HTMLCanvasElement, ctx = element.getContext('2d')!, data = ctx.getImageData(0,0,element.width,element.height).data;
      let pixels = 0; for(let i=3;i<data.length;i+=4) if(data[i]) pixels++; return pixels;
    }); expect(ink).toBeGreaterThan(name === 'character' ? 1000 : 10);
    const download = page.waitForEvent('download'); await page.locator('#download').click(); expect(readFileSync((await (await download).path())!, 'utf8')).toBe(text);
    if (info.project.name === 'chromium') { mkdirSync('private-docs/s5-demo',{recursive:true}); writeFileSync(`private-docs/s5-demo/${name}.actorproject`,text); await page.screenshot({path:`private-docs/s5-demo/${name}-consumer.png`,fullPage:true}); }
    const editor = await page.context().newPage(); editor.on('dialog', d => d.accept()); await editor.goto('/');
    await editor.locator('#open').setInputFiles({ name: `${name}.actorproject`, mimeType: 'application/json', buffer: Buffer.from(text) });
    await expect(editor.locator('#message')).toHaveText('Opened complete editable source.');
    const saved = editor.waitForEvent('download'); await editor.locator('#save').click();
    expect(JSON.parse(readFileSync((await (await saved).path())!,'utf8'))).toEqual(s);
    if(info.project.name === 'chromium') await editor.screenshot({path:`private-docs/s5-demo/${name}-workspace.png`});
    await editor.close();
  }
});

test('historical profile refusals and stale file reads preserve native text edits', async ({ page }) => {
  await page.addInitScript(() => {
    const read = File.prototype.text;
    File.prototype.text = async function() { if (this.name === 'slow.actorproject') await new Promise(resolve => setTimeout(resolve, 400)); return read.call(this); };
  });
  await page.goto('/spacelab-example/'); await expect(page.locator('#download')).toBeEnabled();
  const original = await page.locator('#source').inputValue(), invalid = JSON.parse(original); invalid.requiredCapabilities.push('future:shader/2');
  await page.locator('#source').fill(JSON.stringify(invalid)); await page.locator('#inspect').click();
  await expect(page.locator('#result')).toContainText('/requiredCapabilities/'); await expect(page.locator('#download')).toBeDisabled();
  expect(await page.locator('#source').inputValue()).toBe(JSON.stringify(invalid));
  await page.locator('#file').setInputFiles({name:'slow.actorproject',mimeType:'application/json',buffer:Buffer.from(original)});
  await page.locator('#source').fill('native edit stays'); await page.waitForTimeout(500);
  expect(await page.locator('#source').inputValue()).toBe('native edit stays'); await expect(page.locator('#download')).toBeDisabled();
  await page.locator('#source').focus(); await page.keyboard.press('End'); await page.keyboard.type('!'); await page.keyboard.press('Control+z');
  expect(await page.locator('#source').inputValue()).toBe('native edit stays');
  await page.locator('#file').setInputFiles({name:'beacon.actorproject',mimeType:'application/json',buffer:Buffer.from(original)});
  await expect(page.locator('#download')).toBeEnabled(); expect(await page.locator('#source').inputValue()).toBe(original);
});
