import assert from 'node:assert/strict';
import { cpSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'actor-runtime-consumer-'));
const demoOnly = process.argv.includes('--demo');
function run(bin, args, options = {}) {
  return execFileSync(bin, args, { cwd: scratch, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, ...options });
}
try {
  const [archive] = JSON.parse(run('npm', ['pack', resolve(root, 'dist/runtime'), '--ignore-scripts', '--json', '--pack-destination', scratch]));
  const allowed = /^(?:package\.json|(?:runtime|spacelab)\.js|README\.md|ACTOR-PROJECT\.md|SPACELAB\.md|LICENSE|CREDITS\.md|UPSTREAM\.json|types\/(?:runtime|actor-tools|project-types|adapters\/spacelab)\/src\/[\w-]+\.d\.ts)$/;
  for (const file of archive.files) {
    assert.match(file.path, allowed, `Unexpected package file ${file.path}`);
    const content = readFileSync(resolve(root, 'dist/runtime', file.path), 'utf8');
    assert.equal(/(?:\/home\/|\/Users\/|[A-Z]:\\Users\\|private-docs|KICKOFF\.txt|AGENTS\.md|space-sim\/)/.test(content), false, `Private path/context in ${file.path}`);
    if (file.path.endsWith('.d.ts')) assert.equal(/@actor-animator\/types|\b(?:HTMLElement|HTMLCanvasElement|Document|Window)\b/.test(content), false, `Nonportable declaration in ${file.path}`);
  }
  for (const name of ['runtime', 'spacelab']) {
    const bundle = readFileSync(resolve(root, `dist/runtime/${name}.js`), 'utf8');
    assert.equal(/\b(?:document|window|localStorage)\.|^\s*import\s|\bimport\s*\(|@space-sim\/|actor-tools\/main/m.test(bundle), false, `${name} must be self-contained and DOM/game free`);
  }
  const manifest = JSON.parse(readFileSync(resolve(root, 'dist/runtime/package.json'), 'utf8'));
  assert.equal(manifest.private, true);
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'scripts']) assert.equal(Object.keys(manifest[field] ?? {}).length, 0);
  assert.deepEqual(Object.keys(manifest.exports), ['.', './spacelab']);
  writeFileSync(join(scratch, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', join(scratch, archive.filename)]);
  const installed = join(scratch, 'node_modules/@actor-animator/runtime');
  assert.equal(lstatSync(installed).isSymbolicLink(), false);
  assert.ok(realpathSync(installed).startsWith(scratch));
  for (const file of archive.files) {
    assert.equal(readFileSync(join(installed, file.path)).equals(readFileSync(resolve(root, 'dist/runtime', file.path))), true, `Archive changed ${file.path}`);
  }
  for (const file of ['actors.mjs', 'node.mjs']) cpSync(resolve(root, 'examples/runtime', file), join(scratch, file));
  if (!demoOnly) {
    for (const file of ['consumer.mjs', 'consumer.ts', 'spacelab-consumer.mjs']) cpSync(resolve(root, 'tests/runtime', file), join(scratch, file));
    cpSync(resolve(root, 'examples/spacelab/beacon.actorproject'), join(scratch, 'beacon.actorproject'));
    cpSync(resolve(root, 'tests/fixtures/actor-projects'), join(scratch, 'fixtures'), { recursive: true });
    writeFileSync(join(scratch, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
      target: 'ES2022', lib: ['ES2022'], types: [], module: 'NodeNext', moduleResolution: 'NodeNext',
      strict: true, skipLibCheck: false, noEmit: true,
    }, include: ['consumer.ts'] }));
    run(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', join(scratch, 'tsconfig.json')], { stdio: 'inherit' });
    run(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', join(scratch, 'tsconfig.json'), '--module', 'ESNext', '--moduleResolution', 'Bundler'], { stdio: 'inherit' });
    run(process.execPath, ['--test', 'consumer.mjs'], { stdio: 'inherit' });
    run(process.execPath, ['--test', 'spacelab-consumer.mjs'], { stdio: 'inherit' });
    // Production browser consumer must exercise the freshly installed archive.
    cpSync(installed, resolve(root, 'dist/spacelab-example/package'), { recursive: true });
  }
  run(process.execPath, ['node.mjs'], { stdio: 'inherit' });
  console.log(JSON.stringify({ package: archive.name, version: archive.version, files: archive.files.length,
    archiveBytes: archive.size, unpackedBytes: archive.unpackedSize,
    sha256: createHash('sha256').update(readFileSync(join(scratch, archive.filename))).digest('hex'),
    freshInstalledConsumer: 'passed', declarationsWithoutDOM: demoOnly ? 'not run' : 'passed',
  }, null, 2));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
