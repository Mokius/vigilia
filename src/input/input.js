// =============================================================================
// input.js — Turns pointer / touch into a flashlight aim direction.
//   • Mouse (pointer lock): relative movement drives yaw/pitch. The beam sweeps
//     continuously from the walls onto the floor — no panel edges to snag on.
//   • Touch / no-lock: absolute — the ray through whichever panel you touch is
//     the aim, so tapping the floor screen lights the floor directly.
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { clamp } from '../core/util.js';

export class Input {
  constructor(canvas, rig) {
    this.canvas = canvas;
    this.rig = rig;
    this.yaw = 0;
    this.pitch = -0.12;
    this.dir = new THREE.Vector3(0, -0.12, -1).normalize();
    this.locked = false;
    this.enabled = true;
    this.allowLock = false;          // only true while a night is being played
    this._absDir = null;
    this.px = window.innerWidth / 2;  // last pointer position (for the reticle)
    this.py = window.innerHeight / 2;

    // Grab pointer lock ONLY during play — never in the menu, or clicking the
    // canvas behind the menu would hide the cursor and make it unclickable.
    canvas.addEventListener('click', () => {
      if (this.allowLock && !this.locked && canvas.requestPointerLock) canvas.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });

    window.addEventListener('mousemove', (e) => {
      if (this.locked) {
        this.yaw += e.movementX * CONFIG.flashlight.yawSpeed;
        this.pitch = clamp(this.pitch - e.movementY * CONFIG.flashlight.pitchSpeed,
          CONFIG.flashlight.pitchMin, CONFIG.flashlight.pitchMax);
        this._absDir = null;
      } else {
        this.px = e.clientX; this.py = e.clientY;   // reticle follows the mouse
        this._absolute(e.clientX, e.clientY);
      }
    });

    window.addEventListener('touchmove', (e) => {
      if (!e.touches[0]) return;
      this.px = e.touches[0].clientX; this.py = e.touches[0].clientY;
      this._absolute(e.touches[0].clientX, e.touches[0].clientY);
      e.preventDefault();
    }, { passive: false });
  }

  _absolute(cx, cy) {
    const u = clamp(cx / window.innerWidth, 0, 0.9999);
    const v = clamp(cy / window.innerHeight, 0, 0.9999);
    const hit = this.rig.panelAt(u, v);
    if (!hit) return;
    this._absDir = this.rig.rayFromPanel(hit.surface, hit.lu, hit.lv);
  }

  update() {
    if (this._absDir) {
      this.dir.copy(this._absDir);
    } else {
      const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      this.dir.set(Math.sin(this.yaw) * cp, sp, -Math.cos(this.yaw) * cp).normalize();
    }
    return this.dir;
  }
}
