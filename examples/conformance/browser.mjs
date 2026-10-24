import * as binding from './package/runtime.js';
import { runConformance } from './runner.mjs';
try {
  const read = async path => { const response = await fetch(path); if (!response.ok) throw Error(`Fixture load failed: ${path}`); return response.text(); };
  const manifest = JSON.parse(await read('./manifest.json'));
  const names = [...new Set(manifest.cases.flatMap(c => [c.fixture, ...(c.canonical ? [c.canonical] : [])]))];
  const files = Object.fromEntries(await Promise.all(names.map(async name => [name, await read(`./fixtures/${name}`)])));
  const report = runConformance(binding, manifest, files);
  document.querySelector('#report').textContent = JSON.stringify(report, null, 2);
  document.querySelector('#status').textContent = `${report.failed ? 'FAILED' : 'Passed'}: ${report.passed}/${manifest.cases.length} semantic cases, ${report.failed} failures`;
} catch (error) { document.querySelector('#status').textContent = `FAILED: ${error.message}`; }
