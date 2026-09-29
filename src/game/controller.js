// The local fighter's gameplay simulation, stepped at a fixed 60 Hz (rendering interpolates between steps).
// Movement: run -> ninja sprint, turn rates, quick 180s, jump (coyote time + buffering), double jump, dashes (ground
// and air, invulnerable start), wall runs on any climbable surface (up and along it, vault over the top, kick off),
// landings (hard landings recover unless you dash out), push-apart between fighters. Combat states plug in through
// `this.action` (src/game/combat.js). Everything the animator needs is exposed on the instance.
import { SIM, ST, FLAG, SURF } from '../shared/config.js';
import { makeBody, stepBody } from '../shared/physics.js';
import { charOf } from '../shared/characters.js';

const TAU = Math.PI * 2;
const NO_INPUT = { take: () => false, peek: () => false, held: () => false, heldFor: () => 0 };
export const wrap = (a) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const _wall = {};
const _mg = {};
const _mv = { x: 0, y: 0 };

export class Controller {
  constructor(world, charId = 'naruto') {
    this.world = world;
    this.C = charOf(charId);
    this.M = this.C.move;
    this.body = makeBody();
    this.opts = {
      r: this.C.body.radius, h: this.C.body.height, step: this.M.step, gravity: this.M.gravity, fallMul: this.M.fallMul,
      maxFall: this.M.maxFall, snap: 0.55, slopeLimitCos: Math.cos(this.M.slopeLimit),
    };
    this.reset([0, 0, 0], 0);
  }

  reset(p, yaw) {
    const b = this.body;
    b.x = p[0];
    b.y = p[1];
    b.z = p[2];
    b.vx = b.vy = b.vz = 0;
    b.ground = true;
    b.gy = p[1];
    this.yaw = yaw; // facing (0 = toward -z)
    this.moveYaw = yaw; // travel direction
    this.yawRate = 0;
    this.st = ST.loco;
    this.stT = 0;
    this.runT = 0; // seconds of continuous running (sprint after M.sprintAfter)
    this.sprint = false;
    this.airT = 0; // seconds since leaving the ground (coyote time)
    this.jumps = 0; // 1 after the first jump, 2 after the double jump
    this.airDashes = 0;
    this.flipT = -1; // time since the double jump started (the front flip), -1 = none
    this.dashT = 0;
    this.dashDir = [0, -1];
    this.dashCharges = this.C.stats.dashCharges;
    this.dashRegen = 0;
    this.wall = null; // { nx, nz, top } while wall running
    this.wallDir = [0, 1]; // run direction on the wall: [along tangent, up]
    this.vault = null;
    this.landV = 0;
    this.landT = 9;
    this.hardLand = false;
    this.chakra = this.C.stats.chakra;
    this.lockTarget = null; // a fighter we are locked on to (the camera frames it, attacks aim at it)
    // combat action (attack, jutsu, reaction...) owning the fighter; a reset (spawn, teleport) ends any
    if (this.action?.netState === 5) this.onGuardEnd?.();
    this.action = null;
    this.airCombo = false;
    this.events = []; // things that happened this step, for net/fx/audio: { k, ... }
    this.invulnUntil = 0;
    this.water = false;
    this.speed = 0;
    this.prevX = p[0];
    this.prevY = p[1];
    this.prevZ = p[2];
    this.prevYaw = yaw;
    this.stepUp = 0;
  }

  /** Moves the fighter (substitution, server corrections) keeping its resources and cooldowns. */
  teleportTo(p, yaw) {
    const b = this.body;
    this.prevX = b.x = p[0];
    this.prevY = b.y = p[1];
    this.prevZ = b.z = p[2];
    b.vx = b.vy = b.vz = 0;
    b.ground = true;
    this.prevYaw = this.yaw = this.moveYaw = yaw;
    this.action = null;
    this.wall = null;
    this.vault = null;
    this.sprint = false;
    this.runT = 0;
    this.setState(ST.loco);
  }

  setState(st) {
    if (this.st === st) return;
    this.st = st;
    this.stT = 0;
  }

  get grounded() {
    return this.body.ground;
  }

  emit(k, o = {}) {
    o.k = k;
    this.events.push(o);
  }

