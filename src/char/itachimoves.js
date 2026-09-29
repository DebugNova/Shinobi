// Itachi's jutsu clips (keyframes.js format, baked per body with every other keyed move: bakeMoves). Frames at 60 Hz,
// laid on the timings in src/shared/itachi.js. Fighter frame: +z forward, +x his LEFT, y up, reference-body metres;
// hand targets follow his shoulders (gotcha 34). His cloak's collar stands high round the jaw: a hand at the mouth
// sits at z ~0.36 (in front of it), hands at the chest at z >= 0.26.
const P = (x, y, z, o = {}) => ({ p: [x, y, z], ...o });

// hand signs (per-finger curls: index, middle, ring, little)
const TIGER = { fingers: [0, 0, 1, 1], thumb: 0.6, spread: -6 };
const sealL = (y = 1.2, z = 0.3) => P(0.03, y, z, { pole: [1, -0.4, 0], wrist: [0, -60, 70], ...TIGER });
const sealR = (y = 1.2, z = 0.3) => P(-0.03, y, z, { pole: [-1, -0.4, 0], wrist: [0, 60, -70], ...TIGER });
// the right hand's two fingers up at the lips (the half-Tiger the fire is blown through)
const mouthR = (y = 1.34, z = 0.36) => P(-0.02, y, z, { pole: [-1, -0.6, 0], wrist: [0, -40, -70], ...TIGER });
// his calm stance for a cast: feet under the shoulders, the left a little ahead
const CALM = { lf: { p: [0.14, 0, 0.12], pole: [0.2, 0, 1], yaw: -8 }, rf: { p: [-0.15, 0, -0.14], yaw: 18 } };
const WIDE = { lf: { p: [0.2, 0, 0.3], pole: [0.3, 0, 1], yaw: -8 }, rf: { p: [-0.2, 0, -0.3], yaw: 28 } };

// Phoenix Sage Fire (62 f): the Tiger seal (0-10), the fingers to the mouth with a breath in (10-16), a fireball blown
// at 18, 30 and 42 (a snap forward from the chest, a short recoil and a new breath between), the recovery (42-62)
const INHALE = { h: [0, -0.05, -0.05], hips: [-2, -12, 0], spine: [-6, -4, 0], chest: [-7, -2, 0], upperChest: [-3, 0, 0], neck: [-3, 4, 0], head: [-10, 4, 0], ...WIDE };
const BLOW = { h: [0, -0.12, 0.07], hips: [6, -8, 0], spine: [10, -2, 0], chest: [6, 0, 0], upperChest: [2, 0, 0], neck: [-12, 4, 0], head: [-10, 4, 0], ...WIDE };
const LHIP = P(0.3, 0.98, -0.1, { pole: [1, -0.3, -0.5], fist: 1 }); // the left fist back at the hip while he blows
const shot = (f, mouth, extra = {}) => [
  [f, { ...BLOW, ...extra, lh: LHIP, rh: mouth }, 'snap'],
  [f + 6, { ...INHALE, h: [0, -0.07, -0.02], lh: LHIP, rh: mouthR(1.35, 0.35) }, 'io'],
];
const fire = {
  keys: [
    [0, {}],
    [5, { h: [0, -0.06, 0], hips: [2, -10, 0], spine: [4, 2, 0], lh: P(0.09, 1.14, 0.3, { open: 0.5, pole: [1, -0.5, 0] }), rh: P(-0.09, 1.14, 0.3, { open: 0.5, pole: [-1, -0.5, 0] }), ...WIDE }, 'out'],
    [9, { h: [0, -0.08, 0], hips: [2, -8, 0], spine: [5, 4, 0], chest: [3, 4, 0], neck: [-4, 0, 0], head: [-3, 0, 0], lh: sealL(1.2), rh: sealR(1.2), ...WIDE }, 'snap'],
    [11, { h: [0, -0.08, 0], hips: [2, -8, 0], spine: [5, 4, 0], chest: [3, 4, 0], neck: [-4, 0, 0], head: [-3, 0, 0], lh: sealL(1.19), rh: sealR(1.19), ...WIDE }],
    [16, { ...INHALE, lh: LHIP, rh: mouthR() }, 'io'],
    ...shot(18, mouthR(1.33, 0.37)),
    ...shot(30, mouthR(1.33, 0.37), { spine: [11, -2, 0] }),
    // the third is the biggest: a deeper drive, the head down behind it
    [42, { ...BLOW, h: [0, -0.16, 0.1], hips: [8, -8, 0], spine: [13, -2, 0], chest: [7, 0, 0], neck: [-14, 4, 0], head: [-12, 4, 0], lh: LHIP, rh: mouthR(1.32, 0.38) }, 'snap'],
    [50, { ...BLOW, h: [0, -0.13, 0.07], lh: LHIP, rh: mouthR(1.33, 0.37) }, 'io'],
    [62, {}, 'io'],
  ],
};

