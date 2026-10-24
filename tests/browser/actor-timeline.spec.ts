import { revealDetails } from './actor-animator-authoring';
import { test, expect, type Page, type TestInfo, type Locator } from '@playwright/test';
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
async function centre(el: Locator) { await el.scrollIntoViewIfNeeded(); const b = (await el.boundingBox())!; return { x: b.x + b.width/2, y: b.y + b.height/2 }; }
async function drag(page: Page, key: Locator, deltaPixels: number) { const a = await centre(key); await page.mouse.move(a.x,a.y); await page.mouse.down(); await page.mouse.move(a.x+deltaPixels,a.y,{ steps:4 }); await page.mouse.up(); }
async function demo(page: Page, info: TestInfo, name: string, before: string, after: string) {
  if (info.project.name !== 'chromium') return;
  mkdirSync('test-results/evidence/s3-demo', { recursive: true }); writeFileSync(`test-results/evidence/s3-demo/${name}-before.actorproject`,before); writeFileSync(`test-results/evidence/s3-demo/${name}-after.actorproject`,after);
  await page.locator('#preview-panel').evaluate(el=>el.scrollTop=0);
  await page.locator('#workspace-inspectors').evaluate(el=>el.scrollTop=0);
  await page.locator('#dope-sheet').evaluate(el=>el.scrollTop=0);
  await page.locator('#dope-sheet').scrollIntoViewIfNeeded();
  await page.locator('#dope-sheet').screenshot({ path: `test-results/evidence/s3-demo/${name}.png` });
  await page.screenshot({path:`test-results/evidence/s3-demo/${name}-workspace.png`});
}
test.beforeEach(async ({ page, browser }, info) => {
  console.log(`${info.project.name} actual browser ${browser.version()}`);
  await page.addInitScript(() => {
    const timings: number[] = [], moves: number[] = [], ups: number[] = [], playheadDom: number[] = []; let start = 0;
    Object.assign(window, { timelinePointer: -1, timelineEvidence: { timings, moves, ups, playheadDom } });
    document.addEventListener('pointerdown', e => { (window as unknown as { timelinePointer: number }).timelinePointer = e.pointerId; }, true);
    for (const event of ['pointermove','pointerup']) {
      document.addEventListener(event, () => { start = performance.now(); }, true);
      document.addEventListener(event, e => { if ((e.target as HTMLElement).id === 'dope-sheet') (event === 'pointermove' ? moves : ups).push(performance.now()-start); });
    }
    // Measure the narrow playhead DOM boundary: style getter through clock
    // text setter. Full rAF includes evaluator/raster/status and is separate.
    const style = Object.getOwnPropertyDescriptor(HTMLElement.prototype,'style'), content = Object.getOwnPropertyDescriptor(Node.prototype,'textContent'); let domStart = 0;
    if (style?.get && style.configurable && content?.set && content.configurable) {
      Object.defineProperty(HTMLElement.prototype,'style',{...style,get(){if((this as HTMLElement).id==='sheet-playhead')domStart=performance.now();return style.get!.call(this);}});
      Object.defineProperty(Node.prototype,'textContent',{...content,set(value: string){content.set!.call(this,value);if((this as HTMLElement).id==='sheet-clock'&&domStart){playheadDom.push(performance.now()-domStart);domStart=0;}}});
    }
    const draw=CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage=function(this:CanvasRenderingContext2D,...args:Parameters<typeof draw>){if(this.canvas.id==='actor-preview'){const m=this.getTransform();Object.assign(window,{timelineRasterMatrix:[m.a,m.b,m.c,m.d,m.e,m.f]});}return draw.apply(this,args);} as typeof draw;
    const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = cb => raf(t => { const start = performance.now(); cb(t); timings.push(performance.now()-start); });
  });
});

test.afterEach(async ({page,browser},info) => {
  if (page.isClosed()) return;
  const data=await page.evaluate(()=>(window as unknown as {timelineEvidence:unknown}).timelineEvidence), body=JSON.stringify({test:info.title,browser:browser.version(),data},null,2);
  mkdirSync(`test-results/evidence/s3-performance/${info.project.name}`,{recursive:true});
  writeFileSync(`test-results/evidence/s3-performance/${info.project.name}/${info.title.replace(/\W+/g,'-')}.json`,body+'\n');
  await info.attach('timeline-performance',{body,contentType:'application/json'});
});

