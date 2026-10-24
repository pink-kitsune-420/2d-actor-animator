import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { click, field, save, open } from './actor-animator-authoring';

const section = async (page: Page, task: string, name: string) => {
  await click(page, `task-button-${task}`); await click(page, `section-${task}-${name}`);
};
const inView = async (page: Page, id: string) => {
  const r = (await page.locator(`#${id}`).boundingBox())!;
  expect(r.y, id).toBeGreaterThanOrEqual(0); expect(r.y + r.height, id).toBeLessThanOrEqual(page.viewportSize()!.height);
};
test.beforeEach(async ({ browser }, info) => console.log(`${info.project.name} actual browser ${browser.version()}`));

test('focused sections retain pending inputs, source, history and recovery; All tools restores disclosures', async ({ page }) => {
  await page.goto('/'); await click(page, 'classic-astronaut'); const before = await save(page);
  const recovery = await page.evaluate(() => localStorage.getItem('actor-animator:draft:1'));
  const undo = await page.locator('#undo').isEnabled();
  await section(page, 'parts', 'setup'); await field(page, 'part-name', 'Pending artwork name');
  await section(page, 'rig', 'item'); await field(page, 'item-name', 'Pending joint name');
  for (const [task, sections] of Object.entries({parts:['paint','setup','layers','files'],rig:['hierarchy','item','artwork','advanced'],animate:['keys','timeline','clips','curves','compose','cels']})) {
    for (const name of sections) {
      await section(page, task, name);
      await expect(page.locator(`#section-${task}-${name}`)).toHaveAttribute('aria-pressed', 'true');
      const ids = (await page.locator(`#section-${task}-${name}`).getAttribute('aria-controls'))!.split(' ');
      for (const id of ids) await expect(page.locator(`#${id}`)).not.toHaveAttribute('hidden');
    }
  }
  await section(page, 'parts', 'setup'); await expect(page.locator('#part-name')).toHaveValue('Pending artwork name');
  await expect(page.getByText('Pivot & pixel scale', { exact:true }).locator('..')).not.toHaveAttribute('open');
  await click(page, 'task-button-all'); await expect(page.locator('#pivot-x')).toBeVisible();
  await click(page, 'task-button-parts'); await expect(page.getByText('Pivot & pixel scale', {exact:true}).locator('..')).not.toHaveAttribute('open');
  await section(page, 'rig', 'item'); await expect(page.locator('#item-name')).toHaveValue('Pending joint name');
  expect(await save(page)).toBe(before); expect(await page.locator('#undo').isEnabled()).toBe(undo);
  expect(await page.evaluate(() => localStorage.getItem('actor-animator:draft:1'))).toBe(recovery);
});

test('laptop layouts reduce inspector travel and keep canvas and transport visible', async ({ page }, info) => {
  await page.goto('/'); await click(page, 'classic-astronaut'); const baseline = await save(page);
  for (const [width,height] of [[1366,768],[1357,592],[1024,768]]) {
    await page.setViewportSize({width:width!,height:height!});
    for (const task of ['parts','rig','animate']) {
      await click(page, `task-button-${task}`);
      for (const id of ['actor-preview','play','pause','scrub','seek','preview-state']) await inView(page,id);
      const scroll = await page.locator('#workspace-inspectors').evaluate(el => el.scrollHeight);
      expect(scroll,task).toBeLessThan(task==='animate'?1600:1000);
      await page.locator('#workspace-inspectors').evaluate(el => {el.scrollTop=el.scrollHeight;});
      for (const id of ['actor-preview','play','scrub']) await inView(page,id);
      const preview = await page.locator('#preview-panel').evaluate(el=>({height:el.clientHeight,scroll:el.scrollHeight}));
      expect(preview.scroll,task).toBeLessThanOrEqual(preview.height+1);
      if(info.project.name==='chromium') {mkdirSync('test-results/evidence/ui-audit',{recursive:true});await page.screenshot({path:`test-results/evidence/ui-audit/${task}-${width}x${height}.png`});}
    }
  }
  expect(await save(page)).toBe(baseline);
});

