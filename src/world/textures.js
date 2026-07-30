// =============================================================================
// textures.js — Procedural PBR material maps generated on a canvas.
// No external files: everything (concrete, painted metal, grime) is synthesized
// from value-noise fBm, and normal maps are derived from the height field via
// Sobel gradients so a raking flashlight reveals real surface relief.
// =============================================================================

import * as THREE from 'three';

// --- hashed value noise + fBm --------------------------------------------------
function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) ^ 0x9e3779b9;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
function fbm(x, y, oct, lac = 2, gain = 0.5) {
  let f = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < oct; i++) { f += amp * vnoise(x * freq, y * freq); norm += amp; amp *= gain; freq *= lac; }
  return f / norm;
}

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

// --- pattern primitives --------------------------------------------------
// Each takes plain 0..1 UV (px, py) — deliberately decoupled from baseFreq/
// seed so a primitive's period can be tuned independently of the underlying
// fBm. Every one returns a signed delta to add straight onto the height
// field; recessing primitives (grooves, gouges, holes) bake the minus sign
// in themselves so the call site is a uniform `h += xHeight(...)`.
//
// Two tiling strategies are used, picked per primitive:
//  - true periodic (ribs/grid/perforate): built from sin/frac of px*N with
//    N rounded to an integer, which is exactly periodic on 0..1 — no seam,
//    full stop, regardless of size.
//  - jittered cellular (spangle/scratches/dents): a 3x3 neighbour search
//    over a grid of N cells, where the cell id is wrapped mod N *before*
//    hashing. That makes cell N identical to cell 0, so a feature that
//    straddles the UV edge is reconstructed identically on both sides.
// speckle needs neither trick — each chip lives inside a single self-
// contained cell, so per-cell hashing alone already tiles exactly.

// Periodic corrugation. `period` is rounded to an integer rib count across
// the tile — anything else would leave a visible phase jump on repeat.
function ribsHeight(px, py, { axis = 'y', period = 8, depth = 0.15, profile = 'round' } = {}) {
  const n = Math.max(1, Math.round(period));
  const t = axis === 'x' ? py : px;
  const phase = t * n * Math.PI * 2;
  const wave = profile === 'square' ? Math.sign(Math.sin(phase)) : Math.sin(phase);
  return wave * depth;
}

// Rectangular plate grid with recessed grooves. Cell counts are rounded to
// integers for the same reason as ribs' period: the groove has to meet
// itself cleanly across the tile edge.
function gridHeight(px, py, { u: cellsU = 4, v: cellsV = 4, groove = 0.05, depth = 0.3 } = {}) {
  const gu = Math.max(1, Math.round(cellsU)), gv = Math.max(1, Math.round(cellsV));
  const fu = (px * gu) % 1, fv = (py * gv) % 1;
  const nearU = Math.min(fu, 1 - fu), nearV = Math.min(fv, 1 - fv);
  return (nearU < groove || nearV < groove) ? -depth : 0;
}

// Worley/cellular crystallites (galvanised zinc spangle). Cell id wrapped
// mod N before hashing — see the tiling note above.
function spangleHeight(px, py, { scale = 12, amount = 0.3 } = {}) {
  const n = Math.max(1, Math.round(scale));
  const cx = px * n, cy = py * n;
  const ix = Math.floor(cx), iy = Math.floor(cy);
  let minD = 4;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const gx = ix + ox, gy = iy + oy;
      const wx = ((gx % n) + n) % n, wy = ((gy % n) + n) % n;
      const fx2 = gx + hash2(wx, wy), fy2 = gy + hash2(wx + 31, wy + 57);
      const d = Math.hypot(cx - fx2, cy - fy2);
      if (d < minD) minD = d;
    }
  }
  return amount * Math.max(0, 1 - minD); // bright facet at each crystallite centre, fading within one cell
}

