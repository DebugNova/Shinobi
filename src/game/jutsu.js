// Jutsu and ninja tools for the local fighter, and the visuals of everyone else's:
//   1  Shuriken        an upper-body throw (the legs keep running), a fast projectile with mild homing, 3 charges
//   R  Rasenshuriken   (full ultimate gauge) a spinning wind-shuriken that bursts into a big multi-hit sphere
//   F  Chakra charge   (combat.js ChargeAction) the blue aura
// Naruto's Q / E / G / X (Shadow Clone Jutsu, Rasengan, Shadow Clone Substitution, Shadow Clone Rush) live in
// naruto.js, Madara's in madara.js, Itachi's in itachi.js; this file owns the slots, cooldowns and chakra for all.
// Every cast is an event (net `jutsu` / `tool` with the origin, direction and target), so every client plays it at
// once; the caster detects the hits (swept spheres for projectiles) and
// the server validates them like melee hits.
import * as THREE from 'three';
import { ST } from '../shared/config.js';
import { segSeg } from './hurtbox.js';
import { ChakraAura, RasenganFX, RasenshurikenFX, shurikenMesh } from '../gfx/jutsufx.js';
import { NARUTO_CASTS, NarutoKit } from './naruto.js';
import { MADARA_CASTS, MadaraKit } from './madara.js';
import { ITACHI_CASTS, ItachiKit } from './itachi.js';

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

// input actions -> the character's kit slots (C.kit: { jutsu1, jutsu2, jutsu3, jutsu4, ult } = jutsu ids: Q, E, G, X, R)
export const SLOTS = ['jutsu1', 'jutsu2', 'jutsu3', 'jutsu4', 'ult'];
// jutsu id -> { ok(J, ctrl): can it start now, start(J, ctrl, slot): the action, why: the refusal's toast }. Naruto's
// come from naruto.js, Madara's from madara.js, Itachi's from itachi.js.
const CASTS = {
  ...NARUTO_CASTS,
  rasenshuriken: { ok: () => true, start: (J, ctrl) => new RasenshurikenAction(J, ctrl, J.game.combat.aimTarget(ctrl, 30)) },
  ...MADARA_CASTS,
  ...ITACHI_CASTS,
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
    this.ready = {}; // jutsu id -> seconds (performance clock) when usable again
    this.time = 0;
    this.fxBy = new Map(); // fighter -> { aura, ras, rsh }
    this.madara = new MadaraKit(this); // Madara's kit: fire, wood, gunbai counter, meteor (madara.js)
    this.itachi = new ItachiKit(this); // Itachi's kit: fireballs, Tsukuyomi, crow escape, Amaterasu (itachi.js)
    this.naruto = new NarutoKit(this); // Naruto's kit: shadow clones, Rasengan, substitution, the Rush (naruto.js)
  }

  /** Every clone body on screen ({ f, gone }: shadow casters, Tsukuyomi hiding them). */
  get clones() {
    return this.naruto.drawables();
  }

  /** A new cast / projectile instance id (unique per client, sent with every cast and hit). */
  nextInst() {
    return ++instSeq;
  }

  /** Clone bodies, n per character with a clone jutsu (parsed behind the loading screen: naruto.js Bodies). */
  async warmClones(n) {
    await this.naruto.bodies.warm(n);
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
      if (!J || !cast) return this.nope();
      if (!cast.ok(this, ctrl)) return this.nope(cast.why);
      if (J.ult) {
        if ((g.gauge?.u || 0) < 99.5) return this.nope();
        g.gauge.u = 0;
      } else {
        if (t < (this.ready[id] || 0) || ctrl.chakra < J.cost) return this.nope();
        ctrl.chakra -= J.cost;
        this.ready[id] = t + J.cd;
      }
      this.endHold(ctrl);
      ctrl.action = cast.start(this, ctrl, slot);
      return true;
    }
    return false;
  }

  nope(why = 'Not ready') {
    this.game.hud.toast?.(why, 700);
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
    if (this.naruto.onRemote(m, r) || this.madara.onRemote(m, r) || this.itachi.onRemote(m, r)) return;
    if (m.k === 'tool' && m.m === 'shuriken' && m.o && m.d) {
      r.act = { clip: 'throw', r: m.r, key: `throw${m.i}`, dur: 19 * F, pause: 0, upper: true };
      this.addProjectile('shuriken', m.id, false, m.i, _v.fromArray(m.o).clone(), _w.fromArray(m.d).clone(), m.tg);
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
    // per fighter: charge aura, the Rasenshuriken overhead, wall-run chakra at the feet (the Rasengan: naruto.js)
    const each = (f, charging, rshSize) => {
      const e = this.fxFor(f);
      e.aura?.update(dt, f.pos, charging, this.time);
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
    each(g.player, a?.netState === ST.charge, a instanceof RasenshurikenAction ? a.size : 0);
    for (const r of g.remotes.values()) {
      if (!r.fighter) continue;
      const v = r.view || {};
      const act = r.act;
      let rsh = 0;
      if (act?.jutsu === 'rsh' && v.act && !r.rshThrown) rsh = clamp(v.act.t / (40 * F), 0.1, 1);
      if (!act) r.rshThrown = false;
      each(r.fighter, v.st === ST.charge, rsh);
    }
    this.madara.update(dt);
    this.itachi.update(dt);
    this.naruto.update(dt);
    this.updateProjectiles(dt);
    this.updateBursts(dt);
    for (const x of this.rsh) if (!x.busy) x.update(dt, _v, 0);
  }
}
