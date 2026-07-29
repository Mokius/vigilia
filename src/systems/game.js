// =============================================================================
// game.js — Game Manager. ONE verb runs the whole experience: point the
// flashlight and hold. It banishes creatures, collects batteries and throws the
// menu levers. There is no DOM UI and no HUD: the wall clock is the timer and
// the beam itself is the battery gauge.
//   MENU -> PLAYING -> (SCARE -> END) | (dawn -> END)
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { EnemyManager } from '../ai/enemyManager.js';
import { PickupField } from '../world/pickups.js';
import { Tutorial } from './tutorial.js';
import { damp, clamp, mulberry32 } from '../core/util.js';

export const GState = { MENU: 'menu', PLAYING: 'playing', SCARE: 'scare', END: 'end' };

// ---- Jumpscare staging ------------------------------------------------------
// Kept together because they are one calibration, not three settings: the range,
// the size and the lamp trade off against each other. Irradiance from a decaying
// point light goes as 1/d**2, so halving the distance to the face means the lamp
// has to come down by 4x or the skin clips to pure white.
const SCARE_Z = 0.34;      // metres from the eye to the head
const SCARE_S = 1.5;       // creature scale while it screams
const EYE_CLEAR = 0.09;    // keep the eye this far outside the body, in metres
const SCARE_LAMP = 6.0;    // flash intensity, tuned by measurement (see below)


export class Game {
  constructor({ scene, room, flashlight, eye, bus, audio, crt, onPointerLock, onPointerUnlock }) {
    Object.assign(this, { scene, room, flashlight, eye, bus, audio, crt, onPointerLock, onPointerUnlock });
    this.manager = new EnemyManager(scene, room, eye, bus);
    this.pickups = new PickupField(scene, room);
    this.state = GState.MENU;
    this.night = CONFIG.game.startNight;
    this.timer = 0;
    this.scareFX = 0;
    this.shake = 0;
    this.flash = 0;
    this._dwell = {};
    // Every physical state change of an access reports its own mechanical sound.
    this.room.onAccessSound = (kind, step, pan, closing) => this.audio.accessSound(kind, step, pan, closing);
    // A dedicated lamp that only exists to light the creature's face during a
    // jumpscare. A scare you cannot SEE is not a scare.
    this.scareLight = new THREE.PointLight(0xffe7cf, 0, 3.0, 2);
    this.scareLight.position.copy(this.eye);
    this.scene.add(this.scareLight);
    this._wire();
  }

  _wire() {
    const a = this.audio;
    const sfx = { footstep: (p, m) => a.footstep(p, m), knock: (p, m) => a.knock(p, m), breath: (p, m) => a.breath(p, m), whisper: (p, m) => a.whisper(p, m), scrape: (p, m) => a.scrape(p, m) };
    this.bus.on('cue', ({ sound, pan, muffle }) => sfx[sound] && sfx[sound](pan, muffle));
    // The opening announces itself BEFORE anything is visible.
    this.bus.on('spawn', ({ pan, route }) => {
      if (route === 'door') a.creak(pan);
      else if (route === 'vent' || route === 'hatch') a.ductRattle(pan);
      else if (route === 'window') a.scrape(pan, 0.2);
      else a.knock(pan, 0.6);
    });
    this.bus.on('banish', ({ pan }) => { a.scrape(pan, 0.25); a.boom(pan); });
    // COVER FOR THE VANISH. The creature asks for this the moment it reaches the
    // place it came in by; the lamp stutters, the image tears for a few frames,
    // and the body is destroyed inside that window. Nobody sees it go.
    this.bus.on('vanish', ({ pan }) => {
      this._glitchT = 0.42;
      this.flashlight.stutter(0.34);
      a.scrape(pan, 0.5);
    });
    // every snap between stations lands with a hard impact
    this.bus.on('step', ({ pan, p, route, station, back }) => {
      a.lunge(pan, p);
      // The window has no mechanism to step, so its identity is emitted here:
      // every position it gains over the frame sounds like glass and steel
      // taking weight, and going back sounds like it coming off again.
      if (route === 'window') a.accessSound('window', (station || 0) + 1, pan, !!back);
    });
  }

  init() { this.crt.showMenu(); this.state = GState.MENU; }

