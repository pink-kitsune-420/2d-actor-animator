# Actor Animator runtime 0.1.0

An engine-free ESM package for validating editable actor projects and sampling retained Float64 poses. It has zero runtime dependencies. The editor and runtime build use the same project validator, evaluator and animation implementation. This local package is private and has not been published to a registry.

## Build and consume

From the repository, run `npm ci --ignore-scripts --no-audit --no-fund`, then `npm run build`. The package directory is `dist/runtime`; `npm pack ./dist/runtime` produces an installable archive. In a separate application, install that archive with `npm install /path/to/actor-animator-runtime-0.1.0.tgz`, then:

```js
import {
  openActorProject, compileActorProject, createActorPose, evaluateActorPose,
} from '@actor-animator/runtime';

const opened = openActorProject(projectText);
if (!opened.ok) throw new Error(JSON.stringify(opened.diagnostics));
const compiled = compileActorProject(opened.source);
const actorA = createActorPose(compiled);
const actorB = createActorPose(compiled);
evaluateActorPose(compiled, compiled.clipIds[0] ?? null, 0.5, actorA);
evaluateActorPose(compiled, null, 0, actorB); // explicit rest pose
```

Use Node >=22.12 or a modern browser supporting ES2022 modules and `structuredClone`. Native browser modules can import `runtime.js` directly; no bundler or DOM is needed by the runtime. ESM is the supported module format; CommonJS is outside this package's contract. Type declarations work with NodeNext and bundler resolution without DOM types or workspace aliases.

`npm run demo:runtime` installs the built archive in an isolated temporary consumer and runs the original antenna/zero-bone Node example. `npm run check:runtime` also verifies archive content, declarations and independent source/math assertions. To see the browser example, build, run `npm run preview -- --port 4502 --strictPort`, and open `/runtime-example/`. It has independent time controls for two nonhuman actors and a zero-bone lamp. `/` opens the existing editor. Examples are first-party MIT schematic art.

## Selected public API

Only the root export is supported. Internal evaluator modules, scratch buffers and editor operations are excluded. The declarations provide signatures and detailed field semantics.

| Area | Runtime exports |
| --- | --- |
| Editable source | `openActorProject`, `validateActorProject`, `saveActorProject`, `ActorProjectError` |
| Admission and feature negotiation | `DEFAULT_ACTOR_PROJECT_LIMITS`, `ACTOR_PROJECT_CAPABILITIES`, `ACTOR_CURVES`, `RIG_CONSTRAINTS_CAPABILITY`, `ANIMATION_COMPOSITION_CAPABILITY`, `CEL_TRACKS_CAPABILITY`, `EMOTE_AUTHORING_CAPABILITY`, `CCD_CHAIN_SOLVER` |
| Compile and sample | `compileActorProject`, `createActorPose`, `evaluateActorPose`, `BLEND_STACK_CAP` |
| Composition | `createActorAnimationPlayer`, `requestActorAnimationState`, `evaluateActorAnimation`, `trimActorAnimationHistory`, `describeActorAnimation` |
| Optional choreography data | `actorEmoteCompatibility`, `sampleActorEmoteTime` |

Public types: all explicitly enumerated `ActorProject` data records (units, transforms, raster parts/layers, rigs, nodes, sockets, constraints, attachments, clips/keys/curves, discrete tracks, cels, animators/layers/states/transitions/masks/references, actions, emotes/roles, JSON values); `ActorProjectDiagnostic`, `ActorProjectLimits`, `ActorProjectResult`; `ActorReadonly`, `CompiledActorProject`, `ActorPose`, `ActorPoseSlot`, `ActorAnimatorDescriptor`, `ActorConstraintStatus`, `ActorCompileOptions`, `ActorConstraintSolver`, `ActorConstraintRig`, `ActorPreparedConstraint`, `ActorPoseUpdater`; `ActorAnimationPlayer`, `ActorAnimationPlayerOptions`, `ActorAnimationStatus`, `ActorRequestOutcome`, `ActorEmoteCompatibility`.

The bundled declaration closure contains implementation declarations required by TypeScript. Their presence is not a supported deep import. The package exports map blocks internal subpaths. There is no engine renderer, image loader, history editor or sheet codec API in this runtime surface.

## Lifetime and sampling

