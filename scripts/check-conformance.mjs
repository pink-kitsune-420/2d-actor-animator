// Fresh archive consumer: no workspace source imports, aliases or linked dependencies.
import { execFileSync } from 'node:child_process';
import { cpSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('..', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'actor-contract-consumer-'));
const run = (bin, args) => execFileSync(bin, args, {cwd:scratch, encoding:'utf8', maxBuffer:2*1024*1024});
try {
  const [archive] = JSON.parse(run('npm', ['pack', resolve(root,'dist/runtime'), '--ignore-scripts', '--json', '--pack-destination', scratch]));
  cpSync(resolve(root,'tests/conformance'), scratch, {recursive:true});
  writeFileSync(join(scratch,'package.json'), JSON.stringify({private:true,type:'module'}));
  run('npm', ['install','--offline','--ignore-scripts','--no-audit','--no-fund','--package-lock=false',join(scratch,archive.filename)]);
  const installed = join(scratch,'node_modules/@actor-animator/runtime');
  assert.equal(lstatSync(installed).isSymbolicLink(),false); assert.ok(realpathSync(installed).startsWith(scratch));
  for (const file of archive.files) assert.ok(readFileSync(join(installed,file.path)).equals(readFileSync(resolve(root,'dist/runtime',file.path))),`Archive mismatch: ${file.path}`);
  let output;
  try { output = run(process.execPath,['node.mjs']); }
  catch (error) { output = error.stdout; if (!output) throw error; }
  const report = JSON.parse(output);
  report.archive = {files:archive.files.length, bytes:archive.size, sha256:createHash('sha256').update(readFileSync(join(scratch,archive.filename))).digest('hex'), freshInstalled:true};
  writeFileSync(resolve(root,'dist/conformance-report.json'),JSON.stringify(report,null,2)+'\n');
  for (const row of report.cases.filter(c => c.status !== 'passed')) console.error(`${row.id}: ${row.message}`);
  assert.equal(report.failed,0,`Conformance failures: ${report.failed}`);
  assert.ok(report.negativeControls.every(c => c.status === 'passed'),'Negative controls failed');
  // Browser tests use the same freshly installed package, including shared brands.
  rmSync(resolve(root,'dist/conformance-example/package'),{recursive:true,force:true});
  cpSync(installed,resolve(root,'dist/conformance-example/package'),{recursive:true});
  console.log(`PASS: Draft 1 ${report.passed} semantic cases, ${report.negativeControls.length} negative controls; ${report.environment.node}; report dist/conformance-report.json. Native rendering is qualified separately.`);
} finally { rmSync(scratch,{recursive:true,force:true}); }
