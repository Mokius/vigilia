// =============================================================================
// enemyTypes.js — The cast. Adding a creature = adding an entry here.
// `modelKey` points at CONFIG.models.<key>, whose URL list is probed at runtime
// (drop the real Mixamo GLB in assets/models/ and it is used automatically).
// =============================================================================

export const ENEMY_TYPES = [
  {
    id: 'romero', name: 'ROMERO', modelKey: 'romero',
    height: 1.85,
    routes: ['door', 'corridor', 'corner_l', 'corner_r'],
    crossRoute: 'corridorCross',
    advanceSpeed: 0.042,      // ~24 s from cover to the player, unobserved
    retreatSpeed: 0.34, crossSpeed: 0.22,
    banishTime: 0.55,
    cueInterval: [3.0, 5.2], cues: ['footstep', 'knock'],
    eyeColor: 0xbfe0ff, weight: 3, minNight: 1,
    scream: 'shriek', face: 'gaunt',
  },
  {
    id: 'parasite', name: 'PARÁSITO', modelKey: 'parasite',
    height: 1.50,
    routes: ['vent', 'hatch'],
    crossRoute: null,
    advanceSpeed: 0.055,
    retreatSpeed: 0.4, crossSpeed: 0.25,
    banishTime: 0.70,
    cueInterval: [2.4, 4.0], cues: ['scrape', 'breath'],
    eyeColor: 0xffd27a, weight: 2, minNight: 1,
    scream: 'gurgle', face: 'maw',
  },
  {
    id: 'drake', name: 'DRAKE', modelKey: 'drake',
    height: 1.90,
    routes: ['window', 'corridor'],
    crossRoute: 'corridorCross',
    advanceSpeed: 0.036,
    retreatSpeed: 0.3, crossSpeed: 0.2,
    banishTime: 0.90,
    cueInterval: [3.4, 6.0], cues: ['knock', 'whisper'],
    eyeColor: 0xff5a5a, weight: 2, minNight: 2,
    scream: 'roar', face: 'face',
  },
];

export function nightParams(night) {
  return {
    maxConcurrent: Math.min(3, 1 + Math.floor(night / 2)),
    spawnInterval: [Math.max(4.0, 10 - night * 0.9), Math.max(7, 16 - night * 1.2)],
    speedMul: 1 + (night - 1) * 0.16,
    crossChance: 0.22,          // odds a spawn is a harmless fly-by scare
  };
}