  /**
   * One fixed step. input: the Input; camYaw: camera yaw (movement is camera-relative); others: remote fighters'
   * positions for push-apart ([{ x, z, r }]); t: server-clock seconds (for invulnerability windows).
   */
  step(input, camYaw, others, t) {
    const dt = SIM.dt;
    const b = this.body, M = this.M;
    this.prevX = b.x;
    this.prevY = b.y;
    this.prevZ = b.z;
    this.prevYaw = this.yaw;
    this.stT += dt;
    this.landT += dt;
    this.t = t;

    // resources
    if (this.dashCharges < this.C.stats.dashCharges) {
      this.dashRegen += dt;
      if (this.dashRegen >= this.C.stats.dashRegen) {
        this.dashRegen = 0;
        this.dashCharges++;
      }
    }
    if (this.st !== ST.wall && this.st !== ST.charge) this.chakra = Math.min(this.C.stats.chakra, this.chakra + this.C.stats.chakraRegen * dt);

    // camera-relative intent
    input.move(_mv);
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
    let wx = rx * _mv.x + fx * _mv.y, wz = rz * _mv.x + fz * _mv.y;
    const wl = Math.hypot(wx, wz);
    this.wish = wl;
    if (wl > 1e-3) {
      this.wishX = wx / wl;
      this.wishZ = wz / wl;
    } else {
      this.wishX = this.wishZ = 0;
    }

    // combat input may start an action (attacks, guard, charge)
    if (!this.dead) this.combatHook?.(this, input, t);
    // a combat action owns the fighter (it may consume input and drive velocity)
    const act = this.action;
    if (this.dead) {
      // the KO reaction keeps playing (the flight, then lying there); it used to freeze on the killing hit's flinch
      if (act && !act.step(this, NO_INPUT, dt, t)) this.action = null;
      if (!act || !act.noPhysics) this.physics(dt);
      this.finishStep(dt);
      return;
    }
    if (act) {
      const keep = act.step(this, input, dt, t);
      if (!keep) this.action = act.replace || null;
      else if (act.owns) {
        if (!act.noPhysics) this.physics(dt, act.physicsOpts);
        this.separate(others, dt);
        this.finishStep(dt);
        this.onStepped?.(t);
        return;
      }
    }

    switch (this.st) {
      case ST.wall:
        this.stepWall(input, dt);
        break;
      case ST.dash:
        this.stepDash(input, dt);
        break;
      default:
        this.stepMove(input, dt);
    }
    this.separate(others, dt);
    this.finishStep(dt);
    this.onStepped?.(t);
  }

  finishStep(dt) {
    const b = this.body;
    if (!this.wall && !this.vault) this.unbury();
    this.speed = Math.hypot(b.vx, b.vz);
    this.yawRate = wrap(this.yaw - this.prevYaw) / dt;
    this.water = b.ground && b.surf === SURF.water;
  }

  // ---------------------------------------------------------------- ground + air movement

