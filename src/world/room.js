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
import { addSignage, addServices, addDoorDetail, addBatteryGauge, updateBatteryGauge } from './detail.js';

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

    // floor and ceiling shared ONE material: identical maps and tiling, and
    // every extra material clones three 1024 textures onto the GPU.
    const floorMat = this._mat(tex.concrete, 3, 3, { color: 0x4a4e56 });
    const ceilMat = floorMat;
    // --- WALLS: three DIFFERENT tilings so no two surfaces share a pattern,
    // and low metalness so the beam stops turning them into polished sheet.
    const wallMat = this._mat(tex.metal, 2.15, 1.75, { color: 0x585d66, metalness: 0.12, roughness: 0.88 });
    const wallMatB = this._mat(tex.concrete, 1.55, 1.25, { color: 0x565a61, metalness: 0.06, roughness: 0.93 });
    const wallMatC = this._mat(tex.metal, 2.75, 1.35, { color: 0x545a63, metalness: 0.14, roughness: 0.86 });
    this.wallMatB = wallMatB; this.wallMatC = wallMatC;
    // --- MATERIAL FAMILIES: each object type gets its own physical answer -----
    const metal = this._mat(tex.metal, 2, 2, { color: 0x5b6068, metalness: 0.3, roughness: 0.72 });
    const rust = this._mat(tex.rust, 1, 1, { color: 0x7a4f30, metalness: 0.12, roughness: 0.97 });
    // painted steel: furniture, lockers, shelving
    const painted = this._mat(tex.metal, 1.6, 1.6, { color: 0x3d4a4e, metalness: 0.18, roughness: 0.8 });
    // stainless: handles, bars, hardware you touch
    const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.85, roughness: 0.38 });
    // aged plastic / bakelite: knobs, switch bodies
    const plastic = new THREE.MeshStandardMaterial({ color: 0x23252a, metalness: 0.0, roughness: 0.62 });
    // worn timber: crates and pallets
    const timber = this._mat(tex.rust, 1.2, 1.2, { color: 0x6b5638, metalness: 0.0, roughness: 0.95 });
    // chipped enamel paint: the door leaf
    const enamel = this._mat(tex.rust, 0.9, 1.4, { color: 0x4a5b53, metalness: 0.1, roughness: 0.86 });
    Object.assign(this, { painted, steel, plastic, timber, enamel });
    const voidMat = new THREE.MeshStandardMaterial({ color: 0x030406, roughness: 1, side: THREE.BackSide });
    // Dark painted equipment. The big flat faces of the cabinet, pump and bench
    // sit ~1 m from the lamp; in mid-grey metal the beam clipped them to white.
    const equip = this._mat(tex.metal, 2, 2, { color: 0x2a2e33, metalness: 0.3, roughness: 0.9 });
    this.metal = metal; this.rust = rust; this.voidMat = voidMat; this.equip = equip;

    const plane = (pw, ph, m) => new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), m);

    const floor = plane(CONFIG.room.W, CONFIG.room.D, floorMat);
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; g.add(floor);
    const ceil = plane(CONFIG.room.W, CONFIG.room.D, ceilMat);
    ceil.rotation.x = Math.PI / 2; ceil.position.y = h; ceil.receiveShadow = true; g.add(ceil);
    // Back wall: never seen (no rear screen) — minimal, just to catch shadows.
    const back = plane(CONFIG.room.W, h, wallMat);
    back.position.set(0, h / 2, d); back.rotation.y = Math.PI; back.receiveShadow = true; g.add(back);
    const left = plane(CONFIG.room.D, h, wallMatB);
    left.position.set(-w, h / 2, 0); left.rotation.y = Math.PI / 2; left.receiveShadow = true; g.add(left);
    const right = plane(CONFIG.room.D, h, wallMatC);
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
    // Painted plant signage, ceiling services and door hardware. Kept in
    // detail.js so this file stays about structure and the accesses.
    addSignage(this);
    addServices(this);
    addDoorDetail(this);
    addBatteryGauge(this);

    // ---- shadow pockets S1..S6: the only legal lurking spots -------------
    this.shadowSpots = [
      new V3(-1.30, 0, -1.30), new V3(1.30, 0, -1.30), new V3(0, 0, -1.45),
      new V3(-1.28, 0, -0.85), new V3(1.25, 0, 1.00), new V3(-0.50, 0, 1.05),
    ];
    // ---- battery pickup positions (on ledges / in the pockets) -----------
    // Cells sit where a maintenance crew would actually have left them: on the
    // bench, on the shelving, by the breaker cabinet, on the crates, on the desk
    // and on the pump's flange. Each one makes you look toward a way in.
    this.pickupSpots = [
      { pos: new V3(-1.05, 0.95, 0.70), pan: -0.8 },   // maintenance bench top
      { pos: new V3(-1.32, 0.98, -0.85), pan: -0.9 },  // industrial shelving
      { pos: new V3(1.30, 0.92, 0.75), pan: 0.85 },    // ledge of the breaker cabinet
      { pos: new V3(1.26, 0.90, 0.95), pan: 0.8 },     // stacked crate, right-back
      { pos: new V3(-0.50, 0.86, 1.08), pan: -0.3 },   // control desk
      { pos: new V3(1.18, 0.60, -0.95), pan: 0.7 },    // pump flange (faces the window)
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
    const hallDoorMat = new THREE.MeshStandardMaterial({ color: 0x0b0c10, roughness: 0.95 });
    for (const z of [-1.15, -2.30]) for (const sx of [-1, 1]) {
      const dr = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 1.55), hallDoorMat);
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
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(1.02, 2.02, 0.06), this.enamel);
    leaf.geometry.translate(0.51, 0, 0);
    leaf.castShadow = leaf.receiveShadow = true; pivot.add(leaf);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.14), this.steel);
    handle.position.set(0.9, 0.02, 0.08); pivot.add(handle);
    this.doorPivot = pivot;
    pivot.rotation.y = 0;              // shut in its frame at the start of a night
  }

  _window(pos, ry) {
    const grp = new THREE.Group(); grp.position.copy(pos); grp.rotation.y = ry; this.group.add(grp);

    // The whole right wall used to read as one uniform mass because the frame,
    // the sill and the wall were all variants of the same metal at similar
    // roughness. Each part now gets a DIFFERENT physical answer to light:
    //   frame   = machined steel, smooth + metallic  -> catches a hard highlight
    //   surround= rough painted concrete lintel      -> matte, kills reflection
    //   sill    = heavily worn, deep normals         -> broken, gritty
    const steel = new THREE.MeshStandardMaterial({
      color: 0x8f959c, roughness: 0.28, metalness: 0.92,
      map: this.metal.map, normalMap: this.metal.normalMap,
      normalScale: new THREE.Vector2(0.5, 0.5),
    });
    const lintelMat = new THREE.MeshStandardMaterial({
      color: 0x6d6a63, roughness: 0.98, metalness: 0.0,
      map: this.rust.map, normalMap: this.rust.normalMap,
      normalScale: new THREE.Vector2(2.2, 2.2),
    });
    const sillMat = new THREE.MeshStandardMaterial({
      color: 0x55524c, roughness: 0.88, metalness: 0.35,
      map: this.rust.map, normalMap: this.rust.normalMap,
      normalScale: new THREE.Vector2(2.8, 2.8),
    });
    this._winSteel = steel;

    // structural surround: a concrete lintel over it and two pilasters, so the
    // opening is framed by architecture instead of floating in a flat wall
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.2, 0.16), lintelMat);
    lintel.position.set(0, 0.72, 0.06); lintel.castShadow = lintel.receiveShadow = true; grp.add(lintel);
    for (const sx of [-1, 1]) {
      const pil = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.72, 0.13), lintelMat);
      pil.position.set(sx * 0.85, -0.16, 0.05); pil.castShadow = pil.receiveShadow = true; grp.add(pil);
    }

    // the frame itself: 4 machined bars, so the glazing line is a real recess
    const bar = (sx, sy, px, py) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, 0.14), steel);
      m.position.set(px, py, 0.02); m.castShadow = m.receiveShadow = true; grp.add(m);
    };
    bar(1.52, 0.11, 0, 0.52); bar(1.52, 0.11, 0, -0.52);
    bar(0.11, 1.04, -0.70, 0); bar(0.11, 1.04, 0.70, 0);
    // central mullion: gives the opening a readable division
    const mull = new THREE.Mesh(new THREE.BoxGeometry(0.055, 1.0, 0.1), steel);
    mull.position.set(0, 0, 0.02); mull.castShadow = true; grp.add(mull);

    const hole = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.96, 0.9), this.voidMat);
    hole.position.set(0, 0, -0.48); grp.add(hole);

    const sill = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.11, 0.32), sillMat);
    sill.position.set(0, -0.6, 0.12); sill.castShadow = sill.receiveShadow = true; grp.add(sill);
    // bent-up lip on the sill: something has been climbing over this
    const lip = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.05, 0.04), sillMat);
    lip.position.set(0, -0.55, 0.27); lip.rotation.x = -0.4; grp.add(lip);

    // remaining glass: bright, sharp, clearly a different substance
    const shard = new THREE.MeshPhysicalMaterial({
      color: 0x9fc4cc, roughness: 0.03, metalness: 0.0,
      transmission: 0.85, transparent: true, opacity: 0.3, ior: 1.52,
      reflectivity: 1.0, side: THREE.DoubleSide,
    });
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(0.14 + Math.random() * 0.2, 0.14 + Math.random() * 0.22), shard);
      const e = i % 4;
      s.position.set(e === 0 ? -0.58 : e === 1 ? 0.58 : (Math.random() - 0.5) * 1.0,
                     e === 2 ? -0.42 : e === 3 ? 0.44 : (Math.random() - 0.5) * 0.72, 0.055);
      s.rotation.z = (Math.random() - 0.5) * 0.8; s.rotation.y = (Math.random() - 0.5) * 0.3;
      grp.add(s);
    }
    // glass grit on the sill and floor below: tells the story and adds sparkle
    const grit = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(0.016), shard, 14);
    const mm = new THREE.Matrix4(), qq = new THREE.Quaternion();
    for (let i = 0; i < 14; i++) {
      mm.compose(new V3((Math.random() - 0.5) * 1.4, i < 7 ? -0.53 : -1.2, 0.16 + Math.random() * 0.22),
        qq.setFromEuler(new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3)), new V3(1, 1, 1));
      grit.setMatrixAt(i, mm);
    }
    grit.instanceMatrix.needsUpdate = true; grp.add(grit);

    // LOCAL LIGHT: a dead-cold spill from the machine room behind, so the hole
    // reads as depth and anything climbing through is backlit.
    const back = new THREE.PointLight(0x2a4a66, 1.5, 2.6, 2);
    back.position.set(0, 0, -0.7); grp.add(back);
    this.windowLight = back;

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
    this.ventCover = cover;
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
    this.hatchLid = lid;
  }

  _clock(pos) {
    const grp = new THREE.Group(); grp.position.copy(pos); this.group.add(grp);
    const R = 512, C = R / 2;
    const cv = document.createElement('canvas'); cv.width = cv.height = R;
    const x = cv.getContext('2d');
    x.fillStyle = '#d8d2c4'; x.beginPath(); x.arc(C, C, C - 8, 0, 7); x.fill();
    x.strokeStyle = '#15120f'; x.lineWidth = 12; x.stroke();
    // the shift ends at 6 — mark that sector so the goal is unmistakable
    x.fillStyle = 'rgba(170,32,24,0.16)';
    x.beginPath(); x.moveTo(C, C); x.arc(C, C, C - 20, -Math.PI / 2, Math.PI / 2); x.closePath(); x.fill();
    x.textAlign = 'center'; x.textBaseline = 'middle';
    for (let i = 1; i <= 12; i++) {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      const tx = C + Math.cos(a) * (C - 62), ty = C + Math.sin(a) * (C - 62);
      const six = (i === 6);
      x.fillStyle = six ? '#a92018' : '#15120f';
      x.font = `${six ? 'bold ' : ''}${six ? 62 : 44}px ${CONFIG.fonts.stencil}`;
      x.fillText(String(i), tx, ty);
      // minute ticks
      x.beginPath();
      x.arc(C + Math.cos(a) * (C - 22), C + Math.sin(a) * (C - 22), i % 3 === 0 ? 7 : 4, 0, 7);
      x.fillStyle = '#15120f'; x.fill();
    }
    x.fillStyle = '#a92018'; x.font = `30px ${CONFIG.fonts.crt}`;
    x.fillText('SALIDA 06:00', C, C + 118);
    // decades of grime
    x.fillStyle = 'rgba(60,50,35,0.26)'; x.beginPath(); x.arc(C * 0.7, C * 1.25, 110, 0, 7); x.fill();
    x.fillStyle = 'rgba(40,34,24,0.18)'; x.beginPath(); x.arc(C * 1.35, C * 0.7, 78, 0, 7); x.fill();
    const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace;
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.17, 32), new THREE.MeshStandardMaterial({ map: tx, roughness: 0.7 }));
    face.position.z = 0.035; grp.add(face);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.016, 8, 32), this.metal); rim.position.z = 0.035; grp.add(rim);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.175, 0.06, 24), this.metal);
    body.rotation.x = Math.PI / 2; grp.add(body);
    const handMat = new THREE.MeshStandardMaterial({ color: 0x14110e, roughness: 0.5 });
    const mk = (len, wid) => { const m = new THREE.Mesh(new THREE.BoxGeometry(wid, len, 0.008), handMat); m.geometry.translate(0, len / 2, 0); m.position.z = 0.045; grp.add(m); return m; };
    this.clock = { grp, hour: mk(0.085, 0.017), minute: mk(0.135, 0.011) };
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
    const crates = new THREE.InstancedMesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), this.timber, 4);
    crates.castShadow = crates.receiveShadow = true;
    // Pulled off the cabinet (they blocked it) and away from the floor hatch.
    [[w - 0.30, 0.28, d - 0.18, 0.3], [w - 0.34, 0.83, d - 0.22, 0.5], [-w + 0.95, 0.28, d - 0.16, 0.1], [-w + 0.42, 0.28, d - 0.30, -0.2]]
      .forEach(([x, y, z, ry], i) => { m.compose(new V3(x, y, z), q.setFromEuler(new THREE.Euler(0, ry, 0)), new V3(1, 1, 1)); crates.setMatrixAt(i, m); });
    crates.instanceMatrix.needsUpdate = true; this.group.add(crates);

    const desk = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.05, 0.5), this.painted);
    desk.position.set(-0.5, 0.78, d - 0.32); desk.castShadow = desk.receiveShadow = true; this.group.add(desk);
    for (const [lx, lz] of [[-0.95, 1.02], [-0.05, 1.02], [-0.95, 1.4], [-0.05, 1.4]]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.78, 0.05), this.metal); l.position.set(lx, 0.39, lz); l.castShadow = true; this.group.add(l);
    }

    // ---- instanced hardware: hundreds of bolts/seams for ONE draw call ----
    const boltGeo = new THREE.CylinderGeometry(0.011, 0.013, 0.012, 6);
    const bolts = [];
    const pushBolt = (x, y, z, rx, ry) => bolts.push([x, y, z, rx, ry]);
    // bolt rows along the wall panel seams
    for (let i = 0; i < 7; i++) {
      const z = -1.35 + i * 0.45;
      pushBolt(-w + 0.012, 0.16, z, 0, Math.PI / 2); pushBolt(-w + 0.012, 1.62, z, 0, Math.PI / 2);
      pushBolt(w - 0.012, 0.16, z, 0, -Math.PI / 2); pushBolt(w - 0.012, 1.62, z, 0, -Math.PI / 2);
    }
    for (let i = 0; i < 6; i++) {
      const x = -1.25 + i * 0.5;
      pushBolt(x, 0.16, -d + 0.012, Math.PI / 2, 0); pushBolt(x, 2.28, -d + 0.012, Math.PI / 2, 0);
    }
    const boltMesh = new THREE.InstancedMesh(boltGeo, this.metal, bolts.length);
    boltMesh.castShadow = true; boltMesh.receiveShadow = true;
    bolts.forEach(([x, y, z, rx, ry], i) => {
      m.compose(new V3(x, y, z), q.setFromEuler(new THREE.Euler(rx, ry, 0)), new V3(1, 1, 1));
      boltMesh.setMatrixAt(i, m);
    });
    boltMesh.instanceMatrix.needsUpdate = true; this.group.add(boltMesh);

    // horizontal panel seams (recessed strips) - one instanced batch
    const seamGeo = new THREE.BoxGeometry(0.02, 0.022, CONFIG.room.D - 0.05);
    const seams = new THREE.InstancedMesh(seamGeo, this.rust, 4);
    seams.receiveShadow = true;
    [[-w + 0.011, 1.62, 0, 0], [w - 0.011, 1.62, 0, 0], [-w + 0.011, 0.16, 0, 0], [w - 0.011, 0.16, 0, 0]]
      .forEach(([x, y, z], i) => { m.compose(new V3(x, y, z), q.identity(), new V3(1, 1, 1)); seams.setMatrixAt(i, m); });
    seams.instanceMatrix.needsUpdate = true; this.group.add(seams);

    // pipe brackets clamping the ceiling runs
    const brGeo = new THREE.TorusGeometry(0.062, 0.012, 5, 10, Math.PI);
    const brackets = new THREE.InstancedMesh(brGeo, this.metal, 9);
    brackets.castShadow = true;
    let bi = 0;
    for (const px of [-1.15, 1.05, 1.25]) for (const pz of [-1.1, 0, 1.1]) {
      m.compose(new V3(px, h - 0.13, pz), q.setFromEuler(new THREE.Euler(0, 0, 0)), new V3(1, 1, 1));
      brackets.setMatrixAt(bi++, m);
    }
    brackets.instanceMatrix.needsUpdate = true; this.group.add(brackets);

    // conduit running down the corner + a junction box (reads as a real build)
    const conduit = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.9, 8), this.metal);
    conduit.position.set(-w + 0.06, 1.2, -d + 0.09); conduit.castShadow = true; this.group.add(conduit);
    const jbox = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.08), this.metal);
    jbox.position.set(-w + 0.07, 0.5, -d + 0.1); jbox.castShadow = true; this.group.add(jbox);

    // skirting so walls meet the floor with a real edge, not a seam
    const skirtGeo = new THREE.BoxGeometry(0.03, 0.09, CONFIG.room.D);
    const skirt = new THREE.InstancedMesh(skirtGeo, this.rust, 2);
    skirt.receiveShadow = true;
    [[-w + 0.015, 0.045, 0], [w - 0.015, 0.045, 0]].forEach(([x, y, z], i) => {
      m.compose(new V3(x, y, z), q.identity(), new V3(1, 1, 1)); skirt.setMatrixAt(i, m);
    });
    skirt.instanceMatrix.needsUpdate = true; this.group.add(skirt);

    // ---- ZONE IDENTITY: each wall now reads as a specific part of a plant ---
    // LEFT-BACK = maintenance bench. Something a night watchman actually uses,
    // and the natural place to find spare cells.
    // Moved back against the rear corner: at z=0.95 this bench stood squarely
    // across the doorway approach and hid the door itself.
    const bench = new THREE.Group(); bench.position.set(-1.02, 0, 1.19); this.group.add(bench);
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.06, 1.15), this.painted);
    top.position.set(0, 0.88, 0); top.castShadow = top.receiveShadow = true; bench.add(top);
    for (const [bx, bz] of [[-0.25, -0.5], [0.25, -0.5], [-0.25, 0.5], [0.25, 0.5]]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.88, 0.06), this.metal);
      l.position.set(bx, 0.44, bz); l.castShadow = true; bench.add(l);
    }
    const backboard = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 1.1), this.rust);
    backboard.position.set(-0.29, 1.16, 0); backboard.castShadow = true; bench.add(backboard);
    // tools hanging on the backboard: instanced, one draw call
    const toolGeo = new THREE.BoxGeometry(0.03, 0.22, 0.03);
    const tools = new THREE.InstancedMesh(toolGeo, this.metal, 5);
    tools.castShadow = true;
    for (let i = 0; i < 5; i++) {
      m.compose(new V3(-0.25, 1.14, -0.42 + i * 0.21), q.setFromEuler(new THREE.Euler(0, 0, (i % 2 ? 1 : -1) * 0.12)), new V3(1, 1, 1));
      tools.setMatrixAt(i, m);
    }
    tools.instanceMatrix.needsUpdate = true; bench.add(tools);
    const vice = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.13, 0.16), this.metal);
    vice.position.set(0.1, 0.97, -0.42); vice.castShadow = true; bench.add(vice);

    // RIGHT-BACK = electrical distribution. Tells you where the power is.
    const cab = new THREE.Group(); cab.position.set(w - 0.14, 1.05, 0.75); this.group.add(cab);
    const box2 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.85, 0.62), this.equip);
    box2.castShadow = box2.receiveShadow = true; cab.add(box2);
    const doorPanel = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.78, 0.56), this.equip);
    doorPanel.position.set(-0.12, 0, 0.03); doorPanel.rotation.y = 0.35; doorPanel.castShadow = true; cab.add(doorPanel);
    // breaker rows behind the ajar panel
    const brk = new THREE.InstancedMesh(new THREE.BoxGeometry(0.03, 0.05, 0.02), this.metal, 12);
    for (let i = 0; i < 12; i++) {
      m.compose(new V3(-0.1, 0.28 - (i % 6) * 0.09, -0.16 + Math.floor(i / 6) * 0.22), q.identity(), new V3(1, 1, 1));
      brk.setMatrixAt(i, m);
    }
    brk.instanceMatrix.needsUpdate = true; cab.add(brk);
    // (the old unlit yellow square here was replaced by the painted danger
    //  panel in detail.js, which reads far better and cannot glow on its own)

    // RIGHT-FRONT = a dead pump with a hand valve: the "machine" of the room
    const pump = new THREE.Group(); pump.position.set(w - 0.32, 0, -0.95); this.group.add(pump);
    const body2 = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 0.55, 12), this.equip);
    body2.position.y = 0.28; body2.castShadow = body2.receiveShadow = true; pump.add(body2);
    const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 12), this.metal);
    flange.position.y = 0.56; pump.add(flange);
    const riser = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 1.6, 10), this.rust);
    riser.position.set(0, 1.38, 0); riser.castShadow = true; pump.add(riser);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.018, 6, 14), this.metal);
    wheel.position.set(-0.12, 0.95, 0); wheel.rotation.y = Math.PI / 2; wheel.castShadow = true; pump.add(wheel);
    for (let i = 0; i < 3; i++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.24, 0.015), this.metal);
      spoke.position.set(-0.12, 0.95, 0); spoke.rotation.x = i * 1.05; wheel.parent.add(spoke);
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
    // A fire-alarm beacon whose driver has failed: it keeps trying to strobe,
    // never quite manages it, and drifts between red and a sickly orange.
    const cage = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.008, 5, 10), this.steel);
    cage.position.copy(dome.position); cage.rotation.z = Math.PI / 2; this.group.add(cage);
    this.lights = { fluo, fluoMesh: tube, emergency: emg, emgDome: dome, emgBase: 3.4 };
    this._emgT = 0; this._emgLevel = 1;
  }

  // ---- animated state ----------------------------------------------------
  // ===== PERSISTENT ACCESSES ==============================================
  // Every way into this room starts the night SHUT. Each time a creature pushes
  // through, the access moves one notch further open and stays there — the room
  // is permanently degraded by what has been coming in. Sound is emitted only on
  // a real state change, so a fully-open door never "opens" again.
  _initAccesses() {
    const mk = (kind, steps, pan) => ({ kind, steps, pan, state: 0, anim: 0, target: 0, tellT: 0, pending: 0 });
    this.accesses = {
      door: mk('door', 3, -0.95),
      vent: mk('vent', 3, -0.35),
      hatch: mk('hatch', 3, 0.30),
    };
    // Do NOT clobber the handler here: _initAccesses() runs lazily on the first
    // update(), which is AFTER the Game has registered its callback — resetting
    // it silently killed every door/vent/hatch sound in normal play.
    if (typeof this.onAccessSound !== 'function') this.onAccessSound = null;
  }

  resetAccesses() {
    if (!this.accesses) this._initAccesses();
    for (const a of Object.values(this.accesses)) { a.state = 0; a.anim = 0; a.target = 0; a.tellT = 0; a.pending = 0; }
  }

  /** A creature forces this access one notch wider. No-op once fully open. */
  openStep(name) {
    const a = this.accesses && this.accesses[name];
    if (!a || a.state >= a.steps) return false;   // already wide open: nothing to hear
    a.pending = 1; a.tellT = 0.42;                // it shudders first, then gives
    return true;
  }

  /** A creature backs out. A partially open access is pulled shut a notch;
   *  one already forced fully open stays that way for the rest of the night. */
  closeStep(name) {
    const a = this.accesses && this.accesses[name];
    if (!a || a.state <= 0 || a.state >= a.steps) return false;
    a.pending = -1; a.tellT = 0.12;
    return true;
  }

  accessState(name) { const a = this.accesses && this.accesses[name]; return a ? a.state : 0; }

  /** How far an access has ACTUALLY travelled, not just what was requested.
   *  Creatures gate their movement on this so nothing crosses closed geometry. */
  accessOpenness(name) {
    const a = this.accesses && this.accesses[name];
    if (!a) return { state: 99, steps: 1, anim: 1, moving: false };
    return { state: a.state, steps: a.steps, anim: a.anim, moving: a.tellT > 0 || Math.abs(a.target - a.anim) > 0.04 };
  }

  _applyAccess(a, dt, t) {
    // the shudder that precedes any movement
    if (a.tellT > 0) {
      a.tellT -= dt;
      if (a.tellT <= 0 && a.pending !== 0) {
        a.state = Math.max(0, Math.min(a.steps, a.state + a.pending));
        a.target = a.state / a.steps;
        if (this.onAccessSound) this.onAccessSound(a.kind, a.state || 1, a.pan, a.pending < 0);
        a.pending = 0;
      }
    }
    a.anim += (a.target - a.anim) * Math.min(1, dt * 3.2);
    const shudder = a.tellT > 0 ? Math.min(1, a.tellT / 0.42) : 0;

    if (a.kind === 'door' && this.doorPivot) {
      // 0 -> shut, 1 -> wide. Hinge groan wobble while it travels.
      this.doorPivot.rotation.y = -a.anim * 1.05 + Math.sin(t * 46) * 0.012 * shudder;
    } else if (a.kind === 'vent' && this.ventCover) {
      this.ventCover.rotation.x = -a.anim * 1.5 + Math.sin(t * 74) * 0.06 * shudder;
      this.ventCover.position.x = Math.sin(t * 91) * 0.007 * shudder;
    } else if (a.kind === 'hatch' && this.hatchLid) {
      const bump = shudder * Math.max(0, Math.sin(t * 15)) * 0.05;
      this.hatchLid.position.y = 0.02 + bump;
      this.hatchLid.rotation.x = -a.anim * 0.9;
      this.hatchLid.position.z = -0.4 + a.anim * 0.34;
      this.hatchLid.rotation.z = bump * 0.8;
    }
  }

  update(dt) {
    this._t = (this._t || 0) + dt;
    if (!this.accesses) this._initAccesses();

    // --- failing alarm beacon: irregular strobe attempts + slow colour drift --
    const L = this.lights;
    if (L && L.emergency) {
      this._emgT -= dt;
      if (this._emgT <= 0) {
        // never a fixed rhythm: sometimes a stutter, sometimes a long sulk
        const r = Math.random();
        this._emgLevel = r < 0.18 ? 1.9 : r < 0.55 ? 0.85 : 0.35;
        this._emgT = r < 0.18 ? 0.07 + Math.random() * 0.12 : 0.35 + Math.random() * 2.2;
      }
      const want = L.emgBase * this._emgLevel;
      L.emergency.intensity += (want - L.emergency.intensity) * Math.min(1, dt * 9);
      // subtle hue drift red <-> sickly orange
      const hue = 0.012 + 0.022 * (0.5 + 0.5 * Math.sin(this._t * 0.23));
      L.emergency.color.setHSL(hue, 0.85, 0.32);
      if (L.emgDome) L.emgDome.material.color.setHSL(hue, 0.9, 0.13 + 0.09 * this._emgLevel);
    }
    for (const a of Object.values(this.accesses)) this._applyAccess(a, dt, this._t);
  }

  /** Drive the lamp charge meter (0..1). */
  setBattery(frac, dt) { updateBatteryGauge(this, frac, dt); }

  /** frac 0..1 across the night -> clock hands (00:00 -> 06:00). */
  setClock(frac) {
    if (!this.clock) return;
    const hours = CONFIG.game.clockFrom + frac * (CONFIG.game.clockTo - CONFIG.game.clockFrom);
    this.clock.hour.rotation.z = -(hours / 12) * Math.PI * 2;
    this.clock.minute.rotation.z = -((hours % 1)) * Math.PI * 2;
  }

}
