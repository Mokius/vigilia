// =============================================================================
// enemyTypes.js — Data-driven roster. Add a new creature by adding an entry.
// Each type differs in model, speed, how long light must dwell to banish it,
// its cue cadence and palette, which anchors it uses, spawn weight, and the
// earliest night it can appear. This is the "modular, easily extensible AI".
// =============================================================================

export const ENEMY_TYPES = [
  {
    id: 'watcher', name: 'El Vigía', model: 'watcher',
    anchors: ['door', 'corner_l', 'corner_r'],
    banishTime: 0.50, advanceInterval: [2.6, 3.8], advanceStep: 0.11,
    cueInterval: [3.0, 5.0], cues: ['footstep', 'knock'],
    eyeColor: 0xbfe0ff, weight: 3, minNight: 1, speedMul: 1.0,
  },
  {
    id: 'crawler', name: 'La Cosa del Conducto', model: 'crawler',
    anchors: ['vent', 'corner_l', 'corner_r'],
    banishTime: 0.70, advanceInterval: [1.9, 2.7], advanceStep: 0.15,
    cueInterval: [2.4, 4.0], cues: ['scrape', 'footstep'],
    eyeColor: 0xffd27a, weight: 2, minNight: 1, speedMul: 1.15,
  },
  {
    id: 'peeker', name: 'El que Observa', model: 'peeker',
    anchors: ['glass'],
    banishTime: 0.45, advanceInterval: [3.0, 4.5], advanceStep: 0.09,
    cueInterval: [3.5, 6.0], cues: ['whisper', 'breath'],
    eyeColor: 0xff5a5a, weight: 2, minNight: 2, speedMul: 0.9,
  },
  {
    id: 'runner', name: 'El Corredor', model: 'watcher',
    anchors: ['door', 'corner_l', 'corner_r', 'vent'],
    banishTime: 0.95, advanceInterval: [1.1, 1.7], advanceStep: 0.2,
    cueInterval: [1.6, 2.8], cues: ['footstep', 'scrape'],
    eyeColor: 0xff7a2a, weight: 1, minNight: 3, speedMul: 1.4,
  },
];

// Difficulty envelope per night.
export function nightParams(night) {
  return {
    maxConcurrent: Math.min(4, 1 + Math.floor(night / 1.5)),
    spawnInterval: [Math.max(3.5, 9 - night * 0.9), Math.max(6, 15 - night * 1.1)],
    advanceMul: 1 + (night - 1) * 0.14,
    cueMul: Math.max(0.6, 1 - (night - 1) * 0.06),
  };
}
