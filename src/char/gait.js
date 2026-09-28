// Procedural locomotion: a gait generator that plants feet exactly. A stance foot is integrated against the body's
// real motion (velocity and turning) so it never slides, at any speed, while accelerating or turning. Swing feet
// arc to a landing point ahead of the hips chosen from the travel direction. Cadence, duty factor (time on the
// ground), stride, lift and heel kick all come from the ground speed, so a walk, a run and the 12 m/s ninja sprint
// are one continuous gait. Legs are solved with two-bone IK; the body bobs, the pelvis turns with the stride, the
// chest counter-rotates, the arms swing (or sweep back for the ninja run), and the whole body banks into turns.
// Idle keeps both feet planted and takes corrective steps when the body turns in place.
//
// Character-local frame: origin at the feet (the body's position), +Z = facing, +X = the character's left, +Y up.
import * as THREE from 'three';
import { BI, BONES } from './rig.js';
import { setEuler, addEuler, armAngles, hand } from './posekit.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ss = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const TAU = Math.PI * 2;
/** piecewise linear table lookup: [[x, y], ...] */
const table = (t, x) => {
  if (x <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) if (x <= t[i][0]) return lerp(t[i - 1][1], t[i][1], (x - t[i - 1][0]) / (t[i][0] - t[i - 1][0]));
  return t[t.length - 1][1];
};

// gait tables by ground speed (m/s): cycles per second, duty factor, swing lift (m)
// (a cycle = two steps). Walking is duty-driven (a foot is down ~60% of the time); running is stance-length driven:
// the planted foot travels about 0.8 leg lengths under the body and the rest of the stride is flight.
const CPS = [[0, 0.95], [1.5, 1.02], [3, 1.38], [5, 1.78], [8, 2.15], [12, 2.45], [18, 2.7]];
const DUTY = [[0, 0.64], [1.5, 0.6], [2.6, 0.55]];
const LIFT = [[0, 0.07], [1.5, 0.1], [3, 0.24], [5, 0.36], [8, 0.46], [12, 0.52]];

// arm and finger bones: the ninja-run layer blends over them by its weight
const ARM_BONES = BONES.filter((n) => /^(left|right)(UpperArm|LowerArm|Hand|Thumb|Index|Middle|Ring|Little)/.test(n)).map((n) => BI[n]);
const _K = [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]];
const _pp = new THREE.Vector3(), _flex = new THREE.Vector3(0, 0, -1), _hinge = new THREE.Vector3(), _dir = new THREE.Vector3();
const _t = new THREE.Vector3(), _pole = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();

export class Gait {
  constructor(rig) {
    this.rig = rig;
    const P = rig.P;
    rig.fk(restPose(rig));
    // neutral stance: feet under the hips, a little apart; ankle height from the rest pose (soles on the ground)
    const la = P[BI.leftFoot], ra = P[BI.rightFoot];
    this.ankleH = Math.max(0.03, (la.y + ra.y) / 2);
    this.hipW = Math.abs(P[BI.leftUpperLeg].x - P[BI.rightUpperLeg].x) / 2;
    this.toeL = P[BI.leftToes] ? Math.hypot(P[BI.leftToes].z - la.z, P[BI.leftToes].y - la.y) : 0.12;
    // hips -> thigh joint drop, and the hips height that stands the legs (nearly) straight
    this.hipDrop = rig.hipsY - (P[BI.leftUpperLeg].y + P[BI.rightUpperLeg].y) / 2;
    this.H0 = this.ankleH + rig.legLen * 0.992 + this.hipDrop;
    this.feet = [0, 1].map((i) => ({
      side: i ? 'right' : 'left',
      s: i ? -1 : 1, // x sign (left = +x)
      p: new THREE.Vector3(this.hipW * 0.9 * (i ? -1 : 1), 0, 0), // contact point (local), y = height above ground
      planted: true,
      swing: 0, // 0..1 progress while swinging
      from: new THREE.Vector3(),
      yaw: 0,
      pitch: 0,
      dur: 0.3,
      stepping: false, // an idle corrective step
      gy: 0, // ground height under the foot, relative to the body's feet (foot IK)
      vel: new THREE.Vector3(), // swing velocity (local, m/s)
      land: new THREE.Vector3(), // where this swing is heading (follows the stride's landing spot, see follow())
      landOn: false,
    }));
    this.groundAt = null; // (lx, lz) -> ground height relative to the feet, set by the fighter
    this.pelvis = 0;
    this.phase = 0;
    this.moving = 0; // 0 idle .. 1 moving (smoothed)
    this.speed = 0;
    this.lean = 0;
    this.bank = 0;
    this.bob = 0;
    this.idleT = 0;
    this.stepCooldown = 0;
    this.nextStep = 0;
    this.ninja = 0; // ninja-run arm blend
    this.skidW = 0; // skid stop blend
    this.accelLean = 0;
    this.prevSpeed = 0;
    // strafing (lock-on): the legs run toward the travel direction, turned up to ~72 degrees from the facing, and the
    // chest turns back to the target; beyond ~115 degrees the legs face forward and backpedal
    this.legYaw = 0; // radians, + = left
    this.backW = 0; // backpedal blend
    this.backpedal = false;
  }

