// Amaterasu's cinematic (Itachi's R), on EVERY screen at the same moment: the timeline runs on the server clock from
// the press (`at`, relayed to everyone with the cast's first phase), so whoever hears of it late just joins it where it
// is (its first half second is in the arena, where a late start shows nothing missing). While it plays the whole arena
// holds still (no input on any screen, no hit lands anywhere: the server keeps the same window, server/index.js).
//   in the arena      the fingers to the eye, the view darkening round him
//   the negative world (a flash) light and dark swap onto cold teal, the camera low in front of him; the arms fling
//                     wide, a flock of crows bursts off his back, feathers drift past the lens; the camera pushes in,
//                     then rushes into his face
//   the eyes          (a flash) his eyes painted over the whole view (amaterasufx.js): shut, a flutter, opening wide
//                     (snapping wider for a moment as the Mangekyō takes); the Sharingan spins up into the Mangekyō;
//                     veins crawl in, blood wells and runs down from the right
//                     eye; black flames lick up the bottom edge; the camera drives into the right pupil and black
//                     flames burst out of it over everything
//   the flames        under the black the arena comes back in colour, the camera on a victim; at `focus` (server
//                     clock, the same instant everywhere) the flames latch onto everyone the gaze took (the server told
//                     every screen who at the pick); the black burns away onto them; the game camera eases back.
// Visual and local, except the timing and who burns (the server's). Audio: the voice line (the owner's recording, on
// the same clock: "Amaterasu" as the eyes open fully, voiceStep), and hooks for the rest (audio.amaterasuCine?.(phase)).
import * as THREE from 'three';
import { charOf } from '../shared/characters.js';
import { AMA_LAYOUT } from '../gfx/amaterasufx.js';

const F = 1 / 60;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ss = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, k) => a + (b - a) * k;
const QUALITY = { low: 0.4, medium: 0.7, high: 1, ultra: 1.3 };

/** The timeline: seconds after the press on the server clock (focus and the end come from the data: itachi.js). */
export const AMA = {
  gather: [0.05, 0.46], // in the arena: the view darkens and drains round him
  hud: 0.35, // the HUD fades away (back at the end)
  bars: [0.3, 0.62], // the letterbox comes in
  cut: 0.5, // a flash: the negative world, the cinema camera
  crows: [0.52, 1.3], // the flock bursts off his back
  push: [0.5, 2.05], // low in front of him, pushing in slowly
  rush: [2.05, 2.5], // rushing into his face
  eye: 2.47, // the painted close-up (a red flash)
  flutter: [2.74, 2.92], // the lids crack open and fall back
  lids: [3.0, 3.58], // they open
  morph: [3.3, 3.64], // the Sharingan turns into the Mangekyō
  veins: [3.36, 3.96],
  blood: [3.46, 4.3], // the first stream (the second from 3.72)
  edge: [3.68, 4.16], // black flames up the bottom edge
  focus: [3.9, 4.2], // the camera drives into the right pupil
  burst: [4.13, 4.3], // black flames out of it fill the view
  back: 4.3, // under the black: the arena in colour, the camera on a victim
  burn: [4.42, 4.9], // the black burns away onto them (the flames at the data's `focus`, 4.37)
  ret: 0, // s the game camera takes to ease back (0: a cut at the end, the data's cinema[1]: gliding home from the victim passed through its head)
  barsOut: 0.3, // s for the letterbox to go
  // the voice line (audio.js FILES.amaterasu) starts here, at the press: its drone under the fingers and the negative
  // world, "Amaterasu" from 1.46 (the owner's ear: the negative world, the
  // push in), its stressed "TE" just before the rush into his face (1.94); the burning in it fades
  // out over ~7 s after the cinematic
  voice: 0,
  voiceLate: 3.0, // (a screen that hears of the cast later than this after the line's start skips it: the word begun)
};
// (the picture reaches the screen about a frame after it is drawn: the voice is scheduled that much later)
const SHOW_LAG = 0.01;

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion();
// (a frozen screen's input: nothing held, nothing pressed; the presses made meanwhile stay buffered in the real one)
export const FROZEN_INPUT = {
  take: () => false, peek: () => false, held: () => false, heldFor: () => 0, pressedAt: () => -1,
  move: (o) => { o.x = 0; o.y = 0; return o; },
};

