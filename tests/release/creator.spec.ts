import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { click, field, open, save } from '../browser/actor-animator-authoring';

async function download(page:Page,id:string) { const event=page.waitForEvent('download');await click(page,id);return readFileSync((await (await event).path())!); }
async function task(page:Page,name:string) { await click(page,`task-button-${name}`); }
async function retain(page:Page) {await click(page,'retained');}
async function screen(page:Page,name:string,engine:string) {
  if(engine==='chromium') {mkdirSync('playwright-report/release-demo',{recursive:true});await page.screenshot({path:`playwright-report/release-demo/${name}.png`});}
}
test.beforeEach(async({browser},info)=>console.log(`${info.project.name} actual browser ${browser.version()}`));

for(const delivery of ['hosted','offline'] as const)for(const actor of ['character','nonhuman'] as const){
  test(`${delivery} ${actor}: artwork, rig, keys, undo/redo, original reopen and sampled output`,async({page},info)=>{
    await page.setViewportSize({width:1366,height:768});
    let scratch='';const errors:string[]=[],network:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
    if(delivery==='offline') {scratch=mkdtempSync(join(tmpdir(),'actor-release-offline-'));cpSync('_site/downloads/2D Actor Animator.html',join(scratch,'Editor.html'));await page.goto(pathToFileURL(join(scratch,'Editor.html')).href);}
    else await page.goto('./');
    try {
      if(actor==='character') {
        await click(page,'classic-astronaut');
        const before=JSON.parse(await save(page));
        await page.getByText('Pivot & pixel scale',{exact:true}).click();await field(page,'pivot-x',.25);await click(page,'pivot');
        const revised=JSON.parse(await save(page));expect(revised.parts.length).toBe(before.parts.length+1);expect(revised.attachments).toEqual(before.attachments);
        const revision=await page.locator('#parts').inputValue();
        await task(page,'rig');await page.locator('#item-kind').selectOption('attachment');await page.locator('#items').selectOption({index:0});
        await task(page,'parts');await page.locator('#parts').selectOption(revision);await task(page,'rig');await click(page,'accept-part');
        expect(JSON.parse(await save(page)).attachments.some((a:{partId:string})=>a.partId===revision)).toBe(true);
      } else {
        await click(page,'new');await field(page,'part-name','Beacon');await field(page,'width',8);await field(page,'height',8);await click(page,'add-part');
        const c=page.locator('#paint');await c.scrollIntoViewIfNeeded();const b=(await c.boundingBox())!;await page.mouse.move(b.x+24,b.y+24);await page.mouse.down();await page.mouse.move(b.x+72,b.y+72,{steps:3});await page.mouse.up();
        await page.getByText('Pivot & pixel scale',{exact:true}).click();await field(page,'units',.125);await field(page,'pivot-x',.5);await field(page,'pivot-y',.5);await click(page,'pivot');
        await task(page,'rig');await page.locator('#item-kind').selectOption('attachment');await field(page,'item-name','Light');await click(page,'add-item');
        const source=JSON.parse(await save(page));expect(source.rigs).toEqual([]);expect(source.attachments).toHaveLength(1);expect(source.parts[0].artwork.layers[0].pixels.filter((i:number)=>i===1).length).toBeGreaterThan(2);
        await page.getByText('View & playback options',{exact:true}).click();await page.locator('#preview-zoom').selectOption('128');
      }
      await task(page,'animate');await field(page,'clip-name','Release motion');await field(page,'duration',1);await click(page,'add-clip');
      await page.getByText('Two-key shortcut',{exact:true}).click();await field(page,'key-b-x',.5);await click(page,'apply-keys');
      // Inspect authoritative source rather than counting visible controls.
      const edited=await save(page),s=JSON.parse(edited),clip=s.clips.find((c:{name:string})=>c.name==='Release motion');
      expect(clip.tracks[0].keys[1].value.x).toBe(.5);
      await click(page,'undo');expect(await save(page)).not.toBe(edited);await click(page,'redo');expect(await save(page)).toBe(edited);
      await click(page,'play');await expect(page.locator('#preview-state')).toContainText('Playing');await click(page,'pause');await field(page,'seek-time',.5);await click(page,'seek');
      await screen(page,`${delivery}-${actor}-workspace`,info.project.name);
      await retain(page);await open(page,edited);expect(await save(page)).toBe(edited);
      await task(page,'animate');await page.getByText('Cels & flipbooks',{exact:true}).click();
      for(const [id,v]of [['sheet-frame-width',128],['sheet-frame-height',128],['sheet-scale',actor==='character'?64:96],['sheet-centre-y',actor==='character'?.8:0]] as const)await field(page,id,v);
      // Reopening selects the first clip: explicitly choose our authored motion.
      await page.locator('#clips').selectOption(clip.id);await click(page,'prepare-sheet');await expect(page.locator('#sheet-contact')).toBeVisible();
      const png=await download(page,'download-sheet'),metadata=await download(page,'download-sheet-metadata');const m=JSON.parse(metadata.toString());expect(m.frames).toHaveLength(4);expect(m.frames.map((f:{time:number})=>f.time)).toEqual([0,.25,.5,.75]);
      expect(await save(page)).toBe(edited);
      if(info.project.name==='chromium'){mkdirSync('playwright-report/release-demo',{recursive:true});for(const [ext,bytes]of [['actorproject',edited],['png',png],['sheet.json',metadata]] as const)writeFileSync(`playwright-report/release-demo/${delivery}-${actor}.${ext}`,bytes);await screen(page,`${delivery}-${actor}-sheet`,info.project.name);}
      if(delivery==='offline')expect(network).toEqual([]);
      else expect(network.every(url=>new URL(url).pathname.startsWith('/2d-actor-animator/'))).toBe(true);
      // Independent public consumer reads only flattened PNG + metadata.
      await page.goto('./sheet-example/');await page.locator('#metadata').setInputFiles({name:'m.json',mimeType:'application/json',buffer:metadata});await page.locator('#png').setInputFiles({name:'p.png',mimeType:'image/png',buffer:png});await expect(page.locator('#report')).toContainText('"frame": 0');
      const coloured=await page.locator('#view').evaluate((c:HTMLCanvasElement)=>{const a=c.getContext('2d')!.getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<a.length;i+=4)if(a[i])n++;return n;});expect(coloured).toBeGreaterThan(0);
      expect(errors).toEqual([]);
    } finally {if(scratch)rmSync(scratch,{recursive:true,force:true});}
  });
}

