// =============================================================================
// room.js — Procedural derelict security post. Each surface reads as something:
//   FRONT  = a corridor opening receding into the dark, with side doors + a red
//            exit glow (a monster can walk up the hall).
//   LEFT   = a heavy door, slightly ajar, with a recess behind it.
//   RIGHT  = a smashed observation window with a sill (a monster can climb in).
//   FRONT-low = an air vent whose louvers swing open (with a duct rattle).
//   FLOOR  = a maintenance hatch/grate a crawler can push up through.
// Dim red emergency light + a stuttering fluorescent keep the space readable
// and tense. Green BATTERY CELLS glow on the walls — light them to recharge.
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { buildTextures } from './textures.js';

const V3 = THREE.Vector3;

function tiled(maps, rx, ry) {
  const c = {};
  for (const k of ['map', 'normalMap', 'roughnessMap']) {
    if (!maps[k]) continue;
    const t = maps[k].clone(); t.needsUpdate = true;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry);
    c[k] = t;
  }
  return c;
}

export class Room {
  constructor() {
    this.group = new THREE.Group();
    this.spawnAnchors = [];
    this.batteryCells = [];
    this._t = 0;
    this._build();
  }

  _mat(maps, rx, ry, extra = {}) {
    const t = tiled(maps, rx, ry);
    return new THREE.MeshStandardMaterial({
      map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap,
      metalness: 0.0, roughness: 1.0, normalScale: new THREE.Vector2(1.4, 1.4),
      color: 0x5a5f68, ...extra,
    });
  }

