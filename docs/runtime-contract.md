# 2D Actor Runtime Contract — Draft 1

Document revision **draft-1**. This is this project's semantic contract, with an ESM JavaScript reference binding in runtime package **0.1.0**, compiler **`spacelab-actor-compiler/5`**. It describes the existing behavior. It introduces no actor file format, capability ID, API, migration, runtime event system or product 1.0. Compatibility claims require a named implementation, version, supported features, limits and conformance report. Industry adoption and arbitrary engine compatibility are not claimed.

“Must” denotes a requirement within a declared supported profile. Optional profiles may be omitted from an implementation's claim; unsupported **required** capabilities must still reject admission. Documentation profile names below are groupings, never new fields in an actor project. The [fixture kit and evidence matrix](runtime-conformance.md) define the tested subset, tolerances and repeatable checks. Passing the finite kit is evidence at that scope, not proof of all possible inputs.

## 1. Asset admission and source identity

The portable input is editable `.actorproject` JSON, format **`spacelab-actor-project/1`**. Loaders validate and compile at load time. [Editable project fields and limits](actor-project.md) and the `ActorProject` records in the public package declarations define the supported record shapes. Required root fields are `format`, semantic `version`, namespaced `id`, `name`, `author`, `license`, `provenance`, `units`, `requiredCapabilities`, `parts`, `rigs`, `attachments`, `clips`, `actions`, `extensions`; `animators`, `cels`, `emotes` are optional. Core records reject unknown fields. IDs are stable namespaced strings, case sensitive, without whitespace; names impose no anatomy. Node/socket references are rig scoped. Attachment references are project scoped. Consumers must resolve references explicitly, including rig identity when node IDs repeat across rigs.

Admission accepts finite plain JSON data and bounded UTF-8 text. It rejects cycles, nonfinite numbers, accessors, sparse arrays, executable values and unsupported core fields. Byte limits precede parsing text; depth/value/string, aggregate collection/pixel and solver/composition work limits precede compiling. Default budgets and override rules are in the project contract. Overrides are nonnegative safe integers with known names; invalid configurations are caller errors. A consumer must disclose any lower or higher supported limits. Raising core limits does not raise renderer limits.

Unknown required capabilities reject the whole asset before playback. Unknown namespaced extension values remain inert and preserved, including strings that resemble URLs. No asset data executes code or causes a fetch. Unknown constraint solvers retain settings and report unsupported; admitting their source does not mean solving them. An unsupported schema must not be resaved as `/1`. Retain the rejected original and diagnostics.

Open/validate produce detached accepted values. Canonical save sorts object keys lexically, keeps array order, emits no formatting whitespace, and preserves accepted JSON values, including negative zero. This canonical representation is distinct from original bytes: whitespace, key layout and escape spelling may differ. Preserve original text separately when exact bytes are required. A pose, PNG, sheet, diagnostic snapshot or compiled object must never replace the editable authority. Artwork revision acceptance is an explicit authoring/host decision; runtime compilation does not revise, accept or mutate artwork.

Project ID identifies an asset; project `version` and part `revision` identify authored revisions. A runtime cache must include exact source and behavioral options/limits, not just IDs. The reference compile identity contains full canonical source, compiler, numerical/curve policy, capabilities, solver ID/versions and configured limits. Compiled resources are immutable implementation memory, **not a serialized portable format**. Other bindings need equivalent semantic inputs and outputs; they need not counterfeit private JavaScript brands or cache strings.

## 2. Coordinates, hierarchy and raster space

All time is seconds. Translation is in project units, rotation CCW radians, scene x right/y up, origin `[0,0]`. Positive finite `metresPerUnit` is descriptive calibration and does not automatically scale pose matrices or gameplay. Clip keys contain complete absolute local transforms; they are not deltas from rest. Finite zero and negative scale are valid. There is no mandatory frame rate, required human skeleton, single-root rule or inverse-transform requirement.

Local TRS is `T * R * S`. For `x,y,r,sx,sy`, its affine coefficients are `[cos(r)*sx, sin(r)*sx, -sin(r)*sy, cos(r)*sy, x, y]`. Affine `[a,b,c,d,tx,ty]` means `x'=a*x+c*y+tx`, `y'=b*x+d*y+ty`. Child world is parent world multiplied by child local; root parent is scene identity. Nonuniform parent scale and child rotation can create shear; consumers must preserve the full affine result rather than decompose it into a lossy rotation/scale pair. Multiple rigs/roots, empty rigs and zero-bone scene attachments are valid. Sockets inherit node world and their own local TRS. Attachments inherit either their explicit node or scene identity; socket attachments are unsupported.

