# Editable actor-project contract /1

The accepted format is `spacelab-actor-project/1`, commonly saved as `.actorproject`. Legacy `spacelab:*` identifiers remain compatibility identifiers. They do not require a game runtime. The package's TypeScript data declarations are the field reference; validation is the executable admission contract. Original analytic admission and pose fixtures live in `tests/conformance/` in the source repository.

See the [Runtime Contract Draft 1](runtime-contract.md) for evaluation/playback/lifecycle semantics and [conformance scope](runtime-conformance.md) for repeatable reference checks.

## Records and preservation

The root requires `format`, semantic project `version`, namespaced `id`, nonempty `name`, `author`, `license`, `provenance`, `units`, `requiredCapabilities`, `parts`, `rigs`, `attachments`, `clips`, `actions` and `extensions`. `animators`, `cels` and `emotes` are optional. Names are free text; IDs are stable nonempty namespaced strings, with no whitespace or fixed anatomy names. ID scope follows each declared collection/reference (node and socket IDs belong to their rig). Multiple rigs, multiple roots, zero nodes and zero parts are valid when references remain valid. Arrays preserve authored order; compile slot order is separate and deterministic.

Core records are strict: unknown core fields are rejected rather than silently discarded. Put optional unknown data under root `extensions` using namespaced keys. Extension values and unknown solver settings are inert finite JSON, retained without executing, fetching or interpreting them. An unsupported *required* capability is a rejection, even if similarly named optional extension data exists.

Open/validate/save preserve accepted JSON values, including negative zero, arrays, IDs, layered pixels, optional metadata and unknown extensions. Save sorts object keys and omits formatting whitespace; original byte layout is not preserved. Keep original bytes when needed. Sparse arrays, accessors, functions, cycles, symbols, undefined and nonfinite numbers are not accepted source. Use `openActorProject` for file text; structured input must be plain data.

The editor keeps complete editable source/history/recovery separately from compiled snapshots and rendered output. Changing artwork increments its revision and requires explicit editor preview acceptance; compilation never rewrites/revises artwork. A host recompiles only the source revision it deliberately accepts. Undo/recovery must restore the full source, not reconstruct it from a pose or flattened image. Package sampling does not implement an editor history or acceptance UI.

## Coordinates, images and timing

| Quantity | Contract |
| --- | --- |
| Scene | x right, y up, origin `[0,0]`; positive finite `metresPerUnit` is calibration only |
| Transform | Local absolute `T*R*S`; translation in project units; rotation in CCW radians; finite scales including zero/negative |
| Affine pose | `[a,b,c,d,tx,ty]`; parent world multiplied by local; roots inherit scene identity |
| Raster | Indexed rows from top to bottom, columns right; eight-digit `#RRGGBBAA`, including alpha at palette index zero |
| Layers | Source order, row-major indices, layer opacity in `[0,1]`; preserve every editable layer |
| Pixel density | Positive `unitsPerPixel`; top-left outer edge before pivot is `(0,height*unitsPerPixel)` |
| Pivot | Project units from bottom-left; subtract before attachment TRS; pixel centres use half-pixel offsets |
| Attachment | Both `rigId`/`nodeId` present, or both absent for a scene root; socket attachment is unsupported |
| Draw order | Safe integers, ties broken by stable attachment ID |
| Clip | Positive finite duration and key times in seconds in `[0,duration]`; no mandatory frame rate |
| Emote placement | Translation in metres and CCW radians in a cosmetic shared frame, explicit scale; no world authority |

Tracks supply complete absolute local TRS keys. Base interpolation is step or linear, with endpoint holds and no invented loop seam. Unwrapped rotation is the default; optional shortest rotation wraps to `[-pi,pi)` with explicit extra integer turns (half-turn clockwise). Segment easing supports step, linear, fixed ease-in/ease-out/ease-in-out Béziers and authored cubic Bézier controls; x controls in `[0,1]`, finite y overshoot allowed. Visibility, draw order and cel tracks are discrete. Cel keys reference layered parts with their own pivot/density. Override blends choose incoming discrete channels at weight >=0.5; additive layers ignore them. Masks, reference poses, state rates and transitions follow the data declarations.

## Capability negotiation

| Retained capability | Implemented behavior |
| --- | --- |
| `spacelab:indexed-raster/1` | Layered indexed actor parts |
| `spacelab:transform-clips/1` | Transform clips |
| `spacelab:rig-constraints/1` | Joint limits and visual constraints; built-in `spacelab:ccd-chain/1` |
| `spacelab:animation-composition/1` | Easing/angle modes, ping-pong, visibility/order tracks, layered animators |
| `spacelab:cel-tracks/1` | Reusable cels and discrete artwork selection |
| `spacelab:emote-authoring/1` | Inert solo/two-role choreography definitions and time/compatibility helpers |

Optional features require their declared capability. Unknown solver settings may be retained even though a solver is unsupported. The host must inspect constraint status and decide whether visual degradation is acceptable. Limits do not promise equivalent behavior in another engine. Meshes, vectors, materials, physics and executable providers are outside this contract.

## Default admission limits

Overrides are nonnegative safe integers; unknown override names are errors. All collection/work limits are aggregate across the document unless specified. Raising them needs host resource review; defaults bound admission and computation rather than assert production capacity.

| Limit name | Default |
| --- | ---: |
| maxJsonBytes | 4194304 (UTF-8, before parse and canonical admission) |
| maxJsonDepth | 48 |
| maxJsonValues | 1000000 |
| maxStringLength | 16384 |
| maxParts | 256 |
| maxRigs | 32 |
| maxNodes | 4096 |
| maxSockets | 4096 |
| maxAttachments | 4096 |
| maxClips | 256 |
| maxTracks | 8192 |
| maxKeys | 65536 |
| maxLayers | 1024 |
| maxPixels | 262144 (all editable layers) |
| maxDimension | 1024 (each raster dimension) |
| maxPalette | 256 |
| maxRigDepth | 256 |
| maxConstraints | 1024 |
| maxConstraintIterations | 64 (per CCD constraint) |
| maxConstraintWork | 4000000 |
| maxAnimators | 64 |
| maxAnimatorLayers | 256 |
| maxAnimatorStates | 4096 |
| maxAnimatorTransitions | 16384 |
| maxMaskEntries | 8192 |
| maxAnimationWork | 4000000 |

Constraint work estimates sum `iterations*(joints+1)^2` plus a recomposition of all slots per constraint. Animation work is per animator: `layers*9*slots*5`, with eight blend entries plus layer base. JSON byte/work/depth admission precedes compilation. Numeric overflow can still reject otherwise admitted sampling; handle its exception before rendering.

## Source versus derivatives and versions

| Artifact | Retains |
| --- | --- |
| Editable `.actorproject` | Full accepted source, layers, palette alpha, pivots/scale, rigs/clips/cels/composition and extensions |
| Compiled runtime snapshot | Validated immutable resources for supported pose evaluation; not a source editor or replacement save format |
| PNG/sampled sheet | Flattened appearance and explicit export timing/pivots; loses editable layers, rig/constraints/composition and unsampled motion |

Project semantic revision is separate from format `/1`, each capability version, runtime package version and compiler `/5`. Unsupported schemas are rejected with a diagnostic and the original must be retained. This increment introduces no schema migration. A future migration must create a separate reviewed copy, disclose feature loss and preserve the editable original. Space Lab actor data round trips remain supported; live API/provider/module packaging and additional engine compatibility require actual versioned adapters and consumer tests.
