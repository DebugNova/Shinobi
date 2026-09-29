// Itachi's M1 clips (keyframes.js format, baked per body with every other keyed move: bakeMoves), laid on the frame
// data in src/shared/itachi.js ITACHI_MOVES: a move's contact key is its first active frame. Paced to be read: a wind-up
// that shows where the strike comes from, the strike on a snap ease, a held follow-through, a settle back to the stance.
// Fighter frame: +z forward, +x his LEFT, y up, reference-body metres; hand targets are wrists placed from the
// shoulders (gotchas 34, 52). `rot` turns the whole pose (limb targets turn with it); `tilt`/`roll` pivot the body at
// the hips only, so flipped limbs are written in the body's frame (FF, FH).
const P = (x, y, z, o = {}) => ({ p: [x, y, z], ...o });

// the kunai at the ready (right fist low at the side, the blade out past the thumb)
const KR = P(-0.2, 1.06, 0.2, { fist: 1, pole: [-1, -0.6, -0.2] });
// in the air: legs tucked under (the root is the body's feet point while airborne)
const AIRL = {
  h: [0, 0.05, 0],
  lf: { p: [0.12, 0.3, 0.2], pole: [0, 0.3, 1], pitch: 20 },
  rf: { p: [-0.12, 0.18, -0.15], pole: [0, 0.3, 1], pitch: 30 },
};
// the body bursting into crows (the frame before he vanishes: movefx.js MOVE_FX `hide`)
const BURST = {
  h: [0, 0.02, -0.03], hips: [-4, 0, 0], spine: [-8, 0, 0], chest: [-8, 0, 0], neck: [-6, 0, 0], head: [-10, 0, 0],
  lh: P(0.6, 1.36, 0.08, { pole: [0, -1, -0.4], open: 1, spread: 10 }), rh: P(-0.6, 1.36, 0.08, { pole: [0, -1, -0.4], open: 1, spread: 10 }),
};
// kneeling where he landed from a dive, the right fist driven into the ground (the dust cloud: movefx `slam`)
const KNEEL = {
  h: [0, -0.5, 0.1], hips: [22, 0, 0], spine: [20, 0, 0], chest: [10, 0, 0], neck: [-22, 0, 0], head: [-10, 0, 0],
  lf: { p: [0.17, 0, 0.36] }, rf: { p: [-0.15, 0, -0.34], pitch: 70 },
  rh: P(-0.1, 0.3, 0.56, { fist: 1, pole: [-1, 1, 0] }), lh: P(0.46, 0.74, 0.02, { open: 1, pole: [1, 0, -0.4] }),
};

