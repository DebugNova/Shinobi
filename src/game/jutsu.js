// Jutsu and ninja tools for the local fighter, and the visuals of everyone else's:
//   1  Shuriken        an upper-body throw (the legs keep running), a fast projectile with mild homing, 3 charges
//   Q  Rasengan        wind-up (the sphere forms in the palm), a 9 m lunge; on contact a 5-tick grind, then a launch
//   E  Shadow Clone Rush  two clones poof out and rush the target, each doing a 3-hit string
//   R  Rasenshuriken   (full ultimate gauge) a spinning wind-shuriken that bursts into a big multi-hit sphere
//   F  Chakra charge   (combat.js ChargeAction) the blue aura
// Every cast is an event (net `jutsu` / `tool` with the origin, direction and target), so every client plays it at
// once; the caster detects the hits (clip-sampled for clones, swept spheres for projectiles and the Rasengan) and
// the server validates them like melee hits.
import * as THREE from 'three';
import { ST, FLAG, SIM } from '../shared/config.js';
import { makeBody, stepBody } from '../shared/physics.js';
import { segSeg } from './hurtbox.js';
import { ChakraAura, RasenganFX, RasenshurikenFX, shurikenMesh } from '../gfx/jutsufx.js';
import { Fighter } from './fighter.js';
import { MADARA_CASTS, MadaraKit } from './madara.js';

const F = 1 / 60;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = (a) => a - Math.round(a / (Math.PI * 2)) * Math.PI * 2;
/** Turns yaw toward `to` at most `rate` rad/s. */
const turn = (yaw, to, rate, dt) => yaw + clamp(wrap(to - yaw), -rate * dt, rate * dt);
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3(), _hit = new THREE.Vector3();
let instSeq = Math.floor(Math.random() * 1000) * 1000 + 500000;

/** World position of a fighter's bone (raw skeleton, drawn pose). */
function bonePos(fighter, name, out) {
  const n = fighter.vrm.humanoid.getRawBoneNode(name);
  return n ? n.getWorldPosition(out) : out.copy(fighter.pos).setY(fighter.pos.y + 1.1);
}

// ---------------------------------------------------------------- local actions

class ThrowAction {
  constructor(J, ctrl) {
    this.J = J;
    this.jutsu = true;
    this.owns = false; // the legs keep running
    this.t = 0;
    this.thrown = false;
    this.inst = ++instSeq;
    J.game.lastFight = performance.now();
  }

  anim() {
    return { clip: 'throw', t: this.t, upper: true, key: `throw${this.inst}` };
  }

  step(ctrl, input, dt) {
    this.t += dt;
    if (!this.thrown && this.t >= 7 * F) {
      this.thrown = true;
      this.J.throwShuriken(ctrl, this.inst);
    }
    return this.t < 19 * F;
  }
}

class RasenganAction {
  constructor(J, ctrl, target) {
    this.J = J;
    this.jutsu = true;
    this.owns = true;
    this.netState = ST.jutsu;
    this.D = ctrl.C.jutsu.rasengan;
    this.t = 0;
    this.phase = 'wind';
    this.inst = ++instSeq;
    this.target = target;
    this.tick = 0;
    this.hitT = 0;
    const b = ctrl.body;
    if (target) ctrl.yaw = Math.atan2(-(target.x - b.x), -(target.z - b.z));
    this.dir = [-Math.sin(ctrl.yaw), -Math.cos(ctrl.yaw)];
    this.physicsOpts = { ...ctrl.opts, gravity: ctrl.opts.gravity * 0.3 };
    J.game.net.act('jutsu', { m: 'rasengan', i: this.inst, tg: target?.id });
    J.game.audio?.rasengan?.();
  }

  anim() {
    // wind-up 0-18, strike pose held through the lunge and the grind, then the recovery keys
    const f = this.t / F;
    let ct;
    if (this.phase === 'wind') ct = f;
    else if (this.phase === 'lunge' || this.phase === 'grind') ct = Math.min(40, 18 + (f - 18) * 1.5);
    else ct = 60 + (this.t - this.recT) / F;
    return { clip: 'rasengan', t: ct * F, key: `ras${this.inst}` };
  }

  /** The sphere's size (0..1) for the effect. */
  get sphere() {
    if (this.phase === 'wind') return clamp(this.t / (this.D.windup * F), 0.15, 1);
    if (this.phase === 'rec') return Math.max(0, 1 - (this.t - this.recT) * 5);
    return 1;
  }

