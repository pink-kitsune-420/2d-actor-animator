import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
// Compile the actual editor into one classic script: file:// pages cannot rely
// on cross-file ES module loading. Keep the served build/runtime independent.
const result = await build({
  configFile: false, root, publicDir: false, logLevel: 'warn',
  resolve: { alias: { '@actor-animator/types': resolve(root, 'packages/project-types/src/index.ts') } },
  build: {
    target: 'es2022', write: false, emptyOutDir: false, sourcemap: false,
    cssCodeSplit: false, assetsInlineLimit: () => true,
    lib: { entry: resolve(root, 'apps/web/src/actor-tools/main.ts'), name: 'ActorAnimator', formats: ['iife'] },
  },
});
const outputs = Array.isArray(result) ? result : [result];
assert.equal(outputs.length, 1);
assert.ok('output' in outputs[0]);
const chunks = outputs[0].output.filter(item => item.type === 'chunk');
assert.equal(chunks.length, 1, 'Standalone editor must contain exactly one script');
const script = chunks[0];
assert.deepEqual(script.imports, []);
assert.deepEqual(script.dynamicImports, []);
assert.equal(script.viteMetadata.importedAssets.size, 0);
const assets = outputs[0].output.filter(item => item.type === 'asset');
assert.ok(assets.length > 0 && assets.every(item => item.fileName.endsWith('.css')), 'Unexpected external standalone asset');
const css = assets.map(item => typeof item.source === 'string' ? item.source : new TextDecoder().decode(item.source)).join('\n');
const escapeText = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const html = readFileSync(resolve(root, 'apps/standalone/index.html'), 'utf8')
  .replace('/* ACTOR_STYLES */', () => css.replace(/<\/style/gi, '<\\/style'))
  .replace('ACTOR_LICENSE', () => escapeText(readFileSync(resolve(root, 'LICENSE'), 'utf8')))
  .replace('ACTOR_CREDITS', () => escapeText(readFileSync(resolve(root, 'CREDITS.md'), 'utf8')))
  .replace('/* ACTOR_SCRIPT */', () => script.code.replace(/<\/script/gi, '<\\/script'));
assert.equal(/<script\b[^>]*\bsrc\s*=|<link\b[^>]*\b(?:href|rel)\s*=|sourceMappingURL/.test(html), false, 'Standalone HTML must not load companion resources');
mkdirSync(resolve(root, 'dist'), { recursive: true });
writeFileSync(resolve(root, 'dist/Actor Animator.html'), html);
console.log(`Built dist/Actor Animator.html (${Buffer.byteLength(html)} bytes); double-click to open offline.`);
