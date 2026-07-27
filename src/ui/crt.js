// =============================================================================
// crt.js — The DIEGETIC menu (docs/FASE1_ESCENARIO.md §6). There is no DOM UI.
//
// An instrumentation cart is parked in the corridor mouth. On it: a CRT monitor
// whose screen is a live CanvasTexture (phosphor, scanlines, jitter, burn-in),
// and a panel of PHYSICAL levers — five to pick the night, one big red one to
// start. You operate them with the flashlight: hold the beam on a lever and it
// throws. Same grammar as the battery cells, so the whole game has ONE verb.
//
// Starting a night rolls the cart away down the corridor and powers the tube
// down, so there is never a cut between menu and game.
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { clamp } from '../core/util.js';

// Canvas aspect must match the screen plane (0.86 x 0.60) or the type stretches.
const W = 1024, H = 716;

export class CRTConsole {
  constructor(scene, room) {
    this.scene = scene; this.room = room;
    // Screen CONTENT and cart POSITION are independent: rolling the cart away
    // must not wipe the result the tube is displaying.
    this.mode = 'menu';                 // 'menu' | 'result'  (what's drawn)
    this.docked = true;                  // parked in the corridor mouth?
    this.night = 1;
    this.result = null;
    this.aim = { name: null, frac: 0 };
    this.t = 0;
    this.parked = new THREE.Vector3(0, 0, -1.28);
    this.away = new THREE.Vector3(0, 0, -4.1);
    this.rolling = 0;                   // 0 = parked, 1 = away
    this.power = 1;
    this.controls = [];
    this._build();
    this._initCanvas();
  }

