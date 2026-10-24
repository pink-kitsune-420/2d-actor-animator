import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('..', import.meta.url));
const out = resolve(root, 'dist/runtime');
rmSync(out, { recursive: true, force: true });
const run = args => execFileSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
run(['node_modules/typescript/bin/tsc', '-p', 'tsconfig.runtime.json']);
run(['node_modules/typescript/bin/tsc', '-p', 'tsconfig.renderers.json']);
run(['node_modules/vite/bin/vite.js', 'build', '--config', 'vite.runtime.config.ts']);

// Native NodeNext declarations need explicit relative .js specifiers and no
// workspace-only type aliases. JS remains one self-contained ESM bundle.
function rewrite(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, e.name);
    if (e.isDirectory()) rewrite(path);
    else if (path.endsWith('.d.ts')) {
      const text = readFileSync(path, 'utf8').replace(/(\bfrom\s*|\bimport\s*\()(['"])([^'"]+)\2/g, (_m, prefix, quote, spec) => {
        const target = spec === '@actor-animator/types'
          ? relative(dirname(path), resolve(out, 'types/project-types/src/index')).replaceAll('\\', '/') : spec;
        if (!target.startsWith('.')) throw new Error(`External declaration import: ${target}`);
        return `${prefix}${quote}${target}.js${quote}`;
      });
      writeFileSync(path, text);
    }
  }
}
rewrite(resolve(out, 'types'));
for (const [src, dest] of [
  ['packages/runtime/package.json', 'package.json'], ['docs/runtime.md', 'README.md'],
  ['docs/actor-project.md', 'ACTOR-PROJECT.md'], ['LICENSE', 'LICENSE'],
  ['docs/spacelab.md', 'SPACELAB.md'], ['docs/rendering.md', 'RENDERING.md'],
  ['CREDITS.md', 'CREDITS.md'], ['UPSTREAM.json', 'UPSTREAM.json'],
]) cpSync(resolve(root, src), resolve(out, dest));
// Keep documentation links usable both in the source tree and installed archive.
const readme = resolve(out, 'README.md');
writeFileSync(readme, readFileSync(readme, 'utf8').replace('(actor-project.md)', '(ACTOR-PROJECT.md)').replace('(spacelab.md)', '(SPACELAB.md)').replace('(rendering.md)', '(RENDERING.md)'));
const profileDoc = resolve(out, 'SPACELAB.md');
writeFileSync(profileDoc, readFileSync(profileDoc, 'utf8').replace('(actor-project.md)', '(ACTOR-PROJECT.md)').replace('(runtime.md)', '(README.md)'));
const demo = resolve(root, 'dist/runtime-example');
rmSync(demo, { recursive: true, force: true });
mkdirSync(demo, { recursive: true });
for (const name of ['index.html', 'browser.mjs', 'actors.mjs']) cpSync(resolve(root, 'examples/runtime', name), resolve(demo, name));
console.log('Built private local runtime package and native browser example.');
const profileDemo = resolve(root, 'dist/spacelab-example');
rmSync(profileDemo, { recursive: true, force: true });
cpSync(resolve(root, 'examples/spacelab'), profileDemo, { recursive: true });
cpSync(out, resolve(profileDemo, 'package'), { recursive: true });
cpSync(resolve(root, 'apps/web/src/actor-tools/classic-astronaut.project.json'), resolve(profileDemo, 'character.actorproject'));
// Original built-runtime example data, serialized without source-path imports.
const { createActors } = await import('../examples/runtime/actors.mjs');
writeFileSync(resolve(profileDemo, 'nonhuman.actorproject'), JSON.stringify(createActors().creature, null, 2) + '\n');
// Independent PNG + metadata consumer, with no private implementation imports.
cpSync(resolve(root, 'examples/sheet'), resolve(root, 'dist/sheet-example'), { recursive: true });

// Standalone bridge consumer. check-runtime replaces this with a fresh archive install.
cpSync(resolve(root, 'examples/rendering'), resolve(root, 'dist/rendering-example'), { recursive: true });
cpSync(out, resolve(root, 'dist/rendering-example/package'), { recursive: true });
for (const name of ['character.actorproject', 'nonhuman.actorproject']) cpSync(resolve(profileDemo, name), resolve(root, 'dist/rendering-example', name));
cpSync(resolve(root, 'examples/spacelab/beacon.actorproject'), resolve(root, 'dist/rendering-example/zero-bone.actorproject'));
