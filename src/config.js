// =============================================================================
// config.js — Single source of truth. Physical constants come from the real
// Ubicuity U-Box (3 x 3 x 2.5 m). See docs/FASE1_ESCENARIO.md for the rationale
// behind every dimension here.
// =============================================================================

export const CONFIG = {
  // ---- Physical room (metres). Origin = floor centre. Y up, -Z = front. ----
  room: {
    W: 3.0, D: 3.0, H: 2.5,
    eye: [0, 1.6, 0],          // CAVE apex = the operator's eye
  },

  // The 4 panels render as a contiguous strip: LEFT FRONT RIGHT FLOOR.
  screen: { floorCover: 0.70, near: 0.05, far: 60 },

  render: {
    // The scene is rasterized FOUR times per frame (one per surface), so every
    // pixel costs 4x. Keep DPR modest and let the adaptive scaler take over.
    maxPixelRatio: 1.25,
    shadowMapSize: 1024,       // 2048 was re-rendered every frame: too costly
    shadowEveryNthFrame: 2,    // recompute the shadow map at ~30 Hz, not 60
    exposure: 1.2,
    post: true,
    bloom: { threshold: 0.48, strength: 1.1, radius: 0.7 },
    grain: 0.042, vignette: 1.1, aberration: 0.0016,
    // Adaptive resolution: hold a stable frame time by scaling the buffer.
    adaptive: { enabled: true, targetMs: 20, worseMs: 25, betterMs: 13, min: 0.55, max: 1.0, settleMs: 1100 },
    crtHz: 12,                 // the CRT canvas only needs a dozen redraws/s
  },

  atmos: {
    fogColor: 0x080a12, fogDensity: 0.115,
    ambient: 0x0b0e15, ambientIntensity: 0.13,
    dustCount: 380,
  },

  flashlight: {
    color: 0xffe9c6, intensity: 46, distance: 16,
    // Wider cone and a much softer edge. Deliberately NOT brighter: the old
    // 0.40 rad beam forced pixel-hunting, which read as artificial difficulty.
    angle: 0.54, penumbra: 0.80, decay: 1.05,
    pitchMin: -1.52, pitchMax: 0.42,
    yawSpeed: 0.0022, pitchSpeed: 0.0022, smoothing: 0.18,
    // ---- FINITE battery (docs/FASE1_ESCENARIO.md §5) ----
    battery: {
      enabled: true,
      drainPerSec: 2.5,        // 100% -> ~40 s of continuous light
      flickerBelow: 25,
      warnBelow: 25,
    },
  },

  // Battery pickups: physical objects, aim to collect, finite.
  pickups: {
    // At most TWO cells exist at any moment: enough to offer a choice, few enough
    // that the room still feels short of power. Each runs its own respawn clock.
    live: 2,
    dwell: 1.4,                // seconds of continuous aim to collect
    amount: 28,                // % restored (never a full charge)
    litThreshold: 0.35,
    maxAngle: 0.20,            // must be near the beam axis, not just in the cone
    // Each collected cell comes back on its own clock, staggered.
    respawn: [26, 48],
    // Only ONE cell can ever be charging: the one closest to the beam axis.
    exclusive: true,
  },

  // Aim-to-activate for the diegetic menu controls. `maxAngle` is a TIGHT
  // angular window (~5.7°) because the levers sit close together and the lit
  // cone (~23°) is far too coarse to disambiguate them.
  interact: { dwell: 1.2, litThreshold: 0.3, maxAngle: 0.10 },

  game: {
    startNight: 1,
    nightSeconds: 150,
    clockFrom: 0, clockTo: 6,  // wall clock reads 00:00 -> 06:00
  },

  audio: { masterGain: 0.9, duckOnScare: 0.25 },

  // Distinctive but legible type. Loaded from Google Fonts with robust
  // fallbacks — if the installation is offline the fallbacks still read well.
  fonts: {
    crt: '"Share Tech Mono", ui-monospace, Consolas, "Courier New", monospace',
    stencil: '"Special Elite", "Arial Narrow", Impact, sans-serif',
  },

  // Plug-and-play models. Each entry is tried IN ORDER; first one that loads
  // wins, and if none do we fall back to the procedural creature. Drop the
  // Mixamo GLBs into assets/models/ (see docs/MIXAMO_INGESTA.md) and they are
  // picked up automatically with no code change.
  models: {
    probeTimeoutMs: 9000,
    romero:   ['assets/models/romero.glb'],
    romera:   ['assets/models/romera.glb'],
    // Licence-clean CC0/Mixamo-derived fallbacks served with CORS. Verified.
    fallbackHumanoid: [
      'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/models/gltf/Xbot.glb',
      'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/models/gltf/Soldier.glb',
    ],
  },

  debug: false,
};

// Screen rectangles (world corners) for the 4 off-axis CAVE cameras.
// Adjacent walls share an edge exactly => seamless corners.
export function screenRects() {
  const w = CONFIG.room.W / 2, d = CONFIG.room.D / 2, h = CONFIG.room.H;
  return {
    front: { pa: [-w, 0, -d], pb: [ w, 0, -d], pc: [-w, h, -d] },
    left:  { pa: [-w, 0,  d], pb: [-w, 0, -d], pc: [-w, h,  d] },
    right: { pa: [ w, 0, -d], pb: [ w, 0,  d], pc: [ w, h, -d] },
    floor: { pa: [-w, 0,  d], pb: [ w, 0,  d], pc: [-w, 0, -d] },
  };
}

export const SURFACES = ['left', 'front', 'right', 'floor'];
