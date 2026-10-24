# Optional native renderers

The private local runtime 0.1.0 provides WebGL2 as the primary standalone backend and Canvas2D as a backup. Import `createActorWebGL2Renderer` and `ACTOR_WEBGL2_RENDERER` (`actor-animator:webgl2/1`) from `@actor-animator/runtime/webgl2`; import `createActorCanvas2DRenderer` and `ACTOR_CANVAS2D_RENDERER` (`actor-animator:canvas2d/1`) from `@actor-animator/runtime/canvas2d`. Both entries export `ActorRenderView`, `ActorRendererMetrics` and their renderer/binding interfaces. These browser entries require DOM types. Root and `./spacelab` remain DOM-free with ES2022 declarations and zero runtime dependencies. Use one installed package instance for root and renderer imports: internal shared chunks preserve private compile/pose identity and are unsupported entrypoints.

```js
import { compileActorProject, createActorPose, evaluateActorPose } from '@actor-animator/runtime';
import { createActorWebGL2Renderer } from '@actor-animator/runtime/webgl2';
const compiled = compileActorProject(admittedSource);
const pose = createActorPose(compiled);
const renderer = createActorWebGL2Renderer(compiled, exclusiveCanvas);
const actor = renderer.bind(pose);
const view = [40, 0, 0, -40, 320, 240]; // project -> backing pixels
evaluateActorPose(compiled, selectedClipOrNull, 0.375, pose);
renderer.clear(); // host begins frame; additional actors can share the renderer
actor.draw(view);
// Host stops scheduling before teardown.
actor.dispose();
renderer.dispose();
```

For backup use `createActorCanvas2DRenderer(compiled)` and `renderer.bind(pose).draw(context, view)`. The host clears the Canvas2D target. Prepare a different canvas if WebGL2 creation fails: a canvas that already acquired a GL context cannot switch to Canvas2D. Fallback selection is an explicit host decision. No clocks, input, gameplay, physics, events, file loading, fetches, extension execution or artwork revision acceptance are supplied. See `examples/rendering` for a standalone installed-output consumer with two independent poses and explicit fractional sampling.

| Contract | Support and boundary |
| --- | --- |
| Inputs | Exact branded `spacelab-actor-compiler/5` object and its successfully evaluated poses; a fresh pose starts at evaluated rest. Another compile with identical IDs/content is foreign. No structural casts or JSON reconstruction of compiled objects. |
| Artwork | Admitted indexed raster, source-order source-over layers, opacity and actual RGBA including index 0. Empty layer lists draw nothing. Immutable compile snapshot, accepted revisions, pivot and density retained. |
| Rig drawing | Arbitrary anatomy, multiple roots/rigs, zero bones, full affine shear/reflection/zero/negative scales; `drawSequence`, `visible`, `partIndices` select cels/order/art. Evaluator handles curves, turns, constraints and composition; unsupported solvers stay unsupported. |
| Coordinates | Project x-right/y-up, CCW radians, seconds. `ActorRenderView` is `[a,b,c,d,tx,ty]`, mapping project positions to target backing pixels, including host placement/framing. Raster centre `(i+.5,j+.5)` maps local `(u*(i+.5)-pivotX, height*u-pivotY-u*(j+.5))`. Final image affine is `view * world * [u,0,0,-u,-pivotX,height*u-pivotY]`. No TRS decomposition or implicit metres scaling; `metresPerUnit` remains calibration. |
| Precision | CPU pose/preflight Float64; WebGL2 vertex uniforms are Float32 clip coordinates. Nonfinite/overflow geometry refuses before any actor draw commands. Native raster edges, alpha/colour rounding and transparent RGB normalization can differ by backend/browser; editable source is unchanged. Nearest texture sampling, no mipmaps. |
| Limits | Preparation dimensions at most 1024 each and aggregate nonempty raster area at most 262144 pixels, independently checked before native allocations. Raised core limits do not widen backend limits. WebGL2 additionally checks actual maximum texture size and finite Float32 clip coefficients. |
| Canvas ownership | Backend owns prepared rasters; caller owns target/context. Draw saves/restores caller state even on native failure, sets source-over/alpha1/no effects, respects existing clip, never clears/resizes target. Native failure can leave pixels partially painted; no pixel rollback. |
| WebGL2 ownership | Exclusive use of the supplied canvas context, default framebuffer only. Backend owns textures, program, shaders and VAO; no borrowed GL objects. It sets viewport/blend/texture/program/state and does not restore GL state. Do not use it directly on another renderer's shared context. Dispose deletes only owned objects, never calls `loseContext`, removes/resizes canvas or disposes caller objects. Host dimensions must be nonzero. |
| Loss and replacement | Synchronous prepare/upload, no asynchronous completion/decoder callbacks/URLs. Failed setup releases partial resources; prepare replacement before disposing the previous renderer. On context loss, status becomes `context-lost`; further bind/clear/draw refuses. No automatic restoration or stale upload. Host disposes it and prepares a fresh renderer/canvas or backup. |
| Lifecycle | Bind once per instance, reuse pose buffers and view; draw performs constant-time brand/completion checks and visible-attachment affine preflight, with retained matrices. No source validation/serialization/compilation/raster rebuilding/texture upload or temporary per-joint arrays in draws. Failed partial evaluation invalidates the pose until a successful evaluation. Rejected calls before mutation retain the prior complete pose. Caller buffer edits remain caller responsibility; no concurrent mutation during draw. |
| Disposal and metrics | Binding/renderer disposal is idempotent; renderer invalidates all bindings, drops compile/pose references and releases owned resources. `metrics` reports CPU rasters/bytes versus GPU textures/bytes and retained binding numeric bytes, excluding native/driver/JS overhead. WebGL2 `status` is `ready`, `context-lost`, or `disposed`; lost GPU resources require disposal, not further use. No total heap or frame rate claim. |

| Other reuse path | Losses |
| --- | --- |
| Live rig through these backends | Native raster rendering of evaluated pose; no vectors, meshes, deformable skinning, custom shaders/materials, WebGL1 or arbitrary engine compatibility. No live Space Lab provider is implemented or verified by this standalone consumer. Existing game integration needs its accepted import/render/resource/package/ownership contracts. |
| Flattened `spacelab-actor-sheet/1` | Sampled pixels/timing only; see `docs/sheets.md`. Cannot reconstruct rigs/curves/layers/constraints. Indexed reimport can refuse more than 256 palette entries. |
| Historical `./spacelab` source profile | Editable original-text preservation with explicit historical capability report, not proof of live game rendering or universal proprietary format compatibility. |

The native upload/context rules follow the [Khronos WebGL2 specification](https://registry.khronos.org/webgl/specs/latest/2.0/) and its [base WebGL specification](https://registry.khronos.org/webgl/specs/latest/1.0/). Code, shaders and fixtures here are original MIT work; no engine library is required.
