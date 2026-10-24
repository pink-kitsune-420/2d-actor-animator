# Contributing

Keep the editor independent of game engines, backend services and runtime dependencies. Preserve MIT provenance, the authoritative editable source, stable IDs, unknown extensions and existing format identifiers. Read [ARCHITECTURE.md](ARCHITECTURE.md) and the [source contract](docs/actor-project.md) before changing formats.

Use Node.js 22.12 or newer (the qualification uses 22.23.2) and this repository's own locked install:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run stage:pages
npx --no-install playwright install chromium firefox webkit
ANIMATOR_TEST_PORT=4510 npm run test:browser -- --project=chromium
ANIMATOR_TEST_PORT=4512 npm run test:release
```

`check` includes isolation, exact tooling, public-content/history guards, types, units, production builds, fresh runtime archive consumers and licensing. Browser runs own strict local ports and refuse server reuse. Build and stage first; keep outputs fixed during browser tests. `test:release` serves only the staged site under `/2d-actor-animator/`, with no development fallback, and also checks the offline HTML. Install browser system libraries if Playwright reports them missing. Other OS/browser qualification must be recorded separately.

Add meaningful independent source, mathematical or pixel assertions for changed behavior. Retain reusable hot-loop buffers and Float64 pose math. Keep gameplay and physics in consumers. Additions that ship must have reviewed permissive licensing and credits; run `npm run check:licenses`.

Public bug reports belong in this repository's Issues once published. Include browser/OS, steps, expected/actual result and a minimal non-sensitive project you have permission to share. Exclude recovery data, credentials and private artwork. Use [SECURITY.md](SECURITY.md) for vulnerabilities. No response-time promise is made.
