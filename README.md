# Actor Animator

An independent, actor-focused 2D rigging and animation editor, extracted from Space Lab's MIT-licensed actor tools. Build characters, creatures and robots with freely named parts and skeletons; preserve layered artwork, rigs and animation in editable projects.

This repository is a working extraction baseline. The standalone product and installable runtime are under development. Space Lab's game copy continues independently.

## Run locally

Requires Node.js 22.12 or newer and npm. From this directory:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run dev
```

Open **http://127.0.0.1:4500/**. Choose **Example: classic astronaut**, then use Parts, Rig, Animate or Emotes. The example demonstrates the tools; its animation is not a finished quality reference. Empty projects and nonhuman/zero-bone projects use the same editor.

Stop the server with **Ctrl+C**. It uses a strict port, so it will refuse to take an occupied port. Files stay local; the editor requires no account or hosted game.

For a production preview:

```bash
npm run build
npm run preview -- --port 4502 --strictPort
```

Open http://127.0.0.1:4502/.

## Current capabilities

- Indexed raster actor parts with editable layers, palette transparency, pivots and explicit scale.
- Arbitrary skeletons, multiple roots and rigs, zero-bone scene attachments, cosmetic sockets, joint limits and optional CCD constraints.
- Transform keys, easing, visibility/order tracks, animation composition, cels/flipbooks and optional solo/two-role choreography preview.
- Rest/pose distinction, retained previews, shared Undo/Redo, local recovery and exact editable-source download/reopen.
- PNG and sampled sprite-sheet exports with timing/pivot metadata. Flattened output does not retain the full rig or editable layers.

The current rig/timeline interface includes numeric controls. Direct viewport bone manipulation, a visual dope sheet/curve editor, broader artwork input, a packaged runtime and engine adapters are future development. Mesh deformation and general illustration/world/ship/tile editing are outside the extraction baseline.

## Space Lab compatibility

The existing `.actorproject` format and its `spacelab:*` capability identifiers are intentionally retained. Actor artwork, RGBA palettes/layers, scale/pivots, rigs, clips, cels and optional emote definitions continue to round-trip against the frozen examples.

Space Lab is a planned optional API/export target. Integrations must use versioned public actor/art/package contracts and state supported capabilities explicitly. The baseline has no live-game provider, module packaging, gameplay/physics ownership or multiplayer-consent implementation. Ship/tile artwork uses different formats and is outside this actor-focused project.

## Layout and verification

- `apps/web/src/actor-tools/`: retained editor, artwork and previews.
- `packages/actor-tools/src/`: pure project validation, rigging and animation implementation.
- `packages/project-types/src/`: local actor-project data contracts.
- `examples/modules/actor-project/src/source.ts`: retained first-party analytic data examples; no game module service or manifest.
- `tests/`: independent mathematical, pixel, source, history and browser journeys.

```bash
npm run check
ANIMATOR_TEST_PORT=4501 npm run test:browser -- --project=chromium
```

`check` verifies isolation, actual pinned tool versions, types, all units, production build and licenses. Build before browser tests; keep that build fixed during the run. Chromium, Firefox and WebKit projects are configured. To install the matching browser binaries when absent, run `npx playwright install chromium` (or the required browser names). Installed browser executables are development tools and are not bundled with the editor.

Use this repository's own `npm ci`; do not symlink another project's mutable installation. There are zero third-party runtime dependencies.

## Origin and license

MIT. Preserve [LICENSE](LICENSE) and [CREDITS.md](CREDITS.md). [UPSTREAM.json](UPSTREAM.json) identifies the frozen Space Lab source commit and all 52 imported files. The extraction includes the editor, independent evaluator/types and first-party examples/tests; it contains no game simulation, game module host or private project history.

The import alias is now local (`@actor-animator/types`), recovery storage is namespaced for this project, and build/test tooling is isolated. Legacy source-format identifiers remain wire-compatible. Improvements may later be backported or consumed through a reviewed versioned adapter; no automatic synchronization or game changes occur.