  /** Puts both feet planted at the neutral stance (spawns, teleports, landings). */
  plant() {
    for (const f of this.feet) {
      f.p.set(this.hipW * 0.9 * f.s, 0, 0);
      f.planted = true;
      f.stepping = false;
      f.swing = 0;
      f.landOn = false;
    }
  }

  /**
   * Plants feet where they are now after an air/landing (keeps the stride going if moving).
   * lx/lz: local positions of the landing feet (null = neutral).
   */
  land(speedLocal) {
    this.plant();
    if (speedLocal > 2) {
      // land mid-stride: one foot ahead, one behind
      const D = 0.45;
      this.feet[0].p.z = D * 0.5;
      this.feet[1].p.z = -D * 0.4;
      this.phase = 0.05;
    }
  }

  /**
   * Advances the gait and writes the lower body (hips, legs) and upper-body locomotion layer into `pose`.
   * v: { vx, vz } local velocity (m/s; z = forward), yawRate (rad/s, + = turning left), sprint (bool),
   * upper: the upper-body idle source pose (or null), accel (m/s^2 forward), crouch (0..1)
   */
  update(dt, pose, v) {
    const rig = this.rig;
    const speed = Math.hypot(v.vx, v.vz);
    this.speed = speed;
    const dirx = speed > 0.05 ? v.vx / speed : 0, dirz = speed > 0.05 ? v.vz / speed : 1;
    const moveTarget = speed > 0.35 ? 1 : 0;
    this.moving += (moveTarget - this.moving) * damp(moveTarget ? 14 : 6, dt);
    // the style of the gait (run blend, cadence, duty, lift, arm bend) follows a smoothed speed: the simulation
    // changes speed in steps at 60 Hz (1 m/s per tick when accelerating), and a step through the walk -> run blend
    // flipped the elbows and the toe-off in one drawn frame. The feet still move with the real velocity.
    this.sp = (this.sp ?? speed) + (speed - (this.sp ?? speed)) * damp(18, dt);
    const sp = this.sp;
    const lift = table(LIFT, sp);
    const run = ss(2.4, 4.5, sp);
    // stance length D (how far a planted foot travels under the body), cadence and duty factor. Walking: a foot is
    // down 60% of the time and the stance is capped at 0.78 leg lengths (short legs walk with a quicker cadence);
    // running: the stance is 0.6-0.7 leg lengths at the table's cadence, and the rest of each stride is flight.
    const Dw = rig.legLen * 0.78, cpsW = clamp((sp * 0.6) / Dw, 0.85, 1.7);
    const Dr = rig.legLen * lerp(0.6, 0.7, ss(5, 12, sp)), cpsR = table(CPS, sp);
    const cps = lerp(cpsW, cpsR, run);
    const cycle = 1 / cps;
    const D = lerp(Math.min(Dw, (sp * 0.6) / cpsW), Math.min(Dr, (sp * 0.6) / cpsR), run);
    const duty = clamp((D * cps) / Math.max(sp, 0.01), 0.1, 0.66);
    const yawStep = v.yawRate * dt;
    // skid: both feet planted and sliding with the body (lead foot forward), hips low, leaning back
    this.skidW += ((v.skid ? 1 : 0) - this.skidW) * damp(v.skid ? 22 : 8, dt);
    const skid = this.skidW;
    const width = lerp(this.hipW * 0.95, this.hipW * 0.25, run);
    let legT = 0;
    if (moveTarget && speed > 0.8 && skid < 0.35) {
      const a = Math.atan2(dirx, dirz);
      this.backpedal = Math.abs(a) > (this.backpedal ? 1.85 : 2.1);
      legT = clamp(this.backpedal ? a - Math.sign(a) * Math.PI : a, -1.25, 1.25);
    } else this.backpedal = false;
    this.legYaw += (legT - this.legYaw) * damp(9, dt);
    this.backW += ((this.backpedal ? 1 : 0) - this.backW) * damp(8, dt);
    const L = this.legYaw, lcx = Math.cos(L), lsx = -Math.sin(L); // the legs' left axis (local x, z)
    const runSwing = run * (1 - this.backW); // backpedalling swings are low arcs, not a sprinter's loop
    // (the spline's end tangent in metres per quarter swing that matches ~70% of the ground speed; see swingFoot)
    const paw = Math.min(sp * (1 - duty) * cycle * 0.25 * 2 * 0.7, D);

    // planted feet stay put in the world: move them against the body's motion and turning
    const c = Math.cos(-yawStep), s = Math.sin(-yawStep);
    for (const f of this.feet) {
      if (!f.planted) continue;
      f.p.x -= v.vx * dt * (1 - skid);
      f.p.z -= v.vz * dt * (1 - skid);
      const x = f.p.x, z = f.p.z;
      // rotating the body by +yaw (toward +x... left) turns a fixed world point by -yaw in the local frame
      f.p.x = x * c + z * s;
      f.p.z = -x * s + z * c;
      f.yaw -= yawStep;
    }

    if (skid > 0.35) {
      // skidding: finish any swing fast and slide both feet toward the braking stance
      this.phase = -1;
      for (const f of this.feet) {
        const lead = f.s > 0;
        _t.set(this.hipW * 1.1 * f.s + dirx * (lead ? 0.5 : -0.12), 0, dirz * (lead ? 0.5 : -0.12));
        if (!f.planted) {
          // a swinging foot keeps the motion it had and is handed over to the braking stance as the skid builds
          // (switching paths in one frame jerked the leg), then comes down in ~0.15 s
          const w = ss(0.35, 0.75, skid);
          f.p.addScaledVector(f.vel, dt * (1 - w));
          f.vel.multiplyScalar(1 - damp(10, dt));
          f.p.lerp(_t, damp(16, dt) * w);
          f.p.y = Math.max(0, f.p.y * (1 - damp(16, dt) * w));
          if (f.p.y < 0.02 && w > 0.5) {
            f.planted = true;
            f.landOn = false;
          }
        } else f.p.lerp(_t, damp(14, dt) * skid);
        f.pitch += (-12 * (lead ? 1 : 0) - f.pitch) * damp(12, dt);
        f.yaw *= 1 - damp(10, dt);
      }
    } else if (moveTarget) {
      this.idleT = 0;
      // start: pick the phase so the foot that is farther behind lifts first; a foot already in the air (an idle
      // step, a skid's last swing) is the one that swings, carried on from where it is (it used to be "touched down"
      // at the stride's landing spot in one frame)
      if (this.phase < 0) {
        const airborne = this.feet.findIndex((f) => !f.planted);
        const behind = airborne >= 0 ? airborne : this.feet[0].p.z * dirz + this.feet[0].p.x * dirx < this.feet[1].p.z * dirz + this.feet[1].p.x * dirx ? 0 : 1;
        this.phase = behind === 0 ? duty + 0.001 : (duty + 0.5 + 0.001) % 1;
        // the stride's styling (arm swing, pelvis, bob) carries on from where it was and catches up with the new
        // phase (restarting it snapped the arms)
        let off = (this.lastPh ?? this.phase) - this.phase;
        off -= Math.round(off);
        this.phOff = off;
        for (const f of this.feet) {
          f.stepping = false;
          if (!f.planted) {
            f.from.copy(f.p);
            f.yaw0 = f.yaw;
            f.pitch0 = f.pitch;
            f.k0 = 0;
            f.landOn = false;
          }
        }
      }
      this.phase = (this.phase + dt / cycle) % 1;
      this.feet.forEach((f, i) => {
        const fp = (this.phase + (i ? 0.5 : 0)) % 1;
        const inSwing = fp >= duty;
        const land = _t.set(lcx * width * f.s + dirx * D * 0.5, 0, lsx * width * f.s + dirz * D * 0.5);
        // landing a little outward of a turn (the body leans into it); bank is in degrees
        land.x -= this.bank * 0.004;
        if (inSwing) {
          let k = (fp - duty) / (1 - duty);
          if (f.planted) {
            f.planted = false;
            f.from.copy(f.p);
            f.yaw0 = f.yaw;
            f.pitch0 = f.pitch; // the swing eases out of the pitch the foot actually left the ground with
            // a swing that begins late (the gait restarting at speed puts the second foot mid-cycle) runs from here
            // in the time left, instead of jumping to the middle of the arc
            f.k0 = k < 0.9 ? k : 0;
            f.landOn = false;
          }
          k = clamp((k - (f.k0 || 0)) / (1 - (f.k0 || 0)), 0, 1);
          f.swing = k;
          _pp.copy(f.p);
          this.swingFoot(f, k, this.follow(f, land, dt), lift * (1 - this.backW * 0.4), runSwing, paw);
          f.vel.subVectors(f.p, _pp).divideScalar(Math.max(dt, 1e-3)); // (carried into a skid)
          f.yaw = lerp(f.yaw0, L, ss(0, 0.8, k));
        } else if (!f.planted && f.swing < 0.9) {
          // the duty factor grew under a swing in progress (slowing down makes the stance a bigger share of the
          // cycle): the swing finishes on its own clock instead of the foot being put down where it would land
          f.swing = Math.min(1, f.swing + dt / Math.max(0.1, (1 - duty) * cycle));
          this.swingFoot(f, f.swing, this.follow(f, land, dt), lift * (1 - this.backW * 0.4), runSwing, paw);
          f.yaw = lerp(f.yaw0, L, ss(0, 0.8, f.swing));
          if (f.swing >= 0.9) f.swing = 0.9; // lands next frame through the touchdown below
        } else if (!f.planted) {
          // touchdown
          f.planted = true;
          f.p.copy(f.landOn ? f.land : land);
          f.landOn = false;
          f.p.y = 0;
          f.swing = 0;
          f.yaw = L;
          this.onStep?.(f.side, speed);
        }
        // foot pitch: toe-off near the end of stance, toes down in early swing, flat to land
        const st = inSwing ? 1 : fp / duty;
        // toe-off peaks as the foot leaves the ground and eases out over the first third of the swing (dropping it to
        // flat on the lift-off frame snapped the ankle, toes and knee every step)
        const toeOff = inSwing ? 0 : ss(0.55, 1, st);
        const swingPitch = inSwing ? Math.sin(f.swing * Math.PI) * lerp(10, 35, run) * (1 - f.swing) : 0;
        const pitchT = inSwing ? (f.pitch0 || 0) * (1 - ss(0, 0.33, f.swing)) + swingPitch : toeOff * lerp(18, 38, run);
        // (followed quickly rather than set: coming out of a skid the braking foot's angle would snap to the stride's)
        f.pitch += (pitchT - f.pitch) * damp(40, dt);
      });
    } else {
      // idle: finish swings (land at the neutral stance), then correct stance with small steps when turning
      this.phase = -1;
      this.idleT += dt;
      this.stepCooldown -= dt;
      for (const f of this.feet) {
        const home = _t.set(this.hipW * 0.9 * f.s, 0, f.s * 0.02);
        if (!f.planted) {
          if (!f.stepping) {
            f.stepping = true;
            f.from.copy(f.p);
            f.yaw0 = f.yaw;
            f.dur = 0.18;
            f.swing = 0;
          }
          f.swing = Math.min(1, f.swing + dt / f.dur);
          this.swingFoot(f, f.swing, home, 0.09, 0);
          f.yaw = lerp(f.yaw0, 0, ss(0, 1, f.swing));
          if (f.swing >= 1) {
            f.planted = true;
            f.stepping = false;
            f.landOn = false;
            f.p.copy(home);
            f.yaw = 0;
            this.onStep?.(f.side, 0.5);
          }
        }
        f.pitch *= 1 - damp(10, dt);
      }
      // turning in place (or pushed): step the worse foot back under the body
      if (this.stepCooldown <= 0 && this.feet.every((f) => f.planted)) {
        let worst = null, wd = 0;
        for (const f of this.feet) {
          const hx = this.hipW * 0.9 * f.s;
          const d = Math.hypot(f.p.x - hx, f.p.z) + Math.abs(f.yaw) * 0.35;
          if (d > wd) {
            wd = d;
            worst = f;
          }
        }
        if (worst && wd > 0.17) {
          worst.planted = false;
          worst.stepping = false;
          this.stepCooldown = 0.12;
        }
      }
    }

    // ---- ground under each foot (slopes, stairs, roots): planted feet keep the height they landed at
    let low = 0;
    for (const f of this.feet) {
      if (this.groundAt) {
        const g = this.groundAt(f.p.x, f.p.z);
        if (!f.planted || Math.abs(g - f.gy) > 0.5) f.gy += (g - f.gy) * (f.planted ? 1 : damp(25, dt));
        else f.gy = g;
      } else f.gy *= 1 - damp(20, dt);
      low = Math.min(low, f.gy);
    }
    // the pelvis drops so the lower foot can reach its ground
    this.pelvis += (low - this.pelvis) * damp(14, dt);

    // ---- hips: height, bob, pelvis rotation, lean and bank
    const legL = rig.legLen;
    // lower the hips as the stride lengthens so the legs can reach; bob with the steps
    // the hips can't be higher than the landing foot allows (it touches down D/2 ahead)
    const reach = Math.min(0.62, D * 0.5 + 0.03);
    const needH = Math.sqrt(Math.max(0.1, (legL * 0.995) ** 2 - reach * reach)) + this.ankleH + this.hipDrop;
    let H = Math.min(this.H0 * (0.992 - 0.012 * run), needH + 0.025);
    // when the gait stops (phase -1) the stride's phase-driven motion (bob, pelvis turn, arm swing) keeps its last
    // phase and fades out with `moving`, instead of jumping to phase 0 on the stopping frame
    this.phOff = (this.phOff || 0) * (1 - damp(9, dt));
    const ph = this.phase < 0 ? this.lastPh || 0 : (this.lastPh = (this.phase + this.phOff + 1) % 1);
    // running: lowest at mid-stance, highest in flight; walking: highest at mid-stance (inverted pendulum)
    const bobRun = -Math.cos((ph - duty * 0.5) * TAU * 2) * 0.02 * run;
    const bobWalk = Math.cos((ph - duty * 0.5) * TAU * 2) * 0.018 * (1 - run) * this.moving;
    const breathe = Math.sin(this.idleT * 2.1) * 0.006 * (1 - this.moving) - 0.012 * (1 - this.moving);
    H += bobRun + bobWalk + breathe - (v.crouch || 0) * 0.35 + this.pelvis - skid * 0.14;
    pose.h[0] = this.bank * 0.0015; // hips toward the inside of a turn (bank in degrees)
    pose.h[1] = H;
    pose.h[2] = -this.lean * 0.002;

    // lean: forward with speed and acceleration; bank into turns (lateral acceleration v * yawRate)
    const acc = clamp((sp - this.prevSpeed) / Math.max(dt, 1e-3), -40, 40);
    this.prevSpeed = sp;
    this.accelLean += (clamp(acc * 0.45, -8, 12) - this.accelLean) * damp(6, dt);
    const leanT = lerp(3, 16, run) + ss(8, 12, sp) * (v.sprint ? 22 : 6) + this.accelLean;
    this.lean += (leanT * this.moving * (1 - skid) * (1 - this.backW * 1.25) - 16 * skid - this.lean) * damp(skid > 0.3 ? 14 : 8, dt);
    const bankT = clamp(Math.atan2(speed * v.yawRate, 9.81) * 57.3 * 0.55, -16, 16) * this.moving;
    this.bank += (bankT - this.bank) * damp(7, dt);
    const pelvisYaw = -Math.cos(ph * TAU) * lerp(7, 11, run) * this.moving;
    const pelvisRoll = Math.sin(ph * TAU * 2) * 2.5 * (1 - run) * this.moving;
    // +Z roll leans the body right; turning left (bank > 0) leans left
    const hipYaw = L * 57.3 * 0.9;
    setEuler(pose, 'hips', this.lean * 0.35, pelvisYaw + hipYaw, -this.bank * 0.4 + pelvisRoll);

    // ---- legs (IK to the feet), after the hips are set
    for (const f of this.feet) this.solveLeg(pose, f);

    // ---- upper body locomotion layer: spine counter-rotation, arms
    const chestYaw = -pelvisYaw * 1.25;
    const twist = chestYaw - hipYaw; // the chest turns back to face forward (the target) over the legs
    const spineLean = this.lean * 0.65;
    setEuler(pose, 'spine', spineLean * 0.4, twist * 0.3, -this.bank * 0.25);
    setEuler(pose, 'chest', spineLean * 0.35, twist * 0.35, -this.bank * 0.2);
    setEuler(pose, 'upperChest', spineLean * 0.25, twist * 0.35, 0);
    // idle: breathing (the chest lifts), a slow weight shift, the head drifting a little
    const idle = 1 - this.moving, it = this.idleT;
    if (idle > 0.01) {
      addEuler(pose, 'chest', -Math.sin(it * 2.1) * 1.4 * idle, 0, 0);
      addEuler(pose, 'upperChest', -Math.sin(it * 2.1 - 0.4) * 1.1 * idle, 0, Math.sin(it * 0.5) * 1.2 * idle);
      pose.h[0] += Math.sin(it * 0.5) * 0.012 * idle;
      addEuler(pose, 'hips', 0, Math.sin(it * 0.37) * 2 * idle, -Math.sin(it * 0.5) * 1.5 * idle);
    }
    // head stays level and looks ahead: undo most of the lean
    setEuler(pose, 'neck', -this.lean * 0.45, -chestYaw * 0.4, this.bank * 0.3);
    setEuler(pose, 'head', -this.lean * 0.35 + Math.sin(it * 0.31) * 3 * idle, -chestYaw * 0.3 + Math.sin(it * 0.23) * 6 * idle, this.bank * 0.2);

    // arms: swing opposite to the legs; the ninja run sweeps them straight back
    this.ninja += ((v.sprint && speed > 9 ? 1 : 0) - this.ninja) * damp(6, dt);
    const swingAmp = lerp(18, 48, run) * this.moving;
    const elbow = lerp(18, 95, run);
    for (const side of ['left', 'right']) {
      const sg = side === 'left' ? 1 : -1;
      const sw = Math.cos(ph * TAU) * swingAmp * sg; // left arm forward when the right leg is (fades with moving)
      const idleArm = Math.sin(this.idleT * 2.1 + (sg > 0 ? 0 : 0.5)) * 1.5 * (1 - this.moving);
      // skid: both arms thrown forward and out for balance
      armAngles(rig, pose, side, {
        down: lerp(lerp(76, 72, run) + idleArm, 58, skid),
        swing: lerp(-sw + lerp(6, 8, run), 38, skid),
        out: lerp(lerp(7, 10, run), 26, skid),
        elbow: lerp(lerp(24, elbow, this.moving) + Math.max(0, sw) * 0.35, 48, skid),
        twist: lerp(35, 45, run),
      });
      hand(pose, side, lerp(0.45, 0.75, run), 0.5);
    }
    return { duty, cps, D };
  }

