import {
  compileActorProject, createActorPose, evaluateActorPose, openActorProject, saveActorProject,
  createActorAnimationPlayer, evaluateActorAnimation, type ActorProject, type ActorPose,
  type ActorConstraintSolver, type ActorJsonValue,
} from '@actor-animator/runtime';
// These intentionally unsupported imports must fail the declaration check.
// @ts-expect-error private traversal is not public
import { orderedActorNodes } from '@actor-animator/runtime';
// @ts-expect-error internal subpaths are blocked by exports
import { sampleClip } from '@actor-animator/runtime/types/actor-tools/src/evaluator.js';
export function consume(text: string): ActorPose | ActorJsonValue {
  const result = openActorProject(text);
  if (!result.ok) return result.diagnostics[0]?.code ?? null;
  const source: ActorProject = result.source;
  const solver: ActorConstraintSolver = {
    id: 'demo:solver/1', version: '1',
    prepare(_constraint, rig) {
      return { firstSlot: 0, solve(pose, update, residualIndex) {
        const slot = rig.nodeSlot('demo:hub');
        if (slot >= 0) update.recompose(pose, slot);
        pose.constraintResiduals[residualIndex] = NaN;
      } };
    },
  };
  const compiled = compileActorProject(source, {}, { solvers: [solver] });
  const pose: ActorPose = createActorPose(compiled);
  evaluateActorPose(compiled, compiled.clipIds[0] ?? null, 0.5, pose);
  const animator = compiled.animators[0];
  if (animator) evaluateActorAnimation(compiled, createActorAnimationPlayer(compiled, animator.id), 1, pose);
  saveActorProject(source);
  return pose;
}
