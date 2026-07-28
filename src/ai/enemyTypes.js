// =============================================================================
// enemyTypes.js — The cast. Adding a creature = adding an entry here.
// `modelKey` points at CONFIG.models.<key>, whose URL list is probed at runtime
// (drop the real Mixamo GLB in assets/models/ and it is used automatically).
// =============================================================================

export const ENEMY_TYPES = [
  {
    id: 'romero', name: 'ROMERO', modelKey: 'romero',
    height: 1.85,
    routes: ['door', 'corridor'],
    crossRoute: 'corridorCross',
    holdMin: 1.5, holdMax: 3.4,     // stands motionless, watching
    dashMin: 0.12, dashMax: 0.19,   // then crosses to the next station in a blink
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
    holdMin: 0.9, holdMax: 2.2,     // the crawler barely waits
    dashMin: 0.10, dashMax: 0.15,
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
    holdMin: 2.0, holdMax: 4.2,     // heavy: long stares, then a brutal lunge
    dashMin: 0.14, dashMax: 0.20,
    banishTime: 0.90,
    cueInterval: [3.4, 6.0], cues: ['knock', 'whisper'],
    eyeColor: 0xff5a5a, weight: 2, minNight: 2,
    scream: 'roar', face: 'face',
  },
];

export function nightParams(night) {
  // Night 1 is a lesson, not a test: ONE creature at a time, long gaps between
  // arrivals, and generous stillness so there is always time to find it, put the
  // beam on it and learn that the light is what saves you. Pressure then ramps.
  const n = Math.max(1, night);
  return {
    maxConcurrent: n <= 1 ? 1 : n <= 2 ? 2 : 3,
    spawnInterval: n <= 1 ? [11, 18]
                 : n <= 2 ? [8, 13]
                 : [Math.max(3.5, 9 - n * 0.8), Math.max(6, 14 - n * 1.1)],
    // Multiplies how long a creature stands still between moves: >1 = slower,
    // more reaction time for the player.
    holdMul: n <= 1 ? 1.85 : n <= 2 ? 1.4 : Math.max(0.85, 1.35 - (n - 2) * 0.18),
    crossChance: 0.24,          // harmless fly-bys stay common: tension, not deaths
  };
}


// Staging of an appearance (docs/FASE1_ESCENARIO.md §4.2): the opening starts
// moving BEFORE anything is visible, then the creature fades in — it must never
// simply pop into existence.
export const SPAWN = {
  // Long enough that the entry point's "tell" (grille rattling, hatch thumping,
  // door creeping open) plays out ALONE first — that warning is the whole point.
  openingLead: 0.85,
  fadeIn: 0.55,        // s the creature fades up from invisible
  holdAfter: 0.4,      // s it lingers at the opening before it starts moving
};
