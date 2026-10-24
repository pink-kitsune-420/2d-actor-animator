import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as binding from '@actor-animator/runtime';
import { runConformance } from './runner.mjs';
const manifestText = readFileSync(new URL('manifest.json', import.meta.url), 'utf8');
const manifest = JSON.parse(manifestText);
const files = Object.fromEntries(readdirSync(new URL('fixtures/', import.meta.url)).sort().map(name => [name, readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8')]));
const report = runConformance(binding, manifest, files);
// Negative controls prove the consumer detects wrong math, canonical bytes,
// discrete channels and diagnostic expectations without rewriting the oracle.
const controls = [
  ['math', 'geometry-rest', entry => { entry.samples[0].expect.slots[0].worldMatrices[4] = 7; }],
  ['canonical', 'preserve-canonical-values', () => {}],
  ['discrete', 'discrete-first-hold-exact-tie', entry => { entry.samples[0].expect.slots[0].visible = 1; }],
  ['diagnostic', 'unknown-required', entry => { entry.expect.diagnostic.code = 'reference'; }],
];
report.negativeControls = controls.map(([id, caseId, change]) => {
  const altered = structuredClone(manifest), entry = altered.cases.find(c => c.id === caseId); change(entry);
  const alteredFiles = {...files}; if (id === 'canonical') alteredFiles[entry.canonical] += '\n';
  const result = runConformance(binding, altered, alteredFiles);
  return {id, status:result.failed === 1 && result.cases.find(c => c.id === caseId).status === 'failed' ? 'passed' : 'failed'};
});
const installed = JSON.parse(readFileSync(new URL('./node_modules/@actor-animator/runtime/package.json', import.meta.url), 'utf8'));
report.environment = {node:process.version, platform:process.platform, arch:process.arch, package:installed.name, version:installed.version,
  compiler:binding.compileActorProject(JSON.parse(files['empty.actorproject'])).compilerVersion};
report.limits = binding.DEFAULT_ACTOR_PROJECT_LIMITS;
report.inputs = Object.entries({'manifest.json':manifestText, 'runner.mjs':readFileSync(new URL('runner.mjs', import.meta.url), 'utf8'), ...files}).map(([file, text]) => ({file, sha256:createHash('sha256').update(text).digest('hex')}));
console.log(JSON.stringify(report, null, 2));
if (report.failed || report.negativeControls.some(c => c.status !== 'passed')) process.exitCode = 1;
