// =============================================================================
// enemy.js — One creature: a procedural model (front = local -Z, so lookAt aims
// its eyes at the player) plus a state machine:
//   LURK  → emits directional cues; advances in discrete steps while unobserved
//   (light on it) → freezes and, if the beam dwells long enough, is BANISHED
//   reaches the player → ATTACK (jumpscare)
// Emissive eyes glow through the dark (and get caught by bloom) so you catch a
// glint before you catch the shape.
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { clamp, randRange, pick, smoothstep } from '../core/util.js';

// Near-black, matte: creatures read as a SILHOUETTE + glowing eyes even under
// the flashlight — you sense the shape more than you see it.
const dark = () => new THREE.MeshStandardMaterial({ color: 0x040406, roughness: 1.0, metalness: 0.0 });
// Unlit + toneMapped:false → the eyes render at full colour regardless of scene
// lighting/exposure, so they always glow in the dark and feed the bloom pass.
const eyeMat = (c) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false });
const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);

// All models built with FEET at y=0 and FRONT toward -Z.
function buildModel(kind, eyeColor) {
  const g = new THREE.Group();
  const m = dark();
  const em = eyeMat(eyeColor);
  const eyes = [];
  // Eyes are CHILDREN of the head mesh so they always sit on the face and rotate
  // with it (a bowed head can't hide them). z is pushed in front of the face.
  const addEyes = (parent, y, z, sep, r) => {
    for (const sx of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 10), em);
      e.position.set(sx * sep, y, z); parent.add(e); eyes.push(e);
    }
  };
  if (kind === 'crawler') {
    const body = box(0.55, 0.16, 0.34, m); body.position.set(0, 0.22, 0); g.add(body);
    const head = box(0.24, 0.17, 0.22, m); head.position.set(0, 0.22, -0.28); g.add(head);
    for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) {
      const leg = box(0.04, 0.04, 0.36, m); leg.position.set(sx * 0.24, 0.16, -0.15 + i * 0.18);
      leg.rotation.z = sx * 0.5; leg.rotation.x = 0.5; g.add(leg);
    }
    addEyes(head, 0.01, -0.13, 0.055, 0.032);
  } else if (kind === 'peeker') {
    const head = box(0.26, 0.34, 0.24, m); head.position.set(0, 0, 0); g.add(head);
    const jaw = box(0.2, 0.08, 0.18, m); jaw.position.set(0, -0.2, -0.02); g.add(jaw);
    addEyes(head, 0.06, -0.14, 0.07, 0.042);
  } else { // watcher — tall, gaunt, slightly hunched, arms hanging past the knees
    for (const sx of [-1, 1]) { const leg = box(0.075, 0.92, 0.09, m); leg.position.set(sx * 0.08, 0.46, 0); g.add(leg); }
    // tapered torso (two stacked boxes) leaning forward
    const hip = box(0.28, 0.34, 0.17, m); hip.position.set(0, 1.06, 0.02); g.add(hip);
    const chest = box(0.32, 0.44, 0.18, m); chest.position.set(0, 1.42, -0.03); chest.rotation.x = -0.12; g.add(chest);
    // long thin arms hanging low, slightly forward
    for (const sx of [-1, 1]) {
      const upper = box(0.06, 0.5, 0.07, m); upper.position.set(sx * 0.2, 1.36, 0.0); upper.rotation.x = 0.2; g.add(upper);
      const fore = box(0.055, 0.52, 0.06, m); fore.position.set(sx * 0.235, 0.92, 0.08); fore.rotation.x = 0.05; g.add(fore);
    }
    const neck = box(0.07, 0.16, 0.07, m); neck.position.set(0, 1.66, -0.03); neck.rotation.x = 0.35; g.add(neck);
    const head = box(0.17, 0.22, 0.2, m); head.position.set(0, 1.76, -0.09); head.rotation.x = 0.3; g.add(head); // head bowed toward you
    addEyes(head, 0.0, -0.12, 0.05, 0.062);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData.eyes = eyes;
  g.userData.eyeMat = em;
  g.userData.eyeBase = new THREE.Color(eyeColor);
  return g;
}

export const EnemyState = { LURK: 0, BANISHED: 1, ATTACK: 2, DONE: 3 };

