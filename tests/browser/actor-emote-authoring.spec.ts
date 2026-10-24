import { test,expect } from '@playwright/test';
import { readFileSync,writeFileSync,readdirSync } from 'node:fs';
import type { ActorProject } from '@actor-animator/types';
import { showProjectDetails, disposePage, click,field,open,save } from './actor-animator-authoring';
import { authorAstronautEmotes,authorNonhumanEmotes } from './actor-emote-authoring-steps';

interface Draws{roles:{role:string|undefined;time:string|undefined;instance:string}[];points:number[][];callbacks:FrameRequestCallback[];frameTimes:number[]}
declare global{interface Window{emoteEvidence:Draws}}
test.beforeEach(async({page})=>{await page.addInitScript(()=>{
  window.emoteEvidence={roles:[],points:[],callbacks:[],frameTimes:[]};const clear=CanvasRenderingContext2D.prototype.clearRect,draw=CanvasRenderingContext2D.prototype.drawImage,arc=CanvasRenderingContext2D.prototype.arc,raf=window.requestAnimationFrame;
  CanvasRenderingContext2D.prototype.clearRect=function(...args){if(this.canvas.id==='emote-preview'){window.emoteEvidence.roles=[];window.emoteEvidence.points=[];}return clear.apply(this,args);};
  CanvasRenderingContext2D.prototype.drawImage=function(this:CanvasRenderingContext2D,...args:Parameters<typeof draw>){if(this.canvas.id==='emote-preview'&&args[0]instanceof HTMLCanvasElement)window.emoteEvidence.roles.push({role:args[0].dataset.role,time:args[0].dataset.time,instance:args[0].id});return draw.apply(this,args);}as typeof draw;
  CanvasRenderingContext2D.prototype.arc=function(...args){if(this.canvas.id==='emote-preview')window.emoteEvidence.points.push([args[0],args[1]]);return arc.apply(this,args);};
  window.requestAnimationFrame=callback=>{window.emoteEvidence.callbacks.push(callback);return raf.call(window,time=>{const start=performance.now();try{callback(time);}finally{window.emoteEvidence.frameTimes.push(performance.now()-start);}});};
});});

