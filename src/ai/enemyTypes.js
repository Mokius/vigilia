// =============================================================================
// enemyTypes.js — The cast. Adding a creature = adding an entry here.
// `modelKey` points at CONFIG.models.<key>, whose URL list is probed at runtime
// (drop the real Mixamo GLB in assets/models/ and it is used automatically).
// =============================================================================

import { clamp } from '../core/util.js';

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
    // A 0.15 s crossing cannot contain a stride, so the take had to be run at
    // 3.4x to fill it and the result was fast-forward footage. The crossing is
    // now long enough for two real steps and the hold is trimmed to match, so
    // the RHYTHM of position changes is the same while the body moves like a
    // body. It still covers 0.5 m in half a second, which is a sprint.
    holdMin: 1.25, holdMax: 2.90,   // stands motionless, watching
    dashMin: 0.42, dashMax: 0.62,   // then crosses fast, but on its own legs
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
    holdMin: 0.70, holdMax: 1.70,   // barely waits
    dashMin: 0.34, dashMax: 0.50,
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
  // A smooth 0..1 ramp across nights 1-5, so nothing steps: every axis below is
  // interpolated along it rather than switched at a threshold.
  const r = clamp((n - 1) / 4, 0, 1);
  const lerp = (a, b) => a + (b - a) * r;
  return {
    maxConcurrent: n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 3 : 4,
    spawnInterval: [lerp(11, 3.6), lerp(18, 6.4)],
    // Multiplies how long a creature stands still between moves: >1 = slower,
    // more reaction time for the player.
    holdMul: lerp(1.85, 0.72),
    // Multiplies the CROSSING time. Below 1 it travels faster — and because the
    // animation rate is decoupled now, this speeds up the creature without ever
    // speeding up its legs.
    dashMul: lerp(1.15, 0.72),
    // Multiplies how long the beam has to be held to turn it: later nights make
    // the lamp work harder, but never slower than a third of a second.
    banishMul: lerp(0.85, 1.9),
    // How often it presses on instead of pausing once it is close.
    aggression: lerp(0.15, 0.75),
    crossChance: lerp(0.30, 0.14),   // fewer free scares as the nights go on
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
