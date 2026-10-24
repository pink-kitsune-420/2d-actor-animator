import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActorProject } from '../../packages/project-types/src';
import original from '../../examples/spacelab/beacon.actorproject?raw';
import { compileActorProject, createActorPose, evaluateActorPose, saveActorProject } from '../../packages/runtime/src';
import { createActorCanvas2DRenderer, type ActorRenderView } from '../../packages/adapters/canvas2d/src';
import { createActorWebGL2Renderer } from '../../packages/adapters/webgl2/src';

function source(): ActorProject { return JSON.parse(original) as ActorProject; }
const view: ActorRenderView = [40, 0, 0, -40, 0, 160];
function native() {
  const canvases: { width: number; height: number }[] = [], uploads: number[][] = [];
  const contexts: object[] = [];
  vi.stubGlobal('document', { createElement() {
    const canvas = { width: 0, height: 0, getContext() { return context; } };
    const context = { globalAlpha: 1,
      createImageData(w: number, h: number) { return { data: new Uint8ClampedArray(w * h * 4) }; },
      putImageData(data: { data: Uint8ClampedArray }) { uploads.push([...data.data]); }, drawImage() {},
    };
    canvases.push(canvas); contexts.push(context); return canvas;
  } });
  return { canvases, uploads, contexts };
}
function target() {
  const matrices: number[][] = [];
  const ctx = { save: vi.fn(), restore: vi.fn(), drawImage: vi.fn(), setTransform: (...m: number[]) => { matrices.push(m); } };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, raw: ctx, matrices };
}
afterEach(() => vi.unstubAllGlobals());
describe('optional rendering affine, source and lifetime contracts', () => {
  it('maps asymmetric pivots/density and top-down pixels without implicit metres scaling', () => {
    native(); const s = source(), before = saveActorProject(s), c = compileActorProject(s), p = createActorPose(c);
    const renderer = createActorCanvas2DRenderer(c), b = renderer.bind(p), t = target();
    b.draw(t.ctx, view); expect(t.matrices).toEqual([[20, 0, -0, 20, 40, 120]]);
    expect(t.raw.save).toHaveBeenCalledOnce(); expect(t.raw.restore).toHaveBeenCalledOnce();
    const buffers = [p.worldMatrices, p.partIndices, p.drawSequence];
    for (let i = 0; i < 1000; i++) { evaluateActorPose(c, 'profile:pulse', i / 1600, p); b.draw(t.ctx, view); }
    expect([p.worldMatrices, p.partIndices, p.drawSequence]).toEqual(buffers);
    expect(renderer.metrics).toMatchObject({ rasters: 2, rasterPixels: 8, rasterBytes: 32, bindings: 1, bindingNumericBytes: 48 });
    renderer.dispose(); expect(saveActorProject(s)).toBe(before);
  });
  it('preserves actual index0 colour/alpha in resource upload and source-order layer opacity', () => {
    const n = native(), c = compileActorProject(source()); createActorCanvas2DRenderer(c).dispose();
    expect(n.uploads[0]).toEqual([255,0,0,255,18,52,86,0,0,255,0,128,255,0,0,255]);
    expect(n.uploads[1]).toEqual([0,255,0,128,18,52,86,0,18,52,86,0,18,52,86,0]);
    expect(n.canvases.every(c => c.width === 0 && c.height === 0)).toBe(true);
  });
  it('shares resources between independent evaluated poses and refuses same-ID foreign and forged poses', () => {
    const n = native(), s = source(), c = compileActorProject(s), a = createActorPose(c), b = createActorPose(c), r = createActorCanvas2DRenderer(c);
    const first = r.bind(a), second = r.bind(b), t = target();
    evaluateActorPose(c, 'profile:pulse', .75, b); first.draw(t.ctx, view); second.draw(t.ctx, view);
    expect(t.matrices.map(m => m[4])).toEqual([40, 120]); expect(n.canvases).toHaveLength(3);
    expect(() => r.bind(createActorPose(compileActorProject(s)))).toThrow('belong');
    expect(() => r.bind({ ...a })).toThrow('belong');
    s.parts[0]!.revision++; s.parts[0]!.artwork.palette[1] = '#ffffffff';
    expect(() => r.bind(createActorPose(compileActorProject(s)))).toThrow('belong');
    first.dispose(); first.dispose(); expect(r.metrics.bindings).toBe(1); r.dispose(); r.dispose();
    expect(r.metrics).toMatchObject({ disposed: true, rasters: 0, bindings: 0, bindingNumericBytes: 0 });
    expect(() => second.draw(t.ctx, view)).toThrow('disposed');
  });
  it('preserves full shear/reflection and explicit affine host placement', () => {
    native(); const c = compileActorProject(source()), p = createActorPose(c), r = createActorCanvas2DRenderer(c), t = target();
    // Caller-mutable evaluated world matrix: no decomposition of [-2,1,3,4,5,6].
    p.worldMatrices.set([-2,1,3,4,5,6]);
    r.bind(p).draw(t.ctx, [2, 1, -1, 3, 7, 11]);
    // V*W=[-5,1,2,15,11,34]; raster x=.5i-.25,y=.25-.5j.
    expect(t.matrices[0]).toEqual([-2.5,.5,-1,-7.5,12.75,37.5]); r.dispose();
  });
  it('preflights overflow/corrupted slots before saving context or painting, and restores state on native failure', () => {
    native(); const c = compileActorProject(source()), p = createActorPose(c), r = createActorCanvas2DRenderer(c), b = r.bind(p), t = target();
    expect(() => b.draw(t.ctx, [Infinity,0,0,1,0,0])).toThrow('finite');
    p.worldMatrices[0] = Number.MAX_VALUE; expect(() => b.draw(t.ctx, view)).toThrow('overflow'); expect(t.raw.save).not.toHaveBeenCalled();
    evaluateActorPose(c,null,0,p); p.drawSequence[0] = 999; expect(() => b.draw(t.ctx,view)).toThrow('slot');
    evaluateActorPose(c,null,0,p); p.partIndices[0] = 999; expect(() => b.draw(t.ctx,view)).toThrow('artwork');
    evaluateActorPose(c,null,0,p); t.raw.drawImage.mockImplementation(() => { throw new Error('native failure'); });
    expect(() => b.draw(t.ctx,view)).toThrow('native failure'); expect(t.raw.restore).toHaveBeenCalledOnce(); r.dispose();
  });
  it('allows degenerate scales and empty/layerless actors without native drawing', () => {
    native(); const s = source(); s.parts.forEach(p => { p.artwork.layers = []; });
    const c = compileActorProject(s), p = createActorPose(c), r = createActorCanvas2DRenderer(c), t = target();
    r.bind(p).draw(t.ctx,view); expect(t.raw.drawImage).not.toHaveBeenCalled(); expect(r.metrics.rasters).toBe(0); r.dispose();
  });
  it('rolls back partial resource creation while preserving an older renderer', () => {
    const n = native(), c = compileActorProject(source()), old = createActorCanvas2DRenderer(c), oldCanvases = n.canvases.slice(0,3);
    const doc = document.createElement.bind(document); let call = 0;
    vi.stubGlobal('document', { createElement() { const c = doc('canvas'); if (++call === 3) c.getContext = (() => null) as typeof c.getContext; return c; } });
    expect(() => createActorCanvas2DRenderer(c)).toThrow('unavailable');
    expect(n.canvases.slice(3).every(c => c.width === 0 && c.height === 0)).toBe(true);
    expect(oldCanvases.filter(c => c.width > 0)).toHaveLength(2); expect(old.metrics.disposed).toBe(false); old.dispose();
  });
  it('rejects impossible resource geometry, raised core dimensions and unsupported compile before allocations', () => {
    const n = native(), s = source(); s.parts[0]!.unitsPerPixel = Number.MAX_VALUE;
    expect(() => compileActorProject(s)).toThrow('Unsafe raster');
    const c = compileActorProject(source());
    const large = source(); large.parts[0]!.artwork.width = 1025; large.parts[0]!.artwork.layers = [];
    expect(() => createActorCanvas2DRenderer(compileActorProject(large,{maxDimension:1025}))).toThrow('geometry');
    expect(() => createActorCanvas2DRenderer({ ...c, compilerVersion:'foreign/9' })).toThrow('compiled'); expect(n.canvases).toHaveLength(0);
  });
  it('rejects a partial failed solver evaluation until a complete evaluation succeeds', () => {
    native(); const s = source(); s.requiredCapabilities.push('spacelab:rig-constraints/1');
    s.rigs = [{ id:'r',name:'R',nodes:[{id:'n',name:'N',parentId:null,rest:{x:0,y:0,rotation:0,scaleX:1,scaleY:1}}],sockets:[],constraints:[{id:'bad',name:'Bad',solver:'test:throw/1',enabled:true,settings:{}}] }];
    let fail = false;
    const c = compileActorProject(s,{}, {solvers:[{id:'test:throw/1',version:'1',prepare:()=>({firstSlot:0,solve(){if(fail)throw new Error('solver failed');}})}]}), p = createActorPose(c), r = createActorCanvas2DRenderer(c), b = r.bind(p), t = target();
    fail = true; expect(() => evaluateActorPose(c,null,0,p)).toThrow('solver failed'); expect(() => b.draw(t.ctx,view)).toThrow('completed');
    evaluateActorPose(c,null,0,p,false); b.draw(t.ctx,view);
    expect(() => evaluateActorPose(c,'missing',0,p)).toThrow('Unknown'); b.draw(t.ctx,view); r.dispose();
  });
  it('WebGL unavailable cleanup releases all prepared CPU resources for explicit fallback', () => {
    const n = native(), c = compileActorProject(source());
    expect(() => createActorWebGL2Renderer(c,{getContext:()=>null} as unknown as HTMLCanvasElement)).toThrow('WebGL2 unavailable');
    expect(n.canvases.every(c => !c.width && !c.height)).toBe(true);
    const backup = createActorCanvas2DRenderer(c); expect(backup.metrics.rasters).toBe(2); backup.dispose();
  });
  it('refuses raised aggregate raster budgets before native allocation', () => {
    const n = native(), s = source(), art = s.parts[0]!.artwork;
    art.width = art.height = 512; art.layers = [{id:'large',name:'Large',opacity:1,pixels:Array<number>(512*512).fill(1)}];
    const c = compileActorProject(s,{maxPixels:512*512+8});
    expect(() => createActorCanvas2DRenderer(c)).toThrow('pixel budget'); expect(n.canvases).toHaveLength(0);
  });
});
