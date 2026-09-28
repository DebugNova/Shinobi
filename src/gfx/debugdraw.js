// F4 debug view: every hurtbox capsule (green), attack hitboxes as they are swept (red, fading), and where the server's
// rewound history had the victim of each confirmed hit (yellow standing capsule). One LineSegments buffer rebuilt each
// frame while on; drawn over everything. Debug only: its program compiles on the first F4.
import * as THREE from 'three';

const MAX = 60000; // vertices
const SEG = 12;
const _u = new THREE.Vector3(), _v = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Vector3();
const GREEN = [0.2, 1, 0.35], RED = [1, 0.15, 0.1], YELLOW = [1, 0.9, 0.1];

export class DebugDraw {
  constructor(scene) {
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, toneMapped: false }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 10;
    this.lines.visible = false;
    scene.add(this.lines);
    this.n = 0;
    this.timed = []; // { a, b, r, c, ttl, life }
  }

  setOn(on) {
    this.lines.visible = on;
    if (!on) this.timed.length = 0;
  }

  /** An attack's hitbox capsule this frame (from Combat.detect). */
  hitbox(a, b, r) {
    if (this.timed.length < 400) this.timed.push({ a: a.clone(), b: b.clone(), r, c: RED, ttl: 0.3, life: 0.3 });
  }

  /** The server's rewound victim position of a confirmed hit. */
  rewound(p) {
    this.timed.push({ a: new THREE.Vector3(p[0], p[1] + 0.35, p[2]), b: new THREE.Vector3(p[0], p[1] + 1.4, p[2]), r: 0.35, c: YELLOW, ttl: 1.5, life: 1.5 });
  }

  /** hurts: Hurtbox-like objects ({ caps: [{ a, b, r }], valid }). */
  update(dt, hurts) {
    this.n = 0;
    for (const h of hurts) if (h && h.valid !== false) for (const c of h.caps) this.capsule(c.a, c.b, c.r, GREEN, 1);
    for (let i = this.timed.length - 1; i >= 0; i--) {
      const t = this.timed[i];
      t.ttl -= dt;
      if (t.ttl <= 0) {
        this.timed.splice(i, 1);
        continue;
      }
      this.capsule(t.a, t.b, t.r, t.c, Math.min(1, (t.ttl / t.life) * 2));
    }
    const g = this.lines.geometry;
    g.setDrawRange(0, this.n);
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }

  seg(p, q, c, k) {
    if (this.n + 2 > MAX) return;
    let i = this.n * 3;
    for (const v of [p, q]) {
      this.pos[i] = v.x;
      this.pos[i + 1] = v.y;
      this.pos[i + 2] = v.z;
      this.col[i] = c[0] * k;
      this.col[i + 1] = c[1] * k;
      this.col[i + 2] = c[2] * k;
      i += 3;
    }
    this.n += 2;
  }

  /** A wire capsule: a ring at each end, four side lines, and two half-arcs over each cap. */
  capsule(a, b, r, c, k) {
    _d.subVectors(b, a);
    const len = _d.length();
    if (len < 1e-5) _d.set(0, 1, 0);
    else _d.divideScalar(len);
    _u.set(1, 0, 0);
    if (Math.abs(_d.x) > 0.9) _u.set(0, 0, 1);
    _u.cross(_d).normalize();
    _v.crossVectors(_d, _u);
    for (const [o, s] of [[a, -1], [b, 1]]) {
      for (let i = 0; i < SEG; i++) {
        const t0 = (i / SEG) * Math.PI * 2, t1 = ((i + 1) / SEG) * Math.PI * 2;
        _p.copy(o).addScaledVector(_u, Math.cos(t0) * r).addScaledVector(_v, Math.sin(t0) * r);
        _q.copy(o).addScaledVector(_u, Math.cos(t1) * r).addScaledVector(_v, Math.sin(t1) * r);
        this.seg(_p, _q, c, k);
      }
      // cap arcs in the two planes through the axis
      for (const w of [_u, _v]) {
        for (let i = 0; i < SEG / 2; i++) {
          const t0 = (i / (SEG / 2)) * Math.PI, t1 = ((i + 1) / (SEG / 2)) * Math.PI;
          _p.copy(o).addScaledVector(w, Math.cos(t0) * r).addScaledVector(_d, Math.sin(t0) * r * s);
          _q.copy(o).addScaledVector(w, Math.cos(t1) * r).addScaledVector(_d, Math.sin(t1) * r * s);
          this.seg(_p, _q, c, k);
        }
      }
    }
    for (let i = 0; i < 4; i++) {
      const t = (i / 4) * Math.PI * 2;
      _p.copy(a).addScaledVector(_u, Math.cos(t) * r).addScaledVector(_v, Math.sin(t) * r);
      _q.copy(b).addScaledVector(_u, Math.cos(t) * r).addScaledVector(_v, Math.sin(t) * r);
      this.seg(_p, _q, c, k);
    }
  }
}
