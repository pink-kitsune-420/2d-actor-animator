import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
test('strict project path refresh, asset requests, relative demos and exact offline download',async({page,request,browser},info)=>{
  console.log(`${info.project.name} actual browser ${browser.version()}`);
  const errors:string[]=[],bad:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)bad.push(r.url());});
  await page.goto('./');await expect(page.getByRole('heading',{name:'Actor Animator',exact:true})).toBeVisible();await page.reload();await expect(page.locator('#getting-started')).toBeVisible();
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('link',{name:'Download offline HTML'}).click()]);
  const bytes=readFileSync((await download.path())!);expect(createHash('sha256').update(bytes).digest('hex')).toBe(createHash('sha256').update(readFileSync('dist/Actor Animator.html')).digest('hex'));
  for(const [path,marker]of [['runtime-example/','#status'],['rendering-example/','#report'],['spacelab-example/','#report'],['sheet-example/','#status']] as const){await page.goto('./'+path);await expect(page.locator(marker)).toBeVisible();if(path==='runtime-example/'){await page.getByRole('link',{name:'Open the authoring editor'}).click();await expect(page.locator('#save')).toBeVisible();}if(path==='rendering-example/'){await expect(page.locator('#status')).toContainText('Prepared webgl2');await page.locator('#backend').selectOption('canvas2d');await expect(page.locator('#report')).toContainText('canvas2d');}}
  expect(errors).toEqual([]);expect(bad).toEqual([]);
  for(const path of ['/','/2d-actor-animator/not-a-page','/2d-actor-animator/package.json','/2d-actor-animator/.git/config'])expect((await request.get(path)).status()).toBe(404);
});
