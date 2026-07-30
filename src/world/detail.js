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

  // ---- GUARANTEED MARGINS, EVERYWHERE -----------------------------------
  // Every sign in the room was setting its own font size as a fraction of the
  // plate and hoping the string fitted. Long ones did not: they ran to both
  // edges and, with the border stroke right there, became unreadable. Rather
  // than hand-tune a dozen call sites, fillText is wrapped once here: it
  // measures the string and, if it would breach the safe box, shrinks the font
  // until it fits. Plates can now ask for the size they WANT and always get a
  // readable one.
  const SAFE = 0.86;                       // 7% clear on each side
  const rawFillText = c.fillText.bind(c);
  c.fillText = (str, x, y, mw) => {
    const limit = px * SAFE;
    let w = c.measureText(str).width;
    if (w > limit) {
      const m = /(\d+(?:\.\d+)?)px/.exec(c.font);
      if (m) {
        const shrunk = Math.max(6, Math.floor(parseFloat(m[1]) * (limit / w)));
        c.font = c.font.replace(m[0], shrunk + 'px');
        w = c.measureText(str).width;
      }
    }
    // and keep the anchor itself inside the box, whatever the alignment
    const half = w / 2;
    let cx = x;
    if (c.textAlign === 'center') cx = Math.min(px - half - px * 0.05, Math.max(half + px * 0.05, x));
    else if (c.textAlign === 'left') cx = Math.min(px * 0.95 - w, Math.max(px * 0.05, x));
    return rawFillText(str, cx, y, mw);
  };

  draw(c, px, H);

  // --- wear pass ---
  c.globalAlpha = 0.34;
  const specks = Math.round(px * H / 900);
  for (let i = 0; i < specks; i++) {
    const x = Math.random() * px, y = Math.random() * H, r = 1 + Math.random() * 3.5;
    c.fillStyle = Math.random() < 0.55 ? 'rgba(18,16,14,0.75)' : 'rgba(150,145,135,0.30)';
    c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
  }
  c.globalAlpha = 0.13;
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
    map: tex, color: 0x8f8f8f, roughness: matte, metalness: 0.0, transparent: alpha,
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
    c.font = Math.round(H * 0.40) + 'px ' + F.stencil;
    c.fillText('SECTOR 3', W / 2, H * 0.33);
    // ONE subtitle, big enough to actually read from across the room. Two lines
    // at 4.6 cm of cap height was decoration pretending to be information.
    c.font = Math.round(H * 0.28) + 'px ' + F.crt; c.fillStyle = '#c2c8b2';
    c.fillText('SALA DE CONTROL', W / 2, H * 0.72);
  });
  // Offset to the right-hand pier: the clock owns the centre above the corridor,
  // and the two signs then flank it symmetrically.
  sign.geometry.dispose();
  sign.geometry = new THREE.PlaneGeometry(0.8, 0.2);
  sign.position.set(1.02, 1.74, -d + 0.045); g.add(sign);
  // stand it off the wall on a bracket: a flat decal read as a sticker
  const backer = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.24, 0.03), room.equip);
  backer.position.set(1.02, 1.74, -d + 0.022); backer.castShadow = true; g.add(backer);

  // FRONT beside the corridor: the exit arrow.
  //
  // COLOUR LANGUAGE: green now means ONE thing in this room — a battery cell you
  // can take. This sign used to be green-on-green with its own green lamp, and
  // players kept aiming at it trying to collect it. It is now the older amber
  // filament type, which reads just as clearly as a way out and cannot be
  // mistaken for a pickup.
  const exitSign = paintedPlate(0.44, 0.2, (c, W, H) => {
    c.fillStyle = '#231a0c'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#e8b45c'; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.font = Math.round(H * 0.5) + 'px ' + F.stencil;
    c.fillText('SALIDA', W * 0.07, H * 0.52);
    c.lineWidth = 7; c.strokeStyle = '#e8b45c';
    c.beginPath(); c.moveTo(W * 0.7, H * 0.52); c.lineTo(W * 0.88, H * 0.52); c.stroke();
    c.beginPath(); c.moveTo(W * 0.95, H * 0.52); c.lineTo(W * 0.82, H * 0.28);
    c.lineTo(W * 0.82, H * 0.76); c.closePath(); c.fillStyle = '#e8b45c'; c.fill();
  }, { px: 256 });
  exitSign.position.set(-1.0, 1.74, -d + 0.05); g.add(exitSign);
  const exBox = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.24, 0.05), room.equip);
  exBox.position.set(-1.0, 1.74, -d + 0.026); exBox.castShadow = true; g.add(exBox);
  // it is a lit sign, so give it its own faint glow — warm, never green
  const exLamp = new THREE.PointLight(0xd8a24a, 0.45, 1.1, 2);
  exLamp.position.set(-1.0, 1.74, -d + 0.16); g.add(exLamp);

  // FRONT low, next to the vent: labels the duct so it reads as an air path.
  const ventTag = paintedPlate(0.50, 0.15, (c, W, H) => {
    c.fillStyle = '#20241f'; c.fillRect(0, 0, W, H);
    c.strokeStyle = '#6b7063'; c.lineWidth = 4; c.strokeRect(5, 5, W - 10, H - 10);
    c.fillStyle = '#bcc1ad'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = Math.round(H * 0.52) + 'px ' + F.crt;
    c.fillText('CLIMA CT-14', W / 2, H * 0.55);
  }, { px: 256 });
  ventTag.rotation.y = Math.PI / 2;
  ventTag.position.set(-w + 0.025, room.openings.vent.y + 0.48, room.openings.vent.z);
  g.add(ventTag);

  // LEFT wall: pipe colour-code key. Explains the bands on the ceiling.
  // Three colour bands and three words, sized to be read. The old version put a
  // 4.6 cm caption and a 3 cm title on a 30 cm plate on the wall the beam only
  // ever rakes at a grazing angle: unreadable by construction.
  const key = paintedPlate(0.44, 0.40, (c, W, H) => {
    c.fillStyle = '#1d201c'; c.fillRect(0, 0, W, H);
    c.strokeStyle = '#6d7265'; c.lineWidth = 4; c.strokeRect(6, 6, W - 12, H - 12);
    c.textBaseline = 'middle';
    [['#2f6bab', 'AGUA'], ['#b8992f', 'GAS'], ['#a33a2a', 'CONTRA INC.']].forEach(([col, label], i) => {
      const y = H * (0.22 + i * 0.28);
      c.fillStyle = col; c.fillRect(W * 0.07, y - H * 0.075, W * 0.20, H * 0.15);
      c.fillStyle = '#d2d6c6'; c.font = Math.round(H * 0.15) + 'px ' + F.crt;
      c.textAlign = 'left'; c.fillText(label, W * 0.33, y);
    });
  }, { px: 256 });
  key.rotation.y = Math.PI / 2; key.position.set(-w + 0.025, 1.62, 1.10); g.add(key);

  // RIGHT on the cabinet: the console-grade panel for that wall.
  const panel = paintedPlate(0.5, 0.74, (c, W, H) => {
    c.fillStyle = '#2a2d27'; c.fillRect(0, 0, W, H);
    c.strokeStyle = '#7d8274'; c.lineWidth = 4; c.strokeRect(8, 8, W - 16, H - 16);
    c.fillStyle = '#d9ddcb'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = Math.round(H * 0.095) + 'px ' + F.stencil;
    c.fillText('CUADRO GENERAL', W / 2, H * 0.09);
    const cx = W / 2, ty = H * 0.26, r = H * 0.1;
    c.beginPath(); c.moveTo(cx, ty - r); c.lineTo(cx + r * 0.95, ty + r * 0.72);
    c.lineTo(cx - r * 0.95, ty + r * 0.72); c.closePath();
    c.fillStyle = '#c9a52a'; c.fill(); c.lineWidth = 5; c.strokeStyle = '#20231f'; c.stroke();
    c.fillStyle = '#20231f'; c.font = 'bold ' + Math.round(r * 1.15) + 'px ' + F.stencil;
    c.fillText('!', cx, ty + r * 0.2);
    c.fillStyle = '#b8452f'; c.font = Math.round(H * 0.062) + 'px ' + F.crt;
    c.fillText('400 V — RIESGO ELECTRICO', W / 2, H * 0.44);
    // The five-way breaker schedule was 3.8 cm type — invisible, and it made the
    // plate look busy for no gain. It is now three engraved rocker labels at a
    // size that reads, which is all the wall needs to say.
    c.textAlign = 'center'; c.font = Math.round(H * 0.075) + 'px ' + F.crt;
    ['ILUMINACION', 'BOMBAS', 'EMERGENCIA'].forEach((L, i) => {
      const y = H * (0.62 + i * 0.13);
      c.fillStyle = '#1c1e1a'; c.fillRect(W * 0.12, y - H * 0.048, W * 0.76, H * 0.096);
      c.strokeStyle = '#5c6154'; c.lineWidth = 3; c.strokeRect(W * 0.12, y - H * 0.048, W * 0.76, H * 0.096);
      c.fillStyle = '#b9bfa9'; c.fillText(L, W / 2, y);
    });
  });
  panel.rotation.y = -Math.PI / 2; panel.position.set(w - 0.255, 1.05, 1.05); g.add(panel);

  // ---- FLOOR: the drainage access ----------------------------------------
  // This was ONE 1.2 x 1.2 m plane centred on the hatch. Now that the slab has a
  // real hole cut in it, such a plane would lie straight across the aperture and
  // hide the pit — so the marking is four painted strips AROUND the opening.
  // The label is also its own opaque plate at legible size: 'REGISTRO' used to be
  // 9 cm of dark ochre on transparency over dark concrete, which is why it could
  // not be read at all.
  const OP = room.openings.hatch;
  const half = OP.w / 2, band = 0.17, off = half + 0.09 + band / 2;
  const hazard = (len) => paintedPlate(len, band, (c, W, H) => {
    // Painted, decades old, walked on. At #c9a72c under a raking beam this band
    // was the brightest thing in the room and read as a light strip.
    c.fillStyle = '#1c1a12'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#8a731f';
    const step = H * 1.15;
    for (let x = -step; x < W + step; x += step) {
      c.beginPath();
      c.moveTo(x, H); c.lineTo(x + step * 0.5, 0);
      c.lineTo(x + step * 0.92, 0); c.lineTo(x + step * 0.42, H);
      c.closePath(); c.fill();
    }
  }, { px: 256 });
  for (const [px, pz, len, rot] of [
    [OP.x, OP.z - off, OP.w + 0.18 + band * 2, 0],
    [OP.x, OP.z + off, OP.w + 0.18 + band * 2, 0],
    [OP.x - off, OP.z, OP.w + 0.18, Math.PI / 2],
    [OP.x + off, OP.z, OP.w + 0.18, Math.PI / 2],
  ]) {
    const s = hazard(len);
    s.rotation.x = -Math.PI / 2; s.rotation.z = rot;
    s.position.set(px, 0.0035, pz); g.add(s);
  }
  // the label, on the approach side where the player is actually looking
  const regTag = paintedPlate(0.62, 0.19, (c, W, H) => {
    c.fillStyle = '#1a1b18'; c.fillRect(0, 0, W, H);
    c.strokeStyle = '#6d6a55'; c.lineWidth = 4; c.strokeRect(5, 5, W - 10, H - 10);
    c.fillStyle = '#e0d59a'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = Math.round(H * 0.52) + 'px ' + CONFIG.fonts.stencil;
    c.fillText('REGISTRO', W / 2, H * 0.52);

  }, { px: 256 });
  regTag.rotation.x = -Math.PI / 2;
  // Moved to the +X side of the hatch. On the approach side the walkway's two
  // painted edge stripes ran straight across the word and cut the letters in half.
  regTag.rotation.z = -Math.PI / 2;
  regTag.position.set(OP.x + off + 0.22, 0.0035, OP.z); g.add(regTag);

  // FLOOR: a painted walkway leading in from the corridor. Guides the eye.
  // Shortened at both ends so it no longer runs under the chevrons at one end or
  // across the hatch aperture at the other — three coplanar decals were fighting
  // for the same square metre of floor.
  const lane = paintedPlate(0.95, 1.02, (c, W, H) => {
    c.clearRect(0, 0, W, H);
    c.strokeStyle = '#c2b64a'; c.lineWidth = 8;
    c.beginPath();
    c.moveTo(9, 0); c.lineTo(9, H); c.moveTo(W - 9, 0); c.lineTo(W - 9, H);
    c.stroke();
  }, { px: 128, alpha: true });
  lane.rotation.x = -Math.PI / 2;
  lane.position.set(0, 0.004, -0.54); g.add(lane);

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
/**
 * A panel-mounted analogue charge meter for the lamp, bolted to the front-right
 * pier. It is on the FRONT surface, so in the cube it is permanently in view —
 * the player can check power at a glance without any screen furniture.
 */