test('timeline native nonhuman group retime/copy, rich metadata and exact one-undo/redo', async ({ page }, info) => {
  await setup(page); await page.locator('#sheet-snap').fill('.125'); const before = await save(page);
  await key(page,'tracks','t',.25).click(); await expect(page.locator('#timeline-time')).toHaveValue('0.25'); await expect(page.locator('#items')).toHaveValue('n');
  await key(page,'tracks','t',.75).click({ modifiers:['Shift'] }); await expect(page.locator('#dope-status')).toContainText('2 selected');
  await drag(page,key(page,'tracks','t',.25),40); //160 CSSpx/s -> +.25s
  const moved = await save(page), expected = JSON.parse(before) as ActorProject; expected.clips[0]!.tracks[0]!.keys[0]!.time = .5; expected.clips[0]!.tracks[0]!.keys[1]!.time = 1;
  expect(JSON.parse(moved)).toEqual(expected); await page.locator('#undo').click(); expect(await save(page)).toBe(before); await page.locator('#redo').click(); expect(await save(page)).toBe(moved);
  await key(page,'tracks','t',.5).click(); await key(page,'tracks','t',1).click({ modifiers:['Shift'] }); await page.locator('#sheet-copy').click();
  await page.locator('#clips').selectOption('dest'); await page.locator('#sheet-paste-time').fill('.375'); await page.locator('#sheet-paste-exact').click();
  const after = await save(page), s = JSON.parse(after) as ActorProject, t = s.clips[1]!.tracks[0]!;
  expect(t.keys).toEqual(expected.clips[0]!.tracks[0]!.keys.slice(0,2).map(k => ({ ...k,time:k.time-.125 }))); expect(t.angle).toBe('shortest'); expect(s.parts).toEqual(fixture().parts); expect(s.extensions).toEqual(fixture().extensions);
  await expect(page.locator('.sheet-key')).toHaveCount(2);
  await key(page,'tracks',t.id,.875).click();
  // Bound nonhuman art: x=1 project unit at128px/unit, .25unit/pixel,
  // 2x2 image with bottom-left pivot0 -> backing affine[32,0,0,32,448,136].
  const matrix=await page.evaluate(()=>(window as unknown as {timelineRasterMatrix:number[]}).timelineRasterMatrix);
  [32,0,0,32,448,136].forEach((v,i)=>expect(Math.abs(matrix[i]!-v)).toBeLessThan(1e-10));
  expect(await save(page)).toBe(after);
  await demo(page,info,'nonhuman',before,after); await info.attach('timeline-costs',{body:JSON.stringify(await page.evaluate(() => (window as unknown as {timelineEvidence:unknown}).timelineEvidence)),contentType:'application/json'});
});

test('timeline zero-bone range/discrete/cel holds, source refusal, paste compatibility and focus', async ({ page }, info) => {
  await setup(page,fixture(true)); const before = await save(page);
  await page.locator('#sheet-range-a').fill('.25'); await page.locator('#sheet-range-b').fill('.75'); await page.locator('#sheet-range').click(); await expect(page.locator('#dope-status')).toContainText('5 selected');
  await page.locator('#sheet-offset').fill('.125'); await page.locator('#sheet-move').click();
  const moved = await save(page), s = JSON.parse(moved) as ActorProject;
  expect(s.clips[0]!.tracks[0]!.keys.map(k=>k.time)).toEqual([.375,.875,1.75]); expect(s.clips[0]!.celTracks![0]!.keys.map(k=>k.time)).toEqual([.375,1.5]); expect(s.clips[0]!.visibilityTracks![0]!.keys.map(k=>k.time)).toEqual([.375,1.5]); expect(s.clips[0]!.drawOrderTracks![0]!.keys[0]!.time).toBe(.875); expect(s.parts).toEqual(fixture(true).parts); expect(s.rigs).toEqual([]);
  await key(page,'celTracks','ct',.375).click(); await expect(page.locator('#dope-status')).toContainText('1 selected key.'); await expect(page.locator('#cel-key-time')).toHaveValue('0.375'); await expect(page.locator('#cel-key-hold')).toHaveValue('1.125');
  await page.locator('#sheet-offset').fill('1.125'); await page.locator('#sheet-move').click(); await expect(page.locator('#message')).toContainText('collision'); expect(await save(page)).toBe(moved);
  await page.locator('#sheet-offset').fill('-1'); await page.locator('#sheet-move').click(); await expect(page.locator('#message')).toContainText('within'); expect(await save(page)).toBe(moved);
  await key(page,'celTracks','ct',.375).click(); await page.locator('#dope-sheet').focus(); await page.keyboard.press('Control+c'); await page.locator('#clips').selectOption('dest'); await page.locator('#sheet-paste-time').fill('.5'); await page.locator('#sheet-paste-exact').click();
  const after = await save(page); expect((JSON.parse(after) as ActorProject).clips[1]!.celTracks![0]!.keys).toEqual([{time:.5,celId:'cel'}]);
  // Native text undo is local; sheet shortcuts must not consume it.
  await page.locator('#sheet-offset').fill('.6789'); await page.locator('#sheet-offset').press('Control+z'); expect(await save(page)).toBe(after);
  await expect(page.locator('.sheet-key')).toHaveCount(1);
  await demo(page,info,'zero-bone',before,after);
  // Reopening clears the private clipboard even for the same source ID.
  await open(page,fixture(true)); await page.locator('#sheet-paste').click(); await expect(page.locator('#message')).toContainText('Copy keys');
});

