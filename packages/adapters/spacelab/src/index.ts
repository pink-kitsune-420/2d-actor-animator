/** Optional historical data profile. This is not a live game provider. */
import { openActorProject, DEFAULT_ACTOR_PROJECT_LIMITS, CCD_CHAIN_SOLVER } from '../../../runtime/src/index';
import type { ActorProject, ActorProjectDiagnostic, ActorProjectLimits } from '../../../runtime/src/index';

export const SPACELAB_ACTOR_SOURCE_PROFILE = Object.freeze({
  id: 'actor-animator:spacelab-source/1',
  format: 'spacelab-actor-project/1',
  support: 'historical-source-only',
  upstreamCommit: '2caf67c8e4949b4d898a12a4b2aa6dfbf4cfea37',
  upstreamTree: '157f7df411ccae2b51044d99fc46f6205af1685b',
  compiler: 'spacelab-actor-compiler/5',
  capabilities: Object.freeze([
    'spacelab:indexed-raster/1', 'spacelab:transform-clips/1',
    'spacelab:rig-constraints/1', 'spacelab:animation-composition/1',
    'spacelab:cel-tracks/1', 'spacelab:emote-authoring/1',
  ]),
  limits: Object.freeze({ ...DEFAULT_ACTOR_PROJECT_LIMITS }),
} as const);

export interface SpaceLabActorSourceOptions {
  /** Exact local profile identifier. No implicit latest version or downgrade. */
  profile: string;
  /** Only stricter limits than this profile's envelope are accepted. */
  limits?: Partial<ActorProjectLimits>;
}
export interface SpaceLabActorSourceReport {
  readonly profile: typeof SPACELAB_ACTOR_SOURCE_PROFILE.id;
  readonly editableSource: 'preserved';
  readonly standaloneRuntime: 'available';
  readonly liveGame: 'unverified';
  readonly gameProvider: 'not-implemented';
  readonly warnings: readonly ActorProjectDiagnostic[];
}
export type SpaceLabActorSourceResult =
  | { ok: true; source: ActorProject; report: SpaceLabActorSourceReport }
  | { ok: false; diagnostics: readonly ActorProjectDiagnostic[] };
export type SpaceLabActorSourceExport =
  | { ok: true; source: ActorProject; report: SpaceLabActorSourceReport; text: string }
  | { ok: false; diagnostics: readonly ActorProjectDiagnostic[] };

const refusal = (path: string, code: string, message: string): SpaceLabActorSourceResult =>
  ({ ok: false, diagnostics: [{ path, code, message }] });

/** Admission only, outside sampling loops. Never executes extensions or solvers,
 * accesses resources, changes revisions, flattens pixels, or mutates input. */
export function inspectSpaceLabActorSource(text: string, options: SpaceLabActorSourceOptions): SpaceLabActorSourceResult {
  if (options.profile !== SPACELAB_ACTOR_SOURCE_PROFILE.id) {
    return refusal('/profile', 'profile-version', `Expected ${SPACELAB_ACTOR_SOURCE_PROFILE.id}; no migration or live-game profile is available`);
  }
  for (const [key, value] of Object.entries(options.limits ?? {})) {
    const ceiling = SPACELAB_ACTOR_SOURCE_PROFILE.limits[key as keyof ActorProjectLimits];
    if (!Object.hasOwn(SPACELAB_ACTOR_SOURCE_PROFILE.limits, key) || !Number.isSafeInteger(value) || value < 0 || value > ceiling) {
      return refusal(`/limits/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`, 'profile-limit', 'Limit must be a known nonnegative safe integer no larger than the profile default');
    }
  }
  const opened = openActorProject(text, options.limits);
  if (!opened.ok) return opened;
  const source = opened.source;
  for (let i = 0; i < source.requiredCapabilities.length; i++) {
    if (!(SPACELAB_ACTOR_SOURCE_PROFILE.capabilities as readonly string[]).includes(source.requiredCapabilities[i]!)) {
      return refusal(`/requiredCapabilities/${i}`, 'profile-capability', 'Required capability is outside this pinned profile');
    }
  }
  const warnings: ActorProjectDiagnostic[] = [];
  source.rigs.forEach((rig, r) => rig.constraints?.forEach((constraint, c) => {
    if (constraint.solver !== CCD_CHAIN_SOLVER) warnings.push({
      path: `/rigs/${r}/constraints/${c}/solver`, code: 'unsupported-solver',
      message: `${constraint.solver} is preserved as inert data; execution is unsupported by this profile`,
    });
  }));
  return { ok: true, source, report: {
    profile: SPACELAB_ACTOR_SOURCE_PROFILE.id, editableSource: 'preserved',
    standaloneRuntime: 'available', liveGame: 'unverified', gameProvider: 'not-implemented', warnings,
  } };
}

/** Lossless original export. A successful result returns the exact input string,
 * including formatting; it does not serialize the detached inspection source.
 * Keep original bytes separately for non-UTF-8 encodings or BOM byte fidelity. */
export function exportSpaceLabActorSource(text: string, options: SpaceLabActorSourceOptions): SpaceLabActorSourceExport {
  const result = inspectSpaceLabActorSource(text, options);
  return result.ok ? { ...result, text } : result;
}
