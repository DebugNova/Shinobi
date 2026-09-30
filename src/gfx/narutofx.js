// Naruto's kit visuals (src/game/naruto.js drives them; all created up front, compiled behind the loading screen):
//   Afterimages    frozen copies of a fighter's body at an instant (its skinned mesh merged into one geometry per model,
//                  a frozen bone texture per ghost): a rim-lit translucent silhouette that fades in ~0.2 s. One draw each.
//   RasenganBlast  the Rasengan's impact: a swirling sphere bursting out (about a body across, gone in a quarter of a
//                  second) and a drill of three spiral wind rings driven out along the push, each later, farther and
//                  smaller, with a bright shock rim; the big one wider and longer
// HDR colours above 1 feed the bloom; everything here is additive light.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rasenganMaterial } from './jutsufx.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ss = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------- afterimages

const ghostVert = /* glsl */ `
  #include <common>
  #include <skinning_pars_vertex>
  varying vec3 vN; varying vec3 vV; varying float vH;
  void main() {
    #include <beginnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <defaultnormal_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>
    #include <project_vertex>
    vN = normalize(transformedNormal);
    vV = normalize(-mvPosition.xyz);
    vH = (modelMatrix * vec4(transformed, 1.0)).y;
  }`;
const ghostFrag = /* glsl */ `
  uniform vec3 uColor; uniform float uAlpha; uniform float uBase;
  varying vec3 vN; varying vec3 vV; varying float vH;
  void main() {
    // a rim-lit silhouette: bright edges, a faint body, thinning toward the feet (the smear trails off the ground)
    float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
    float a = uAlpha * (0.14 + 0.86 * pow(f, 1.6)) * clamp((vH - uBase) * 1.6 + 0.35, 0.0, 1.0);
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor * a, 1.0);
  }`;

/**
 * Afterimages of fighters. Per character model a template: every skinned primitive of its body merged into one
 * geometry (position, normal, skin attributes: the combined skeleton's indices), so a ghost is one draw whatever the
 * model. A ghost = that geometry on a frozen skeleton whose bone matrices are copied from a fighter at one instant
 * (the renderer's per-frame skeleton update is switched off for it).
 */
export class Afterimages {
  constructor(scene) {
    this.scene = scene;
    this.templates = new Map(); // model -> { geo, bindMatrix, n (bones), ghosts: [] }
    this.all = [];
  }

