// Combat and movement effects in one instanced draw: every particle is a camera-facing quad whose whole life is
// animated in the vertex shader from its spawn time (no CPU work per particle after spawning, no allocations).
// Kinds: 0 smoke puff (toon-banded, expands, fades), 1 impact burst (radial speed-line streaks + a hot core),
// 2 spark (streak stretched along its velocity), 3 dust puff, 4 ring (water ripple / shockwave, lies flat),
// 5 flash (a quick soft glow), 6 ember (rises, wanders and flickers: fire). HDR colours above 1 feed the bloom.
import * as THREE from 'three';

const MAX = 1024;

const vert = /* glsl */ `
  attribute vec3 aPos; attribute vec3 aVel; attribute vec4 aTime; // t0, life, size0, size1
  attribute vec4 aColor; attribute vec2 aKind; // kind, seed
  uniform float uTime; uniform float uGravity;
  varying vec2 vUv; varying vec4 vColor; varying float vAge; varying float vKind; varying float vSeed;
  void main() {
    float age = (uTime - aTime.x) / aTime.y;
    vAge = age; vKind = aKind.x; vSeed = aKind.y; vColor = aColor; vUv = position.xy + 0.5;
    if (age < 0.0 || age > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    float t = age * aTime.y;
    vec3 p = aPos;
    float kind = aKind.x;
    // motion: sparks and dust fall, smoke drifts up and slows
    if (kind == 2.0) p += aVel * t + vec3(0.0, -uGravity * 0.5 * t * t, 0.0);
    else if (kind == 0.0 || kind == 3.0) p += aVel * (1.0 - exp(-t * 4.0)) / 4.0;
    else if (kind == 6.0) p += aVel * (1.0 - exp(-t * 1.5)) / 1.5 + vec3(sin(t * 4.3 + aKind.y * 40.0) * 0.35, 0.9 * t, cos(t * 3.1 + aKind.y * 27.0) * 0.35) * t;
    float size = mix(aTime.z, aTime.w, kind == 1.0 ? 1.0 - pow(1.0 - age, 3.0) : sqrt(age));
    if (kind == 4.0) {
      // flat on the ground (xz plane)
      vec3 wp = p + vec3(position.x, 0.0, position.y) * size;
      gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      return;
    }
    vec4 mv = viewMatrix * vec4(p, 1.0);
    vec2 c = position.xy;
    if (kind == 2.0) {
      // stretch along the on-screen velocity
      vec3 v = aVel + vec3(0.0, -uGravity * t, 0.0);
      vec2 dv = (viewMatrix * vec4(v, 0.0)).xy;
      float l = length(dv);
      vec2 d = l > 1e-4 ? dv / l : vec2(1.0, 0.0);
      vec2 n = vec2(-d.y, d.x);
      mv.xy += d * c.x * size * (1.0 + l * 0.05) * 3.0 + n * c.y * size * 0.35;
    } else {
      float a = aKind.y * 6.2831;
      mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
      mv.xy += R * c * size;
    }
    gl_Position = projectionMatrix * mv;
  }`;

