// =============================================================================
// pickups.js — Physical battery cells (docs/FASE1_ESCENARIO.md §5).
// FINITE resource: 6 per night, partial charge each, gone once taken.
//
// Feedback is the point here: only ONE cell can ever be charging (the one
// closest to the beam axis — the lit cone is far too wide to disambiguate), and
// while you hold it a bright arc fills around that cell, it brightens, lifts
// slightly and ticks faster. There is never any doubt about what you're taking.
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { clamp } from '../core/util.js';

function ringTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  return { canvas: c, ctx: c.getContext('2d'), tex: new THREE.CanvasTexture(c) };
}

// Shared across every cell: 6 identical materials were 6 extra shader programs.
let CAP_MAT = null;
const capMat = () => (CAP_MAT || (CAP_MAT = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.4, metalness: 0.8 })));

class Battery {
  constructor(spot, metal) {
    this.pos = spot.pos.clone();
    this.pan = spot.pan;
    this.dwell = 0; this.taken = false; this.active = false;
    this.t = Math.random() * 6; this._lastTick = 0;

    const g = new THREE.Group(); g.position.copy(this.pos); this.group = g;

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.17, 0.08),
      metal || new THREE.MeshStandardMaterial({ color: 0x2c2f34, roughness: 0.6, metalness: 0.5 }));
    body.castShadow = body.receiveShadow = true; g.add(body);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 8), capMat());
    cap.position.y = 0.095; cap.castShadow = true; g.add(cap);

    this.glowMat = new THREE.MeshBasicMaterial({ color: 0x27ff5a, toneMapped: false });
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.032), this.glowMat);
    win.position.set(0, 0.03, 0.041); g.add(win);
    for (let i = 0; i < 2; i++) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.062, 0.008), this.glowMat);
      p.position.set(0, -0.015 - i * 0.018, 0.041); g.add(p);
    }

    this.spriteMat = new THREE.SpriteMaterial({ color: 0x1aff55, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const s = new THREE.Sprite(this.spriteMat); s.scale.setScalar(0.18); s.position.set(0, 0.02, 0.05); g.add(s);
  }

  /** @returns null | 'collected' | 'tick' */
  update(dt, flashlight) {
    if (this.taken) {
      this.anim += dt;
      this.group.position.y = this.pos.y + Math.min(0.38, this.anim * 0.8);
      this.group.rotation.y += dt * 8;
      const f = clamp(1 - this.anim / 0.7, 0, 1);
      this.spriteMat.opacity = 0.5 * f;
      this.group.scale.setScalar(0.55 + 0.45 * f);
      if (this.anim > 0.7) this.group.visible = false;
      return null;
    }

    this.t += dt;
    const D = CONFIG.pickups;
    let out = null;
    if (this.active) {
      const prev = this.dwell;
      this.dwell = Math.min(D.dwell, this.dwell + dt);
      // audible ticks that get closer together as it fills
      const step = D.dwell / 5;
      if (Math.floor(this.dwell / step) > Math.floor(prev / step)) out = 'tick';
      if (this.dwell >= D.dwell) { this.taken = true; this.anim = 0; return 'collected'; }
    } else {
      this.dwell = Math.max(0, this.dwell - dt * 2.2);
    }

    const f = this.dwell / D.dwell;
    const pulse = 0.55 + 0.45 * Math.sin(this.t * (5 + f * 26));
    const bright = 0.3 + f * 0.7;
    this.glowMat.color.setRGB(0.1 * bright, bright * (0.55 + 0.45 * pulse), 0.2 * bright);
    this.spriteMat.opacity = 0.3 + f * 0.55;
    this.glow = 0.4 + f * 1.8 * pulse;
    this.group.scale.setScalar(1 + f * 0.16);
    this.group.position.y = this.pos.y + f * 0.02;
    return out;
  }

  dispose() {
    this.group.traverse((o) => { if (o.isMesh) o.geometry?.dispose?.(); });
    this.glowMat.dispose(); this.spriteMat.dispose();
  }
}

export class PickupField {
  constructor(scene, room) {
    this.scene = scene; this.room = room; this.items = [];
    this._buildRing();
  }

