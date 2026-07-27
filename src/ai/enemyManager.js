// =============================================================================
// enemyManager.js — Spawns and orchestrates creatures for a night. Uses a
// seeded PRNG so a night is reproducible (and could be synced across projectors).
// Handles anchor occupancy, per-night difficulty, and forwards enemy events to
// the bus. Reports a "tension" scalar = how close the nearest threat is.
// =============================================================================

import { Enemy, EnemyState } from './enemy.js';
import { ENEMY_TYPES, nightParams } from './enemyTypes.js';
import { mulberry32, randRange } from '../core/util.js';

const ALIVE = (e) => e.state === EnemyState.LURK || e.state === EnemyState.ATTACK;

export class EnemyManager {
  constructor(scene, room, eye, bus) {
    this.scene = scene; this.room = room; this.eye = eye; this.bus = bus;
    this.enemies = []; this.active = false; this.tension = 0;
  }

  start(night) {
    this.stop();
    this.night = night;
    this.params = nightParams(night);
    this.rng = mulberry32((0x9e3779b9 ^ Math.imul(night, 2654435761)) >>> 0);
    this.spawnTimer = randRange(this.rng, 1.5, 3.0);
    this.active = true; this.tension = 0;
  }

  stop() {
    for (const e of this.enemies) e.dispose();
    this.enemies = []; this.active = false; this.tension = 0;
  }

  _freeAnchors(typeAnchors) {
    const used = new Set(this.enemies.filter(ALIVE).map((e) => e.anchor.name));
    return this.room.spawnAnchors.filter((a) => typeAnchors.includes(a.name) && !used.has(a.name));
  }

  _spawn() {
    const pool = ENEMY_TYPES.filter((t) => t.minNight <= this.night && this._freeAnchors(t.anchors).length);
    if (!pool.length) return;
    const bag = [];
    for (const t of pool) for (let i = 0; i < t.weight; i++) bag.push(t);
    const type = bag[(this.rng() * bag.length) | 0];
    const anchors = this._freeAnchors(type.anchors);
    const anchor = anchors[(this.rng() * anchors.length) | 0];
    const e = new Enemy(type, anchor, this.scene, this.eye, mulberry32((this.rng() * 1e9) >>> 0),
      this.params.advanceMul, this.params.cueMul);
    this.enemies.push(e);
    this.bus.emit('spawn', { name: type.name, pan: anchor.pan });
  }

  update(dt, flashlight) {
    if (!this.active) return { tension: this.tension, scared: false };
    let scared = false;

    const activeCount = this.enemies.filter(ALIVE).length;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && activeCount < this.params.maxConcurrent) {
      this.spawnTimer = randRange(this.rng, ...this.params.spawnInterval);
      this._spawn();
    }

    let maxThreat = 0;
    for (const e of this.enemies) {
      const evs = e.update(dt, flashlight, this.bus);
      if (evs) for (const ev of evs) { if (ev.type === 'scare') scared = ev.payload; this.bus.emit(ev.type, ev.payload); }
      e.animate(dt);
      if (ALIVE(e)) maxThreat = Math.max(maxThreat, e.p);
    }
    for (const e of this.enemies) if (e.state === EnemyState.DONE) e.dispose();
    this.enemies = this.enemies.filter((e) => e.state !== EnemyState.DONE);

    this.tension += (maxThreat - this.tension) * Math.min(1, dt * 2);
    return { tension: this.tension, scared };
  }
}
