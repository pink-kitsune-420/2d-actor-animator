// Original MIT analytic examples. No evaluator code or game/editor imports.
export const transform = (x = 0, y = 0, rotation = 0) => ({ x, y, rotation, scaleX: 1, scaleY: 1 });
export function createActors() {
  const shared = {
    format: 'spacelab-actor-project/1', version: '0.1.0', author: 'Actor Animator contributors',
    license: 'MIT', provenance: 'Original analytic runtime sample; no third-party art.',
    units: { metresPerUnit: 0.01, coordinates: 'x-right-y-up', angle: 'radians-ccw', time: 'seconds', origin: [0, 0] },
    requiredCapabilities: ['spacelab:indexed-raster/1', 'spacelab:transform-clips/1'],
    parts: [{ id: 'demo:lamp', name: 'Lamp', revision: 1, pivot: [0.5, 0.5], unitsPerPixel: 0.5,
      artwork: { kind: 'indexed-raster', width: 2, height: 2, palette: ['#00000000', '#f6ba45ff', '#317b94ff'],
        layers: [{ id: 'demo:ink', name: 'Ink', opacity: 0.8, pixels: [1, 0, 2, 1] }] } }],
    actions: [], extensions: { 'demo:future': { kept: [null, false, 0, 'demo:antenna'], revision: 7 } },
  };
  const creature = {
    ...structuredClone(shared), id: 'demo:antenna', name: 'Orbiting antenna creature',
    rigs: [
      { id: 'demo:antenna', name: 'Antenna', sockets: [], nodes: [
        { id: 'demo:hub', name: 'Hub', parentId: null, rest: transform(1, 2) },
        { id: 'demo:tip', name: 'Tip', parentId: 'demo:hub', rest: transform(2, 0) },
        { id: 'demo:free-root', name: 'Independent feeler', parentId: null, rest: transform(-1, 1) },
      ] },
      { id: 'demo:satellite', name: 'Satellite', sockets: [], nodes: [
        { id: 'demo:spark', name: 'Spark', parentId: null, rest: transform(0, -1) },
      ] },
    ],
    attachments: [{ id: 'demo:lamp', name: 'Tip lamp', partId: 'demo:lamp', rigId: 'demo:antenna', nodeId: 'demo:tip', drawOrder: 0, transform: transform() }],
    clips: [{ id: 'demo:orbit', name: 'Antenna orbit', duration: 2, playback: 'once', tracks: [
      { id: 'demo:rotate', target: { kind: 'node', rigId: 'demo:antenna', nodeId: 'demo:hub' }, interpolation: 'linear', keys: [
        { time: 0, value: transform(1, 2, 0) }, { time: 2, value: transform(1, 2, Math.PI) },
      ] },
    ] }],
  };
  const marker = {
    ...structuredClone(shared), id: 'demo:marker', name: 'Zero-bone lamp', rigs: [],
    attachments: [{ id: 'demo:marker', name: 'Marker', partId: 'demo:lamp', drawOrder: 0, transform: transform() }],
    clips: [{ id: 'demo:rise', name: 'Rise', duration: 2, playback: 'loop', tracks: [
      { id: 'demo:rise-key', target: { kind: 'attachment', attachmentId: 'demo:marker' }, interpolation: 'linear', keys: [
        { time: 0, value: transform() }, { time: 2, value: transform(0, 2) },
      ] },
    ] }],
  };
  return { creature, marker };
}
