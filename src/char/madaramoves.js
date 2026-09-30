// Madara's jutsu clips (keyframes.js format, baked per body with every other keyed move: bakeMoves). Frames at 60 Hz,
// laid on the timings in src/shared/madara.js. Fighter frame: +z forward, +x his LEFT, y up, reference-body metres;
// hand targets follow his shoulders (gotcha 34). His chest plate (dō) stands ~15 cm off the chest and the collar is
// tall: hands at the chest stay at z >= 0.26, a hand at the mouth at z ~0.38 (checked with scripts/debug/posetest.mjs).
const P = (x, y, z, o = {}) => ({ p: [x, y, z], ...o });

// hand signs (per-finger curls: index, middle, ring, little)
const TIGER = { fingers: [0, 0, 1, 1], thumb: 0.6, spread: -6 };
const sealL = (y = 1.2, z = 0.3) => P(0.03, y, z, { pole: [1, -0.4, 0], wrist: [0, -60, 70], ...TIGER });
const sealR = (y = 1.2, z = 0.3) => P(-0.03, y, z, { pole: [-1, -0.4, 0], wrist: [0, 60, -70], ...TIGER });
// the right hand's two fingers straight up in front of the mouth (the half-Tiger he blows the fire past)
const mouthR = (x = 0.025, y = 1.2, z = 0.38) => P(x, y, z, { pole: [-1, -0.6, 0], wrist: [0, -40, -70], ...TIGER });

// the square, rooted stance of a big cast (the robe flares with the wide feet)
const ROOT = { lf: { p: [0.2, 0, 0.3], pole: [0.3, 0, 1], yaw: -8 }, rf: { p: [-0.2, 0, -0.3], yaw: 28 } };

// Great Fire Annihilation (86 f): the Tiger seal (0-12), the inhale leaning back (12-26), the torrent (26-66: the
// body drives forward behind the fingers at the mouth, head level so the fire leaves straight), the recovery
const fire = {
  keys: [
    [0, {}],
    [5, { h: [0, -0.07, 0], hips: [2, -10, 0], spine: [4, 2, 0], lh: P(0.09, 1.14, 0.3, { open: 0.5, pole: [1, -0.5, 0] }), rh: P(-0.09, 1.14, 0.3, { open: 0.5, pole: [-1, -0.5, 0] }), ...ROOT }, 'out'],
    [9, { h: [0, -0.09, 0], hips: [2, -8, 0], spine: [5, 4, 0], chest: [3, 4, 0], neck: [-4, 0, 0], head: [-3, 0, 0], lh: sealL(1.2), rh: sealR(1.2), ...ROOT }, 'snap'],
    [13, { h: [0, -0.1, 0], hips: [2, -8, 0], spine: [6, 4, 0], chest: [4, 4, 0], neck: [-5, 0, 0], head: [-4, 0, 0], lh: sealL(1.19), rh: sealR(1.19), ...ROOT }],
    // the inhale: chest up, head back, weight onto the rear foot, the seal lifted
    [24, { h: [0, -0.06, -0.09], hips: [-4, -10, 0], spine: [-10, 0, 0], chest: [-10, 0, 0], upperChest: [-4, 0, 0], neck: [-6, 0, 0], head: [-18, 0, 0], lh: sealL(1.24, 0.26), rh: sealR(1.24, 0.26), lf: { p: [0.18, 0, 0.28], yaw: -8 }, rf: { p: [-0.19, 0, -0.28], yaw: 28 } }, 'io'],
    [26, { h: [0, -0.06, -0.1], hips: [-5, -10, 0], spine: [-11, 0, 0], chest: [-11, 0, 0], upperChest: [-4, 0, 0], neck: [-6, 0, 0], head: [-19, 0, 0], lh: sealL(1.25, 0.26), rh: sealR(1.25, 0.26), lf: { p: [0.18, 0, 0.28], yaw: -8 }, rf: { p: [-0.19, 0, -0.28], yaw: 28 } }],
    // the torrent: a snap forward, then a sustained push that swells and settles
    [31, { h: [0, -0.16, 0.09], hips: [7, 10, 0], spine: [11, 6, 0], chest: [7, 4, 0], upperChest: [2, 0, 0], neck: [-15, -6, 0], head: [-13, -6, 0], lh: P(0.33, 0.98, -0.14, { pole: [1, -0.3, -0.5], fist: 1 }), rh: mouthR(), lf: { p: [0.21, 0, 0.4], pole: [0.3, 0, 1], yaw: -5 }, rf: { p: [-0.2, 0, -0.37], pitch: 22, yaw: 30 } }, 'snap'],
    [44, { h: [0, -0.14, 0.07], hips: [6, 10, 0], spine: [9, 6, 0], chest: [6, 4, 0], upperChest: [2, 0, 0], neck: [-13, -6, 0], head: [-12, -6, 0], lh: P(0.34, 1.0, -0.12, { pole: [1, -0.3, -0.5], fist: 1 }), rh: mouthR(0.025, 1.21, 0.37), lf: { p: [0.21, 0, 0.4], pole: [0.3, 0, 1], yaw: -5 }, rf: { p: [-0.2, 0, -0.37], pitch: 22, yaw: 30 } }, 'io'],
    [56, { h: [0, -0.17, 0.1], hips: [8, 10, 0], spine: [12, 6, 0], chest: [7, 4, 0], upperChest: [2, 0, 0], neck: [-16, -6, 0], head: [-14, -6, 0], lh: P(0.33, 0.97, -0.15, { pole: [1, -0.3, -0.5], fist: 1 }), rh: mouthR(0.025, 1.19, 0.39), lf: { p: [0.21, 0, 0.4], pole: [0.3, 0, 1], yaw: -5 }, rf: { p: [-0.2, 0, -0.37], pitch: 22, yaw: 30 } }, 'io'],
    [66, { h: [0, -0.15, 0.08], hips: [6, 10, 0], spine: [10, 6, 0], chest: [6, 4, 0], upperChest: [2, 0, 0], neck: [-14, -6, 0], head: [-12, -6, 0], lh: P(0.33, 0.99, -0.13, { pole: [1, -0.3, -0.5], fist: 1 }), rh: mouthR(0.02, 1.19, 0.37), lf: { p: [0.21, 0, 0.4], pole: [0.3, 0, 1], yaw: -5 }, rf: { p: [-0.2, 0, -0.37], pitch: 22, yaw: 30 } }, 'io'],
    [86, {}, 'io'],
  ],
};