const frag = /* glsl */ `
  varying vec2 vUv; varying vec4 vColor; varying float vAge; varying float vKind; varying float vSeed;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  void main() {
    vec2 q = vUv * 2.0 - 1.0;
    float r = length(q);
    vec3 col = vColor.rgb; float a = 0.0;
    if (vKind == 0.0 || vKind == 3.0) {
      // puff: a lumpy disc with two toon bands (lit rim, shadowed core)
      float ang = atan(q.y, q.x);
      float edge = 0.78 + 0.12 * sin(ang * 5.0 + vSeed * 40.0) + 0.06 * sin(ang * 11.0 + vSeed * 17.0);
      float body = step(r, edge * (1.0 - vAge * 0.15));
      float band = step(0.0, q.x * 0.35 + q.y * 0.6 + 0.15);
      col *= mix(0.72, 1.0, band);
      a = body * (1.0 - smoothstep(0.55, 1.0, vAge));
    } else if (vKind == 1.0) {
      // impact: radial speed lines of random length + a hot core
      float ang = atan(q.y, q.x) / 6.2831 + 0.5;
      float cell = floor(ang * 26.0);
      float h = hash(cell + vSeed * 91.0);
      float w = abs(fract(ang * 26.0) - 0.5);
      float len = mix(0.45, 1.0, h);
      float lines = step(w, 0.18 * (1.0 - r)) * step(0.2 + vAge * 0.5, r) * step(r, len) * step(0.35, h);
      // (the core is gone by 70% of the life: smoothstep with edge1 <= edge0 is undefined and filled the whole quad)
      float cr = 0.2 * (1.0 - vAge * 1.4);
      float core = cr > 0.001 ? 1.0 - smoothstep(0.0, cr, r) : 0.0;
      a = max(lines * (1.0 - vAge), core) ;
      col = mix(col, vec3(4.0, 3.6, 3.0), core);
    } else if (vKind == 2.0) {
      a = (1.0 - smoothstep(0.0, 1.0, abs(q.x))) * (1.0 - smoothstep(0.2, 1.0, abs(q.y))) * (1.0 - vAge);
    } else if (vKind == 4.0) {
      a = smoothstep(0.08, 0.0, abs(r - 0.85)) * (1.0 - vAge);
    } else if (vKind == 6.0) {
      // a hot speck that flickers out
      float fl = 0.55 + 0.45 * sin(vAge * 40.0 + vSeed * 60.0);
      a = (1.0 - smoothstep(0.15, 0.55, r)) * (1.0 - vAge) * fl;
      col *= 1.0 + (1.0 - smoothstep(0.0, 0.25, r)) * 0.8;
    } else {
      a = (1.0 - smoothstep(0.0, 1.0, r)) * (1.0 - vAge);
    }
    if (a < 0.01) discard;
    gl_FragColor = vec4(col * vColor.a, a);
  }`;