test('timeline character visual retime/copy/delete and retained playhead rows', async ({ page }, info) => {
  test.setTimeout(120_000);
  const s = JSON.parse(readFileSync(new URL('../fixtures/actor-projects/classic-astronaut-b3.project.json',import.meta.url),'utf8')) as ActorProject;
  await setup(page,s); await page.locator('#sheet-snap').fill('.25'); const before = await save(page), c = s.clips[0]!, track = c.tracks[0]!;
  await revealDetails(page,'Preview aids: speed, grid & onion skins');await page.locator('#preview-origin-y').fill('.8');await page.locator('#apply-preview-aids').click();await revealDetails(page,'Preview aids: speed, grid & onion skins');
  await drag(page,key(page,'tracks',track.id,1),-40); // middle breathing pose -> .75s
  await key(page,'tracks',track.id,.75).click(); await page.locator('#sheet-copy').click();
  // Seek via the seconds ruler, then paste via the focused sheet shortcut.
  const ruler = page.locator('#sheet-ruler'); await ruler.scrollIntoViewIfNeeded(); const b = (await ruler.boundingBox())!;
  await page.mouse.click(b.x+184+1.25*160,b.y+16); await page.locator('#dope-sheet').focus(); await page.keyboard.press('Control+v');
  const after = await save(page), expected = JSON.parse(before) as ActorProject;
  expected.clips[0]!.tracks[0]!.keys[1]!.time = .75; expected.clips[0]!.tracks[0]!.keys.splice(2,0,{...structuredClone(expected.clips[0]!.tracks[0]!.keys[1]!),time:1.25}); expect(JSON.parse(after)).toEqual(expected);
  await demo(page,info,'character',before,after);
  // Playback updates only the line/status, preserving every authored-key element.
  await page.locator('#dope-sheet').evaluate(el => { const refs = [...el.querySelectorAll('[data-key]')]; Object.assign(window,{ retainedTimelineKeys:refs }); });
  await page.locator('#play').click(); await expect(page.locator('#preview-state')).toContainText('Playing'); await page.waitForTimeout(180); await page.locator('#pause').click();
  expect(await page.locator('#dope-sheet').evaluate(el => { const before=(window as unknown as {retainedTimelineKeys:Element[]}).retainedTimelineKeys, after=[...el.querySelectorAll('[data-key]')]; return after.every((key,i)=>key===before[i]); })).toBe(true);
  await key(page,'tracks',track.id,1.25).click(); await page.locator('#dope-sheet').focus(); await page.keyboard.press('Delete'); await expect(key(page,'tracks',track.id,1.25)).toHaveCount(0); await page.locator('#dope-sheet').focus(); await page.keyboard.press('Control+z'); expect(await save(page)).toBe(after);
});

