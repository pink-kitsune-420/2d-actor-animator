import { requireResources, requireCompletedPose, type ActorPose, type CompiledActorProject } from '../../../actor-tools/src/evaluator';

/** Project coordinates to canvas backing pixels, including host placement. */
export type ActorRenderView = readonly [number, number, number, number, number, number];
export interface ActorRendererMetrics {
  readonly disposed: boolean;
  readonly rasters: number;
  readonly rasterPixels: number;
  readonly rasterBytes: number;
  readonly textures: number;
  readonly texturePixels: number;
  readonly textureBytes: number;
  readonly bindings: number;
  /** Retained CPU transform buffers only; excludes native/driver/JS overhead. */
  readonly bindingNumericBytes: number;
  readonly resourceNumericBytes: number;
}
export interface Raster {
  canvas: HTMLCanvasElement;
  width: number; height: number; unit: number; left: number; top: number;
}
export function releaseRasters(rasters: readonly (Raster | null)[]): void {
  for (let i = 0; i < rasters.length; i++) {
    const r = rasters[i]; if (r) r.canvas.width = r.canvas.height = 0;
  }
}
/** Synchronous, bounded native composition. No decode/upload callbacks or URLs. */
export function prepareRasters(compiled: CompiledActorProject): (Raster | null)[] {
  requireResources(compiled);
  if (compiled.compilerVersion !== 'spacelab-actor-compiler/5') throw new TypeError('Unsupported actor compiler');
  let pixels = 0;
  // Admission of ALL geometry precedes any native allocation, even with raised core limits.
  for (const part of compiled.parts) {
    const { width, height, layers } = part.artwork, u = part.unitsPerPixel;
    if (width > 1024 || height > 1024 || !Number.isFinite(width * u - part.pivot[0]) || !Number.isFinite(height * u - part.pivot[1])) throw new RangeError('Actor raster geometry exceeds renderer limits');
    if (layers.length) pixels += width * height;
    if (pixels > 262144) throw new RangeError('Actor raster pixel budget exceeds 262144');
  }
  const rasters: (Raster | null)[] = [];
  let scratch: HTMLCanvasElement | null = null;
  try {
    for (const part of compiled.parts) {
      const art = part.artwork;
      if (!art.layers.length) { rasters.push(null); continue; }
      const canvas = document.createElement('canvas');
      // Register ownership before operations that can throw.
      rasters.push({ canvas, width: art.width, height: art.height, unit: part.unitsPerPixel, left: -part.pivot[0], top: art.height * part.unitsPerPixel - part.pivot[1] });
      canvas.width = art.width; canvas.height = art.height;
      const c = canvas.getContext('2d'); if (!c) throw new Error('Canvas2D resource preparation unavailable');
      if (!scratch) scratch = document.createElement('canvas');
      scratch.width = art.width; scratch.height = art.height;
      const layerContext = scratch.getContext('2d'); if (!layerContext) throw new Error('Canvas2D layer preparation unavailable');
      const data = layerContext.createImageData(art.width, art.height);
      for (const layer of art.layers) {
        for (let i = 0; i < layer.pixels.length; i++) {
          const colour = art.palette[layer.pixels[i]!]!;
          for (let k = 0; k < 4; k++) data.data[i * 4 + k] = parseInt(colour.slice(1 + k * 2, 3 + k * 2), 16);
        }
        layerContext.putImageData(data, 0, 0); c.globalAlpha = layer.opacity; c.drawImage(scratch, 0, 0);
      }
      c.globalAlpha = 1;
    }
    return rasters;
  } catch (error) { releaseRasters(rasters); throw error; }
  finally { if (scratch) scratch.width = scratch.height = 0; }
}

