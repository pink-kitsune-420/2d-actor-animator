import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { ActorProject, ActorTransform } from '@actor-animator/types';

export const field = async (p: Page, id: string, v: string | number) => { await p.locator(`#${id}`).fill(String(v)); };
export const click = async (p: Page, id: string) => { await p.locator(`#${id}`).click(); };
export async function save(p: Page) { const download = p.waitForEvent('download'); await click(p, 'save'); return readFileSync((await (await download).path())!, 'utf8'); }
export async function open(p: Page, text: string) { await p.locator('#open').setInputFiles({ name: 'animation.actorproject', mimeType: 'application/json', buffer: Buffer.from(text) }); await expect(p.locator('#message')).toHaveText('Opened complete editable source.'); }
export async function transform(p: Page, prefix: string, t: Partial<ActorTransform>) { for (const [k, v] of Object.entries(t)) await field(p, `${prefix}-${k}`, v); }
export async function key(p: Page, target: string, time: number, values: Partial<ActorTransform>, curve = 'ease-in-out') {
  await p.locator('#track-target').selectOption({ label: target }); await p.locator('#key-channel').selectOption('transform'); await click(p, 'new-key');
  await field(p, 'timeline-time', time); await transform(p, 'timeline', values); await p.locator('#key-curve').selectOption(curve); await click(p, 'write-key');
}
export async function addClip(p: Page, name: string, duration: number, mode = 'loop') {
  await field(p, 'clip-name', name); await field(p, 'duration', duration); await p.locator('#playback').selectOption(mode); await click(p, 'add-clip');
}
async function addNode(p: Page, name: string, parent: string, x: number, y: number) {
  await p.locator('#item-kind').selectOption('node'); await field(p, 'item-name', name); await p.locator('#parent-node').selectOption({ label: parent || 'Scene root (no node)' });
  await transform(p, 'rest', { x, y, rotation: 0, scaleX: 1, scaleY: 1 }); await click(p, 'add-item');
}
async function attach(p: Page, name: string, node: string, part: string, order: number) {
  const option = await p.locator('#parts option').filter({ hasText: `${part} ·` }).first().getAttribute('value'); await p.locator('#parts').selectOption(option!);
  await p.locator('#item-kind').selectOption('attachment'); await field(p, 'item-name', name); await p.locator('#parent-node').selectOption({ label: node });
  await transform(p, 'rest', { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }); await field(p, 'draw-order', order); await click(p, 'add-item');
}
const palette = ['#000000', '#e1e9df', '#e8ae45', '#172f43', '#6f9eb0', '#526370'];
async function paint(p: Page, name: string, rows: string[], pivot: [number, number]) {
  await field(p, 'part-name', name); await field(p, 'width', rows[0]!.length); await field(p, 'height', rows.length); await click(p, 'add-part');
  await field(p, 'units', 1 / 16); await field(p, 'pivot-x', pivot[0] / 16); await field(p, 'pivot-y', pivot[1] / 16); await click(p, 'pivot');
  // Existing palette indices 1/2 are edited, extra colours use the same UI.
  for (let c = 1; c < palette.length; c++) {
    if (c < 3) await p.locator('#palette').selectOption(String(c));
    await field(p, 'colour', palette[c]!); await field(p, 'alpha', 255); await click(p, c < 3 ? 'apply-colour' : 'add-colour');
  }
  await p.locator('#zoom').selectOption('16');
  for (let c = 1; c < palette.length; c++) {
    await p.locator('#palette').selectOption(String(c));
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y]!;
      for (let x = 0; x < row.length; x++) {
        if (row[x] !== String(c)) continue;
        const start = x; while (x + 1 < row.length && row[x + 1] === String(c)) x++;
        await p.locator('#paint').scrollIntoViewIfNeeded(); const box = (await p.locator('#paint').boundingBox())!;
        await p.mouse.move(box.x + start * 16 + 8, box.y + y * 16 + 8); await p.mouse.down();
        if (x > start) await p.mouse.move(box.x + x * 16 + 8, box.y + y * 16 + 8); await p.mouse.up();
      }
    }
  }
}

/** Recorded first-party authoring recipe: only pointer strokes and form
 * operations. No project JSON generation or privileged draft mutation. */
