# Credits and licensing

2D Actor Animator is an independent extraction of Space Lab's first-party actor editor and animation implementation. Copyright (c) 2026 Spacelab Contributors, MIT; the original notice is retained in LICENSE. UPSTREAM.json records the exact source commit and imported-file hashes. The astronaut, nonhuman fixtures and analytic examples are original MIT first-party work retained from that source.

This software is not affiliated with, endorsed by, or sponsored by NASA or ESA. No NASA/JPL ephemeris datasets, game simulation, third-party logos or game assets outside the actor examples are included in this extraction.

Developer playback demos in `examples/runtime/` use two small schematic samples: an antenna creature and a lamp animated without bones. These samples are separate from the editor’s Projects menu. The samples and build/package scripts are original MIT work by Actor Animator contributors. Runtime downloads retain the original animation code’s attribution in LICENSE, CREDITS.md and UPSTREAM.json.

There are zero third-party runtime dependencies. Build and verification tools remain development-only: Vite and Vitest (MIT), TypeScript (Apache-2.0), Node type declarations (MIT), and Playwright (Apache-2.0). Exact versions/transitive packages are locked in package-lock.json and inspected by npm run check:licenses. A Node runtime is supplied by the user; no Node executable is bundled.

The sampled-sheet consumer in `examples/sheet/` and its analytic verification artwork are original MIT work by Actor Animator contributors.

## Release tooling and documentation

Creator tutorial screenshots are captured from first-party 2D Actor Animator examples and UI (MIT). No third-party branding or artwork is added. GitHub Actions checkout, setup-node, upload-artifact and deploy-pages are development/deployment-only tools from GitHub's official actions organization, under MIT licenses. Their reviewed revisions are pinned in the workflow files; they are not bundled into the editor or runtime.
