import type { ActorPose, CompiledActorProject } from '../../../actor-tools/src/evaluator';
import { prepareRasters, releaseRasters, RenderResources, type ActorRenderView, type ActorRendererMetrics } from '../../rendering/src/resources';
export type { ActorRenderView, ActorRendererMetrics } from '../../rendering/src/resources';
export const ACTOR_WEBGL2_RENDERER = 'actor-animator:webgl2/1';
export interface ActorWebGL2Binding { draw(view: ActorRenderView): void; dispose(): void }
export interface ActorWebGL2Renderer {
  readonly metrics: ActorRendererMetrics;
  readonly status: 'ready' | 'context-lost' | 'disposed';
  clear(): void;
  bind(pose: ActorPose): ActorWebGL2Binding;
  dispose(): void;
}
const vertex = `#version 300 es
precision highp float;
uniform mat3 affine;
out vec2 uv;
const vec2 corners[6] = vec2[6](vec2(0,0),vec2(1,0),vec2(0,1),vec2(0,1),vec2(1,0),vec2(1,1));
void main() { uv = corners[gl_VertexID]; gl_Position = vec4((affine * vec3(uv,1)).xy,0,1); }
`;
const fragment = `#version 300 es
precision highp float;
uniform sampler2D artwork;
in vec2 uv;
out vec4 colour;
void main() { colour = texture(artwork,uv); }
`;
/** Primary standalone backend. Requires exclusive use of the canvas GL context.
 * Does not resize/remove the caller canvas or dispose/lose its native context. */
