// =============================================================================
// pickups.js — Physical battery cells.
//
// THE CELL IS AN OBJECT, NOT AN EFFECT. Earlier versions wrapped each cell in an
// additive sprite halo and parked a coloured point light on it, which read as a
// floating green glow — indistinguishable from the room's own lamps, and the one
// thing that kept getting mistaken for scenery. A real cell has a charge
// indicator: a 3 mm LED on its own face, blinking on an irregular slow cycle.
// The light now comes OUT of the object, so you find it without the room turning
// into a video game.
//
// SPAWNING (see PickupField): at most TWO live at once, drawn from a pool of
// surfaces spread around the room, and each cell runs its OWN respawn timer that
// only starts when that cell is taken. Consecutive picks never reuse a spot, so
// there is no single place to memorise.
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { clamp } from '../core/util.js';

// Shared across every cell: one material set, not one per instance.
let MATS = null;
function mats() {
  if (MATS) return MATS;
  MATS = {
    // moulded ABS case: matte, slightly waxy, absolutely not metal
    shell: new THREE.MeshStandardMaterial({ color: 0x1c2024, roughness: 0.55, metalness: 0.0 }),
    // nickel-plated terminals: the only metal on the object
    term: new THREE.MeshStandardMaterial({ color: 0x8d9299, roughness: 0.42, metalness: 0.8 }),
    // printed label
    label: new THREE.MeshStandardMaterial({ color: 0x9a9384, roughness: 0.85, metalness: 0.0 }),
    // the LED lens. toneMapped:false so its colour survives the grade, but it is
    // TINY — a 3 mm dot, not a halo.
    lens: new THREE.MeshBasicMaterial({ color: 0x0d3a18, toneMapped: false }),
  };
  return MATS;
}