export function addBatteryGauge(room) {
  const d = CONFIG.room.D / 2;
  const F = CONFIG.fonts;
  const grp = new THREE.Group();
  grp.position.set(1.03, 1.26, -d + 0.07);
  room.group.add(grp);

  // housing + bezel, so it is a real instrument and not a decal
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.26, 0.09), room.equip);
  box.castShadow = box.receiveShadow = true; grp.add(box);
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.011, 6, 20), room.steel);
  bezel.position.z = 0.05; grp.add(bezel);

  // dial face, drawn like the wall clock: stencil marks, wear, a red danger arc
  const face = paintedPlate(0.17, 0.17, (c, W, H) => {
    // BLACK-faced instrument with pale markings. A paper-white dial blew out to
    // pure white the moment the beam touched it.
    c.fillStyle = '#141517'; c.fillRect(0, 0, W, H);
    const cx = W / 2, cy = H * 0.62, R = W * 0.4;
    // red band on the low third
    c.strokeStyle = '#8e2a1a'; c.lineWidth = W * 0.075;
    c.beginPath(); c.arc(cx, cy, R, Math.PI, Math.PI * 1.33); c.stroke();
    c.strokeStyle = '#b9bcae'; c.lineWidth = W * 0.02;
    c.beginPath(); c.arc(cx, cy, R, Math.PI, Math.PI * 2); c.stroke();
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI + (i / 10) * Math.PI;
      const r0 = R * (i % 5 === 0 ? 0.78 : 0.88);
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      c.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      c.lineWidth = i % 5 === 0 ? W * 0.022 : W * 0.012; c.stroke();
    }
    c.fillStyle = '#b9bcae'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = Math.round(H * 0.15) + 'px ' + F.stencil;
    c.fillText('CARGA', cx, cy - R * 0.40);

  }, { px: 256 });
  face.position.z = 0.047; grp.add(face);

  // needle: pivots at the dial centre, sweeps the 180 deg scale
  const pivot = new THREE.Group();
  pivot.position.set(0, -0.012, 0.052); grp.add(pivot);
  const needle = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.072, 0.004),
    new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.6, metalness: 0.1 }));
  needle.geometry.translate(0, 0.036, 0); pivot.add(needle);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.008, 10), room.steel);
  hub.rotation.x = Math.PI / 2; pivot.add(hub);

  // a low-charge warning lamp beside the dial
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0x220604, toneMapped: false }));
  lamp.position.set(0.115, -0.085, 0.05); grp.add(lamp);

  room.gauge = { pivot, lamp, t: 0 };
}

