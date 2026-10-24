import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const runtimePath = /^(?:package\.json|(?:runtime|spacelab|canvas2d|webgl2|core|render-resources)\.js|README\.md|ACTOR-PROJECT\.md|SPACELAB\.md|RENDERING\.md|LICENSE|CREDITS\.md|UPSTREAM\.json|types\/(?:runtime|actor-tools|project-types|adapters\/(?:spacelab|canvas2d|webgl2|rendering))\/src\/[\w-]+\.d\.ts)$/;
const rootFiles = new Set(['.gitignore','ARCHITECTURE.md','CREDITS.md','LICENSE','README.md','UPSTREAM.json','CONTRIBUTING.md','SECURITY.md','CHANGELOG.md','package.json','package-lock.json']);
export function sourcePath(path) {
  if (/(^|\/)(?:node_modules|dist|private-docs|\.tickets|\.worktrees|\.git|\.codex|\.agents|\.aws|coverage|test-results|playwright-report|release-artifacts|_site)(?:\/|$)|(?:^|\/)(?:AGENTS\.md|KICKOFF\.txt|tk|\.env(?:\..*)?)$|\.(?:log|trace|tgz|zip|tar|pyc)$/.test(path)) return false;
  return rootFiles.has(path) || /^(?:apps|packages|examples|tests|scripts|docs)\/[\w./ -]+$/.test(path)
    || /^\.(?:github)\/(?:workflows\/[\w-]+\.yml|ISSUE_TEMPLATE\/[\w-]+\.md)$/.test(path)
    || /^(?:tsconfig(?:\.[\w-]+)?\.json|(?:vite(?:\.runtime)?|vitest|playwright(?:\.release)?)\.config\.ts)$/.test(path);
}
export function inspectText(content, path) {
  const problems = [];
  if (/(?:\/home\/[\w.-]+\/|\/Users\/[\w.-]+\/|[A-Z]:\\Users\\)/.test(content)) problems.push(`${path}: machine path`);
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|\bgh[pousr]_[A-Za-z0-9]{30,}|\bAKIA[A-Z0-9]{16}\b/.test(content)) problems.push(`${path}: credential signature (value suppressed)`);
  return problems;
}
export function files(dir, prefix = '') {
  return readdirSync(dir).sort().flatMap(name => {
    const rel = prefix + name, path = join(dir, name), stat = lstatSync(path);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw Error(`Unsupported file type: ${rel}`);
    return stat.isDirectory() ? files(path, rel + '/') : [rel];
  });
}
export function manifest(dir) {
  return files(dir).map(path => { const bytes = readFileSync(join(dir,path)); return {path, bytes:bytes.length, sha256:createHash('sha256').update(bytes).digest('hex')}; });
}
export function sitePath(path) {
  return /^(?:index\.html|actor-tools\.html|\.nojekyll|LICENSE|CREDITS\.md|UPSTREAM\.json|downloads\/2D Actor Animator\.html|assets\/[\w-]+\.(?:js|css)|examples\/beacon\.actorproject|runtime-example\/(?:index\.html|browser\.mjs|actors\.mjs)|sheet-example\/(?:index\.html|browser\.mjs)|spacelab-example\/(?:index\.html|browser\.mjs|(?:beacon|character|nonhuman)\.actorproject)|rendering-example\/(?:index\.html|browser\.mjs|proofs\.mjs|(?:character|nonhuman|zero-bone)\.actorproject))$/.test(path)
    || (path.startsWith('runtime/') && runtimePath.test(path.slice(8)))
    || /^(?:spacelab|rendering)-example\/package\//.test(path) && runtimePath.test(path.replace(/^[^/]+\/package\//,''));
}
