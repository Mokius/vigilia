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
import { damp, clamp, mulberry32 } from '../core/util.js';

export const GState = { MENU: 'menu', PLAYING: 'playing', SCARE: 'scare', END: 'end' };

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
    this._dwell = {};
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
  }

  init() { this.crt.showMenu(); this.state = GState.MENU; }

  // ------------------------------------------------------------------- night
  startNight(night) {
    this.night = clamp(night, 1, 5);
    this.audio.resume().catch(() => {});
    this.flashlight.battery = 100; this.flashlight.on = true;
    this.timer = CONFIG.game.nightSeconds;
    this.manager.start(this.night);
    this.pickups.spawn(mulberry32((0xabcd ^ Math.imul(this.night, 48271)) >>> 0));
    this.room.setClock(0);
    this.crt.rollAway();
    this.state = GState.PLAYING;
    this._dwell = {};
    this.onPointerLock && this.onPointerLock();
  }

  update(dt) {
    this.scareFX = damp(this.scareFX, this.state === GState.SCARE ? 1 : 0, 6, dt);
    this.shake = damp(this.shake, 0, 3.2, dt);

    if (this.state === GState.MENU || this.state === GState.END) {
      this._menuInteract(dt);
      return;
    }
    if (this.state !== GState.PLAYING) return;

    this.timer -= dt;
    this.room.setClock(1 - clamp(this.timer / CONFIG.game.nightSeconds, 0, 1));

    const r = this.manager.update(dt, this.flashlight);
    this.audio.setTension(r.tension);
    this.audio.updateHeartbeat(dt);
    this.scareFX = Math.max(this.scareFX, r.tension * 0.16);

    for (const c of this.pickups.update(dt, this.flashlight)) {
      if (c.kind === 'collected') {
        this.flashlight.recharge(CONFIG.pickups.amount);
        this.audio.charge(c.pan);
      } else {
        this.audio.tick(c.pan, c.frac);   // rising ticks while you hold it
      }
    }

    if (r.scared) return this._onScare(r.scared);
    if (this.timer <= 0) return this._onWin();
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

    if (target && (this._dwell[target.name] || 0) >= D.dwell) {
      this._dwell[target.name] = 0;
      this.audio.blip(0);
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
    this.shake = 1;
    this.audio.setTension(0);
    this.audio.scream(scared.type.scream);
    this.onPointerUnlock && this.onPointerUnlock();

    // Bring the actual creature to the player's face, on whichever screen it
    // came from, and let its own attack clip play. No 2D overlay anywhere.
    const e = scared.enemy;
    if (e && e.group) {
      const dir = e.group.position.clone().sub(this.eye); dir.y = 0;
      if (dir.lengthSq() < 1e-4) dir.set(0, 0, -1);
      dir.normalize();
      const p = this.eye.clone().addScaledVector(dir, 0.62);
      p.y = Math.max(0, this.eye.y - (e.bodyHeight || 1.8) * 0.82);
      e.group.position.copy(p);
      e.group.lookAt(this.eye.x, e.group.position.y, this.eye.z);
      e.group.scale.setScalar(1.12);
      this._scareEnemy = e;
    }
    this._scareT = 0;
  }

  tickScare(dt) {
    if (this.state !== GState.SCARE) return;
    this._scareT += dt;
    const e = this._scareEnemy;
    if (e) {
      e.animate(dt);
      // lunge a few centimetres closer, twitching
      const d = this.eye.clone().sub(e.group.position); d.y = 0;
      if (d.length() > 0.42) e.group.position.addScaledVector(d.normalize(), dt * 0.35);
      e.group.rotation.z = Math.sin(this._scareT * 47) * 0.05;
      if (Math.random() < 0.2) this.shake = Math.max(this.shake, 0.75);
    }
    if (this._scareT > 1.7) {
      const left = this.pickups.remaining;      // read BEFORE clearing the field
      this.manager.stop(); this.pickups.clear();
      this._scareEnemy = null;
      this._lastWin = false;
      this.state = GState.END;
      this.crt.showResult(false, this.night, left);
      this.crt.rollBack();
    }
  }

  _onWin() {
    this.state = GState.END;
    this._lastWin = true;
    this.audio.setTension(0); this.audio.boom(0);
    const left = this.pickups.remaining;
    this.manager.stop(); this.pickups.clear();
    this.onPointerUnlock && this.onPointerUnlock();
    this.crt.showResult(true, this.night, left);
    this.crt.rollBack();
  }
}