  _build() {
    const metal = this.room.metal || new THREE.MeshStandardMaterial({ color: 0x50555c, roughness: 0.6, metalness: 0.5 });
    const g = new THREE.Group(); g.position.copy(this.parked); this.group = g; this.scene.add(g);

    // --- cart ---
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.05, 0.5), metal);
    top.position.set(0, 0.82, 0); top.castShadow = top.receiveShadow = true; g.add(top);
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.04, 0.46), metal);
    shelf.position.set(0, 0.42, 0); shelf.castShadow = true; g.add(shelf);
    for (const [x, z] of [[-0.47, 0.21], [0.47, 0.21], [-0.47, -0.21], [0.47, -0.21]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.82, 0.05), metal);
      leg.position.set(x, 0.41, z); leg.castShadow = true; g.add(leg);
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.02, 6, 12), metal);
      wheel.position.set(x, 0.05, z); wheel.rotation.y = Math.PI / 2; g.add(wheel);
    }

    // --- CRT body + curved glass ---
    const shell = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.72, 0.62),
      new THREE.MeshStandardMaterial({ color: 0x3b3a35, roughness: 0.72, metalness: 0.15 }));
    shell.position.set(0, 1.22, -0.06); shell.castShadow = shell.receiveShadow = true; g.add(shell);
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.66, 0.04),
      new THREE.MeshStandardMaterial({ color: 0x2a2925, roughness: 0.8 }));
    bezel.position.set(0, 1.22, 0.26); g.add(bezel);

    this.canvas = document.createElement('canvas'); this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.screenMat = new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false });
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.6), this.screenMat);
    this.screen.position.set(0, 1.22, 0.285); g.add(this.screen);
    // slight convex glass over the phosphor
    const glass = new THREE.Mesh(new THREE.SphereGeometry(1.2, 24, 16, 0, 0.38, Math.PI / 2 - 0.13, 0.26),
      new THREE.MeshPhysicalMaterial({ color: 0x0a0d10, roughness: 0.12, metalness: 0, transmission: 0.55, transparent: true, opacity: 0.28, ior: 1.5 }));
    glass.position.set(0, 1.22, -0.86); g.add(glass);
    this.screenLight = new THREE.PointLight(0x66ff99, 1.5, 2.6, 2);
    this.screenLight.position.set(0, 1.22, 0.5); g.add(this.screenLight);

    // --- lever panel on the cart's lower shelf ---
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.26, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x33352f, roughness: 0.8, metalness: 0.3 }));
    panel.position.set(0, 0.62, 0.24); panel.rotation.x = -0.45; panel.castShadow = true; g.add(panel);

    const leverMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.45, metalness: 0.7 });
    const knobMat = new THREE.MeshStandardMaterial({ color: 0xb8452f, roughness: 0.5, metalness: 0.2 });
    this.levers = [];
    for (let i = 0; i < 5; i++) {
      const pivot = new THREE.Group();
      pivot.position.set(-0.3 + i * 0.15, 0.66, 0.26); g.add(pivot);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.13, 0.022), leverMat);
      arm.geometry.translate(0, 0.065, 0); arm.castShadow = true; pivot.add(arm);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.024, 10, 10), knobMat);
      knob.position.y = 0.14; pivot.add(knob);
      this.levers.push(pivot);
      this.controls.push({ name: 'night' + (i + 1), night: i + 1, obj: knob, pivot });
    }
    // big start lever, to the right
    const sp = new THREE.Group(); sp.position.set(0.4, 0.66, 0.26); g.add(sp);
    const sArm = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.2, 0.035), leverMat);
    sArm.geometry.translate(0, 0.1, 0); sArm.castShadow = true; sp.add(sArm);
    const sKnob = new THREE.Mesh(new THREE.SphereGeometry(0.042, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0xc4331f, roughness: 0.45, metalness: 0.25 }));
    sKnob.position.y = 0.21; sp.add(sKnob);
    this.startPivot = sp;
    this.controls.push({ name: 'start', obj: sKnob, pivot: sp });

    this._syncLevers();
  }

  _syncLevers() {
    this.levers.forEach((p, i) => { p.rotation.x = (i + 1 === this.night) ? -0.5 : 0.42; });
  }

  _initCanvas() {
    // Redraw once the distinctive fonts land (falls back gracefully offline).
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { this._dirty = true; });
    this._dirty = true;
  }

  worldPosOf(ctrl) { return ctrl.obj.getWorldPosition(new THREE.Vector3()); }

  setAim(name, frac) { this.aim.name = name; this.aim.frac = frac; }
  setNight(n) { this.night = clamp(n | 0, 1, 5); this._syncLevers(); }
  showResult(win, night, remaining) { this.mode = 'result'; this.result = { win, night, remaining }; }
  showMenu() { this.mode = 'menu'; this.result = null; }
  rollAway() { this.docked = false; }
  rollBack() { this.docked = true; }

  // ---------------------------------------------------------------- drawing
  _draw() {
    const c = this.ctx, F = CONFIG.fonts;
    const jitter = (Math.random() - 0.5) * 2;
    // Near-black base: only the glyphs should be bright, or bloom eats the text.
    c.fillStyle = '#020905'; c.fillRect(0, 0, W, H);

    // phosphor vignette (subtle)
    const rg = c.createRadialGradient(W / 2, H / 2, 60, W / 2, H / 2, W * 0.75);
    rg.addColorStop(0, 'rgba(30,255,120,0.055)'); rg.addColorStop(1, 'rgba(0,0,0,0.55)');
    c.fillStyle = rg; c.fillRect(0, 0, W, H);

    c.save(); c.translate(jitter, 0);
    const GREEN = '#c8ffdc', DIM = '#69d79b', WARN = '#ffdd9a';

    if (this.mode === 'result' && this.result) {
      const { win, night, remaining } = this.result;
      c.textAlign = 'center';
      c.fillStyle = win ? GREEN : '#ff6a5a';
      c.font = `78px ${F.stencil}`;
      c.fillText(win ? 'AMANECE' : 'TE ATRAPÓ', W / 2, 230);
      c.font = `34px ${F.crt}`; c.fillStyle = GREEN;
      c.fillText(win ? `NOCHE ${night} SUPERADA` : `NOCHE ${night} FALLIDA`, W / 2, 310);
      c.fillStyle = DIM; c.font = `26px ${F.crt}`;
      c.fillText(`CELDAS SIN USAR: ${remaining}`, W / 2, 372);
      c.fillStyle = GREEN; c.font = `30px ${F.crt}`;
      c.fillText(win ? '> PALANCA ROJA: SIGUIENTE NOCHE' : '> PALANCA ROJA: REINTENTAR', W / 2, 470);
    } else {
      // title
      c.textAlign = 'center';
      c.fillStyle = GREEN; c.font = `150px ${F.stencil}`;
      c.fillText('VIGILIA', W / 2, 150);
      c.font = `36px ${F.crt}`; c.fillStyle = DIM;
      c.fillText('T U R N O   D E   N O C H E', W / 2, 202);

      // night selector row — thick strokes so they survive bloom
      for (let i = 1; i <= 5; i++) {
        const x = 132 + (i - 1) * 152, sel = i === this.night;
        if (sel) { c.fillStyle = 'rgba(120,255,170,0.16)'; c.fillRect(x, 248, 112, 100); }
        c.strokeStyle = sel ? GREEN : DIM; c.lineWidth = sel ? 7 : 3;
        c.strokeRect(x, 248, 112, 100);
        c.fillStyle = sel ? GREEN : DIM; c.font = `${sel ? 70 : 54}px ${F.crt}`;
        c.textAlign = 'center'; c.fillText(String(i), x + 56, 318);
      }
      c.fillStyle = DIM; c.font = `30px ${F.crt}`;
      c.fillText('TURNO', W / 2, 392);

      c.textAlign = 'center'; c.fillStyle = GREEN; c.font = `38px ${F.crt}`;
      c.fillText('LA LINTERNA ES TU ÚNICA LUZ', W / 2, 470);
      c.fillStyle = WARN; c.font = `38px ${F.crt}`;
      c.fillText('LA BATERÍA SE AGOTA. RECÓGELAS.', W / 2, 522);
      c.fillStyle = DIM; c.font = `30px ${F.crt}`;
      c.fillText('APUNTA Y MANTÉN PARA ACCIONAR', W / 2, 586);

      c.fillStyle = GREEN; c.font = `44px ${F.crt}`;
      c.fillText('> PALANCA ROJA: EMPEZAR', W / 2, 665);
    }

    // aim feedback: shows you ARE aiming at a control, and the hold progress
    if (this.aim.name && this.aim.frac > 0.02) {
      const label = this.aim.name === 'start' ? 'EMPEZAR' : 'TURNO ' + this.aim.name.replace('night', '');
      c.textAlign = 'center';
      c.fillStyle = '#020905'; c.fillRect(W / 2 - 300, H - 92, 600, 74);
      c.strokeStyle = GREEN; c.lineWidth = 5; c.strokeRect(W / 2 - 300, H - 92, 600, 74);
      c.fillStyle = GREEN; c.font = `34px ${F.crt}`;
      c.fillText(label, W / 2, H - 58);
      c.fillStyle = GREEN;
      c.fillRect(W / 2 - 290, H - 40, 580 * clamp(this.aim.frac, 0, 1), 12);
    }
    c.restore();

    // scanlines
    c.globalAlpha = 0.13; c.fillStyle = '#000';
    for (let y = 0; y < H; y += 4) c.fillRect(0, y, W, 2);
    c.globalAlpha = 1;
    this.tex.needsUpdate = true;
  }

  update(dt) {
    this.t += dt;
    // roll the cart in/out of the corridor
    const targ = this.docked ? 0 : 1;
    this.rolling += (targ - this.rolling) * Math.min(1, dt * 1.1);
    this.group.position.lerpVectors(this.parked, this.away, this.rolling);
    // tube power: degauss-style collapse as it rolls away
    const wantPower = this.docked ? 1 : 0;
    this.power += (wantPower - this.power) * Math.min(1, dt * 2.2);
    const p = clamp(this.power, 0, 1);
    this.screen.scale.set(1, Math.max(0.02, p), 1);
    this.screenMat.opacity = p; this.screenMat.transparent = true;
    this.screenLight.intensity = 1.5 * p;
    this.startPivot.rotation.x = -0.1 - 0.5 * (1 - p);

    if (p > 0.02) this._draw();
    return p;
  }

  get isAway() { return this.rolling > 0.92; }
}
