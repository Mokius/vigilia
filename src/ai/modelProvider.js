// =============================================================================
// modelProvider.js — PLUG AND PLAY asset resolution.
//
// Each creature declares a list of candidate model URLs. We probe them in order
// and the first that actually loads wins; if none do, the caller falls back to
// the procedural creature. So the moment real Mixamo GLBs are dropped into
// assets/models/ they are picked up with ZERO code changes.
//
// Also here:
//  • bindClips(): fuzzy-matches whatever animation clips a model happens to
//    ship with against the behaviour intents the AI needs (walk/idle/scream…),
//    so we never hard-code clip names we can't verify.
//  • measureHeight(): robust height measurement. Box3.setFromObject() can
//    report ZERO for skinned meshes (verified during Fase 0), so we fall back
//    to per-geometry bind-pose bounds before giving up.
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';

let _loaderPromise = null;
async function loader() {
  if (!_loaderPromise) {
    _loaderPromise = import('three/addons/loaders/GLTFLoader.js')
      .then((m) => new m.GLTFLoader());
  }
  return _loaderPromise;
}

// Cheap existence probe so a missing local file doesn't spam loader errors.
async function exists(url) {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    if (r.ok) return true;
    // Some static hosts don't implement HEAD; retry with a tiny ranged GET.
    const g = await fetch(url, { headers: { Range: 'bytes=0-0' } });
    return g.ok;
  } catch { return false; }
}

// Parse each model ONCE and hand out skeleton-aware clones. Without this, four
// creatures using the same file meant four parses and four texture uploads.
const _cache = new Map();     // url -> { scene, animations }
let _skelUtils = null;

async function skeletonUtils() {
  if (!_skelUtils) _skelUtils = await import('three/addons/utils/SkeletonUtils.js');
  return _skelUtils;
}

async function instantiate(entry, url) {
  const { clone } = await skeletonUtils();
  const root = clone(entry.scene);
  // Clone materials per instance so one creature fading out doesn't fade them
  // all — textures stay shared, which is the part that actually costs memory.
  root.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
  });
  return { scene: root, animations: entry.animations, url };
}

/** Load the first candidate URL that works. Returns null if none do. */
export async function loadFirst(urls) {
  if (!urls || !urls.length) return null;
  for (const url of urls) {
    if (_cache.has(url)) return instantiate(_cache.get(url), url);
  }
  const L = await loader();
  for (const url of urls) {
    if (!/^https?:/i.test(url) && !(await exists(url))) continue;
    try {
      const gltf = await L.loadAsync(url);
      const entry = { scene: gltf.scene, animations: gltf.animations || [] };
      _cache.set(url, entry);
      return instantiate(entry, url);
    } catch (e) {
      if (CONFIG.debug) console.warn('[model] failed', url, e);
    }
  }
  return null;
}

/** Robust height in world units, or null if unmeasurable. */
export function measureHeight(root) {
  root.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(root, true);
  let h = box.max.y - box.min.y;
  if (Number.isFinite(h) && h > 0.05) return { height: h, minY: box.min.y };

  // Fallback: skinned meshes can report an empty/degenerate world box.
  box = new THREE.Box3();
  let any = false;
  root.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    const g = o.geometry; if (!g) return;
    if (!g.boundingBox) g.computeBoundingBox();
    if (!g.boundingBox) return;
    const b = g.boundingBox.clone().applyMatrix4(o.matrixWorld);
    box.union(b); any = true;
  });
  if (!any) return null;
  h = box.max.y - box.min.y;
  return (Number.isFinite(h) && h > 0.05) ? { height: h, minY: box.min.y } : null;
}

/**
 * Scale to `targetHeight`, sit the feet on y=0, enable shadows and sink the
 * albedo so a textured realistic model reads as something wet in the dark
 * (we TINT rather than replace, to keep the detail we paid for).
 */
