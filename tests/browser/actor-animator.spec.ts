import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import type { ActorProject } from '@actor-animator/types';
import { markerSource } from '../../examples/modules/actor-project/src/source';
import { disposePage, authorAstronaut, click, field, key, open, save, addClip } from './actor-animator-authoring';

test('classic astronaut is reproducibly authored through the painter, rig and timeline; every clip is reviewable', async ({ page }, info) => {
  test.setTimeout(600_000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const text = await authorAstronaut(page);
  const path = new URL('../fixtures/actor-projects/classic-astronaut-b2.project.json', import.meta.url);
  if (process.env.ACTOR_UPDATE_EXAMPLE === '1') writeFileSync(path, text + '\n');
  else expect(text).toBe(readFileSync(path, 'utf8').trimEnd());
  await click(page, 'retained'); await disposePage(page); await click(page, 'reopen'); await page.getByRole('button', { name: 'All tools', exact: true }).click(); await open(page, text); expect(await save(page)).toBe(text);
  await page.locator('#preview-zoom').selectOption('128'); await field(page, 'preview-origin-y', .8); await field(page, 'preview-grid', .5); await page.locator('#preview-markers').uncheck(); await click(page, 'apply-preview-aids');
  const source = JSON.parse(text) as ActorProject;
  for (const c of source.clips) {
    await page.locator('#clips').selectOption(c.id);
    for (const [label, fraction] of [['start', 0], ['mid', .5], ['end', .999]] as const) {
      await field(page, 'seek-time', c.duration * fraction); await click(page, 'seek');
      await page.locator('#actor-preview').screenshot({ path: info.outputPath(`${c.name.replaceAll(' ', '-')}-${label}.png`) });
    }
  }
  await page.locator('#animator-layers').selectOption({ label: 'Base' });
  for (const [time, state] of [[.5, 'Walk'], [1.5, 'Run'], [2.5, 'Jump anticipation'], [4, 'Climb enter'], [6, 'Climb exit'], [7, 'Swim']] as const) {
    await page.locator('#animation-states').selectOption({ label: state }); await field(page, 'request-time', time); await click(page, 'append-request');
  }
  await field(page, 'animator-time', 3); await click(page, 'seek-animator'); await expect(page.locator('#composition-status')).toContainText('accepted');
  await page.locator('#actor-preview').screenshot({ path: info.outputPath('astronaut-transition.png') });
  expect(errors).toEqual([]); await info.attach('classic-astronaut.actorproject', { body: text, contentType: 'application/json' });
});

test('timeline keys, visibility, painter order, composition, masks, undo and native focus on a nonhuman project', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const source = readFileSync(new URL('../fixtures/actor-projects/nonhuman.project.json', import.meta.url), 'utf8');
  await page.goto('/actor-tools.html'); await page.getByRole('button', { name: 'All tools', exact: true }).click(); await open(page, source);
  await addClip(page, 'Tail oscillation', 2, 'ping-pong');
  const target = await page.locator('#track-target option').filter({ hasText: 'Tail' }).first().textContent();
  await key(page, target!, 0, { rotation: 3 }, 'linear'); await key(page, target!, 1, { rotation: -3 }); await key(page, target!, 2, { rotation: 3 });
  await page.locator('#timeline-keys').selectOption('0'); await page.locator('#key-angle').selectOption('shortest'); await field(page, 'key-turns', 1); await click(page, 'write-key');
  await page.locator('#key-channel').selectOption('visibility'); await field(page, 'timeline-time', 0); await page.locator('#key-visible').uncheck(); await click(page, 'write-key');
  await click(page, 'new-key'); await field(page, 'timeline-time', 1); await page.locator('#key-visible').check(); await click(page, 'write-key');
  await page.locator('#track-target').selectOption(await page.locator('#track-target option').filter({ hasText: 'Attachment /' }).first().getAttribute('value') ?? '');
  await page.locator('#key-channel').selectOption('draw-order'); await field(page, 'timeline-time', .5); await field(page, 'key-order', 9); await click(page, 'write-key');
  await click(page, 'add-animator'); await click(page, 'add-animation-layer'); await field(page, 'state-name', 'Scuttle'); await page.locator('#state-clip').selectOption({ label: 'Tail oscillation' }); await field(page, 'state-rate', -1); await click(page, 'add-animation-state'); await click(page, 'initial-state');
  await page.locator('#mask-mode').selectOption('selected'); await page.locator('#layer-mask').selectOption(await page.locator('#layer-mask option').first().getAttribute('value') ?? ''); await click(page, 'apply-animation-layer');
  await page.locator('#transition-from').selectOption({ label: 'Scuttle' }); await page.locator('#transition-to').selectOption({ label: 'Rest' }); await field(page, 'transition-duration', .4); await field(page, 'transition-priority', 2); await click(page, 'add-transition');
  await page.locator('#animation-states').selectOption({ label: 'Rest' }); await field(page, 'request-time', .5); await click(page, 'append-request');
  await page.locator('#animation-states').selectOption({ label: 'Scuttle' }); await field(page, 'request-time', 1.5); await click(page, 'append-request');
  await click(page, 'add-animation-layer'); await field(page, 'layer-name-animation', 'Tail additive'); await page.locator('#layer-blend').selectOption('additive'); await field(page, 'layer-weight', .3); await page.locator('#reference-clip').selectOption({ label: 'Tail oscillation' }); await page.locator('#mask-mode').selectOption('selected'); await page.locator('#layer-mask').selectOption(await page.locator('#layer-mask option').filter({ hasText: 'Tail' }).first().getAttribute('value') ?? ''); await click(page, 'apply-animation-layer');
  await page.locator('#state-clip').selectOption({ label: 'Tail oscillation' }); await field(page, 'state-rate', .5); await click(page, 'apply-animation-state');
  const text = await save(page); await click(page, 'undo'); expect(await save(page)).not.toBe(text); await click(page, 'redo'); expect(await save(page)).toBe(text);
  await field(page, 'animator-time', .7); await click(page, 'seek-animator'); await expect(page.locator('#composition-status')).toContainText('clipTime');
  await page.locator('#onion').check(); await click(page, 'apply-preview-aids'); await click(page, 'play-animator'); await expect(page.locator('#preview-state')).toContainText('Playing');
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await expect(page.locator('#preview-state')).toContainText('Paused');
  // A field retains native undo ownership; preview does not rewrite its value.
  await field(page, 'state-name', 'Native text'); await page.locator('#state-name').press('ControlOrMeta+a'); await page.locator('#state-name').press('x'); await page.locator('#state-name').press('ControlOrMeta+z'); expect(await save(page)).toBe(text);
  await click(page, 'retained'); await click(page, 'new'); await open(page, text); expect(await save(page)).toBe(text); expect(errors).toEqual([]);
});

