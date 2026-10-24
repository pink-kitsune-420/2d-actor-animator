// Original MIT semantic consumer. No implementation/deep imports and no oracle generation.
// Host supplies the selected public JS binding and immutable fixture texts.
function insist(ok, message) { if (!ok) throw new Error(message); }
function same(actual, expected, path, tolerance, numeric = false) {
  if (numeric && expected === 'NaN') { insist(Number.isNaN(actual), `${path}: expected NaN`); return; }
  if (typeof expected === 'number' && numeric) {
    insist(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance.absolute + tolerance.relative * Math.abs(expected), `${path}: ${actual} != ${expected}`); return;
  }
  if (Array.isArray(expected)) {
    insist(actual != null && actual.length === expected.length, `${path}: array length`);
    expected.forEach((value, i) => same(actual[i], value, `${path}/${i}`, tolerance, numeric)); return;
  }
  if (expected !== null && typeof expected === 'object') {
    insist(actual !== null && typeof actual === 'object', `${path}: expected object`);
    for (const [key, value] of Object.entries(expected)) same(actual[key], value, `${path}/${key}`, tolerance, numeric);
    return;
  }
  insist(Object.is(actual, expected), `${path}: ${String(actual)} != ${String(expected)}`);
}
function throws(fn, name) {
  let error; try { fn(); } catch (caught) { error = caught; }
  insist(error?.name === name, `Expected ${name}, got ${error?.name ?? 'success'}`);
  return error;
}
function patched(source, patch = []) {
  const copy = structuredClone(source);
  for (const [keys, value] of patch) {
    insist(keys.length > 0, 'Empty fixture patch path');
    let at = copy;
    for (const key of keys.slice(0, -1)) { insist(Object.hasOwn(at, key), `Missing patch parent ${key}`); at = at[key]; }
    at[keys.at(-1)] = structuredClone(value);
  }
  return copy;
}
const numericFields = new Set(['localTRS', 'localMatrices', 'worldMatrices']);
function poseMatches(c, p, expected, tolerance) {
  insist(Object.keys(expected).every(k => ['slotCount','draw','residuals','slots'].includes(k)), 'Unknown pose expectation');
  if (Object.hasOwn(expected, 'slotCount')) same(c.slots.length, expected.slotCount, 'slotCount', tolerance);
  if (expected.draw) same(Array.from(p.drawSequence, i => c.slots[i].id), expected.draw, 'draw', tolerance);
  if (expected.residuals) same(p.constraintResiduals, expected.residuals, 'residuals', tolerance, true);
  for (const item of expected.slots ?? []) {
    const i = c.slots.findIndex(s => s.kind === item.kind && s.id === item.id && s.rigId === item.rigId);
    insist(i >= 0, `Missing ${item.kind} ${item.rigId ?? ''}/${item.id}`);
    for (const [field, value] of Object.entries(item)) {
      if (['kind','rigId','id'].includes(field)) continue;
      if (numericFields.has(field)) {
        const width = field === 'localTRS' ? 5 : 6;
        same(p[field].subarray(i * width, (i + 1) * width), value, `${item.id}/${field}`, tolerance, true);
      } else {
        insist(['part','drawOrder','visible','localVisible'].includes(field), `Unknown slot expectation ${field}`);
        const actual = field === 'part' ? c.parts[p.partIndices[i]]?.id ?? null : field === 'drawOrder' ? p.drawOrders[i] : p[field]?.[i];
        same(actual, value, `${item.id}/${field}`, tolerance);
      }
    }
  }
}
// Exact accepted JSON-value comparison, including -0 and every object key.
function exactJSON(a, b) {
  if (a !== null && typeof a === 'object') {
    insist(b !== null && typeof b === 'object' && Array.isArray(a) === Array.isArray(b), 'Source shape changed');
    const keys = Object.keys(a).sort(); same(Object.keys(b).sort(), keys, 'source keys', {});
    for (const key of keys) exactJSON(a[key], b[key]);
  } else insist(Object.is(a, b), 'Source value changed');
}
function lifecycle(r, source) {
  const before = structuredClone(source), c = r.compileActorProject(source), p = r.createActorPose(c), other = r.createActorPose(c);
  const refs = Object.fromEntries(Object.entries(p));
  const otherBefore = Object.fromEntries(Object.entries(other).map(([k,v]) => [k, Array.from(v)]));
  const sameCompile = r.compileActorProject(source);
  insist(c.identity === sameCompile.identity && c !== sameCompile, 'Compile identity/instance separation');
  throws(() => r.evaluateActorPose(sameCompile, null, 0, p), 'TypeError');
  throws(() => r.evaluateActorPose(c, null, 0, {...p}), 'TypeError');
  throws(() => r.createActorPose({...c}), 'TypeError');
  for (let i = 0; i < 32; i++) r.evaluateActorPose(c, 'contract:once', i / 16, p);
  for (const [key, ref] of Object.entries(refs)) {
    insist(p[key] === ref && other[key] !== ref, `Buffer lifetime ${key}`);
    same(Array.from(other[key]), otherBefore[key], `independent ${key}`, {});
  }
  const complete = Object.fromEntries(Object.entries(p).map(([k,v]) => [k, Array.from(v)]));
  throws(() => r.evaluateActorPose(c, 'future:missing', 0, p), 'RangeError');
  throws(() => r.evaluateActorPose(c, null, NaN, p), 'RangeError');
  for (const key of Object.keys(p)) same(Array.from(p[key]), complete[key], `rejected ${key}`, {});
  throws(() => r.validateActorProject(source, {unknownLimit:1}), 'RangeError');
  throws(() => r.createActorAnimationPlayer(c, 'future:animator'), 'RangeError');
  const nonfinite = structuredClone(source); nonfinite.units.metresPerUnit = Infinity;
  insist(!r.validateActorProject(nonfinite).ok, 'Nonfinite structured input admitted');
  const originalIdentity = c.identity;
  source.parts[0].revision++; source.parts[0].artwork.palette[0] = '#00ff00ff';
  insist(c.parts[0].revision === before.parts[0].revision, 'Compile is detached');
  insist(r.compileActorProject(source).identity !== originalIdentity, 'Artwork revision identity');
  exactJSON(source.extensions, before.extensions);
  // Source is local to this case. No lifetime API/clock is invented by this kit.
}
function runCase(r, entry, files, tolerance) {
  const rawText = files[entry.fixture]; insist(typeof rawText === 'string', `Missing fixture ${entry.fixture}`);
  const source = patched(JSON.parse(rawText), entry.patch), before = structuredClone(source);
  if (entry.kind === 'admission') {
    const text = entry.text ?? (entry.patch?.length ? JSON.stringify(source) : rawText);
    const opened = r.openActorProject(text, entry.limits);
    same(opened.ok, entry.expect.ok, 'admission', tolerance);
    if (!opened.ok) {
      same(opened.diagnostics[0], entry.expect.diagnostic, 'diagnostic', tolerance);
      if (entry.text === undefined && entry.limits?.maxJsonBytes === undefined) {
        same(r.validateActorProject(source, entry.limits), {ok:false, diagnostics:[entry.expect.diagnostic]}, 'structured admission', tolerance);
        const error = throws(() => r.compileActorProject(source, entry.limits), 'ActorProjectError');
        same(error.diagnostic, entry.expect.diagnostic, 'compile diagnostic', tolerance);
      }
    } else {
      const canonical = r.saveActorProject(opened.source);
      if (entry.canonical) same(canonical, files[entry.canonical], 'canonical bytes', tolerance);
      exactJSON(source, opened.source);
      exactJSON(opened.source, r.openActorProject(canonical).source);
      exactJSON(source, before);
      opened.source.name = 'detached admission'; insist(source.name === before.name, 'Admission aliases input');
    }
    exactJSON(source, before); return;
  }
  if (entry.kind === 'emote') {
    const admitted = r.validateActorProject(source); insist(admitted.ok, 'Emote admission failed');
    const emote = source.emotes.find(e => e.id === entry.emote), buffer = new Float64Array(2);
    for (const sample of entry.samples) { r.sampleActorEmoteTime(emote, emote.roles[0], sample.time, buffer); same(buffer, sample.expect, 'emote', tolerance, true); }
    for (const other of entry.compatibility ?? []) same(r.actorEmoteCompatibility(source, patched(source, other.patch), entry.emote).code, other.expect, 'compatibility', tolerance);
    throws(() => r.sampleActorEmoteTime(emote, emote.roles[0], NaN, buffer), 'RangeError');
    throws(() => r.sampleActorEmoteTime(emote, emote.roles[0], 0, new Float64Array(1)), 'RangeError');
  } else if (entry.kind === 'lifecycle') lifecycle(r, source);
  else {
    const c = r.compileActorProject(source), p = r.createActorPose(c);
    if (entry.statuses) same(c.constraints.map(s => s.status), entry.statuses, 'constraint statuses', tolerance);
    if (entry.kind === 'pose') for (const sample of entry.samples) {
      r.evaluateActorPose(c, sample.clip, sample.time, p, sample.applyConstraints ?? true); poseMatches(c, p, sample.expect, tolerance);
    } else if (entry.kind === 'animation') {
      const player = r.createActorAnimationPlayer(c, entry.animator, entry.options);
      for (const op of entry.operations) {
        if (op.op === 'request') same(r.requestActorAnimationState(player, op.layer, op.state, op.time), op.expect, 'request', tolerance);
        else if (op.op === 'sample') { r.evaluateActorAnimation(c, player, op.time, p); poseMatches(c, p, op.expect, tolerance); }
        else if (op.op === 'sample-error') throws(() => r.evaluateActorAnimation(c, player, op.time, p), op.expect);
        else if (op.op === 'status') same(r.describeActorAnimation(player, op.time), op.expect, 'status', tolerance);
        else if (op.op === 'trim') r.trimActorAnimationHistory(player);
        else throw new Error(`Unknown animation operation ${op.op}`);
      }
    } else if (entry.kind === 'overflow') {
      throws(() => r.evaluateActorPose(c, 'contract:overflow', 0, p), 'RangeError');
      r.evaluateActorPose(c, null, 0, p);
      poseMatches(c, p, {slots:[{kind:'node',rigId:'contract:rig',id:'contract:child',worldMatrices:[2,0,0,1,0,0]}]}, tolerance);
    } else throw new Error(`Unknown case kind ${entry.kind}`);
  }
  if (entry.kind !== 'lifecycle') exactJSON(source, before);
}
/** All cases run; a failure remains failed and is never relabeled unsupported.
 * This is the JS reference binding runner. Other language bindings consume the
 * same inputs/expectations with their own adapter and must report their scope. */
