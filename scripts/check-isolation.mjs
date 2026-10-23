import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, extname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const files = dir => readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);
const problems = [];
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
if (Object.keys(manifest.dependencies ?? {}).length) problems.push('Unexpected runtime dependencies.');
for (const path of [...files('apps'), ...files('packages'), ...files('examples')].filter(p => extname(p) === '.ts')) {
  const source = readFileSync(resolve(root, path), 'utf8');
  // Match module declarations, including multiline type imports, rather than
  // words such as "from" inside template strings and transition field names.
  const declarations = /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:\{[^;]*?\}|\*[^;]*?|[\w$]+(?:\s*,\s*\{[^;]*?\})?)\s+from\s*['"]([^'"]+)['"]/g;
  const sideEffects = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
  const dynamicLiterals = /\bimport\s*\(\s*['"]([^'"]+)['"]/g;
  const specifiers = [declarations, sideEffects, dynamicLiterals].flatMap(pattern => [...source.matchAll(pattern)].map(m => m[1]));
  for (const specifier of specifiers) {
    if (specifier.startsWith('@space-sim/') || /(?:sim-core|game-runtime|render-2d)/.test(specifier)) problems.push(`${path}: game import ${specifier}`);
    if (specifier.startsWith('.') && !resolve(root, dirname(path), specifier).startsWith(root)) problems.push(`${path}: import escapes repository`);
    if (isAbsolute(specifier)) problems.push(`${path}: absolute host import`);
    if (!specifier.startsWith('.') && specifier !== '@actor-animator/types') problems.push(`${path}: undeclared runtime import ${specifier}`);
  }
  if (/\b(?:stepWorld|stepPhysics|stepAvatars|fixedUpdate)\s*\(/.test(source)) problems.push(`${path}: world stepping call`);
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log('PASS: editor/core/types/examples stay inside the standalone repository; no game imports, world stepping or runtime dependencies.');