  stepMove(input, dt) {
    const b = this.body, M = this.M;
    const onGround = b.ground;
    if (onGround) {
      this.airT = 0;
      this.jumps = 0;
      this.airDashes = 0;
      this.flipT = -1;
    } else this.airT += dt;
    if (this.flipT >= 0) this.flipT += dt;

    // hard landing: a short recovery (dash cancels it)
    if (this.st === ST.land && this.stT > 0.26) this.setState(ST.loco);

    // dash
    if (input.take('dash', 0.12) && this.dashCharges > 0 && (onGround || this.airDashes < M.dash.airDashes)) {
      this.startDash(input);
      return;
    }

    // jump / double jump (buffered, coyote time)
    const canJump = onGround || this.airT < M.coyote;
    if (this.st !== ST.land && input.peek('jump', M.jumpBuffer)) {
      if (canJump && this.jumps === 0) {
        input.take('jump', M.jumpBuffer);
        b.vy = M.jump;
        b.ground = false;
        this.jumps = 1;
        this.airT = M.coyote;
        this.setState(ST.air);
        this.emit('jump');
      } else if (!onGround && this.jumps < 2 && this.airT > 0.08) {
        // a wall ahead takes the press as a wall run instead
        if (!this.tryWall(true)) {
          input.take('jump', M.jumpBuffer);
          b.vy = M.doubleJump;
          this.jumps = 2;
          this.flipT = 0;
          this.emit('dj');
        } else {
          input.take('jump', M.jumpBuffer);
          return;
        }
      }
    }

    // wall run: holding jump in the air (or sprinting into a wall) against a climbable surface
    if (!b.ground && input.held('jump') && b.vy < M.jump * 0.85 && this.tryWall(false)) return;
    if (b.ground && this.sprint && this.tryWall(false, true)) return;

    // horizontal
    const wish = this.wish;
    const locked = this.lockTarget && !this.lockTarget.dead;
    if (b.ground) {
      // run -> ninja sprint after sprintAfter seconds of running flat out (locked on or not: lock-on only steers the
      // camera and what attacks aim at, never how the fighter moves)
      if (wish > 0.75) this.runT += dt;
      else this.runT = 0;
      if (this.runT < 0.05 || wish < 0.5) this.sprint = false;
      if (this.runT >= M.sprintAfter) this.sprint = true;
      const target = wish * (this.sprint ? M.sprint : M.run) * (this.st === ST.land ? 0.25 : 1);
      let spd = Math.hypot(b.vx, b.vz);
      let dir = spd > 0.05 ? Math.atan2(-b.vx, -b.vz) : this.moveYaw;
      if (wish > 0.01) {
        const want = Math.atan2(-this.wishX, -this.wishZ);
        let d = wrap(want - dir);
        // quick 180: reversing at speed skids to a stop first
        if (Math.abs(d) > 2.6 && spd > 5) {
          spd = Math.max(0, spd - M.decel * 1.4 * dt);
          this.sprint = false;
          this.runT = 0;
          if (spd < 1.5) dir = want;
          this.skid = 0.25;
        } else {
          // turn rate narrows with speed: tight at run, wide arcs at sprint
          const k = clamp((spd - M.run) / (M.sprint - M.run), 0, 1);
          const rate = spd < 2 ? 40 : M.turnRun + (M.turnSprint - M.turnRun) * k;
          dir += clamp(d, -rate * dt, rate * dt);
          spd += clamp(target - spd, -M.decel * dt, M.accel * dt);
        }
      } else {
        // letting go at speed: a skid stop (the animation plants both feet and slides)
        if (spd > 6 && !this.skid) this.skid = Math.min(0.35, spd / M.decel + 0.06);
        spd = Math.max(0, spd - M.decel * dt);
      }
      this.skid = Math.max(0, (this.skid || 0) - dt);
      if (wish > 0.5 && this.skid && Math.abs(wrap(Math.atan2(-this.wishX, -this.wishZ) - dir)) < 1) this.skid = 0;
      b.vx = -Math.sin(dir) * spd;
      b.vz = -Math.cos(dir) * spd;
      if (spd > 0.3) this.moveYaw = dir;
    } else {
      // air control: steer the horizontal velocity toward the wish, never beyond run speed by input alone
      const maxS = Math.max(M.run, Math.hypot(b.vx, b.vz));
      const tx = this.wishX * wish * maxS, tz = this.wishZ * wish * maxS;
      const a = M.airAccel * dt;
      if (wish > 0.01) {
        b.vx += clamp(tx - b.vx, -a, a);
        b.vz += clamp(tz - b.vz, -a, a);
      } else {
        b.vx *= 1 - M.airDrag * dt;
        b.vz *= 1 - M.airDrag * dt;
      }
      const s = Math.hypot(b.vx, b.vz);
      if (s > 0.3) this.moveYaw = Math.atan2(-b.vx, -b.vz);
    }

    // facing: the travel direction, locked on or not (strafing at the target locked the legs to a walk-like
    // sidestep/backpedal and no sprint: the owner wants the same run everywhere). Standing still while locked on
    // (no input, the skid over) turns to face the target in the fighting stance.
    let face = this.moveYaw;
    const spdH = Math.hypot(b.vx, b.vz);
    const faceLock = locked && wish < 0.01 && !this.skid && spdH < 3;
    if (faceLock) {
      const L = this.lockTarget;
      face = Math.atan2(-(L.x - b.x), -(L.z - b.z));
    }
    const moving = spdH > 0.4 || faceLock;
    // (capped at 14 rad/s: a 180-degree change of mind, e.g. stopping to face the target behind, would start at
    // ~50 rad/s and the body snapped round)
    const turn = wrap(face - this.yaw) * (1 - Math.exp(-dt * (b.ground ? 16 : 6)));
    if (moving) this.yaw += clamp(turn, -14 * dt, 14 * dt);

    const wasGround = b.ground;
    this.physics(dt);
    if (b.ground && !wasGround) this.landed(b.landV);
    if (!b.ground && wasGround) {
      this.setState(ST.air);
      if (this.jumps === 0) this.airT = 0;
    }
    if (b.ground && this.st === ST.air) this.setState(ST.loco);
  }