  /** Writes the ninja-run layer over the upper body (arms swept back, body forward, head up). */
  ninjaRun(pose, rig, w, t) {
    if (w <= 0.01) return;
    // the layer fades in and out with w (writing the full pose at any w > 0 popped the arms when the sprint began)
    const save = (this._armSave ||= ARM_BONES.map(() => new THREE.Quaternion()));
    const partial = w < 0.995;
    if (partial) ARM_BONES.forEach((b, k) => pose.get(b, save[k]));
    const bounce = Math.sin(t * 14) * 3;
    for (const side of ['left', 'right']) {
      // arms straight back and down behind the body, palms up (the classic ninja run)
      // (relative to the chest, which already leans ~30 degrees forward: -42 here trails them about level)
      armAngles(rig, pose, side, { down: 86 + bounce * 0.3, swing: -42 + bounce, out: 14, elbow: 6, twist: 80 });
      hand(pose, side, 0.12, 0.2, 4);
    }
    if (partial) {
      ARM_BONES.forEach((b, k) => {
        pose.get(b, _q);
        pose.set(b, save[k].slerp(_q, w));
      });
    }
    addEuler(pose, 'spine', 14 * w, 0, 0);
    addEuler(pose, 'chest', 12 * w, 0, 0);
    addEuler(pose, 'neck', -14 * w, 0, 0);
    addEuler(pose, 'head', -10 * w, 0, 0);
  }

