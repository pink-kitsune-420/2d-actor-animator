import { test, expect, type Page } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { click, field, open, save, section, revealDetails } from './actor-animator-authoring';
import type { ActorProject } from '@actor-animator/types';

async function create(page: Page) {
  await section(page,'parts','setup');await field(page,'width',4);await field(page,'height',4);await click(page,'add-part');await section(page,'parts','paint');
}
async function dot(page:Page,x=1,y=1){await page.locator('#paint').scrollIntoViewIfNeeded();const b=(await page.locator('#paint').boundingBox())!;await page.mouse.click(b.x+x*16+8,b.y+y*16+8);}
const swatch=(page:Page,index:number)=>page.locator(`#paint-swatches [data-color="${index}"]`);
test.beforeEach(async({browser},info)=>console.log(`${info.project.name} actual browser ${browser.version()}`));

test('swatches and keyboard choose ink without source edits; painting and erasing undo exactly',async({page},info)=>{
  await page.goto('/');await expect(page.locator('#paint-colour')).toBeDisabled();await expect(page.locator('#paint-eraser')).toBeDisabled();
  await create(page);const before=await save(page),recovery=await page.evaluate(()=>localStorage.getItem('actor-animator:draft:1'));
  await expect(page.locator('#palette-editor')).not.toHaveAttribute('open');await expect(page.locator('#palette')).toBeHidden();await expect(page.locator('#alpha')).toBeHidden();
  await swatch(page,2).click();await expect(swatch(page,2)).toBeFocused();await expect(swatch(page,2)).toHaveAttribute('aria-pressed','true');
  await page.keyboard.press('Home');await expect(swatch(page,0)).toBeFocused();await expect(page.locator('#paint-color-selection')).toHaveText('Transparent paint');
  await page.keyboard.press('End');await expect(swatch(page,2)).toBeFocused();await page.keyboard.press('ArrowLeft');await expect(swatch(page,1)).toBeFocused();await page.keyboard.press('ArrowRight');
  expect(await page.locator('#paint-swatches button[tabindex="0"]').count()).toBe(1);expect(await save(page)).toBe(before);
  expect(await page.evaluate(()=>localStorage.getItem('actor-animator:draft:1'))).toBe(recovery);
  await dot(page);const painted=await save(page);expect(JSON.parse(painted).parts[0].artwork.layers[0].pixels[5]).toBe(2);
  expect(await page.locator('#paint').evaluate((c:HTMLCanvasElement)=>[...c.getContext('2d')!.getImageData(1,1,1,1).data])).toEqual([255,190,85,255]);
  await click(page,'paint-eraser');await expect(page.locator('#tool')).toHaveValue('erase');await expect(page.locator('#paint-eraser')).toHaveAttribute('aria-pressed','true');await dot(page);
  expect(JSON.parse(await save(page)).parts[0].artwork.layers[0].pixels[5]).toBe(0);
  await click(page,'undo');expect(await save(page)).toBe(painted);await click(page,'undo');expect(await save(page)).toBe(before);
  await click(page,'redo');expect(await save(page)).toBe(painted);
  for(const width of [1366,800,390]){await page.setViewportSize({width,height:768});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);}
  if(info.project.name==='chromium'){mkdirSync('test-results/evidence/color-picker',{recursive:true});await page.setViewportSize({width:1366,height:768});await page.screenshot({path:'test-results/evidence/color-picker/simple-paint.png'});}
});

