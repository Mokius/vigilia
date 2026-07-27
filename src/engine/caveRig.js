// =============================================================================
// caveRig.js — Generalized (off-axis) perspective for the 4 U-Box surfaces.
//
// Each physical screen (left / front / right walls + floor) gets its own camera
// whose asymmetric frustum has its image plane lying exactly on that screen,
// all sharing one eye point. This is Robert Kooima's "Generalized Perspective
// Projection" (2009). Because adjacent screens share a physical edge, the four
// rendered images join with zero seam — the room looks continuous around the
// corners, and a light sweeping down a wall lands on the floor for free.
//
// Rendering: ONE WebGL context, ONE scene, 4 scissored viewports in a strip:
//   [ LEFT ][ FRONT ][ RIGHT ][ FLOOR ]
// The floor is drawn only in the top `floorCover` band of its panel (the rest
// is black — the real floor projector doesn't cover the whole panel).
// =============================================================================

import * as THREE from 'three';
import { CONFIG, SURFACES, screenRects } from '../config.js';

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);

function makeScreenCamera(rect, eye, near, far) {
  const cam = new THREE.PerspectiveCamera();
  const pa = V(rect.pa), pb = V(rect.pb), pc = V(rect.pc);

  const vr = new THREE.Vector3().subVectors(pb, pa).normalize(); // screen right
  const vu = new THREE.Vector3().subVectors(pc, pa).normalize(); // screen up
  const vn = new THREE.Vector3().crossVectors(vr, vu).normalize(); // toward eye

  const va = new THREE.Vector3().subVectors(pa, eye);
  const vb = new THREE.Vector3().subVectors(pb, eye);
  const vc = new THREE.Vector3().subVectors(pc, eye);

  const d = -va.dot(vn);                 // eye→screen-plane distance
  const nd = near / d;
  const left = vr.dot(va) * nd;
  const right = vr.dot(vb) * nd;
  const bottom = vu.dot(va) * nd;
  const top = vu.dot(vc) * nd;

  cam.projectionMatrix.makePerspective(left, right, top, bottom, near, far);
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();

  // Orient the camera so its local axes are (vr, vu, vn); it looks along -vn
  // (toward the screen) from the eye. matrixAutoUpdate stays on so the renderer
  // keeps matrixWorldInverse in sync; we only override the projection.
  cam.position.copy(eye);
  cam.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(vr, vu, vn));
  cam.updateMatrixWorld(true);

  cam.userData.screen = { pa, pb, pc, vr, vu, vn, eye: eye.clone() };
  return cam;
}

export class CaveRig {
  constructor() {
    const eye = V(CONFIG.room.eye);
    const rects = screenRects();
    const { near, far } = CONFIG.screen;
    this.eye = eye;
    this.cams = {};
    for (const s of SURFACES) this.cams[s] = makeScreenCamera(rects[s], eye, near, far);

    // Optional single-surface mode for one-projector-per-screen setups.
    const p = new URLSearchParams(location.search).get('surface');
    this.solo = SURFACES.includes(p) ? p : null;

    this._black = new THREE.Color(0x000000);
  }

  // Render the scene into every panel of the strip (or a single panel in solo
  // mode). `target` may be a WebGLRenderTarget (for post) or null (screen).
  render(renderer, scene, target = null) {
    const size = renderer.getSize(new THREE.Vector2());
    const W = size.x, H = size.y;
    const cover = CONFIG.screen.floorCover;

    renderer.setRenderTarget(target);
    renderer.autoClear = false;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
    renderer.setScissor(0, 0, W, H);
    renderer.setClearColor(this._black, 1);
    renderer.clear(true, true, true);              // whole buffer → black
    renderer.setScissorTest(true);

    if (this.solo) {
      // One physical screen fills the whole output.
      if (this.solo === 'floor') {
        const fh = H * cover;
        renderer.setViewport(0, H - fh, W, fh);
        renderer.setScissor(0, H - fh, W, fh);
      } else {
        renderer.setViewport(0, 0, W, H);
        renderer.setScissor(0, 0, W, H);
      }
      renderer.render(scene, this.cams[this.solo]);
    } else {
      const pw = W / 4;
      const strip = [
        ['left', 0, 0, pw, H],
        ['front', pw, 0, pw, H],
        ['right', 2 * pw, 0, pw, H],
        // Floor: only the top `cover` band of its panel; the rest stays black.
        ['floor', 3 * pw, H - H * cover, pw, H * cover],
      ];
      for (const [s, x, y, w, h] of strip) {
        renderer.setViewport(x, y, w, h);
        renderer.setScissor(x, y, w, h);
        renderer.render(scene, this.cams[s]);
      }
    }

    // Restore a full-frame viewport/scissor so later full-screen passes (post
    // composite → screen) don't inherit the last panel's sub-rect.
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
    renderer.setScissor(0, 0, W, H);
    renderer.setRenderTarget(null);
  }

  // Which panel is under a strip-space cursor (u,v in [0,1]) and its local uv.
  // Used by absolute (touch) input; pointer-lock input doesn't need it.
  panelAt(u, v) {
    if (this.solo) return { surface: this.solo, lu: u, lv: v };
    const idx = Math.min(3, Math.floor(u * 4));
    const surface = SURFACES[idx];
    let lu = u * 4 - idx, lv = v;
    if (surface === 'floor') {
      const cover = CONFIG.screen.floorCover;
      if (v > cover) return null;        // black band below the floor image
      lv = v / cover;
    }
    return { surface, lu, lv };
  }

  // Cast a ray from the eye through local panel coords (lu,lv ∈ [0,1], v down)
  // and return its world direction. Lets a touch on any panel aim the light at
  // exactly that spot — same 3D room, so it stays seamless with the walls.
  rayFromPanel(surface, lu, lv) {
    const ndc = new THREE.Vector3(lu * 2 - 1, (1 - lv) * 2 - 1, 0.5);
    ndc.unproject(this.cams[surface]);
    return ndc.sub(this.eye).normalize();
  }
}
