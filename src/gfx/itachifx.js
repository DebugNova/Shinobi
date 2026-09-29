// Itachi's jutsu visuals (all created up front, pooled, compiled behind the loading screen; nothing is allocated
// mid-fight). The fire and the black flames are Madara's Billows (madarafx.js: `black` turns the ramp into
// Amaterasu's); here:
//   EyeMarks   camera-facing Mangekyō Sharingan billboards: the Tsukuyomi mark over a victim (an eye that opens, its
//              pinwheel turning, a red halo) and the glow in Itachi's own eyes through his casts. HDR red feeds the bloom.
//   Crows      a flock of low-poly crows in one instanced draw: wings flap in the vertex shader (two joints), bodies
//              bank into their turns, near-black with a blue sheen, ink-outlined (opaque, depth-written).
//   Feathers   black feathers fluttering down, animated entirely on the GPU from their spawn (like fx.js).
//   InkStrokes torn brush-ink streaks along a path (his crow shift: the dash, the escape's flight): strips widened
//              in the vertex shader toward the camera, bristles, ragged edges and a dry-brush tail in the fragment
//              shader, drying out from the tail. Every stroke on screen in one draw.
//   GenjutsuEffect  the victim's own screen inside Tsukuyomi: the world turned to red and black, the Mangekyō flashed
//              over the view as it takes hold (a post effect in the stack's first pass; strength 0 = off).
import * as THREE from 'three';
import { Effect, BlendFunction } from 'postprocessing';
import { SEAL_GLSL } from './tsukuyomifx.js';

// Itachi's Mangekyō in a unit disc (q: -1..1, the iris edge at 1): a blood-red iris darkening to the rim, the black
// ring, the pupil and three blades curving out from it like a pinwheel (turned by `rot`). rgb + alpha.
export const MANGEKYO = /* glsl */ `
  vec4 mangekyo(vec2 q, float rot) {
    float r = length(q);
    if (r > 1.0) return vec4(0.0);
    float a = atan(q.y, q.x);
    vec3 red = mix(vec3(2.4, 0.08, 0.06), vec3(0.5, 0.0, 0.02), smoothstep(0.08, 0.96, r));
    float ink = 1.0 - smoothstep(0.15, 0.19, r);
    ink = max(ink, 1.0 - smoothstep(0.035, 0.06, abs(r - 0.93)));
    for (int k = 0; k < 3; k++) {
      float c = rot + float(k) * 2.0943951 + (r - 0.15) * 2.3;
      float d = abs(mod(a - c + 3.14159265, 6.2831853) - 3.14159265);
      float w = 0.66 * (1.0 - smoothstep(0.12, 0.86, r)) + 0.035;
      ink = max(ink, (1.0 - smoothstep(w - 0.07, w, d)) * smoothstep(0.12, 0.16, r) * (1.0 - smoothstep(0.84, 0.89, r)));
    }
    return vec4(mix(red, vec3(0.012, 0.0, 0.004), ink), 1.0 - smoothstep(0.97, 1.0, r));
  }`;

// ---------------------------------------------------------------- eye marks

const MARKS = 40; // (two eyes per Itachi, one mark per dazed victim)

