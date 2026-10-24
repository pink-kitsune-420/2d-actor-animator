import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { ActorProject } from '@actor-animator/types';
import { showProjectDetails, click, field, open, save, transform } from './actor-animator-authoring';

export async function selectPart(p:Page,name:string){const value=await p.locator('#parts option').filter({hasText:`${name} ·`}).first().getAttribute('value');await p.locator('#parts').selectOption(value!);}
export async function dot(p:Page,x:number,y:number){await p.locator('#paint').scrollIntoViewIfNeeded();const b=(await p.locator('#paint').boundingBox())!;await p.mouse.click(b.x+x*16+8,b.y+y*16+8);}
export async function cel(p:Page,name:string){await field(p,'cel-name',name);await click(p,'new-cel');}
export async function celKey(p:Page,attachment:string,time:number,name:string){await p.locator('#cel-attachment').selectOption({label:attachment});await click(p,'new-cel-key');await field(p,'cel-key-time',time);await p.locator('#cel-key-cel').selectOption({label:name});await click(p,'write-cel-key');}
export async function part(p:Page,name:string,width:number,height:number){await field(p,'part-name',name);await field(p,'width',width);await field(p,'height',height);await click(p,'add-part');}

/** Extension recipe uses only downloaded B2 source and normal tool actions. */
export async function authorAstronautHybrid(p:Page){
  await p.addInitScript(()=>{let n=0;Object.defineProperty(crypto,'randomUUID',{value:()=>`10000000-0000-4000-8000-${String(++n).padStart(12,'0')}`});});
  await p.goto('/actor-tools.html'); await p.getByRole('button', { name: 'All tools', exact: true }).click();await open(p,readFileSync(new URL('../fixtures/actor-projects/classic-astronaut-b2.project.json',import.meta.url),'utf8'));
  await showProjectDetails(p);await field(p,'project-name','Classic astronaut — layered animation');await field(p,'project-version','0.2.0');await field(p,'project-provenance','Original MIT artwork and hybrid visual clips authored through Actor tools. 16 pixels/metre; developer art review pending.');await click(p,'apply-project');
  await selectPart(p,'Helmet');await cel(p,'Helmet base');await click(p,'copy-cel-art');await p.locator('#palette').selectOption('1');await dot(p,6,4);await dot(p,7,3);await cel(p,'Visor glint');
  const before=JSON.parse(await save(p)) as ActorProject;
  for(const c of before.clips){await p.locator('#clips').selectOption(c.id);for(const [t,name]of [[0,'Helmet base'],[c.duration*.45,'Visor glint'],[c.duration*.6,'Helmet base']]as const)await celKey(p,'Helmet art',t,name);}
  for(const side of ['Near','Far']){
    await selectPart(p,side==='Near'?'Glove':'Far Glove');await cel(p,`${side} glove open`);await click(p,'copy-cel-art');await p.locator('#palette').selectOption('5');await dot(p,1,1);await dot(p,2,1);await cel(p,`${side} rung grip`);
    for(const name of ['Climb enter','Climb','Climb exit']){await p.locator('#clips').selectOption({label:name});const duration=Number(await p.locator('#duration').inputValue());for(const [t,celName]of [[0,`${side} glove open`],[duration*.4,`${side} rung grip`],[duration*.65,`${side} glove open`]]as const)await celKey(p,`${side} hand art`,t,celName);}
  }
  await part(p,'Breath blank',5,5);await field(p,'units',1/16);await field(p,'pivot-x',2.5/16);await field(p,'pivot-y',2.5/16);await click(p,'pivot');await cel(p,'Breath off');
  await part(p,'Breath bubbles',5,5);await field(p,'units',1/16);await field(p,'pivot-x',2.5/16);await field(p,'pivot-y',2.5/16);await click(p,'pivot');await p.locator('#palette').selectOption('2');await field(p,'colour','#82c9dd');await field(p,'alpha',180);await click(p,'apply-colour');for(const[x,y]of [[2,0],[0,2],[4,2],[2,4]])await dot(p,x!,y!);await cel(p,'Breath bubbles');
  await selectPart(p,'Breath blank');await p.locator('#item-kind').selectOption('attachment');await field(p,'item-name','Breath effect');await p.locator('#parent-node').selectOption({label:'Head'});await transform(p,'rest',{x:.45,y:0,rotation:0,scaleX:1,scaleY:1});await field(p,'draw-order',12);await click(p,'add-item');
  await p.locator('#clips').selectOption({label:'Swim'});for(const[t,name]of [[0,'Breath off'],[.4,'Breath bubbles'],[.8,'Breath off'],[1.2,'Breath bubbles']]as const)await celKey(p,'Breath effect',t,name);
  const text=await save(p),source=JSON.parse(text) as ActorProject;expect(source.cels).toHaveLength(8);expect(source.rigs[0]!.nodes).toHaveLength(15);expect(source.attachments).toHaveLength(16);expect(source.clips).toHaveLength(11);return text;
}
