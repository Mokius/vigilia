// =============================================================================
// enemyManager.js — Spawns and orchestrates the cast for one night. Seeded PRNG
// so a night is reproducible. Keeps one creature per route, applies the night's
// difficulty envelope, and tells the world when a vent/hatch must physically
// open (a creature is using it).
// =============================================================================

import { Enemy, EState } from './enemy.js';
import { ENEMY_TYPES, nightParams } from './enemyTypes.js';
import { ROUTES } from './routes.js';
import { mulberry32, randRange } from '../core/util.js';

const LIVE = (e) => e.state !== EState.DONE;
const THREATENING = (e) => e.state === EState.APPROACH || e.state === EState.ATTACK;

export class EnemyManager {
  constructor(scene, room, eye, bus) {
    Object.assign(this, { scene, room, eye, bus });
    this.enemies = []; this.active = false; this.tension = 0;
  }

  start(night) {
    this.stop();
    this.night = night;
    this.params = nightParams(night);
    this.rng = mulberry32((0x9e3779b9 ^ Math.imul(night, 2654435761)) >>> 0);
    this.spawnTimer = randRange(this.rng, 2.0, 4.0);
    this.active = true; this.tension = 0;
  }

  stop() {
    for (const e of this.enemies) e.dispose();
    this.enemies = []; this.active = false; this.tension = 0;
    if (this.room.resetAccesses) this.room.resetAccesses();
  }

  _busyRoutes() { return new Set(this.enemies.filter(LIVE).map((e) => e.routeName)); }

  _spawn() {
    const busy = this._busyRoutes();
    const pool = ENEMY_TYPES.filter((t) => t.minNight <= this.night
      && t.routes.some((r) => !busy.has(r)));
    if (!pool.length) return;
    const bag = []; for (const t of pool) for (let i = 0; i < t.weight; i++) bag.push(t);
    const type = bag[(this.rng() * bag.length) | 0];

    // Sometimes it's just a fly-by across the corridor: a scare with no threat.
    let routeName;
    if (type.crossRoute && !busy.has(type.crossRoute) && this.rng() < this.params.crossChance) {
      routeName = type.crossRoute;
    } else {
      const free = type.routes.filter((r) => !busy.has(r));
      if (!free.length) return;
      routeName = free[(this.rng() * free.length) | 0];
    }

    // Later nights don't move faster — they WAIT LESS. The dash is already
    // near-instant, so pressure comes from shorter, more erratic stillness.
    const scaled = Object.assign({}, type, {
      holdMin: type.holdMin * this.params.holdMul,
      holdMax: type.holdMax * this.params.holdMul,
    });
    const e = new Enemy(scaled, routeName, this.scene, this.eye, mulberry32((this.rng() * 1e9) >>> 0), this.room);
    this.enemies.push(e);
    this.bus.emit('spawn', { name: type.name, pan: ROUTES[routeName].pan, route: routeName });
  }

  update(dt, flashlight) {
    if (!this.active) return { tension: this.tension, scared: false };
    let scared = false;

    const live = this.enemies.filter(THREATENING).length;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && live < this.params.maxConcurrent) {
      this.spawnTimer = randRange(this.rng, ...this.params.spawnInterval);
      this._spawn();
    }

    let maxThreat = 0;
    for (const e of this.enemies) {
      const evs = e.update(dt, flashlight);
      for (const ev of evs) {
        if (ev.type === 'scare') scared = ev.payload;
        // Creatures physically work the accesses open, and pull them back when
        // driven off. The room keeps that state for the rest of the night.
        if (ev.type === 'access') {
          if (ev.payload.opening) this.room.openStep(ev.payload.name);
          else this.room.closeStep(ev.payload.name);
          continue;
        }
        this.bus.emit(ev.type, ev.payload);
      }
      e.animate(dt);
      if (THREATENING(e)) maxThreat = Math.max(maxThreat, e.p);
    }
    for (const e of this.enemies) if (e.state === EState.DONE) e.dispose();
    this.enemies = this.enemies.filter(LIVE);

    // Only the two nearest creatures cast shadows. The shadow pass re-renders
    // every caster, and in near-darkness a distant creature's shadow is not
    // something anyone can see anyway.
    if (this.enemies.length > 2) {
      const order = this.enemies.slice().sort((a, b) => b.p - a.p);
      order.forEach((e, i) => e.setCastShadow(i < 2));
    } else {
      for (const e of this.enemies) e.setCastShadow(true);
    }


    this.tension += (maxThreat - this.tension) * Math.min(1, dt * 2);
    return { tension: this.tension, scared };
  }
}