export function runConformance(binding, manifest, files) {
  insist(manifest.contract === '2D Actor Runtime Contract' && manifest.revision === 'draft-1' && manifest.fixtureRevision === 1, 'Unsupported fixture revision');
  insist(Array.isArray(manifest.cases) && manifest.cases.length > 0, 'Empty conformance manifest');
  const ids = new Set();
  const cases = manifest.cases.map(entry => {
    insist(typeof entry.id === 'string' && !ids.has(entry.id), 'Duplicate/missing case ID'); ids.add(entry.id);
    insist(entry.profiles?.length && entry.profiles.every(p => Object.hasOwn(manifest.profiles, p)), 'Unknown/missing fixture profile');
    try { runCase(binding, entry, files, manifest.tolerance); return {id:entry.id, profiles:entry.profiles, status:'passed'}; }
    catch (error) { return {id:entry.id, profiles:entry.profiles, status:'failed', message:String(error.message ?? error)}; }
  });
  return {contract:manifest.contract, revision:manifest.revision, fixtureRevision:manifest.fixtureRevision, binding:'@actor-animator/runtime ESM 0.1.0',
    passed:cases.filter(c => c.status === 'passed').length, failed:cases.filter(c => c.status === 'failed').length,
    profiles:Object.fromEntries(Object.keys(manifest.profiles).map(profile => { const selected = cases.filter(c => c.profiles.includes(profile)); return [profile,{cases:selected.length,status:selected.length && selected.every(c => c.status === 'passed') ? 'passed' : 'failed'}]; })), cases};
}
