// Amaterasu's cinematic on screen (src/game/amaterasu.js drives it; every screen at once): one post effect, in the
// stack's first pass after the Genjutsu one. JS sets this frame's strengths, apply() uploads them and resets (nothing
// sticks if the cinematic stops calling). Layers, back to front:
//   the negative world   light and dark swapped onto a cold teal ramp (the reference shots: a white Itachi on a dark
//                        blue-green world); past the subject (depth) the arena sinks into drifting smoke, ink specks
//                        drift across, the edges sink
//   the painted close-up his eyes filling the screen, painted in the shader (nothing to load): the face in low red
//                        light, black hair strands (with their shadows), the lids (a lash line that flicks out at the
//                        outer corner, the crease, his tear-trough lines), the Sharingan (three tomoe riding a ring)
//                        turning into his Mangekyō (three curved blades) from the pupil out, veins crawling in from the
//                        corners, blood welling on the lower lid of his right eye and running down in two streams with
//                        a drop at each head, embers rising, black flames licking up the frame's bottom edge
//   the black flames     Amaterasu bursting out of the pupil over the whole view, then burning away in holes with
//                        glowing edges (the arena behind: the flames on the victims)
//   a flash, the letterbox bars
// The stack is linear light: the painting is written in display colours and converted (gotcha 50); NaN guarded
// (gotcha 55); SRC blend (it replaces the image, gotcha 56).
import * as THREE from 'three';
import { Effect, EffectAttribute, BlendFunction } from 'postprocessing';

// The painted close-up's layout (screen heights from the screen's centre; the camera's zoom works in the same units).
export const AMA_LAYOUT = {
  eyeR: [-0.325, 0.005], // his right eye (on the left of the screen): the one that bleeds (the model paints its blood there)
  eyeL: [0.325, 0.005],
  hw: 0.215, // half an eye's width
  iris: [0.03, -0.035], // the iris centre, eye units (+x toward the outer corner)
  ir: 0.43, // its radius, eye units
};
const L = AMA_LAYOUT;
const v2 = (a) => `vec2(${a[0].toFixed(4)}, ${a[1].toFixed(4)})`;

// hair strands: root x (at y 0.62), tip x, tip y, half width at the root; and how far each bows sideways
const HAIR = [
  [0.04, -0.03, -0.36, 0.034], [0.11, 0.075, -0.1, 0.026], [-0.62, -0.61, -0.56, 0.07], [-0.77, -0.88, -0.6, 0.1],
  [0.64, 0.63, -0.56, 0.07], [0.79, 0.9, -0.6, 0.1], [-0.3, -0.25, 0.19, 0.065], [-0.14, -0.2, 0.15, 0.05],
  [0.25, 0.31, 0.2, 0.062], [0.43, 0.51, 0.13, 0.05], [-0.49, -0.53, -0.28, 0.022],
];
const BEND = [0.025, -0.02, -0.05, 0.02, 0.05, -0.02, 0.02, -0.02, -0.02, 0.025, 0.03];