  step(ctrl, input, dt) {
    const b = ctrl.body, D = this.D;
    this.t += dt;
    b.vx *= 0.8;
    b.vz *= 0.8;
    if (this.phase === 'wind') {
      if (this.target) ctrl.yaw = Math.atan2(-(this.target.x - b.x), -(this.target.z - b.z));
      this.dir = [-Math.sin(ctrl.yaw), -Math.cos(ctrl.yaw)];
      if (this.t >= D.windup * F) {
        this.phase = 'lunge';
        this.lungeT = 0;
        this.J.game.fx.dust(b, 6, 1.2);
      }
    } else if (this.phase === 'lunge') {
      this.lungeT += dt;
      let sp = D.lunge.speed;
      if (this.target) {
        const d = Math.hypot(this.target.x - b.x, this.target.z - b.z);
        if (d < 0.9) sp = 0;
      }
      b.vx = this.dir[0] * sp;
      b.vz = this.dir[1] * sp;
      b.vy = Math.max(b.vy, 0);
      if (this.lungeT >= D.lunge.time) this.rec(ctrl);
    } else if (this.phase === 'grind') {
      b.vx = b.vz = 0;
      b.vy = 0;
      this.hitT += dt;
      // ticks every D.grind.every frames, then the launch
      if (this.hitT >= D.grind.every * F) {
        this.hitT = 0;
        this.J.rasenganTick(this);
      }
    } else if (this.t - this.recT >= D.recovery * F) return false;
    return true;
  }

  rec() {
    this.phase = 'rec';
    this.recT = this.t;
  }
}

class ClonesAction {
  constructor(J, ctrl, target) {
    this.J = J;
    this.jutsu = true;
    this.owns = true;
    this.netState = ST.jutsu;
    this.t = 0;
    this.inst = ++instSeq;
    this.target = target;
    this.cast = ctrl.C.jutsu.clones.cast;
    this.done = false;
    const b = ctrl.body;
    if (target) ctrl.yaw = ctrl.moveYaw = Math.atan2(-(target.x - b.x), -(target.z - b.z));
    J.game.audio?.handsign?.();
  }

  anim() {
    return { clip: 'handsign', t: this.t, key: `sign${this.inst}` };
  }

  step(ctrl, input, dt) {
    const b = ctrl.body;
    this.t += dt;
    b.vx *= 0.8;
    b.vz *= 0.8;
    if (!this.done && this.t >= this.cast * F) {
      this.done = true;
      this.J.spawnClones(ctrl, this.inst, this.target, true);
    }
    return this.t < (this.cast + 6) * F;
  }
}

class RasenshurikenAction {
  constructor(J, ctrl, target) {
    this.J = J;
    this.jutsu = true;
    this.owns = true;
    this.netState = ST.jutsu;
    this.D = ctrl.C.jutsu.rasenshuriken;
    this.t = 0;
    this.inst = ++instSeq;
    this.target = target;
    this.thrown = false;
    J.game.net.act('jutsu', { m: 'rasenshuriken', i: this.inst, tg: target?.id });
    J.game.audio?.ult?.();
  }

  anim() {
    return { clip: 'rasenshuriken', t: this.t, key: `rsh${this.inst}` };
  }

  get size() {
    if (this.thrown) return 0;
    return clamp(this.t / (this.D.cast * F), 0.1, 1);
  }

  step(ctrl, input, dt) {
    const b = ctrl.body;
    this.t += dt;
    b.vx *= 0.85;
    b.vz *= 0.85;
    if (this.target) ctrl.yaw = Math.atan2(-(this.target.x - b.x), -(this.target.z - b.z));
    if (!this.thrown && this.t >= (this.D.cast + 6) * F) {
      this.thrown = true;
      this.J.throwRasenshuriken(ctrl, this);
    }
    return this.t < (this.D.cast + 6 + this.D.recovery) * F;
  }
}

// ---------------------------------------------------------------- the kit

// input actions -> the character's kit slots (C.kit: { jutsu1, jutsu2, jutsu3, ult } = jutsu ids)
export const SLOTS = ['jutsu1', 'jutsu2', 'jutsu3', 'ult'];
// jutsu id -> { ok(J, ctrl): can it start now, start(J, ctrl): the action }. Madara's come from madara.js.
const CASTS = {
  rasengan: { ok: () => true, start: (J, ctrl) => new RasenganAction(J, ctrl, J.game.combat.findTarget(ctrl, 10)) },
  clones: { ok: () => true, start: (J, ctrl) => new ClonesAction(J, ctrl, J.game.combat.aimTarget(ctrl, 30)) },
  rasenshuriken: { ok: () => true, start: (J, ctrl) => new RasenshurikenAction(J, ctrl, J.game.combat.aimTarget(ctrl, 30)) },
  ...MADARA_CASTS,
};

// ---------------------------------------------------------------- the manager

export class Jutsu {
  constructor(game) {
    this.game = game;
    const s = game.scene;
    this.auras = Array.from({ length: 8 }, () => new ChakraAura(s));
    this.rasengans = Array.from({ length: 8 }, () => new RasenganFX(s));
    this.rsh = Array.from({ length: 3 }, () => new RasenshurikenFX(s));
    this.shuriken = Array.from({ length: 16 }, () => {
      const m = shurikenMesh();
      m.visible = false;
      s.add(m);
      return m;
    });
    this.projectiles = []; // { kind, owner (id), mine, inst, pos, vel, tgt, t, life, mesh | fx, r }
    this.clones = []; // { fighter, owner, mine, inst, idx, tgt, t, state, move, hitSet }
    this.clonePools = new Map(); // character id -> VRM instances for clones (a clone looks like its caster)
    this.ready = {}; // jutsu id -> seconds (performance clock) when usable again
    this.time = 0;
    this.fxBy = new Map(); // fighter -> { aura, ras, rsh }
    this.madara = new MadaraKit(this); // Madara's kit: fire, wood, gunbai counter, meteor (madara.js)
  }