  physics(dt, o) {
    stepBody(this.world, this.body, o || this.opts, dt);
    this.stepUp = this.body.stepUp;
  }

  landed(v) {
    this.airCombo = false;
    this.landV = v;
    this.landT = 0;
    this.jumps = 0;
    this.airDashes = 0;
    this.flipT = -1;
    this.emit('land', { v });
    if (v > this.M.hardLand && this.st !== ST.dash) {
      this.setState(ST.land);
      this.hardLand = true;
      this.sprint = false;
      this.runT = 0;
    } else {
      this.hardLand = false;
      if (this.st === ST.air) this.setState(ST.loco);
    }
  }

  // ---------------------------------------------------------------- dash

  startDash(input) {
    const b = this.body, M = this.M;
    this.dashCharges--;
    this.dashRegen = 0;
    let dx = this.wishX, dz = this.wishZ;
    this.dashBack = false;
    if (this.wish < 0.2) {
      // neutral: a backstep away from where we face
      dx = Math.sin(this.yaw);
      dz = Math.cos(this.yaw);
      this.dashBack = true;
    }
    this.dashDir = [dx, dz];
    this.dashAir = !b.ground;
    if (this.dashAir) this.airDashes++;
    this.dashT = 0;
    this.invulnUntil = (this.t || 0) + M.dash.invuln;
    this.setState(ST.dash);
    b.vx = dx * M.dash.speed;
    b.vz = dz * M.dash.speed;
    b.vy = this.dashAir ? 0 : b.vy;
    this.sprint = false;
    this.emit('dash', { d: [Math.round(dx * 100) / 100, Math.round(dz * 100) / 100], air: this.dashAir });
    // facing: dashes turn you toward the direction, locked on or not (a backstep keeps the facing)
    if (!this.dashBack) this.yaw = Math.atan2(-dx, -dz);
    this.moveYaw = Math.atan2(-dx, -dz);
  }

  stepDash(input, dt) {
    const b = this.body, M = this.M;
    this.dashT += dt;
    const k = clamp(this.dashT / M.dash.time, 0, 1);
    // fast burst, easing out toward end speed
    const s = M.dash.speed + (M.dash.endSpeed - M.dash.speed) * k * k;
    b.vx = this.dashDir[0] * s;
    b.vz = this.dashDir[1] * s;
    if (this.dashAir) b.vy = Math.max(b.vy, -1.5); // air dashes hang for their duration
    this.physics(dt, this.dashAir ? { ...this.opts, gravity: 4 } : this.opts);
    if (this.dashT >= M.dash.time) {
      // keep a little momentum into the run (dash -> sprint feels fluid)
      if (b.ground && this.wish > 0.5) {
        this.runT = M.sprintAfter;
        this.sprint = true;
      }
      this.setState(b.ground ? ST.loco : ST.air);
      if (!b.ground) this.airT = M.coyote;
    }
    // a jump buffered during the dash comes out as soon as it ends (or right away on the ground)
    if (b.ground && input.peek('jump', M.jumpBuffer) && this.dashT > 0.12) {
      this.setState(ST.loco);
    }
    if (!this.dashAir && !b.ground && this.dashT > 0.05) {
      this.setState(ST.air);
      this.airT = 0;
    }
  }

  // ---------------------------------------------------------------- wall run

