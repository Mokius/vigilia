// =============================================================================
// tutorial.js — Night 1 is a guided shift, not a test.
//
// A fully scripted sequence: nothing spawns on its own, the player cannot die,
// no creature ever reaches a jumpscare, and every access in the room is
// demonstrated once so the space is memorised before a real night starts.
//
// Teaching is done by events, not by walls of text: the room does something, a
// short stencilled line appears low on the front wall, and the step only ends
// when the player actually performs the action. If they take too long the hint
// simply repeats — there is no failure state anywhere in here.
// =============================================================================

import { CONFIG } from '../config.js';

const STEPS = [
  {
    id: 'look',
    hint: 'Mueve el ratón: la linterna es tu única luz',
    // done once they have actually swept the beam around
    done: (c) => c.swept > 1.6,
  },
  {
    id: 'battery',
    hint: 'La linterna se agota. Ilumina la celda verde y MANTÉN la luz',
    enter: (c) => c.spawnBattery(),
    done: (c) => c.batteriesTaken >= 1,
    after: (c) => c.say('Recargada. Las celdas son limitadas: gástalas bien', 3.2),
  },
  {
    id: 'door',
    route: 'door',
    hint: 'Algo fuerza la puerta. Ilumínalo y mantén la luz encima',
    intro: 'Escucha. Algo viene por la puerta',
  },
  {
    id: 'vent',
    route: 'vent',
    hint: 'La rejilla del conducto. Mantén la luz sobre lo que sale',
    intro: 'La ventilación se está moviendo',
  },
  {
    id: 'hatch',
    route: 'hatch',
    hint: 'La arqueta del suelo. Baja la linterna y mantenla',
    intro: 'Algo empuja desde debajo del suelo',
  },
  {
    id: 'corridor',
    route: 'corridor',
    hint: 'Por el pasillo llegan de frente. No dejes de iluminarlo',
    intro: 'Mira al fondo del pasillo',
  },
  {
    id: 'window',
    route: 'window',
    hint: 'La ventana rota. Ilumínalo antes de que pase el alféizar',
    intro: 'Cristales. Viene por la ventana',
  },
  {
    id: 'end',
    hint: 'Ya conoces la sala. Mañana nadie te va a avisar',
    hold: 5.0,
  },
];

// Nothing in the guided night may take longer than this. It is a backstop, not a
// pacing value: every step has its own completion test, and this only fires when
// one of those tests cannot be satisfied.
const STEP_LIMIT = 26;

export class Tutorial {
  constructor({ game, room, flashlight, audio, manager, pickups }) {
    Object.assign(this, { game, room, flashlight, audio, manager, pickups });
    this.i = -1;
    this.t = 0;
    this.swept = 0;
    this.batteriesTaken = 0;
    this.current = null;      // the demo creature for this step
    this.finished = false;
    this._lastDir = flashlight.dir.clone();
    this._buildCaption();
    this._next();
  }

  // ---- discreet caption, painted-signage styling, front panel only ---------
  _buildCaption() {
    const solo = new URLSearchParams(location.search).get('surface');
    if (solo && solo !== 'front') { this.el = null; return; }   // side screens stay clean
    const left = solo === 'front' ? '0' : '25vw';
    const width = solo === 'front' ? '100vw' : '25vw';
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;bottom:7%;left:' + left + ';width:' + width + ';'
      + 'text-align:center;pointer-events:none;z-index:45;opacity:0;transition:opacity .8s;'
      + 'font-family:' + CONFIG.fonts.stencil + ';font-size:clamp(11px,1.15vw,19px);'
      + 'letter-spacing:.14em;color:#c9cdbe;text-shadow:0 0 10px rgba(0,0,0,.95),0 1px 0 #000;'
      + 'padding:0 6%;line-height:1.5';
    document.body.appendChild(el);
    this.el = el;
  }

