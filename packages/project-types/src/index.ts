/** Editable presentation data. These records grant no movement, collision, input,
 * executable-provider or multiplayer-consent authority. Format and project
 * revision are independent of module/API versions. */
export interface ActorProject {
  format: 'spacelab-actor-project/1';
  /** Semantic project revision; IDs survive renaming and reordering. */
  version: string;
  /** Namespaced project identity; component IDs are arbitrary nonempty strings. */
  id: string;
  name: string;
  author: string;
  license: string;
  provenance: string;
  units: ActorProjectUnits;
  requiredCapabilities: string[];
  parts: ActorPart[];
  rigs: ActorRig[];
  attachments: ActorAttachment[];
  clips: ActorClip[];
  actions: ActorAction[];
  /** Optional animation composition (layers, states, transitions); requires
   * capability `spacelab:animation-composition/1`. Presentation only. */
  animators?: ActorAnimator[];
  /** Reusable references to layered parts; requires `spacelab:cel-tracks/1`. */
  cels?: ActorCel[];
  /** Optional solo/two-role choreography; `spacelab:emote-authoring/1`.
   * Definitions never grant consent, movement or gameplay effects. */
  emotes?: ActorEmote[];
  /** Inert JSON, preserved at value level. Namespaced keys do not enable code
   * or turn an unsupported required capability into an optional one. */
  extensions: Record<string, ActorJsonValue>;
}

/** Source units only; metresPerUnit never changes an authoritative body. */
export interface ActorProjectUnits {
  metresPerUnit: number;
  coordinates: 'x-right-y-up';
  angle: 'radians-ccw';
  time: 'seconds';
  origin: [0, 0];
}

/** Local absolute T * R * S. Project-unit translation, unwrapped CCW radians.
 * Finite negative/zero scales are valid; no inverse operation is implied. */