// Tsukuyomi (44 f): the head lowers, eyes in shadow, the left hand rising to a one-handed seal before the chest
// (0-10); at 18 the head comes up and the eyes meet theirs (the gaze), held still (18-38), then he lets it go
const LOW = {
  h: [0, -0.03, 0], hips: [0, -6, 0], spine: [3, 0, 0], chest: [2, 0, 0], neck: [10, 0, 0], head: [16, 0, 0], ...CALM,
  lh: P(0.04, 1.16, 0.3, { pole: [1, -0.6, 0], wrist: [0, -50, 70], fingers: [0, 0, 1, 1], thumb: 0.7 }),
  rh: P(-0.2, 0.84, 0.05, { pole: [-1, 0.2, -0.4], open: 0.35 }),
};
const GAZE = {
  ...LOW, h: [0, -0.02, 0.01], spine: [-2, 0, 0], chest: [-3, 0, 0], neck: [-4, 0, 0], head: [-5, 0, 0],
  lh: P(0.04, 1.2, 0.31, { pole: [1, -0.6, 0], wrist: [0, -50, 70], fingers: [0, 0, 1, 1], thumb: 0.7 }),
};
const tsukuyomi = {
  keys: [
    [0, {}],
    [10, LOW, 'io'],
    [15, { ...LOW, neck: [12, 0, 0], head: [18, 0, 0] }, 'io'],
    [18, GAZE, 'snap'],
    [24, { ...GAZE, h: [0, -0.025, 0.02], head: [-6, 0, 0] }, 'out'],
    [38, { ...GAZE, h: [0, -0.03, 0.01] }, 'io'],
    [44, {}, 'io'],
  ],
};

// Crow Clone Escape (38 f): the arms fling out as the body bursts (0-4); hidden 5-26 (he re-forms crouched on one knee
// where the crows gather: the pose is already there at 26), rising to the stance by 38
const BURST = {
  h: [0, 0.02, -0.03], hips: [-4, 0, 0], spine: [-8, 0, 0], chest: [-8, 0, 0], neck: [-6, 0, 0], head: [-10, 0, 0], ...CALM,
  lh: P(0.62, 1.34, 0.08, { pole: [0, -1, -0.4], open: 1, spread: 10 }), rh: P(-0.62, 1.34, 0.08, { pole: [0, -1, -0.4], open: 1, spread: 10 }),
};
const KNEEL = {
  h: [0, -0.44, 0.02], hips: [26, -10, 0], spine: [10, 0, 0], chest: [6, 0, 0], neck: [-12, 0, 0], head: [-14, 0, 0],
  lf: { p: [0.17, 0, 0.3], pole: [0.3, 0, 1], yaw: -10 }, rf: { p: [-0.17, 0.02, -0.32], pole: [0, 0, 1], pitch: 52, yaw: 12 },
  lh: P(0.26, 0.78, 0.3, { pole: [1, -0.6, 0], open: 0.5 }), rh: P(-0.2, 0.22, 0.36, { pole: [-1, 0.2, 0], open: 0.9, spread: 6 }),
};
const crow = {
  keys: [
    [0, {}],
    [4, BURST, 'snap'],
    [5, BURST],
    [6, KNEEL, 'lin'],
    [26, KNEEL],
    [31, { ...KNEEL, h: [0, -0.3, 0.02], hips: [16, -10, 0], rf: { p: [-0.17, 0, -0.26], yaw: 18 } }, 'out'],
    [38, {}, 'io'],
  ],
};

