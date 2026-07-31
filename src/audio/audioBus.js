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
    // The hum is part of the room's identity, but it must sit UNDER everything
    // else rather than dominate — it was fatiguing over a long session.
    bed.gain.setTargetAtTime(0.42, ctx.currentTime, 3);

    // Sparse piano layer: isolated notes with a lot of silence between them.
    this._musicGain = ctx.createGain(); this._musicGain.gain.value = 0.0;
    this._musicGain.connect(this.master);
    this._musicGain.gain.setTargetAtTime(1, ctx.currentTime + 2, 4);
    this._noteT = 6 + Math.random() * 6;
    this._ambT = 3 + Math.random() * 5;
  }

  // ---- ambient factory life ------------------------------------------------
  // One-shots fired at irregular intervals so no pattern is ever learnable.
  _amb(kind, pan) {
    const ctx = this.ctx, t = this._now(), { head } = this._out(pan, 0.35);
    const noise = () => this._noiseSrc();
    const env = (g, peak, atk, dur) => {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + atk);
      g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    };
    if (kind === 'steam') {                       // pssshhh from a joint
      const n = noise(), bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.setValueAtTime(3800, t); bp.frequency.exponentialRampToValueAtTime(1500, t + 1.4);
      bp.Q.value = 0.7; const g = ctx.createGain(); env(g, 0.1, 0.08, 1.6);
      n.connect(bp); bp.connect(g); g.connect(head); n.start(t); n.stop(t + 1.7);
    } else if (kind === 'pipe') {                 // metal expanding: a slow tick-groan
      const o = ctx.createOscillator(); o.type = 'triangle';
      o.frequency.setValueAtTime(210, t); o.frequency.linearRampToValueAtTime(178, t + 0.9);
      const bq = ctx.createBiquadFilter(); bq.type = 'bandpass'; bq.frequency.value = 900; bq.Q.value = 12;
      const g = ctx.createGain(); env(g, 0.075, 0.05, 1.1);
      o.connect(bq); bq.connect(g); g.connect(head); o.start(t); o.stop(t + 1.2);
    } else if (kind === 'drip') {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(1500, t); o.frequency.exponentialRampToValueAtTime(680, t + 0.07);
      const g = ctx.createGain(); env(g, 0.06, 0.004, 0.16);
      o.connect(g); g.connect(head); o.start(t); o.stop(t + 0.2);
    } else if (kind === 'relay') {                // contactor clack
      const n = noise(), hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2200;
      const g = ctx.createGain(); env(g, 0.09, 0.002, 0.06);
      n.connect(hp); hp.connect(g); g.connect(head); n.start(t); n.stop(t + 0.09);
    } else if (kind === 'beep') {                 // a panel still reporting to nobody
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 1180;
      const g = ctx.createGain(); env(g, 0.028, 0.005, 0.14);
      o.connect(g); g.connect(head); o.start(t); o.stop(t + 0.16);
    } else if (kind === 'transformer') {          // mains buzz swelling then gone
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 100;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320;
      const g = ctx.createGain(); env(g, 0.07, 0.6, 2.6);
      o.connect(lp); lp.connect(g); g.connect(head); o.start(t); o.stop(t + 2.8);
    } else if (kind === 'farknock') {             // something heavy, far away
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(88, t); o.frequency.exponentialRampToValueAtTime(44, t + 0.25);
      const g = ctx.createGain(); env(g, 0.16, 0.006, 0.5);
      o.connect(g); g.connect(head); o.start(t); o.stop(t + 0.55);
    } else if (kind === 'creak') {                // structure settling
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(64, t); o.frequency.linearRampToValueAtTime(118, t + 1.1);
      const bq = ctx.createBiquadFilter(); bq.type = 'bandpass'; bq.frequency.value = 640; bq.Q.value = 9;
      const g = ctx.createGain(); env(g, 0.07, 0.2, 1.3);
      o.connect(bq); bq.connect(g); g.connect(head); o.start(t); o.stop(t + 1.4);
    } else if (kind === 'fan') {                  // an extractor spinning down
      const n = noise(), lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(260, t + 2.4);
      const g = ctx.createGain(); env(g, 0.06, 0.5, 2.6);
      const lfo = ctx.createOscillator(); lfo.frequency.value = 7.5;
      const lg = ctx.createGain(); lg.gain.value = 0.02; lfo.connect(lg); lg.connect(g.gain); lfo.start(t); lfo.stop(t + 2.7);
      n.connect(lp); lp.connect(g); g.connect(head); n.start(t); n.stop(t + 2.7);
    } else {                                      // 'starter': machinery failing to catch
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      const g = ctx.createGain(); g.gain.value = 0.0001;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
      o.connect(lp); lp.connect(g); g.connect(head); o.start(t);
      for (let i = 0; i < 3; i++) {
        const s = t + i * 0.42;
        o.frequency.setValueAtTime(42, s); o.frequency.linearRampToValueAtTime(96, s + 0.16);
        o.frequency.linearRampToValueAtTime(38, s + 0.34);
        g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.1, s + 0.06);
        g.gain.exponentialRampToValueAtTime(0.0008, s + 0.36);
      }
      o.stop(t + 1.4);
    }
  }

  // A very quiet, slow piano-like note. Sparse by design: the silence between
  // notes is doing the work.
  _note(freq) {
    const ctx = this.ctx, t = this._now();
    const out = ctx.createGain(); out.gain.value = 0.055; out.connect(this._musicGain);
    // struck-string-ish: a couple of partials with fast attack, long tail
    [[1, 1], [2, 0.32], [3.01, 0.12]].forEach(([mul, amp]) => {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = freq * mul;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(amp, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 3.4);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + 3.5);
    });
  }

  /** Call every frame. Drives the ambient one-shots and the sparse music. */
  updateAmbience(dt) {
    if (!this.ready || !this.enabled) return;
    const KINDS = ['steam', 'pipe', 'drip', 'relay', 'beep', 'transformer', 'farknock', 'creak', 'fan', 'starter'];
    this._ambT -= dt;
    if (this._ambT <= 0) {
      // irregular gaps, and quieter/rarer while something is stalking you
      this._ambT = 3.5 + Math.random() * Math.random() * 14;
      if (this._tension < 0.75) this._amb(KINDS[(Math.random() * KINDS.length) | 0], Math.random() * 2 - 1);
    }
    // A minor, unresolved set. Notes are isolated and never form a phrase.
    const SCALE = [146.83, 174.61, 196.00, 220.00, 261.63, 293.66, 349.23];
    this._noteT -= dt;
    if (this._noteT <= 0) {
      this._noteT = 7 + Math.random() * 14;
      if (this._tension < 0.5) this._note(SCALE[(Math.random() * SCALE.length) | 0]);
    }
    // music yields completely to gameplay audio when the room gets dangerous
    if (this._musicGain) {
      const want = this._tension > 0.45 ? 0 : 1 - this._tension * 1.6;
      this._musicGain.gain.setTargetAtTime(Math.max(0, want), this._now(), 0.5);
    }
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
    // Deeper, longer, heavier: it has to sit ON the player for a while.
    const ATT = 0.004, SUS = 0.95, REL = 0.6;  // instant attack, long hold, slow decay
    const END = ATT + SUS + REL;

    // slam everything else down so the scream owns the whole mix
    this.duck.gain.cancelScheduledValues(t);
    // EVERYTHING ELSE GETS OUT OF THE WAY. The rest of the mix is pulled to near
    // silence for the duration, so for a second the only thing that exists is the
    // attack — which is where the dynamic range comes from.
    this.duck.gain.setValueAtTime(0.004, t);
    this.duck.gain.setTargetAtTime(1, t + END + 0.25, 0.7);

    const V = {
      // Every voice dropped roughly an octave: chest and throat, not whistle.
      shriek:        { base: [232, 239, 349, 462], drive: 6.5, sub: [110, 26], noise: 0.5,  hiss: 1500 },
      gurgle:        { base: [62, 66, 97, 141],    drive: 9.0, sub: [96, 22],  noise: 0.9,  hiss: 480 },
      whisperscream: { base: [176, 182, 314, 452], drive: 5.5, sub: [104, 25], noise: 1.0,  hiss: 2100 },
      roar:          { base: [84, 89, 131, 176],   drive: 8.5, sub: [116, 24], noise: 0.75, hiss: 760 },
    }[variant] || { base: [104, 110, 158, 220], drive: 6.5, sub: [108, 25], noise: 0.65, hiss: 1200 };

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
    // Pushed hard into the brick-wall limiter on scareBus rather than left with
    // headroom: the limiter is what lets this be enormous without clipping.
    const wide = ctx.createGain(); wide.gain.value = 4.4;
    shaper.connect(wide); wide.connect(outL); wide.connect(outR);
    outL.connect(this.scareBus); outR.connect(this.scareBus);

    // --- 1. transient: the hit that makes you flinch ------------------------
    const nb = this._noiseSrc();
    const nbf = ctx.createBiquadFilter(); nbf.type = 'bandpass'; nbf.frequency.value = 1800; nbf.Q.value = 0.6;
    const nbg = ctx.createGain();
    nbg.gain.setValueAtTime(3.4, t); nbg.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
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
    const grg = ctx.createGain(); grg.gain.value = 0.95;
    gr.connect(fmt); fmt.connect(grg); grg.connect(env); gr.start(t); gr.stop(t + END);

    // --- 4. sub drop: the part you feel rather than hear ---------------------
    const sub = ctx.createOscillator(); sub.type = 'sine';
    sub.frequency.setValueAtTime(V.sub[0], t);
    sub.frequency.exponentialRampToValueAtTime(V.sub[1], t + END * 0.85);
    const sg = ctx.createGain();
    // the sub is the body of the thing: it is what you feel rather than hear
    sg.gain.setValueAtTime(0.0001, t); sg.gain.linearRampToValueAtTime(3.2, t + 0.008);
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

    // --- 6. the tear: a slow, grinding low layer that makes it oppressive ---
    const tear = ctx.createOscillator(); tear.type = 'square';
    tear.frequency.setValueAtTime(V.base[0] * 0.5, t);
    tear.frequency.exponentialRampToValueAtTime(V.base[0] * 0.28, t + END);
    const tlp = ctx.createBiquadFilter(); tlp.type = 'lowpass'; tlp.frequency.value = 340; tlp.Q.value = 3;
    const tg2 = ctx.createGain(); tg2.gain.value = 0.55;
    // slow amplitude wobble = a throat running out of air
    const wob = ctx.createOscillator(); wob.type = 'sine'; wob.frequency.value = 5.5;
    const wg = ctx.createGain(); wg.gain.value = 0.22; wob.connect(wg); wg.connect(tg2.gain);
    tear.connect(tlp); tlp.connect(tg2); tg2.connect(env);
    tear.start(t); wob.start(t); tear.stop(t + END); wob.stop(t + END);

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

  /**
   * Mechanical sound for an access changing state. `kind` is the access type and
   * `step` is which notch it just moved to, so the first crack of a door and its
   * final swing sound different. Nothing plays once an access is already open.
   */
  /**
   * The wall clock striking the hour. A bell is a struck metal bar: a hard,
   * inharmonic attack that decays into two or three surviving partials. Faking it
   * with a sine gives a doorbell, so the strike is built from a detuned partial
   * stack with a noise transient on the front — and it is deliberately QUIET and
   * distant, because it is information, not a scare.
   */
  chime(hour = 0) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t = this._now(), { head } = this._out(0.15, 0.5);
    // A real bell's partials are not integer multiples; these ratios are roughly
    // those of a small cast bell, which is what stops it sounding like a synth.
    const f0 = 452;
    const parts = [[1.0, 0.55, 2.6], [2.02, 0.30, 1.9], [2.97, 0.18, 1.2],
                   [4.18, 0.10, 0.8], [5.42, 0.06, 0.55]];
    for (const [mult, amp, dur] of parts) {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(f0 * mult, t);
      // every partial drifts down a little as the bar cools: keeps it from ringing
      // mechanically flat
      o.frequency.linearRampToValueAtTime(f0 * mult * 0.994, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(amp * 0.10, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0004, t + dur);
      o.connect(g); g.connect(head); o.start(t); o.stop(t + dur + 0.05);
    }
    // the hammer itself: a click, without which the bell has no beginning
    const n = this._noiseSrc();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 3;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.05, t); ng.gain.exponentialRampToValueAtTime(0.0004, t + 0.05);
    n.connect(bp); bp.connect(ng); ng.connect(head); n.start(t); n.stop(t + 0.08);
  }

  accessSound(kind, step = 1, pan = 0, closing = false) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t = this._now(), { head } = this._out(pan, 0.12);
    const k = Math.min(2, Math.max(0, step - 1));
    if (kind === 'door') {
      // 1st: a short dry crack. 2nd: longer hinge groan. 3rd: full swing + thud.
      const dur = [0.45, 0.95, 1.35][k];
      const f0 = [120, 74, 58][k], f1 = [190, 148, 122][k];
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(closing ? f1 : f0, t);
      o.frequency.linearRampToValueAtTime(closing ? f0 : f1, t + dur * 0.85);
      const bq = ctx.createBiquadFilter(); bq.type = 'bandpass'; bq.frequency.value = 720 + k * 120; bq.Q.value = 8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2 + k * 0.05, t + 0.08);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 9 + k * 4;
      const lg = ctx.createGain(); lg.gain.value = 0.08; lfo.connect(lg); lg.connect(g.gain);
      o.connect(bq); bq.connect(g); g.connect(head);
      o.start(t); lfo.start(t); o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
      if (k === 2 || closing) {  // the leaf hitting its stop
        const th = ctx.createOscillator(); th.type = 'sine';
        const s2 = t + dur * 0.82;
        th.frequency.setValueAtTime(96, s2); th.frequency.exponentialRampToValueAtTime(40, s2 + 0.2);
        const tgn = ctx.createGain(); tgn.gain.setValueAtTime(0.5, s2); tgn.gain.exponentialRampToValueAtTime(0.001, s2 + 0.26);
        th.connect(tgn); tgn.connect(head); th.start(s2); th.stop(s2 + 0.3);
      }
      // A hinge groan alone is a cartoon door. What makes a heavy steel leaf read
      // as a heavy steel leaf is the SHEET: a big thin panel flexing as it swings,
      // and the latch furniture rattling in its keep.
      // 1. sheet flex: a low resonance that bends as the leaf moves
      const flex = ctx.createOscillator(); flex.type = 'sine';
      flex.frequency.setValueAtTime(closing ? 168 : 132, t + 0.04);
      flex.frequency.linearRampToValueAtTime(closing ? 132 : 176, t + dur * 0.7);
      const fq = ctx.createBiquadFilter(); fq.type = 'bandpass';
      fq.frequency.value = 320; fq.Q.value = 3.5;
      const fg = ctx.createGain();
      fg.gain.setValueAtTime(0.0001, t + 0.04);
      fg.gain.linearRampToValueAtTime(0.16 + k * 0.04, t + dur * 0.3);
      fg.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      flex.connect(fq); fq.connect(fg); fg.connect(head);
      flex.start(t + 0.04); flex.stop(t + dur + 0.05);
      // 2. latch and keep: a couple of dry metallic knocks, unevenly placed
      for (let i = 0; i < 2 + k; i++) {
        const st = t + 0.02 + Math.random() * dur * 0.55;
        const kn = this._noiseSrc();
        const kf = ctx.createBiquadFilter(); kf.type = 'bandpass';
        kf.frequency.value = 1700 + Math.random() * 1400; kf.Q.value = 11;
        const kg = ctx.createGain();
        kg.gain.setValueAtTime(0.0001, st);
        kg.gain.linearRampToValueAtTime(0.11 + Math.random() * 0.08, st + 0.003);
        kg.gain.exponentialRampToValueAtTime(0.0008, st + 0.05);
        kn.connect(kf); kf.connect(kg); kg.connect(head);
        kn.start(st); kn.stop(st + 0.09);
      }
    } else if (kind === 'window') {
      // GLASS. The window is not a mechanism, so it cannot use the stepped
      // hinge/thud language of the others: what you hear is a body working its
      // way over a broken frame. Three layers — fragments shifting, the metal
      // frame ringing, and cloth-on-grit friction — so this access is instantly
      // distinguishable from the door and the hatch with your eyes shut.
      const dur = 0.55 + k * 0.25;
      // 1. loose fragments: short bright grains, irregularly spaced
      for (let i = 0; i < 5 + k * 3; i++) {
        const st = t + Math.random() * dur * 0.8;
        const n2 = this._noiseSrc();
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3800 + Math.random() * 2600;
        const bp2 = ctx.createBiquadFilter(); bp2.type = 'bandpass';
        bp2.frequency.value = 5200 + Math.random() * 3200; bp2.Q.value = 14;
        const gg = ctx.createGain();
        gg.gain.setValueAtTime(0.0001, st);
        gg.gain.linearRampToValueAtTime(0.10 + Math.random() * 0.10, st + 0.004);
        gg.gain.exponentialRampToValueAtTime(0.0008, st + 0.05 + Math.random() * 0.07);
        n2.connect(hp); hp.connect(bp2); bp2.connect(gg); gg.connect(head);
        n2.start(st); n2.stop(st + 0.16);
      }
      // 2. the steel frame ringing as weight goes onto it
      const ring = ctx.createOscillator(); ring.type = 'triangle';
      ring.frequency.setValueAtTime(430 - k * 40, t);
      ring.frequency.exponentialRampToValueAtTime(300 - k * 30, t + dur);
      const rg = ctx.createGain();
      rg.gain.setValueAtTime(0.0001, t); rg.gain.linearRampToValueAtTime(0.075 + k * 0.02, t + 0.05);
      rg.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      const rq = ctx.createBiquadFilter(); rq.type = 'bandpass'; rq.frequency.value = 900; rq.Q.value = 5;
      ring.connect(rq); rq.connect(rg); rg.connect(head);
      ring.start(t); ring.stop(t + dur + 0.05);
      // 3. the drag: something heavy sliding over grit on the sill
      const dn = this._noiseSrc();
      const df = ctx.createBiquadFilter(); df.type = 'bandpass';
      df.frequency.setValueAtTime(700, t); df.frequency.linearRampToValueAtTime(1700, t + dur);
      df.Q.value = 1.6;
      const dg = ctx.createGain();
      dg.gain.setValueAtTime(0.0001, t); dg.gain.linearRampToValueAtTime(0.11 + k * 0.03, t + dur * 0.35);
      dg.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      dn.connect(df); df.connect(dg); dg.connect(head);
      dn.start(t); dn.stop(t + dur + 0.05);
    } else if (kind === 'vent') {
      // grille chattering in its frame, then the fixings letting go
      const n = this._noiseSrc();
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400 + k * 700; bp.Q.value = 6;
      const dur = [0.4, 0.7, 0.9][k];
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.2 + k * 0.06, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 26 - k * 6;
      const lg = ctx.createGain(); lg.gain.value = 0.14; lfo.connect(lg); lg.connect(g.gain);
      n.connect(bp); bp.connect(g); g.connect(head);
      n.start(t); lfo.start(t); n.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
      // A duct is a TUBE with a thin lid screwed onto it, and all three of those
      // things make noise: the fixings buzzing loose, the panel oil-canning, and
      // the shaft behind it resonating like a pipe. That last layer is the one
      // that tells you the sound came from inside the wall.
      // 1. screws chattering in their holes
      for (let i = 0; i < 3 + k * 2; i++) {
        const st = t + Math.random() * dur * 0.85;
        const sn = ctx.createOscillator(); sn.type = 'square';
        sn.frequency.setValueAtTime(3100 + Math.random() * 2400, st);
        const sf = ctx.createBiquadFilter(); sf.type = 'bandpass';
        sf.frequency.value = 4200; sf.Q.value = 18;
        const sg2 = ctx.createGain();
        sg2.gain.setValueAtTime(0.0001, st);
        sg2.gain.linearRampToValueAtTime(0.030 + Math.random() * 0.022, st + 0.004);
        sg2.gain.exponentialRampToValueAtTime(0.0006, st + 0.03 + Math.random() * 0.04);
        sn.connect(sf); sf.connect(sg2); sg2.connect(head);
        sn.start(st); sn.stop(st + 0.09);
      }
      // 2. the panel oil-canning: a bending low tone, the sound of thin sheet
      const oc = ctx.createOscillator(); oc.type = 'triangle';
      oc.frequency.setValueAtTime(210 + k * 26, t + 0.02);
      oc.frequency.linearRampToValueAtTime(148 + k * 18, t + dur * 0.8);
      const ocg = ctx.createGain();
      ocg.gain.setValueAtTime(0.0001, t + 0.02);
      ocg.gain.linearRampToValueAtTime(0.10 + k * 0.03, t + 0.09);
      ocg.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      oc.connect(ocg); ocg.connect(head);
      oc.start(t + 0.02); oc.stop(t + dur + 0.05);
      // 3. the shaft behind it: a narrow resonant band on filtered noise, which
      // is what makes it sound like it is coming from a metre inside the wall
      const rn = this._noiseSrc();
      const r1 = ctx.createBiquadFilter(); r1.type = 'bandpass'; r1.frequency.value = 300; r1.Q.value = 16;
      const r2 = ctx.createBiquadFilter(); r2.type = 'bandpass'; r2.frequency.value = 600; r2.Q.value = 14;
      const rg2 = ctx.createGain();
      rg2.gain.setValueAtTime(0.0001, t);
      rg2.gain.linearRampToValueAtTime(0.24 + k * 0.06, t + dur * 0.25);
      rg2.gain.exponentialRampToValueAtTime(0.0008, t + dur * 1.5);
      rn.connect(r1); r1.connect(rg2); rn.connect(r2); r2.connect(rg2);
      rg2.connect(head);
      rn.start(t); rn.stop(t + dur * 1.6);
    } else {   // hatch / grate
      // ---- MODAL, NOT A PITCH SWEEP -----------------------------------------
      // The old impact was a sine falling 120 -> 46 Hz, and a descending glide is
      // the single most cartoon-like gesture in sound design: nothing struck in the
      // real world changes pitch as it rings. A cast-iron grating dropped on
      // concrete is a noise burst exciting a handful of FIXED modes, each decaying
      // at its own rate — the low ones long, the high ones almost instantly. That
      // is what tells the ear how heavy something is, and it is the whole reason
      // this access never felt like a hundredweight of iron.
      const modes = [[62, 0.90, 1.15], [88, 0.62, 0.85], [143, 0.40, 0.42],
                     [227, 0.24, 0.24], [356, 0.14, 0.13], [611, 0.08, 0.07]];
      for (const [f, amp, dur] of modes) {
        const n0 = this._noiseSrc();
        const bq0 = ctx.createBiquadFilter(); bq0.type = 'bandpass';
        bq0.frequency.value = f;
        // Q rises with frequency so the low modes are broad and thuddy while the
        // high ones ring: a uniform Q makes every mode sound like the same bell.
        bq0.Q.value = 6 + f / 55;
        const g0 = ctx.createGain();
        g0.gain.setValueAtTime(0.0001, t);
        g0.gain.linearRampToValueAtTime(amp * (0.30 + k * 0.10), t + 0.003);
        g0.gain.exponentialRampToValueAtTime(0.0004, t + dur);
        n0.connect(bq0); bq0.connect(g0); g0.connect(head);
        n0.start(t); n0.stop(t + dur + 0.05);
      }
      // and the weight underneath it: a sub you feel rather than hear, with no
      // pitch movement at all
      const sub0 = ctx.createOscillator(); sub0.type = 'sine';
      sub0.frequency.value = 41;
      const sg0 = ctx.createGain();
      sg0.gain.setValueAtTime(0.0001, t);
      sg0.gain.linearRampToValueAtTime(0.55, t + 0.006);
      sg0.gain.exponentialRampToValueAtTime(0.0004, t + 0.55);
      sub0.connect(sg0); sg0.connect(head); sub0.start(t); sub0.stop(t + 0.6);
      // the hinge taking the load: a slow groan, amplitude-wobbled rather than
      // pitch-wobbled, which is how a stiff pin under weight actually behaves
      const hg = ctx.createOscillator(); hg.type = 'sawtooth';
      hg.frequency.value = 74 - k * 6;
      const hf = ctx.createBiquadFilter(); hf.type = 'bandpass'; hf.frequency.value = 420; hf.Q.value = 7;
      const hgn = ctx.createGain();
      hgn.gain.setValueAtTime(0.0001, t + 0.02);
      hgn.gain.linearRampToValueAtTime(0.16 + k * 0.05, t + 0.14);
      hgn.gain.exponentialRampToValueAtTime(0.0004, t + 0.9 + k * 0.25);
      const wob = ctx.createOscillator(); wob.type = 'triangle'; wob.frequency.value = 11 - k * 2;
      const wg = ctx.createGain(); wg.gain.value = 0.09; wob.connect(wg); wg.connect(hgn.gain);
      hg.connect(hf); hf.connect(hgn); hgn.connect(head);
      hg.start(t + 0.02); wob.start(t + 0.02);
      hg.stop(t + 1.2 + k * 0.3); wob.stop(t + 1.2 + k * 0.3);
      if (k > 0 || closing) {
        const n = this._noiseSrc();
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1700; bp.Q.value = 2.2;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.0001, t + 0.05); ng.gain.linearRampToValueAtTime(0.16, t + 0.12);
        ng.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
        n.connect(bp); bp.connect(ng); ng.connect(head); n.start(t + 0.05); n.stop(t + 0.85);
      }
      // The pit is the heaviest access in the room and it needs the mass to match:
      // a lift chain paying out, the ladder ringing as weight goes on it, and the
      // grating itself buzzing in its frame afterwards. Three layers, all much
      // lower and slower than the window's glass, so the two can never be
      // confused with your eyes shut.
      // 1. chain: a scatter of dull metallic links, close together
      for (let i = 0; i < 6 + k * 4; i++) {
        const st = t + 0.03 + Math.random() * (0.30 + k * 0.22);
        const cn = this._noiseSrc();
        const cf = ctx.createBiquadFilter(); cf.type = 'bandpass';
        cf.frequency.value = 900 + Math.random() * 1100; cf.Q.value = 9;
        const cg = ctx.createGain();
        cg.gain.setValueAtTime(0.0001, st);
        cg.gain.linearRampToValueAtTime(0.055 + Math.random() * 0.05, st + 0.004);
        cg.gain.exponentialRampToValueAtTime(0.0006, st + 0.04 + Math.random() * 0.05);
        cn.connect(cf); cf.connect(cg); cg.connect(head);
        cn.start(st); cn.stop(st + 0.11);
      }
      // 2. the ladder: a long, low ring as something puts its weight on a rung
      const lad = ctx.createOscillator(); lad.type = 'triangle';
      const ls = t + 0.10;
      lad.frequency.setValueAtTime(232, ls);
      lad.frequency.exponentialRampToValueAtTime(198, ls + 0.9);
      const lq = ctx.createBiquadFilter(); lq.type = 'bandpass'; lq.frequency.value = 460; lq.Q.value = 12;
      const lgn = ctx.createGain();
      lgn.gain.setValueAtTime(0.0001, ls);
      lgn.gain.linearRampToValueAtTime(0.13 + k * 0.03, ls + 0.03);
      lgn.gain.exponentialRampToValueAtTime(0.0006, ls + 1.0);
      lad.connect(lq); lq.connect(lgn); lgn.connect(head);
      lad.start(ls); lad.stop(ls + 1.05);
      // 3. the grating left buzzing in its frame once it has been moved
      const bz = ctx.createOscillator(); bz.type = 'square';
      bz.frequency.value = 58 + k * 7;
      const bzf = ctx.createBiquadFilter(); bzf.type = 'bandpass'; bzf.frequency.value = 700; bzf.Q.value = 6;
      const bzg = ctx.createGain();
      const bs = t + 0.16;
      bzg.gain.setValueAtTime(0.0001, bs);
      bzg.gain.linearRampToValueAtTime(0.075, bs + 0.05);
      bzg.gain.exponentialRampToValueAtTime(0.0006, bs + 0.55);
      bz.connect(bzf); bzf.connect(bzg); bzg.connect(head);
      bz.start(bs); bz.stop(bs + 0.6);
    }
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
