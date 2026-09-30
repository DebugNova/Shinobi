// Naruto's jutsu clips (Jiraiya training era: src/shared/naruto.js, src/game/naruto.js), keyframes.js format, baked
// per body with every other keyed move (bakeMoves). Frames at 60 Hz laid on the kit's timings; fighter frame: +z
// forward, +x his LEFT, y up, reference-body metres; hand targets are wrists placed from the shoulders (gotchas 34, 52).
//   kb_seal     Shadow Clone Jutsu: the cross seal (the clones burst out of the smoke round him)
//   ras_charge  the Rasengan forming over his right palm, the left hand steadying the wrist (a clone shapes it:
//               ras_helper); ras_dash the charge holding it out; ras_hit the blast (braced through the hitstop);
//               ras_whiff a skid with nothing there
//   nr_rush     the Rush's seal, held while the clones charge; nr_drop its finisher (the NR move: from a crouch)
//   cr_*        the Rush's clones: crouched beside him before they set off (cr_ready), then out of the ninja sprint
//               (the gait) a flying punch, a spinning roundhouse, the sliding launch kick (each strikes at frame 6);
//               cr_knee is kept for tools
//   cd_*        the substitution: the seal, the decoy standing in his place, re-forming out of the smoke
const P = (x, y, z, o = {}) => ({ p: [x, y, z], ...o });

// hand signs (per-finger curls: index, middle, ring, little): two fingers up
const TWO = { fingers: [0, 0, 1, 1], thumb: 0.65, spread: -4 };
// the cross seal: the right hand's two fingers up before the chest, the left hand's across them (pointing to his right)
const crossR = (y = 1.2, z = 0.3) => P(-0.03, y, z, { pole: [-1, -0.4, 0], wrist: [0, 60, -70], ...TWO });
const crossL = (y = 1.24, z = 0.33) => P(0.05, y, z, { pole: [1, -0.8, 0.2], wrist: [0, -20, 0], ...TWO });
const WIDE = { lf: { p: [0.2, 0, 0.26], pole: [0.3, 0, 1], yaw: -10 }, rf: { p: [-0.2, 0, -0.24], yaw: 26 } };
const SEAL = { h: [0, -0.12, 0.02], hips: [6, -6, 0], spine: [8, 2, 0], chest: [4, 2, 0], neck: [-6, 0, 0], head: [-4, 0, 0], lh: crossL(), rh: crossR(), ...WIDE };

// in the air: legs tucked under (the root is the body's feet point while airborne)
const AIR = {
  h: [0, 0.05, 0],
  lf: { p: [0.12, 0.3, 0.2], pole: [0, 0.3, 1], pitch: 20 },
  rf: { p: [-0.12, 0.18, -0.15], pole: [0, 0.3, 1], pitch: 30 },
};

// flips: limb targets in the body frame of a pose turned forward by `tilt` degrees about its hips (see itachim1.js)
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
const flip = (tilt, h, { lf, rf, lh, rh, ...rest }) => ({
  tilt, h, ...rest,
  lf: FF(tilt, h, ...lf), rf: FF(tilt, h, ...rf), lh: FH(tilt, h, ...lh), rh: FH(tilt, h, ...rh),
});

// ------------------------------------------------------------------ Q: Shadow Clone Jutsu (30 f)
// hands come together fast (0-6), the seal snaps in and he sinks into it as the smoke bursts (8), held while the
// clones pop out round him (9-15), let go (22-30)
const kb_seal = {
  keys: [
    [0, {}],
    [4, { h: [0, -0.06, 0], hips: [4, -10, 0], spine: [4, 0, 0], lh: P(0.1, 1.16, 0.3, { open: 0.5, pole: [1, -0.5, 0] }), rh: P(-0.1, 1.14, 0.3, { open: 0.5, pole: [-1, -0.5, 0] }), ...WIDE }, 'out'],
    [7, SEAL, 'snap'],
    [10, { ...SEAL, h: [0, -0.15, 0.02], spine: [10, 2, 0], neck: [-8, 0, 0], lh: crossL(1.23), rh: crossR(1.19) }, 'out'],
    [20, { ...SEAL, h: [0, -0.13, 0.02], lh: crossL(1.24), rh: crossR(1.2) }, 'io'],
    [30, {}, 'io'],
  ],
};

