// =============================================================================
// room.js — The night-watch control post, built to docs/FASE1_ESCENARIO.md §2.
// Every opening exists because a real building would need it, and each one is a
// creature's way in:
//   FRONT  corridor (with side doors + red exit backlight) + low air vent
//   LEFT   heavy door, ajar 32° -> the "slit"
//   RIGHT  smashed observation window with a sill to climb over
//   FLOOR  drainage hatch with a grate
// Plus the diegetic wall CLOCK (the night timer) and the shadow pockets S1..S6
// that creatures are allowed to occupy.
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { buildTextures } from './textures.js';

const V3 = THREE.Vector3;

function tiled(maps, rx, ry) {
  const o = {};
  for (const k of ['map', 'normalMap', 'roughnessMap']) {
    if (!maps[k]) continue;
    const t = maps[k].clone(); t.needsUpdate = true;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry);
    o[k] = t;
  }
  return o;
}

export class Room {
  constructor() {
    this.group = new THREE.Group();
    this.pickupSpots = [];
    this._build();
  }

  _mat(maps, rx, ry, extra = {}) {
    const t = tiled(maps, rx, ry);
    return new THREE.MeshStandardMaterial({
      map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap,
      metalness: 0, roughness: 1, normalScale: new THREE.Vector2(1.4, 1.4),
      color: 0x5a5f68, ...extra,
    });
  }

