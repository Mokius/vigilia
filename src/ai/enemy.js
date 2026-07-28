// =============================================================================
// enemy.js — One creature.
//
// Presentation is driven by the ROUTE it is using (docs/FASE1_ESCENARIO.md
// §4.2/§4.3): eyes in a door slit, leaning out, half-emerging from a duct,
// crossing the corridor, standing still in a shadow, stalking closer, backing
// off when lit, hiding again, or lunging. Movement along the route is
// CONTINUOUS — the creature is never teleported.
//
// The visual body is resolved at runtime by modelProvider: a real Mixamo GLB if
// one has been dropped in, else a CC0 humanoid, else a procedural creature.
// Animation clips are fuzzy-bound, so we never depend on clip names we can't
// verify. Glowing eyes are billboarded at the head bone so they read on ANY rig.
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { ROUTES, samplePath } from './routes.js';
import { SPAWN } from './enemyTypes.js';
import { loadFirst, prepareModel, bindClips, measureHeight } from './modelProvider.js';
import { buildTextures } from '../world/textures.js';
import { clamp, randRange, pick } from '../core/util.js';

export const EState = {
  APPROACH: 'approach',   // slit / peek / emerge / stalk — advancing when unseen
  CROSS: 'cross',         // walks past, never attacks (false alarm)
  RETREAT: 'retreat',     // lit long enough: backing away
  HIDE: 'hide',           // returned to cover
  ATTACK: 'attack',       // reached the player
  DONE: 'done',
};

// Stage (from the route waypoint) -> which animation intent to play.
const STAGE_CLIP = {
  slit: 'idle', stare: 'idle', far: 'idle',
  peek: 'peek', threshold: 'walk', hall: 'walk', inside: 'walk', close: 'walk',
  emerge: 'crawl', drop: 'crawl', crawl: 'crawl', cross: 'walk', climb: 'climb',
};

const HEAD_BONE_RE = /(mixamorig)?:?head$/i;

function proceduralBody(eyeColor) {
  // Fallback creature: gaunt, near-black, hunched. Reads as a silhouette.
  const t = buildTextures().skin;
  const map = t.map.clone(); map.needsUpdate = true;
  const nrm = t.normalMap.clone(); nrm.needsUpdate = true;
  const m = new THREE.MeshStandardMaterial({ map, normalMap: nrm, color: 0x2e1f1d, roughness: 0.85, metalness: 0.05 });
  const g = new THREE.Group();
  const box = (w, h, d) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  for (const sx of [-1, 1]) { const l = box(0.075, 0.92, 0.09); l.position.set(sx * 0.085, 0.46, 0); g.add(l); }
  const hip = box(0.27, 0.33, 0.17); hip.position.set(0, 1.06, 0.02); g.add(hip);
  const chest = box(0.31, 0.45, 0.18); chest.position.set(0, 1.42, -0.04); chest.rotation.x = -0.13; g.add(chest);
  const arms = [];
  for (const sx of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(sx * 0.2, 1.57, -0.02); g.add(sh);
    const up = box(0.055, 0.5, 0.06); up.geometry.translate(0, -0.25, 0); up.rotation.x = 0.24; sh.add(up);
    const fo = box(0.05, 0.5, 0.05); fo.geometry.translate(0, -0.25, 0); fo.position.y = -0.5; up.add(fo);
    arms.push({ sh, sx });
  }
  const neck = box(0.06, 0.18, 0.06); neck.position.set(0, 1.67, -0.04); neck.rotation.x = 0.3; g.add(neck);
  const head = box(0.17, 0.22, 0.19); head.position.set(0, 1.78, -0.1); head.rotation.x = 0.28; g.add(head);
  const jaw = box(0.12, 0.07, 0.14); jaw.position.set(0, 1.67, -0.16); jaw.rotation.x = 0.3; g.add(jaw);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
  g.userData.proc = { chest, head, jaw, arms };
  return { root: g, height: 1.9 };
}