const frag = /* glsl */ `
uniform float uTime; uniform float uNeg; uniform vec2 uIso; uniform float uBars; uniform vec4 uFlash;
uniform float uEye; uniform float uEyeT; uniform vec2 uLid; uniform vec4 uIris; uniform float uSpinBlur;
uniform vec2 uBlood; uniform vec3 uZoom; uniform vec2 uFlame; uniform vec2 uFlameC; uniform vec2 uShake; uniform float uEdgeFire;

#define AM_PI 3.14159265
#define AM_TAU 6.2831853
const vec2 AM_ER = ${v2(L.eyeR)};
const vec2 AM_EL = ${v2(L.eyeL)};
const float AM_HW = ${L.hw.toFixed(4)};
const vec2 AM_IC = ${v2(L.iris)};
const float AM_IR = ${L.ir.toFixed(4)};
const vec4 AM_HAIR[${HAIR.length}] = vec4[${HAIR.length}](${HAIR.map((h) => `vec4(${h.map((x) => x.toFixed(3)).join(', ')})`).join(', ')});
const float AM_BEND[${BEND.length}] = float[${BEND.length}](${BEND.map((x) => x.toFixed(3)).join(', ')});

float amH(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float amN(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(amH(i), amH(i + vec2(1.0, 0.0)), u.x), mix(amH(i + vec2(0.0, 1.0)), amH(i + vec2(1.0, 1.0)), u.x), u.y);
}
float amF(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int k = 0; k < 4; k++) { s += a * amN(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return s;
}
vec3 amLin(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }
float amBand(float d, float a, float b, float aa) { return smoothstep(a - aa, a + aa, d) * (1.0 - smoothstep(b - aa, b + aa, d)); }

// ---- the negative world's ramp, by darkness after the flip (perceived): ink, deep teal, steel, bone white
vec3 amTeal(float n) {
  vec3 c = mix(vec3(0.012, 0.03, 0.045), vec3(0.06, 0.18, 0.235), smoothstep(0.0, 0.4, n));
  c = mix(c, vec3(0.43, 0.56, 0.61), smoothstep(0.36, 0.7, n));
  return mix(c, vec3(0.9, 0.935, 0.945), smoothstep(0.68, 0.96, n));
}

// ---- the lids, eye units (x -1 inner corner .. 1 outer, y up from the eye's centre)
float amLo(float x) { float s = max(1.0 - x * x, 0.0); return -0.2 * pow(s, 0.8) * (1.0 + 0.2 * x) + 0.035 * x - 0.02; }
float amUpO(float x) { float s = max(1.0 - x * x, 0.0); return 0.34 * pow(s, 0.6) * (1.0 - 0.3 * x) + 0.06 * x - 0.02; }
// (shut, the upper lid lies on the lower: opening lifts it)
float amUp(float x, float open) { return mix(amLo(x), amUpO(x), open); }

// ---- the iris patterns in the unit disc (1 = the iris's edge): ink coverage
float amTomoe(vec2 q, float r, float a, float spin) {
  float ink = 1.0 - smoothstep(0.17, 0.19, r);
  ink = max(ink, 1.0 - smoothstep(0.01, 0.022, abs(r - 0.6)));
  for (int k = 0; k < 3; k++) {
    float th = spin + float(k) * 2.0943951;
    ink = max(ink, 1.0 - smoothstep(0.115, 0.13, length(q - 0.6 * vec2(cos(th), sin(th)))));
    // the tail trails the spin, curling out and thinning to a point
    float s = -(mod(a - th + AM_PI, AM_TAU) - AM_PI) / 1.05;
    if (s > 0.0 && s < 1.0) {
      float rc = 0.6 + 0.02 + 0.1 * s;
      float w = 0.115 * pow(1.0 - s, 1.5);
      ink = max(ink, 1.0 - smoothstep(w - 0.012, w, abs(r - rc)));
    }
  }
  return ink;
}
float amBlades(float r, float a, float spin) {
  float ink = 1.0 - smoothstep(0.125, 0.145, r);
  float s = (r - 0.09) / 0.72;
  if (s > 0.0 && s < 1.0) {
    float prof = 0.62 * pow(sin(AM_PI * pow(s, 0.62)), 0.85);
    for (int k = 0; k < 3; k++) {
      float d = mod(a - (spin + float(k) * 2.0943951 + s * 2.3) + AM_PI, AM_TAU) - AM_PI;
      float wk = d > 0.0 ? prof : prof * 0.42;
      ink = max(ink, (1.0 - smoothstep(wk - 0.024 / max(r, 0.05), wk, abs(d))) * smoothstep(0.0, 0.05, s));
    }
  }
  return max(ink, 1.0 - smoothstep(0.011, 0.022, abs(r - 0.8)));
}
vec3 amIris(vec2 q0) {
  float r0 = length(q0);
  float morph = uIris.x, spin = uIris.y, focus = uIris.z;
  // (focusing: the pattern draws in toward the pupil)
  vec2 q = q0 * (1.0 + 0.45 * focus);
  float r = length(q), a = atan(q.y, q.x);
  float fib = amN(vec2(abs(atan(q0.y, q0.x)) * 7.0, r0 * 3.0 + 1.7));
  vec3 red = mix(vec3(1.0, 0.13, 0.08), vec3(0.74, 0.02, 0.035), smoothstep(0.12, 0.7, r0));
  red = mix(red, vec3(0.26, 0.0, 0.02), smoothstep(0.72, 0.99, r0));
  red *= 0.82 + 0.34 * fib;
  red += vec3(0.7, 0.06, 0.03) * exp(-pow((r0 - 0.42) / 0.14, 2.0)) * (0.35 + 0.9 * focus);
  float sh = 0.0, mg = 0.0;
  for (int k = -1; k <= 1; k++) {
    float sp = spin + float(k) * uSpinBlur;
    sh += amTomoe(q, r, a, sp);
    mg += amBlades(r, a, sp);
  }
  sh /= 3.0;
  mg /= 3.0;
  // the Mangekyō spreads from the pupil out, a burning front ahead of it
  float front = morph * 1.3 - 0.12;
  float pat = mix(sh, mg, 1.0 - smoothstep(front - 0.07, front + 0.07, r));
  float rim = smoothstep(0.9, 0.96, r0);
  vec3 c = mix(red, vec3(0.025, 0.0, 0.008), max(pat, rim));
  c += vec3(2.2, 0.22, 0.1) * exp(-pow((r - front) / 0.05, 2.0)) * step(0.01, morph) * step(morph, 0.99);
  return c;
}

// ---- one blood stream from root down \`len\`: coverage (x) and the across coordinate for its shading (y)
vec2 amStream(vec2 p, vec2 root, float len, float w0, float seed, float aa) {
  float s = root.y - p.y;
  if (len <= 0.0 || s < -0.03 || s > len + 0.05) return vec2(0.0);
  float cx = root.x + 0.007 * sin(s * 19.0 + seed) + 0.012 * s + 0.003 * sin(s * 47.0 + seed * 3.0);
  float w = w0 * (0.82 + 0.22 * sin(s * 29.0 + seed * 2.0)) + 0.009 * exp(-max(s, 0.0) * 28.0);
  float dx = (p.x - cx) / w;
  float body = (1.0 - smoothstep(1.0 - aa / w, 1.0 + aa / w, abs(dx))) * smoothstep(-0.004, 0.004, s) * (1.0 - smoothstep(len - 0.004, len, s));
  // the drop at its head: rounder, a little wider, hanging
  float hx = root.x + 0.007 * sin(len * 19.0 + seed) + 0.012 * len + 0.003 * sin(len * 47.0 + seed * 3.0);
  vec2 hd = (p - vec2(hx, root.y - len - w0 * 0.5)) / vec2(w0 * 1.45, w0 * 1.9);
  float head = 1.0 - smoothstep(1.0 - aa / w0, 1.0 + aa / w0, length(hd));
  float cov = max(body, head);
  return vec2(cov, head > body ? hd.x : dx);
}
vec3 amBloodShade(vec3 c, vec2 st) {
  float x = st.y;
  vec3 b = mix(vec3(0.62, 0.02, 0.04), vec3(0.3, 0.0, 0.015), smoothstep(0.2, 1.0, abs(x)));
  // a wet highlight down one side
  b += vec3(0.9, 0.55, 0.55) * (1.0 - smoothstep(0.0, 0.18, abs(x - 0.42)));
  return mix(c, b, st.x);
}

// ---- rising embers (display colours, HDR)
vec3 amEmbers(vec2 p, float t) {
  vec3 acc = vec3(0.0);
  for (int l = 0; l < 2; l++) {
    float sc = l == 0 ? 7.0 : 13.0;
    vec2 g = p * sc + vec2(0.0, -t * (l == 0 ? 1.1 : 1.7));
    vec2 id = floor(g), f = fract(g) - 0.5;
    float h = amH(id + float(l) * 17.0);
    if (h > 0.8) {
      vec2 o = vec2(amH(id + 3.7), amH(id + 9.1)) - 0.5;
      o.x += 0.25 * sin(t * 2.0 + h * 40.0);
      float d = length(f - o * 0.6);
      acc += vec3(1.7, 0.5, 0.12) * exp(-d * d * (l == 0 ? 700.0 : 1400.0)) * (0.55 + 0.45 * sin(t * 13.0 + h * 90.0));
    }
  }
  return acc;
}

// ---- the painted close-up (display colours; p: screen heights from the centre, after the zoom)
vec3 amPaint(vec2 p, float aa) {
  float t = uEyeT;
  float lit = smoothstep(0.0, 0.75, t);
  // hair: the strands (the nearest covers), their shadow on the skin (cast down and right)
  float hair = 0.0, hairHl = 0.0, hairS = 0.0, shadow = 0.0;
  for (int i = 0; i < ${HAIR.length}; i++) {
    vec4 h = AM_HAIR[i];
    float bend = AM_BEND[i] + 0.006 * sin(uTime * 1.2 + float(i) * 1.7);
    float s = (0.62 - p.y) / (0.62 - h.z);
    if (s > 0.0 && s < 1.0) {
      float cx = mix(h.x, h.y, s) + bend * sin(s * AM_PI);
      float wd = h.w * pow(1.0 - s, 0.75) + 0.0015;
      float d = (p.x - cx) / wd;
      float m = 1.0 - smoothstep(1.0 - aa / wd, 1.0 + aa / wd, abs(d));
      if (m > hair) {
        hair = m;
        hairHl = smoothstep(0.05, 0.6, d) * (1.0 - smoothstep(0.6, 0.95, d));
        hairS = s;
      }
    }
    vec2 ps = p - vec2(0.012, -0.03);
    float s2 = (0.62 - ps.y) / (0.62 - h.z);
    if (s2 > 0.0 && s2 < 1.0) {
      float cx2 = mix(h.x, h.y, s2) + bend * sin(s2 * AM_PI);
      float wd2 = h.w * pow(1.0 - s2, 0.75) + 0.005;
      shadow = max(shadow, 1.0 - smoothstep(wd2 * 0.6, wd2 * 1.4, abs(ps.x - cx2)));
    }
  }
  // the fringe's mass above the forehead
  float mass = smoothstep(0.29, 0.3, p.y + 0.03 * sin(p.x * 23.0) + 0.015 * sin(p.x * 57.0 + 1.0));
  if (mass > hair) { hair = mass; hairHl = 0.0; hairS = 0.0; }
  shadow = max(shadow, smoothstep(0.2, 0.29, p.y + 0.03 * sin(p.x * 23.0)));

  // the nearer eye: eye units, +x toward its outer corner
  float side = p.x < 0.0 ? -1.0 : 1.0;
  bool bleeds = side < 0.0;
  vec2 E = bleeds ? AM_ER : AM_EL;
  vec2 e = vec2((p.x - E.x) * side, p.y - E.y) / AM_HW;
  float ea = aa / AM_HW;
  float open = bleeds ? uLid.x : uLid.y;

  // the background: red smoke in the dark round the face
  float sm = amF(p * 3.0 + vec2(0.0, -uTime * 0.25));
  vec3 col = mix(vec3(0.03, 0.0, 0.006), vec3(0.3, 0.015, 0.03), smoothstep(0.3, 0.8, sm) * (1.0 - smoothstep(-0.5, 0.55, p.y)));
  float faceW = 0.8 - 0.22 * (1.0 - smoothstep(-0.6, -0.05, p.y));
  float inFace = 1.0 - smoothstep(faceW - aa, faceW + aa, abs(p.x));

  // the skin: three painted tones, lit from below by the red, shaded under the brow, the fringe and the nose
  float Lt = 0.5;
  // (the brow ridge shades the lid softly; the cheekbones under the eyes and the nose bridge catch the light)
  vec2 br = (e - vec2(0.1, 0.5)) / vec2(1.3, 0.32);
  Lt -= 0.1 * exp(-dot(br, br));
  Lt -= 0.2 * shadow;
  Lt += 0.06 * (1.0 - smoothstep(-0.5, -0.1, p.y));
  Lt += 0.1 * (1.0 - smoothstep(0.0, 0.03, abs(p.x - 0.012))) * (1.0 - smoothstep(-0.05, 0.08, p.y)) * smoothstep(-0.45, -0.2, p.y);
  Lt -= 0.12 * smoothstep(0.08, 0.3, p.y);
  // (the shade down the nose's left side: a band just left of the bridge)
  float nose = (1.0 - smoothstep(-0.03, 0.0, p.x)) * smoothstep(-0.075, -0.035, p.x) * (1.0 - smoothstep(-0.1, 0.1, p.y));
  Lt -= 0.09 * nose;
  float b1 = smoothstep(0.34, 0.37, Lt), b2 = smoothstep(0.585, 0.615, Lt);
  vec3 skin = mix(mix(vec3(0.24, 0.1, 0.11), vec3(0.6, 0.38, 0.34), b1), vec3(0.86, 0.63, 0.52), b2);
  skin += vec3(0.4, 0.02, 0.02) * (1.0 - smoothstep(-0.5, 0.0, p.y)) * 0.55;
  // (soft light on the cheekbones: added after the bands, a hard-edged band there read as a pasted oval)
  vec2 ck = (e - vec2(0.2, -1.0)) / vec2(1.1, 0.55);
  skin += vec3(0.22, 0.13, 0.1) * exp(-dot(ck, ck)) * (1.0 - shadow * 0.7) * (side > 0.0 ? 1.0 : 0.7);
  col = mix(col, skin, inFace);

  // his tear-trough lines, down beside the nose from the inner corners
  {
    float s = (-0.14 - e.y) / 0.72;
    if (s > 0.0 && s < 1.0) {
      float xc = mix(-0.9, -0.52, s) - 0.07 * sin(s * AM_PI);
      float w = 0.02 * (1.0 - 0.55 * s);
      col = mix(col, vec3(0.16, 0.05, 0.06), (1.0 - smoothstep(w - ea, w + ea, abs(e.x - xc))) * (1.0 - 0.5 * s) * 0.8 * inFace);
    }
  }
  // his brows: thin, sharp, rising to the outer end (half under the fringe)
  {
    float s = (e.x + 0.85) / 2.0;
    if (s > 0.0 && s < 1.0) {
      float yc = 0.56 + 0.2 * sin(s * 2.4) - 0.06 * s;
      float w = 0.045 * pow(sin(AM_PI * pow(s, 0.55)), 0.9) + 0.004;
      col = mix(col, vec3(0.03, 0.012, 0.02), (1.0 - smoothstep(w - ea, w + ea, abs(e.y - yc))) * 0.92 * inFace);
    }
  }
  // the crease above the lid
  {
    float yc = amUpO(e.x) + 0.2 + 0.03 * e.x;
    float m = amBand(e.y - yc, -0.012, 0.012, ea) * smoothstep(-0.55, -0.2, e.x) * (1.0 - smoothstep(0.85, 1.0, e.x));
    col = mix(col, vec3(0.22, 0.08, 0.09), m * 0.7);
  }

  // the Mangekyō's light in the socket round each eye
  {
    vec2 g = (e - AM_IC) / vec2(1.7, 0.95);
    col += vec3(0.55, 0.02, 0.02) * exp(-dot(g, g) * 1.6) * (0.25 * smoothstep(0.0, 0.6, uIris.x) + 0.25 * uIris.z) * inFace;
  }
  // the eye itself
  float up = amUp(e.x, open), lo = amLo(e.x);
  float inEye = step(abs(e.x), 1.0) * smoothstep(lo - ea, lo + ea, e.y) * (1.0 - smoothstep(up - ea, up + ea, e.y)) * smoothstep(0.0, 0.02, up - lo);
  if (inEye > 0.001) {
    // the white: shaded under the upper lid, pink at the corners, veins crawling in from them
    vec3 w = vec3(0.93, 0.89, 0.87);
    w = mix(w, vec3(0.86, 0.58, 0.58), smoothstep(0.55, 1.0, abs(e.x)));
    float veins = uIris.w * (bleeds ? 1.0 : 0.3);
    if (veins > 0.001) {
      float n1 = amN(e * vec2(5.0, 7.0) + side * 3.1 + amN(e * 3.0) * 1.6);
      float n2 = amN(e * vec2(11.0, 15.0) + 7.3 + amN(e * 5.0 + 2.0));
      float v = max(1.0 - smoothstep(0.0, 0.05, abs(n1 - 0.5)), (1.0 - smoothstep(0.0, 0.06, abs(n2 - 0.5))) * 0.7);
      float grow = smoothstep(0.0, 0.25, abs(e.x) + amN(e * 2.5) * 0.35 - 1.05 + veins * 1.1);
      w = mix(w, vec3(0.72, 0.03, 0.05), v * grow * smoothstep(0.02, 0.18, length(e - AM_IC) - AM_IR));
      w = mix(w, vec3(0.9, 0.55, 0.54), veins * 0.35);
    }
    // the iris, glowing onto the white round it
    vec2 q = (e - AM_IC) / AM_IR;
    float r = length(q);
    w += vec3(0.5, 0.02, 0.02) * exp(-max(r - 1.0, 0.0) * 5.0) * 0.35;
    vec3 ball = w;
    if (r < 1.03) ball = mix(w, amIris(q), 1.0 - smoothstep(1.0 - ea / AM_IR, 1.0 + ea / AM_IR, r));
    // the upper lid's shadow on the ball
    ball *= 1.0 - 0.6 * smoothstep(up - 0.26, up, e.y);
    // blood pooling on the lower lid (his right eye)
    if (bleeds && uBlood.x > 0.001) {
      float pool = (1.0 - smoothstep(0.0, 0.03 + 0.12 * smoothstep(0.0, 0.5, uBlood.x) + 0.015 * sin(e.x * 9.0), e.y - lo));
      vec3 bc = mix(vec3(0.55, 0.02, 0.04), vec3(0.95, 0.5, 0.5), amBand(e.y - lo, 0.02, 0.035, ea) * 0.6);
      ball = mix(ball, bc, pool * smoothstep(0.0, 0.12, uBlood.x));
    }
    // the catch lights (they don't turn with the pattern)
    vec2 h1 = (q - vec2(-0.4, 0.36)) / vec2(0.16, 0.12), h2 = (q - vec2(0.36, -0.3)) / 0.06;
    ball = mix(ball, vec3(1.25), (1.0 - smoothstep(0.8, 1.0, length(h1))) * 0.9);
    ball = mix(ball, vec3(1.1), (1.0 - smoothstep(0.7, 1.0, length(h2))) * 0.7);
    col = mix(col, ball, inEye);
  }
  // the lash line: thick toward the outer corner, flicking out past it; the lower lid's fine line
  {
    float xl = e.x;
    float ly, th;
    if (xl <= 1.0) {
      ly = up;
      th = 0.045 + 0.08 * smoothstep(-0.7, 0.95, xl);
    } else {
      float u = xl - 1.0;
      ly = amUp(1.0, open) - 0.2 * u - 0.8 * u * u;
      th = 0.125 * pow(max(1.0 - u / 0.33, 0.0), 1.3);
    }
    float lash = amBand(e.y - ly, -0.012, th, ea) * step(-1.03, xl) * step(xl, 1.33);
    float lower = amBand(lo - e.y, -0.004, 0.02 * smoothstep(-0.3, 0.6, xl), ea) * step(-0.3, xl) * step(xl, 1.0);
    vec3 ink = vec3(0.03, 0.012, 0.018);
    col = mix(col, ink, max(lash, lower * 0.85));
  }
  // the blood: two streams from his right eye's lower lid, running down
  if (uBlood.x > 0.001 && p.x < 0.0) {
    vec2 r1 = AM_ER + vec2(-0.05, amLo(0.05)) * AM_HW;
    vec2 r2 = AM_ER + vec2(-0.55, amLo(0.55)) * AM_HW;
    col = amBloodShade(col, amStream(p, r1, uBlood.x * 0.62, 0.011, 1.3, aa));
    col = amBloodShade(col, amStream(p, r2, uBlood.y * 0.38, 0.0065, 4.1, aa));
  }
  // the Mangekyō waking: a red shock ring round each eye
  if (uIris.x > 0.01 && uIris.x < 0.999) {
    float k = smoothstep(0.25, 1.0, uIris.x);
    float rr = length(e - AM_IC) - AM_IR * (1.0 + 2.2 * k);
    col += vec3(1.0, 0.04, 0.04) * exp(-pow(rr / (0.04 + 0.06 * k), 2.0)) * (1.0 - k) * (1.0 - k) * 0.7;
  }
  // the hair over everything
  vec3 hc = vec3(0.012, 0.012, 0.02) + vec3(0.13, 0.14, 0.22) * hairHl * (1.0 - hairS) + vec3(0.35, 0.02, 0.02) * smoothstep(0.55, 1.0, hairS) * 0.4;
  col = mix(col, hc * (0.35 + 0.65 * lit), hair);
  col *= 0.12 + 0.88 * lit;
  // Amaterasu's black flames licking up the bottom edge as it comes
  if (uEdgeFire > 0.001) {
    float ff = amF(vec2(p.x * 4.0, p.y * 2.0 - uTime * 2.4));
    float H = -0.52 + uEdgeFire * (0.1 + 0.26 * ff) * (0.6 + 0.4 * smoothstep(0.2, 0.9, abs(p.x)));
    float m = 1.0 - smoothstep(H - 0.01, H + 0.01, p.y);
    col = mix(col, vec3(0.012, 0.0, 0.016), m);
    col += vec3(1.3, 0.06, 0.2) * exp(-pow((p.y - H) / 0.012, 2.0)) * uEdgeFire;
  }
  col += amEmbers(p, uTime) * lit;
  // the frame: a vignette, grain
  col *= 1.0 - smoothstep(0.45, 1.05, length(p * vec2(0.72, 1.1))) * 0.7;
  col += (amH(p * 431.0 + fract(uTime * 7.0)) - 0.5) * 0.035;
  return col;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  // (NaN and Inf out: an infinite HDR highlight times a zero weight is NaN, it showed through the black cover)
  vec3 c = min(inputColor.rgb, vec3(64.0));
  if (!(c.r >= 0.0)) c.r = 0.0;
  if (!(c.g >= 0.0)) c.g = 0.0;
  if (!(c.b >= 0.0)) c.b = 0.0;
  vec2 sq = (uv - 0.5) * vec2(aspect, 1.0);
  if (uNeg > 0.001) {
    // light and dark swapped onto the teal ramp (judged by perceived lightness: the stack is linear)
    float lum = pow(max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 0.0), 0.4545);
    // (a gamma on the flip: the black cloak keeps its folds as greys instead of one flat white, the bright world sinks dark)
    vec3 ng = amTeal(pow(smoothstep(0.04, 0.97, 1.0 - clamp(lum, 0.0, 1.0)), 1.7));
    // past the subject the arena sinks into slow smoke
    float vz = -getViewZ(depth);
    float far = smoothstep(uIso.x + 0.8, uIso.x + 7.0, vz) * uIso.y;
    vec2 sp = sq * 2.2 + vec2(uTime * 0.05, -uTime * 0.025);
    float s = amF(sp + amF(sp * 0.7 + uTime * 0.03) * 1.6);
    vec3 smoke = mix(vec3(0.015, 0.05, 0.07), vec3(0.13, 0.28, 0.34), smoothstep(0.35, 0.85, s));
    ng = mix(ng, mix(ng * 0.35, smoke, 0.82), far);
    // ink specks drifting across
    vec2 g = sq * 9.0 + vec2(uTime * 0.35, uTime * 0.12);
    vec2 id = floor(g), f = fract(g) - 0.5;
    float h = amH(id);
    float rs = 0.025 + 0.05 * amH(id + 1.3);
    float speck = step(0.8, h) * (1.0 - smoothstep(rs, rs + 0.03, length(f - (vec2(amH(id + 3.1), amH(id + 7.7)) - 0.5) * 0.6)));
    ng = mix(ng, vec3(0.004, 0.01, 0.018), speck * 0.85);
    ng *= 1.0 - smoothstep(0.35, 1.0, length(sq)) * 0.62;
    c = mix(c, amLin(ng), uNeg);
  }
  if (uEye > 0.001) {
    // (the camera on the painting: the point uZoom.xy at the screen's centre, magnified uZoom.z)
    vec2 p = sq / uZoom.z + uZoom.xy + uShake;
    c = mix(c, amLin(amPaint(p, 1.4 / (resolution.y * uZoom.z))), uEye);
  }
  if (uFlame.x > 0.001) {
    // the black flames out of the pupil (where it is on screen), over everything, then burning away in holes
    vec2 d = sq - uFlameC;
    float r = length(d);
    vec2 dir = r > 1e-4 ? d / r : vec2(1.0, 0.0);
    float n1 = amN(dir * 4.0 + vec2(uTime * 2.3, -uTime * 1.1));
    float n2 = amN(dir * 13.0 - vec2(uTime * 3.1, uTime * 1.7));
    float edge = uFlame.x * (0.78 + 0.34 * n1 + 0.16 * n2);
    float inF = 1.0 - smoothstep(edge - 0.015, edge + 0.015, r);
    float body = amF(d * 5.0 + vec2(0.0, -uTime * 2.2));
    vec3 fl = vec3(0.01, 0.0, 0.014) + vec3(0.2, 0.0, 0.12) * smoothstep(0.55, 0.85, body) * 0.35;
    float hn = amF(sq * 4.5 + vec2(0.0, -uTime * 0.35)) * 0.7 + length(sq) * 0.42;
    float b = uFlame.y * 1.4 - 0.08;
    float cover = smoothstep(b - 0.02, b + 0.02, hn);
    vec3 cf = mix(c, amLin(fl), inF * cover);
    // crimson where the flames' front runs and where the holes burn open
    cf += vec3(1.8, 0.06, 0.22) * exp(-pow((r - edge) / 0.025, 2.0)) * cover * step(uFlame.y, 0.999);
    cf += vec3(0.25, 0.02, 0.35) * exp(-max(r - edge, 0.0) * 9.0) * (1.0 - inF) * 0.6 * cover;
    // (the burning edge: a thin hot line, crimson into ember orange, the char just inside it)
    float eg = hn - b;
    cf += (vec3(1.6, 0.05, 0.12) * exp(-pow(eg / 0.012, 2.0)) + vec3(0.9, 0.18, 0.03) * exp(-pow((eg - 0.012) / 0.008, 2.0))) * inF * step(0.001, uFlame.y);
    c = cf;
  }
  if (uFlash.a > 0.001) c = mix(c, uFlash.rgb, uFlash.a);
  if (uBars > 0.001) {
    // the letterbox: 2.39:1 at full
    float h = 0.5 - 0.5 * min(1.0, aspect / 2.39);
    c = mix(c, vec3(0.0), step(0.5 - h * uBars, abs(uv.y - 0.5)));
  }
  outputColor = vec4(c, inputColor.a);
}`;