export class AmaterasuCinema {
  constructor(K) {
    this.K = K;
    this.game = K.game;
    this.S = null; // the cinematic running on this screen: see start()
    this.cam = false; // the camera is ours this frame (late())
    this.focus = new THREE.Vector3(); // what the toon shader keeps clear of occluders (main.js)
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
  }

  get active() {
    return !!this.S;
  }

  /** Its clock: seconds since the press (server clock). */
  time(now = this.game.net.serverNow()) {
    if (this.S && this.hold !== undefined && this.hold !== null) return this.hold;
    return this.S ? (now - this.S.at) / 1000 : -1;
  }

  /** Is the arena held still at server time `now` (ms)? (main.js: no input; combat.js: no hit is sent) */
  frozen(now) {
    const S = this.S;
    return !!S && now >= S.from && now <= S.to;
  }

  /** A cast's first phase (ours at the press, a remote's relayed n:0): the cinematic starts on its clock. */
  start(id, inst, at, ch) {
    const g = this.game;
    if (this.S) {
      if (this.S.id === id && this.S.inst === inst) return;
      this.end(); // (the server lets one run at a time: a newer one wins)
    }
    // (the last one's fire tail, if it is still fading, makes way)
    if (this.voice) {
      this.voice.stop(0.5);
      this.voice = null;
    }
    const C = charOf(ch), J = C.jutsu.amaterasu;
    if (!J?.cinema) return;
    this.S = {
      id, inst, at, C, J, from: at + J.cinema[0] * F * 1000, to: at + J.cinema[1] * F * 1000, focusAt: at + J.focus * F * 1000,
      endT: J.cinema[1] * F, victims: null, picked: false, lit: false, cut: false, back: false, crowsT: AMA.crows[0], hud: false,
      yaw: 0, ang: 0, sgn: 1, shotC: null, sounds: {}, trauma: 0,
    };
    // (Tsukuyomi's world on this screen gives way: the genjutsu itself goes on)
    this.K.world.abort();
    g.audio?.amaterasuCine?.('start');
  }

  /** The pick (n:1, from the server, to everyone): whom the flames take (`v`) and when (`e`, server ms). */
  pick(m) {
    const S = this.S;
    if (!S || S.id !== m.id || S.inst !== m.i) return;
    S.victims = Array.isArray(m.v) ? m.v.slice() : [];
    S.picked = true;
    if (Number.isFinite(m.e)) S.focusAt = m.e;
  }

  /** Its caster left or respawned (a match starting): it ends here. */
  drop(id) {
    if (this.S && this.S.id === id) this.end();
  }

  /** Ends it at once, everything given back. */
  end() {
    const g = this.game, S = this.S;
    if (!S) return;
    // (cut short, by its caster leaving or respawning or a newer cast, its voice goes too; played out, the fire tail
    // fades on by itself)
    if (this.voice && this.time() < S.endT) {
      this.voice.stop(0.3);
      this.voice = null;
    }
    if (S.hud) g.hud?.cinema?.(false);
    this.showRings(true);
    this.S = null;
    this.cam = false;
  }

  /** The caster's drawn fighter on this screen (null: gone). */
  caster() {
    const g = this.game, S = this.S;
    if (S.id === g.net.id) return g.player;
    return g.remotes.get(S.id)?.fighter || null;
  }

  showRings(on) {
    const g = this.game;
    const set = (f) => f?.ring && (f.ring.visible = on && !f.noRing);
    set(g.player);
    for (const r of g.remotes.values()) set(r.fighter);
  }

  quality() {
    return QUALITY[this.game.preset] ?? 1;
  }

  // ---------------------------------------------------------------- per frame

