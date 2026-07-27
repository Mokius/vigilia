// =============================================================================
// game.js — The Game Manager. Owns the state machine and wires the decoupled
// systems together via the event bus:
//   MENU → PLAYING → (SCARE → END) | (survive → END win)
// Enemy cue/scare/banish events are routed to audio here, so AI never imports
// audio directly (and vice-versa).
// =============================================================================

import { CONFIG } from '../config.js';
import { EnemyManager } from '../ai/enemyManager.js';
import { clamp, damp } from '../core/util.js';

export const GState = { MENU: 'menu', PLAYING: 'playing', SCARE: 'scare', END: 'end' };

export class Game {
  constructor({ scene, room, flashlight, eye, bus, audio, ui, onPointerLock, onPointerUnlock }) {
    this.scene = scene; this.room = room; this.flashlight = flashlight; this.eye = eye;
    this.bus = bus; this.audio = audio; this.ui = ui;
    this.onPointerLock = onPointerLock; this.onPointerUnlock = onPointerUnlock;
    this.manager = new EnemyManager(scene, room, eye, bus);
    this.state = GState.MENU;
    this.night = CONFIG.startNight;
    this.timer = 0;
    this.scareFX = 0;
    this._wire();
  }

  _wire() {
    const a = this.audio;
    const sfx = { footstep: (p, m) => a.footstep(p, m), knock: (p, m) => a.knock(p, m), breath: (p, m) => a.breath(p, m), whisper: (p, m) => a.whisper(p, m), scrape: (p, m) => a.scrape(p, m) };
    this.bus.on('cue', ({ sound, pan, muffle }) => sfx[sound] && sfx[sound](pan, muffle));
    this.bus.on('spawn', ({ pan }) => { if (Math.random() < 0.6) a.knock(pan, 0.6); });
    this.bus.on('banish', ({ pan }) => { a.scrape(pan, 0.2); a.boom(pan); });
    this.bus.on('approach', () => {});
  }

  init() { this.ui.showMenu((n) => this.startNight(n)); this.ui.hideHud(); }

  startNight(night) {
    this.night = night;
    // Kick audio off the click gesture, but NEVER block game start on it.
    this.audio.resume().catch(() => {});
    this.flashlight.battery = 100; this.flashlight.on = true;
    this.timer = CONFIG.game.nightSeconds;
    this.manager.start(night);
    this.ui.hideMenu(); this.ui.hideEnd(); this.ui.showHud();
    this.state = GState.PLAYING;
    this.scareFX = 0;
    this.onPointerLock && this.onPointerLock();
  }

  update(dt) {
    // scare flash decays regardless of state
    this.scareFX = damp(this.scareFX, this.state === GState.SCARE ? 1 : 0, 6, dt);

    if (this.state === GState.PLAYING) {
      this.timer -= dt;
      const r = this.manager.update(dt, this.flashlight);
      this.audio.setTension(r.tension); this.audio.updateHeartbeat(dt);
      this.scareFX = Math.max(this.scareFX, r.tension * 0.16);
      this.ui.setHud({ night: this.night, timeFrac: this.timer / CONFIG.game.nightSeconds, battery: this.flashlight.battery, tension: r.tension });
      if (r.scared) return this._onScare(r.scared);
      if (this.timer <= 0) return this._onWin();
    }
  }

  _onScare(scared) {
    this.state = GState.SCARE;
    this.manager.stop();
    this.audio.setTension(0); this.audio.scream();
    this.onPointerUnlock && this.onPointerUnlock();
    this.ui.showScare(scared.type.eyeColor, () => {
      this.state = GState.END;
      this.ui.showEnd(false, this.night, (win) => this._retry(win));
    });
  }

  _onWin() {
    this.state = GState.END;
    this.manager.stop();
    this.audio.setTension(0); this.audio.boom(0);
    this.onPointerUnlock && this.onPointerUnlock();
    this.ui.showEnd(true, this.night, (win) => this._retry(win));
  }

  _retry(win) {
    const next = win ? Math.min(5, this.night + 1) : this.night;
    this.startNight(next);
  }
}