  /**
   * Starts a wall run when a climbable wall is in front of the fighter (within reach, facing into it).
   * press: triggered by a jump press (more forgiving); fromGround: sprinting straight into it.
   */
  tryWall(press, fromGround = false) {
    const b = this.body, M = this.M;
    if (this.chakra < 2) return false;
    const r = this.opts.r;
    const w = this.world.wall(b.x, b.y + 0.9, b.z, r, press ? 0.7 : 0.35, _wall);
    if (!w) return false;
    // intent into the wall: the stick (or, with no input, the facing)
    const ix = this.wish > 0.2 ? this.wishX : -Math.sin(this.yaw), iz = this.wish > 0.2 ? this.wishZ : -Math.cos(this.yaw);
    const into = -(ix * w.nx + iz * w.nz);
    if (into < (fromGround ? 0.85 : 0.35)) return false;
    // too short to bother (a crate, a low wall): just jump it
    if (w.top - b.y < 2.2) return false;
    this.wall = { nx: w.nx, nz: w.nz, top: w.top, shape: w.shape };
    this.setState(ST.wall);
    this.sprint = false;
    this.jumps = 1; // a wall jump allows one more jump after it
    this.airDashes = 0;
    this.flipT = -1;
    const vIn = Math.max(0, b.vy);
    // carry the run's speed up the wall
    this.wallSpeed = Math.max(M.wall.speed, Math.hypot(b.vx, b.vz) * 0.8, vIn);
    b.vx = b.vz = 0;
    b.ground = false;
    this.emit('wall', { n: [w.nx, w.nz] });
    return true;
  }

  stepWall(input, dt) {
    const b = this.body, M = this.M, W = M.wall, r = this.opts.r;
    if (this.vault) return this.stepVault(dt);
    this.chakra -= W.drain * dt;
    // the wall under us now (it may curve: tree trunks; or end: ran past a corner)
    const w = this.world.wall(b.x, b.y + 0.9, b.z, r, 0.6, _wall) || this.world.wall(b.x, b.y + 0.2, b.z, r, 0.6, _wall);
    if (!w || this.chakra <= 0 || (input.take('dash', 0.1) && this.dropOff())) {
      this.leaveWall(false);
      return;
    }
    this.wall.nx = w.nx;
    this.wall.nz = w.nz;
    this.wall.top = w.top;
    // jump: kick off the wall (away from it and up), then the air (with one jump left)
    if (input.take('jump', 0.12) && this.stT > 0.12) {
      b.vx = w.nx * W.kickOut + (this.wishX * 3);
      b.vz = w.nz * W.kickOut + (this.wishZ * 3);
      b.vy = W.kickUp;
      this.leaveWall(true);
      this.yaw = Math.atan2(-b.vx, -b.vz);
      this.moveYaw = this.yaw;
      this.emit('walljump');
      return;
    }
    // run direction on the wall plane: into the wall = up, along the tangent = sideways
    const tx = -w.nz, tz = w.nx; // tangent (horizontal)
    let ix = this.wishX * this.wish, iz = this.wishZ * this.wish;
    if (this.wish < 0.2 && this.stT < 0.35) {
      // just attached with no stick input: keep running up
      ix = -w.nx;
      iz = -w.nz;
    }
    let along = ix * tx + iz * tz;
    let up = -(ix * w.nx + iz * w.nz);
    const m = Math.hypot(along, up);
    const speed = (this.wallSpeed += (W.speed - this.wallSpeed) * (1 - Math.exp(-dt * 3)));
    if (m > 0.15) {
      along /= m;
      up /= m;
      this.wallDir = [along, up];
      b.vx = tx * along * speed;
      b.vz = tz * along * speed;
      b.vy = up * speed;
    } else {
      // no input: cling, sliding down slowly
      b.vx = b.vz = 0;
      b.vy += (-1.2 - b.vy) * (1 - Math.exp(-dt * 6));
      this.wallDir = [0, 0];
    }
    // move along the plane, then stick to the surface at capsule distance
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
    const w2 = this.world.wall(b.x, b.y + 0.9, b.z, r, 0.8, _wall);
    if (w2) {
      b.x += -w2.nx * (w2.dist - 0.02);
      b.z += -w2.nz * (w2.dist - 0.02);
    }
    // nothing else may overlap us (other shapes, the ground below)
    const g = this.world.ground(b.x, b.z, b.y + 0.3, {}, 0);
    if (b.y < g.y) {
      b.y = g.y;
      if (b.vy < 0) {
        // slid back down to the ground
        this.leaveWall(false);
        b.ground = true;
        this.setState(ST.loco);
        return;
      }
    }
    const ceil = this.world.ceiling(b.x, b.z, r * 0.6, b.y + this.opts.h - 0.1, b.y + this.opts.h + 0.3);
    if (ceil !== Infinity && b.vy > 0) {
      // an overhang (eaves, a branch): vault over it if the wall top is just there, mantle onto the overhang if its
      // top is within reach (a branch reached from the trunk), else stop climbing under it
      if (w.top - b.y < 2.4) this.startVault(w);
      else if (!this.mantle(w, ceil)) b.y = Math.min(b.y, ceil - this.opts.h);
      return;
    }
    // reached the top: vault over the edge onto it
    if (b.vy > 0 && w.top - b.y < 1.05) {
      this.startVault(w);
      return;
    }
    // the body faces the run direction on the wall; yaw follows the horizontal part, or faces into the wall
    const face = Math.abs(along) > 0.3 ? Math.atan2(-(tx * along), -(tz * along)) : Math.atan2(w.nx, w.nz);
    this.yaw += wrap(face - this.yaw) * (1 - Math.exp(-dt * 12));
    this.moveYaw = this.yaw;
  }