export class Enemy {
  constructor(type, routeName, scene, eye, rng, room = null) {
    this.type = type; this.scene = scene; this.eye = eye; this.rng = rng; this.room = room;
    this.routeName = routeName;
    this.route = ROUTES[routeName];
    this.state = this.route.cross ? EState.CROSS : EState.APPROACH;
    this.p = 0; this.dwell = 0; this.lit = 0;
    this.pan = this.route.pan;
    // station-based movement (see update): hold still, then snap to the next one
    this.station = 0; this.dashing = false; this.dashT = 0; this.dashDur = 0.15;
    this.fromStation = 0; this.toStation = 0; this._clipRate = 1; this._windup = 0;
    this.holdT = randRange(rng, 0.5, 1.2);
    this.cueT = randRange(rng, ...type.cueInterval) * 0.5;
    this._ph = rng() * 10; this._t = 0;
    this.stage = this.route.points[0][3];
    // Appearance staging: the opening moves first while nothing is visible,
    // then the body fades up. It must never simply pop into the room.
    this.phase = 'opening'; this.phaseT = 0; this.opacity = 0;

    this.group = new THREE.Group(); scene.add(this.group);
    this._buildEyes(type.eyeColor);
    this._place();
    this.ready = false;
    this._resolveBody();
  }

  async _resolveBody() {
    const urls = [].concat(CONFIG.models[this.type.modelKey] || [], CONFIG.models.fallbackHumanoid || []);
    const got = await loadFirst(urls);
    if (got) {
      prepareModel(got.scene, this.type.height);
      this.body = got.scene; this.group.add(this.body);
      this.clips = bindClips(got.animations);
      this.source = got.url;
      if (got.animations.length) {
        this.mixer = new THREE.AnimationMixer(this.body);
        this._playIntent(STAGE_CLIP[this.stage] || 'idle', true);
      }
      // Prefer the real head bone for eye placement / light detection.
      this.body.traverse((o) => { if (o.isBone && HEAD_BONE_RE.test(o.name)) this.headBone = o; });
      const m = measureHeight(this.body);
      this.bodyHeight = m ? m.height : this.type.height;
    } else {
      const p = proceduralBody(this.type.eyeColor);
      this.body = p.root; this.group.add(this.body);
      this.body.scale.setScalar(this.type.height / p.height);
      this.bodyHeight = this.type.height;
      this.clips = null; this.source = 'procedural';
    }
    this.ready = true;
  }

