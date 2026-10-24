import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const manifest = JSON.parse(readFileSync('tests/conformance/manifest.json','utf8'));
test('Draft 1 static semantic fixtures pass in the independent built-package consumer', async({page,browser},info) => {
  console.log(`${info.project.name} actual browser ${browser.version()}`);
  const errors:string[]=[], external:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(new URL(r.url()).hostname!=='127.0.0.1')external.push(r.url());});
  await page.goto('/conformance-example/');
  await expect(page.locator('#status')).toHaveText(`Passed: ${manifest.cases.length}/${manifest.cases.length} semantic cases, 0 failures`);
  const report=JSON.parse((await page.locator('#report').textContent())!);
  expect(report.cases.map((c:{id:string})=>c.id)).toEqual(manifest.cases.map((c:{id:string})=>c.id));
  for(const profile of Object.values(report.profiles))expect(profile).toMatchObject({status:'passed'});
  expect(errors).toEqual([]);expect(external).toEqual([]);
});
for(const mode of ['webgl2','canvas2d'])test(`${mode} refuses incomplete overflow poses and recovers after successful sample`,async({page,browser},info)=>{
  console.log(`${info.project.name} actual browser ${browser.version()}`);
  await page.goto('/conformance-example/');
  const result=await page.evaluate(async(mode)=>{
    const corePath='/conformance-example/package/runtime.js',backendPath=`/conformance-example/package/${mode}.js`;
    const r=await import(corePath),backend=await import(backendPath);
    const source=await(await fetch('/conformance-example/fixtures/overflow.actorproject')).json();
    const c=r.compileActorProject(source),p=r.createActorPose(c),canvas=document.createElement('canvas');canvas.width=canvas.height=32;
    const renderer=mode==='webgl2'?backend.createActorWebGL2Renderer(c,canvas):backend.createActorCanvas2DRenderer(c);
    const b=renderer.bind(p),context=mode==='canvas2d'?canvas.getContext('2d'):null;
    const draw=()=>mode==='webgl2'?b.draw([1,0,0,-1,0,0]):b.draw(context,[1,0,0,-1,0,0]);
    const attempt=(fn:()=>void)=>{try{fn();return 'success';}catch(e){return(e as Error).name+': '+(e as Error).message;}};
    try{
      const overflow=attempt(()=>r.evaluateActorPose(c,'contract:overflow',0,p));
      const incomplete=attempt(draw),bind=attempt(()=>renderer.bind(p));
      r.evaluateActorPose(c,null,0,p);const recovered=attempt(draw);
      renderer.dispose();renderer.dispose();
      return{overflow,incomplete,bind,recovered,metrics:renderer.metrics,disposed:attempt(draw)};
    }finally{renderer.dispose();}
  },mode);
  expect(result.overflow).toContain('RangeError');expect(result.incomplete).toContain('completed');expect(result.bind).toContain('completed');
  expect(result.recovered).toBe('success');expect(result.metrics).toMatchObject({disposed:true,rasters:0,textures:0,bindings:0,bindingNumericBytes:0,resourceNumericBytes:0});
  expect(result.disposed).toContain('disposed');
});