// flips: limb targets in the body frame of a pose turned forward by `tilt` degrees about its hips (x his left, y up
// the spine, z out of the chest; h = the key's hips offset): FF an ankle there (the spec's contact point is 0.1 m under
// it; the foot pitches with the body), FH a wrist there
const HIPS_Y = 0.9;
const flipV = (tilt, x, y, z) => {
  const a = (tilt * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [x, y * c - z * s, y * s + z * c];
};
const flipP = (tilt, h, x, y, z) => {
  const v = flipV(tilt, x, y, z);
  return [h[0] + v[0], HIPS_Y + h[1] + v[1], h[2] + v[2]];
};
const FF = (tilt, h, x, y, z, o = {}) => {
  const p = flipP(tilt, h, x, y, z);
  p[1] -= 0.1;
  return { ...o, p, pole: flipV(tilt, ...(o.pole || [0, 0.3, 1])), pitch: (o.pitch || 0) + tilt };
};
const FH = (tilt, h, x, y, z, o = {}) => ({ ...o, p: flipP(tilt, h, x, y, z), pole: flipV(tilt, ...(o.pole || [x > 0 ? 1 : -1, -0.6, 0])) });
/** A whole flipped key: body angles + tucked or extended limbs from body-frame points. */
const flip = (tilt, h, { lf, rf, lh, rh, ...rest }) => ({
  tilt, h, ...rest,
  lf: FF(tilt, h, ...lf), rf: FF(tilt, h, ...rf), lh: FH(tilt, h, ...lh), rh: FH(tilt, h, ...rh),
});

// ------------------------------------------------------------------ Uchiha Taijutsu (standing string)

// I1 Uchiha Backfist (11/4/16): the torso winds left with the right fist folded to the left shoulder while the lead
// foot slides in, then unwinds: the back of the fist whips out at head height and on across (the follow-through)
const backhand = {
  keys: [
    [0, {}],
    [5, { h: [0, -0.12, 0], hips: [6, 20, 0], spine: [6, 12, 0], chest: [4, 14, 0], neck: [-6, -18, 0], head: [-4, -16, 0], rh: P(0.2, 1.36, 0.22, { fist: 1, pole: [-0.3, -0.5, 1] }), lh: P(0.2, 1.2, 0.34, { open: 0.4, pole: [1, -1, 0] }), lf: { p: [0.16, 0.07, 0.32], pitch: -6, yaw: -10 }, rf: { p: [-0.17, 0, -0.22], yaw: 22 } }, 'out'],
    [9, { h: [0, -0.16, 0.08], hips: [8, 2, 0], spine: [6, 4, 0], chest: [4, 2, 0], neck: [-6, 0, 0], head: [-4, 0, 0], rh: P(0.1, 1.4, 0.5, { fist: 1, pole: [-0.6, -0.3, 1] }), lh: P(0.22, 1.15, 0.2, { open: 0.4, pole: [1, -1, 0] }), lf: { p: [0.17, 0, 0.46], yaw: -10 }, rf: { p: [-0.18, 0.02, -0.28], pitch: 22, yaw: 25 } }, 'in'],
    [11, { h: [0, -0.18, 0.12], hips: [8, -12, 0], spine: [6, -6, 0], chest: [4, -8, 0], upperChest: [0, -4, 0], neck: [-8, 14, 0], head: [-6, 12, 0], rh: P(-0.1, 1.4, 0.74, { fist: 1, pole: [-1, -0.3, 0.3] }), lh: P(0.28, 1.08, 0.02, { open: 0.3, pole: [1, -1, 0] }), lf: { p: [0.17, 0, 0.48], yaw: -10 }, rf: { p: [-0.19, 0, -0.32], pitch: 32, yaw: 28 } }, 'snap'],
    [15, { h: [0, -0.18, 0.12], hips: [8, -26, 0], spine: [6, -12, 0], chest: [4, -16, 0], upperChest: [0, -6, 0], neck: [-8, 24, 0], head: [-6, 20, 0], rh: P(-0.36, 1.38, 0.6, { fist: 1, pole: [-1, -0.3, 0.1] }), lh: P(0.28, 1.08, 0.02, { open: 0.3, pole: [1, -1, 0] }), lf: { p: [0.17, 0, 0.48], yaw: -10 }, rf: { p: [-0.19, 0, -0.32], pitch: 32, yaw: 28 } }, 'lin'],
    [21, { h: [0, -0.13, 0.06], hips: [6, -24, 0], spine: [5, -4, 0], chest: [4, -6, 0], neck: [-6, 12, 0], head: [-5, 10, 0], rh: P(-0.2, 1.24, 0.32, { fist: 1, pole: [-1, -1, 0] }), lh: P(0.15, 1.26, 0.32, { fist: 0.8 }), lf: { p: [0.17, 0, 0.42] }, rf: { p: [-0.17, 0.05, -0.3], pitch: 14, yaw: 25 } }, 'out'],
    [31, { lf: { p: [0.16, 0, 0.28] } }, 'io'],
  ],
};

// I2 Spinning Heel (13/5/17): he keeps turning the way the backfist went: a pivot on the right foot, the head whips
// round first to find the target, the left leg chambers and the heel hooks across at head height, the coat swinging
const spinheel = {
  keys: [
    [0, {}],
    [5, { rot: -70, h: [0, -0.12, 0.02], hips: [6, 0, 0], spine: [6, 0, 0], neck: [0, 30, 0], head: [0, 26, 0], lf: { p: [0.14, 0.1, 0.02], pitch: 20 }, rf: { p: [-0.08, 0, 0.04] }, lh: P(0.2, 1.25, 0.25, { fist: 0.8 }), rh: P(-0.18, 1.2, 0.2, { fist: 0.8 }) }, 'in'],
    [9, { rot: -140, h: [0, -0.05, 0], spine: [14, 0, 0], chest: [6, 0, 0], neck: [-10, -24, 0], head: [-6, -22, 0], lf: { p: [0.16, 0.62, -0.28], pole: [0, 0.3, -1], pitch: 30 }, rf: { p: [-0.05, 0, 0.06], pitch: 8 }, lh: P(0.25, 1.2, 0.3, { fist: 0.8 }), rh: P(-0.25, 1.2, 0.15, { fist: 0.8 }) }, 'lin'],
    [13, { rot: -178, h: [0, -0.02, 0], spine: [24, 0, 0], chest: [10, 0, 0], neck: [-22, -30, 0], head: [-10, -20, 0], lf: { p: [0.08, 1.12, -0.8], pole: [0, 1, 0], pitch: -60 }, rf: { p: [-0.05, 0, 0.1], pitch: 10 }, lh: P(0.26, 1.18, 0.28), rh: P(-0.28, 1.16, 0.1) }, 'snap'],
    [18, { rot: -205, h: [0, -0.02, 0], spine: [24, 0, 0], chest: [10, 0, 0], neck: [-22, -30, 0], head: [-10, -20, 0], lf: { p: [-0.1, 1.08, -0.76], pole: [0, 1, 0], pitch: -60 }, rf: { p: [-0.05, 0, 0.1], pitch: 10 }, lh: P(0.26, 1.18, 0.28), rh: P(-0.28, 1.16, 0.1) }, 'lin'],
    [24, { rot: -290, h: [0, -0.1, 0], spine: [8, 0, 0], lf: { p: [0.14, 0.32, -0.08], pole: [0, 0.3, -1], pitch: 25 }, rf: { p: [-0.05, 0, 0.05] } }, 'io'],
    [35, { rot: -360 }, 'out'],
  ],
};

// I3 Kunai Draw (12/4/18): the right hand slips into the cloak at the left breast (the kunai: movefx), draws it in a
// long low lunge and cuts across at the waist, the left hand flung back for balance
const kunaidraw = {
  keys: [
    [0, {}],
    [4, { h: [0, -0.1, 0], hips: [4, 10, 0], spine: [4, 8, 0], chest: [4, 12, 0], neck: [-4, -10, 0], head: [-4, -8, 0], rh: P(0.1, 1.16, 0.22, { fist: 0.9, pole: [-0.5, -1, 0.5] }), lh: P(0.16, 1.24, 0.34, { open: 0.4 }) }, 'out'],
    [8, { h: [0, -0.26, 0.06], hips: [12, 22, 0], spine: [8, 10, 0], chest: [6, 14, 0], neck: [-10, -14, 0], head: [-8, -12, 0], rh: P(0.26, 1.06, 0.3, { fist: 1, pole: [-0.4, -1, 0.6] }), lh: P(0.1, 1.2, 0.36, { open: 0.5 }), lf: { p: [0.22, 0, 0.42], yaw: -10 }, rf: { p: [-0.2, 0, -0.3], pitch: 25, yaw: 30 } }, 'in'],
    [12, { h: [0, -0.36, 0.14], hips: [16, -28, 0], spine: [10, -12, 0], chest: [6, -14, 0], neck: [-14, 22, 0], head: [-10, 18, 0], rh: P(-0.22, 1.02, 0.62, { fist: 1, pole: [-1, -0.5, 0.3] }), lh: P(0.36, 0.98, -0.02, { open: 0.6, pole: [1, -0.5, -0.3] }), lf: { p: [0.26, 0, 0.5], yaw: -15 }, rf: { p: [-0.24, 0, -0.36], pitch: 40, yaw: 35 } }, 'snap'],
    [16, { h: [0, -0.36, 0.14], hips: [16, -40, 0], spine: [10, -16, 0], chest: [6, -18, 0], neck: [-14, 28, 0], head: [-10, 22, 0], rh: P(-0.44, 1.0, 0.42, { fist: 1, pole: [-1, -0.5, 0] }), lh: P(0.36, 0.98, -0.02, { open: 0.6, pole: [1, -0.5, -0.3] }), lf: { p: [0.26, 0, 0.5], yaw: -15 }, rf: { p: [-0.24, 0, -0.36], pitch: 40, yaw: 35 } }, 'lin'],
    [24, { h: [0, -0.24, 0.08], hips: [10, -24, 0], spine: [6, -6, 0], chest: [4, -6, 0], neck: [-8, 14, 0], head: [-6, 12, 0], rh: P(-0.3, 1.08, 0.3, { fist: 1, pole: [-1, -0.6, -0.2] }), lh: P(0.18, 1.18, 0.32, { open: 0.4 }), lf: { p: [0.2, 0, 0.42] }, rf: { p: [-0.2, 0.04, -0.32], pitch: 20, yaw: 28 } }, 'out'],
    [34, { rh: KR }, 'io'],
  ],
};

// I4 Rising Cut (11/4/18): the blade drops to the right hip in a crouch, then rises diagonally across the body to over
// the left shoulder, the body lifting with it onto the rear toes
const risingcut = {
  keys: [
    [0, { rh: KR }],
    [5, { h: [0, -0.28, 0.02], hips: [10, -35, 0], spine: [8, -14, 0], chest: [4, -16, 0], neck: [-8, 24, 0], head: [-6, 20, 0], rh: P(-0.34, 0.74, 0.12, { fist: 1, pole: [-1, 0.2, -0.3] }), lh: P(0.2, 1.2, 0.35, { open: 0.5 }), lf: { p: [0.18, 0, 0.34], yaw: -10 }, rf: { p: [-0.2, 0, -0.28], pitch: 15, yaw: 30 } }, 'out'],
    [9, { h: [0, -0.2, 0.08], hips: [8, -6, 0], spine: [4, -2, 0], chest: [2, -2, 0], neck: [-6, 6, 0], head: [-4, 6, 0], rh: P(-0.2, 0.96, 0.48, { fist: 1, pole: [-1, -0.2, 0] }), lh: P(0.24, 1.12, 0.2, { open: 0.5 }), lf: { p: [0.18, 0, 0.44], yaw: -8 }, rf: { p: [-0.18, 0.02, -0.32], pitch: 25, yaw: 30 } }, 'in'],
    [11, { h: [0, -0.1, 0.12], hips: [-4, 24, 0], spine: [-6, 12, 0], chest: [-4, 14, 0], neck: [-2, -20, 0], head: [-2, -16, 0], rh: P(0.02, 1.3, 0.7, { fist: 1, pole: [-1, -0.4, 0.2] }), lh: P(0.32, 1.0, -0.05, { open: 0.6 }), lf: { p: [0.18, 0, 0.46], yaw: -5 }, rf: { p: [-0.18, 0.05, -0.36], pitch: 40, yaw: 30 } }, 'snap'],
    [15, { h: [0, -0.06, 0.12], hips: [-6, 32, 0], spine: [-10, 16, 0], chest: [-6, 16, 0], neck: [0, -24, 0], head: [0, -20, 0], rh: P(0.2, 1.6, 0.46, { fist: 1, pole: [-1, 0, 0.3] }), lh: P(0.32, 1.0, -0.05, { open: 0.6 }), lf: { p: [0.18, 0, 0.46], yaw: -5 }, rf: { p: [-0.18, 0.08, -0.36], pitch: 45, yaw: 30 } }, 'lin'],
    [22, { h: [0, -0.12, 0.06], hips: [0, 16, 0], spine: [-2, 8, 0], neck: [-4, -12, 0], head: [-4, -10, 0], rh: P(0.02, 1.38, 0.3, { fist: 1, pole: [-1, -0.4, 0] }), lh: P(0.2, 1.15, 0.28, { open: 0.4 }), lf: { p: [0.17, 0, 0.4] }, rf: { p: [-0.17, 0.02, -0.3], pitch: 15, yaw: 25 } }, 'out'],
    [33, { rh: KR }, 'io'],
  ],
};

// I5 Chakra Palm Launch (14/4/22, leaps at 18): the kunai goes (a glint), he sinks low with the left palm forward and
// the right palm cocked at the hip, then drives it up under the chin onto his toes (the chakra sphere bursts on the
// hit); he leaps after the victim, arms flung wide, and tucks
const palmrise = {
  keys: [
    [0, { rh: KR }],
    [6, { h: [0, -0.34, 0.02], hips: [16, -30, 0], spine: [14, -10, 0], chest: [6, -10, 0], neck: [-16, 20, 0], head: [-10, 16, 0], rh: P(-0.26, 0.84, 0.04, { open: 1, pole: [-1, 0.2, -0.6], wrist: [-40, 0, 0] }), lh: P(0.18, 1.12, 0.45, { open: 0.8, pole: [1, -1, 0] }), lf: { p: [0.2, 0, 0.4], yaw: -12 }, rf: { p: [-0.2, 0, -0.3], pitch: 20, yaw: 30 } }, 'out'],
    [11, { h: [0, -0.3, 0.08], hips: [12, -6, 0], spine: [8, -4, 0], chest: [4, -4, 0], neck: [-10, 8, 0], head: [-8, 6, 0], rh: P(-0.14, 0.98, 0.4, { open: 1, pole: [-1, -0.2, -0.3], wrist: [-45, 0, 0] }), lh: P(0.24, 1.08, 0.3, { open: 0.7, pole: [1, -1, 0] }), lf: { p: [0.2, 0, 0.44], yaw: -10 }, rf: { p: [-0.2, 0, -0.32], pitch: 25, yaw: 30 } }, 'in'],
    [14, { h: [0, -0.02, 0.14], hips: [-8, 20, 0], spine: [-10, 10, 0], chest: [-8, 12, 0], neck: [4, -14, 0], head: [2, -12, 0], rh: P(-0.02, 1.52, 0.64, { open: 1, spread: 8, pole: [-1, -0.6, 0], wrist: [-50, 0, 0] }), lh: P(0.3, 1.0, 0.0, { open: 0.5 }), lf: { p: [0.18, 0, 0.48], pitch: 30 }, rf: { p: [-0.18, 0.1, -0.34], pitch: 50 } }, 'snap'],
    [18, { h: [0, 0, 0.14], hips: [-8, 20, 0], spine: [-10, 10, 0], chest: [-8, 12, 0], neck: [4, -14, 0], head: [2, -12, 0], rh: P(0, 1.58, 0.6, { open: 1, spread: 8, pole: [-1, -0.6, 0], wrist: [-50, 0, 0] }), lh: P(0.3, 1.0, 0.0, { open: 0.5 }), lf: { p: [0.18, 0.02, 0.48], pitch: 40 }, rf: { p: [-0.18, 0.12, -0.34], pitch: 55 } }, 'lin'],
    [25, { h: [0, 0.05, 0], hips: [-6, 0, 0], spine: [-10, 0, 0], chest: [-8, 0, 0], neck: [8, 0, 0], head: [6, 0, 0], lh: P(0.64, 1.44, 0.1, { open: 1, spread: 10, pole: [0, -1, -0.4] }), rh: P(-0.64, 1.44, 0.1, { open: 1, spread: 10, pole: [0, -1, -0.4] }), lf: { p: [0.2, 0.22, 0.26], pole: [0.3, 0.3, 1], pitch: 25 }, rf: { p: [-0.2, 0.16, -0.22], pole: [0, 0.3, 1], pitch: 35 } }, 'out'],
    [40, { ...AIRL, lh: P(0.46, 1.3, 0.16, { open: 0.8, pole: [0.4, -1, -0.4] }), rh: P(-0.46, 1.3, 0.16, { open: 0.8, pole: [-0.4, -1, -0.4] }) }, 'io'],
  ],
};

// I6 Crow Descent (20/5/28, in the air; crows 3-11, dive at 25, lands at 34): the arms fling out and he is crows;
// he re-forms above the victim with the right leg raised straight overhead, the heel chops down through it, he drops
// to the ground and lands kneeling with the fist in the dirt
const RAISED = {
  h: [0, 0.05, -0.04], hips: [-14, -10, 0], spine: [-12, 0, 0], chest: [-6, 0, 0], neck: [10, 0, 0], head: [6, 0, 0],
  rf: { p: [-0.02, 1.6, 0.38], pole: [0, 1, 0.4], pitch: -45 }, lf: { p: [0.12, 0.25, 0.05], pole: [0, 0.3, 1], pitch: 30 },
  lh: P(0.34, 1.4, 0.1, { open: 0.5 }), rh: P(-0.34, 1.42, 0.05, { open: 0.5 }),
};
const CHOP = {
  h: [0, -0.1, 0.12], hips: [20, -6, 0], spine: [18, 0, 0], chest: [10, 0, 0], neck: [-20, 0, 0], head: [-8, 0, 0],
  rf: { p: [-0.02, 0.35, 0.72], pole: [0, 0.3, 1], pitch: 30 }, lf: { p: [0.12, 0.2, -0.1], pole: [0, 0.3, 1], pitch: 30 },
  lh: P(0.26, 1.0, 0.22, { fist: 0.8 }), rh: P(-0.26, 1.0, 0.16, { fist: 0.8 }),
};
const FALL = {
  h: [0, 0.02, 0.04], hips: [10, 0, 0], spine: [8, 0, 0], neck: [-8, 0, 0],
  lf: { p: [0.15, 0.15, 0.28], pole: [0, 0.3, 1], pitch: 10 }, rf: { p: [-0.15, 0.2, -0.2], pole: [0, 0.3, 1], pitch: 30 },
  lh: P(0.42, 1.3, 0.1, { open: 0.6 }), rh: P(-0.42, 1.3, 0.05, { open: 0.6 }),
};
const crowdrop = {
  keys: [
    [0, { ...AIRL, lh: P(0.46, 1.3, 0.16, { open: 0.8, pole: [0.4, -1, -0.4] }), rh: P(-0.46, 1.3, 0.16, { open: 0.8, pole: [-0.4, -1, -0.4] }) }],
    [3, { ...AIRL, ...BURST }, 'snap'],
    [4, RAISED, 'lin'],
    [11, RAISED],
    [16, { ...RAISED, hips: [-18, -10, 0], spine: [-14, 0, 0], rf: { p: [-0.02, 1.72, 0.5], pole: [0, 1, 0.4], pitch: -40 }, lh: P(0.36, 1.5, 0.05, { open: 0.5 }), rh: P(-0.36, 1.52, 0.0, { open: 0.5 }) }, 'io'],
    [20, CHOP, 'snap'],
    [25, { ...CHOP, rf: { p: [-0.02, 0.12, 0.62], pole: [0, 0.3, 1], pitch: 30 } }, 'lin'],
    [29, FALL, 'io'],
    [34, { ...FALL, h: [0, 0, 0.05] }],
    [37, KNEEL, 'snap'],
    [44, { ...KNEEL, h: [0, -0.48, 0.1], rh: P(-0.12, 0.34, 0.52, { fist: 1, pole: [-1, 1, 0] }) }],
    [53, {}, 'io'],
  ],
};

// ------------------------------------------------------------------ Crow Rush (the string on the move)

// R1 Flying Side Kick (12/5/16): out of the run he springs off the left foot, the body turns side-on in the air, the
// right knee chambers and the leg shoots out at the target (the travel carries him ~4 m), then a skidding landing
const flykick = {
  keys: [
    [0, {}],
    [4, { rot: 20, h: [0, -0.2, 0.05], hips: [12, -10, 0], spine: [10, 0, 0], lf: { p: [0.15, 0, 0.3], pitch: 10 }, rf: { p: [-0.14, 0.1, -0.3], pitch: 40 }, lh: P(0.2, 1.22, 0.3, { fist: 0.8 }), rh: P(-0.2, 1.12, 0.12, { fist: 0.8 }) }, 'out'],
    [8, { rot: 70, h: [0, 0.3, 0], hips: [0, 0, -6], spine: [2, 0, -6], neck: [-4, -34, 0], head: [-4, -30, 0], rf: { p: [-0.36, 0.82, 0.08], pole: [-1, 0.6, 0], pitch: 10 }, lf: { p: [0.1, 0.5, 0.12], pole: [0, 0.3, 1], pitch: 30 }, lh: P(0.1, 1.36, 0.26, { fist: 1 }), rh: P(-0.12, 1.3, 0.28, { fist: 1 }) }, 'in'],
    [12, { rot: 80, h: [0, 0.42, 0], hips: [0, 0, -12], spine: [0, 0, -12], chest: [0, 0, -4], neck: [-4, -38, 6], head: [-4, -34, 6], rf: { p: [-0.8, 1.08, 0.05], pole: [0, 1, 0.2], pitch: -10, yaw: -70 }, lf: { p: [0.1, 0.55, 0.12], pole: [0, 0.3, 1], pitch: 30 }, lh: P(0.08, 1.4, 0.24, { fist: 1 }), rh: P(0.1, 1.1, -0.26, { fist: 1, pole: [-1, -0.5, -0.5] }) }, 'snap'],
    [17, { rot: 80, h: [0, 0.38, 0], hips: [0, 0, -12], spine: [0, 0, -12], chest: [0, 0, -4], neck: [-4, -38, 6], head: [-4, -34, 6], rf: { p: [-0.76, 1.04, 0.05], pole: [0, 1, 0.2], pitch: -10, yaw: -70 }, lf: { p: [0.1, 0.5, 0.12], pole: [0, 0.3, 1], pitch: 30 }, lh: P(0.08, 1.4, 0.24, { fist: 1 }), rh: P(0.1, 1.1, -0.26, { fist: 1, pole: [-1, -0.5, -0.5] }) }, 'lin'],
    [23, { rot: 30, h: [0, -0.14, 0.05], hips: [8, -10, 0], spine: [6, 0, 0], neck: [-4, -10, 0], head: [-4, -8, 0], lf: { p: [0.16, 0, 0.25] }, rf: { p: [-0.18, 0, -0.2], pitch: 20 }, lh: P(0.16, 1.26, 0.3, { fist: 0.9 }), rh: P(-0.1, 1.2, 0.2, { fist: 0.9 }) }, 'out'],
    [33, {}, 'io'],
  ],
};

// R2 Aerial Hook Kick (13/5/17): a jumping spin (both feet leave the ground), the body laid over sideways as the left
// heel sweeps round at head height (the inverted-looking kick of the reference), landing through the turn
const airhook = {
  keys: [
    [0, {}],
    [4, { rot: -80, h: [0, -0.18, 0], hips: [8, 0, 0], neck: [0, 30, 0], head: [0, 26, 0], lf: { p: [0.15, 0, 0.15] }, rf: { p: [-0.1, 0.1, -0.2], pitch: 20 }, lh: P(0.2, 1.2, 0.26, { fist: 0.8 }), rh: P(-0.2, 1.15, 0.2, { fist: 0.8 }) }, 'in'],
    [9, { rot: -150, h: [0, 0.3, 0], roll: -15, neck: [-10, -24, 0], head: [-6, -22, 0], lf: { p: [0.18, 0.62, -0.12], pole: [0, 0.3, -1], pitch: 25 }, rf: { p: [-0.12, 0.3, 0.05], pitch: 30 }, lh: P(0.34, 1.3, 0.1, { open: 0.4 }), rh: P(-0.3, 1.3, 0.1, { open: 0.4 }) }, 'lin'],
    [13, { rot: -183, h: [0, 0.42, 0], roll: -34, spine: [10, 0, 0], neck: [-20, -30, 0], head: [-8, -20, 0], lf: { p: [0.12, 1.2, -0.78], pole: [0, 1, 0], pitch: -50 }, rf: { p: [-0.1, 0.35, 0.1], pole: [0, 0.3, 1], pitch: 30 }, lh: P(0.3, 1.1, 0.25, { open: 0.4 }), rh: P(-0.36, 1.2, 0.05, { open: 0.5 }) }, 'snap'],
    [18, { rot: -210, h: [0, 0.36, 0], roll: -30, spine: [10, 0, 0], neck: [-20, -30, 0], head: [-8, -20, 0], lf: { p: [-0.12, 1.14, -0.74], pole: [0, 1, 0], pitch: -50 }, rf: { p: [-0.1, 0.32, 0.1], pole: [0, 0.3, 1], pitch: 30 }, lh: P(0.3, 1.1, 0.25, { open: 0.4 }), rh: P(-0.36, 1.2, 0.05, { open: 0.5 }) }, 'lin'],
    [24, { rot: -300, h: [0, -0.12, 0], spine: [8, 0, 0], neck: [0, 0, 0], head: [0, 0, 0], lf: { p: [0.15, 0.1, -0.05], pitch: 10 }, rf: { p: [-0.14, 0, 0.05] }, lh: P(0.2, 1.2, 0.28, { fist: 0.8 }), rh: P(-0.16, 1.16, 0.22, { fist: 0.8 }) }, 'io'],
    [35, { rot: -360 }, 'out'],
  ],
};

// R3 Kunai Crescent Draw (11/4/17): the kunai comes out of the cloak over the left shoulder and cuts down diagonally
// across the target to the right hip in a lunge
const crossslash = {
  keys: [
    [0, {}],
    [3, { h: [0, -0.06, 0], hips: [2, 10, 0], chest: [2, 14, 0], rh: P(0.12, 1.3, 0.2, { fist: 0.9, pole: [-0.4, -0.8, 0.6] }), lh: P(0.16, 1.24, 0.34, { open: 0.4 }) }, 'out'],
    [7, { h: [0, -0.08, 0.02], hips: [0, 25, 0], spine: [-6, 14, 0], chest: [-6, 16, 0], neck: [0, -20, 0], head: [0, -16, 0], rh: P(0.22, 1.64, 0.14, { fist: 1, pole: [-1, 0.4, -0.3] }), lh: P(0.2, 1.15, 0.35, { open: 0.5 }), lf: { p: [0.17, 0.05, 0.36], pitch: -5 }, rf: { p: [-0.17, 0, -0.24], yaw: 25 } }, 'in'],
    [11, { h: [0, -0.22, 0.12], hips: [14, -24, 0], spine: [14, -10, 0], chest: [8, -14, 0], neck: [-14, 20, 0], head: [-10, 16, 0], rh: P(-0.08, 1.18, 0.72, { fist: 1, pole: [-1, -0.3, 0] }), lh: P(0.32, 1.0, -0.05, { open: 0.6 }), lf: { p: [0.2, 0, 0.5] }, rf: { p: [-0.2, 0, -0.38], pitch: 40, yaw: 30 } }, 'snap'],
    [15, { h: [0, -0.26, 0.12], hips: [16, -34, 0], spine: [16, -14, 0], chest: [8, -16, 0], neck: [-14, 24, 0], head: [-10, 20, 0], rh: P(-0.36, 0.9, 0.5, { fist: 1, pole: [-1, -0.3, 0] }), lh: P(0.32, 1.0, -0.05, { open: 0.6 }), lf: { p: [0.2, 0, 0.5] }, rf: { p: [-0.2, 0, -0.38], pitch: 40, yaw: 30 } }, 'lin'],
    [22, { h: [0, -0.16, 0.08], hips: [8, -20, 0], spine: [6, -4, 0], chest: [4, -6, 0], neck: [-6, 10, 0], head: [-5, 8, 0], rh: P(-0.26, 1.04, 0.3, { fist: 1, pole: [-1, -0.6, -0.2] }), lh: P(0.18, 1.18, 0.3, { open: 0.4 }), lf: { p: [0.18, 0, 0.42] }, rf: { p: [-0.18, 0.04, -0.3], pitch: 18, yaw: 28 } }, 'out'],
    [32, { rh: KR }, 'io'],
  ],
};

// R4 Crow Flank (18/4/16; crows 3-11): the arms fling and he is crows; he re-forms crouched at the target's back
// (facing it), rises and turns a right elbow into it
const CROUCH = {
  h: [0, -0.36, 0.02], hips: [20, -24, 0], spine: [8, -6, 0], chest: [4, -6, 0], neck: [-10, 20, 0], head: [-8, 16, 0],
  lf: { p: [0.18, 0, 0.32], yaw: -10 }, rf: { p: [-0.18, 0.02, -0.3], pitch: 45, yaw: 25 },
  rh: P(-0.24, 0.92, 0.04, { fist: 1, pole: [-1, 0, -1] }), lh: P(0.22, 0.95, 0.38, { open: 0.6, pole: [1, -1, 0] }),
};
const crowflank = {
  keys: [
    [0, { rh: KR }],
    [3, { ...BURST, rh: P(-0.6, 1.36, 0.08, { pole: [0, -1, -0.4], fist: 1 }) }, 'snap'],
    [4, CROUCH, 'lin'],
    [11, CROUCH],
    [15, { h: [0, -0.24, 0.04], hips: [8, -40, 0], spine: [6, -14, 0], chest: [4, -20, 0], neck: [-8, 26, 0], head: [-6, 22, 0], rh: P(-0.3, 1.24, 0.0, { fist: 1, pole: [-1, 0.4, 0.3] }), lh: P(0.26, 1.2, 0.36, { open: 0.5 }), lf: { p: [0.18, 0, 0.38], yaw: -10 }, rf: { p: [-0.18, 0.02, -0.3], pitch: 25, yaw: 28 } }, 'in'],
    [18, { h: [0, -0.2, 0.12], hips: [8, 30, 0], spine: [8, 16, 0], chest: [6, 18, 0], neck: [-8, -26, 0], head: [-6, -22, 0], rh: P(0.14, 1.3, 0.34, { fist: 1, pole: [-0.2, 0, 1] }), lh: P(0.3, 1.15, 0.0, { open: 0.4 }), lf: { p: [0.18, 0, 0.46], yaw: -8 }, rf: { p: [-0.18, 0.04, -0.34], pitch: 35, yaw: 30 } }, 'snap'],
    [22, { h: [0, -0.2, 0.12], hips: [8, 38, 0], spine: [8, 20, 0], chest: [6, 20, 0], neck: [-8, -30, 0], head: [-6, -26, 0], rh: P(0.2, 1.3, 0.3, { fist: 1, pole: [-0.2, 0, 1] }), lh: P(0.3, 1.15, 0.0, { open: 0.4 }), lf: { p: [0.18, 0, 0.46], yaw: -8 }, rf: { p: [-0.18, 0.04, -0.34], pitch: 35, yaw: 30 } }, 'lin'],
    [29, { h: [0, -0.14, 0.06], hips: [6, 10, 0], spine: [4, 6, 0], neck: [-6, -6, 0], head: [-4, -6, 0], rh: P(-0.18, 1.14, 0.26, { fist: 1, pole: [-1, -0.6, -0.2] }), lh: P(0.16, 1.22, 0.3, { open: 0.4 }), lf: { p: [0.17, 0, 0.36] }, rf: { p: [-0.17, 0.02, -0.26], pitch: 12, yaw: 25 } }, 'out'],
    [38, { rh: KR }, 'io'],
  ],
};

// R5 Crimson Crescent (15/5/26): he coils to the right, then spins a full turn to the left low in his stance with the
// kunai arm straight out: the blade cuts a crimson circle through the target; he ends turned back to it, the kunai
// flicked down at his side, and puts it away
const crescent = {
  keys: [
    [0, { rh: KR }],
    [5, { rot: 110, h: [0, -0.24, 0], hips: [10, 0, 0], spine: [8, 0, 0], neck: [-4, -32, 0], head: [-4, -28, 0], rh: P(-0.3, 1.0, -0.12, { fist: 1, pole: [-1, 0, -1] }), lh: P(0.28, 1.12, 0.22, { open: 0.5 }), lf: { p: [0.22, 0, 0.18] }, rf: { p: [-0.2, 0, -0.18], pitch: 12 } }, 'in'],
    [10, { rot: 240, h: [0, -0.3, 0], hips: [8, -10, 0], spine: [6, -6, 0], neck: [-4, 24, 0], head: [-4, 22, 0], rh: P(-0.42, 1.16, 0.22, { fist: 1, pole: [-1, -0.2, -0.4] }), lh: P(0.32, 1.1, -0.05, { open: 0.6 }), lf: { p: [0.24, 0, 0.16] }, rf: { p: [-0.24, 0, -0.12], pitch: 15 } }, 'lin'],
    [15, { rot: 350, h: [0, -0.34, 0.08], hips: [12, -18, 0], spine: [8, -8, 0], chest: [4, -8, 0], neck: [-10, 16, 0], head: [-8, 14, 0], rh: P(-0.2, 1.22, 0.64, { fist: 1, pole: [-1, -0.4, 0.2] }), lh: P(0.36, 1.06, -0.12, { open: 0.6 }), lf: { p: [0.26, 0, 0.36], yaw: -10 }, rf: { p: [-0.24, 0, -0.3], pitch: 30, yaw: 30 } }, 'snap'],
    [20, { rot: 382, h: [0, -0.34, 0.08], hips: [12, -10, 0], spine: [8, 4, 0], chest: [4, 6, 0], neck: [-10, 0, 0], head: [-8, 0, 0], rh: P(0.24, 1.24, 0.52, { fist: 1, pole: [-0.6, -0.4, 0.6] }), lh: P(0.36, 1.06, -0.12, { open: 0.6 }), lf: { p: [0.26, 0, 0.36], yaw: -10 }, rf: { p: [-0.24, 0, -0.3], pitch: 30, yaw: 30 } }, 'lin'],
    [28, { rot: 394, h: [0, -0.3, 0.05], hips: [10, 6, 0], spine: [6, 10, 0], chest: [4, 10, 0], neck: [-8, -12, 0], head: [-6, -10, 0], rh: P(0.34, 1.16, 0.3, { fist: 1, pole: [-0.4, -0.6, 0.6] }), lh: P(0.34, 1.0, -0.1, { open: 0.5 }), lf: { p: [0.24, 0, 0.3] }, rf: { p: [-0.22, 0, -0.26], pitch: 20, yaw: 28 } }, 'out'],
    [40, { rot: 372, h: [0, -0.12, 0], hips: [4, -10, 0], neck: [-2, 0, 0], head: [-3, 0, 0], rh: P(-0.3, 0.9, 0.08, { fist: 1, pole: [-1, 0.2, -0.4] }), lh: P(0.24, 0.9, 0.08, { open: 0.35, pole: [1, 0.1, -0.3] }), lf: { p: [0.16, 0, 0.16] }, rf: { p: [-0.16, 0, -0.14], yaw: 18 } }, 'io'],
    [46, { rot: 360 }, 'io'],
  ],
};

// ------------------------------------------------------------------ Crow Heaven (the air string)

// IA1 Air Snap Kick (9/4/14)
const airsnap = {
  base: AIRL,
  keys: [
    [0, {}],
    [4, { hips: [6, 0, 0], rf: { p: [-0.08, 0.6, 0.25], pole: [0, 0.4, 1], pitch: 30 }, lh: P(0.18, 1.3, 0.3, { fist: 0.9 }), rh: P(-0.1, 1.25, 0.25, { fist: 0.9 }) }, 'out'],
    [9, { hips: [-12, -10, 0], spine: [-10, 0, 0], chest: [-4, 0, 0], neck: [10, 0, 0], rf: { p: [-0.06, 1.05, 0.78], pole: [0, 1, 0.2], pitch: -15 }, lf: { p: [0.12, 0.25, 0.0], pole: [0, 0.3, 1], pitch: 30 }, lh: P(0.3, 1.2, 0.1, { open: 0.4 }), rh: P(-0.3, 1.15, 0.0, { open: 0.4 }) }, 'snap'],
    [13, { hips: [-12, -10, 0], spine: [-10, 0, 0], chest: [-4, 0, 0], neck: [10, 0, 0], rf: { p: [-0.06, 1.02, 0.74], pole: [0, 1, 0.2], pitch: -15 }, lf: { p: [0.12, 0.25, 0.0], pole: [0, 0.3, 1], pitch: 30 }, lh: P(0.3, 1.2, 0.1, { open: 0.4 }), rh: P(-0.3, 1.15, 0.0, { open: 0.4 }) }, 'lin'],
    [27, {}, 'io'],
  ],
};

// IA2 Air Spin Slash (11/5/14): the kunai out of the cloak, a full turn with the arm straight out
const airslash = {
  base: AIRL,
  keys: [
    [0, { rh: P(0.1, 1.16, 0.22, { fist: 0.9, pole: [-0.5, -1, 0.5] }) }],
    [5, { rot: 120, neck: [-4, -32, 0], head: [-4, -28, 0], rh: P(-0.3, 1.04, -0.12, { fist: 1, pole: [-1, 0, -1] }), lh: P(0.26, 1.15, 0.2, { open: 0.5 }) }, 'in'],
    [9, { rot: 250, neck: [-4, 24, 0], head: [-4, 22, 0], rh: P(-0.42, 1.2, 0.22, { fist: 1, pole: [-1, -0.2, -0.4] }), lh: P(0.32, 1.15, -0.05, { open: 0.6 }) }, 'lin'],
    [11, { rot: 350, hips: [8, -16, 0], spine: [6, -8, 0], neck: [-6, 14, 0], head: [-6, 12, 0], rh: P(-0.2, 1.26, 0.64, { fist: 1, pole: [-1, -0.4, 0.2] }), lh: P(0.34, 1.1, -0.12, { open: 0.6 }) }, 'snap'],
    [16, { rot: 382, hips: [8, -6, 0], spine: [6, 4, 0], neck: [-6, 0, 0], head: [-6, 0, 0], rh: P(0.24, 1.26, 0.52, { fist: 1, pole: [-0.6, -0.4, 0.6] }), lh: P(0.34, 1.1, -0.12, { open: 0.6 }) }, 'lin'],
    [24, { rot: 390, rh: P(0.2, 1.16, 0.3, { fist: 1, pole: [-0.4, -0.6, 0.6] }), lh: P(0.2, 1.2, 0.26, { open: 0.4 }) }, 'out'],
    [30, { rot: 360, rh: KR }, 'io'],
  ],
};

// IA3 Air Heel Hook (11/5/14): a reverse turn in the air, the left heel hooking across
const airheel = {
  base: AIRL,
  keys: [
    [0, { rh: KR }],
    [4, { rot: -90, neck: [0, 30, 0], head: [0, 26, 0], lf: { p: [0.16, 0.55, -0.2], pole: [0, 0.3, -1], pitch: 30 }, lh: P(0.24, 1.2, 0.28, { fist: 0.8 }), rh: { ...KR, p: [-0.24, 1.14, 0.18] } }, 'in'],
    [11, { rot: -178, spine: [20, 0, 0], chest: [8, 0, 0], neck: [-20, -30, 0], head: [-8, -20, 0], lf: { p: [0.06, 1.1, -0.78], pole: [0, 1, 0], pitch: -55 }, lh: P(0.28, 1.18, 0.26), rh: { ...KR, p: [-0.3, 1.14, 0.1] } }, 'snap'],
    [16, { rot: -206, spine: [20, 0, 0], chest: [8, 0, 0], neck: [-20, -30, 0], head: [-8, -20, 0], lf: { p: [-0.12, 1.06, -0.72], pole: [0, 1, 0], pitch: -55 }, lh: P(0.28, 1.18, 0.26), rh: { ...KR, p: [-0.3, 1.14, 0.1] } }, 'lin'],
    [23, { rot: -300, spine: [6, 0, 0], lf: { p: [0.14, 0.34, 0.0], pole: [0, 0.3, 1], pitch: 25 }, rh: KR }, 'io'],
    [30, { rot: -360, rh: KR }, 'out'],
  ],
};

// IA4 Crow Ambush (17/4/15; crows 3-11): gone in crows, re-formed at the victim's back coiled for a backfist
const airambush = {
  base: AIRL,
  keys: [
    [0, { rh: KR }],
    [3, { ...BURST, rh: P(-0.6, 1.36, 0.08, { pole: [0, -1, -0.4], fist: 1 }) }, 'snap'],
    [4, { hips: [6, 20, 0], spine: [6, 12, 0], chest: [4, 14, 0], neck: [-6, -18, 0], head: [-4, -16, 0], rh: P(0.2, 1.36, 0.22, { fist: 1, pole: [-0.3, -0.5, 1] }), lh: P(0.2, 1.2, 0.34, { open: 0.4, pole: [1, -1, 0] }) }, 'lin'],
    [11, { hips: [6, 20, 0], spine: [6, 12, 0], chest: [4, 14, 0], neck: [-6, -18, 0], head: [-4, -16, 0], rh: P(0.2, 1.36, 0.22, { fist: 1, pole: [-0.3, -0.5, 1] }), lh: P(0.2, 1.2, 0.34, { open: 0.4, pole: [1, -1, 0] }) }],
    [15, { h: [0, 0.05, 0.08], hips: [8, 2, 0], spine: [6, 4, 0], chest: [4, 2, 0], rh: P(0.1, 1.4, 0.5, { fist: 1, pole: [-0.6, -0.3, 1] }), lh: P(0.22, 1.15, 0.2, { open: 0.4, pole: [1, -1, 0] }) }, 'in'],
    [17, { h: [0, 0.05, 0.12], hips: [8, -12, 0], spine: [6, -6, 0], chest: [4, -8, 0], neck: [-8, 14, 0], head: [-6, 12, 0], rh: P(-0.1, 1.4, 0.74, { fist: 1, pole: [-1, -0.3, 0.3] }), lh: P(0.28, 1.08, 0.02, { open: 0.3, pole: [1, -1, 0] }) }, 'snap'],
    [21, { h: [0, 0.05, 0.12], hips: [8, -26, 0], spine: [6, -12, 0], chest: [4, -16, 0], neck: [-8, 24, 0], head: [-6, 20, 0], rh: P(-0.36, 1.38, 0.6, { fist: 1, pole: [-1, -0.3, 0.1] }), lh: P(0.28, 1.08, 0.02, { open: 0.3, pole: [1, -1, 0] }) }, 'lin'],
    [36, { rh: KR }, 'io'],
  ],
};

// IA5 Heaven Drop (16/5/28; flips up over the victim 2-11, dive at 21, lands at 30): a rising front flip, head down
// over the victim with the right fist cocked, the fist drives down at it diagonally (it hangs half a metre ahead), he
// plunges, flips on to his feet and lands kneeling, the fist in the ground (the reference's upside-down dive into a dust cloud)
const HD = [0, 0.75, 0.1]; // the inverted hips: 1.65 m over the root, a little forward
const airdrop = {
  keys: [
    [0, { ...AIRL, rh: KR }],
    [4, flip(50, [0, 0.3, 0.04], { spine: [16, 0, 0], chest: [10, 0, 0], neck: [6, 0, 0], lf: [0.1, -0.3, 0.2, { pitch: 30 }], rf: [-0.1, -0.28, 0.22, { pitch: 30 }], lh: [0.16, 0.05, 0.3, { open: 0.3 }], rh: [-0.16, 0.05, 0.3, { fist: 1 }] }), 'in'],
    [8, flip(115, [0, 0.55, 0.06], { spine: [16, 0, 0], chest: [10, 0, 0], neck: [6, 0, 0], lf: [0.1, -0.3, 0.18, { pitch: 30 }], rf: [-0.1, -0.28, 0.2, { pitch: 30 }], lh: [0.18, 0.1, 0.3, { open: 0.3 }], rh: [-0.18, 0.1, 0.3, { fist: 1 }] }), 'lin'],
    [12, flip(128, HD, { spine: [-4, 0, 0], chest: [-4, 0, 0], neck: [18, 0, 0], head: [12, 0, 0], lf: [0.14, -0.78, 0.1, { pitch: -10 }], rf: [-0.16, -0.72, -0.12, { pitch: -10 }], lh: [0.46, 0.45, 0.12, { open: 0.8, pole: [1, 0, 0] }], rh: [-0.15, 0.42, 0.2, { fist: 1, pole: [-1, 0, -0.5] }] }), 'out'],
    [14, flip(134, HD, { spine: [-6, 0, 0], chest: [-6, 0, 0], neck: [20, 0, 0], head: [14, 0, 0], lf: [0.14, -0.8, 0.1, { pitch: -10 }], rf: [-0.18, -0.74, -0.14, { pitch: -10 }], lh: [0.5, 0.42, 0.1, { open: 0.8, pole: [1, 0, 0] }], rh: [-0.16, 0.38, 0.12, { fist: 1, pole: [-1, 0, -0.5] }] }), 'io'],
    [16, flip(150, HD, { spine: [8, 0, 0], chest: [6, 0, 0], neck: [6, 0, 0], head: [4, 0, 0], lf: [0.16, -0.8, 0.05, { pitch: -10 }], rf: [-0.2, -0.74, -0.1, { pitch: -10 }], lh: [0.5, 0.36, 0.15, { open: 0.8, pole: [1, 0, 0] }], rh: [-0.12, 1.0, 0.1, { fist: 1, pole: [-1, 0, 0.5] }] }), 'snap'],
    [21, flip(154, HD, { spine: [8, 0, 0], chest: [6, 0, 0], neck: [6, 0, 0], head: [4, 0, 0], lf: [0.16, -0.8, 0.05, { pitch: -10 }], rf: [-0.2, -0.74, -0.1, { pitch: -10 }], lh: [0.5, 0.36, 0.15, { open: 0.8, pole: [1, 0, 0] }], rh: [-0.12, 0.98, 0.1, { fist: 1, pole: [-1, 0, 0.5] }] }), 'lin'],
    [25, flip(260, [0, 0.35, 0.05], { spine: [16, 0, 0], chest: [10, 0, 0], neck: [6, 0, 0], lf: [0.1, -0.3, 0.18, { pitch: 30 }], rf: [-0.1, -0.28, 0.2, { pitch: 30 }], lh: [0.18, 0.1, 0.3, { open: 0.4 }], rh: [-0.18, 0.1, 0.3, { fist: 1 }] }), 'lin'],
    [30, flip(350, [0, 0.08, 0.05], { spine: [10, 0, 0], chest: [6, 0, 0], neck: [-6, 0, 0], lf: [0.15, -0.55, 0.16, { pitch: 10 }], rf: [-0.15, -0.5, -0.12, { pitch: 20 }], lh: [0.42, 0.45, 0.1, { open: 0.6 }], rh: [-0.42, 0.45, 0.05, { open: 0.6 }] }), 'out'],
    [33, { ...KNEEL, tilt: 360 }, 'snap'],
    [40, { ...KNEEL, tilt: 360, h: [0, -0.48, 0.1], rh: P(-0.12, 0.34, 0.52, { fist: 1, pole: [-1, 1, 0] }) }],
    [49, { tilt: 360 }, 'io'],
  ],
};

// the kunai held as a blade: the wrist turned so it points ahead of the fist, nearly in line with the forearm (with a
// plain fist its blade stuck out of the thumb side, sideways across the strike: gripSegment follows the hand's +z)
const BLADE = [0, -70, 0];
/** Every right-hand key from frame `from` on holds the kunai as a blade (hitbox and prop follow the same grip). */
function armed(def, from = 0) {
  return {
    ...def,
    base: def.base && def.base.rh ? { ...def.base, rh: { ...def.base.rh, wrist: BLADE } } : def.base,
    keys: def.keys.map(([f, s, e]) => [f, f >= from && s.rh && !s.rh.open ? { ...s, rh: { ...s.rh, wrist: BLADE } } : s, e]),
  };
}

export const ITACHI_M1_CLIPS = {
  it_backhand: backhand,
  it_spinheel: spinheel,
  it_kunaidraw: armed(kunaidraw, 8),
  it_risingcut: armed(risingcut),
  it_palmrise: palmrise,
  it_crowdrop: crowdrop,
  it_flykick: flykick,
  it_airhook: airhook,
  it_crossslash: armed(crossslash, 7),
  it_crowflank: armed(crowflank),
  it_crescent: armed(crescent),
  it_air_snap: airsnap,
  it_air_slash: armed(airslash, 5),
  it_air_heel: armed(airheel),
  it_air_ambush: armed(airambush),
  it_air_drop: airdrop,
};
