// =============================================================================
// enemy.js — One creature. A procedural, ANIMATED model (fleshy dark skin, gaunt
// distorted anatomy, glowing eyes) that idles (sways / breathes / twitches) and
// lurches as it advances — read as alive, not a white box. If a type sets
// `modelUrl`, a real .glb is loaded via GLTFLoader and its clip is played
// instead (drop-in for CC0 models). State machine unchanged:
//   LURK → (light dwells) BANISHED  |  reaches player → ATTACK (jumpscare).
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { buildTextures } from '../world/textures.js';
import { clamp, randRange, pick, smoothstep } from '../core/util.js';

const eyeMat = (c) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false });
const box = (w, hh, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), m);

function skinMaterial() {
  const t = buildTextures().skin;
  const map = t.map.clone(); map.needsUpdate = true; map.wrapS = map.wrapT = THREE.RepeatWrapping; map.repeat.set(2, 2);
  const nrm = t.normalMap.clone(); nrm.needsUpdate = true; nrm.wrapS = nrm.wrapT = THREE.RepeatWrapping; nrm.repeat.set(2, 2);
  return new THREE.MeshStandardMaterial({ map, normalMap: nrm, color: 0x3a2422, roughness: 0.85, metalness: 0.0, normalScale: new THREE.Vector2(1.6, 1.6) });
}

// All models: feet at y=0, FRONT toward -Z (lookAt aims the face at the player).
function buildModel(kind, eyeColor) {
  const g = new THREE.Group();
  const m = skinMaterial();
  const em = eyeMat(eyeColor);
  const eyes = [];
  const addEyes = (parent, y, z, sep, r) => { for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 10), em); e.position.set(sx * sep, y, z); parent.add(e); eyes.push(e); } };
  const parts = {};

  if (kind === 'crawler') {
    const body = box(0.5, 0.16, 0.42, m); body.position.set(0, 0.26, 0.02); g.add(body); parts.torso = body;
    const head = box(0.26, 0.18, 0.24, m); head.position.set(0, 0.24, -0.3); g.add(head); parts.head = head;
    const jaw = box(0.2, 0.06, 0.16, m); jaw.position.set(0, 0.15, -0.36); jaw.rotation.x = 0.3; g.add(jaw); parts.jaw = jaw;
    parts.legs = [];
    for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) {
      const hip = new THREE.Group(); hip.position.set(sx * 0.22, 0.26, -0.14 + i * 0.18); g.add(hip);
      const seg = box(0.045, 0.045, 0.4, m); seg.position.z = 0.0; seg.rotation.x = 0.7; seg.rotation.z = sx * 0.6; hip.add(seg); parts.legs.push({ hip, ph: i });
    }
    addEyes(head, 0.02, -0.13, 0.055, 0.034);
  } else if (kind === 'peeker') {
    const head = box(0.28, 0.4, 0.26, m); head.position.set(0, 0, 0); g.add(head); parts.head = head;
    const jaw = box(0.22, 0.12, 0.2, m); jaw.position.set(0, -0.24, -0.02); g.add(jaw); parts.jaw = jaw;
    const hand = box(0.1, 0.34, 0.05, m); hand.position.set(-0.24, -0.3, 0.02); hand.rotation.z = 0.3; g.add(hand);
    addEyes(head, 0.06, -0.14, 0.07, 0.05);
    parts.headOnly = true;
  } else { // watcher / runner — tall, gaunt, hunched, arms past the knees
    for (const sx of [-1, 1]) { const leg = box(0.07, 0.94, 0.08, m); leg.position.set(sx * 0.09, 0.47, 0); g.add(leg); }
    const hip = box(0.26, 0.32, 0.16, m); hip.position.set(0, 1.06, 0.02); g.add(hip);
    const chest = box(0.3, 0.46, 0.17, m); chest.position.set(0, 1.42, -0.04); chest.rotation.x = -0.14; g.add(chest); parts.torso = chest;
    parts.arms = [];
    for (const sx of [-1, 1]) {
      const sh = new THREE.Group(); sh.position.set(sx * 0.19, 1.58, -0.02); g.add(sh);
      const up = box(0.055, 0.5, 0.06, m); up.geometry.translate(0, -0.25, 0); up.rotation.x = 0.25; sh.add(up);
      const fo = box(0.05, 0.5, 0.05, m); fo.geometry.translate(0, -0.25, 0); fo.position.y = -0.5; fo.rotation.x = 0.15; up.add(fo);
      parts.arms.push({ sh, sx });
    }
    const neck = box(0.06, 0.18, 0.06, m); neck.position.set(0, 1.68, -0.04); neck.rotation.x = 0.32; g.add(neck);
    const head = box(0.16, 0.22, 0.19, m); head.position.set(0, 1.79, -0.11); head.rotation.x = 0.3; g.add(head); parts.head = head;
    const jaw = box(0.12, 0.07, 0.14, m); jaw.position.set(0, 1.68, -0.16); jaw.rotation.x = 0.3; g.add(jaw); parts.jaw = jaw;
    addEyes(head, 0.0, -0.12, 0.05, 0.055);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData = { eyes, eyeMat: em, eyeBase: new THREE.Color(eyeColor), parts, kind };
  return g;
}

