import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileActorProject, createActorPose, evaluateActorPose } from '@actor-animator/runtime';
import { createActorCanvas2DRenderer, ACTOR_CANVAS2D_RENDERER } from '@actor-animator/runtime/canvas2d';
import { createActorWebGL2Renderer, ACTOR_WEBGL2_RENDERER } from '@actor-animator/runtime/webgl2';
test('fresh installed optional imports are inert in Node and root objects share renderer brands', () => {
  assert.equal(ACTOR_CANVAS2D_RENDERER,'actor-animator:canvas2d/1'); assert.equal(ACTOR_WEBGL2_RENDERER,'actor-animator:webgl2/1');
  assert.equal(typeof createActorWebGL2Renderer,'function'); assert.equal(globalThis.document,undefined);
  const source = JSON.parse(readFileSync('beacon.actorproject','utf8')), before = JSON.stringify(source), canvases = [];
  globalThis.document = {createElement(){
    const ctx = {createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)};},putImageData(){},drawImage(){}};
    const canvas = {width:0,height:0,getContext(){return ctx;}};canvases.push(canvas);return canvas;
  }};
  try {
    const c = compileActorProject(source), a = createActorPose(c), b = createActorPose(c), r = createActorCanvas2DRenderer(c);
    const matrices=[],ctx={save(){},restore(){},setTransform(...m){matrices.push(m);},drawImage(){}};
    const first=r.bind(a),second=r.bind(b);evaluateActorPose(c,'profile:pulse',.75,b);
    first.draw(ctx,[40,0,0,-40,0,160]);second.draw(ctx,[40,0,0,-40,0,160]);
    assert.deepEqual(matrices.map(m=>m[4]),[40,120]);assert.equal(r.metrics.bindings,2);
    assert.throws(()=>r.bind(createActorPose(compileActorProject(source))),/belong/);
    assert.throws(()=>r.bind({...a}),/belong/);first.dispose();r.dispose();r.dispose();
    assert.equal(r.metrics.rasters,0);assert.equal(r.metrics.bindingNumericBytes,0);
    assert.ok(canvases.every(c=>c.width===0&&c.height===0));assert.equal(JSON.stringify(source),before);
  } finally {delete globalThis.document;}
});