export class FX {
  constructor(scene) {
    const g = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    g.index = quad.index;
    g.setAttribute('position', quad.attributes.position);
    const A = (n) => new THREE.InstancedBufferAttribute(new Float32Array(MAX * n), n).setUsage(THREE.DynamicDrawUsage);
    this.aPos = A(3);
    this.aVel = A(3);
    this.aTime = A(4);
    this.aColor = A(4);
    this.aKind = A(2);
    for (const [k, a] of [['aPos', this.aPos], ['aVel', this.aVel], ['aTime', this.aTime], ['aColor', this.aColor], ['aKind', this.aKind]]) g.setAttribute(k, a);
    g.instanceCount = MAX;
    // every particle starts dead
    for (let i = 0; i < MAX; i++) this.aTime.array[i * 4] = -1e6;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uGravity: { value: 12 } },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    // additive copy for the glowing kinds (bursts, sparks, flashes)
    this.addMat = this.mat.clone();
    this.addMat.blending = THREE.AdditiveBlending;
    this.addMat.uniforms = this.mat.uniforms;
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
    this.glow = new THREE.Mesh(g, this.addMat);
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 6;
    scene.add(this.glow);
    this.next = 0;
    this.time = 0;
    this.dirty = [MAX, 0];
    // kinds drawn by each mesh: smoke/dust/ring normal-blended, the rest additive (the alpha test in the shader
    // discards the other set: a particle is written into both, each material shows its own kinds)
    this.mat.onBeforeCompile = (s) => (s.fragmentShader = s.fragmentShader.replace('if (a < 0.01) discard;', 'if (a < 0.01 || vKind == 1.0 || vKind == 2.0 || vKind == 5.0 || vKind == 6.0) discard;'));
    this.addMat.onBeforeCompile = (s) => (s.fragmentShader = s.fragmentShader.replace('if (a < 0.01) discard;', 'if (a < 0.01 || vKind == 0.0 || vKind == 3.0 || vKind == 4.0) discard;'));
    this.mat.customProgramCacheKey = () => 'fx-normal';
    this.addMat.customProgramCacheKey = () => 'fx-add';
  }

  emit(kind, x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a = 1) {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    this.aPos.array.set([x, y, z], i * 3);
    this.aVel.array.set([vx, vy, vz], i * 3);
    this.aTime.array.set([this.time, life, s0, s1], i * 4);
    this.aColor.array.set([r, g, b, a], i * 4);
    this.aKind.array[i * 2] = kind;
    this.aKind.array[i * 2 + 1] = Math.random();
    this.dirty[0] = Math.min(this.dirty[0], i);
    this.dirty[1] = Math.max(this.dirty[1], i + 1);
  }

  /** The orange impact burst (screenshot 4): radial streaks, a flash, sparks. weight 1..4. */
  impact(p, weight = 1, color = [3.2, 1.5, 0.35]) {
    const s = 0.5 + weight * 0.18;
    this.emit(1, p.x, p.y, p.z, 0, 0, 0, 0.16 + weight * 0.025, s * 0.35, s * 1.35, color[0], color[1], color[2]);
    this.emit(5, p.x, p.y, p.z, 0, 0, 0, 0.07, s * 0.25, s * 0.55, 2.2, 1.9, 1.5);
    const n = 6 + weight * 4;
    for (let k = 0; k < n; k++) {
      const u = Math.random() * 2 - 1, th = Math.random() * 6.283, sp = 5 + Math.random() * 7 * weight;
      const sq = Math.sqrt(1 - u * u);
      this.emit(2, p.x, p.y, p.z, Math.cos(th) * sq * sp, u * sp * 0.8 + 2, Math.sin(th) * sq * sp, 0.18 + Math.random() * 0.2, 0.05, 0.03, 3.5, 2.0, 0.6);
    }
  }

  /** A blocked hit: blue-white sparks. */
  block(p) {
    this.emit(5, p.x, p.y, p.z, 0, 0, 0, 0.1, 0.25, 0.6, 1.2, 1.8, 3);
    for (let k = 0; k < 8; k++) {
      const th = Math.random() * 6.283, sp = 4 + Math.random() * 4;
      this.emit(2, p.x, p.y, p.z, Math.cos(th) * sp, 2 + Math.random() * 3, Math.sin(th) * sp, 0.2, 0.04, 0.02, 1.6, 2.2, 3.5);
    }
  }

  /** Smoke poof (substitution, shadow clones). */
  poof(p, scale = 1) {
    for (let k = 0; k < 9; k++) {
      const th = (k / 9) * 6.283, sp = 1.5 * scale;
      this.emit(0, p.x + Math.cos(th) * 0.2, p.y + 0.6 + Math.random() * 0.8 * scale, p.z + Math.sin(th) * 0.2, Math.cos(th) * sp, 0.8 + Math.random(), Math.sin(th) * sp, 0.55 + Math.random() * 0.25, 0.4 * scale, 1.0 * scale, 0.95, 0.95, 0.97);
    }
    this.emit(0, p.x, p.y + 0.9, p.z, 0, 0.6, 0, 0.6, 0.6 * scale, 1.4 * scale, 1, 1, 1);
  }

  /** Dust kicked up on stops, landings and dashes. */
  dust(p, n = 4, spread = 1, color = [0.78, 0.7, 0.58]) {
    for (let k = 0; k < n; k++) {
      const th = Math.random() * 6.283, sp = (0.8 + Math.random() * 1.5) * spread;
      this.emit(3, p.x, p.y + 0.08, p.z, Math.cos(th) * sp, 0.4 + Math.random() * 0.6, Math.sin(th) * sp, 0.45 + Math.random() * 0.3, 0.12, 0.45 * spread, color[0], color[1], color[2]);
    }
  }

  /** Embers rising off a fire (n specks within `spread` metres). */
  embers(x, y, z, n = 3, spread = 1, up = 2) {
    for (let k = 0; k < n; k++) {
      const th = Math.random() * 6.283, r = Math.random() * spread;
      this.emit(6, x + Math.cos(th) * r, y + Math.random() * spread * 0.5, z + Math.sin(th) * r, Math.cos(th) * 0.8, up * (0.6 + Math.random() * 0.8), Math.sin(th) * 0.8, 0.9 + Math.random() * 1.1, 0.045, 0.02, 3.6, 1.4 + Math.random() * 0.6, 0.25);
    }
  }

  ripple(p, size = 1) {
    this.emit(4, p.x, p.y + 0.02, p.z, 0, 0, 0, 0.7, 0.1, 1.1 * size, 0.9, 0.97, 1.0, 0.9);
  }

  update(dt) {
    this.time += dt;
    this.mat.uniforms.uTime.value = this.time;
    if (this.dirty[1] > this.dirty[0]) {
      for (const a of [this.aPos, this.aVel, this.aTime, this.aColor, this.aKind]) {
        a.clearUpdateRanges();
        a.addUpdateRange(this.dirty[0] * a.itemSize, (this.dirty[1] - this.dirty[0]) * a.itemSize);
        a.needsUpdate = true;
      }
      this.dirty[0] = MAX;
      this.dirty[1] = 0;
    }
  }
}
