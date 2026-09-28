// Itachi's jutsu visuals (all created up front, pooled, compiled behind the loading screen; nothing is allocated
// mid-fight). The fire and the black flames are Madara's Billows (madarafx.js: `black` turns the ramp into
// Amaterasu's); here:
//   EyeMarks   camera-facing Mangekyō Sharingan billboards: the Tsukuyomi mark over a victim (an eye that opens, its
//              pinwheel turning, a red halo) and the glow in Itachi's own eyes through his casts. HDR red feeds the bloom.
//   Crows      a flock of low-poly crows in one instanced draw: wings flap in the vertex shader (two joints), bodies
//              bank into their turns, near-black with a blue sheen, ink-outlined (opaque, depth-written).
//   Feathers   black feathers fluttering down, animated entirely on the GPU from their spawn (like fx.js).
//   GenjutsuEffect  the victim's own screen inside Tsukuyomi: the world turned to red and black, the Mangekyō flashed
//              over the view as it takes hold (a post effect in the stack's first pass; strength 0 = off).
import * as THREE from 'three';
import { Effect } from 'postprocessing';

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
          vec3 wp = iPos.xyz + (-r2 * p.x + u2 * p.y + f * p.z) * iPos.w;
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

// ---------------------------------------------------------------- the genjutsu on the victim's screen

const genjutsuFrag = /* glsl */ `
uniform float uAmt; uniform float uEye; uniform float uTime;
${MANGEKYO}
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
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
  if (uEye > 0.001) {
    // the Mangekyō over the whole view the moment it takes hold
    vec2 q = (uv - 0.5) * vec2(aspect, 1.0) / 0.36;
    vec4 m = mangekyo(q, uTime * 1.6);
    c = mix(c, min(m.rgb, vec3(1.0)), m.a * uEye);
  }
  outputColor = vec4(c, inputColor.a);
}`;

export class GenjutsuEffect extends Effect {
  constructor() {
    super('Genjutsu', genjutsuFrag, {
      uniforms: new Map([
        ['uAmt', new THREE.Uniform(0)],
        ['uEye', new THREE.Uniform(0)],
        ['uTime', new THREE.Uniform(0)],
      ]),
    });
    this.amt = 0; // this frame's strengths (set by the kit), applied in apply()
    this.eye = 0;
  }

  apply(dt) {
    const U = this.uniforms;
    U.get('uTime').value += dt;
    U.get('uAmt').value = this.amt;
    U.get('uEye').value = this.eye;
    this.amt = 0;
    this.eye = 0;
  }
}
