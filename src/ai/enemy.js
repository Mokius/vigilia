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
  emerge: 'crawl', drop: 'crawl', crawl: 'crawl', cross: 'walk',
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
  constructor(type, routeName, scene, eye, rng) {
    this.type = type; this.scene = scene; this.eye = eye; this.rng = rng;
    this.routeName = routeName;
    this.route = ROUTES[routeName];
    this.state = this.route.cross ? EState.CROSS : EState.APPROACH;
    this.p = 0; this.dwell = 0; this.lit = 0;
    this.pan = this.route.pan;
    this.holdT = randRange(rng, 0.6, 1.6);
    this.cueT = randRange(rng, ...type.cueInterval) * 0.5;
    this._ph = rng() * 10; this._t = 0;
    this.stage = this.route.points[0][3];

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

  /** Returns an array of {type,payload} events. */
  update(dt, flashlight) {
    this._t += dt;
    const ev = [];
    if (this.state === EState.DONE || !this.ready) return ev;

    this.lit = flashlight.litAmount(this.headWorld);

    // ---- crossing the corridor: never attacks, just walks past -------------
    if (this.state === EState.CROSS) {
      this.p += dt * this.type.crossSpeed;
      this._place(); this._playIntent('walk');
      if (this.p >= 1) { this.state = EState.DONE; }
      this._cues(dt, ev);
      return ev;
    }

    // ---- lit long enough -> back off and hide -----------------------------
    if (this.state === EState.APPROACH) {
      if (this.lit > 0.35) {
        this.dwell += dt * this.lit;
        this._playIntent(STAGE_CLIP[this.stage] === 'crawl' ? 'crawl' : 'peek');
        if (this.dwell >= this.type.banishTime) {
          this.state = EState.RETREAT;
          this._timeScale = -1;
          ev.push({ type: 'banish', payload: { pan: this.pan, name: this.type.name } });
        }
      } else {
        this.dwell = Math.max(0, this.dwell - dt * 0.6);
        // advance continuously, with deliberate pauses (reads as intent)
        this.holdT -= dt;
        if (this.holdT <= 0) {
          this.p += dt * this.type.advanceSpeed;
          if (this.rng() < 0.004) this.holdT = randRange(this.rng, 0.5, 1.8);
        }
        this._place();
        this._playIntent(STAGE_CLIP[this.stage] || 'walk');
        if (this.p >= 1) {
          this.state = EState.ATTACK;
          this._playIntent('scream', true);
          ev.push({ type: 'scare', payload: { type: this.type, pan: this.pan, enemy: this } });
          return ev;
        }
      }
    } else if (this.state === EState.RETREAT) {
      this.p -= dt * this.type.retreatSpeed;
      this._place();
      this._playIntent(STAGE_CLIP[this.stage] === 'crawl' ? 'crawl' : 'walk');
      if (this.p <= 0) { this.state = EState.HIDE; this._hideT = 0.5; }
    } else if (this.state === EState.HIDE) {
      this._hideT -= dt;
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
      if (this._curAction) this._curAction.timeScale = (this.state === EState.RETREAT ? -1 : 1);
      this.mixer.update(dt);
    } else if (this.body && this.body.userData.proc) {
      // idle life for the procedural fallback
      const P = this.body.userData.proc, ph = this._t * 1.2 + this._ph;
      P.chest.scale.y = 1 + Math.sin(ph * 2.2) * 0.03;
      P.head.rotation.z = Math.sin(ph * 0.9) * 0.05;
      P.head.rotation.y = Math.sin(ph * 0.37) * 0.12;
      P.jaw.rotation.x = 0.3 + (0.5 + 0.5 * Math.sin(ph * 3.1)) * 0.22;
      P.arms.forEach((a, i) => { a.sh.rotation.x = Math.sin(ph * 1.3 + i) * 0.08; });
      const walking = STAGE_CLIP[this.stage] === 'walk';
      this.body.position.y = Math.sin(ph * (walking ? 6 : 2)) * (walking ? 0.02 : 0.006);
    }

    // eyes: billboarded slightly toward the player so they never sink into the skull
    const hw = this.headWorld;
    const toEye = this.eye.clone().sub(hw).normalize();
    this.eyes.position.copy(hw).addScaledVector(toEye, 0.11);
    const dim = this.state === EState.RETREAT || this.state === EState.HIDE;
    const k = dim ? 0.12 : clamp(0.45 + this.p * 0.55 + (this.lit > 0.3 ? 0.25 : 0), 0, 1);
    this.eyeMat.opacity = k;
    // subtle flicker so they feel alive
    this.eyeMat.opacity *= 0.85 + 0.15 * Math.sin(this._t * 9 + this._ph);
    this.eyes.visible = this.state !== EState.DONE;
  }

  dispose() {
    this.scene.remove(this.group); this.scene.remove(this.eyes);
    this.group.traverse((o) => { if (o.isMesh) { o.geometry?.dispose?.(); } });
    this.eyeMat.dispose();
  }
}