export function createActorWebGL2Renderer(compiled: CompiledActorProject, canvas: HTMLCanvasElement): ActorWebGL2Renderer {
  const rasters = prepareRasters(compiled);
  let gl: WebGL2RenderingContext | null = null, program: WebGLProgram | null = null, vao: WebGLVertexArrayObject | null = null;
  const shaders: WebGLShader[] = [], textures: (WebGLTexture | null)[] = [];
  let resources: RenderResources | null = null, lost = false, listening = false;
  const onLost = () => { lost = true; };
  function cleanup() {
    if (listening) { canvas.removeEventListener('webglcontextlost', onLost); listening = false; }
    if (resources) resources.dispose();
    if (gl) {
      for (const texture of textures) if (texture) gl.deleteTexture(texture);
      for (const shader of shaders) gl.deleteShader(shader);
      if (vao) gl.deleteVertexArray(vao);
      if (program) {
        if (gl.getParameter(gl.CURRENT_PROGRAM) === program) gl.useProgram(null);
        gl.deleteProgram(program);
      }
    }
    textures.length = shaders.length = 0; program = null; vao = null;
  }
  try {
    gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
    if (!gl || gl.isContextLost()) throw new Error('WebGL2 unavailable; select Canvas2D backup on a separate canvas');
    const attributes = gl.getContextAttributes();
    if (!attributes?.alpha || !attributes.premultipliedAlpha || attributes.antialias) throw new Error('WebGL2 requires alpha, premultiplied alpha and no antialiasing; use an exclusive fresh canvas');
    const maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    for (const r of rasters) if (r && (r.width > maxTexture || r.height > maxTexture)) throw new RangeError('Artwork exceeds WebGL2 texture limit');
    resources = new RenderResources(compiled, rasters);
    const makeShader = (type: number, source: string) => {
      const shader = gl!.createShader(type); if (!shader) throw new Error('WebGL2 shader allocation failed');
      shaders.push(shader); gl!.shaderSource(shader, source); gl!.compileShader(shader);
      if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) throw new Error(`WebGL2 shader compilation failed: ${gl!.getShaderInfoLog(shader)}`);
      return shader;
    };
    const vs = makeShader(gl.VERTEX_SHADER, vertex), fs = makeShader(gl.FRAGMENT_SHADER, fragment);
    program = gl.createProgram(); if (!program) throw new Error('WebGL2 program allocation failed');
    gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`WebGL2 program link failed: ${gl.getProgramInfoLog(program)}`);
    const affine = gl.getUniformLocation(program, 'affine'), artwork = gl.getUniformLocation(program, 'artwork');
    if (!affine || !artwork) throw new Error('WebGL2 shader uniforms unavailable');
    gl.detachShader(program, vs); gl.detachShader(program, fs);
    for (const shader of shaders) gl.deleteShader(shader); shaders.length = 0;
    vao = gl.createVertexArray(); if (!vao) throw new Error('WebGL2 vertex array allocation failed');
    gl.bindVertexArray(vao); gl.useProgram(program); gl.uniform1i(artwork, 0); gl.activeTexture(gl.TEXTURE0);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    for (const r of rasters) {
      if (!r) { textures.push(null); continue; }
      const texture = gl.createTexture(); if (!texture) throw new Error('WebGL2 texture allocation failed');
      textures.push(texture); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, r.canvas);
      if (gl.getError() !== gl.NO_ERROR) throw new Error('WebGL2 texture upload failed');
    }
    if (gl.isContextLost()) throw new Error('WebGL2 context lost during preparation');
    canvas.addEventListener('webglcontextlost', onLost); listening = true;
    const g = gl, state = resources;
    const requireReady = () => {
      state.require();
      if (lost || g.isContextLost()) { lost = true; throw new Error('WebGL2 context lost; dispose and prepare a fresh renderer or Canvas2D backup'); }
      if (!g.drawingBufferWidth || !g.drawingBufferHeight) throw new RangeError('WebGL2 drawing buffer must be nonempty');
    };
    // Exclusive context contract; no caller GL state or foreign resource is touched.
    const setupDraw = () => {
      g.bindFramebuffer(g.FRAMEBUFFER, null); g.viewport(0, 0, g.drawingBufferWidth, g.drawingBufferHeight);
      g.disable(g.DEPTH_TEST); g.disable(g.CULL_FACE); g.disable(g.SCISSOR_TEST); g.disable(g.DITHER); g.disable(g.STENCIL_TEST); g.disable(g.RASTERIZER_DISCARD);
      g.colorMask(true, true, true, true); g.enable(g.BLEND); g.blendEquation(g.FUNC_ADD); g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
      g.useProgram(program); g.bindVertexArray(vao); g.activeTexture(g.TEXTURE0);
    };
    return {
      get metrics() { return state.metrics(true); },
      get status() { return !state.compiled ? 'disposed' : lost || g.isContextLost() ? 'context-lost' : 'ready'; },
      clear() { requireReady(); setupDraw(); g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT); },
      bind(pose) {
        requireReady(); const data = state.bind(pose, true);
        let active = true;
        return { dispose() { if (!active) return; active = false; data.dispose(); }, draw(view) {
          requireReady(); const pose = state.frame(data, view), out = data.matrices, matrix = data.gpuMatrix;
          const sx = 2 / g.drawingBufferWidth, sy = -2 / g.drawingBufferHeight;
          // Admit the GPU precision boundary before issuing any draw command.
          for (let k = 0; k < pose.drawSequence.length; k++) {
            const slot = pose.drawSequence[k]!, part = pose.partIndices[slot]!;
            if (!pose.visible[slot] || !textures[part]) continue;
            const o = k * 6, w = state.widths[part]!, h = state.heights[part]!;
            if (!Number.isFinite(Math.fround(out[o]! * w * sx)) || !Number.isFinite(Math.fround(out[o + 1]! * w * sy)) || !Number.isFinite(Math.fround(out[o + 2]! * h * sx)) || !Number.isFinite(Math.fround(out[o + 3]! * h * sy)) || !Number.isFinite(Math.fround(out[o + 4]! * sx - 1)) || !Number.isFinite(Math.fround(out[o + 5]! * sy + 1))) throw new RangeError('Actor raster exceeds WebGL2 Float32 clip range');
            // Bound intermediate shader additions too, even when cancellation
            // would make the final CPU Float64 corner finite.
            if (Math.abs(out[o]! * w * sx) + Math.abs(out[o + 2]! * h * sx) + Math.abs(out[o + 4]! * sx - 1) > 3.4028234663852886e38 || Math.abs(out[o + 1]! * w * sy) + Math.abs(out[o + 3]! * h * sy) + Math.abs(out[o + 5]! * sy + 1) > 3.4028234663852886e38) throw new RangeError('Actor raster exceeds WebGL2 Float32 corner range');
          }
          setupDraw();
          for (let k = 0; k < pose.drawSequence.length; k++) {
            const slot = pose.drawSequence[k]!, part = pose.partIndices[slot]!;
            if (!pose.visible[slot] || !textures[part]) continue;
            const o = k * 6, w = state.widths[part]!, h = state.heights[part]!;
            matrix[0] = out[o]! * w * sx; matrix[1] = out[o + 1]! * w * sy; matrix[2] = 0;
            matrix[3] = out[o + 2]! * h * sx; matrix[4] = out[o + 3]! * h * sy; matrix[5] = 0;
            matrix[6] = out[o + 4]! * sx - 1; matrix[7] = out[o + 5]! * sy + 1; matrix[8] = 1;
            g.uniformMatrix3fv(affine, false, matrix); g.bindTexture(g.TEXTURE_2D, textures[part]!); g.drawArrays(g.TRIANGLES, 0, 6);
          }
        } };
      },
      dispose: cleanup,
    };
  } catch (error) { cleanup(); throw error; }
  finally { releaseRasters(rasters); }
}
