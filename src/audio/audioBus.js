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
    this.master = ctx.createGain(); this.master.gain.value = CONFIG.audio.masterGain;
    this.duck = ctx.createGain(); this.duck.gain.value = 1;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 22; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.25;
    this.master.connect(this.duck); this.duck.connect(comp); comp.connect(ctx.destination);

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
    const ctx = this.ctx, t = this._now();
    this.duck.gain.cancelScheduledValues(t);
    this.duck.gain.setValueAtTime(CONFIG.audio.duckOnScare, t);
    this.duck.gain.setTargetAtTime(1, t + 1.4, 0.8);
    const V = {
      shriek: { base: [520, 528, 790], drive: 3.5, sub: [150, 44], noise: 0.5, dur: 1.1 },
      gurgle: { base: [90, 96, 140], drive: 6.0, sub: [120, 30], noise: 0.8, dur: 1.3 },
      whisperscream: { base: [340, 351, 610], drive: 2.6, sub: [110, 40], noise: 1.0, dur: 1.2 },
      roar: { base: [150, 158, 232, 300], drive: 5.5, sub: [140, 34], noise: 0.7, dur: 1.35 },
    }[variant] || { base: [180, 184, 271], drive: 3.5, sub: [130, 38], noise: 0.6, dur: 1.2 };

    const shaper = ctx.createWaveShaper(); const cur = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; cur[i] = Math.tanh(x * V.drive); }
    shaper.curve = cur; const sg = ctx.createGain(); sg.gain.value = 1.4; shaper.connect(sg); sg.connect(this.master);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1.0, t + 0.02); g.gain.setValueAtTime(1.0, t + V.dur * 0.55); g.gain.exponentialRampToValueAtTime(0.001, t + V.dur); g.connect(shaper);
    V.base.forEach((f) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f * 1.5, t); o.frequency.exponentialRampToValueAtTime(f * 0.55, t + V.dur * 0.9); o.connect(g); o.start(t); o.stop(t + V.dur); });
    const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.setValueAtTime(V.sub[0], t); sub.frequency.exponentialRampToValueAtTime(V.sub[1], t + V.dur * 0.8); const subg = ctx.createGain(); subg.gain.value = 0.9; sub.connect(subg); subg.connect(this.master); sub.start(t); sub.stop(t + V.dur);
    const n = this._noiseSrc(); const bp = ctx.createBiquadFilter(); bp.type = variant === 'gurgle' ? 'lowpass' : 'highpass'; bp.frequency.value = variant === 'gurgle' ? 800 : 1500;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(V.noise, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.55); n.connect(bp); bp.connect(ng); ng.connect(this.master); n.start(t); n.stop(t + 0.6);
  }

  // Rising electric tone when a battery cell tops up the flashlight.
  charge(pan = 0) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t = this._now(), { head } = this._out(pan, 0);
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(320, t); o.frequency.exponentialRampToValueAtTime(1050, t + 0.5);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.28, t + 0.05); g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    o.connect(g); g.connect(head); o.start(t); o.stop(t + 0.6);
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