// Thin directional gouges on a jittered grid — count is a rough total, not
// an exact one, since it drives a sqrt'd NxN cell grid rather than a literal
// scatter (a literal Poisson scatter can't wrap cleanly at the tile edge).
function scratchesHeight(px, py, { count = 6, length = 0.35, depth = 0.3, angleJitter = 0.6 } = {}) {
  const n = Math.max(1, Math.round(Math.sqrt(Math.max(0, count)))); // clamp before sqrt — a stray negative count must not sqrt to NaN
  const cx = px * n, cy = py * n;
  const ix = Math.floor(cx), iy = Math.floor(cy);
  let mask = 0;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const gx = ix + ox, gy = iy + oy;
      const wx = ((gx % n) + n) % n, wy = ((gy % n) + n) % n;
      const jx = hash2(wx, wy), jy = hash2(wx + 13, wy + 29);
      // base diagonal + jitter, not a uniform random angle, so scratches keep a
      // family resemblance instead of looking like scattered noise
      const ang = Math.PI * 0.25 + (hash2(wx + 7, wy + 19) - 0.5) * angleJitter;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const dx = cx - (gx + jx), dy = cy - (gy + jy);
      const along = dx * ca + dy * sa, across = -dx * sa + dy * ca;
      const halfLen = (length * n) * 0.5;
      if (Math.abs(along) < halfLen) {
        const w = Math.max(0, 1 - Math.abs(across) / 0.12);
        if (w > mask) mask = w;
      }
    }
  }
  return -depth * mask; // a scratch is always a recess
}

// Soft circular impacts — squared falloff reads as a rounded dish rather
// than a conical crater. Same wrapped-grid trick as spangle/scratches.
function dentsHeight(px, py, { count = 5, radius = 0.18, depth = 0.25 } = {}) {
  const n = Math.max(1, Math.round(Math.sqrt(Math.max(0, count)))); // clamp before sqrt — a stray negative count must not sqrt to NaN
  const r = Math.max(0.001, radius); // guards the division below — radius 0 would otherwise divide by zero
  const cx = px * n, cy = py * n;
  const ix = Math.floor(cx), iy = Math.floor(cy);
  let mask = 0;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const gx = ix + ox, gy = iy + oy;
      const wx = ((gx % n) + n) % n, wy = ((gy % n) + n) % n;
      const jx = hash2(wx, wy), jy = hash2(wx + 5, wy + 11);
      const d = Math.hypot(cx - (gx + jx), cy - (gy + jy)) / (r * n);
      const w = Math.max(0, 1 - d * d);
      const w2 = w * w;
      if (w2 > mask) mask = w2;
    }
  }
  return -depth * mask;
}

// Regular punched-hole grid — no jitter, so a plain rectangular repeat
// (rounded to an integer count) tiles exactly with no wrap handling needed.
function perforateHeight(px, py, { period = 10, radius = 0.22, depth = 0.6 } = {}) {
  const n = Math.max(1, Math.round(period));
  const cx = (px * n) % 1 - 0.5, cy = (py * n) % 1 - 0.5;
  const d = Math.hypot(cx, cy);
  const edge = radius + 0.06; // small chamfer so the punch edge isn't a one-pixel cliff
  if (d < radius) return -depth;
  if (d < edge) return -depth * (1 - (d - radius) / (edge - radius));
  return 0;
}

// Tight directional fibre. The along-grain axis is sampled at 0.25x
// frequency — near-static — so the result reads as long fibres, not blobs.
function grainHeight(px, py, { axis = 'y', freq = 18, amount = 0.25 } = {}) {
  const across = axis === 'y' ? px : py;
  const along = axis === 'y' ? py : px;
  const fibre = fbm(across * freq, along * freq * 0.25, 3);
  return (fibre - 0.5) * amount * 2;
}

// Small hard chips. One hash per cell, no neighbour search: each chip sits
// fully inside its own cell, and the cells already tile exactly.
function speckleHeight(px, py, { density = 30, size = 0.25, amount = 0.15 } = {}) {
  const n = Math.max(1, Math.round(density));
  const ix = Math.floor(px * n) % n, iy = Math.floor(py * n) % n;
  if (hash2(ix, iy) <= 1 - size) return 0; // most cells stay empty — only a sparse few chip out
  return (hash2(ix + 3, iy + 9) - 0.5) * amount * 2;
}

