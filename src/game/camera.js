// Third-person camera: a spring arm behind the right shoulder that orbits with the mouse / right stick, pulls in
// against walls and trunks (fast in, slow out, never jitters), lags the fighter slightly, kicks its FOV on sprints
// and dashes, shakes on hits (trauma model), frames both fighters when locked on, and zooms with the wheel (the arm moves in toward the body).
import * as THREE from 'three';
import { vnoise } from '../shared/rng.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = (a) => {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
};
const damp = (k, dt) => 1 - Math.exp(-k * dt);
// Wheel zoom dollies the camera along its arm, from the full arm (fully out, the settings FOV untouched) in to
// ZOOM_NEAR metres behind the shoulder. The level is interpolated in log(arm), so every notch moves in by the same
// ratio; it glides on a critically damped spring (eases in and out, never overshoots, stable at any frame time).
const ZOOM_NEAR = 1.0;
const ZOOM_STEP = 0.1; // of the full range per wheel notch
const ZOOM_TIME = 0.11; // s, spring smoothing time
const _v = new THREE.Vector3(), _hit = {};

export class ThirdPersonCamera {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.yaw = 0; // 0 = looking toward -z
    this.pitch = -0.22;
    this.dist = 3.3; // arm length
    this.height = 1.42; // pivot above the feet
    this.side = 0.38; // over the right shoulder
    this.baseFov = 70;
    this.fovKick = 0;
    this.zoom = 0; // 0 = fully out (the full arm), 1 = fully in (ZOOM_NEAR)
    this.zoomTarget = 0;
    this.zoomVel = 0;
    this.zf = 1; // arm length factor of the zoom (1 fully out)
    this.focus = new THREE.Vector3();
    this.focusInit = false;
    this.arm = this.dist; // current (collision-limited) arm length, in unzoomed metres
    this.trauma = 0;
    this.shakeT = 0;
    this.lock = null; // { x, y, z } of the lock-on target
    this.lockW = 0;
    this.pos = new THREE.Vector3();
  }

  reset(x, y, z, yaw) {
    this.focus.set(x, y + this.height, z);
    this.focusInit = true;
    this.yaw = yaw;
    this.pitch = -0.22;
    this.arm = this.dist;
  }

  addTrauma(t) {
    this.trauma = Math.min(1, this.trauma + t);
  }

  /** Wheel zoom: notches > 0 zoom out, < 0 zoom in. */
  zoomBy(notches) {
    this.zoomTarget = clamp(this.zoomTarget - notches * ZOOM_STEP, 0, 1);
  }

  /** Mouse/stick look. */
  look(dy, dp) {
    this.yaw = wrap(this.yaw + dy);
    this.pitch = clamp(this.pitch + dp, -1.35, 0.95);
  }

  /**
   * target: the fighter's drawn feet position; opts: { sprint, dash, wall (wall-run normal or null), vy }
   */
  update(dt, target, opts = {}) {
    const cam = this.camera;
    if (!this.focusInit) this.reset(target.x, target.y, target.z, this.yaw);
    // zoom (a smooth-damp spring toward the wheel's target)
    if (this.zoom !== this.zoomTarget || this.zoomVel) {
      const w = 2 / ZOOM_TIME, x = w * dt, e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
      const ch = this.zoom - this.zoomTarget, tmp = (this.zoomVel + w * ch) * dt;
      this.zoomVel = (this.zoomVel - w * tmp) * e;
      let z = this.zoomTarget + (ch + tmp) * e;
      if ((ch > 0) !== (z > this.zoomTarget) || Math.abs(z - this.zoomTarget) < 1e-4) {
        z = this.zoomTarget;
        this.zoomVel = 0;
      }
      this.zoom = z;
    }
    this.zf = this.zoom ? Math.pow(Math.min(1, ZOOM_NEAR / this.dist), this.zoom) : 1;

    // focus: follows the fighter with a slight lag (vertical lags more: hides steps and bounces). Zoomed in, the
    // same lag in metres would fill more of the screen: it tightens in proportion (unchanged fully out).
    const tight = 1 / this.zf;
    const fy = target.y + this.height + (opts.wall ? 0.15 : 0);
    this.focus.x += (target.x - this.focus.x) * damp((opts.dash ? 26 : 18) * tight, dt);
    this.focus.z += (target.z - this.focus.z) * damp((opts.dash ? 26 : 18) * tight, dt);
    this.focus.y += (fy - this.focus.y) * damp((Math.abs(fy - this.focus.y) > 2 ? 14 : 9) * tight, dt);

    // lock-on: turn the view so both fighters stay framed (the mouse still nudges it)
    this.lockW += ((this.lock ? 1 : 0) - this.lockW) * damp(6, dt);
    if (this.lock) {
      const dx = this.lock.x - target.x, dz = this.lock.z - target.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.5) {
        const want = Math.atan2(-dx, -dz);
        this.yaw = wrap(this.yaw + wrap(want - this.yaw) * damp(5, dt));
        // look down at a close target, level at a far one; up at one above
        const wantPitch = clamp(Math.atan2(this.lock.y - target.y - 0.4, d) * 0.6 - 0.18 - 0.35 / Math.max(1, d), -0.8, 0.5);
        this.pitch += (wantPitch - this.pitch) * damp(3, dt);
      }
    }

    // FOV kick: sprint and dash widen the view a little
    const kick = (opts.sprint ? 7 : 0) + (opts.dash ? 9 : 0);
    this.fovKick += (kick - this.fovKick) * damp(opts.dash ? 12 : 4, dt);
    if (Math.abs(kick - this.fovKick) < 0.01) this.fovKick = kick;
    const fov = this.baseFov + this.fovKick;
    // small steps are skipped, but at rest the FOV lands exactly on the settings value
    if (cam.fov !== fov && (this.fovKick === kick || Math.abs(cam.fov - fov) > 0.01)) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }

    // arm direction from yaw/pitch
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const fx = -Math.sin(this.yaw) * cp, fz = -Math.cos(this.yaw) * cp, fyv = sp;
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    // the pivot sits over the right shoulder
    const side = this.side * (1 - this.lockW * 0.4);
    const px = this.focus.x + rx * side, py = this.focus.y, pz = this.focus.z + rz * side;
    // arm length: shorter looking up (the ground would clip), longer when locked on at range
    let want = this.dist * (1 - clamp(-this.pitch - 0.2, 0, 1) * 0.05) * (1 + this.lockW * 0.12);
    if (this.pitch > 0.3) want *= 1 - (this.pitch - 0.3) * 0.35;
    const want0 = want;
    want *= this.zf; // the zoom shortens the arm itself: the camera keeps its place over the shoulder
    // collision: from the fighter's head out along the arm (a little margin keeps the near plane out of walls)
    const ox = this.focus.x, oy = this.focus.y, oz = this.focus.z;
    const ex = px - fx * want, ey = py - fyv * want, ez = pz - fz * want;
    const dx = ex - ox, dy = ey - oy, dz = ez - oz;
    const dl = Math.hypot(dx, dy, dz);
    let free = dl;
    if (dl > 1e-3) {
      const t = this.world.raycast(ox, oy, oz, dx / dl, dy / dl, dz / dl, dl + 0.3, _hit);
      free = Math.max(0.35, t - 0.3);
    }
    // (arm and lim in unzoomed metres, so zooming back out with nothing in the way follows the wheel, not the
    // slow collision ease-out)
    const lim = (free / dl) * want0;
    // snap in immediately (never see through a wall), ease back out
    this.arm = lim < this.arm ? lim : this.arm + (lim - this.arm) * damp(3.5, dt);
    const k = this.arm / want0;
    const cx = ox + (ex - ox) * k, cy = oy + (ey - oy) * k, cz = oz + (ez - oz) * k;
    // never below the terrain
    const gy = this.world.terrain(cx, cz) + 0.25;
    cam.position.set(cx, Math.max(cy, gy), cz);
    this.pos.copy(cam.position);
    // look at the point ahead of the pivot
    _v.set(px + fx * 10, py + fyv * 10, pz + fz * 10);
    cam.lookAt(_v);

    // shake: trauma^2, smooth noise, decays
    if (this.trauma > 0) {
      this.shakeT += dt * 38;
      const s = this.trauma * this.trauma;
      cam.rotateZ(vnoise(this.shakeT, 1.3, 7) * 0.035 * s);
      cam.rotateX(vnoise(this.shakeT, 5.1, 9) * 0.03 * s);
      cam.rotateY(vnoise(this.shakeT, 9.7, 11) * 0.03 * s);
      this.trauma = Math.max(0, this.trauma - dt * 1.9);
    }
  }
}
