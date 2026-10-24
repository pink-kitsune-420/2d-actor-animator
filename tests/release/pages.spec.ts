import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
test('strict project path refresh, asset requests, relative demos and exact offline download',async({page,request,browser},info)=>{
  console.log(`${info.project.name} actual browser ${browser.version()}`);
  const errors:string[]=[],bad:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)bad.push(r.url());});
  await page.goto('./');await expect(page.getByRole('heading',{name:'2D Actor Animator',exact:true})).toBeVisible();await page.reload();await expect(page.locator('#getting-started')).toBeVisible();
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('link',{name:'Download offline HTML'}).click()]);
  const bytes=readFileSync((await download.path())!);expect(createHash('sha256').update(bytes).digest('hex')).toBe(createHash('sha256').update(readFileSync('dist/2D Actor Animator.html')).digest('hex'));
  for(const [path,marker]of [['rendering-example/','#report'],['spacelab-example/','#report'],['conformance-example/','#status']] as const){await page.goto('./'+path);try{await expect(page.locator(marker)).toBeVisible();}catch(error){console.log(JSON.stringify({path,status:await page.locator('#status').textContent(),browser:browser.version()}));throw error;}if(path==='conformance-example/'){await expect(page.locator('#status')).toContainText('0 failures');const report=JSON.parse((await page.locator('#report').textContent())!);expect(report.failed).toBe(0);expect(report.cases).toHaveLength(JSON.parse(readFileSync('tests/conformance/manifest.json','utf8')).cases.length);}if(path==='rendering-example/'){await expect(page.locator('#status')).toContainText('Prepared webgl2');await page.locator('#backend').selectOption('canvas2d');await expect(page.locator('#report')).toContainText('canvas2d');}}
  expect(errors).toEqual([]);expect(bad).toEqual([]);
  for(const path of ['/','/2d-actor-animator/not-a-page','/2d-actor-animator/package.json','/2d-actor-animator/.git/config','/2d-actor-animator/runtime-example/','/2d-actor-animator/sheet-example/','/2d-actor-animator/__actor-test/sheet/','/2d-actor-animator/tests/support/sheet-consumer/index.html'])expect((await request.get(path)).status()).toBe(404);
});