// ------------------------------------------------------------------ E: Rasengan
// the right palm up before him at the waist, fingers spread round the sphere; the left hand holds the right wrist
const PALM = (y = 1.04, z = 0.4) => P(-0.2, y, z, { open: 1, spread: 10, pole: [-1, -0.6, 0], wrist: [0, 0, 60] });
const GRIP = (y = 1.0, z = 0.3) => P(-0.1, y, z, { open: 0.7, pole: [1, -0.8, -0.2] });
const CHARGE = {
  h: [0, -0.16, 0.02], hips: [8, -26, 0], spine: [10, -8, 0], chest: [6, -6, 0], neck: [8, 10, 0], head: [10, 8, 0],
  lh: GRIP(), rh: PALM(), lf: { p: [0.22, 0, 0.3], pole: [0.3, 0, 1], yaw: -18 }, rf: { p: [-0.2, 0, -0.26], yaw: 30 },
};
// the charge: forming (0-18), then held with the strain of it (a tremble that grows), up to its 96-frame cap
const tremble = (f, k) => [f, { ...CHARGE, h: [0, -0.16 - 0.012 * k, 0.02], chest: [6 + 2 * k, -6, 0], rh: PALM(1.04 + 0.006 * k, 0.4), lh: GRIP(1.0 + 0.006 * k, 0.3) }, 'io'];
const ras_charge = {
  keys: [
    [0, {}],
    [6, { h: [0, -0.08, 0], hips: [4, -16, 0], spine: [4, -4, 0], rh: P(-0.26, 1.08, 0.26, { open: 0.6, pole: [-1, -0.5, 0] }), lh: P(0.04, 1.08, 0.3, { open: 0.6, pole: [1, -0.6, 0] }), ...WIDE }, 'out'],
    [14, CHARGE, 'io'],
    [18, { ...CHARGE, rh: PALM(1.05, 0.41) }, 'io'],
    tremble(28, -1), tremble(36, 1), tremble(44, -1), tremble(50, 2), tremble(56, -2), tremble(62, 2), tremble(68, -2),
    tremble(74, 3), tremble(80, -3), tremble(86, 3), tremble(92, -3), tremble(96, 3),
  ],
};
// the dash: low, leaning into it, the sphere thrust ahead in the right hand, the left arm swept back, the legs in a
// gliding lunge (the body covers 24 m/s: a run cycle would blur; the anime draws it as one stretched pose)
const DASH = {
  h: [0, -0.22, 0.1], hips: [24, 12, 0], spine: [16, 8, 0], chest: [8, 6, 0], neck: [-24, -8, 0], head: [-14, -6, 0],
  rh: P(-0.08, 1.12, 0.66, { open: 1, spread: 10, pole: [-1, -0.4, 0], wrist: [0, 0, 70] }), lh: P(0.34, 0.9, -0.3, { open: 0.3, pole: [1, 0.2, 1] }),
  lf: { p: [0.14, 0.06, 0.44], pole: [0.2, 0.2, 1], pitch: -10 }, rf: { p: [-0.14, 0.28, -0.58], pole: [0, 0, 1], pitch: 55 },
};
const ras_dash = {
  keys: [
    [0, CHARGE],
    [4, { ...DASH, h: [0, -0.18, 0.08] }, 'out'],
    [10, DASH, 'io'],
    [18, { ...DASH, h: [0, -0.2, 0.1], rf: { p: [-0.14, 0.3, -0.6], pole: [0, 0, 1], pitch: 60 } }, 'io'],
    [26, DASH, 'io'],
  ],
};
// the blast: the arm drives the sphere in (0-3), braced as it grinds (through the hitstop: a shudder), the blast
// throws the arm up and him back a step (16-20), he recovers (40)
const DRIVE = {
  h: [0, -0.24, 0.14], hips: [18, 22, 0], spine: [18, 16, 0], chest: [8, 12, 0], neck: [-22, -14, 0], head: [-12, -10, 0],
  rh: P(-0.02, 1.16, 0.74, { open: 1, spread: 10, pole: [-1, -0.3, 0], wrist: [0, 0, 70] }), lh: P(0.3, 1.0, -0.2, { fist: 0.8 }),
  lf: { p: [0.18, 0, 0.5], pole: [0.2, 0, 1], yaw: -8 }, rf: { p: [-0.18, 0.04, -0.46], pitch: 35, yaw: 28 },
};
const ras_hit = {
  keys: [
    [0, { ...DRIVE, h: [0, -0.22, 0.1], rh: P(-0.04, 1.14, 0.68, { open: 1, spread: 10, pole: [-1, -0.3, 0], wrist: [0, 0, 70] }) }],
    [3, DRIVE, 'snap'],
    [6, { ...DRIVE, h: [0, -0.25, 0.15], chest: [9, 13, 0] }, 'io'],
    [9, { ...DRIVE, h: [0, -0.24, 0.13], chest: [7, 11, 0] }, 'io'],
    [12, { ...DRIVE, h: [0, -0.25, 0.15], chest: [9, 13, 0] }, 'io'],
    [15, DRIVE, 'io'],
    [20, { ...DRIVE, h: [0, -0.18, 0.02], hips: [6, 18, 0], spine: [2, 12, 0], chest: [-4, 10, 0], neck: [-8, -10, 0], rh: P(-0.08, 1.4, 0.6, { open: 1, spread: 12, pole: [-1, -0.3, 0] }) }, 'snap'],
    [28, { h: [0, -0.14, 0], hips: [6, -10, 0], spine: [6, 2, 0], rh: P(-0.12, 1.22, 0.3, { open: 0.6, pole: [-1, -1, 0] }), lh: P(0.14, 1.24, 0.3, { fist: 0.8 }), lf: { p: [0.18, 0, 0.36] }, rf: { p: [-0.18, 0, -0.3], yaw: 26 } }, 'io'],
    [40, {}, 'io'],
  ],
};
// nothing there: the feet skid, the body rears back to brake, the sphere comes back in and fizzles
const ras_whiff = {
  keys: [
    [0, DASH],
    [6, { h: [0, -0.26, -0.04], hips: [-8, 20, 0], spine: [-6, 10, 0], chest: [-4, 8, 0], neck: [6, -8, 0], rh: P(-0.18, 1.1, 0.4, { open: 1, pole: [-1, -0.5, 0], wrist: [0, 0, 60] }), lh: P(0.34, 1.0, 0.1, { open: 0.6 }), lf: { p: [0.2, 0, 0.5], pole: [0.3, 0.2, 1], pitch: -20 }, rf: { p: [-0.2, 0, -0.34], yaw: 30 } }, 'out'],
    [14, { h: [0, -0.18, -0.02], hips: [2, 0, 0], rh: P(-0.2, 1.04, 0.3, { open: 0.5, pole: [-1, -0.5, 0] }), lh: P(0.2, 1.1, 0.2, { open: 0.5 }), lf: { p: [0.2, 0, 0.36] }, rf: { p: [-0.2, 0, -0.26], yaw: 26 } }, 'io'],
    [24, {}, 'io'],
  ],
};
// the helper clone (his Jiraiya-era Rasengan: a clone shapes it): facing him beside the sphere, both hands cupped
// round it, churning (one over, one under, swapping)
const CUP = (a) => {
  const c = Math.cos(a), s = Math.sin(a);
  return {
    lh: P(0.07 + 0.05 * c, 1.1 + 0.07 * s, 0.4, { open: 0.8, spread: 8, pole: [1, -0.4, -0.4], wrist: [0, -30, 40] }),
    rh: P(-0.07 - 0.05 * c, 1.1 - 0.07 * s, 0.4, { open: 0.8, spread: 8, pole: [-1, -0.4, -0.4], wrist: [0, 30, -40] }),
  };
};
const HELP = { h: [0, -0.2, 0.02], hips: [12, 0, 0], spine: [12, 0, 0], chest: [6, 0, 0], neck: [10, 0, 0], head: [12, 0, 0], ...WIDE };
const ras_helper = {
  keys: [0, 6, 12, 18, 24].map((f, k) => [f, { ...HELP, ...CUP((k / 4) * Math.PI * 2) }, 'io']),
  loop: true,
};

