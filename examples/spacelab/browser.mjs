// Original MIT consumer. Imports only installed archive output, never source.
import { SPACELAB_ACTOR_SOURCE_PROFILE as profile, inspectSpaceLabActorSource, exportSpaceLabActorSource } from './package/spacelab.js';
import { compileActorProject, createActorPose, evaluateActorPose } from './package/runtime.js';
const $ = id => document.getElementById(id);
const canvas = document.querySelector('canvas'), ctx = canvas.getContext('2d');
const options = { profile: profile.id }, urls = new Set();
let epoch = 0, disposed = false, accepted = null;
function invalidate() {
  epoch++; accepted = null; $('download').disabled = true;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  $('report').textContent = ''; $('result').textContent = 'Source changed; inspect to accept a new standalone sample.';
}
function sample() {
  if (!accepted) return;
  const { compiled, pose, peer } = accepted, time = Number($('time').value);
  try {
    evaluateActorPose(compiled, $('clip').value || null, time, pose);
    evaluateActorPose(compiled, null, 0, peer);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Explicit view units keep image/pivot conversion separate from framing.
    const zoom = Number($('zoom').value), ox = Number($('origin-x').value), oy = Number($('origin-y').value);
    if (!Number.isFinite(zoom) || zoom <= 0 || zoom > 512 || !Number.isFinite(ox) || !Number.isFinite(oy)) throw Error('Use finite view origins and pixels per unit in (0,512].');
    ctx.save(); ctx.translate(ox, oy); ctx.scale(zoom, -zoom);
    for (const slot of pose.drawSequence) {
      if (!pose.visible[slot]) continue;
      const part = compiled.parts[pose.partIndices[slot]], art = part.artwork, u = part.unitsPerPixel;
      ctx.save(); ctx.transform(...pose.worldMatrices.subarray(slot*6, slot*6+6));
      for (const layer of art.layers) {
        ctx.globalAlpha = layer.opacity;
        for (let pixel = 0; pixel < layer.pixels.length; pixel++) {
          ctx.fillStyle = art.palette[layer.pixels[pixel]];
          ctx.fillRect((pixel % art.width)*u-part.pivot[0], (art.height-1-Math.floor(pixel/art.width))*u-part.pivot[1], u, u);
        }
      }
      ctx.restore();
    }
    ctx.restore();
    $('report').textContent = JSON.stringify({ ...accepted.report, measurements: accepted.measurements,
      sampleSeconds: time, independentBuffers: pose.worldMatrices !== peer.worldMatrices,
      attachmentMatrices: Array.from(pose.drawSequence, slot => Array.from(pose.worldMatrices.subarray(slot*6, slot*6+6))),
      visible: Array.from(pose.drawSequence, slot => pose.visible[slot]),
      parts: Array.from(pose.drawSequence, slot => compiled.parts[pose.partIndices[slot]].id),
    }, null, 2);
  } catch (error) { $('result').textContent = error.message; }
}
function inspect() {
  const text = $('source').value, start = performance.now(), result = inspectSpaceLabActorSource(text, options), inspected = performance.now();
  accepted = null; $('download').disabled = true;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!result.ok) { $('result').textContent = JSON.stringify(result.diagnostics); $('report').textContent = ''; return; }
  const compiled = compileActorProject(result.source), pose = createActorPose(compiled), peer = createActorPose(compiled), end = performance.now();
  accepted = { compiled, pose, peer, report: result.report, measurements: {
    utf8Bytes: new TextEncoder().encode(text).byteLength, parts: result.source.parts.length, rigs: result.source.rigs.length,
    clips: result.source.clips.length, inspectMs: inspected-start, compileAndInstancesMs: end-inspected, compiledNumericBytes: compiled.numericBytes,
    poseNumericBytes: Object.values(pose).reduce((sum, a) => sum + a.byteLength, 0),
  } };
  $('clip').replaceChildren(new Option('Rest (no clip)', ''), ...compiled.clipIds.map(id => new Option(id, id)));
  $('download').disabled = false; $('result').textContent = 'Accepted by historical source profile. Live game support unverified.';
  sample();
}
async function load(read) {
  invalidate(); const captured = epoch;
  try {
    const text = await read();
    if (disposed || captured !== epoch) return;
    $('source').value = text; inspect();
  } catch (error) { if (!disposed && captured === epoch) $('result').textContent = error.message; }
}
function example() {
  const file = $('example').value;
  const character = file === 'character.actorproject';
  $('zoom').value = character ? '128' : '40'; $('origin-x').value = character ? '240' : '80'; $('origin-y').value = character ? '270' : '160';
  return load(async () => { const r = await fetch(`./${file}`); if (!r.ok) throw Error('Example unavailable'); return r.text(); });
}
$('source').addEventListener('input', invalidate);
$('inspect').addEventListener('click', () => { epoch++; inspect(); });
$('example').addEventListener('change', example);
$('file').addEventListener('change', () => {
  const file = $('file').files[0]; if (!file) return;
  void load(() => { if (file.size > profile.limits.maxJsonBytes) throw Error('File exceeds profile byte limit'); return file.text(); });
});
for (const id of ['clip', 'time', 'zoom', 'origin-x', 'origin-y']) $(id).addEventListener('input', sample);
$('download').addEventListener('click', () => {
  const result = exportSpaceLabActorSource($('source').value, options);
  if (!result.ok) { invalidate(); $('result').textContent = JSON.stringify(result.diagnostics); return; }
  const url = URL.createObjectURL(new Blob([result.text], { type: 'application/json;charset=utf-8' })); urls.add(url);
  const link = document.createElement('a'); link.href = url; link.download = 'original.actorproject'; link.click();
  setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, 1000);
});
addEventListener('pagehide', () => { disposed = true; invalidate(); for (const url of urls) URL.revokeObjectURL(url); urls.clear(); });
void example();