// Wood Release: Cutting Technique (66 f): the right arm winds up high (0-8), he drops to one knee and slams the palm
// flat on the ground (12: the stakes start), holds it while they run (12-48), rises (48-66). The torso folds ~80 deg so
// the hand reaches the ground (arm 0.44 m); the wide knees flare the robe.
const SLAM = {
  h: [0, -0.5, 0.14], hips: [42, -12, 0], spine: [22, -4, 0], chest: [12, -4, 0], upperChest: [6, 0, 0], neck: [-34, 4, 0], head: [-28, 4, 0],
  lf: { p: [0.3, 0, 0.34], pole: [0.4, 0, 1], yaw: -15 }, rf: { p: [-0.22, 0.04, -0.34], pole: [-0.2, 0, 1], pitch: 55, yaw: 25 },
  lh: P(0.42, 0.8, -0.2, { pole: [1, -0.2, -0.6], open: 0.8 }), rh: P(-0.12, 0.08, 0.48, { pole: [-1, 0.3, 0], open: 1, spread: 6 }),
};
const WIND = {
  h: [0, 0.01, -0.05], hips: [-6, -24, 0], spine: [-8, -10, 0], chest: [-6, -8, 0], neck: [-2, 8, 0], head: [-6, 8, 0],
  lf: { p: [0.22, 0, 0.32], pole: [0.3, 0, 1], yaw: -12 }, rf: { p: [-0.2, 0, -0.3], yaw: 25 },
  lh: P(0.22, 1.12, 0.34, { pole: [1, -0.5, 0], open: 0.6 }), rh: P(-0.3, 1.62, -0.08, { pole: [-1, 0, -1], open: 1, spread: 8 }),
};
const wood = {
  keys: [
    [0, {}],
    [8, WIND, 'out'],
    [12, SLAM, 'in'],
    // the impact: a little deeper, then it settles
    [15, { ...SLAM, h: [0, -0.54, 0.15], spine: [25, -4, 0], rh: P(-0.12, 0.07, 0.49, { pole: [-1, 0.3, 0], open: 1, spread: 6 }) }, 'out'],
    [30, { ...SLAM, h: [0, -0.51, 0.14] }, 'io'],
    [48, { ...SLAM, h: [0, -0.5, 0.13], spine: [21, -4, 0] }, 'io'],
    [66, {}, 'io'],
  ],
};
// the dive from the air (held until he lands): the wind-up with the legs tucked
const woodDive = {
  keys: [
    [0, { ...WIND, h: [0, 0.05, 0], lf: { p: [0.12, 0.34, 0.18], pole: [0, 0.3, 1], pitch: 20 }, rf: { p: [-0.12, 0.22, -0.12], pole: [0, 0.3, 1], pitch: 30 } }],
    [30, { ...WIND, h: [0, 0.05, 0], hips: [8, -24, 0], lf: { p: [0.12, 0.3, 0.2], pole: [0, 0.3, 1], pitch: 20 }, rf: { p: [-0.12, 0.2, -0.1], pole: [0, 0.3, 1], pitch: 30 } }],
  ],
  loop: true,
};