// Amaterasu (312 f), acted for its cinematic (src/game/amaterasu.js AMA: every screen films it at the same time).
// Two fingers of the right hand rise to the right eye (the target is the wrist: the fingertips reach the eye with it at
// the chin), the head tilting into them, eyes shut (0-24); as the world turns negative the arms fling wide, head bowed,
// the crows bursting off his back (30-100, the front shot); the arms sink (100-140) and the head comes up level as the
// camera rushes into his face (126-150); unseen through the painted close-up of his eyes, then the fingers to the eye
// again (235-255), and at `focus` (262) the hand snaps away and the eye opens on them (the flames), held while the
// flames take hold, then the recovery (300-312)
const EYE = {
  h: [0, -0.05, 0], hips: [0, -10, 0], spine: [4, -4, 0], chest: [3, -2, 0], neck: [4, -8, -6], head: [6, -8, -8], ...CALM,
  rh: P(-0.07, 1.33, 0.27, { pole: [-1, -0.8, -0.2], wrist: [10, -20, -20], fingers: [0, 0, 1, 1], thumb: 0.8 }),
  lh: P(0.28, 0.9, -0.12, { pole: [1, 0, -0.6], open: 0.4 }),
};
const FOCUS = { ...EYE, h: [0, -0.08, 0.02], spine: [7, -4, 0], chest: [5, -2, 0], neck: [6, -8, -6], head: [9, -8, -8] };
const OPEN = {
  h: [0, -0.07, 0.04], hips: [2, -8, 0], spine: [-4, 0, 0], chest: [-5, 0, 0], neck: [-6, 0, 0], head: [-8, 0, 0], ...CALM,
  rh: P(-0.36, 1.2, 0.36, { pole: [-1, -0.6, 0], open: 0.8, spread: 6 }), lh: P(0.3, 0.92, -0.14, { pole: [1, 0, -0.6], open: 0.4 }),
};
// arms flung wide, palms out, the chest open and the head bowed (the reference's first shot); then sinking to the front
const SPREAD = {
  h: [0, -0.03, 0], hips: [-2, -4, 0], spine: [-5, 0, 0], chest: [-7, 0, 0], upperChest: [-3, 0, 0], neck: [12, 0, 0], head: [16, 0, 0], ...CALM,
  lh: P(0.66, 1.3, 0.16, { pole: [0, -1, -0.5], open: 1, spread: 12 }), rh: P(-0.66, 1.3, 0.16, { pole: [0, -1, -0.5], open: 1, spread: 12 }),
};
const SINK = {
  ...SPREAD, spine: [-2, 0, 0], chest: [-3, 0, 0], upperChest: [-1, 0, 0], neck: [10, 0, 0], head: [12, 0, 0],
  lh: P(0.38, 0.98, 0.3, { pole: [1, -0.4, -0.3], open: 0.8, spread: 8 }), rh: P(-0.38, 0.98, 0.3, { pole: [-1, -0.4, -0.3], open: 0.8, spread: 8 }),
};
const STILL = {
  h: [0, -0.02, 0], hips: [0, -6, 0], spine: [1, 0, 0], chest: [0, 0, 0], neck: [-2, 0, 0], head: [-3, 0, 0], ...CALM,
  lh: P(0.24, 0.86, 0.06, { pole: [1, 0.1, -0.3], open: 0.35 }), rh: P(-0.24, 0.86, 0.05, { pole: [-1, 0.1, -0.3], open: 0.35 }),
};
// the classic gaze: head level, two fingers at the right eye
const STARE = { ...EYE, h: [0, -0.04, 0], spine: [2, -4, 0], chest: [1, -2, 0], neck: [0, -6, -4], head: [-2, -6, -5] };
const amaterasu = {
  keys: [
    [0, {}],
    [12, EYE, 'out'],
    [22, { ...FOCUS, rh: P(-0.07, 1.32, 0.28, { pole: [-1, -0.8, -0.2], wrist: [10, -20, -20], fingers: [0, 0, 1, 1], thumb: 0.8 }) }, 'io'],
    [28, FOCUS, 'io'],
    [40, SPREAD, 'out'],
    [96, { ...SPREAD, h: [0, -0.02, 0], chest: [-8, 0, 0], lh: P(0.68, 1.34, 0.12, { pole: [0, -1, -0.5], open: 1, spread: 12 }), rh: P(-0.68, 1.34, 0.12, { pole: [0, -1, -0.5], open: 1, spread: 12 }) }, 'io'],
    [122, SINK, 'io'],
    [146, STILL, 'io'],
    [232, { ...STILL, h: [0, -0.025, 0], head: [-4, 0, 0] }, 'io'],
    [250, STARE, 'io'],
    [258, { ...STARE, head: [-3, -6, -5] }, 'io'],
    [262, OPEN, 'snap'],
    [270, { ...OPEN, h: [0, -0.06, 0.03], head: [-7, 0, 0] }, 'out'],
    [298, { ...OPEN, h: [0, -0.05, 0.02], head: [-6, 0, 0] }, 'io'],
    [312, {}, 'io'],
  ],
};