export class EyeMarks {
  constructor(scene) {
    const quad = new THREE.PlaneGeometry(2, 2);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.attributes.position);
    const A = (n) => new THREE.InstancedBufferAttribute(new Float32Array(MARKS * n), n).setUsage(THREE.DynamicDrawUsage);
    this.aPos = A(4); // x, y, z, size (half-width, m)
    this.aData = A(4); // open (0..1; < 0: an iris alone, glowing: the eyes of the caster), alpha, rot, halo
    g.setAttribute('iPos', this.aPos);
    g.setAttribute('iData', this.aData);
    g.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute vec4 iPos; attribute vec4 iData;
        varying vec2 vQ; varying vec4 vData;
        void main() {
          vQ = position.xy; vData = iData;
          if (iPos.w <= 0.0 || iData.y <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          vec4 mv = viewMatrix * vec4(iPos.xyz, 1.0);
          // (the halo needs room: the quad is twice the eye)
          mv.xy += position.xy * iPos.w * 2.0;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vQ; varying vec4 vData;
        ${MANGEKYO}
        void main() {
          vec2 q = vQ * 2.0; // the eye spans -1..1 in the middle of the quad
          float open = vData.x, alpha = vData.y, rot = vData.z, halo = vData.w;
          vec3 col = vec3(0.0); float a = 0.0;
          if (open < 0.0) {
            // the caster's eye: the iris and a hot bloom round it
            vec4 m = mangekyo(q * 1.05, rot);
            float g = exp(-length(q) * 2.2) * halo;
            col = m.rgb * m.a + vec3(2.2, 0.05, 0.04) * g * (1.0 - m.a);
            a = max(m.a, g);
          } else {
            // an almond eye opening (the lids meet at the corners), the Mangekyō in it, a red aura round it
            float lid = open * 0.62 * (1.0 - q.x * q.x);
            float inEye = step(abs(q.y), lid) * step(abs(q.x), 1.0);
            float edge = step(abs(q.y), lid + 0.075) * step(abs(q.x), 1.04) * (1.0 - inEye);
            vec4 m = mangekyo(q / 0.6, rot);
            vec3 eye = mix(vec3(0.16, 0.0, 0.01), m.rgb, m.a);
            float g = exp(-length(q * vec2(0.8, 1.3)) * 2.4) * halo * (1.0 - inEye) * (1.0 - edge);
            col = eye * inEye + vec3(0.01, 0.0, 0.0) * edge + vec3(2.0, 0.04, 0.05) * g;
            a = max(max(inEye, edge), g * 0.9);
          }
          a *= alpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(col, a);
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    scene.add(this.mesh);
    this.n = 0;
  }

  /** Starts a frame's list (call before set). */
  begin() {
    this.n = 0;
  }

  set(x, y, z, size, open, alpha, rot, halo) {
    if (this.n >= MARKS) return;
    const o = this.n++ * 4;
    this.aPos.array.set([x, y, z, size], o);
    this.aData.array.set([open, alpha, rot, halo], o);
  }

  end() {
    const g = this.mesh.geometry;
    g.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
    if (!this.n) return;
    for (const a of [this.aPos, this.aData]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.n * 4);
      a.needsUpdate = true;
    }
  }
}

// ---------------------------------------------------------------- crows

const CROWS = 200;

/**
 * A crow facing +z, wings along x (span ~0.62 m at scale 1; drawn at ~1.3-1.8: chakra crows, big enough to read), y up. Attribute `wing`: 0 the body, 1 the inner wing, 2 the outer
 * wing (the side is the sign of x). ~30 triangles.
 */
function crowGeometry() {
  const P = [], W = [], idx = [];
  const v = (x, y, z, w = 0) => {
    P.push(x, y, z);
    W.push(w);
    return P.length / 3 - 1;
  };
  const tri = (a, b, c) => idx.push(a, b, c);
  // body: a diamond, fat at the chest, the head and beak in front, the tail fan behind
  const nose = v(0, 0.01, 0.2), beak = v(0, -0.005, 0.27);
  const head = [v(0.03, 0.03, 0.14), v(-0.03, 0.03, 0.14), v(0, -0.02, 0.14)];
  const chest = [v(0.055, 0.035, 0.04), v(-0.055, 0.035, 0.04), v(0, -0.055, 0.04), v(0, 0.055, 0.02)];
  const rump = [v(0.03, 0.02, -0.1), v(-0.03, 0.02, -0.1), v(0, -0.02, -0.1)];
  const tail = [v(0.07, 0.01, -0.24), v(-0.07, 0.01, -0.24), v(0, 0.015, -0.2)];
  tri(beak, head[0], head[1]); tri(beak, head[1], head[2]); tri(beak, head[2], head[0]); tri(nose, head[0], head[1]);
  const ring = (A, B) => {
    for (let i = 0; i < A.length; i++) {
      const j = (i + 1) % A.length;
      tri(A[i], B[i], B[j]);
      tri(A[i], B[j], A[j]);
    }
  };
  ring(head, [chest[0], chest[1], chest[2]]);
  tri(chest[0], chest[3], chest[1]);
  ring([chest[0], chest[1], chest[2]], rump);
  tri(rump[0], rump[1], rump[2]);
  tri(rump[0], tail[2], tail[0]); tri(rump[1], tail[1], tail[2]); tri(rump[0], tail[0], tail[1]); tri(rump[0], tail[1], rump[1]);
  // wings: an inner panel from the shoulder to the wrist, an outer one fanning to the tip (primaries swept back)
  for (const s of [1, -1]) {
    const sh0 = v(0.04 * s, 0.03, 0.06, 1), sh1 = v(0.04 * s, 0.03, -0.05, 1);
    const wr0 = v(0.17 * s, 0.03, 0.05, 1), wr1 = v(0.17 * s, 0.03, -0.09, 1);
    const tp0 = v(0.31 * s, 0.02, -0.04, 2), tp1 = v(0.29 * s, 0.02, -0.13, 2), tp2 = v(0.22 * s, 0.02, -0.14, 2);
    tri(sh0, wr0, wr1); tri(sh0, wr1, sh1);
    tri(wr0, tp0, tp1); tri(wr0, tp1, wr1); tri(wr1, tp1, tp2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('wing', new THREE.Float32BufferAttribute(W, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export class Crows {
  constructor(scene) {
    const base = crowGeometry();
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    for (const k of ['position', 'normal', 'wing']) g.setAttribute(k, base.attributes[k]);
    const A = (n) => new THREE.InstancedBufferAttribute(new Float32Array(CROWS * n), n).setUsage(THREE.DynamicDrawUsage);
    this.aPos = A(4); // x, y, z, scale
    this.aDir = A(4); // heading (unit), flap phase
    this.aData = A(4); // flap rate (rad/s), bank (rad), glide (0..1: wings held out), 0
    g.setAttribute('iPos', this.aPos);
    g.setAttribute('iDir', this.aDir);
    g.setAttribute('iData', this.aData);
    g.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
      fog: true,
      vertexShader: /* glsl */ `
        attribute float wing; attribute vec4 iPos; attribute vec4 iDir; attribute vec4 iData;
        uniform float uTime;
        varying vec3 vN; varying vec3 vView;
        #include <fog_pars_vertex>
        void main() {
          if (iPos.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          vec3 p = position, n = normal;
          // the flap: the whole wing turns up/down about the body's axis at the shoulder, the outer part folds
          // further at the wrist (a crow's stroke is deep and whippy)
          float side = sign(p.x);
          float ph = uTime * iData.x + iDir.w;
          float th = mix(sin(ph) * 0.95 + 0.15, 0.08, iData.z);
          float th2 = mix(sin(ph - 0.6) * 0.55, 0.0, iData.z);
          if (wing > 0.5) {
            float ax = abs(p.x) - 0.04;
            float c = cos(th), s = sin(th);
            if (wing < 1.5) { p.x = side * (0.04 + ax * c); p.y += ax * s; }
            else {
              float aj = 0.13, ao = ax - aj; float c2 = cos(th + th2), s2 = sin(th + th2);
              p.x = side * (0.04 + aj * c + ao * c2); p.y += aj * s + ao * s2;
            }
            n = normalize(vec3(-side * sin(th) * 0.8, cos(th), 0.0));
          }
          // heading + bank: forward = iDir.xyz, the wings along the right vector turned about it
          vec3 f = normalize(iDir.xyz);
          vec3 r = normalize(cross(f, abs(f.y) > 0.97 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0)));
          vec3 u = cross(r, f);
          float cb = cos(iData.y), sb = sin(iData.y);
          vec3 r2 = r * cb + u * sb, u2 = u * cb - r * sb;
          // (model +x is the crow's left: r points right, so left = -r2)
          // (one flying past the lens filled the view: they shrink away within 3 m of the camera)
          float near = smoothstep(0.8, 3.0, distance(iPos.xyz, cameraPosition));
          vec3 wp = iPos.xyz + (-r2 * p.x + u2 * p.y + f * p.z) * iPos.w * near;
          vN = normalize((viewMatrix * vec4(-r2 * n.x + u2 * n.y + f * n.z, 0.0)).xyz);
          vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
          vView = normalize(-mvPosition.xyz);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vN; varying vec3 vView;
        #include <fog_pars_fragment>
        void main() {
          vec3 n = normalize(vN);
          if (!gl_FrontFacing) n = -n;
          // near-black feathers: a lit band from above, a blue-violet sheen at grazing angles
          float lit = step(0.35, n.y * 0.5 + 0.5);
          float rim = pow(1.0 - clamp(abs(dot(n, normalize(vView))), 0.0, 1.0), 2.5);
          vec3 col = mix(vec3(0.018, 0.02, 0.028), vec3(0.05, 0.055, 0.075), lit) + vec3(0.1, 0.12, 0.26) * rim;
          gl_FragColor = vec4(col, 1.0);
          #include <fog_fragment>
        }`,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    scene.add(this.mesh);
    this.list = []; // { i, x, y, z, vx, vy, vz, t, life, mode, ... }
    this.free = [];
    for (let i = CROWS - 1; i >= 0; i--) this.free.push(i);
    this.hi = 0;
    this.time = 0;
  }

  /**
   * A crow bursting away: from (x, y, z) at velocity v, flapping hard, wandering, gone after `life` s (it shrinks away
   * the last 0.3 s: onEnd(x, y, z) is where it vanished).
   */
  burst(x, y, z, vx, vy, vz, life, onEnd) {
    return this.add({ mode: 0, x, y, z, vx, vy, vz, life, onEnd, turn: (Math.random() - 0.5) * 2.4, s: 1.35 + Math.random() * 0.45 });
  }

  /** A crow flying in to (tx, ty, tz), arriving `life` s from now along a curve through (cx, cy, cz). */
  gather(x, y, z, cx, cy, cz, tx, ty, tz, life, onEnd) {
    return this.add({ mode: 1, x0: x, y0: y, z0: z, cx, cy, cz, tx, ty, tz, x, y, z, vx: 0, vy: 0, vz: 0, life, onEnd, s: 1.25 + Math.random() * 0.4 });
  }

  add(c) {
    if (!this.free.length) return null;
    c.i = this.free.pop();
    if (c.i >= this.hi) this.hi = c.i + 1;
    c.t = 0;
    c.ph = Math.random() * 6.283;
    c.rate = 15 + Math.random() * 5;
    c.bank = 0;
    c.fx = c.vx;
    c.fy = c.vy;
    c.fz = c.vz;
    this.list.push(c);
    return c;
  }

  update(dt) {
    this.time += dt;
    this.mat.uniforms.uTime.value = this.time;
    const P = this.aPos.array, D = this.aDir.array, Q = this.aData.array;
    let w = 0;
    for (const c of this.list) {
      c.t += dt;
      const k = c.t / c.life;
      if (k >= 1) {
        P[c.i * 4 + 3] = 0;
        this.free.push(c.i);
        c.onEnd?.(c.x, c.y, c.z);
        continue;
      }
      let fx, fy, fz, turn = 0;
      if (c.mode === 0) {
        // wander: the heading swings about the vertical, a steady climb, drag toward a cruising speed
        const sp = Math.hypot(c.vx, c.vz) || 1;
        const a = c.turn * dt * (0.6 + Math.sin(c.t * 3 + c.ph));
        const cs = Math.cos(a), sn = Math.sin(a);
        const nx = c.vx * cs - c.vz * sn, nz = c.vx * sn + c.vz * cs;
        c.vx = nx;
        c.vz = nz;
        const want = 5.5, dmp = Math.exp(-dt * 1.2);
        c.vx = c.vx * dmp + (c.vx / sp) * want * (1 - dmp);
        c.vz = c.vz * dmp + (c.vz / sp) * want * (1 - dmp);
        c.vy = c.vy * Math.exp(-dt * 2) + 1.6 * dt;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.z += c.vz * dt;
        fx = c.vx;
        fy = c.vy * 0.6;
        fz = c.vz;
        turn = a / Math.max(dt, 1e-4);
      } else {
        // a quadratic curve in, easing into the arrival
        const e = 1 - (1 - k) * (1 - k) * (1 - k * 0.3);
        const u = 1 - e;
        const x = u * u * c.x0 + 2 * u * e * c.cx + e * e * c.tx, y = u * u * c.y0 + 2 * u * e * c.cy + e * e * c.ty, z = u * u * c.z0 + 2 * u * e * c.cz + e * e * c.tz;
        fx = x - c.x;
        fy = y - c.y;
        fz = z - c.z;
        c.x = x;
        c.y = y;
        c.z = z;
        turn = 0;
      }
      const fl = Math.hypot(fx, fy, fz);
      if (fl > 1e-5) {
        // the heading follows the motion smoothly (no snapping on the first frame)
        const b = 1 - Math.exp(-dt * 14);
        c.fx += (fx / fl - c.fx) * b;
        c.fy += (fy / fl - c.fy) * b;
        c.fz += (fz / fl - c.fz) * b;
      }
      c.bank += (Math.max(-0.9, Math.min(0.9, -turn * 0.35)) - c.bank) * (1 - Math.exp(-dt * 6));
      // bursting out they pop in over 0.08 s; they shrink away at the end
      const sc = c.s * Math.min(1, c.t / 0.08) * Math.min(1, (c.life - c.t) / (c.mode === 0 ? 0.3 : 0.12));
      const o = c.i * 4;
      P[o] = c.x;
      P[o + 1] = c.y;
      P[o + 2] = c.z;
      P[o + 3] = sc;
      D[o] = c.fx;
      D[o + 1] = c.fy;
      D[o + 2] = c.fz;
      D[o + 3] = c.ph;
      Q[o] = c.rate;
      Q[o + 1] = c.bank;
      Q[o + 2] = c.mode === 1 && k > 0.75 ? (k - 0.75) * 4 : 0; // wings out, gliding in to land
      this.list[w++] = c;
    }
    this.list.length = w;
    while (this.hi > 0 && P[(this.hi - 1) * 4 + 3] <= 0 && this.free.includes(this.hi - 1)) this.hi--;
    const g = this.mesh.geometry;
    g.instanceCount = this.hi;
    this.mesh.visible = this.hi > 0;
    if (this.hi > 0) {
      for (const a of [this.aPos, this.aDir, this.aData]) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, this.hi * 4);
        a.needsUpdate = true;
      }
    }
  }

  clear() {
    for (const c of this.list) {
      this.aPos.array[c.i * 4 + 3] = 0;
      this.free.push(c.i);
    }
    this.list.length = 0;
    this.update(0);
  }
}

// ---------------------------------------------------------------- feathers

const FEATHERS = 320;

export class Feathers {
  constructor(scene) {
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.attributes.position);
    const A = (n) => new THREE.InstancedBufferAttribute(new Float32Array(FEATHERS * n), n).setUsage(THREE.DynamicDrawUsage);
    this.aPos = A(4); // x, y, z, t0
    this.aVel = A(4); // vx, vy, vz, life
    this.aSeed = A(2); // seed, size
    g.setAttribute('iPos', this.aPos);
    g.setAttribute('iVel', this.aVel);
    g.setAttribute('iSeed', this.aSeed);
    g.instanceCount = FEATHERS;
    for (let i = 0; i < FEATHERS; i++) this.aPos.array[i * 4 + 3] = -1e6;
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
      fog: true,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        attribute vec4 iPos; attribute vec4 iVel; attribute vec2 iSeed;
        uniform float uTime;
        varying vec2 vUv; varying float vShade;
        #include <fog_pars_vertex>
        void main() {
          float t = uTime - iPos.w, k = t / iVel.w;
          vUv = position.xy + 0.5;
          if (k < 0.0 || k > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          float s = iSeed.x * 40.0;
          // thrown out, caught by the air, then drifting down in a swaying fall, turning over as it goes
          vec3 p = iPos.xyz + iVel.xyz * (1.0 - exp(-t * 3.0)) / 3.0 + vec3(sin(t * 2.6 + s) * 0.35, -0.55 * t, cos(t * 2.1 + s) * 0.3) * min(t, 1.0);
          float a = t * (2.0 + iSeed.x * 3.0) + s, b = sin(t * 3.3 + s) * 1.2;
          mat3 R = mat3(cos(a), 0.0, -sin(a), 0.0, 1.0, 0.0, sin(a), 0.0, cos(a)) * mat3(1.0, 0.0, 0.0, 0.0, cos(b), sin(b), 0.0, -sin(b), cos(b));
          float sz = iSeed.y * (1.0 - smoothstep(0.75, 1.0, k));
          vec3 lp = R * vec3(position.x * 0.35, position.y, 0.0) * sz;
          vShade = 0.5 + 0.5 * (R * vec3(0.0, 0.0, 1.0)).y;
          vec4 mvPosition = viewMatrix * vec4(p + lp, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv; varying float vShade;
        #include <fog_pars_fragment>
        void main() {
          // a feather: a pointed vane either side of the quill
          vec2 q = vUv * 2.0 - 1.0;
          float w = (1.0 - q.y * q.y) * (0.75 + 0.25 * q.y);
          if (abs(q.x) > w || abs(q.y) > 0.98) discard;
          float quill = 1.0 - smoothstep(0.04, 0.09, abs(q.x));
          vec3 col = mix(vec3(0.02, 0.022, 0.03), vec3(0.07, 0.08, 0.12), vShade) + vec3(0.1, 0.1, 0.12) * quill;
          gl_FragColor = vec4(col, 1.0);
          #include <fog_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.next = 0;
    this.time = 0;
    this.dirty = [FEATHERS, 0];
  }

  /** n feathers from around (x, y, z) (spread metres), thrown out at up to `speed` m/s. */
  puff(x, y, z, n, spread = 0.3, speed = 2.5) {
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % FEATHERS;
      const a = Math.random() * 6.283, u = Math.random() * 2 - 1, s = Math.sqrt(1 - u * u), sp = speed * (0.3 + Math.random() * 0.7);
      this.aPos.array.set([x + (Math.random() - 0.5) * spread, y + (Math.random() - 0.5) * spread, z + (Math.random() - 0.5) * spread, this.time], i * 4);
      this.aVel.array.set([Math.cos(a) * s * sp, u * sp * 0.6 + 0.8, Math.sin(a) * s * sp, 1.6 + Math.random() * 1.6], i * 4);
      this.aSeed.array.set([Math.random(), 0.09 + Math.random() * 0.07], i * 2);
      this.dirty[0] = Math.min(this.dirty[0], i);
      this.dirty[1] = Math.max(this.dirty[1], i + 1);
    }
  }

  update(dt) {
    this.time += dt;
    this.mat.uniforms.uTime.value = this.time;
    if (this.dirty[1] > this.dirty[0]) {
      for (const a of [this.aPos, this.aVel, this.aSeed]) {
        a.clearUpdateRanges();
        a.addUpdateRange(this.dirty[0] * a.itemSize, (this.dirty[1] - this.dirty[0]) * a.itemSize);
        a.needsUpdate = true;
      }
      this.dirty[0] = FEATHERS;
      this.dirty[1] = 0;
    }
  }
}

// ---------------------------------------------------------------- ink strokes

const INK_STRANDS = 48, INK_PTS = 40, INK_STEP = 0.12; // (strands on screen, points each, metres between points)

/**
 * A strand is a path of points (x, y, z, birth time, arc length), its head where the brush is now. Each point dries
 * `life` s after it was laid down: gaps open between the bristles, the tail goes first, the whole stroke is gone
 * when its head has dried. The strip's width axis leans toward the camera about the path (`lean`: from the side it
 * stands up like a body-high smear; from behind, strands with opposite leans cross like brush strokes).
 */
export class InkStrokes {
  constructor(scene) {
    const NV = INK_STRANDS * INK_PTS * 2;
    const g = new THREE.BufferGeometry();
    const A = (n) => new THREE.BufferAttribute(new Float32Array(NV * n), n).setUsage(THREE.DynamicDrawUsage);
    this.aPos = A(3); // the path point (the strip is widened in the vertex shader)
    this.aTan = A(4); // path tangent (unit), side (-1 / 1)
    this.aInk = A(4); // along (arc length, m: the bristles stay pinned to the ground they cross), to the head (m), tail (0..1), age (0..1)
    this.aStr = A(4); // half width (m), lean, seed, alpha
    g.setAttribute('position', this.aPos);
    g.setAttribute('aTan', this.aTan);
    g.setAttribute('aInk', this.aInk);
    g.setAttribute('aStr', this.aStr);
    this.index = new THREE.BufferAttribute(new Uint16Array(INK_STRANDS * (INK_PTS - 1) * 6), 1).setUsage(THREE.DynamicDrawUsage);
    g.setIndex(this.index);
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
      fog: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        attribute vec4 aTan; attribute vec4 aInk; attribute vec4 aStr;
        varying vec4 vInk; varying vec3 vStr;
        #include <fog_pars_vertex>
        void main() {
          vec3 p = position, t = aTan.xyz;
          // the width axis: across the path, facing the camera, leaned toward the vertical
          vec3 s = cross(t, cameraPosition - p);
          float sl = length(s);
          s = sl > 1e-5 ? s / sl : vec3(0.0, 1.0, 0.0);
          // (its sign from the path's own right side: from behind s is level and a sign taken from s.y flickered;
          // from the side s is near vertical and either sign leans it the same, up)
          if (dot(s, cross(t, vec3(0.0, 1.0, 0.0))) < 0.0) s = -s;
          vec3 w = vec3(0.0, 1.0, 0.0) + s * aStr.y;
          w -= t * dot(w, t);
          float wl = length(w);
          w = wl > 1e-4 ? w / wl : s;
          vInk = aInk;
          vStr = vec3(aTan.w, aStr.z, aStr.w);
          vec4 mvPosition = viewMatrix * vec4(p + w * aTan.w * aStr.x, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        varying vec4 vInk; varying vec3 vStr;
        #include <fog_pars_fragment>
        float h21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        float vn(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        void main() {
          float v = vStr.x, av = abs(v), seed = vStr.y;
          float along = vInk.x, head = vInk.y, tail = vInk.z, age = vInk.w;
          // bristles: long fibres (noise across the stroke, barely changing along it)
          float fib = vn(vec2(v * 6.0 + seed * 17.0, along * 0.45)) * 0.6 + vn(vec2(v * 21.0 + seed * 5.0, along * 1.4)) * 0.4;
          // the outline: a ragged edge, a round brush tip at the head, thinning to a point at the tail
          float rag = 0.66 + 0.24 * vn(vec2(along * 2.6 + seed * 9.0, v > 0.0 ? 3.0 : 11.0)) + 0.1 * vn(vec2(along * 9.0 + seed * 3.0, v > 0.0 ? 5.0 : 13.0));
          float tip = 1.0 - clamp(head / 0.34, 0.0, 1.0);
          float edge = rag * sqrt(max(0.0, 1.0 - tip * tip)) * mix(0.2, 1.0, pow(tail, 0.6));
          float body = 1.0 - smoothstep(edge - 0.07, edge, av);
          // dry brush: gaps open between the bristles toward the tail, at the frayed edges and as the ink dries
          float dry = 0.1 + 0.5 * (1.0 - smoothstep(0.0, 0.75, tail)) + 0.45 * smoothstep(0.5, 1.0, av / max(edge, 0.05)) + age * 0.95;
          float ink = body * smoothstep(dry - 0.08, dry + 0.03, fib + (1.0 - av) * 0.3);
          float a = ink * vStr.z;
          if (a < 0.02) discard;
          // near-black indigo, bleeding to crimson only at the torn fringes and in the driest strands; a cold sheen on the fibres
          float fringe = clamp(smoothstep(0.8, 1.0, av / max(edge, 0.05)) + (1.0 - tail) * 0.12 + age * 0.2, 0.0, 1.0);
          vec3 col = mix(vec3(0.007, 0.007, 0.02), vec3(0.13, 0.008, 0.026), fringe * 0.55);
          col += vec3(0.035, 0.045, 0.1) * smoothstep(0.72, 0.95, fib) * (1.0 - fringe);
          gl_FragColor = vec4(col, a);
          #include <fog_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.pool = [];
    for (let i = 0; i < INK_STRANDS; i++) this.pool.push({ p: new Float32Array(INK_PTS * 5), n: 0, on: false });
    this.list = [];
    this.time = 0;
  }

  /** A new strand (null when every one is in use): hw half width (m), lean (-0.7..0.7), life (s a point takes to dry). */
  add(hw, lean, life, alpha = 1) {
    const S = this.pool.find((s) => !s.on);
    if (!S) return null;
    S.on = true;
    S.live = true;
    S.n = 0;
    S.hw = hw;
    S.lean = lean;
    S.life = life;
    S.alpha = alpha;
    S.seed = Math.random();
    this.list.push(S);
    return S;
  }

  /** The brush moves on to (x, y, z) at time t (this clock's s; default now): a new point every INK_STEP metres, the head in between. */
  push(S, x, y, z, t = this.time) {
    if (!S?.live) return;
    const P = S.p;
    let n = S.n, s = 0;
    if (n) {
      const o = (n - 1) * 5, d = Math.hypot(x - P[o], y - P[o + 1], z - P[o + 2]);
      if (d < 1e-4) {
        P[o + 3] = t;
        return;
      }
      if (n >= 2) {
        const o2 = (n - 2) * 5, d2 = Math.hypot(x - P[o2], y - P[o2 + 1], z - P[o2 + 2]);
        if (Math.hypot(P[o] - P[o2], P[o + 1] - P[o2 + 1], P[o + 2] - P[o2 + 2]) < INK_STEP) {
          // (the head point moves with the brush until it is a step from the one before)
          P[o] = x;
          P[o + 1] = y;
          P[o + 2] = z;
          P[o + 3] = t;
          P[o + 4] = P[o2 + 4] + d2;
          return;
        }
      }
      s = P[o + 4] + d;
    }
    if (n === INK_PTS) {
      P.copyWithin(0, 5);
      n--;
    }
    const o = n * 5;
    P[o] = x;
    P[o + 1] = y;
    P[o + 2] = z;
    P[o + 3] = t;
    P[o + 4] = s;
    S.n = n + 1;
  }

  /** A straight stroke from (x0, y0, z0) to (x1, y1, z1), all wet (a blot that moves with its brush: redrawn each frame). */
  line(S, x0, y0, z0, x1, y1, z1) {
    if (!S?.live) return;
    S.n = 0;
    this.push(S, x0, y0, z0);
    this.push(S, x1, y1, z1);
  }

  /** The brush lifts: the strand dries out and is gone, all of it within `fade` s (its fresh head would linger by the body). */
  release(S, fade = 0.3) {
    if (!S?.live) return;
    S.live = false;
    S.rel = this.time;
    S.fade = fade;
  }

  clear() {
    for (const S of this.list) S.on = false;
    this.list.length = 0;
    this.update(0);
  }

  update(dt) {
    this.time += dt;
    const X = this.aPos.array, T = this.aTan.array, K = this.aInk.array, R = this.aStr.array, I = this.index.array;
    let v = 0, ix = 0, w = 0;
    for (const S of this.list) {
      const P = S.p, n = S.n;
      // gone once its newest point has dried (a live strand keeps its head wet)
      // (released: every point dries a little more each frame on top of its age: no pop, gone by `fade`)
      const extra = S.live ? 0 : (this.time - S.rel) / S.fade;
      if (!S.live && (extra >= 1 || !n || (this.time - P[(n - 1) * 5 + 3]) / S.life >= 1)) {
        S.on = false;
        continue;
      }
      this.list[w++] = S;
      if (n < 2) continue;
      const s0 = P[4], s1 = P[(n - 1) * 5 + 4], len = s1 - s0, tl = 0.25 + len * 0.4;
      const v0 = v;
      for (let i = 0; i < n; i++) {
        const o = i * 5, a = Math.max(0, i - 1) * 5, b = Math.min(n - 1, i + 1) * 5;
        let tx = P[b] - P[a], ty = P[b + 1] - P[a + 1], tz = P[b + 2] - P[a + 2];
        const tl2 = Math.hypot(tx, ty, tz) || 1;
        tx /= tl2;
        ty /= tl2;
        tz /= tl2;
        const age = Math.min(1, Math.max(0, (this.time - P[o + 3]) / S.life) + extra);
        for (let side = -1; side <= 1; side += 2) {
          X[v * 3] = P[o];
          X[v * 3 + 1] = P[o + 1];
          X[v * 3 + 2] = P[o + 2];
          T[v * 4] = tx;
          T[v * 4 + 1] = ty;
          T[v * 4 + 2] = tz;
          T[v * 4 + 3] = side;
          K[v * 4] = P[o + 4];
          K[v * 4 + 1] = s1 - P[o + 4];
          K[v * 4 + 2] = Math.min(1, (P[o + 4] - s0) / tl);
          K[v * 4 + 3] = age;
          R[v * 4] = S.hw;
          R[v * 4 + 1] = S.lean;
          R[v * 4 + 2] = S.seed;
          R[v * 4 + 3] = S.alpha;
          v++;
        }
      }
      for (let i = 0; i < n - 1; i++) {
        const a = v0 + i * 2;
        I[ix++] = a;
        I[ix++] = a + 1;
        I[ix++] = a + 3;
        I[ix++] = a;
        I[ix++] = a + 3;
        I[ix++] = a + 2;
      }
    }
    this.list.length = w;
    const g = this.mesh.geometry;
    g.setDrawRange(0, ix);
    this.mesh.visible = ix > 0;
    if (!ix) return;
    for (const [a, n] of [[this.aPos, 3], [this.aTan, 4], [this.aInk, 4], [this.aStr, 4]]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, v * n);
      a.needsUpdate = true;
    }
    this.index.clearUpdateRanges();
    this.index.addUpdateRange(0, ix);
    this.index.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- the genjutsu on the victim's screen

// (the stack works in linear light: light and shade are judged by perceived lightness, ~gamma 2.2; gotcha 50)
const genjutsuFrag = /* glsl */ `
uniform float uAmt; uniform float uEye; uniform float uTime; uniform float uEyeS; uniform float uEyeR;
uniform float uDim; uniform float uMono; uniform float uNeg; uniform float uFlash; uniform vec2 uCover;
${SEAL_GLSL}
// the negative world's ramp, by darkness (perceived): black, blood-brown, dusty rose, white
vec3 negRamp(float n) {
  vec3 c = mix(vec3(0.015, 0.0, 0.0), vec3(0.3, 0.07, 0.045), smoothstep(0.0, 0.32, n));
  c = mix(c, vec3(0.58, 0.44, 0.42), smoothstep(0.32, 0.62, n));
  return mix(c, vec3(0.95, 0.94, 0.94), smoothstep(0.62, 0.95, n));
}
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  // (the saturation boost can push a saturated colour's weak channel below 0, and the sRGB transfer round the
  // contrast effect turns that into NaN: invisible on a channel that was ~0 anyway, but the grades below mix all
  // three through the luminance and the whole pixel went wrong: yellow grass, red clouds in the negative world)
  if (!(c.r >= 0.0)) c.r = 0.0;
  if (!(c.g >= 0.0)) c.g = 0.0;
  if (!(c.b >= 0.0)) c.b = 0.0;
  vec2 sq = (uv - 0.5) * vec2(aspect, 1.0);
  float lum = pow(max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 0.0), 0.4545);
  if (uDim > 0.001) {
    // inside the genjutsu the world drains of colour and light, cold, the edges sinking
    vec3 g = pow(vec3(lum) * vec3(0.86, 0.84, 0.98), vec3(2.2)) * 0.72;
    c = mix(c, g, uDim * 0.8) * (1.0 - uDim * smoothstep(0.35, 0.9, length(sq)) * 0.6);
  }
  if (uMono > 0.001) c = mix(c, pow(vec3(lum) * vec3(1.0, 0.985, 0.97), vec3(2.2)), uMono);
  if (uNeg > 0.001) {
    // the negative world: light becomes dark and dark light, on the ramp
    vec3 ng = pow(negRamp(1.0 - lum), vec3(2.2)) * (1.0 - smoothstep(0.45, 1.05, length(sq)) * 0.55);
    c = mix(c, ng, uNeg);
  }
  if (uAmt > 0.001) {
    // Tsukuyomi's world: light turns to blood red, shade to black (hard, like ink), a dark vignette closing in
    // (the stack works in linear light: judge light and shade by perceived lightness, ~gamma 2.2)
    float l = pow(max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 0.0), 0.4545);
    float t = smoothstep(0.22, 0.72, l);
    vec3 w = vec3(0.9, 0.03, 0.035) * t + vec3(0.35, 0.18, 0.16) * pow(t, 5.0);
    vec2 q = (uv - 0.5) * vec2(aspect, 1.0);
    w *= 1.0 - smoothstep(0.3, 0.95, length(q)) * 0.85;
    // (a slow, sick pulse)
    w *= 0.9 + 0.1 * sin(uTime * 2.2);
    c = mix(c, w, uAmt);
  }
  if (uFlash > 0.001) c = mix(c, vec3(1.0, 0.9, 0.88), uFlash);
  if (uEye > 0.001) {
    // the Mangekyō over the whole view (uEyeS: its iris radius in screen heights, uEyeR: its turn)
    vec4 m = itachiSeal(sq / uEyeS, uEyeR);
    c = mix(c, min(m.rgb, vec3(1.0)), m.a * uEye);
  }
  if (uCover.y > 0.001) {
    // its pupil opening over everything, then a hole opening in it (screen heights: inner, outer), rimmed red
    float r = length(sq);
    float cov = smoothstep(uCover.x - 0.006, uCover.x + 0.006, r) * (1.0 - smoothstep(uCover.y - 0.006, uCover.y + 0.006, r));
    float rim = exp(-pow((r - uCover.y) / 0.022, 2.0)) + exp(-pow((r - uCover.x) / 0.035, 2.0)) * step(0.01, uCover.x);
    c = mix(c, vec3(0.0), cov) + vec3(0.85, 0.02, 0.02) * rim * 0.9;
  }
  outputColor = vec4(c, inputColor.a);
}`;

export class GenjutsuEffect extends Effect {
  constructor() {
    const U = (v) => new THREE.Uniform(v);
    // (SRC: it replaces the colour outright; blended by the buffer's alpha, see-through hair and cloth kept their own
    // colours through the negative)
    super('Genjutsu', genjutsuFrag, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map([
        ['uAmt', U(0)], ['uEye', U(0)], ['uTime', U(0)], ['uEyeS', U(0.36)], ['uEyeR', U(0)],
        ['uDim', U(0)], ['uMono', U(0)], ['uNeg', U(0)], ['uFlash', U(0)], ['uCover', U(new THREE.Vector2())],
      ]),
    });
    this.reset();
  }

  /** This frame's strengths, set by the kit (Tsukuyomi's world: tsukuyomi.js), applied in apply(), then reset. */
  reset() {
    this.amt = 0;
    this.eye = 0;
    this.eyeS = 0.36;
    this.eyeR = null; // (null: turning with the clock)
    this.dim = 0;
    this.mono = 0;
    this.neg = 0;
    this.flash = 0;
    this.cover = [0, 0];
  }

  apply(dt) {
    const U = this.uniforms, t = (U.get('uTime').value += dt);
    for (const [k, v] of [['uAmt', this.amt], ['uEye', this.eye], ['uEyeS', this.eyeS], ['uEyeR', this.eyeR ?? t * 1.6], ['uDim', this.dim], ['uMono', this.mono], ['uNeg', this.neg], ['uFlash', this.flash]]) U.get(k).value = v;
    U.get('uCover').value.set(this.cover[0], this.cover[1]);
    this.reset();
  }
}
