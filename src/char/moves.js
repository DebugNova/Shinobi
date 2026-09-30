// Naruto's hand-keyed clips (attacks, guard, reactions, air and jutsu poses). Keys are frames at 60 Hz, laid on the
// frame data in src/shared/naruto.js: an attack's contact key is its first active frame. A Mixamo clip with the same
// id (npm run anims) replaces a keyed one when it exists and the move has a retime map; see Animator.
// Fighter frame: +z forward, +x = the fighter's LEFT, y up (metres for a 0.908 m hips height).
import { bakeClip } from './keyframes.js';
import { MADARA_CLIPS } from './madaramoves.js';
import { ITACHI_CLIPS } from './itachimoves.js';
import { ITACHI_M1_CLIPS } from './itachim1.js';
import { NARUTO_CLIPS } from './narutomoves.js';

// shorthand
const P = (x, y, z, o = {}) => ({ p: [x, y, z], ...o });
const LEAD = { lf: { p: [0.16, 0, 0.2] }, rf: { p: [-0.16, 0, -0.2] } };

// air: legs tucked under, no ground contact (the root is the body's feet point while airborne)
const AIR = {
  h: [0, 0.05, 0],
  lf: { p: [0.12, 0.3, 0.2], pole: [0, 0.3, 1], pitch: 20 },
  rf: { p: [-0.12, 0.18, -0.15], pole: [0, 0.3, 1], pitch: 30 },
};

// flips: limb targets written in the body frame of a pose turned forward by `tilt` degrees about its hips (metres from
// the hips bone: x the fighter's left, y up the spine, z out of the chest; h = the key's hips offset), so a tuck or a
// straight leg keeps its shape all the way round. FF: an ankle there (-> the foot spec's contact point, 0.1 m under
// it; the foot pitches with the body); FH: a hand there.
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

