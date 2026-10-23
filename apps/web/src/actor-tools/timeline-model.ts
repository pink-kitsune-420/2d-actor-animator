import type { ActorClip, ActorProject, ActorTrackTarget, ActorTrack, ActorVisibilityTrack, ActorDrawOrderTrack, ActorCelTrack } from '@actor-animator/types';
import { syncAnimationCapability, syncCelCapability } from '../../../../packages/actor-tools/src';
import type { ActorDraft } from './editing';
import { sameTarget } from './assembly';

export const CHANNELS = ['tracks', 'visibilityTracks', 'drawOrderTracks', 'celTracks'] as const;
export type Channel = typeof CHANNELS[number];
export const channelNames: Record<Channel, string> = { tracks: 'Transform (absolute TRS)', visibilityTracks: 'Visibility (step)', drawOrderTracks: 'Draw order (step)', celTracks: 'Cel (hold)' };
export type Track = ActorTrack | ActorVisibilityTrack | ActorDrawOrderTrack | ActorCelTrack;
export type Key = Track['keys'][number];
export interface KeyRef { channel: Channel; trackId: string; time: number }
export interface TimelineRow { id: string; label: string; target: ActorTrackTarget; channel: Channel; track?: Track }
export const refId = (r: KeyRef) => JSON.stringify([r.channel, r.trackId, r.time]);
export const rowId = (channel: Channel, target: ActorTrackTarget) => JSON.stringify([channel, target]);
export function rowsFor(source: ActorProject, clip?: ActorClip): TimelineRow[] {
  const targets: { target: ActorTrackTarget; label: string }[] = [];
  for (const rig of source.rigs) for (const node of rig.nodes) targets.push({ target: { kind: 'node', rigId: rig.id, nodeId: node.id }, label: `${rig.name} / ${node.name}` });
  for (const a of source.attachments) targets.push({ target: { kind: 'attachment', attachmentId: a.id }, label: `Attachment / ${a.name}` });
  return targets.flatMap(({ target, label }) => CHANNELS.filter(c => target.kind === 'attachment' || c === 'tracks' || c === 'visibilityTracks').map(channel => ({
    id: rowId(channel, target), label, target, channel, track: clip?.[channel]?.find(t => sameTarget(t.target, target)),
  })));
}
/** One DOM/CSS coordinate model; rect scale includes CSS transforms. Native
 * scroll offsets are in unscaled layout pixels, not device/backing pixels. */
export interface SheetGeometry { left: number; top: number; scaleX: number; scaleY: number; scrollLeft: number; scrollTop: number; label: number; ruler: number; row: number; zoom: number }
export function sheetPoint(g: SheetGeometry, clientX: number, clientY: number) {
  return { time: ((clientX - g.left) / g.scaleX + g.scrollLeft - g.label) / g.zoom,
    row: Math.floor(((clientY - g.top) / g.scaleY + g.scrollTop - g.ruler) / g.row) };
}
/** A click is selection even if its authored key is off an enabled snap grid. */
export function dragOffset(anchor: number, delta: number, interval: number) {
  if (![anchor, delta, interval].every(Number.isFinite) || interval < 0) throw new Error('Snap interval must be zero (off) or positive finite seconds.');
  return delta === 0 ? 0 : interval ? Math.round((anchor + delta) / interval) * interval - anchor : delta;
}
export function rangeKeys(rows: TimelineRow[], a: number, b: number, startRow = 0, endRow = rows.length - 1): KeyRef[] {
  return rows.flatMap((r, i) => i < Math.min(startRow, endRow) || i > Math.max(startRow, endRow) ? [] : (r.track?.keys ?? []).filter(k => k.time >= Math.min(a, b) && k.time <= Math.max(a, b)).map(k => ({ channel: r.channel, trackId: r.track!.id, time: k.time })));
}
export interface KeyClipboard { projectId: string; origin: number; entries: { channel: Channel; track: Track; keys: Key[] }[] }
function clipFor(s: ActorProject, id: string) { const c = s.clips.find(c => c.id === id); if (!c) throw new Error('Select a clip.'); return c; }
export function copyKeys(s: ActorProject, clipId: string, refs: KeyRef[]): KeyClipboard {
  if (!refs.length) throw new Error('Select authored keys first.');
  const c = clipFor(s, clipId), entries: KeyClipboard['entries'] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    if (seen.has(refId(ref))) continue; seen.add(refId(ref));
    const track = c[ref.channel]?.find(t => t.id === ref.trackId), key = track?.keys.find(k => k.time === ref.time);
    if (!track || !key) throw new Error('Key selection is stale; select the keys again.');
    let entry = entries.find(e => e.channel === ref.channel && e.track.id === ref.trackId);
    if (!entry) { entry = { channel: ref.channel, track: structuredClone(track), keys: [] }; entry.track.keys = []; entries.push(entry); }
    entry.keys.push(structuredClone(key));
  }
  return { projectId: s.id, origin: Math.min(...refs.map(r => r.time)), entries };
}
function targetExists(s: ActorProject, t: ActorTrackTarget) { return t.kind === 'attachment' ? s.attachments.some(a => a.id === t.attachmentId) : s.rigs.some(r => r.id === t.rigId && r.nodes.some(n => n.id === t.nodeId)); }
/** Build every result first. Even direct callers see atomic refusal; ActorDraft
 * additionally validates the complete project before publishing a transaction. */
