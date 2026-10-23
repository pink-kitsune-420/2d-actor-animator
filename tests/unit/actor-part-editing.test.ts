import { describe, expect, it } from 'vitest';
import { ActorDraft, emptyProject, ink, movePixels, newPart, readProject, resizePart, transparentIndex } from '../../apps/web/src/actor-tools/editing';
import { pngDimensions, rgbaPart } from '../../apps/web/src/actor-tools/png';
import { saveActorProject } from '../../packages/actor-tools/src';
import { actorFixture } from '../helpers/actor-project';

describe('whole-project part editing', () => {
  it('preserves rigs, clips, actions, stable IDs and inert values across edit/save/reopen', () => {
    const source = actorFixture('nonhuman'); source.extensions['test:zero'] = -0;
    const before = saveActorProject(source), draft = new ActorDraft(source), id = source.parts[0]!.id;
    draft.edit(s => { s.parts[0]!.name = 'Antenna / arbitrary 🪐'; ink(s.parts[0]!, 0, 0, 0, 1); }, id);
    const reopened = readProject(saveActorProject(draft.source));
    expect(reopened.rigs).toEqual(source.rigs); expect(reopened.clips).toEqual(source.clips); expect(reopened.actions).toEqual(source.actions);
    expect(reopened.attachments).toEqual(source.attachments); expect(Object.is(reopened.extensions['test:zero'], -0)).toBe(true);
    expect(reopened.parts[0]!.id).toBe(id); expect(reopened.parts[0]!.revision).toBe(source.parts[0]!.revision + 1);
    draft.undo(); expect(saveActorProject(draft.source)).toBe(before); expect(draft.dirty).toBe(false);
    draft.redo(); expect(draft.dirty).toBe(true);
  });
  it('treats a stroke as one undo and rolls cancellation back without clearing redo', () => {
    const source = emptyProject(), part = newPart('Tail', 3, 2); source.parts.push(part); const draft = new ActorDraft(source);
    draft.begin(); draft.edit(s => ink(s.parts[0]!, 0, 0, 0, 1), part.id); draft.edit(s => ink(s.parts[0]!, 0, 1, 0, 1), part.id); draft.commit();
    draft.undo(); expect(draft.source.parts[0]!.artwork.layers[0]!.pixels).toEqual([0, 0, 0, 0, 0, 0]);
    draft.begin(); draft.edit(s => ink(s.parts[0]!, 0, 2, 1, 2), part.id); draft.cancel();
    expect(draft.canRedo).toBe(true); draft.redo(); expect(draft.source.parts[0]!.artwork.layers[0]!.pixels).toEqual([1, 1, 0, 0, 0, 0]); expect(draft.canUndo).toBe(true);
  });
  it('bounds history count and bytes; current document remains editable when a snapshot exceeds the budget', () => {
    const draft = new ActorDraft(emptyProject(), 20000, 2);
    for (let i = 0; i < 5; i++) draft.edit(s => { s.name = `Revision ${i}`; });
    draft.undo(); draft.undo(); expect(draft.source.name).toBe('Revision 2'); expect(draft.canUndo).toBe(false);
    const small = new ActorDraft(emptyProject(), 1, 32); small.edit(s => { s.name = 'Kept'; }); expect(small.historyBytes).toBe(0); expect(small.source.name).toBe('Kept');
  });
  it('rejects invalid edits atomically, including over-budget layer allocation', () => {
    const draft = new ActorDraft(); const before = saveActorProject(draft.source);
    expect(() => draft.edit(s => { s.name = ''; })).toThrow(); expect(saveActorProject(draft.source)).toBe(before);
    expect(() => newPart('Too big', 1000000, 1000000)).toThrow(); expect(() => newPart('Fractional', 2.5, 3)).toThrow();
  });
  it('keeps recovery dirty and does not infer file retention from serialization', () => {
    const draft = new ActorDraft(); draft.edit(s => { s.name = 'Retained'; }); const text = saveActorProject(draft.source);
    expect(draft.dirty).toBe(true); draft.replace(readProject(text), true); expect(draft.dirty).toBe(true);
    draft.acknowledgeRetained(); expect(draft.dirty).toBe(false); draft.replace(readProject(text)); expect(draft.canUndo).toBe(false);
  });
  it.each(['empty', 'zero-bone'])('allows arbitrary parts in %s projects', fixture => {
    const draft = new ActorDraft(actorFixture(fixture)); draft.edit(s => s.parts.push(newPart('Antenna', 2, 4)));
    expect(readProject(saveActorProject(draft.source)).parts.at(-1)!.name).toBe('Antenna');
  });
});
describe('independent pixel operations', () => {
  it('does not bump a part revision or create undo for an unchanged pixel', () => {
    const source = emptyProject(); source.parts.push(newPart('Tail', 2, 2)); const draft = new ActorDraft(source);
    draft.edit(s => ink(s.parts[0]!, 0, 0, 0, 0), source.parts[0]!.id); expect(draft.source.parts[0]!.revision).toBe(1); expect(draft.canUndo).toBe(false); expect(draft.dirty).toBe(false);
  });
  it('floods a connected region without wrapping rows', () => {
    const p = newPart('Tail', 3, 3); p.artwork.layers[0]!.pixels = [0, 1, 0, 0, 1, 0, 0, 1, 0]; ink(p, 0, 0, 0, 2, true);
    expect(p.artwork.layers[0]!.pixels).toEqual([2, 1, 0, 2, 1, 0, 2, 1, 0]);
  });
  it('erases using alpha rather than assuming index zero is transparent', () => {
    const p = newPart('Antenna', 2, 2); p.artwork.palette = ['#ffffffff', '#00000000']; expect(transparentIndex(p)).toBe(1);
    p.artwork.palette = ['#ffffffff']; expect(transparentIndex(p)).toBe(1); expect(p.artwork.palette).toEqual(['#ffffffff', '#00000000']);
  });
  it('moves an overlapping selection from an independent snapshot and rejects cropping', () => {
    const p = newPart('Tail', 4, 1); p.artwork.layers[0]!.pixels = [1, 2, 0, 0]; movePixels(p, 0, { x: 0, y: 0, width: 2, height: 1 }, 1, 0);
    expect(p.artwork.layers[0]!.pixels).toEqual([0, 1, 2, 0]); expect(() => movePixels(p, 0, { x: 0, y: 0, width: 4, height: 1 }, 1, 0)).toThrow();
  });
  it('resizes every layer without changing pivot or scale', () => {
    const p = newPart('Arbitrary', 2, 2); p.artwork.layers.push({ id: 'other', name: 'Overlay', opacity: .5, pixels: [2, 1, 0, 2] }); p.pivot = [1.5, -2]; p.unitsPerPixel = .25;
    p.artwork.layers[0]!.pixels = [1, 2, 2, 1]; resizePart(p, 3, 1);
    expect(p.artwork.layers.map(l => l.pixels)).toEqual([[1, 2, 0], [2, 1, 0]]); expect(p.pivot).toEqual([1.5, -2]); expect(p.unitsPerPixel).toBe(.25);
  });
  it('preserves alpha colours on PNG indexing without quantization', () => {
    const p = rgbaPart('import', 2, 1, new Uint8ClampedArray([20, 30, 40, 127, 99, 88, 77, 0])); expect(p.artwork.palette).toEqual(['#00000000', '#141e287f']); expect(p.artwork.layers[0]!.pixels).toEqual([1, 0]);
    const many = new Uint8ClampedArray(256 * 4); for (let i = 0; i < 256; i++) { many[i * 4] = i; many[i * 4 + 3] = 255; } expect(() => rgbaPart('reject', 256, 1, many)).toThrow(/256/);
  });
  it('rejects PNG source and dimension budgets before decode', () => {
    const header = new Uint8Array(33); header.set([137,80,78,71,13,10,26,10]); const view = new DataView(header.buffer); view.setUint32(8, 13); view.setUint32(12, 0x49484452); view.setUint32(16, 16); view.setUint32(20, 32);
    expect(pngDimensions(header, 100)).toEqual({ width: 16, height: 32 }); expect(() => pngDimensions(header, 5000000)).toThrow(/source/);
    view.setUint32(16, 100000); expect(() => pngDimensions(header, 100)).toThrow(/decode/); expect(() => pngDimensions(new Uint8Array(100), 100)).toThrow(/PNG/);
  });
});