export function prepareModel(root, targetHeight, { darken = 0.15, roughness = 0.97 } = {}) {
  const m = measureHeight(root);
  if (m) {
    const s = targetHeight / m.height;
    root.scale.multiplyScalar(s);
    root.updateMatrixWorld(true);
    const m2 = measureHeight(root);
    if (m2) root.position.y -= m2.minY;
  }
  root.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    o.frustumCulled = false;               // skinned bounds are unreliable
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const mat of mats) {
      if (!mat) continue;
      // Opaque, heavy, physically plain: same treatment as the room's surfaces.
      // Anything shiny or emissive made them read as lit props floating in the
      // scene instead of objects standing in it.
      if (mat.color) mat.color.multiplyScalar(darken);
      if ('roughness' in mat) mat.roughness = roughness;
      if ('metalness' in mat) mat.metalness = 0.05;
      if (mat.emissive) { mat.emissive.setRGB(0, 0, 0); mat.emissiveIntensity = 0; }
      if (mat.envMapIntensity !== undefined) mat.envMapIntensity = 0.15;
      if ('sheen' in mat) mat.sheen = 0;
      if ('clearcoat' in mat) mat.clearcoat = 0;
      if ('specularIntensity' in mat) mat.specularIntensity = 0.06;
      if ('reflectivity' in mat) mat.reflectivity = 0.05;
      if (mat.normalScale) mat.normalScale.multiplyScalar(0.8);   // calmer highlights
      mat.needsUpdate = true;
    }
  });
  return !!m;
}

// ---------------------------------------------------------------------------
// THE CLIP PLAN
//
// One entry per behaviour the AI can ask for, chosen by watching what each clip
// in the pack actually does and how long it runs — not by trusting its filename.
// Mixamo exports every take as `Armature|mixamo.com|Layer0`, so the conversion
// renames each action after its source file and this table addresses those names.
//
//   clip   source action name (from tools/mixamo_to_glb.py)
//   rate   playback speed; NEGATIVE plays the clip backwards
//   loop   cycle or play once and hold the last pose
//   range  [from, to] in SECONDS — a sub-clip, for when only part of a take is
//          the beat we want
//
// FOUR BEHAVIOURS HAVE NO CLIP in this pack and are honestly not faked here:
// peeking round a door, turning the head, looking at the player and backing
// away. The first three are driven procedurally from the head/neck bones (see
// enemy.js aimHead), which layers over whatever cycle is playing; the retreat is
// the walk cycle run in reverse, which is what `rate: -1` is for.
// ---------------------------------------------------------------------------
export const CLIP_PLAN = {
  // waiting, watching. The only neutral cycle in the pack.
  idle:      { clip: 'zombie_idle',      rate: 1.00, loop: true },
  // POSITION 1, far away: the slow arrival. A 5.1 s crawl read at a third speed
  // is a heavy, laboured emergence — much better than any idle for "it is here".
  far:       { clip: 'zombie_crawl',     rate: 0.34, loop: true },
  // coming out of a duct or a pit: the first two seconds of the crawl, which is
  // where the take pushes up off the ground
  emerge:    { clip: 'zombie_crawl',     rate: 0.55, loop: false, range: [0.0, 2.0] },
  crawl:     { clip: 'zombie_crawl',     rate: 0.85, loop: true },
  // the fast crawl: a 0.67 s cycle, which is what a dash between stations needs
  crawlFast: { clip: 'running_crawl',    rate: 1.15, loop: true },
  // POSITION 2, closing in
  walk:      { clip: 'zombie_walk',      rate: 1.00, loop: true },
  // POSITION 3 and dashes: 25 frames, tight enough to read at speed
  run:       { clip: 'zombie_run',       rate: 1.00, loop: true },
  // the warning cry at mid distance
  scream:    { clip: 'zombie_scream',    rate: 1.00, loop: false },
  // the strike that happens if the player never answers
  attack:    { clip: 'zombie_attack',    rate: 1.05, loop: false },
  // THE SCREAMER. Simple and violent beats elaborate: `neck bite` and `biting_2`
  // both throw the arms forward, and at the range this is staged at that put the
  // player INSIDE the creature's own limbs — the clearance solver then had to
  // push it back to 0.8 m and the whole point of the shot was lost. These two
  // takes keep the movement in the head and torso, so the face can stay right up
  // against the camera where it belongs.
  jumpscare: { clip: 'zombie_scream', rate: 1.20, loop: false, range: [0.25, 1.85] },
  jumpscareB:{ clip: 'zombie_attack', rate: 1.15, loop: false, range: [0.55, 2.10] },
  // DRIVEN OFF BY THE LIGHT: no retreat take exists, so the walk runs backwards.
  retreat:   { clip: 'zombie_walk',      rate: -1.55, loop: true },
  // and the same idea for anything on the floor: a crawler backs INTO its hole
  // rather than standing up to leave
  retreatCrawl: { clip: 'zombie_crawl',   rate: -1.45, loop: true },
  // and when the beam finally breaks it, it goes down
  banish:    { clip: 'zombie_dying',     rate: 1.35, loop: false },
  death:     { clip: 'zombie_death',     rate: 1.00, loop: false },
  // straining at a gap: idle slowed right down, with the head aim doing the work
  peek:      { clip: 'zombie_idle',      rate: 0.45, loop: true },
  climb:     { clip: 'zombie_walk',      rate: 0.75, loop: true },
};