test('timeline native cancel/lost capture/blur/hidden/focus/task/file/resize/selection/source/dispose leave no edit', async ({ page }) => {
  test.setTimeout(120_000); await setup(page); const before = await save(page), recovery = await page.evaluate(()=>localStorage.getItem('actor-animator:draft:1'));
  // Establish selection before capturing geometry: changing rigs in All tools
  // can resize inspectors above the sheet and must cancel an active drag.
  const begin = async () => { await key(page,'tracks','t',.25).click(); const a = await centre(key(page,'tracks','t',.25)); await page.mouse.move(a.x,a.y); await page.mouse.down(); await page.mouse.move(a.x+20,a.y,{steps:3}); await expect(page.locator('#dope-status')).toContainText('Staged offset'); };
  for (const reason of ['escape','pointercancel','lostpointercapture','blur','hidden','focus','task','file','resize','selection','clip','scroll']) {
    await begin();
    if (reason==='escape') await page.keyboard.press('Escape');
    if (reason==='pointercancel'||reason==='lostpointercapture') await page.locator('#dope-sheet').evaluate((el,type)=>{const id=(window as unknown as {timelinePointer:number}).timelinePointer;if(!el.hasPointerCapture(id))throw new Error('Missing owned capture');if(type==='lostpointercapture')el.releasePointerCapture(id);else el.dispatchEvent(new PointerEvent(type,{pointerId:id}));},reason);
    if(reason==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
    if(reason==='hidden')await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(document,'hidden',{configurable:true,value:false});});
    if(reason==='focus')await page.locator('#sheet-offset').focus();
    if(reason==='task'){await page.locator('#task-button-rig').focus();await page.mouse.up();await page.keyboard.press('Enter');await page.locator('#task-button-all').click();}
    if(reason==='file'){const f=page.waitForEvent('filechooser');await page.locator('#project-library > summary').focus(); await page.keyboard.press('Enter'); await page.locator('#open').focus();await page.mouse.up();await page.keyboard.press('Enter');await(await f).setFiles([]);}
    if(reason==='resize')await page.setViewportSize({width:1100,height:800});
    if(reason==='selection')await page.locator('#track-target').selectOption(JSON.stringify({kind:'node',rigId:'other',nodeId:'n'}));
    if(reason==='clip'){await page.locator('#clips').selectOption('dest');await page.locator('#clips').selectOption('c');}
    if(reason==='scroll')await page.locator('#dope-sheet').evaluate(el=>{el.scrollLeft=40;el.dispatchEvent(new Event('scroll'));});
    await page.mouse.up(); expect(await save(page),reason).toBe(before);expect(await page.evaluate(()=>localStorage.getItem('actor-animator:draft:1')),reason).toBe(recovery);await expect(page.locator('#undo')).toBeDisabled();await page.setViewportSize({width:1280,height:720});await page.locator('#dope-sheet').evaluate(el=>el.scrollLeft=0);
  }
  await begin();await open(page,fixture(true));await page.mouse.up();expect((JSON.parse(await save(page)) as ActorProject).rigs).toEqual([]);
  await begin();await page.getByText('Project & recovery',{exact:true}).focus();await page.mouse.up();await page.keyboard.press('Enter');await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));await expect(page.locator('#dope-sheet')).toHaveCount(0);await page.locator('#reopen').click();await expect(page.locator('#state')).not.toContainText('Unsaved');
});

