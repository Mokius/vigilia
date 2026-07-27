// =============================================================================
// room.js — Procedural derelict maintenance bay.
// Original setting (no third-party IP): a decommissioned service room with a
// doorway, an observation window, a wall vent, and dark corners — the places
// something can lurk without ever standing right in front of you.
// Exposes `spawnAnchors`: where enemies emerge, which way they face, and the
// stereo pan their sounds should use (matched to the physical screen strip).
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { buildTextures } from './textures.js';

const V3 = THREE.Vector3;

function tiled(maps, rx, ry) {
  const clone = {};
  for (const k of ['map', 'normalMap', 'roughnessMap']) {
    if (!maps[k]) continue;
    const t = maps[k].clone(); t.needsUpdate = true;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry);
    clone[k] = t;
  }
  return clone;
}

export class Room {
  constructor() {
    this.group = new THREE.Group();
    this.spawnAnchors = [];
    this._build();
  }

  _mat(maps, rx, ry, extra = {}) {
    const t = tiled(maps, rx, ry);
    return new THREE.MeshStandardMaterial({
      map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap,
      metalness: 0.0, roughness: 1.0,
      normalScale: new THREE.Vector2(1.1, 1.1),
      color: 0x8a8f9c, ...extra,
    });
  }

  _build() {
    const tex = buildTextures();
    const w = CONFIG.room.W / 2, d = CONFIG.room.D / 2, h = CONFIG.room.H;
    const g = this.group;

    const concrete = this._mat(tex.concrete, 3, 3, { color: 0x6f747f });
    const concreteWall = this._mat(tex.concrete, 3, 2.6, { color: 0x71767f });
    const metal = this._mat(tex.metal, 2, 2, { color: 0x8b909a, metalness: 0.55, roughness: 0.6 });
    const rust = this._mat(tex.rust, 1, 1, { color: 0xa06a42, metalness: 0.3, roughness: 0.9 });

    const plane = (pw, ph, mat) => new THREE.Mesh(new THREE.PlaneGeometry(pw, ph, 1, 1), mat);

    // Floor
    const floor = plane(CONFIG.room.W, CONFIG.room.D, concrete);
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0; floor.receiveShadow = true;
    g.add(floor);

    // Ceiling
    const ceil = plane(CONFIG.room.W, CONFIG.room.D, concrete);
    ceil.rotation.x = Math.PI / 2; ceil.position.y = h; ceil.receiveShadow = true;
    g.add(ceil);

    // Walls (front, back, left, right)
    const front = plane(CONFIG.room.W, h, concreteWall);
    front.position.set(0, h / 2, -d); front.receiveShadow = true; g.add(front);

    const back = plane(CONFIG.room.W, h, concreteWall);
    back.position.set(0, h / 2, d); back.rotation.y = Math.PI; back.receiveShadow = true; g.add(back);

    const left = plane(CONFIG.room.D, h, concreteWall);
    left.position.set(-w, h / 2, 0); left.rotation.y = Math.PI / 2; left.receiveShadow = true; g.add(left);

    const right = plane(CONFIG.room.D, h, concreteWall);
    right.position.set(w, h / 2, 0); right.rotation.y = -Math.PI / 2; right.receiveShadow = true; g.add(right);

    // ---- Doorway on the LEFT wall (recessed, ajar) --------------------------
    this._doorway(new V3(-w, 0, 0.35), Math.PI / 2, metal, rust);
    // ---- Observation window on the RIGHT wall -------------------------------
    this._window(new V3(w, 1.35, -0.2), -Math.PI / 2, metal);
    // ---- Vent on the FRONT wall (low, offset) -------------------------------
    this._vent(new V3(-0.85, 0.55, -d), 0, metal);

    // ---- Set dressing -------------------------------------------------------
    this._props(metal, rust);

    // ---- Spawn anchors ------------------------------------------------------
    // pan is matched to the strip: left screen = -1, front = 0, right = +1.
    this.spawnAnchors = [
      { name: 'door',    pos: new V3(-w + 0.32, 0, 0.35),  face: new V3(1, 0, -0.1), pan: -0.95, reveal: 0.85, hint: 'door' },
      { name: 'glass',   pos: new V3(w - 0.3, 1.1, -0.2),  face: new V3(-1, 0, 0.1), pan: 0.95,  reveal: 0.45, hint: 'glass' },
      { name: 'vent',    pos: new V3(-0.85, 0.35, -d + 0.25), face: new V3(0, 0.2, 1), pan: -0.25, reveal: 0.35, hint: 'vent' },
      { name: 'corner_l',pos: new V3(-w + 0.35, 0, -d + 0.35), face: new V3(1, 0, 1), pan: -0.6, reveal: 0.6, hint: 'corner' },
      { name: 'corner_r',pos: new V3(w - 0.35, 0, -d + 0.35), face: new V3(-1, 0, 1), pan: 0.6,  reveal: 0.6, hint: 'corner' },
    ];
    for (const a of this.spawnAnchors) a.face.normalize();
  }

