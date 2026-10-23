import { expect, test } from '@playwright/test';

test('native built runtime renders two independent analytic poses and zero-bone RGBA artwork', async ({ page }) => {
  const errors: string[] = [], external: string[] = [], runtimeRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.hostname !== '127.0.0.1') external.push(url.href);
    if (url.pathname === '/runtime/runtime.js') runtimeRequests.push(url.pathname);
  });
  await page.goto('/runtime-example/');
  const status = page.locator('#status');
  await expect(status).toContainText('independentBuffers');
  const initial = JSON.parse((await status.textContent())!);
  expect(initial.independentBuffers).toBe(true);
  expect(initial.a[0]).toBeCloseTo(1 + Math.SQRT2, 12);
  expect(initial.a[1]).toBeCloseTo(2 + Math.SQRT2, 12);
  expect(initial.b[0]).toBeCloseTo(1 - Math.SQRT2, 12);
  expect(initial.b[1]).toBeCloseTo(2 + Math.SQRT2, 12);
  expect(initial.zeroBoneY).toBe(0.5);
  await page.locator('#time-a').fill('1');
  const after = JSON.parse((await status.textContent())!);
  expect(after.a[0]).toBeCloseTo(1, 12); expect(after.a[1]).toBeCloseTo(4, 12);
  expect(after.b).toEqual(initial.b);
  await page.locator('#time-b').focus();
  await page.keyboard.press('Home');
  const keyboard = JSON.parse((await status.textContent())!);
  expect(keyboard.a).toEqual(after.a); expect(keyboard.b).toEqual([3, 2]);
  // Independent source/pixel oracle: zero-bone lamp at (0,.5), scale 35,
  // pivot (.5,.5), top-left amber at .8 opacity; top-right transparent.
  // getImageData reads raw RGBA; the white CSS background is not composited.
  const pixels = await page.locator('canvas').evaluate(canvas => {
    const ctx = (canvas as HTMLCanvasElement).getContext('2d')!;
    return [[750, 200], [768, 200]].map(([x, y]) => Array.from(ctx.getImageData(x!, y!, 1, 1).data));
  });
  for (let c = 0; c < 3; c++) expect(Math.abs(pixels[0]![c]! - [246, 186, 69][c]!)).toBeLessThanOrEqual(1);
  expect(pixels[0]![3]).toBe(204);
  expect(pixels[1]).toEqual([0, 0, 0, 0]);
  expect(runtimeRequests).toEqual(['/runtime/runtime.js']);
  expect(errors).toEqual([]); expect(external).toEqual([]);
});
