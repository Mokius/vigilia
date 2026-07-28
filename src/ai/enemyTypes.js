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
    advanceSpeed: 0.100,      // ~10 s from cover to the player, unobserved
    retreatSpeed: 0.55, crossSpeed: 0.30,
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
    advanceSpeed: 0.130,      // the crawler is the fastest thing in the room
    retreatSpeed: 0.65, crossSpeed: 0.30,
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
    advanceSpeed: 0.085,      // heavy, but still closes in ~12 s
    retreatSpeed: 0.5, crossSpeed: 0.28,
    banishTime: 0.90,
    cueInterval: [3.4, 6.0], cues: ['knock', 'whisper'],
    eyeColor: 0xff5a5a, weight: 2, minNight: 2,
    scream: 'roar', face: 'face',
  },
];

export function nightParams(night) {
  return {
    // Several at once from the first night. Capped at 3: each creature is a
    // skinned mesh rendered in 4 viewports plus the shadow pass, and 4 of them
    // measurably breaks the frame budget.
    maxConcurrent: Math.min(3, 2 + Math.floor(night / 3)),
    spawnInterval: [Math.max(2.4, 6.5 - night * 0.7), Math.max(4.2, 10 - night)],
    speedMul: 1 + (night - 1) * 0.14,
    crossChance: 0.20,          // odds a spawn is a harmless fly-by scare
  };
}

// Staging of an appearance (docs/FASE1_ESCENARIO.md §4.2): the opening starts
// moving BEFORE anything is visible, then the creature fades in — it must never
// simply pop into existence.
export const SPAWN = {
  openingLead: 0.45,   // s the door/vent/hatch moves alone, still empty
  fadeIn: 0.55,        // s the creature fades up from invisible
  holdAfter: 0.35,     // s it lingers at the opening before advancing
};