  /**
   * A swing foot from f.from to `to` (local). Walking: a low arc. Running: the sprinter's loop (Catmull-Rom through
   * the key points of a real stride): after toe-off the foot keeps going back and up (the heel kicks toward the
   * hips), comes through high under the body (knee drive), reaches out ahead, then paws back down to land.
   */
  /**
   * A swinging foot's landing spot follows the stride's over ~50 ms. The stride's spot turns with the raw velocity,
   * so a sudden change of direction (bumping a wall mid-backpedal) jumped a foot that was nearly down by 15-20 cm in
   * one frame; how far along its swing a foot is at that moment depends on the leg length (Madara showed it).
   */
  follow(f, land, dt) {
    if (!f.landOn) {
      f.land.copy(land);
      f.landOn = true;
    } else f.land.lerp(land, damp(22, dt));
    return f.land;
  }

  swingFoot(f, k, to, lift, run, paw = 0) {
    const ax = f.from.x, az = f.from.z, ay = f.from.y, bx = to.x, bz = to.z;
    const len = Math.hypot(bx - ax, bz - az);
    const ux = len > 1e-3 ? (bx - ax) / len : 0, uz = len > 1e-3 ? (bz - az) / len : 1;
    const back = 0.28 * run * Math.min(1, len * 1.6), out = 0.2 * run * Math.min(1, len * 1.6);
    // key points along the travel direction (u) and up: [along, up] relative to the lift-off point
    const K = _K;
    K[0][0] = -back * 0.2; K[0][1] = 0;
    K[1][0] = 0; K[1][1] = ay;
    K[2][0] = -back; K[2][1] = lift * 0.78;
    K[3][0] = len * 0.45; K[3][1] = lift;
    K[4][0] = len + out; K[4][1] = lift * 0.42;
    K[5][0] = len; K[5][1] = 0;
    // paw back: the foot arrives already moving backward (relative to the hips) at most of the ground speed, so
    // touchdown doesn't turn a nearly still foot into one sweeping back at 12 m/s in one frame
    K[6][0] = len - out * 0.2 - paw * run; K[6][1] = 0;
    // walking: a plain low arc (blend toward it as run -> 0)
    const seg = k * 4, i = Math.min(3, Math.floor(seg)), t = seg - i;
    const p0 = K[i], p1 = K[i + 1], p2 = K[i + 2], p3 = K[i + 3];
    const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
    const al = cr(p0[0], p1[0], p2[0], p3[0]), up = cr(p0[1], p1[1], p2[1], p3[1]);
    const wl = len * ss(0, 1, k), wu = lerp(ay, 0, k) + lift * Math.sin(Math.PI * k);
    const A = lerp(wl, al, run), U = Math.max(0, lerp(wu, up, run));
    f.p.x = ax + ux * A;
    f.p.z = az + uz * A;
    f.p.y = U;
    f.heel = 0;
  }

