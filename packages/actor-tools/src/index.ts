/** DOM-independent 2D project validation, rigging and animation implementation.
 * Legacy project formats and compiler behavior are preserved by this extraction. */
export {
  ACTOR_CURVES, ACTOR_PROJECT_CAPABILITIES, CEL_TRACKS_CAPABILITY, EMOTE_AUTHORING_CAPABILITY, ANIMATION_COMPOSITION_CAPABILITY, CCD_CHAIN_SOLVER, DEFAULT_ACTOR_PROJECT_LIMITS, RIG_CONSTRAINTS_CAPABILITY,
  ActorProjectError, openActorProject, saveActorProject, validateActorProject,
} from './project';
export type { ActorProjectDiagnostic, ActorProjectLimits, ActorProjectResult } from './project';
export { BLEND_STACK_CAP, compileActorProject, createActorPose, evaluateActorPose } from './evaluator';
export type {
  ActorAnimatorDescriptor, ActorCompileOptions, ActorConstraintRig, ActorConstraintSolver, ActorConstraintStatus, ActorPose, ActorPoseSlot,
  ActorPoseUpdater, ActorPreparedConstraint, ActorReadonly, CompiledActorProject,
} from './evaluator';
export {
  createActorAnimationPlayer, describeActorAnimation, evaluateActorAnimation, requestActorAnimationState, trimActorAnimationHistory,
} from './animation';
export type { ActorAnimationPlayer, ActorAnimationPlayerOptions, ActorAnimationStatus, ActorRequestOutcome } from './animation';
export { CCD_CHAIN_CONSTRAINT_SOLVER } from './constraints';
export {
  ActorEditError, REPRESENTABLE_TOLERANCE, addCcdConstraint, applyDeletion, constraintFieldsUsed, decomposeMatrix, deleteConstraint,
  invertMatrix, isAncestorOrSelf, isSimilarity, keyedClipNames, maintainCapability, mirrorSubtree, moveJoint, multiplyMatrices,
  reparentRigItem, restWorld, reviewDeletion, rigDiagnostics, scaleSegmentOffsets, setConstraintEnabled, setJointLimits,
  setPoseKey, subtreeOf, tracksFor, transformMatrix, updateCcdConstraint,
} from './rig';
export type { ActorDeletePolicy, ActorMatrix, ActorParentRef, ActorPreserveMode, ActorRigItem } from './rig';

export { syncAnimationCapability, editTransformKey, deleteActorClip } from './animation-edit';
export { syncCelCapability, editCelKey, setCelHold, deleteActorCel, openActorSheet, importActorSheet } from './cels';
export type { ActorSheet } from './cels';
export { syncEmoteCapability, actorEmoteCompatibility, sampleActorEmoteTime } from './emotes';
export type { ActorEmoteCompatibility } from './emotes';