  /** Builds a model's template and its ghosts (at load). vrm: any instance of it. */
  prepare(model, vrm, count = 10) {
    if (this.templates.has(model)) return;
    const meshes = [];
    vrm.scene.traverse((o) => o.isSkinnedMesh && meshes.push(o));
    if (!meshes.length) return;
    const skel = meshes[0].skeleton;
    // one skeleton for the whole body (VRMUtils.combineSkeletons): its primitives merge into one geometry
    // (plain typed copies: glTF attributes may be interleaved, normalized or of mixed types, which the merge refuses)
    const copy = (a, n, Arr) => {
      const out = new Arr(a.count * n);
      for (let i = 0; i < a.count; i++) for (let c = 0; c < n; c++) out[i * n + c] = a.getComponent(i, c);
      return new THREE.BufferAttribute(out, n);
    };
    const parts = meshes.filter((o) => o.skeleton === skel && o.bindMatrix.equals(meshes[0].bindMatrix)).map((o) => {
      const g = new THREE.BufferGeometry(), A = o.geometry.attributes;
      if (!A.position || !A.normal || !A.skinIndex || !A.skinWeight) return null;
      g.setAttribute('position', copy(A.position, 3, Float32Array));
      g.setAttribute('normal', copy(A.normal, 3, Float32Array));
      g.setAttribute('skinIndex', copy(A.skinIndex, 4, Uint16Array));
      g.setAttribute('skinWeight', copy(A.skinWeight, 4, Float32Array));
      const idx = o.geometry.index;
      const ix = new Uint32Array(idx ? idx.count : A.position.count);
      for (let i = 0; i < ix.length; i++) ix[i] = idx ? idx.getX(i) : i;
      g.setIndex(new THREE.BufferAttribute(ix, 1));
      return g;
    }).filter(Boolean);
    const geo = parts.length ? mergeGeometries(parts, false) : null;
    if (!geo) return;
    const T = { geo, bindMatrix: meshes[0].bindMatrix.clone(), n: skel.bones.length, inv: skel.boneInverses, ghosts: [] };
    for (let i = 0; i < count; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uAlpha: { value: 0 }, uBase: { value: 0 } },
        vertexShader: ghostVert, fragmentShader: ghostFrag,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const bones = Array.from({ length: T.n }, () => new THREE.Bone());
      const sk = new THREE.Skeleton(bones, T.inv.map((m) => m.clone()));
      sk.computeBoneTexture();
      sk.update = () => {}; // frozen: the snapshot's matrices stay
      const m = new THREE.SkinnedMesh(geo, mat);
      m.bind(sk, T.bindMatrix);
      m.frustumCulled = false;
      m.renderOrder = 6;
      m.visible = false;
      m.matrixAutoUpdate = false;
      this.scene.add(m);
      const gh = { m, mat, sk, t: -1, life: 0.2, a0: 0.5 };
      T.ghosts.push(gh);
      this.all.push(gh);
    }
    this.templates.set(model, T);
  }

  /**
   * A ghost of `fighter` (drawn with `model`) as it is on screen now: colour (HDR), life (s), starting alpha. The
   * fighter's bones must be fresh (after its update this frame).
   */
  spawn(model, fighter, color, life = 0.2, alpha = 0.5) {
    const T = this.templates.get(model);
    if (!T || !fighter?.vrm) return;
    const skel = fighter._skel || (fighter._skel = findSkeleton(fighter.vrm));
    if (!skel || skel.bones.length !== T.n) return;
    // a free ghost, else the oldest
    let g = null;
    for (const x of T.ghosts) if (x.t < 0 && !g) g = x;
    if (!g) g = T.ghosts.reduce((a, b) => (a.t > b.t ? a : b));
    const out = g.sk.boneMatrices;
    for (let i = 0; i < T.n; i++) {
      _m.multiplyMatrices(skel.bones[i].matrixWorld, skel.boneInverses[i]);
      _m.toArray(out, i * 16);
    }
    g.sk.boneTexture.needsUpdate = true;
    g.mat.uniforms.uColor.value.setRGB(color[0], color[1], color[2]);
    g.mat.uniforms.uBase.value = fighter.pos.y;
    g.t = 0;
    g.life = life;
    g.a0 = alpha;
    g.m.visible = true;
    g.mat.uniforms.uAlpha.value = alpha;
  }

  update(dt) {
    for (const g of this.all) {
      if (g.t < 0) continue;
      g.t += dt;
      const k = g.t / g.life;
      if (k >= 1) {
        g.t = -1;
        g.m.visible = false;
        continue;
      }
      g.mat.uniforms.uAlpha.value = g.a0 * (1 - k) ** 1.4;
    }
  }

  /** Everything whose program must compile at load (one ghost of each model, shown for the warm-up). */
  warmObjects() {
    return [...this.templates.values()].map((T) => T.ghosts[0].m);
  }
}

const _m = new THREE.Matrix4();
function findSkeleton(vrm) {
  let s = null;
  vrm.scene.traverse((o) => {
    if (!s && o.isSkinnedMesh) s = o.skeleton;
  });
  return s;
}

// ---------------------------------------------------------------- the Rasengan's impact

const vortexMat = () => new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uAge: { value: 0 }, uBig: { value: 0 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform float uTime; uniform float uAge; uniform float uBig; varying vec2 vUv;
    void main() {
      // a spiral of wind: arms wound on log(r), spinning, bright near the core, torn at the rim, fading with age
      vec2 q = vUv * 2.0 - 1.0;
      float r = length(q);
      if (r > 1.0) discard;
      float a = atan(q.y, q.x);
      float arms = sin(a * 5.0 + log(max(r, 0.02)) * 7.0 - uTime * 26.0);
      float band = smoothstep(0.35, 0.95, arms);
      float rim = 1.0 - smoothstep(0.62 + 0.28 * (1.0 - uAge), 1.0, r);
      float hole = smoothstep(0.05, 0.22, r);
      // a thin shock rim riding the edge out (brightest early), torn by the arms
      float shock = exp(-pow((r - 0.9) / 0.035, 2.0)) * (0.55 + 0.45 * arms) * (1.0 - uAge);
      float al = band * rim * hole * (1.0 - uAge) * (1.0 - uAge) + shock * 0.9;
      if (al < 0.01) discard;
      vec3 col = mix(vec3(0.9, 2.2, 3.8), vec3(2.6, 3.2, 3.8), 1.0 - smoothstep(0.0, 0.5, r)) * (0.8 + 0.4 * uBig);
      gl_FragColor = vec4(col * al, 1.0);
    }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
});

