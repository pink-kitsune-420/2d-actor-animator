import type { ActorProject, ActorTransform } from '@actor-animator/types';
import { compileActorProject, createActorPose, evaluateActorPose, createActorAnimationPlayer, evaluateActorAnimation, requestActorAnimationState, describeActorAnimation, type ActorAnimationPlayer, type ActorPose, type CompiledActorProject } from '../../../../packages/actor-tools/src/index';
import { rasterCanvas } from './png';
import type { ViewFrame } from './viewport-math';

interface ActorDrawing { raster: HTMLCanvasElement; pivotX: number; top: number; pixelScale: number }

/** Independent local presentation. Raster canvases and Float64 pose buffers are
 * retained across frames. No world, physics, session or game renderer exists here. */
export class ActorPreview {
  private source: ActorProject | null = null;
  private compiled: CompiledActorProject | null = null;
  private pose: ActorPose | null = null;
  private rasterKeys = new Map<string, string>();
  overlay: (() => void) | null = null;
  private rasters = new Map<string, HTMLCanvasElement>();
  private drawingsByPart: (ActorDrawing | undefined)[] = [];
  private frame: number | null = null;
  private generation = 0;
  private disposed = false;
  private clip: string | null = null;
  private time = 0;
  private started = 0;
  private originTime = 0;
  private scale = 16;
  private constraints = true;
  private player: ActorAnimationPlayer | null = null;
  private animator = '';
  private speed = 1;
  private grid = 0;
  private onion = false;
  private markers = true;
  private viewY = 0;
  private sheetX = 0;
  private ghost: ActorPose | null = null;
  private placementOn = false;
  private placement = new Float64Array([1,0,0,1,0,0]);
  readonly context: CanvasRenderingContext2D;
  constructor(readonly canvas: HTMLCanvasElement, readonly onTime: (time: number, playing: boolean) => void,
    readonly onError: (message: string) => void, readonly transparent = false) {
    this.context = canvas.getContext('2d')!;
  }
  sync(source: ActorProject) {
    if (this.disposed || source === this.source) return;
    this.pause();
    const compiled = compileActorProject(source), pose = createActorPose(compiled);
    const rasters = new Map<string, HTMLCanvasElement>();
    // Only attached, nonempty rasters need resources. Layerless source can have
    // large dimensions without consuming the source's aggregate layer budget.
    const needed = new Set(source.attachments.map(a => a.partId));
    const celParts = new Map((source.cels ?? []).map(c => [c.id, c.partId]));
    for (const c of source.clips) for (const t of c.celTracks ?? []) for (const k of t.keys) needed.add(celParts.get(k.celId)!);
    const keys = new Map<string, string>();
    try { for (const part of source.parts) if (needed.has(part.id) && part.artwork.layers.length) {
      const key = JSON.stringify(part); keys.set(part.id, key);
      rasters.set(part.id, this.rasterKeys.get(part.id) === key ? this.rasters.get(part.id)! : rasterCanvas(part));
    } }
    catch (error) { for (const [id, c] of rasters) if (c !== this.rasters.get(id)) c.width = c.height = 0; throw error; }
    for (const [id, c] of this.rasters) if (c !== rasters.get(id)) c.width = c.height = 0;
    this.rasters = rasters; this.rasterKeys = keys;
    this.compiled = compiled; this.pose = pose; this.source = source; this.player = null; this.animator = ''; this.ghost = createActorPose(compiled);
    this.drawingsByPart = compiled.parts.map(part => {
      const raster = rasters.get(part.id); return raster ? { raster, pivotX: part.pivot[0], top: part.artwork.height * part.unitsPerPixel - part.pivot[1], pixelScale: part.unitsPerPixel } : undefined;
    });
    // Keep the shown clip time across edits so pose editing stays in place.
    if (!source.clips.some(c => c.id === this.clip)) this.clip = null;
    this.seek(this.clip === null ? 0 : this.time);
  }
  /** Host overlay reads retained displayed buffers; never owns runtime state. */
  get rigCompiled() { return this.compiled; }
  get rigPose() { return this.pose; }
  get constraintsApplied() { return this.constraints; }
  viewFrame(): ViewFrame {
    const r = this.canvas.getBoundingClientRect();
    const fit = Math.min(r.width / this.canvas.width, r.height / this.canvas.height);
    const contained = getComputedStyle(this.canvas).objectFit === 'contain';
    const cssWidth = contained ? this.canvas.width * fit : r.width, cssHeight = contained ? this.canvas.height * fit : r.height;
    return { width: this.canvas.width, height: this.canvas.height, cssWidth, cssHeight, offsetX: (r.width - cssWidth) / 2, offsetY: (r.height - cssHeight) / 2,
      scale: this.scale, viewY: this.viewY, placement: this.placement.slice() };
  }
  updateViewFrame(frame: ViewFrame) {
    frame.width = this.canvas.width; frame.height = this.canvas.height; frame.scale = this.scale; frame.viewY = this.viewY;
    frame.placement = this.placement;
  }
  /** One raw sample at input start, explicitly without constraints/composition. */
  authoringPose() {
    if (!this.compiled || this.player) throw new Error('Show Rest or a single clip before editing; composition is preview only.');
    const raw = createActorPose(this.compiled); evaluateActorPose(this.compiled, this.clip, this.time, raw, false); return raw;
  }
  /** Optional visual constraints in the preview; off shows the raw FK pose. */
  setConstraints(on: boolean) { this.constraints = on; this.draw(); }
  get clipId() { return this.clip; }
  /** Cosmetic preview frame only; never writes source or physical state. */
  setPlacement(t: ActorTransform) {
    if (![t.x,t.y,t.rotation,t.scaleX,t.scaleY].every(Number.isFinite)) throw new Error('Finite preview placement required.');
    this.placementOn = t.x!==0||t.y!==0||t.rotation!==0||t.scaleX!==1||t.scaleY!==1;
    const c=Math.cos(t.rotation),s=Math.sin(t.rotation),p=this.placement;
    p[0]=c*t.scaleX;p[1]=s*t.scaleX;p[2]=-s*t.scaleY;p[3]=c*t.scaleY;p[4]=t.x;p[5]=t.y;this.draw();
  }
  /** Resolve a cosmetic socket once during preview setup; -1 means absent. */
  socketSlot(rigId: string, id: string) { return this.compiled?.slots.findIndex(s => s.kind==='socket'&&s.rigId===rigId&&s.id===id) ?? -1; }
  /** Read a displayed point in project units, including cosmetic placement;
   * writes retained output and never changes source, pose or physical state. */
  worldPoint(slot: number, into: Float64Array, offset = 0): boolean {
    if (!this.pose || slot<0 || slot*6+5>=this.pose.worldMatrices.length || offset<0 || offset+1>=into.length) return false;
    const w=this.pose.worldMatrices,x=w[slot*6+4]!,y=w[slot*6+5]!,p=this.placement;
    into[offset]=this.placementOn?p[0]!*x+p[2]!*y+p[4]!:x;into[offset+1]=this.placementOn?p[1]!*x+p[3]!*y+p[5]!:y;return true;
  }
  get currentTime() { return this.time; }
  aids(speed: number, grid: number, onion: boolean, markers: boolean, viewY = 0) {
    if (!Number.isFinite(speed) || speed <= 0 || !Number.isFinite(grid) || grid < 0) throw new Error('Speed must be positive; grid must be nonnegative.');
    this.pause(); this.speed = speed; this.grid = grid; this.onion = onion; this.markers = markers; this.viewY = viewY; this.draw();
  }
  /** Static sheet-only framing; no scheduler, placement, composition or aids. */
  sheetFraming(scale: number, x: number, y: number) {
    if (![scale,x,y,scale*x,scale*y].every(Number.isFinite) || scale<=0) throw new Error('Finite sheet framing required.');
    this.pause();this.scale=scale;this.sheetX=x;this.viewY=y;this.grid=0;this.onion=false;this.markers=false;this.constraints=true;this.draw();
  }
  configureAnimator(id: string, requests: readonly { time: number; layerId: string; stateId: string }[]) {
    if (!this.compiled) throw new Error('Open a project.');
    const player = createActorAnimationPlayer(this.compiled, id);
    for (const r of requests) {
      const outcome = requestActorAnimationState(player, r.layerId, r.stateId, r.time);
      if (outcome === 'capacity' || outcome === 'out-of-order') throw new Error(`Preview request: ${outcome}`);
    }
    this.pause(); this.player = player; this.animator = id; this.clip = null; this.time = 0;
  }
  animationStatus(time: number) { return this.player ? JSON.stringify(describeActorAnimation(this.player, time), null, 2) : ''; }
  playAnimation() { if (!this.player) throw new Error('Select an animator.'); this.playClock(); }
  /** Effective clip time of the shown pose (loop wrapped, once clamped); 0 at rest. */
  clipTime(): number {
    const clip = this.source?.clips.find(c => c.id === this.clip);
    if (!clip) return 0;
    if (clip.playback === 'ping-pong') { const p = ((this.time % (2 * clip.duration)) + 2 * clip.duration) % (2 * clip.duration); return p <= clip.duration ? p : 2 * clip.duration - p; }
    return clip.playback === 'loop' ? ((this.time % clip.duration) + clip.duration) % clip.duration : Math.max(0, Math.min(clip.duration, this.time));
  }
  /** Evaluated local TRS of the shown pose (after constraints when enabled). */
  localTransform(kind: 'node' | 'socket' | 'attachment', id: string, rigId?: string): ActorTransform | null {
    const index = this.compiled?.slots.findIndex(s => s.kind === kind && s.id === id && (kind === 'attachment' || s.rigId === rigId)) ?? -1;
    if (index < 0 || !this.pose) return null;
    const t = this.pose.localTRS, o = index * 5;
    return { x: t[o]!, y: t[o + 1]!, rotation: t[o + 2]!, scaleX: t[o + 3]!, scaleY: t[o + 4]! };
  }
  /** Status and residual (project units, NaN when not solved) of one constraint. */
  constraint(rigId: string, id: string): { status: string; residual: number } | null {
    const index = this.compiled?.constraints.findIndex(c => c.rigId === rigId && c.id === id) ?? -1;
    return index < 0 || !this.pose ? null : { status: this.compiled!.constraints[index]!.status, residual: this.pose.constraintResiduals[index]! };
  }
  select(clip: string | null) { this.pause(); this.player = null; this.animator = ''; this.clip = clip; this.seek(0); }
  zoom(scale: number) { if (!Number.isFinite(scale) || scale <= 0) throw new Error('Preview zoom must be positive.'); this.scale = scale; this.draw(); }
  seek(time: number) {
    if (this.disposed) return;
    if (!Number.isFinite(time)) throw new Error('Preview time must be finite.');
    this.pause(); this.time = time; this.draw(); this.onTime(time, false);
  }
  rest() { this.select(null); }
  reset(clip: string) { this.select(clip || null); }
  play(clip: string) {
    if (this.disposed || !this.source?.clips.some(c => c.id === clip)) throw new Error('Create or select a clip to play.');
    this.pause(); if (this.clip !== clip) this.time = 0;
    this.player = null; this.animator = ''; this.clip = clip;
    const definition = this.source.clips.find(c => c.id === clip)!;
    if (definition.playback === 'once' && this.time >= definition.duration) this.time = 0;
    this.playClock();
  }
  private playClock() {
    this.pause(); this.started = performance.now(); this.originTime = this.time;
    const definition = this.source?.clips.find(c => c.id === this.clip), generation = this.generation;
    const tick = (now: number) => {
      if (this.disposed || generation !== this.generation) return;
      this.frame = null; this.time = this.originTime + Math.max(0, now - this.started) / 1000 * this.speed;
      const end = !!definition && definition.playback === 'once' && this.time >= definition.duration;
      if (end) this.time = definition!.duration;
      try { this.draw(); } catch (error) { this.pause(); this.onError(String(error)); return; }
      this.onTime(this.player ? this.time : this.clipTime(), !end);
      if (!end && !this.disposed && generation === this.generation) this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }
  pause() {
    this.generation++;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null; this.onTime(this.time, false);
  }
  draw() {
    if (this.disposed || !this.compiled || !this.pose) return;
    const { context: c, compiled, pose, canvas, scale } = this;
    // Evaluate fully before drawing: a Float64 overflow must not draw a partial pose.
    if (this.player) evaluateActorAnimation(compiled, this.player, this.time, pose, this.constraints);
    else evaluateActorPose(compiled, this.clip, this.time, pose, this.constraints);
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, canvas.width, canvas.height);
    if (!this.transparent) {
      c.fillStyle = '#0b131b'; c.fillRect(0, 0, canvas.width, canvas.height);
      c.strokeStyle = '#344656'; c.lineWidth = 1; c.beginPath();
      c.moveTo(canvas.width / 2, 0); c.lineTo(canvas.width / 2, canvas.height);
      c.moveTo(0, canvas.height / 2); c.lineTo(canvas.width, canvas.height / 2); c.stroke();
    }
    c.imageSmoothingEnabled = false;
    if (this.grid > 0 && this.grid * scale >= 4) {
      const step = this.grid * scale; c.strokeStyle = '#22313e'; c.beginPath();
      for (let x = canvas.width / 2 % step; x < canvas.width; x += step) { c.moveTo(x, 0); c.lineTo(x, canvas.height); }
      for (let y = canvas.height / 2 % step; y < canvas.height; y += step) { c.moveTo(0, y); c.lineTo(canvas.width, y); } c.stroke();
    }
    if (this.onion && this.ghost) {
      c.globalAlpha = .2;
      for (let side = -1; side <= 1; side += 2) {
        const t = Math.max(0, this.time + side / 12);
        if (this.player) evaluateActorAnimation(compiled, this.player, t, this.ghost, this.constraints);
        else evaluateActorPose(compiled, this.clip, t, this.ghost, this.constraints);
        this.paintPose(this.ghost);
      }
      c.globalAlpha = 1;
    }
    this.paintPose(pose);
    // Cosmetic hierarchy/socket markers use screen-sized geometry, including
    // degenerate scales. They never imply collision or contact.
    c.setTransform(1, 0, 0, 1, 0, 0);
    for (let i = 0; this.markers && i < compiled.slots.length; i++) {
      const slot = compiled.slots[i]!; if (slot.kind === 'attachment') continue;
      const w = pose.worldMatrices, x = canvas.width / 2 + w[i * 6 + 4]! * scale, y = canvas.height / 2 + (this.viewY - w[i * 6 + 5]!) * scale;
      c.strokeStyle = slot.kind === 'socket' ? '#ffbe55' : '#76a6c8'; c.beginPath();
      if (slot.parent >= 0) { c.moveTo(canvas.width / 2 + w[slot.parent * 6 + 4]! * scale, canvas.height / 2 + (this.viewY - w[slot.parent * 6 + 5]!) * scale); c.lineTo(x, y); }
      c.moveTo(x - 3, y); c.lineTo(x + 3, y); c.moveTo(x, y - 3); c.lineTo(x, y + 3); c.stroke();
    }
    this.overlay?.();
    this.canvas.dataset.clip = this.player ? this.animator : this.clip ?? 'rest'; this.canvas.dataset.time = String(this.time);
  }
  private paintPose(pose: ActorPose) {
    const c = this.context, scale = this.scale, w = pose.worldMatrices;
    for (let k = 0; k < pose.drawSequence.length; k++) {
      const slot = pose.drawSequence[k]!; if (!pose.visible[slot]) continue;
      const drawing = this.drawingsByPart[pose.partIndices[slot]!]; if (!drawing) continue;
      const m = slot * 6;
      const a=scale*w[m]!,b=-scale*w[m+1]!,cc=scale*w[m+2]!,d=-scale*w[m+3]!,tx=this.canvas.width/2+scale*(w[m+4]!-this.sheetX),ty=this.canvas.height/2+scale*(this.viewY-w[m+5]!);
      const left=-drawing.pivotX,right=left+drawing.raster.width*drawing.pixelScale,top=drawing.top,bottom=top-drawing.raster.height*drawing.pixelScale;
      if (!Number.isFinite(a)||!Number.isFinite(b)||!Number.isFinite(cc)||!Number.isFinite(d)||!Number.isFinite(tx)||!Number.isFinite(ty)||
        !Number.isFinite(a*left+cc*top+tx)||!Number.isFinite(b*left+d*top+ty)||!Number.isFinite(a*right+cc*bottom+tx)||!Number.isFinite(b*right+d*bottom+ty)||
        !Number.isFinite(a*right+cc*top+tx)||!Number.isFinite(b*right+d*top+ty)||!Number.isFinite(a*left+cc*bottom+tx)||!Number.isFinite(b*left+d*bottom+ty)) throw new RangeError('Raster framing exceeds Float64 geometry range.');
      if (!this.placementOn) c.setTransform(scale*w[m]!,-scale*w[m+1]!,scale*w[m+2]!,-scale*w[m+3]!,this.canvas.width/2+scale*(w[m+4]!-this.sheetX),this.canvas.height/2+scale*(this.viewY-w[m+5]!));
      else {
        const p=this.placement,a=p[0]!*w[m]!+p[2]!*w[m+1]!,b=p[1]!*w[m]!+p[3]!*w[m+1]!,cc=p[0]!*w[m+2]!+p[2]!*w[m+3]!,d=p[1]!*w[m+2]!+p[3]!*w[m+3]!,x=p[0]!*w[m+4]!+p[2]!*w[m+5]!+p[4]!,y=p[1]!*w[m+4]!+p[3]!*w[m+5]!+p[5]!;
        if(!Number.isFinite(a)||!Number.isFinite(b)||!Number.isFinite(cc)||!Number.isFinite(d)||!Number.isFinite(x)||!Number.isFinite(y))throw new RangeError('Preview placement exceeds Float64 range');
        c.setTransform(scale*a,-scale*b,scale*cc,-scale*d,this.canvas.width/2+scale*x,this.canvas.height/2+scale*(this.viewY-y));
      }
      c.translate(-drawing.pivotX, drawing.top); c.scale(drawing.pixelScale, -drawing.pixelScale); c.drawImage(drawing.raster, 0, 0);
    }
  }
  private releaseRasters() { for (const c of this.rasters.values()) c.width = c.height = 0; this.rasters.clear(); this.rasterKeys.clear(); }
  dispose() {
    if (this.disposed) return;
    this.overlay = null; this.pause(); this.disposed = true; this.releaseRasters(); this.drawingsByPart = []; this.source = null; this.compiled = null; this.pose = null; this.ghost = null; this.player = null;
    this.canvas.width = this.canvas.height = 0;
  }
}
