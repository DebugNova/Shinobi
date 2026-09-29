// Tsukuyomi's visuals (Itachi's E). Everything is created up front and compiled behind the loading screen; nothing
// is allocated mid-fight.
//   SealFx   the Mangekyō as the jutsu throws it, drawn from per-instance layer weights on quads (camera-facing, or
//            turned to a normal): the capture round a victim (a white flash sphere with wind streaks, a violet sphere,
//            three black blades sweeping in, a red ring tearing into ink, then the whole Mangekyō turning over the
//            body), the eye projected in front of Itachi as he casts, the stage's violet sphere and ink pinwheel.
//            HDR red and white feed the bloom.
//   Stage    the world inside the genjutsu, built where its victim stood: the T-shaped cross (pale wood, rope), a sky
//            shell and a ground disc that take over once the fog has swallowed the arena, a planar shadow of the cross.
//   Swords   the katanas (instanced, faceted steel with a hamon, a wrapped grip) and their motion streaks.
//   Ink      splatters bursting off every stab, drops flying, stains on the ground (animated on the GPU).
// The victim's screen grades the stage (GenjutsuEffect): dim, fog-grey, then the negative world (luminance inverted
// onto a black / blood-brown / white ramp). What must keep its own look through the negative (steel, streaks, ink,
// the shadow) is written as its own negative by uNeg; the sky and the ground write theirs directly.
import * as THREE from 'three';
import { toon } from './toon.js';

// ---------------------------------------------------------------- the Mangekyō (GLSL, shared with the post effect)

// Itachi's Mangekyō as the jutsu projects it. The unit disc is the iris; the brush ring and its three horns reach
// r ~1.65. pinwheel(): the black pattern alone (a ring round a hollow pupil, three sickles), as it hangs over the
// stage. Angles are measured counter-clockwise; `rot` turns everything.
export const SEAL_GLSL = /* glsl */ `
  #define S_TAU 6.2831853
  float sAngd(float a, float c) { return mod(a - c + 3.14159265, S_TAU) - 3.14159265; }
  float sH(float n) { return fract(sin(n * 127.1 + 1.7) * 43758.5453); }
  // noise round the circle with k cells (no seam at +-pi)
  float sCirc(float a, float k, float seed) {
    float x = (a / S_TAU + 0.5) * k, i = floor(x), f = fract(x), u = f * f * (3.0 - 2.0 * f);
    return mix(sH(mod(i, k) + seed * 13.0), sH(mod(i + 1.0, k) + seed * 13.0), u);
  }
  // three sickle blades from r0 to r1, curving curv rad along their length, w rad at their widest (near the root
  // third); the leading edge runs straight, the trailing one bellies out. aa: the edge's softness in radius units.
  float sSickles(float r, float a, float rot, float r0, float r1, float w, float curv, float aa) {
    float s = (r - r0) / (r1 - r0);
    if (s <= 0.0 || s >= 1.0) return 0.0;
    float prof = w * pow(sin(3.14159265 * pow(s, 0.62)), 0.85);
    float ink = 0.0;
    for (int k = 0; k < 3; k++) {
      float d = sAngd(a, rot + float(k) * 2.0943951 + s * curv);
      float wk = d > 0.0 ? prof : prof * 0.42;
      ink = max(ink, 1.0 - smoothstep(wk - aa / max(r, 0.04), wk, abs(d)));
    }
    return ink * smoothstep(0.0, 0.04, s);
  }
  // rgb (HDR red) + alpha
  vec4 itachiSeal(vec2 q, float rot) {
    float r = length(q), a = atan(q.y, q.x);
    if (r > 1.7) return vec4(0.0);
    vec3 red = mix(vec3(2.5, 0.16, 0.09), vec3(0.4, 0.0, 0.015), smoothstep(0.04, 0.97, r));
    red += vec3(1.1, 0.04, 0.03) * exp(-pow((r - 0.56) / 0.07, 2.0));
    float ink = 1.0 - smoothstep(0.125, 0.14, r);
    ink = max(ink, sSickles(r, a, rot, 0.09, 0.72, 0.62, 2.3, 0.012));
    ink = max(ink, 1.0 - smoothstep(0.01, 0.022, abs(r - 0.79)));
    float iris = 1.0 - smoothstep(0.93, 0.945, r);
    // the brush ring: ragged, with thorns, turning a little slower than the eye
    float ar = a - rot * 0.7;
    float e = 1.05 + 0.05 * sCirc(ar, 23.0, 3.0) + 0.11 * pow(max(0.0, sin(ar * 9.0 + 2.0 * sCirc(ar, 7.0, 1.0))), 10.0);
    float ring = smoothstep(0.905, 0.925, r) * (1.0 - smoothstep(e - 0.02, e, r));
    // three horns sweeping off it, trailing the spin
    float hs = (r - 0.93) / 0.72, horn = 0.0;
    if (hs > 0.0 && hs < 1.0) {
      for (int k = 0; k < 3; k++) {
        float d = abs(sAngd(a, rot + float(k) * 2.0943951 + 0.55 - hs * 1.3));
        float hw = 0.38 * pow(1.0 - hs, 1.3);
        horn = max(horn, 1.0 - smoothstep(hw - 0.018 / r, hw, d));
      }
    }
    float black = max(ring, horn);
    return vec4(mix(red, vec3(0.012, 0.0, 0.004), max(ink * iris, black)), max(iris, black));
  }
  float pinwheel(vec2 q, float rot) {
    float r = length(q), a = atan(q.y, q.x);
    float ring = smoothstep(0.12, 0.135, r) * (1.0 - smoothstep(0.255, 0.27, r));
    return max(ring, sSickles(r, a, rot, 0.19, 1.0, 0.78, 2.1, 0.012));
  }`;

