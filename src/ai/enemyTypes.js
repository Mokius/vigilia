// =============================================================================
// enemyTypes.js — Data-driven roster. Add a creature by adding an entry.
// `modelUrl` (null = procedural) accepts a CORS-served .glb for a real model.
// `scream` picks the jumpscare audio variant; `face` picks the jumpscare visual.
// =============================================================================

export const ENEMY_TYPES = [
  {
    id: 'watcher', name: 'El Vigía', model: 'watcher', modelUrl: null,
    anchors: ['door', 'corridor', 'corner_l'],
    banishTime: 0.55, advanceInterval: [2.6, 3.8], advanceStep: 0.11,
    cueInterval: [3.0, 5.0], cues: ['footstep', 'knock'],
    eyeColor: 0xbfe0ff, weight: 3, minNight: 1, speedMul: 1.0,
    scream: 'shriek', face: 'gaunt',
  },
  {
    id: 'crawler', name: 'La Cosa del Conducto', model: 'crawler', modelUrl: null,
    anchors: ['vent', 'hatch', 'corner_l'],
    banishTime: 0.70, advanceInterval: [1.9, 2.7], advanceStep: 0.15,
    cueInterval: [2.4, 4.0], cues: ['scrape', 'footstep'],
    eyeColor: 0xffd27a, weight: 2, minNight: 1, speedMul: 1.15,
    scream: 'gurgle', face: 'maw',
  },
  {
    id: 'peeker', name: 'El que Observa', model: 'peeker', modelUrl: null,
    anchors: ['window'],
    banishTime: 0.45, advanceInterval: [3.0, 4.5], advanceStep: 0.09,
    cueInterval: [3.5, 6.0], cues: ['whisper', 'breath'],
    eyeColor: 0xff5a5a, weight: 2, minNight: 2, speedMul: 0.9,
    scream: 'whisperscream', face: 'face',
  },
  {
    id: 'runner', name: 'El Corredor', model: 'watcher', modelUrl: null,
    anchors: ['corridor', 'door', 'hatch'],
    banishTime: 0.95, advanceInterval: [1.1, 1.7], advanceStep: 0.2,
    cueInterval: [1.6, 2.8], cues: ['footstep', 'scrape'],
    eyeColor: 0xff7a2a, weight: 1, minNight: 3, speedMul: 1.4,
    scream: 'roar', face: 'gaunt',
  },
];

export function nightParams(night) {
  return {
    maxConcurrent: Math.min(4, 1 + Math.floor(night / 1.5)),
    spawnInterval: [Math.max(3.5, 9 - night * 0.9), Math.max(6, 15 - night * 1.1)],
    advanceMul: 1 + (night - 1) * 0.14,
    cueMul: Math.max(0.6, 1 - (night - 1) * 0.06),
  };
}
