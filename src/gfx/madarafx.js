// Madara's jutsu visuals, cel-shaded to match the toon world (all created up front, pooled, compiled behind the
// loading screen; nothing is allocated mid-fight):
//   Billows       big rolling blobs of anime fire and smoke: one instanced draw of fbm-displaced icospheres. Opaque
//                 with a noise erosion instead of blending (they write depth, so the ink outline pass draws round them,
//                 and there is no overdraw), toon-banded by heat: white-yellow core -> orange -> deep red -> dark smoke.
//                 HDR colours feed the bloom. Positions come from the CPU (the wave's path follows the terrain).
//   WaveDecal     the wave's footprint on the ground: a glowing band under the rolling front, then scorch that fades.
//   FieldFlames   camera-facing flame tongues for the burning field (cylindrical billboards, toon bands).
// No lights are added (programs are keyed by lights: gotcha 17); every glow is emissive + bloom.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMSpringBoneCollider, VRMSpringBoneColliderShapePlane } from '@pixiv/three-vrm';

const NOISE = /* glsl */ `
  float mh3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float mn3(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(mh3(i), mh3(i + vec3(1,0,0)), f.x), mix(mh3(i + vec3(0,1,0)), mh3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(mh3(i + vec3(0,0,1)), mh3(i + vec3(1,0,1)), f.x), mix(mh3(i + vec3(0,1,1)), mh3(i + vec3(1,1,1)), f.x), f.y), f.z); }
  float mfbm(vec3 p) { return mn3(p) * 0.55 + mn3(p * 2.03) * 0.3 + mn3(p * 4.1) * 0.15; }
  // 4x4 ordered dither threshold (screen-door transparency for opaque, outlined surfaces)
  float bayer4(vec2 fc) {
    ivec2 p = ivec2(mod(fc, 4.0));
    int i = p.x + p.y * 4;
    int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
    return (float(m[i]) + 0.5) / 16.0;
  }`;

// toon fire ramp: value -> colour bands (HDR above 1 blooms)
const RAMP = /* glsl */ `
  // (linear HDR: the tone mapper and the bloom (threshold 1.05) take it from here; keep the body saturated so
  // it reads orange, not white; only the core crosses into white-yellow)
  vec3 fireRamp(float v) {
    if (v > 0.9) return vec3(2.1, 1.55, 0.55);
    if (v > 0.72) return vec3(1.3, 0.62, 0.07);
    if (v > 0.47) return vec3(0.95, 0.24, 0.022);
    if (v > 0.28) return vec3(0.5, 0.06, 0.012);
    return vec3(0.05, 0.022, 0.02);
  }
  vec3 smokeRamp(float l) {
    return l > 0.58 ? vec3(0.11, 0.09, 0.095) : l > 0.32 ? vec3(0.06, 0.047, 0.055) : vec3(0.03, 0.024, 0.03);
  }`;

// ---------------------------------------------------------------- billows

const BILLOW_MAX = 900;