  // ------------------------------------------------------------------- night
  startNight(night) {
    this.night = clamp(night, 1, 5);
    this.audio.resume().catch(() => {});
    this.flashlight.battery = 100; this.flashlight.on = true;
    // NIGHT 1 IS THE GUIDED SHIFT: nothing spawns by itself, the clock does not
    // run you out, and no creature can land a scare.
    this.isTutorial = (this.night === 1);
    if (this.tutorial) { this.tutorial.dispose(); this.tutorial = null; }
    this.timer = this.isTutorial ? Number.POSITIVE_INFINITY : CONFIG.game.nightSeconds;
    this.manager.start(this.night, { autoSpawn: !this.isTutorial });
    if (this.isTutorial) this.pickups.clear();
    // Deliberately NOT seeded. The enemy schedule stays deterministic per night,
    // but cell placement must not be: with a seeded rng the first battery of
    // night N was always in the same place and the player simply learned it.
    else this.pickups.spawn();
    this.room.setClock(0);
    this.crt.rollAway();
    this.state = GState.PLAYING;
    this._dwell = {}; this._hover = null; this._latched = null;
    this.flashlight.drainEnabled = !this.isTutorial;   // guided night never strands you
    if (this.isTutorial) {
      this.tutorial = new Tutorial({
        game: this, room: this.room, flashlight: this.flashlight,
        audio: this.audio, manager: this.manager, pickups: this.pickups,
      });
    }
    this.onPointerLock && this.onPointerLock();
  }

  update(dt) {
    // The building keeps breathing in every state, menus included.
    this.audio.updateAmbience(dt);
    // held at 1 from the impact frame (set in _onScare); only the decay is damped
    if (this.state !== GState.SCARE) this.scareFX = damp(this.scareFX, 0, 6, dt);
    this.shake = damp(this.shake, 0, 3.2, dt);
    if (this._glitchT > 0) {
      this._glitchT -= dt;
      const k = clamp(this._glitchT / 0.42, 0, 1);
      // short, ugly and asymmetric: interference, not a fade
      this.scareFX = Math.max(this.scareFX, 0.55 * k);
      this.flash = Math.max(this.flash, (Math.random() < 0.35 ? 0.30 : 0.06) * k);
    }

    if (this.state === GState.MENU || this.state === GState.END) {
      this.flashlight.drainEnabled = false;
      this.flashlight.battery = 100;        // mains power until a shift starts
      this._menuInteract(dt);
      return;
    }
    if (this.state !== GState.PLAYING) return;

    // The guided night has no countdown: it advances by script, and the clock
    // creeps forward only as the player completes steps.
    if (this.isTutorial) {
      if (this.tutorial) {
        this.tutorial.update(dt);
        const steps = 8;
        this.room.setClock(clamp(this.tutorial.i / steps, 0, 1));
      }
    } else {
      this.timer -= dt;
      this.room.setClock(1 - clamp(this.timer / CONFIG.game.nightSeconds, 0, 1));
    }

    const r = this.manager.update(dt, this.flashlight);
    this.audio.setTension(r.tension);
    this.audio.updateHeartbeat(dt);
    this.scareFX = Math.max(this.scareFX, r.tension * 0.16);

    for (const c of this.pickups.update(dt, this.flashlight)) {
      if (c.kind === 'collected') {
        this.flashlight.recharge(CONFIG.pickups.amount);
        this.audio.charge(c.pan);
        if (this.tutorial) this.tutorial.batteriesTaken++;
      } else {
        this.audio.tick(c.pan, c.frac);   // rising ticks while you hold it
      }
    }

    // During the guided night the battery never strands you either.
    if (this.isTutorial && this.flashlight.battery < 35) this.flashlight.recharge(40);

    if (r.scared && !this.isTutorial) return this._onScare(r.scared);
    if (this.isTutorial) { if (this.tutorial && this.tutorial.finished) return this._onWin(); }
    else if (this.timer <= 0) return this._onWin();
  }

  // --------------------------------------------------- diegetic menu levers
  _menuInteract(dt) {
    if (this.crt.isAway) return;
    const D = CONFIG.interact;

    // The lit cone is far wider than the gap between levers, so pick the ONE
    // control closest to the beam axis. Everything else decays.
    let target = null, bestAngle = Infinity;
    for (const ctrl of this.crt.controls) {
      const a = this.flashlight.aimAngle(this.crt.worldPosOf(ctrl));
      if (a < CONFIG.interact.maxAngle && a < bestAngle) { bestAngle = a; target = ctrl; }
    }

    for (const ctrl of this.crt.controls) {
      const k = ctrl.name;
      if (ctrl === target && this.flashlight.on) {
        this._dwell[k] = Math.min(D.dwell, (this._dwell[k] || 0) + dt);
      } else {
        this._dwell[k] = Math.max(0, (this._dwell[k] || 0) - dt * 1.6);
      }
    }

    // Hover feedback exactly ONCE, on entry.
    const tname = target ? target.name : null;
    if (tname !== this._hover) {
      this._hover = tname;
      if (tname) this.audio.blip(0);
      this._latched = null;              // a new control may fire again
    }

    // Activation also fires once per entry: holding the beam on a control that
    // has already been thrown must not keep re-triggering it.
    if (target && this._latched !== target.name && (this._dwell[target.name] || 0) >= D.dwell) {
      this._latched = target.name;
      this._dwell[target.name] = 0;
      if (target.name === 'start') {
        const next = (this.state === GState.END && this._lastWin) ? Math.min(5, this.night + 1) : this.crt.night;
        this.crt.setNight(next);
        this.startNight(next);
        return;
      }
      this.crt.setNight(target.night);
    }
    this.crt.setAim(target ? target.name : null, target ? (this._dwell[target.name] || 0) / D.dwell : 0);
  }