// ---------------------------------------------------------------- seals

const SEALS = 16;

export class SealFx {
  constructor(scene) {
    const quad = new THREE.PlaneGeometry(2, 2);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.attributes.position);
    const A = (k) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(SEALS * 4), 4).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(k, a);
      return a;
    };
    this.attrs = [A('iPos'), A('iN'), A('iA'), A('iB'), A('iC')];
    // iPos: x, y, z, size (m: the iris radius)   iN: facing normal (0 = toward the camera), pull toward the camera (m)
    // iA: weights of the flash sphere, the violet sphere, the black blades, the red ring
    // iB: weights of the seal, the ink pinwheel; age (s), spin (rad)   iC: scales of the seal, pinwheel, blades; dark core
    g.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      premultipliedAlpha: true,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        attribute vec4 iPos; attribute vec4 iN; attribute vec4 iA; attribute vec4 iB; attribute vec4 iC;
        varying vec2 vQ; varying vec4 vA; varying vec4 vB; varying vec4 vC;
        void main() {
          vQ = position.xy * 1.75; vA = iA; vB = iB; vC = iC;
          if (iPos.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          vec3 c = iPos.xyz;
          float s = iPos.w * 1.75;
          if (dot(iN.xyz, iN.xyz) < 0.01) {
            vec4 mv = viewMatrix * vec4(c, 1.0);
            // (pulled toward the camera so the body it wraps doesn't cut through it)
            mv.xyz += normalize(-mv.xyz) * iN.w;
            mv.xy += position.xy * s;
            gl_Position = projectionMatrix * mv;
          } else {
            vec3 n = normalize(iN.xyz);
            vec3 r = abs(n.y) > 0.98 ? vec3(1.0, 0.0, 0.0) : normalize(cross(vec3(0.0, 1.0, 0.0), n));
            vec3 u = cross(n, r);
            gl_Position = projectionMatrix * viewMatrix * vec4(c + (r * position.x + u * position.y) * s, 1.0);
          }
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vQ; varying vec4 vA; varying vec4 vB; varying vec4 vC;
        ${SEAL_GLSL}
        vec4 acc;
        void over(vec3 c, float a) { a = clamp(a, 0.0, 1.0); acc.rgb = c * a + acc.rgb * (1.0 - a); acc.a = a + acc.a * (1.0 - a); }
        void main() {
          acc = vec4(0.0);
          vec2 q = vQ;
          float r = length(q), a = atan(q.y, q.x), age = vB.z, spin = vB.w;
          // the violet sphere: a thin shell (bright rim, faint body), a highlight up on the left, a dark core
          if (vA.y > 0.001) {
            float R = 1.0 + 0.025 * sin(age * 7.0);
            float x = r / R;
            if (x < 1.0) {
              float rim = pow(x, 5.0);
              over(mix(vec3(0.3, 0.2, 0.95), vec3(0.75, 0.62, 1.6), rim), (0.2 + 0.6 * rim) * vA.y * (1.0 - smoothstep(0.985, 1.0, x)));
              float hl = exp(-pow(length(q / R - vec2(-0.38, 0.46)) / 0.16, 2.0));
              over(vec3(1.4, 1.3, 1.8), 0.35 * hl * vA.y);
              over(vec3(0.02, 0.0, 0.05), vC.w * vA.y * exp(-pow(r / 0.2, 2.0)));
            }
          }
          // the white flash: a sphere swelling out, wind tearing off it in streaks
          if (vA.x > 0.001) {
            float R = 0.62 + 0.5 * (1.0 - exp(-age * 9.0));
            float x = r / R;
            float body = (1.0 - smoothstep(0.97, 1.0, x)) * (0.34 + 0.66 * pow(x, 4.0));
            float st = 0.0;
            for (int k = 0; k < 16; k++) {
              float fk = float(k), ang = (fk + sH(fk) * 0.7) * S_TAU / 16.0 + 0.3;
              float d = abs(sAngd(a, ang));
              float len = 0.35 + 0.5 * sH(fk + 7.0), head = R * (0.92 + age * (2.2 + 2.0 * sH(fk + 3.0)));
              float along = smoothstep(head - len, head, r) * (1.0 - smoothstep(head, head + 0.03, r));
              st = max(st, along * (1.0 - smoothstep(0.004, 0.022, d * r)) * (0.5 + 0.5 * sH(fk + 11.0)));
            }
            over(vec3(1.9, 1.85, 2.1), max(body, st * 0.9) * vA.x);
          }
          // the red ring tearing into ink: a hot line, a ragged black stroke hugging it, thorns flying off
          if (vA.w > 0.001) {
            float g = exp(-pow((r - 1.0) / 0.035, 2.0));
            over(vec3(2.6, 0.12, 0.06), g * vA.w);
            over(vec3(1.2, 0.02, 0.02), 0.35 * exp(-pow((r - 1.0) / 0.16, 2.0)) * vA.w);
            float rb = r - 1.06 - 0.14 * (sCirc(a, 17.0, 5.0) - 0.5) - 0.07 * (sCirc(a, 41.0, 9.0) - 0.5);
            float stroke = (1.0 - smoothstep(0.012, 0.028, abs(rb))) * step(0.35, sCirc(a + spin * 0.2, 11.0, 2.0));
            float th = pow(max(0.0, sin(a * 13.0 + 3.0 * sCirc(a, 5.0, 4.0))), 26.0) * step(1.0, r) * (1.0 - smoothstep(1.05, 1.32, r));
            over(vec3(0.015, 0.0, 0.004), max(stroke, th) * vA.w);
          }
          // the seal itself
          if (vB.x > 0.001) {
            vec4 m = itachiSeal(q / vC.x, spin);
            // (the iris lets the body show through; the ink is solid)
            float ia = m.a * (m.r > 0.05 ? 0.78 : 0.97);
            over(m.rgb, ia * vB.x);
          }
          // three great black blades sweeping round the body (they close in as they slow)
          if (vA.z > 0.001) {
            float b = sSickles(r / vC.z, a, spin * 1.6 + 0.8, 0.2, 1.0, 0.55, 2.0, 0.01);
            over(vec3(0.01, 0.0, 0.004), b * vA.z);
          }
          // the ink pinwheel hanging over the stage
          if (vB.y > 0.001) over(vec3(0.02, 0.005, 0.02), pinwheel(q / vC.y, spin) * 0.82 * vB.y);
          if (acc.a < 0.004) discard;
          gl_FragColor = acc;
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    scene.add(this.mesh);
    this.n = 0;
  }

  begin() {
    this.n = 0;
  }

  /**
   * One seal this frame. p: position, size: the iris radius (m), n: facing normal or null (toward the camera),
   * pull: metres toward the camera, w: { flash, violet, blades, ring, seal, ink }, age (s), spin (rad),
   * sc: { seal, ink, blades } scales, core: the violet sphere's dark core.
   */
  set(p, size, n, pull, w, age, spin, sc, core = 0) {
    if (this.n >= SEALS) return;
    const o = this.n++ * 4, [P, N, A, B, C] = this.attrs.map((x) => x.array);
    P.set([p.x, p.y, p.z, size], o);
    N.set(n ? [n.x, n.y, n.z, 0] : [0, 0, 0, pull], o);
    A.set([w.flash || 0, w.violet || 0, w.blades || 0, w.ring || 0], o);
    B.set([w.seal || 0, w.ink || 0, age, spin], o);
    C.set([sc?.seal || 1, sc?.ink || 1, sc?.blades || 1, core], o);
  }

  end() {
    const g = this.mesh.geometry;
    g.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
    if (!this.n) return;
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.n * 4);
      a.needsUpdate = true;
    }
  }
}

