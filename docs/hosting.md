# Static hosting and downloads

The repository is `pink-kitsune-420/2d-actor-animator`. [0.1.0a (Alpha)](https://github.com/pink-kitsune-420/2d-actor-animator/releases/tag/v0.1.0a) provides the self-contained offline HTML, source and optional runtime archives. **This is alpha software and may not work properly.** Keep editable-source backups. The intended hosted editor URL is https://pink-kitsune-420.github.io/2d-actor-animator/; deployment and live editor verification remain pending. A private security reporting channel is also pending.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run stage:pages
ANIMATOR_TEST_PORT=4512 npm run test:release
```

`_site/` is the only deployment input. `scripts/stage-pages.mjs` copies explicit editor assets, selected built-package demos, the offline HTML, an original editable beacon example and notices. It rejects unexpected paths, symlinks, source maps, private context and broken relative HTML/module references. It writes an exact SHA-256 manifest under ignored `release-artifacts/`. Never upload the repository root or all of `dist/`.

The build uses relative URLs. Release tests mount `/2d-actor-animator/` on a strict static server: refresh, examples, assets, downloads and missing-page responses must work without an SPA fallback. Changing the repository slug requires updating this mount and the intended links, then rerunning qualification. The offline HTML works separately via `file://` and has embedded help. Its **License & credits** footer contains separate expanders for the full MIT license and credits/provenance; saving and recovery guidance is in **Help & shortcuts**.

After committing the reviewed source, `npm run package:release` prepares the exact-ref source archive, offline HTML, runtime archive, site archive, content manifests and SHA256SUMS. This is local packaging only. Both package manifests stay private. Extracted source can build with `npm ci --ignore-scripts --no-audit --no-fund` and `npm run build`; a Git checkout is required for the history audit in `npm run check`.

The verification workflow has read-only repository permissions. The Pages workflow is manual only and depends on successful verification. Only its deployment job receives Pages/OIDC write permissions and uses the `github-pages` environment. Configure required reviewers and the approved publication branch in that environment, select GitHub Actions as the Pages source, and review the exact SHA before manually deploying. These repository settings and remote Actions behavior remain unverified until publication. Official Actions are pinned to full commit SHAs; artifact creation mirrors the official Pages tar contract while avoiding mutable composite-action dependencies. See [GitHub's Pages workflow requirements](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) and [workflow security guidance](https://docs.github.com/en/actions/reference/security/secure-use).

After approved publication, verify the HTTPS editor and downloads against SHA256SUMS, replace pending wording in the README with the verified URL, and provide that exact URL to the Space Lab README owner. Retain a known-good artifact for rollback. Do not claim either live deployment or the two-README linking goal complete from local tests.
