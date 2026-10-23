# Credits and licensing

Actor Animator is an independent extraction of Space Lab's first-party actor editor and animation implementation. Copyright (c) 2026 Spacelab Contributors, MIT; the original notice is retained in LICENSE. UPSTREAM.json records the exact source commit and imported-file hashes. The astronaut, nonhuman fixtures and analytic examples are original MIT first-party work retained from that source.

This software is not affiliated with, endorsed by, or sponsored by NASA or ESA. No NASA/JPL ephemeris datasets, game simulation, third-party logos or game assets outside the actor examples are included in this extraction.

The antenna creature, zero-bone lamp, runtime examples and package tooling added here are original Actor Animator contributor work under the same MIT license. The runtime includes the preserved evaluator and data-contract provenance; its package carries LICENSE, this credit record and UPSTREAM.json.

There are zero third-party runtime dependencies. Build and verification tools remain development-only: Vite and Vitest (MIT), TypeScript (Apache-2.0), Node type declarations (MIT), and Playwright (Apache-2.0). Exact versions/transitive packages are locked in package-lock.json and inspected by npm run check:licenses. A Node runtime is supplied by the user; no Node executable is bundled.

The sampled-sheet consumer in `examples/sheet/` and its analytic verification artwork are original MIT work by Actor Animator contributors.