The reference binding exposes nodes parent first (rigs by stable ID, depth-first roots and siblings by stable ID), then sockets (rig/ID), then attachments (ID). `parts` retain source order; resolved part indices address this order. Array ordering in editable source remains unchanged by compilation. Cross-binding comparisons should resolve `(kind, rigId, id)` instead of assuming a wire slot index.

Raster rows run top down, columns right; each row-major index selects an eight-digit `#RRGGBBAA`, including alpha at index zero. Layers composite source-over in source order with their layer opacity; alpha is not an implicit transparent-index convention. Keep editable layers even when rendering flattens them. A pixel centre at column `c`, row `r`, height `h`, density `u=unitsPerPixel` and bottom-left pivot `(px,py)` is `((c+.5)*u-px, (h-r-.5)*u-py)` before attachment world. Multiply actor world then host view. Preview zoom belongs to the host view, independently of `metresPerUnit` and raster density.

## 3. Sampling and composition

A successful sample resets untracked channels to rest/default, then writes every output channel, composes hierarchy and optionally solves constraints, derives inherited visibility, and sorts painter order. Rest is selected explicitly; an unknown clip is an error, never an implicit rest. Visible draw order is increasing authored/current order, ties by stable attachment ID using ordinal string comparison. The draw sequence includes hidden attachments; skip those with effective visibility zero. Effective visibility is own visibility AND every ancestor node's visibility. Hidden slots still have evaluated transforms. Cel keys resolve ordinary layered parts, with that part's own pivot/density/revision; no resize or bake is implied.

For duration `D>0`, let `mod(t,D)` mean a nonnegative remainder (negative input wraps):

| Playback | Mapped clip time | `D=2`, input → mapped |
| --- | --- | --- |
| once | clamp to `[0,D]` | `-1→0`, `2→2`, `3→2` |
| loop | `mod(t,D)` | `-.5→1.5`, `2→0`, `4→0` |
| ping-pong | `p=mod(t,2D)`; `p>D ? 2D-p : p` | `-.5→.5`, `2→2`, `3→1`, `4→0` |

Implementations must avoid overflowing merely by adding a period before remainder. Ping-pong requires composition capability and finite `2D`. There is no seam interpolation. Before the first key, hold it; after the last, hold it. Keys have strictly increasing times in `[0,D]`. Step/discrete sampling chooses the latest key at or before mapped time, holding the first before it. At an exact key, choose that authored key; transforms at the final key hold its authored angle even if the preceding shortest segment used extra turns.

Within a transform segment, normalized `u=(t-leftTime)/(rightTime-leftTime)`. A key's `curve` applies to the segment **starting** there, falling back to track `interpolation`; last-key curve/turn metadata is inert. Step uses zero fraction, linear uses `u`. Cubic Bézier solves `X(s)=u`, `s` in `[0,1]`, then uses `Y(s)` for every TRS component. X controls lie in `[0,1]`; finite Y overshoot is allowed. Presets are ease-in `(.42,0,1,1)`, ease-out `(0,0,.58,1)`, ease-in-out `(.42,0,.58,1)`. Reference inversion uses up to eight Newton iterations, then up to 64 bisections with X residual `1e-12`; this is numerical policy, not bitwise cross-language equality.

Unwrapped angle interpolation is ordinary numeric interpolation. Optional shortest uses `a + (wrap(b-a)+2π*turns)*fraction`, wrapping to `[-π,π)`; exact half-turn goes clockwise. `turns` is an extra signed integer on the left key and requires shortest mode. Exact endpoints still use authored values. This differs from blend rotations: partial override/crossfade rotates along the shortest arc, while additive layer deltas are componentwise, including angle and scale.

Animation layers run source order, bottom to top over rest. Each layer operates only on its mask. Absent mask selects all nodes/attachments; empty mask selects nothing. Descendant node masks include descendant nodes and their carried attachments, not independent scene attachments. Sockets follow hierarchy rather than being independently masked.

