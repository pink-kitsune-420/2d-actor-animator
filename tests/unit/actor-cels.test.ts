import { describe, it, expect } from 'vitest';
import { markerSource } from '../../examples/modules/actor-project/src/source';
import { compileActorProject, createActorPose, evaluateActorPose, createActorAnimationPlayer, requestActorAnimationState, evaluateActorAnimation,
  validateActorProject, saveActorProject, syncCelCapability, editCelKey, setCelHold, deleteActorCel, importActorSheet, openActorSheet, applyDeletion, type ActorSheet } from '../../packages/actor-tools/src';
import { ActorDraft } from '../../apps/web/src/actor-tools/editing';
import { editPartRevision } from '../../apps/web/src/actor-tools/assembly';

function source() {
  const s=markerSource(); s.actions=[]; const p=structuredClone(s.parts[0]!);p.id='second';p.pivot=[.25,.75];p.unitsPerPixel=.5;s.parts.push(p);
  s.cels=[{id:'one',name:'One',partId:s.parts[0]!.id},{id:'two',name:'Two',partId:p.id}];
  s.clips[0]!.playback='once';s.clips[0]!.celTracks=[{id:'cels',target:{kind:'attachment',attachmentId:s.attachments[0]!.id},keys:[{time:.25,celId:'one'},{time:1,celId:'two'}]}];syncCelCapability(s);return s;
}
const sheet=():ActorSheet=>({format:'spacelab-actor-sheet/1',width:2,height:1,name:'Frames',duration:2,playback:'loop',sourceProjectId:'example:s',sourceVersion:'0.1.0',metresPerUnit:1,frames:[{x:0,y:0,width:1,height:1,time:0,pivot:[.5,.5],unitsPerPixel:1},{x:1,y:0,width:1,height:1,time:1,pivot:[.25,.75],unitsPerPixel:.5}]});

