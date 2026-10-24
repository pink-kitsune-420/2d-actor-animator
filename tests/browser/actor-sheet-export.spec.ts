import { test,expect,type Page } from '@playwright/test';
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { ActorProject } from '@actor-animator/types';
import { disposePage, click,field,open,save } from './actor-animator-authoring';
const beacon=readFileSync(new URL('../../examples/spacelab/beacon.actorproject',import.meta.url),'utf8');
async function start(p:Page,text=beacon){await p.goto('/actor-tools.html');await p.getByRole('button',{name:'All tools',exact:true}).click();await open(p,text);}
async function settings(p:Page){
  await p.locator('#sheet-schedule').selectOption('explicit');await field(p,'sheet-times','0, .5, .75, .875');
  for(const [id,value]of [['sheet-frame-width',32],['sheet-frame-height',16],['sheet-columns',2],['sheet-scale',4],['sheet-centre-x',2],['sheet-centre-y',.5]] as const)await field(p,id,value);
}
async function download(p:Page,id:string){const event=p.waitForEvent('download');await click(p,id);return readFileSync((await(await event).path())!);}
async function pixels(p:Page,png:Buffer,points:number[][]){return p.evaluate(async({bytes,points})=>{const b=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'}));const c=document.createElement('canvas');c.width=b.width;c.height=b.height;try{const x=c.getContext('2d')!;x.drawImage(b,0,0);return points.map(([a,b])=>[...x.getImageData(a!,b!,1,1).data]);}finally{b.close();c.width=c.height=0;}},{bytes:[...png],points});}
function near(actual:number[],expected:number[]){actual.forEach((v,i)=>expect(Math.abs(v-expected[i]!)).toBeLessThanOrEqual(1));}
function demo(name:string,bytes:string|Buffer){if(process.env.ANIMATOR_S6_DEMO==='1'){mkdirSync('test-results/evidence/s6-demo',{recursive:true});writeFileSync(`test-results/evidence/s6-demo/${name}`,bytes);}}

test('sampled sheet reviews immutable source, independent RGBA and fractional holds, then reimports atomically',async({page,browser},info)=>{
  console.log(JSON.stringify({engine:info.project.name,browser:browser.version(),runner:'Playwright1.63.0',platform:process.platform}));
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await start(page);const before=await save(page),recovery=await page.evaluate(()=>({...localStorage}));
  await settings(page);
  await page.evaluate(`(() => {
    window.sheetMetrics={encodes:[],decodes:[],imports:[],opened:0,closed:0};window.sheetCanvases=[];
    let importStart=null;document.getElementById('sheet-png').addEventListener('change',()=>{importStart=performance.now();},{capture:true});
    new MutationObserver(()=>{if(importStart!==null&&document.getElementById('message').textContent.includes('Flattened sheet imported')){window.sheetMetrics.imports.push({decodeIndexTransactionRenderMs:performance.now()-importStart});importStart=null;}}).observe(document.getElementById('message'),{childList:true,subtree:true,characterData:true});
    const create=document.createElement.bind(document);document.createElement=function(...args){const el=create(...args);if(args[0]==='canvas')window.sheetCanvases.push(el);return el;};
    const encode=HTMLCanvasElement.prototype.toBlob;HTMLCanvasElement.prototype.toBlob=function(callback,...args){const start=performance.now(),m={scheduleMs:0,completionMs:0,bytes:0};window.sheetMetrics.encodes.push(m);encode.call(this,blob=>{m.completionMs=performance.now()-start;m.bytes=blob?.size??0;callback(blob);},...args);m.scheduleMs=performance.now()-start;};
    const decode=window.createImageBitmap.bind(window);window.createImageBitmap=function(...args){const start=performance.now();return decode(...args).then(bitmap=>{window.sheetMetrics.decodes.push({completionMs:performance.now()-start,width:bitmap.width,height:bitmap.height});window.sheetMetrics.opened++;return bitmap;});};
    const close=ImageBitmap.prototype.close;ImageBitmap.prototype.close=function(){window.sheetMetrics.closed++;return close.call(this);};
  })()`);
  await click(page,'prepare-sheet');await expect(page.locator('#sheet-review')).toContainText(createHash('sha256').update(before).digest('hex'));
  await expect(page.locator('#sheet-contact')).toBeVisible();
  const retained=await page.evaluate(()=> (window as unknown as {sheetCanvases:HTMLCanvasElement[]}).sheetCanvases.map(c=>[c.width,c.height]).filter(([w,h])=>w!>0&&h!>0));expect(retained).toEqual([[64,32]]);await expect(page.locator('#sheet-review')).toContainText('0.75s hold 0.125s');
  const metadata=await download(page,'download-sheet-metadata'),png=await download(page,'download-sheet'),m=JSON.parse(metadata.toString());
  expect([m.width,m.height,m.frames[0].pivot,m.frames[0].unitsPerPixel]).toEqual([64,32,[2,1.5],.25]);expect(m.frames.map((f:{time:number})=>f.time)).toEqual([0,.5,.75,.875]);
  // Independently mapped pixel centres: screenX=16+4*(worldX-2), screenY=8+4*(.5-worldY).
  const rgba=await pixels(page,png,[[13,7],[15,7],[13,9],[15,9],[55,9],[23,25],[55,25],[0,0]]);
  near(rgba[0]!,[191,64,0,255]);expect(rgba.slice(1)).toEqual([[0,0,0,0],[0,255,0,128],[255,0,0,255],[255,0,0,255],[0,0,255,255],[0,0,0,0],[0,0,0,0]]);
  expect((await download(page,'sheet-source')).toString()).toBe(before);expect(await page.evaluate(()=>({...localStorage}))).toEqual(recovery);
  await page.locator('#sheet-contact').screenshot({path:info.outputPath('sheet-contact.png')});
  demo('zero-bone.actorproject',before);demo('zero-bone.png',png);demo('zero-bone.sheet.json',metadata);demo('zero-bone-review.txt',await page.locator('#sheet-review').innerText());demo('pixel-evidence.json',JSON.stringify({points:[[13,7],[15,7],[13,9],[15,9],[55,9],[23,25],[55,25],[0,0]],rgba},null,2));
  if(process.env.ANIMATOR_S6_DEMO==='1'){await page.locator('#cel-panel').screenshot({path:'test-results/evidence/s6-demo/zero-bone-export.png'});await page.locator('#preview-zoom').selectOption('64');await field(page,'seek-time',0);await click(page,'seek');await page.locator('#preview-panel').screenshot({path:'test-results/evidence/s6-demo/zero-bone-workspace.png'});}
  await page.locator('#sheet-metadata').setInputFiles({name:'sheet.json',mimeType:'application/json',buffer:metadata});await expect(page.locator('#sheet-import-status')).toContainText('4 admitted');
  await page.locator('#sheet-png').setInputFiles({name:'sheet.png',mimeType:'image/png',buffer:png});await expect(page.locator('#message')).toContainText('Flattened sheet imported');
  const after=JSON.parse(await save(page))as ActorProject,original=JSON.parse(before)as ActorProject;expect(after.parts.slice(0,2)).toEqual(original.parts);expect(after.clips.slice(0,1)).toEqual(original.clips);expect(after.extensions).toEqual(original.extensions);expect(after.rigs).toEqual([]);expect(after.parts.at(-1)!.pivot).toEqual([2,1.5]);
  await click(page,'undo');expect(await save(page)).toBe(before);await click(page,'redo');const revised=await save(page);demo('zero-bone-reimport.actorproject',revised);await click(page,'retained');await open(page,revised);expect(await save(page)).toBe(revised);expect(errors).toEqual([]);
  const metrics=await page.evaluate(()=>({...(window as unknown as{sheetMetrics:object}).sheetMetrics,exportCanvases:(window as unknown as{sheetCanvases:HTMLCanvasElement[]}).sheetCanvases.map(c=>[c.width,c.height])}));demo('native-metrics.json',JSON.stringify(metrics,null,2));
  await page.goto('/sheet-example/');await page.locator('#metadata').setInputFiles({name:'sheet.json',mimeType:'application/json',buffer:metadata});await expect(page.locator('#status')).toContainText('4 frames');await page.locator('#png').setInputFiles({name:'sheet.png',mimeType:'image/png',buffer:png});await expect(page.locator('#report')).toContainText('"frame": 0');
  const consumer=await page.locator('#view').evaluate((c:HTMLCanvasElement)=>[...c.getContext('2d')!.getImageData(302,174,1,1).data]);near(consumer,[191,64,0,255]);
  for(const [time,frame]of [[.499,0],[.5,1],[.749,1],[.75,2],[.875,3],[1,3],[1.125,3],[1.5,1],[2,0],[-.25,0]] as const){await field(page,'time',time);await click(page,'sample');expect(JSON.parse(await page.locator('#report').innerText()).frame).toBe(frame);}
  await field(page,'time',0);await click(page,'sample');await page.screenshot({path:info.outputPath('independent-consumer.png')});if(process.env.ANIMATOR_S6_DEMO==='1')await page.screenshot({path:'test-results/evidence/s6-demo/zero-bone-consumer.png',fullPage:true});
});

test('recipe inputs retain native focus/undo and invalidate settings, clip, history and same-ID documents',async({page})=>{
  await start(page);const text=await save(page),recovery=await page.evaluate(()=>({...localStorage}));await settings(page);await click(page,'prepare-sheet');
  await page.locator('#sheet-times').focus();await page.keyboard.press('End');await page.keyboard.type('9');await expect(page.locator('#sheet-times')).toBeFocused();await expect(page.locator('#download-sheet')).toBeDisabled();await page.keyboard.press('ControlOrMeta+z');expect(await page.locator('#sheet-times').inputValue()).toBe('0, .5, .75, .875');expect(await save(page)).toBe(text);expect(await page.evaluate(()=>({...localStorage}))).toEqual(recovery);
  for(const times of ['0,.5,.5','0,1','.5,.75','0,.75,.5']){await field(page,'sheet-times',times);await click(page,'prepare-sheet');await expect(page.locator('#message')).toContainText('Samples must start');await expect(page.locator('#download-sheet')).toBeDisabled();expect(await save(page)).toBe(text);}
  await settings(page);await click(page,'prepare-sheet');await page.locator('#project-details > summary').click();await field(page,'project-name','A source edit');await click(page,'apply-project');await expect(page.locator('#download-sheet')).toBeDisabled();await click(page,'undo');expect(await save(page)).toBe(text);await click(page,'prepare-sheet');await click(page,'redo');await expect(page.locator('#download-sheet')).toBeDisabled();
  await save(page);await click(page,'retained');const next=JSON.parse(text)as ActorProject;next.clips.push({...structuredClone(next.clips[0]!),id:'other',name:'Other clip',tracks:[],celTracks:[],visibilityTracks:[],drawOrderTracks:[]});await open(page,JSON.stringify(next));await click(page,'prepare-sheet');await page.locator('#clips').selectOption('other');await expect(page.locator('#download-sheet')).toBeDisabled();await click(page,'prepare-sheet');await open(page,text);await expect(page.locator('#download-sheet')).toBeDisabled();
});

test('late encoding is discarded on settings, clip, source replacement, file cancellation and disposal',async({page})=>{
  const doc=JSON.parse(beacon)as ActorProject;doc.clips.push({id:'other',name:'Other',duration:1,playback:'loop',tracks:[]});await start(page,JSON.stringify(doc));const text=await save(page);await settings(page);
  await page.evaluate(()=>{Object.assign(window,{callbacks:[]});HTMLCanvasElement.prototype.toBlob=function(callback){(window as unknown as{callbacks:BlobCallback[]}).callbacks.push(callback);};});
  let downloads=0;page.on('download',()=>downloads++);
  const flush=()=>page.evaluate(()=>{for(const f of(window as unknown as{callbacks:BlobCallback[]}).callbacks.splice(0))f(new Blob(['late'],{type:'image/png'}));});
  await click(page,'prepare-sheet');await click(page,'download-sheet');await page.locator('#clips').selectOption('other');await flush();expect(downloads).toBe(0);await page.locator('#clips').selectOption('profile:pulse');
  await click(page,'prepare-sheet');await click(page,'download-sheet');await field(page,'sheet-centre-x',3);await flush();expect(downloads).toBe(0);
  await click(page,'prepare-sheet');await click(page,'download-sheet');await open(page,text);await flush();expect(downloads).toBe(0);
  await click(page,'prepare-sheet');await click(page,'download-sheet');await page.locator('#open').dispatchEvent('cancel');await expect(page.locator('#download-sheet')).toBeDisabled();await flush();expect(downloads).toBe(0);
  await click(page,'prepare-sheet');await click(page,'download-sheet');await disposePage(page);await flush();expect(downloads).toBe(0);
});

test('character and bound multiple-rig originals produce independently usable flattened output; once and loop boundaries',async({page},info)=>{
  for(const [name,path,scale,y]of [['character','../../apps/web/src/actor-tools/classic-astronaut.project.json',64,.8],['nonhuman','../../dist/spacelab-example/nonhuman.actorproject',8,2]] as const){
    const text=readFileSync(new URL(path,import.meta.url),'utf8');await start(page,text);const before=await save(page);await field(page,'sheet-frame-width',128);await field(page,'sheet-frame-height',128);await field(page,'sheet-scale',scale);await field(page,'sheet-centre-y',y);await click(page,'prepare-sheet');
    const png=await download(page,'download-sheet'),metadata=await download(page,'download-sheet-metadata');expect(await save(page)).toBe(before);demo(`${name}.actorproject`,before);demo(`${name}.png`,png);demo(`${name}.sheet.json`,metadata);demo(`${name}-review.txt`,await page.locator('#sheet-review').innerText());
    await page.locator('#sheet-contact').screenshot({path:info.outputPath(`${name}-sheet.png`)});if(process.env.ANIMATOR_S6_DEMO==='1'){await page.locator('#cel-panel').screenshot({path:`test-results/evidence/s6-demo/${name}-export.png`});await page.locator('#preview-zoom').selectOption(name==='character'?'128':'16');await field(page,'seek-time',.5);await click(page,'seek');await page.locator('#preview-panel').screenshot({path:`test-results/evidence/s6-demo/${name}-workspace.png`});}
    await page.goto('/sheet-example/');await page.locator('#metadata').setInputFiles({name:'sheet.json',mimeType:'application/json',buffer:metadata});await expect(page.locator('#status')).toContainText('4 frames');await page.locator('#png').setInputFiles({name:'sheet.png',mimeType:'image/png',buffer:png});await expect(page.locator('#report')).toContainText('"frame": 0');
    const count=await page.locator('#view').evaluate((c:HTMLCanvasElement)=>{const a=c.getContext('2d')!.getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<a.length;i+=4)if(a[i])n++;return n;});expect(count).toBeGreaterThan(100);if(process.env.ANIMATOR_S6_DEMO==='1')await page.screenshot({path:`test-results/evidence/s6-demo/${name}-consumer.png`,fullPage:true});
  }
  for(const mode of ['once','loop'] as const){const s=JSON.parse(beacon)as ActorProject;s.clips[0]!.playback=mode;await start(page,JSON.stringify(s));await settings(page);await click(page,'prepare-sheet');const png=await download(page,'download-sheet'),m=await download(page,'download-sheet-metadata');await page.goto('/sheet-example/');await page.locator('#metadata').setInputFiles({name:'m.json',mimeType:'application/json',buffer:m});await expect(page.locator('#status')).toContainText('4 frames');await page.locator('#png').setInputFiles({name:'p.png',mimeType:'image/png',buffer:png});await expect(page.locator('#report')).toContainText('"frame": 0');for(const [t,i]of [[1,mode==='once'?3:0],[1.5,mode==='once'?3:1],[-.25,mode==='once'?0:2]] as const){await field(page,'time',t);await click(page,'sample');expect(JSON.parse(await page.locator('#report').innerText()).frame).toBe(i);}}
});

test('sheared reflected attachment raster and draw order agree with independent matrix pixels, with clipping and padding',async({page})=>{
  const s=JSON.parse(beacon) as ActorProject,rt=(x=0,y=0,rotation=0,scaleX=1,scaleY=1)=>({x,y,rotation,scaleX,scaleY});
  s.rigs=[{id:'rig',name:'Affine rig',sockets:[],nodes:[{id:'root',name:'Root',parentId:null,rest:rt(0,0,0,2,1)},{id:'child',name:'Child',parentId:'root',rest:rt(0,0,Math.PI/4)}]}];
  s.parts=s.parts.slice(0,1);s.parts[0]!.artwork.palette=['#00000000','#ff0000ff','#00ff00ff'];s.parts[0]!.artwork.layers=s.parts[0]!.artwork.layers.slice(0,1);s.parts[0]!.artwork.layers[0]!.pixels=[1,0,2,1];
  s.attachments=[{id:'affine',name:'Reflected art',partId:s.parts[0]!.id,rigId:'rig',nodeId:'child',drawOrder:0,transform:rt(0,0,0,-1,1)},
    {id:'front',name:'Order marker',partId:s.parts[0]!.id,drawOrder:-1,transform:rt(0,0,0,-1,1)}];
  s.clips=[{id:'affine',name:'Affine sample',duration:1,playback:'once',tracks:[],drawOrderTracks:[{id:'order',target:{kind:'attachment',attachmentId:'front'},keys:[{time:0,drawOrder:-1},{time:.5,drawOrder:1}]}]}];delete s.cels;s.actions=[];
  await start(page,JSON.stringify(s));await page.locator('#sheet-schedule').selectOption('explicit');await field(page,'sheet-times','0,.5,.75');for(const [id,v]of [['sheet-frame-width',16],['sheet-frame-height',16],['sheet-scale',12],['sheet-centre-y',0]]as const)await field(page,id,v);await click(page,'prepare-sheet');const png=await download(page,'download-sheet');
  // Independently multiply S(2,1)*R(pi/4)*S(-1,1): [-sqrt2,-sqrt(.5),-sqrt2,sqrt(.5)].
  // Source pivot(.25,.75),density.5 => local image x=.5u-.25,y=.25-.5v.
  // Canvas origin(8,8),12px/unit yields [ -6sqrt2,6sqrt(.5),6sqrt2,6sqrt(.5),8,8-6sqrt(.5) ].
  const result=await page.evaluate(async bytes=>{
    const b=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'}));const actual=document.createElement('canvas');actual.width=actual.height=32;actual.getContext('2d')!.drawImage(b,0,0);b.close();
    const raster=document.createElement('canvas');raster.width=raster.height=2;const rc=raster.getContext('2d')!,data=rc.createImageData(2,2);data.data.set([255,0,0,255,0,0,0,0,0,255,0,255,255,0,0,255]);rc.putImageData(data,0,0);
    const expected=document.createElement('canvas');expected.width=expected.height=32;const e=expected.getContext('2d')!,frame=document.createElement('canvas');frame.width=frame.height=16;const f=frame.getContext('2d')!;f.imageSmoothingEnabled=false;
    const drawAffine=()=>{f.setTransform(-6*Math.SQRT2,6*Math.SQRT1_2,6*Math.SQRT2,6*Math.SQRT1_2,8,8-6*Math.SQRT1_2);f.drawImage(raster,0,0);};
    const drawMarker=()=>{f.setTransform(-6,0,0,6,11,5);f.drawImage(raster,0,0);};
    for(let i=0;i<3;i++){f.setTransform(1,0,0,1,0,0);f.clearRect(0,0,16,16);if(i===0){drawMarker();drawAffine();}else{drawAffine();drawMarker();}e.drawImage(frame,i%2*16,Math.floor(i/2)*16);}
    const a=actual.getContext('2d')!.getImageData(0,0,32,32).data,z=e.getImageData(0,0,32,32).data;let mismatch=0;for(let i=0;i<a.length;i++)if(Math.abs(a[i]!-z[i]!)>1)mismatch++;return {mismatch,padding:[...a.slice((16*32+16)*4,(16*32+17)*4)]};
  },[...png]);expect(result).toEqual({mismatch:0,padding:[0,0,0,0]});demo('affine.actorproject',JSON.stringify(s,null,2));demo('affine.png',png);
});

test('exportable RGBA refuses indexed reimport without source changes; delayed decode cannot replace newer metadata',async({page})=>{
  const s=JSON.parse(beacon)as ActorProject,p=s.parts[0]!;s.parts=[p];p.pivot=[0,0];p.unitsPerPixel=1;p.artwork.width=p.artwork.height=16;
  p.artwork.palette=['#00000000',...Array.from({length:254},(_,i)=>`#${(i+1).toString(16).padStart(2,'0')}0000ff`),'#0000ffff'];
  p.artwork.layers=[{id:'base',name:'Base',opacity:1,pixels:[...Array.from({length:255},(_,i)=>i+1),1]},{id:'blend',name:'Blend',opacity:.5,pixels:[...Array<number>(255).fill(0),255]}];
  s.attachments[0]!.transform={x:0,y:0,rotation:0,scaleX:1,scaleY:1};s.clips=[{id:'colours',name:'RGBA output',duration:1,playback:'loop',tracks:[]}];delete s.cels;s.actions=[];
  await start(page,JSON.stringify(s));const before=await save(page);for(const [id,v]of [['sheet-frames',1],['sheet-columns',1],['sheet-frame-width',16],['sheet-frame-height',16],['sheet-scale',1],['sheet-centre-x',8],['sheet-centre-y',8]]as const)await field(page,id,v);await click(page,'prepare-sheet');const png=await download(page,'download-sheet'),metadata=await download(page,'download-sheet-metadata');
  await page.locator('#sheet-metadata').setInputFiles({name:'m.json',mimeType:'application/json',buffer:metadata});await expect(page.locator('#sheet-import-status')).toContainText('1 admitted');await page.locator('#sheet-png').setInputFiles({name:'p.png',mimeType:'image/png',buffer:png});await expect(page.locator('#message')).toContainText('256 palette entries');expect(await save(page)).toBe(before);
  demo('rgba-not-indexed.actorproject',before);demo('rgba-not-indexed.png',png);demo('rgba-not-indexed.sheet.json',metadata);
  // A legitimate exportable one-colour frame tests host generation ownership of a native decode.
  await start(page);await settings(page);await click(page,'prepare-sheet');const goodPng=await download(page,'download-sheet'),goodMeta=await download(page,'download-sheet-metadata'),source=await save(page);
  await page.locator('#sheet-metadata').setInputFiles({name:'m.json',mimeType:'application/json',buffer:goodMeta});await expect(page.locator('#sheet-import-status')).toContainText('4 admitted');
  await page.evaluate(()=>{const decode=window.createImageBitmap.bind(window);Object.assign(window,{decodeStarted:false,finishDecode:null});window.createImageBitmap=((...args:Parameters<typeof createImageBitmap>)=>{(window as unknown as{decodeStarted:boolean}).decodeStarted=true;return new Promise<ImageBitmap>(resolve=>{(window as unknown as{finishDecode:()=>void}).finishDecode=()=>decode(...args).then(resolve);});})as typeof createImageBitmap;});
  await page.locator('#sheet-png').setInputFiles({name:'p.png',mimeType:'image/png',buffer:goodPng});await expect.poll(()=>page.evaluate(()=>(window as unknown as{decodeStarted:boolean}).decodeStarted)).toBe(true);
  await page.locator('#sheet-metadata').setInputFiles({name:'replacement.json',mimeType:'application/json',buffer:goodMeta});await expect(page.locator('#sheet-import-status')).toContainText('4 admitted');await page.evaluate(()=>(window as unknown as{finishDecode:()=>void}).finishDecode());expect(await save(page)).toBe(source);
  await page.locator('#sheet-metadata').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"format":"wrong/2"}')});await expect(page.locator('#message')).toContainText('Unexpected sheet');await page.locator('#sheet-png').setInputFiles({name:'p.png',mimeType:'image/png',buffer:goodPng});await expect(page.locator('#message')).toContainText('Load sheet metadata first');expect(await save(page)).toBe(source);
});
