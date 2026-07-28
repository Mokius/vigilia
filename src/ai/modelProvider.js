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
export function prepareModel(root, targetHeight, { darken = 0.45, roughness = 0.78 } = {}) {
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
      if (mat.color) mat.color.multiplyScalar(darken);
      if ('roughness' in mat) mat.roughness = roughness;
      if ('metalness' in mat) mat.metalness = Math.min(0.35, mat.metalness ?? 0.1);
      if (mat.emissive) mat.emissive.setRGB(0, 0, 0);
      mat.needsUpdate = true;
    }
  });
  return !!m;
}

// ---------------------------------------------------------------------------
// Fuzzy clip binding: behaviour intent -> whatever the pack actually contains.
// ---------------------------------------------------------------------------
const INTENT_KEYS = {
  idle:   ['idle', 'breath', 'stand', 'neutral', 'tpose', 'pose'],
  walk:   ['walk', 'stagger', 'shamble', 'stalk', 'move', 'run', 'sneak'],
  crawl:  ['crawl', 'creep', 'prone', 'ground', 'floor'],
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

/**
 * Returns { idle: AnimationClip|null, walk: ..., crawl: ..., scream: ..., ... }
 * choosing the best-scoring clip for each intent, with `idle` as the last
 * resort so a state always has something to play.
 */
export function bindClips(animations) {
  const out = {};
  const list = animations || [];
  for (const intent of Object.keys(INTENT_KEYS)) {
    let best = null, bestScore = 0;
    for (const c of list) {
      const s = scoreName(c.name, INTENT_KEYS[intent]);
      if (s > bestScore) { bestScore = s; best = c; }
    }
    out[intent] = best;
  }
  if (!out.idle && list.length) out.idle = list[0];
  // Never leave the critical intents empty if anything at all exists.
  for (const k of ['walk', 'crawl', 'scream', 'peek']) if (!out[k]) out[k] = out.idle;
  out.all = list.map((c) => c.name);
  return out;
}