  /** Once per frame from the kit's update (after the fighters are posed). */
  update(dt, now) {
    const S = this.S, g = this.game;
    if (!S) return;
    // (debug: scripts/debug/amashots.mjs holds its clock at a time to film one moment exactly)
    if (this.hold !== undefined && this.hold !== null) now = S.at + this.hold * 1000;
    if (g.state !== 'playing') return this.end();
    const t = (now - S.at) / 1000;
    const f = this.caster();
    if (!f || t > S.endT + AMA.ret + AMA.barsOut) return this.end();
    const A = g.post.amaterasu;
    this.cam = false;
    this.voiceStep(t);
    // ---- in the arena: the view darkens and drains round him
    if (t < AMA.cut) {
      const k = ss(AMA.gather[0], AMA.gather[1], t);
      g.post.grade.sat -= 0.6 * k;
      g.post.grade.bright -= 0.1 * k;
    }
    if (t >= AMA.hud && !S.hud && t < S.endT) {
      S.hud = true;
      g.hud?.cinema?.(true);
    }
    if (S.hud && t >= S.endT + 0.05) {
      S.hud = false;
      g.hud?.cinema?.(false);
    }
    A.bars = ss(AMA.bars[0], AMA.bars[1], t) * (1 - ss(S.endT, S.endT + AMA.barsOut, t));
    // ---- the negative world (front shot, the rush into the face)
    if (t >= AMA.cut && !S.cut) this.cutIn(f);
    if (t >= AMA.cut && t < AMA.eye + 0.05) {
      A.neg = 1;
      A.iso = [Math.max(0.3, g.camera.position.distanceTo(_v.copy(f.pos).setY(f.pos.y + 1.2))), 1];
      this.crowsStep(f, t);
      this.shotA(f, t);
    }
    // the flashes: white-cold into the negative, red into the eyes
    const fa = Math.exp(-Math.pow((t - AMA.cut) / 0.05, 2)), fb = Math.exp(-Math.pow((t - AMA.eye) / 0.035, 2));
    if (fa > 0.01) A.flash = [0.85, 0.95, 1, 0.9 * fa];
    if (fb > 0.01) A.flash = [0.7, 0.02, 0.02, 0.9 * fb];
    // ---- the eyes
    if (t >= AMA.eye && t < AMA.back + 0.02) this.eyes(A, t, dt);
    // ---- the flames: the arena in colour, the camera on a victim
    if (t >= AMA.back && !S.back) this.backIn(f);
    if (t >= AMA.burst[0]) {
      const k = ss(AMA.burst[0], AMA.burst[1], t);
      A.flame = [3.2 * (1 - (1 - k) ** 2.2), ss(AMA.burn[0], AMA.burn[1], t)];
      A.flameC = S.flameC || [0, 0];
      if (t >= AMA.burn[1]) A.flame = [0, 0];
      if (!S.sounds.burst) this.sound('burst');
    }
    if (S.back && t < S.endT + AMA.ret) this.shotC(t);
    // the flames latch on at the focus: the same instant on every screen (the server's hitr follows with the damage)
    if (!S.lit && now >= S.focusAt && S.picked) {
      S.lit = true;
      for (const id of S.victims) this.K.latch(id, f.pos);
      this.sound('ignite');
    }
    if (t >= S.endT && !S.sounds.end) {
      this.sound('end');
      this.showRings(true);
    }
  }

  /** The voice line on the cinematic's clock (the server's: every screen hears the word at the same moment). Scheduled
   *  on the audio clock just ahead of time (sample-exact, not on a frame), earlier by the output's latency, later by
   *  the display's; a screen that hears of the cast late joins the line where it is. Not while the clock is held. */
  voiceStep(t) {
    const S = this.S, a = this.game.audio;
    if (S.voice || !a?.playFile || (this.hold !== undefined && this.hold !== null)) return;
    const due = AMA.voice - (a.latency() - SHOW_LAG);
    if (t < due - 0.15 || t > due + AMA.voiceLate) return;
    const h = a.playFile('amaterasu', { offset: t - due, delay: due - t });
    // (null: the audio not running or the file not decoded yet: tried again next frame, within voiceLate)
    if (!h) return;
    S.voice = true;
    this.voice = h;
  }

  sound(k) {
    this.S.sounds[k] = true;
    this.game.audio?.amaterasuCine?.(k);
  }

