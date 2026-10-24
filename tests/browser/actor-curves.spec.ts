import { revealDetails } from './actor-animator-authoring';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import type { ActorProject, ActorTransform } from '@actor-animator/types';

const I = (): ActorTransform => ({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
function fixture(zero = false): ActorProject {
  const s = JSON.parse(readFileSync(new URL('../fixtures/actor-projects/empty.project.json', import.meta.url), 'utf8')) as ActorProject;
  s.name = zero ? 'Zero-bone lantern sequence' : 'Crawler signal sequence'; s.extensions['foreign:timeline'] = { retained: [true, 3.125] };
  s.parts.push({ id: 'p', name: 'Glow', revision: 7, pivot: [0,0], unitsPerPixel: .25, artwork: { kind: 'indexed-raster', width: 2, height: 2, palette: ['#ffcc55ff'], layers: [{ id: 'l', name: 'Ink', opacity: 1, pixels: [0,0,0,0] }] } });
  if (!zero) {
    s.rigs.push({ id: 'r', name: 'Crawler', nodes: [{ id: 'n', name: 'Antenna', parentId: null, rest: I() }, { id: 'root', name: 'Free root', parentId: null, rest: I() }], sockets: [] });
    s.rigs.push({ id: 'other', name: 'Auxiliary', nodes: [{ id: 'n', name: 'Second root', parentId: null, rest: I() }], sockets: [] });
  }
  const target = zero ? { kind: 'attachment' as const, attachmentId: 'a' } : { kind: 'node' as const, rigId: 'r', nodeId: 'n' };
  s.attachments.push({ id: 'a', name: 'Glow', partId: 'p', transform: I(), drawOrder: 0, ...(zero ? {} : { rigId: 'r', nodeId: 'n' }) });
  s.cels = [{ id: 'cel', name: 'Lit', partId: 'p' }]; s.requiredCapabilities.push('spacelab:animation-composition/1','spacelab:cel-tracks/1');
  s.clips.push({ id: 'c', name: 'Signal', duration: 2, playback: 'once', tracks: [{ id: 't', target, interpolation: 'linear', angle: 'shortest', keys: [
    { time: .25, value: I(), curve: 'cubic-bezier', bezier: [.2,-.5,.8,1.5], turns: 2 }, { time: .75, value: { ...I(), x: 1 } }, { time: 1.75, value: { ...I(), x: 3 } },
  ] }], visibilityTracks: [{ id: 'v', target: { kind: 'attachment', attachmentId: 'a' }, keys: [{ time: .25, visible: true }, { time: 1.5, visible: false }] }], drawOrderTracks: [{ id: 'o', target: { kind: 'attachment', attachmentId: 'a' }, keys: [{ time: .75, drawOrder: 2 }] }], celTracks: [{ id: 'ct', target: { kind: 'attachment', attachmentId: 'a' }, keys: [{ time: .25, celId: 'cel' }, { time: 1.5, celId: 'cel' }] }] });
  s.clips.push({ id: 'dest', name: 'Signal copy target', duration: 3, playback: 'ping-pong', tracks: [] }); return s;
}
async function open(page: Page, s: ActorProject) {
  await page.locator('#open').setInputFiles({ name: 'timeline.actorproject', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(s)) });
  await expect(page.locator('#message')).toHaveText('Opened complete editable source.');
}
async function save(page: Page) { const d = page.waitForEvent('download'); await page.locator('#save').click(); return readFileSync((await (await d).path())!, 'utf8'); }
async function setup(page: Page, s = fixture()) { page.on('dialog', d => d.accept()); await page.goto('/'); await open(page,s); await page.locator('#task-button-all').click(); await page.locator('#sheet-filter').selectOption('keyed');
  await revealDetails(page,'View & playback options');await page.locator('#preview-zoom').selectOption('128');await revealDetails(page,'View & playback options');await page.locator('#preview-panel').evaluate(el=>el.scrollTop=0);
}
function key(page: Page, channel: string, track: string, time: number) { return page.locator(`[data-key='${JSON.stringify([channel,track,time])}']`); }
async function centre(el: import('@playwright/test').Locator) { await el.scrollIntoViewIfNeeded(); const b = (await el.boundingBox())!; return { x: b.x + b.width/2, y: b.y + b.height/2 }; }
async function demo(page: Page, info: TestInfo, name: string, before: string, after: string) {
  if (info.project.name !== 'chromium') return;
  mkdirSync('test-results/evidence/s4-demo', { recursive: true }); writeFileSync(`test-results/evidence/s4-demo/${name}-before.actorproject`,before); writeFileSync(`test-results/evidence/s4-demo/${name}-after.actorproject`,after);
  await page.locator('#preview-panel').evaluate(el=>el.scrollTop=0);
  await page.locator('#workspace-inspectors').evaluate(el=>el.scrollTop=0);
  await page.locator('#dope-sheet').evaluate(el=>el.scrollTop=0);
  await page.locator('#dope-sheet').scrollIntoViewIfNeeded();
  await page.locator('.curve-surface').scrollIntoViewIfNeeded();
  await page.locator('.curve-surface').screenshot({ path: `test-results/evidence/s4-demo/${name}.png` });
  await page.screenshot({path:`test-results/evidence/s4-demo/${name}-workspace.png`});
}
test.beforeEach(async({page,browser},info)=>{
  console.log(`${info.project.name} actual browser ${browser.version()}`);
  await page.addInitScript(()=>{
    const moves:number[]=[],ups:number[]=[],frames:number[]=[];Object.assign(window,{curvePointer:-1,curveEvidence:{moves,ups,frames},curveMatrix:[]});let start=0;
    document.addEventListener('pointerdown',e=>Object.assign(window,{curvePointer:e.pointerId}),true);
    for(const name of ['pointermove','pointerup']){document.addEventListener(name,()=>start=performance.now(),true);document.addEventListener(name,e=>{if((e.target as HTMLElement).id.startsWith('curve-h'))(name==='pointermove'?moves:ups).push(performance.now()-start);});}
    const raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>raf(t=>{const a=performance.now();cb(t);frames.push(performance.now()-a);});
    const draw=CanvasRenderingContext2D.prototype.drawImage;CanvasRenderingContext2D.prototype.drawImage=function(this:CanvasRenderingContext2D,...args:Parameters<typeof draw>){if(this.canvas.id==='actor-preview'){const m=this.getTransform();Object.assign(window,{curveMatrix:[m.a,m.b,m.c,m.d,m.e,m.f]});}return draw.apply(this,args);} as typeof draw;
  });
});
test.afterEach(async({page,browser},info)=>{if(page.isClosed())return;const data=await page.evaluate(()=>(window as unknown as {curveEvidence:unknown}).curveEvidence);mkdirSync(`test-results/evidence/s4-performance/${info.project.name}`,{recursive:true});writeFileSync(`test-results/evidence/s4-performance/${info.project.name}/${info.title.replace(/\W/g,'-')}.json`,JSON.stringify({browser:browser.version(),data},null,2));});
async function select(page:Page,track='t',time=.25){await key(page,'tracks',track,time).click();await page.locator('#curve-editor').scrollIntoViewIfNeeded();}
async function custom(page:Page,b:number[]){for(let i=0;i<4;i++)await page.locator(`#curve-b${i}`).fill(String(b[i]));await page.locator('#curve-controls-apply').click();}
async function begin(page:Page){const a=await centre(page.locator('#curve-h1'));await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(a.x+15,a.y-8,{steps:3});await expect(page.locator('#curve-status')).toContainText('Staged');}

test('curves native nonhuman handles, CSS coordinates, exact source undo and independent raster',async({page},info)=>{
  test.setTimeout(120_000);await setup(page);await select(page);const before=await save(page),expected=JSON.parse(before) as ActorProject;
  await page.locator('#curve-h1').click();expect(await save(page)).toBe(before);await expect(page.locator('#undo')).toBeDisabled();
  await page.locator('.curve-surface').evaluate(el=>{(el as HTMLElement).style.width='93.375%';(el as HTMLElement).style.zoom='.8';});
  // Source controls .2,-.5,.8,1.5 => fitted range[-.7,1.7].
  const a=await centre(page.locator('#curve-h1')),r=(await page.locator('#curve-graph').boundingBox())!;
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(r.x+(.4*304+48)/400*r.width,r.y+(228-(.9+.7)/2.4*204)/280*r.height,{steps:4});await page.mouse.up();
  const after=await save(page),s=JSON.parse(after) as ActorProject,b=s.clips[0]!.tracks[0]!.keys[0]!.bezier!;
  expect(Math.abs(b[0]-.4)*304*r.width/400).toBeLessThan(1.1);expect(Math.abs(b[1]-.9)/2.4*204*r.height/280).toBeLessThan(1.1);
  expected.clips[0]!.tracks[0]!.keys[0]!.bezier=[...b];expect(s).toEqual(expected);await page.locator('#undo').click();expect(await save(page)).toBe(before);await page.locator('#redo').click();expect(await save(page)).toBe(after);
  await select(page);await custom(page,[1/3,2,2/3,2]);const final=await save(page);
  const graphNumbers=(await page.locator('#curve-path').getAttribute('d'))!.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g)!.map(Number);
  [48,211,149.33333333333331,41,250.66666666666666,41,352,126].forEach((v,i)=>expect(graphNumbers[i]).toBeCloseTo(v,10));
  await page.locator('#seek-time').fill('.5');await page.locator('#seek').click();
  // elapsed=.5 in segment .25→.75, X(s)=s; x=1.625, rotation=6.5*pi.
  // Raster top is .5 units above pivot: rotated top-left x=320+(1.625-.5)*128=464.
  const matrix=await page.evaluate(()=>(window as unknown as {curveMatrix:number[]}).curveMatrix);
  [0,-32,32,0,464,200].forEach((v,i)=>expect(Math.abs(matrix[i]!-v)).toBeLessThan(1e-8));
  expect((JSON.parse(final) as ActorProject).parts).toEqual(fixture().parts);await demo(page,info,'nonhuman',before,final);
});

