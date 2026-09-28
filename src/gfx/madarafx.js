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
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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
  /** soft: alpha-blended smoke (fresnel-soft edges, dissolving), else opaque fire with ink outlines */
  constructor(scene, soft = false) {
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
      defines: soft ? { SOFT: '' } : {},
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
          if (n < vData.y * 1.15 - 0.12 || smoothstep(1.2, 4.5, vDist) < bayer4(gl_FragCoord.xy)) discard;
          float facing = clamp(dot(normalize(vN), normalize(vView)), 0.0, 1.0);
          float up = normalize(vN).y;
          vec3 col;
          if (vData.w < 0.5) {
            // hot where the blob faces you (its core), red at the rims, broken up by the noise
            float v = vData.x * 0.5 + facing * 0.42 + (n - 0.5) * 0.36 - max(up, 0.0) * 0.1 * (1.0 - vData.x);
            // the burnt-out top of a cooling blob turns to smoke
            if (vData.x < 0.45 && up > 0.35 && n > 0.45) v = 0.0;
            col = fireRamp(v);
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
      this.set(b.i, b.x, b.y, b.z, b.r0 + (b.r1 - b.r0) * e, b.heat * (1 - a), Math.max(0, a - 0.12) / 0.88, b.seed, b.smoke, b.vx / sp, b.vy / sp, b.vz / sp, 1 + Math.min(0.6, sp / 14));
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

const DECAL_COLS = 9, DECAL_ROWS = 45;

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

const TONGUE_MAX = 192;

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

// ---------------------------------------------------------------- Uchiha Return: the gunbai

// The war fan's face outline (metres, the handle's top at the origin, +y up the face): a wide rounded paddle,
// slightly taller than wide, narrowing into the neck.
function gunbaiShape() {
  const s = new THREE.Shape();
  s.moveTo(-0.055, 0);
  s.bezierCurveTo(-0.2, 0.07, -0.33, 0.24, -0.32, 0.42);
  s.bezierCurveTo(-0.31, 0.63, -0.17, 0.77, 0, 0.775);
  s.bezierCurveTo(0.17, 0.77, 0.31, 0.63, 0.32, 0.42);
  s.bezierCurveTo(0.33, 0.24, 0.2, 0.07, 0.055, 0);
  s.lineTo(-0.055, 0);
  return s;
}

/** The face: cream paper with faint ribs fanning from the neck and three red tomoe (the Sharingan's crest). */
function gunbaiFaceTexture() {
  const n = 512, c = document.createElement('canvas');
  c.width = c.height = n;
  const x = c.getContext('2d');
  // (u = (px + 0.33) / 0.66, v = py / 0.78: the texture spans the face's bounds)
  const U = (px) => ((px + 0.33) / 0.66) * n, V = (py) => n - (py / 0.78) * n;
  const grd = x.createRadialGradient(U(0), V(0.44), 10, U(0), V(0.44), n * 0.6);
  grd.addColorStop(0, '#f3e9d2');
  grd.addColorStop(1, '#dccaa2');
  x.fillStyle = grd;
  x.fillRect(0, 0, n, n);
  // ribs
  x.strokeStyle = 'rgba(150,118,72,0.35)';
  x.lineWidth = 2;
  for (let k = -7; k <= 7; k++) {
    const a = (k / 7) * 1.25;
    x.beginPath();
    x.moveTo(U(0), V(0.02));
    x.lineTo(U(Math.sin(a) * 0.5), V(0.02 + Math.cos(a) * 0.8));
    x.stroke();
  }
  // a thin dark ring round the crest
  const cx = U(0), cy = V(0.44), R = (0.2 / 0.66) * n;
  x.strokeStyle = '#3a2418';
  x.lineWidth = 5;
  x.beginPath();
  x.arc(cx, cy, R, 0, Math.PI * 2);
  x.stroke();
  // three tomoe, heads on a circle, tails sweeping round
  x.fillStyle = '#b01018';
  const hr = R * 0.24;
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 - Math.PI / 2;
    const hx = cx + Math.cos(a) * R * 0.5, hy = cy + Math.sin(a) * R * 0.5;
    x.beginPath();
    x.arc(hx, hy, hr, 0, Math.PI * 2);
    x.fill();
    // the tail: a crescent from the head's outer side, curling round the centre
    const t0 = a + Math.PI / 2;
    x.beginPath();
    x.moveTo(hx + Math.cos(t0) * hr, hy + Math.sin(t0) * hr);
    x.quadraticCurveTo(cx + Math.cos(a + 0.9) * R * 0.95, cy + Math.sin(a + 0.9) * R * 0.95, cx + Math.cos(a + 1.5) * R * 0.78, cy + Math.sin(a + 1.5) * R * 0.78);
    x.quadraticCurveTo(cx + Math.cos(a + 0.8) * R * 0.62, cy + Math.sin(a + 0.8) * R * 0.62, hx - Math.cos(t0) * hr * 0.2, hy - Math.sin(t0) * hr * 0.2);
    x.closePath();
    x.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.repeat.set(1 / 0.66, 1 / 0.78);
  tex.offset.set(0.33 / 0.66, 0);
  return tex;
}

function colored(g, rgb) {
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set(typeof rgb === 'function' ? rgb(g, i) : rgb, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

let gunbaiParts = null;
/** Shared geometry and materials of every gunbai (built once). */
function gunbaiKit(toonFn) {
  if (gunbaiParts) return gunbaiParts;
  const shape = gunbaiShape();
  const face = new THREE.ExtrudeGeometry(shape, { depth: 0.018, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1, curveSegments: 24 });
  face.translate(0, 0, -0.009);
  // the rim: a dark lacquered band round the face, in segments (thin metal bands between them)
  const pts = shape.getSpacedPoints(96).map((p) => new THREE.Vector3(p.x, p.y, 0));
  const rim = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 128, 0.02, 6, true);
  colored(rim, (g, i) => {
    const seg = Math.floor(i / 7) % 128; // (tube vertices: radialSegments + 1 per ring)
    return seg % 11 === 0 ? [0.55, 0.42, 0.2] : [0.07, 0.035, 0.03];
  });
  // the handle: lacquered shaft, a gold collar at the neck, bandages round the lower grip, a knob at the end
  const parts = [];
  const shaft = new THREE.CylinderGeometry(0.021, 0.025, 0.52, 8);
  shaft.translate(0, -0.26, 0);
  parts.push(colored(shaft, [0.06, 0.028, 0.022]));
  const collar = new THREE.CylinderGeometry(0.034, 0.03, 0.05, 8);
  collar.translate(0, -0.005, 0);
  parts.push(colored(collar, [0.5, 0.36, 0.14]));
  const wrap = new THREE.CylinderGeometry(0.029, 0.03, 0.16, 8, 8);
  wrap.translate(0, -0.4, 0);
  parts.push(colored(wrap, (g, i) => (Math.floor((g.attributes.position.getY(i) + 0.48) / 0.02) % 2 ? [0.8, 0.75, 0.64] : [0.62, 0.57, 0.48])));
  const knob = new THREE.SphereGeometry(0.034, 8, 6);
  knob.translate(0, -0.52, 0);
  parts.push(colored(knob, [0.07, 0.035, 0.03]));
  const ring = new THREE.TorusGeometry(0.018, 0.006, 5, 10);
  ring.translate(0, -0.56, 0);
  parts.push(colored(ring, [0.55, 0.55, 0.6]));
  const handle = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  handle.computeVertexNormals();
  gunbaiParts = {
    face, rim, handle, link: new THREE.TorusGeometry(0.02, 0.0055, 5, 10),
    faceMat: toonFn({ map: gunbaiFaceTexture(), hatch: 0.3, key: 'gface', side: THREE.DoubleSide, fade: false }),
    lacquer: toonFn({ vertexColors: true, hatch: 0.4, key: 'glacq', fade: false }),
    metal: toonFn({ color: 0x8e8e9a, hatch: 0.3, key: 'gmetal', fade: false }),
  };
  return gunbaiParts;
}

const LINKS = 13, LINK_LEN = 0.042;
const _gq = new THREE.Quaternion(), _gv = new THREE.Vector3(), _gw = new THREE.Vector3(), _gm = new THREE.Matrix4(), _gs = new THREE.Vector3(1.35, 1, 1), _gy = new THREE.Vector3(0, 1, 0), _gz = new THREE.Quaternion();

/**
 * One fighter's gunbai: attached to the right hand's bone so the handle passes through the closed fist (the grip is
 * measured from that body's own finger bones), the face turned the way the knuckles point, the chain hanging off the
 * handle's end on a small verlet rope. Appears / vanishes in a puff of smoke with a quick scale pop.
 */
export class Gunbai {
  constructor(scene, toonFn) {
    const K = gunbaiKit(toonFn);
    this.group = new THREE.Group();
    this.face = new THREE.Mesh(K.face, K.faceMat);
    this.rim = new THREE.Mesh(K.rim, K.lacquer);
    this.handle = new THREE.Mesh(K.handle, K.lacquer);
    for (const m of [this.face, this.rim, this.handle]) {
      m.castShadow = true;
      this.group.add(m);
    }
    this.group.visible = false;
    this.chain = new THREE.InstancedMesh(K.link, K.metal, LINKS);
    this.chain.frustumCulled = false;
    this.chain.visible = false;
    scene.add(this.chain);
    this.pts = Array.from({ length: LINKS + 1 }, () => new THREE.Vector3());
    this.prev = Array.from({ length: LINKS + 1 }, () => new THREE.Vector3());
    this.hand = null;
    this.on = false;
    this.pop = 0;
  }

  /**
   * Holds it in `fighter`'s right hand. The grip frame comes from the hand's finger bones (their rest offsets in the
   * hand's space): the handle runs pinky -> index through the middle of the fist, the face opens toward the index
   * side, facing where the knuckles point.
   */
  attach(fighter) {
    const H = fighter.vrm.humanoid;
    const hand = H.getRawBoneNode('rightHand');
    if (!hand) return false;
    if (this.hand !== hand) {
      hand.add(this.group);
      this.hand = hand;
      const I = H.getRawBoneNode('rightIndexProximal').position, Lp = H.getRawBoneNode('rightLittleProximal').position, M = H.getRawBoneNode('rightMiddleProximal').position;
      const fingers = _gv.copy(M).normalize(), grip = _gw.copy(I).sub(Lp).normalize();
      const palm = new THREE.Vector3().crossVectors(fingers, grip).negate().normalize();
      const x = new THREE.Vector3().crossVectors(grip, fingers).normalize(); // (the face's width axis)
      // local frame of the fan: +y along the handle toward the head (grip), +z the face normal (fingers)
      const zf = new THREE.Vector3().crossVectors(x, grip).normalize();
      this.group.matrix.makeBasis(x, grip, zf);
      // the grip point: inside the curled fingers, in front of the palm; the handle's top 0.1 m above the fist
      const c = M.clone().multiplyScalar(0.55).addScaledVector(palm, 0.03).addScaledVector(grip, 0.1);
      this.group.matrix.setPosition(c);
      // (the body's scale: the bones may carry the model's)
      const ws = hand.getWorldScale(new THREE.Vector3()).x || 1;
      this.group.matrix.scale(new THREE.Vector3(1 / ws, 1 / ws, 1 / ws));
      this.group.matrixAutoUpdate = false;
      this.group.matrixWorldNeedsUpdate = true;
    }
    return true;
  }

  detach() {
    this.group.removeFromParent();
    this.hand = null;
    this.on = false;
    this.group.visible = false;
    this.chain.visible = false;
  }

  /** Where the chain hangs from (the ring under the handle), in world space. */
  anchor(out) {
    this.group.updateWorldMatrix(true, false);
    return out.set(0, -0.56, 0).applyMatrix4(this.group.matrixWorld);
  }

  show(on) {
    if (on === this.on) return false;
    this.on = on;
    this.group.visible = on;
    this.chain.visible = on;
    if (on) {
      this.pop = 0;
      this.anchor(this.pts[0]);
      for (let i = 1; i <= LINKS; i++) this.pts[i].copy(this.pts[0]).y -= i * LINK_LEN;
      for (let i = 0; i <= LINKS; i++) this.prev[i].copy(this.pts[i]);
    }
    return true;
  }

  update(dt) {
    if (!this.on) return;
    // appear: a quick pop from 60% to full size
    this.pop = Math.min(1, this.pop + dt / 0.09);
    const s = 0.6 + 0.4 * (1 - (1 - this.pop) ** 3);
    this.face.scale.setScalar(s);
    this.rim.scale.setScalar(s);
    this.handle.scale.setScalar(s);
    // the chain: verlet with gravity and damping, the first point pinned to the handle's ring
    const P = this.pts, Q = this.prev, h = Math.min(dt, 1 / 30);
    this.anchor(P[0]);
    for (let i = 1; i <= LINKS; i++) {
      const p = P[i], q = Q[i];
      _gv.copy(p).sub(q).multiplyScalar(0.96);
      q.copy(p);
      p.add(_gv).y -= 9.8 * h * h;
    }
    for (let it = 0; it < 4; it++) {
      for (let i = 1; i <= LINKS; i++) {
        const a = P[i - 1], b = P[i];
        _gv.subVectors(b, a);
        const d = _gv.length() || 1e-6, k = (d - LINK_LEN) / d;
        if (i === 1) b.addScaledVector(_gv, -k);
        else {
          a.addScaledVector(_gv, k * 0.5);
          b.addScaledVector(_gv, -k * 0.5);
        }
      }
    }
    for (let i = 0; i < LINKS; i++) {
      const a = P[i], b = P[i + 1];
      _gv.subVectors(b, a).normalize();
      _gq.setFromUnitVectors(_gy, _gv);
      // alternate links turn 90 degrees about the chain
      if (i % 2) _gq.multiply(_gz.setFromAxisAngle(_gy, Math.PI / 2));
      _gm.compose(_gw.addVectors(a, b).multiplyScalar(0.5), _gq, _gs.set(1, 1.4, 1));
      this.chain.setMatrixAt(i, _gm);
    }
    this.chain.instanceMatrix.needsUpdate = true;
  }
}