  _build() {
    const tex = buildTextures();
    const w = CONFIG.room.W / 2, d = CONFIG.room.D / 2, h = CONFIG.room.H;
    const g = this.group;

    const floorMat = this._mat(tex.concrete, 3, 3, { color: 0x50545c });
    const ceilMat = this._mat(tex.concrete, 3, 3, { color: 0x3c3f46 });
    const wallMat = this._mat(tex.metal, 3, 2.4, { color: 0x5c616a, metalness: 0.5, roughness: 0.66 });
    const metal = this._mat(tex.metal, 2, 2, { color: 0x5f646c, metalness: 0.6, roughness: 0.55 });
    const rust = this._mat(tex.rust, 1, 1, { color: 0x7a4f30, metalness: 0.25, roughness: 0.95 });
    const voidMat = new THREE.MeshStandardMaterial({ color: 0x030406, roughness: 1, side: THREE.BackSide });
    this.metal = metal; this.rust = rust; this.voidMat = voidMat;

    const plane = (pw, ph, m) => new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), m);

    const floor = plane(CONFIG.room.W, CONFIG.room.D, floorMat);
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; g.add(floor);
    const ceil = plane(CONFIG.room.W, CONFIG.room.D, ceilMat);
    ceil.rotation.x = Math.PI / 2; ceil.position.y = h; ceil.receiveShadow = true; g.add(ceil);
    // Back wall: never seen (no rear screen) — minimal, just to catch shadows.
    const back = plane(CONFIG.room.W, h, wallMat);
    back.position.set(0, h / 2, d); back.rotation.y = Math.PI; back.receiveShadow = true; g.add(back);
    const left = plane(CONFIG.room.D, h, wallMat);
    left.position.set(-w, h / 2, 0); left.rotation.y = Math.PI / 2; left.receiveShadow = true; g.add(left);
    const right = plane(CONFIG.room.D, h, wallMat);
    right.position.set(w, h / 2, 0); right.rotation.y = -Math.PI / 2; right.receiveShadow = true; g.add(right);

    // ---- FRONT wall built around the corridor opening ----------------------
    const opW = 1.30, opH = 2.15, sideW = (CONFIG.room.W - opW) / 2;
    const fl = plane(sideW, h, wallMat); fl.position.set(-(opW / 2 + sideW / 2), h / 2, -d); fl.receiveShadow = true; g.add(fl);
    const fr = plane(sideW, h, wallMat); fr.position.set(opW / 2 + sideW / 2, h / 2, -d); fr.receiveShadow = true; g.add(fr);
    const ft = plane(opW, h - opH, wallMat); ft.position.set(0, opH + (h - opH) / 2, -d); ft.receiveShadow = true; g.add(ft);

    this._corridor(new V3(0, 0, -d), opW, opH);
    this._door(new V3(-w, 0, 0.35), Math.PI / 2);
    this._window(new V3(w, 1.20, -0.15), -Math.PI / 2);
    this._vent(new V3(-0.90, 0.60, -d + 0.002), 0);
    this._hatch(new V3(0.55, 0.002, 0.45));
    this._clock(new V3(0, 2.28, -d + 0.06));
    this._props();
    this._lights();

    // ---- shadow pockets S1..S6: the only legal lurking spots -------------
    this.shadowSpots = [
      new V3(-1.30, 0, -1.30), new V3(1.30, 0, -1.30), new V3(0, 0, -1.45),
      new V3(-1.28, 0, -0.85), new V3(1.25, 0, 1.00), new V3(-0.50, 0, 1.05),
    ];
    // ---- battery pickup positions (on ledges / in the pockets) -----------
    this.pickupSpots = [
      { pos: new V3(-1.34, 0.95, -0.85), pan: -0.85 },   // shelf, left wall
      { pos: new V3(-1.30, 0.06, -1.28), pan: -0.7 },    // floor, S1
      { pos: new V3(1.30, 0.06, -1.26), pan: 0.7 },      // floor, S2
      { pos: new V3(1.32, 0.70, 0.95), pan: 0.85 },      // on the crates
      { pos: new V3(-0.50, 0.83, 1.05), pan: -0.3 },     // on the desk
      { pos: new V3(0.30, 0.06, -1.40), pan: 0.15 },     // floor, corridor mouth
    ];
  }

  _corridor(pos, opW, opH) {
    const grp = new THREE.Group(); grp.position.copy(pos); this.group.add(grp);
    const L = 3.2;
    const tube = new THREE.Mesh(new THREE.BoxGeometry(opW, opH, L), this.voidMat);
    tube.position.set(0, opH / 2, -L / 2); tube.receiveShadow = true; grp.add(tube);
    const bar = (x, y, z, sx, sy, sz) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), this.metal); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; grp.add(m); };
    bar(-opW / 2, opH / 2, 0, 0.09, opH, 0.17); bar(opW / 2, opH / 2, 0, 0.09, opH, 0.17); bar(0, opH, 0, opW + 0.1, 0.11, 0.17);
    // side doors down the hall: the plant continues
    for (const z of [-1.15, -2.30]) for (const sx of [-1, 1]) {
      const dr = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 1.55), new THREE.MeshStandardMaterial({ color: 0x0b0c10, roughness: 0.95 }));
      dr.position.set(sx * (opW / 2 - 0.012), 0.86, z); dr.rotation.y = sx * Math.PI / 2; grp.add(dr);
      const fr2 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.6, 0.05), this.metal);
      fr2.position.set(sx * (opW / 2 - 0.03), 0.88, z + 0.31); grp.add(fr2);
    }
    // red exit backlight at the far end -> silhouettes
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(opW * 0.8, opH * 0.62),
      new THREE.MeshBasicMaterial({ color: 0x3a0606, toneMapped: false }));
    glow.position.set(0, opH * 0.48, -L + 0.03); grp.add(glow);
    const exit = new THREE.PointLight(0x771212, 1.6, 3.6, 2);
    exit.position.set(0, 1.15, -L + 0.35); grp.add(exit);
    this.corridor = grp;
  }

  _door(pos, ry) {
    const grp = new THREE.Group(); grp.position.copy(pos); grp.rotation.y = ry; this.group.add(grp);
    const recess = new THREE.Mesh(new THREE.BoxGeometry(1.06, 2.1, 1.0), this.voidMat);
    recess.position.set(0, 1.05, -0.55); recess.receiveShadow = true; grp.add(recess);
    const jamb = (x) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.14, 0.17), this.metal); m.position.set(x, 1.07, 0); m.castShadow = m.receiveShadow = true; grp.add(m); };
    jamb(-0.56); jamb(0.56);
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.14, 0.17), this.metal);
    lintel.position.set(0, 2.14, 0); lintel.castShadow = true; grp.add(lintel);
    // hinge on the left edge so the gap (the "slit") opens on the right
    const pivot = new THREE.Group(); pivot.position.set(-0.52, 1.02, -0.05); grp.add(pivot);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(1.02, 2.02, 0.06), this.rust);
    leaf.geometry.translate(0.51, 0, 0);
    leaf.castShadow = leaf.receiveShadow = true; pivot.add(leaf);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.14), this.metal);
    handle.position.set(0.9, 0.02, 0.08); pivot.add(handle);
    this.door = { pivot, base: -0.56, open: 0, target: 0 };   // -32° at rest
    pivot.rotation.y = this.door.base;
  }

  _window(pos, ry) {
    const grp = new THREE.Group(); grp.position.copy(pos); grp.rotation.y = ry; this.group.add(grp);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.52, 1.16, 0.12), this.metal);
    frame.castShadow = frame.receiveShadow = true; grp.add(frame);
    const hole = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.95, 0.85), this.voidMat);
    hole.position.set(0, 0, -0.45); grp.add(hole);
    const sill = new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.09, 0.3), this.metal);
    sill.position.set(0, -0.58, 0.11); sill.castShadow = sill.receiveShadow = true; grp.add(sill);
    // shards still in the frame
    const shard = new THREE.MeshPhysicalMaterial({ color: 0x0c1013, roughness: 0.22, metalness: 0, transmission: 0.55, transparent: true, opacity: 0.45, ior: 1.4 });
    for (let i = 0; i < 9; i++) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(0.16 + Math.random() * 0.22, 0.16 + Math.random() * 0.24), shard);
      const e = i % 4;
      s.position.set(e === 0 ? -0.56 : e === 1 ? 0.56 : (Math.random() - 0.5) * 0.9,
                     e === 2 ? -0.4 : e === 3 ? 0.42 : (Math.random() - 0.5) * 0.7, 0.06);
      s.rotation.z = (Math.random() - 0.5) * 0.7; grp.add(s);
    }
    this.window = grp;
  }

  _vent(pos, ry) {
    const grp = new THREE.Group(); grp.position.copy(pos); grp.rotation.y = ry; this.group.add(grp);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.7, 0.08), this.metal);
    frame.castShadow = frame.receiveShadow = true; grp.add(frame);
    const duct = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.56, 0.9), this.voidMat);
    duct.position.set(0, 0, -0.47); grp.add(duct);
    const cover = new THREE.Group(); cover.position.set(0, 0.31, 0.05); grp.add(cover);
    for (let i = 0; i < 6; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.07, 0.03), this.metal); s.position.set(0, -0.07 - i * 0.09, 0); s.castShadow = true; cover.add(s); }
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.6, 0.014), this.metal);
    plate.position.set(0, -0.3, -0.02); cover.add(plate);
    this.vent = { cover, open: 0, target: 0 };
  }

  _hatch(pos) {
    const grp = new THREE.Group(); grp.position.copy(pos); this.group.add(grp);
    const pit = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.62, 0.8), this.voidMat);
    pit.position.set(0, -0.31, 0); grp.add(pit);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.03, 0.92), this.metal);
    lip.position.set(0, 0.005, 0); lip.receiveShadow = true; grp.add(lip);
    const lid = new THREE.Group(); lid.position.set(0, 0.02, -0.4); grp.add(lid);
    for (let i = -2; i <= 2; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.03, 0.05), this.metal); b.position.set(0, 0, 0.4 + i * 0.16); b.castShadow = true; lid.add(b);
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.78), this.metal); c.position.set(i * 0.16, 0, 0.4); c.castShadow = true; lid.add(c);
    }
    this.hatch = { lid, open: 0, target: 0 };
  }

  _clock(pos) {
    const grp = new THREE.Group(); grp.position.copy(pos); this.group.add(grp);
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const x = cv.getContext('2d');
    x.fillStyle = '#d8d2c4'; x.beginPath(); x.arc(128, 128, 124, 0, 7); x.fill();
    x.strokeStyle = '#15120f'; x.lineWidth = 6; x.stroke();
    x.fillStyle = '#15120f'; x.font = 'bold 30px ' + CONFIG.fonts.stencil;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    for (let i = 1; i <= 12; i++) {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      x.beginPath(); x.arc(128 + Math.cos(a) * 100, 128 + Math.sin(a) * 100, i % 3 === 0 ? 7 : 4, 0, 7); x.fill();
    }
    // grime
    x.fillStyle = 'rgba(60,50,35,0.28)'; x.beginPath(); x.arc(90, 160, 55, 0, 7); x.fill();
    const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace;
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.17, 32), new THREE.MeshStandardMaterial({ map: tx, roughness: 0.7 }));
    face.position.z = 0.035; grp.add(face);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.016, 8, 32), this.metal); rim.position.z = 0.035; grp.add(rim);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.175, 0.06, 24), this.metal);
    body.rotation.x = Math.PI / 2; grp.add(body);
    const mk = (len, wid, col) => { const m = new THREE.Mesh(new THREE.BoxGeometry(wid, len, 0.008), new THREE.MeshStandardMaterial({ color: col, roughness: 0.5 })); m.geometry.translate(0, len / 2, 0); m.position.z = 0.045; grp.add(m); return m; };
    this.clock = { grp, hour: mk(0.085, 0.017, 0x14110e), minute: mk(0.135, 0.011, 0x14110e) };
    this.setClock(0);
  }

  _props() {
    const w = CONFIG.room.W / 2, d = CONFIG.room.D / 2, h = CONFIG.room.H;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();

    // ceiling pipes (they slice the beam into moving shadow bars)
    const pipes = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, CONFIG.room.D, 10), this.rust, 3);
    pipes.castShadow = true;
    [-1.15, 1.05, 1.25].forEach((x, i) => { m.compose(new V3(x, h - 0.13, 0), q.setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), new V3(1, 1, 1)); pipes.setMatrixAt(i, m); });
    pipes.instanceMatrix.needsUpdate = true; this.group.add(pipes);
    for (let i = 0; i < 3; i++) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.52, 6), this.metal); c.position.set(-0.3 + i * 0.42, h - 0.28, 0.9); c.rotation.z = 0.22 - i * 0.11; c.castShadow = true; this.group.add(c); }

    // left-wall shelving unit (breaks the wall, makes shadow S4)
    const shelf = new THREE.Group(); shelf.position.set(-1.34, 0, -0.85); this.group.add(shelf);
    for (let i = 0; i < 3; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.9), this.metal); s.position.set(0, 0.35 + i * 0.3, 0); s.castShadow = s.receiveShadow = true; shelf.add(s); }
    for (const sz of [-0.43, 0.43]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.98, 0.04), this.metal); p.position.set(0, 0.49, sz); p.castShadow = true; shelf.add(p); }

    // crates (right-back) and desk (left-back)
    const crates = new THREE.InstancedMesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), this.rust, 4);
    crates.castShadow = crates.receiveShadow = true;
    [[w - 0.4, 0.28, d - 0.5, 0.3], [w - 0.44, 0.83, d - 0.55, 0.5], [w - 0.92, 0.28, d - 0.42, 0.1], [-w + 0.52, 0.28, d - 0.42, -0.2]]
      .forEach(([x, y, z, ry], i) => { m.compose(new V3(x, y, z), q.setFromEuler(new THREE.Euler(0, ry, 0)), new V3(1, 1, 1)); crates.setMatrixAt(i, m); });
    crates.instanceMatrix.needsUpdate = true; this.group.add(crates);

    const desk = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.05, 0.5), this.metal);
    desk.position.set(-0.5, 0.78, d - 0.32); desk.castShadow = desk.receiveShadow = true; this.group.add(desk);
    for (const [lx, lz] of [[-0.95, 1.02], [-0.05, 1.02], [-0.95, 1.4], [-0.05, 1.4]]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.78, 0.05), this.metal); l.position.set(lx, 0.39, lz); l.castShadow = true; this.group.add(l);
    }

    // hazard stripe on the floor at the corridor threshold (scale + reading)
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(1.34, 0.13), new THREE.MeshBasicMaterial({ color: 0x2b2410, toneMapped: false }));
    stripe.rotation.x = -Math.PI / 2; stripe.position.set(0, 0.006, -1.15); this.group.add(stripe);

    // damp patches: low roughness so they throw the flashlight back at you
    const wet = new THREE.MeshStandardMaterial({ color: 0x0e1014, roughness: 0.14, metalness: 0.05 });
    for (const [px, pz, r] of [[-0.35, -0.9, 0.28], [0.75, -0.55, 0.2], [-0.9, 0.35, 0.17]]) {
      const p = new THREE.Mesh(new THREE.CircleGeometry(r, 18), wet);
      p.rotation.x = -Math.PI / 2; p.position.set(px, 0.004, pz); this.group.add(p);
    }
  }

  _lights() {
    const h = CONFIG.room.H;
    const tube = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.06, 0.1), new THREE.MeshBasicMaterial({ color: 0x0a0d12, toneMapped: false }));
    tube.position.set(0, h - 0.05, 0.4); this.group.add(tube);
    const fluo = new THREE.PointLight(0xbcd0ea, 0, 9, 2); fluo.position.set(0, h - 0.12, 0.4); this.group.add(fluo);

    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x661414, toneMapped: false }));
    dome.position.set(CONFIG.room.W / 2 - 0.02, 2.15, 1.2); dome.rotation.z = Math.PI / 2; this.group.add(dome);
    const emg = new THREE.PointLight(0x8a221a, 3.4, 6.5, 2); emg.position.set(CONFIG.room.W / 2 - 0.2, 2.1, 1.2); this.group.add(emg);

    this.lights = { fluo, fluoMesh: tube, emergency: emg };
  }

  // ---- animated state ----------------------------------------------------
  setVent(v) { if (this.vent) this.vent.target = v; }
  setHatch(v) { if (this.hatch) this.hatch.target = v; }
  setDoor(v) { if (this.door) this.door.target = v; }

  /** frac 0..1 across the night -> clock hands (00:00 -> 06:00). */
  setClock(frac) {
    if (!this.clock) return;
    const hours = CONFIG.game.clockFrom + frac * (CONFIG.game.clockTo - CONFIG.game.clockFrom);
    this.clock.hour.rotation.z = -(hours / 12) * Math.PI * 2;
    this.clock.minute.rotation.z = -((hours % 1)) * Math.PI * 2;
  }

  update(dt) {
    const k = Math.min(1, dt * 3);
    if (this.vent) { this.vent.open += (this.vent.target - this.vent.open) * k; this.vent.cover.rotation.x = -this.vent.open * 1.5; }
    if (this.hatch) { this.hatch.open += (this.hatch.target - this.hatch.open) * k; this.hatch.lid.rotation.x = -this.hatch.open * 1.15; }
    if (this.door) {
      this.door.open += (this.door.target - this.door.open) * k * 0.7;
      this.door.pivot.rotation.y = this.door.base - this.door.open * 0.75;
    }
  }
}