  solveLeg(pose, f) {
    const rig = this.rig;
    const up = BI[`${f.side}UpperLeg`], lo = BI[`${f.side}LowerLeg`], ft = BI[`${f.side}Foot`];
    // ankle above the contact point; pitching the foot (toe-off) raises the ankle around the toes
    const pitch = f.pitch * (Math.PI / 180);
    const ah = this.ankleH + Math.sin(Math.max(0, pitch)) * this.toeL * 0.9;
    const heelTuck = (f.heel || 0) * 0.12;
    _t.set(f.p.x, f.p.y + f.gy + ah, f.p.z - heelTuck);
    // knee direction from the knee's hinge axis (the legs' left axis, turned the legs' way plus 30% of the foot's own
    // turn): perpendicular to the hip -> ankle line in the leg's swing plane, so forward when the leg hangs and
    // turning smoothly to up as the foot comes through in front (a fixed forward pole flips the thigh 180 degrees
    // in one frame when the hip -> ankle line passes through it: the sprint's knee drive). Knees a little out.
    const ky = this.legYaw + (f.yaw - this.legYaw) * 0.3;
    _hinge.set(Math.cos(ky), 0, -Math.sin(ky));
    rig.fkTo(pose, up);
    _dir.copy(_t).sub(rig.P[up]).normalize();
    _pole.crossVectors(_dir, _hinge).addScaledVector(_hinge, 0.12 * f.s);
    rig.twoBone(pose, up, lo, ft, _t, _pole, _flex);
    // foot: flat to the ground, turned by its yaw, pitched (toe-off / swing); world -> local of the lower leg
    rig.fkTo(pose, lo);
    _e.set(pitch, f.yaw, 0, 'YXZ');
    _q.setFromEuler(_e);
    _q2.copy(rig.W[lo]).invert().multiply(_q);
    pose.set(ft, _q2);
    // toes bend back during toe-off
    if (rig.has[BI[`${f.side}Toes`]]) setEuler(pose, `${f.side}Toes`, -clamp(f.pitch * 0.9, 0, 35), 0, 0);
  }
}

let _rest = null;
function restPose(rig) {
  _rest ||= new (class {
    constructor() {
      this.q = new Float32Array(rig.W.length * 4);
      for (let i = 0; i < rig.W.length; i++) this.q[i * 4 + 3] = 1;
      this.h = new Float32Array([0, rig.hipsY, 0]);
    }
  })();
  _rest.h[1] = rig.hipsY;
  return _rest;
}
