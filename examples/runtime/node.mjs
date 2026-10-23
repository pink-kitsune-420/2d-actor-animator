import { compileActorProject, createActorPose, evaluateActorPose, openActorProject, saveActorProject } from '@actor-animator/runtime';
import { createActors } from './actors.mjs';
const { creature, marker } = createActors();
const saved = saveActorProject(creature);
const opened = openActorProject(saved);
if (!opened.ok) throw new Error(JSON.stringify(opened.diagnostics));
const compiled = compileActorProject(opened.source);
const a = createActorPose(compiled), b = createActorPose(compiled);
evaluateActorPose(compiled, 'demo:orbit', 0.5, a);
evaluateActorPose(compiled, 'demo:orbit', 1.5, b);
const tip = compiled.slots.findIndex(s => s.id === 'demo:tip');
const position = pose => Array.from(pose.worldMatrices.slice(tip * 6 + 4, tip * 6 + 6));
const zero = compileActorProject(marker), zeroPose = createActorPose(zero);
evaluateActorPose(zero, 'demo:rise', 0.5, zeroPose);
console.log(JSON.stringify({ sourceRoundTrip: saveActorProject(opened.source) === saved,
  units: creature.units, tipAtHalfSecond: position(a), tipAtOneAndHalfSeconds: position(b),
  independentBuffers: a.worldMatrices !== b.worldMatrices, zeroBoneY: zeroPose.worldMatrices[5],
  compiledNumericBytes: compiled.numericBytes,
  poseNumericBytes: Object.values(a).reduce((n, buffer) => n + buffer.byteLength, 0),
}, null, 2));