export interface RenderBindingData { pose: ActorPose | null; matrices: Float64Array; gpuMatrix: Float32Array; dispose(): void }
/** Shared lifetime, identity and affine admission; no public source/pose branding API. */
export class RenderResources {
  compiled: CompiledActorProject | null;
  readonly bindings = new Set<RenderBindingData>();
  attachmentSlots: Uint8Array;
  geometry: Float64Array;
  widths: Float64Array;
  heights: Float64Array;
  readonly pixels: number;
  readonly count: number;
  constructor(compiled: CompiledActorProject, rasters: readonly (Raster | null)[]) {
    this.compiled = compiled;
    this.attachmentSlots = new Uint8Array(compiled.slots.length);
    for (const s of compiled.drawSlots) this.attachmentSlots[s] = 1;
    this.geometry = new Float64Array(rasters.length * 3);
    this.widths = new Float64Array(rasters.length); this.heights = new Float64Array(rasters.length);
    let count = 0, pixels = 0;
    for (let i = 0; i < rasters.length; i++) {
      const r = rasters[i]; if (!r) continue;
      this.geometry[i * 3] = r.unit; this.geometry[i * 3 + 1] = r.left; this.geometry[i * 3 + 2] = r.top;
      this.widths[i] = r.width; this.heights[i] = r.height;
      count++; pixels += r.width * r.height;
    }
    this.pixels = pixels; this.count = count;
  }
  require(): CompiledActorProject {
    if (!this.compiled) throw new Error('Actor renderer is disposed');
    return this.compiled;
  }
  bind(pose: ActorPose, gpu = false): RenderBindingData {
    const compiled = this.require(); requireCompletedPose(compiled, pose);
    const data: RenderBindingData = { pose, matrices: new Float64Array(compiled.drawSlots.length * 6), gpuMatrix: new Float32Array(gpu ? 9 : 0), dispose: () => {
      if (!data.pose) return;
      data.pose = null; data.matrices = new Float64Array(0); data.gpuMatrix = new Float32Array(0); this.bindings.delete(data);
    } };
    this.bindings.add(data); return data;
  }
  metrics(gpu: boolean): ActorRendererMetrics {
    let bytes = 0; for (const b of this.bindings) bytes += b.matrices.byteLength + b.gpuMatrix.byteLength;
    const live = !!this.compiled, n = live ? this.count : 0, p = live ? this.pixels : 0;
    return { disposed: !live, rasters: gpu ? 0 : n, rasterPixels: gpu ? 0 : p, rasterBytes: gpu ? 0 : p * 4,
      textures: gpu ? n : 0, texturePixels: gpu ? p : 0, textureBytes: gpu ? p * 4 : 0, bindings: this.bindings.size, bindingNumericBytes: bytes,
      resourceNumericBytes: this.attachmentSlots.byteLength + this.geometry.byteLength + this.widths.byteLength + this.heights.byteLength };
  }
  dispose(): void {
    this.compiled = null;
    for (const b of this.bindings) b.dispose();
    this.attachmentSlots = new Uint8Array(0); this.geometry = this.widths = this.heights = new Float64Array(0);
  }
  /** Preflight every drawable before the first backend command; retained output. */
  frame(data: RenderBindingData, view: ActorRenderView): ActorPose {
    const compiled = this.require(), pose = data.pose;
    if (!pose) throw new Error('Actor draw binding is disposed');
    requireCompletedPose(compiled, pose);
    if (view.length !== 6) throw new TypeError('Expected six view affine coefficients');
    for (let k = 0; k < 6; k++) if (!Number.isFinite(view[k])) throw new RangeError('View affine must be finite');
    const w = pose.worldMatrices, out = data.matrices;
    for (let k = 0; k < pose.drawSequence.length; k++) {
      const slot = pose.drawSequence[k]!;
      if (this.attachmentSlots[slot] !== 1) throw new TypeError('Invalid actor draw slot');
      if (!pose.visible[slot]) continue;
      const part = pose.partIndices[slot]!;
      if (part < 0 || part >= compiled.parts.length) throw new TypeError('Invalid actor artwork index');
      const width = this.widths[part]!, height = this.heights[part]!; if (!width) continue;
      const m = slot * 6, g = part * 3, o = k * 6, u = this.geometry[g]!, left = this.geometry[g + 1]!, top = this.geometry[g + 2]!;
      const a = view[0] * w[m]! + view[2] * w[m + 1]!, b = view[1] * w[m]! + view[3] * w[m + 1]!;
      const c = view[0] * w[m + 2]! + view[2] * w[m + 3]!, d = view[1] * w[m + 2]! + view[3] * w[m + 3]!;
      out[o] = a * u; out[o + 1] = b * u; out[o + 2] = -c * u; out[o + 3] = -d * u;
      out[o + 4] = a * left + c * top + view[0] * w[m + 4]! + view[2] * w[m + 5]! + view[4];
      out[o + 5] = b * left + d * top + view[1] * w[m + 4]! + view[3] * w[m + 5]! + view[5];
      for (let j = 0; j < 6; j++) if (!Number.isFinite(out[o + j])) throw new RangeError('Actor raster affine overflow');
      // Both pairs of opposite corners, including shear/reflection/zero scales.
      for (let corner = 0; corner < 4; corner++) {
        const x = corner & 1 ? width : 0, y = corner & 2 ? height : 0;
        if (!Number.isFinite(out[o]! * x + out[o + 2]! * y + out[o + 4]!) || !Number.isFinite(out[o + 1]! * x + out[o + 3]! * y + out[o + 5]!)) throw new RangeError('Actor raster corner overflow');
      }
    }
    return pose;
  }
}
