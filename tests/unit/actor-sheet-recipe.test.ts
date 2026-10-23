import { describe,it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ActorProject } from '@actor-animator/types';
import { sheetRecipe,type SheetRecipe } from '../../apps/web/src/actor-tools/sheet-recipe';
import { ActorDraft } from '../../apps/web/src/actor-tools/editing';
import { openActorSheet,importActorSheet,saveActorProject } from '../../packages/actor-tools/src';
import { rgbaPart } from '../../apps/web/src/actor-tools/png';
const source=()=>JSON.parse(readFileSync(new URL('../../examples/spacelab/beacon.actorproject',import.meta.url),'utf8')) as ActorProject;
const recipe=():SheetRecipe=>({mode:'explicit',times:'0, .5, .75, .875',count:4,columns:2,width:32,height:16,scale:4,centreX:2,centreY:.5});
describe('sampled sheet recipes (editor local, legacy metadata unchanged)',()=>{
  it('derives independent seconds, positive holds, grid/padding and asymmetric project-unit pivots',()=>{
    const s=source(),before=saveActorProject(s),m=sheetRecipe(s,'profile:pulse',recipe());
    expect([m.width,m.height,m.metresPerUnit]).toEqual([64,32,.01]);
    expect(m.frames).toEqual([
      {x:0,y:0,width:32,height:16,time:0,pivot:[2,1.5],unitsPerPixel:.25},
      {x:32,y:0,width:32,height:16,time:.5,pivot:[2,1.5],unitsPerPixel:.25},
      {x:0,y:16,width:32,height:16,time:.75,pivot:[2,1.5],unitsPerPixel:.25},
      {x:32,y:16,width:32,height:16,time:.875,pivot:[2,1.5],unitsPerPixel:.25},
    ]);
    expect(m.frames.map((f,i)=>(m.frames[i+1]?.time??m.duration)-f.time)).toEqual([.5,.25,.125,.125]);
    const padded=sheetRecipe(s,'profile:pulse',{...recipe(),times:'0,.5,.75'});expect([padded.width,padded.height,padded.frames.length]).toEqual([64,32,3]);
    expect(saveActorProject(s)).toBe(before);
  });
  it('uniform seconds exclude duplicate loop endpoint while legacy /1 still admits endpoint samples',()=>{
    const s=source();s.clips[0]!.duration=2;
    const m=sheetRecipe(s,'profile:pulse',{...recipe(),mode:'uniform'});
    expect(m.frames.map(f=>f.time)).toEqual([0,.5,1,1.5]);
    m.frames[3]!.time=2;expect(openActorSheet(JSON.stringify(m)).frames[3]!.time).toBe(2);
  });
  it('refuses ambiguous schedules atomically, without sorting/clamping or editing keys/history',()=>{
    const d=new ActorDraft(source()),text=saveActorProject(d.source),epoch=d.epoch;
    for(const times of ['',',','0,','0,.5,.5','0,.75,.5','.1,.5','0,1','0,-1','0,Infinity','0,NaN','0,1e-9999','0,'.repeat(65),' '.repeat(4097)])expect(()=>sheetRecipe(d.source,'profile:pulse',{...recipe(),times})).toThrow();
    expect(saveActorProject(d.source)).toBe(text);expect(d.epoch).toBe(epoch);expect(d.dirty).toBe(false);d.undo();expect(saveActorProject(d.source)).toBe(text);
  });
  it('refuses nonfinite/fractured/impossible allocations and finite numbers whose derived scale overflows',()=>{
    for(const delta of [{width:257},{width:1.5},{height:0},{columns:65},{columns:5},{width:256},{scale:0},{scale:Infinity},{scale:Number.MIN_VALUE},{centreX:Infinity},{scale:1e308,centreX:2},{scale:1e-307,width:256,height:256,columns:1}])expect(()=>sheetRecipe(source(),'profile:pulse',{...recipe(),...delta})).toThrow();
    expect(()=>sheetRecipe(source(),'missing',recipe())).toThrow('Select a clip');
  });
  it('reimport is one transaction with exact old source/history, and indexed refusal never quantizes',()=>{
    const s=source(),d=new ActorDraft(s),before=saveActorProject(d.source),m=sheetRecipe(s,'profile:pulse',recipe());let n=0;
    const parts=m.frames.map((f,i)=>{const p=rgbaPart('frame',f.width,f.height,new Uint8ClampedArray(f.width*f.height*4));p.id=`part-${i}`;return p;});
    d.edit(s=>{importActorSheet(s,m,parts,()=>`new-${++n}`);});
    expect(d.source.parts.slice(0,2)).toEqual(s.parts);expect(d.source.rigs).toEqual(s.rigs);expect(d.source.extensions).toEqual(s.extensions);expect(d.source.parts.at(-1)!.pivot).toEqual([2,1.5]);
    d.undo();expect(saveActorProject(d.source)).toBe(before);d.redo();expect(d.source.parts.length).toBe(6);
    // 256 opaque colours + mandatory transparent entry exceeds indexed import capacity.
    const pixels=new Uint8ClampedArray(256*4);for(let i=0;i<256;i++){pixels[i*4]=i;pixels[i*4+3]=255;}
    expect(()=>rgbaPart('too many',256,1,pixels)).toThrow('256 palette entries');expect(saveActorProject(s)).toBe(before);
  });
});