  /** The cut into the negative world: the camera's side chosen for a clear view; ink bursts behind him. */
  cutIn(f) {
    const S = this.S, g = this.game;
    S.cut = true;
    S.yaw = f.yaw;
    // the camera in front of him, as straight on as the arena allows
    let best = null;
    for (const ang of [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 2.0, -2.0]) {
      const sc = this.viewScore(f, S.yaw + ang);
      if (!best || sc > best.sc) best = { ang, sc };
      if (sc >= 1) break;
    }
    S.ang = best.ang;
    S.sgn = best.ang < 0 ? -1 : 1;
    this.showRings(false);
    // ink thrown up behind him (white in the scene: the negative turns it to ink)
    const q = this.quality(), fx = -Math.sin(S.yaw), fz = -Math.cos(S.yaw), p = f.pos;
    for (let n = Math.round(10 * q) + 4; n > 0; n--) {
      const a = Math.random() * Math.PI * 2, sp = 1.5 + Math.random() * 3;
      g.fx.emit(0, p.x - fx * 0.5 + Math.cos(a) * 0.3, p.y + 0.6 + Math.random() * 1.4, p.z - fz * 0.5 + Math.sin(a) * 0.3, Math.cos(a) * sp - fx * 2, 0.8 + Math.random() * 2, Math.sin(a) * sp - fz * 2, 0.5 + Math.random() * 0.4, 0.45, 1.1 + Math.random() * 0.6, 0.95, 0.95, 0.95);
    }
    this.sound('negative');
  }

  /** How well a camera `yaw` round him sees him: 1 = clear at both ends of the push, less when blocked. */
  viewScore(f, yaw) {
    const W = this.game.world, p = f.pos, dx = -Math.sin(yaw), dz = -Math.cos(yaw);
    let s = 1;
    for (const [d, h] of [[2.75, 0.95], [1.9, 1.32], [1.0, 1.5]]) {
      const x = p.x + dx * d, y = p.y + h, z = p.z + dz * d;
      if (!W.clear(p.x, p.y + 1.3, p.z, x, y, z)) s -= 0.35;
      if (W.solidAt(x, z, y - 0.25, y + 0.25, 0.2)) s -= 0.5;
      if (W.ground(x, z, y + 2, {}).y > y - 0.3) s -= 0.4;
    }
    return s + (Math.abs(yaw - f.yaw) < 0.01 ? 0.02 : 0);
  }

  /** The flock off his back: a stream of big crows flung out to the sides and up, away from the lens; feathers. */
  crowsStep(f, t) {
    const S = this.S, K = this.K, q = this.quality();
    const [c0, c1] = AMA.crows;
    if (t < c0 || S.crowsT >= c1) return;
    const fx = -Math.sin(S.yaw), fz = -Math.cos(S.yaw), rx = Math.cos(S.yaw), rz = -Math.sin(S.yaw), p = f.pos;
    const rate = 26 * q; // crows a second at the start, easing off
    while (S.crowsT < Math.min(t, c1)) {
      const k = (S.crowsT - c0) / (c1 - c0);
      S.crowsT += 1 / (rate * (1.2 - k) + 4);
      const side = Math.random() < 0.5 ? -1 : 1, sp = 3.5 + Math.random() * 4, up = 1.2 + Math.random() * 3;
      const bx = p.x - fx * 0.35 + rx * side * (0.2 + Math.random() * 0.3), by = p.y + 0.9 + Math.random() * 1.0, bz = p.z - fz * 0.35 + rz * side * (0.2 + Math.random() * 0.3);
      const back = 2 + Math.random() * 3;
      K.flyOff(bx, by, bz, rx * side * sp - fx * back, up, rz * side * sp - fz * back, 1.1 + Math.random() * 1.1, 0.8 + Math.random() * 0.35);
      if (Math.random() < 0.5) K.feathers.puff(bx, by, bz, 1, 0.3, 2.5, 1.5);
    }
    // feathers drifting down across the lens (between the camera and him)
    if (Math.random() < 0.35 * q) {
      const d = 0.4 + Math.random() * 1.2, s = (Math.random() - 0.5) * 2.6;
      K.feathers.puff(p.x + fx * d + rx * s, p.y + 1.6 + Math.random() * 1.2, p.z + fz * d + rz * s, 1, 0.2, 0.6, 1.2 + Math.random() * 0.6);
    }
  }