// the drill: ring k starts `delay` s late, travels to `at` m along the push, spreads to `size` of the blast's disc radius
const RINGS = [{ delay: 0, at: 0.2, size: 1 }, { delay: 0.035, at: 0.75, size: 0.8 }, { delay: 0.07, at: 1.3, size: 0.62 }];

/** One impact: a sphere of swirling chakra bursting out, a drill of spiral wind rings along the push direction. */
class Blast {
  constructor(scene) {
    this.sphere = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 4), rasenganMaterial());
    const plane = new THREE.PlaneGeometry(2, 2);
    this.discs = RINGS.map(() => new THREE.Mesh(plane, vortexMat()));
    for (const m of [this.sphere, ...this.discs]) {
      m.frustumCulled = false;
      m.renderOrder = 8;
      m.visible = false;
      scene.add(m);
    }
    this.p = new THREE.Vector3();
    this.dir = new THREE.Vector3(0, 0, 1);
    this.t = -1;
  }

  fire(p, dir, big) {
    this.t = 0;
    this.big = big ? 1 : 0;
    this.life = big ? 0.46 : 0.38;
    // (the sphere about a body across, not a beach ball over the victim: the first pass burst it to 2 m and it hid
    // everything, the vortex included)
    this.R = big ? 0.62 : 0.48;
    this.D = big ? 1.5 : 1.15;
    this.p.copy(p);
    this.sphere.position.copy(p);
    // the rings face along the push (the wind drives the victim away through them)
    _d.copy(dir);
    if (_d.lengthSq() < 1e-6) _d.set(0, 0, 1);
    this.dir.copy(_d.normalize());
    for (const m of this.discs) {
      m.quaternion.setFromUnitVectors(_z, this.dir);
      m.material.uniforms.uBig.value = this.big;
    }
  }

  update(dt, time) {
    if (this.t < 0) return;
    this.t += dt;
    const k = this.t / this.life;
    if (k >= 1.25) {
      this.t = -1;
      this.sphere.visible = false;
      for (const m of this.discs) m.visible = false;
      return;
    }
    // the sphere: out fast (ease-out cubic), thinning at once, gone by 70% of the life
    const e = 1 - (1 - Math.min(1, k * 2.8)) ** 3;
    this.sphere.visible = k < 0.7;
    this.sphere.scale.setScalar(this.R * (0.35 + 0.65 * e));
    this.sphere.rotation.set(time * 6, time * 9, 0);
    const u = this.sphere.material.uniforms;
    u.uTime.value = time;
    // (restrained: a bright burst that thins at once, never a screen of white up close)
    u.uAmt.value = 0.36 * (1 - ss(0.05, 0.7, k)) * (1 + this.big * 0.15);
    // the drill: each ring driven out along the push, spreading, spinning, thinning out
    RINGS.forEach((Rg, n) => {
      const m = this.discs[n], a = (this.t - Rg.delay) / this.life;
      m.visible = a > 0 && a < 1;
      if (!m.visible) return;
      const ea = 1 - (1 - a) ** 2.2;
      m.position.copy(this.p).addScaledVector(this.dir, Rg.at * (0.3 + 0.7 * ea) * (1 + this.big * 0.3));
      m.scale.setScalar(this.D * Rg.size * (0.3 + 0.7 * ea));
      m.material.uniforms.uTime.value = time + n * 0.37;
      m.material.uniforms.uAge.value = a;
    });
  }
}
const _d = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1);

export class RasenganBlasts {
  constructor(scene) {
    this.pool = Array.from({ length: 3 }, () => new Blast(scene));
    this.time = 0;
  }

  fire(p, dir, big) {
    const b = this.pool.find((x) => x.t < 0) || this.pool.reduce((a, c) => (a.t > c.t ? a : c));
    b.fire(p, dir, big);
  }

  update(dt) {
    this.time += dt;
    for (const b of this.pool) b.update(dt, this.time);
  }

  warmObjects() {
    return this.pool.flatMap((b) => [b.sphere, ...b.discs]);
  }
}