| Composition rule | Required result |
| --- | --- |
| Override layer | Mix pose below with layer accumulator by weight; partial rotation uses shortest arc; full weight copies exact TRS |
| Additive layer | `below + weight*(accumulator-reference)` for all five TRS components; reference sampled from rest at compile |
| Crossfade | Blend stack bottom upward by clamped elapsed/fade; untracked incoming channels fade to layer base (below for override, reference for additive) |
| Discrete channels | Incoming wins at crossfade weight `>=.5`, then override layer wins at layer weight `>=.5`; missing channels use below. Additive ignores visibility/order/cels |
| Null state clip | Pass through layer base; no implied fallback clip |
| State rate | Clip seconds `(playerTime-entryStart)*rate` for nonnegative rate; `D+(playerTime-entryStart)*rate` for negative; zero freezes at zero |
| Transitions | Exact `(from,to)` overrides `(null,to)`, then layer default; duration zero cuts |
| Automatic next | Only newest entry of once clip with nonzero rate, at `entryStart+D/abs(rate)`; automatic before explicit requests at the same time; automatic bypasses interrupt priority |

Player origin defaults to 0, finite absolute seconds; requests use the same clock and append in nondecreasing time, never before origin. Equal times preserve insertion order per layer. Request outcome rules, in order: earlier than origin/previous request → `out-of-order`; history full → `capacity`; newest already that state → `already-active` without restart; while fading, lower transition priority → `rejected-priority`; otherwise `accepted`. The last three outcomes consume recorded request capacity (default 1024). Rejected-priority is dropped, never queued. Automatic next graphs are acyclic. Each layer has at most eight stack entries. On overflow, discard oldest and increment diagnostic dropped count. Prune occluded entries at event times so sampling frequency does not alter history.

Seeks at/after retained origin replay requests deterministically. Trimming copies the processed stacks into a new origin at processed time and removes processed requests; pending later requests remain. A seek before the new origin refuses. `describeActorAnimation` advances processing and allocates a diagnostic snapshot; it is not a hot-loop sampling operation. The host owns requests, cancellation policy and scheduling.

Constraints solve after all layers, rigs by stable ID then constraints by source order. Unknown solver = unsupported (even if disabled), known disabled = disabled, supported enabled = active. Unsupported, disabled or explicitly bypassed constraints have NaN residuals; NaN here is runtime status, never admitted JSON. Built-in CCD rotates joints toward an explicit same-rig target outside the chain root subtree, fixed iteration/tolerance budget, with authored joint limits only on solver-rotated joints. Rest and keys are not implicitly clamped. Singular/reflected parents are permitted; solver results are cosmetic and must be checked within declared tolerance. Host custom solvers are trusted code, validate/prepare once and identify behavior by ID/version; source never loads them.

Emote data is optional presentation metadata. Compatibility compares definition ID/revision/duration/playback/interrupt priority, role IDs and semantic socket names plus valid local rig/clip/socket mappings; differing concrete mapping IDs are allowed. Role start/rate/placement can differ. Time helper writes `[start + sharedSeconds*rate, sharedSeconds]`, where sharedSeconds is once-clamped or loop-wrapped in the emote duration. Despite its `phase` name, the second value is **seconds, not a normalized fraction**. Placement translation is metres, CCW radians and explicit scale in a cosmetic shared frame. Helpers never schedule participants or grant consent, gameplay effects, physics or movement authority.

## 4. Consumer lifetime and errors

Validate/open → keep authoritative source → compile immutable resources → allocate separate pose/player per instance → sample explicit seconds → render only a complete successful pose → stop host scheduling → release references/resources. Built-in successful sampling reuses retained arrays and avoids per-frame/per-joint allocation. Compilation, admission/serialization, requests, diagnostics and renderer metrics have separate allocation costs. Solvers must not reenter sampling; reference scratch is synchronous/shared. No concurrent mutation is allowed during sample/draw.

| Failure boundary | Reference binding behavior / host duty |
| --- | --- |
| Invalid source | Open/validate return `ok:false` and first JSON-pointer diagnostic; save/compile throw `ActorProjectError` with singular `diagnostic`; preserve rejected original |
| Bad configuration/IDs/time | `RangeError` for invalid limits, unknown clip/animator/layer/state, nonfinite time, bad history origin/capacity or seek before origin |
| Foreign resources | `TypeError` for forged/mismatched compile/pose/player. Equal source/identity does not make two compiles interchangeable |
| Numeric overflow | `RangeError`; partial evaluation must not draw. Renderer completion check refuses until successful resampling |
| Refusal before mutation | Unknown clip/nonfinite time/foreign buffers preserve previous complete pose; later processing errors can invalidate it even if outputs look unchanged |
| Unsupported solver | Status, inert settings and NaN residual, not silent successful solve |

