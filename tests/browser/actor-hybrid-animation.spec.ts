import { test,expect } from '@playwright/test';
import { readFileSync,writeFileSync } from 'node:fs';
import type { ActorProject } from '@actor-animator/types';
import { click,field,open,save,key,addClip } from './actor-animator-authoring';
import { authorAstronautHybrid,cel,celKey,dot,part } from './actor-hybrid-authoring';

test('classic astronaut hybrid cels are authored and revised in the shared tools',async({page},info)=>{
  test.setTimeout(180_000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const text=await authorAstronautHybrid(page);
  const path=new URL('../fixtures/actor-projects/classic-astronaut-b3.project.json',import.meta.url);
  if(process.env.ACTOR_UPDATE_EXAMPLE==='1')writeFileSync(path,text+'\n');else expect(text).toBe(readFileSync(path,'utf8').trimEnd());
  await click(page,'retained');await click(page,'close');await click(page,'reopen'); await page.getByRole('button', { name: 'All tools', exact: true }).click();await open(page,text);expect(await save(page)).toBe(text);
  await page.locator('#preview-zoom').selectOption('128');await field(page,'preview-origin-y',.8);await page.locator('#preview-markers').uncheck();await click(page,'apply-preview-aids');
  for(const[name,time]of [['Idle',1],['Climb',.6],['Swim',.45]]as const){await page.locator('#clips').selectOption({label:name});await field(page,'seek-time',time);await click(page,'seek');await page.locator('#actor-preview').screenshot({path:info.outputPath(`${name}-hybrid.png`)});}
  expect(errors).toEqual([]);await info.attach('classic-astronaut-hybrid.actorproject',{body:text,contentType:'application/json'});
});

test('a six-limb keyed gait and reusable cel effect reopen with exact timing and revision acceptance',async({page},info)=>{
  await page.goto('/actor-tools.html'); await page.getByRole('button', { name: 'All tools', exact: true }).click();await open(page,readFileSync(new URL('../fixtures/actor-projects/nonhuman.project.json',import.meta.url),'utf8'));await addClip(page,'Scuttle with expression',2);
  for(let i=0;i<6;i++)for(const[t,r]of [[0,i%2?.35:-.35],[1,i%2?-.35:.35],[2,i%2?.35:-.35]])await key(page,`Freely named creature / Feeler ${i}`,t!,{rotation:r});
  await cel(page,'Creature face');await click(page,'copy-cel-art');await pPalette(page);await field(page,'colour','#ffbe55');await field(page,'alpha',255);await click(page,'apply-colour');await cel(page,'Creature blink');
  await celKey(page,'art-crown',0,'Creature face');await celKey(page,'art-crown',.7,'Creature blink');await celKey(page,'art-crown',.9,'Creature face');
  await page.locator('#cel-keys').selectOption('0.7');await field(page,'cel-key-hold',.3);await click(page,'apply-cel-hold');
  let source=JSON.parse(await save(page))as ActorProject;expect(source.clips.at(-1)!.celTracks![0]!.keys.map(k=>k.time)).toEqual([0,.7,1]);
  await page.locator('#cels').selectOption({label:'Creature blink'});await click(page,'edit-cel');await pPalette(page);await field(page,'colour','#aabbcc');await click(page,'apply-colour');const prior=JSON.parse(await save(page))as ActorProject;const celId=prior.cels!.find(c=>c.name==='Creature blink')!.id,accepted=prior.cels!.find(c=>c.id===celId)!.partId;
  await click(page,'accept-cel-part');source=JSON.parse(await save(page));expect(source.cels!.find(c=>c.id===celId)!.partId).not.toBe(accepted);
  const text=await save(page);await click(page,'undo');expect(await save(page)).not.toBe(text);await click(page,'redo');expect(await save(page)).toBe(text);
  await click(page,'retained');await click(page,'new');await open(page,text);expect(await save(page)).toBe(text);await page.locator('#clips').selectOption({label:'Scuttle with expression'});await field(page,'seek-time',.8);await click(page,'seek');await page.locator('#actor-preview').screenshot({path:info.outputPath('six-limb-hybrid.png')});
});
async function pPalette(page:import('@playwright/test').Page){await page.locator('#palette').selectOption('1');}

test('zero-bone flipbook, sheet PNG and timing/pivot metadata round trip without flattening source',async({page},info)=>{
  await page.goto('/actor-tools.html'); await page.getByRole('button', { name: 'All tools', exact: true }).click();await part(page,'White',1,1);await field(page,'pivot-x',.5);await field(page,'pivot-y',.5);await click(page,'pivot');await dot(page,0,0);await cel(page,'White cel');
  await click(page,'copy-cel-art');await page.locator('#palette').selectOption('2');await dot(page,0,0);await cel(page,'Gold cel');
  await page.locator('#item-kind').selectOption('attachment');await click(page,'add-item');await addClip(page,'Whole actor flipbook',2,'loop');const attachment=await page.locator('#cel-attachment option').first().textContent();await celKey(page,attachment!,0,'White cel');await celKey(page,attachment!,1,'Gold cel');
  await page.locator('#cel-keys').selectOption('0');await field(page,'cel-key-hold',.5);await click(page,'apply-cel-hold');const text=await save(page),source=JSON.parse(text)as ActorProject;expect(source.rigs).toEqual([]);
  await field(page,'sheet-frame-width',16);await field(page,'sheet-frame-height',16);await field(page,'sheet-scale',8);await field(page,'sheet-centre-y',0);await click(page,'prepare-sheet');await expect(page.locator('#sheet-warning')).toContainText('lossy');expect(await save(page)).toBe(text);
  const metaDownload=page.waitForEvent('download');await click(page,'download-sheet-metadata');const metadata=readFileSync((await(await metaDownload).path())!,'utf8');expect(JSON.parse(metadata).frames.map((f:{time:number})=>f.time)).toEqual([0,.5,1,1.5]);
  const pngDownload=page.waitForEvent('download');await click(page,'download-sheet');const png=readFileSync((await(await pngDownload).path())!);expect(png.subarray(1,4).toString()).toBe('PNG');expect(await save(page)).toBe(text);
  const colours=await page.evaluate(async bytes=>{const bitmap=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'}));const c=document.createElement('canvas');c.width=c.height=32;try{const ctx=c.getContext('2d')!;ctx.drawImage(bitmap,0,0);return [[8,8],[24,8],[8,24],[24,24]].map(([x,y])=>[...ctx.getImageData(x!,y!,1,1).data]);}finally{bitmap.close();c.width=c.height=0;}},[...png]);
  expect(colours).toEqual([[213,232,255,255],[255,190,85,255],[255,190,85,255],[255,190,85,255]]);
  await click(page,'retained');await click(page,'new');await page.locator('#sheet-metadata').setInputFiles({name:'sheet.json',mimeType:'application/json',buffer:Buffer.from(metadata)});await expect(page.locator('#sheet-import-status')).toContainText('4 admitted frames');await page.locator('#sheet-png').setInputFiles({name:'sheet.png',mimeType:'image/png',buffer:png});await expect(page.locator('#message')).toContainText('Flattened sheet imported');
  const imported=JSON.parse(await save(page))as ActorProject;expect(imported.rigs).toEqual([]);expect(imported.cels).toHaveLength(4);expect(imported.parts[0]!.artwork.palette).toContain('#d5e8ffff');expect(imported.parts[1]!.artwork.palette).toContain('#ffbe55ff');expect(imported.parts.every(p=>p.pivot[0]===1&&p.pivot[1]===1&&p.unitsPerPixel===.125)).toBe(true);expect(imported.clips[0]!.celTracks![0]!.keys.map(k=>k.time)).toEqual([0,.5,1,1.5]);
  const reopen=await save(page);await click(page,'retained');await click(page,'close');await click(page,'reopen'); await page.getByRole('button', { name: 'All tools', exact: true }).click();await open(page,reopen);expect(await save(page)).toBe(reopen);await page.locator('#actor-preview').screenshot({path:info.outputPath('zero-bone-sheet-roundtrip.png')});
});

test('invalid sheet metadata is atomic and late PNG encoding cannot download after replacement',async({page})=>{
  await page.goto('/actor-tools.html'); await page.getByRole('button', { name: 'All tools', exact: true }).click();const before=await save(page);await page.locator('#sheet-metadata').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"format":"unexpected"}')});await expect(page.locator('#message')).toContainText('Unexpected sheet');expect(await save(page)).toBe(before);
  await open(page,readFileSync(new URL('../fixtures/actor-projects/zero-bone.project.json',import.meta.url),'utf8'));await click(page,'prepare-sheet');
  await page.evaluate(()=>{const callbacks:BlobCallback[]=[];Object.assign(window,{sheetCallbacks:callbacks});HTMLCanvasElement.prototype.toBlob=function(callback){callbacks.push(callback);};});
  await click(page,'download-sheet');await click(page,'new');let downloads=0;page.on('download',()=>downloads++);
  await page.evaluate(async()=>{for(const c of(window as unknown as{sheetCallbacks:BlobCallback[]}).sheetCallbacks)c(new Blob(['stale'],{type:'image/png'}));await new Promise(r=>setTimeout(r,50));});expect(downloads).toBe(0);await expect(page.locator('#download-sheet')).toBeDisabled();
});