export class AmaterasuEffect extends Effect {
  constructor() {
    const U = (v) => new THREE.Uniform(v);
    super('Amaterasu', frag, {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.SRC,
      uniforms: new Map([
        ['uTime', U(0)], ['uNeg', U(0)], ['uIso', U(new THREE.Vector2())], ['uBars', U(0)], ['uFlash', U(new THREE.Vector4())],
        ['uEye', U(0)], ['uEyeT', U(0)], ['uLid', U(new THREE.Vector2())], ['uIris', U(new THREE.Vector4())], ['uSpinBlur', U(0)],
        ['uBlood', U(new THREE.Vector2())], ['uZoom', U(new THREE.Vector3(0, 0, 1))], ['uFlame', U(new THREE.Vector2())],
        ['uShake', U(new THREE.Vector2())], ['uEdgeFire', U(0)], ['uFlameC', U(new THREE.Vector2())],
      ]),
    });
    this.reset();
  }

  /** This frame's strengths (set by the cinematic each frame; applied, then reset). */
  reset() {
    this.neg = 0; // the negative world
    this.iso = [4, 0]; // [the subject's distance from the camera (m), how much the rest sinks into smoke]
    this.bars = 0; // the letterbox (1 = 2.39:1)
    this.flash = [1, 1, 1, 0]; // rgb (linear), amount
    this.eye = 0; // the painted close-up over everything
    this.eyeT = 0; // its clock (s)
    this.lid = [0, 0]; // lids open: his right eye, his left
    this.iris = [0, 0, 0, 0]; // Sharingan -> Mangekyō, spin (rad), focus, veins
    this.spinBlur = 0; // (rad either side: a fast spin smears)
    this.blood = [0, 0]; // the two streams (0..1 of their length)
    this.zoom = [0, 0, 1]; // [the painting's point at the screen's centre x, y (screen heights), magnification]
    this.flame = [0, 0]; // the black flames' reach (screen heights), burnt away (0..1)
    this.flameC = [0, 0]; // where they burst from (screen heights from the centre)
    this.shake = [0, 0];
    this.edgeFire = 0; // black flames up the close-up's bottom edge
  }

  apply(dt) {
    const U = this.uniforms;
    U.get('uTime').value += dt;
    for (const [k, v] of [['uNeg', this.neg], ['uBars', this.bars], ['uEye', this.eye], ['uEyeT', this.eyeT], ['uSpinBlur', this.spinBlur], ['uEdgeFire', this.edgeFire]]) U.get(k).value = v;
    U.get('uIso').value.set(this.iso[0], this.iso[1]);
    U.get('uFlash').value.set(...this.flash);
    U.get('uLid').value.set(this.lid[0], this.lid[1]);
    U.get('uIris').value.set(...this.iris);
    U.get('uBlood').value.set(this.blood[0], this.blood[1]);
    U.get('uZoom').value.set(...this.zoom);
    U.get('uFlame').value.set(this.flame[0], this.flame[1]);
    U.get('uFlameC').value.set(this.flameC[0], this.flameC[1]);
    U.get('uShake').value.set(this.shake[0], this.shake[1]);
    this.reset();
  }
}