// ------------------------------------------------------------------ X: Shadow Clone Rush
// Naruto: the seal snaps in (0-5) as the clones appear beside him, held (a slow breath, sinking into it) while they
// charge and strike: up to the Rush's 2.2 s. The finisher (nr_drop) starts from CROUCH whenever the launch lands.
const SEAL_DEEP = { ...SEAL, h: [0, -0.16, 0.03], spine: [11, 2, 0], neck: [-10, 0, 0], head: [-6, 0, 0], lh: crossL(1.22), rh: crossR(1.18) };
const SEAL_UP = { ...SEAL, h: [0, -0.13, 0.02], lh: crossL(1.24), rh: crossR(1.2) };
const nr_rush = {
  keys: [
    [0, {}],
    [5, SEAL, 'snap'],
    [9, SEAL_DEEP, 'out'],
    ...[40, 70, 100, 132].map((f, k) => [f, k % 2 ? SEAL_DEEP : SEAL_UP, 'io']),
  ],
};
const CROUCH = {
  h: [0, -0.36, 0.08], hips: [26, 0, 0], spine: [18, 0, 0], chest: [8, 0, 0], neck: [-26, 0, 0], head: [-14, 0, 0],
  lh: P(0.3, 0.72, 0.3, { open: 0.8 }), rh: P(-0.3, 0.72, 0.3, { open: 0.8 }), lf: { p: [0.18, 0, 0.24] }, rf: { p: [-0.18, 0, -0.18], pitch: 25 },
};
// NR Uzumaki Barrage Drop (34/5/24, dive at 37, lands at 44): he springs (0-6) and is gone in smoke (6-16: hidden, the
// warp); he re-forms over the victim tucked in a front flip (16-26), unfolds with the right leg raised straight overhead
// (30), the heel chops down through it (34), the dive, a kneeling landing with the fist in the ground
const RAISED = {
  h: [0, 0.05, -0.04], hips: [-14, -10, 0], spine: [-12, 0, 0], chest: [-6, 0, 0], neck: [10, 0, 0], head: [6, 0, 0],
  rf: { p: [-0.02, 1.62, 0.4], pole: [0, 1, 0.4], pitch: -45 }, lf: { p: [0.12, 0.25, 0.05], pole: [0, 0.3, 1], pitch: 30 },
  lh: P(0.36, 1.42, 0.1, { open: 0.5 }), rh: P(-0.36, 1.44, 0.05, { open: 0.5 }),
};
const CHOP = {
  h: [0, -0.1, 0.12], hips: [22, -6, 0], spine: [18, 0, 0], chest: [10, 0, 0], neck: [-20, 0, 0], head: [-8, 0, 0],
  rf: { p: [-0.02, 0.34, 0.74], pole: [0, 0.3, 1], pitch: 30 }, lf: { p: [0.12, 0.2, -0.1], pole: [0, 0.3, 1], pitch: 30 },
  lh: P(0.26, 1.0, 0.22, { fist: 0.8 }), rh: P(-0.26, 1.0, 0.16, { fist: 0.8 }),
};
const FALL = {
  h: [0, 0.02, 0.04], hips: [10, 0, 0], spine: [8, 0, 0], neck: [-8, 0, 0],
  lf: { p: [0.15, 0.15, 0.28], pole: [0, 0.3, 1], pitch: 10 }, rf: { p: [-0.15, 0.2, -0.2], pole: [0, 0.3, 1], pitch: 30 },
  lh: P(0.42, 1.3, 0.1, { open: 0.6 }), rh: P(-0.42, 1.3, 0.05, { open: 0.6 }),
};
const KNEEL = {
  h: [0, -0.5, 0.1], hips: [22, 0, 0], spine: [20, 0, 0], chest: [10, 0, 0], neck: [-22, 0, 0], head: [-10, 0, 0],
  lf: { p: [0.17, 0, 0.36] }, rf: { p: [-0.15, 0, -0.34], pitch: 70 },
  rh: P(-0.1, 0.3, 0.56, { fist: 1, pole: [-1, 1, 0] }), lh: P(0.46, 0.74, 0.02, { open: 1, pole: [1, 0, -0.4] }),
};
const TUCK = { spine: [16, 0, 0], chest: [10, 0, 0], neck: [6, 0, 0], lf: [0.1, -0.3, 0.16, { pitch: 30 }], rf: [-0.1, -0.28, 0.18, { pitch: 30 }], lh: [0.16, 0.05, 0.3, { fist: 0.7 }], rh: [-0.16, 0.05, 0.3, { fist: 0.7 }] };
const nr_drop = {
  keys: [
    [0, CROUCH],
    [4, { h: [0, 0.04, 0.02], hips: [-6, 0, 0], spine: [-8, 0, 0], neck: [6, 0, 0], lh: P(0.34, 1.2, -0.1, { open: 0.6 }), rh: P(-0.34, 1.2, -0.1, { open: 0.6 }), lf: { p: [0.12, 0.08, 0.1], pitch: 50 }, rf: { p: [-0.12, 0.1, -0.1], pitch: 55 } }, 'snap'],
    [6, { ...AIR, h: [0, 0.1, 0], lh: P(0.3, 1.3, 0.1, { open: 0.6 }), rh: P(-0.3, 1.3, 0.1, { open: 0.6 }) }, 'out'],
    [16, flip(120, [0, 0.3, 0.04], TUCK)],
    [22, flip(230, [0, 0.34, 0.04], TUCK), 'lin'],
    [27, flip(330, [0, 0.2, 0.04], { ...TUCK, lf: [0.1, -0.4, 0.14, { pitch: 20 }], rf: [-0.1, -0.2, 0.34, { pitch: 10 }] }), 'lin'],
    [30, { ...RAISED, tilt: 360 }, 'out'],
    [32, { ...RAISED, tilt: 360, rf: { p: [-0.02, 1.7, 0.46], pole: [0, 1, 0.4], pitch: -40 } }, 'io'],
    [34, { ...CHOP, tilt: 360 }, 'snap'],
    [38, { ...CHOP, tilt: 360, rf: { p: [-0.02, 0.12, 0.64], pole: [0, 0.3, 1], pitch: 30 } }, 'lin'],
    [41, { ...FALL, tilt: 360 }, 'io'],
    [44, { ...KNEEL, tilt: 360 }, 'snap'],
    [50, { ...KNEEL, tilt: 360, h: [0, -0.48, 0.1], rh: P(-0.12, 0.34, 0.52, { fist: 1, pole: [-1, 1, 0] }) }],
    [63, { tilt: 360 }, 'io'],
  ],
};

