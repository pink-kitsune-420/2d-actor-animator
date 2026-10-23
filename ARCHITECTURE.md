# Actor-focused architecture

The authoring editor creates editable actor source. A DOM-independent evaluator validates/compiles that source and evaluates one independent retained Float64 pose per instance. The preview draws those results. Future integrations consume source or a packaged runtime through explicit adapters.

## Boundaries

The core models actor artwork, rig transforms, visual constraints, clips, composition and optional choreography. It owns no engine world, locomotion, collision, player input, network session, gameplay contact or participant consent. A game adapter may observe accepted game state to select animation, while authoritative movement stays with that game.

The standalone repository is independent of the Space Lab checkout and its task/dependency store. Its generic editor/runtime must not import `@space-sim/game-api`, game private modules or absolute paths into another checkout. A future optional Space Lab adapter belongs under an explicit integration boundary and targets actual versioned public actor/art/package contracts. It must not expose private game layouts to the core. Public data declarations alone do not establish a supported game runtime/provider.

## Source and rendering

The current editable format is `spacelab-actor-project/1`, with compiler identity /5 and optional declared capabilities. These are retained compatibility identifiers, not a runtime dependency on a game. Keep original files and explicit versioned migration if another format is later introduced.

Coordinates use x-right/y-up project units, CCW radians and seconds. Raster rows run top-to-bottom; pivots are in project units from the image's bottom-left, with explicit project units per pixel. Scene calibration never grants physical authority. Source, immutable compiled resources and per-instance mutable pose outputs have different identities/lifetimes.

Arbitrary names/IDs, unconventional anatomy, multiple roots/rigs and zero bones remain valid. Unknown inert source extensions survive round trips. Hidden UI controls never discard settings. Editing accepted artwork creates an explicit new revision; attachment/cel acceptance and exact undo remain separate.

The initial artwork implementation is layered indexed raster. Bounded actor-part vector editing and future deformation require explicit source/rendering design; do not claim SVG/mesh support before it exists. Optional emote data is cosmetic authoring information, not runtime consent or a general scene/ship/world format.

## Portability and performance

Keep the core usable without DOM, editor, filesystem or any game engine. Evaluators retain buffers and avoid per-joint/per-frame allocation; constrain resource usage explicitly and keep diagnostics actionable. Games can use a built runtime for live poses; tools that only need rendered frames can use PNG/sheets. Different exporters may lose different features and must disclose that without modifying the editable original.

An actor may bind to application-defined actions without a required humanoid state enum. An adapter negotiates units, coordinate conversion, capabilities, clip fallback and resource teardown. Same source does not imply every engine can reproduce every constraint/blend/artwork feature. Engine-specific material/shader or package code belongs outside the generic core.