  _buildEyes(color) {
    const tex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const x = c.getContext('2d');
      const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, 64, 64);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    this.eyes = new THREE.Group();
    this.eyeMat = new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    for (const sx of [-1, 1]) {
      const s = new THREE.Sprite(this.eyeMat);
      s.scale.setScalar(0.075); s.position.x = sx * 0.045;
      this.eyes.add(s);
    }
    this.scene.add(this.eyes);
  }

  _playIntent(intent, immediate = false) {
    if (!this.mixer || !this.clips) return;
    const clip = this.clips[intent] || this.clips.idle;
    if (!clip || clip === this._curClip) return;
    const next = this.mixer.clipAction(clip);
    next.reset();
    next.setLoop(intent === 'scream' ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = true;
    next.timeScale = this._timeScale || 1;
    if (this._curAction && !immediate) this._curAction.crossFadeTo(next.play(), 0.35, false);
    else { if (this._curAction) this._curAction.stop(); next.play(); }
    this._curAction = next; this._curClip = clip; this._curIntent = intent;
  }

  get headWorld() {
    if (this.headBone) return this.headBone.getWorldPosition(new THREE.Vector3());
    const crawl = (STAGE_CLIP[this.stage] === 'crawl');
    const h = (this.bodyHeight || this.type.height);
    return this.group.position.clone().setY(this.group.position.y + (crawl ? h * 0.22 : h * 0.92));
  }

  _place() {
    const s = samplePath(this.route, this.p);
    this.group.position.set(s.x, s.y, s.z);
    this.stage = s.stage;
    if (this.route.cross) {
      // faces the direction of travel
      const a = samplePath(this.route, Math.min(1, this.p + 0.02));
      this.group.lookAt(a.x, this.group.position.y, a.z);
    } else {
      this.group.lookAt(this.eye.x, this.group.position.y, this.eye.z);
    }
  }

  /** How long it stands motionless. Never a fixed value. */
  _rollHold() {
    const T = this.type;
    const base = randRange(this.rng, T.holdMin, T.holdMax);
    // occasional very short hold => sudden double-move, deeply unnerving
    return this.rng() < 0.18 ? base * 0.35 : base;
  }

  /**
   * Can the body legally occupy `station` yet? Crossing an access requires that
   * access to have physically travelled far enough — otherwise the creature
   * would pass through a shut door, which destroys the illusion instantly.
   * Station N needs the access at notch min(N, steps), and the ANIMATION must
   * have arrived there (not merely been requested).
   */
  _clearedFor(station) {
    const acc = this.route.access;
    if (!acc || !this.room || !this.room.accessOpenness) return true;
    const o = this.room.accessOpenness(acc);
    const needed = Math.min(station, o.steps);
    if (o.state < needed) return false;
    // wait for the leaf/grate/grate to actually be there, and to stop moving
    return o.anim >= (needed / o.steps) - 0.05 && !o.moving;
  }

  /** Snap to another station in a fraction of a second. */
  _beginDash(to) {
    if (to === this.station) { this.holdT = this._rollHold(); return; }
    this.fromStation = this.station; this.toStation = to;
    this.dashT = 0; this.dashing = true; this._windup = 0;
    this.dashDur = randRange(this.rng, this.type.dashMin, this.type.dashMax);
    // aggressive, fast animation for the blur of movement
    this._clipRate = 3.4;
    this._playIntent(STAGE_CLIP[this.stage] === 'crawl' ? 'crawl' : 'walk', true);
  }

  /** Shadow casting is budgeted by the manager (only the nearest few). */
  setCastShadow(on) {
    if (this._shadowOn === on || !this.body) return;
    this._shadowOn = on;
    this.body.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) o.castShadow = on; });
  }

  /** Fade the whole body (and its eyes) in or out. */
  _setOpacity(v) {
    this.opacity = clamp(v, 0, 1);
    if (!this.body) return;
    this.body.visible = this.opacity > 0.01;
    this.body.traverse((o) => {
      if (!o.isMesh && !o.isSkinnedMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        const solid = this.opacity >= 0.995;
        m.transparent = !solid;
        m.opacity = this.opacity;
        m.depthWrite = true;
      }
    });
  }

  /** Returns an array of {type,payload} events. */
  update(dt, flashlight) {
    this._t += dt;
    const ev = [];
    if (this.state === EState.DONE || !this.ready) return ev;

    // ---- staged appearance: opening moves -> body fades in -> then it moves --
    if (this.phase !== 'live') {
      this.phaseT += dt;
      if (this.phase === 'opening') {
        this._setOpacity(0);
        if (this.phaseT >= SPAWN.openingLead) { this.phase = 'fadein'; this.phaseT = 0; }
        this._cues(dt, ev);
        return ev;
      }
      this._setOpacity(this.phaseT / SPAWN.fadeIn);
      this._playIntent(STAGE_CLIP[this.stage] || 'idle');
      if (this.phaseT >= SPAWN.fadeIn + SPAWN.holdAfter) { this.phase = 'live'; this._setOpacity(1); }
      this._cues(dt, ev);
      return ev;
    }

    this.lit = flashlight.litAmount(this.headWorld);

    // ---- STATIONS, not gliding --------------------------------------------
    // It stands dead still and watches you, then crosses to the next station in
    // 0.1-0.2 s. You never see it travel; it is simply somewhere new. Holds are
    // randomised so the rhythm is never predictable.
    if (this.state === EState.CROSS || this.state === EState.APPROACH || this.state === EState.RETREAT) {
      const last = this.route.points.length - 1;

      if (this.dashing) {
        this.dashT += dt;
        const k = clamp(this.dashT / this.dashDur, 0, 1);
        // easeInOutQuint: violent in the middle, lands hard
        const e = k < 0.5 ? 16 * k * k * k * k * k : 1 - Math.pow(-2 * k + 2, 5) / 2;
        this.p = (this.fromStation + (this.toStation - this.fromStation) * e) / last;
        this._place();
        if (k >= 1) {
          this.dashing = false;
          this.station = this.toStation;
          this.holdT = this._rollHold();
          this._playIntent('idle');
          if (this.state === EState.APPROACH && this.station >= last) {
            if (this.harmless) {
              // Guided night: it gets right up to you and then simply leaves.
              // Nothing can ever land a jumpscare during the tutorial.
              this.state = EState.RETREAT;
              this._beginDash(Math.max(0, this.station - 1));
              this._cues(dt, ev);
              return ev;
            }
            this.state = EState.ATTACK;
            this._playIntent('scream', true);
            ev.push({ type: 'scare', payload: { type: this.type, pan: this.pan, enemy: this } });
            return ev;
          }
          if (this.state === EState.RETREAT && this.station <= 0) {
            this.state = EState.HIDE; this._hideT = 0.45;
            // It leaves the way it came in and pulls the access back with it.
            // A door already forced fully open stays open — room.closeStep()
            // is the one that decides, so persistence is respected.
            if (this.route.access) ev.push({ type: 'access', payload: { name: this.route.access, opening: false } });
          }
          if (this.state === EState.CROSS && this.station >= last) { this.state = EState.DONE; }
          ev.push({ type: 'step', payload: { pan: this.pan, p: this.p } });
        }
        this._cues(dt, ev);
        return ev;
      }

      // Driven off while still at its entry station: there is nowhere further
      // back to dash to, so leave now. Without this the creature sat in RETREAT
      // for ever and its route stayed blocked for the rest of the night.
      if (this.state === EState.RETREAT && this.station <= 0) {
        this.state = EState.HIDE; this._hideT = 0.45;
        if (this.route.access) ev.push({ type: 'access', payload: { name: this.route.access, opening: false } });
        this._cues(dt, ev);
        return ev;
      }

      // --- holding: motionless, watching -----------------------------------
      // `demoLock` (guided night only): until it has actually forced the access
      // and come through, the light does NOT stop it. That way the player always
      // sees the opening animation, hears it and watches the thing move before
      // being taught the counter.
      const canBeRepelled = this.station >= (this.demoLock || 0);
      if (this.state === EState.APPROACH && this.lit > 0.35 && canBeRepelled) {
        this.dwell += dt * this.lit;
        this._playIntent('peek');            // flinches the instant the beam lands
        this.holdT = Math.max(this.holdT, 0.25);   // pinned: cannot advance while lit
        if (this.dwell >= this.type.banishTime) {
          this.state = EState.RETREAT;
          ev.push({ type: 'banish', payload: { pan: this.pan, name: this.type.name } });
          this._beginDash(Math.max(0, this.station - 1));
        }
        this._cues(dt, ev);
        return ev;
      }
      // Demo phase: it shrugs the beam off and keeps working its way in, so the
      // logic below (advance / force the access) still runs.
      if (!canBeRepelled) this.dwell = Math.min(this.dwell, this.type.banishTime * 0.85);
      this.dwell = Math.max(0, this.dwell - dt * 0.6);
      this._playIntent('idle');
      this.holdT -= dt;
      // last moments before it moves: a tell you can just about catch
      this._windup = clamp(1 - this.holdT / 0.22, 0, 1);
      if (this.holdT <= 0) {
        const dir = this.state === EState.RETREAT ? -1 : 1;
        const to = clamp(this.station + dir, 0, last);
        if (dir > 0 && !this._clearedFor(to)) {
          // Not enough room to get through yet: work the access wider and WAIT.
          // It never squeezes through geometry that hasn't moved.
          if (this.route.access) ev.push({ type: 'access', payload: { name: this.route.access, opening: true } });
          this.holdT = 0.55;           // try again once the mechanism has moved
          this._playIntent('peek');    // straining at the gap meanwhile
        } else {
          if (this.route.access && dir < 0 && to !== this.station && this.station <= 1) {
            ev.push({ type: 'access', payload: { name: this.route.access, opening: false } });
          }
          this._beginDash(to);
        }
      }
      if (this.state === EState.CROSS) this._setOpacity(this.station >= last - 1 ? 0.35 : 1);
      this._cues(dt, ev);
      return ev;
    }

    if (this.state === EState.HIDE) {
      // dissolve away over the last half second instead of blinking out
      this._hideT -= dt;
      this._setOpacity(clamp(this._hideT / 0.45, 0, 1));
      if (this._hideT <= 0) this.state = EState.DONE;
    }

    this._cues(dt, ev);
    return ev;
  }

  _cues(dt, ev) {
    this.cueT -= dt;
    if (this.cueT <= 0) {
      this.cueT = randRange(this.rng, ...this.type.cueInterval);
      const near = this.p;
      ev.push({ type: 'cue', payload: { sound: pick(this.rng, this.type.cues), pan: this.pan, muffle: 0.55 * (1 - near) } });
    }
  }

  /** Visual-only per-frame work. */
  animate(dt) {
    if (!this.ready) return;
    if (this.mixer) {
      if (this._curAction) this._curAction.timeScale = this.dashing ? this._clipRate : 1;
      this.mixer.update(dt);
    } else if (this.body && this.body.userData.proc) {
      // idle life for the procedural fallback
      // Procedural fallback: almost frozen while holding (only breath), then a
      // violent lurch during the dash, plus a wind-up tell just before it moves.
      const P = this.body.userData.proc, ph = this._t * 1.2 + this._ph;
      const w = this._windup || 0, d = this.dashing ? 1 : 0;
      P.chest.scale.y = 1 + Math.sin(ph * 2.2) * 0.02;
      P.chest.rotation.x = -0.13 - d * 0.28 - w * 0.10;
      P.head.rotation.z = Math.sin(ph * 0.55) * 0.03 + w * 0.09;
      P.head.rotation.y = Math.sin(ph * 0.31) * 0.06;
      P.jaw.rotation.x = 0.3 + d * 0.4 + w * 0.15;
      P.arms.forEach((a, i) => {
        a.sh.rotation.x = Math.sin(ph * 1.1 + i) * 0.03 - d * (i ? 0.5 : -0.35);
        a.sh.rotation.z = a.sx * (0.04 + d * 0.22);
      });
      this.body.position.y = d ? Math.sin(this.dashT * 60) * 0.03 : Math.sin(ph * 2) * 0.005;
    }

    // ---- REACTION TO THE LIGHT --------------------------------------------
    // Exposure builds while the beam holds. The body twists away, cowers and
    // trembles harder the longer it is caught, so the flashlight reads as a
    // weapon rather than a detector.
    const exTarget = clamp(this.dwell / (this.type.banishTime || 0.6), 0, 1);
    this._ex = (this._ex || 0) + (exTarget - (this._ex || 0)) * Math.min(1, dt * 10);
    const ex = this._ex;
    if (this._baseQuat && this.state !== EState.ATTACK) {
      this.group.quaternion.copy(this._baseQuat);
      if (ex > 0.01) {
        const away = this.pan >= 0 ? 1 : -1;
        this.group.rotateZ(away * 0.30 * ex + Math.sin(this._t * 26) * 0.055 * ex);
        this.group.rotateX(-0.26 * ex);                       // recoiling back
        this.group.position.y = this._basePos.y - 0.07 * ex;  // cowering down
        this.group.position.x = this._basePos.x + Math.sin(this._t * 31) * 0.012 * ex;
      } else if (this._basePos) {
        this.group.position.copy(this._basePos);
      }
    }
    if (this.headBone && ex > 0.01) {
      // turns its face out of the beam
      this.headBone.rotation.z = (this.headBone.userData._z ?? (this.headBone.userData._z = this.headBone.rotation.z)) + 0.5 * ex;
    }
    if (this.body && this.body.userData.proc && ex > 0.01) {
      const P = this.body.userData.proc;
      P.chest.rotation.x = -0.13 - 0.5 * ex;                  // folds away from it
      P.head.rotation.z = 0.55 * ex;
      P.arms.forEach((a, i) => { a.sh.rotation.x = -1.05 * ex; a.sh.rotation.z = a.sx * (0.05 + 0.5 * ex); });
    }

    // eyes: billboarded slightly toward the player so they never sink into the skull
    const hw = this.headWorld;
    const toEye = this.eye.clone().sub(hw).normalize();
    this.eyes.position.copy(hw).addScaledVector(toEye, 0.11);
    const dim = this.state === EState.RETREAT || this.state === EState.HIDE;
    const k = dim ? 0.12 : clamp(0.45 + this.p * 0.55 + (this.lit > 0.3 ? 0.25 : 0), 0, 1);
    // eyes obey the same fade as the body, so nothing pops in or out
    // Under direct light the glow yields to the actual lit face — no lamps.
    const litFade = 1 - 0.9 * clamp(this.lit * 1.4, 0, 1);
    this.eyeMat.opacity = k * this.opacity * litFade * (0.85 + 0.15 * Math.sin(this._t * 9 + this._ph)) * 0.6;
    this.eyes.visible = this.state !== EState.DONE;
  }

  dispose() {
    this.scene.remove(this.group); this.scene.remove(this.eyes);
    this.group.traverse((o) => { if (o.isMesh) { o.geometry?.dispose?.(); } });
    this.eyeMat.dispose();
  }
}