  _doorway(pos, ry, metal, rust) {
    const grp = new THREE.Group(); grp.position.copy(pos); grp.rotation.y = ry;
    // Recess: a short dark corridor behind the wall so the opening has depth.
    const recess = new THREE.Mesh(
      new THREE.BoxGeometry(1.02, 2.05, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x05070b, roughness: 1, metalness: 0, side: THREE.BackSide }),
    );
    recess.position.set(0, 1.02, -0.5); recess.receiveShadow = true; grp.add(recess);
    // Frame
    const frameMat = metal;
    const jamb = (x) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.09, 2.1, 0.14), frameMat); m.position.set(x, 1.05, 0); m.castShadow = m.receiveShadow = true; grp.add(m); };
    jamb(-0.53); jamb(0.53);
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.12, 0.14), frameMat);
    lintel.position.set(0, 2.08, 0); lintel.castShadow = lintel.receiveShadow = true; grp.add(lintel);
    // Door, slightly ajar
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.0, 0.05), rust);
    door.position.set(0.35, 1.0, -0.12); door.rotation.y = -0.5;
    door.castShadow = door.receiveShadow = true; grp.add(door);
    this.group.add(grp);
    this.doorGroup = grp;
  }

  _window(pos, ry, metal) {
    const grp = new THREE.Group(); grp.position.copy(pos); grp.rotation.y = ry;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.95, 0.1), metal);
    frame.castShadow = frame.receiveShadow = true; grp.add(frame);
    // Void behind the glass
    const voidBox = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.78, 0.6),
      new THREE.MeshStandardMaterial({ color: 0x04050a, roughness: 1, side: THREE.BackSide }));
    voidBox.position.set(0, 0, -0.32); grp.add(voidBox);
    // Grimy glass
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.78),
      new THREE.MeshPhysicalMaterial({
        color: 0x0a0e12, roughness: 0.35, metalness: 0, transmission: 0.55,
        transparent: true, opacity: 0.55, ior: 1.3, reflectivity: 0.2,
      }));
    glass.position.set(0, 0, 0.06); grp.add(glass);
    this.group.add(grp);
    this.glassGroup = grp;
  }

  _vent(pos, ry, metal) {
    const grp = new THREE.Group(); grp.position.copy(pos); grp.rotation.y = ry;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.62, 0.08), metal);
    frame.castShadow = frame.receiveShadow = true; grp.add(frame);
    const voidBox = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.48, 0.7),
      new THREE.MeshStandardMaterial({ color: 0x04050a, roughness: 1, side: THREE.BackSide }));
    voidBox.position.set(0, 0, -0.38); grp.add(voidBox);
    // Horizontal louvers
    const louMat = metal;
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.05, 0.03), louMat);
      s.position.set(0, 0.22 - i * 0.09, 0.03); s.rotation.x = 0.5;
      s.castShadow = true; grp.add(s);
    }
    this.group.add(grp);
    this.ventGroup = grp;
  }

  _props(metal, rust) {
    const w = CONFIG.room.W / 2, d = CONFIG.room.D / 2, h = CONFIG.room.H;

    // Instanced pipes along the ceiling
    const pipeGeo = new THREE.CylinderGeometry(0.05, 0.05, CONFIG.room.D, 10);
    const pipes = new THREE.InstancedMesh(pipeGeo, rust, 4);
    pipes.castShadow = true; pipes.receiveShadow = true;
    const m = new THREE.Matrix4(); const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
    const px = [-1.1, -0.55, 0.6, 1.15];
    for (let i = 0; i < 4; i++) { m.compose(new V3(px[i], h - 0.14, 0), q, new V3(1, 1, 1)); pipes.setMatrixAt(i, m); }
    pipes.instanceMatrix.needsUpdate = true; this.group.add(pipes);

    // Crates in the front-right and back-left
    const crateGeo = new THREE.BoxGeometry(0.55, 0.55, 0.55);
    const crates = new THREE.InstancedMesh(crateGeo, rust, 5);
    crates.castShadow = crates.receiveShadow = true;
    const spots = [
      [w - 0.4, 0.28, d - 0.5, 0.3], [w - 0.45, 0.83, d - 0.55, 0.5],
      [-w + 0.5, 0.28, d - 0.4, -0.2], [w - 0.9, 0.28, d - 0.45, 0.1],
      [-w + 0.55, 0.28, -0.9, 0.6],
    ];
    for (let i = 0; i < spots.length; i++) {
      const [x, y, z, ry] = spots[i];
      m.compose(new V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new V3(1, 1, 1));
      crates.setMatrixAt(i, m);
    }
    crates.instanceMatrix.needsUpdate = true; this.group.add(crates);

    // Desk against the back wall with a dead monitor (very dim emissive)
    const desk = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.05, 0.55), metal);
    desk.position.set(0.4, 0.78, d - 0.35); desk.castShadow = desk.receiveShadow = true; this.group.add(desk);
    const leg = (x, z) => { const l = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.78, 0.05), metal); l.position.set(x, 0.39, z); l.castShadow = true; this.group.add(l); };
    leg(-0.05, d - 0.15); leg(0.85, d - 0.15); leg(-0.05, d - 0.55); leg(0.85, d - 0.55);
    const monitor = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.32, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x0a0c10, emissive: 0x0a1420, emissiveIntensity: 0.25, roughness: 0.4 }));
    monitor.position.set(0.4, 1.0, d - 0.45); monitor.castShadow = true; this.group.add(monitor);
    this.monitor = monitor;

    // A hanging broken ceiling lamp (Atmosphere flickers it)
    const lampGrp = new THREE.Group(); lampGrp.position.set(0, h - 0.02, -0.2);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.35, 6), metal);
    cord.position.y = -0.17; lampGrp.add(cord);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.18, 12, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x20242c, metalness: 0.6, roughness: 0.5, side: THREE.DoubleSide }));
    shade.position.y = -0.42; shade.castShadow = true; lampGrp.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0x1a1206, emissive: 0xffb055, emissiveIntensity: 0 }));
    bulb.position.y = -0.46; lampGrp.add(bulb);
    this.group.add(lampGrp);
    this.lampBulb = bulb;
    this.lampGroup = lampGrp;
  }
}
