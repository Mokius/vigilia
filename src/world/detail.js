// =============================================================================
// detail.js — Art pass for the control room (FASE 12 §4).
//
// The clock face and the menu console are the quality bar, and what made them
// work was not polygons: it was PAINTED detail. Stencil type, chipped paint and
// grime drawn onto a canvas read beautifully under a raking beam, and layered
// geometry with real recesses does the rest.
//
// This module applies that same recipe to the whole room so every wall states
// what it is: FRONT = way out (corridor + plant signage), LEFT = personnel door
// + stores, RIGHT = electrical + machinery, FLOOR = drainage access + walkway,
// CEILING = services.
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';

const V3 = THREE.Vector3;

/**
 * A painted metal plate. `draw(ctx, W, H)` paints it; a shared wear pass then
 * chips and dirties it so nothing ever looks freshly printed.
 */
export function paintedPlate(wm, hm, draw, { px = 512, matte = 0.95, alpha = false } = {}) {
  const H = Math.max(32, Math.round(px * hm / wm));
  const cv = document.createElement('canvas');
  cv.width = px; cv.height = H;
  const c = cv.getContext('2d');
  draw(c, px, H);

  // --- wear pass ---
  c.globalAlpha = 0.5;
  const specks = Math.round(px * H / 900);
  for (let i = 0; i < specks; i++) {
    const x = Math.random() * px, y = Math.random() * H, r = 1 + Math.random() * 3.5;
    c.fillStyle = Math.random() < 0.55 ? 'rgba(18,16,14,0.75)' : 'rgba(150,145,135,0.30)';
    c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
  }
  c.globalAlpha = 0.2;
  const gr = c.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, 'rgba(0,0,0,0.5)');
  gr.addColorStop(0.45, 'rgba(0,0,0,0)');
  gr.addColorStop(1, 'rgba(0,0,0,0.65)');
  c.fillStyle = gr; c.fillRect(0, 0, px, H);
  c.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  // `color` acts as a multiplier on the map. Halving it guarantees a plate
  // cannot clip to white when the beam hits it square from a metre away —
  // the same trap the menu console fell into.
  const mat = new THREE.MeshStandardMaterial({
    map: tex, color: 0x7a7a7a, roughness: matte, metalness: 0.0, transparent: alpha,
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(wm, hm), mat);
}