test('curves character presets, deliberate conversion, keyboard handles and native text undo',async({page},info)=>{
  test.setTimeout(120_000);const s=JSON.parse(readFileSync(new URL('../fixtures/actor-projects/classic-astronaut-b3.project.json',import.meta.url),'utf8')) as ActorProject;await setup(page,s);await revealDetails(page,'Preview aids: speed, grid & onion skins');await page.locator('#preview-origin-y').fill('.8');await page.locator('#apply-preview-aids').click();await revealDetails(page,'Preview aids: speed, grid & onion skins');const t=s.clips[0]!.tracks[0]!;await select(page,t.id,0);const before=await save(page);
  await page.locator('#curve-choice').selectOption('ease-in');expect(await save(page)).toBe(before);await page.locator('#curve-apply').click();const preset=await save(page);expect((JSON.parse(preset) as ActorProject).clips[0]!.tracks[0]!.keys[0]!.curve).toBe('ease-in');
  await expect(page.locator('#curve-h1')).toBeHidden();await page.locator('#curve-custom').click();await expect(page.locator('#curve-h1')).toBeVisible();const converted=await save(page);
  await begin(page);await page.mouse.up();await page.locator('#undo').click();expect(await save(page)).toBe(converted);
  await page.locator('#curve-h1').focus();await page.keyboard.press('ArrowUp');const keyboard=await save(page);expect((JSON.parse(keyboard) as ActorProject).clips[0]!.tracks[0]!.keys[0]!.bezier).toEqual([.42,.01,1,1]);await page.locator('#undo').click();expect(await save(page)).toBe(converted);await page.locator('#redo').click();expect(await save(page)).toBe(keyboard);
  await custom(page,[1/3,2,2/3,2]);const after=await save(page),expected=JSON.parse(before) as ActorProject;expected.clips[0]!.tracks[0]!.keys[0]!.curve='cubic-bezier';expected.clips[0]!.tracks[0]!.keys[0]!.bezier=[1/3,2,2/3,2];if(!expected.requiredCapabilities.includes('spacelab:animation-composition/1'))expected.requiredCapabilities.push('spacelab:animation-composition/1');expect(JSON.parse(after)).toEqual(expected);
  await page.locator('#curve-b1').fill('3.14159');await page.locator('#curve-b1').press('Control+z');expect(await save(page)).toBe(after);
  await page.locator('#play').click();await page.waitForTimeout(150);await page.locator('#pause').click();await expect(page.locator('#curve-clock')).toContainText('Single clip');await demo(page,info,'character',before,after);
});