// Uchiha Return (90 f, timings in madara.js): the gunbai rides head down on his back, its handle up past his right
// shoulder (madarafx.js GUNBAI.back). The right hand reaches up over the shoulder and closes on the handle (grab at 5,
// held a beat), then swings the fan out behind him and up over his head, the paddle turning a half circle away from
// his back (5-12), and sweeps it round in one full turn to his left, the arm out in front so the fan's face pushes the
// air (rot 0 -> 360 over 12-31, a small hop so the feet don't slide; the gust bursts at 20), then plants it upright in
// front of him: the Uchiha Return guard, the left palm at the chest behind it (31-72, the barrier). The same arc the
// other way puts it back: up over his head, the paddle swung down behind him, the fist back at the shoulder (let go at
// 84). The fan itself follows the hand from the grab to the release (madarafx.js Gunbai): at the grab and the release
// the fist holds it exactly as it rides on his back (wrists solved for that on his rig, scripts/debug/gunbai.mjs), so
// it changes hands without a jump; the fist's thumb side up with wrist -40 stands it upright.
const FAN = { fist: 1, wrist: [-40, 0, 0] };
// the hand on the handle above the right shoulder, palm to the neck, elbow up and forward (gotcha 41: the elbow the
// way it really goes); the head bows and turns away from the arm, the chest turned a little to the right
const BACK = {
  h: [0, -0.04, 0], hips: [2, -8, 0], spine: [2, -6, 0], chest: [0, -4, 0], neck: [6, 4, -4], head: [6, 6, -6],
  lf: { p: [0.2, 0, 0.26], pole: [0.3, 0, 1], yaw: -12 }, rf: { p: [-0.2, 0, -0.26], yaw: 25 },
  rh: P(-0.075, 1.508, -0.256, { pole: [-0.6, 1, 0.5], fist: 1, wrist: [6.4, 8, -13] }), lh: P(0.16, 1.12, 0.3, { pole: [1, -1, 0], open: 0.6 }),
};
// the swing: the fist up over the shoulder, the paddle swung out behind him (60 degrees from hanging), the chest
// opening back
const SWING = { spine: [-2, -2, 0], chest: [-3, 0, 0], neck: [0, 4, -6], head: [-2, 8, -8] };
const swingR = () => P(-0.36, 1.6, -0.1, { pole: [-1, 0.3, 0.3], fist: 1, wrist: [-51.4, 24, 1.2] });
// overhead, the paddle straight up (the half turn done), about to sweep round
const overR = () => P(-0.5, 1.45, -0.02, { pole: [-1, -0.2, -0.6], fist: 1, wrist: [-40, 0, 0] });
const GUARD = {
  h: [0, -0.1, 0], hips: [4, -20, 0], spine: [4, -10, 0], chest: [2, -6, 0], neck: [-2, 8, 0], head: [-2, 10, 0],
  lf: { p: [0.24, 0, 0.32], pole: [0.3, 0, 1], yaw: -12 }, rf: { p: [-0.22, 0, -0.3], yaw: 25 },
  rh: P(-0.12, 0.84, 0.5, { pole: [-1, -1, 0], ...FAN }), lh: P(0.12, 1.04, 0.3, { pole: [1, -1, 0], open: 0.6 }),
};
// the spin: the arm out in front and to the right, the fan standing up at the end of it; knees bent, feet just off
// the ground, the body leaning into the turn
const SPIN = {
  h: [0, -0.04, 0], hips: [6, -10, 0], spine: [6, -6, -4], chest: [3, -4, -3], neck: [-4, 6, 0], head: [-4, 6, 0],
  lf: { p: [0.2, 0.06, 0.12], pole: [0.3, 0, 1], pitch: 10 }, rf: { p: [-0.2, 0.08, -0.12], pole: [0, 0, 1], pitch: 14 },
  rh: P(-0.36, 1.2, 0.5, { pole: [-1, -1, 0], ...FAN }), lh: P(0.3, 1.1, 0.12, { pole: [1, -1, -0.3], open: 0.7 }),
};
const counter = {
  keys: [
    [0, {}],
    [5, BACK, 'out'],
    // torn off the back: the paddle swings out behind him and up, the torso unwinding
    [9, { ...BACK, hips: [0, -6, 0], ...SWING, rh: swingR() }, 'in'],
    // (eases matched so the paddle's turn runs on at ~30 degrees a frame from here into the spin: no hitch at a key)
    [12, { ...SPIN, rot: 0, hips: [-2, -4, 0], spine: [-4, 0, 0], chest: [-4, 0, 0], rh: overR() }, 'lin'],
    // one full turn to his left (keys <= 90 degrees apart: nlerp takes the short way, gotcha 41)
    [16, { ...SPIN, rot: 70 }, 'lin'],
    [20, { ...SPIN, rot: 160, h: [0, -0.02, 0] }, 'lin'],
    [24, { ...SPIN, rot: 250 }, 'lin'],
    [28, { ...SPIN, rot: 330, h: [0, -0.06, 0] }, 'lin'],
    // planted: a stamp down into the guard, then it settles
    [31, { ...GUARD, rot: 360, h: [0, -0.16, 0.02], rh: P(-0.12, 0.82, 0.54, { pole: [-1, -1, 0], ...FAN }) }, 'out'],
    [38, { ...GUARD, rot: 360 }, 'io'],
    [55, { ...GUARD, rot: 360, h: [0, -0.11, 0], rh: P(-0.12, 0.85, 0.51, { pole: [-1, -1, 0], ...FAN }) }, 'io'],
    [72, { ...GUARD, rot: 360 }, 'io'],
    // back on his back: up over his head, the paddle swung down behind him, the fist back at the shoulder
    [76, { ...BACK, rot: 360, hips: [0, -6, 0], spine: [-4, 0, 0], chest: [-4, 0, 0], neck: [-4, 6, 0], head: [-4, 6, 0], rh: overR() }, 'io'],
    [79, { ...BACK, rot: 360, hips: [0, -6, 0], ...SWING, rh: swingR() }, 'in'],
    [82, { ...BACK, rot: 360 }, 'out'],
    [84, { ...BACK, rot: 360 }, 'hold'],
    [90, { rot: 360 }, 'io'],
  ],
};