  /** The front shot: low in front of him, pushing in and turning a little; then rushing into his face. */
  shotA(f, t) {
    const S = this.S;
    const u = ss(AMA.push[0], AMA.push[1], t);
    const ang = S.yaw + S.ang + S.sgn * lerp(0.3, 0.1, u);
    const d = lerp(2.75, 1.9, u), h = lerp(0.95, 1.32, u);
    const p = f.pos;
    const cx = p.x - Math.sin(ang) * d, cy = p.y + h, cz = p.z - Math.cos(ang) * d;
    const ly = p.y + lerp(1.3, 1.5, u);
    const eye = this.K.eyes(f, S.C, _w);
    const k = clamp((t - AMA.rush[0]) / (AMA.rush[1] - AMA.rush[0]), 0, 1), kk = k ** 2.4;
    // (the rush: straight at the eyes from where the push left off, ending a hand's width from his face)
    const ea = S.yaw + S.ang;
    const ex = eye.x - Math.sin(ea) * 0.34, ey = eye.y + 0.01, ez = eye.z - Math.cos(ea) * 0.34;
    this.camPos.set(lerp(cx, ex, kk), lerp(cy, ey, kk), lerp(cz, ez, kk));
    this.camLook.set(lerp(p.x, eye.x, ss(0, 0.6, k)), lerp(ly, eye.y, ss(0, 0.6, k)), lerp(p.z, eye.z, ss(0, 0.6, k)));
    S.fov = lerp(48, 36, kk);
    S.roll = S.sgn * 0.05 * kk;
    this.focus.copy(p).setY(p.y + 1.2);
    this.cam = true;
  }

  /** The painted close-up's parameters at time t. */
  eyes(A, t, dt) {
    const S = this.S, T = t - AMA.eye;
    A.eye = ss(AMA.eye - 0.01, AMA.eye + 0.03, t);
    A.eyeT = T;
    const flutter = 0.16 * Math.sin(Math.PI * clamp((t - AMA.flutter[0]) / (AMA.flutter[1] - AMA.flutter[0]), 0, 1));
    // (wide open at 1; the Mangekyō taking snaps them wider for a moment: > 1 lifts the lids past the open shape)
    const snap = 0.08 * Math.exp(-Math.pow((t - AMA.morph[1]) / 0.12, 2));
    const lid = Math.max(flutter, ss(AMA.lids[0], AMA.lids[1], t) ** 1.3) + snap;
    // (his left eye a breath behind his right)
    A.lid = [lid, Math.max(flutter * 0.8, ss(AMA.lids[0] + 0.05, AMA.lids[1] + 0.05, t) ** 1.3) + snap];
    const morph = ss(AMA.morph[0], AMA.morph[1], t);
    // the spin: slow, whirling up through the change, settling
    const w = 1.1 + 16 * Math.exp(-Math.pow((t - (AMA.morph[0] + AMA.morph[1]) / 2) / 0.16, 2));
    S.spin = (S.spin || 0) + w * dt;
    const focus = ss(AMA.focus[0], AMA.focus[1], t);
    A.iris = [morph, S.spin, focus, ss(AMA.veins[0], AMA.veins[1], t)];
    A.spinBlur = clamp(w * 0.006, 0, 0.16);
    A.blood = [ss(AMA.blood[0], AMA.blood[1], t) ** 0.8, ss(3.72, AMA.blood[1] + 0.05, t) ** 0.9];
    A.edgeFire = ss(AMA.edge[0], AMA.edge[1], t);
    // the camera: a slow push toward his right eye, then driving into its pupil
    const L = AMA_LAYOUT;
    const px = L.eyeR[0] - L.iris[0] * L.hw, py = L.eyeR[1] + L.iris[1] * L.hw;
    const drift = ss(AMA.eye, AMA.focus[0], t);
    const zi = ss(AMA.focus[0], AMA.focus[1] + 0.06, t) ** 2.6;
    const pan = 0.3 * drift + 0.7 * ss(0, 0.5, zi ** 0.5), mag = 1 + 0.12 * drift + 11 * zi;
    A.zoom = [px * pan, py * pan, mag];
    S.flameC = [(px - px * pan) * mag, (py - py * pan) * mag];
    // a jolt as the Mangekyō takes, a tremor as it focuses
    const j = Math.exp(-Math.pow((t - AMA.morph[1]) / 0.06, 2)) * 0.006 + focus * 0.002;
    A.shake = [(Math.random() - 0.5) * j, (Math.random() - 0.5) * j];
    for (const [k, at] of [['eyes', AMA.eye], ['open', AMA.lids[0]], ['mangekyo', AMA.morph[0]], ['blood', AMA.blood[0]], ['focus', AMA.focus[0]]]) {
      if (t >= at && !S.sounds[k]) this.sound(k);
    }
    // (the arena under it: the camera stays at his face)
    this.cam = true;
  }