test('new source graph remains independent of world stepping and physics', () => {
  const paths = ['../../apps/web/src/actor-tools/', '../../packages/actor-tools/src/'];
  const files = paths.flatMap(d => readdirSync(new URL(d, import.meta.url)).filter(f => f.endsWith('.ts')).map(f => d + f));
  const text = files.map(f => readFileSync(new URL(f, import.meta.url), 'utf8')).join('\n');
  expect(files.some(f => f.endsWith('animation-panel.ts'))).toBe(true);
  expect(text.match(/from\s+['"][^'"]*(?:sim-core|game-runtime|session|world|render-2d)/g) ?? []).toEqual([]);
  expect(text.match(/\b(?:stepWorld|stepPhysics|stepAvatars|fixedUpdate)\s*\(/g) ?? []).toEqual([]);
});


test('the production preview draws the shared blend result with the independently computed crossfade weights', async ({ page }) => {
  await page.addInitScript(() => {
    const draws: number[][] = []; Object.assign(window, { animationDraws: draws });
    const draw = CanvasRenderingContext2D.prototype.drawImage, clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function(...args) { if (this.canvas.id === 'actor-preview') draws.length = 0; return clear.apply(this, args); };
    CanvasRenderingContext2D.prototype.drawImage = function(this: CanvasRenderingContext2D, ...args: Parameters<typeof draw>) {
      if (this.canvas.id === 'actor-preview') { const m = this.getTransform(); draws.push([m.a,m.b,m.c,m.d,m.e,m.f]); } return draw.apply(this,args);
    } as typeof draw;
  });
  const s = markerSource(); s.actions = []; s.requiredCapabilities.push('spacelab:animation-composition/1');
  s.clips = [0,10,20].map((x,i) => ({ id: `c${i}`, name: `C${i}`, duration: 2, playback: 'once', tracks: [{ id: 't', target: { kind: 'attachment', attachmentId: 'example:drawing' }, interpolation: 'linear', keys: [{ time: 0, value: { x, y:0, rotation:0, scaleX:1, scaleY:1 } }, { time: 2, value: { x:x+2, y:0, rotation:0, scaleX:1, scaleY:1 } }] }] }));
  s.animators = [{ id:'a',name:'A',layers:[{id:'l',name:'L',blend:'override',weight:1,initialStateId:'s0',defaultTransition:{duration:2,priority:0},states:s.clips.map((c,i)=>({id:`s${i}`,name:`S${i}`,clipId:c.id,rate:1})),transitions:[]}] }];
  await page.goto('/actor-tools.html'); await page.getByRole('button', { name: 'All tools', exact: true }).click(); await open(page,JSON.stringify(s));
  for (const [time,name] of [[0,'S1'],[.5,'S2']] as const) { await page.locator('#animation-states').selectOption({label:name}); await field(page,'request-time',time); await click(page,'append-request'); }
  await field(page,'animator-time',1); await click(page,'seek-animator');
  const drawn = await page.evaluate(() => (window as unknown as {animationDraws:number[][]}).animationDraws);
  expect(drawn).toHaveLength(1); [16,0,0,16,312 + 16*9.625,192].forEach((n,i) => expect(drawn[0]![i]).toBeCloseTo(n,10));
});


test('the bundled opt-in example loader retains the complete editable source', async ({ page }) => {
  await page.goto('/actor-tools.html'); await page.getByRole('button', { name: 'All tools', exact: true }).click(); await click(page, 'classic-astronaut');
  expect(await save(page)).toBe(readFileSync(new URL('../../apps/web/src/actor-tools/classic-astronaut.project.json', import.meta.url),'utf8').trimEnd());
});


test('playing a clip explicitly leaves animator preview mode', async ({ page }) => {
  const s = markerSource(); s.requiredCapabilities.push('spacelab:animation-composition/1');
  s.animators = [{ id:'example:a',name:'A',layers:[{id:'l',name:'L',blend:'override',weight:1,initialStateId:'rest',defaultTransition:{duration:0,priority:0},states:[{id:'rest',name:'Rest',clipId:null,rate:1}],transitions:[]}] }];
  await page.goto('/actor-tools.html'); await page.getByRole('button', { name: 'All tools', exact: true }).click(); await open(page, JSON.stringify(s));
  await click(page, 'preview-animator'); await expect(page.locator('#actor-preview')).toHaveAttribute('data-clip','example:a');
  await click(page, 'play'); await expect(page.locator('#actor-preview')).toHaveAttribute('data-clip','example:rise');
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await expect(page.locator('#preview-state')).toContainText('Paused');
});


test('reviewed structural deletion removes the last discrete channel capability; undo restores it', async ({ page }) => {
  const s = markerSource(); s.requiredCapabilities.push('spacelab:animation-composition/1');
  s.clips[0]!.visibilityTracks = [{id:'v',target:{kind:'attachment',attachmentId:'example:drawing'},keys:[{time:0,visible:false}]}];
  await page.goto('/actor-tools.html'); await page.getByRole('button', { name: 'All tools', exact: true }).click(); await open(page, JSON.stringify(s)); const before=await save(page);
  await page.locator('#item-kind').selectOption('attachment'); await click(page,'review-delete'); await expect(page.locator('#delete-review')).toContainText('Remove track v'); await click(page,'confirm-delete');
  const after=JSON.parse(await save(page)) as ActorProject; expect(after.requiredCapabilities).not.toContain('spacelab:animation-composition/1'); expect(after.clips[0]!.visibilityTracks).toBeUndefined();
  await click(page,'undo'); expect(await save(page)).toBe(before);
});


test('an already-started animation frame cannot seek before the player origin', async ({ page }) => {
  await page.addInitScript(() => {
    const request = window.requestAnimationFrame; let first = true;
    window.requestAnimationFrame = callback => { const requested = performance.now(); return request.call(window,time => { const at = first ? requested - 10 : time; first = false; callback(at); }); };
  });
  const s = markerSource(); s.requiredCapabilities.push('spacelab:animation-composition/1');
  s.animators = [{id:'example:a',name:'A',layers:[{id:'l',name:'L',blend:'override',weight:1,initialStateId:'s',defaultTransition:{duration:0,priority:0},states:[{id:'s',name:'S',clipId:'example:rise',rate:1}],transitions:[]}]}];
  await page.goto('/actor-tools.html'); await page.getByRole('button', { name: 'All tools', exact: true }).click(); await open(page,JSON.stringify(s)); await click(page,'play-animator');
  await expect(page.locator('#preview-state')).toContainText('Playing'); await expect(page.locator('#message')).not.toContainText('history origin');
  expect(Number(await page.locator('#actor-preview').getAttribute('data-time'))).toBeGreaterThanOrEqual(0);
});
