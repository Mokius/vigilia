// =============================================================================
// game.js — Game Manager / state machine, wiring the decoupled systems:
//   MENU → PLAYING → (SCARE → END) | (survive → END win)
// Adds: battery-recharge cells (aim the beam at a green wall cell to top up a
// little), vent/hatch that open while a creature uses them, and a per-monster
// jumpscare (distinct face + scream).
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { EnemyManager } from '../ai/enemyManager.js';
import { EnemyState } from '../ai/enemy.js';
import { damp, randRange } from '../core/util.js';

export const GState = { MENU: 'menu', PLAYING: 'playing', SCARE: 'scare', END: 'end' };
const ALIVE = (e) => e.state === EnemyState.LURK || e.state === EnemyState.ATTACK;

export class Game {
  constructor({ scene, room, flashlight, eye, bus, audio, ui, onPointerLock, onPointerUnlock }) {
    Object.assign(this, { scene, room, flashlight, eye, bus, audio, ui, onPointerLock, onPointerUnlock });
    this.manager = new EnemyManager(scene, room, eye, bus);
    this.state = GState.MENU;
    this.night = CONFIG.startNight;
    this.timer = 0; this.scareFX = 0;
    this._ventOpen = false; this._hatchOpen = false;
    this._wire();
  }

  _wire() {
    const a = this.audio;
    const sfx = { footstep: (p, m) => a.footstep(p, m), knock: (p, m) => a.knock(p, m), breath: (p, m) => a.breath(p, m), whisper: (p, m) => a.whisper(p, m), scrape: (p, m) => a.scrape(p, m) };
    this.bus.on('cue', ({ sound, pan, muffle }) => sfx[sound] && sfx[sound](pan, muffle));
    this.bus.on('spawn', ({ pan }) => { if (Math.random() < 0.6) a.knock(pan, 0.6); });
    this.bus.on('banish', ({ pan }) => { a.scrape(pan, 0.2); a.boom(pan); });
    this.bus.on('charge', ({ pan }) => a.charge(pan));
    this.bus.on('cellblip', ({ pan }) => a.blip(pan));
  }

  init() { this.ui.showMenu((n) => this.startNight(n)); this.ui.hideHud(); }

  startNight(night) {
    this.night = night;
    this.audio.resume().catch(() => {});
    this.flashlight.battery = 100; this.flashlight.on = true;
    this.timer = CONFIG.game.nightSeconds;
    this.manager.start(night);
    for (const c of this.room.batteryCells) { c.active = true; c.charge = 1; c.cooldown = 0; c._dwell = 0; }
    this.ui.hideMenu(); this.ui.hideEnd(); this.ui.showHud();
    this.state = GState.PLAYING; this.scareFX = 0;
    this.onPointerLock && this.onPointerLock();
  }

  update(dt) {
    this.scareFX = damp(this.scareFX, this.state === GState.SCARE ? 1 : 0, 6, dt);
    if (this.state !== GState.PLAYING) return;

    this.timer -= dt;
    const r = this.manager.update(dt, this.flashlight);
    this.audio.setTension(r.tension); this.audio.updateHeartbeat(dt);
    this.scareFX = Math.max(this.scareFX, r.tension * 0.16);

    this._battery(dt);
    this._openings();

    this.ui.setHud({ night: this.night, timeFrac: this.timer / CONFIG.game.nightSeconds, battery: this.flashlight.battery, tension: r.tension });
    if (r.scared) return this._onScare(r.scared);
    if (this.timer <= 0) return this._onWin();
  }

  _battery(dt) {
    const rc = CONFIG.flashlight.recharge;
    for (const c of this.room.batteryCells) {
      if (c.active) {
        const lit = this.flashlight.litAmount(c.pos);
        if (lit > rc.litThreshold) {
          c._dwell = (c._dwell || 0) + dt * lit;
          if (c._dwell >= rc.dwell) { this.flashlight.recharge(rc.amount); c.active = false; c.charge = 0; c._dwell = 0; c.cooldown = randRange(Math.random, ...rc.cellCooldown); this.bus.emit('charge', { pan: c.pan }); }
        } else { c._dwell = Math.max(0, (c._dwell || 0) - dt); c.charge = Math.max(0.15, c._dwell / rc.dwell); }
        c._blip = (c._blip || (0.5 + Math.random())) - dt;
        if (c._blip <= 0) { c._blip = 1.6 + Math.random() * 1.6; this.bus.emit('cellblip', { pan: c.pan }); }
      } else {
        c.cooldown -= dt; if (c.cooldown <= 0) { c.active = true; c.charge = 1; }
      }
    }
  }

  _openings() {
    const anchors = new Set(this.manager.enemies.filter(ALIVE).map((e) => e.anchor.name));
    const v = anchors.has('vent'), h = anchors.has('hatch');
    if (v !== this._ventOpen) { this._ventOpen = v; this.room.openVent(v ? 1 : 0); if (v) this.audio.ductRattle(-0.35); }
    if (h !== this._hatchOpen) { this._hatchOpen = h; this.room.openHatch(h ? 1 : 0); if (h) this.audio.ductRattle(0.3); }
  }

  _onScare(scared) {
    this.state = GState.SCARE;
    this.manager.stop(); this.room.openVent(0); this.room.openHatch(0); this._ventOpen = this._hatchOpen = false;
    this.audio.setTension(0); this.audio.scream(scared.type.scream);
    this.onPointerUnlock && this.onPointerUnlock();
    this.ui.showScare(scared.type, () => { this.state = GState.END; this.ui.showEnd(false, this.night, (win) => this._retry(win)); });
  }

  _onWin() {
    this.state = GState.END;
    this.manager.stop(); this.audio.setTension(0); this.audio.boom(0);
    this.onPointerUnlock && this.onPointerUnlock();
    this.ui.showEnd(true, this.night, (win) => this._retry(win));
  }

  _retry(win) { this.startNight(win ? Math.min(5, this.night + 1) : this.night); }
}