// ---------------------------------------------------------------- the stage

// A colour written as its own negative (perceived lightness flipped): the victim's post flips it back, so steel and
// streaks keep their look through the negative world. neg: 0..1 (the post's own uNeg).
const NEG_SELF = /* glsl */ `
  vec3 negSelf(vec3 c, float neg) {
    vec3 p = pow(clamp(c, 0.0, 1.0), vec3(0.4545));
    return mix(c, pow(vec3(1.0) - p, vec3(2.2)), neg);
  }`;

const NOISE_GLSL = /* glsl */ `
  float tH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float tN(vec2 p) {
    vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(tH(i), tH(i + vec2(1, 0)), u.x), mix(tH(i + vec2(0, 1)), tH(i + vec2(1, 1)), u.x), u.y);
  }
  float tF(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += tN(p) * a; p = p * 2.03 + 7.1; a *= 0.5; } return s; }`;

/** Pale weathered wood for the cross: grain along u, a few dark cracks, knots, a lavender-grey cast (image-matched). */
function woodTexture() {
  const w = 512, h = 128, c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d');
  let s = 91;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  x.fillStyle = '#e4e2e6';
  x.fillRect(0, 0, w, h);
  for (let i = 0; i < 140; i++) {
    const y = rnd() * h, l = 40 + rnd() * 260, x0 = rnd() * w, a = 0.05 + rnd() * 0.12;
    x.strokeStyle = rnd() < 0.7 ? `rgba(120,118,138,${a})` : `rgba(255,255,255,${a * 1.5})`;
    x.lineWidth = 0.6 + rnd() * 1.6;
    x.beginPath();
    x.moveTo(x0, y);
    for (let k = 1; k <= 6; k++) x.lineTo(x0 + (l * k) / 6, y + (rnd() - 0.5) * 3);
    x.stroke();
  }
  // cracks and chips: dark, short, broken
  for (let i = 0; i < 26; i++) {
    const y = rnd() * h, x0 = rnd() * w, l = 10 + rnd() * 50;
    x.strokeStyle = `rgba(40,36,52,${0.35 + rnd() * 0.4})`;
    x.lineWidth = 0.8 + rnd() * 1.2;
    x.beginPath();
    x.moveTo(x0, y);
    x.lineTo(x0 + l * 0.5, y + (rnd() - 0.5) * 4);
    x.lineTo(x0 + l, y + (rnd() - 0.5) * 6);
    x.stroke();
  }
  for (let i = 0; i < 3; i++) {
    const cx = rnd() * w, cy = rnd() * h;
    x.strokeStyle = 'rgba(90,86,108,0.35)';
    for (let k = 0; k < 3; k++) {
      x.lineWidth = 1;
      x.beginPath();
      x.ellipse(cx, cy, 6 + k * 4, 2.5 + k * 2, 0, 0, Math.PI * 2);
      x.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** A beam: a box whose UVs run the grain along its long axis (metres, so the wood never stretches). */
function beam(w, h, d, axis) {
  const g = new THREE.BoxGeometry(w, h, d, 1, 1, 1);
  const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
  for (let i = 0; i < P.count; i++) {
    const p = [P.getX(i), P.getY(i), P.getZ(i)], n = [N.getX(i), N.getY(i), N.getZ(i)];
    const along = p[axis];
    // the other axis on this face: whichever of the remaining two the normal doesn't point along
    const rest = [0, 1, 2].filter((k) => k !== axis && Math.abs(n[k]) < 0.5);
    const across = rest.length ? p[rest[0]] : p[(axis + 1) % 3];
    U.setXY(i, along * 0.55, across * 2.2 + 0.5);
  }
  return g;
}

export class Stage {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.uNeg = { value: 0 };
    this.uFog = { value: 0 };
    this.uTime = { value: 0 };
    // the cross: a post and a crossbar at its top (a T), built for a crossbar at 1 m; set(): the height
    this.woodMap = woodTexture();
    this.wood = toon({ map: this.woodMap, hatch: 0.5, fade: false, color: 0xffffff });
    this.post = new THREE.Mesh(beam(0.3, 1, 0.3, 1), this.wood);
    this.bar = new THREE.Mesh(beam(2.6, 0.27, 0.27, 0), this.wood);
    this.cross = new THREE.Group();
    this.cross.add(this.post, this.bar);
    // rope: a few turns at each wrist and round the ankles
    const ropeMat = toon({ color: 0x6b5a45, hatch: 0.6, fade: false });
    const turn = new THREE.TorusGeometry(0.155, 0.022, 6, 14);
    this.ropes = [0, 1, 2].map((k) => {
      const g = new THREE.Group();
      for (let j = 0; j < 3; j++) {
        const m = new THREE.Mesh(turn, ropeMat);
        m.position.x = (j - 1) * 0.045;
        m.rotation.y = Math.PI / 2;
        m.rotation.x = (j - 1) * 0.12;
        g.add(m);
      }
      // (stretched front to back: round the beam and the limb tied in front of it; the ankles' turns lie flat)
      if (k === 2) {
        g.rotation.z = Math.PI / 2;
        g.scale.set(1, 1.15, 1.7);
      } else g.scale.set(1, 1, 1.55);
      this.cross.add(g);
      return g;
    });
    this.group.add(this.cross);
    for (const m of [this.post, this.bar, ...this.ropes.flatMap((g) => g.children)]) m.castShadow = false;
    // the planar shadow of the cross on the ground disc (along the sun; the real shadow map ends at the arena)
    this.shadowMat = new THREE.ShaderMaterial({
      uniforms: { uNeg: this.uNeg },
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float uNeg; void main() { gl_FragColor = vec4(vec3(mix(0.0, 1.0, uNeg)), 0.62); }',
    });
    this.shadow = new THREE.Mesh(new THREE.BufferGeometry(), this.shadowMat);
    this.shadow.matrixAutoUpdate = false;
    this.shadow.renderOrder = 1;
    this.group.add(this.shadow);
    // the sky shell and the ground disc (shown once the fog has swallowed the arena)
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(42, 48, 24), new THREE.ShaderMaterial({
      uniforms: { uNeg: this.uNeg, uFog: this.uFog, uTime: this.uTime },
      side: THREE.BackSide,
      fog: false,
      vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */ `
        uniform float uNeg, uFog, uTime;
        varying vec3 vDir;
        ${NOISE_GLSL}
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          // the fog world: white-grey at the horizon, a dark warm grey overhead, slow billows
          vec2 sp = d.xz / (abs(h) + 0.3);
          float b = tF(sp * 1.1 + vec2(uTime * 0.05, uTime * 0.02));
          vec3 fogc = mix(vec3(0.86, 0.86, 0.87), vec3(0.3, 0.27, 0.25), smoothstep(0.0, 0.55, h + (b - 0.5) * 0.18));
          // the negative sky, as the post will see it (darkness n on the ramp; written as luminance 1 - n): a deep
          // blood-brown with black cloud masses drifting, a redder glow low on the horizon
          float cl = tF(sp * 0.8 + vec2(uTime * 0.07, -uTime * 0.03));
          float cl2 = tF(sp * 2.3 - vec2(uTime * 0.11, uTime * 0.05));
          float n = mix(0.3, 0.06, smoothstep(0.46, 0.64, cl * 0.75 + cl2 * 0.35));
          n = mix(n, 0.44, (1.0 - smoothstep(0.0, 0.3, h)) * 0.75);
          vec3 neg = vec3(1.0 - n);
          neg = mix(neg, vec3(0.75), smoothstep(0.03, -0.12, h));
          vec3 col = mix(fogc, neg, uNeg);
          gl_FragColor = vec4(pow(col, vec3(2.2)), 1.0);
        }`,
    }));
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -5;
    this.group.add(this.dome);
    const gg = new THREE.CircleGeometry(42, 72);
    gg.rotateX(-Math.PI / 2);
    this.ground = new THREE.Mesh(gg, new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
      fog: true,
      vertexShader: /* glsl */ `
        varying vec2 vP;
        #include <fog_pars_vertex>
        void main() {
          vP = position.xz;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform float uNeg;
        varying vec2 vP;
        ${NOISE_GLSL}
        #include <fog_pars_fragment>
        void main() {
          float nz = tF(vP * 0.3), fine = tN(vP * 3.1);
          // fog: pale grey earth; negative: near-white ground with pale rose-grey patches (written as its negative)
          vec3 fogG = vec3(0.6, 0.59, 0.57) * (0.88 + 0.22 * nz + 0.05 * fine);
          float n = mix(0.9, 0.7, smoothstep(0.42, 0.68, nz)) - 0.04 * fine;
          vec3 col = mix(fogG, vec3(1.0 - n), uNeg);
          gl_FragColor = vec4(pow(col, vec3(2.2)), 1.0);
          #include <fog_fragment>
        }`,
    }));
    this.ground.material.uniforms.uNeg = this.uNeg;
    this.ground.position.y = 0.01;
    this.ground.renderOrder = -4;
    this.group.add(this.ground);
    this.world(false);
  }

  /** The sky shell and ground disc on (the arena is hidden behind them) or off (the arena shows round the cross). */
  world(on) {
    this.dome.visible = on;
    this.ground.visible = on;
    this.shadow.visible = on;
  }

  /**
   * Builds the stage at (x, y, z) (the ground at the victim's feet) turned by yaw (stage -z = the way the victim
   * faces). barY: the crossbar's centre above the ground; sun: toward the sun (world).
   */
  place(x, y, z, yaw, barY, sun) {
    const G = this.group;
    G.position.set(x, y, z);
    G.rotation.set(0, yaw, 0);
    this.barY = barY;
    const top = barY + 0.135, bottom = -0.25;
    this.post.scale.set(1, top - bottom, 1);
    this.post.position.set(0, (top + bottom) / 2, 0.27);
    this.bar.position.set(0, barY, 0.27);
    // the shadow: both beams flattened onto the ground along the sun (local frame)
    const L = new THREE.Vector3().copy(sun).applyAxisAngle(new THREE.Vector3(0, 1, 0), -yaw).normalize();
    const ly = Math.max(0.2, L.y);
    const flat = new THREE.Matrix4().set(1, -L.x / ly, 0, 0, 0, 0, 0, 0.02, 0, -L.z / ly, 1, 0, 0, 0, 0, 1);
    const geos = [this.post, this.bar].map((m) => {
      m.updateMatrix();
      return m.geometry.clone().applyMatrix4(m.matrix);
    });
    this.shadow.geometry.dispose();
    this.shadow.geometry = mergeBoxes(geos);
    this.shadow.matrix.copy(flat);
    G.updateMatrixWorld(true);
  }

  /** Rope at the wrists and the ankles: world positions (or null to hide one). */
  bind(wl, wr, ankles) {
    const G = this.group;
    const put = (r, p, k) => {
      r.visible = !!p;
      if (!p) return;
      G.worldToLocal(r.position.copy(p));
      if (k < 2) {
        r.position.y = this.barY;
        r.position.z = 0.2;
      } else {
        r.position.x = 0;
        r.position.z = 0.2;
      }
    };
    put(this.ropes[0], wl, 0);
    put(this.ropes[1], wr, 1);
    put(this.ropes[2], ankles, 2);
  }

  /** Shadow casters while it stands (main.js shadowCasters). */
  casters(add) {
    if (!this.group.visible) return;
    const p = this.group.position;
    add(this.cross, p.x, p.y + 1.4, p.z, 2.2);
  }

  show(on) {
    this.group.visible = on;
    for (const m of [this.post, this.bar, ...this.ropes.flatMap((g) => g.children)]) m.castShadow = on;
  }

  update(dt, neg, fog) {
    this.uTime.value += dt;
    this.uNeg.value = neg;
    this.uFog.value = fog;
  }
}