  /** A new cast / projectile instance id (unique per client, sent with every cast and hit). */
  nextInst() {
    return ++instSeq;
  }

  /** Extra VRM instances for clones, n per character (parsed behind the loading screen). */
  async warmClones(n) {
    for (const [id, e] of this.game.chars) {
      if (!e.C.jutsu.clones) continue; // (a kit without Shadow Clone Rush needs no clone bodies)
      const pool = [];
      for (let i = 0; i < n; i++) pool.push(await e.model.parse());
      this.clonePools.set(id, pool);
    }
  }

  now() {
    return performance.now() / 1000;
  }

  /** Fraction of each skill's cooldown remaining (the HUD's sweeps), by jutsu id; 0.999 = not enough chakra. */
  cooldowns() {
    const t = this.now(), c = this.game.ctrl, C = c?.C;
    if (!C) return {};
    const tools = c.tools ?? C.stats.toolCharges;
    const out = (this._cds ||= {});
    out.tool = 0;
    out.shuriken = tools > 0 ? 0 : 1 - (c.toolRegen || 0) / C.stats.toolRegen;
    for (const slot of SLOTS) {
      const id = C.kit[slot], J = id && C.jutsu[id];
      if (!J || J.ult) continue;
      out[id] = Math.max(0, ((this.ready[id] || 0) - t) / J.cd, c.chakra < J.cost ? 0.999 : 0);
    }
    return out;
  }

  cooldownLeft(k) {
    const t = this.now(), c = this.game.ctrl;
    if (k === 'shuriken') return (c?.tools ?? 1) <= 0 ? c.C.stats.toolRegen - (c.toolRegen || 0) : 0;
    if (c?.C.jutsu[k]?.cd) return Math.max(0, (this.ready[k] || 0) - t);
    return 0;
  }

  /** Input -> casts (inside the controller's fixed step). Returns true when a cast started. */
  preStep(ctrl, input) {
    const g = this.game, C = ctrl.C, t = this.now();
    if (ctrl.st === ST.wall) return false;
    // tool charges regenerate one at a time
    ctrl.tools ??= C.stats.toolCharges;
    if (ctrl.tools < C.stats.toolCharges) {
      ctrl.toolRegen = (ctrl.toolRegen || 0) + F;
      if (ctrl.toolRegen >= C.stats.toolRegen) {
        ctrl.toolRegen = 0;
        ctrl.tools++;
      }
    }
    // casting is allowed from neutral, a guard or a charge (constructor names are minified: compare states)
    const cur = ctrl.action;
    if (cur && cur.owns && cur.netState !== ST.guard && cur.netState !== ST.charge) return false;
    if (input.take('tool', 0.12) && ctrl.tools > 0 && !ctrl.action) {
      ctrl.tools--;
      ctrl.action = new ThrowAction(this, ctrl);
      return true;
    }
    // the character's kit: which jutsu sits on Q / E / G / R
    for (const slot of SLOTS) {
      const id = C.kit[slot];
      if (!id || !input.take(slot, 0.12)) continue;
      const J = C.jutsu[id], cast = CASTS[id];
      if (!J || !cast || !cast.ok(this, ctrl)) return this.nope();
      if (J.ult) {
        if ((g.gauge?.u || 0) < 99.5) return this.nope();
        g.gauge.u = 0;
      } else {
        if (t < (this.ready[id] || 0) || ctrl.chakra < J.cost) return this.nope();
        ctrl.chakra -= J.cost;
        this.ready[id] = t + J.cd;
      }
      this.endHold(ctrl);
      ctrl.action = cast.start(this, ctrl);
      return true;
    }
    return false;
  }

  nope() {
    this.game.hud.toast?.('Not ready', 700);
    return false;
  }

  endHold(ctrl) {
    const a = ctrl.action;
    if (a && a.netState === ST.guard) this.game.net.act('guard', { on: 0 });
    if (a && a.netState === ST.charge) this.game.net.act('charge', { on: 0 });
  }

  // ---------------------------------------------------------------- shuriken

  throwShuriken(ctrl, inst) {
    const g = this.game, me = g.player;
    const o = bonePos(me, 'rightHand', new THREE.Vector3());
    const tg = g.combat.aimTarget(ctrl, 30);
    const d = new THREE.Vector3();
    if (tg) d.set(tg.x - o.x, tg.y + 1.1 - o.y, tg.z - o.z).normalize();
    else g.camera.getWorldDirection(d);
    const r3 = (v) => Math.round(v * 1000) / 1000;
    g.net.act('tool', { m: 'shuriken', i: inst, o: [o.x, o.y, o.z].map(r3), d: [d.x, d.y, d.z].map(r3), tg: tg?.id });
    this.addProjectile('shuriken', g.net.id, true, inst, o, d, tg?.id);
    g.audio?.throw?.();
  }

