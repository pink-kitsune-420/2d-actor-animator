import type { ActorPart } from '@actor-animator/types';
import { newPart } from './editing';
export const PNG_LIMITS = Object.freeze({ sourceBytes: 4 * 1024 * 1024, dimension: 256, pixels: 65536, decodedBytes: 262144, decodeMs: 1500 });
/** Header admission precedes browser decoding and raster allocation. */
export function pngDimensions(header: Uint8Array, sourceBytes: number) {
  if (sourceBytes > PNG_LIMITS.sourceBytes) throw new Error('PNG exceeds 4 MiB source budget.');
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (header.length < 33 || signature.some((b, i) => header[i] !== b)) throw new Error('Expected a PNG file.');
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) throw new Error('Missing PNG IHDR.');
  const width = view.getUint32(16), height = view.getUint32(20);
  if (!width || !height || width > PNG_LIMITS.dimension || height > PNG_LIMITS.dimension || width * height > PNG_LIMITS.pixels || width * height * 4 > PNG_LIMITS.decodedBytes) throw new Error('PNG exceeds 256×256 / 65536 pixel decode budget.');
  return { width, height };
}
export function rgbaPart(name: string, width: number, height: number, rgba: Uint8ClampedArray): ActorPart {
  if (rgba.length !== width * height * 4) throw new Error('Decoded byte count mismatch.');
  const part = newPart(name, width, height), palette = ['#00000000'], indices = new Map<string, number>([[palette[0]!, 0]]), pixels: number[] = [];
  for (let i = 0; i < rgba.length; i += 4) {
    const color = rgba[i + 3] === 0 ? '#00000000' : `#${Array.from(rgba.subarray(i, i + 4), n => n.toString(16).padStart(2, '0')).join('')}`;
    let index = indices.get(color);
    if (index === undefined) { if (palette.length === 256) throw new Error('PNG needs more than 256 palette entries including transparency; import rejected without quantization.'); index = palette.push(color) - 1; indices.set(color, index); }
    pixels.push(index);
  }
  part.artwork.palette = palette; part.artwork.layers[0]!.pixels = pixels; return part;
}
/** Owns the bitmap through success, timeout and late completion. A timeout is
 * an admission outcome, not a claim that native decoder work can be cancelled. */
async function readPng<T>(file: File, admit: (width: number, height: number) => void, read: (bitmap: ImageBitmap, width: number, height: number) => T): Promise<{ value: T; milliseconds: number }> {
  const { width, height } = pngDimensions(new Uint8Array(await file.slice(0, 33).arrayBuffer()), file.size); admit(width, height);
  const start = performance.now(); let expired = false; let timer: ReturnType<typeof setTimeout> | undefined;
  const decoded = createImageBitmap(file, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }).then(bitmap => { if (expired) { bitmap.close(); throw new Error('PNG decode completed after budget.'); } return bitmap; });
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { expired = true; reject(new Error('PNG decode exceeded 1500 ms budget.')); }, PNG_LIMITS.decodeMs); });
  try {
    const bitmap = await Promise.race([decoded, timeout]);
    try {
      if (bitmap.width !== width || bitmap.height !== height) throw new Error('PNG decode dimensions disagree with header.');
      if (performance.now() - start > PNG_LIMITS.decodeMs) throw new Error('PNG decode exceeded elapsed budget.');
      return { value: read(bitmap, width, height), milliseconds: performance.now() - start };
    } finally { bitmap.close(); }
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
export async function decodePng(file: File): Promise<{ part: ActorPart; milliseconds: number }> {
  const result = await readPng(file, () => {}, (bitmap, width, height) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    try {
      const context = canvas.getContext('2d', { willReadFrequently: true })!; context.drawImage(bitmap, 0, 0);
      return rgbaPart(file.name.replace(/\.png$/i, '') || 'Imported part', width, height, context.getImageData(0, 0, width, height).data);
    } finally { canvas.width = canvas.height = 0; }
  });
  return { part: result.value, milliseconds: result.milliseconds };
}
/** Decode admitted disjoint sheet rectangles separately, so each frame uses
 * its own bounded palette without quantization or a global sheet palette. */
export async function decodePngFrames(file: File, width: number, height: number, frames: readonly { x: number; y: number; width: number; height: number }[]): Promise<ActorPart[]> {
  const result = await readPng(file, (w,h) => {
    if (w !== width || h !== height || !frames.length || frames.length > 64) throw new Error('Sheet PNG and metadata disagree.');
    let pixels = 0;
    for (const f of frames) {
      if (![f.x,f.y,f.width,f.height].every(Number.isInteger) || f.x < 0 || f.y < 0 || f.width <= 0 || f.height <= 0 || f.x + f.width > w || f.y + f.height > h) throw new Error('Invalid sheet rectangle.');
      pixels += f.width * f.height;
    }
    if (pixels > PNG_LIMITS.pixels) throw new Error('Aggregate sheet decode exceeds pixel budget.');
  }, bitmap => frames.map((f,i) => {
    const canvas = document.createElement('canvas'); canvas.width = f.width; canvas.height = f.height;
    try {
      const c = canvas.getContext('2d', { willReadFrequently: true })!; c.drawImage(bitmap, f.x, f.y, f.width, f.height, 0, 0, f.width, f.height);
      return rgbaPart(`${file.name} frame ${i + 1}`, f.width, f.height, c.getImageData(0,0,f.width,f.height).data);
    } finally { canvas.width = canvas.height = 0; }
  }));
  return result.value;
}

export function rasterCanvas(part: ActorPart): HTMLCanvasElement {
  const canvas = document.createElement('canvas'); canvas.width = part.artwork.width; canvas.height = part.artwork.height;
  const context = canvas.getContext('2d')!, layerCanvas = document.createElement('canvas'); layerCanvas.width = canvas.width; layerCanvas.height = canvas.height;
  const layerContext = layerCanvas.getContext('2d')!;
  for (const layer of part.artwork.layers) {
    const data = layerContext.createImageData(canvas.width, canvas.height);
    layer.pixels.forEach((index, i) => { const c = part.artwork.palette[index]!; for (let k = 0; k < 4; k++) data.data[i * 4 + k] = parseInt(c.slice(1 + k * 2, 3 + k * 2), 16); });
    layerContext.putImageData(data, 0, 0); context.globalAlpha = layer.opacity; context.drawImage(layerCanvas, 0, 0);
  }
  layerCanvas.width = layerCanvas.height = 0; context.globalAlpha = 1; return canvas;
}
