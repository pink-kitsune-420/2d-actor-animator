/** Supported runtime surface. Editor operations and evaluator internals are private. */
export {
  ACTOR_CURVES, ACTOR_PROJECT_CAPABILITIES, ANIMATION_COMPOSITION_CAPABILITY,
  CEL_TRACKS_CAPABILITY, EMOTE_AUTHORING_CAPABILITY, RIG_CONSTRAINTS_CAPABILITY,
  CCD_CHAIN_SOLVER, DEFAULT_ACTOR_PROJECT_LIMITS, ActorProjectError,
  openActorProject, saveActorProject, validateActorProject,
} from '../../actor-tools/src/project';
export type { ActorProjectDiagnostic, ActorProjectLimits, ActorProjectResult } from '../../actor-tools/src/project';
export { BLEND_STACK_CAP, compileActorProject, createActorPose, evaluateActorPose } from '../../actor-tools/src/evaluator';
export type {
  ActorAnimatorDescriptor, ActorCompileOptions, ActorConstraintRig, ActorConstraintSolver,
  ActorConstraintStatus, ActorPose, ActorPoseSlot, ActorPoseUpdater, ActorPreparedConstraint,
  ActorReadonly, CompiledActorProject,
} from '../../actor-tools/src/evaluator';
export {
  createActorAnimationPlayer, describeActorAnimation, evaluateActorAnimation,
  requestActorAnimationState, trimActorAnimationHistory,
} from '../../actor-tools/src/animation';
export type {
  ActorAnimationPlayer, ActorAnimationPlayerOptions, ActorAnimationStatus, ActorRequestOutcome,
} from '../../actor-tools/src/animation';
export { actorEmoteCompatibility, sampleActorEmoteTime } from '../../actor-tools/src/emotes';
export type { ActorEmoteCompatibility } from '../../actor-tools/src/emotes';
export type {
  ActorProject, ActorProjectUnits, ActorTransform, ActorJsonValue, ActorPart, ActorRaster,
  ActorRasterLayer, ActorRig, ActorNode, ActorJointLimits, ActorRigPoint, ActorCcdChainSettings,
  ActorConstraint, ActorSocket, ActorAttachment, ActorClip, ActorTrack, ActorCurve,
  ActorTrackTarget, ActorTransformKey, ActorVisibilityTrack, ActorVisibilityKey,
  ActorDrawOrderTrack, ActorDrawOrderKey, ActorCel, ActorCelTrack, ActorCelKey,
  ActorAnimator, ActorAnimatorLayer, ActorTransitionTiming, ActorMaskEntry, ActorReferencePose,
  ActorAnimatorState, ActorAnimatorTransition, ActorAction, ActorEmote, ActorEmoteRole,
} from '../../project-types/src/index';
