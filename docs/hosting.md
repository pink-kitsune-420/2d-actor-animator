# Static hosting and downloads

The [hosted alpha editor](https://pink-kitsune-420.github.io/2d-actor-animator/) runs on GitHub Pages. [0.1.0a (Alpha)](https://github.com/pink-kitsune-420/2d-actor-animator/releases/tag/v0.1.0a) provides the self-contained offline HTML, source and optional runtime archives. **This is alpha software and may not work properly.** Keep editable-source backups. The hosted application and offline download are checked against the reviewed build, with live edit/save/reopen/export journeys. A private security reporting channel remains pending.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run stage:pages
ANIMATOR_TEST_PORT=4512 npm run test:release
```

`_site/` is the only deployment input. `scripts/stage-pages.mjs` copies explicit editor assets, selected built-package demos, the offline HTML, an original editable beacon example and notices. It rejects unexpected paths, symlinks, source maps, private context and broken relative HTML/module references. It writes an exact SHA-256 manifest under ignored `release-artifacts/`. Never upload the repository root or all of `dist/`.

The build uses relative URLs. Release tests mount `/2d-actor-animator/` on a strict static server: refresh, examples, assets, downloads and missing-page responses must work without an SPA fallback. Changing the repository slug requires updating this mount and the intended links, then rerunning qualification. The offline HTML works separately via `file://` and has embedded help. Its **License & credits** footer contains separate expanders for the full MIT license and credits/provenance; saving and recovery guidance is in **Help & shortcuts**.

After committing the reviewed source, `npm run package:release` prepares the exact-ref source archive, offline HTML, runtime archive, site archive, content manifests and SHA256SUMS. This is local packaging only. Both package manifests stay private. Extracted source can build with `npm ci --ignore-scripts --no-audit --no-fund` and `npm run build`; a Git checkout is required for the history audit in `npm run check`.

The verification workflow has read-only repository permissions. The Pages workflow is manual only and depends on successful verification. Only its deployment job receives Pages/OIDC write permissions and uses the `github-pages` environment. Configure required reviewers and the approved publication branch in that environment, select GitHub Actions as the Pages source, and review the exact SHA before manually deploying. The published site uses the manual workflow, a main-only deployment environment and the owner as its required reviewer. Self-review is permitted for this single-owner deployment; administrator bypass is disabled. Verification uses read-only repository permissions. Official Actions are pinned to full commit SHAs; artifact creation mirrors the official Pages tar contract while avoiding mutable composite-action dependencies. See [GitHub's Pages workflow requirements](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) and [workflow security guidance](https://docs.github.com/en/actions/reference/security/secure-use).

For subsequent releases, verify the HTTPS editor and downloads against the reviewed manifests and SHA256SUMS before updating links. Retain a known-good artifact for rollback. Space Lab README adoption is a separate owner change; this hosted editor does not establish a live game provider.