  // A single reusable progress arc, parked on whichever cell is charging.
  _buildRing() {
    const r = ringTexture();
    this._ring = r;
    r.tex.colorSpace = THREE.SRGBColorSpace;
    this.ringMat = new THREE.SpriteMaterial({ map: r.tex, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0 });
    this.ring = new THREE.Sprite(this.ringMat);
    this.ring.renderOrder = 999;
    this.ring.scale.setScalar(0.42); this.ring.visible = false;
    this.scene.add(this.ring);
    this._ringFrac = -1;
    // ONE shared halo that travels to whichever cell matters. Six point lights
    // (one per cell) were being shaded by every material in the room.
    this.light = new THREE.PointLight(0x1aff55, 0, 1.7, 2);
    this.scene.add(this.light);
  }

  _drawRing(frac) {
    if (Math.abs(frac - this._ringFrac) < 0.02) return;
    this._ringFrac = frac;
    const { ctx: c, tex } = this._ring;
    c.clearRect(0, 0, 128, 128);
    // unfilled track
    c.strokeStyle = 'rgba(50,255,120,0.30)'; c.lineWidth = 12;
    c.beginPath(); c.arc(64, 64, 44, 0, Math.PI * 2); c.stroke();
    // filled arc, with a white core so it reads instantly in the dark
    const a0 = -Math.PI / 2, a1 = a0 + Math.PI * 2 * frac;
    c.lineCap = 'round';
    c.strokeStyle = '#39ff86'; c.lineWidth = 16;
    c.beginPath(); c.arc(64, 64, 44, a0, a1); c.stroke();
    c.strokeStyle = frac >= 1 ? '#ffffff' : '#d9ffe8'; c.lineWidth = 7;
    c.beginPath(); c.arc(64, 64, 44, a0, a1); c.stroke();
    tex.needsUpdate = true;
  }

  spawn(rng) {
    this.clear();
    const spots = this.room.pickupSpots.slice();
    for (let i = spots.length - 1; i > 0; i--) { const j = ((rng ? rng() : Math.random()) * (i + 1)) | 0; [spots[i], spots[j]] = [spots[j], spots[i]]; }
    const n = Math.min(CONFIG.pickups.count, spots.length);
    for (let i = 0; i < n; i++) {
      const b = new Battery(spots[i], this.room.metal);
      this.items.push(b); this.scene.add(b.group);
    }
  }

  clear() {
    for (const b of this.items) { this.scene.remove(b.group); b.dispose(); }
    this.items = [];
    if (this.ring) { this.ring.visible = false; this.ringMat.opacity = 0; }
  }

  /** @returns array of events: {kind:'collected'|'tick', pan, frac} */
  update(dt, flashlight) {
    const D = CONFIG.pickups;
    // EXCLUSIVE: pick the single cell nearest the beam axis, and only if the
    // beam is actually on it. Everything else discharges.
    let best = null, bestAngle = Infinity;
    if (flashlight.on) {
      for (const b of this.items) {
        if (b.taken) continue;
        const a = flashlight.aimAngle(b.pos);
        if (a < D.maxAngle && a < bestAngle && flashlight.litAmount(b.pos) > D.litThreshold) { bestAngle = a; best = b; }
      }
    }
    for (const b of this.items) b.active = (b === best);

    const out = [];
    for (const b of this.items) {
      const r = b.update(dt, flashlight);
      if (r === 'collected') out.push({ kind: 'collected', pan: b.pan });
      else if (r === 'tick') out.push({ kind: 'tick', pan: b.pan, frac: b.dwell / D.dwell });
    }

    // Move the single shared halo to the cell that matters: the one being
    // charged, else the nearest to the beam so cells still read in the dark.
    let host = best;
    if (!host) {
      let bd = Infinity;
      for (const b of this.items) {
        if (b.taken) continue;
        const d = flashlight.aimAngle(b.pos);
        if (d < bd) { bd = d; host = b; }
      }
    }
    if (host) {
      this.light.position.copy(host.pos).add(new THREE.Vector3(0, 0.04, 0.06));
      this.light.intensity += ((host.glow || 0.45) - this.light.intensity) * Math.min(1, dt * 8);
    } else this.light.intensity *= 0.9;

    // park the arc on the active cell
    if (best && best.dwell > 0.01) {
      const f = best.dwell / D.dwell;
      this._drawRing(f);
      this.ring.visible = true;
      this.ringMat.opacity = clamp(0.55 + f * 0.45, 0, 1);
      this.ring.position.copy(best.pos).add(new THREE.Vector3(0, 0.17, 0));
      this.ring.scale.setScalar(0.40 + f * 0.09);
    } else if (this.ring.visible) {
      this.ringMat.opacity *= 0.82;
      if (this.ringMat.opacity < 0.03) this.ring.visible = false;
    }
    return out;
  }

  get remaining() { return this.items.filter((b) => !b.taken).length; }
}