  // ------------------------------------------------------------------ scare
  _onScare(scared) {
    this.state = GState.SCARE;
    this.flashlight.drainEnabled = false;
    this.shake = 1;
    this.flash = 1;                       // blown-out frame on the attack
    this.audio.setTension(0);
    // The audio returns its own timing; the visuals are driven from it so image
    // and sound are one event rather than two things that merely overlap.
    this._scareAudio = this.audio.scream(scared.type.scream) || { attack: 0.004, sustain: 0.95, total: 1.55 };
    this.onPointerUnlock && this.onPointerUnlock();
    // ---- LIGHTS: the opposite of hiding. Blast the room so the face is
    // unmistakable, and set the fire alarm off.
    this.room.alarmOverride = true;
    this.flashlight.on = true;
    this._flSaved = this.flashlight.spot.intensity;

    // ---- STAGE THE FACE: dead ahead, so it lands CENTRED on the front screen,
    // pushed right up to the player with its head exactly at eye level. This is
    // the FNAF framing: a face filling the view, not a body in the dark.
    const e = scared.enemy;
    if (e && e.group) {
      // IN YOUR FACE. At 1.15 m and 1.4x the head filled about 40% of the front
      // panel, which reads as "a monster over there". At SCARE_Z with SCARE_S it
      // subtends ~52 deg across and ~66 deg up, so on the cube the head covers
      // most of the wall you are looking at and there is nowhere else to look.
      e.group.scale.setScalar(SCARE_S);
      e.group.position.set(this.eye.x, 0, this.eye.z - SCARE_Z);
      e.group.lookAt(this.eye.x, e.group.position.y, this.eye.z + 1);
      e.group.updateMatrixWorld(true);
      // Measure where its head actually ended up and put THAT at eye height and
      // at SCARE_Z — not the group origin. The skull sits behind the root, and
      // at 2x scale that offset doubles: positioning by the origin left the face
      // 0.71 m away instead of 0.46, which is 24 deg of framing thrown away.
      // Measuring works for any rig, procedural or GLB, whatever its proportions.
      const hw = e.headWorld;
      e.group.position.y += (this.eye.y - hw.y);
      e.group.position.z += (this.eye.z - SCARE_Z) - hw.z;
      e.group.updateMatrixWorld(true);

      // ---- AS CLOSE AS IT CAN GET WITHOUT SWALLOWING THE CAMERA ------------
      // Pushed to SCARE_Z blind, the creature's own arms and chest closed AROUND
      // the eye point: the front panel then shows the unlit inside of the mesh,
      // i.e. pure black, which is the opposite of a scare. So we solve for the
      // nearest head position at which the eye is still OUTSIDE the body, with a
      // margin. Measured rather than assumed, so it holds for any model dropped
      // in later, whatever its proportions or pose.
      let headZ = this.eye.z - SCARE_Z;
      for (let i = 0; i < 16; i++) {
        const box = new THREE.Box3().setFromObject(e.group).expandByScalar(EYE_CLEAR);
        if (!box.containsPoint(this.eye)) break;
        headZ -= 0.05;
        e.group.position.z -= 0.05;
        e.group.updateMatrixWorld(true);
      }
      this._scareHeadZ = headZ;                // the framing the tick locks onto
      this._scareZ0 = e.group.position.z;
      // FORCE IT SOLID. The body carries a spawn fade, and while that fade is
      // running the materials sit at opacity 0 with body.visible false. A scare
      // that fires in that window shows an empty room and a scream. Whatever
      // state the appearance staging was in, the thing that lunges is opaque.
      e.phase = 'live';
      if (e._setOpacity) e._setOpacity(1);
      if (e.body) e.body.visible = true;
      e._scarePose = true;
      // the lunge-at-the-camera take, per character so the two do not scare alike
      if (e._playIntent) e._playIntent(e.type.jumpscareClip || 'jumpscare', true);
      // Lit from just ABOVE AND BEHIND the player, like a flashgun, not from a
      // lamp wedged between the player and the face. At this range a light in
      // the gap is 25 cm from the skin and clips it to white however low you
      // set it; from behind the head it is ~0.8 m away and stays controllable.
      this.scareLight.position.set(this.eye.x, this.eye.y + 0.34, this.eye.z + 0.18);
      this.scareLight.intensity = SCARE_LAMP;
      this._scareEnemy = e;
    }
    // ONE IMPACT: the post-process hit lands on the same frame as the scream's
    // attack instead of ramping in over half a second behind it.
    this.scareFX = 1;
    this._scareT = 0;
  }

