# 2D Actor Animator

Create characters, creatures and robots in an independent 2D rigging and animation editor. Paint layered parts, build freely named skeletons or use no bones, animate and keep complete editable projects. Built with Space Lab as its first intended consumer.

**[Open 2D Actor Animator](https://pink-kitsune-420.github.io/2d-actor-animator/)** — proposed Pages address; **not yet deployed or live-verified**.

**Offline:** build and open `dist/2D Actor Animator.html` directly in your browser. It is self-contained; no server is needed. A public release download is pending. Keep your work with **Download editable source**, then reopen the `.actorproject` file with **Open source**.

![2D Actor Animator character workspace](docs/images/character.png)

## First animation

1. Choose **Projects → Examples → Example: classic astronaut**, then **Rig** to explore a character; or **Projects → Empty project → Parts → Part setup → Create part** for your own artwork.
2. Use **Rig → Item** to assemble parts, **Animate → Clips** to create a motion and **Animate → Keys** to record poses, and Preview to play or scrub explicit seconds. **Rest** changes the base shape; **Pose** keys the selected clip.
3. Download the editable source and retain it. PNG sheets are flattened derivatives; download their matching metadata and keep your original source too.

Follow the [character and nonhuman tutorial](docs/getting-started.md). **Help & shortcuts** in the editor also works offline. Painting needs a pointer; numeric rig/key controls and keyboard navigation support precise editing. A desktop or laptop is recommended.

Project files are processed locally in your browser. Hosting still loads application files over the network; demos fetch their bundled examples. Recovery is best effort, namespaced browser storage shared across tabs on the same origin, not a permanent backup. See [privacy, recovery and file guidance](docs/getting-started.md#files-recovery-and-mistakes).

## Run locally

Requires Node.js 22.12 or newer and npm. From this directory:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run dev
```

Open **http://127.0.0.1:4500/**. Choose **Projects → Examples → Example: classic astronaut**, then use Parts, Rig, Animate or Emotes. The example demonstrates the tools; its animation is not a finished quality reference. Empty projects and nonhuman/zero-bone projects use the same editor.

Stop the server with **Ctrl+C**. It uses a strict port, so it will refuse to take an occupied port. The editor requires no account or hosted game.

For a production preview:

```bash
npm run build
npm run preview -- --port 4502 --strictPort
```

Open http://127.0.0.1:4502/.

## Open a single HTML file

Run `npm run build`, then double-click **`dist/2D Actor Animator.html`**. It contains the editor, styles and bundled examples, so it works offline without starting a server. You can move or copy this file by itself. `npm run build:launcher` rebuilds just the HTML copy.

Use **Download editable source** to save your work, and **Open** to reopen an `.actorproject` file. Browser recovery storage for local HTML files depends on the browser and file location; keep downloaded project files as your originals. The HTML copy contains its MIT license and credits.

## Current capabilities

- Indexed raster actor parts with editable layers, palette transparency, pivots and explicit scale.
- Arbitrary skeletons, multiple roots and rigs, zero-bone scene attachments, cosmetic sockets, joint limits and optional CCD constraints.
- Visual seconds-based dope sheet with group retiming, range selection and a same-project key clipboard.
- Transform keys, easing, visibility/order tracks, animation composition, cels/flipbooks and optional solo/two-role choreography preview.
- Direct joint/bone/artwork selection, local translation/rotation handles and a separate rest-joint move that preserves children.
- Rest/pose distinction, retained previews, shared Undo/Redo, local recovery and exact editable-source download/reopen.
- [Reviewable sampled sprite sheets](docs/sheets.md) with explicit seconds, fixed X/Y framing, contact-sheet preview and matching PNG/timing/pivot metadata. Keep the complete editable source alongside flattened output.

The rig interface offers both viewport and numeric controls. See [viewport editing](docs/viewport.md). See [visual timeline editing](docs/timeline.md). See [outgoing easing curves](docs/curves.md) for graph, handle and exact numeric editing. Broader artwork input and engine adapters are future development. Mesh deformation and general illustration/world/ship/tile editing are outside the current tool.

## Use the runtime

`npm run build` produces the editor and a private local `@actor-animator/runtime` package in `dist/runtime`. `npm run check:runtime` verifies an isolated installed archive against independent source, pose and resource fixtures.

The [Runtime Contract Draft 1](docs/runtime-contract.md) specifies existing asset, pose, timing and lifecycle semantics. [Conformance fixtures and the tested profile matrix](docs/runtime-conformance.md) provide independent expected outputs; `npm run check:conformance` tests a fresh installed archive and writes `dist/conformance-report.json`. After checking, `/conformance-example/` displays the browser results.

See [the selected API and lifecycle](docs/runtime.md) and [editable project contract, units and limits](docs/actor-project.md). The examples consume built JS, and declaration checks require no DOM types. Compilation snapshots source; poses/animation players belong to individual instances. The generic root includes no editor, renderer or game dependency. Optional [WebGL2 primary and Canvas2D backup backends](docs/rendering.md) consume the same compiled objects/poses through separate browser entries. After `npm run check`, open `/rendering-example/` for an installed-output consumer with two independent actors.

## Space Lab compatibility

The existing `.actorproject` format and its `spacelab:*` capability identifiers are intentionally retained. Actor artwork, RGBA palettes/layers, scale/pivots, rigs, clips, cels and optional emote definitions continue to round-trip against the frozen examples.

The optional [`@actor-animator/runtime/spacelab` historical source profile](docs/spacelab.md) checks the retained data contract and exports accepted original text exactly. After `npm run check`, open `/spacelab-example/` in the production preview for separate source and rendered-art evidence. Current live game support is unverified; no game provider or module installer is implemented. Ship/tile artwork uses different formats and is outside this actor-focused project.

## Browser evidence

The local candidate is being qualified on Linux with the pinned Playwright Chromium, Firefox and WebKit builds. Exact tested versions and scope are recorded in [browser qualification](docs/browser-support.md). Other operating systems, hardware GPU drivers, mobile authoring and arbitrary browser versions are not qualified. WebGL2 is the optional runtime primary backend; Canvas2D is its backup. The editor uses native Canvas2D previews.

## Layout and verification

- `apps/web/src/actor-tools/`: retained editor, artwork and previews.
- `packages/actor-tools/src/`: pure project validation, rigging and animation implementation.
- `packages/project-types/src/`: local actor-project data contracts.
- `packages/runtime/`: selected public runtime entry and local package manifest.
- `packages/adapters/spacelab/`: optional historical data profile outside the generic core.
- `tests/runtime/` and `tests/support/`: retained independent installed-package and raster oracles.
- `examples/modules/actor-project/src/source.ts`: retained first-party analytic data examples; no game module service or manifest.
- `tests/`: independent mathematical, pixel, source, history and browser journeys.

```bash
npm run check
ANIMATOR_TEST_PORT=4501 npm run test:browser -- --project=chromium
```

`check` verifies isolation, actual pinned tool versions, types, all units, production editor/runtime builds, fresh archive imports/declarations/content and licenses. Build before browser tests; keep that build fixed during the run. Chromium, Firefox and WebKit projects are configured. To install the matching browser binaries when absent, run `npx playwright install chromium` (or the required browser names). Installed browser executables are development tools and are not bundled with the editor.

Use this repository's own `npm ci`; do not symlink another project's mutable installation. There are zero third-party runtime dependencies.

See [CONTRIBUTING.md](CONTRIBUTING.md), [CHANGELOG.md](CHANGELOG.md), [SECURITY.md](SECURITY.md) and [static hosting](docs/hosting.md). Public bug reports can use this repository’s Issues once published; include a minimal non-sensitive example.

## Origin and license

MIT. Preserve [LICENSE](LICENSE) and [CREDITS.md](CREDITS.md). [UPSTREAM.json](UPSTREAM.json) identifies the frozen Space Lab source commit and all 52 imported files. The extraction includes the editor, independent evaluator/types and first-party examples/tests; it contains no game simulation, game module host or private project history.

The import alias is now local (`@actor-animator/types`), recovery storage is namespaced for this project, and build/test tooling is isolated. Legacy source-format identifiers remain wire-compatible. Improvements may later be backported or consumed through a reviewed versioned adapter; no automatic synchronization or game changes occur.