test('timeline zoom/scroll/CSS hit geometry, overlap cycle, rectangle and raw/effective clock', async ({ page }) => {
  const s=fixture();s.clips[0]!.playback='ping-pong';s.clips[0]!.tracks[0]!.keys.splice(1,0,{time:.26,value:I()});
  await setup(page,s);const before=await save(page);await page.locator('#sheet-zoom').selectOption('320');
  await page.locator('#dope-sheet').evaluate(el=>{el.style.width='90%';el.style.zoom='0.8';el.scrollLeft=60;});
  // Exact times are still distinct even when their glyphs overlap; Alt cycles.
  let a=await centre(key(page,'tracks','t',.25));await page.keyboard.down('Alt');await page.mouse.click(a.x,a.y);await page.keyboard.up('Alt');await expect(page.locator('#timeline-time')).toHaveValue('0.25');
  a=await centre(key(page,'tracks','t',.25));await page.keyboard.down('Alt');await page.mouse.click(a.x,a.y);await page.keyboard.up('Alt');await expect(page.locator('#timeline-time')).toHaveValue('0.26');expect(await save(page)).toBe(before);
  await page.locator('#sheet-snap').fill('.1');await key(page,'tracks','t',.26).click();expect(await save(page)).toBe(before);await page.locator('#sheet-snap').fill('0');
  await drag(page,key(page,'tracks','t',.26),32); // CSS zoom.8 *320px/s => .125s
  const moved = JSON.parse(await save(page)) as ActorProject, actual = moved.clips[0]!.tracks[0]!.keys[1]!.time;
  expect(Math.abs(actual-.385)*320*.8).toBeLessThan(1.1);
  const expected = JSON.parse(before) as ActorProject; expected.clips[0]!.tracks[0]!.keys[1]!.time=actual; expect(moved).toEqual(expected);
  await page.locator('#undo').click(); expect(await save(page)).toBe(before);
  await page.locator('#dope-sheet').evaluate(el=>{el.style.zoom='1';el.scrollLeft=0;});
  // Background rectangle begins below all keys, spans first row/time interval.
  const b=(await page.locator('#sheet-ruler').boundingBox())!;
  await page.mouse.move(b.x+184+.2*320,b.y+32+29);await page.mouse.down();await page.mouse.move(b.x+184+.8*320,b.y+32+3,{steps:3});await page.mouse.up();await expect(page.locator('#dope-status')).toContainText('3 selected');
  await page.locator('#seek-time').fill('4.375');await page.locator('#seek').click();await expect(page.locator('#sheet-clock')).toContainText('Clip 0.3750 s · clock 4.3750 s');expect(await save(page)).toBe(before);
  await page.locator('#sheet-filter').selectOption('all');await page.locator('#sheet-snap').fill('.125');
  const scrollBox=(await page.locator('#dope-sheet').boundingBox())!;await page.mouse.move(scrollBox.x+220,scrollBox.y+100);await page.mouse.wheel(0,80);await expect.poll(()=>page.locator('#dope-sheet').evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
  await drag(page,key(page,'visibilityTracks','v',.25),40); // vertical-scroll row7, zoom320 => +.125s
  const scrolled=JSON.parse(await save(page)) as ActorProject, expectedScroll=JSON.parse(before) as ActorProject;expectedScroll.clips[0]!.visibilityTracks![0]!.keys[0]!.time=.375;expect(scrolled).toEqual(expectedScroll);
});

test('timeline empty rows/new clip and reference/metadata guards preserve complete source', async ({ page }) => {
  const s = fixture(true); s.actions.push({id:'local:signal-action',category:'custom',label:'Signal',clipId:'c'});
  s.clips[1]!.tracks.push({...structuredClone(s.clips[0]!.tracks[0]!),id:'incompatible',interpolation:'step',keys:[{time:0,value:I()}]});
  await setup(page,s);const before=await save(page);
  await page.locator('#delete-clip').click();await expect(page.locator('#message')).toContainText('used by');expect(await save(page)).toBe(before);
  await key(page,'tracks','t',.25).focus();await page.keyboard.press('Enter');await expect(page.locator('#dope-sheet')).toBeFocused();await expect(page.locator('#timeline-time')).toHaveValue('0.25');await page.locator('#sheet-copy').click();await page.locator('#clips').selectOption('dest');await page.locator('#sheet-paste-time').fill('.5');await page.locator('#sheet-paste-exact').click();await expect(page.locator('#message')).toContainText('interpolation/angle differs');expect(await save(page)).toBe(before);
  await page.locator('#sheet-filter').selectOption('all');await page.locator('.sheet-label').last().click();expect(await save(page)).toBe(before);
  const empty=JSON.parse(readFileSync(new URL('../fixtures/actor-projects/empty.project.json',import.meta.url),'utf8')) as ActorProject;
  await open(page,empty);await expect(page.locator('#dope-sheet')).toContainText('No rows');await page.locator('#clip-name').fill('Arbitrary empty clip');await page.locator('#duration').fill('2.375');await page.locator('#add-clip').click();
  const created=JSON.parse(await save(page)) as ActorProject;expect(created.clips[0]).toMatchObject({name:'Arbitrary empty clip',duration:2.375,tracks:[]});expect(created.rigs).toEqual([]);await expect(page.locator('#sheet-ruler')).toContainText('seconds');
});