  addProjectile(kind, owner, mine, inst, o, d, tgId, n = 0) {
    // the thrower's data (a Madara sees a Naruto's Rasenshuriken)
    const C = this.ownerC(owner);
    const P = kind === 'rsh' ? C.jutsu.rasenshuriken.proj : C.jutsu.shuriken.proj;
    const p = { kind, owner, mine, inst, pos: new THREE.Vector3().copy(o), vel: new THREE.Vector3().copy(d).multiplyScalar(P.speed), tgt: tgId, t: 0, life: P.life, r: P.radius, homing: P.homing, P, n, hitSet: new Set(), done: false };
    if (kind === 'shuriken') {
      p.mesh = this.shuriken.find((m) => !m.visible) || this.shuriken[0];
      p.mesh.visible = true;
    } else {
      p.fx = this.rsh.find((f) => !f.busy) || this.rsh[0];
      p.fx.busy = true;
    }
    this.projectiles.push(p);
    return p;
  }

  /** A fighter's character data by id (ours or a remote's). */
  ownerC(id) {
    const g = this.game;
    return id === g.net.id ? g.ctrl.C : g.charModel(g.remotes.get(id)?.info.ch).C;
  }

  targetPos(id, out) {
    const g = this.game;
    if (id === undefined || id === null) return null;
    if (id === g.net.id) return out.copy(g.player.pos).setY(g.player.pos.y + 1.1);
    if (id === 0) return g.dummy ? out.copy(g.dummy.pos).setY(g.dummy.pos.y + 1.1) : null;
    const f = g.remotes.get(id)?.fighter;
    return f && !f.dead ? out.copy(f.pos).setY(f.pos.y + 1.1) : null;
  }

  updateProjectiles(dt) {
    const g = this.game;
    for (const p of this.projectiles) {
      if (p.done) continue;
      p.t += dt;
      // homing: turn the velocity toward the target (a limited rate)
      if (this.targetPos(p.tgt, _v)) {
        const sp = p.vel.length();
        _w.copy(_v).sub(p.pos).normalize().multiplyScalar(sp);
        p.vel.lerp(_w, Math.min(1, p.homing * dt)).setLength(sp);
      }
      const prev = _c2.copy(p.pos);
      const step = p.vel.length() * dt;
      _w.copy(p.vel).normalize();
      const hitWall = g.world.raycast(prev.x, prev.y, prev.z, _w.x, _w.y, _w.z, step + p.r * 0.5);
      p.pos.addScaledVector(p.vel, dt);
      let impact = hitWall < step + p.r * 0.5;
      if (impact) p.pos.copy(prev).addScaledVector(_w, Math.max(0, hitWall - 0.05));
      // fighters (the owner decides)
      if (p.mine && !impact) {
        for (const t of g.combat.targets()) {
          if (p.hitSet.has(t.id) || !t.hurt?.valid) continue;
          let hit = false;
          for (const c of t.hurt.caps) {
            if (segSeg(prev, p.pos, c.a, c.b, _c1, _hit) <= (p.r + c.r) ** 2) {
              hit = true;
              break;
            }
          }
          if (!hit) continue;
          p.hitSet.add(t.id);
          if (p.kind === 'shuriken') {
            g.combat.landHit({ id: 'shuriken', inst: p.inst, k: 0, from: { x: p.pos.x, y: p.pos.y, z: p.pos.z } }, t, _c1.clone());
            impact = true;
          } else impact = true;
          break;
        }
      }
      if (p.t >= p.life) impact = true;
      if (p.mesh) {
        p.mesh.position.copy(p.pos);
        p.mesh.rotation.y += dt * 40;
        if (Math.random() < 0.6) g.fx.emit(2, p.pos.x, p.pos.y, p.pos.z, -p.vel.x * 0.05, -p.vel.y * 0.05, -p.vel.z * 0.05, 0.12, 0.03, 0.01, 1.2, 1.3, 1.5);
      }
      if (p.fx) p.fx.update(dt, p.pos, 1);
      if (impact) this.endProjectile(p);
    }
    this.projectiles = this.projectiles.filter((p) => !p.done || p.burst);
  }

  endProjectile(p) {
    const g = this.game;
    p.done = true;
    if (p.mesh) {
      p.mesh.visible = false;
      g.fx.impact(p.pos, 0.5, [2.2, 2.4, 2.8]);
    }
    if (p.fx) {
      p.fx.update(0, p.pos, 0);
      p.fx.busy = false;
      p.fx.explode(p.pos, p.kind === 'rsh' ? this.ownerC(p.owner).jutsu.rasenshuriken.burst.radius : 3);
      g.cam.addTrauma(0.5);
      g.fx.impact(p.pos, 4, [2.2, 3.2, 4.0]);
      g.audio?.boom?.(p.pos);
      if (p.mine) {
        // the burst: ticks on everyone inside, then the final blow
        g.net.act('jutsu', { m: 'rasenshuriken', i: p.inst, n: 2, o: [p.pos.x, p.pos.y, p.pos.z].map((v) => Math.round(v * 1000) / 1000) });
        p.burst = { t: 0, tick: 0, center: p.pos.clone() };
      }
    }
  }