test('astronaut wave/high-five authored through tools, shared-clock contact oracle, swap and complete art gallery',async({page},info)=>{
  test.setTimeout(180_000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const text=await authorAstronautEmotes(page),source=JSON.parse(text)as ActorProject;
  const path=new URL('../../apps/web/src/actor-tools/classic-astronaut.project.json',import.meta.url);if(process.env.ACTOR_UPDATE_EXAMPLE==='1')writeFileSync(path,text+'\n');else expect(text).toBe(readFileSync(path,'utf8').trimEnd());
  expect(source.emotes).toHaveLength(2);expect(source.clips).toHaveLength(14);
  await page.locator('#emotes').selectOption({label:'High five'});await field(page,'emote-time',1);await click(page,'seek-emote');
  const poses=await page.evaluate(()=>({roles:window.emoteEvidence.roles,points:window.emoteEvidence.points}));expect(poses.roles.map(r=>r.role)).toEqual(['initiator','receiver']);expect(poses.roles.map(r=>r.time)).toEqual(['1','1']);expect(new Set(poses.roles.map(r=>r.instance)).size).toBe(2);
  // Independent analytic oracle: .16+.25+.25=.66m hand reach, ±.66m
  // cosmetic frames, shared 96px/m view -> contact at (400,152).
  expect(poses.points).toHaveLength(2);for(const p of poses.points){expect(p[0]).toBeCloseTo(400,8);expect(p[1]).toBeCloseTo(152,8);}
  await page.locator('#emote-preview').screenshot({path:info.outputPath('high-five-contact.png')});await click(page,'swap-emote-roles');await field(page,'emote-time',1);await click(page,'seek-emote');expect(await page.evaluate(()=>window.emoteEvidence.roles.map(r=>r.role))).toEqual(['receiver','initiator']);await page.locator('#emote-preview').screenshot({path:info.outputPath('high-five-swapped.png')});expect(await save(page)).toBe(text);
  await click(page,'retained');await disposePage(page);await click(page,'reopen'); await page.getByRole('button', { name: 'All tools', exact: true }).click();await open(page,text);expect(await save(page)).toBe(text);
  await page.locator('#preview-zoom').selectOption('128');await field(page,'preview-origin-y',.8);await page.locator('#preview-markers').uncheck();await click(page,'apply-preview-aids');
  for(const c of source.clips){await page.locator('#clips').selectOption(c.id);for(const[label,f]of [['start',0],['mid',.5],['end',.999]]as const){await field(page,'seek-time',c.duration*f);await click(page,'seek');await page.locator('#actor-preview').screenshot({path:info.outputPath(`${c.name.replaceAll(' ','-')}-${label}.png`)});}}
  expect(errors).toEqual([]);await info.attach('classic-astronaut-emotes.actorproject',{body:text,contentType:'application/json'});
});

test('independent nonhuman mappings, optional/mismatched definitions and source revisions remain explicit',async({page},info)=>{
  test.setTimeout(120_000);const nonhuman=await authorNonhumanEmotes(page);const primary=readFileSync(new URL('../../apps/web/src/actor-tools/classic-astronaut.project.json',import.meta.url),'utf8');
  await click(page,'retained');await open(page,primary);await page.locator('#emotes').selectOption({label:'High five'});const before=await save(page);
  await page.locator('#emote-secondary').setInputFiles({name:'creature.actorproject',mimeType:'application/json',buffer:Buffer.from(nonhuman)});await expect(page.locator('#emote-secondary-state')).toContainText('Preview reference only');await field(page,'emote-time',1);await click(page,'seek-emote');await expect(page.locator('#emote-status')).toContainText('Any receiver');expect(await save(page)).toBe(before);await page.locator('#emote-preview').screenshot({path:info.outputPath('astronaut-nonhuman-compatible.png')});
  await click(page,'swap-emote-roles');await field(page,'emote-time',1);await click(page,'seek-emote');expect(await page.evaluate(()=>window.emoteEvidence.roles.map(r=>r.role))).toEqual(['receiver','initiator']);
  const absent=JSON.parse(nonhuman)as ActorProject;delete absent.emotes;absent.requiredCapabilities=absent.requiredCapabilities.filter(c=>c!=='spacelab:emote-authoring/1');await page.locator('#emote-secondary').setInputFiles({name:'no-emotes.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(absent))});await expect(page.locator('#emote-secondary-state')).toContainText('Second source');await click(page,'configure-emote');await expect(page.locator('#emote-status')).toContainText('missing-emote');expect(await save(page)).toBe(before);
  const mismatch=JSON.parse(nonhuman)as ActorProject;mismatch.emotes![0]!.revision++;await page.locator('#emote-secondary').setInputFiles({name:'revision.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(mismatch))});await click(page,'configure-emote');await expect(page.locator('#emote-status')).toContainText('definition-mismatch');
  await click(page,'clear-emote-secondary');await click(page,'play-emote');await expect(page.locator('#emote-status')).toContainText('Playing');await showProjectDetails(page);await field(page,'project-version','0.3.1');await click(page,'apply-project');await expect(page.locator('#emote-status')).toContainText('cancelled');await info.attach('nonhuman-role-mapping.actorproject',{body:nonhuman,contentType:'application/json'});
});

test('one owned clock, cancel/reset/blur/disposal and stale frames have no source or world effects',async({page},info)=>{
  await page.goto('/actor-tools.html'); await page.getByRole('button', { name: 'All tools', exact: true }).click();await open(page,readFileSync(new URL('../../apps/web/src/actor-tools/classic-astronaut.project.json',import.meta.url),'utf8'));await page.locator('#emotes').selectOption({label:'High five'});const text=await save(page);await click(page,'play-emote');await expect(page.locator('#emote-status')).toContainText('Playing');
  await expect.poll(()=>page.evaluate(()=>window.emoteEvidence.frameTimes.length)).toBeGreaterThanOrEqual(60);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));const before=await page.evaluate(()=>({time:document.querySelector<HTMLCanvasElement>('#emote-preview')!.dataset.time,roles:window.emoteEvidence.roles}));await page.evaluate(()=>{for(const callback of window.emoteEvidence.callbacks)callback(performance.now()+5000);});expect(await page.evaluate(()=>({time:document.querySelector<HTMLCanvasElement>('#emote-preview')!.dataset.time,roles:window.emoteEvidence.roles}))).toEqual(before);
  const frame=await page.evaluate(()=>{const t=[...window.emoteEvidence.frameTimes].sort((a,b)=>a-b);return{count:t.length,p95:t[Math.floor(t.length*.95)],browser:navigator.userAgent};});await info.attach('paired-preview-measurement.json',{body:JSON.stringify({frame,scope:'One rAF callback; two independent retained clip/pose/cel draws, composite and DOM status. No world step.',viewport:page.viewportSize()}),contentType:'application/json'});
  await click(page,'cancel-emote');await expect(page.locator('#emote-status')).toContainText('cancelled');await click(page,'reset-emote');await expect(page.locator('#emote-preview')).toHaveAttribute('data-time','0');expect(await save(page)).toBe(text);await click(page,'retained');await disposePage(page);await page.evaluate(()=>{for(const callback of window.emoteEvidence.callbacks)callback(performance.now()+8000);});await expect(page.locator('#emote-preview')).toHaveCount(0);
  const files=['../../apps/web/src/actor-tools/','../../packages/actor-tools/src/'].flatMap(d=>readdirSync(new URL(d,import.meta.url)).filter(f=>f.endsWith('.ts')).map(f=>d+f)),code=files.map(f=>readFileSync(new URL(f,import.meta.url),'utf8')).join('\n');expect(code.match(/from\s+['"][^'"]*(?:sim-core|game-runtime|session|world|render-2d)/g)??[]).toEqual([]);expect(code.match(/\b(?:stepWorld|stepPhysics|stepAvatars|fixedUpdate)\s*\(/g)??[]).toEqual([]);
});


test('arbitrary semantic binding names remain owned source data and undo exactly',async({page})=>{
  await page.goto('/actor-tools.html'); await page.getByRole('button', { name: 'All tools', exact: true }).click();await open(page,readFileSync(new URL('../../apps/web/src/actor-tools/classic-astronaut.project.json',import.meta.url),'utf8'));await page.locator('#emotes').selectOption({label:'High five'});const before=await save(page);
  await field(page,'emote-binding-name','__proto__');await page.locator('#emote-binding-socket').selectOption({label:'Palm contact'});await click(page,'write-emote-binding');
  const source=JSON.parse(await save(page))as ActorProject,bindings=source.emotes!.find(e=>e.id==='spacelab:high-five')!.roles[0]!.socketBindings;expect(Object.hasOwn(bindings,'__proto__')).toBe(true);expect(bindings.__proto__).toBe(bindings.contact);
  await click(page,'undo');expect(await save(page)).toBe(before);
});