function mergeBoxes(geos) {
  const P = [];
  for (const g of geos) {
    const ng = g.index ? g.toNonIndexed() : g;
    P.push(...ng.attributes.position.array);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  return g;
}

// ---------------------------------------------------------------- swords

/**
 * A katana, the blade along +z (tip at +0.72 m), the edge toward +y, the grip back to -0.29 m. Attribute `part`:
 * 0 blade, 1 fittings (habaki, tsuba, kashira), 2 grip; `suv`: blade (across 0 spine..1 edge, along), grip (round, along).
 */
function katanaGeometry() {
  const P = [], PART = [], UV = [];
  const push = (p, part, uv) => {
    P.push(p[0], p[1], p[2]);
    PART.push(part);
    UV.push(uv[0], uv[1]);
  };
  const quad = (a, b, c, d, part, ua, ub, uc, ud) => {
    push(a, part, ua);
    push(b, part, ub);
    push(c, part, uc);
    push(a, part, ua);
    push(c, part, uc);
    push(d, part, ud);
  };
  const loft = (rings, part, uvs) => {
    for (let i = 0; i < rings.length - 1; i++) {
      const A = rings[i], B = rings[i + 1], n = A.length;
      for (let j = 0; j < n; j++) {
        const k = (j + 1) % n;
        quad(A[j], A[k], B[k], B[j], part, uvs[i][j], uvs[i][k], uvs[i + 1][k], uvs[i + 1][j]);
      }
    }
  };
  const cap = (ring, part) => {
    const c = [0, 0, 0];
    for (const p of ring) for (let k = 0; k < 3; k++) c[k] += p[k] / ring.length;
    for (let j = 0; j < ring.length; j++) {
      const k = (j + 1) % ring.length;
      push(c, part, [0.5, 0]);
      push(ring[j], part, [0.5, 0]);
      push(ring[k], part, [0.5, 0]);
    }
  };
  // blade: a pentagon section (edge, two ridge lines, the back), curving back toward the spine (sori), the kissaki
  // sweeping the edge up to the point
  const L = 0.72, bladeR = [], bladeU = [];
  const zs = [0.036, 0.12, 0.22, 0.32, 0.42, 0.52, 0.6, 0.64, 0.67, 0.695, 0.712];
  for (const z of zs) {
    const w = 0.031 * (1 - (0.2 * z) / L), th = 0.0078 * (1 - (0.35 * z) / L), sori = -0.024 * (z / L) ** 2;
    const t = Math.max(0, (z - 0.63) / (L - 0.63));
    const edge = sori + w / 2 - w * 0.95 * t ** 1.5, back = sori - w / 2 + w * 0.08 * t, ridge = sori - w * 0.06 + (back - sori + w * 0.06) * t * 0.6;
    const thk = th * (1 - t * 0.85);
    bladeR.push([[0, edge, z], [thk / 2, ridge, z], [thk * 0.3, back, z], [-thk * 0.3, back, z], [-thk / 2, ridge, z]]);
    bladeU.push([[1, z], [0.4, z], [0, z], [0, z], [0.4, z]]);
  }
  loft(bladeR, 0, bladeU);
  const last = bladeR[bladeR.length - 1];
  const tip = [0, (last[0][1] + last[2][1]) / 2, L + 0.006];
  for (let j = 0; j < last.length; j++) {
    const k = (j + 1) % last.length;
    push(last[j], 0, [0.5, L]);
    push(last[k], 0, [0.5, L]);
    push(tip, 0, [0.5, L]);
  }
  cap(bladeR[0], 0);
  // habaki: a collar round the blade's root
  const box = (x0, x1, y0, y1, z0, z1, part) => {
    const r0 = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], r1 = r0.map((p) => [p[0], p[1], z1]);
    loft([r0, r1], part, [r0.map(() => [0, 0]), r1.map(() => [0, 0])]);
    cap(r0, part);
    cap(r1, part);
  };
  box(-0.0065, 0.0065, -0.019, 0.021, 0.004, 0.038, 1);
  // tsuba: an oval guard
  const ring = (rx, ry, z, n, oy = 0) => Array.from({ length: n }, (_, j) => [Math.cos((j / n) * Math.PI * 2) * rx, Math.sin((j / n) * Math.PI * 2) * ry + oy, z]);
  const t0 = ring(0.037, 0.043, -0.004, 20), t1 = ring(0.037, 0.043, 0.004, 20);
  loft([t0, t1], 1, [t0.map(() => [0, 0]), t1.map(() => [0, 0])]);
  cap(t0, 1);
  cap(t1, 1);
  // grip: an octagonal oval, a slight waist, then the pommel cap
  const gz = [-0.004, -0.07, -0.15, -0.225, -0.272], gw = [1, 0.97, 0.94, 0.97, 1];
  const gr = gz.map((z, i) => ring(0.0125 * gw[i], 0.0172 * gw[i], z, 8));
  loft(gr, 2, gr.map((r, i) => r.map((_, j) => [j / 8, -gz[i]])));
  const k0 = ring(0.0132, 0.018, -0.272, 8), k1 = ring(0.011, 0.0155, -0.29, 8);
  loft([k0, k1], 1, [k0.map(() => [0, 0]), k1.map(() => [0, 0])]);
  cap(k1, 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('part', new THREE.Float32BufferAttribute(PART, 1));
  g.setAttribute('suv', new THREE.Float32BufferAttribute(UV, 2));
  g.computeVertexNormals();
  return g;
}

const SWORDS = 48;

export class Swords {
  constructor(scene, sunDir, uNeg) {
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uSun: { value: sunDir.clone() } }]),
      fog: true,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        attribute float part; attribute vec2 suv;
        varying vec3 vN; varying vec3 vW; varying float vPart; varying vec2 vUv;
        #include <fog_pars_vertex>
        void main() {
          vPart = part; vUv = suv;
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vW = wp.xyz;
          vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSun; uniform float uNeg;
        varying vec3 vN; varying vec3 vW; varying float vPart; varying vec2 vUv;
        ${NEG_SELF}
        #include <fog_pars_fragment>
        void main() {
          vec3 n = normalize(vN);
          if (!gl_FrontFacing) n = -n;
          vec3 v = normalize(cameraPosition - vW);
          float nl = dot(n, uSun);
          float lit = 0.5 + 0.28 * smoothstep(-0.05, 0.05, nl) + 0.22 * smoothstep(0.5, 0.6, nl);
          vec3 col;
          float spec = 0.0;
          if (vPart < 0.5) {
            // steel: the flat and the ridge, a misty hamon wavering along the edge, a hard glint
            float hamon = smoothstep(0.66, 0.72, vUv.x + 0.035 * sin(vUv.y * 70.0) + 0.02 * sin(vUv.y * 190.0));
            col = mix(vec3(0.56, 0.59, 0.64), vec3(0.93, 0.94, 0.97), hamon);
            spec = pow(max(dot(reflect(-v, n), uSun), 0.0), 60.0) * 2.4 + pow(1.0 - abs(dot(n, v)), 3.0) * 0.35;
          } else if (vPart < 1.5) {
            col = vec3(0.2, 0.15, 0.09);
            spec = pow(max(dot(reflect(-v, n), uSun), 0.0), 20.0) * 0.8;
          } else {
            // the grip: black cord crossing over pale ray skin, in diamonds
            vec2 u = vec2(vUv.x * 2.0, vUv.y * 26.0);
            float dmd = abs(fract(u.x + u.y * 0.5) - 0.5) + abs(fract(u.x - u.y * 0.5) - 0.5);
            col = mix(vec3(0.03, 0.028, 0.035), vec3(0.8, 0.77, 0.7), step(dmd, 0.28));
          }
          col = col * lit + vec3(spec);
          col = negSelf(col, uNeg);
          gl_FragColor = vec4(col, 1.0);
          #include <fog_fragment>
        }`,
    });
    this.mat.uniforms.uNeg = uNeg;
    this.mesh = new THREE.InstancedMesh(katanaGeometry(), this.mat, SWORDS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    // motion streaks: a ribbon from where the sword was back along its path, turned to face the camera
    const q = new THREE.PlaneGeometry(1, 2, 1, 1);
    q.translate(0.5, 0, 0);
    const g = new THREE.InstancedBufferGeometry();
    g.index = q.index;
    g.setAttribute('position', q.attributes.position);
    this.aA = new THREE.InstancedBufferAttribute(new Float32Array(SWORDS * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aB = new THREE.InstancedBufferAttribute(new Float32Array(SWORDS * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iA', this.aA);
    g.setAttribute('iB', this.aB);
    g.instanceCount = 0;
    this.trailMat = new THREE.ShaderMaterial({
      uniforms: { uNeg },
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute vec4 iA; attribute vec4 iB;
        varying vec2 vUv; varying float vA;
        void main() {
          vUv = vec2(position.x, position.y); vA = iA.w;
          if (iA.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          vec3 p = mix(iA.xyz, iB.xyz, position.x);
          vec3 d = iB.xyz - iA.xyz;
          vec3 side = normalize(cross(d, p - cameraPosition));
          gl_Position = projectionMatrix * viewMatrix * vec4(p + side * position.y * 0.5 * iB.w, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uNeg;
        varying vec2 vUv; varying float vA;
        ${NEG_SELF}
        void main() {
          float a = pow(vUv.x, 1.6) * (1.0 - pow(abs(vUv.y), 2.0)) * vA;
          vec3 c = negSelf(vec3(0.8, 0.81, 0.85), uNeg);
          gl_FragColor = vec4(c, a * 0.6);
        }`,
    });
    this.trails = new THREE.Mesh(g, this.trailMat);
    this.trails.frustumCulled = false;
    this.trails.renderOrder = 6;
    scene.add(this.trails);
    this.nT = 0;
  }

  /** This frame's swords: list of { m: Matrix4 (world), tail: Vector3 | null, head: Vector3, trail (0..1) }. */
  draw(list) {
    const n = Math.min(list.length, SWORDS);
    this.mesh.count = n;
    let t = 0;
    for (let i = 0; i < n; i++) {
      const s = list[i];
      this.mesh.setMatrixAt(i, s.m);
      if (s.tail && s.trail > 0.01) {
        this.aA.array.set([s.tail.x, s.tail.y, s.tail.z, s.trail], t * 4);
        this.aB.array.set([s.head.x, s.head.y, s.head.z, 0.07], t * 4);
        t++;
      }
    }
    this.mesh.instanceMatrix.needsUpdate = n > 0;
    this.mesh.visible = n > 0;
    this.trails.geometry.instanceCount = t;
    this.trails.visible = t > 0;
    if (t) {
      for (const a of [this.aA, this.aB]) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, t * 4);
        a.needsUpdate = true;
      }
    }
  }
}

