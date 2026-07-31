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

const ALL_ROUTES = ['door', 'vent', 'hatch', 'corridor', 'window'];

const LIVE = (e) => e.state !== EState.DONE;
const THREATENING = (e) => e.state === EState.APPROACH || e.state === EState.ATTACK;

export class EnemyManager {
  constructor(scene, room, eye, bus) {
    Object.assign(this, { scene, room, eye, bus });
    this.enemies = []; this.active = false; this.tension = 0;
  }

  start(night, { autoSpawn = true } = {}) {
    this.stop();
    this.night = night;
    this.params = nightParams(night);
    this.rng = mulberry32((0x9e3779b9 ^ Math.imul(night, 2654435761)) >>> 0);
    this.spawnTimer = randRange(this.rng, 2.0, 4.0);
    this.active = true; this.tension = 0;
    // The guided night drives every appearance itself.
    this.autoSpawn = autoSpawn;
  }

  /** Scripted spawn on a named route (used by the tutorial). Returns the Enemy. */
  spawnOn(routeName, { harmless = false, holdMul = 1, demoLock = 0 } = {}) {
    const route = ROUTES[routeName];
    if (!route) return null;
    // pick a type that legitimately uses this access, so the demo stays coherent
    const type = ENEMY_TYPES.find((t) => t.routes.includes(routeName)) || ENEMY_TYPES[0];
    const scaled = Object.assign({}, type, {
      holdMin: type.holdMin * holdMul, holdMax: type.holdMax * holdMul,
    });
    const e = new Enemy(scaled, routeName, this.scene, this.eye,
      mulberry32(((Math.random() * 1e9) | 0) >>> 0), this.room);
    e.harmless = harmless;
    e.demoLock = demoLock;
    this.enemies.push(e);
    this.bus.emit('spawn', { name: type.name, pan: route.pan, route: routeName });
    return e;
  }

  stop() {
    for (const e of this.enemies) e.dispose();
    this.enemies = []; this.active = false; this.tension = 0;
    if (this.room.resetAccesses) this.room.resetAccesses();
  }

  // The five ways into the room. Kept here rather than derived from the cast, so
  // adding a creature cannot quietly change how often an entrance is used.
  static get ROUTES() { return ALL_ROUTES; }

  _busyRoutes() { return new Set(this.enemies.filter(LIVE).map((e) => e.routeName)); }

  _spawn() {
    const busy = this._busyRoutes();

    // ---- ROUTE FIRST, THEN CREATURE ---------------------------------------
    // This used to pick the creature and then one of ITS routes, which handed
    // romero's three entrances 16.7% each and romera's two 25% each — five ways in
    // with five different frequencies, and no memory either, so the same door could
    // come twice running. The player's job is to watch five places, so all five
    // have to earn attention equally. Choose the WAY IN first, penalise whatever
    // has been used lately, and only then ask which creature uses that entrance.
    const usable = ALL_ROUTES.filter((r) => !busy.has(r)
      && ENEMY_TYPES.some((t) => t.minNight <= this.night && t.routes.includes(r)));
    if (!usable.length) return;
    this._recent = this._recent || [];
    const bag = [];
    for (const r of usable) {
      const age = this._recent.lastIndexOf(r);
      // most recent gets weight 1, the one before 2, and so on; unused gets 6
      const w = age < 0 ? 6 : (this._recent.length - age);
      for (let i = 0; i < w; i++) bag.push(r);
    }
    const routeName = bag[(this.rng() * bag.length) | 0];
    this._recent.push(routeName);
    while (this._recent.length > 3) this._recent.shift();

    const cands = ENEMY_TYPES.filter((t) => t.minNight <= this.night && t.routes.includes(routeName));
    if (!cands.length) return;
    const type = cands[(this.rng() * cands.length) | 0];

    // Later nights don't move faster — they WAIT LESS. The dash is already
    // near-instant, so pressure comes from shorter, more erratic stillness.
    const scaled = Object.assign({}, type, {
      holdMin: type.holdMin * this.params.holdMul,
      holdMax: type.holdMax * this.params.holdMul,
    });
    const e = new Enemy(scaled, routeName, this.scene, this.eye, mulberry32((this.rng() * 1e9) >>> 0), this.room);
    // Per-night scaling that the creature applies itself: how fast it CROSSES
    // (never how fast its legs move) and how long the beam has to be held.
    e.dashMul = this.params.dashMul;
    e.banishMul = this.params.banishMul;
    e.aggression = this.params.aggression;
    this.enemies.push(e);
    this.bus.emit('spawn', { name: type.name, pan: ROUTES[routeName].pan, route: routeName });
  }

  update(dt, flashlight) {
    if (!this.active) return { tension: this.tension, scared: false };
    let scared = false;

    const live = this.enemies.filter(THREATENING).length;
    if (this.autoSpawn !== false) this.spawnTimer -= dt;
    if (this.autoSpawn !== false && this.spawnTimer <= 0 && live < this.params.maxConcurrent) {
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
