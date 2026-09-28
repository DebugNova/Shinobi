// Procedural audio (Web Audio): every sound is synthesised, so there is nothing to download or license.
// Spatialised with panners that follow the camera. Footsteps by surface, whooshes by attack weight, layered impacts
// (a low thump, a crack, a boom for heavy hits; a metallic clank when blocked), dash, substitution poof, the chakra
// charge hum and the Rasengan whirr (loops), the ultimate's roar and burst, UI clicks, and ambience by zone (forest
// birds and wind, the village's murmur, the river). A light battle loop plays when the music volume is up.
import { SURF } from '../shared/config.js';
import { riverDist } from '../shared/map.js';

export class Audio {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.musicVol = 0;
    this.loops = new Map();
    this.lastStep = 0;
  }

  /** Needs a user gesture (the JOIN click). */
  start() {
    if (this.ctx) {
      this.ctx.resume?.();
      return;
    }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      return;
    }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(c.destination);
    // a gentle compressor keeps the big hits from clipping
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 4;
    this.comp.connect(this.master);
    this.sfx = c.createGain();
    this.sfx.connect(this.comp);
    this.amb = c.createGain();
    this.amb.gain.value = 0.5;
    this.amb.connect(this.master);
    this.music = c.createGain();
    this.music.gain.value = this.musicVol;
    this.music.connect(this.master);
    // noise buffers
    const n = c.sampleRate * 2;
    this.white = c.createBuffer(1, n, c.sampleRate);
    const d = this.white.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.pink = c.createBuffer(1, n, c.sampleRate);
    const p = this.pink.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + w * 0.029591;
      b1 = 0.985 * b1 + w * 0.032534;
      b2 = 0.95 * b2 + w * 0.048056;
      p[i] = (b0 + b1 + b2 + w * 0.1848) * 0.35;
    }
    this.startAmbience();
    this.startMusic();
  }

  setVolume(v, music) {
    this.volume = v ?? this.volume;
    if (music !== undefined) this.musicVol = music;
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
    this.music.gain.setTargetAtTime(this.musicVol * 0.5, this.ctx.currentTime, 0.2);
  }

  /** Listener at the camera. */
  listen(camera) {
    if (!this.ctx) return;
    const L = this.ctx.listener, p = camera.position;
    const f = (this._f ||= { x: 0, y: 0, z: -1 });
    const e = camera.matrixWorld.elements;
    f.x = -e[8];
    f.y = -e[9];
    f.z = -e[10];
    if (L.positionX) {
      const t = this.ctx.currentTime;
      L.positionX.setValueAtTime(p.x, t);
      L.positionY.setValueAtTime(p.y, t);
      L.positionZ.setValueAtTime(p.z, t);
      L.forwardX.setValueAtTime(f.x, t);
      L.forwardY.setValueAtTime(f.y, t);
      L.forwardZ.setValueAtTime(f.z, t);
      L.upX.setValueAtTime(e[4], t);
      L.upY.setValueAtTime(e[5], t);
      L.upZ.setValueAtTime(e[6], t);
    } else {
      L.setPosition(p.x, p.y, p.z);
      L.setOrientation(f.x, f.y, f.z, e[4], e[5], e[6]);
    }
    this.listenerPos = p;
  }

  /** An output node at a world position (or straight to the mix). */
  out(pos, gain = 1) {
    const c = this.ctx;
    const g = c.createGain();
    g.gain.value = gain;
    if (pos) {
      const pn = c.createPanner();
      pn.panningModel = 'equalpower';
      pn.distanceModel = 'inverse';
      pn.refDistance = 3;
      pn.rolloffFactor = 1.1;
      pn.maxDistance = 80;
      if (pn.positionX) {
        pn.positionX.value = pos.x;
        pn.positionY.value = pos.y ?? 0;
        pn.positionZ.value = pos.z;
      } else pn.setPosition(pos.x, pos.y ?? 0, pos.z);
      g.connect(pn);
      pn.connect(this.sfx);
    } else g.connect(this.sfx);
    return g;
  }

  noise(dest, t, dur, { type = 'bandpass', f0 = 1000, f1 = f0, q = 1, gain = 1, pink = false, attack = 0.003 } = {}) {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = pink ? this.pink : this.white;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  tone(dest, t, dur, { type = 'sine', f0 = 200, f1 = f0, gain = 1, attack = 0.003 } = {}) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  ok() {
    return this.ctx && this.ctx.state === 'running';
  }

  // ---------------------------------------------------------------- sounds

  footstep(pos, surf, run = 1) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime, o = this.out(pos, 0.5 + run * 0.25);
    switch (surf) {
      case SURF.grass:
        this.noise(o, t, 0.09, { f0: 2400, f1: 1500, q: 0.8, gain: 0.35 });
        break;
      case SURF.water:
        this.noise(o, t, 0.16, { f0: 1400, f1: 500, q: 1.5, gain: 0.5 });
        this.tone(o, t + 0.02, 0.08, { f0: 600, f1: 1100, gain: 0.08 });
        break;
      case SURF.wood:
        this.tone(o, t, 0.08, { f0: 180, f1: 90, gain: 0.4 });
        this.noise(o, t, 0.04, { type: 'highpass', f0: 2500, gain: 0.15 });
        break;
      case SURF.stone:
      case SURF.rock:
      case SURF.roof:
        this.noise(o, t, 0.05, { type: 'highpass', f0: 1800, gain: 0.3 });
        this.tone(o, t, 0.05, { f0: 140, f1: 80, gain: 0.2 });
        break;
      case SURF.bark:
      case SURF.plaster:
        this.noise(o, t, 0.05, { f0: 900, f1: 600, q: 2, gain: 0.3 });
        break;
      default:
        this.noise(o, t, 0.08, { type: 'lowpass', f0: 900, f1: 400, gain: 0.45 });
    }
  }

  /** An attack's swish (weight 1 = jab, 4 = axe kick). */
  whoosh(weight = 1, pos = null) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime, o = this.out(pos, 0.6);
    this.noise(o, t, 0.12 + weight * 0.04, { f0: 600 + weight * 150, f1: 2600, q: 1.8, gain: 0.35 + weight * 0.08, attack: 0.02 });
  }

  impact(pos, weight = 1, blocked = false) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime, o = this.out(pos, 1);
    weight = Math.max(0.3, weight || 0); // (a light tick's weight came out 0: the thump's pitch went infinite)
    if (blocked) {
      for (const f of [820, 1370, 2150, 2890]) this.tone(o, t, 0.25, { type: 'triangle', f0: f, f1: f * 0.98, gain: 0.12 });
      this.noise(o, t, 0.06, { type: 'highpass', f0: 3000, gain: 0.3 });
      return;
    }
    // thump + crack (+ boom for the heavy ones)
    this.tone(o, t, 0.16 + weight * 0.04, { f0: 110 + 20 / weight, f1: 45, gain: 0.7 });
    this.noise(o, t, 0.07, { type: 'highpass', f0: 1500, gain: 0.45 + weight * 0.05 });
    this.noise(o, t, 0.12, { f0: 700, f1: 300, q: 0.8, gain: 0.4 });
    if (weight >= 3) {
      this.noise(o, t, 0.5, { type: 'lowpass', f0: 500, f1: 60, gain: 0.7, pink: true });
      this.tone(o, t, 0.4, { f0: 70, f1: 30, gain: 0.6 });
    }
  }

  dash(pos) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime, o = this.out(pos, 0.6);
    this.noise(o, t, 0.22, { f0: 400, f1: 3000, q: 1.2, gain: 0.45, attack: 0.03 });
  }

  jump(pos) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime, o = this.out(pos, 0.4);
    this.noise(o, t, 0.1, { type: 'lowpass', f0: 1200, f1: 500, gain: 0.3 });
  }

  land(pos, v) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime, o = this.out(pos, Math.min(1, v / 14));
    this.tone(o, t, 0.12, { f0: 120, f1: 50, gain: 0.5 });
    this.noise(o, t, 0.12, { type: 'lowpass', f0: 800, f1: 200, gain: 0.4 });
  }

  poof(pos = null) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime, o = this.out(pos, 0.8);
    this.noise(o, t, 0.35, { type: 'lowpass', f0: 2400, f1: 200, gain: 0.6, pink: true, attack: 0.01 });
    this.tone(o, t, 0.06, { f0: 500, f1: 900, gain: 0.15 });
  }

  throw(pos = null) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime, o = this.out(pos, 0.5);
    this.noise(o, t, 0.18, { f0: 2500, f1: 5000, q: 3, gain: 0.3 });
    this.tone(o, t, 0.2, { type: 'triangle', f0: 3200, f1: 2600, gain: 0.05 });
  }

  handsign(pos = null) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime, o = this.out(pos, 0.6);
    this.noise(o, t, 0.05, { type: 'highpass', f0: 2000, gain: 0.3 });
    this.noise(o, t + 0.12, 0.05, { type: 'highpass', f0: 2200, gain: 0.3 });
  }

  rasengan(pos = null) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime, o = this.out(pos, 0.9);
    // a whirring build-up
    this.noise(o, t, 1.1, { f0: 500, f1: 2800, q: 5, gain: 0.35, attack: 0.3 });
    this.tone(o, t, 1.1, { type: 'sawtooth', f0: 160, f1: 420, gain: 0.06, attack: 0.3 });
  }

  ult(pos = null) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime, o = this.out(pos, 1);
    this.noise(o, t, 1.4, { f0: 300, f1: 3500, q: 4, gain: 0.45, attack: 0.5 });
    this.tone(o, t, 1.4, { type: 'sawtooth', f0: 90, f1: 260, gain: 0.08, attack: 0.5 });
  }

  boom(pos) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime, o = this.out(pos, 1.3);
    this.noise(o, t, 1.2, { type: 'lowpass', f0: 1200, f1: 50, gain: 1, pink: true, attack: 0.005 });
    this.tone(o, t, 0.9, { f0: 60, f1: 25, gain: 0.9 });
    this.noise(o, t, 1.4, { f0: 1500, f1: 400, q: 3, gain: 0.3 });
  }

  // ---- Madara's kit

  /** The sharp breath in before the fire. */
  inhale(pos = null) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime, o = this.out(pos, 0.7);
    this.noise(o, t, 0.28, { f0: 900, f1: 2600, q: 1.2, gain: 0.35, attack: 0.18 });
  }

  /** Great Fire Annihilation: a roaring torrent (a low swell, a bright rush, crackles) for ~1.4 s. */
  fireRoar(pos = null) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime, o = this.out(pos, 1.25);
    this.noise(o, t, 1.5, { type: 'lowpass', f0: 500, f1: 1900, gain: 0.9, pink: true, attack: 0.06 });
    this.noise(o, t + 0.05, 1.2, { f0: 1400, f1: 700, q: 0.8, gain: 0.35, attack: 0.1 });
    this.tone(o, t, 1.3, { type: 'sawtooth', f0: 70, f1: 48, gain: 0.07, attack: 0.1 });
    this.tone(o, t, 0.9, { f0: 55, f1: 35, gain: 0.5, attack: 0.04 });
    for (let k = 0; k < 14; k++) this.noise(o, t + 0.1 + Math.random() * 1.4, 0.03, { type: 'highpass', f0: 2500 + Math.random() * 2500, gain: 0.25 + Math.random() * 0.2 });
  }

  /** Wood Release: the palm slams the ground (a thump, earth cracking open, a low rumble running off). */
  woodSlam(pos = null) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime, o = this.out(pos, 1.2);
    this.tone(o, t, 0.35, { f0: 90, f1: 35, gain: 0.9 });
    this.noise(o, t, 0.08, { type: 'highpass', f0: 1800, gain: 0.5 });
    this.noise(o, t, 0.9, { type: 'lowpass', f0: 380, f1: 70, gain: 0.8, pink: true, attack: 0.02 });
    this.noise(o, t + 0.05, 0.6, { f0: 700, f1: 250, q: 1.5, gain: 0.3, attack: 0.05 });
  }

  /** A stake splitting out of the ground: a woody crack and splinters. */
  woodCrack(pos = null) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime, o = this.out(pos, 0.9);
    this.noise(o, t, 0.05, { f0: 1100, f1: 600, q: 4, gain: 0.55 });
    this.tone(o, t, 0.09, { type: 'triangle', f0: 240 + Math.random() * 80, f1: 120, gain: 0.25 });
    for (let k = 0; k < 3; k++) this.noise(o, t + 0.02 + Math.random() * 0.12, 0.02, { type: 'highpass', f0: 3000 + Math.random() * 2000, gain: 0.2 });
  }

  /** Uchiha Return: the gunbai raised (a heavy cloth swish, a wooden knock). */
  gunbaiUp(pos = null) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime, o = this.out(pos, 0.7);
    this.noise(o, t, 0.16, { f0: 500, f1: 1600, q: 1.4, gain: 0.35, attack: 0.02 });
    this.tone(o, t + 0.06, 0.08, { type: 'triangle', f0: 380, f1: 300, gain: 0.25 });
  }

  /** The gunbai torn off his back: a leather creak, a heavy swish rising over the shoulder. */
  gunbaiDraw(pos = null) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime, o = this.out(pos, 0.8);
    this.noise(o, t, 0.06, { f0: 900, f1: 500, q: 3, gain: 0.3 });
    this.noise(o, t + 0.03, 0.22, { f0: 300, f1: 1400, q: 1.1, gain: 0.45, attack: 0.05 });
  }

  /** The gust bursts out of the spin: a deep thump of air and a roar of wind racing away. */
  gunbaiGust(pos = null) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime, o = this.out(pos, 1.3);
    this.tone(o, t, 0.25, { f0: 110, f1: 45, gain: 0.7 });
    this.noise(o, t, 0.7, { type: 'lowpass', f0: 1800, f1: 250, gain: 0.9, pink: true, attack: 0.01 });
    this.noise(o, t + 0.02, 0.5, { f0: 2400, f1: 700, q: 0.8, gain: 0.35, attack: 0.02 });
  }

  /** The wind barrier holding: a swirling roar that sweeps round (call every frame with on; it fades). */
  gunbaiWind(key, on, pos) {
    this.loop(key, on, pos, () => {
      const c = this.ctx;
      const g = c.createGain();
      g.gain.value = 0;
      const pan = c.createPanner();
      pan.refDistance = 3;
      g.connect(pan).connect(this.sfx);
      const s = c.createBufferSource();
      s.buffer = this.pink;
      s.loop = true;
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 650;
      bp.Q.value = 1.2;
      // the whirl: the band sweeps up and down a few times a second
      const lfo = c.createOscillator();
      lfo.frequency.value = 2.6;
      const lg = c.createGain();
      lg.gain.value = 380;
      lfo.connect(lg).connect(bp.frequency);
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 260;
      s.connect(bp).connect(g);
      s.connect(lp).connect(g);
      s.start();
      lfo.start();
      return { gain: g, pan, level: 0.5, stop: () => [s, lfo].forEach((n) => n.stop()) };
    });
  }

  /** The barrier answers a hit: a ringing clang off the wind; a blow adds a gust, a deflection a deep boom. */
  gunbaiClang(pos = null, kind = 1) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime, o = this.out(pos, 1.2);
    for (const f of [640, 1010, 1580, 2330]) this.tone(o, t, 0.45, { type: 'triangle', f0: f, f1: f * 0.985, gain: 0.13 });
    this.noise(o, t, 0.05, { type: 'highpass', f0: 2600, gain: 0.45 });
    if (kind === 1) this.noise(o, t + 0.02, 0.4, { f0: 300, f1: 1800, q: 0.9, gain: 0.6, attack: 0.03 });
    if (kind === 3) {
      this.tone(o, t, 0.5, { f0: 80, f1: 34, gain: 0.7 });
      this.noise(o, t, 0.6, { type: 'lowpass', f0: 700, f1: 90, gain: 0.6, pink: true });
    }
  }

  /** Tengai Shinsei falling: a roar rising over the `dur` s of its fall, a whistle on top (it ends at the impact). */
  meteorFall(pos = null, dur = 1.8) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime, o = this.out(pos, 1.4);
    this.noise(o, t, dur, { type: 'lowpass', f0: 120, f1: 900, gain: 0.8, pink: true, attack: dur * 0.8 });
    this.noise(o, t + dur * 0.4, dur * 0.6, { f0: 700, f1: 2600, q: 5, gain: 0.25, attack: dur * 0.5 });
    this.tone(o, t, dur, { type: 'sawtooth', f0: 38, f1: 62, gain: 0.12, attack: dur * 0.83 });
  }

  /** Tengai Shinsei lands: the heaviest boom in the game (a crack, a blast, a long rumble). */
  meteorImpact(pos = null) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime, o = this.out(pos, 2.2);
    this.noise(o, t, 0.12, { type: 'highpass', f0: 1200, gain: 0.9 });
    this.tone(o, t, 0.9, { f0: 70, f1: 22, gain: 1 });
    this.noise(o, t, 2.6, { type: 'lowpass', f0: 900, f1: 40, gain: 1, pink: true, attack: 0.01 });
    this.noise(o, t + 0.1, 1.5, { f0: 500, f1: 150, q: 0.7, gain: 0.5 });
    for (let k = 0; k < 10; k++) this.noise(o, t + 0.3 + Math.random() * 1.6, 0.05, { f0: 300 + Math.random() * 500, q: 2, gain: 0.3 });
  }

  /** A burst of crackles (the burning field, a wall splash). */
  crackle(pos = null, n = 4, gain = 0.2) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime, o = this.out(pos, 0.8);
    for (let k = 0; k < n; k++) this.noise(o, t + Math.random() * 0.45, 0.025, { type: 'highpass', f0: 2200 + Math.random() * 3000, gain: gain * (0.6 + Math.random() * 0.6) });
    this.noise(o, t, 0.5, { type: 'lowpass', f0: 600, f1: 300, gain: gain * 0.8, pink: true, attack: 0.1 });
  }

  click() {
    if (!this.ok()) return;
    const t = this.ctx.currentTime, o = this.out(null, 0.4);
    this.tone(o, t, 0.05, { type: 'triangle', f0: 1400, f1: 900, gain: 0.3 });
  }

  /** A looping sound while something lasts (the charge hum): call every frame with on, it fades. */
  loop(key, on, pos, make) {
    if (!this.ok()) return;
    let L = this.loops.get(key);
    if (on && !L) {
      L = make();
      this.loops.set(key, L);
    }
    if (!L) return;
    const t = this.ctx.currentTime;
    L.gain.gain.setTargetAtTime(on ? L.level : 0, t, on ? 0.08 : 0.15);
    if (L.pan && pos) {
      if (L.pan.positionX) {
        L.pan.positionX.setValueAtTime(pos.x, t);
        L.pan.positionY.setValueAtTime(pos.y, t);
        L.pan.positionZ.setValueAtTime(pos.z, t);
      }
    }
    if (!on) {
      L.off = (L.off || 0) + 1;
      if (L.off > 90) {
        L.stop();
        this.loops.delete(key);
      }
    } else L.off = 0;
  }

  chargeHum(key, on, pos) {
    this.loop(key, on, pos, () => {
      const c = this.ctx;
      const g = c.createGain();
      g.gain.value = 0;
      const pan = c.createPanner();
      pan.refDistance = 3;
      g.connect(pan).connect(this.sfx);
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 98;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 500;
      const s = c.createBufferSource();
      s.buffer = this.pink;
      s.loop = true;
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900;
      bp.Q.value = 0.8;
      const lfo = c.createOscillator();
      lfo.frequency.value = 7;
      const lg = c.createGain();
      lg.gain.value = 0.3;
      lfo.connect(lg).connect(g.gain);
      o.connect(lp).connect(g);
      s.connect(bp).connect(g);
      o.start();
      s.start();
      lfo.start();
      return { gain: g, pan, level: 0.25, stop: () => [o, s, lfo].forEach((n) => n.stop()) };
    });
  }

  // ---------------------------------------------------------------- ambience + music

  startAmbience() {
    const c = this.ctx;
    const bed = (buf, type, f, q, gain) => {
      const s = c.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      const fl = c.createBiquadFilter();
      fl.type = type;
      fl.frequency.value = f;
      fl.Q.value = q;
      const g = c.createGain();
      g.gain.value = gain;
      s.connect(fl).connect(g).connect(this.amb);
      s.start(0, Math.random() * 2);
      return g;
    };
    this.wind = bed(this.pink, 'lowpass', 500, 0.5, 0.18);
    this.river = bed(this.white, 'bandpass', 700, 0.6, 0);
    this.murmur = bed(this.pink, 'bandpass', 380, 1.2, 0);
    this.birdT = 0;
  }

  startMusic() {
    // a light taiko + flute loop, 96 bpm, generated a bar ahead
    this.beat = 0;
    this.nextBar = this.ctx.currentTime + 0.5;
  }

  scheduleMusic() {
    const c = this.ctx;
    if (this.musicVol <= 0.001) {
      this.nextBar = c.currentTime + 0.5;
      return;
    }
    while (this.nextBar < c.currentTime + 1.2) {
      const t0 = this.nextBar, spb = 60 / 96;
      const drum = (t, f, g) => this.tone(this.music, t, 0.35, { f0: f, f1: f * 0.5, gain: g });
      const hit = (t) => this.noise(this.music, t, 0.05, { type: 'highpass', f0: 3000, gain: 0.08 });
      for (let b = 0; b < 4; b++) {
        drum(t0 + b * spb, b % 2 ? 90 : 70, b === 0 ? 0.5 : 0.3);
        hit(t0 + (b + 0.5) * spb);
      }
      if (this.beat % 2 === 0) drum(t0 + 3.5 * spb, 110, 0.25);
      // flute: pentatonic phrase
      const scale = [293.7, 329.6, 392, 440, 523.3, 587.3];
      for (let k = 0; k < 4; k++) {
        if (Math.random() < 0.35) continue;
        const f = scale[Math.floor(Math.random() * scale.length)];
        this.tone(this.music, t0 + k * spb, spb * 1.4, { type: 'triangle', f0: f, f1: f * 1.005, gain: 0.07, attack: 0.08 });
      }
      this.nextBar += spb * 4;
      this.beat++;
    }
  }

  /** Per frame: listener, zone ambience (forest west, village east, the river), birds, music. */
  update(dt, camera, pos) {
    if (!this.ok()) return;
    this.listen(camera);
    const t = this.ctx.currentTime;
    if (pos) {
      const forest = Math.max(0, Math.min(1, (-pos.x - 5) / 20));
      const village = Math.max(0, Math.min(1, (pos.x - 15) / 12));
      const r = riverDist(pos.x, pos.z).d;
      this.river.gain.setTargetAtTime(Math.max(0, 1 - r / 25) * 0.35 + (Math.hypot(pos.x + 4, pos.z + 46) < 20 ? 0.25 : 0), t, 0.5);
      this.murmur.gain.setTargetAtTime(village * 0.12, t, 0.5);
      this.wind.gain.setTargetAtTime(0.1 + forest * 0.08 + Math.max(0, pos.y - 6) * 0.02, t, 0.5);
      // birds in the forest
      this.birdT -= dt;
      if (this.birdT <= 0) {
        this.birdT = 0.6 + Math.random() * 2.5;
        if (Math.random() < 0.3 + forest * 0.6) {
          const f = 2200 + Math.random() * 1800, o = this.amb;
          for (let k = 0; k < 2 + Math.floor(Math.random() * 3); k++) this.tone(o, t + k * 0.11, 0.08, { f0: f, f1: f * (1.2 + Math.random() * 0.3), gain: 0.03 });
        }
      }
    }
    this.scheduleMusic();
  }
}
