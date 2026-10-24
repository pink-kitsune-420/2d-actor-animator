import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const beacon = JSON.parse(readFileSync('examples/spacelab/beacon.actorproject','utf8'));
async function proof(page: Page, name: string, mode = 'webgl2') {
  await page.goto('/rendering-example/');
  return page.evaluate(async ({name,mode,source}) => {
    const path='/rendering-example/proofs.mjs',m=await import(path);
    return ['setupFailure','contextLoss'].includes(name)?m[name](source):m[name](mode,source);
  },{name,mode,source:beacon});
}
function near(actual: number[], expected: number[], tolerance=1) { for(let i=0;i<expected.length;i++)expect(Math.abs(actual[i]!-expected[i]!)).toBeLessThanOrEqual(tolerance); }
function evidence(name: string, value: unknown, browser: string){
  if(process.env.ANIMATOR_S7_DEMO==='1'&&browser==='chromium'){mkdirSync('test-results/evidence/s7-demo',{recursive:true});writeFileSync(`test-results/evidence/s7-demo/${name}.json`,JSON.stringify(value,null,2));}
}
test.beforeEach(async({browser},info)=>{console.log(`${info.project.name} actual browser ${browser.version()}`);});
for(const mode of ['webgl2','canvas2d']){
  test(`${mode} installed output preserves layered RGBA, pivots, fractional cels and shared independent instance lifetimes`,async({page},info)=>{
    const r=await proof(page,'layered',mode);
    near(r.pixels[0],[191,64,0,255]);expect(r.pixels[1]).toEqual([0,0,0,0]);near(r.pixels[2],[0,255,0,128]);expect(r.pixels[3]).toEqual([255,0,0,255]);expect(r.pixels[4]).toEqual([0,0,255,255]);
    expect(r.samples.map((s:{x:number;visible:number})=>[s.x,s.visible])).toEqual([[3.25,0],[3.25,1],[3.25,1],[1.25,1]]);
    expect(r.hidden).toEqual([[0,0,0,0]]);expect([r.creates,r.uploads]).toEqual([0,0]);expect(r.retained).toBe(true);expect(r.sourceUnchanged).toBe(true);
    for(const name of ['foreign','forged','revision'])expect(r[name]).toContain('belong');expect(r.afterDispose).toContain('disposed');
    expect(r.metrics).toMatchObject(mode==='webgl2'?{rasters:0,textures:2,textureBytes:32,bindings:2,bindingNumericBytes:168}:{rasters:2,textures:0,rasterBytes:32,bindings:2,bindingNumericBytes:96});
    expect(r.afterBinding.bindings).toBe(1);expect(r.disposed).toMatchObject({disposed:true,textures:0,rasters:0,bindings:0,bindingNumericBytes:0});evidence(`${mode}-pixels-lifecycle`,r,info.project.name);
  });
  test(`${mode} shear, reflection, draw order, zero scales and viewport clipping match independent interior pixels`,async({page},info)=>{
    const r=await proof(page,'affine',mode);for(const frame of r.results){expect(frame.checked).toBeGreaterThan(64);expect(frame.mismatch).toBe(0);}near(r.actualWorld,r.expectedWorld,1e-12);expect(r.degenerate).toEqual([[0,0,0,0],[0,0,0,0]]);evidence(`${mode}-affine`,r,info.project.name);
  });
  test(`${mode} composition masks, curved clips, additive references and solved/raw constraints render from root poses`,async({page},info)=>{
    const c=await proof(page,'composition',mode);expect(c.x).toBeCloseTo(10.5,10);expect(c.sourceUnchanged).toBe(true);near(c.pixels[0],[191,64,0,255]);
    const angles=await proof(page,'curves',mode);near(angles.actual,angles.expected,1e-12);expect(angles.unwrappedRotation).toBeCloseTo(angles.expectedUnwrapped,12);
    const r=await proof(page,'constraints',mode);expect(r.raw).toEqual([2,0]);near(r.solved,[1,1],.0001);expect(r.residual).toBeLessThan(.0001);expect(r.unknown).toBe('unsupported');expect(r.unknownResidual).toBe(true);expect(r.ink.some((p:number[])=>p[3]!>0)).toBe(true);evidence(`${mode}-composition-constraints`,{composition:c,angles,constraints:r},info.project.name);
  });
  test(`${mode} rejects unsafe geometry and required capabilities while preserving source and caller state`,async({page},info)=>{
    const r=await proof(page,'refusals',mode);expect(r.nonfinite).toContain('finite');expect(r.overflow).toContain('overflow');expect(r.foreignPart).toContain('artwork');expect(r.capability).toContain('Unsupported required capability');expect(r.sourceUnchanged).toBe(true);
    if(mode==='webgl2')expect(r.float32).toContain('Float32');else{expect(r.nativeFailure).toContain('injected native');expect(r.restored).toBe(true);}evidence(`${mode}-refusals`,r,info.project.name);
  });
}
test('primary WebGL2 partial upload failure releases owned resources and leaves the previous renderer valid',async({page},info)=>{
  const r=await proof(page,'setupFailure');expect(r.error).toContain('texture allocation failed');expect(r.created).toBeGreaterThan(3);expect(r.deleted).toBe(r.created);expect(r.balanced).toBe(true);expect(r.oldReady).toBe('ready');evidence('webgl2-setup-failure',r,info.project.name);
});
test('native WebGL2 context loss refuses later work and permits an explicit Canvas2D backup',async({page},info)=>{
  const r=await proof(page,'contextLoss');expect(r.status).toBe('context-lost');for(const name of ['draw','clear','bind'])expect(r[name]).toContain('context lost');expect(r.disposed.textures).toBe(0);near(r.pixels[0],[191,64,0,255]);evidence('webgl2-context-loss',r,info.project.name);
});
test('standalone installed consumer demonstrates character, bound multiple-root rigs, zero bones, backend replacement and reopen',async({page},info)=>{
  const errors:string[]=[],external:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).hostname!=='127.0.0.1')external.push(r.url());});
  await page.goto('/rendering-example/');await expect(page.locator('#status')).toContainText('Prepared webgl2');
  for(const name of ['character','nonhuman','zero-bone']){
    await page.locator('#example').selectOption(name);await expect(page.locator('#source')).toHaveValue(readFileSync(`dist/rendering-example/${name}.actorproject`,'utf8'));
    await expect(page.locator('#status')).toContainText('Prepared webgl2');const text=await page.locator('#source').inputValue();
    const report=JSON.parse((await page.locator('#report').textContent())!);expect(report.independentBuffers).toBe(true);expect(report.sourceUnchanged).toBe(true);expect(report.sourceCounts.rigs).toBe(name==='character'?1:name==='nonhuman'?2:0);
    if(name==='nonhuman')expect(report.sourceCounts.roots).toBe(3);
    if(process.env.ANIMATOR_S7_DEMO==='1'&&info.project.name==='chromium'){
      mkdirSync('test-results/evidence/s7-demo',{recursive:true});writeFileSync(`test-results/evidence/s7-demo/${name}.actorproject`,text);writeFileSync(`test-results/evidence/s7-demo/${name}-webgl2-report.json`,JSON.stringify(report,null,2));await page.screenshot({path:`test-results/evidence/s7-demo/${name}-webgl2.png`,fullPage:true});
    }
    await page.locator('#backend').selectOption('canvas2d');await expect(page.locator('#status')).toContainText('Prepared canvas2d');expect(await page.locator('#source').inputValue()).toBe(text);
    const ink=await page.locator('canvas').evaluate((c:HTMLCanvasElement)=>{const d=c.getContext('2d')!.getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i])n++;return n;});expect(ink).toBeGreaterThan(100);
    if(process.env.ANIMATOR_S7_DEMO==='1'&&info.project.name==='chromium')await page.screenshot({path:`test-results/evidence/s7-demo/${name}-canvas2d.png`,fullPage:true});
    await page.locator('#dispose').click();await expect(page.locator('#status')).toContainText('Resources disposed');expect(JSON.parse((await page.locator('#report').textContent())!).bindings).toBe(0);
    await page.locator('#reopen').click();await expect(page.locator('#status')).toContainText('Prepared canvas2d');expect(await page.locator('#source').inputValue()).toBe(text);await page.locator('#backend').selectOption('webgl2');
  }
  expect(errors).toEqual([]);expect(external).toEqual([]);
});
