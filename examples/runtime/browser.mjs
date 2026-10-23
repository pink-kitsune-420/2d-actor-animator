import { compileActorProject, createActorPose, evaluateActorPose } from '../runtime/runtime.js';
import { createActors } from './actors.mjs';
const { creature, marker } = createActors();
const compiled = compileActorProject(creature), zero = compileActorProject(marker);
const a = createActorPose(compiled), b = createActorPose(compiled), lamp = createActorPose(zero);
const canvas = document.querySelector('canvas'), ctx = canvas.getContext('2d');
const inputs = ['a', 'b'].map(id => document.querySelector(`#time-${id}`));
function drawActor(actor, pose, x, label) {
  ctx.save(); ctx.translate(x, 230); ctx.scale(35, -35); ctx.lineWidth = 0.045;
  for (let i = 0; i < actor.slots.length; i++) {
    const slot = actor.slots[i], m = pose.worldMatrices.subarray(i * 6, i * 6 + 6);
    if (slot.kind !== 'node') continue;
    ctx.strokeStyle = '#317b94';
    if (slot.parent >= 0) {
      const p = slot.parent * 6;
      ctx.beginPath(); ctx.moveTo(pose.worldMatrices[p + 4], pose.worldMatrices[p + 5]); ctx.lineTo(m[4], m[5]); ctx.stroke();
    }
    ctx.fillStyle = '#173343'; ctx.beginPath(); ctx.arc(m[4], m[5], 0.09, 0, Math.PI * 2); ctx.fill();
  }
  for (const slot of pose.drawSequence) {
    if (!pose.visible[slot]) continue;
    const part = actor.parts[pose.partIndices[slot]], art = part.artwork, unit = part.unitsPerPixel;
    ctx.save(); ctx.transform(...pose.worldMatrices.subarray(slot * 6, slot * 6 + 6));
    for (const layer of art.layers) {
      ctx.globalAlpha = layer.opacity;
      layer.pixels.forEach((index, pixel) => {
        ctx.fillStyle = art.palette[index];
        ctx.fillRect((pixel % art.width) * unit - part.pivot[0], (art.height - 1 - Math.floor(pixel / art.width)) * unit - part.pivot[1], unit, unit);
      });
    }
    ctx.restore();
  }
  ctx.restore(); ctx.fillStyle = '#173343'; ctx.font = '18px system-ui'; ctx.fillText(label, x - 40, 290);
}
function render() {
  const times = inputs.map(input => Number(input.value));
  evaluateActorPose(compiled, 'demo:orbit', times[0], a); evaluateActorPose(compiled, 'demo:orbit', times[1], b);
  evaluateActorPose(zero, 'demo:rise', 0.5, lamp);
  document.querySelector('#value-a').textContent = times[0].toFixed(2);
  document.querySelector('#value-b').textContent = times[1].toFixed(2);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawActor(compiled, a, 130, 'Actor A'); drawActor(compiled, b, 460, 'Actor B'); drawActor(zero, lamp, 760, 'Zero bones');
  const tip = compiled.slots.findIndex(s => s.id === 'demo:tip') * 6;
  // Plain visible diagnostic snapshot for this example, not a runtime API.
  document.querySelector('#status').textContent = JSON.stringify({
    a: Array.from(a.worldMatrices.slice(tip + 4, tip + 6)),
    b: Array.from(b.worldMatrices.slice(tip + 4, tip + 6)), zeroBoneY: lamp.worldMatrices[5],
    independentBuffers: a.worldMatrices !== b.worldMatrices,
  }, null, 2);
}
for (const input of inputs) input.addEventListener('input', render);
render();
