// =============================================================================
// pickups.js — Physical battery cells (docs/FASE1_ESCENARIO.md §5).
// FINITE resource: 6 per night, each worth a partial charge, and once taken they
// are gone. Collected by holding the flashlight on one for `dwell` seconds — the
// cell brightens and pulses harder the longer you hold it, so it is unmistakable
// that you ARE aiming at it. Then it lifts, spins and fades with a charge sound.
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { clamp } from '../core/util.js';

class Battery {
  constructor(spot, metal) {
    this.pos = spot.pos.clone();
    this.pan = spot.pan;
    this.dwell = 0;
    this.taken = false;
    this.t = Math.random() * 6;

    const g = new THREE.Group();
    g.position.copy(this.pos);
    this.group = g;

    // a chunky industrial cell
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.17, 0.08),
      metal || new THREE.MeshStandardMaterial({ color: 0x2c2f34, roughness: 0.6, metalness: 0.5 }));
    body.castShadow = body.receiveShadow = true; g.add(body);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 8),
      new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.4, metalness: 0.8 }));
    cap.position.y = 0.095; cap.castShadow = true; g.add(cap);

    // green charge window — unlit so it always reads in the dark
    this.glowMat = new THREE.MeshBasicMaterial({ color: 0x27ff5a, toneMapped: false });
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.032), this.glowMat);
    win.position.set(0, 0.03, 0.041); g.add(win);
    for (let i = 0; i < 2; i++) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.062, 0.008), this.glowMat);
      p.position.set(0, -0.015 - i * 0.018, 0.041); g.add(p);
    }
    this.halo = new THREE.PointLight(0x1aff55, 0.55, 1.1, 2);
    this.halo.position.set(0, 0.02, 0.1); g.add(this.halo);

    // soft billboard so it's spottable from an angle
    this.spriteMat = new THREE.SpriteMaterial({ color: 0x1aff55, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const s = new THREE.Sprite(this.spriteMat); s.scale.setScalar(0.19); s.position.set(0, 0.02, 0.05); g.add(s);
  }

  /** @returns 'collected' | null */
  update(dt, flashlight) {
    if (this.taken) {
      // collection animation: lift, spin, fade out
      this.anim += dt;
      this.group.position.y = this.pos.y + Math.min(0.35, this.anim * 0.7);
      this.group.rotation.y += dt * 7;
      const f = clamp(1 - this.anim / 0.7, 0, 1);
      this.spriteMat.opacity = 0.5 * f;
      this.halo.intensity = 1.6 * f;
      this.group.scale.setScalar(0.6 + 0.4 * f);
      if (this.anim > 0.7) this.group.visible = false;
      return null;
    }

    this.t += dt;
    const D = CONFIG.pickups;
    // Needs the beam ON it, not merely somewhere in the wide cone.
    const lit = (flashlight.aimAngle(this.pos) < D.maxAngle) ? flashlight.litAmount(this.pos) : 0;
    if (lit > D.litThreshold) {
      this.dwell = Math.min(D.dwell, this.dwell + dt * lit);
      if (this.dwell >= D.dwell) { this.taken = true; this.anim = 0; return 'collected'; }
    } else {
      this.dwell = Math.max(0, this.dwell - dt * 1.4);
    }

    // Feedback: the closer to collected, the brighter and faster the pulse.
    const f = this.dwell / D.dwell;
    const pulse = 0.55 + 0.45 * Math.sin(this.t * (5 + f * 22));
    const bright = 0.35 + f * 0.65;
    this.glowMat.color.setRGB(0.1 * bright, bright * (0.6 + 0.4 * pulse), 0.22 * bright);
    this.halo.intensity = 0.45 + f * 1.5 * pulse;
    this.spriteMat.opacity = 0.35 + f * 0.5;
    this.group.scale.setScalar(1 + f * 0.12);
    return null;
  }

  dispose() {
    this.group.traverse((o) => { if (o.isMesh) o.geometry?.dispose?.(); });
    this.glowMat.dispose(); this.spriteMat.dispose();
  }
}

export class PickupField {
  constructor(scene, room) {
    this.scene = scene; this.room = room; this.items = [];
  }

  spawn(rng) {
    this.clear();
    const spots = this.room.pickupSpots.slice();
    // shuffle deterministically so each night distributes differently
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
  }

  /** @returns array of collected {pan} events */
  update(dt, flashlight) {
    const out = [];
    for (const b of this.items) {
      if (b.update(dt, flashlight) === 'collected') out.push({ pan: b.pan });
    }
    return out;
  }

  get remaining() { return this.items.filter((b) => !b.taken).length; }
}