  /**
   * The body's middle inside a solid (a roof reached by a vault from under the gable, anything a teleport put us in):
   * stand on that solid's top when it is within reach, as if we had climbed it. pushOut can't free a body whose centre
   * is inside two shapes that push it into each other (the two slopes of a gable roof meet at the ridge).
   */
  unbury() {
    const b = this.body, h = this.opts.h;
    for (let k = 0; k < 3; k++) {
      const s = this.world.solidAt(b.x, b.z, b.y + 0.35, b.y + h * 0.7, 0.02);
      if (!s) return;
      const top = this.world.topAt(s, b.x, b.z, 0.02);
      if (top - b.y > 4) return;
      b.y = top;
      if (b.vy < 0) b.vy = 0;
      b.ground = true;
      b.gy = top;
      b.shape = s;
    }
  }

  /** A standing spot for a vault / mantle at (x, z) no lower than y: y itself, or the top of what fills it. */
  standAt(x, z, y, maxY) {
    const h = this.opts.h, m = 0.02;
    for (let k = 0; k < 3; k++) {
      const s = this.world.solidAt(x, z, y + 0.05, y + h, m);
      if (!s) return y;
      y = this.world.topAt(s, x, z, m);
      if (y > maxY) return null;
    }
    return null;
  }

  dropOff() {
    return true;
  }

  leaveWall(jumped) {
    const b = this.body;
    const n = this.wall;
    this.wall = null;
    this.vault = null;
    this.setState(ST.air);
    this.airT = this.M.coyote;
    if (!jumped && n) {
      // push off slightly so we don't re-grab instantly
      b.vx += n.nx * 1.5;
      b.vz += n.nz * 1.5;
      b.vy = Math.min(b.vy, 2);
    }
    this.jumps = jumped ? 1 : Math.max(1, this.jumps);
    this.emit('wallend', { j: jumped ? 1 : 0 });
  }

  /**
   * Onto an overhang above the head (a branch out of the trunk we are running up, eaves): its top must be within
   * 2.2 m of its underside with room to stand. Landing points are searched outward from the wall and to both sides
   * (the capsule touches the overhang before its middle is under it).
   */
  mantle(w, ceil) {
    const b = this.body, h = this.opts.h;
    const tx = -w.nz, tz = w.nx;
    for (const out of [0.7, 1.1]) {
      for (const side of [0, 0.35, -0.35, 0.7, -0.7]) {
        const x = b.x + w.nx * out + tx * side, z = b.z + w.nz * out + tz * side;
        const g = this.world.ground(x, z, ceil + 2.2, _mg, 0);
        if (g.y < ceil - 0.05 || g.y > ceil + 2.2) continue;
        if (this.world.ceiling(x, z, this.opts.r * 0.6, g.y + 0.1, g.y + h) !== Infinity) continue;
        if (this.standAt(x, z, g.y, g.y) === null) continue;
        this.vault = { x0: b.x, y0: b.y, z0: b.z, x1: x, y1: g.y, z1: z, t: 0, dur: 0.38 };
        this.emit('vault');
        return true;
      }
    }
    return false;
  }

