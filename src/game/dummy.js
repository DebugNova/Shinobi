// The training dummy (a log man on a post on the training field) and the logs a Substitution Jutsu leaves behind.
// The dummy takes hits like any fighter (validated by the server, id 0), wobbles on a spring, shows damage numbers
// and the combo count, and heals when left alone.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PostHurtbox } from './hurtbox.js';

const wood = () => new THREE.MeshLambertMaterial({ color: 0x9a6a3e });

function logGeometry(len, r) {
  const g = new THREE.CylinderGeometry(r, r * 1.05, len, 12, 1);
  // cut ends a lighter colour: a second group
  return g;
}

export class Dummy {
  constructor(game, info) {
    this.game = game;
    this.id = 0;
    this.info = info;
    const [x, y, z] = info.s;
    this.pos = new THREE.Vector3(x, y, z);
    this.root = new THREE.Group();
    this.root.position.copy(this.pos);
    this.root.rotation.y = info.s[6];
    this.pivot = new THREE.Group(); // wobbles about the base
    this.root.add(this.pivot);
    const body = new THREE.Mesh(logGeometry(1.35, 0.26), wood());
    body.position.y = 0.95;
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.34, 12), wood());
    head.position.y = 1.8;
    const arms = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.1, 8).rotateZ(Math.PI / 2), wood());
    arms.position.y = 1.35;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.5, 8), new THREE.MeshLambertMaterial({ color: 0x5a4030 }));
    post.position.y = 0.25;
    const rope = new THREE.Mesh(new THREE.TorusGeometry(0.265, 0.025, 6, 20).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xd9c9a0 }));
    rope.position.y = 1.2;
    for (const m of [body, head, arms, post, rope]) {
      m.castShadow = true;
      m.receiveShadow = true;
      (m === post ? this.root : this.pivot).add(m);
    }
    game.scene.add(this.root);
    this.hurt = new PostHurtbox(x, y, z);
    this.wob = 0;
    this.wobV = 0;
    this.wobDir = 0;
    this.combo = null;
    this.hp = 1000;
    this.dead = false;
  }

  /** A predicted hit on our screen. */
  hit(res, at) {
    this.wobV += 4 + res.dmg * 0.04;
    const g = this.game, b = g.ctrl.body;
    this.wobDir = Math.atan2(this.pos.x - b.x, this.pos.z - b.z);
    this.combo = { n: this.combo && at / 1000 < this.combo.until + 0.6 ? this.combo.n + 1 : 1, start: at / 1000, until: at / 1000 + 0.6 };
    g.hud.damage?.(this.pos, res.dmg, this.combo.n);
  }

  /** The server's result (someone hit the dummy). */
  confirm(m) {
    this.hp = m.hp;
    if (m.a !== this.game.net.id) {
      this.wobV += 4 + m.d * 0.04;
      this.game.fx.impact(this.hurt.center, 1.5);
    }
  }

  update(dt) {
    // a damped spring leaning away from the hits
    this.wobV += (-120 * this.wob - 7 * this.wobV) * dt;
    this.wob += this.wobV * dt;
    const a = Math.max(-0.6, Math.min(0.6, this.wob * 0.12));
    this.pivot.rotation.set(Math.cos(this.wobDir - this.root.rotation.y) * a, 0, -Math.sin(this.wobDir - this.root.rotation.y) * a);
  }
}

/** Substitution logs: a log appears where the fighter stood, tumbles and falls, then sinks away. */
export class Logs {
  constructor(scene) {
    this.scene = scene;
    this.pool = [];
    const geo = mergeGeometries([new THREE.CylinderGeometry(0.2, 0.22, 1.3, 10), new THREE.CylinderGeometry(0.04, 0.05, 0.3, 5).rotateZ(1.1).translate(0.18, 0.2, 0)]);
    this.geo = geo;
    this.mat = new THREE.MeshLambertMaterial({ color: 0x8a5a34 });
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(geo, this.mat);
      m.castShadow = true;
      m.visible = false;
      scene.add(m);
      this.pool.push({ m, t: 99, vy: 0, spin: 0, y0: 0, ground: 0 });
    }
    this.world = null;
  }

  spawn(p, yaw) {
    const L = this.pool.find((l) => l.t > 3) || this.pool[0];
    L.t = 0;
    L.m.visible = true;
    L.m.position.set(p.x, p.y + 0.9, p.z);
    L.m.rotation.set(0.15, yaw, 0.1);
    L.vy = 1.5;
    L.spin = (Math.random() - 0.5) * 6;
    L.ground = this.world ? this.world.ground(p.x, p.z, p.y + 1, {}).y : p.y;
  }

  update(dt) {
    for (const L of this.pool) {
      if (L.t > 3) continue;
      L.t += dt;
      const m = L.m;
      if (m.position.y > L.ground + 0.22) {
        L.vy -= 20 * dt;
        m.position.y = Math.max(L.ground + 0.22, m.position.y + L.vy * dt);
        m.rotation.z += L.spin * dt;
        m.rotation.x = Math.min(Math.PI / 2, m.rotation.x + dt * 5);
      } else m.rotation.x = Math.PI / 2;
      if (L.t > 2.4) m.position.y -= dt * 0.6;
      if (L.t > 3) m.visible = false;
    }
  }
}