/** Drive the meter. `frac` is 0..1 charge. Call every frame. */
export function updateBatteryGauge(room, frac, dt) {
  const gg = room.gauge; if (!gg) return;
  gg.t += dt;
  // needle sweeps +90deg (empty) to -90deg (full), with a little mechanical lag
  const want = (Math.PI / 2) - frac * Math.PI;
  gg.pivot.rotation.z += (want - gg.pivot.rotation.z) * Math.min(1, dt * 4);
  // it also trembles slightly, like a real moving-coil movement
  gg.pivot.rotation.z += Math.sin(gg.t * 21) * 0.004;
  const low = frac < 0.25;
  const blink = low ? (Math.sin(gg.t * 7) > 0 ? 1 : 0.15) : 0;
  gg.lamp.material.color.setRGB(0.16 + 0.84 * blink, 0.05 * blink, 0.03 * blink);
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
  // water = blue, not green: green is reserved for battery cells alone
  const cols = [0x2f6bab, 0xb8992f, 0xa33a2a];
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

  // THE LEAF LIES IN THE X-Y PLANE AND IS 6 cm THICK. Every piece of hardware
  // below was laid out as if it lay in X-Z: the number plate was rotated 90 deg so
  // it stood edge-on like a fin, the vision panel was 26 cm deep through a 6 cm
  // leaf, and the wire grid was spread +-10 cm along Z. All of it stuck out into
  // thin air, which is exactly the "things floating around the door when it opens"
  // — it was never a swing problem, it was a plane problem.
  const plate = paintedPlate(0.3, 0.18, (c, W, H) => {
    c.fillStyle = '#8c8f84'; c.fillRect(0, 0, W, H);
    c.strokeStyle = '#3a3d36'; c.lineWidth = 4; c.strokeRect(6, 6, W - 12, H - 12);
    c.fillStyle = '#20231f'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = Math.round(H * 0.55) + 'px ' + F.stencil;
    c.fillText('L-03', W / 2, H * 0.54);
  }, { px: 256 });
  plate.position.set(0.62, 1.66, 0.034);      // flat ON the leaf face
  pivot.add(plate);

  // wire-glass vision panel: 26 cm across the leaf, 4 cm through it
  const vision = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.34, 0.042),
    new THREE.MeshPhysicalMaterial({
      color: 0x0b0f12, roughness: 0.34, metalness: 0,
      transmission: 0.42, transparent: true, opacity: 0.58, ior: 1.4,
    }));
  vision.position.set(0.62, 1.30, 0.006); pivot.add(vision);
  // a returned frame around the glass, so it is set INTO the leaf
  for (const [sx, sy, px, py] of [[0.30, 0.03, 0, 0.185], [0.30, 0.03, 0, -0.185],
                                  [0.03, 0.40, -0.145, 0], [0.03, 0.40, 0.145, 0]]) {
    const fr = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, 0.05), room.galv);
    fr.position.set(0.62 + px, 1.30 + py, 0.010); fr.castShadow = true; pivot.add(fr);
  }
  // the wire mesh inside the glass, in the leaf's own plane
  const wire = new THREE.InstancedMesh(new THREE.BoxGeometry(0.004, 0.30, 0.004), room.stainless, 12);
  const mm = new THREE.Matrix4(), qq = new THREE.Quaternion();
  for (let i = 0; i < 6; i++) {                       // verticals, spread in X
    mm.compose(new V3(0.62 - 0.10 + i * 0.04, 1.30, 0.028), qq.identity(), new V3(1, 1, 1));
    wire.setMatrixAt(i, mm);
  }
  for (let i = 0; i < 6; i++) {                       // horizontals, spread in Y
    mm.compose(new V3(0.62, 1.16 + i * 0.056, 0.028),
      qq.setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)), new V3(0.85, 0.85, 0.85));
    wire.setMatrixAt(6 + i, mm);
  }
  wire.instanceMatrix.needsUpdate = true; pivot.add(wire);

  // kick plate + hinges + push bar: hardware sells it
  // aluminium kick plate: a different metal from the leaf it is screwed to
  const kick = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.22, 0.014), room.alu);
  kick.position.set(0.51, 0.17, 0.04); kick.castShadow = true; pivot.add(kick);
  for (const hy of [0.3, 1.02, 1.76]) {
    const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.023, 0.023, 0.11, 8), room.metal);
    hinge.position.set(0.015, hy, 0); hinge.castShadow = true; pivot.add(hinge);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.042, 0.042), room.stainless);
  bar.position.set(0.5, 0.98, 0.072); bar.castShadow = true; pivot.add(bar);
  for (const bx of [0.20, 0.80]) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.055), room.tech);
    st.position.set(bx, 0.98, 0.048); pivot.add(st);
  }
}