1. Keep editable source as the authority. Open/validate produces a detached canonical copy; save preserves all accepted JSON values and array order. Compilation validates and freezes a separate snapshot. Editing source never mutates an existing compile.
2. Share one immutable compiled resource between instances of the same exact source/options. `identity` is a full canonical cache key including compiler/options/limits/source, not a hash or project ID. Compiler identity remains `spacelab-actor-compiler/5`.
3. Allocate one pose per instance with `createActorPose`. Its typed arrays are retained. Slot `i` has local TRS at `i*5` (`x,y,rotation,scaleX,scaleY`) and affine matrices at `i*6` (`a,b,c,d,tx,ty`): `x'=a*x+c*y+tx`, `y'=b*x+d*y+ty`. Parent `-1` is the scene identity. No renderer should substitute pose arrays or pass a pose to a different compile.
4. Pass explicit clip seconds to `evaluateActorPose`. `null` selects rest. Successful samples overwrite all channels; draw only visible attachment slots in `drawSequence`, using `partIndices` into `compiled.parts` (cel selection can change the part). Apply raster scale/pivot separately; matrices do not bake the artwork pivot. Once clamps, loop wraps including negative times, ping-pong reflects. Constraints run after composition unless explicitly disabled.
5. For composition, allocate one player per instance/animator. Requests use absolute player seconds from `origin` (default 0), recorded in nondecreasing order. `evaluateActorAnimation` samples into that instance's pose. State rate maps player seconds into clip seconds. Requests return `accepted`, `already-active`, `rejected-priority`, `out-of-order` or `capacity`. Capacity defaults to 1024 retained requests. Call `trimActorAnimationHistory` after sampling to advance the earliest seekable time and reclaim request capacity. There are at most eight blended entries per layer; status reports dropped entries. `describeActorAnimation` allocates diagnostic snapshots; keep it outside hot loops.
6. Stop host scheduling and drop references to poses/players/compiled data when finished. There is no runtime timer, subscription, asset fetch or explicit dispose handle. Internal ownership maps are weak. Solver callbacks are trusted host code and must not reenter evaluation: sampling uses shared scratch synchronously. Successful built-in sampling retains buffers and avoids per-frame/per-joint allocation; compiling, source IO, requests/status inspection and host renderers have separate costs.

`compiled.numericBytes` reports retained compilation numeric buffers, excluding source text, JS metadata, solver-private data, pose and player storage. Sum pose array byte lengths for its numeric storage. These are accounting aids, not a total-heap or frame-rate guarantee. Float64 sampling is deterministic for the same inputs/ordered history in a given JS environment; no cross-engine bitwise trigonometry guarantee is made.

## Errors and optional features

Open/validate return `{ok:false, diagnostics:[{path,code,message}]}` for source errors. Diagnostics stop at the first failure; paths are JSON pointers. Save/compile throw `ActorProjectError` with that diagnostic. Invalid limit configuration throws `RangeError`. Preserve the original file on rejection; never silently downgrade it. Unknown required capabilities fail admission. See [the project contract](actor-project.md) for units, supported capabilities and all limits.

Unknown clips/animators/layers/states and nonfinite times throw `RangeError`; choose explicit rest or clip fallbacks in the host. Foreign compiled objects/poses/players throw `TypeError`. Float64 transform overflow throws `RangeError` and can leave a partial pose: do not draw it. Zero/negative scales are valid and need no inverse.

Unknown namespaced constraint solvers keep inert settings and compile with `unsupported` status and NaN residuals; disabled constraints also keep NaN. Built-in CCD is enabled by default. The host can register/replace solvers by ID in compile options; solver ID/version participates in identity. A custom solver must validate its settings, prepare once and retain its buffers; it is executable trusted host code, never code loaded from source. NaN residuals also indicate explicitly bypassed constraints.

Emote helpers compare authored role contracts or write clip time/phase into a caller-owned two-value Float64 buffer. They do not execute choreography, move participants or grant consent. Actions and emotes are optional metadata with explicit host selection. This package owns no gameplay, physics or input.

Package 0.1.0 establishes this selected surface. Any breaking API change requires an explicitly documented version change (minor while 0.x, major at 1.x). Source schema, capability IDs, project revisions and compiler identity are independent versions. No migration, engine compatibility or live Space Lab provider is implied by successful JSON validation. MIT; see LICENSE, CREDITS.md and UPSTREAM.json.