  _build() {
    const tex = buildTextures();
    const w = CONFIG.room.W / 2, d = CONFIG.room.D / 2, h = CONFIG.room.H;
    const g = this.group;

    const floorMat = this._mat(tex.concrete, 3, 3, { color: 0x50545c });
    const ceilMat = this._mat(tex.concrete, 3, 3, { color: 0x3c3f46 });
    const wallMat = this._mat(tex.metal, 3, 2.4, { color: 0x5c616a, metalness: 0.5, roughness: 0.65 });
    const metal = this._mat(tex.metal, 2, 2, { color: 0x5b5f66, metalness: 0.6, roughness: 0.55 });
    const rust = this._mat(tex.rust, 1, 1, { color: 0x7a4f30, metalness: 0.25, roughness: 0.95 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x040507, roughness: 1, metalness: 0, side: THREE.BackSide });
    this._metal = metal; this._rust = rust; this._dark = dark;

    const plane = (pw, ph, mat) => new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), mat);

    // floor + ceiling
    const floor = plane(CONFIG.room.W, CONFIG.room.D, floorMat);
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; g.add(floor);
    const ceil = plane(CONFIG.room.W, CONFIG.room.D, ceilMat);
    ceil.rotation.x = Math.PI / 2; ceil.position.y = h; ceil.receiveShadow = true; g.add(ceil);

    // side + back walls
    const back = plane(CONFIG.room.W, h, wallMat); back.position.set(0, h / 2, d); back.rotation.y = Math.PI; back.receiveShadow = true; g.add(back);
    const left = plane(CONFIG.room.D, h, wallMat); left.position.set(-w, h / 2, 0); left.rotation.y = Math.PI / 2; left.receiveShadow = true; g.add(left);
    const right = plane(CONFIG.room.D, h, wallMat); right.position.set(w, h / 2, 0); right.rotation.y = -Math.PI / 2; right.receiveShadow = true; g.add(right);

    // ---- FRONT wall built around a central CORRIDOR opening -----------------
    const opW = 1.3, opH = 2.15;              // corridor opening
    const sideW = (CONFIG.room.W - opW) / 2;  // 0.85 each side
    const fl = plane(sideW, h, wallMat); fl.position.set(-(opW / 2 + sideW / 2), h / 2, -d); fl.receiveShadow = true; g.add(fl);
    const fr = plane(sideW, h, wallMat); fr.position.set(opW / 2 + sideW / 2, h / 2, -d); fr.receiveShadow = true; g.add(fr);
    const ftop = plane(opW, h - opH, wallMat); ftop.position.set(0, opH + (h - opH) / 2, -d); ftop.receiveShadow = true; g.add(ftop);
    this._corridor(new V3(0, 0, -d), opW, opH, metal, dark);

    // ---- LEFT door ----------------------------------------------------------
    this._doorway(new V3(-w, 0, 0.35), Math.PI / 2, metal, rust, dark);
    // ---- RIGHT smashed window ----------------------------------------------
    this._window(new V3(w, 1.2, -0.15), -Math.PI / 2, metal, dark);
    // ---- FRONT-low vent (animated) -----------------------------------------
    this._vent(new V3(-0.9, 0.6, -d + 0.001), 0, metal, dark);
    // ---- FLOOR hatch --------------------------------------------------------
    this._hatch(new V3(0.55, 0.001, 0.45), metal, dark);

    this._props(metal, rust);
    this._lights();
    this._batteries(metal);

    // ---- Spawn anchors (pan matched to the physical strip) ------------------
    this.spawnAnchors = [
      { name: 'corridor', pos: new V3(0, 0, -d + 0.15),   face: new V3(0, 0, 1),  pan: 0.0,  hint: 'corridor' },
      { name: 'door',     pos: new V3(-w + 0.34, 0, 0.35), face: new V3(1, 0, -0.1), pan: -0.95, hint: 'door' },
      { name: 'window',   pos: new V3(w - 0.34, 1.1, -0.15), face: new V3(-1, 0, 0.1), pan: 0.95, hint: 'window' },
      { name: 'vent',     pos: new V3(-0.9, 0.42, -d + 0.28), face: new V3(0, 0.15, 1), pan: -0.35, hint: 'vent' },
      { name: 'hatch',    pos: new V3(0.55, 0.02, 0.45),  face: new V3(0, 1, 0),  pan: 0.3,  hint: 'hatch' },
      { name: 'corner_l', pos: new V3(-w + 0.4, 0, -d + 0.45), face: new V3(1, 0, 1), pan: -0.6, hint: 'corner' },
    ];
    for (const a of this.spawnAnchors) a.face.normalize();
  }

  // A dark hallway box behind the front opening, with side-door insets + red exit glow.
  _corridor(pos, opW, opH, metal, dark) {
    const grp = new THREE.Group(); grp.position.copy(pos); this.group.add(grp);
    const L = 3.2;                                  // corridor length into -Z
    const tube = new THREE.Mesh(new THREE.BoxGeometry(opW, opH, L), dark);
    tube.position.set(0, opH / 2, -L / 2); tube.receiveShadow = true; grp.add(tube);
    // threshold frame
    const fr = (gx, gy, gz, sx, sy, sz) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), metal); m.position.set(gx, gy, gz); m.castShadow = m.receiveShadow = true; grp.add(m); };
    fr(-opW / 2, opH / 2, 0, 0.08, opH, 0.16); fr(opW / 2, opH / 2, 0, 0.08, opH, 0.16); fr(0, opH, 0, opW, 0.1, 0.16);
    // receding side doors (dark insets)
    for (const z of [-1.1, -2.2]) for (const sx of [-1, 1]) {
      const dr = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 1.5), new THREE.MeshStandardMaterial({ color: 0x0a0b0e, roughness: 1 }));
      dr.position.set(sx * (opW / 2 - 0.01), 0.85, z); dr.rotation.y = sx * Math.PI / 2; grp.add(dr);
    }
    // faint red exit glow at the far end (unlit, so it reads in the dark)
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(opW * 0.7, opH * 0.6),
      new THREE.MeshBasicMaterial({ color: 0x330404, toneMapped: false }));
    glow.position.set(0, opH * 0.5, -L + 0.02); grp.add(glow);
    const exit = new THREE.PointLight(0x661010, 1.4, 3.2, 2); exit.position.set(0, 1.1, -L + 0.3); grp.add(exit);
  }

  _doorway(pos, ry, metal, rust, dark) {
    const grp = new THREE.Group(); grp.position.copy(pos); grp.rotation.y = ry; this.group.add(grp);
    const recess = new THREE.Mesh(new THREE.BoxGeometry(1.02, 2.05, 1.0), dark);
    recess.position.set(0, 1.02, -0.55); recess.receiveShadow = true; grp.add(recess);
    const jamb = (x) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.12, 0.16), metal); m.position.set(x, 1.06, 0); m.castShadow = m.receiveShadow = true; grp.add(m); };
    jamb(-0.54); jamb(0.54);
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.14, 0.16), metal); lintel.position.set(0, 2.12, 0); lintel.castShadow = true; grp.add(lintel);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.92, 2.02, 0.06), rust);
    door.geometry.translate(-0.46, 0, 0);          // hinge on the left edge
    door.position.set(-0.46, 1.02, -0.04); door.rotation.y = -0.55; door.castShadow = door.receiveShadow = true; grp.add(door);
    this.door = door;
  }

  _window(pos, ry, metal, dark) {
    const grp = new THREE.Group(); grp.position.copy(pos); grp.rotation.y = ry; this.group.add(grp);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.15, 0.12), metal); frame.castShadow = frame.receiveShadow = true; grp.add(frame);
    const voidBox = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.95, 0.8), dark); voidBox.position.set(0, 0, -0.42); grp.add(voidBox);
    const sill = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 0.28), metal); sill.position.set(0, -0.5, 0.12); sill.castShadow = true; grp.add(sill);
    // shattered glass shards around the edges
    const shardMat = new THREE.MeshPhysicalMaterial({ color: 0x0c1013, roughness: 0.25, metalness: 0, transmission: 0.6, transparent: true, opacity: 0.5, ior: 1.4 });
    for (let i = 0; i < 8; i++) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(0.18 + Math.random() * 0.2, 0.18 + Math.random() * 0.2), shardMat);
      const edge = i % 4; s.position.set((edge === 0 ? -0.55 : edge === 1 ? 0.55 : (Math.random() - 0.5)), (edge === 2 ? -0.4 : edge === 3 ? 0.4 : (Math.random() - 0.5)) * 0.9, 0.05);
      s.rotation.z = Math.random() * 0.6 - 0.3; grp.add(s);
    }
  }

  _vent(pos, ry, metal, dark) {
    const grp = new THREE.Group(); grp.position.copy(pos); grp.rotation.y = ry; this.group.add(grp);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.68, 0.08), metal); frame.castShadow = frame.receiveShadow = true; grp.add(frame);
    const voidBox = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.54, 0.8), dark); voidBox.position.set(0, 0, -0.42); grp.add(voidBox);
    // hinged cover with louvers, opens by rotating about its top edge
    const cover = new THREE.Group(); cover.position.set(0, 0.3, 0.05); grp.add(cover);
    for (let i = 0; i < 6; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.07, 0.03), metal); s.position.set(0, -0.06 - i * 0.09, 0); s.castShadow = true; cover.add(s); }
    const coverPlate = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.015), metal); coverPlate.position.set(0, -0.3, -0.02); cover.add(coverPlate);
    this.vent = { group: grp, cover, open: 0, target: 0 };
  }

  _hatch(pos, metal, dark) {
    const grp = new THREE.Group(); grp.position.copy(pos); this.group.add(grp);
    const pit = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.6, 0.78), dark); pit.position.set(0, -0.3, 0); grp.add(pit);
    const lid = new THREE.Group(); grp.add(lid);
    // grate = crossing bars
    for (let i = -2; i <= 2; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.03, 0.05), metal); b.position.set(0, 0.02, i * 0.16); lid.add(b); const c = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.8), metal); c.position.set(i * 0.16, 0.02, 0); lid.add(c); }
    lid.children.forEach((m) => { m.castShadow = true; });
    lid.geometry = null;
    this.hatch = { group: grp, lid, open: 0, target: 0 };
  }

  _props(metal, rust) {
    const w = CONFIG.room.W / 2, d = CONFIG.room.D / 2, h = CONFIG.room.H;
    // ceiling pipes + cables
    const pipeGeo = new THREE.CylinderGeometry(0.05, 0.05, CONFIG.room.D, 10);
    const pipes = new THREE.InstancedMesh(pipeGeo, rust, 3); pipes.castShadow = true;
    const m = new THREE.Matrix4(); const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
    [-1.15, 1.05, 1.25].forEach((x, i) => { m.compose(new V3(x, h - 0.13, 0), q, new V3(1, 1, 1)); pipes.setMatrixAt(i, m); });
    pipes.instanceMatrix.needsUpdate = true; this.group.add(pipes);
    // hanging cables (thin drooping cylinders)
    for (let i = 0; i < 3; i++) { const cbl = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 6), metal); cbl.position.set(-0.3 + i * 0.4, h - 0.28, 0.9); cbl.rotation.z = 0.2 - i * 0.1; this.group.add(cbl); }

    // crates + a desk with a dead monitor
    const crates = new THREE.InstancedMesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), rust, 4); crates.castShadow = crates.receiveShadow = true;
    [[w - 0.4, 0.28, d - 0.5, 0.3], [w - 0.45, 0.83, d - 0.55, 0.5], [-w + 0.5, 0.28, d - 0.4, -0.2], [w - 0.9, 0.28, d - 0.45, 0.1]]
      .forEach(([x, y, z, ry], i) => { m.compose(new V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new V3(1, 1, 1)); crates.setMatrixAt(i, m); });
    crates.instanceMatrix.needsUpdate = true; this.group.add(crates);

    const desk = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.05, 0.5), metal); desk.position.set(-0.5, 0.78, d - 0.32); desk.castShadow = true; this.group.add(desk);
    const monitor = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.05), new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.35 }));
    monitor.position.set(-0.5, 1.0, d - 0.42); monitor.castShadow = true; this.group.add(monitor);

    // hazard stripe under the corridor (facility read), unlit so it's faintly visible
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.12), new THREE.MeshBasicMaterial({ color: 0x2a2410, toneMapped: false }));
    stripe.rotation.x = -Math.PI / 2; stripe.position.set(0, 0.006, -d + 0.35); this.group.add(stripe);
  }

  _lights() {
    const h = CONFIG.room.H;
    // Stuttering fluorescent tube over the room (main flicker reveal)
    const tube = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.1), new THREE.MeshBasicMaterial({ color: 0x0a0d12, toneMapped: false }));
    tube.position.set(0, h - 0.05, 0.4); this.group.add(tube);
    const fluo = new THREE.PointLight(0xbcd0ea, 0, 9, 2); fluo.position.set(0, h - 0.12, 0.4); this.group.add(fluo);
    // Steady dim red emergency wall lamp (keeps the space barely readable)
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x661414, toneMapped: false }));
    dome.position.set(CONFIG.room.W / 2 - 0.02, 2.15, 1.2); dome.rotation.z = Math.PI / 2; this.group.add(dome);
    const emg = new THREE.PointLight(0x8a221a, 3.4, 6.5, 2); emg.position.set(CONFIG.room.W / 2 - 0.2, 2.1, 1.2); this.group.add(emg);
    this.lights = { fluo, fluoMesh: tube, emergency: emg };
  }

  _batteries(metal) {
    const w = CONFIG.room.W / 2;
    // pos = the surface point you aim the flashlight at to recharge; pan for audio.
    const spots = [
      { pos: new V3(-w + 0.06, 1.25, 0.95), ry: Math.PI / 2, pan: -0.85 },
      { pos: new V3(w - 0.06, 1.45, 0.5), ry: -Math.PI / 2, pan: 0.85 },
      { pos: new V3(-1.05, 1.5, -CONFIG.room.D / 2 + 0.06), ry: 0, pan: -0.3 },
    ];
    for (const s of spots) {
      const grp = new THREE.Group(); grp.position.copy(s.pos); grp.rotation.y = s.ry; this.group.add(grp);
      const housing = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.34, 0.1), metal); housing.castShadow = true; grp.add(housing);
      // three green indicator pips (drain visually as it's used) — unlit so visible in dark
      const glowMat = new THREE.MeshBasicMaterial({ color: 0x27ff5a, toneMapped: false });
      const pips = [];
      for (let i = 0; i < 3; i++) { const p = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.05), glowMat.clone()); p.position.set(0, 0.09 - i * 0.08, 0.055); grp.add(p); pips.push(p); }
      const halo = new THREE.PointLight(0x1aff55, 0.9, 1.4, 2); halo.position.set(0, 0, 0.2); grp.add(halo);
      this.batteryCells.push({ group: grp, pos: s.pos.clone(), pan: s.pan, pips, halo, glowMat, charge: 1, active: true, cooldown: 0 });
    }
  }

  // Called each frame from main: animates vent/hatch/door and battery-cell glow.
  update(dt, t) {
    this._t = t;
    if (this.vent) { this.vent.open += (this.vent.target - this.vent.open) * Math.min(1, dt * 3); this.vent.cover.rotation.x = -this.vent.open * 1.5; }
    if (this.hatch) { this.hatch.open += (this.hatch.target - this.hatch.open) * Math.min(1, dt * 3); this.hatch.lid.rotation.x = -this.hatch.open * 1.2; this.hatch.lid.position.z = this.hatch.open * 0.35; }
    for (const c of this.batteryCells) {
      const on = c.active ? 1 : 0;
      c.halo.intensity += (on * 0.9 - c.halo.intensity) * Math.min(1, dt * 5);
      const lvl = c.active ? c.charge : 0;
      c.pips.forEach((p, i) => { const litp = lvl > (i / 3) ? 1 : 0.06; p.material.color.setRGB(0.15 * litp, litp, 0.35 * litp); });
    }
  }

  openVent(v = 1) { if (this.vent) this.vent.target = v; }
  openHatch(v = 1) { if (this.hatch) this.hatch.target = v; }
}