// ---------------------------------------------------------------- ink

const INK = 320;

export class Ink {
  constructor(scene, uNeg) {
    const quad = new THREE.PlaneGeometry(2, 2);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.attributes.position);
    const A = (k) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(INK * 4), 4).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(k, a);
      return a;
    };
    this.aP = A('iP'); // x, y, z, t0
    this.aV = A('iV'); // velocity, life
    this.aD = A('iD'); // kind (0 splat, 1 drop, 2 stain), size, seed, ground y (drops stop there)
    g.instanceCount = INK;
    for (let i = 0; i < INK; i++) this.aP.array[i * 4 + 3] = -1e6;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uNeg },
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute vec4 iP; attribute vec4 iV; attribute vec4 iD;
        uniform float uTime;
        varying vec2 vQ; varying float vAge; varying vec4 vD;
        void main() {
          float t = uTime - iP.w, age = t / iV.w;
          vQ = position.xy; vAge = age; vD = iD;
          if (age < 0.0 || age > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          float kind = iD.x, s = iD.y;
          if (kind > 1.5) {
            // a stain on the ground: grows in fast, stays
            s *= 1.0 - pow(1.0 - min(t / 0.12, 1.0), 3.0);
            gl_Position = projectionMatrix * viewMatrix * vec4(iP.xyz + vec3(position.x, 0.0, position.y) * s, 1.0);
            return;
          }
          vec3 p = iP.xyz;
          vec2 c = position.xy;
          if (kind > 0.5) {
            // a drop: thrown, falling, stretched along its speed on screen
            vec3 v = iV.xyz + vec3(0.0, -9.8 * t, 0.0);
            p += iV.xyz * t + vec3(0.0, -4.9 * t * t, 0.0);
            if (p.y < iD.w) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
            vec2 dv = (viewMatrix * vec4(v, 0.0)).xy;
            float l = length(dv);
            vec2 d = l > 1e-4 ? dv / l : vec2(1.0, 0.0);
            c = d * c.x * (1.0 + min(l * 0.04, 1.6)) + vec2(-d.y, d.x) * c.y;
          } else {
            // a splatter: bursts out in a tenth of a second, hangs, then breaks up
            s *= 0.35 + 0.65 * (1.0 - pow(1.0 - min(t / 0.1, 1.0), 3.0));
          }
          vec4 mv = viewMatrix * vec4(p, 1.0);
          mv.xyz += normalize(-mv.xyz) * 0.12;
          mv.xy += c * s;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uNeg;
        varying vec2 vQ; varying float vAge; varying vec4 vD;
        ${SEAL_GLSL}
        void main() {
          float r = length(vQ), a = atan(vQ.y, vQ.x), sd = vD.z * 17.0, kind = vD.x;
          float ink = 0.0;
          if (kind < 0.5) {
            // thorns of ink round a ragged blot, satellite drops, torn apart as it ages
            float e = 0.34 + 0.16 * sCirc(a, 9.0, sd) + 0.62 * pow(max(0.0, sin(a * (5.0 + floor(vD.z * 4.0)) + sd)), 7.0) * (0.35 + 0.65 * sCirc(a, 6.0, sd + 2.0));
            ink = 1.0 - smoothstep(e - 0.03, e, r);
            for (int k = 0; k < 5; k++) {
              float fk = float(k), ang = sH(fk + sd) * S_TAU, rr = 0.55 + 0.35 * sH(fk + sd + 5.0);
              ink = max(ink, 1.0 - smoothstep(0.05, 0.07, length(vQ - vec2(cos(ang), sin(ang)) * rr) / (0.6 + sH(fk + sd + 9.0))));
            }
            float brk = sCirc(a * 3.0 + r * 9.0, 13.0, sd + 4.0);
            ink *= step(smoothstep(0.55, 1.0, vAge) * 1.1, brk);
          } else if (kind < 1.5) {
            ink = 1.0 - smoothstep(0.8, 1.0, r);
          } else {
            float e = 0.62 + 0.3 * sCirc(a, 7.0, sd) + 0.1 * sCirc(a, 19.0, sd + 1.0);
            ink = max(1.0 - smoothstep(e - 0.04, e, r), 0.0);
            ink *= 1.0 - smoothstep(0.85, 1.0, vAge);
          }
          if (ink < 0.5) discard;
          gl_FragColor = vec4(vec3(mix(0.012, 1.0, uNeg)), 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    scene.add(this.mesh);
    this.next = 0;
    this.time = 0;
    this.dirty = [INK, 0];
  }

  add(kind, x, y, z, vx, vy, vz, life, size, groundY = -1e6) {
    const i = this.next;
    this.next = (this.next + 1) % INK;
    this.aP.array.set([x, y, z, this.time], i * 4);
    this.aV.array.set([vx, vy, vz, life], i * 4);
    this.aD.array.set([kind, size, Math.random(), groundY], i * 4);
    this.dirty[0] = Math.min(this.dirty[0], i);
    this.dirty[1] = Math.max(this.dirty[1], i + 1);
  }

  /** Everything gone (the genjutsu ends). */
  clear() {
    for (let i = 0; i < INK; i++) this.aP.array[i * 4 + 3] = -1e6;
    this.dirty = [0, INK];
  }

  update(dt) {
    this.time += dt;
    this.mat.uniforms.uTime.value = this.time;
    if (this.dirty[1] > this.dirty[0]) {
      for (const a of [this.aP, this.aV, this.aD]) {
        a.clearUpdateRanges();
        a.addUpdateRange(this.dirty[0] * 4, (this.dirty[1] - this.dirty[0]) * 4);
        a.needsUpdate = true;
      }
      this.dirty[0] = INK;
      this.dirty[1] = 0;
    }
  }
}