// Build a height field, then albedo/roughness/normal from it.
function surface(size, opts) {
  const {
    baseFreq, oct, tint, tintVar, roughBase, roughVar, normalScale, seed = 0, streaks = 0,
    aniso, ribs, grid, spangle, scratches, dents, perforate, grain, speckle,
  } = opts;
  const H = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x / size) * baseFreq + seed, ny = (y / size) * baseFreq + seed * 1.7;
      const fx = x / size, fy = y / size; // plain UV, independent of baseFreq — what the new primitives key off
      // aniso stretches the coordinates fed to the base fBm itself (not an
      // added layer), since it's meant to distort the noise, not sit on top of it.
      const ax = aniso ? nx * (aniso.x ?? 1) : nx;
      const ay = aniso ? ny * (aniso.y ?? 1) : ny;
      let h = fbm(ax, ay, oct);
      // fine grain
      h += 0.12 * fbm(ax * 6.3, ay * 6.3, 3);
      if (streaks) { // vertical grime streaks — keyed off nx/ny (unstretched) so grime direction doesn't rotate with aniso
        const s = fbm(nx * 0.6 + 11, ny * 0.15 + 3, 4);
        h -= streaks * Math.max(0, s - 0.55) * (0.5 + 0.5 * fbm(nx * 3, ny * 0.4, 2));
      }
      // Optional structure/detail primitives — all off by default, so
      // existing callers (none of which set these) are bit-for-bit unchanged.
      if (ribs) { // accepts a single descriptor or an array (e.g. two crossed axes for a tread-plate lattice)
        for (const r of (Array.isArray(ribs) ? ribs : [ribs])) h += ribsHeight(fx, fy, r);
      }
      if (grid) h += gridHeight(fx, fy, grid);
      if (spangle) h += spangleHeight(fx, fy, spangle);
      if (scratches) h += scratchesHeight(fx, fy, scratches);
      if (dents) h += dentsHeight(fx, fy, dents);
      if (perforate) h += perforateHeight(fx, fy, perforate);
      if (grain) h += grainHeight(fx, fy, grain);
      if (speckle) h += speckleHeight(fx, fy, speckle);
      H[y * size + x] = Math.min(1, Math.max(0, h));
    }
  }

  const alb = canvas(size), rgh = canvas(size), nrm = canvas(size);
  const ac = alb.getContext('2d'), rc = rgh.getContext('2d'), nc = nrm.getContext('2d');
  const aI = ac.createImageData(size, size), rI = rc.createImageData(size, size), nI = nc.createImageData(size, size);

  const idx = (x, y) => ((y + size) % size) * size + ((x + size) % size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const h = H[y * size + x];

      // albedo: base tint modulated by height + variation
      const shade = 0.55 + 0.9 * (h - 0.5);
      aI.data[i]     = Math.max(0, Math.min(255, tint[0] * shade + (h - 0.5) * tintVar));
      aI.data[i + 1] = Math.max(0, Math.min(255, tint[1] * shade + (h - 0.5) * tintVar));
      aI.data[i + 2] = Math.max(0, Math.min(255, tint[2] * shade + (h - 0.5) * tintVar));
      aI.data[i + 3] = 255;

      // roughness
      const r = roughBase + (h - 0.5) * roughVar;
      const rv = Math.max(0, Math.min(255, r * 255));
      rI.data[i] = rI.data[i + 1] = rI.data[i + 2] = rv; rI.data[i + 3] = 255;

      // normal from Sobel gradient of the height field
      const hl = H[idx(x - 1, y)], hr = H[idx(x + 1, y)];
      const hu = H[idx(x, y - 1)], hd = H[idx(x, y + 1)];
      let nxv = (hl - hr) * normalScale, nyv = (hu - hd) * normalScale, nzv = 1;
      const len = Math.hypot(nxv, nyv, nzv) || 1;
      nI.data[i]     = ((nxv / len) * 0.5 + 0.5) * 255;
      nI.data[i + 1] = ((nyv / len) * 0.5 + 0.5) * 255;
      nI.data[i + 2] = ((nzv / len) * 0.5 + 0.5) * 255;
      nI.data[i + 3] = 255;
    }
  }
  ac.putImageData(aI, 0, 0); rc.putImageData(rI, 0, 0); nc.putImageData(nI, 0, 0);

  const mk = (cv) => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;                 // 8 doubled the fetch cost for no visible gain
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.colorSpace = THREE.NoColorSpace;
    return t;
  };
  const map = mk(alb); map.colorSpace = THREE.SRGBColorSpace;
  return { map, roughnessMap: mk(rgh), normalMap: mk(nrm) };
}