class Battery {
  constructor(spot) {
    this.pos = spot.pos.clone();
    this.pan = spot.pan;
    this.spot = spot;
    this.dwell = 0; this.taken = false; this.active = false;
    this.t = Math.random() * 9;
    this.respawnT = 0;
    this._blink = 0; this._nextBlink = 0;

    const M = mats();
    const g = new THREE.Group(); g.position.copy(this.pos); this.group = g;

    // --- the cell: a squat sealed lead-acid block, the kind a maintenance crew
    //     would leave on a bench. Chamfered lid, moulded ribs, two terminals.
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.15, 0.085), M.shell);
    body.position.y = 0.075;
    body.castShadow = body.receiveShadow = true; g.add(body);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.121, 0.016, 0.091), M.shell);
    lid.position.y = 0.156; lid.castShadow = true; g.add(lid);
    // casing ribs down the sides
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.12, 0.006), M.shell);
        rib.position.set(sx * 0.058, 0.075, -0.028 + i * 0.028); g.add(rib);
      }
    }
    // terminals on the lid
    for (const sx of [-1, 1]) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.013, 0.018, 8), M.term);
      t.position.set(sx * 0.036, 0.172, 0); t.castShadow = true; g.add(t);
    }
    // printed label on the front face
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.088, 0.05), M.label);
    lab.position.set(0, 0.085, 0.0432); g.add(lab);

    // --- THE INDICATOR: a 3 mm lens in a moulded bezel, on the cell's own face.
    this.lensMat = M.lens.clone();
    const bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.006, 8), M.shell);
    bezel.rotation.x = Math.PI / 2; bezel.position.set(0.034, 0.038, 0.0425); g.add(bezel);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.0042, 8, 6), this.lensMat);
    lens.position.set(0.034, 0.038, 0.0455); g.add(lens);
    this.lens = lens;

    // A very short-range light so the LED spills onto the surface it sits on —
    // 12 cm of reach, which grazes the bench top and nothing else. This is what
    // makes it findable without becoming a lamp.
    this.glowLight = new THREE.PointLight(0x3dff86, 0.0, 0.13, 2);
    this.glowLight.position.set(0.034, 0.038, 0.055);
    g.add(this.glowLight);
  }

  /** @returns null | 'collected' | 'tick' */
  update(dt) {
    if (this.taken) {
      this.respawnT -= dt;
      return null;
    }
    this.t += dt;
    const D = CONFIG.pickups;
    let out = null;

    if (this.active) {
      const prev = this.dwell;
      this.dwell = Math.min(D.dwell, this.dwell + dt);
      const step = D.dwell / 5;
      if (Math.floor(this.dwell / step) > Math.floor(prev / step)) out = 'tick';
      if (this.dwell >= D.dwell) {
        this.taken = true;
        this.group.visible = false;
        this.respawnT = D.respawn[0] + Math.random() * (D.respawn[1] - D.respawn[0]);
        return 'collected';
      }
    } else {
      this.dwell = Math.max(0, this.dwell - dt * 2.2);
    }

    // ---- the blink: slow, irregular, and it QUICKENS while you charge it ----
    // A steady pulse reads as a UI element. Real charge indicators stutter.
    const f = this.dwell / D.dwell;
    this._nextBlink -= dt;
    if (this._nextBlink <= 0) {
      const on = this._blink < 0.5;
      this._blink = on ? 1 : 0;
      // charging: fast and even. idle: a brief flash, then a long irregular wait.
      this._nextBlink = on
        ? (0.05 + Math.random() * 0.07) * (1 - f * 0.5)
        : (f > 0.02 ? 0.10 + Math.random() * 0.10 : 0.9 + Math.random() * 2.4);
    }
    // a little filament lag rather than a hard digital edge
    this._lit = (this._lit || 0) + (this._blink - (this._lit || 0)) * Math.min(1, dt * 22);
    const k = this._lit;
    this.lensMat.color.setRGB(0.04 + 0.16 * k, 0.10 + 0.85 * k, 0.06 + 0.30 * k);
    this.glowLight.intensity = 0.055 * k + f * 0.05;
    // it is being taken: the case lifts a few millimetres and the LED runs solid
    this.group.position.y = this.pos.y + f * 0.012;
    return out;
  }

  /** Put it back, on a DIFFERENT surface than the one it was taken from. */
  respawn(spot) {
    this.taken = false; this.dwell = 0; this.active = false;
    this.spot = spot;
    this.pos.copy(spot.pos); this.pan = spot.pan;
    this.group.position.copy(this.pos);
    this.group.visible = true;
    this._blink = 0; this._nextBlink = 0; this._lit = 0;
  }

  dispose() {
    this.group.traverse((o) => { if (o.isMesh) o.geometry?.dispose?.(); });
    this.lensMat.dispose();
  }
}

export class PickupField {
  constructor(scene, room) {
    this.scene = scene; this.room = room; this.items = [];
    this._recent = [];          // spots used lately, so they are not reused
    this._buildRing();
  }