// ---------------------------------------------------------------------------
export function addSignage(room) {
  const w = CONFIG.room.W / 2, d = CONFIG.room.D / 2;
  const F = CONFIG.fonts;
  const g = room.group;

  // FRONT over the corridor: what this room is. Orientation in one glance.
  const sign = paintedPlate(1.15, 0.26, (c, W, H) => {
    c.fillStyle = '#1b1f1c'; c.fillRect(0, 0, W, H);
    c.strokeStyle = '#c9cdbe'; c.lineWidth = 5; c.strokeRect(9, 9, W - 18, H - 18);
    c.fillStyle = '#d7dbcc'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = Math.round(H * 0.30) + 'px ' + F.stencil;
    c.fillText('SECTOR 3', W / 2, H * 0.36);
    c.font = Math.round(H * 0.19) + 'px ' + F.crt; c.fillStyle = '#9aa08e';
    c.fillText('SALA DE CONTROL', W / 2, H * 0.62);
    c.fillText('MANTENIMIENTO', W / 2, H * 0.82);
  });
  // Offset to the right-hand pier: the clock owns the centre above the corridor,
  // and the two signs then flank it symmetrically.
  sign.geometry.dispose();
  sign.geometry = new THREE.PlaneGeometry(0.8, 0.2);
  sign.position.set(1.02, 1.74, -d + 0.035); g.add(sign);

  // FRONT beside the corridor: the exit arrow.
  const exitSign = paintedPlate(0.44, 0.2, (c, W, H) => {
    c.fillStyle = '#123018'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#8fe6a6'; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.font = Math.round(H * 0.5) + 'px ' + F.stencil;
    c.fillText('SALIDA', W * 0.07, H * 0.52);
    c.lineWidth = 7; c.strokeStyle = '#8fe6a6';
    c.beginPath(); c.moveTo(W * 0.7, H * 0.52); c.lineTo(W * 0.88, H * 0.52); c.stroke();
    c.beginPath(); c.moveTo(W * 0.95, H * 0.52); c.lineTo(W * 0.82, H * 0.28);
    c.lineTo(W * 0.82, H * 0.76); c.closePath(); c.fillStyle = '#8fe6a6'; c.fill();
  }, { px: 256 });
  exitSign.position.set(-1.0, 1.74, -d + 0.035); g.add(exitSign);

  // FRONT low, next to the vent: labels the duct so it reads as an air path.
  const ventTag = paintedPlate(0.38, 0.11, (c, W, H) => {
    c.fillStyle = '#20241f'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#a9ae9c'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = Math.round(H * 0.44) + 'px ' + F.crt;
    c.fillText('CLIMA CT-14', W / 2, H * 0.55);
  }, { px: 256 });
  ventTag.position.set(-0.9, 1.02, -d + 0.035); g.add(ventTag);

  // LEFT wall: pipe colour-code key. Explains the bands on the ceiling.
  const key = paintedPlate(0.3, 0.44, (c, W, H) => {
    c.fillStyle = '#1d201c'; c.fillRect(0, 0, W, H);
    c.strokeStyle = '#6d7265'; c.lineWidth = 3; c.strokeRect(6, 6, W - 12, H - 12);
    c.textBaseline = 'middle';
    [['#3f8f4a', 'AGUA'], ['#b8992f', 'GAS'], ['#a33a2a', 'INCEND.']].forEach(([col, label], i) => {
      const y = H * (0.28 + i * 0.24);
      c.fillStyle = col; c.fillRect(W * 0.12, y - H * 0.05, W * 0.22, H * 0.1);
      c.fillStyle = '#c8ccbc'; c.font = Math.round(H * 0.085) + 'px ' + F.crt;
      c.textAlign = 'left'; c.fillText(label, W * 0.42, y);
    });
    c.fillStyle = '#8f9484'; c.textAlign = 'center';
    c.font = Math.round(H * 0.07) + 'px ' + F.stencil;
    c.fillText('CODIGO DE FLUIDOS', W / 2, H * 0.12);
  }, { px: 256 });
  key.rotation.y = Math.PI / 2; key.position.set(-w + 0.02, 1.5, -0.3); g.add(key);

  // RIGHT on the cabinet: the console-grade panel for that wall.
  const panel = paintedPlate(0.5, 0.74, (c, W, H) => {
    c.fillStyle = '#2a2d27'; c.fillRect(0, 0, W, H);
    c.strokeStyle = '#7d8274'; c.lineWidth = 4; c.strokeRect(8, 8, W - 16, H - 16);
    c.fillStyle = '#d9ddcb'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = Math.round(H * 0.07) + 'px ' + F.stencil;
    c.fillText('CUADRO GENERAL', W / 2, H * 0.09);
    const cx = W / 2, ty = H * 0.26, r = H * 0.1;
    c.beginPath(); c.moveTo(cx, ty - r); c.lineTo(cx + r * 0.95, ty + r * 0.72);
    c.lineTo(cx - r * 0.95, ty + r * 0.72); c.closePath();
    c.fillStyle = '#c9a52a'; c.fill(); c.lineWidth = 5; c.strokeStyle = '#20231f'; c.stroke();
    c.fillStyle = '#20231f'; c.font = 'bold ' + Math.round(r * 1.15) + 'px ' + F.stencil;
    c.fillText('!', cx, ty + r * 0.2);
    c.fillStyle = '#b8452f'; c.font = Math.round(H * 0.05) + 'px ' + F.crt;
    c.fillText('400 V — RIESGO ELECTRICO', W / 2, H * 0.44);
    c.textAlign = 'left'; c.font = Math.round(H * 0.04) + 'px ' + F.crt;
    ['Q1  ILUMINACION', 'Q2  VENTILACION', 'Q3  BOMBAS', 'Q4  EMERGENCIA', 'Q5  RESERVA']
      .forEach((L, i) => {
        const y = H * (0.56 + i * 0.072);
        c.fillStyle = '#8f9484'; c.fillText(L, W * 0.13, y);
        c.strokeStyle = '#565b4e'; c.lineWidth = 2;
        c.beginPath(); c.moveTo(W * 0.1, y + H * 0.025); c.lineTo(W * 0.9, y + H * 0.025); c.stroke();
      });
  });
  panel.rotation.y = -Math.PI / 2; panel.position.set(w - 0.255, 1.05, 0.75); g.add(panel);

  // FLOOR around the hatch: painted border, so it reads as a real access.
  const hatchMark = paintedPlate(1.2, 1.2, (c, W, H) => {
    c.clearRect(0, 0, W, H);
    c.strokeStyle = '#b89a28'; c.lineWidth = 12;
    c.setLineDash([34, 22]); c.strokeRect(16, 16, W - 32, H - 32); c.setLineDash([]);
    c.fillStyle = '#b89a28'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = Math.round(H * 0.08) + 'px ' + CONFIG.fonts.stencil;
    c.fillText('REGISTRO', W / 2, H * 0.1);
  }, { px: 256, alpha: true });
  hatchMark.rotation.x = -Math.PI / 2;
  hatchMark.position.set(0.55, 0.005, 0.45); g.add(hatchMark);

  // FLOOR: a painted walkway leading in from the corridor. Guides the eye.
  const lane = paintedPlate(0.95, 2.1, (c, W, H) => {
    c.clearRect(0, 0, W, H);
    c.strokeStyle = '#c2b64a'; c.lineWidth = 8;
    c.beginPath();
    c.moveTo(9, 0); c.lineTo(9, H); c.moveTo(W - 9, 0); c.lineTo(W - 9, H);
    c.stroke();
  }, { px: 128, alpha: true });
  lane.rotation.x = -Math.PI / 2;
  lane.position.set(0, 0.004, -0.4); g.add(lane);

  // FLOOR: hazard chevrons at the corridor threshold.
  const chev = paintedPlate(1.3, 0.22, (c, W, H) => {
    c.fillStyle = '#1d1a10'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#c2b64a';
    for (let i = -1; i < 12; i++) {
      c.beginPath();
      const x = i * (W / 11);
      c.moveTo(x, H); c.lineTo(x + W / 22, 0); c.lineTo(x + W / 11, 0); c.lineTo(x + W / 22, H);
      c.closePath(); c.fill();
    }
  }, { px: 256 });
  chev.rotation.x = -Math.PI / 2; chev.position.set(0, 0.006, -1.18); g.add(chev);
}