export async function authorAstronaut(p: Page) {
  await p.addInitScript(() => { let n = 0; Object.defineProperty(crypto, 'randomUUID', { value: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` }); });
  await p.goto('/actor-tools.html'); await p.getByRole('button', { name: 'All tools', exact: true }).click();
  await p.locator('details').filter({ has: p.locator('summary', { hasText: 'Project details' }) }).last().evaluate((el: HTMLDetailsElement) => { el.open = true; });
  await field(p, 'project-name', 'Classic astronaut — editable pixel art'); await field(p, 'project-author', 'Space Lab'); await field(p, 'project-provenance', 'Original MIT artwork and clips authored through Actor tools; 16 pixels/metre. Visual review pending.'); await click(p, 'apply-project');
  await paint(p, 'Helmet', ['00011111000','00111111100','01144444110','11433333411','14322222341','14322222341','11433333411','01144444110','00111111100','00055555000'], [5.5, 4]);
  // Explicit artwork revision through the painter before assembly.
  await p.locator('#palette').selectOption('1'); await p.locator('#paint').scrollIntoViewIfNeeded(); const box = (await p.locator('#paint').boundingBox())!; await p.mouse.click(box.x + 3 * 16 + 8, box.y + 2 * 16 + 8);
  await paint(p, 'Suit', ['0111110','1111111','1144411','1142411','1144411','1111111','1555551','0555550'], [3.5, 4]);
  await paint(p, 'Backpack', ['444','455','455','425','455','455','444'], [4, 4]);
  await paint(p, 'Upper limb', ['111','111','141','111','555'], [1.5, 4]);
  await paint(p, 'Lower limb', ['555','111','141','111','111'], [1.5, 4]);
  await paint(p, 'Glove', ['555','111','111'], [1.5, 2]);
  await paint(p, 'Boot', ['15500','15555','55555'], [1.5, 2]);
  for (const [name, rows, pivot] of [['Upper limb', ['111','111','141','111','555'], [1.5,4]], ['Lower limb', ['555','111','141','111','111'], [1.5,4]], ['Glove', ['555','111','111'], [1.5,2]], ['Boot', ['15500','15555','55555'], [1.5,2]]] as const) await paint(p, `Far ${name}`, rows.map(r => r.replaceAll('1','4')), [...pivot]);
  await field(p, 'rig-name', 'Astronaut'); await click(p, 'add-rig');
  await addNode(p, 'Pelvis', '', 0, .8); await addNode(p, 'Torso', 'Pelvis', 0, .25); await addNode(p, 'Head', 'Torso', 0, .45);
  for (const side of ['Far', 'Near']) {
    const x = side === 'Far' ? -.16 : .16;
    await addNode(p, `${side} shoulder`, 'Torso', x, .25); await addNode(p, `${side} elbow`, `${side} shoulder`, 0, -.25); await addNode(p, `${side} hand`, `${side} elbow`, 0, -.25);
    await addNode(p, `${side} hip`, 'Pelvis', x, 0); await addNode(p, `${side} knee`, `${side} hip`, 0, -.35); await addNode(p, `${side} ankle`, `${side} knee`, 0, -.35);
  }
  await attach(p, 'Pack art', 'Torso', 'Backpack', 0); await attach(p, 'Suit art', 'Torso', 'Suit', 7); await attach(p, 'Helmet art', 'Head', 'Helmet', 10);
  for (const side of ['Far', 'Near']) {
    const order = side === 'Far' ? 1 : 8;
    for (const [joint, part] of [['shoulder', 'Upper limb'], ['elbow', 'Lower limb'], ['hand', 'Glove'], ['hip', 'Upper limb'], ['knee', 'Lower limb'], ['ankle', 'Boot']]) await attach(p, `${side} ${joint} art`, `${side} ${joint}`, side === 'Far' ? `Far ${part}` : part!, order);
  }
  await addClip(p, 'Idle', 2);
  for (const [t, y] of [[0, .25], [1, .27], [2, .25]]) await key(p, 'Astronaut / Torso', t!, { y });
  for (const [name, duration, amplitude] of [['Walk', 1, .5], ['Run', .65, .9]] as const) {
    await addClip(p, name, duration);
    for (const side of ['Near', 'Far']) for (const joint of ['hip', 'shoulder', 'knee', 'elbow']) {
      const sign = (side === 'Near' ? 1 : -1) * (joint === 'shoulder' ? -1 : 1), a = amplitude * (joint === 'knee' || joint === 'elbow' ? .6 : 1);
      for (const [t, r] of [[0, sign * a], [duration / 2, -sign * a], [duration, sign * a]]) await key(p, `Astronaut / ${side} ${joint}`, t!, { rotation: r });
    }
  }
  for (const [name, duration, rootY, hip, arm] of [['Jump anticipation', .2, .7, .4, -.3], ['Jump rise', .3, 1.05, -.3, -2.2], ['Jump fall', .3, .95, .2, -1.4], ['Jump land', .2, .7, .55, -.3]] as const) {
    await addClip(p, name, duration, 'once');
    for (const t of [0, duration]) {
      await key(p, 'Astronaut / Pelvis', t, { y: rootY });
      for (const side of ['Near', 'Far']) { await key(p, `Astronaut / ${side} hip`, t, { rotation: hip }); await key(p, `Astronaut / ${side} shoulder`, t, { rotation: arm * (side === 'Near' ? 1 : -1) }); }
    }
  }
  for (const [name, duration, mode] of [['Climb enter', .3, 'once'], ['Climb', 1.2, 'loop'], ['Climb exit', .3, 'once'], ['Swim', 1.6, 'loop']] as const) {
    await addClip(p, name, duration, mode);
    for (const side of ['Near', 'Far']) for (const joint of ['hip', 'shoulder', 'elbow']) {
      const sign = side === 'Near' ? 1 : -1;
      for (const [t, r] of [[0, sign * (joint === 'shoulder' ? 2.3 : .4)], [duration / 2, sign * (joint === 'shoulder' ? 1.2 : -.4)], [duration, sign * (joint === 'shoulder' ? 2.3 : .4)]]) await key(p, `Astronaut / ${side} ${joint}`, t!, { rotation: name === 'Climb exit' ? 0 : r });
    }
    if (name === 'Swim') for (const t of [0, duration]) await key(p, 'Astronaut / Pelvis', t, { rotation: -Math.PI / 2, y: 1 });
  }
  // One base state per clip, explicit rates, transitions and automatic jump phases.
  await click(p, 'add-animator'); await click(p, 'add-animation-layer');
  const clipNames = await p.locator('#clips option').allTextContents();
  for (const name of clipNames) { await field(p, 'state-name', name); await p.locator('#state-clip').selectOption({ label: name }); await field(p, 'state-rate', 1); await click(p, 'add-animation-state'); }
  await p.locator('#animation-states').selectOption({ label: 'Idle' }); await click(p, 'initial-state');
  for (const [from, to] of [['Jump anticipation', 'Jump rise'], ['Jump rise', 'Jump fall'], ['Jump fall', 'Jump land'], ['Jump land', 'Idle'], ['Climb enter', 'Climb'], ['Climb exit', 'Idle']]) {
    await p.locator('#animation-states').selectOption({ label: from! }); await p.locator('#state-next').selectOption({ label: to! }); await click(p, 'apply-animation-state');
  }
  for (const [from, to, duration, priority] of [['Idle', 'Walk', .2, 0], ['Walk', 'Idle', .2, 0], ['Walk', 'Run', .2, 0], ['Run', 'Walk', .2, 0], ['Any state', 'Jump anticipation', .08, 3], ['Any state', 'Climb enter', .15, 2], ['Climb', 'Climb exit', .15, 2], ['Any state', 'Swim', .3, 1]] as const) {
    await p.locator('#transition-from').selectOption({ label: from }); await p.locator('#transition-to').selectOption({ label: to }); await field(p, 'transition-duration', duration); await field(p, 'transition-priority', priority); await click(p, 'add-transition');
  }
  await click(p, 'add-animation-layer'); await field(p, 'layer-name-animation', 'Breathing overlay'); await p.locator('#layer-blend').selectOption('additive'); await field(p, 'layer-weight', .25); await p.locator('#reference-clip').selectOption({ label: 'Idle' }); await p.locator('#mask-mode').selectOption('selected'); await p.locator('#layer-mask').selectOption({ label: 'Astronaut/Torso' }); await click(p, 'apply-animation-layer');
  await p.locator('#state-clip').selectOption({ label: 'Idle' }); await click(p, 'apply-animation-state');
  await p.locator('#preview-zoom').selectOption('128');
  await field(p, 'preview-grid', .5); await field(p, 'preview-origin-y', .8); await p.locator('#preview-markers').uncheck(); await click(p, 'apply-preview-aids');
  const text = await save(p), source = JSON.parse(text) as ActorProject;
  expect(source.rigs[0]!.nodes).toHaveLength(15); expect(source.attachments).toHaveLength(15); expect(source.clips).toHaveLength(11); expect(source.animators![0]!.layers).toHaveLength(2);
  return text;
}
