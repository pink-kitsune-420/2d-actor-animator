import { describe, expect, it } from 'vitest';
import { markerSource } from '../../examples/modules/actor-project/src/source';
import { compileActorProject, createActorPose, evaluateActorPose, saveActorProject, syncAnimationCapability } from '../../packages/actor-tools/src';
import { ActorDraft } from '../../apps/web/src/actor-tools/editing';
import { changeCurve, controls, controlAt, CurveEdit, curvePath, effectiveCurve, fitControls, segment, validateControls } from '../../apps/web/src/actor-tools/curve-model';
import type { ActorTransform, ActorProject } from '@actor-animator/types';
const T = (x=0, rotation=0): ActorTransform => ({x,y:0,rotation,scaleX:1,scaleY:1});
const ref = {clipId:'curve',trackId:'t',time:.25,next:1.75};
function source() { const s=markerSource();s.actions=[];s.extensions['foreign:curve']={inert:[3,2,1]};s.clips=[{id:'curve',name:'Curve',duration:2.5,playback:'once',tracks:[{id:'t',target:{kind:'attachment',attachmentId:s.attachments[0]!.id},interpolation:'linear',keys:[{time:.25,value:T(0,3)},{time:1.75,value:T(2,-3),curve:'step'}]}]}];syncAnimationCapability(s);return s; }
function sample(s:ActorProject,time:number) {const c=compileActorProject(s),p=createActorPose(c);evaluateActorPose(c,'curve',time,p);return p.localTRS;}
describe('outgoing curve source contract and independent graph/runtime oracles',()=>{
  it('changes only requested outgoing fields and keeps exact undo/redo and inert metadata',()=>{
    const s=source(),t=s.clips[0]!.tracks[0]!;t.angle='shortest';t.keys[0]!.turns=-2;syncAnimationCapability(s);
    s.animators=[];s.clips[0]!.visibilityTracks=[];s.clips[0]!.drawOrderTracks=[];
    const d=new ActorDraft(s),before=saveActorProject(d.source),expected=structuredClone(d.source);
    expected.clips[0]!.tracks[0]!.keys[0]!.curve='cubic-bezier';expected.clips[0]!.tracks[0]!.keys[0]!.bezier=[1,2,0,-1];
    expect(new CurveEdit(d,ref).finish('cubic-bezier',[1,2,0,-1])).toBe(true);expect(d.source).toEqual(expected);
    const after=saveActorProject(d.source);d.undo();expect(saveActorProject(d.source)).toBe(before);expect(d.canUndo).toBe(false);d.redo();expect(saveActorProject(d.source)).toBe(after);
    new CurveEdit(d,ref).finish(undefined);expect(d.source.clips[0]!.tracks[0]!.keys[0]).toEqual(s.clips[0]!.tracks[0]!.keys[0]);
  });
  it('refuses invalid controls, missing/last/stale segments atomically; no-op/cancel has no history',()=>{
    const d=new ActorDraft(source()),before=saveActorProject(d.source);const noop=new CurveEdit(d,ref);expect(noop.finish(undefined)).toBe(false);expect(d.canUndo).toBe(false);
    const cancel=new CurveEdit(d,ref);cancel.cancel();expect(cancel.finish('linear')).toBe(false);
    for(const b of [[-1,0,1,1],[0,0,2,1],[0,NaN,1,1],[0,0,1,Infinity]] as [number,number,number,number][])expect(()=>new CurveEdit(d,ref).finish('cubic-bezier',b)).toThrow();
    expect(saveActorProject(d.source)).toBe(before);expect(d.canUndo).toBe(false);
    expect(()=>segment(d.source,{...ref,time:1.75,next:2})).toThrow();expect(()=>segment(d.source,{...ref,next:1})).toThrow();
    const stale=new CurveEdit(d,ref);d.replace(d.source);expect(()=>stale.finish('linear')).toThrow('selection changed');expect(saveActorProject(d.source)).toBe(before);
  });
  it('inspects inheritance/presets without normalization and retains last-key metadata',()=>{
    const s=source(),before=saveActorProject(s),t=s.clips[0]!.tracks[0]!,k=t.keys[0]!;
    expect(effectiveCurve(t,k)).toBe('linear');t.interpolation='step';expect(effectiveCurve(t,k)).toBe('step');t.interpolation='linear';
    expect(controls('ease-in')).toEqual([.42,0,1,1]);expect(controls('ease-out')).toEqual([0,0,.58,1]);expect(controls('ease-in-out')).toEqual([.42,0,.58,1]);
    expect(saveActorProject(s)).toBe(before);expect(t.keys[1]!.curve).toBe('step');
    validateControls([1,-100,0,100]);const b=controls('cubic-bezier',{...k,bezier:[1,-100,0,100]});expect(fitControls(b)).toEqual({lo:-120,hi:120});expect(b).toEqual([1,-100,0,100]);
  });
  it('maps fractional CSS geometry without backing/integer rounding and represents real parametric X/Y',()=>{
    const range={lo:-1,hi:3},rect={x:17.25,y:28.125,width:320.5,height:224.35};
    // Independently: viewBox(124,126) -> x=.25, y=1.
    const p=controlAt(rect,rect.x+124/400*rect.width,rect.y+126/280*rect.height,range);
    expect(p.x).toBeCloseTo(.25,14);expect(p.y).toBeCloseTo(1,14);
    expect(curvePath('cubic-bezier',[0,2,1,-1],range)).toBe('M48,177 C48,75 352,228 352,126');
    expect(curvePath('step',[0,0,1,1],range)).toBe('M48,177 H352 M352,177 V126');
  });
  it('uses independently calculated parametric samples for asymmetric, flat and crossing X controls',()=>{
    const cases=[{b:[0,2,0,-1],s:.5,x:.125,y:.5},{b:[1,0,1,0],s:.5,x:.875,y:.125},{b:[1,2,0,2],s:.25,x:.4375,y:1.140625},{b:[1/3,2,2/3,2],s:.5,x:.5,y:1.625}] as const;
    for(const {b,x,y} of cases){const s=source();changeCurve(s,ref,'cubic-bezier',[...b]);expect(sample(s,.25+1.5*x)[0]).toBeCloseTo(2*y,9);expect(sample(s,.25)[0]).toBe(0);expect(sample(s,1.75)[0]).toBe(2);}
    const s=source();changeCurve(s,ref,'cubic-bezier',[0,-2,0,-2]); // X(.5)=.125, Y(.5)=-1.375
    expect(sample(s,.4375)[0]).toBeCloseTo(-2.75,9);
  });
  it('preserves unwrapped/shortest/positive/negative turns and exact half-turn boundary',()=>{
    const s=source(),t=s.clips[0]!.tracks[0]!;expect(sample(s,1)[2]).toBe(0);t.angle='shortest';syncAnimationCapability(s);expect(sample(s,1)[2]).toBeCloseTo(Math.PI,12);
    for(const turns of [-2,-1,1,2]){t.keys[0]!.turns=turns;expect(sample(s,1)[2]).toBeCloseTo(Math.PI+Math.PI*turns,12);}delete t.keys[0]!.turns;
    t.keys[0]!.value.rotation=0;t.keys[1]!.value.rotation=Math.PI;expect(sample(s,1)[2]).toBeCloseTo(-Math.PI/2,12);expect(sample(s,1.75)[2]).toBe(Math.PI);
  });
});