  // A single reusable progress arc, parked on whichever cell is charging.
  _buildRing() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    this._ring = { canvas: c, ctx: c.getContext('2d'), tex: new THREE.CanvasTexture(c) };
    this._ring.tex.colorSpace = THREE.SRGBColorSpace;
    this.ringMat = new THREE.SpriteMaterial({
      map: this._ring.tex, transparent: true, depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0,
    });
    this.ring = new THREE.Sprite(this.ringMat);
    this.ring.renderOrder = 999;
    this.ring.scale.setScalar(0.30); this.ring.visible = false;
    this.scene.add(this.ring);
    this._ringFrac = -1;
  }

  _drawRing(frac) {
    if (Math.abs(frac - this._ringFrac) < 0.02) return;
    this._ringFrac = frac;
    const { ctx: c, tex } = this._ring;
    c.clearRect(0, 0, 128, 128);
    c.strokeStyle = 'rgba(50,255,120,0.30)'; c.lineWidth = 12;
    c.beginPath(); c.arc(64, 64, 44, 0, Math.PI * 2); c.stroke();
    const a0 = -Math.PI / 2, a1 = a0 + Math.PI * 2 * frac;
    c.lineCap = 'round';
    c.strokeStyle = '#39ff86'; c.lineWidth = 16;
    c.beginPath(); c.arc(64, 64, 44, a0, a1); c.stroke();
    c.strokeStyle = frac >= 1 ? '#ffffff' : '#d9ffe8'; c.lineWidth = 7;
    c.beginPath(); c.arc(64, 64, 44, a0, a1); c.stroke();
    tex.needsUpdate = true;
  }

  /**
   * Choose a spawn surface, avoiding anything used recently.
   *
   * The old field seeded every cell from a shuffled list at the start of the
   * night, which meant the first one was always in the same place for a given
   * seed and the player simply learned it. Now each placement is drawn at the
   * moment it is needed, and the last few choices are excluded, so consecutive
   * cells are always somewhere else.
   */
  _pickSpot(rng) {
    const all = this.room.pickupSpots || [];
    if (!all.length) return null;
    const taken = new Set(this.items.filter((b) => !b.taken).map((b) => b.spot));
    let pool = all.filter((s) => !taken.has(s) && !this._recent.includes(s));
    if (!pool.length) pool = all.filter((s) => !taken.has(s));
    if (!pool.length) pool = all;
    const s = pool[((rng ? rng() : Math.random()) * pool.length) | 0];
    this._recent.push(s);
    // remember roughly half the room, so it rotates rather than ping-pongs
    while (this._recent.length > Math.max(2, Math.floor(all.length / 2))) this._recent.shift();
    return s;
  }

  /** Place cells at exactly these spots (used by the guided night). */
  spawnAt(spots) {
    this.clear();
    for (const s of spots) {
      const b = new Battery(s);
      this.items.push(b); this.scene.add(b.group);
    }
  }

  spawn(rng) {
    this.clear();
    this._rng = rng;
    this._recent = [];
    // NEVER more than two live at once: two is enough to give a choice, few
    // enough that the room still feels short of power.
    const n = Math.min(CONFIG.pickups.live, (this.room.pickupSpots || []).length);
    for (let i = 0; i < n; i++) {
      const s = this._pickSpot(rng);
      if (!s) break;
      const b = new Battery(s);
      this.items.push(b); this.scene.add(b.group);
    }
  }

  clear() {
    for (const b of this.items) { this.scene.remove(b.group); b.dispose(); }
    this.items = [];
    this._recent = [];
    if (this.ring) { this.ring.visible = false; this.ringMat.opacity = 0; }
  }

  /** @returns array of events: {kind:'collected'|'tick', pan, frac} */
  update(dt, flashlight) {
    const D = CONFIG.pickups;
    // EXCLUSIVE: the single cell nearest the beam axis. The test is geometric —
    // never litAmount — so a flat battery can still be replaced.
    let best = null, bestAngle = Infinity;
    for (const b of this.items) {
      if (b.taken) continue;
      const a = flashlight.aimAngle(b.pos);
      if (a < D.maxAngle && a < bestAngle && flashlight.coverage(b.pos) > D.litThreshold) { bestAngle = a; best = b; }
    }
    for (const b of this.items) b.active = (b === best);

    const out = [];
    for (const b of this.items) {
      const r = b.update(dt);
      if (r === 'collected') out.push({ kind: 'collected', pan: b.pan });
      else if (r === 'tick') out.push({ kind: 'tick', pan: b.pan, frac: b.dwell / D.dwell });
      // Its own timer, started when IT was taken — not a shared respawn wave.
      if (b.taken && b.respawnT <= 0) {
        const s = this._pickSpot(this._rng);
        if (s) b.respawn(s);
      }
    }

    // park the arc on the active cell
    if (best && best.dwell > 0.01) {
      const f = best.dwell / D.dwell;
      this._drawRing(f);
      this.ring.visible = true;
      this.ringMat.opacity = clamp(0.5 + f * 0.5, 0, 1);
      this.ring.position.copy(best.pos).add(new THREE.Vector3(0, 0.24, 0));
      this.ring.scale.setScalar(0.28 + f * 0.07);
    } else if (this.ring.visible) {
      this.ringMat.opacity *= 0.82;
      if (this.ringMat.opacity < 0.03) this.ring.visible = false;
    }
    return out;
  }

  get remaining() { return this.items.filter((b) => !b.taken).length; }
}
