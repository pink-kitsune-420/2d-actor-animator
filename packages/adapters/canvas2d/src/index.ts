import type { ActorPose, CompiledActorProject } from '../../../actor-tools/src/evaluator';
import { prepareRasters, releaseRasters, RenderResources, type ActorRenderView, type ActorRendererMetrics } from '../../rendering/src/resources';
export type { ActorRenderView, ActorRendererMetrics } from '../../rendering/src/resources';
export const ACTOR_CANVAS2D_RENDERER = 'actor-animator:canvas2d/1';
export interface ActorCanvas2DBinding { draw(context: CanvasRenderingContext2D, view: ActorRenderView): void; dispose(): void }
export interface ActorCanvas2DRenderer {
  readonly metrics: ActorRendererMetrics;
  bind(pose: ActorPose): ActorCanvas2DBinding;
  dispose(): void;
}
/** Optional backup backend. Synchronously prepares native raster resources once. */
export function createActorCanvas2DRenderer(compiled: CompiledActorProject): ActorCanvas2DRenderer {
  const rasters = prepareRasters(compiled);
  let resources: RenderResources;
  try { resources = new RenderResources(compiled, rasters); }
  catch (error) { releaseRasters(rasters); throw error; }
  return {
    get metrics() { return resources.metrics(false); },
    bind(pose) {
      const data = resources.bind(pose);
      return { dispose: data.dispose, draw(context, view) {
        const pose = resources.frame(data, view), out = data.matrices;
        context.save();
        try {
          context.globalAlpha = 1; context.globalCompositeOperation = 'source-over'; context.imageSmoothingEnabled = false;
          context.shadowColor = 'transparent'; context.shadowBlur = 0; context.shadowOffsetX = context.shadowOffsetY = 0;
          // Some native backends have no filter state. Do not create/overwrite
          // an expando that native save/restore cannot restore.
          if ('filter' in Object.getPrototypeOf(context)) context.filter = 'none';
          for (let k = 0; k < pose.drawSequence.length; k++) {
            const slot = pose.drawSequence[k]!; if (!pose.visible[slot]) continue;
            const r = rasters[pose.partIndices[slot]!]; if (!r) continue;
            const o = k * 6; context.setTransform(out[o]!, out[o + 1]!, out[o + 2]!, out[o + 3]!, out[o + 4]!, out[o + 5]!);
            context.drawImage(r.canvas, 0, 0);
          }
        } finally { context.restore(); }
      } };
    },
    dispose() { if (resources.compiled) { resources.dispose(); releaseRasters(rasters); rasters.length = 0; } },
  };
}