export class Enemy {
  constructor(type, anchor, scene, eye, rng, advanceMul, cueMul) {
    this.type = type; this.anchor = anchor; this.scene = scene; this.eye = eye; this.rng = rng;
    this.state = EnemyState.LURK;
    this.p = 0;                       // progress 0 (anchor) → 1 (at player)
    this.dwell = 0;                   // seconds of continuous light
    this.advanceMul = advanceMul; this.cueMul = cueMul;
    this.advanceTimer = randRange(rng, ...type.advanceInterval);
    this.cueTimer = randRange(rng, ...type.cueInterval) * 0.6;
    this.lit = 0;

    this.model = buildModel(type.model, type.eyeColor);
    // Path: from just inside the anchor recess to a point 0.45 m off the eye,
    // arriving from the anchor's direction (never dead-centre until the lunge).
    const a = anchor.pos.clone();
    this.start = a.clone().addScaledVector(anchor.face, -0.25);
    // Approach stays at the anchor's height (grounded creatures don't float up);
    // it closes horizontally toward the player, arriving 0.5 m to the side.
    const toEye = eye.clone(); toEye.y = a.y;
    const from = a.clone().sub(eye); from.y = 0; from.setLength(0.5);
    this.end = toEye.add(from);
    this._headOffset = type.model === 'crawler' ? 0.22 : type.model === 'peeker' ? 0.0 : 1.72;
    this._place();
    scene.add(this.model);
  }

  _place() {
    const pos = this.start.clone().lerp(this.end, smoothstep(0, 1, this.p));
    this.model.position.copy(pos);
    this.model.lookAt(this.eye.x, pos.y, this.eye.z);         // face player, stay upright
    this.worldHead = pos.clone(); this.worldHead.y = pos.y + this._headOffset;
  }

  // Returns an array of {type,payload} events for the bus (cue / advance / banish / scare).
  update(dt, flashlight, bus) {
    if (this.state !== EnemyState.LURK) return;
    const ev = [];
    // Am I lit? Sample the head position.
    this.lit = flashlight.litAmount(this.worldHead);
    const k = Math.min(1, 0.4 + this.p * 0.5 + (this.lit > 0.3 ? 0.3 : 0));
    this.model.userData.eyeMat.color.copy(this.model.userData.eyeBase).multiplyScalar(k);

    if (this.lit > 0.35) {
      this.dwell += dt * this.lit;
      if (this.dwell >= this.type.banishTime) {
        this.state = EnemyState.BANISHED;
        ev.push({ type: 'banish', payload: { pan: this.anchor.pan, name: this.type.name } });
        return ev;
      }
    } else {
      this.dwell = Math.max(0, this.dwell - dt * 0.5);
      // advance while unobserved
      this.advanceTimer -= dt * this.advanceMul * this.type.speedMul;
      if (this.advanceTimer <= 0) {
        this.advanceTimer = randRange(this.rng, ...this.type.advanceInterval);
        this.p = clamp(this.p + this.type.advanceStep, 0, 1);
        this._place();
        ev.push({ type: 'cue', payload: { sound: pick(this.rng, this.type.cues), pan: this.anchor.pan, muffle: (1 - this.p) * 0.4 } });
        ev.push({ type: 'approach', payload: { p: this.p } });
        if (this.p >= 1) { this.state = EnemyState.ATTACK; ev.push({ type: 'scare', payload: { type: this.type, pan: this.anchor.pan } }); return ev; }
      }
    }
    // ambient cues
    this.cueTimer -= dt;
    if (this.cueTimer <= 0) {
      this.cueTimer = randRange(this.rng, ...this.type.cueInterval) * this.cueMul;
      ev.push({ type: 'cue', payload: { sound: pick(this.rng, this.type.cues), pan: this.anchor.pan, muffle: 0.3 + (1 - this.p) * 0.3 } });
    }
    return ev;
  }

  // Called each frame after update for retreat animation / cleanup.
  animate(dt) {
    if (this.state === EnemyState.BANISHED) {
      this.p = Math.max(0, this.p - dt * 2.2);
      this._place();
      this.model.userData.eyeMat.color.multiplyScalar(Math.max(0, 1 - dt * 3));
      if (this.p <= 0.001) this.state = EnemyState.DONE;
    }
  }

  dispose() {
    this.scene.remove(this.model);
    this.model.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  }
}