// Tengai Shinsei (45 f): the right arm rises to the sky, palm open, eyes up, the left hand's seal at the chest
// (0-12, held to 28); at 30 the arm sweeps down at the target (the release), then he lowers it
const SKY = {
  h: [0, -0.04, -0.03], hips: [-3, -12, 0], spine: [-7, -4, 0], chest: [-6, -2, 0], upperChest: [-3, 0, 0], neck: [-12, 0, 0], head: [-20, 0, 0],
  ...ROOT, lh: sealL(1.18, 0.3), rh: P(-0.22, 2.1, 0.08, { pole: [-1, 0.2, -1], open: 1, spread: 8, wrist: [0, 0, -20] }),
};
const meteor = {
  keys: [
    [0, {}],
    [12, SKY, 'out'],
    [28, { ...SKY, h: [0, -0.03, -0.04], rh: P(-0.22, 2.14, 0.06, { pole: [-1, 0.2, -1], open: 1, spread: 10, wrist: [0, 0, -20] }) }, 'io'],
    [33, { ...SKY, hips: [6, -8, 0], spine: [8, -2, 0], chest: [4, 0, 0], neck: [-8, 0, 0], head: [-6, 0, 0], rh: P(-0.2, 1.42, 0.6, { pole: [-1, -0.4, 0], open: 1, spread: 6 }) }, 'snap'],
    [45, {}, 'io'],
  ],
};

