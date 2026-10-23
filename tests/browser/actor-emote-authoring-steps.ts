import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { click,field,open,save,addClip,key,transform } from './actor-animator-authoring';

export async function socket(page:Page,name:string,parent:string){await page.locator('#item-kind').selectOption('socket');await field(page,'item-name',name);await page.locator('#parent-node').selectOption({label:parent});await transform(page,'rest',{x:0,y:0,rotation:0,scaleX:1,scaleY:1});await click(page,'add-item');}
async function definition(page:Page,id:string,label:string,priority:number){await field(page,'emote-id',id);await field(page,'emote-label',label);await field(page,'emote-revision',1);await field(page,'emote-duration',2);await page.locator('#emote-playback').selectOption('once');await field(page,'emote-priority',priority);await click(page,'add-emote');}
async function role(page:Page,id:string,label:string,clip:string,rig:string,x:number,reflected:boolean,add=false,y=0){await field(page,'emote-role-id',id);await field(page,'emote-role-label',label);await page.locator('#emote-role-clip').selectOption({label:clip});await page.locator('#emote-role-rig').selectOption({label:rig});await field(page,'emote-role-start',0);await field(page,'emote-role-rate',1);await transform(page,'emote-role',{x,y,rotation:0,scaleX:reflected?-1:1,scaleY:1});await click(page,add?'add-emote-role':'apply-emote-role');}
async function bind(page:Page,name:string){await field(page,'emote-binding-name','contact');await page.locator('#emote-binding-socket').selectOption({label:name});await click(page,'write-emote-binding');}

/** No JSON generation: every shipped definition/pose is entered through forms. */
export async function authorAstronautEmotes(page:Page){
  await page.addInitScript(()=>{let n=0;Object.defineProperty(crypto,'randomUUID',{value:()=>`20000000-0000-4000-8000-${String(++n).padStart(12,'0')}`});});
  await page.goto('/actor-tools.html'); await page.getByRole('button', { name: 'All tools', exact: true }).click();await open(page,readFileSync(new URL('../fixtures/actor-projects/classic-astronaut-b3.project.json',import.meta.url),'utf8'));
  await page.locator('details').filter({ has: page.locator('summary', { hasText: 'Project details' }) }).last().evaluate((el: HTMLDetailsElement) => { el.open = true; });await field(page,'project-name','Classic astronaut — editable gestures and animation');await field(page,'project-version','0.3.0');await field(page,'project-provenance','Original MIT layered artwork, clips and solo/two-role choreography authored through Actor tools. Preview only; developer art review pending.');await click(page,'apply-project');
  await socket(page,'Palm contact','Near hand');
  await addClip(page,'Wave',2,'once');
  for(const[t,r]of [[0,0],[.4,2.4],[1.6,2.4],[2,0]])await key(page,'Astronaut / Near shoulder',t!,{rotation:r});
  for(const[t,r]of [[0,0],[.4,0],[.65,-.45],[1,.45],[1.35,-.45],[1.6,.45],[2,0]])await key(page,'Astronaut / Near elbow',t!,{rotation:r});
  await definition(page,'spacelab:wave','Wave',1);await role(page,'actor','Solo','Wave','Astronaut',0,false);
  for(const[name,lead]of [['High five initiator',true],['High five receiver',false]]as const){
    await addClip(page,name,2,'once');
    for(const[t,r]of [[0,0],[lead?.4:.55,lead?1.1:.8],[1,Math.PI/2],[1.35,1.2],[2,0]])await key(page,'Astronaut / Near shoulder',t!,{rotation:r});
    for(const[t,r]of [[0,0],[.5,lead?-.2:.2],[1,0],[1.35,.2],[2,0]])await key(page,'Astronaut / Near elbow',t!,{rotation:r});
  }
  await definition(page,'spacelab:high-five','High five',10);await role(page,'initiator','Initiator','High five initiator','Astronaut',-.66,false);await bind(page,'Palm contact');await role(page,'receiver','Receiver','High five receiver','Astronaut',.66,true,true);await bind(page,'Palm contact');
  return save(page);
}

/** Independent arbitrary-topology mapping shares only the semantic contract. */
export async function authorNonhumanEmotes(page:Page){
  await page.goto('/actor-tools.html'); await page.getByRole('button', { name: 'All tools', exact: true }).click();await open(page,readFileSync(new URL('../fixtures/actor-projects/nonhuman.project.json',import.meta.url),'utf8'));await socket(page,'Feeler contact','Feeler 0');
  for(const[name,sign]of [['Feeler greeting A',1],['Feeler greeting B',-1]]as const){await addClip(page,name,2,'once');for(const[t,r]of [[0,0],[1,sign*.7],[2,0]])await key(page,'Freely named creature / Feeler 0',t!,{rotation:r});}
  await definition(page,'spacelab:high-five','Six-limb greeting',10);await role(page,'initiator','Any initiator','Feeler greeting A','Freely named creature',-.66,false,false,.8);await bind(page,'Feeler contact');await role(page,'receiver','Any receiver','Feeler greeting B','Freely named creature',.66,true,true,.8);await bind(page,'Feeler contact');return save(page);
}