  startVault(w) {
    const b = this.body, r = this.opts.r;
    // the landing spot: over the edge, one body width in
    const tx = b.x - w.nx * (r + 0.55), tz = b.z - w.nz * (r + 0.55);
    const g = this.world.ground(tx, tz, w.top + 1.6, {}, 0);
    // the spot must have room to stand: under a gable the wall's top is inside the roof, so land on the roof itself
    // (or stay on the wall under an overhang too high to reach)
    const ty = this.standAt(tx, tz, Math.max(g.y, w.top), w.top + 3.2);
    if (ty === null) {
      b.y = Math.min(b.y, this.world.ceiling(b.x, b.z, r * 0.6, b.y, b.y + this.opts.h + 0.3) - this.opts.h);
      b.vy = Math.min(b.vy, 0);
      return;
    }
    this.vault = { x0: b.x, y0: b.y, z0: b.z, x1: tx, y1: ty, z1: tz, t: 0, dur: 0.3 + Math.max(0, ty - w.top - 1) * 0.06 };
    this.emit('vault');
  }

  stepVault(dt) {
    const b = this.body, v = this.vault;
    v.t += dt;
    const k = clamp(v.t / v.dur, 0, 1);
    // up first, then over: a quick arc
    const ku = 1 - (1 - Math.min(1, k * 1.6)) ** 2;
    const kf = k * k * (3 - 2 * k);
    const px = b.x, pz = b.z, py = b.y;
    b.x = v.x0 + (v.x1 - v.x0) * kf;
    b.z = v.z0 + (v.z1 - v.z0) * kf;
    b.y = v.y0 + (v.y1 + 0.35 - v.y0) * ku - 0.35 * Math.max(0, k - 0.6) / 0.4;
    b.vx = (b.x - px) / dt;
    b.vy = (b.y - py) / dt;
    b.vz = (b.z - pz) / dt;
    if (k >= 1) {
      b.y = v.y1;
      b.vy = 0;
      b.vx *= 0.5;
      b.vz *= 0.5;
      this.wall = null;
      this.vault = null;
      b.ground = true;
      this.setState(ST.loco);
      this.jumps = 0;
      this.emit('land', { v: 1 });
      this.landT = 0;
      this.landV = 1;
    }
  }

  // ---------------------------------------------------------------- fighters don't overlap

  separate(others, dt) {
    const b = this.body, r = this.opts.r;
    for (const o of others) {
      const dx = b.x - o.x, dz = b.z - o.z;
      if (Math.abs(b.y - o.y) > 1.5) continue;
      const d = Math.hypot(dx, dz), min = r + (o.r ?? r);
      if (d >= min || d < 1e-4) continue;
      // soft push (both clients push their own fighter: they part symmetrically), hard when deeply inside
      const pen = min - d;
      const push = Math.min(pen, (this.M.push * dt) + Math.max(0, pen - 0.25));
      b.x += (dx / d) * push;
      b.z += (dz / d) * push;
    }
  }

  // ---------------------------------------------------------------- network state

  /** [x, y, z, vx, vy, vz, yaw, state, stateMs, flags] */
  netState(out) {
    const b = this.body;
    out[0] = b.x;
    out[1] = b.y;
    out[2] = b.z;
    out[3] = b.vx;
    out[4] = b.vy;
    out[5] = b.vz;
    out[6] = this.yaw;
    out[7] = this.action?.netState ?? this.st;
    out[8] = Math.min(60000, Math.round((this.action ? this.action.t : this.stT) * 1000));
    let f = 0;
    if (this.sprint) f |= FLAG.sprint;
    if (this.lockTarget) f |= FLAG.lock;
    if ((this.t || 0) < this.invulnUntil) f |= FLAG.invuln;
    if (this.water) f |= FLAG.water;
    if (this.jumps >= 2) f |= FLAG.doubleJumped;
    if (this.skid > 0 && this.body.ground) f |= FLAG.skid;
    out[9] = f;
    return out;
  }
}