  updateBursts(dt) {
    const g = this.game;
    for (const p of this.projectiles) {
      if (!p.burst) continue;
      const B = this.ownerC(p.owner).jutsu.rasenshuriken;
      const b = p.burst;
      b.t += dt;
      if (b.t < B.burst.every * F) continue;
      b.t = 0;
      const final = b.tick >= B.burst.ticks;
      for (const t of g.combat.targets()) {
        if (Math.hypot(t.x - b.center.x, t.y + 1 - b.center.y, t.z - b.center.z) > B.burst.radius + 0.4) continue;
        g.combat.landHit({ id: final ? 'rsh' : 'rsh:b', inst: p.inst, k: b.tick, from: { x: b.center.x, y: b.center.y - 1, z: b.center.z } }, t, _v.set(t.x, t.y + 1, t.z).clone());
      }
      b.tick++;
      if (final) p.burst = null;
    }
  }

  // ---------------------------------------------------------------- rasengan

  rasenganTick(a) {
    const g = this.game, D = a.D;
    const t = a.victim;
    if (!t) return;
    const last = a.tick >= D.grind.ticks;
    const p = _v.set(t.x, t.y + 1.1, t.z).clone();
    g.combat.landHit({ id: last ? 'rasengan' : 'rasengan:g', inst: a.inst, k: a.tick, onHit: () => {} }, t, p);
    g.fx.impact(p, last ? 4 : 1, [1.6, 2.6, 4.0]);
    a.tick++;
    if (last) {
      g.cam.addTrauma(0.6);
      a.rec();
    }
  }

  detectRasengan(a) {
    const g = this.game, ctrl = g.ctrl, b = ctrl.body;
    if (a.phase !== 'lunge') return;
    const L = a.D.hit.box.local;
    const fx = -Math.sin(ctrl.yaw), fz = -Math.cos(ctrl.yaw);
    const cx = b.x + fx * L[2], cy = b.y + L[1], cz = b.z + fz * L[2];
    _v.set(cx, cy, cz);
    for (const t of g.combat.targets()) {
      if (!t.hurt?.valid) continue;
      if (!t.dummy && (t.entry.view?.flags ?? 0) & FLAG.invuln) continue;
      let hit = false;
      for (const c of t.hurt.caps) {
        if (segSeg(_v, _v, c.a, c.b, _c1, _c2) <= (a.D.hit.box.r + c.r) ** 2) {
          hit = true;
          break;
        }
      }
      if (!hit) continue;
      a.phase = 'grind';
      a.victim = t;
      a.hitT = a.D.grind.every * F; // the first tick right away
      break;
    }
  }

  // ---------------------------------------------------------------- clones

  spawnClones(ctrl, inst, target, mine, origin = null, ownerId = null) {
    const g = this.game;
    const b = origin || ctrl.body;
    // the caster's character: its body, its clip library, its data
    const owner = ownerId ?? g.net.id;
    const OC = this.ownerC(owner), C = OC.jutsu.clones.clone;
    const ch = g.charModel(owner === g.net.id ? g.me?.ch : g.remotes.get(owner)?.info.ch);
    const pool = this.clonePools.get(ch.C.id) || [];
    const yaw = origin ? origin.yaw : ctrl.yaw;
    if (mine) g.net.act('jutsu', { m: 'clones', i: inst, tg: target?.id, o: [b.x, b.y, b.z, yaw].map((v) => Math.round(v * 1000) / 1000) });
    for (let k = 0; k < C.count; k++) {
      // the oldest clone gives up its body when the pool is empty
      let vrm = pool.find((v) => !v.taken);
      if (!vrm) {
        const old = this.clones.find((c) => !c.gone && pool.includes(c.f.vrm));
        if (old) this.poofClone(old);
        vrm = pool.find((v) => !v.taken);
      }
      if (!vrm) break;
      vrm.taken = true;
      const side = k ? -1 : 1;
      let x = b.x + Math.cos(yaw) * side * 1.1, z = b.z - Math.sin(yaw) * side * 1.1;
      // not inside a wall or a trunk next to the caster
      const pos = { x, z };
      g.world.pushOut(pos, ctrl.opts.r, b.y, b.y + ctrl.opts.h, 0.45, null);
      x = pos.x;
      z = pos.z;
      const gr = g.world.ground(x, z, b.y + 1, {});
      const air = b.y - gr.y > 0.3; // cast in the air: the clones start there too and drop
      const y = air ? b.y : gr.y;
      const body = makeBody(x, y, z);
      body.ground = !air;
      const f = new Fighter({ id: `clone${inst}${k}`, name: '', slot: 0, local: false, vrm, rig: ch.model.rig, lib: ch.lib, world: g.world, scene: g.scene });
      f.noRing = true; // a clone is not a player: no ring under it
      f.snap(x, y, z, yaw);
      g.fx.poof({ x, y, z }, 0.9);
      this.clones.push({
        f, C: OC, owner: ownerId ?? g.net.id, mine, inst, idx: k, tgt: target?.id, b: body, opts: ctrl.opts, x, y, z, yaw, t: 0,
        state: 'rush', move: 0, moveT: 0, hitSet: new Set(), view: {}, life: C.life, airT: 0, landT: 9, landV: 0, hardLand: false, jumps: air ? 1 : 0, flipT: -1,
      });
    }
    g.audio?.poof?.();
  }