test('curves zero-bone numeric overshoot, inheritance, invalid refusal and discrete source preservation',async({page},info)=>{
  await setup(page,fixture(true));await select(page);const before=await save(page);await custom(page,[1,-3,0,4]);const after=await save(page),expected=JSON.parse(before) as ActorProject;expected.clips[0]!.tracks[0]!.keys[0]!.bezier=[1,-3,0,4];expect(JSON.parse(after)).toEqual(expected);await expect(page.locator('#curve-segment')).toContainText('extra turns 2');
  await custom(page,[-.1,0,1,1]);await expect(page.locator('#message')).toContainText('each x');expect(await save(page)).toBe(after);
  await select(page);await demo(page,info,'zero-bone',before,after);
  await page.locator('#curve-choice').selectOption('track-default');await page.locator('#curve-apply').click();const inherited=JSON.parse(await save(page)) as ActorProject;expect(inherited.clips[0]!.tracks[0]!.keys[0]).toEqual({time:.25,value:I(),turns:2});await expect(page.locator('#curve-segment')).toContainText('inherited linear');
  await select(page,'t',1.75);await expect(page.locator('#curve-controls-apply')).toBeDisabled();await expect(page.locator('#timeline-time')).toHaveValue('1.75');
});

test('curves shared segment selection follows retime paste delete and explicit group active key',async({page})=>{
  await setup(page);await select(page);await key(page,'tracks','t',.75).click({modifiers:['Shift']});await expect(page.locator('#curve-segment')).toContainText('0.75 → 1.75');
  await page.locator('#sheet-clear').click();await expect(page.locator('#curve-apply')).toBeDisabled();
  await select(page);await page.locator('#sheet-offset').fill('.125');await page.locator('#sheet-move').click();await expect(page.locator('#curve-segment')).toContainText('0.375 → 0.75');
  await page.locator('#sheet-copy').click();await page.locator('#sheet-paste-time').fill('1');await page.locator('#sheet-paste-exact').click();await expect(page.locator('#curve-segment')).toContainText('1 → 1.75');
  await page.locator('#sheet-delete').click();await expect(page.locator('#curve-apply')).toBeDisabled();
  await page.locator('#timeline-keys').selectOption('.75'.replace(/^\./,'0.'));await expect(page.locator('#curve-segment')).toContainText('0.75 → 1.75');
  await key(page,'celTracks','ct',.25).click();await expect(page.locator('#curve-apply')).toBeDisabled();
});