// Fallback for a pack we have never seen: guess from clip names as before, so
// dropping in some other character still produces something that moves.
const INTENT_KEYS = {
  idle:   ['idle', 'breath', 'stand', 'neutral', 'tpose', 'pose'],
  walk:   ['walk', 'stagger', 'shamble', 'stalk', 'move', 'run', 'sneak'],
  crawl:  ['crawl', 'creep', 'prone', 'ground', 'floor'],
  climb:  ['climb', 'vault', 'jump', 'clamber', 'hang', 'crawl'],
  scream: ['scream', 'yell', 'shout', 'roar', 'attack', 'bite', 'lunge', 'punch', 'kick'],
  peek:   ['peek', 'look', 'turn', 'head', 'agree', 'react'],
  death:  ['death', 'die', 'fall', 'dying'],
};

function scoreName(name, keys) {
  const n = String(name).toLowerCase();
  let best = 0;
  keys.forEach((k, i) => {
    if (n === k) best = Math.max(best, 100 - i);
    else if (n.includes(k)) best = Math.max(best, 60 - i);
  });
  return best;
}

const FPS = 30;   // Mixamo takes are authored and exported at 30 fps

/**
 * Resolve the behaviour intents against the clips a model actually ships.
 *
 * Returns { <intent>: { clip, rate, loop } }, plus `all` (the raw clip names)
 * and `plan` (true when the explicit table matched, false when we fell back to
 * guessing from names). Sub-clips are cut once, here, and cached on the entry —
 * AnimationUtils.subclip copies keyframes, so doing it per playback would churn.
 */
export function bindClips(animations) {
  const list = animations || [];
  const byName = new Map(list.map((c) => [c.name, c]));
  const out = { all: list.map((c) => c.name), plan: false, missing: [] };

  // --- preferred path: the explicit plan --------------------------------------
  let matched = 0;
  for (const [intent, spec] of Object.entries(CLIP_PLAN)) {
    const src = byName.get(spec.clip);
    if (!src) { out.missing.push(intent + '<-' + spec.clip); continue; }
    let clip = src;
    if (spec.range) {
      const a = Math.max(0, Math.round(spec.range[0] * FPS));
      const b = Math.min(Math.round(src.duration * FPS), Math.round(spec.range[1] * FPS));
      if (b > a + 1) clip = THREE.AnimationUtils.subclip(src, intent, a, b, FPS);
    }
    out[intent] = { clip, rate: spec.rate, loop: spec.loop };
    matched++;
  }

  if (matched >= 6) {
    out.plan = true;
    // Anything the plan could not fill borrows the nearest thing that exists,
    // so a state always has something to play.
    const sub = (k, ...alts) => { if (!out[k]) for (const a of alts) if (out[a]) { out[k] = out[a]; return; } };
    sub('far', 'crawl', 'idle'); sub('emerge', 'crawl', 'idle');
    sub('crawlFast', 'crawl', 'run', 'walk'); sub('run', 'walk');
    sub('retreat', 'walk', 'idle'); sub('retreatCrawl', 'retreat', 'crawl');
    sub('banish', 'death', 'idle');
    sub('jumpscare', 'scream', 'attack'); sub('jumpscareB', 'jumpscare');
    sub('peek', 'idle'); sub('climb', 'walk');
    return out;
  }

  // --- fallback: an unknown pack. Guess from names, as before. ----------------
  for (const intent of Object.keys(INTENT_KEYS)) {
    let best = null, bestScore = 0;
    for (const c of list) {
      const s = scoreName(c.name, INTENT_KEYS[intent]);
      if (s > bestScore) { bestScore = s; best = c; }
    }
    if (best) out[intent] = { clip: best, rate: 1, loop: intent !== 'scream' && intent !== 'death' };
  }
  if (!out.idle && list.length) out.idle = { clip: list[0], rate: 1, loop: true };
  for (const k of ['walk', 'crawl', 'climb', 'scream', 'peek', 'run', 'far', 'emerge',
                   'crawlFast', 'retreat', 'retreatCrawl', 'banish', 'attack',
                   'jumpscare', 'jumpscareB']) {
    if (!out[k]) out[k] = out.walk || out.idle;
  }
  return out;
}