  poofClone(c) {
    const g = this.game;
    c.gone = true;
    g.fx.poof({ x: c.x, y: c.y + 0.9, z: c.z }, 0.9);
    c.f.dispose();
    c.f.vrm.taken = false;
    c.f.vrm.scene.removeFromParent();
  }

  /**
   * Clones run the same body physics as fighters (walls, ledges, slopes), so they fall off edges, jump up to a
   * target on a roof or in the air (a flip for the second jump) and land with the landing squash. Every screen runs
   * them from the cast event toward the target's drawn position; only the caster's copies land hits.
   */
  updateClones(dt) {
    for (const c of this.clones) {
      if (c.gone) continue;
      const C = c.C, CL = C.jutsu.clones.clone;
      c.t += dt;
      if (c.t > c.life) {
        this.poofClone(c);
        continue;
      }
      // fixed-size steps: the physics is tuned for the 60 Hz sim
      for (let left = dt; left > 1e-6 && !c.gone; left -= SIM.dt) this.stepClone(c, Math.min(SIM.dt, left), C, CL);
      if (c.gone) continue;
      const b = c.b, v = c.view;
      c.x = b.x;
      c.y = b.y;
      c.z = b.z;
      const s = Math.sin(c.yaw), co = Math.cos(c.yaw);
      Object.assign(v, {
        x: b.x, y: b.y, z: b.z, yaw: c.yaw, vf: -b.vx * s - b.vz * co, vl: -b.vx * co + b.vz * s, vy: b.vy, speed: Math.hypot(b.vx, b.vz),
        yawRate: c.yawRate || 0, st: b.ground ? ST.loco : ST.air, stT: b.ground ? c.t : c.airT, sprint: c.state === 'rush' && b.ground, skid: 0,
        ground: b.ground, flipT: c.flipT, landT: c.landT, landV: c.landV, hardLand: c.hardLand, wall: null, stepUp: c.stepUp || 0, combat: true,
      });
      c.stepUp = 0;
      if (c.state !== 'attack') v.act = null;
      c.f.update(dt, v);
    }
    this.clones = this.clones.filter((c) => !c.gone);
  }

