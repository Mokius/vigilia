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

// Build a height field, then albedo/roughness/normal from it.
function surface(size, opts) {
  const {
    baseFreq, oct, tint, tintVar, roughBase, roughVar, normalScale, seed = 0, streaks = 0,
  } = opts;
  const H = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x / size) * baseFreq + seed, ny = (y / size) * baseFreq + seed * 1.7;
      let h = fbm(nx, ny, oct);
      // fine grain
      h += 0.12 * fbm(nx * 6.3, ny * 6.3, 3);
      if (streaks) { // vertical grime streaks
        const s = fbm(nx * 0.6 + 11, ny * 0.15 + 3, 4);
        h -= streaks * Math.max(0, s - 0.55) * (0.5 + 0.5 * fbm(nx * 3, ny * 0.4, 2));
      }
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
    t.anisotropy = 4;
    t.colorSpace = THREE.NoColorSpace;
    return t;
  };
  const map = mk(alb); map.colorSpace = THREE.SRGBColorSpace;
  return { map, roughnessMap: mk(rgh), normalMap: mk(nrm) };
}

let _cache = null;
export function buildTextures() {
  if (_cache) return _cache;
  // Dark, grimy, industrial — not clean marble.
  const concrete = surface(512, {
    baseFreq: 5, oct: 5, tint: [44, 46, 52], tintVar: 34,
    roughBase: 0.92, roughVar: 0.18, normalScale: 3.4, seed: 3, streaks: 1.6,
  });
  const metal = surface(512, {
    baseFreq: 3, oct: 5, tint: [50, 52, 60], tintVar: 50,
    roughBase: 0.55, roughVar: 0.4, normalScale: 2.6, seed: 17, streaks: 1.1,
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
  _cache = { concrete, metal, rust, skin };
  return _cache;
}