export class Billows {
  /**
   * soft: alpha-blended smoke (fresnel-soft edges, dissolving), else opaque fire with ink outlines; black: the fire is
   * Amaterasu's (Itachi: jet black, the rims smouldering crimson-violet)
   */
  constructor(scene, soft = false, black = false) {
    const ico = new THREE.IcosahedronGeometry(1, 2);
    const g = new THREE.InstancedBufferGeometry();
    g.index = ico.index;
    g.setAttribute('position', ico.attributes.position);
    g.setAttribute('normal', ico.attributes.normal);
    const A = (n) => new THREE.InstancedBufferAttribute(new Float32Array(BILLOW_MAX * n), n).setUsage(THREE.DynamicDrawUsage);
    this.aPos = A(4); // x, y, z, radius
    this.aData = A(4); // heat 0..1, erosion 0..1, seed, smoke 0..1
    this.aDir = A(4); // motion direction xyz, stretch (1 = round; fast blobs stretch along their motion)
    g.setAttribute('iPos', this.aPos);
    g.setAttribute('iData', this.aData);
    g.setAttribute('iDir', this.aDir);
    g.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uSun: { value: new THREE.Vector3(0.4, 0.8, 0.3) } }]),
      fog: true,
      defines: soft ? { SOFT: '' } : black ? { BLACK: '' } : {},
      transparent: soft,
      depthWrite: !soft,
      vertexShader: /* glsl */ `
        attribute vec4 iPos; attribute vec4 iData; attribute vec4 iDir;
        uniform float uTime;
        varying vec3 vN; varying vec3 vObj; varying vec4 vData; varying vec3 vView; varying float vDist;
        #include <fog_pars_vertex>
        ${NOISE}
        void main() {
          vData = iData;
          if (iPos.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          vec3 n = normalize(position);
          // lumpy, rolling surface: noise scrolled up and through each blob
          float d = mfbm(n * 1.6 + vec3(iData.z * 17.0, iData.z * 5.0 - uTime * 1.3, iData.z * 11.0));
          vec3 p = n * (0.7 + 0.62 * d) * iPos.w;
          // speed stretch: an ellipsoid along the motion (a jet reads as a jet, not a pile of balls)
          if (iDir.w > 1.001) p += iDir.xyz * dot(p, iDir.xyz) * (iDir.w - 1.0);
          vObj = n + vec3(iData.z * 9.0);
          vN = normalize(n + (d - 0.5) * 0.8 * n);
          vec4 mvPosition = viewMatrix * vec4(iPos.xyz + p, 1.0);
          vView = normalize(-mvPosition.xyz);
          vDist = -mvPosition.z;
          vN = normalize((viewMatrix * vec4(vN, 0.0)).xyz);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uSun;
        varying vec3 vN; varying vec3 vObj; varying vec4 vData; varying vec3 vView; varying float vDist;
        #include <fog_pars_fragment>
        ${NOISE}
        ${RAMP}
        void main() {
          #ifdef SOFT
          // smoke: soft at the silhouette, wisps dissolving over its life, lit by the sun in two bands
          float n = mfbm(vObj * 2.0 + vec3(0.0, -uTime * 1.4, 0.0));
          float fc = clamp(dot(normalize(vN), normalize(vView)), 0.0, 1.0);
          float a = smoothstep(0.02, 0.55, fc) * smoothstep(vData.y * 0.95 - 0.15, vData.y * 0.95 + 0.2, n) * smoothstep(0.5, 3.0, vDist);
          a *= 1.0 - smoothstep(0.55, 1.0, vData.y);
          if (a < 0.02) discard;
          vec3 sn = normalize((viewMatrix * vec4(uSun, 0.0)).xyz);
          vec3 col = smokeRamp(dot(normalize(vN), sn) * 0.5 + 0.5 + (n - 0.5) * 0.3);
          col += vec3(0.9, 0.2, 0.03) * vData.x * clamp(-normalize(vN).y, 0.0, 1.0);
          gl_FragColor = vec4(col, a * 0.92);
          #else
          float n = mfbm(vObj * 2.6 + vec3(0.0, -uTime * 2.2, 0.0));
          // erosion: the blob breaks up into holes as it burns out; right at the camera it dissolves (a fighter
          // caught in the torrent keeps a view through it instead of a screen of flat orange)
          #ifdef BLACK
          // (flames clinging to a body: seen from the burning fighter's own camera, 3 m off; they only thin out right at the lens)
          if (n < vData.y * 1.15 - 0.12 || smoothstep(0.3, 1.1, vDist) < bayer4(gl_FragCoord.xy)) discard;
          #else
          if (n < vData.y * 1.15 - 0.12 || smoothstep(1.2, 4.5, vDist) < bayer4(gl_FragCoord.xy)) discard;
          #endif
          float facing = clamp(dot(normalize(vN), normalize(vView)), 0.0, 1.0);
          float up = normalize(vN).y;
          vec3 col;
          if (vData.w < 0.5) {
            // hot where the blob faces you (its core), red at the rims, broken up by the noise
            float v = vData.x * 0.5 + facing * 0.42 + (n - 0.5) * 0.36 - max(up, 0.0) * 0.1 * (1.0 - vData.x);
            // the burnt-out top of a cooling blob turns to smoke
            if (vData.x < 0.45 && up > 0.35 && n > 0.45) v = 0.0;
            col = fireRamp(v);
            #ifdef BLACK
            // Amaterasu: flat ink-black flames; where a blob turns away its edge smoulders a deep crimson-violet
            float rimv = 1.0 - facing + (n - 0.5) * 0.45;
            col = mix(vec3(0.006, 0.003, 0.01), vec3(0.028, 0.01, 0.034), step(0.56, n));
            col += vec3(0.62, 0.015, 0.2) * smoothstep(0.66, 0.97, rimv) * (0.3 + vData.x * 0.9);
            #endif
          } else {
            vec3 sun = normalize((viewMatrix * vec4(uSun, 0.0)).xyz);
            float l = dot(normalize(vN), sun) * 0.5 + 0.5 + (n - 0.5) * 0.3;
            col = smokeRamp(l);
            // a faint ember glow under a fresh puff
            col += vec3(0.5, 0.1, 0.02) * vData.x * clamp(-up, 0.0, 1.0);
          }
          gl_FragColor = vec4(col, 1.0);
          #endif
          #include <fog_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = soft ? 6 : 4;
    scene.add(this.mesh);
    this.free = [];
    for (let i = BILLOW_MAX - 1; i >= 0; i--) this.free.push(i);
    this.hi = 0; // instances drawn: 0..hi (the highest slot in use + 1)
    // how much a moving billow stretches along its motion (Amaterasu's flames: tall tongues)
    this.stretchK = black ? 0.32 : 1 / 14;
    this.stretchMax = black ? 1.5 : 0.6;
    this.drift = []; // free-moving billows (smoke, splashes): { i, x, y, z, vx, vy, vz, t, life, r0, r1, heat, smoke, drag }
    this.time = 0;
    this.dirty = false;
  }

  /** A slot (or -1 when the pool is full: the effect just draws fewer blobs). */
  take() {
    const i = this.free.length ? this.free.pop() : -1;
    if (i >= this.hi) this.hi = i + 1;
    return i;
  }

  give(i) {
    if (i < 0) return;
    this.aPos.array[i * 4 + 3] = 0;
    this.free.push(i);
    this.dirty = true;
  }

  set(i, x, y, z, r, heat, erode, seed, smoke, dx = 0, dy = 0, dz = 0, stretch = 1) {
    if (i < 0) return;
    const p = this.aPos.array, d = this.aData.array, o = i * 4, q = this.aDir.array;
    q[o] = dx;
    q[o + 1] = dy;
    q[o + 2] = dz;
    q[o + 3] = stretch;
    p[o] = x;
    p[o + 1] = y;
    p[o + 2] = z;
    p[o + 3] = r;
    d[o] = heat;
    d[o + 1] = erode;
    d[o + 2] = seed;
    d[o + 3] = smoke;
    this.dirty = true;
  }

  /** A blob that moves on its own (smoke rising off the fire, splash off a wall, a meteor's trail). */
  puff(x, y, z, vx, vy, vz, life, r0, r1, heat, smoke, drag = 1.5) {
    const i = this.take();
    if (i < 0) return;
    this.drift.push({ i, x, y, z, vx, vy, vz, t: 0, life, r0, r1, heat, smoke, drag, seed: Math.random() });
  }

  update(dt, sun) {
    this.time += dt;
    this.mat.uniforms.uTime.value = this.time;
    if (sun) this.mat.uniforms.uSun.value.copy(sun);
    const D = this.drift;
    let w = 0;
    for (let k = 0; k < D.length; k++) {
      const b = D[k];
      b.t += dt;
      const a = b.t / b.life;
      if (a >= 1) {
        this.give(b.i);
        continue;
      }
      const damp = Math.exp(-b.drag * dt);
      b.vx *= damp;
      b.vz *= damp;
      b.vy = b.vy * damp + 2.2 * dt; // hot air rises
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      const e = 1 - (1 - a) * (1 - a);
      const sp = Math.hypot(b.vx, b.vy, b.vz) || 1;
      this.set(b.i, b.x, b.y, b.z, b.r0 + (b.r1 - b.r0) * e, b.heat * (1 - a), Math.max(0, a - 0.12) / 0.88, b.seed, b.smoke, b.vx / sp, b.vy / sp, b.vz / sp, 1 + Math.min(this.stretchMax, sp * this.stretchK));
      D[w++] = b;
    }
    D.length = w;
    // the drawn range shrinks back when the top slots are free again
    while (this.hi > 0 && this.aPos.array[(this.hi - 1) * 4 + 3] <= 0 && this.free.includes(this.hi - 1)) this.hi--;
    this.mesh.geometry.instanceCount = this.hi;
    this.mesh.visible = this.hi > 0;
    if (this.dirty && this.hi > 0) {
      for (const a of [this.aPos, this.aData, this.aDir]) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, this.hi * 4);
        a.needsUpdate = true;
      }
      this.dirty = false;
    }
  }
}

// ---------------------------------------------------------------- the wave's footprint

const DECAL_COLS = 11, DECAL_ROWS = 45; // (columns ~1.6 m apart across the 16 m end)

export class WaveDecal {
  constructor(scene) {
    const n = DECAL_COLS * DECAL_ROWS;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3);
    this.sf = new Float32Array(n * 2); // distance along the wave, lateral fraction
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSF', new THREE.BufferAttribute(this.sf, 2).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let r = 0; r < DECAL_ROWS - 1; r++) {
      for (let c = 0; c < DECAL_COLS - 1; c++) {
        const a = r * DECAL_COLS + c, b = a + 1, d = a + DECAL_COLS, e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
    }
    g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uFront: { value: 0 }, uTail: { value: 0 }, uT: { value: 0 }, uLife: { value: 10 }, uField: { value: new THREE.Vector3(0, 0, 0) }, uFieldAmt: { value: 0 }, uTime: { value: 0 } }]),
      fog: true,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -6,
      vertexShader: /* glsl */ `
        attribute vec2 aSF; varying vec2 vSF; varying vec3 vW;
        #include <fog_pars_vertex>
        void main() { vSF = aSF; vW = position; vec4 mvPosition = viewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform float uFront; uniform float uTail; uniform float uT; uniform float uLife; uniform vec3 uField; uniform float uFieldAmt; uniform float uTime;
        varying vec2 vSF; varying vec3 vW;
        #include <fog_pars_fragment>
        ${NOISE}
        void main() {
          float s = vSF.x, f = abs(vSF.y);
          float n = mfbm(vec3(vW.x * 0.9, 0.0, vW.z * 0.9));
          // ragged edges
          float edge = 1.0 - smoothstep(0.78, 1.05, f + (n - 0.5) * 0.35);
          if (s > uFront + (n - 0.5) * 1.2 || edge <= 0.01) discard;
          // scorch: dark, patchy, fading over its life
          float fade = 1.0 - smoothstep(uLife * 0.6, uLife, uT);
          float burn = smoothstep(0.25, 0.6, n) * 0.75 + 0.2;
          vec3 col = vec3(0.05, 0.035, 0.03);
          float a = burn * edge * fade * 0.8;
          // the glowing band under the fire (between tail and front), hottest right behind the front
          float inFire = step(uTail, s) * (1.0 - smoothstep(uFront - 0.2, uFront + 0.4, s));
          float hot = inFire * (0.55 + 0.45 * smoothstep(uFront - 6.0, uFront, s));
          // embers glowing in the field while it burns
          float fld = uFieldAmt * step(uField.x, s) * step(s, uField.y) * step(f, uField.z) * smoothstep(0.35, 0.8, mn3(vec3(vW.x * 1.7, uTime * 0.6, vW.z * 1.7)));
          float g = max(hot, fld);
          col = mix(col, vec3(3.2, 1.1, 0.2) * (0.6 + 0.4 * n), g);
          a = max(a, g * edge * 0.9);
          if (a < 0.01) discard;
          gl_FragColor = vec4(col, a);
          #include <fog_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    this.busy = false;
    scene.add(this.mesh);
  }

  /** Lays the decal on a fire shape: columns across the width (a little past the edges), rows along its length. */
  place(shape, W, firePoint) {
    const o = {};
    for (let r = 0; r < DECAL_ROWS; r++) {
      const s = (r / (DECAL_ROWS - 1)) * W.length;
      for (let c = 0; c < DECAL_COLS; c++) {
        const f = ((c / (DECAL_COLS - 1)) * 2 - 1) * 1.12;
        firePoint(shape, W, s, Math.max(-1, Math.min(1, f)), o);
        // (past the edge lanes: extrapolate outward on the edge lane's ground)
        const half = (W.w0 + (W.w1 - W.w0) * Math.pow(s / W.length, 0.8)) * 0.5, extra = (f - Math.max(-1, Math.min(1, f))) * half;
        const i = r * DECAL_COLS + c;
        this.pos[i * 3] = o.x + shape.nx * extra;
        this.pos[i * 3 + 1] = o.y + 0.05;
        this.pos[i * 3 + 2] = o.z + shape.nz * extra;
        this.sf[i * 2] = s;
        this.sf[i * 2 + 1] = f;
      }
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aSF.needsUpdate = true;
    this.mesh.visible = true;
    this.busy = true;
  }

  update(front, tail, t, field, fieldAmt, time) {
    const u = this.mat.uniforms;
    u.uFront.value = front;
    u.uTail.value = tail;
    u.uT.value = t;
    u.uTime.value = time;
    if (field) u.uField.value.copy(field);
    u.uFieldAmt.value = fieldAmt;
    if (t > u.uLife.value) {
      this.mesh.visible = false;
      this.busy = false;
    }
  }
}

// ---------------------------------------------------------------- the burning field

const TONGUE_MAX = 256;

export class FieldFlames {
  constructor(scene) {
    const q = new THREE.PlaneGeometry(1, 1, 1, 4);
    q.translate(0, 0.5, 0);
    const g = new THREE.InstancedBufferGeometry();
    g.index = q.index;
    g.setAttribute('position', q.attributes.position);
    g.setAttribute('uv', q.attributes.uv);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(TONGUE_MAX * 4), 4).setUsage(THREE.DynamicDrawUsage); // x y z height
    this.aData = new THREE.InstancedBufferAttribute(new Float32Array(TONGUE_MAX * 2), 2).setUsage(THREE.DynamicDrawUsage); // width, seed
    g.setAttribute('iPos', this.aPos);
    g.setAttribute('iData', this.aData);
    g.instanceCount = TONGUE_MAX;
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
      fog: true,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        attribute vec4 iPos; attribute vec2 iData; uniform float uTime; varying vec2 vUv; varying float vSeed;
        #include <fog_pars_vertex>
        void main() {
          vUv = uv; vSeed = iData.y;
          if (iPos.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          // cylindrical billboard: the quad turns about its vertical axis to face the camera
          vec3 toCam = cameraPosition - iPos.xyz; toCam.y = 0.0; toCam = normalize(toCam + vec3(1e-4, 0.0, 0.0));
          vec3 side = vec3(toCam.z, 0.0, -toCam.x);
          float sway = sin(uTime * 7.0 + iData.y * 40.0 + position.y * 3.0) * 0.12 * position.y;
          vec3 wp = iPos.xyz + side * (position.x * iData.x + sway) + vec3(0.0, position.y * iPos.w, 0.0);
          vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; varying vec2 vUv; varying float vSeed;
        #include <fog_pars_fragment>
        ${NOISE}
        ${RAMP}
        void main() {
          float y = vUv.y;
          // the tongue sways more toward its tip
          float x = vUv.x * 2.0 - 1.0 - sin(y * 3.4 + uTime * 6.5 + vSeed * 40.0) * 0.28 * y;
          float n = mfbm(vec3(x * 2.2, y * 2.6 - uTime * 3.8, vSeed * 30.0));
          // teardrop: a round base, a licking point; the noise flickers the width and the tip's height
          float w = 0.95 * pow(max(0.0, 1.0 - y), 0.75) * smoothstep(-0.05, 0.22, y) * (0.8 + 0.4 * n);
          float tip = 0.62 + 0.38 * n;
          if (abs(x) > w || y > tip) discard;
          // a fork near the tip: a notch eaten out of its middle
          if (y > tip * 0.62 && abs(x) < 0.12 * (y - tip * 0.62) / (tip * 0.38) && n > 0.5) discard;
          float c = 1.0 - abs(x) / max(w, 1e-3);
          float v = c * 0.62 + (1.0 - y / tip) * 0.36 + (n - 0.5) * 0.25;
          gl_FragColor = vec4(fireRamp(v), 1.0);
          #include <fog_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    scene.add(this.mesh);
    this.used = new Uint8Array(TONGUE_MAX);
  }

  take(n) {
    const out = [];
    for (let i = 0; i < TONGUE_MAX && out.length < n; i++) {
      if (!this.used[i]) {
        this.used[i] = 1;
        out.push(i);
      }
    }
    return out;
  }

  give(list) {
    for (const i of list) {
      this.used[i] = 0;
      this.aPos.array[i * 4 + 3] = 0;
    }
    this.aPos.needsUpdate = true;
  }

  set(i, x, y, z, h, w, seed) {
    const p = this.aPos.array, d = this.aData.array;
    p[i * 4] = x;
    p[i * 4 + 1] = y;
    p[i * 4 + 2] = z;
    p[i * 4 + 3] = h;
    d[i * 2] = w;
    d[i * 2 + 1] = seed;
  }

  update(time) {
    this.mat.uniforms.uTime.value = time;
    this.aPos.needsUpdate = true;
    this.aData.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- Wood Release: stakes, the crack, debris

/**
 * One stake: a faceted spike (7 sides), a flared foot, bent a little, its bark dark with vertical grooves, the top
 * third pale splintered wood ending in a split, jagged tip. Unit height, unit foot radius (instances scale it).
 */
function stakeGeometry() {
  const S = 7, R = 8, pos = [], col = [], idx = [];
  const bark = [0.24, 0.13, 0.065], groove = [0.12, 0.065, 0.035], pale = [0.85, 0.66, 0.4], paleDark = [0.6, 0.43, 0.24];
  for (let j = 0; j <= R; j++) {
    const t = j / R;
    // radius: a flared foot, then tapering to the tip
    const rad = j === R ? 0 : (1 - t) ** 0.8 * (1 + (0.35 * Math.max(0, 0.18 - t)) / 0.18);
    const bend = 0.09 * t * t; // bends forward (local -z)
    for (let i = 0; i < S; i++) {
      const a = (i / S) * Math.PI * 2, jag = j >= R - 2 ? (i % 2 ? 0.55 : 1.15) : 1;
      pos.push(Math.cos(a) * rad * jag, t, Math.sin(a) * rad * jag - bend);
      const c = t > 0.66 + (i % 3) * 0.04 ? (i % 2 ? paleDark : pale) : i % 2 ? groove : bark;
      col.push(...c);
    }
  }
  for (let j = 0; j < R; j++) {
    for (let i = 0; i < S; i++) {
      const a = j * S + i, b = j * S + ((i + 1) % S), c = a + S, d = b + S;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  const flat = g.toNonIndexed(); // flat facets: each face its own normal
  flat.computeVertexNormals();
  return flat;
}

const STAKES_PER_LINE = 48;

/** A pool of stake lines: each its own instanced mesh (one draw; a moving shadow caster while it stands). */
export class Stakes {
  constructor(scene, material) {
    const g = stakeGeometry();
    this.lines = Array.from({ length: 3 }, () => {
      const m = new THREE.InstancedMesh(g, material, STAKES_PER_LINE);
      m.count = 0;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.visible = false;
      scene.add(m);
      return { mesh: m, busy: false, sphere: new THREE.Sphere(), t0: 0 };
    });
  }

  take() {
    const L = this.lines.find((x) => !x.busy) || this.lines.reduce((a, b) => (a.t0 < b.t0 ? a : b));
    L.busy = true;
    L.t0 = performance.now();
    return L;
  }

  give(L) {
    L.busy = false;
    L.mesh.visible = false;
    L.mesh.count = 0;
  }
}

const CRACK_ROWS = 40;

/** The crack racing along the ground ahead of the stakes (a ribbon on the line's ground samples). */
export class CrackDecal {
  constructor(scene) {
    const n = CRACK_ROWS * 3;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3);
    this.su = new Float32Array(n * 2);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSU', new THREE.BufferAttribute(this.su, 2).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let r = 0; r < CRACK_ROWS - 1; r++) {
      for (let c = 0; c < 2; c++) {
        const a = r * 3 + c, b = a + 1, d = a + 3, e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
    }
    g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uFront: { value: 0 }, uFade: { value: 1 }, uSeed: { value: 0 } }]),
      fog: true,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -6,
      vertexShader: /* glsl */ `
        attribute vec2 aSU; varying vec2 vSU; varying vec3 vW;
        #include <fog_pars_vertex>
        void main() { vSU = aSU; vW = position; vec4 mvPosition = viewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform float uFront; uniform float uFade; uniform float uSeed; varying vec2 vSU; varying vec3 vW;
        #include <fog_pars_fragment>
        ${NOISE}
        void main() {
          float s = vSU.x, u = vSU.y;
          if (s > uFront) discard;
          // the main crack wanders along the line; short side cracks split off it
          float wob = (mfbm(vec3(s * 0.7, uSeed, 0.0)) - 0.5) * 0.9;
          float w = 0.05 + 0.06 * mfbm(vec3(s * 3.0, uSeed + 3.0, 0.0));
          float d = abs(u - wob);
          float side = mfbm(vec3(floor(s * 1.6), uSeed + 7.0, 0.0));
          float sd = abs(u - wob - (fract(s * 1.6) - 0.5) * sign(side - 0.5) * 1.2);
          float branch = step(0.55, side) * (1.0 - smoothstep(0.015, 0.04, sd)) * (1.0 - smoothstep(0.1, 0.7, d));
          float crack = max(1.0 - smoothstep(w * 0.55, w, d), branch);
          // churned earth either side of it
          float dirt = (1.0 - smoothstep(0.15, 0.85, d)) * smoothstep(0.35, 0.65, mfbm(vec3(vW.x * 2.0, 0.0, vW.z * 2.0)));
          vec3 col = mix(vec3(0.36, 0.26, 0.17), vec3(0.05, 0.035, 0.03), crack);
          float a = max(crack, dirt * 0.55) * uFade;
          if (a < 0.02) discard;
          gl_FragColor = vec4(col, a);
          #include <fog_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    this.busy = false;
    scene.add(this.mesh);
  }

  place(line, seed) {
    for (let r = 0; r < CRACK_ROWS; r++) {
      const s = (r / (CRACK_ROWS - 1)) * line.len;
      const i = Math.min(line.ys.length - 1, s / 0.5), i0 = Math.floor(i);
      const y = line.ys[i0] + (line.ys[Math.min(line.ys.length - 1, i0 + 1)] - line.ys[i0]) * (i - i0);
      for (let c = 0; c < 3; c++) {
        const u = (c - 1) * (1.1 + (s / 18) * 0.8), k = r * 3 + c;
        this.pos[k * 3] = line.o[0] + line.dx * s + line.nx * u;
        this.pos[k * 3 + 1] = y + 0.05;
        this.pos[k * 3 + 2] = line.o[2] + line.dz * s + line.nz * u;
        this.su[k * 2] = s;
        this.su[k * 2 + 1] = u;
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.aSU.needsUpdate = true;
    this.mat.uniforms.uSeed.value = (seed % 1000) * 0.37;
    this.mesh.visible = true;
    this.busy = true;
  }
}

const DEBRIS_MAX = 220;
const _dg = {};

/** Rock and dirt chunks thrown up by the stakes and the meteor: instanced, ballistic, bouncing once, then gone. */
export class Debris {
  constructor(scene, material) {
    const g = new THREE.DodecahedronGeometry(1, 0);
    this.mesh = new THREE.InstancedMesh(g, material, DEBRIS_MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(DEBRIS_MAX * 3), 3);
    scene.add(this.mesh);
    this.list = [];
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  /** A chunk: position, velocity, size (m), colour (hex), life (s). */
  throw(x, y, z, vx, vy, vz, size, color, life = 2.2) {
    if (this.list.length >= DEBRIS_MAX) this.list.shift();
    this.list.push({ x, y, z, vx, vy, vz, size, color, life, t: 0, rx: Math.random() * 6, ry: Math.random() * 6, wx: (Math.random() - 0.5) * 14, wy: (Math.random() - 0.5) * 14, bounced: false });
  }

  update(dt, world) {
    const L = this.list;
    let w = 0;
    for (const d of L) {
      d.t += dt;
      if (d.t >= d.life) continue;
      d.vy -= 22 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      const gy = world.ground(d.x, d.z, d.y + 0.5, _dg).y + d.size * 0.5;
      if (d.y < gy) {
        d.y = gy;
        if (!d.bounced && d.vy < -3) {
          d.vy *= -0.3;
          d.vx *= 0.5;
          d.vz *= 0.5;
          d.bounced = true;
        } else {
          d.vy = 0;
          d.vx *= 0.8;
          d.vz *= 0.8;
          d.wx *= 0.8;
          d.wy *= 0.8;
        }
      }
      d.rx += d.wx * dt;
      d.ry += d.wy * dt;
      L[w++] = d;
    }
    L.length = w;
    const m = this.mesh;
    for (let i = 0; i < L.length; i++) {
      const d = L[i];
      const shrink = Math.min(1, (d.life - d.t) / 0.4);
      this._q.setFromEuler(this._e.set(d.rx, d.ry, 0));
      this._s.set(d.size, d.size * 0.75, d.size * 0.9).multiplyScalar(shrink);
      this._m.compose(this._p.set(d.x, d.y, d.z), this._q, this._s);
      m.setMatrixAt(i, this._m);
      m.setColorAt(i, this._c.setHex(d.color));
    }
    m.count = L.length;
    m.visible = L.length > 0;
    if (L.length) {
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor.needsUpdate = true;
    }
  }
}

// ---------------------------------------------------------------- Uchiha Return: the gunbai, the wind barrier

// The gunbai: public/assets/props/gunbai.glb ("Madara-Uchiha gunbai" by Madara.Uchiha.supreme, CC BY 4.0; source
// models/gunbai.glb). Prop frame, metres: +y along the handle toward the head, origin at the neck (where the paddle
// meets the handle), +z the face's normal, +x across the face; the paddle is 13 mm thick at most (6.7 mm on the -z
// side, the wrapping 13 mm), the handle 9 mm in radius. `len`: overall length; `grip`: the fist's place below the
// neck; `back`: where it rides on his back, in the upper chest's frame (VRM normalized: +z forward, +x his left):
// carried like a sword, head down: the neck at the shoulder blades, the paddle hanging down his back over the hair
// toward his left hip (18 degrees), the handle rising past his right shoulder (where the right hand finds it), the
// tomoe face to the back. The paddle's inner face rests on the hair (its back surface measured on the model: z -0.23
// to -0.27 from 0.9 to 1.45 m, thinning to the robe's -0.14 at 0.75 m), leaning in a little at the bottom.
// `hair`: how far in front of the fan's mid-plane the hair's spring joints are held, at two points down the paddle
// ([prop y, metres]): the mane's spikes stand up to 11 cm behind its joints at the shoulder blades but 3 cm at its
// tail, so the plane leans (deep where the hair is thick, shallow where it is thin: the hips' collider leaves the tail
// ~8 cm, the chest's ~15; measured with scripts/debug/gunbai.mjs, a flat 7.5 cm still let 10-24 spike tips through).
export const GUNBAI = {
  url: '/assets/props/gunbai.glb', len: 1.12, grip: 0.27,
  back: { p: [-0.03, 0.11, -0.275], up: [0.309, -0.951, 0.1], face: [0, 0, -1] },
  hair: [[0.15, 0.125], [0.6, 0.07]],
};
let gunbaiGeo = null;

/**
 * Parses the gunbai's .glb (its bytes) into the shared prop geometry (in the prop frame) and its texture. Triangles
 * are turned to face their vertex normals (a ripped mesh can wind half of them backwards: gotcha 33).
 */
export async function loadGunbai(buf) {
  const gltf = await new GLTFLoader().parseAsync(buf, '');
  gltf.scene.updateMatrixWorld(true);
  let mesh = null;
  gltf.scene.traverse((o) => {
    if (o.isMesh && !mesh) mesh = o;
  });
  let g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  if (g.index) g = g.toNonIndexed();
  if (!g.attributes.normal) g.computeVertexNormals();
  const P = g.attributes.position, N = g.attributes.normal, n = P.count;
  g.computeBoundingBox();
  const b = g.boundingBox, s = GUNBAI.len / (b.max.y - b.min.y), cx = (b.min.x + b.max.x) / 2, hw = (b.max.x - b.min.x) / 2;
  // the handle's axis: the middle of its end; the neck: the lowest point of the paddle (well off the axis)
  let ex = 0, ez = 0, en = 0, neck = b.max.y;
  for (let i = 0; i < n; i++) {
    const x = P.getX(i), y = P.getY(i);
    if (y < b.min.y + 0.03 * (b.max.y - b.min.y)) {
      ex += x;
      ez += P.getZ(i);
      en++;
    }
    if (Math.abs(x - cx) > 0.4 * hw) neck = Math.min(neck, y);
  }
  ex /= en || 1;
  ez /= en || 1;
  g.translate(-ex, -neck, -ez);
  g.scale(s, s, s);
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), nm = new THREE.Vector3();
  for (let i = 0; i < n; i += 3) {
    A.fromBufferAttribute(P, i);
    B.fromBufferAttribute(P, i + 1).sub(A);
    C.fromBufferAttribute(P, i + 2).sub(A);
    nm.fromBufferAttribute(N, i).add(A.fromBufferAttribute(N, i + 1)).add(A.fromBufferAttribute(N, i + 2));
    if (B.cross(C).dot(nm) >= 0) continue;
    for (const at of Object.values(g.attributes)) {
      const k = at.itemSize, arr = at.array, o1 = (i + 1) * k, o2 = (i + 2) * k;
      for (let j = 0; j < k; j++) [arr[o1 + j], arr[o2 + j]] = [arr[o2 + j], arr[o1 + j]];
    }
  }
  g.computeBoundingSphere();
  gunbaiGeo = { geo: g, map: mesh.material.map || null };
  return gunbaiGeo;
}

const _gp = new THREE.Vector3(), _gq = new THREE.Quaternion(), _gs = new THREE.Vector3(), _gp2 = new THREE.Vector3(), _gq2 = new THREE.Quaternion();
const _gm = new THREE.Matrix4(), _gx = new THREE.Vector3(), _gy = new THREE.Vector3(), _gz = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);
const BACK_Q = new THREE.Quaternion(), BACK_P = new THREE.Vector3();
/** The back mount from GUNBAI.back (again after a change: MadaraKit.debugGunbai). */
export function gunbaiBack(b = GUNBAI.back) {
  GUNBAI.back = b;
  BACK_P.fromArray(b.p);
  const y = new THREE.Vector3().fromArray(b.up).normalize();
  const z = new THREE.Vector3().fromArray(b.face);
  z.addScaledVector(y, -z.dot(y)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  BACK_Q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}
gunbaiBack();

/**
 * One Madara's gunbai: a child of his fighter's root, placed every frame from his bones (after their world matrices
 * are up to date): on his back (the upper chest's frame) at w = 0, in the right fist at w = 1 (the handle through
 * the closed fingers, measured from that body's own finger bones), blended in between (the grab, the release).
 * While it rides on his back it is also a spring-bone collider for his hair (a plane under the paddle's inner face,
 * on the upper chest), so a swinging mane drapes against the fan instead of passing through it; once the fan leaves
 * his back the plane backs away (and eases back in on the release: the hair is pressed down, never snapped).
 */
export class Gunbai {
  constructor(mat) {
    this.mesh = new THREE.Mesh(gunbaiGeo.geo, mat);
    this.mesh.castShadow = true;
    this.mesh.matrixAutoUpdate = false;
    this.fighter = null;
    this.fist = new THREE.Vector3(); // the grip point in the hand bone's space
    this.gripQ = new THREE.Quaternion(); // the prop's frame in the hand bone's space
    this.w = 0;
    this.shape = new VRMSpringBoneColliderShapePlane({ offset: new THREE.Vector3(), normal: new THREE.Vector3(0, 0, -1) });
    this.collider = new VRMSpringBoneCollider(this.shape);
    this.colliders = { name: 'gunbai', colliders: [this.collider] };
    this.joints = [];
    this.hairAt = [0, 0];
  }

  attach(fighter) {
    if (this.fighter === fighter) return;
    if (this.fighter) this.detach();
    const H = fighter.vrm.humanoid;
    this.fighter = fighter;
    this.hand = H.getRawBoneNode('rightHand');
    this.chest = H.getNormalizedBoneNode('upperChest') || H.getNormalizedBoneNode('chest');
    // the hair collider rides on the chest in the back mount's frame (the normalized bone: the same frame `pose` uses)
    this.collider.position.copy(BACK_P);
    this.collider.quaternion.copy(BACK_Q);
    this.chest.add(this.collider);
    this.joints = [...(fighter.vrm.springBoneManager?.joints || [])];
    for (const j of this.joints) j.colliderGroups.push(this.colliders);
    // the plane through GUNBAI.hair's two limits (joint centres; the joints' own radius taken off)
    const [[y0, d0], [y1, d1]] = GUNBAI.hair, r = this.joints[0]?.settings.hitRadius || 0, k = (d0 - d1) / (y1 - y0);
    this.shape.normal.set(0, k, -1).normalize();
    this.hairAt = [y0, -(d0 - r)];
    // the grip frame: the handle runs pinky -> index through the middle of the fist, the face opens toward where the
    // knuckles point
    const I = H.getRawBoneNode('rightIndexProximal').position, Lp = H.getRawBoneNode('rightLittleProximal').position, M = H.getRawBoneNode('rightMiddleProximal').position;
    const fingers = _gz.copy(M).normalize(), grip = _gy.copy(I).sub(Lp).normalize();
    const palm = new THREE.Vector3().crossVectors(fingers, grip).negate().normalize();
    const x = _gx.crossVectors(grip, fingers).normalize();
    const zf = new THREE.Vector3().crossVectors(x, grip).normalize();
    this.gripQ.setFromRotationMatrix(_gm.makeBasis(x, grip, zf));
    this.fist.copy(M).multiplyScalar(0.55).addScaledVector(palm, 0.03 / (this.hand.getWorldScale(_gs).x || 1));
    fighter.root.add(this.mesh);
  }

  detach() {
    this.mesh.removeFromParent();
    this.collider.removeFromParent();
    for (const j of this.joints) {
      const i = j.colliderGroups.indexOf(this.colliders);
      if (i >= 0) j.colliderGroups.splice(i, 1);
    }
    this.joints = [];
    this.fighter = null;
  }

  /** The prop's origin (the neck) and orientation at w, in world space. */
  pose(w, outP, outQ) {
    this.chest.matrixWorld.decompose(outP, outQ, _gs);
    outP.add(_gp2.copy(BACK_P).applyQuaternion(outQ));
    outQ.multiply(BACK_Q);
    if (w <= 0) return;
    this.hand.matrixWorld.decompose(_gp2, _gq2, _gs);
    _gq2.multiply(this.gripQ);
    _gp2.copy(this.fist).applyMatrix4(this.hand.matrixWorld).addScaledVector(_gy.set(0, 1, 0).applyQuaternion(_gq2), GUNBAI.grip);
    if (w >= 1) {
      outP.copy(_gp2);
      outQ.copy(_gq2);
    } else {
      outP.lerp(_gp2, w);
      outQ.slerp(_gq2, w);
    }
  }

  /** Draws it at w (0 on the back, 1 in the hand). */
  place(w) {
    this.w = w;
    this.pose(w, _gp, _gq);
    const m = this.mesh;
    m.matrixWorld.compose(_gp, _gq, _one);
    m.matrix.copy(this.fighter.root.matrixWorld).invert().multiply(m.matrixWorld);
    // the hair's plane: under the inner face while on his back, backing off as the hand takes the fan (gone once it
    // is in the hand), sweeping in over the release's last frames (a hair behind it is pressed forward, not popped)
    this.collider.position.copy(BACK_P);
    this.collider.quaternion.copy(BACK_Q);
    this.shape.offset.set(0, this.hairAt[0], this.hairAt[1] + (w >= 1 ? 100 : w * 0.6));
  }

  /** A point of the prop (prop frame, e.g. the top of the paddle) in world space, as last drawn. */
  point(x, y, z, out) {
    return out.set(x, y, z).applyMatrix4(this.mesh.matrixWorld);
  }
}

// The wind barrier round Madara while the gunbai is up: (1) ribbons of wind whirling round him (one draw: every
// ribbon is built in the vertex shader from its seed and the time; they turn the way he spun, to his left), (2) a
// thin shell showing the cover's edge (fresnel + swirling bands; a hit sends a ring across it from where it struck),
// (3) the wave: a band of wind lines rushing out from his body (the gust at the spin, then small pulses). White
// cores with pale cyan edges, hard toon bands; the side between the camera and him is kept faint so he stays in view.
const RIBBONS = 26, SEGS = 48;
const WIND = /* glsl */ `
  float wh(float n) { return fract(sin(n * 127.1) * 43758.5453); }`;
// two kinds of ribbon (by seed): ~70% are thin crisp lines of wind (the anime stroke), the rest wide soft bands at a
// low alpha that give the whirl its body
const ribbonVert = /* glsl */ `
  attribute vec4 aR; // u (0 = the head, 1 = the tail), v (-1..1 across), seed, -
  uniform float uTime; uniform float uAmt; uniform float uR; uniform float uH; uniform float uGrow;
  varying float vU; varying float vV; varying float vSeed; varying float vFade; varying float vBand;
  ${WIND}
  void main() {
    float s = aR.z, u = aR.x;
    float band = step(0.7, wh(s + 11.7));
    float r0 = uR * mix(0.7, 1.05, wh(s)) * uGrow * mix(1.0, 0.92, band);
    float y0 = mix(0.1, uH, wh(s + 1.3));
    float arc = mix(2.2, 4.4, wh(s + 2.7));
    float spd = mix(5.0, 9.0, wh(s + 4.1));
    float slope = mix(-0.05, 0.1, wh(s + 5.9));
    float w = (band > 0.5 ? mix(0.16, 0.3, wh(s + 7.3)) : mix(0.018, 0.045, wh(s + 7.3))) * (1.0 - u * 0.5);
    // a left turn is a falling atan2(z, x): the head leads at u = 0, the tail trails round behind it
    float ang = wh(s + 9.1) * 6.2832 - uTime * spd + u * arc;
    float rad = r0 * (1.0 + 0.06 * sin(u * 5.0 - uTime * 4.0 + s * 13.0));
    vec3 radial = vec3(cos(ang), 0.0, sin(ang));
    vec3 p = radial * rad + vec3(0.0, y0 + slope * u * arc * rad + 0.06 * sin(ang * 2.0 + s * 3.0 + uTime * 2.0), 0.0);
    // the band stands up, tipped a little into the turn
    p += (vec3(0.0, 0.92, 0.0) + radial * 0.38) * aR.y * w;
    vec4 wp = modelMatrix * vec4(p, 1.0);
    // faint on the near side (between the camera and him)
    vec3 c = (modelMatrix * vec4(0.0, 1.0, 0.0, 1.0)).xyz, tc = cameraPosition - c;
    vFade = 1.0 - 0.65 * smoothstep(0.1, 0.8, dot(radial, normalize(vec3(tc.x, 0.0, tc.z))));
    vU = u; vV = aR.y; vSeed = s; vBand = band;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const ribbonFrag = /* glsl */ `
  uniform float uTime; uniform float uAmt;
  varying float vU; varying float vV; varying float vSeed; varying float vFade; varying float vBand;
  ${WIND}
  void main() {
    float along = smoothstep(0.0, 0.05, vU) * pow(1.0 - vU, 1.6);
    float alpha;
    vec3 col;
    if (vBand > 0.5) {
      // a soft band: body, no edge
      alpha = along * (1.0 - vV * vV) * 0.16;
      col = vec3(0.78, 0.9, 1.0);
    } else {
      // a line: a hard core, broken here and there like a brush stroke
      float gap = step(0.22, wh(floor(vU * 7.0 + vSeed * 3.0) + vSeed));
      float core = 1.0 - smoothstep(0.35, 0.9, abs(vV));
      alpha = step(0.12, along) * mix(0.55, 0.9, along) * core * gap;
      col = mix(vec3(0.75, 0.9, 1.0), vec3(1.25, 1.3, 1.38), step(0.45, along));
    }
    alpha *= uAmt * vFade;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(col, alpha);
  }`;
const shellVert = /* glsl */ `
  varying vec3 vN; varying vec3 vV; varying vec3 vL;
  void main() {
    vL = normalize(position);
    vN = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const shellFrag = /* glsl */ `
  uniform float uTime; uniform float uAmt; uniform vec4 uHits[4];
  varying vec3 vN; varying vec3 vV; varying vec3 vL;
  void main() {
    float f = pow(1.0 - abs(dot(vN, vV)), 2.6);
    // bands swirling round the vertical, sheared by height (the same turn as the ribbons)
    float ang = atan(vL.z, vL.x);
    float band = smoothstep(0.55, 0.95, sin(ang * 5.0 + vL.y * 5.0 + uTime * 9.0)) * 0.7 + smoothstep(0.7, 0.98, sin(ang * 9.0 - vL.y * 3.0 + uTime * 13.0)) * 0.4;
    float a = f * (0.02 + band * 0.16);
    // hits: a ring running across the shell from the point struck
    float ring = 0.0;
    for (int i = 0; i < 4; i++) {
      vec4 h = uHits[i];
      if (h.w < 0.0 || h.w > 1.0) continue;
      float d = acos(clamp(dot(vL, h.xyz), -1.0, 1.0));
      ring += smoothstep(0.22, 0.0, abs(d - h.w * 2.2)) * (1.0 - h.w) * 1.4 + smoothstep(0.5, 0.0, d) * (1.0 - h.w) * (1.0 - h.w);
    }
    a = a * uAmt + ring * min(1.0, uAmt * 2.0) * 0.8;
    if (a < 0.01) discard;
    vec3 col = mix(vec3(0.62, 0.84, 1.0), vec3(1.4, 1.45, 1.55), clamp(band * f + ring, 0.0, 1.0));
    gl_FragColor = vec4(col, min(a, 0.9));
  }`;
const waveVert = /* glsl */ `
  varying vec2 vUv; varying float vFace; varying float vDist;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDist = -mv.z;
    // how squarely the band faces the camera (edge-on it would pile up into white bars at the silhouette)
    vFace = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
    gl_Position = projectionMatrix * mv;
  }`;
const waveFrag = /* glsl */ `
  uniform float uK; uniform float uAmt; uniform float uSeed;
  varying vec2 vUv; varying float vFace; varying float vDist;
  ${WIND}
  void main() {
    // wind lines round the band: long strokes (6 rows of 20 per turn, each a random length at a random height and
    // offset), thin however far it has spread
    float y = vUv.y, row = floor(y * 6.0);
    float x = vUv.x * 20.0 + wh(row + uSeed) * 7.0, cell = floor(x);
    float h = wh(cell + row * 17.0 + uSeed * 31.0), yc = (row + mix(0.25, 0.75, wh(cell + row * 5.0 + 7.7 + uSeed))) / 6.0;
    // a brush stroke: thickest in the middle, tapering to points at both ends
    float len = mix(0.3, 0.9, h), e = abs(fract(x) - 0.5) / (len * 0.5);
    float th = 0.02 * max(0.0, 1.0 - e * e);
    float dash = step(e, 1.0) * smoothstep(th, th * 0.35, abs(y - yc));
    float body = smoothstep(0.0, 0.25, y) * smoothstep(1.0, 0.6, y) * 0.1;
    float a = (dash * step(0.25, h) * 0.85 + body) * pow(1.0 - uK, 1.4) * uAmt * smoothstep(0.08, 0.45, vFace) * smoothstep(0.6, 2.2, vDist); // (not across the camera as it spreads past it)
    if (a < 0.01) discard;
    gl_FragColor = vec4(mix(vec3(0.7, 0.88, 1.0), vec3(1.35, 1.4, 1.5), dash), min(a, 0.95));
  }`;

let barrierGeo = null;
function barrierGeometry() {
  if (barrierGeo) return barrierGeo;
  const n = RIBBONS * (SEGS + 1) * 2, aR = new Float32Array(n * 4), idx = [];
  for (let r = 0; r < RIBBONS; r++) {
    for (let j = 0; j <= SEGS; j++) {
      for (let k = 0; k < 2; k++) aR.set([j / SEGS, k ? 1 : -1, r * 1.618 + 0.37, 0], ((r * (SEGS + 1) + j) * 2 + k) * 4);
      if (j < SEGS) {
        const a = (r * (SEGS + 1) + j) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
  const ribbons = new THREE.BufferGeometry();
  ribbons.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  ribbons.setAttribute('aR', new THREE.BufferAttribute(aR, 4));
  ribbons.setIndex(idx);
  ribbons.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 3);
  const shell = new THREE.IcosahedronGeometry(1, 4);
  const wave = new THREE.CylinderGeometry(1, 1, 1, 64, 1, true);
  wave.translate(0, 0.5, 0);
  barrierGeo = { ribbons, shell, wave };
  return barrierGeo;
}

/** One wind barrier (a pool of them: one per Madara whose gunbai is up). */
export class WindBarrier {
  constructor(scene) {
    const G = barrierGeometry();
    const blend = { transparent: true, depthWrite: false, blending: THREE.NormalBlending };
    this.ribbonMat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uAmt: { value: 0 }, uR: { value: 1.6 }, uH: { value: 2.1 }, uGrow: { value: 1 } }, vertexShader: ribbonVert, fragmentShader: ribbonFrag, side: THREE.DoubleSide, ...blend });
    this.shellMat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uAmt: { value: 0 }, uHits: { value: Array.from({ length: 4 }, () => new THREE.Vector4(0, 1, 0, -1)) } }, vertexShader: shellVert, fragmentShader: shellFrag, ...blend });
    this.waveMat = new THREE.ShaderMaterial({ uniforms: { uK: { value: 0 }, uAmt: { value: 0 }, uSeed: { value: 0 } }, vertexShader: waveVert, fragmentShader: waveFrag, side: THREE.DoubleSide, ...blend });
    this.group = new THREE.Group();
    this.ribbons = new THREE.Mesh(G.ribbons, this.ribbonMat);
    this.shell = new THREE.Mesh(G.shell, this.shellMat);
    this.wave = new THREE.Mesh(G.wave, this.waveMat);
    this.ribbons.renderOrder = 7;
    this.shell.renderOrder = 6;
    this.wave.renderOrder = 7;
    this.ribbons.frustumCulled = false;
    this.group.add(this.ribbons, this.shell, this.wave);
    this.group.visible = false;
    scene.add(this.group);
    this.owner = null;
    this.hitN = 0;
  }

  /**
   * Draws it at feet position p. o: { t (s since the press, drives the swirl), amt 0..1, grow (radius scale), R (m),
   * wave: null | { k 0..1, amt, r (m), h (m), seed } }.
   */
  update(p, o, dt) {
    this.group.visible = o.amt > 0.005 || !!o.wave;
    if (!this.group.visible) return;
    this.group.position.copy(p);
    const U = this.ribbonMat.uniforms;
    U.uTime.value = o.t;
    U.uAmt.value = o.amt;
    U.uR.value = o.R;
    U.uGrow.value = o.grow;
    this.ribbons.visible = o.amt > 0.005;
    const S = this.shellMat.uniforms;
    S.uTime.value = o.t;
    S.uAmt.value = o.amt * o.shell;
    for (const h of S.uHits.value) if (h.w >= 0) h.w = h.w + dt / 0.45 > 1 ? -1 : h.w + dt / 0.45;
    this.shell.visible = o.amt > 0.005 || S.uHits.value.some((h) => h.w >= 0);
    this.shell.position.set(0, 1.0, 0);
    this.shell.scale.set(o.R * o.grow * 1.05, o.R * 0.82 * o.grow + 0.35, o.R * o.grow * 1.05);
    const W = o.wave;
    this.wave.visible = !!W;
    if (W) {
      this.waveMat.uniforms.uK.value = W.k;
      this.waveMat.uniforms.uAmt.value = W.amt;
      this.waveMat.uniforms.uSeed.value = W.seed;
      this.wave.scale.set(W.r, W.h, W.r);
      this.wave.position.set(0, 0.05, 0);
    }
  }

  /** A hit struck the shell from world direction d (from his chest): a ring runs across it. */
  hit(dx, dy, dz) {
    const h = this.shellMat.uniforms.uHits.value[this.hitN++ % 4], l = Math.hypot(dx, dy, dz) || 1;
    h.set(dx / l, dy / l, dz / l, 0);
  }

  release() {
    this.owner = null;
    this.group.visible = false;
    for (const h of this.shellMat.uniforms.uHits.value) h.w = -1;
  }
}

// ---------------------------------------------------------------- Tengai Shinsei: the meteor, its mark on the ground

/** Deterministic 3D value noise for building the rock (CPU side; the shaders have their own). */
function rockNoise(x, y, z) {
  const h = (i, j, k) => {
    let n = (i * 374761393 + j * 668265263 + k * 1274126177) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  const fx = x - i, fy = y - j, fz = z - k;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const L = (a, b, t) => a + (b - a) * t;
  return L(L(L(h(i, j, k), h(i + 1, j, k), u), L(h(i, j + 1, k), h(i + 1, j + 1, k), u), v), L(L(h(i, j, k + 1), h(i + 1, j, k + 1), u), L(h(i, j + 1, k + 1), h(i + 1, j + 1, k + 1), u), v), w);
}
const rockFbm = (x, y, z) => rockNoise(x, y, z) * 0.55 + rockNoise(x * 2.1, y * 2.1, z * 2.1) * 0.3 + rockNoise(x * 4.3, y * 4.3, z * 4.3) * 0.15;

/**
 * The meteor's rock: a lumpy, cratered boulder (unit radius; faceted: the toon look), basalt dark with paler ridges.
 * Shared geometry of the rock and its heat shell.
 */
function meteorGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 3);
  const p = g.attributes.position, n = new THREE.Vector3();
  // a few craters: dents where the surface is near one of these directions
  const craters = [[0.6, 0.5, 0.62], [-0.7, 0.2, 0.5], [0.1, -0.8, 0.5], [-0.3, 0.6, -0.7], [0.8, -0.3, -0.4]].map((c) => new THREE.Vector3(...c).normalize());
  for (let i = 0; i < p.count; i++) {
    n.fromBufferAttribute(p, i).normalize();
    let r = 0.74 + 0.5 * rockFbm(n.x * 1.3 + 3, n.y * 1.3 + 7, n.z * 1.3 + 1) + 0.12 * rockFbm(n.x * 4 + 9, n.y * 4, n.z * 4);
    for (const c of craters) {
      const d = n.angleTo(c);
      if (d < 0.38) r -= 0.16 * Math.cos((d / 0.38) * Math.PI * 0.5) ** 2;
      else if (d < 0.46) r += 0.025;
    }
    // squashed a little: not a ball
    p.setXYZ(i, n.x * r * 1.15, n.y * r * 0.82, n.z * r);
  }
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  const q = flat.attributes.position, col = new Float32Array(q.count * 3);
  for (let i = 0; i < q.count; i += 3) {
    // one colour per facet: height on the rock (ridges pale, hollows dark) + noise
    let r = 0;
    for (let k = 0; k < 3; k++) r += n.fromBufferAttribute(q, i + k).length() / 3;
    const t = Math.min(1, Math.max(0, (r - 0.8) / 0.35)) * 0.7 + rockNoise(q.getX(i) * 5, q.getY(i) * 5, q.getZ(i) * 5) * 0.3;
    const c = [0.1 + 0.16 * t, 0.085 + 0.13 * t, 0.08 + 0.11 * t];
    for (let k = 0; k < 3; k++) col.set(c, (i + k) * 3);
  }
  flat.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return flat;
}

/**
 * One meteor: the rock (toon, outlined, a moving shadow caster) and its heat shell: an additive skin glowing on the
 * leading face (the fall's direction) with molten cracks, brighter as it comes down.
 */
export class MeteorRock {
  constructor(scene, material) {
    const g = meteorGeometry();
    this.rock = new THREE.Mesh(g, material);
    this.rock.castShadow = true;
    this.rock.frustumCulled = false;
    this.shellMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uDir: { value: new THREE.Vector3(0, -1, 0) }, uHeat: { value: 0 }, uTime: { value: 0 } }]),
      fog: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vObj; varying vec3 vView;
        #include <fog_pars_vertex>
        void main() {
          vObj = position;
          vN = normalize(mat3(modelMatrix) * normal);
          vec4 wp = modelMatrix * vec4(position * 1.035, 1.0);
          vec4 mvPosition = viewMatrix * wp;
          vView = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uDir; uniform float uHeat; uniform float uTime;
        varying vec3 vN; varying vec3 vObj; varying vec3 vView;
        #include <fog_pars_fragment>
        ${NOISE}
        void main() {
          float front = clamp(dot(normalize(vN), uDir), 0.0, 1.0);
          float rim = pow(1.0 - clamp(dot(normalize(vN), vView), 0.0, 1.0), 2.0);
          // molten cracks: thin bands of the noise, over the front half
          float n = mfbm(vObj * 3.2 + vec3(0.0, uTime * 0.4, 0.0));
          float crack = 1.0 - smoothstep(0.02, 0.06, abs(n - 0.5));
          float a = uHeat * (pow(front, 5.0) * 0.55 + crack * smoothstep(0.0, 0.6, dot(normalize(vN), uDir)) * 0.85 + rim * pow(front, 1.5) * 0.7);
          if (a < 0.01) discard;
          vec3 col = mix(vec3(1.4, 0.32, 0.04), vec3(2.4, 1.3, 0.4), pow(front, 3.0));
          gl_FragColor = vec4(col * a, 1.0);
          #include <fog_fragment>
        }`,
    });
    this.shell = new THREE.Mesh(g, this.shellMat);
    this.shell.frustumCulled = false;
    this.shell.renderOrder = 2;
    this.rock.add(this.shell);
    this.rock.visible = false;
    this.busy = false;
    this.sphere = new THREE.Sphere();
    scene.add(this.rock);
  }
}

const MARK_N = 41; // (a 29 m square round a 13 m ring: ~0.7 m cells follow the ground)

/**
 * The meteor's mark on the ground, on a terrain-following grid round the impact point. Before the impact
 * (uK: 0 -> 1 over the fall): the danger rings (outer and core, red, pulsing faster), the rock's shadow growing dark
 * and sharp under it. After (uAge: seconds since): the crater's scorch with molten cracks cooling, fading out.
 */
export class MeteorMark {
  constructor(scene) {
    const n = MARK_N * MARK_N;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3);
    this.rel = new Float32Array(n * 2);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aRel', new THREE.BufferAttribute(this.rel, 2).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let j = 0; j < MARK_N - 1; j++) {
      for (let i = 0; i < MARK_N - 1; i++) {
        const a = j * MARK_N + i, b = a + 1, c = a + MARK_N, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uK: { value: 0 }, uAge: { value: -1 }, uTime: { value: 0 }, uCore: { value: 4 }, uOuter: { value: 10 }, uShadow: { value: 5 }, uFade: { value: 1 } }]),
      fog: true,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -6,
      vertexShader: /* glsl */ `
        attribute vec2 aRel; varying vec2 vRel;
        #include <fog_pars_vertex>
        void main() { vRel = aRel; vec4 mvPosition = viewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform float uK; uniform float uAge; uniform float uTime; uniform float uCore; uniform float uOuter; uniform float uShadow; uniform float uFade;
        varying vec2 vRel;
        #include <fog_pars_fragment>
        ${NOISE}
        void main() {
          float r = length(vRel), ang = atan(vRel.y, vRel.x);
          vec3 col = vec3(0.0); float a = 0.0;
          if (uAge < 0.0) {
            // the warning: rings pulsing faster as it comes; dashes on the outer ring turning
            float pulse = 0.55 + 0.45 * sin(uTime * (5.0 + uK * 16.0));
            float outer = 1.0 - smoothstep(0.06, 0.16, abs(r - uOuter));
            outer *= step(0.35, fract(ang * 6.0 / 3.14159 + uTime * 0.6));
            float core = 1.0 - smoothstep(0.08, 0.2, abs(r - uCore));
            float fill = (1.0 - smoothstep(uCore * 0.9, uOuter, r)) * 0.18 + (1.0 - smoothstep(0.0, uCore, r)) * 0.12;
            // the rock's shadow: wide and faint high up, tight and dark as it lands
            float sr = uShadow * (2.2 - 1.2 * uK);
            float sh = (1.0 - smoothstep(sr * (0.55 + 0.35 * uK), sr, r)) * (0.15 + 0.6 * uK * uK);
            vec3 red = vec3(1.9, 0.18, 0.06);
            col = red * max(outer * (0.6 + 0.4 * pulse), core * pulse) + red * 0.35 * fill * pulse;
            a = max(max(outer, core) * (0.55 + 0.45 * pulse), fill * pulse);
            col = mix(col, vec3(0.02, 0.01, 0.01), sh * (1.0 - a));
            a = max(a, sh);
          } else {
            // the crater: scorched, cracked earth; the cracks glow and cool
            float n = mfbm(vec3(vRel * 0.45, 3.0));
            float rim = uCore * 1.6 + (n - 0.5) * 2.5;
            float burn = 1.0 - smoothstep(rim * 0.7, rim * 1.25, r);
            float cr = mfbm(vec3(ang * 2.2, r * 0.35, 7.0));
            float crack = (1.0 - smoothstep(0.015, 0.045, abs(cr - 0.5))) * (1.0 - smoothstep(rim, rim * 1.6, r)) * step(0.6, r);
            float glow = exp(-uAge * 0.55);
            col = mix(vec3(0.16, 0.11, 0.08), vec3(0.03, 0.022, 0.02), smoothstep(0.2, 0.9, burn));
            col = mix(col, vec3(2.2, 0.55, 0.08) * glow + vec3(0.02) * (1.0 - glow), crack);
            col += vec3(1.6, 0.35, 0.05) * glow * (1.0 - smoothstep(0.0, uCore * 0.8, r)) * 0.6;
            a = max(burn * (0.55 + 0.35 * n), crack);
            a *= uFade;
          }
          if (a < 0.02) discard;
          gl_FragColor = vec4(col, a);
          #include <fog_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    this.busy = false;
    scene.add(this.mesh);
  }

  /** Lays the grid on the ground round (x, z); ground(x, z) -> y. */
  place(x, y, z, half, ground) {
    for (let j = 0; j < MARK_N; j++) {
      for (let i = 0; i < MARK_N; i++) {
        const k = j * MARK_N + i, u = (i / (MARK_N - 1)) * 2 - 1, v = (j / (MARK_N - 1)) * 2 - 1;
        const px = x + u * half, pz = z + v * half;
        this.pos[k * 3] = px;
        this.pos[k * 3 + 1] = ground(px, pz, y) + 0.06;
        this.pos[k * 3 + 2] = pz;
        this.rel[k * 2] = u * half;
        this.rel[k * 2 + 1] = v * half;
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.aRel.needsUpdate = true;
    this.mesh.visible = true;
    this.busy = true;
  }
}