  stepClone(c, dt, C, CL) {
    const g = this.game, b = c.b;
    const tp = this.targetPos(c.tgt, _v);
    let d = 99, dy = 0, tx = 0, tz = 0;
    if (tp) {
      tx = tp.x;
      tz = tp.z;
      d = Math.hypot(tx - b.x, tz - b.z);
      dy = tp.y - 1.1 - b.y;
    }
    const yaw0 = c.yaw;
    let opts = c.opts;
    if (c.state === 'rush') {
      let dx = -Math.sin(c.yaw), dz = -Math.cos(c.yaw);
      if (tp && d > 0.05) {
        dx = (tx - b.x) / d;
        dz = (tz - b.z) / d;
        // the two clones come in from either side, converging as they arrive
        const side = c.idx ? -1 : 1, k = 0.3 * Math.min(1, d / 4);
        const ex = dx - dz * side * k, ez = dz + dx * side * k, l = Math.hypot(ex, ez);
        dx = ex / l;
        dz = ez / l;
      }
      c.yaw = turn(c.yaw, Math.atan2(-dx, -dz), 16, dt);
      // accelerate toward the wanted velocity (full control on the ground, some in the air, braking as the target
      // comes under it: at full speed a jump carried the clone a metre past a target on a ledge)
      const sp = b.ground || !tp ? CL.speed : Math.min(CL.speed, Math.max(3, (d - 0.6) * 4));
      const wx = dx * sp - b.vx, wz = dz * sp - b.vz, wl = Math.hypot(wx, wz), a = (b.ground ? 110 : 40) * dt;
      if (wl > a) {
        b.vx += (wx / wl) * a;
        b.vz += (wz / wl) * a;
      } else {
        b.vx += wx;
        b.vz += wz;
      }
      // jumps: up to a target above (a roof, a juggle), over something in the way; a second jump (a flip) to reach
      if (tp) {
        const wallAhead = b.ground && b.contacts > 0 && b.cnx * dx + b.cnz * dz < -0.5 && Math.hypot(b.vx, b.vz) < CL.speed * 0.5;
        if (b.ground && ((dy > 0.9 && d < 6) || wallAhead)) {
          this.cloneJump(c, Math.sqrt(2 * c.opts.gravity * (Math.max(dy, 1.2) + 0.5)));
          // the horizontal speed that reaches the target a little after the top of the arc
          if (!wallAhead) {
            const hs = Math.min(CL.speed, Math.max(3, (d - 0.7) / ((b.vy / c.opts.gravity) * 1.3)));
            b.vx = dx * hs;
            b.vz = dz * hs;
          }
        } else if (!b.ground && c.jumps === 1 && b.vy < 1 && dy > 0.8 && d < 5) {
          this.cloneJump(c, 9);
          c.flipT = 0;
        }
      }
      if (tp ? d < 1.05 && Math.abs(dy) < 1.4 : c.t > 0.45) {
        c.state = 'attack';
        c.moveT = 0;
      }
    } else {
      const id = CL.string[c.move], M = C.moves[id];
      if (tp) c.yaw = turn(c.yaw, Math.atan2(-(tx - b.x), -(tz - b.z)), 24, dt);
      // stick to the target through the string (a short step-in), braking otherwise
      if (tp && d > 0.8 && d < 2.5) {
        const sp = Math.min(6, (d - 0.8) * 10);
        b.vx = ((tx - b.x) / d) * sp;
        b.vz = ((tz - b.z) / d) * sp;
      } else {
        const k = Math.max(0, 1 - dt * 14);
        b.vx *= k;
        b.vz *= k;
      }
      // strikes in the air hang there (like the fighters' air attacks)
      if (!b.ground) {
        opts = c.hover ||= { ...c.opts, gravity: c.opts.gravity * 0.3, fallMul: 1 };
        if (b.vy > 0) b.vy *= Math.max(0, 1 - dt * 10);
      }
      c.moveT += dt;
      const f = c.moveT / F;
      // clone hits: the move's contact frame
      if (c.mine && f >= M.startup && !c.hitSet.has(c.move)) {
        c.hitSet.add(c.move);
        this.cloneHit(c, M, id === CL.string[CL.string.length - 1]);
      }
      if (f >= M.startup + M.active + (c.move < CL.string.length - 1 ? 4 : M.recovery)) {
        c.move++;
        c.moveT = 0;
        if (c.move >= CL.string.length) return this.poofClone(c);
        // the target got away between two hits: chase it again (the string carries on where it was)
        if (tp && (d > 2.2 || Math.abs(dy) > 1.6)) c.state = 'rush';
      }
      if (c.state === 'attack') c.view.act = { clip: M.anim, t: c.moveT, key: `c${c.inst}${c.idx}${c.move}` };
    }
    c.yawRate = wrap(c.yaw - yaw0) / dt;
    const was = b.ground;
    stepBody(g.world, b, opts, dt);
    c.stepUp = (c.stepUp || 0) + b.stepUp;
    if (c.flipT >= 0) c.flipT = c.flipT + dt > 0.5 ? -1 : c.flipT + dt;
    if (b.ground) {
      if (!was) {
        c.landT = 0;
        c.landV = b.landV;
        c.hardLand = b.landV > C.move.hardLand;
        c.jumps = 0;
        c.flipT = -1;
        g.fx.dust(b, 4, 0.8);
      } else c.landT += dt;
    } else {
      c.airT = was ? 0 : c.airT + dt;
      if (was && c.jumps === 0) c.jumps = 1; // ran off a ledge: one jump left
    }
  }

  cloneJump(c, vy) {
    const b = c.b;
    b.vy = clamp(vy, 7, 16);
    b.ground = false;
    c.jumps++;
    c.airT = 0;
    if (c.jumps === 1) this.game.fx.dust(b, 5, 1);
  }

  cloneHit(c, M, last) {
    const g = this.game;
    let pick = null;
    for (const t of g.combat.targets()) {
      if (Math.hypot(t.x - c.x, t.z - c.z) > 1.9 || Math.abs(t.y - c.y) > 1.5) continue;
      if (!pick || t.id === c.tgt) pick = t; // the clone's own target first
    }
    if (pick) g.combat.landHit({ id: last ? 'clone:last' : 'clone', inst: c.inst, k: c.idx * 10 + c.move, from: { x: c.x, y: c.y, z: c.z, yaw: c.yaw } }, pick, _v.set(pick.x, pick.y + 1.1, pick.z).clone());
  }

  // ---------------------------------------------------------------- rasenshuriken throw

  throwRasenshuriken(ctrl, a) {
    const g = this.game, me = g.player;
    const o = bonePos(me, 'rightHand', new THREE.Vector3());
    o.y += 0.35;
    const tg = a.target;
    const d = new THREE.Vector3();
    if (tg) d.set(tg.x - o.x, tg.y + 1.1 - o.y, tg.z - o.z).normalize();
    else d.set(-Math.sin(ctrl.yaw), 0, -Math.cos(ctrl.yaw));
    const r3 = (v) => Math.round(v * 1000) / 1000;
    g.net.act('jutsu', { m: 'rasenshuriken', i: a.inst, n: 1, o: [o.x, o.y, o.z].map(r3), d: [d.x, d.y, d.z].map(r3), tg: tg?.id });
    this.addProjectile('rsh', g.net.id, true, a.inst, o, d, tg?.id);
  }

  // ---------------------------------------------------------------- remote casts (visuals)