test('curves native cancellation capture focus file task source and geometry retain recovery exactly',async({page})=>{
  test.setTimeout(180_000);await setup(page);await select(page);const before=await save(page),recovery=await page.evaluate(()=>localStorage.getItem('actor-animator:draft:1'));
  for(const reason of ['escape','pointercancel','lostpointercapture','blur','hidden','focus','task','file','resize','clip','target','selection','scroll']){
    await select(page);await begin(page);
    if(reason==='escape')await page.keyboard.press('Escape');
    if(reason==='pointercancel'||reason==='lostpointercapture')await page.locator('#curve-h1').evaluate((el,type)=>{const id=(window as unknown as {curvePointer:number}).curvePointer;if(!el.hasPointerCapture(id))throw new Error('No native capture');if(type==='lostpointercapture')el.releasePointerCapture(id);else el.dispatchEvent(new PointerEvent(type,{pointerId:id}));},reason);
    if(reason==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
    if(reason==='hidden')await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(document,'hidden',{configurable:true,value:false});});
    if(reason==='focus')await page.locator('#curve-b0').focus();
    if(reason==='task'){await page.locator('#task-button-rig').focus();await page.mouse.up();await page.keyboard.press('Enter');await page.locator('#task-button-all').click();}
    if(reason==='file'){const f=page.waitForEvent('filechooser');await page.locator('#project-library > summary').focus(); await page.keyboard.press('Enter'); await page.locator('#open').focus();await page.mouse.up();await page.keyboard.press('Enter');await(await f).setFiles([]);}
    if(reason==='resize')await page.setViewportSize({width:1100,height:800});
    if(reason==='clip'){await page.locator('#clips').selectOption('dest');await page.locator('#clips').selectOption('c');}
    if(reason==='target'){await page.locator('#track-target').selectOption(JSON.stringify({kind:'node',rigId:'other',nodeId:'n'}));await page.locator('#track-target').selectOption(JSON.stringify({kind:'node',rigId:'r',nodeId:'n'}));}
    if(reason==='selection')await page.locator('#timeline-keys').selectOption('0.75');
    if(reason==='scroll')await page.locator('#workspace-inspectors').evaluate(el=>el.dispatchEvent(new Event('scroll')));
    await page.mouse.up();expect(await save(page),reason).toBe(before);expect(await page.evaluate(()=>localStorage.getItem('actor-animator:draft:1')),reason).toBe(recovery);await expect(page.locator('#undo')).toBeDisabled();await page.setViewportSize({width:1280,height:720});
  }
  await select(page);await begin(page);await open(page,fixture(true));await page.mouse.up();expect((JSON.parse(await save(page)) as ActorProject).rigs).toEqual([]);
  await select(page);await begin(page);await page.getByText('Project & recovery',{exact:true}).focus();await page.mouse.up();await page.keyboard.press('Enter');await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));await expect(page.locator('#curve-editor')).toHaveCount(0);await page.locator('#reopen').click();await expect(page.locator('#state')).not.toContainText('Unsaved');
});