export const MOVE_CLIPS = {
  // ------------------------------------------------------------ stances
  stance: { keys: [[0, {}], [60, { h: [0, -0.07, 0], chest: [6, 8, 0] }], [120, {}]], loop: true },
  guard: {
    base: { h: [0, -0.1, 0], spine: [10, 4, 0], chest: [8, 4, 0], neck: [-8, 0, 0], head: [-6, 0, 0] },
    keys: [[0, { lh: P(-0.02, 1.36, 0.27, { pole: [1, -1, 0] }), rh: P(0.03, 1.28, 0.24, { pole: [-1, -1, 0] }) }], [40, { h: [0, -0.11, 0], lh: P(-0.02, 1.35, 0.27, { pole: [1, -1, 0] }), rh: P(0.03, 1.27, 0.24, { pole: [-1, -1, 0] }) }], [80, { lh: P(-0.02, 1.36, 0.27, { pole: [1, -1, 0] }), rh: P(0.03, 1.28, 0.24, { pole: [-1, -1, 0] }) }]],
    loop: true,
  },
  guard_hit: {
    base: { h: [0, -0.12, -0.05], spine: [4, 4, 0], chest: [0, 4, 0], lh: P(-0.02, 1.36, 0.22, { pole: [1, -1, 0] }), rh: P(0.03, 1.28, 0.2, { pole: [-1, -1, 0] }) },
    keys: [[0, { spine: [14, 4, 0] }], [3, { spine: [-6, 4, 0], chest: [-6, 0, 0], h: [0, -0.1, -0.12] }, 'snap'], [14, { spine: [10, 4, 0], h: [0, -0.1, 0] }]],
  },

  // ------------------------------------------------------------ light combo (ground)
  // L1 jab: startup 6, active 3, recovery 15
  jab: {
    keys: [
      [0, {}],
      [3, { hips: [4, -30, 0], lh: P(0.14, 1.27, 0.24), rh: P(-0.08, 1.22, 0.16) }, 'out'],
      [6, { hips: [6, -8, 0], spine: [6, 12, 0], chest: [4, 14, 0], h: [0, -0.07, 0.05], lh: P(0.07, 1.31, 0.66, { pole: [1, -0.4, -0.2], fist: 1 }), rh: P(-0.1, 1.24, 0.16) }, 'snap'],
      [9, { hips: [6, -8, 0], spine: [6, 12, 0], chest: [4, 14, 0], h: [0, -0.07, 0.05], lh: P(0.07, 1.31, 0.64, { pole: [1, -0.4, -0.2], fist: 1 }), rh: P(-0.1, 1.24, 0.16) }],
      [16, { hips: [4, -18, 0], lh: P(0.12, 1.29, 0.36) }, 'out'],
      [24, {}],
    ],
  },
  // L2 cross: startup 6, active 3, recovery 16 (rear hand; the hips drive through)
  cross: {
    keys: [
      [0, {}],
      [3, { hips: [4, -34, 0], chest: [4, 0, 0], rh: P(-0.12, 1.22, 0.1), rf: { p: [-0.16, 0, -0.2], pitch: 10 } }, 'out'],
      [6, { hips: [6, 22, 0], spine: [8, 14, 0], chest: [6, 16, 0], h: [0, -0.08, 0.08], rh: P(0.02, 1.3, 0.68, { pole: [-1, -0.4, -0.2], fist: 1 }), lh: P(0.14, 1.3, 0.2), rf: { p: [-0.14, 0, -0.16], pitch: 35, yaw: 45 } }, 'snap'],
      [9, { hips: [6, 22, 0], spine: [8, 14, 0], chest: [6, 16, 0], h: [0, -0.08, 0.08], rh: P(0.02, 1.3, 0.66, { pole: [-1, -0.4, -0.2], fist: 1 }), lh: P(0.14, 1.3, 0.2), rf: { p: [-0.14, 0, -0.16], pitch: 35, yaw: 45 } }],
      [17, { hips: [4, -6, 0], rh: P(-0.08, 1.24, 0.3) }, 'out'],
      [25, {}],
    ],
  },
  // L3 knee: startup 7, active 4, recovery 16 (both hands pull the opponent in)
  knee: {
    keys: [
      [0, {}],
      [4, { h: [0, -0.02, 0.04], hips: [0, -10, 0], rf: { p: [-0.08, 0.25, 0.02], pole: [0, 0.4, 1], pitch: 40 }, lh: P(0.12, 1.32, 0.46, { open: 0.6 }), rh: P(-0.1, 1.32, 0.46, { open: 0.6 }) }, 'out'],
      [7, { h: [0, 0.03, 0.08], hips: [-6, -4, 0], spine: [-4, 0, 0], chest: [8, 0, 0], lf: { p: [0.06, 0, 0.12], pitch: 25 }, rf: { p: [-0.06, 0.52, 0.1], pole: [0, 0.6, 1], pitch: 50 }, lh: P(0.1, 1.24, 0.4, { fist: 0.9 }), rh: P(-0.08, 1.24, 0.4, { fist: 0.9 }) }, 'snap'],
      [11, { h: [0, 0.03, 0.08], hips: [-6, -4, 0], spine: [-4, 0, 0], chest: [8, 0, 0], lf: { p: [0.06, 0, 0.12], pitch: 25 }, rf: { p: [-0.06, 0.5, 0.12], pole: [0, 0.6, 1], pitch: 50 }, lh: P(0.1, 1.24, 0.4), rh: P(-0.08, 1.24, 0.4) }],
      [19, { rf: { p: [-0.14, 0.08, -0.05], pitch: 10 } }, 'io'],
      [27, {}],
    ],
  },
  // L4 spinning back kick: startup 9, active 5, recovery 17 (turns a full circle; contact with the back to the target)
  spin_kick: {
    keys: [
      [0, {}],
      [4, { rot: -100, h: [0, -0.04, 0], lf: { p: [0.1, 0.35, -0.05], pole: [0, 0.3, -1], pitch: 30 }, rf: { p: [-0.05, 0, 0.02] }, head: [0, -40, 0] }, 'in'],
      [9, { rot: -180, h: [0, -0.02, 0], spine: [26, 0, 0], chest: [10, 0, 0], neck: [-24, -30, 0], head: [-10, -20, 0], lf: { p: [0.05, 0.98, -0.72], pole: [0, 1, 0], pitch: -60 }, rf: { p: [-0.05, 0, 0.1], pitch: 10 }, lh: P(0.22, 1.2, 0.3), rh: P(-0.24, 1.2, 0.2) }, 'snap'],
      [14, { rot: -195, h: [0, -0.02, 0], spine: [24, 0, 0], chest: [10, 0, 0], neck: [-22, -30, 0], head: [-10, -20, 0], lf: { p: [0.05, 0.95, -0.7], pole: [0, 1, 0], pitch: -60 }, rf: { p: [-0.05, 0, 0.1], pitch: 10 }, lh: P(0.22, 1.2, 0.3), rh: P(-0.24, 1.2, 0.2) }],
      [21, { rot: -280, lf: { p: [0.12, 0.3, -0.1], pole: [0, 0.3, -1] }, rf: { p: [-0.05, 0, 0.05] } }, 'io'],
      [31, { rot: -360 }, 'out'],
    ],
  },
  // L5 rising launch kick: startup 11, active 5, recovery 26
  roundhouse: {
    keys: [
      [0, {}],
      [5, { h: [0, -0.1, 0], hips: [8, -40, 0], spine: [8, 0, 0], rf: { p: [-0.02, 0.45, 0.12], pole: [0, 0.5, 1], pitch: 30 }, lf: { p: [0.12, 0, 0.1], pitch: 10 }, lh: P(0.2, 1.25, 0.25), rh: P(-0.18, 1.15, 0.05) }, 'out'],
      [11, { h: [0, 0.02, -0.02], hips: [-14, -20, 0], spine: [-12, 0, 0], chest: [-6, 0, 0], neck: [10, 0, 0], rf: { p: [-0.02, 1.45, 0.62], pole: [0, 1, 0.2], pitch: -40 }, lf: { p: [0.1, 0, 0.1], pitch: 30 }, lh: P(0.3, 1.2, -0.05, { open: 0.5 }), rh: P(-0.32, 1.15, -0.1, { open: 0.5 }) }, 'snap'],
      [16, { h: [0, 0.02, -0.02], hips: [-14, -20, 0], spine: [-12, 0, 0], chest: [-6, 0, 0], neck: [10, 0, 0], rf: { p: [-0.02, 1.42, 0.55], pole: [0, 1, 0.2], pitch: -40 }, lf: { p: [0.1, 0, 0.1], pitch: 30 }, lh: P(0.3, 1.2, -0.05, { open: 0.5 }), rh: P(-0.32, 1.15, -0.1, { open: 0.5 }) }],
      [26, { h: [0, -0.08, 0.05], hips: [6, -10, 0], rf: { p: [-0.1, 0.2, 0.35], pitch: 10 } }, 'io'],
      [42, {}],
    ],
  },
  // H axe kick: startup 16, active 4, recovery 28 (the leg rises straight, then chops down)
  axe_kick: {
    keys: [
      [0, {}],
      [9, { h: [0, 0.02, -0.04], hips: [-10, -10, 0], spine: [-10, 0, 0], rf: { p: [-0.02, 1.62, 0.36], pole: [0, 1, 0.4], pitch: -50 }, lf: { p: [0.1, 0, 0.12], pitch: 15 }, lh: P(0.3, 1.3, 0.1, { open: 0.4 }), rh: P(-0.3, 1.3, 0.05, { open: 0.4 }) }, 'out'],
      [13, { h: [0, 0.04, -0.04], hips: [-14, -10, 0], spine: [-14, 0, 0], rf: { p: [-0.02, 1.7, 0.5], pole: [0, 1, 0.4], pitch: -40 }, lf: { p: [0.1, 0, 0.12], pitch: 25 }, lh: P(0.3, 1.32, 0.1, { open: 0.4 }), rh: P(-0.3, 1.32, 0.05, { open: 0.4 }) }, 'io'],
      [16, { h: [0, -0.16, 0.12], hips: [18, -6, 0], spine: [18, 0, 0], chest: [10, 0, 0], neck: [-20, 0, 0], rf: { p: [-0.02, 0.3, 0.72], pole: [0, 0.3, 1], pitch: 30 }, lf: { p: [0.1, 0, -0.05], pitch: 20 }, lh: P(0.24, 1.0, 0.2), rh: P(-0.24, 1.0, 0.15) }, 'snap'],
      [20, { h: [0, -0.2, 0.12], hips: [20, -6, 0], spine: [20, 0, 0], chest: [10, 0, 0], neck: [-20, 0, 0], rf: { p: [-0.02, 0.05, 0.62], pole: [0, 0.3, 1] }, lf: { p: [0.1, 0, -0.1], pitch: 20 }, lh: P(0.24, 0.95, 0.2), rh: P(-0.24, 0.95, 0.15) }],
      [32, { h: [0, -0.1, 0.06], hips: [8, -12, 0], rf: { p: [-0.14, 0, 0.1] } }, 'io'],
      [48, {}],
    ],
  },

  // ------------------------------------------------------------ air combo
  air_jab: {
    base: AIR,
    keys: [[0, {}], [5, { spine: [6, 10, 0], chest: [4, 14, 0], lh: P(0.06, 1.3, 0.66, { fist: 1 }) }, 'snap'], [8, { spine: [6, 10, 0], chest: [4, 14, 0], lh: P(0.06, 1.3, 0.64, { fist: 1 }) }], [21, {}]],
  },
  air_kick: {
    base: AIR,
    keys: [[0, {}], [3, { rf: { p: [-0.05, 0.55, 0.2], pole: [0, 0.4, 1], pitch: 30 } }, 'out'], [6, { hips: [-10, 0, 0], spine: [-10, 0, 0], rf: { p: [-0.04, 1.05, 0.7], pole: [0, 1, 0.2], pitch: -20 } }, 'snap'], [10, { hips: [-10, 0, 0], spine: [-10, 0, 0], rf: { p: [-0.04, 1.02, 0.68], pole: [0, 1, 0.2], pitch: -20 } }], [24, {}]],
  },
  air_spin: {
    base: AIR,
    keys: [[0, {}], [4, { rot: -120, lf: { p: [0.2, 0.6, -0.1], pole: [0, 0.5, -1] } }, 'in'], [7, { rot: -180, spine: [20, 0, 0], lf: { p: [0.05, 1.0, -0.7], pole: [0, 1, 0], pitch: -50 } }, 'snap'], [12, { rot: -200, spine: [20, 0, 0], lf: { p: [0.05, 0.98, -0.68], pole: [0, 1, 0], pitch: -50 } }], [19, { rot: -290 }], [26, { rot: -360 }, 'out']],
  },
  air_spike: {
    base: AIR,
    keys: [[0, {}], [6, { hips: [-18, 0, 0], spine: [-12, 0, 0], rf: { p: [-0.02, 1.55, 0.4], pole: [0, 1, 0.4], pitch: -40 }, lh: P(0.3, 1.3, 0.1, { open: 0.5 }), rh: P(-0.3, 1.3, 0.05, { open: 0.5 }) }, 'out'], [10, { hips: [24, 0, 0], spine: [18, 0, 0], neck: [-20, 0, 0], rf: { p: [-0.02, 0.1, 0.75], pole: [0, 0.3, 1], pitch: 30 }, lh: P(0.24, 1.0, 0.2), rh: P(-0.24, 1.0, 0.15) }, 'snap'], [15, { hips: [24, 0, 0], spine: [18, 0, 0], rf: { p: [-0.02, 0.05, 0.7], pole: [0, 0.3, 1] } }], [37, {}]],
  },

  // ------------------------------------------------------------ M1 strings (naruto.js U1-U5, S1-S5)
  // The body travels during skips, hops, slides and flips (the moves' `step` runs over those frames), so feet are
  // off the ground or sliding for a reason while it moves, and planted while it doesn't.

  // U1 Lunge Straight (8/3/14): coil, skip in off the rear foot, a rear straight at full extension
  u_lunge: {
    keys: [
      [0, {}],
      [3, { h: [0.02, -0.16, -0.06], hips: [8, -38, 0], spine: [8, -8, 0], chest: [4, -6, 0], neck: [-6, 22, 0], head: [-6, 24, 0], lh: P(0.16, 1.24, 0.38, { open: 0.5, pole: [1, -1, 0] }), rh: P(-0.17, 1.04, -0.04, { fist: 1, pole: [-1, -0.2, -1] }), lf: { p: [0.15, 0.03, 0.28], pitch: -6, yaw: -15 }, rf: { p: [-0.17, 0, -0.24], pitch: 22, yaw: 30 } }, 'out'],
      [6, { h: [0, -0.04, 0.1], hips: [14, -16, 0], spine: [10, 0, 0], chest: [4, 2, 0], neck: [-8, 8, 0], head: [-6, 8, 0], lh: P(0.15, 1.25, 0.26, { fist: 0.8, pole: [1, -1, 0] }), rh: P(-0.13, 1.12, 0.12, { fist: 1, pole: [-1, -0.4, -0.6] }), lf: { p: [0.15, 0.2, 0.46], pole: [0, 0.4, 1], pitch: -18 }, rf: { p: [-0.15, 0.24, -0.32], pitch: 45 } }, 'in'],
      [8, { h: [0, -0.17, 0.08], hips: [10, 30, 0], spine: [8, 14, 0], chest: [6, 16, 0], upperChest: [0, 6, 0], neck: [-10, -26, 0], head: [-6, -20, 0], rh: P(0.03, 1.3, 0.82, { fist: 1, pole: [-1, -0.5, -0.2] }), lh: P(0.11, 1.3, 0.15, { fist: 1, pole: [1, -1, 0] }), lf: { p: [0.17, 0, 0.52], pole: [0.2, 0, 1], yaw: -5 }, rf: { p: [-0.2, 0, -0.5], pitch: 45, yaw: 35 } }, 'snap'],
      [11, { h: [0, -0.17, 0.08], hips: [10, 30, 0], spine: [8, 14, 0], chest: [6, 16, 0], upperChest: [0, 6, 0], neck: [-10, -26, 0], head: [-6, -20, 0], rh: P(0.03, 1.3, 0.79, { fist: 1, pole: [-1, -0.5, -0.2] }), lh: P(0.11, 1.3, 0.15, { fist: 1, pole: [1, -1, 0] }), lf: { p: [0.17, 0, 0.52], pole: [0.2, 0, 1], yaw: -5 }, rf: { p: [-0.2, 0, -0.5], pitch: 45, yaw: 35 } }],
      [17, { h: [0, -0.12, 0.04], hips: [6, -8, 0], spine: [6, 6, 0], chest: [4, 6, 0], rh: P(-0.07, 1.23, 0.3, { fist: 1 }), lh: P(0.13, 1.28, 0.3, { fist: 0.9 }), lf: { p: [0.17, 0, 0.42] }, rf: { p: [-0.17, 0.09, -0.34], pitch: 20, yaw: 30 } }, 'out'],
      [25, { lf: { p: [0.16, 0, 0.28] }, rf: { p: [-0.16, 0, -0.24], yaw: 25 } }, 'io'],
    ],
  },
  // U2 Switch Roundhouse (9/4/15): a switch hop, the left knee chambers, the shin whips across at head height (the
  // hips turn the left side to the target, the torso leans away)
  u_switch: {
    keys: [
      [0, {}],
      [3, { h: [0, 0.04, 0.04], hips: [2, 8, 0], spine: [4, 4, 0], chest: [2, 4, 0], lh: P(0.17, 1.3, 0.3, { fist: 0.9 }), rh: P(-0.1, 1.3, 0.26, { fist: 0.9 }), lf: { p: [0.14, 0.16, -0.02], pitch: 25 }, rf: { p: [-0.13, 0.12, 0.12], pitch: -5 } }, 'out'],
      [6, { h: [0.02, -0.02, 0.1], hips: [-6, -42, 6], spine: [-2, 8, 6], chest: [0, 10, 0], neck: [-4, 20, 0], head: [-4, 20, 0], lf: { p: [0.34, 0.62, 0.34], pole: [1, 0.6, 0.6], pitch: 30, yaw: -40 }, rf: { p: [-0.1, 0, 0.14], yaw: -70 }, lh: P(0.3, 1.1, 0.0, { open: 0.3 }), rh: P(-0.04, 1.34, 0.22, { fist: 1, pole: [-1, -1, 0] }) }, 'in'],
      [9, { h: [-0.03, -0.02, 0.08], hips: [0, -85, 28], spine: [0, 25, -6], chest: [0, 15, 0], neck: [-4, 22, 0], head: [-6, 18, 0], lf: { p: [-0.02, 1.3, 0.85], pole: [-1, 0.3, 0], pitch: -30, yaw: -60 }, rf: { p: [-0.1, 0, 0.12], pitch: 8, yaw: -100 }, lh: P(0.42, 0.95, -0.2, { open: 0.3, pole: [1, -1, 0] }), rh: P(-0.02, 1.36, 0.22, { fist: 1, pole: [-1, -1, 0] }) }, 'snap'],
      [12, { h: [-0.03, -0.02, 0.08], hips: [0, -95, 26], spine: [0, 25, -6], chest: [0, 15, 0], neck: [-4, 24, 0], head: [-6, 20, 0], lf: { p: [-0.3, 1.22, 0.72], pole: [-1, 0, -0.3], pitch: -30, yaw: -80 }, rf: { p: [-0.1, 0, 0.12], pitch: 8, yaw: -105 }, lh: P(0.42, 0.95, -0.2, { open: 0.3, pole: [1, -1, 0] }), rh: P(-0.02, 1.36, 0.22, { fist: 1, pole: [-1, -1, 0] }) }],
      [18, { h: [0, -0.04, 0.08], hips: [-4, -40, 8], spine: [0, 10, 4], chest: [0, 10, 0], neck: [-4, 18, 0], head: [-4, 18, 0], lf: { p: [0.26, 0.5, 0.3], pole: [1, 0.5, 0.8], pitch: 30, yaw: -30 }, rf: { p: [-0.1, 0, 0.14], yaw: -60 }, lh: P(0.24, 1.15, 0.1, { fist: 0.8 }), rh: P(-0.06, 1.3, 0.24, { fist: 1 }) }, 'out'],
      [28, { lf: { p: [0.16, 0, 0.3] }, rf: { p: [-0.14, 0, -0.1], yaw: 20 } }, 'io'],
    ],
  },
  // U3 Wind Palm (9/3/15): palms gather chakra at the right hip, a low sliding horse stance, both palms thrust (the
  // wind release bursts from them: movefx)
  u_windpalm: {
    keys: [
      [0, {}],
      [4, { h: [0, -0.2, -0.05], hips: [6, -45, 0], spine: [6, -10, 0], chest: [4, -10, 0], neck: [-4, 30, 0], head: [-4, 26, 0], rh: P(-0.24, 1.0, -0.02, { open: 1, pole: [-1, -1, 0] }), lh: P(-0.17, 1.02, 0.06, { open: 1, pole: [1, -1, 0] }), lf: { p: [0.2, 0, 0.24], yaw: -20 }, rf: { p: [-0.18, 0, -0.2], pitch: 12, yaw: 22 } }, 'out'],
      [7, { h: [0, -0.26, 0.08], hips: [10, -18, 0], spine: [8, -4, 0], chest: [4, -2, 0], neck: [-8, 12, 0], head: [-6, 10, 0], rh: P(-0.12, 1.1, 0.3, { open: 1, pole: [-1, -1, 0] }), lh: P(-0.04, 1.08, 0.32, { open: 1, pole: [1, -1, 0] }), lf: { p: [0.26, 0.04, 0.34], yaw: -20 }, rf: { p: [-0.24, 0, -0.24], pitch: 10, yaw: 25 } }, 'in'],
      [9, { h: [0, -0.32, 0.12], hips: [10, 4, 0], spine: [10, 0, 0], chest: [6, 0, 0], neck: [-12, 0, 0], head: [-8, 0, 0], rh: P(-0.03, 1.26, 0.8, { open: 1, spread: 8, pole: [-1, -1, 0] }), lh: P(0.05, 1.08, 0.76, { open: 1, spread: 8, pole: [1, -1, 0] }), lf: { p: [0.3, 0, 0.32], yaw: -25 }, rf: { p: [-0.3, 0, -0.16], yaw: 25 } }, 'snap'],
      [12, { h: [0, -0.32, 0.12], hips: [10, 4, 0], spine: [10, 0, 0], chest: [6, 0, 0], neck: [-12, 0, 0], head: [-8, 0, 0], rh: P(-0.03, 1.26, 0.78, { open: 1, spread: 8, pole: [-1, -1, 0] }), lh: P(0.05, 1.08, 0.74, { open: 1, spread: 8, pole: [1, -1, 0] }), lf: { p: [0.3, 0, 0.32], yaw: -25 }, rf: { p: [-0.3, 0, -0.16], yaw: 25 } }],
      [18, { h: [0, -0.18, 0.06], hips: [6, -6, 0], spine: [6, 0, 0], rh: P(-0.08, 1.2, 0.4, { open: 0.6 }), lh: P(0.1, 1.2, 0.4, { open: 0.6 }), lf: { p: [0.26, 0, 0.3] }, rf: { p: [-0.24, 0.08, -0.2], pitch: 15 } }, 'out'],
      [27, { lf: { p: [0.17, 0, 0.26] } }, 'io'],
    ],
  },
  // U4 Flip Heel Drop (12/4/16): crouch, a tucked front flip over the top, the right heel chops down through the
  // target, a scissor landing on the left foot
  u_flipkick: {
    keys: [
      [0, {}],
      [3, { h: [0, -0.24, 0.02], hips: [18, 0, 0], spine: [14, 0, 0], chest: [8, 0, 0], neck: [-16, 0, 0], head: [-8, 0, 0], lh: P(0.22, 0.95, -0.22, { open: 0.6 }), rh: P(-0.22, 0.95, -0.22, { open: 0.6 }), lf: { p: [0.13, 0, 0.12] }, rf: { p: [-0.13, 0, 0.0], pitch: 10 } }, 'out'],
      ...[[6, 80, [0, 0.4, 0.08], 0.1, 0.3], [9, 175, [0, 0.62, 0.12], 0.15, 0.3]].map(([f, t, h, rz, ez]) => [f, {
        tilt: t, h, spine: [16, 0, 0], chest: [10, 0, 0], neck: [6, 0, 0],
        lf: FF(t, h, 0.1, -0.3, 0.15, { pitch: 30 }), rf: FF(t, h, -0.1, -0.28, 0.18, { pitch: 30 }),
        lh: FH(t, h, 0.15, rz - 0.15, ez + 0.08, { open: 0.3 }), rh: FH(t, h, -0.15, rz - 0.15, ez + 0.08, { open: 0.3 }),
      }, 'lin']),
      [12, { tilt: 232, h: [0, 0.55, 0.12], spine: [-6, 0, 0], chest: [-4, 0, 0], neck: [16, 0, 0], head: [10, 0, 0], rf: FF(232, [0, 0.55, 0.12], -0.1, -0.82, 0.12, { pitch: -10, pole: [0, 0, 1] }), lf: FF(232, [0, 0.55, 0.12], 0.1, -0.3, 0.16, { pitch: 30 }), lh: FH(232, [0, 0.55, 0.12], 0.55, 0.25, 0.05, { open: 0.5 }), rh: FH(232, [0, 0.55, 0.12], -0.55, 0.25, 0.05, { open: 0.5 }) }, 'snap'],
      [15, { tilt: 292, h: [0, 0.32, 0.12], spine: [14, 0, 0], chest: [8, 0, 0], neck: [-6, 0, 0], rf: FF(292, [0, 0.32, 0.12], -0.1, -0.82, 0.08, { pole: [0, 0, 1] }), lf: FF(292, [0, 0.32, 0.12], 0.1, -0.5, 0.1), lh: FH(292, [0, 0.32, 0.12], 0.5, 0.2, 0.15, { open: 0.5 }), rh: FH(292, [0, 0.32, 0.12], -0.5, 0.2, 0.15, { open: 0.5 }) }, 'lin'],
      [19, { h: [0, -0.26, 0.08], hips: [22, 0, 0], spine: [16, 0, 0], chest: [6, 0, 0], neck: [-16, 0, 0], head: [-8, 0, 0], lf: { p: [0.16, 0, 0.3] }, rf: { p: [-0.15, 0, -0.14], pitch: 20 }, lh: P(0.4, 1.0, 0.25, { open: 0.5 }), rh: P(-0.4, 1.0, 0.2, { open: 0.5 }) }, 'out'],
      [24, { h: [0, -0.2, 0.04], hips: [12, -10, 0], spine: [8, 0, 0], lh: P(0.16, 1.2, 0.3, { fist: 0.8 }), rh: P(-0.1, 1.15, 0.2, { fist: 0.8 }), lf: { p: [0.16, 0, 0.28] }, rf: { p: [-0.15, 0, -0.16], pitch: 10, yaw: 20 } }, 'io'],
      [32, {}, 'io'],
    ],
  },
  // U5 Whirlwind Roundhouse (13/5/24): a stepping turn, a jumping 360 (the left knee drives up), the right shin
  // whips round at head height, a crouched landing past the target, back to stance
  u_tornado: {
    keys: [
      [0, {}],
      [4, { rot: 80, h: [0, -0.2, 0.02], hips: [8, 0, 0], spine: [6, 0, 0], lf: { p: [0.2, 0, 0.18] }, rf: { p: [-0.1, 0.08, -0.25], pitch: 20 }, lh: P(0.05, 1.2, 0.3, { fist: 0.8 }), rh: P(-0.05, 1.15, 0.28, { fist: 0.8 }) }, 'in'],
      [8, { rot: 170, h: [0, 0.28, 0], hips: [-4, 0, 0], lf: { p: [0.12, 0.62, 0.22], pole: [0, 0.4, 1], pitch: 20 }, rf: { p: [-0.12, 0.25, -0.1], pitch: 40 }, lh: P(0.3, 1.5, 0.1, { open: 0.4 }), rh: P(-0.25, 1.45, 0.1, { open: 0.4 }) }, 'lin'],
      [11, { rot: 260, h: [0, 0.42, 0], hips: [-4, 0, -8], rf: { p: [-0.28, 0.9, 0.12], pole: [-0.5, 0.5, 1], pitch: 30 }, lf: { p: [0.12, 0.62, 0.05], pole: [0, 0.3, 1], pitch: 30 }, lh: P(0.35, 1.3, 0.0, { open: 0.4 }), rh: P(-0.3, 1.35, 0.2, { fist: 0.8 }) }, 'lin'],
      [13, { rot: 335, h: [0, 0.42, 0.04], hips: [-6, 0, -18], spine: [-4, 0, -8], chest: [0, 8, 0], neck: [-4, 12, 0], head: [-6, 12, 0], rf: { p: [0.2, 1.32, 0.64], pole: [0.3, 1, 0], pitch: -10, yaw: 25 }, lf: { p: [0.14, 0.72, 0.1], pole: [0, 0.3, 1], pitch: 30 }, lh: P(0.45, 1.25, -0.15, { open: 0.4 }), rh: P(-0.2, 1.3, 0.25, { fist: 1 }) }, 'snap'],
      [17, { rot: 385, h: [0, 0.3, 0.04], hips: [-6, 0, -18], spine: [-4, 0, -8], chest: [0, 8, 0], neck: [-4, 12, 0], head: [-6, 12, 0], rf: { p: [0.2, 1.24, 0.62], pole: [0.3, 1, 0], pitch: -10, yaw: 25 }, lf: { p: [0.14, 0.6, 0.1], pole: [0, 0.3, 1], pitch: 30 }, lh: P(0.45, 1.25, -0.15, { open: 0.4 }), rh: P(-0.2, 1.3, 0.25, { fist: 1 }) }, 'lin'],
      [22, { rot: 390, h: [0, -0.24, 0.02], hips: [14, 0, 0], spine: [10, 0, 0], neck: [-10, -20, 0], head: [-6, -14, 0], lf: { p: [0.18, 0, 0.12] }, rf: { p: [-0.18, 0, -0.22], pitch: 15 }, lh: P(0.42, 1.0, 0.1, { open: 0.5 }), rh: P(-0.38, 1.05, 0.15, { open: 0.5 }) }, 'in'],
      [28, { rot: 372, h: [0, -0.18, 0], hips: [8, -10, 0], neck: [-6, -10, 0], lh: P(0.16, 1.22, 0.3, { fist: 0.8 }), rh: P(-0.1, 1.15, 0.2, { fist: 0.8 }) }, 'out'],
      [42, { rot: 360 }, 'io'],
    ],
  },

  // S1 Slide Kick (7/6/15): out of a run, drop into a slide, the right sole leading low along the ground, the left
  // palm dragging behind; spring back up
  r_slide: {
    keys: [
      [0, {}],
      [3, { tilt: -14, h: [0, -0.36, 0.04], hips: [-8, 0, 0], spine: [-6, 0, 0], lf: { p: [0.14, 0, 0.2], pitch: 10 }, rf: { p: [-0.12, 0.18, 0.35], pole: [0, 0.5, 1], pitch: -20 }, lh: P(0.3, 0.6, -0.1, { open: 0.8 }), rh: P(-0.25, 1.0, 0.25, { fist: 0.7 }) }, 'in'],
      [7, { tilt: -40, h: [0, -0.62, -0.02], hips: [0, -8, 0], spine: [4, -4, 0], chest: [6, 0, 0], neck: [18, 0, 0], head: [12, 8, 0], rf: { p: [-0.07, 0.08, 0.92], pole: [0, 1, 0.2], pitch: -60 }, lf: { p: [0.2, 0, 0.22], pole: [1, 1, 0.3], pitch: 20, yaw: -40 }, lh: P(0.36, 0.15, -0.36, { open: 1, pole: [1, 0, -1] }), rh: P(-0.28, 0.72, 0.42, { fist: 0.7 }) }, 'snap'],
      [12, { tilt: -38, h: [0, -0.6, -0.02], hips: [0, -8, 0], spine: [4, -4, 0], chest: [6, 0, 0], neck: [18, 0, 0], head: [12, 8, 0], rf: { p: [-0.07, 0.08, 0.9], pole: [0, 1, 0.2], pitch: -60 }, lf: { p: [0.2, 0, 0.22], pole: [1, 1, 0.3], pitch: 20, yaw: -40 }, lh: P(0.36, 0.15, -0.36, { open: 1, pole: [1, 0, -1] }), rh: P(-0.28, 0.72, 0.42, { fist: 0.7 }) }],
      [17, { tilt: -5, h: [0, -0.32, 0.08], hips: [12, 0, 0], spine: [10, 0, 0], rf: { p: [-0.13, 0, 0.35], pole: [0, 0.3, 1] }, lf: { p: [0.15, 0, 0.0], pitch: 25 }, lh: P(0.3, 0.8, 0.0, { open: 0.6 }), rh: P(-0.2, 1.1, 0.3, { fist: 0.9 }) }, 'out'],
      [22, { h: [0, -0.14, 0.04], lf: { p: [0.16, 0.1, 0.2], pitch: -5 }, rf: { p: [-0.14, 0, 0.1], yaw: 15 } }, 'io'],
      [28, {}, 'io'],
    ],
  },
  // S2 Scroll Draw Strike (10/4/14): the right hand reaches to the back for the scroll (it appears there: movefx),
  // swings it up over the shoulder and brings it down diagonally in a lunge
  r_draw: {
    keys: [
      [0, {}],
      [2, { h: [0, -0.1, 0.01], hips: [2, -16, 0], spine: [2, -6, 0], neck: [-4, 14, 0], head: [-4, 14, 0], rh: P(-0.26, 0.98, 0.06, { fist: 0.8, pole: [-1, -0.2, -0.4] }), lh: P(0.15, 1.27, 0.33, { fist: 0.6 }) }, 'in'],
      [4, { h: [0, -0.14, 0.02], hips: [4, -32, 0], spine: [2, -14, 0], chest: [0, -10, 0], neck: [-4, 26, 0], head: [-4, 26, 0], rh: P(-0.14, 0.98, -0.24, { fist: 0.8, pole: [-1, 0, -0.8] }), lh: P(0.16, 1.26, 0.34, { open: 0.3 }), lf: { p: [0.15, 0.06, 0.32], pitch: -5 }, rf: { p: [-0.15, 0, -0.18], pitch: 12, yaw: 25 } }, 'out'],
      [7, { h: [0, -0.06, 0.04], hips: [-2, -42, 0], spine: [-8, -18, 0], chest: [-6, -12, 0], neck: [0, 30, 0], head: [-2, 26, 0], rh: P(-0.22, 1.62, -0.06, { fist: 1, pole: [-1, 0.3, -1] }), lh: P(0.22, 1.3, 0.3, { open: 0.5 }), lf: { p: [0.16, 0, 0.42] }, rf: { p: [-0.16, 0, -0.22], pitch: 18, yaw: 30 } }, 'out'],
      [10, { h: [0, -0.2, 0.12], hips: [14, 30, 0], spine: [14, 16, 0], chest: [8, 14, 0], neck: [-12, -22, 0], head: [-8, -20, 0], rh: P(0.1, 1.2, 0.72, { fist: 1, pole: [-1, -0.6, 0] }), lh: P(0.3, 1.08, -0.08, { open: 0.4, pole: [1, -1, 0] }), lf: { p: [0.18, 0, 0.55], yaw: -5 }, rf: { p: [-0.18, 0, -0.44], pitch: 35, yaw: 30 } }, 'snap'],
      [13, { h: [0, -0.22, 0.12], hips: [16, 38, 0], spine: [16, 20, 0], chest: [8, 16, 0], neck: [-12, -26, 0], head: [-8, -22, 0], rh: P(0.28, 0.9, 0.5, { fist: 1, pole: [-1, -1, 0] }), lh: P(0.3, 1.08, -0.08, { open: 0.4, pole: [1, -1, 0] }), lf: { p: [0.18, 0, 0.55], yaw: -5 }, rf: { p: [-0.18, 0, -0.44], pitch: 35, yaw: 30 } }, 'lin'],
      [19, { h: [0, -0.12, 0.06], hips: [6, -10, 0], spine: [6, 4, 0], chest: [4, 4, 0], neck: [-4, 6, 0], head: [-4, 6, 0], rh: P(-0.14, 1.22, 0.3, { fist: 1, pole: [-1, -1, 0] }), lh: P(0.14, 1.26, 0.3, { open: 0.3 }), lf: { p: [0.17, 0, 0.42] }, rf: { p: [-0.17, 0.08, -0.3], pitch: 15, yaw: 25 } }, 'out'],
      [28, { rh: P(-0.12, 1.2, 0.26, { fist: 1, pole: [-1, -1, 0] }), lf: { p: [0.16, 0, 0.3] }, rf: { p: [-0.16, 0, -0.22], yaw: 25 } }, 'io'],
    ],
  },
  // S3 Grapple Toss (9/3/17): step in, the left hand seizes the collar and the scroll hooks behind the neck, sink the
  // hips, then drive up onto the toes and heave the target skyward
  r_throw: {
    keys: [
      [0, { rh: P(-0.12, 1.2, 0.26, { fist: 1, pole: [-1, -1, 0] }) }],
      [4, { h: [0, -0.12, 0.08], hips: [8, -14, 0], spine: [8, 0, 0], chest: [4, 0, 0], lh: P(0.12, 1.34, 0.62, { open: 0.9, pole: [1, -1, 0] }), rh: P(-0.14, 1.3, 0.46, { fist: 1, pole: [-1, -1, -0.5] }), lf: { p: [0.15, 0.07, 0.45] }, rf: { p: [-0.14, 0, -0.12], pitch: 15, yaw: 20 } }, 'out'],
      [9, { h: [0, -0.3, 0.12], hips: [20, -8, 0], spine: [14, 0, 0], chest: [8, 0, 0], neck: [-16, 0, 0], head: [-8, 0, 0], lh: P(0.1, 1.28, 0.64, { fist: 1, pole: [1, -1, 0] }), rh: P(-0.12, 1.42, 0.52, { fist: 1, pole: [-1, -1, -0.5] }), lf: { p: [0.2, 0, 0.42], yaw: -10 }, rf: { p: [-0.2, 0, -0.18], pitch: 10, yaw: 20 } }, 'snap'],
      [11, { h: [0, -0.32, 0.12], hips: [20, -8, 0], spine: [14, 0, 0], chest: [8, 0, 0], neck: [-16, 0, 0], head: [-8, 0, 0], lh: P(0.1, 1.26, 0.64, { fist: 1, pole: [1, -1, 0] }), rh: P(-0.12, 1.4, 0.52, { fist: 1, pole: [-1, -1, -0.5] }), lf: { p: [0.2, 0, 0.42], yaw: -10 }, rf: { p: [-0.2, 0, -0.18], pitch: 10, yaw: 20 } }],
      [15, { h: [0, 0.06, 0.06], hips: [-12, 0, 0], spine: [-16, 0, 0], chest: [-8, 0, 0], neck: [14, 0, 0], head: [12, 0, 0], lh: P(0.16, 1.98, 0.36, { open: 0.7, pole: [1, 0, 0] }), rh: P(-0.16, 1.96, 0.3, { fist: 1, pole: [-1, 0, 0] }), lf: { p: [0.16, 0, 0.32], pitch: 35 }, rf: { p: [-0.16, 0, -0.08], pitch: 35 } }, 'out'],
      [21, { h: [0, -0.2, 0.04], hips: [8, -6, 0], spine: [4, 0, 0], neck: [10, 0, 0], head: [10, 0, 0], lh: P(0.22, 1.2, 0.3, { open: 0.4 }), rh: P(-0.3, 0.9, -0.18, { fist: 1, pole: [-1, 0, 1] }), lf: { p: [0.15, 0, 0.26] }, rf: { p: [-0.15, 0, -0.12], pitch: 10 } }, 'io'],
      [29, { h: [0, -0.1, 0.02], rh: P(-0.12, 1.2, 0.26, { fist: 1, pole: [-1, -1, 0] }) }, 'io'],
    ],
  },
  // S4 Rising Scroll (9/4/14, a leap: the body leaves the ground on frame 0): push off, tuck, the scroll swings up
  // through the airborne target; curl up for the slam
  r_rise: {
    keys: [
      [0, { h: [0, 0, 0.04], hips: [-4, 0, 0], lf: { p: [0.12, 0.02, 0.16], pitch: 45 }, rf: { p: [-0.12, 0.05, -0.1], pitch: 55 }, rh: P(-0.3, 0.85, -0.2, { fist: 1, pole: [-1, 0.3, 1] }), lh: P(0.25, 1.25, 0.25, { open: 0.4 }) }],
      [4, { h: [0, 0.05, 0.04], hips: [-6, -10, 0], spine: [-4, -8, 0], lf: { p: [0.12, 0.35, 0.22], pole: [0, 0.3, 1], pitch: 25 }, rf: { p: [-0.12, 0.18, -0.12], pitch: 45 }, rh: P(-0.22, 0.95, 0.3, { fist: 1, pole: [-1, 0, -1] }), lh: P(0.3, 1.3, 0.1, { open: 0.5 }) }, 'out'],
      [9, { h: [0, 0.05, 0.04], hips: [-14, 18, 0], spine: [-14, 12, 0], chest: [-8, 8, 0], neck: [16, -10, 0], head: [10, -8, 0], rh: P(-0.02, 1.95, 0.5, { fist: 1, pole: [-1, 0.2, -1] }), lh: P(0.35, 1.05, -0.05, { open: 0.5 }), lf: { p: [0.12, 0.48, 0.24], pole: [0, 0.4, 1], pitch: 20 }, rf: { p: [-0.12, 0.08, -0.2], pitch: 50 } }, 'snap'],
      [12, { h: [0, 0.05, 0.04], hips: [-14, 18, 0], spine: [-14, 12, 0], chest: [-8, 8, 0], neck: [16, -10, 0], head: [10, -8, 0], rh: P(0.02, 2.0, 0.36, { fist: 1, pole: [-1, 0.2, -1] }), lh: P(0.35, 1.05, -0.05, { open: 0.5 }), lf: { p: [0.12, 0.48, 0.24], pole: [0, 0.4, 1], pitch: 20 }, rf: { p: [-0.12, 0.08, -0.2], pitch: 50 } }],
      [18, { h: [0, 0.1, 0], hips: [6, 0, 0], spine: [10, 0, 0], chest: [8, 0, 0], neck: [-10, 0, 0], lf: { p: [0.12, 0.4, 0.18], pole: [0, 0.3, 1], pitch: 30 }, rf: { p: [-0.12, 0.34, 0.12], pole: [0, 0.3, 1], pitch: 30 }, rh: P(-0.14, 1.8, -0.12, { fist: 1, pole: [-1, -0.3, 0] }), lh: P(0.25, 1.4, 0.2, { open: 0.4 }) }, 'out'],
      [27, { h: [0, 0.1, 0], hips: [6, 0, 0], spine: [10, 0, 0], chest: [8, 0, 0], neck: [-10, 0, 0], lf: { p: [0.12, 0.4, 0.18], pole: [0, 0.3, 1], pitch: 30 }, rf: { p: [-0.12, 0.34, 0.12], pole: [0, 0.3, 1], pitch: 30 }, rh: P(-0.14, 1.8, -0.12, { fist: 1, pole: [-1, -0.3, 0] }), lh: P(0.25, 1.4, 0.2, { open: 0.4 }) }],
    ],
  },
  // S5 Scroll Meteor Slam (14/4/22, in the air): a tucked front flip, the scroll comes over the top and smashes down
  // through the target, a dive, a kneeling landing (the clip waits at frame 22 until the feet touch down)
  r_slam: {
    keys: [
      [0, { h: [0, 0.1, 0], spine: [10, 0, 0], chest: [8, 0, 0], neck: [-10, 0, 0], lf: FF(0, [0, 0.1, 0], 0.1, -0.3, 0.15, { pitch: 30 }), rf: FF(0, [0, 0.1, 0], -0.1, -0.3, 0.15, { pitch: 30 }), rh: FH(0, [0, 0.1, 0], -0.14, 0.85, -0.1, { fist: 1, pole: [-1, -0.3, 0] }), lh: FH(0, [0, 0.1, 0], 0.25, 0.5, 0.25, { open: 0.4 }) }],
      ...[[4, 100], [8, 210]].map(([f, t]) => [f, {
        tilt: t, h: [0, 0.1, 0.04], spine: [18, 0, 0], chest: [10, 0, 0], neck: [6, 0, 0],
        lf: FF(t, [0, 0.1, 0.04], 0.1, -0.3, 0.15, { pitch: 30 }), rf: FF(t, [0, 0.1, 0.04], -0.1, -0.3, 0.15, { pitch: 30 }),
        rh: FH(t, [0, 0.1, 0.04], -0.16, 0.7, 0.1, { fist: 1, pole: [-1, -0.3, 0] }), lh: FH(t, [0, 0.1, 0.04], 0.16, -0.05, 0.38, { open: 0.3 }),
      }, 'lin']),
      [12, { tilt: 320, h: [0, 0.1, 0.04], spine: [-6, 0, 0], chest: [-6, 0, 0], neck: [10, 0, 0], lf: FF(320, [0, 0.1, 0.04], 0.1, -0.62, 0.05), rf: FF(320, [0, 0.1, 0.04], -0.1, -0.55, -0.1, { pitch: 20 }), rh: FH(320, [0, 0.1, 0.04], -0.12, 0.85, 0.15, { fist: 1, pole: [-1, -0.3, -0.5] }), lh: FH(320, [0, 0.1, 0.04], 0.35, 0.4, 0.2, { open: 0.5 }) }, 'lin'],
      [14, { tilt: 375, h: [0, 0.06, 0.06], spine: [22, 0, 0], chest: [12, 0, 0], neck: [-18, 0, 0], head: [-8, 0, 0], rh: FH(375, [0, 0.06, 0.06], -0.08, 0.2, 0.75, { fist: 1, pole: [-1, 1, 0] }), lh: FH(375, [0, 0.06, 0.06], 0.4, 0.35, -0.15, { open: 0.6 }), lf: FF(375, [0, 0.06, 0.06], 0.12, -0.6, 0.12), rf: FF(375, [0, 0.06, 0.06], -0.12, -0.55, -0.15, { pitch: 30 }) }, 'snap'],
      [18, { tilt: 382, h: [0, 0.04, 0.06], spine: [24, 0, 0], chest: [12, 0, 0], neck: [-18, 0, 0], head: [-8, 0, 0], rh: FH(382, [0, 0.04, 0.06], -0.05, -0.05, 0.65, { fist: 1, pole: [-1, 1, 0] }), lh: FH(382, [0, 0.04, 0.06], 0.4, 0.35, -0.15, { open: 0.6 }), lf: FF(382, [0, 0.04, 0.06], 0.12, -0.62, 0.12), rf: FF(382, [0, 0.04, 0.06], -0.12, -0.55, -0.15, { pitch: 30 }) }, 'lin'],
      [22, { tilt: 10, h: [0, 0, 0.06], hips: [10, 0, 0], spine: [16, 0, 0], neck: [-14, 0, 0], lf: { p: [0.15, -0.02, 0.3], pitch: -10 }, rf: { p: [-0.15, 0.1, -0.12], pitch: 30 }, rh: P(-0.08, 0.6, 0.62, { fist: 1, pole: [-1, 1, 0] }), lh: P(0.4, 1.1, -0.1, { open: 0.6 }) }],
      [25, { h: [0, -0.5, 0.1], hips: [22, 0, 0], spine: [20, 0, 0], chest: [10, 0, 0], neck: [-22, 0, 0], head: [-10, 0, 0], lf: { p: [0.17, 0, 0.36] }, rf: { p: [-0.15, 0, -0.34], pitch: 70 }, rh: P(-0.1, 0.3, 0.55, { fist: 1, pole: [-1, 1, 0] }), lh: P(0.46, 0.72, 0.02, { open: 1 }) }, 'snap'],
      [32, { h: [0, -0.48, 0.1], hips: [20, 0, 0], spine: [18, 0, 0], chest: [10, 0, 0], neck: [-18, 0, 0], head: [-10, 0, 0], lf: { p: [0.17, 0, 0.36] }, rf: { p: [-0.15, 0, -0.34], pitch: 70 }, rh: P(-0.12, 0.34, 0.52, { fist: 1, pole: [-1, 1, 0] }), lh: P(0.46, 0.74, 0.02, { open: 1 }) }],
      [40, {}, 'io'],
    ],
  },

  // ------------------------------------------------------------ hit reactions (stretched to the stun time)
  hit_head: {
    keys: [[0, {}], [3, { h: [0, -0.08, -0.08], hips: [-4, -22, 0], spine: [-14, 0, 6], chest: [-10, 0, 0], neck: [-18, 10, 0], head: [-14, 14, 0], lh: P(0.2, 1.2, 0.1, { open: 0.6 }), rh: P(-0.2, 1.15, 0.05, { open: 0.6 }) }, 'snap'], [14, { h: [0, -0.08, -0.04], spine: [0, 0, 0], neck: [-4, 0, 0] }, 'io'], [22, {}]],
  },
  hit_body: {
    keys: [[0, {}], [3, { h: [0, -0.14, -0.1], hips: [10, -22, 0], spine: [22, 0, 0], chest: [14, 0, 0], neck: [-10, 0, 0], lh: P(0.1, 1.0, 0.25, { open: 0.3 }), rh: P(-0.08, 0.95, 0.25, { open: 0.3 }) }, 'snap'], [14, { h: [0, -0.1, -0.05], spine: [10, 0, 0] }, 'io'], [22, {}]],
  },
  stagger: {
    keys: [
      [0, {}],
      [4, { h: [0, -0.1, -0.2], hips: [-8, -20, 0], spine: [-18, 0, 0], chest: [-10, 0, 0], neck: [-20, 0, 0], lf: { p: [0.16, 0, 0.3] }, rf: { p: [-0.16, 0.1, -0.35], pitch: 20 }, lh: P(0.3, 1.2, 0.05, { open: 0.7 }), rh: P(-0.3, 1.15, 0.0, { open: 0.7 }) }, 'snap'],
      [14, { h: [0, -0.16, -0.1], hips: [10, -20, 0], spine: [16, 0, 0], neck: [-10, 0, 0], rf: { p: [-0.16, 0, -0.3] }, lh: P(0.2, 1.0, 0.2), rh: P(-0.2, 0.95, 0.2) }, 'io'],
      [24, {}],
    ],
  },
  // flying back through the air (loops while airborne): arched, limbs trailing toward the hit
  fly: {
    base: { h: [0, 0.05, 0], tilt: -35, spine: [-16, 0, 0], chest: [-10, 0, 0], neck: [20, 0, 0], head: [16, 0, 0], lh: P(0.28, 1.1, 0.5, { open: 0.6 }), rh: P(-0.26, 1.05, 0.46, { open: 0.6 }), lf: { p: [0.14, 0.2, 0.5], pole: [0, 1, 0.6], pitch: -30 }, rf: { p: [-0.12, 0.35, 0.35], pole: [0, 1, 0.6], pitch: -20 } },
    keys: [[0, {}], [12, { lh: P(0.32, 1.2, 0.45, { open: 0.7 }), rf: { p: [-0.12, 0.25, 0.45], pole: [0, 1, 0.6] } }], [24, {}]],
    loop: true,
  },
  // lying on the back (after a knockdown); the fighter's root stays at the feet point
  lie: {
    base: { h: [0, -0.74, -0.55], tilt: -86, spine: [-4, 0, 0], neck: [10, 0, 0], head: [8, 10, 0], lh: P(0.34, 0.06, -0.72, { open: 0.7, pole: [1, 1, 0] }), rh: P(-0.32, 0.1, -0.58, { open: 0.7, pole: [-1, 1, 0] }), lf: { p: [0.18, 0.02, 0.12], pole: [0, 1, 0], pitch: -80 }, rf: { p: [-0.14, 0.2, 0.3], pole: [0, 1, 0], pitch: -60 } },
    keys: [[0, {}], [40, { spine: [-6, 0, 0] }], [80, {}]],
    loop: true,
  },
  // get up: roll to a knee, then stand (34 frames)
  getup: {
    keys: [
      [0, { h: [0, -0.74, -0.55], tilt: -86, lh: P(0.34, 0.06, -0.72, { open: 0.7, pole: [1, 1, 0] }), rh: P(-0.32, 0.1, -0.58, { open: 0.7, pole: [-1, 1, 0] }), lf: { p: [0.18, 0.02, 0.12], pole: [0, 1, 0], pitch: -80 }, rf: { p: [-0.14, 0.2, 0.3], pole: [0, 1, 0], pitch: -60 } }],
      [10, { h: [0, -0.52, -0.2], tilt: -40, spine: [20, 0, 0], lh: P(0.3, 0.35, 0.2, { open: 0.8 }), rh: P(-0.3, 0.35, 0.25, { open: 0.8 }), lf: { p: [0.2, 0, 0.35], pole: [0, 0.5, 1] }, rf: { p: [-0.16, 0, -0.1], pole: [0, 0.5, 1], pitch: 40 } }, 'io'],
      [22, { h: [0, -0.4, 0], spine: [24, 0, 0], chest: [10, 0, 0], lh: P(0.22, 0.6, 0.3, { open: 0.6 }), rh: P(-0.2, 0.7, 0.2), lf: { p: [0.16, 0, 0.3], pole: [0, 0.4, 1] }, rf: { p: [-0.16, 0, -0.25], pole: [0, 0, 1], pitch: 50 } }, 'io'],
      [34, {}, 'out'],
    ],
  },
  // tech roll: a quick backward roll to the feet (24 frames)
  tech: {
    keys: [
      [0, { h: [0, -0.5, 0], tilt: -40, lf: { p: [0.16, 0.2, 0.4], pole: [0, 1, 0] }, rf: { p: [-0.16, 0.2, 0.4], pole: [0, 1, 0] } }],
      [8, { h: [0, -0.2, 0], tilt: -200, spine: [30, 0, 0], lf: { p: [0.12, 0.6, 0.2], pole: [0, 1, 1] }, rf: { p: [-0.12, 0.6, 0.2], pole: [0, 1, 1] } }],
      [16, { h: [0, -0.35, 0], tilt: -330, spine: [30, 0, 0], lf: { p: [0.14, 0, 0.1], pole: [0, 0.5, 1] }, rf: { p: [-0.14, 0, -0.2], pole: [0, 0.5, 1] } }],
      [24, { tilt: -360 }, 'out'],
    ],
  },

  // ------------------------------------------------------------ jutsu and tools
  charge: {
    base: { h: [0, -0.2, 0], hips: [6, 0, 0], spine: [10, 0, 0], chest: [6, 0, 0], neck: [-6, 0, 0], head: [-4, 0, 0], lf: { p: [0.28, 0, 0.05], yaw: -20 }, rf: { p: [-0.28, 0, 0.0], yaw: 20 }, lh: P(0.2, 0.95, 0.12, { fist: 1, pole: [1, 0, -1] }), rh: P(-0.2, 0.95, 0.12, { fist: 1, pole: [-1, 0, -1] }) },
    keys: [[0, {}], [20, { h: [0, -0.22, 0], chest: [8, 0, 0] }], [40, {}]],
    loop: true,
  },
  throw: {
    keys: [[0, {}], [4, { hips: [2, -40, 0], chest: [0, -20, 0], rh: P(-0.3, 1.35, -0.1, { open: 0.3 }) }, 'out'], [7, { hips: [6, 10, 0], chest: [4, 24, 0], rh: P(0.02, 1.28, 0.62, { open: 1, pole: [-1, -0.2, 0] }) }, 'snap'], [19, {}]],
  },
  handsign: {
    keys: [[0, {}], [6, { h: [0, -0.1, 0], lh: P(0.02, 1.2, 0.26, { open: 0.3, pole: [1, -1, 0] }), rh: P(-0.02, 1.21, 0.26, { open: 0.3, pole: [-1, -1, 0] }) }, 'snap'], [14, { h: [0, -0.12, 0], lh: P(0.015, 1.24, 0.25, { open: 0.3, pole: [1, -1, 0] }), rh: P(-0.015, 1.24, 0.25, { open: 0.3, pole: [-1, -1, 0] }) }], [20, {}]],
  },
  // Rasengan: wind up (the sphere forms over the right palm), then the lunge holds it out
  rasengan: {
    keys: [
      [0, {}],
      [8, { h: [0, -0.12, 0], hips: [6, -30, 0], spine: [10, -10, 0], rh: P(-0.18, 1.0, 0.28, { open: 1, pole: [-1, -0.5, 0], wrist: [0, 0, 60] }), lh: P(-0.08, 1.12, 0.32, { open: 1, pole: [1, 0, 0] }) }, 'out'],
      [18, { h: [0, -0.14, 0], hips: [6, -34, 0], spine: [12, -12, 0], rh: P(-0.16, 1.02, 0.3, { open: 1, pole: [-1, -0.5, 0], wrist: [0, 0, 60] }), lh: P(-0.07, 1.16, 0.33, { open: 1, pole: [1, 0, 0] }) }],
      [24, { h: [0, -0.2, 0.1], hips: [18, 10, 0], spine: [16, 10, 0], chest: [8, 10, 0], neck: [-20, 0, 0], rh: P(0.0, 1.18, 0.72, { open: 1, pole: [-1, -0.3, 0], wrist: [0, 0, 70] }), lh: P(0.25, 1.15, -0.15), lf: { p: [0.16, 0, 0.5] }, rf: { p: [-0.16, 0.05, -0.45], pitch: 30 } }, 'snap'],
      [60, { h: [0, -0.2, 0.1], hips: [18, 10, 0], spine: [16, 10, 0], chest: [8, 10, 0], neck: [-20, 0, 0], rh: P(0.0, 1.18, 0.7, { open: 1, pole: [-1, -0.3, 0], wrist: [0, 0, 70] }), lh: P(0.25, 1.15, -0.15), lf: { p: [0.16, 0, 0.5] }, rf: { p: [-0.16, 0.05, -0.45], pitch: 30 } }],
      [84, {}],
    ],
  },
  rasenshuriken: {
    keys: [
      [0, {}],
      [16, { h: [0, -0.06, 0], hips: [-4, -20, 0], spine: [-10, -10, 0], chest: [-6, -10, 0], rh: P(-0.12, 1.85, 0.0, { open: 1, pole: [-1, 0, -1] }), lh: P(0.2, 1.2, 0.3) }, 'out'],
      [40, { h: [0, -0.08, 0], hips: [-6, -24, 0], spine: [-12, -12, 0], chest: [-8, -12, 0], rh: P(-0.12, 1.88, -0.05, { open: 1, pole: [-1, 0, -1] }), lh: P(0.2, 1.2, 0.3) }],
      [46, { h: [0, -0.12, 0.08], hips: [14, 20, 0], spine: [14, 16, 0], chest: [6, 10, 0], rh: P(-0.02, 1.3, 0.7, { open: 1, pole: [-1, -0.3, 0] }), lh: P(0.22, 1.1, -0.1), rf: { p: [-0.16, 0.05, -0.3], pitch: 30 } }, 'snap'],
      [64, {}],
    ],
  },
  victory: {
    keys: [[0, {}], [12, { h: [0, 0.02, 0], hips: [-4, 0, 0], spine: [-8, 0, 0], chest: [-4, 0, 0], lh: P(0.18, 1.0, 0.1, { fist: 1 }), rh: P(-0.12, 1.75, 0.2, { fist: 1, pole: [-1, 0, -1] }), lf: { p: [0.14, 0, 0.02] }, rf: { p: [-0.14, 0, -0.02] } }, 'snap'], [90, { h: [0, 0.02, 0], hips: [-4, 0, 0], spine: [-8, 0, 0], chest: [-4, 0, 0], lh: P(0.18, 1.0, 0.1, { fist: 1 }), rh: P(-0.12, 1.75, 0.2, { fist: 1, pole: [-1, 0, -1] }), lf: { p: [0.14, 0, 0.02] }, rf: { p: [-0.14, 0, -0.02] } }]],
  },
};
void LEAD;

/** Bakes every keyed clip for a rig into the library (mocap clips of the same id stay; see ClipLibrary.add). */
export function bakeMoves(rig, lib, H0) {
  // keyed clips win over mocap of the same id: a Mixamo attack needs a retime map onto the frame data first
  // (Madara's and Itachi's jutsu clips live in madaramoves.js / itachimoves.js, Itachi's M1 in itachim1.js, Naruto's jutsu
  // in narutomoves.js; every body gets them)
  for (const [id, def] of Object.entries({ ...MOVE_CLIPS, ...MADARA_CLIPS, ...ITACHI_CLIPS, ...ITACHI_M1_CLIPS, ...NARUTO_CLIPS })) lib.add(bakeClip(rig, id, def, H0), true);
}