  /** Back in the arena (under the black flames): the camera on the victim this screen cares most about. */
  backIn(f) {
    const S = this.S, g = this.game;
    S.back = true;
    const ids = S.victims || [];
    // our own body if it was taken; else the one nearest him
    let V = null, best = 1e9;
    for (const id of ids) {
      const B = this.K.body(id);
      if (!B) continue;
      const d = id === g.net.id ? -1 : Math.hypot(B.pos.x - f.pos.x, B.pos.z - f.pos.z);
      if (d < best) {
        best = d;
        V = B;
      }
    }
    if (V) {
      // looking at the victim from Itachi's side of it, turned off the line so both read
      const dx = f.pos.x - V.pos.x, dz = f.pos.z - V.pos.z, l = Math.hypot(dx, dz) || 1;
      const base = Math.atan2(dx / l, dz / l);
      let pick = null;
      for (const off of [0.6, -0.6, 0.95, -0.95, 0.3, -0.3, 1.4, -1.4, 2.2, -2.2]) {
        const a = base + off, x = V.pos.x + Math.sin(a) * 3.2, z = V.pos.z + Math.cos(a) * 3.2, y = V.pos.y + 1.35;
        let sc = 1;
        if (!g.world.clear(V.pos.x, V.pos.y + 1.1, V.pos.z, x, y, z)) sc -= 0.6;
        if (g.world.solidAt(x, z, y - 0.25, y + 0.25, 0.2)) sc -= 0.6;
        if (g.world.ground(x, z, y + 2, {}).y > y - 0.3) sc -= 0.4;
        if (!pick || sc > pick.sc) pick = { a, sc };
        if (sc >= 1) break;
      }
      S.shotC = { id: V.id, a: pick.a };
    } else {
      // nobody taken: him again, in colour, from the front
      S.shotC = { id: null, a: S.yaw + S.ang };
    }
    this.showRings(false);
  }

  /** Shot C: a slow push in on the victim as the flames take it (or on him); then the game camera eases back in. */
  shotC(t) {
    const S = this.S, C = S.shotC;
    const B = C.id !== null ? this.K.body(C.id) : null;
    const f = this.caster();
    const P = B ? B.pos : f.pos;
    const u = ss(AMA.back, S.endT, t);
    const d = lerp(3.2, 2.7, u);
    // (the victim: from its side toward him; him: from in front, his facing is -sin, -cos)
    if (B) this.camPos.set(P.x + Math.sin(C.a) * d, P.y + 1.35, P.z + Math.cos(C.a) * d);
    else this.camPos.set(P.x - Math.sin(C.a) * d, P.y + 1.4, P.z - Math.cos(C.a) * d);
    this.camLook.set(P.x, P.y + (B ? 1.0 : 1.3), P.z);
    S.fov = 44;
    S.roll = 0;
    this.focus.copy(P).setY(P.y + 1.0);
    S.ret = AMA.ret > 0 && t > S.endT ? ss(S.endT, S.endT + AMA.ret, t) : 0;
    this.cam = true;
  }

  // ---------------------------------------------------------------- the frame (main.js)

  /** After the game camera's update: while the cinematic films, the view is ours. Returns true when it took it. */
  late(camera) {
    const S = this.S;
    if (!S || !this.cam) return false;
    // (easing back: from the cinematic's pose to where the game camera is now)
    const ret = S.ret || 0;
    if (ret > 0) {
      _v.copy(camera.position);
      _q.copy(camera.quaternion);
    }
    camera.position.copy(this.camPos);
    camera.up.set(0, 1, 0);
    camera.lookAt(this.camLook);
    if (S.roll) camera.rotateZ(S.roll);
    let fov = S.fov || 44;
    if (ret > 0) {
      const k = ret * ret * (3 - 2 * ret);
      camera.position.lerp(_v, k);
      camera.quaternion.slerp(_q, k);
      fov = lerp(fov, this.game.cam.baseFov + this.game.cam.fovKick, k);
    }
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
    return true;
  }
}