describe('B3 reusable cels and independent timing oracles',()=>{
  it('gates additive fields and checks all references, targets and shared track/key budgets',()=>{
    const s=source();s.requiredCapabilities=s.requiredCapabilities.filter(c=>c!=='spacelab:cel-tracks/1');expect(validateActorProject(s)).toMatchObject({ok:false,diagnostics:[{code:'capability'}]});
    syncCelCapability(s);s.clips[0]!.celTracks![0]!.keys[0]!.celId='missing';expect(validateActorProject(s).ok).toBe(false);
    const dup=source();dup.clips[0]!.celTracks![0]!.id=dup.clips[0]!.tracks[0]!.id;expect(validateActorProject(dup)).toMatchObject({ok:false,diagnostics:[{code:'duplicate'}]});
    expect(validateActorProject(source(),{maxKeys:3}).ok).toBe(false);expect(validateActorProject(source(),{maxTracks:1}).ok).toBe(false);
  });
  it('holds before first/exact keys, resets from rest and respects loop/once/ping-pong boundaries',()=>{
    const s=source(),c=compileActorProject(s),p=createActorPose(c),id=s.clips[0]!.id;
    for(const [time,index]of [[-1,0],[.249,0],[.999,0],[1,1],[2,1],[5,1]]){evaluateActorPose(c,id,time!,p);expect(p.partIndices[0]).toBe(index);}
    p.partIndices.fill(999);evaluateActorPose(c,null,0,p);expect([...p.partIndices]).toEqual([0]);
    s.clips[0]!.playback='loop';let cc=compileActorProject(s),pp=createActorPose(cc);evaluateActorPose(cc,id,2,pp);expect(pp.partIndices[0]).toBe(0);evaluateActorPose(cc,id,-.5,pp);expect(pp.partIndices[0]).toBe(1);
    s.clips[0]!.playback='ping-pong';s.requiredCapabilities.push('spacelab:animation-composition/1');cc=compileActorProject(s);pp=createActorPose(cc);evaluateActorPose(cc,id,3.5,pp);expect(pp.partIndices[0]).toBe(0);
  });
  it('switches incoming artwork at .5 during fades, fades untracked back, and additive ignores cels',()=>{
    const s=source();s.requiredCapabilities.push('spacelab:animation-composition/1');s.clips[0]!.celTracks![0]!.keys=[{time:0,celId:'two'}];
    s.animators=[{id:'a',name:'A',layers:[{id:'l',name:'L',blend:'override',weight:1,initialStateId:'rest',defaultTransition:{duration:2,priority:0},states:[{id:'rest',name:'Rest',clipId:null,rate:1},{id:'cel',name:'Cel',clipId:s.clips[0]!.id,rate:1}],transitions:[]}]}];
    let c=compileActorProject(s),p=createActorPose(c),a=createActorAnimationPlayer(c,'a');requestActorAnimationState(a,'l','cel',0);
    evaluateActorAnimation(c,a,.999,p);expect(p.partIndices[0]).toBe(0);evaluateActorAnimation(c,a,1,p);expect(p.partIndices[0]).toBe(1);
    requestActorAnimationState(a,'l','rest',2);evaluateActorAnimation(c,a,3,p);expect(p.partIndices[0]).toBe(0);evaluateActorAnimation(c,a,1,p);expect(p.partIndices[0]).toBe(1);
    const l=s.animators[0]!.layers[0]!;l.blend='additive';l.reference={clipId:s.clips[0]!.id,time:0};l.initialStateId='cel';c=compileActorProject(s);p=createActorPose(c);a=createActorAnimationPlayer(c,'a');evaluateActorAnimation(c,a,1,p);expect(p.partIndices[0]).toBe(0);
  });
  it('preserves source byte identity and edits holds without touching transform timing',()=>{
    const s=source(),text=saveActorProject(s);expect(saveActorProject(JSON.parse(text))).toBe(text);
    const draft=new ActorDraft(s),before=structuredClone(s.clips[0]!.tracks);draft.edit(s=>setCelHold(s,s.clips[0]!.id,s.attachments[0]!.id,.25,.5));expect(draft.source.clips[0]!.celTracks![0]!.keys[1]!.time).toBe(.75);expect(draft.source.clips[0]!.tracks).toEqual(before);
    const valid=saveActorProject(draft.source);expect(()=>draft.edit(s=>setCelHold(s,s.clips[0]!.id,s.attachments[0]!.id,.25,4))).toThrow();expect(saveActorProject(draft.source)).toBe(valid);
    draft.undo();expect(saveActorProject(draft.source)).toBe(text);
  });
  it('reuses cels, reviews deletion and requires explicit accepted part revision changes',()=>{
    const s=source();expect(()=>deleteActorCel(s,'two')).toThrow('clips');editCelKey(s,s.clips[0]!.id,s.attachments[0]!.id,.5,'one',()=> 'new');expect(s.clips[0]!.celTracks![0]!.keys).toHaveLength(3);
    const old=s.cels![1]!.partId;let revised='';
    // A cel-only reference has the same immutable accepted-art policy as an attachment.
    const standalone=source();standalone.clips=[];standalone.attachments=[];const cd=new ActorDraft(standalone);
    revised=editPartRevision(cd,old,p=>{p.artwork.palette[0]='#010203ff';});expect(revised).not.toBe(old);expect(cd.source.cels![1]!.partId).toBe(old);
    const lines=applyDeletion(s,{kind:'attachment',id:s.attachments[0]!.id});expect(lines.join('\n')).toContain('cels');expect(s.clips[0]!.celTracks).toEqual([]);
  });
  it('imports bounded flattened metadata as ordinary zero-bone source, preserving pivots and timing',()=>{
    const s=markerSource(),meta=sheet(),parts=[structuredClone(s.parts[0]!),structuredClone(s.parts[0]!)];parts[0]!.id='f0';parts[1]!.id='f1';let n=0;
    const id=importActorSheet(s,meta,parts,()=>`import-${++n}`);expect(validateActorProject(s).ok).toBe(true);
    expect(s.rigs).toEqual([]);expect(s.parts.at(-1)!.pivot).toEqual([.25,.75]);expect(s.parts.at(-1)!.unitsPerPixel).toBe(.5);
    const c=compileActorProject(s),p=createActorPose(c);evaluateActorPose(c,id,1,p);const slot=c.slots.findIndex(slot=>slot.id===s.attachments.at(-1)!.id);expect(p.partIndices[slot]).toBe(2);
  });
  it('converts flattened visual calibration between project units without physical output',()=>{
    const s=markerSource();s.units.metresPerUnit=.5;const parts=[structuredClone(s.parts[0]!),structuredClone(s.parts[0]!)];parts[0]!.id='f0';parts[1]!.id='f1';let n=0;
    importActorSheet(s,sheet(),parts,()=>`i${++n}`);expect(s.parts.at(-1)!.pivot).toEqual([.5,1.5]);expect(s.parts.at(-1)!.unitsPerPixel).toBe(1);expect(s.units.metresPerUnit).toBe(.5);
  });
  it('rejects metadata over budgets, overlaps, unknown fields and non-monotonic holds before decode',()=>{
    const s=sheet();expect(openActorSheet(JSON.stringify(s))).toEqual(s);
    for(const mutate of [(s:ActorSheet)=>{s.width=257;},(s:ActorSheet)=>{s.frames[1]!.x=0;},(s:ActorSheet)=>{s.frames[1]!.time=0;},(s:ActorSheet)=>{s.frames[1]!.unitsPerPixel=0;}]){const bad=sheet();mutate(bad);expect(()=>openActorSheet(JSON.stringify(bad))).toThrow();}
    expect(()=>openActorSheet(JSON.stringify({...s,url:'https://invalid'}))).toThrow();expect(()=>openActorSheet(' '.repeat(65537))).toThrow('64 KiB');
  });
});