for(const offline of [false,true])test(`${offline?'offline':'hosted'} color picker adds ink without recoloring existing pixels; exact source and native raster reopen`,async({page})=>{
  const errors:string[]=[],requests:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  await page.goto(offline?pathToFileURL(resolve('dist/2D Actor Animator.html')).href:'/');await create(page);await dot(page,0,0);
  const before=await save(page),expected=JSON.parse(before) as ActorProject;
  await page.locator('#paint-colour').fill('#1234ab');
  const added=await save(page);expected.parts[0]!.artwork.palette.push('#1234abff');expected.parts[0]!.revision++;
  expect(JSON.parse(added)).toEqual(expected);await expect(swatch(page,3)).toHaveAttribute('aria-pressed','true');
  // Reusing a color is view state only, not another palette entry or undo step.
  await page.locator('#paint-colour').fill('#d5e8ff');await page.locator('#paint-colour').fill('#1234ab');expect(await save(page)).toBe(added);
  await dot(page);const painted=await save(page);expect(JSON.parse(painted).parts[0].artwork.layers[0].pixels.slice(0,6)).toEqual([1,0,0,0,0,3]);
  expect(await page.locator('#paint').evaluate((c:HTMLCanvasElement)=>[...c.getContext('2d')!.getImageData(1,1,1,1).data])).toEqual([18,52,171,255]);
  await click(page,'undo');expect(await save(page)).toBe(added);await click(page,'undo');expect(await save(page)).toBe(before);
  await click(page,'redo');expect(await save(page)).toBe(added);await click(page,'redo');expect(await save(page)).toBe(painted);
  await click(page,'retained');await open(page,painted);expect(await save(page)).toBe(painted);
  expect(errors).toEqual([]);if(offline)expect(requests.filter(r=>/^https?:/.test(r))).toEqual([]);
});

test('accepted artwork, exact alpha and deliberate palette recoloring stay explicit',async({page})=>{
  await page.goto('/');await click(page,'classic-astronaut');const before=JSON.parse(await save(page)) as ActorProject,partId=await page.locator('#parts').inputValue();
  await page.locator('#paint-colour').fill('#0a2b3c');const added=JSON.parse(await save(page)) as ActorProject;
  expect(added.attachments).toEqual(before.attachments);expect(added.parts.slice(0,before.parts.length)).toEqual(before.parts);
  const revision=added.parts.at(-1)!;expect(revision.id).not.toBe(partId);expect(revision.artwork.palette.at(-1)).toBe('#0a2b3cff');
  await revealDetails(page,'Edit existing colors');await page.locator('#palette').selectOption('1');await field(page,'alpha',127);await click(page,'apply-colour');
  const changed=JSON.parse(await save(page)) as ActorProject;expect(changed.attachments).toEqual(before.attachments);expect(changed.parts.at(-1)!.artwork.palette[1]!.slice(-2)).toBe('7f');
  await expect(page.locator('#paint-color-selection')).toContainText('50% opacity');
  await click(page,'undo');expect(JSON.parse(await save(page))).toEqual(added);await click(page,'undo');expect(JSON.parse(await save(page))).toEqual(before);
});

test('full palette refusal and uncommitted picker input preserve source and history',async({page})=>{
  const source=JSON.parse(readFileSync('tests/fixtures/actor-projects/empty.project.json','utf8')) as ActorProject;
  source.parts=[{id:'full',name:'Full colors',revision:3,pivot:[0,0],unitsPerPixel:.125,artwork:{kind:'indexed-raster',width:1,height:1,palette:Array.from({length:256},(_,i)=>`#${i.toString(16).padStart(2,'0').repeat(3)}ff`),layers:[{id:'ink',name:'Ink',opacity:1,pixels:[17]}]}}];
  source.extensions['foreign:colors']={retain:[true,.125]};
  await page.goto('/');await open(page,JSON.stringify(source));const before=await save(page),undo=await page.locator('#undo').isEnabled();
  await page.locator('#paint-colour').evaluate((el:HTMLInputElement)=>{el.value='#1234ab';el.dispatchEvent(new Event('input',{bubbles:true}));});expect(await save(page)).toBe(before);
  await page.locator('#paint-colour').fill('#1234ab');await expect(page.locator('#message')).toContainText('256 colors');expect(await save(page)).toBe(before);expect(await page.locator('#undo').isEnabled()).toBe(undo);
  await expect(page.locator('#paint-swatches button')).toHaveCount(256);
  await swatch(page,1).focus();await page.keyboard.press('End');await expect(swatch(page,255)).toBeFocused();expect(await save(page)).toBe(before);
});
