// A fighter on screen (local or remote): one VRM instance, its animator, the root transform (facing, wall-run
// orientation, flip pivot, smoothed step-ups), spring bones stepped at a fixed rate (they look the same at 60 and
// 144 fps and never explode on teleports), expressions, and the coloured ring on the ground under it.
import * as THREE from 'three';
import { Animator } from '../char/animator.js';
import { ST, PALETTE } from '../shared/config.js';

const SPRING_DT = 1 / 60;
// Level of detail by distance to the camera (6 fighters on screen): up close everything; further out the MToon
// outline hull goes (the screen-space outline pass still draws the silhouette) and the spring bones step at 30 / 15 Hz.
export const LOD = { cam: null, near: 11, far: 26 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const _m = new THREE.Matrix4(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _q = new THREE.Quaternion();
const _g = {};

let ringGeo = null;
function ringGeometry() {
  if (ringGeo) return ringGeo;
  ringGeo = new THREE.RingGeometry(0.46, 0.56, 48, 1);
  ringGeo.rotateX(-Math.PI / 2);
  return ringGeo;
}

export class Fighter {
  /**
   * o: { id, name, slot, local, vrm, rig, lib, world, scene }
   */
  constructor(o) {
    this.id = o.id;
    this.name = o.name;
    this.slot = o.slot ?? 0;
    this.local = !!o.local;
    this.vrm = o.vrm;
    this.world = o.world;
    this.root = new THREE.Group();
    this.root.name = `fighter-${o.id}`;
    this.body = new THREE.Group(); // the VRM sits in here (turned to face -z like our yaw 0)
    this.root.add(this.body);
    this.body.add(this.vrm.scene);
    this.vrm.scene.rotation.y = Math.PI;
    this.anim = new Animator(o.rig, this.vrm, o.lib);
    this.color = new THREE.Color(PALETTE[this.slot % PALETTE.length]);
    // ground ring (its own object so it stays flat on the ground under wall runs and flips)
    this.ring = new THREE.Mesh(ringGeometry(), new THREE.MeshBasicMaterial({ color: this.color, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }));
    this.ring.renderOrder = 2;
    this.ring.material.polygonOffset = true;
    this.ring.material.polygonOffsetFactor = -2;
    this.ring.material.polygonOffsetUnits = -4;
    o.scene.add(this.root);
    o.scene.add(this.ring);
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.yOff = 0; // step-up smoothing (visual only)
    this.wallW = 0;
    this.wallQ = new THREE.Quaternion();
    this.springAcc = 0;
    this.blinkT = 2 + Math.random() * 3;
    this.dead = false;
    this.visible = true;
    this.view = null;
    this.flashT = 0;
    this.root.userData.fighter = this;
    // Materials: the model's shared set (see vrm.js). Per mesh, four variants: with/without the outline hull (LOD and
    // shadow draws) x normal/flashing (own clones of the emissive materials, white for the hit flash).
    const flashOf = new Map();
    this.meshes = [];
    this.vrm.scene.traverse((o) => {
      if (!o.isMesh) return;
      const b = o.userData.baseMaterial || o.material, arr = Array.isArray(b);
      const base = arr ? b : [b];
      const flash = base.map((m) => {
        if (!m.emissive) return m;
        let c = flashOf.get(m);
        if (!c) {
          c = m.clone();
          c.emissive.setScalar(0.85);
          c.update?.(0);
          flashOf.set(m, c);
        }
        return c;
      });
      const cut = (l) => l.filter((m) => !m.isOutline);
      this.meshes.push({ o, arr, v: [base, cut(base), flash, cut(flash)] });
    });
    this.flashClones = [...flashOf.values()];
    this.matKey = -1;
    this.shadowDraw = false;
    // The fighter's world matrices are brought up to date in updateVRM (the spring bones need them mid-update); the
    // renderer's scene-wide pass would compute all ~270 nodes again, so the root skips it once after each updateVRM.
    this.fresh = false;
    const rootUpdate = THREE.Object3D.prototype.updateMatrixWorld;
    this.root.updateMatrixWorld = (force) => {
      if (this.fresh) this.fresh = false;
      else rootUpdate.call(this.root, force);
    };
    // what the updates after that pass move: constraint targets (they only set quaternions) and the bones hanging
    // under spring chains that aren't joints themselves (spring joints update their own world matrices)
    this.afterPass = [];
    for (const c of this.vrm.nodeConstraintManager?.constraints || []) this.afterPass.push(c.destination);
    const joints = new Set([...(this.vrm.springBoneManager?.joints || [])].map((j) => j.bone));
    for (const b of joints) for (const ch of b.children) if (!joints.has(ch)) this.afterPass.push(ch);
    this.lod = -1;
    this.setLod(0);
  }

  /** Puts the right material variant on every mesh (only when it changes). */
  applyMaterials() {
    const key = (this.flashT > 0 ? 2 : 0) + (this.lod === 0 && !this.shadowDraw ? 0 : 1);
    if (key === this.matKey) return;
    this.matKey = key;
    for (const m of this.meshes) m.o.material = m.arr ? m.v[key] : m.v[key][0];
  }

  /** 0 near, 1 mid, 2 far (see LOD); never nearer than `lodMin` (Naruto's clones: no outline hull, 30 Hz springs). */
  setLod(l) {
    l = Math.max(l, this.lodMin || 0);
    if (l === this.lod) return;
    this.lod = l;
    this.applyMaterials();
  }

  /** Shadow maps never need the outline hull (the shadow cache hides it while drawing the casters). */
  hullVisible(on) {
    this.shadowDraw = !on;
    this.applyMaterials();
  }

  /** The white hit flash (a few frames of emissive). */
  flash() {
    this.flashT = 0.1;
  }

  /** Teleport (spawn, substitution): no smoothing, springs reset, feet planted. */
  snap(x, y, z, yaw) {
    this.drawX = undefined; // (the gait takes the simulation's velocity for the frame after a teleport)
    this.pos.set(x, y, z);
    this.yaw = yaw;
    this.yOff = 0;
    this.anim.snap();
    this.place();
    this.root.updateMatrixWorld(true);
    this.vrm.springBoneManager?.reset();
  }

  /**
   * v: the fighter view (see Animator.update) plus x, y, z (drawn feet position), yaw, stepUp, wall: { nx, nz } | null,
   * wallDir: [along, up].
   */
  update(dt, v) {
    this.view = v;
    // the drawn motion this frame (local velocity and turn rate): the gait moves planted feet against exactly what
    // the body does on screen (interpolation between ticks, server corrections), so they never slide; a teleport
    // (more than 2 m in a frame) falls back to the simulation's velocity
    const dx = v.x - (this.drawX ?? v.x), dz = v.z - (this.drawZ ?? v.z);
    if (dt > 1e-4 && this.drawX !== undefined && dx * dx + dz * dz < 4) {
      const s = Math.sin(v.yaw), c = Math.cos(v.yaw);
      v.gvf = (-dx * s - dz * c) / dt;
      v.gvl = (-dx * c + dz * s) / dt;
      let dy = v.yaw - this.drawYaw;
      dy -= Math.round(dy / (Math.PI * 2)) * Math.PI * 2;
      v.gyr = dy / dt;
    } else {
      v.gvf = v.vf;
      v.gvl = v.vl;
      v.gyr = v.yawRate;
    }
    this.drawX = v.x;
    this.drawZ = v.z;
    this.drawYaw = v.yaw;
    const cam = LOD.cam;
    if (cam) {
      const d = cam.position.distanceTo(this.pos);
      // a little hysteresis so a fighter on the boundary doesn't flicker between levels
      const l = this.lod;
      this.setLod(d < LOD.near + (l === 0 ? 1 : 0) ? 0 : d < LOD.far + (l <= 1 ? 2 : 0) ? 1 : 2);
    }
    if (v.stepUp > 0 && v.stepUp < 0.6) this.yOff -= v.stepUp;
    this.yOff *= 1 - damp(18, dt);
    this.pos.set(v.x, v.y + this.yOff, v.z);
    this.yaw = v.yaw;
    // the gait's feet follow the real ground under them (slopes, stairs, roots)
    this.anim.gait.groundAt = v.st === ST.loco || v.st === ST.land ? this.groundLocal : null;
    this.anim.update(dt, v);
    this.anim.apply();
    this.place(dt, v);
    this.updateVRM(dt);
    this.hurt?.update();
    if (this.flashT > 0) {
      this.flashT -= dt;
      for (const m of this.flashClones) m.update?.(dt);
    }
    this.applyMaterials();
    // ring: flat on the ground under the fighter, faded while high above it
    const g = this.world.ground(this.pos.x, this.pos.z, this.pos.y + 0.3, _g);
    this.ring.position.set(this.pos.x, g.y + 0.03, this.pos.z);
    const h = this.pos.y - g.y;
    this.ring.material.opacity = 0.85 * clamp(1 - h / 6, 0.2, 1);
    this.ring.visible = this.visible && !this.dead && !this.noRing;
  }

  /** Terrain height under a character-local point, relative to the feet (for the gait's foot IK). */
  groundLocal = (lx, lz) => {
    // local +x = the character's left, +z = forward; world: rotation by yaw + pi
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const wx = this.pos.x - c * lx - s * lz, wz = this.pos.z + s * lx - c * lz;
    const y0 = this.pos.y - this.yOff;
    const g = this.world.ground(wx, wz, y0 + 0.5, _g);
    return clamp(g.y - y0, -0.45, 0.45);
  };

  place(dt = 0, v = null) {
    this.root.position.copy(this.pos);
    // wall run: stand on the wall (local up = the wall normal, forward = the run direction on it)
    const onWall = v && v.st === ST.wall && v.wall;
    this.wallW += ((onWall ? 1 : 0) - this.wallW) * (dt ? damp(onWall ? 16 : 10, dt) : 1);
    _q.setFromAxisAngle(_y.set(0, 1, 0), this.yaw);
    if (onWall) {
      const n = v.wall;
      _y.set(n.nx, 0, n.nz);
      const [along, up] = v.wallDir || [0, 1];
      // run direction on the wall: along the tangent and/or up
      const tx = -n.nz, tz = n.nx;
      _z.set(tx * along, up, tz * along);
      if (_z.lengthSq() < 1e-4) _z.set(0, 1, 0);
      _z.normalize();
      _x.crossVectors(_y, _z).normalize();
      _z.crossVectors(_x, _y);
      // the VRM faces +z inside `body`, which we turn by pi; build the root so body-forward = _z: root(-x, y, -z)
      _m.makeBasis(_x.negate(), _y, _z.negate());
      this.wallQ.setFromRotationMatrix(_m);
      // feet on the wall: pull the root onto the wall surface, at the body's middle height
      this.root.position.x -= n.nx * 0.3;
      this.root.position.z -= n.nz * 0.3;
      this.root.position.y += 0.75;
    }
    if (this.wallW > 0.001) this.root.quaternion.copy(_q).slerp(this.wallQ, this.wallW);
    else this.root.quaternion.copy(_q);
  }

  updateVRM(dt) {
    const vrm = this.vrm;
    vrm.humanoid.update();
    this.fresh = false;
    this.root.updateMatrixWorld(true);
    // expressions: blink now and then
    const em = vrm.expressionManager;
    if (em) {
      this.blinkT -= dt;
      let b = 0;
      if (this.blinkT < 0.12) b = Math.sin(clamp(1 - this.blinkT / 0.12, 0, 1) * Math.PI);
      if (this.blinkT <= 0) this.blinkT = 2 + Math.random() * 4;
      em.setValue('blink', this.dead ? 1 : b);
      em.update();
    }
    // spring bones at a fixed step: identical motion at any frame rate, and stable after a long frame
    const sb = vrm.springBoneManager;
    if (sb) {
      const step = SPRING_DT * (this.lod === 2 ? 4 : this.lod === 1 ? 2 : 1);
      this.springAcc = Math.min(this.springAcc + dt, step * 2);
      while (this.springAcc >= step) {
        sb.update(step);
        this.springAcc -= step;
      }
    }
    vrm.nodeConstraintManager?.update();
    for (const o of this.afterPass) o.updateMatrixWorld(true);
    this.fresh = true;
  }

  dispose(scene) {
    // hand the VRM back with its shared materials on (the next fighter builds its variants from them)
    this.flashT = 0;
    this.lod = 0;
    this.shadowDraw = false;
    this.applyMaterials();
    for (const m of this.flashClones) m.dispose();
    this.root.removeFromParent();
    this.ring.removeFromParent();
    this.ring.material.dispose();
  }
}
