import type { ActorProject, ActorTransform } from '@actor-animator/types';

const rest: ActorTransform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };

/** Data example only: no registered service, gameplay actor or editor mount.
 * Portable modules can exchange these public types; host composition validates
 * source using its actor-tools implementation before previewing it. */
export function markerSource(): ActorProject {
  return {
    format: 'spacelab-actor-project/1', version: '0.1.0', id: 'example:marker-project', name: 'Independent marker',
    author: 'Space Lab', license: 'MIT', provenance: 'Original first-party data example.',
    units: { metresPerUnit: 1, coordinates: 'x-right-y-up', angle: 'radians-ccw', time: 'seconds', origin: [0, 0] },
    requiredCapabilities: ['spacelab:indexed-raster/1', 'spacelab:transform-clips/1'],
    parts: [{ id: 'example:dot', name: 'Dot', revision: 1, pivot: [0.5, 0.5], unitsPerPixel: 1,
      artwork: { kind: 'indexed-raster', width: 1, height: 1, palette: ['#c7d4dcff'],
        layers: [{ id: 'example:ink', name: 'Ink', opacity: 1, pixels: [0] }] } }],
    rigs: [],
    attachments: [{ id: 'example:drawing', name: 'Drawing', partId: 'example:dot', drawOrder: 0, transform: { ...rest } }],
    clips: [{ id: 'example:rise', name: 'Rise', duration: 2, playback: 'loop', tracks: [{
      id: 'example:rise-track', target: { kind: 'attachment', attachmentId: 'example:drawing' }, interpolation: 'linear',
      keys: [{ time: 0, value: { ...rest } }, { time: 2, value: { ...rest, y: 1 } }],
    }] }],
    actions: [{ id: 'example:emote-rise', label: 'Rise', clipId: 'example:rise', category: 'emote' }],
    extensions: { 'example:author-note': { meaning: 'Presentation only; no physical movement.' } },
  };
}

/** Data example only: a two-segment arm with an optional joint limit and a
 * visual CCD chain reaching toward a separate root. Requires capability
 * `spacelab:rig-constraints/1`; the constraint is presentation only. */
export function rigReachSource(): ActorProject {
  const source = markerSource();
  source.id = 'example:reach-project'; source.name = 'Reaching arm';
  source.requiredCapabilities.push('spacelab:rig-constraints/1');
  source.rigs.push({ id: 'example:arm', name: 'Arm', sockets: [], nodes: [
    { id: 'example:shoulder', name: 'Shoulder', parentId: null, rest: { ...rest } },
    { id: 'example:elbow', name: 'Elbow', parentId: 'example:shoulder', rest: { ...rest, x: 1 }, limits: { minRotation: 0, maxRotation: 2.5 } },
    { id: 'example:hand', name: 'Hand', parentId: 'example:elbow', rest: { ...rest, x: 1 } },
    { id: 'example:goal', name: 'Goal', parentId: null, rest: { ...rest, x: 1, y: 1 } },
  ], constraints: [{ id: 'example:reach', name: 'Reach goal', solver: 'spacelab:ccd-chain/1', enabled: true,
    settings: { effector: { kind: 'node', id: 'example:hand' }, chainRootId: 'example:shoulder', target: { kind: 'node', id: 'example:goal' }, iterations: 16, tolerance: 0.001 } }] });
  return source;
}

/** Presentation-only composition example: a ping-pong attachment clip with
 * easing and a single override layer. No runtime service or game action. */
export function animationSource(): ActorProject {
  const source = markerSource();
  source.requiredCapabilities.push('spacelab:animation-composition/1');
  source.clips[0]!.playback = 'ping-pong';
  source.clips[0]!.tracks[0]!.keys[0]!.curve = 'ease-in-out';
  source.animators = [{ id: 'example:animator', name: 'Marker', layers: [{
    id: 'example:base', name: 'Base', blend: 'override', weight: 1,
    initialStateId: 'example:rise', defaultTransition: { duration: .2, priority: 0 },
    states: [{ id: 'example:rise', name: 'Rise', clipId: 'example:rise', rate: 1 }], transitions: [],
  }] }];
  return source;
}

/** Zero-bone flipbook reuses ordinary layered parts; cel choice is step-only.
 * Changing the cel never changes the attachment transform or any mechanics. */
export function celSource(): ActorProject {
  const s = markerSource(); s.requiredCapabilities.push('spacelab:cel-tracks/1');
  const alternate = structuredClone(s.parts[0]!); alternate.id = 'example:alternate';
  alternate.artwork.palette[0] = '#ffbe55ff'; s.parts.push(alternate);
  s.cels = [{ id: 'example:plain', name: 'Plain', partId: s.parts[0]!.id }, { id: 'example:bright', name: 'Bright', partId: alternate.id }];
  s.clips[0]!.celTracks = [{ id: 'example:frames', target: { kind: 'attachment', attachmentId: s.attachments[0]!.id }, keys: [{ time: 0, celId: 'example:plain' }, { time: 1, celId: 'example:bright' }] }];
  return s;
}

/** Named solo choreography uses explicit local clip mapping. No player consent,
 * event, movement lock or world positioning is encoded by this data. */
export function emoteSource(): ActorProject {
  const s=markerSource();s.requiredCapabilities.push('spacelab:emote-authoring/1');s.clips[0]!.playback='once';
  s.emotes=[{id:'example:rise-emote',label:'Rise',revision:1,duration:2,playback:'once',interruptPriority:0,
    roles:[{id:'actor',label:'Actor',clipId:s.clips[0]!.id,rigId:null,socketBindings:{},start:0,rate:1,placement:{...rest}}]}];
  return s;
}
