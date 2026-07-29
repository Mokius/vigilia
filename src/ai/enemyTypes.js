// =============================================================================
// enemyTypes.js — The cast. Adding a creature = adding an entry here.
// `modelKey` points at CONFIG.models.<key>, whose URL list is probed at runtime
// (drop the real Mixamo GLB in assets/models/ and it is used automatically).
// =============================================================================

// TWO characters, five ways in. There were three entries here when there were no
// real models and the differences were notional; now that Romero and Romera are
// actual meshes with actual weight, the cast is what we have — and each one gets
// the routes and the tempo that suit its build rather than a third being faked
// from a shared asset.
export const ENEMY_TYPES = [
  {
    // The heavy. Tall, slow, long stares — takes the upright approaches.
    id: 'romero', name: 'ROMERO', modelKey: 'romero',
    height: 1.86,
    routes: ['door', 'corridor', 'window'],
    crossRoute: 'corridorCross',
    holdMin: 1.6, holdMax: 3.4,     // stands motionless, watching
    dashMin: 0.13, dashMax: 0.20,   // then crosses to the next station in a blink
    banishTime: 0.55,
    cueInterval: [3.0, 5.2], cues: ['footstep', 'knock'],
    eyeColor: 0xbfe0ff, weight: 3, minNight: 1,
    scream: 'shriek', face: 'gaunt',
    jumpscareClip: 'jumpscare',      // zombie_neck_bite, trimmed
  },
  {
    // The crawler. Lighter and quicker, and she comes up through the floor and
    // out of the duct, where the crawl takes belong.
    id: 'romera', name: 'ROMERA', modelKey: 'romera',
    height: 1.68,
    routes: ['vent', 'hatch', 'door'],
    crossRoute: null,
    holdMin: 0.9, holdMax: 2.1,     // barely waits
    dashMin: 0.10, dashMax: 0.16,
    banishTime: 0.60,
    cueInterval: [2.4, 4.0], cues: ['scrape', 'breath'],
    eyeColor: 0xffd27a, weight: 3, minNight: 1,
    scream: 'gurgle', face: 'maw',
    jumpscareClip: 'jumpscareB',     // zombie_biting_2: a different lunge
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