export interface ActorTransform {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

/** JSON source values only: no undefined, functions, cycles or non-finite numbers. */
export type ActorJsonValue = null | boolean | number | string | ActorJsonValue[] | { [key: string]: ActorJsonValue };

/** First-party indexed raster source, retained with its editable layers. */
export interface ActorPart {
  id: string;
  name: string;
  revision: number;
  /** Pivot in project units, subtracted from the drawing before attachment TRS. */
  pivot: [number, number];
  unitsPerPixel: number;
  artwork: ActorRaster;
}

/** Row zero is highest, columns increase right. The top-left outer edge before
 * pivot subtraction is (0, height * unitsPerPixel); sample pixel centres.
 * Eight-digit RGBA defines alpha, including palette entry zero. */
export interface ActorRaster {
  kind: 'indexed-raster';
  width: number;
  height: number;
  palette: string[];
  layers: ActorRasterLayer[];
}

/** Layers are composited in source order; pixels are row-major palette indices. */
export interface ActorRasterLayer {
  id: string;
  name: string;
  opacity: number;
  pixels: number[];
}

/** Zero nodes and multiple roots are valid. Roots use an identity scene frame. */
export interface ActorRig {
  id: string;
  name: string;
  nodes: ActorNode[];
  sockets: ActorSocket[];
  /** Optional visual constraints, solved in array order after clip sampling.
   * Requires capability `spacelab:rig-constraints/1`. Presentation only: never
   * collision, mass, reach, locomotion or authoritative events. */
  constraints?: ActorConstraint[];
}

/** Stable node IDs are scoped to this rig; no anatomy labels are required. */
export interface ActorNode {
  id: string;
  name: string;
  parentId: string | null;
  rest: ActorTransform;
  /** Optional editing/solver aid; requires `spacelab:rig-constraints/1`. */
  limits?: ActorJointLimits;
}

/** Local unwrapped CCW radians, minRotation <= maxRotation. Authored rest and
 * keys are never clamped; visual solvers clamp only joints they rotate. */
export interface ActorJointLimits {
  minRotation: number;
  maxRotation: number;
}

/** A node or cosmetic socket within the constraint's own rig. */
export interface ActorRigPoint {
  kind: 'node' | 'socket';
  id: string;
}

/** Built-in 2D cyclic-coordinate-descent chain. Joints run from `chainRootId`
 * down to the effector's parent node (node effector) or the socket's node.
 * The target must lie outside the chain root's subtree. `tolerance` is in
 * project units; `iterations` is a fixed per-evaluation budget. */
export interface ActorCcdChainSettings {
  effector: ActorRigPoint;
  chainRootId: string;
  target: ActorRigPoint;
  iterations: number;
  tolerance: number;
}

/** Built-in solvers validate `settings` strictly. Any other namespaced
 * `solver` keeps `settings` as inert JSON: preserved, never executed and
 * reported as unsupported unless the host registers that solver. */
export type ActorConstraint =
  | { id: string; name: string; solver: 'spacelab:ccd-chain/1'; enabled: boolean; settings: ActorCcdChainSettings }
  | { id: string; name: string; solver: string; enabled: boolean; settings: ActorJsonValue };

/** Cosmetic marker only, local to a node; no gameplay contact or reach. */
export interface ActorSocket {
  id: string;
  name: string;
  nodeId: string;
  transform: ActorTransform;
}

/** Both rigId and nodeId are present, or both absent for scene-root artwork.
 * Painter ties use stable attachment ID. Socket attachment is not supported. */
export interface ActorAttachment {
  id: string;
  name: string;
  partId: string;
  rigId?: string;
  nodeId?: string;
  drawOrder: number;
  transform: ActorTransform;
}

/** Once clamps; loop uses positive modulo, including negative seeks. Endpoints
 * hold the nearest key. Loops never invent interpolation across the seam.
 * `ping-pong` (capability `spacelab:animation-composition/1`) maps the positive
 * modulo `p` of period `2 * duration` to `p <= duration ? p : 2 * duration - p`.
 * Track IDs are unique across all of a clip's track arrays. */
export interface ActorClip {
  id: string;
  name: string;
  duration: number;
  playback: 'once' | 'loop' | 'ping-pong';
  tracks: ActorTrack[];
  /** Step-only node/attachment visibility; needs `spacelab:animation-composition/1`. */
  visibilityTracks?: ActorVisibilityTrack[];
  /** Step-only attachment painter order; needs `spacelab:animation-composition/1`. */
  drawOrderTracks?: ActorDrawOrderTrack[];
  /** Step-only artwork selection; requires `spacelab:cel-tracks/1`. */
  celTracks?: ActorCelTrack[];
}

/** One transform track per target per clip. Linear interpolates all TRS
 * components, including unwrapped rotations. Step uses the latest key at or
 * before time. A key's optional `curve` overrides `interpolation` for the
 * segment that starts at that key. */
export interface ActorTrack {
  id: string;
  target: ActorTrackTarget;
  interpolation: 'step' | 'linear';
  /** Rotation interpolation. Absent or `unwrapped`: authored radians as numbers.
   * `shortest`: `a + (wrap(b - a) + 2*pi*turns) * f`, wrap into [-pi, pi)
   * (an exact half turn goes clockwise). Needs `spacelab:animation-composition/1`. */
  angle?: 'unwrapped' | 'shortest';
  keys: ActorTransformKey[];
}

/** Segment easing. `ease-in`, `ease-out` and `ease-in-out` are the cubic Béziers
 * (.42,0,1,1), (0,0,.58,1) and (.42,0,.58,1); `cubic-bezier` uses the key's
 * `bezier`. The eased fraction replaces the time fraction for every component. */
export type ActorCurve = 'step' | 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'cubic-bezier';

/** References are scoped to their explicitly named rig or scene attachment. */
export type ActorTrackTarget = { kind: 'node'; rigId: string; nodeId: string }
  | { kind: 'attachment'; attachmentId: string };

/** Complete local absolute pose, time in seconds within [0, clip.duration].
 * Optional fields need `spacelab:animation-composition/1` and describe the
 * segment from this key to the next (inert on the last key). */
export interface ActorTransformKey {
  time: number;
  value: ActorTransform;
  curve?: ActorCurve;
  /** `[x1, y1, x2, y2]`, present exactly when `curve` is `cubic-bezier`;
   * x1 and x2 in [0, 1], y values finite (overshoot allowed). */
  bezier?: [number, number, number, number];
  /** Integer extra full turns (positive CCW) added to the shortest arc; only on
   * `angle: 'shortest'` tracks, where unwrapped values cannot express turns. */
  turns?: number;
}

/** Step-only node or attachment visibility. A slot is drawn only when it and
 * every ancestor node are visible; hidden artwork still has evaluated matrices. */
export interface ActorVisibilityTrack {
  id: string;
  target: ActorTrackTarget;
  keys: ActorVisibilityKey[];
}
/** One step-only visibility key, time in clip seconds. */
export interface ActorVisibilityKey {
  time: number;
  visible: boolean;
}

/** Step-only painter order for one attachment; ties use stable attachment ID. */
export interface ActorDrawOrderTrack {
  id: string;
  target: { kind: 'attachment'; attachmentId: string };
  keys: ActorDrawOrderKey[];
}
/** One step-only painter-order key, time in clip seconds. */
export interface ActorDrawOrderKey {
  time: number;
  /** Safe integer, compared like `ActorAttachment.drawOrder`. */
  drawOrder: number;
}

/** A reusable cel references an ordinary layered part, including its exact
 * pivot and pixel density. It does not bake, resize or copy its artwork. */
export interface ActorCel { id: string; name: string; partId: string }

/** Per-attachment step selection. Keys share the clip's playback mapping;
 * hold the first before it, then the latest key at/before time. Whole-actor
 * flipbooks use an ordinary scene attachment without any rig. Override blends
 * switch at incoming weight >= 0.5; additive layers ignore this channel. */
export interface ActorCelTrack {
  id: string;
  target: { kind: 'attachment'; attachmentId: string };
  keys: ActorCelKey[];
}

/** Clip seconds and reusable cel ID. A hold lasts until the next key or clip
 * end; changing timing never changes simulation or authoritative events. */
export interface ActorCelKey { time: number; celId: string }

/** Ordered animation layers evaluated over rest. Presentation only: requests,
 * states and transitions never move the actor, emit events or grant gameplay
 * authority. Requires `spacelab:animation-composition/1`. */
export interface ActorAnimator {
  id: string;
  name: string;
  /** Bottom to top. */
  layers: ActorAnimatorLayer[];
}

/** Override: masked slots become mix(below, layer, weight). Additive: masked
 * slots become below + weight * (layer - reference), per component. Within a
 * layer, crossfades mix entries upward; slots an entry's clip does not track
 * fade back to the layer base (the pose below, or the reference pose). */
export interface ActorAnimatorLayer {
  id: string;
  name: string;
  blend: 'override' | 'additive';
  /** In [0, 1]. */
  weight: number;
  /** Absent: every node and attachment. `[]` affects nothing. */
  mask?: ActorMaskEntry[];
  /** Required exactly for additive layers; sampled once from rest. */
  reference?: ActorReferencePose;
  initialStateId: string;
  /** Used when no `(from, to)` or `(null, to)` transition matches. */
  defaultTransition: ActorTransitionTiming;
  states: ActorAnimatorState[];
  transitions: ActorAnimatorTransition[];
}

/** Crossfade seconds (0 cuts) and interrupt priority (safe integer). A request
 * made while the newest entry is still fading in is accepted only when its
 * transition priority is at least the fading transition's priority. */
export interface ActorTransitionTiming {
  duration: number;
  priority: number;
}

/** With `descendants`, also every descendant node and every attachment carried
 * by the node or a descendant. */
export type ActorMaskEntry = { kind: 'node'; rigId: string; nodeId: string; descendants: boolean }
  | { kind: 'attachment'; attachmentId: string };

/** Clip time in seconds, mapped by the clip's playback mode. */
export interface ActorReferencePose {
  clipId: string;
  time: number;
}

/** `clipId: null` passes the layer base through. `rate` scales entry time;
 * negative plays from the end, zero freezes. `next` (only for `once` clips with
 * nonzero rate, acyclic, not itself) is requested when this state's clip ends
 * while it is the newest entry. */
export interface ActorAnimatorState {
  id: string;
  name: string;
  clipId: string | null;
  rate: number;
  next?: string;
}

/** At most one per (from, to); `from: null` matches any current state. */
export interface ActorAnimatorTransition extends ActorTransitionTiming {
  id: string;
  from: string | null;
  to: string;
}

/** Optional visual action suggestion. A missing action is handled by the caller
 * with an explicit rest/idle fallback; this is not a checked gameplay command. */
export interface ActorAction {
  /** Namespaced visual action identity, without a fixed action catalogue. */
  id: string;
  label: string;
  clipId: string;
  category: string;
}


/** Discoverable presentation choreography. Shared ID/revision/timing and role
 * contracts can have different explicit rig/clip/socket mappings per project.
 * This is not a live invitation or authority to move/rotate another actor. */
export interface ActorEmote {
  id: string;
  label: string;
  revision: number;
  duration: number;
  playback: 'once' | 'loop';
  /** Inert visual interrupt hint; never prevents explicit cancellation or
   * ordinary fresh gameplay input. No gameplay lock is implied. */
  interruptPriority: number;
  roles: ActorEmoteRole[];
}

/** One explicit compatible role. Names/IDs impose no anatomy. Source rig binds
 * socket IDs only; all authored scene parts/rigs remain part of this actor. */
export interface ActorEmoteRole {
  id: string;
  label: string;
  clipId: string;
  rigId: string | null;
  /** Semantic role names to actual socket IDs in rigId. Cross-project
   * compatibility compares names, never guesses matching human bones. */
  socketBindings: Record<string, string>;
  /** Clip seconds = start + sharedPhase * rate; reverse/frozen are explicit. */
  start: number;
  rate: number;
  /** Cosmetic shared frame: x/y in metres, rotation in radians. Scales apply
   * after source project-unit calibration. Never a world positioning command. */
  placement: ActorTransform;
}
