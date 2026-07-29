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
    // Parked BEYOND the red end wall (z=-4.67), so the cart is out of sight and,
    // more importantly, out of the corridor route's first station at z=-4.20 —
    // creatures used to spawn inside it.
    this.away = new THREE.Vector3(0, 0, -5.35);
    this.rolling = 0;                   // 0 = parked, 1 = away
    this.power = 1;
    this.controls = [];
    this._build();
    this._initCanvas();
  }

  _build() {
    // Dark painted steel: the player aims the flashlight straight at this thing
    // from ~1 m, and pale metal blows out to pure white at that range.
    const metal = new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.82, metalness: 0.45 });
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

    // --- CRT monitor: inset screen, tapered tube, vents, knobs, power lamp ---
    const caseMat = new THREE.MeshStandardMaterial({ color: 0x272621, roughness: 0.8, metalness: 0.1 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x181713, roughness: 0.88, metalness: 0.08 });
    const CY = 1.24;                                    // screen centre height

    // front housing ring (4 bars) so the glass is genuinely recessed
    const bar = (sx, sy, px, py, pz, mat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, 0.07), mat || caseMat);
      m.position.set(px, py, pz); m.castShadow = m.receiveShadow = true; g.add(m); return m;
    };
    bar(1.02, 0.10, 0, CY + 0.35, 0.26);                // top
    bar(1.02, 0.14, 0, CY - 0.37, 0.26);                // bottom (thicker, holds knobs)
    bar(0.10, 0.80, -0.46, CY, 0.26);                   // left
    bar(0.10, 0.80, 0.46, CY, 0.26);                    // right
    // tapered tube behind
    const tube1 = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.72, 0.3), caseMat);
    tube1.position.set(0, CY, 0.06); tube1.castShadow = tube1.receiveShadow = true; g.add(tube1);
    const tube2 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.48, 0.24), caseMat);
    tube2.position.set(0, CY, -0.16); tube2.castShadow = true; g.add(tube2);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.16, 12), darkMat);
    neck.rotation.x = Math.PI / 2; neck.position.set(0, CY, -0.34); g.add(neck);
    // cooling vents on top
    for (let i = 0; i < 7; i++) {
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.012, 0.016), darkMat);
      v.position.set(0, CY + 0.365, 0.02 - i * 0.032); g.add(v);
    }
    // knobs + power lamp on the bottom bar
    for (const kx of [0.24, 0.33]) {
      const k = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.03, 12), darkMat);
      k.rotation.x = Math.PI / 2; k.position.set(kx, CY - 0.37, 0.30); k.castShadow = true; g.add(k);
      const notch = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.018, 0.004), caseMat);
      notch.position.set(kx, CY - 0.362, 0.316); g.add(notch);
    }
    this.powerLamp = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff6a3a, toneMapped: false }));
    this.powerLamp.position.set(-0.36, CY - 0.37, 0.30); g.add(this.powerLamp);

    this.canvas = document.createElement('canvas'); this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.screenMat = new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false, transparent: true });
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.60), this.screenMat);
    this.screen.position.set(0, CY, 0.245); g.add(this.screen);       // recessed
    // convex glass sitting proud of the bezel
    const glass = new THREE.Mesh(new THREE.SphereGeometry(1.15, 28, 18, 0, 0.40, Math.PI / 2 - 0.14, 0.28),
      new THREE.MeshPhysicalMaterial({ color: 0x0a0d10, roughness: 0.08, metalness: 0, transmission: 0.6, transparent: true, opacity: 0.22, ior: 1.52 }));
    glass.position.set(0, CY, -0.83); g.add(glass);
    this.screenLight = new THREE.PointLight(0x66ff99, 1.3, 2.4, 2);
    this.screenLight.position.set(0, CY, 0.45); g.add(this.screenLight);
    // power cable drooping to the floor
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.8, 6), darkMat);
    cable.position.set(0.34, 0.42, -0.3); cable.rotation.z = 0.25; g.add(cable);

    // --- control panel: engraved plate, collared levers, screws -------------
    const panel = new THREE.Group();
    // Pushed forward and tilted flatter so the whole lever arc stays in free
    // air. Previously the throw swung the arm back INTO the cart top and shell.
    panel.position.set(0, 0.585, 0.30); panel.rotation.x = -0.62; g.add(panel);
    // Matte, non-metallic: the beam hits this plate almost head-on, and any
    // specular at all turns it into a white card.
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.28, 0.045),
      new THREE.MeshStandardMaterial({ color: 0x1e211c, roughness: 0.97, metalness: 0.0 }));
    plate.castShadow = plate.receiveShadow = true; panel.add(plate);
    panel.add(this._panelLabels());
    for (const sx of [-0.44, 0.44]) for (const sy of [-0.12, 0.12]) {
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.01, 6),
        new THREE.MeshStandardMaterial({ color: 0x555a60, roughness: 0.4, metalness: 0.85 }));
      s.rotation.x = Math.PI / 2; s.position.set(sx, sy, 0.026); panel.add(s);
    }

    // Everything here is aimed at from ~1 m: keep albedo low or it clips to white.
    // Mechanical travel limits: a real toggle swings through a small arc, and
    // both ends must clear the housing. REST leans out toward the player, ON
    // stands it up; neither reaches the casing behind.
    const REST = 0.62, ON = 0.10;
    this._leverRest = REST; this._leverOn = ON;
    const steel = new THREE.MeshStandardMaterial({ color: 0x4a4f56, roughness: 0.42, metalness: 0.75 });
    const bakelite = new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.55, metalness: 0.1 });
    this.levers = [];
    const mkLever = (x, scale, knobColor) => {
      // collar sunk into the plate, so the lever emerges from a real hole
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.026 * scale, 0.03 * scale, 0.018, 12), steel);
      collar.rotation.x = Math.PI / 2; collar.position.set(x, -0.02, 0.026); panel.add(collar);
      const pivot = new THREE.Group();
      pivot.position.set(x, -0.02, 0.03); panel.add(pivot);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.008 * scale, 0.012 * scale, 0.10 * scale, 10), steel);
      arm.geometry.translate(0, 0.05 * scale, 0); arm.castShadow = true; pivot.add(arm);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.016 * scale, 0.005 * scale, 6, 12), bakelite);
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.085 * scale; pivot.add(ring);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.023 * scale, 14, 12),
        new THREE.MeshStandardMaterial({ color: knobColor, roughness: 0.42, metalness: 0.15 }));
      knob.position.y = 0.105 * scale; knob.castShadow = true; pivot.add(knob);
      return { pivot, knob };
    };

    for (let i = 0; i < 5; i++) {
      const { pivot, knob } = mkLever(-0.31 + i * 0.135, 1.0, 0x2b2d31);
      pivot.userData.target = REST;
      this.levers.push(pivot);
      this.controls.push({ name: 'night' + (i + 1), night: i + 1, obj: knob, pivot });
    }
    const big = mkLever(0.40, 1.45, 0x8f2a18);
    this.startPivot = big.pivot; this.startPivot.userData.target = REST;
    this.controls.push({ name: 'start', obj: big.knob, pivot: big.pivot });

    this._syncLevers();
  }

  // Engraved-looking legend silk-screened on the control plate.
  _panelLabels() {
    const cv = document.createElement('canvas'); cv.width = 940; cv.height = 280;
    const c = cv.getContext('2d');
    c.fillStyle = '#1e211c'; c.fillRect(0, 0, 940, 280);
    // brushed streaks
    c.globalAlpha = 0.07;
    for (let i = 0; i < 160; i++) { c.fillStyle = i % 2 ? '#fff' : '#000'; c.fillRect(0, Math.random() * 280, 940, 1); }
    c.globalAlpha = 1;
    c.fillStyle = '#cfd3c8'; c.textAlign = 'center';
    c.font = `26px ${CONFIG.fonts.stencil}`;
    c.fillText('S E L E C T O R   D E   T U R N O', 340, 40);
    c.font = `34px ${CONFIG.fonts.crt}`;
    for (let i = 0; i < 5; i++) c.fillText(String(i + 1), 160 + i * 135, 250);
    c.fillStyle = '#e0b0a0'; c.font = `28px ${CONFIG.fonts.stencil}`;
    c.fillText('I N I C I O', 828, 40);
    c.strokeStyle = '#8f948a'; c.lineWidth = 3; c.strokeRect(742, 56, 172, 190);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.94, 0.28),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.97, metalness: 0.0 }));
    m.position.z = 0.0231;
    return m;
  }

  _syncLevers() {
    // store targets; update() eases toward them so throws never snap
    this.levers.forEach((p, i) => { p.userData.target = (i + 1 === this.night) ? this._leverOn : this._leverRest; });
  }

  _initCanvas() {
    // Redraw once the distinctive fonts land (falls back gracefully offline).
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { this._dirty = true; });
    this._dirty = true;
  }

  worldPosOf(ctrl) {
    // The levers hang off cart -> panel -> pivot. Force the chain up to date or
    // this returns a stale position (e.g. before the first render) and aiming
    // silently targets empty air.
    ctrl.obj.updateWorldMatrix(true, false);
    return ctrl.obj.getWorldPosition(new THREE.Vector3());
  }

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

    // ---- cart travel: a fixed-duration eased tween, not an exponential chase.
    // Framerate-independent and genuinely smooth in both directions.
    const dur = 2.6;
    const dir = this.docked ? -1 : 1;
    this._rollT = clamp((this._rollT ?? (this.docked ? 0 : 1)) + dir * dt / dur, 0, 1);
    const s = this._rollT;
    const eased = s * s * s * (s * (s * 6 - 15) + 10);      // smootherstep
    this.rolling = eased;
    this.group.position.lerpVectors(this.parked, this.away, eased);
    // wheels turn with the distance actually travelled
    this.group.rotation.y = Math.sin(eased * Math.PI) * 0.02;

    // ---- tube power: collapses as it leaves, warms back up on return
    const wantPower = this.docked ? 1 : 0;
    this.power += (wantPower - this.power) * Math.min(1, dt * 3.0);
    const p = clamp(this.power, 0, 1);
    this.screen.scale.set(1, Math.max(0.02, p), 1);
    this.screenMat.opacity = p;
    this.screenLight.intensity = 1.3 * p;
    this.powerLamp.material.color.setRGB(p * 1.0, p * 0.42, p * 0.22);

    // ---- lever throws, eased
    const k = Math.min(1, dt * 9);
    for (const lv of this.levers) lv.rotation.x += ((lv.userData.target ?? 0.42) - lv.rotation.x) * k;
    const st = this._leverOn + (this._leverRest - this._leverOn) * (1 - p);
    this.startPivot.rotation.x += (st - this.startPivot.rotation.x) * k;

    // ---- redraw the phosphor at a fixed low rate: this canvas + texture upload
    // was the single biggest per-frame cost in the whole experience.
    this._acc = (this._acc || 0) + dt;
    const period = 1 / (CONFIG.render.crtHz || 12);
    if (p > 0.02 && this._acc >= period) { this._acc = 0; this._draw(); }
    return p;
  }

  get isAway() { return this.rolling > 0.92; }
}