// ---------------------------------------------------------------------------
// A NOTE ON roughBase, LEARNT THE HARD WAY
//
// three.js MULTIPLIES material.roughness by the green channel of roughnessMap —
// it does not replace it. So a map authored with roughBase 0.32 caps every
// material built on it at 0.32 effective roughness however high a number the
// material writes, and there is no way back because roughness clamps at 1.0.
// Measured: a frame asking for 0.88 was rendering at 0.297 and blowing out to
// white under the torch.
//
// The maps that stand for MATTE industrial surfaces therefore sit at 0.84-0.90
// here. The two that are genuinely glossy (brushedAlu, techPlastic) are left low
// on purpose — for those the answer is a dark albedo, not a rougher map.
// ---------------------------------------------------------------------------
let _cache = null;
export function buildTextures() {
  if (_cache) return _cache;
  // 1024 for the two surfaces that cover the whole room: at 512 the grain was
  // visibly soft under a raking flashlight. More octaves = finer detail that
  // survives close inspection.
  const concrete = surface(1024, {
    baseFreq: 7, oct: 7, tint: [44, 46, 52], tintVar: 34,
    roughBase: 0.92, roughVar: 0.2, normalScale: 3.8, seed: 3, streaks: 1.6,
  });
  const metal = surface(512, {
    baseFreq: 4, oct: 6, tint: [50, 52, 60], tintVar: 50,
    roughBase: 0.55, roughVar: 0.42, normalScale: 3.0, seed: 17, streaks: 1.1,
  });
  const rust = surface(256, {
    baseFreq: 6, oct: 4, tint: [80, 48, 30], tintVar: 66,
    roughBase: 0.95, roughVar: 0.1, normalScale: 3.6, seed: 42, streaks: 0.6,
  });
  // Dark mottled "skin" for creatures — reads as flesh, not a white block.
  const skin = surface(256, {
    baseFreq: 7, oct: 5, tint: [26, 16, 16], tintVar: 40,
    roughBase: 0.7, roughVar: 0.3, normalScale: 4.0, seed: 91, streaks: 0.3,
  });

  // --- extended material set -------------------------------------------
  // 256 by default; 512 only for maps meant to tile across large areas
  // (paintedSheet, tiledConcrete, corrugated) — the renderer draws this
  // scene 4x per frame for the CAVE rig, so texture memory is a real cost.
  // None of the 512s use the neighbour-search primitives (spangle/
  // scratches/dents), so generation stays cheap even at that size.

  // Zinc spangle: cool, semi-matte, fine cellular crystallites catch the light
  // as flat facets rather than a mottled blur.
  const galvanised = surface(256, {
    baseFreq: 3, oct: 4, tint: [165, 170, 178], tintVar: 20,
    roughBase: 0.90, roughVar: 0.12, normalScale: 2.2, seed: 101,
    spangle: { scale: 16, amount: 0.38 },
  });
  // Smooth painted coat: lowest baseFreq/oct in the set (orange-peel only,
  // no coarse mottle) plus a handful of hard chips exposing the substrate.
  const paintedSheet = surface(512, {
    baseFreq: 2, oct: 3, tint: [150, 148, 138], tintVar: 14,
    roughBase: 0.86, roughVar: 0.10, normalScale: 1.6, seed: 102,
    speckle: { density: 9, size: 0.12, amount: 0.22 },
  });
  // Paint failing over rust: speckle amount cranked hard (0.6) so the
  // per-cell mask reads as large hard-edged flakes, not fine grain, and huge
  // tintVar turns each flake into a genuinely different colour, not just shade.
  const chippedPaint = surface(256, {
    baseFreq: 5, oct: 4, tint: [92, 58, 36], tintVar: 70,
    roughBase: 0.75, roughVar: 0.3, normalScale: 3.4, seed: 103, streaks: 0.4,
    speckle: { density: 8, size: 0.4, amount: 0.6 },
    dents: { count: 5, radius: 0.1, depth: 0.12 },
  });
  // Brushed aluminium: aniso stretches the base fBm ~440:1 into fine
  // unidirectional streaks, reinforced by a grain layer on the same axis.
  const brushedAlu = surface(256, {
    baseFreq: 2, oct: 3, tint: [192, 194, 198], tintVar: 10,
    roughBase: 0.22, roughVar: 0.08, normalScale: 2.6, seed: 104,
    aniso: { x: 22, y: 0.05 },
    grain: { axis: 'y', freq: 36, amount: 0.14 },
  });
  // Cast iron: coarsest baseFreq/oct of the whole set — reads as sandy
  // aggregate rather than smooth mottle — plus fine pitting from casting sand.
  const castIron = surface(256, {
    baseFreq: 9, oct: 5, tint: [58, 56, 54], tintVar: 36,
    roughBase: 0.9, roughVar: 0.12, normalScale: 3.2, seed: 105,
    speckle: { density: 26, size: 0.3, amount: 0.1 },
  });
  // Timber: directional fibre plus faint cross-grain growth rings (a
  // low-depth rib wave running perpendicular to the grain axis).
  const timber = surface(256, {
    baseFreq: 3, oct: 4, tint: [118, 78, 42], tintVar: 26,
    roughBase: 0.88, roughVar: 0.14, normalScale: 2.8, seed: 106,
    grain: { axis: 'y', freq: 14, amount: 0.4 },
    ribs: { axis: 'x', period: 4, depth: 0.05, profile: 'round' },
  });
  // Plywood: finer, lighter fibre than timber, rotated 90 degrees, with a
  // blotchier base layer (higher oct + streaks) standing in for ply layers.
  const plywood = surface(256, {
    baseFreq: 6, oct: 5, tint: [176, 148, 104], tintVar: 34,
    roughBase: 0.89, roughVar: 0.14, normalScale: 2.4, seed: 107, streaks: 0.3,
    grain: { axis: 'x', freq: 30, amount: 0.18 },
  });
  // Rubber: lowest normalScale/roughVar in the set — deliberately near-flat
  // — with only fine speckled pitting to keep it from reading as a flat void.
  const rubber = surface(256, {
    baseFreq: 2, oct: 3, tint: [24, 24, 26], tintVar: 8,
    roughBase: 0.95, roughVar: 0.05, normalScale: 1.2, seed: 108,
    speckle: { density: 44, size: 0.22, amount: 0.05 },
  });
  // Moulded tech plastic: gentle aniso for faint mould-flow lines, kept at
  // low amplitude (small normalScale) so it stays flatter than brushedAlu.
  const techPlastic = surface(256, {
    baseFreq: 2, oct: 3, tint: [112, 114, 120], tintVar: 10,
    roughBase: 0.28, roughVar: 0.1, normalScale: 1.4, seed: 109,
    aniso: { x: 4, y: 0.4 },
  });
  // Diamond plate: two ribs descriptors crossed x/y with a square profile
  // form a raised lattice — the only map using ribs' array form.
  const diamondPlate = surface(256, {
    baseFreq: 4, oct: 3, tint: [100, 102, 106], tintVar: 16,
    roughBase: 0.87, roughVar: 0.14, normalScale: 3.0, seed: 110,
    ribs: [
      { axis: 'x', period: 9, depth: 0.24, profile: 'square' },
      { axis: 'y', period: 9, depth: 0.24, profile: 'square' },
    ],
    speckle: { density: 20, size: 0.18, amount: 0.06 },
  });
  // Perforated sheet: the only map built around the regular punched-hole grid.
  const perfSheet = surface(256, {
    baseFreq: 3, oct: 3, tint: [124, 126, 132], tintVar: 14,
    roughBase: 0.88, roughVar: 0.12, normalScale: 2.6, seed: 111,
    perforate: { period: 11, radius: 0.24, depth: 0.55 },
  });
  // Tiled concrete: same family as `concrete` but the slab grid dominates —
  // reads as a floor of visible tiles rather than a monolithic pour. 512
  // because it's meant to cover whole floors/walls.
  const tiledConcrete = surface(512, {
    baseFreq: 6, oct: 6, tint: [96, 92, 86], tintVar: 30,
    roughBase: 0.86, roughVar: 0.18, normalScale: 3.4, seed: 112, streaks: 1.0,
    grid: { u: 5, v: 5, groove: 0.045, depth: 0.4 },
  });
  // Corrugated cladding: a single large-period, deep rib wave. 512 because
  // it's meant to cover whole wall panels — a soft-looking rib at 256 read
  // blocky under a raking light.
  const corrugated = surface(512, {
    baseFreq: 3, oct: 4, tint: [108, 116, 122], tintVar: 18,
    roughBase: 0.88, roughVar: 0.14, normalScale: 2.8, seed: 113, streaks: 0.6,
    ribs: { axis: 'y', period: 16, depth: 0.48, profile: 'round' },
  });
  // Greasy metal: same base character as `metal` but streaks cranked far
  // higher — dark oily contamination dominates rather than being an accent.
  const greasyMetal = surface(256, {
    baseFreq: 4, oct: 5, tint: [42, 42, 46], tintVar: 44,
    roughBase: 0.84, roughVar: 0.22, normalScale: 2.8, seed: 114, streaks: 2.4,
  });
  // Sooted steel: darkest of the streaked-metal trio, higher roughBase than
  // greasyMetal (soot is matte, not oily) — the two shouldn't read as the same substance.
  const sootedSteel = surface(256, {
    baseFreq: 5, oct: 5, tint: [26, 26, 28], tintVar: 30,
    roughBase: 0.8, roughVar: 0.16, normalScale: 3.0, seed: 115, streaks: 2.0,
  });

  _cache = {
    concrete, metal, rust, skin,
    galvanised, paintedSheet, chippedPaint, brushedAlu, castIron,
    timber, plywood, rubber, techPlastic, diamondPlate,
    perfSheet, tiledConcrete, corrugated, greasyMetal, sootedSteel,
  };
  return _cache;
}