/** The same upper-body keys hanging in the air: legs tucked; `pitch` degrees of the head down from frame `from`. */
function airVariant(def, pitch = 0, from = 0) {
  const AIR = { h: [0, 0.05, 0], lf: { p: [0.12, 0.3, 0.2], pole: [0, 0.3, 1], pitch: 20 }, rf: { p: [-0.12, 0.18, -0.15], pole: [0, 0.3, 1], pitch: 30 } };
  return {
    base: AIR,
    keys: def.keys.map(([f, s, e]) => {
      if (!Object.keys(s).length) return [f, s, e];
      const o = { ...s, lf: AIR.lf, rf: AIR.rf, h: [0, 0.05, 0] };
      if (pitch && f >= from) {
        o.neck = [(s.neck?.[0] || 0) + pitch * 0.5, s.neck?.[1] || 0, s.neck?.[2] || 0];
        o.head = [(s.head?.[0] || 0) + pitch * 0.5, s.head?.[1] || 0, s.head?.[2] || 0];
      }
      return [f, o, e];
    }),
  };
}

// Inside Tsukuyomi (the victim's own screen, tsukuyomi.js): the victim bound to the cross, arms along the crossbar
// (pulled a little back onto it), hanging from it with the feet off the ground, the head dropping and rolling as it
// struggles (a 2.5 s loop); Itachi standing before it, calm, breathing (a 3 s loop)
const boundArms = (y, z, dx = 0) => ({
  lh: P(0.6 + dx, y, z, { pole: [0.1, -1, 0.3], open: 0.55, spread: 8 }),
  rh: P(-0.6 - dx, y, z, { pole: [-0.1, -1, 0.3], open: 0.55, spread: 8 }),
});
const BOUND = {
  h: [0, -0.02, 0.02], hips: [2, 0, 0], spine: [4, 0, 0], chest: [3, 0, 0], upperChest: [1, 0, 0], neck: [16, 0, 6], head: [20, 6, 9],
  lf: { p: [0.065, 0, 0.04], pole: [0.1, 0, 1], pitch: 38, yaw: -4 }, rf: { p: [-0.065, 0.01, 0.01], pole: [-0.1, 0, 1], pitch: 30, yaw: 6 },
  ...boundArms(1.3, 0.08),
};
const WATCH = {
  h: [0, -0.015, 0], hips: [0, -4, 0], spine: [1, 2, 0], chest: [0, 2, 0], upperChest: [0, 0, 0], neck: [-2, 0, 0], head: [-3, 0, 0],
  lf: { p: [0.13, 0, 0.06], pole: [0.2, 0, 1], yaw: -6 }, rf: { p: [-0.13, 0, -0.05], pole: [-0.1, 0, 1], yaw: 10 },
  lh: P(0.24, 0.84, 0.05, { pole: [1, 0.1, -0.3], open: 0.3 }), rh: P(-0.24, 0.84, 0.04, { pole: [-1, 0.1, -0.3], open: 0.3 }),
};

