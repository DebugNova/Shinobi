// Madara's Sharingan Genjutsu on screen (his X; driven by src/game/madaragenjutsu.js and, on the victim's own screen,
// src/game/madaravision.js). Two things live here:
//   MADARA_EYE_GLSL  his eyes as GLSL in a unit disc (the iris edge at 1): the three-tomoe Sharingan, and his Eternal
//                    Mangekyō (three petals round a ringed pupil, Izuna's three thin blades curving out between them,
//                    a black rim). madaraInk() is the black pattern alone (a Sharingan -> Mangekyō crossfade burning out
//                    from the pupil); `mangekyo()` (EyeMarks' pattern slot) and `madaraSeal()` (SealFx's) colour it.
//   VisionEffect     the victim's screen (a post effect, the stack's first pass): the world sinking into the dark, his
//                    face in close-up graded violet-black (the reference: a face in shadow, the eyes blazing white),
//                    the face dissolving into the dark until only the eyes are left, eyes watching from the dark,
//                    heartbeat ripples, the lids snapping shut, the black opening back onto the arena.
// Written in display colours and converted with pow(2.2) (the stack is linear light, gotcha 50); NaN guarded (gotcha
// 55); it reads depth, so the pass runs it before tone mapping (gotcha 64); SRC blend (it replaces the image).
import * as THREE from 'three';
import { Effect, EffectAttribute, BlendFunction } from 'postprocessing';

export const MADARA_EYE_GLSL = /* glsl */ `
  #define MD_TAU 6.2831853
  float mdAngd(float a, float c) { return mod(a - c + 3.14159265, MD_TAU) - 3.14159265; }
  // the three-tomoe Sharingan: a thin ring, three commas riding it (heads leading the turn, tails trailing), the pupil
  float mdTomoe(float r, float a, float rot) {
    float ink = 1.0 - smoothstep(0.12, 0.14, r);
    ink = max(ink, 1.0 - smoothstep(0.008, 0.018, abs(r - 0.56)));
    for (int k = 0; k < 3; k++) {
      float c = rot + float(k) * 2.0943951;
      vec2 h = 0.56 * vec2(cos(c), sin(c));
      vec2 q = r * vec2(cos(a), sin(a));
      ink = max(ink, 1.0 - smoothstep(0.1, 0.125, length(q - h)));
      float d = mdAngd(a, c);
      if (d < 0.0 && d > -0.95) {
        float s = -d / 0.95;
        float w = 0.1 * (1.0 - s);
        float rc = 0.56 + 0.07 * s;
        ink = max(ink, 1.0 - smoothstep(w - 0.015, w, abs(r - rc)));
      }
    }
    return ink;
  }
  // his Eternal Mangekyō: the pupil in a ring, three petals leaning with the turn, Izuna's blades between them, the rim
  float mdEms(float r, float a, float rot) {
    float ink = 1.0 - smoothstep(0.11, 0.13, r);
    ink = max(ink, 1.0 - smoothstep(0.022, 0.036, abs(r - 0.29)));
    for (int k = 0; k < 3; k++) {
      float c = rot + float(k) * 2.0943951;
      float d = mdAngd(a, c + 0.55 * (r - 0.3));
      float e = pow((r - 0.6) / 0.29, 2.0) + pow(d * r / 0.17, 2.0);
      ink = max(ink, 1.0 - smoothstep(0.86, 1.0, e));
      float b = mdAngd(a, c + 1.0472 - 1.1 * (r - 0.29));
      float bw = 0.024 * (1.0 - smoothstep(0.3, 0.92, r)) + 0.006;
      ink = max(ink, (1.0 - smoothstep(bw - 0.008, bw, abs(b) * r)) * smoothstep(0.28, 0.32, r) * (1.0 - smoothstep(0.86, 0.92, r)));
    }
    ink = max(ink, 1.0 - smoothstep(0.018, 0.034, abs(r - 0.94)));
    return ink;
  }
  // the pattern (x) and the burning front of the change (y): the Mangekyō spreads out from the pupil as ems goes 0 -> 1
  vec2 madaraInk(vec2 q, float rot, float ems) {
    float r = length(q), a = atan(q.y, q.x);
    float f = ems * 1.12;
    float k = smoothstep(f - 0.03, f + 0.03, r);
    float ink = mix(mdEms(r, a, rot * 0.7), mdTomoe(r, a, rot), k);
    float front = exp(-pow((r - f) / 0.035, 2.0)) * step(0.001, ems) * (1.0 - step(0.999, ems));
    return vec2(ink, front);
  }
  // EyeMarks' pattern slot: his Eternal Mangekyō, glowing (HDR red)
  vec4 mangekyo(vec2 q, float rot) {
    float r = length(q);
    if (r > 1.0) return vec4(0.0);
    vec3 red = mix(vec3(2.5, 0.1, 0.07), vec3(0.55, 0.0, 0.02), smoothstep(0.08, 0.96, r));
    float ink = madaraInk(q, rot, 1.0).x;
    return vec4(mix(red, vec3(0.012, 0.0, 0.004), ink), 1.0 - smoothstep(0.97, 1.0, r));
  }
  // SealFx's pattern slot: his Eternal Mangekyō thrown out before him / round a victim (the unit disc is the iris; a
  // ring of red ripples, Rinnegan-like, to r ~1.6)
  vec4 madaraSeal(vec2 q, float rot) {
    float r = length(q), a = atan(q.y, q.x);
    if (r > 1.7) return vec4(0.0);
    vec3 red = mix(vec3(2.6, 0.14, 0.08), vec3(0.45, 0.0, 0.02), smoothstep(0.05, 0.97, r));
    float ink = madaraInk(q, rot, 1.0).x;
    float iris = 1.0 - smoothstep(0.95, 0.965, r);
    float rings = 0.0;
    for (int k = 0; k < 3; k++) {
      float rr = 1.08 + float(k) * 0.19 + 0.012 * sin(a * 7.0 + rot * 2.0 + float(k));
      rings = max(rings, (1.0 - smoothstep(0.012, 0.026 - float(k) * 0.004, abs(r - rr))) * (1.0 - float(k) * 0.28));
    }
    vec3 c = mix(red, vec3(0.012, 0.0, 0.004), ink * iris);
    c = mix(c, vec3(1.6, 0.05, 0.05), rings * (1.0 - iris));
    return vec4(c, max(iris, rings * 0.9));
  }`;