// the Rush's clones: they pop in crouched and waiting (cr_ready), sprint in (the gait), and each strike clip starts in
// the sprint's lean (RUNIN: arms swept back, mid-stride) and hits at 6
const READY = {
  h: [0, -0.36, 0.04], hips: [22, -10, 0], spine: [16, 4, 0], chest: [8, 4, 0], neck: [-22, 4, 0], head: [-12, 4, 0],
  lh: P(0.2, 0.9, 0.36, { fist: 0.9, pole: [1, -1, 0] }), rh: P(-0.26, 0.5, 0.2, { open: 0.9, pole: [-1, 0.4, 0] }),
  lf: { p: [0.2, 0, 0.3], pole: [0.3, 0, 1], yaw: -12 }, rf: { p: [-0.18, 0, -0.24], pitch: 40, yaw: 28 },
};
const cr_ready = { keys: [[0, READY], [20, { ...READY, h: [0, -0.34, 0.04] }, 'io'], [40, READY, 'io']], loop: true };
const RUNIN = {
  h: [0, -0.14, 0.1], hips: [18, 0, 0], spine: [14, 0, 0], chest: [6, 0, 0], neck: [-18, 0, 0], head: [-8, 0, 0],
  lh: P(0.28, 0.9, -0.3, { open: 0.3, pole: [1, 0.3, -0.2] }), rh: P(-0.28, 0.9, -0.3, { open: 0.3, pole: [-1, 0.3, -0.2] }),
  lf: { p: [0.12, 0.08, 0.36], pole: [0, 0.3, 1] }, rf: { p: [-0.12, 0.26, -0.44], pole: [0, 0, 1], pitch: 50 },
};
const LUNGE = { h: [0, -0.1, 0.14], hips: [20, 0, 0], spine: [14, 0, 0], chest: [6, 0, 0], neck: [-20, 0, 0], head: [-10, 0, 0], lf: { p: [0.12, 0.3, 0.3], pole: [0, 0.4, 1], pitch: 10 }, rf: { p: [-0.12, 0.3, -0.5], pole: [0, 0, 1], pitch: 60 } };
const cr_punch = {
  keys: [
    [0, RUNIN],
    [3, { ...LUNGE, rh: P(-0.2, 1.16, 0.0, { fist: 1, pole: [-1, -0.2, -1] }), lh: P(0.2, 1.2, 0.4, { open: 0.6 }) }, 'out'],
    [6, { h: [0, -0.16, 0.1], hips: [10, 30, 0], spine: [8, 16, 0], chest: [6, 16, 0], upperChest: [0, 6, 0], neck: [-10, -24, 0], head: [-6, -20, 0], rh: P(0.03, 1.3, 0.84, { fist: 1, pole: [-1, -0.5, -0.2] }), lh: P(0.12, 1.28, 0.14, { fist: 1 }), lf: { p: [0.17, 0, 0.5] }, rf: { p: [-0.2, 0.06, -0.5], pitch: 45, yaw: 35 } }, 'snap'],
    [10, { h: [0, -0.16, 0.1], hips: [10, 30, 0], spine: [8, 16, 0], chest: [6, 16, 0], upperChest: [0, 6, 0], neck: [-10, -24, 0], head: [-6, -20, 0], rh: P(0.03, 1.3, 0.8, { fist: 1, pole: [-1, -0.5, -0.2] }), lh: P(0.12, 1.28, 0.14, { fist: 1 }), lf: { p: [0.17, 0, 0.5] }, rf: { p: [-0.2, 0.06, -0.5], pitch: 45, yaw: 35 } }],
    [20, { h: [0, -0.12, 0.04], hips: [6, -8, 0], rh: P(-0.07, 1.23, 0.3, { fist: 1 }), lh: P(0.13, 1.28, 0.3, { fist: 0.9 }) }, 'io'],
  ],
};
const cr_kick = {
  keys: [
    [0, RUNIN],
    [3, { rot: 150, h: [0, 0.2, 0.06], hips: [-4, 0, 0], lf: { p: [0.12, 0.62, 0.2], pole: [0, 0.4, 1], pitch: 20 }, rf: { p: [-0.12, 0.28, -0.1], pitch: 40 }, lh: P(0.3, 1.5, 0.1, { open: 0.4 }), rh: P(-0.25, 1.45, 0.1, { open: 0.4 }) }, 'in'],
    [6, { rot: 335, h: [0, 0.3, 0.04], hips: [-6, 0, -18], spine: [-4, 0, -8], chest: [0, 8, 0], neck: [-4, 12, 0], head: [-6, 12, 0], rf: { p: [0.2, 1.3, 0.66], pole: [0.3, 1, 0], pitch: -10, yaw: 25 }, lf: { p: [0.14, 0.62, 0.1], pole: [0, 0.3, 1], pitch: 30 }, lh: P(0.45, 1.25, -0.15, { open: 0.4 }), rh: P(-0.2, 1.3, 0.25, { fist: 1 }) }, 'snap'],
    [10, { rot: 380, h: [0, 0.2, 0.04], hips: [-6, 0, -18], spine: [-4, 0, -8], chest: [0, 8, 0], rf: { p: [0.2, 1.22, 0.62], pole: [0.3, 1, 0], pitch: -10, yaw: 25 }, lf: { p: [0.14, 0.52, 0.1], pole: [0, 0.3, 1], pitch: 30 }, lh: P(0.45, 1.25, -0.15, { open: 0.4 }), rh: P(-0.2, 1.3, 0.25, { fist: 1 }) }, 'lin'],
    [20, { rot: 360, h: [0, -0.2, 0.02], hips: [12, 0, 0], spine: [10, 0, 0], lf: { p: [0.18, 0, 0.14] }, rf: { p: [-0.18, 0, -0.2], pitch: 15 }, lh: P(0.4, 1.0, 0.1, { open: 0.5 }), rh: P(-0.36, 1.05, 0.15, { open: 0.5 }) }, 'io'],
  ],
};
const cr_knee = {
  keys: [
    [0, READY],
    [3, { ...LUNGE, h: [0, 0.1, 0.1], lh: P(0.14, 1.36, 0.5, { open: 0.6 }), rh: P(-0.12, 1.36, 0.5, { open: 0.6 }) }, 'out'],
    [6, { h: [0, 0.2, 0.08], hips: [-8, -4, 0], spine: [-4, 0, 0], chest: [10, 0, 0], neck: [-6, 0, 0], lf: { p: [0.08, 0.1, -0.1], pitch: 40 }, rf: { p: [-0.06, 0.66, 0.14], pole: [0, 0.6, 1], pitch: 50 }, lh: P(0.1, 1.3, 0.46, { fist: 0.9 }), rh: P(-0.08, 1.3, 0.46, { fist: 0.9 }) }, 'snap'],
    [10, { h: [0, 0.16, 0.08], hips: [-8, -4, 0], spine: [-4, 0, 0], chest: [10, 0, 0], neck: [-6, 0, 0], lf: { p: [0.08, 0.08, -0.1], pitch: 40 }, rf: { p: [-0.06, 0.62, 0.16], pole: [0, 0.6, 1], pitch: 50 }, lh: P(0.1, 1.28, 0.44, { fist: 0.9 }), rh: P(-0.08, 1.28, 0.44, { fist: 0.9 }) }],
    [20, { h: [0, -0.16, 0.04], hips: [10, -8, 0], rf: { p: [-0.14, 0, -0.1], pitch: 10 } }, 'io'],
  ],
};
// the launcher: slides in low under the target, plants the hands, and the right leg shoots straight up through it
const cr_launch = {
  keys: [
    [0, RUNIN],
    [3, { tilt: -20, h: [0, -0.46, 0.04], hips: [-6, 0, 0], spine: [2, 0, 0], neck: [16, 0, 0], lf: { p: [0.14, 0, 0.3], pitch: 10 }, rf: { p: [-0.12, 0.14, 0.4], pole: [0, 0.5, 1], pitch: -20 }, lh: P(0.3, 0.5, -0.1, { open: 0.9 }), rh: P(-0.3, 0.5, -0.1, { open: 0.9 }) }, 'out'],
    [6, { h: [0, -0.2, -0.06], hips: [-22, 0, 0], spine: [-16, 0, 0], chest: [-8, 0, 0], neck: [14, 0, 0], head: [10, 0, 0], rf: { p: [-0.04, 1.72, 0.4], pole: [0, 1, 0.2], pitch: -50 }, lf: { p: [0.12, 0, 0.1], pitch: 20 }, lh: P(0.36, 1.0, -0.24, { open: 0.8 }), rh: P(-0.36, 1.0, -0.24, { open: 0.8 }) }, 'snap'],
    [11, { h: [0, -0.18, -0.06], hips: [-22, 0, 0], spine: [-16, 0, 0], chest: [-8, 0, 0], neck: [14, 0, 0], head: [10, 0, 0], rf: { p: [-0.04, 1.66, 0.38], pole: [0, 1, 0.2], pitch: -50 }, lf: { p: [0.12, 0, 0.1], pitch: 30 }, lh: P(0.36, 1.0, -0.24, { open: 0.8 }), rh: P(-0.36, 1.0, -0.24, { open: 0.8 }) }],
    [22, { h: [0, -0.1, 0.02], hips: [6, -10, 0], rf: { p: [-0.12, 0.2, 0.3], pitch: 10 } }, 'io'],
  ],
};

