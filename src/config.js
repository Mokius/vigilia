// =============================================================================
// config.js — Single source of truth for the whole experience.
// Physical constants come from the real Ubicuity U-Box (3 × 3 × 2.5 m).
// Everything tunable lives here so systems stay decoupled from magic numbers.
// =============================================================================

export const CONFIG = {
  // ---- Physical room (metres). Origin = floor centre. Y up, -Z = front. ----
  room: {
    W: 3.0,   // width  (x span)  -> walls at x = ±1.5
    D: 3.0,   // depth  (z span)  -> front wall z = -1.5, back z = +1.5
    H: 2.5,   // height (y span)  -> ceiling y = 2.5
    eye: [0, 1.6, 0],   // operator eye point (CAVE apex)
  },

  // ---- Projection / screen strip ----
  // The 4 panels render in one canvas as a contiguous strip: LEFT FRONT RIGHT FLOOR.
  // Floor projector only covers the TOP fraction of its panel (U-Box constraint).
  screen: {
    floorCover: 0.70,   // matches shared/cube.css --floor-cover on the real rig
    near: 0.05,
    far: 60,
  },

  // ---- Renderer / performance ----
  render: {
    maxPixelRatio: 1.75,     // clamp DPR (4 viewports = 4× draw cost)
    shadowMapSize: 2048,
    exposure: 1.2,           // ACES filmic
    post: true,              // master toggle for the post pipeline
    bloom: { threshold: 0.48, strength: 1.1, radius: 0.7 },
    grain: 0.042,
    vignette: 1.1,
    aberration: 0.0016,
  },

  // ---- Atmosphere ----
  atmos: {
    fogColor: 0x080a12,
    fogDensity: 0.115,       // exp2 fog
    ambient: 0x0b0e15,       // near-black fill so pure-black isn't crushed
    ambientIntensity: 0.13,
    dustCount: 550,
  },

  // ---- Flashlight ----
  flashlight: {
    color: 0xffe9c6,
    intensity: 55,
    distance: 16,
    angle: 0.40,             // radians, cone half-angle
    penumbra: 0.52,
    decay: 1.05,
    // aim limits (radians): can look up a little, sweep fully down to the floor
    pitchMin: -1.52,
    pitchMax: 0.42,
    yawSpeed: 0.0022,        // pointer-lock sensitivity
    pitchSpeed: 0.0022,
    smoothing: 0.18,         // aim lerp per frame
    battery: {
      enabled: true,
      drainPerSec: 2.4,      // % per second while on (drains fast → the shutdown matters)
      flickerBelow: 28,      // start flickering under this %
    },
    // Recharge by shining the beam on a green wall cell.
    recharge: {
      litThreshold: 0.4,     // beam must be on the cell this strongly
      dwell: 0.85,           // seconds of light to trigger a charge
      amount: 32,            // % restored per charge (partial, on purpose)
      cellCooldown: [11, 20],// seconds a spent cell stays dark before relighting
    },
  },

  // ---- Gameplay ----
  game: {
    startNight: 1,
    nightSeconds: 150,       // survive this long per night
    sanityMax: 100,
    // How long a light must dwell on an enemy to banish it (seconds).
    banishDwell: 0.55,
    // Grace after a banish before that anchor can re-trigger.
    anchorCooldown: [6, 12],
  },

  audio: {
    masterGain: 0.9,
    // Map a world direction to a stereo pan target. The strip is physically
    // LEFT | FRONT | RIGHT so left events pan left, right events pan right,
    // front events stay centred, behind is widened + low-passed.
    duckOnScare: 0.25,
  },

  debug: false,
};

// Derived screen rectangles (world-space corners) for the 4 CAVE cameras.
// Corners: pa = bottom-left, pb = bottom-right, pc = top-left, as seen from the eye.
// Adjacent walls share an edge exactly, so the render is seamless at the corners.
export function screenRects() {
  const w = CONFIG.room.W / 2, d = CONFIG.room.D / 2, h = CONFIG.room.H;
  return {
    // Front wall (z = -d). Left→right = -x→+x.
    front: { pa: [-w, 0, -d], pb: [ w, 0, -d], pc: [-w, h, -d] },
    // Left wall (x = -w). Panel left edge = back (z=+d), right edge = front (z=-d),
    // so LEFT.pb === FRONT.pa (shared front-left corner) -> seamless seam.
    left:  { pa: [-w, 0,  d], pb: [-w, 0, -d], pc: [-w, h,  d] },
    // Right wall (x = +w). Left edge = front (z=-d) so RIGHT.pa === FRONT.pb.
    right: { pa: [ w, 0, -d], pb: [ w, 0,  d], pc: [ w, h, -d] },
    // Floor (y = 0). Image "up" = toward the front wall (-z), so the floor's top
    // edge continues the front wall's bottom edge when the beam sweeps down.
    floor: { pa: [-w, 0,  d], pb: [ w, 0,  d], pc: [-w, 0, -d] },
  };
}

export const SURFACES = ['left', 'front', 'right', 'floor'];