// ---------------------------------------------------------------- the victim's vision

// the eyes watching from the dark (sq coordinates: screen heights from the centre, a 16:9 frame is +-0.89 wide):
// x, y, half width, when it opens (s on the vision's clock, see madaravision.js VIS.watch)
const WATCH = [
  [-0.72, 0.31, 0.05, 0.0], [0.7, -0.3, 0.055, 0.12], [-0.46, -0.36, 0.04, 0.2], [0.52, 0.36, 0.045, 0.3],
  [-0.84, -0.06, 0.035, 0.38], [0.84, 0.08, 0.04, 0.44], [-0.2, 0.43, 0.03, 0.5], [0.22, -0.44, 0.035, 0.56],
  [0.0, 0.46, 0.028, 0.62], [-0.02, -0.46, 0.03, 0.66],
];
const f4 = (a) => `vec4(${a.map((x) => x.toFixed(3)).join(', ')})`;

const frag = /* glsl */ `
uniform float uOn; uniform float uTime; uniform vec2 uIso; uniform vec2 uFace; uniform float uDark; uniform float uRed;
uniform vec4 uEyeA; uniform vec4 uEyeB; uniform vec4 uEyes; uniform float uGlow; uniform vec4 uRipple;
uniform vec2 uWatch; uniform vec3 uCover; uniform vec4 uFlash; uniform vec2 uShake;
${MADARA_EYE_GLSL}
const vec4 MV_WATCH[${WATCH.length}] = vec4[${WATCH.length}](${WATCH.map(f4).join(', ')});

float mvH(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float mvN(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mvH(i), mvH(i + vec2(1.0, 0.0)), u.x), mix(mvH(i + vec2(0.0, 1.0)), mvH(i + vec2(1.0, 1.0)), u.x), u.y);
}
float mvF(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int k = 0; k < 4; k++) { s += a * mvN(p); p = p * 2.07 + vec2(3.1, 7.7); a *= 0.5; }
  return s;
}
vec3 mvLin(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }

// the lids, eye units (x -1 the inner corner .. 1 the outer, y up). A fierce almond like the reference: the outer
// corner pointed and higher than the inner, the upper lid arching high, the lower one flatter; shut (open 0) both meet
// on the slant line
float mvUp(float x, float open) { return open * 0.5 * pow(max(1.0 - x * x, 0.0), 0.62) + 0.16 * x; }
float mvLo(float x, float open) { return -open * 0.3 * pow(max(1.0 - x * x, 0.0), 0.95) + 0.16 * x - 0.02 * open * (1.0 - x * x); }

// One painted eye. E: centre (sq), half width (screen heights), roll; side: +1 if its outer corner is toward +x on
// screen. P: open, ems, spin, brightness. Returns rgb (display colours) over alpha; glow: the light round it.
vec4 mvEye(vec2 sq, vec4 E, float side, vec4 P, out float glow) {
  glow = 0.0;
  vec2 d = sq - E.xy;
  float cr = cos(E.w), sr = sin(E.w);
  d = vec2(cr * d.x + sr * d.y, -sr * d.x + cr * d.y);
  vec2 p = vec2(d.x * side, d.y) / E.z;
  if (abs(p.x) > 4.2 || abs(p.y) > 2.4) return vec4(0.0);
  float aa = 0.9 / (E.z * resolution.y);
  float up = mvUp(clamp(p.x, -1.0, 1.0), P.x), lo = mvLo(clamp(p.x, -1.0, 1.0), P.x);
  float inX = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, abs(p.x));
  float inE = inX * smoothstep(-aa, aa, up - p.y) * smoothstep(-aa, aa, p.y - lo);
  // the light round it: soft, wider sideways (an ellipse round the almond: a falloff built from the lid curves showed
  // their steep ends as hard vertical edges)
  float ell = length(vec2(p.x * 0.92, (p.y - 0.06) * 2.3));
  glow = exp(-max(ell - 0.85, 0.0) * 3.2) * (0.35 + 0.65 * P.x) * (1.0 - inE) * smoothstep(0.0, 0.2, P.x);
  // the white: glowing, a little cooler and darker under the upper lid (its shadow)
  float lidSh = smoothstep(0.0, 0.18, up - p.y);
  vec3 col = mix(vec3(0.62, 0.6, 0.72), vec3(1.0, 0.99, 1.0), 0.35 + 0.65 * lidSh) * P.w;
  // the iris: small in the glowing white (the reference), red darkening to a black rim, his pattern turning in it
  vec2 ic = vec2(-0.02, 0.03 * P.x);
  float ir = 0.36;
  vec2 q = (p - ic) / ir;
  float r = length(q);
  if (r < 1.0) {
    vec3 red = mix(vec3(1.0, 0.24, 0.2), vec3(0.62, 0.02, 0.04), smoothstep(0.1, 0.8, r));
    red = mix(red, vec3(0.2, 0.0, 0.01), smoothstep(0.84, 0.98, r));
    vec2 ink = madaraInk(q, P.z, P.y);
    vec3 ic3 = mix(red, vec3(0.03, 0.0, 0.01), ink.x) + vec3(1.0, 0.55, 0.4) * ink.y;
    // a glint up on the left
    ic3 += vec3(0.9) * exp(-pow(length(q - vec2(-0.32, 0.4)) / 0.11, 2.0)) * 0.7;
    col = mix(col, ic3, 1.0 - smoothstep(0.97, 1.0, r));
  }
  // the lash line: thick along the upper lid, heaviest at the outer end, flicking out past the corner
  float lw = (0.045 + 0.06 * smoothstep(-0.6, 1.0, p.x)) * P.x + 0.03;
  float lash = (1.0 - smoothstep(lw - aa * 2.0, lw, abs(p.y - up - lw * 0.35))) * (1.0 - smoothstep(1.0, 1.22, p.x)) * step(-1.05, p.x);
  float flick = (1.0 - smoothstep(0.02, 0.05, abs(p.y - (0.16 + (p.x - 1.0) * 0.55)))) * step(1.0, p.x) * (1.0 - smoothstep(1.12, 1.3, p.x)) * P.x;
  float lower = (1.0 - smoothstep(0.012, 0.03, abs(p.y - lo + 0.01))) * inX * 0.7 * P.x;
  float dark = max(max(lash, flick), lower) * smoothstep(0.0, 0.12, P.x);
  col = mix(col, vec3(0.02, 0.01, 0.03), dark);
  return vec4(col, max(inE, dark));
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  if (uOn < 0.5) { outputColor = inputColor; return; }
  if (!(c.r >= 0.0)) c.r = 0.0;
  if (!(c.g >= 0.0)) c.g = 0.0;
  if (!(c.b >= 0.0)) c.b = 0.0;
  vec2 sq = (uv - 0.5) * vec2(aspect, 1.0) + uShake;
  float R = length(sq);
  // ---- the dark: the world sinks away; only his face (the subject's depth) stays, graded violet-black
  if (uDark > 0.001) {
    float vz = -getViewZ(depth);
    float fm = 1.0 - smoothstep(uIso.x + 0.3, uIso.x + 0.8, vz);
    vec2 mid = (uEyeA.xy + uEyeB.xy) * 0.5;
    // the face dissolving into the dark (uFace.x: 1 all there .. 0 gone), from its edges in toward the eyes
    float key = 0.62 * mvF(sq * 7.0 + vec2(uTime * 0.3, 0.0)) + 0.5 * clamp(length(sq - mid) / 0.75, 0.0, 1.0);
    float th = uFace.x * 1.15 - 0.06;
    float keep = 1.0 - smoothstep(th - 0.07, th + 0.07, key);
    float ember = exp(-pow((key - th) / 0.02, 2.0)) * fm * step(0.01, uFace.x) * (1.0 - step(0.99, uFace.x));
    fm *= keep * uFace.y;
    float l = pow(max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 0.0), 0.4545);
    // the face: shade to near-black violet, the light to a cold lilac grey (a face in shadow, the eyes the only light)
    vec3 fc = mix(vec3(0.012, 0.01, 0.018), vec3(0.16, 0.145, 0.2), smoothstep(0.05, 0.5, l));
    fc = mix(fc, vec3(0.4, 0.38, 0.46), smoothstep(0.5, 0.95, l));
    // (a red glow from below, round the eyes)
    fc += vec3(0.14, 0.0, 0.02) * exp(-pow(length((sq - mid) * vec2(0.8, 1.4)) / 0.28, 2.0)) * uGlow * 0.6;
    // behind him: black, a slow violet smoke in it
    vec3 bg = vec3(0.012, 0.008, 0.02) + vec3(0.05, 0.02, 0.07) * smoothstep(0.45, 0.85, mvF(sq * 2.2 + vec2(uTime * 0.05, -uTime * 0.08))) * (1.0 - smoothstep(0.4, 1.1, R));
    vec3 dk = mix(mvLin(bg), mvLin(fc), fm) + mvLin(vec3(0.3, 0.04, 0.1)) * ember * 0.45;
    c = mix(c, dk, uDark);
  }
  // ---- the catch: the red closing in from the edges
  if (uRed > 0.001) {
    float e = smoothstep(0.25, 0.95, R);
    c = mix(c, c * vec3(1.0, 0.3, 0.3), uRed * 0.3 * (0.4 + 0.6 * e)) + mvLin(vec3(0.5, 0.0, 0.03)) * e * e * uRed;
  }
  vec3 add = vec3(0.0);
  // ---- eyes watching from the dark, opening one after another (faint, small, blurred at the edges)
  if (uWatch.x > 0.001) {
    for (int k = 0; k < ${WATCH.length}; k++) {
      vec4 W = MV_WATCH[k];
      float o = smoothstep(W.w, W.w + 0.18, uWatch.y) * uWatch.x;
      if (o < 0.01) continue;
      float g;
      vec4 e = mvEye(sq, vec4(W.xy, W.z, 0.12 * sin(float(k) * 2.3)), W.x < 0.0 ? -1.0 : 1.0, vec4(o * 0.8, 1.0, uTime * 1.5 + float(k), 0.55), g);
      c = mix(c, mvLin(e.rgb), e.a * 0.5 * uWatch.x);
      add += mvLin(vec3(0.5, 0.05, 0.08)) * g * 0.12 * o;
    }
  }
  // ---- his eyes: A on the screen's left (his right eye: its outer corner toward -x), B on the right
  if (uEyes.w > 0.001) {
    float gA, gB;
    vec4 P = vec4(uEyes.x, uEyes.y, uEyes.z, 1.0);
    vec4 a = mvEye(sq, uEyeA, -1.0, P, gA);
    vec4 b = mvEye(sq, uEyeB, 1.0, P, gB);
    c = mix(c, mvLin(a.rgb), a.a * uEyes.w);
    c = mix(c, mvLin(b.rgb), b.a * uEyes.w);
    add += (mvLin(vec3(0.85, 0.82, 1.0)) * 0.55 + mvLin(vec3(0.7, 0.05, 0.08)) * 0.35) * (gA + gB) * uGlow * uEyes.w;
  }
  // ---- heartbeat ripples: thin red rings racing out from both eyes (x, y: ages in s; z: strength)
  if (uRipple.z > 0.001) {
    for (int k = 0; k < 2; k++) {
      float age = k == 0 ? uRipple.x : uRipple.y;
      if (age < 0.0 || age > 0.9) continue;
      float rad = 0.05 + age * 1.6, fade = (1.0 - age / 0.9) * uRipple.z;
      float wob = 0.012 * (mvN(vec2(atan(sq.y - uEyeA.y, sq.x - uEyeA.x) * 3.0, age * 4.0)) - 0.5);
      float ra = abs(length(sq - uEyeA.xy) - rad + wob), rb = abs(length(sq - uEyeB.xy) - rad + wob);
      add += mvLin(vec3(0.6, 0.02, 0.05)) * (exp(-pow(ra / 0.005, 2.0)) + exp(-pow(rb / 0.005, 2.0))) * fade;
    }
  }
  c += add;
  // ---- the black: all of it (x), a hole opening in it (y: its radius, screen heights), an inky rim (z)
  if (uCover.x > 0.001) {
    float rr = R + 0.09 * (mvF(sq * 4.0 + vec2(0.0, uTime * 0.4)) - 0.5);
    float cov = smoothstep(uCover.y - 0.03, uCover.y + 0.03, rr) * uCover.x;
    float rim = exp(-pow((rr - uCover.y) / 0.03, 2.0)) * step(0.01, uCover.y) * uCover.z;
    c = mix(c, vec3(0.0), cov) + mvLin(vec3(0.6, 0.02, 0.06)) * rim;
  }
  if (uFlash.w > 0.001) c = mix(c, uFlash.rgb, uFlash.w);
  outputColor = vec4(c, inputColor.a);
}`;