test('help traps keyboard focus, preserves draft, restores focus and explains exports offline',async({page})=>{
  await page.goto('./');await click(page,'classic-astronaut');const before=await save(page);
  await page.locator('#getting-started').focus();await page.keyboard.press('Enter');const guide=page.getByRole('dialog');await expect(guide).toBeVisible();await expect(guide.getByRole('button',{name:'Close help'})).toBeFocused();
  await expect(guide).toContainText('lossy copies');await page.keyboard.press('Tab');await page.keyboard.press('Tab');
  expect(await guide.evaluate(el=>el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');await expect(guide).toBeHidden();await expect(page.locator('#getting-started')).toBeFocused();expect(await save(page)).toBe(before);
  await page.locator('#project-options > summary').click();await page.locator('#recover').focus();await page.keyboard.press('Escape');await expect(page.locator('#project-options')).not.toHaveAttribute('open');await expect(page.locator('#project-options > summary')).toBeFocused();
});

test('storage failure, invalid/cancelled import and incomplete fields retain source safely',async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Unavailable','SecurityError');}}));
  await page.goto('./');await click(page,'classic-astronaut');const before=await save(page);
  await page.locator('#project-options > summary').click();await expect(page.locator('#recover')).toBeDisabled();await expect(page.locator('#recovery-help')).toContainText('unavailable');await page.locator('#project-options > summary').click();
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#open').setInputFiles({name:'invalid.actorproject',mimeType:'application/json',buffer:Buffer.from('{}')});await expect(page.locator('#message')).toContainText('Missing');expect(await save(page)).toBe(before);
  await page.locator('#open').dispatchEvent('cancel');await expect(page.locator('#message')).toContainText('cancelled');expect(await save(page)).toBe(before);
  await field(page,'width','');await click(page,'resize');await expect(page.locator('#message')).toContainText('finite number');expect(await save(page)).toBe(before);
  await field(page,'part-name','<img src=x onerror=alert(1)>');await click(page,'rename');expect(await page.locator('img')).toHaveCount(0);expect(JSON.parse(await save(page)).parts.some((p:{name:string})=>p.name.includes('<img'))).toBe(true);
});

test('practical sizes and effective 200 percent zoom preserve navigation and focus',async({page},info)=>{
  await page.goto('./');await click(page,'classic-astronaut');const source=await save(page);
  for(const [width,height]of [[1366,768],[1357,592],[1024,768],[800,768],[390,844],[683,384]] as const){
    await page.setViewportSize({width,height});for(const taskName of ['parts','rig','animate','emotes']){await task(page,taskName);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);await expect(page.locator(`#task-button-${taskName}`)).toHaveAttribute('aria-pressed','true');}
    await page.locator('#task-button-rig').focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');await page.keyboard.press('Enter');expect(await page.locator('#task-button-rig').evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('solid');await screen(page,`rig-${width}x${height}`,info.project.name);
  }
  expect(await save(page)).toBe(source);
});
