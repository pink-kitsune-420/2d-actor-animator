import { compileActorProject, createActorPose, type ActorProject } from '@actor-animator/runtime';
import { createActorCanvas2DRenderer, type ActorRenderView } from '@actor-animator/runtime/canvas2d';
import { createActorWebGL2Renderer, type ActorWebGL2Renderer } from '@actor-animator/runtime/webgl2';
export function consume(source: ActorProject, canvas: HTMLCanvasElement, context: CanvasRenderingContext2D): ActorWebGL2Renderer {
  const c = compileActorProject(source), p = createActorPose(c), v: ActorRenderView = [1,0,0,-1,0,0];
  const backup = createActorCanvas2DRenderer(c), b = backup.bind(p); b.draw(context,v); b.dispose(); backup.dispose();
  const primary = createActorWebGL2Renderer(c,canvas); primary.clear(); primary.bind(p).draw(v); return primary;
}