  tickScare(dt) {
    if (this.state !== GState.SCARE) return;
    this._scareT += dt;
    const T = this._scareAudio || { attack: 0.004, sustain: 0.95, total: 1.55 };
    const t = this._scareT;

    // FLASH: hard white on the attack, gone in ~110 ms so it reads as a strike
    this.flash = t < 0.02 ? 1 : Math.max(0, 1 - (t - 0.02) / 0.11);
    // SHAKE: violent while the scream sustains, then settles
    const sustainEnd = T.attack + T.sustain;
    this.shake = t < sustainEnd ? Math.max(0.55, 1 - t / (sustainEnd * 1.6)) : Math.max(0, this.shake - dt * 2.2);

    const e = this._scareEnemy;
    if (e) {
      e.animate(dt);
      // Keep the head locked at eye level and centred; only jitter around it, so
      // the face never drifts off the front screen.
      // ---- KEEP THE FACE PINNED, on all three axes -----------------------
      // The scream animation swings the head bone ~0.28 m back and 0.09 m across;
      // at 2x scale that threw the face out of frame within a single tick, which
      // is why it kept reading as a body somewhere in the room. So we steer
      // by the MEASURED head, not by the group origin — the same trick as the
      // height lock, applied to x and z as well. Works for any animation.
      const press = (t < sustainEnd ? 0.10 * Math.min(1, t / sustainEnd) : 0.10);
      const tx = this.eye.x + Math.sin(t * 53) * 0.010;
      const ty = this.eye.y;
      const tz = (this._scareHeadZ ?? (this.eye.z - SCARE_Z)) + press + Math.sin(t * 37) * 0.014;
      const hw = e.headWorld;
      const k = Math.min(1, dt * 22);
      e.group.position.x += (tx - hw.x) * k;
      e.group.position.y += (ty - hw.y) * k;
      e.group.position.z += (tz - hw.z) * k;
      e.group.rotation.z = Math.sin(t * 61) * 0.05 * (t < sustainEnd ? 1 : 0.2);

      // The clearance has to be re-tested EVERY FRAME, not once when staging.
      // Solved on the neutral pose it looked fine, and then the scream animation
      // threw the arms forward and closed them around the eye point — at which
      // moment the front panel shows the unlit inside of the mesh and the scare
      // is a black screen with a noise on it. So: if the eye ends up enclosed,
      // give ground until it isn't. It settles in two or three frames and never
      // creeps back in, because the target only ever moves away.
      e.group.updateMatrixWorld(true);
      const bb = this._scareBox || (this._scareBox = new THREE.Box3());
      bb.setFromObject(e.group).expandByScalar(EYE_CLEAR);
      if (bb.containsPoint(this.eye)) this._scareHeadZ -= 0.05;
      // The torch is cut entirely: at this range even a tenth of it is a
      // point-blank floodlight on skin. The scare is lit by its own flash and
      // the fire alarm, which is what keeps the face readable instead of white.
      this.flashlight.spot.intensity = 0;
      this.scareLight.intensity = t < sustainEnd
        ? SCARE_LAMP * (Math.random() < 0.85 ? 1 : 0.35)
        : Math.max(0, SCARE_LAMP * (1 - (t - sustainEnd) / 0.5));
    }
    if (this._scareT > 2.25) {
      const left = this.pickups.remaining;      // read BEFORE clearing the field
      // Restore the creature BEFORE dropping the reference. This ran after the
      // null assignment, so the scare scale was in fact never undone.
      if (e && e.group) { e.group.scale.setScalar(1); e._scarePose = false; }
      this.manager.stop(); this.pickups.clear();
      this._scareEnemy = null;
      this.flash = 0;
      this.room.alarmOverride = false;
      this.scareLight.intensity = 0;
      if (this._flSaved) this.flashlight.spot.intensity = this._flSaved;
      this._lastWin = false;
      this.state = GState.END;
      this.crt.showResult(false, this.night, left);
      this.crt.rollBack();
    }
  }

  _onWin() {
    this.state = GState.END;
    this.flashlight.drainEnabled = false;
    this._lastWin = true;
    if (this.tutorial) { this.tutorial.dispose(); this.tutorial = null; }
    this.audio.setTension(0); this.audio.boom(0);
    const left = this.pickups.remaining;
    this.manager.stop(); this.pickups.clear();
    this.onPointerUnlock && this.onPointerUnlock();
    this.crt.showResult(true, this.night, left);
    this.crt.rollBack();
  }
}