// ------------------------------------------------------------------ G: Shadow Clone Substitution
// a one-handed seal before the chest (0-3: the smoke takes him), held by the clone standing in his place
const cd_seal = {
  keys: [
    [0, {}],
    [3, { h: [0, -0.1, 0], hips: [4, -14, 0], spine: [6, 4, 0], lh: P(0.14, 1.28, 0.3, { fist: 0.9 }), rh: crossR(1.22, 0.3), ...WIDE }, 'snap'],
    [32, { h: [0, -0.1, 0], hips: [4, -14, 0], spine: [6, 4, 0], lh: P(0.14, 1.28, 0.3, { fist: 0.9 }), rh: crossR(1.22, 0.3), ...WIDE }],
  ],
};
const cd_decoy = { keys: [[0, cd_seal.keys[1][1]], [30, { ...cd_seal.keys[1][1], h: [0, -0.11, 0] }, 'io'], [60, cd_seal.keys[1][1], 'io']], loop: true };
// out of the smoke: landing crouched, weight forward, fists up (behind the attacker: ready to hit), up into the stance
const cd_appear = {
  keys: [
    [0, { h: [0, -0.38, 0.06], hips: [24, -14, 0], spine: [16, 6, 0], chest: [8, 6, 0], neck: [-24, 4, 0], head: [-12, 4, 0], lh: P(0.2, 0.96, 0.4, { fist: 0.9 }), rh: P(-0.16, 0.9, 0.3, { fist: 0.9 }), lf: { p: [0.2, 0, 0.3], pole: [0.3, 0, 1], yaw: -12 }, rf: { p: [-0.18, 0, -0.24], pitch: 40, yaw: 28 } }],
    [8, { h: [0, -0.2, 0.04], hips: [10, -18, 0], spine: [8, 6, 0], lh: P(0.14, 1.24, 0.32, { fist: 0.9 }), rh: P(-0.1, 1.16, 0.2, { fist: 0.9 }) }, 'out'],
    [16, {}, 'io'],
  ],
};

export const NARUTO_CLIPS = {
  kb_seal, ras_charge, ras_dash, ras_hit, ras_whiff, ras_helper, nr_rush, nr_drop,
  cr_ready, cr_punch, cr_kick, cr_knee, cr_launch, cd_seal, cd_decoy, cd_appear,
};