export const ITACHI_CLIPS = {
  ita_fire: fire,
  ita_fire_air: airVariant(fire, 16, 16),
  ita_tsukuyomi: tsukuyomi,
  ita_tsukuyomi_air: airVariant(tsukuyomi),
  ita_crow: crow,
  ita_amaterasu: amaterasu,
  ita_amaterasu_air: airVariant(amaterasu),
  // a genjutsu's victim (Tsukuyomi): slack, swaying where it stands, the head hanging, arms loose (a 3 s loop)
  dazed: {
    loop: true,
    keys: [
      [0, { h: [0, -0.1, 0], hips: [4, 0, 0], spine: [8, 0, 3], chest: [8, 0, 2], upperChest: [4, 0, 0], neck: [16, 0, 4], head: [20, 4, 6], ...CALM, lh: P(0.24, 0.8, 0.06, { pole: [1, 0.2, -0.3], open: 0.3 }), rh: P(-0.23, 0.78, 0.04, { pole: [-1, 0.2, -0.3], open: 0.3 }) }],
      [90, { h: [0.02, -0.12, 0.01], hips: [5, 0, -2], spine: [10, 0, -3], chest: [9, 0, -2], upperChest: [4, 0, 0], neck: [18, 0, -5], head: [24, -4, -7], ...CALM, lh: P(0.23, 0.78, 0.05, { pole: [1, 0.2, -0.3], open: 0.3 }), rh: P(-0.24, 0.8, 0.07, { pole: [-1, 0.2, -0.3], open: 0.3 }) }, 'io'],
      [180, { h: [0, -0.1, 0], hips: [4, 0, 0], spine: [8, 0, 3], chest: [8, 0, 2], upperChest: [4, 0, 0], neck: [16, 0, 4], head: [20, 4, 6], ...CALM, lh: P(0.24, 0.8, 0.06, { pole: [1, 0.2, -0.3], open: 0.3 }), rh: P(-0.23, 0.78, 0.04, { pole: [-1, 0.2, -0.3], open: 0.3 }) }, 'io'],
    ],
  },
  tsu_bound: {
    loop: true,
    base: BOUND,
    keys: [
      [0, {}],
      [40, { h: [0.012, -0.03, 0.03], spine: [6, 0, -3], chest: [5, 0, -2], neck: [20, 0, -4], head: [24, -8, -7], ...boundArms(1.29, 0.09, -0.01) }, 'io'],
      [75, { h: [0, -0.015, 0.015], spine: [2, 0, 0], chest: [0, 0, 0], upperChest: [-2, 0, 0], neck: [10, 0, 2], head: [12, 2, 3] }, 'io'],
      [110, { h: [-0.01, -0.03, 0.03], spine: [6, 0, 3], chest: [5, 0, 2], neck: [19, 0, 7], head: [22, 9, 10], ...boundArms(1.29, 0.09, -0.01) }, 'io'],
      [150, {}, 'io'],
    ],
  },
  tsu_watch: {
    loop: true,
    base: WATCH,
    keys: [
      [0, {}],
      [90, { h: [0, -0.022, 0.004], spine: [2, 2, 0], chest: [1, 2, 0], neck: [-2, 0, 0], head: [-3, 1, 0] }, 'io'],
      [180, {}, 'io'],
    ],
  },
};