  say(text, seconds = 0) {
    if (!this.el) return;
    this.el.textContent = text;
    this.el.style.opacity = '0.88';
    this._sayT = seconds > 0 ? seconds : 0;
  }

  hide() { if (this.el) this.el.style.opacity = '0'; }

  spawnBattery() {
    // one cell, on the maintenance bench: a safe, obvious, lit-from-nowhere place
    this.pickups.clear();
    const spot = this.room.pickupSpots.find((s) => s.pos.x < -0.9) || this.room.pickupSpots[0];
    this.room._tutorialSpots = [spot];
    this.pickups.spawnAt([spot]);
  }

  _next() {
    this.i++;
    this.t = 0;
    this.current = null;
    this._done = false;              // completion may only fire ONCE per step
    this._advanceAfter = undefined;
    if (this.i >= STEPS.length) { this.finished = true; this.hide(); return; }
    const s = STEPS[this.i];
    if (s.enter) s.enter(this);
    if (s.intro) { this.say(s.intro); this._introT = 2.6; } else { this.say(s.hint); this._introT = 0; }
    // creature demos: spawn it harmless on the named access
    if (s.route) {
      // demoLock 2: it must physically work the access open and come through
      // before the light can send it back. That is the lesson.
      // demoLock 1, not 2. At 2 the beam could not touch it until it was fully
      // inside, which needed the access two thirds open — and every retreat pulled
      // that back to zero, so the condition was often unreachable. At 1 it has
      // leant into the opening and is plainly visible, which is enough of a lesson.
      this.current = this.manager.spawnOn(s.route, { harmless: true, holdMul: 1.6, demoLock: 1 });
    }
  }

  update(dt) {
    if (this.finished) return;
    const s = STEPS[this.i];
    this.t += dt;

    // track how much the player has swept the beam (step 1)
    const d = this.flashlight.dir;
    this.swept += d.angleTo(this._lastDir);
    this._lastDir.copy(d);

    // intro line gives way to the actionable hint
    if (this._introT > 0) {
      this._introT -= dt;
      if (this._introT <= 0) this.say(s.hint);
    }
    if (this._sayT > 0) { this._sayT -= dt; if (this._sayT <= 0) this.say(s.hint); }

    // ---- completion (fires exactly once) -----------------------------------
    if (!this._done) {
      if (s.route) {
        // THE LESSON IS "you drove it off", so that is what is measured — not a
        // state the object happens to be in when we look. Waiting for done/hide
        // meant a creature that retreated, closed the door behind it and started
        // over never satisfied the check, and the step hung for ever.
        const c = this.current;
        const beaten = !c || c.repelled || c.state === 'done' || c.state === 'hide';
        if (beaten && this.t > 2.0) {
          this._done = true;
          this.say('Bien. Así se les echa', 2.4);
          this._advanceAfter = 2.4;
        } else if (this.t > STEP_LIMIT) {
          // BACKSTOP. A scripted sequence must never be able to trap the player,
          // whatever goes wrong behind it — so every step has a ceiling, and going
          // over it moves on with a line that does not pretend they succeeded.
          this._done = true;
          this.say('Déjalo. Sigamos', 2.2);
          this._advanceAfter = 2.2;
        }
      } else if (s.done) {
        if (s.done(this)) {
          this._done = true;
          if (s.after) s.after(this); else this.say('Bien', 1.8);
          this._advanceAfter = s.after ? 3.2 : 1.8;
        }
      } else if (s.hold && this.t > s.hold) {
        this._done = true;
        this._advanceAfter = 0.01;
      } else if (!s.hold && this.t > STEP_LIMIT) {
        this._done = true;
        this._advanceAfter = 0.01;
      }
    }

    if (this._advanceAfter !== undefined) {
      this._advanceAfter -= dt;
      if (this._advanceAfter <= 0) { this._advanceAfter = undefined; this._next(); }
    }
  }

  dispose() { if (this.el) this.el.remove(); }
}