// Sharingan Genjutsu (40 f): the head lowers, the eyes in shadow, the right hand rising to a half seal before the chest
// plate (0-10); at 16 the head snaps up and his Eternal Mangekyō meets their eyes (the gaze), held (16-32), let go
const CALM = { lf: { p: [0.15, 0, 0.12], pole: [0.2, 0, 1], yaw: -8 }, rf: { p: [-0.16, 0, -0.14], yaw: 18 } };
const HALF = (y, z) => P(-0.04, y, z, { pole: [-1, -0.6, 0], wrist: [0, 50, -70], fingers: [0, 0, 1, 1], thumb: 0.7 });
const LOW = {
  h: [0, -0.03, 0], hips: [0, 6, 0], spine: [3, 0, 0], chest: [2, 0, 0], neck: [11, 0, 0], head: [17, 0, 0], ...CALM,
  rh: HALF(1.17, 0.31), lh: P(0.21, 0.84, 0.05, { pole: [1, 0.2, -0.4], open: 0.35 }),
};
const GAZE = { ...LOW, h: [0, -0.02, 0.01], spine: [-2, 0, 0], chest: [-3, 0, 0], neck: [-5, 0, 0], head: [-6, 0, 0], rh: HALF(1.21, 0.32) };
const genjutsu = {
  keys: [
    [0, {}],
    [10, LOW, 'io'],
    [13, { ...LOW, neck: [13, 0, 0], head: [19, 0, 0] }, 'io'],
    [16, GAZE, 'snap'],
    [22, { ...GAZE, h: [0, -0.025, 0.02], head: [-8, 0, 0] }, 'out'],
    [32, { ...GAZE, h: [0, -0.03, 0.01] }, 'io'],
    [40, {}, 'io'],
  ],
};
// Inside his genjutsu (its victim's own screen, madaravision.js): the stand-in Madara the camera films up close, the
// chin down and the eyes up at the victim through his bangs, breathing, dead still otherwise (a 3 s loop)
const STARE = { h: [0, -0.02, 0], hips: [0, 4, 0], spine: [2, 0, 0], chest: [1, 0, 0], neck: [6, 0, 0], head: [9, -3, 2], ...CALM,
  lh: P(0.22, 0.83, 0.05, { pole: [1, 0.2, -0.4], open: 0.3 }), rh: P(-0.22, 0.83, 0.05, { pole: [-1, 0.2, -0.4], open: 0.3 }) };
const stare = {
  loop: true,
  base: STARE,
  keys: [
    [0, {}],
    [90, { h: [0, -0.012, 0.004], chest: [0, 0, 0], upperChest: [-1.5, 0, 0], head: [10, -3, 2] }, 'io'],
    [180, {}, 'io'],
  ],
};

/** The same upper-body keys hanging in the air: legs tucked, the body pitched so the torrent angles down. */
function airVariant(def, pitch) {
  const AIR = { h: [0, 0.05, 0], lf: { p: [0.12, 0.3, 0.2], pole: [0, 0.3, 1], pitch: 20 }, rf: { p: [-0.12, 0.18, -0.15], pole: [0, 0.3, 1], pitch: 30 } };
  return {
    base: AIR,
    keys: def.keys.map(([f, s, e]) => {
      if (!Object.keys(s).length) return [f, s, e];
      const o = { ...s, lf: AIR.lf, rf: AIR.rf, h: [0, 0.05, 0] };
      // the head carries the pitch (the mouth aims down), the spine a little of it
      if (f >= 26) {
        o.neck = [(s.neck?.[0] || 0) + pitch * 0.5, s.neck?.[1] || 0, 0];
        o.head = [(s.head?.[0] || 0) + pitch * 0.5, s.head?.[1] || 0, 0];
      }
      return [f, o, e];
    }),
  };
}

export const MADARA_CLIPS = {
  mad_fire: fire,
  mad_fire_air: airVariant(fire, 26),
  mad_wood: wood,
  mad_wood_dive: woodDive,
  mad_counter: counter,
  mad_counter_air: airVariant(counter, 0),
  mad_meteor: meteor,
  mad_meteor_air: airVariant(meteor, 0),
  mad_genjutsu: genjutsu,
  mad_genjutsu_air: airVariant(genjutsu, 0),
  mgj_stare: stare,
};