  onRemote(m, r) {
    const g = this.game;
    const f = r.fighter;
    if (!f) return;
    if (this.madara.onRemote(m, r)) return;
    if (m.k === 'tool' && m.m === 'shuriken' && m.o && m.d) {
      r.act = { clip: 'throw', r: m.r, key: `throw${m.i}`, dur: 19 * F, pause: 0, upper: true };
      this.addProjectile('shuriken', m.id, false, m.i, _v.fromArray(m.o).clone(), _w.fromArray(m.d).clone(), m.tg);
    } else if (m.m === 'rasengan') {
      r.act = { clip: 'rasengan', r: m.r, key: `ras${m.i}`, dur: 84 * F, pause: 0, jutsu: 'rasengan' };
    } else if (m.m === 'clones' && m.o) {
      r.act = { clip: 'handsign', r: m.r, key: `sign${m.i}`, dur: 26 * F, pause: 0 };
      this.spawnClones(g.ctrl, m.i, m.tg !== undefined ? { id: m.tg } : null, false, { x: m.o[0], y: m.o[1], z: m.o[2], yaw: m.o[3] }, m.id);
    } else if (m.m === 'rasenshuriken') {
      if (!m.n) r.act = { clip: 'rasenshuriken', r: m.r, key: `rsh${m.i}`, dur: 64 * F, pause: 0, jutsu: 'rsh' };
      else if (m.n === 1 && m.o && m.d) {
        r.rshThrown = true;
        this.addProjectile('rsh', m.id, false, m.i, _v.fromArray(m.o).clone(), _w.fromArray(m.d).clone(), m.tg);
      } else if (m.n === 2 && m.o) {
        // the owner's impact: end our copy of the projectile there
        const p = this.projectiles.find((q) => q.inst === m.i && !q.done);
        if (p) {
          p.pos.fromArray(m.o);
          this.endProjectile(p);
        } else this.rsh[0].explode(_v.fromArray(m.o), this.ownerC(m.id).jutsu.rasenshuriken.burst.radius);
      }
    }
  }

  // ---------------------------------------------------------------- per frame

  fxFor(fighter) {
    let e = this.fxBy.get(fighter);
    if (!e) {
      e = { aura: this.auras.find((a) => !a.owner), ras: this.rasengans.find((a) => !a.owner) };
      if (e.aura) e.aura.owner = fighter;
      if (e.ras) e.ras.owner = fighter;
      this.fxBy.set(fighter, e);
    }
    return e;
  }

  release(fighter) {
    const e = this.fxBy.get(fighter);
    if (!e) return;
    if (e.aura) {
      e.aura.owner = null;
      e.aura.group.visible = false;
    }
    if (e.ras) {
      e.ras.owner = null;
      e.ras.group.visible = false;
    }
    this.fxBy.delete(fighter);
  }

  update(dt) {
    const g = this.game;
    this.time += dt;
    const ctrl = g.ctrl, a = ctrl.action;
    if (a instanceof RasenganAction) this.detectRasengan(a);
    // per fighter: charge aura, the Rasengan in the palm, the Rasenshuriken overhead, wall-run chakra at the feet
    const each = (f, charging, rasSize, rshSize) => {
      const e = this.fxFor(f);
      e.aura?.update(dt, f.pos, charging, this.time);
      if (e.ras) e.ras.update(dt, rasSize > 0 ? bonePos(f, 'rightHand', _v).add(_w.set(0, 0.02, 0)) : f.pos, rasSize);
      if (rshSize > 0) {
        e.rshFx ||= this.rsh.find((x) => !x.busy);
        if (e.rshFx) {
          e.rshFx.busy = true;
          e.rshFx.update(dt, bonePos(f, 'rightHand', _v).add(_w.set(0, 0.45 * rshSize, 0)), rshSize * 0.9);
        }
      } else if (e.rshFx) {
        e.rshFx.update(dt, f.pos, 0);
        e.rshFx.busy = false;
        e.rshFx = null;
      }
      if (f.view?.st === ST.wall && Math.random() < 0.9) {
        for (const foot of ['leftFoot', 'rightFoot']) {
          bonePos(f, foot, _c1);
          g.fx.emit(5, _c1.x, _c1.y, _c1.z, 0, 0, 0, 0.18, 0.12, 0.22, 0.6, 1.6, 3.6);
        }
      }
    };
    each(g.player, a?.netState === ST.charge, a instanceof RasenganAction ? a.sphere : 0, a instanceof RasenshurikenAction ? a.size : 0);
    for (const r of g.remotes.values()) {
      if (!r.fighter) continue;
      const v = r.view || {};
      const act = r.act;
      let ras = 0, rsh = 0;
      if (act?.jutsu && v.act) {
        const t = v.act.t;
        if (act.jutsu === 'rasengan') ras = t < 0.3 ? clamp(t / 0.3, 0.15, 1) : t < 1.0 ? 1 : Math.max(0, 1 - (t - 1.0) * 5);
        if (act.jutsu === 'rsh' && !r.rshThrown) rsh = clamp(t / (40 * F), 0.1, 1);
      }
      if (!act) r.rshThrown = false;
      each(r.fighter, v.st === ST.charge, ras, rsh);
    }
    this.madara.update(dt);
    this.updateProjectiles(dt);
    this.updateBursts(dt);
    this.updateClones(dt);
    for (const x of this.rsh) if (!x.busy) x.update(dt, _v, 0);
  }
}