export function pasteKeys(s: ActorProject, clipId: string, data: KeyClipboard, time: number, newId: () => string): KeyRef[] {
  return placeKeys(s, clipId, data, newId, key => time + (key.time - data.origin));
}
function placeKeys(s: ActorProject, clipId: string, data: KeyClipboard, newId: () => string, destination: (key: Key) => number): KeyRef[] {
  if (s.id !== data.projectId) throw new Error('Clipboard belongs to another project; no target remapping is performed.');
  const c = clipFor(s, clipId), planned: { channel: Channel; track: Track; existing?: Track }[] = [], refs: KeyRef[] = [];
  const used = new Set(CHANNELS.flatMap(ch => c[ch]?.map(t => t.id) ?? []));
  for (const e of data.entries) {
    if (!targetExists(s, e.track.target)) throw new Error('Clipboard target no longer exists.');
    const existing = c[e.channel]?.find(t => sameTarget(t.target, e.track.target));
    if (e.channel === 'tracks' && existing && 'interpolation' in existing && 'interpolation' in e.track &&
      (existing.interpolation !== e.track.interpolation || existing.angle !== e.track.angle)) throw new Error('Destination transform track interpolation/angle differs; paste refused.');
    const track = structuredClone(existing ?? e.track);
    if (!existing) { const id = newId(); if (used.has(id)) throw new Error('New track ID is already used in this clip.'); track.id = id; used.add(id); }
    const keys: Key[] = [...track.keys];
    for (const key of e.keys) {
      const dest = destination(key);
      if (!Number.isFinite(dest) || dest < 0 || dest > c.duration) throw new Error('All destination times must be within [0, clip duration] seconds.');
      if (keys.some(k => k.time === dest)) throw new Error(`Key collision at ${dest} s; entire operation refused.`);
      if ('celId' in key && !s.cels?.some(cel => cel.id === key.celId)) throw new Error('Clipboard cel no longer exists.');
      keys.push({ ...structuredClone(key), time: dest }); refs.push({ channel: e.channel, trackId: track.id, time: dest });
    }
    track.keys = keys.sort((a, b) => a.time - b.time) as Track['keys']; planned.push({ channel: e.channel, track, existing });
  }
  for (const p of planned) {
    if (p.existing) p.existing.keys = p.track.keys;
    else { const tracks: Track[] = c[p.channel] ?? []; tracks.push(p.track); Object.assign(c, { [p.channel]: tracks }); }
  }
  syncAnimationCapability(s); syncCelCapability(s); return refs;
}
export function deleteKeys(s: ActorProject, clipId: string, refs: KeyRef[]) {
  copyKeys(s, clipId, refs); // Validate all references before any mutation.
  const c = clipFor(s, clipId);
  for (const ch of CHANNELS) for (const t of c[ch] ?? []) t.keys = t.keys.filter(k => !refs.some(r => r.channel === ch && r.trackId === t.id && r.time === k.time)) as Track['keys'];
  for (const ch of CHANNELS) if (c[ch]) Object.assign(c, { [ch]: c[ch]!.filter(t => t.keys.length) });
  syncAnimationCapability(s); syncCelCapability(s);
}
export function moveKeys(s: ActorProject, clipId: string, refs: KeyRef[], delta: number): KeyRef[] {
  if (!Number.isFinite(delta)) throw new Error('Move offset must be finite seconds.');
  const data = copyKeys(s, clipId, refs), working = { ...s, clips: structuredClone(s.clips), requiredCapabilities: [...s.requiredCapabilities] };
  // Remove selected records, retain their track metadata/ID even if all move.
  const c = clipFor(working, clipId);
  for (const ch of CHANNELS) for (const t of c[ch] ?? []) t.keys = t.keys.filter(k => !refs.some(r => r.channel === ch && r.trackId === t.id && r.time === k.time)) as Track['keys'];
  const result = placeKeys(working, clipId, data, () => { throw new Error('Move cannot create a track.'); }, key => key.time + delta);
  s.clips = working.clips; syncAnimationCapability(s); syncCelCapability(s); return result;
}
/** Ghost-only gesture. Source/history/recovery are untouched until a single
 * validated release. Epoch guards also cover undo, replace and external edits. */
export class TimelineMove {
  private active = true;
  private readonly epoch: number;
  constructor(readonly draft: ActorDraft, readonly clipId: string, readonly refs: KeyRef[]) { copyKeys(draft.source, clipId, refs); this.epoch = draft.epoch; }
  get valid() { return this.active && this.epoch === this.draft.epoch; }
  finish(delta: number) {
    if (!this.valid) { this.active = false; return null; }
    this.active = false;
    if (delta === 0) return this.refs;
    let result: KeyRef[] = [];
    this.draft.edit(s => { result = moveKeys(s, this.clipId, this.refs, delta); }); return result;
  }
  cancel() { this.active = false; }
}