export const EnemyState = { LURK: 0, BANISHED: 1, ATTACK: 2, DONE: 3 };

export class Enemy {
  constructor(type, anchor, scene, eye, rng, advanceMul, cueMul) {
    this.type = type; this.anchor = anchor; this.scene = scene; this.eye = eye; this.rng = rng;
    this.state = EnemyState.LURK;
    this.p = 0; this.dwell = 0; this.advanceMul = advanceMul; this.cueMul = cueMul;
    this.advanceTimer = randRange(rng, ...type.advanceInterval);
    this.cueTimer = randRange(rng, ...type.cueInterval) * 0.6;
    this.lit = 0; this._ph = rng() * 10; this._lurch = 0; this._mixer = null; this._clip = null;

    this.model = buildModel(type.model, type.eyeColor);
    const a = anchor.pos.clone();
    this.start = a.clone().addScaledVector(anchor.face, -0.25);
    const toEye = eye.clone(); toEye.y = a.y;
    const from = a.clone().sub(eye); from.y = 0; from.setLength(0.5);
    this.end = toEye.add(from);
    this._headOffset = type.model === 'crawler' ? 0.24 : type.model === 'peeker' ? 0.0 : 1.74;
    this._place();
    scene.add(this.model);

    if (type.modelUrl) this._loadGLB(type.modelUrl);
  }