// ---------------------------------------------------------------------------
export function addServices(room) {
  const h = CONFIG.room.H;
  const g = room.group;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();

  // --- cable ladder tray with instanced rungs ---
  const tray = new THREE.Group(); tray.position.set(0.62, h - 0.1, 0); g.add(tray);
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.055, CONFIG.room.D), room.metal);
    rail.position.set(sx * 0.13, 0, 0); rail.castShadow = true; tray.add(rail);
  }
  const rung = new THREE.InstancedMesh(new THREE.BoxGeometry(0.28, 0.012, 0.03), room.metal, 12);
  rung.castShadow = true;
  for (let i = 0; i < 12; i++) {
    m.compose(new V3(0, -0.02, -1.4 + i * 0.255), q.identity(), new V3(1, 1, 1));
    rung.setMatrixAt(i, m);
  }
  rung.instanceMatrix.needsUpdate = true; tray.add(rung);
  for (let i = 0; i < 3; i++) {
    const cb = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, CONFIG.room.D * 0.98, 6), room.rust);
    cb.rotation.x = Math.PI / 2;
    cb.position.set(-0.06 + i * 0.055, -0.035 - i * 0.006, 0);
    tray.add(cb);
  }

  // --- a real fluorescent fixture instead of a bare bar ---
  if (room.lights && room.lights.fluoMesh) {
    g.remove(room.lights.fluoMesh);
    const fix = new THREE.Group(); fix.position.set(0, h - 0.07, 0.4); g.add(fix);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.09, 0.16), room.metal);
    housing.castShadow = housing.receiveShadow = true; fix.add(housing);
    for (const sx of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 0.17), room.metal);
      cap.position.x = sx * 0.52; fix.add(cap);
      const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.06, 4), room.metal);
      ch.position.set(sx * 0.42, 0.06, 0); fix.add(ch);
    }
    const diff = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.03, 0.1),
      new THREE.MeshBasicMaterial({ color: 0x0a0d12, toneMapped: false }));
    diff.position.y = -0.05; fix.add(diff);
    room.lights.fluoMesh = diff;
  }

  // --- colour-coded bands on the ceiling pipes ---
  const cols = [0x3f8f4a, 0xb8992f, 0xa33a2a];
  [-1.15, 1.05, 1.25].forEach((x, i) => {
    const mat = new THREE.MeshStandardMaterial({ color: cols[i], roughness: 0.85, metalness: 0.1 });
    const band = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.053, 0.053, 0.1, 10), mat, 3);
    for (let k = 0; k < 3; k++) {
      m.compose(new V3(x, h - 0.13, -1.0 + k * 1.0),
        q.setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), new V3(1, 1, 1));
      band.setMatrixAt(k, m);
    }
    band.instanceMatrix.needsUpdate = true; g.add(band);
  });
}

