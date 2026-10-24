import { describe, expect, test } from 'vitest';
// Release policy is executable tooling, independently tested against leak cases.
// @ts-expect-error first-party build-only ESM helper
import { sourcePath, sitePath, inspectText } from '../../scripts/release-files.mjs';
describe('publication boundaries',()=>{
  test('source excludes private/recovery/generated data at any depth',()=>{
    for(const p of ['private-docs/notes.md','AGENTS.md','tk','.env.local','.worktrees/x/a.ts','node_modules/a.js','dist/index.html','apps/web/.env','tests/test-results/trace.zip','personal.txt'])expect(sourcePath(p),p).toBe(false);
    for(const p of ['apps/web/src/actor-tools/main.ts','tests/fixtures/actor-projects/empty.project.json','LICENSE','scripts/stage-pages.mjs','.github/workflows/pages.yml','docs/images/character.png'])expect(sourcePath(p),p).toBe(true);
  });
  test('Pages accepts only deliberate served content',()=>{
    for(const p of ['README.md','package-lock.json','test-results/a.png','runtime/secret.txt','assets/source.js.map','runtime/types/unknown/src/x.d.ts','downloads/project.actorproject'])expect(sitePath(p),p).toBe(false);
    for(const p of ['index.html','downloads/Actor Animator.html','runtime/core.js','runtime/types/runtime/src/index.d.ts','rendering-example/package/webgl2.js'])expect(sitePath(p),p).toBe(true);
  });
  test('machine paths and credential values are detected without echoing values',()=>{
    const secret='gh'+'p_'+'a'.repeat(36);
    expect(inspectText(secret,'sample')[0]).not.toContain(secret);
    expect(inspectText('/'+'home/someone/project','sample')).toHaveLength(1);
    expect(inspectText('https://github.com/pink-kitsune-420/2d-actor-animator','sample')).toEqual([]);
  });
});