export class VisionEffect extends Effect {
  constructor() {
    const U = (v) => new THREE.Uniform(v);
    super('MadaraVision', frag, {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.SRC,
      uniforms: new Map([
        ['uOn', U(0)], ['uTime', U(0)], ['uIso', U(new THREE.Vector2(1, 0))], ['uFace', U(new THREE.Vector2())], ['uDark', U(0)],
        ['uRed', U(0)], ['uEyeA', U(new THREE.Vector4())], ['uEyeB', U(new THREE.Vector4())], ['uEyes', U(new THREE.Vector4())],
        ['uGlow', U(0)], ['uRipple', U(new THREE.Vector4(-1, -1, 0, 0))], ['uWatch', U(new THREE.Vector2())],
        ['uCover', U(new THREE.Vector3())], ['uFlash', U(new THREE.Vector4())], ['uShake', U(new THREE.Vector2())],
      ]),
    });
    this.reset();
  }

  /** This frame's strengths (set by the vision each frame; applied, then reset: nothing sticks if it stops calling). */
  reset() {
    this.on = false;
    this.iso = 1; // the subject's distance from the camera (m)
    this.face = [1, 0]; // [dissolve: 1 all there .. 0 gone, its light]
    this.dark = 0; // the world replaced by the dark (and his face)
    this.red = 0; // the catch's red edges
    this.eyeA = [0, 0, 0.1, 0]; // x, y (screen heights from the centre), half width, roll: the eye on the screen's left
    this.eyeB = [0, 0, 0.1, 0];
    this.eyes = [0, 0, 0, 0]; // open, ems (Sharingan 0 -> Eternal Mangekyō 1), spin (rad), strength
    this.glow = 0;
    this.ripple = [-1, -1, 0]; // two ripples' ages (s; < 0 none), strength
    this.watch = [0, 0]; // the watching eyes: strength, their clock (s)
    this.cover = [0, 0, 0]; // the black, the hole's radius, its rim
    this.flash = [1, 1, 1, 0];
    this.shake = [0, 0];
  }

  apply(dt) {
    const U = this.uniforms;
    U.get('uTime').value += dt;
    U.get('uOn').value = this.on ? 1 : 0;
    if (this.on) {
      for (const [k, v] of [['uDark', this.dark], ['uRed', this.red], ['uGlow', this.glow]]) U.get(k).value = v;
      U.get('uIso').value.set(this.iso, 0);
      U.get('uFace').value.set(this.face[0], this.face[1]);
      U.get('uEyeA').value.set(...this.eyeA);
      U.get('uEyeB').value.set(...this.eyeB);
      U.get('uEyes').value.set(...this.eyes);
      U.get('uRipple').value.set(this.ripple[0], this.ripple[1], this.ripple[2], 0);
      U.get('uWatch').value.set(this.watch[0], this.watch[1]);
      U.get('uCover').value.set(...this.cover);
      U.get('uFlash').value.set(...this.flash);
      U.get('uShake').value.set(this.shake[0], this.shake[1]);
    }
    this.reset();
  }
}