// ---------------------------------------------------------------------------
/** Layered detail on the door leaf so it reads as a real personnel door. */
export function addDoorDetail(room) {
  const pivot = room.doorPivot;
  if (!pivot) return;
  const F = CONFIG.fonts;

  // painted door number, on the leaf so it swings with it
  const plate = paintedPlate(0.3, 0.18, (c, W, H) => {
    c.fillStyle = '#8c8f84'; c.fillRect(0, 0, W, H);
    c.strokeStyle = '#3a3d36'; c.lineWidth = 4; c.strokeRect(6, 6, W - 12, H - 12);
    c.fillStyle = '#20231f'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = Math.round(H * 0.55) + 'px ' + F.stencil;
    c.fillText('L-03', W / 2, H * 0.54);
  }, { px: 256 });
  plate.rotation.y = Math.PI / 2;
  plate.position.set(0.63, 1.66, 0.0);
  pivot.add(plate);

  // wire-glass vision panel
  const vision = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.34, 0.26),
    new THREE.MeshPhysicalMaterial({
      color: 0x0b0f12, roughness: 0.3, metalness: 0,
      transmission: 0.45, transparent: true, opacity: 0.55, ior: 1.4,
    }));
  vision.position.set(0.6, 1.3, 0); pivot.add(vision);
  const wire = new THREE.InstancedMesh(new THREE.BoxGeometry(0.005, 0.3, 0.006), room.metal, 12);
  const mm = new THREE.Matrix4(), qq = new THREE.Quaternion();
  for (let i = 0; i < 6; i++) {
    mm.compose(new V3(0.62, 1.3, -0.1 + i * 0.04), qq.identity(), new V3(1, 1, 1));
    wire.setMatrixAt(i, mm);
  }
  for (let i = 0; i < 6; i++) {
    mm.compose(new V3(0.62, 1.16 + i * 0.056, 0),
      qq.setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)), new V3(0.85, 0.85, 0.85));
    wire.setMatrixAt(6 + i, mm);
  }
  wire.instanceMatrix.needsUpdate = true; pivot.add(wire);

  // kick plate + hinges + push bar: hardware sells it
  const kick = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.22, 0.014), room.metal);
  kick.position.set(0.51, 0.17, 0.04); kick.castShadow = true; pivot.add(kick);
  for (const hy of [0.3, 1.02, 1.76]) {
    const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.023, 0.023, 0.11, 8), room.metal);
    hinge.position.set(0.015, hy, 0); hinge.castShadow = true; pivot.add(hinge);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.045, 0.045), room.metal);
  bar.position.set(0.5, 0.98, 0.06); bar.castShadow = true; pivot.add(bar);
  for (const bx of [0.2, 0.8]) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.06), room.metal);
    st.position.set(bx, 0.98, 0.035); pivot.add(st);
  }
}
