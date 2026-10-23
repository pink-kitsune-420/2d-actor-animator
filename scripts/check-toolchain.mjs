import { readFileSync, realpathSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const problems = [];
if (lstatSync(resolve(root, 'node_modules')).isSymbolicLink() || !realpathSync(resolve(root, 'node_modules')).startsWith(root)) problems.push('node_modules must belong to this independent checkout.');
const versions = {};
for (const [name, expected] of Object.entries(manifest.devDependencies)) {
  const actual = JSON.parse(readFileSync(resolve(root, 'node_modules', name, 'package.json'), 'utf8')).version;
  versions[name] = actual;
  if (actual !== expected || lock.packages[`node_modules/${name}`]?.version !== expected) problems.push(`${name}: manifest/lock/installed version mismatch (${expected}/${actual})`);
}
for (const name of ['playwright', 'playwright-core']) {
  const actual = JSON.parse(readFileSync(resolve(root, 'node_modules', name, 'package.json'), 'utf8')).version;
  versions[name] = actual;
  if (actual !== manifest.devDependencies['@playwright/test']) problems.push(`${name}: browser runner closure mismatch`);
}
console.log(JSON.stringify({ node: process.version, versions }, null, 2));
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log('PASS: isolated installed toolchain matches exact manifest/lock versions.');