test('curves raw graph stays distinct from animator fade diagnostics and scrub emits no requests',async({page})=>{
  const s=fixture();s.animators=[{id:'anim',name:'Mixer',layers:[{id:'layer',name:'Base',blend:'override',weight:.5,initialStateId:'s0',defaultTransition:{duration:1,priority:2},states:[{id:'s0',name:'Signal',clipId:'c',rate:1},{id:'s1',name:'Rest',clipId:null,rate:1}],transitions:[{id:'fade',from:'s0',to:'s1',duration:1,priority:2}]}]}];
  await setup(page,s);await select(page);const before=await save(page),path=await page.locator('#curve-path').getAttribute('d');
  await revealDetails(page,'Composition: layers, states & transitions');await page.locator('#animation-states').selectOption('s1');await page.locator('#append-request').click();
  await page.locator('#animator-time').fill('.25');await page.locator('#seek-animator').click();await page.locator('#refresh-composition').click();
  let status=JSON.parse((await page.locator('#composition-status').textContent())!);expect(status.layers[0].entries.map((e:{weight:number})=>e.weight)).toEqual([.75,.25]);expect(status.requests).toEqual([{time:0,layerId:'layer',stateId:'s1',outcome:'accepted'}]);
  await expect(page.locator('#curve-clock')).toContainText('Animator or rest');expect(await page.locator('#curve-path').getAttribute('d')).toBe(path);expect(await save(page)).toBe(before);
  await page.locator('#animator-scrub').fill('0.75');await page.locator('#refresh-composition').click();status=JSON.parse((await page.locator('#composition-status').textContent())!);expect(status.requests).toHaveLength(1);expect(status.layers[0].entries.map((e:{weight:number})=>e.weight)).toEqual([.25,.75]);expect(await save(page)).toBe(before);
});