for(const offline of [false,true]) test(`${offline?'offline':'hosted'} beginner creates artwork, attaches without bones and animates with exact undo/reopen`,async({page},info)=>{
  await page.setViewportSize({width:1366,height:768});
  const errors:string[]=[],requests:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  await page.goto(offline?pathToFileURL(resolve('dist/2D Actor Animator.html')).href:'/');
  await expect(page.locator('#next-step')).toContainText('Start with one piece of artwork');
  await click(page,'next-step-action');await expect(page.locator('#part-name')).toBeFocused();
  await field(page,'part-name','Beginner beacon');await field(page,'width',8);await field(page,'height',8);await click(page,'add-part');
  await section(page,'parts','paint');const paint=(await page.locator('#paint').boundingBox())!;await page.mouse.click(paint.x+8,paint.y+8);
  await click(page,'next-step-action');await expect(page.locator('#item-kind')).toHaveValue('attachment');await expect(page.locator('#item-name')).toBeFocused();
  await field(page,'item-name','Beacon');await click(page,'add-item');
  await click(page,'next-step-action');await expect(page.locator('#clip-name')).toBeFocused();await field(page,'clip-name','Float');await field(page,'duration',1);await click(page,'add-clip');
  await page.getByText('Two-key shortcut',{exact:true}).click();await field(page,'key-b-time',1);await field(page,'key-b-x',.5);
  const before=await save(page);await click(page,'apply-keys');const after=await save(page),s=JSON.parse(after);
  expect(s.rigs).toEqual([]);expect(s.attachments).toHaveLength(1);expect(s.clips[0].tracks[0].keys[1].value.x).toBe(.5);
  await click(page,'undo');expect(await save(page)).toBe(before);await click(page,'redo');expect(await save(page)).toBe(after);
  await click(page,'play');await expect(page.locator('#preview-state')).toContainText('Playing');await click(page,'pause');
  await click(page,'retained');await open(page,after);expect(await save(page)).toBe(after);
  await click(page,'getting-started');await expect(page.getByRole('dialog')).toContainText('Rigging in plain language');await expect(page.getByRole('dialog')).toContainText('A clip is a named motion');await page.keyboard.press('Escape');await expect(page.locator('#getting-started')).toBeFocused();
  expect(errors).toEqual([]);if(offline)expect(requests.filter(r=>/^https?:/.test(r))).toEqual([]);
  if(info.project.name==='chromium'){mkdirSync('test-results/evidence/ui-audit',{recursive:true});writeFileSync(`test-results/evidence/ui-audit/${offline?'offline':'hosted'}-beacon.actorproject`,after);}
});

test('narrow layouts and keyboard section navigation keep every tool reachable',async({page})=>{
  await page.goto('/');await click(page,'classic-astronaut');
  for(const [width,height]of [[800,768],[390,844],[683,384]]) {
    await page.setViewportSize({width:width!,height:height!});
    for(const task of ['parts','rig','animate','emotes','all']) {
      await click(page,`task-button-${task}`);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width!);
    }
  }
  await section(page,'rig','item');await page.locator('#section-rig-hierarchy').focus();await page.keyboard.press('Enter');
  await expect(page.locator('#rig-name')).toBeVisible();await expect(page.locator('#section-rig-hierarchy')).toBeFocused();
  await page.keyboard.press('Tab');await expect(page.locator('#section-rig-artwork')).toBeFocused();await page.keyboard.press('Enter');await expect(page.locator('#accept-part')).toBeVisible();
});


test('focused Timeline, Keys and Curves share selection and exact source edits',async({page})=>{
  await page.goto('/');await click(page,'classic-astronaut');const before=await save(page),expected=JSON.parse(before);
  const track=expected.clips[0].tracks[0],time=track.keys[1].time;
  await section(page,'animate','timeline');
  const key=(at:number)=>page.locator(`[data-key='${JSON.stringify(['tracks',track.id,at])}']`);
  await key(time).click();
  await section(page,'animate','keys');await expect(page.locator('#timeline-time')).toHaveValue(String(time));
  await field(page,'timeline-time',.75);await click(page,'write-key');expected.clips[0].tracks[0].keys[1].time=.75;
  expect(JSON.parse(await save(page))).toEqual(expected);
  await section(page,'animate','curves');await expect(page.locator('#curve-segment')).toContainText('0.75 → 2');
  await page.locator('#timeline-keys').selectOption('0');await expect(page.locator('#curve-segment')).toContainText('0 → 0.75');
  await section(page,'animate','timeline');await expect(key(.75)).toHaveCount(1);
  await click(page,'undo');expect(await save(page)).toBe(before);await click(page,'redo');expect(JSON.parse(await save(page))).toEqual(expected);
});
