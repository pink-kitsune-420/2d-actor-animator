# Space Lab historical actor-source profile /1

`@actor-animator/runtime/spacelab` is an optional, DOM-free admission and lossless original-text export profile. Its ID is `actor-animator:spacelab-source/1`. It targets the retained `spacelab-actor-project/1` data contract, with historical provenance pinned to Space Lab commit `2caf67c8e4949b4d898a12a4b2aa6dfbf4cfea37`, tree `157f7df411ccae2b51044d99fc46f6205af1685b`. This is a local data profile, not a game API version or provider.

No current accepted Space Lab import/render/resource/module contract or owner acceptance is established. Live game support is **unverified**, and a game provider is **not implemented**. The built standalone example demonstrates local rendering separately from source admission.

```js
import {
  SPACELAB_ACTOR_SOURCE_PROFILE, inspectSpaceLabActorSource, exportSpaceLabActorSource,
} from '@actor-animator/runtime/spacelab';

const options = { profile: SPACELAB_ACTOR_SOURCE_PROFILE.id };
const inspected = inspectSpaceLabActorSource(originalText, options);
if (!inspected.ok) console.error(inspected.diagnostics);
else console.log(inspected.report); // inspect warnings, especially unknown solvers
const exported = exportSpaceLabActorSource(originalText, options);
if (exported.ok) consumeOriginalText(exported.text);
```

Export revalidates the supplied text and returns that exact string. Inspection returns detached editable data. Mutating this detached data does not change a later original-text export; use the generic runtime's explicit source save API to save deliberate edits. Retain original file bytes separately if encoding/BOM byte fidelity matters. No derivatives, migration, flattening, fetching or extension execution occur. A rejected original stays with its caller.

| Feature | Profile behavior |
| --- | --- |
| Layers, RGBA palettes, pixel indices, dimensions | Preserved exactly, including transparent palette RGB and alpha at index zero |
| Revisions, pivots, density, units, attachments | Preserved; no new acceptance of artwork revisions on behalf of an editor |
| Arbitrary rigs, multiple roots, zero bones | Supported as source; no anatomy catalogue |
| Clips, curves, angles/turns, once/loop/ping-pong | Preserved; sampled by the separate standalone runtime |
| Visibility/order, cels, composition, masks/references | Preserved with declared capabilities |
| Built-in CCD and unknown solvers | Built-in runtime available; unknown settings preserved inert with `unsupported-solver` warnings |
| Actions/emotes/extensions | Preserved data; no gameplay dispatch or consent |
| Live game rendering, ownership, module/provider installation | Unverified / not implemented |
| Mesh/vector/material/shader or ship/tile/world formats | Unsupported; no silent substitution |

The six capability IDs and default limits are listed by the immutable profile descriptor and [source contract](actor-project.md). Exact profile matching is mandatory. Unsupported source format/capability/unit/core fields return runtime JSON-pointer diagnostics. Profile mismatch returns `profile-version` at `/profile`. Caller `limits` can only tighten the profile envelope; unknown, expanded or invalid limits return `profile-limit` at `/limits/<key>`. Invalid source returns diagnostics without output. Unknown solver warnings permit lossless preservation and do not assert solver execution. Source revision, profile ID, compiler `/5`, capability versions and package `0.1.0` are separate identities.

The optional implementation lives under `packages/adapters/spacelab`; core/editor do not import it. Its self-contained bundle uses the selected runtime source API and has no runtime dependency, DOM or game imports. Source inspection/export allocates and validates; keep it outside sampling loops. Compile each deliberately accepted source once, retain pose/player/raster resources per the [runtime lifecycle](runtime.md), and drop references when the host stops using them.

The original MIT example in `examples/spacelab` consumes built package exports. After `npm run check`, production `/spacelab-example/` serves a copy from the fresh installed archive, with character, nonhuman and zero-bone samples. Inspect/download preserves text; canvas artwork is a separate static sample, with explicit seconds and no animation timer. Pixels are source-order source-over RGBA layers: top-down image rows map to y-up project units, pixel centres at `((column+.5)*unitsPerPixel-pivotX, (height-row-.5)*unitsPerPixel-pivotY)` before the attachment world matrix. Palette alpha multiplies layer opacity; transparent pixels never erase earlier layers. Canvas is an example renderer, not a game renderer contract.