  async _loadGLB(url) {
    try {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const gltf = await new GLTFLoader().loadAsync(url);
      const root = gltf.scene;
      // normalize height to ~1.9 (watcher) / 0.5 (crawler) / 0.5 (peeker)
      const bb = new THREE.Box3().setFromObject(root); const size = new THREE.Vector3(); bb.getSize(size);
      const targetH = this.type.model === 'crawler' ? 0.55 : this.type.model === 'peeker' ? 0.6 : 1.9;
      const s = targetH / (size.y || 1); root.scale.setScalar(s);
      root.position.y = -bb.min.y * s;
      root.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; if (o.material) { o.material.color = new THREE.Color(0x4a3030); o.material.roughness = 0.85; } } });
      // swap: keep the glowing eyes group, drop procedural body meshes
      const keep = new Set(this.model.userData.eyes);
      [...this.model.children].forEach((c) => { if (!keep.has(c) && !(c.userData && c.userData._keepEyes)) this.model.remove(c); });
      const holder = new THREE.Group(); holder.add(root); this.model.add(holder); this.model.userData.glb = holder;
      if (gltf.animations && gltf.animations.length) { this._mixer = new THREE.AnimationMixer(root); this._mixer.clipAction(gltf.animations[0]).play(); }
    } catch (e) { /* keep procedural fallback */ }
  }

  _place() {
    const pos = this.start.clone().lerp(this.end, smoothstep(0, 1, this.p));
    this.model.position.copy(pos);
    this.model.lookAt(this.eye.x, pos.y, this.eye.z);
    this.worldHead = pos.clone(); this.worldHead.y = pos.y + this._headOffset;
    this._basePos = pos.clone();
  }

  update(dt, flashlight, bus) {
    if (this.state !== EnemyState.LURK) return null;
    const ev = [];
    this.lit = flashlight.litAmount(this.worldHead);
    const k = Math.min(1, 0.4 + this.p * 0.5 + (this.lit > 0.3 ? 0.35 : 0));
    this.model.userData.eyeMat.color.copy(this.model.userData.eyeBase).multiplyScalar(k);

    if (this.lit > 0.35) {
      this.dwell += dt * this.lit;
      if (this.dwell >= this.type.banishTime) { this.state = EnemyState.BANISHED; ev.push({ type: 'banish', payload: { pan: this.anchor.pan, name: this.type.name } }); return ev; }
    } else {
      this.dwell = Math.max(0, this.dwell - dt * 0.5);
      this.advanceTimer -= dt * this.advanceMul * this.type.speedMul;
      if (this.advanceTimer <= 0) {
        this.advanceTimer = randRange(this.rng, ...this.type.advanceInterval);
        this.p = clamp(this.p + this.type.advanceStep, 0, 1); this._place(); this._lurch = 1;
        ev.push({ type: 'cue', payload: { sound: pick(this.rng, this.type.cues), pan: this.anchor.pan, muffle: (1 - this.p) * 0.4 } });
        ev.push({ type: 'approach', payload: { p: this.p, anchor: this.anchor.name } });
        if (this.p >= 1) { this.state = EnemyState.ATTACK; ev.push({ type: 'scare', payload: { type: this.type, pan: this.anchor.pan } }); return ev; }
      }
    }
    this.cueTimer -= dt;
    if (this.cueTimer <= 0) { this.cueTimer = randRange(this.rng, ...this.type.cueInterval) * this.cueMul; ev.push({ type: 'cue', payload: { sound: pick(this.rng, this.type.cues), pan: this.anchor.pan, muffle: 0.3 + (1 - this.p) * 0.3 } }); }
    return ev;
  }

  // Idle "alive" motion + banish retreat. Called every frame.
  animate(dt, t) {
    if (this._mixer) this._mixer.update(dt);
    if (this.state === EnemyState.BANISHED) {
      this.p = Math.max(0, this.p - dt * 2.4); this._place();
      this.model.userData.eyeMat.color.multiplyScalar(Math.max(0, 1 - dt * 3));
      if (this.p <= 0.001) this.state = EnemyState.DONE;
      return;
    }
    if (this.state !== EnemyState.LURK) return;
    this._lurch = Math.max(0, this._lurch - dt * 2.5);
    const ph = t * 1.1 + this._ph;
    const P = this.model.userData.parts || {};
    // whole-body sway + a forward lurch pulse when it just advanced
    this.model.position.y = this._basePos.y + Math.sin(ph * 2) * 0.008 + this._lurch * 0.05;
    this.model.rotation.z = Math.sin(ph * 0.7) * 0.02;
    if (!this._mixer) {
      if (P.torso) P.torso.scale.y = 1 + Math.sin(ph * 2.2) * 0.03;                 // breathing
      if (P.head) { P.head.rotation.z = Math.sin(ph * 0.9) * 0.05; P.head.rotation.y = Math.sin(ph * 0.37) * 0.12; }
      if (P.jaw) P.jaw.rotation.x = 0.3 + (0.5 + 0.5 * Math.sin(ph * 3.3)) * 0.25 * (this.lit > 0.3 ? 1 : 0.3); // agape when lit
      if (P.arms) P.arms.forEach((a, i) => { a.sh.rotation.x = Math.sin(ph * 1.3 + i) * 0.08; a.sh.rotation.z = a.sx * (0.05 + this._lurch * 0.2); });
      if (P.legs) P.legs.forEach((l) => { l.hip.rotation.x = Math.sin(ph * 3 + l.ph) * 0.18 * (this._lurch + 0.15); });
      // twitch: rare fast head jerk
      if (this.rng() < 0.006 && P.head) P.head.rotation.z += (this.rng() - 0.5) * 0.4;
    }
    for (const e of this.model.userData.eyes) e.visible = true;
  }

  dispose() {
    this.scene.remove(this.model);
    this.model.traverse((o) => { if (o.isMesh) { o.geometry?.dispose?.(); o.material?.dispose?.(); } });
  }
}