Reference `createActorPose` initializes a complete constrained rest pose. Caller edits to its arrays are caller responsibility; successful evaluation overwrites outputs. The root owns no clock, subscriptions, loading, fetch, renderer or dispose API. Stop scheduling and drop references to core data. Compilation numeric-byte metrics exclude JS/source/solver-private memory; pose array bytes exclude player and renderer storage. No total heap or frame-rate promise is implied.

## 5. Optional renderer and sheet boundaries

The [native renderer binding](rendering.md) defines exact preparation, metrics and lifecycle APIs. Canvas2D and WebGL2 share one evaluator; they are **two render backends, not independent evaluators**. Hosts supply affine view into backing pixels and draw resolved parts in visible sequence. CPU matrices are Float64; WebGL2 uploads Float32. Native raster composition/readback, trig and raster edges may differ across engines. No bitwise cross-engine matrix/trig, edge-pixel, PNG compression or GPU-driver guarantee is made.

Preparation synchronously flattens admitted raster layers, within fixed maximum dimension 1024 and 262144 prepared pixels (count each nonempty part once), and checks finite pivot/density geometry before allocating. WebGL2 also checks native texture limits. Prepare replacement before releasing the previous resource. No URLs, asynchronous decoder callback or asset fetch is owned by these bindings. New accepted artwork requires a new compile/preparation; old resources keep their snapshot.

Canvas2D owns internal raster canvases; host owns destination context and clears it. Draw uses save/restore, source-over, nearest sampling and no shadow/filter; the caller's clip remains in effect. WebGL2 owns textures/program/shaders/VAO and requires exclusive supplied canvas context/default framebuffer, nonzero backing size; it sets GL state without restoration. It never deletes borrowed engine objects or calls loseContext on disposal. A host cannot switch a GL canvas into a Canvas2D canvas; explicit fallback uses another canvas. Context loss changes status and refuses bind/clear/draw; dispose and create replacement/backup. No automatic restoration.

Bindings and renderers dispose idempotently. Renderer disposal invalidates all its bindings, releases owned native resources and drops compile/pose references. Draw preflights visible geometry and complete-pose identity before issuing backend work. Incomplete poses must be refused, including after arithmetic overflow. Binding/renderer metrics distinguish retained CPU bytes/rasters, GPU texture bytes/counts and binding matrices, excluding driver/JS overhead. Repeated draws must not rebuild rasters, recompile, serialize or upload textures.

Sampled **`spacelab-actor-sheet/1`** is a separately versioned reuse profile: [sheet contract](sheets.md). It contains flattened sampled pixels and explicit timing/pivots, losing editable layers, constraints, composition and unsampled continuous motion. It is not a portable compiled skeleton or a way to reconstruct authoritative source. This Draft 1 kit does not certify a new sheet implementation.

## 6. Versioning and claims

| Version | Purpose |
| --- | --- |
| `draft-1` | This semantic document / fixture report target |
| Source `spacelab-actor-project/1` | Editable wire shape |
| `spacelab:*/*` capability and solver IDs | Required feature and solver behavior negotiation |
| Project version / part revision | Author's asset/artwork revisions |
| Compiler `/5` | Reference compile behavior/cache identity |
| Package `0.1.0` | Selected ESM binding API version; supported root and optional exports only |
| Sheet `/1` | Sampled image/timing wire contract |

None substitutes for another. Unsupported required features must reject before playback even if optional extension data looks familiar. Breaking file changes require separately reviewed version/migration, a retained editable original and disclosed loss. Breaking API changes require a documented package version change (minor while 0.x, major at 1.x). Do not blindly rename legacy identifiers.

An implementation report names version, profiles, limits, fixture revision/hashes, environment, pass/fail/unavailable and numerical/pixel tolerances. Report only profiles actually executed; an unavailable backend is not a pass. Future engine/language bindings must run the same semantic inputs/expected outputs with a real adapter and renderer-specific evidence. Parsing JSON alone is insufficient. Live Space Lab contract/provider/owner acceptance remains unverified; no live game provider is implemented by this contract.
