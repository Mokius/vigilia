// =============================================================================
// audioBus.js — 100% procedural spatial audio (Web Audio API). No sound files.
// The U-Box strip is physically LEFT | FRONT | RIGHT, so a stereo pan maps
// directly to on-screen direction: pan -1 = left screen, 0 = front, +1 = right.
// "Behind" cues are widened and low-passed to feel muffled/off-camera.
// Everything (drone bed, breaths, steps, knocks, whispers, scrape, scream)
// is synthesized so there are zero licensing/IP concerns.
// =============================================================================

import { CONFIG } from '../config.js';
import { clamp } from '../core/util.js';

export class AudioBus {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this._noise = null;
    this._tension = 0;
    this._hbTimer = 0;
    this.enabled = true;
  }

  // Must be called from a user gesture (menu "enter").
  async resume() {
    if (!this.ctx) this._init();
    if (this.ctx.state !== 'running') { try { await this.ctx.resume(); } catch {} }
    if (!this._droneStarted) this._startDrone();
    this.ready = true;
  }

  _init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    this.ctx = ctx;
    // Signal flow:
    //   master -> duck -> glue-comp ->\
    //                                  limiter -> destination
    //   scareBus ----------------------/
    // The scream MUST NOT pass through `duck` — it used to, which meant the
    // jumpscare was ducking ITSELF and landed soft. It now bypasses straight to
    // a brick-wall limiter, so it can be pushed far louder than anything else
    // in the mix while staying clear of digital clipping.
    this.master = ctx.createGain(); this.master.gain.value = CONFIG.audio.masterGain;
    this.duck = ctx.createGain(); this.duck.gain.value = 1;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 22; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.25;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1.5; limiter.knee.value = 0; limiter.ratio.value = 20;
    limiter.attack.value = 0.0008; limiter.release.value = 0.06;
    this.limiter = limiter;

    this.scareBus = ctx.createGain(); this.scareBus.gain.value = 1;

    this.master.connect(this.duck); this.duck.connect(comp); comp.connect(limiter);
    this.scareBus.connect(limiter);
    limiter.connect(ctx.destination);

    // reusable white-noise buffer
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noise = buf;
  }

  _now() { return this.ctx.currentTime; }
  _noiseSrc() { const s = this.ctx.createBufferSource(); s.buffer = this._noise; s.loop = true; return s; }

  // Build a per-event output chain: → [lowpass?] → panner → master
  _out(pan = 0, muffle = 0) {
    const ctx = this.ctx;
    const panner = ctx.createStereoPanner();
    panner.pan.value = clamp(pan, -1, 1);
    let head = panner;
    if (muffle > 0) {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.value = 1600 - muffle * 1200; lp.Q.value = 0.4;
      lp.connect(panner); head = lp;
    }
    panner.connect(this.master);
    return { head, panner };
  }

  // ---- ambient drone bed + tension layer ------------------------------------
  _startDrone() {
    const ctx = this.ctx; this._droneStarted = true;
    const bed = ctx.createGain(); bed.gain.value = 0.0; bed.connect(this.master);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260; lp.Q.value = 0.7; lp.connect(bed);
    [55, 55.2, 82.4, 36.7].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = i === 3 ? 'sine' : 'sawtooth'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = i === 3 ? 0.5 : 0.16; o.connect(g); g.connect(lp); o.start();
    });
    // slow filter LFO
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.06;
    const lg = ctx.createGain(); lg.gain.value = 80; lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
    // brown-ish noise wash
    const n = this._noiseSrc(); const nlp = ctx.createBiquadFilter(); nlp.type = 'lowpass'; nlp.frequency.value = 500;
    const ng = ctx.createGain(); ng.gain.value = 0.02; n.connect(nlp); nlp.connect(ng); ng.connect(bed); n.start();
    // tension layer (dissonant high cluster, gated by _tensionGain)
    const tg = ctx.createGain(); tg.gain.value = 0; tg.connect(this.master);
    const thp = ctx.createBiquadFilter(); thp.type = 'bandpass'; thp.frequency.value = 1400; thp.Q.value = 2; thp.connect(tg);
    [220, 233, 466, 590].forEach((f) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; const g = ctx.createGain(); g.gain.value = 0.05; o.connect(g); g.connect(thp); o.start(); });
    this._bedGain = bed; this._tensionGain = tg;
    // fade the bed in
    bed.gain.setTargetAtTime(0.9, ctx.currentTime, 3);
  }

  setTension(x) {
    this._tension = clamp(x, 0, 1);
    if (this._tensionGain) this._tensionGain.gain.setTargetAtTime(this._tension * 0.5, this._now(), 0.6);
  }

  // ---- one-shot cues --------------------------------------------------------
  footstep(pan = 0, muffle = 0.2) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t = this._now(), { head } = this._out(pan, muffle);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 190; bp.Q.value = 1.4;
    const g = ctx.createGain(); g.gain.value = 0; const n = this._noiseSrc();
    n.connect(bp); bp.connect(g); g.connect(head);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.008); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.15);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.5, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.18); o.connect(og); og.connect(head);
    n.start(t); o.start(t); n.stop(t + 0.2); o.stop(t + 0.2);
  }

  knock(pan = 0, muffle = 0.15) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t = this._now(), { head } = this._out(pan, muffle);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.12);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22); o.connect(g); g.connect(head);
    const n = this._noiseSrc(); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 1;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.5, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.05); n.connect(bp); bp.connect(ng); ng.connect(head);
    o.start(t); n.start(t); o.stop(t + 0.3); n.stop(t + 0.08);
  }

  breath(pan = 0, muffle = 0.5) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t = this._now(), { head } = this._out(pan, muffle);
    const mk = (start, dur, peak) => {
      const n = this._noiseSrc(); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 480; bp.Q.value = 0.8;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(peak, start + dur * 0.4); g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      n.connect(bp); bp.connect(g); g.connect(head); n.start(start); n.stop(start + dur + 0.05);
    };
    mk(t, 0.5, 0.16); mk(t + 0.6, 0.55, 0.12);   // inhale / exhale
  }

  whisper(pan = 0, muffle = 0.3) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t = this._now(), { head } = this._out(pan, muffle);
    const n = this._noiseSrc(); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 6;
    bp.frequency.setValueAtTime(900, t); bp.frequency.linearRampToValueAtTime(2600, t + 1.1);
    const g = ctx.createGain(); g.gain.value = 0; n.connect(bp); bp.connect(g); g.connect(head);
    // tremolo to mimic syllables
    const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 7; const lg = ctx.createGain(); lg.gain.value = 0.09;
    lfo.connect(lg); lg.connect(g.gain); g.gain.value = 0.11; lfo.start(t);
    n.start(t); n.stop(t + 1.2); lfo.stop(t + 1.2);
  }

  scrape(pan = 0, muffle = 0.1) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t = this._now(), { head } = this._out(pan, muffle);
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(90, t); o.frequency.linearRampToValueAtTime(180, t + 0.5);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 9;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t + 0.05); g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    o.connect(bp); bp.connect(g); g.connect(head); o.start(t); o.stop(t + 0.6);
  }

  // The jumpscare stinger. Loud, brief, ducks everything else. `variant` gives
  // each monster a distinct voice: shriek (high sawtooth), gurgle (low wet),
  // whisperscream (breathy + shriek), roar (broadband distorted).
  scream(variant = 'shriek') {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.012;         // tiny lookahead = sample-accurate
    const ATT = 0.004, SUS = 0.42, REL = 0.34; // instant attack, held, then gone
    const END = ATT + SUS + REL;

    // slam everything else down so the scream owns the whole mix
    this.duck.gain.cancelScheduledValues(t);
    this.duck.gain.setValueAtTime(0.05, t);
    this.duck.gain.setTargetAtTime(1, t + END + 0.25, 0.7);

    const V = {
      shriek:        { base: [560, 571, 848, 1123], drive: 5.0, sub: [160, 46], noise: 0.55, hiss: 2600 },
      gurgle:        { base: [96, 101, 148, 214],   drive: 8.0, sub: [128, 30], noise: 0.95, hiss: 700 },
      whisperscream: { base: [352, 361, 628, 905],  drive: 4.0, sub: [116, 40], noise: 1.05, hiss: 3400 },
      roar:          { base: [152, 159, 236, 318],  drive: 7.0, sub: [148, 34], noise: 0.8,  hiss: 1200 },
    }[variant] || { base: [190, 197, 286, 402], drive: 5.0, sub: [136, 38], noise: 0.7, hiss: 2000 };

    // --- master envelope: near-vertical attack, flat hold, fast release ------
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(1.0, t + ATT);
    env.gain.setValueAtTime(1.0, t + ATT + SUS);
    env.gain.exponentialRampToValueAtTime(0.0008, t + END);

    // hard saturation gives the "torn speaker" edge and raises perceived
    // loudness far more than raw gain would
    const shaper = ctx.createWaveShaper();
    const cur = new Float32Array(2048);
    for (let i = 0; i < 2048; i++) { const x = i / 1024 - 1; cur[i] = Math.tanh(x * V.drive) * 0.92; }
    shaper.curve = cur; shaper.oversample = '4x';
    env.connect(shaper);

    // stereo spread: two slightly detuned halves hard-ish left and right
    const outL = ctx.createStereoPanner(); outL.pan.value = -0.55;
    const outR = ctx.createStereoPanner(); outR.pan.value = 0.55;
    const wide = ctx.createGain(); wide.gain.value = 2.6;
    shaper.connect(wide); wide.connect(outL); wide.connect(outR);
    outL.connect(this.scareBus); outR.connect(this.scareBus);

    // --- 1. transient: the hit that makes you flinch ------------------------
    const nb = this._noiseSrc();
    const nbf = ctx.createBiquadFilter(); nbf.type = 'bandpass'; nbf.frequency.value = 1800; nbf.Q.value = 0.6;
    const nbg = ctx.createGain();
    nbg.gain.setValueAtTime(1.6, t); nbg.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    nb.connect(nbf); nbf.connect(nbg); nbg.connect(this.scareBus);
    nb.start(t); nb.stop(t + 0.12);

    // --- 2. the shriek: detuned saw cluster, glissando down ------------------
    V.base.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = i % 2 ? 'sawtooth' : 'square';
      o.frequency.setValueAtTime(f * 1.35, t);
      o.frequency.exponentialRampToValueAtTime(f * 0.62, t + ATT + SUS + REL * 0.8);
      o.detune.value = (i - 1.5) * 22;
      const og = ctx.createGain(); og.gain.value = 0.4 / V.base.length;
      o.connect(og); og.connect(env); o.start(t); o.stop(t + END);
    });

    // --- 3. throat/formant growl --------------------------------------------
    const gr = ctx.createOscillator(); gr.type = 'sawtooth'; gr.frequency.value = V.base[0] * 0.5;
    const fmt = ctx.createBiquadFilter(); fmt.type = 'bandpass'; fmt.Q.value = 9;
    fmt.frequency.setValueAtTime(V.hiss, t);
    fmt.frequency.exponentialRampToValueAtTime(V.hiss * 0.32, t + END);
    const grg = ctx.createGain(); grg.gain.value = 0.5;
    gr.connect(fmt); fmt.connect(grg); grg.connect(env); gr.start(t); gr.stop(t + END);

    // --- 4. sub drop: the part you feel rather than hear ---------------------
    const sub = ctx.createOscillator(); sub.type = 'sine';
    sub.frequency.setValueAtTime(V.sub[0], t);
    sub.frequency.exponentialRampToValueAtTime(V.sub[1], t + END * 0.85);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, t); sg.gain.linearRampToValueAtTime(1.5, t + 0.01);
    sg.gain.exponentialRampToValueAtTime(0.001, t + END);
    sub.connect(sg); sg.connect(this.scareBus); sub.start(t); sub.stop(t + END);

    // --- 5. air/hiss layer ---------------------------------------------------
    const air = this._noiseSrc();
    const ahp = ctx.createBiquadFilter(); ahp.type = 'highpass'; ahp.frequency.value = V.hiss;
    const ag = ctx.createGain();
    ag.gain.setValueAtTime(0.0001, t); ag.gain.linearRampToValueAtTime(V.noise, t + ATT);
    ag.gain.setValueAtTime(V.noise, t + ATT + SUS * 0.7);
    ag.gain.exponentialRampToValueAtTime(0.001, t + END);
    air.connect(ahp); ahp.connect(ag); ag.connect(this.scareBus);
    air.start(t); air.stop(t + END);

    return { at: t, attack: ATT, sustain: SUS, total: END };
  }

  // Rising electric tone when a battery cell tops up the flashlight.
  charge(pan = 0) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t = this._now(), { head } = this._out(pan, 0);
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(320, t); o.frequency.exponentialRampToValueAtTime(1050, t + 0.5);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.28, t + 0.05); g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    o.connect(g); g.connect(head); o.start(t); o.stop(t + 0.6);
  }

  // Rising tick while a battery cell is charging: pitch climbs with progress so
  // you can hear how close you are without looking away.
  tick(pan = 0, frac = 0) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t = this._now(), { head } = this._out(pan, 0);
    const o = ctx.createOscillator(); o.type = 'square';
    o.frequency.value = 620 + frac * 900;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.075, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.075);
    o.connect(g); g.connect(head); o.start(t); o.stop(t + 0.09);
  }

  // The impact of a creature arriving at a new station. Gets harder and closer
  // as it advances, so you can hear it gaining ground even without seeing it.
  lunge(pan = 0, p = 0) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t = this._now(), { head } = this._out(pan, 0.3 * (1 - p));
    const amp = 0.28 + p * 0.6;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(150 - p * 40, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.16);
    const g = ctx.createGain(); g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g); g.connect(head); o.start(t); o.stop(t + 0.24);
    // scuff of the body arriving
    const n = this._noiseSrc();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500 + p * 900; bp.Q.value = 1.1;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(amp * 0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    n.connect(bp); bp.connect(ng); ng.connect(head); n.start(t); n.stop(t + 0.15);
  }

  // Heavy hinge groan — a door being pushed open somewhere in the dark.
  creak(pan = 0) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t = this._now(), { head } = this._out(pan, 0.2);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(58, t);
    o.frequency.linearRampToValueAtTime(132, t + 0.5);
    o.frequency.linearRampToValueAtTime(96, t + 1.0);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 780; bp.Q.value = 7;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
    // irregular stick-slip judder
    const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 11;
    const lg = ctx.createGain(); lg.gain.value = 0.09; lfo.connect(lg); lg.connect(g.gain);
    o.connect(bp); bp.connect(g); g.connect(head);
    o.start(t); lfo.start(t); o.stop(t + 1.15); lfo.stop(t + 1.15);
  }

  // Soft periodic idle blip so you can HEAR where an active green cell is.
  blip(pan = 0) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t = this._now(), { head } = this._out(pan, 0.2);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 1400;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0006, t + 0.13);
    o.connect(g); g.connect(head); o.start(t); o.stop(t + 0.15);
  }

  // Metallic duct rattle when a vent/hatch swings open.
  ductRattle(pan = 0) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t = this._now(), { head } = this._out(pan, 0.15);
    const n = this._noiseSrc(); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 5;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.22, t + 0.03); g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    // tremolo for the rattle
    const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 22; const lg = ctx.createGain(); lg.gain.value = 0.14; lfo.connect(lg); lg.connect(g.gain);
    n.connect(bp); bp.connect(g); g.connect(head); n.start(t); n.stop(t + 0.75); lfo.start(t); lfo.stop(t + 0.75);
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.6); const og = ctx.createGain(); og.gain.setValueAtTime(0.12, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.65); o.connect(og); og.connect(head); o.start(t); o.stop(t + 0.7);
  }

  boom(pan = 0) {
    if (!this.ready) return;
    const ctx = this.ctx, t = this._now(), { head } = this._out(pan, 0);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.7);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.8); o.connect(g); g.connect(head); o.start(t); o.stop(t + 0.9);
  }

  // heartbeat driven by tension; call every frame
  updateHeartbeat(dt) {
    if (!this.ready || this._tension < 0.25) return;
    this._hbTimer -= dt;
    if (this._hbTimer <= 0) {
      const bpm = 55 + this._tension * 70; this._hbTimer = 60 / bpm;
      const ctx = this.ctx, t = this._now();
      const thump = (dl) => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(60, t + dl); o.frequency.exponentialRampToValueAtTime(34, t + dl + 0.12); const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t + dl); g.gain.exponentialRampToValueAtTime(0.35 * this._tension, t + dl + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + dl + 0.18); o.connect(g); g.connect(this.master); o.start(t + dl); o.stop(t + dl + 0.2); };
      thump(0); thump(0.16);
    }
  }
}
