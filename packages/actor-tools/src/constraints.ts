import type { ActorCcdChainSettings } from '@actor-animator/types';
import { CCD_CHAIN_SOLVER } from './project';
import type { ActorConstraintSolver, ActorPose, ActorPoseUpdater } from './evaluator';

/** Vectors shorter than this (project units) give no usable joint angle. */
const DEGENERATE_LENGTH_SQUARED = 1e-24;


/** Built-in visual 2D cyclic coordinate descent. Joints are visited from the
 * one nearest the effector up to the chain root, each rotated so the effector
 * points at the target, clamped to optional joint limits. Joints with a
 * degenerate vector or singular parent frame are skipped. Stops at tolerance or
 * after the fixed iteration budget, keeping the final iterate. Deterministic for
 * identical inputs on one JavaScript engine (Math.atan2/cos/sin precision is
 * implementation-defined across engines). */
const solver: ActorConstraintSolver = {
  id: CCD_CHAIN_SOLVER,
  version: '1',
  prepare(constraint, rig) {
    const settings = constraint.settings as ActorCcdChainSettings;
    const slotOf = (point: ActorCcdChainSettings['effector']) => point.kind === 'node' ? rig.nodeSlot(point.id) : rig.socketSlot(point.id);
    const effector = slotOf(settings.effector), target = slotOf(settings.target), root = rig.nodeSlot(settings.chainRootId);
    const path: number[] = [];
    for (let slot = rig.parentSlot(effector); ; slot = rig.parentSlot(slot)) {
      path.push(slot);
      if (slot === root) break;
    }
    path.reverse();
    const joints = Int32Array.from(path), limits = new Float64Array(joints.length * 2).fill(NaN);
    joints.forEach((slot, k) => { const l = rig.limits(slot); if (l) { limits[k * 2] = l[0]; limits[k * 2 + 1] = l[1]; } });
    const parents = Int32Array.from(joints, slot => rig.parentSlot(slot));
    const iterations = settings.iterations, tolerance = settings.tolerance, m = joints.length;
    return Object.freeze({
      firstSlot: root,
      // Hot loop: plain arithmetic only. Math.hypot and passing doubles to
      // non-inlined helpers allocate (measured), so neither appears here.
      solve(pose: ActorPose, update: ActorPoseUpdater, residualIndex: number): void {
        const w = pose.worldMatrices, trs = pose.localTRS, e = effector * 6;
        const tx = w[target * 6 + 4]!, ty = w[target * 6 + 5]!;
        let dx = w[e + 4]! - tx, dy = w[e + 5]! - ty, residual = Math.sqrt(dx * dx + dy * dy);
        for (let iteration = 0; iteration < iterations && residual > tolerance; iteration++) {
          for (let k = m - 1; k >= 0; k--) {
            const j = joints[k]! * 6, jx = w[j + 4]!, jy = w[j + 5]!;
            const ux = w[e + 4]! - jx, uy = w[e + 5]! - jy, vx = tx - jx, vy = ty - jy;
            if (ux * ux + uy * uy <= DEGENERATE_LENGTH_SQUARED || vx * vx + vy * vy <= DEGENERATE_LENGTH_SQUARED) continue;
            const p = parents[k]! * 6;
            let sign = 1;
            if (p >= 0) {
              // Singular when |det| is negligible against the entries' magnitude.
              const a = w[p]!, b = w[p + 1]!, c = w[p + 2]!, d = w[p + 3]!, det = a * d - b * c;
              let scale = 1;
              if (a > scale || -a > scale) scale = a < 0 ? -a : a;
              if (b > scale || -b > scale) scale = b < 0 ? -b : b;
              if (c > scale || -c > scale) scale = c < 0 ? -c : c;
              if (d > scale || -d > scale) scale = d < 0 ? -d : d;
              if ((det < 0 ? -det : det) <= 1e-12 * scale * scale) continue;
              // A reflected parent turns a local CCW increment clockwise in world.
              if (det < 0) sign = -1;
            }
            const r = joints[k]! * 5 + 2, before = trs[r]!;
            let rotation = before + sign * Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
            const min = limits[k * 2]!, max = limits[k * 2 + 1]!;
            if (min === min) { if (rotation < min) rotation = min; else if (rotation > max) rotation = max; }
            if (rotation === before) continue;
            trs[r] = rotation;
            // Only this joint's local changed; downstream path slots need world only.
            update.recompose(pose, joints[k]!);
            for (let q = k + 1; q < m; q++) update.refreshWorld(pose, joints[q]!);
            update.refreshWorld(pose, effector);
          }
          dx = w[e + 4]! - tx; dy = w[e + 5]! - ty; residual = Math.sqrt(dx * dx + dy * dy);
        }
        pose.constraintResiduals[residualIndex] = residual;
      },
    });
  },
};
export const CCD_CHAIN_CONSTRAINT_SOLVER: ActorConstraintSolver = Object.freeze(solver);
