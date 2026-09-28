// Naruto: the one data file for his stats, movement, moves (frame data), hitboxes, damage and reactions.
// Shared by the client (gameplay, animation retiming, hit detection) and the server (validation, damage).
// Frames are simulation ticks at 60 Hz. Tune here; nothing else hard-codes these numbers.

const F = 60;

export const NARUTO = {
  id: 'naruto',
  name: 'Naruto',
  model: '/assets/characters/naruto.vrm',
  standin: '/assets/characters/standin.vrm', // drawn until naruto.vrm exists (ASSETS.md)
  card: { tag: 'THE ORIGINAL', credit: '' }, // title screen character card
  // which jutsu sits on which key (Q, E, G, R); the tool (1) is always the shuriken
  kit: { jutsu1: 'rasengan', jutsu2: 'clones', ult: 'rasenshuriken' },

  stats: {
    hp: 1000,
    chakra: 100,
    chakraRegen: 3, // per second, passive
    chakraCharge: 35, // per second while charging
    subPips: 3,
    subRegen: 8, // seconds per pip
    dashCharges: 2,
    dashRegen: 1.2, // seconds per charge
    toolCharges: 3, // shuriken
    toolRegen: 4, // seconds per shuriken
    ultDealt: 0.05, // ultimate gauge per point of damage dealt
    ultTaken: 0.035, // ...and taken
  },

  // body capsule (metres): radius, height; eye/chest heights for the camera and line-of-sight checks
  body: { radius: 0.34, height: 1.62, chest: 1.15, head: 1.5 },

  move: {
    run: 8,
    sprint: 12,
    sprintAfter: 0.5, // seconds of running before the ninja sprint kicks in
    walk: 2.2, // below this stick deflection the fighter walks (gamepad)
    accel: 60, // m/s^2 on the ground (0 -> run in ~0.13 s)
    decel: 48,
    turnRun: 16, // rad/s the travel direction can swing at run speed (tight)
    turnSprint: 4.2, // ...and at sprint (wide arcs)
    airAccel: 20,
    airDrag: 0.6,
    jump: 9.5,
    doubleJump: 9.0,
    gravity: 26,
    fallMul: 1.3, // heavier on the way down: snappy arcs
    maxFall: 38,
    coyote: 0.1,
    jumpBuffer: 0.12,
    step: 0.45, // ledges up to this height are stepped onto
    slopeLimit: 0.72, // rad (~41 deg): steeper ground slides the fighter off
    hardLand: 12, // falling faster than this (m/s) = hard landing (short recovery)
    dash: { speed: 18, time: 0.28, invuln: 0.15, airDashes: 1, endSpeed: 8 },
    wall: { speed: 9, drain: 8, minSteep: 60, kickOut: 7, kickUp: 8.5, stick: 0.12, vault: 6.5 },
    water: true,
    push: 6, // m/s push-apart between overlapping fighters
  },

  // M1 on the ground (LMB) starts one of two 5-hit strings: from a standstill or a walk the Uzumaki Barrage (U1-U5),
  // while running, sprinting or out of a dash the Scroll Rush (S1-S5). In the air it is the air combo (A1-A4).
  light: { stand: 'U1', moving: 'S1', movingSpeed: 5 },

  // Every move: startup/active/recovery in frames; `cancel` = first frame (from the move's start) the next input is
  // taken; `hitCancel` = earliest frame a dash/jutsu may cancel it once it has hit.
  // step: the move's own travel. d = metres with no target; with one within `track.range` it goes to `gap` short of
  //   it (at most `max`). The travel runs from frame `from` for `f` frames (default: 0, startup + 2), its speed going
  //   linearly from k[0] to k[1] times the mean (default [1.6, 0.4]: fast at first, easing into the strike).
  // leap: the move jumps (vy m/s, gravity scaled by g; aimed up at an airborne target when `aim`). air: the move
  //   hangs in the air like the air combo (gravity * hover). dive: at frame `at` the fighter drops (vy); the clip waits
  //   at frame `land` until the feet touch down (and skips ahead to it on an early landing).
  moves: {
    // ---- Uzumaki Barrage (M1 from a standstill): lunge straight, switch roundhouse, wind palm, flip heel drop,
    // whirlwind roundhouse. Each hit shoves the target a metre or more and the next one chases it.
    U1: {
      name: 'Lunge Straight', anim: 'u_lunge', kind: 'light', next: 'U2',
      startup: 8, active: 3, recovery: 14, cancel: 12, hitCancel: 12,
      step: { d: 1.6, from: 2, f: 8, k: [1.5, 0.5], track: { range: 6, max: 2.8, gap: 0.72 } },
      hit: { box: { cap: ['rightLowerArm', 'rightHand'], r: 0.17, ext: 0.1 }, dmg: 40, react: 'flinch', stun: 22, kb: [8, 0], hitstop: 4, reach: 2.2 },
      weight: 1,
    },
    U2: {
      name: 'Switch Roundhouse', anim: 'u_switch', kind: 'light', next: 'U3',
      startup: 9, active: 4, recovery: 15, cancel: 13, hitCancel: 13,
      step: { d: 1.4, from: 1, f: 9, k: [1.4, 0.6], track: { range: 6, max: 2.4, gap: 0.8 } },
      hit: { box: { cap: ['leftLowerLeg', 'leftFoot'], r: 0.21, ext: 0.12 }, dmg: 45, react: 'flinch', stun: 22, kb: [9, 0], hitstop: 5, reach: 2.4 },
      weight: 2,
    },
    U3: {
      name: 'Wind Palm', anim: 'u_windpalm', kind: 'light', next: 'U4',
      startup: 9, active: 3, recovery: 15, cancel: 13, hitCancel: 12,
      step: { d: 1.6, from: 3, f: 8, k: [1.5, 0.5], track: { range: 6, max: 2.6, gap: 0.72 } },
      hit: { box: { cap: ['rightLowerArm', 'rightHand'], r: 0.3, ext: 0.22 }, dmg: 55, react: 'stagger', stun: 26, kb: [14, 0], hitstop: 6, reach: 2.6 },
      weight: 2,
    },
    U4: {
      name: 'Flip Heel Drop', anim: 'u_flipkick', kind: 'light', next: 'U5',
      startup: 12, active: 4, recovery: 16, cancel: 17, hitCancel: 17,
      step: { d: 1.8, from: 2, f: 12, k: [1.2, 0.8], track: { range: 6, max: 2.8, gap: 0.8 } },
      hit: { box: { cap: ['rightLowerLeg', 'rightFoot'], r: 0.23, ext: 0.12 }, dmg: 60, react: 'stagger', stun: 24, kb: [6, 0], hitstop: 6, reach: 2.6 },
      weight: 3,
    },
    U5: {
      name: 'Whirlwind Roundhouse', anim: 'u_tornado', kind: 'light', next: null,
      startup: 13, active: 5, recovery: 24, cancel: 99, hitCancel: 20,
      step: { d: 1.6, from: 3, f: 12, k: [1.3, 0.7], track: { range: 6, max: 2.6, gap: 0.8 } },
      hit: { box: { cap: ['rightLowerLeg', 'rightFoot'], r: 0.24, ext: 0.14 }, dmg: 90, react: 'knockback', stun: 0, kb: [13, 6], hitstop: 8, reach: 2.6 },
      weight: 3,
    },

    // ---- Scroll Rush (M1 on the move): slide kick, scroll draw strike, grapple toss (launch), a leap after the target
    // with a rising scroll strike, a flipping scroll slam (spike). The scroll is in hand from S2 on; its hitbox is a
    // `grip` box: a capsule along the fist's grip axis (len past the thumb, back past the little finger, see hurtbox.js).
    S1: {
      name: 'Slide Kick', anim: 'r_slide', kind: 'light', next: 'S2',
      startup: 7, active: 6, recovery: 15, cancel: 14, hitCancel: 14,
      step: { d: 3.4, f: 16, k: [1.25, 0.75], track: { range: 8, max: 4.2, gap: 0.8 } },
      hit: { box: { cap: ['rightLowerLeg', 'rightFoot'], r: 0.26, ext: 0.12 }, dmg: 45, react: 'stagger', stun: 26, kb: [8, 0], hitstop: 5, reach: 2.6 },
      weight: 2,
    },
    S2: {
      name: 'Scroll Draw Strike', anim: 'r_draw', kind: 'light', next: 'S3',
      startup: 10, active: 4, recovery: 14, cancel: 14, hitCancel: 14,
      step: { d: 1.6, from: 2, f: 10, k: [1.4, 0.6], track: { range: 6, max: 2.6, gap: 0.8 } },
      hit: { box: { grip: 'rightHand', len: 0.62, back: 0.14, r: 0.2 }, dmg: 50, react: 'flinch', stun: 24, kb: [9, 0], hitstop: 5, reach: 2.8 },
      weight: 2,
    },
    S3: {
      name: 'Grapple Toss', anim: 'r_throw', kind: 'light', next: 'S4',
      startup: 9, active: 3, recovery: 17, cancel: 16, hitCancel: 16,
      step: { d: 1.0, from: 1, f: 9, k: [1.4, 0.6], track: { range: 5, max: 2.2, gap: 0.62 } },
      hit: { box: { cap: ['leftLowerArm', 'leftHand'], r: 0.28, ext: 0.1 }, dmg: 55, react: 'launch', stun: 0, kb: [2.5, 9.5], hitstop: 6, reach: 2.0 },
      weight: 2,
    },
    S4: {
      name: 'Rising Scroll', anim: 'r_rise', kind: 'light', next: 'S5',
      startup: 9, active: 4, recovery: 14, cancel: 13, hitCancel: 13,
      step: { d: 1.2, f: 11, k: [1.3, 0.7], track: { range: 6, max: 2.2, gap: 0.55 } },
      leap: { vy: 12.5, g: 1.5, aim: true },
      hit: { box: { grip: 'rightHand', len: 0.62, back: 0.14, r: 0.22 }, dmg: 45, react: 'flinch', stun: 22, kb: [2.5, 2.5], hitstop: 5, reach: 3.0 },
      weight: 2,
    },
    S5: {
      name: 'Scroll Meteor Slam', anim: 'r_slam', kind: 'light', next: null, air: true, hover: 0.25,
      startup: 14, active: 4, recovery: 22, cancel: 99, hitCancel: 22,
      step: { d: 0.8, track: { range: 5, max: 1.6, gap: 0.6, vertical: true } },
      dive: { at: 17, vy: -20, land: 22 },
      hit: { box: { grip: 'rightHand', len: 0.62, back: 0.14, r: 0.26 }, dmg: 85, react: 'spike', stun: 0, kb: [3, -16], hitstop: 8, reach: 3.0 },
      weight: 3,
    },

    // ---- the original light string: now only the Shadow Clone Rush's clones use it (jutsu.clones.clone.string)
    L1: {
      name: 'Jab', anim: 'jab', kind: 'light', next: 'L2',
      startup: 6, active: 3, recovery: 15, cancel: 8, hitCancel: 9,
      step: { d: 0.55, track: { range: 4, max: 2.2, gap: 0.62 } },
      hit: { box: { cap: ['leftLowerArm', 'leftHand'], r: 0.16, ext: 0.1 }, dmg: 40, react: 'flinch', stun: 20, kb: [1.6, 0], hitstop: 4, reach: 2.0 },
      weight: 1,
    },
    L2: {
      name: 'Cross', anim: 'cross', kind: 'light', next: 'L3',
      startup: 6, active: 3, recovery: 16, cancel: 8, hitCancel: 9,
      step: { d: 0.6, track: { range: 4, max: 2, gap: 0.62 } },
      hit: { box: { cap: ['rightLowerArm', 'rightHand'], r: 0.16, ext: 0.1 }, dmg: 45, react: 'flinch', stun: 21, kb: [1.8, 0], hitstop: 4, reach: 2.0 },
      weight: 1,
    },
    L3: {
      name: 'Knee', anim: 'knee', kind: 'light', next: 'L4',
      startup: 7, active: 4, recovery: 16, cancel: 10, hitCancel: 11,
      step: { d: 0.8, track: { range: 4, max: 2.2, gap: 0.48 } },
      hit: { box: { cap: ['rightUpperLeg', 'rightLowerLeg'], r: 0.2, ext: 0 }, dmg: 50, react: 'flinch', stun: 22, kb: [2, 1.5], hitstop: 5, reach: 1.9 },
      weight: 2,
    },
    L4: {
      name: 'Spin Kick', anim: 'spin_kick', kind: 'light', next: 'L5',
      startup: 9, active: 5, recovery: 17, cancel: 13, hitCancel: 14,
      step: { d: 0.7, track: { range: 4, max: 2, gap: 0.78 } },
      hit: { box: { cap: ['leftLowerLeg', 'leftFoot'], r: 0.2, ext: 0.12 }, dmg: 60, react: 'stagger', stun: 24, kb: [2.4, 0], hitstop: 5, reach: 2.4 },
      weight: 2,
    },
    L5: {
      name: 'Launch Kick', anim: 'roundhouse', kind: 'light', next: null,
      startup: 11, active: 5, recovery: 26, cancel: 99, hitCancel: 18,
      step: { d: 0.9, track: { range: 4, max: 2, gap: 0.68 } },
      hit: { box: { cap: ['rightLowerLeg', 'rightFoot'], r: 0.22, ext: 0.14 }, dmg: 90, react: 'knockback', stun: 0, kb: [12, 5.5], hitstop: 7, reach: 2.5 },
      weight: 3,
    },

    // air combo: 3 hits + a spike; the fighter hangs in the air while attacking
    A1: {
      name: 'Air Jab', anim: 'air_jab', kind: 'air', next: 'A2', hover: 0.15,
      startup: 5, active: 3, recovery: 13, cancel: 8, hitCancel: 9,
      step: { d: 0.5, track: { range: 4, max: 2, gap: 0.62, vertical: true } },
      hit: { box: { cap: ['leftLowerArm', 'leftHand'], r: 0.17, ext: 0.1 }, dmg: 35, react: 'flinch', stun: 22, kb: [1.2, 2.2], hitstop: 4, reach: 2.2 },
      weight: 1,
    },
    A2: {
      name: 'Air Kick', anim: 'air_kick', kind: 'air', next: 'A3', hover: 0.15,
      startup: 6, active: 4, recovery: 14, cancel: 10, hitCancel: 11,
      step: { d: 0.5, track: { range: 4, max: 2, gap: 0.66, vertical: true } },
      hit: { box: { cap: ['rightLowerLeg', 'rightFoot'], r: 0.2, ext: 0.1 }, dmg: 40, react: 'flinch', stun: 22, kb: [1.4, 2.4], hitstop: 4, reach: 2.4 },
      weight: 2,
    },
    A3: {
      name: 'Air Spin', anim: 'air_spin', kind: 'air', next: 'A4', hover: 0.15,
      startup: 7, active: 5, recovery: 14, cancel: 12, hitCancel: 13,
      step: { d: 0.5, track: { range: 4, max: 2, gap: 0.78, vertical: true } },
      hit: { box: { cap: ['leftLowerLeg', 'leftFoot'], r: 0.21, ext: 0.12 }, dmg: 45, react: 'flinch', stun: 24, kb: [1.4, 2.6], hitstop: 5, reach: 2.5 },
      weight: 2,
    },
    A4: {
      name: 'Spike', anim: 'air_spike', kind: 'air', next: null, hover: 0.4,
      startup: 10, active: 5, recovery: 22, cancel: 99, hitCancel: 16,
      step: { d: 0.4, track: { range: 4, max: 1.6, gap: 0.7, vertical: true } },
      hit: { box: { cap: ['rightLowerLeg', 'rightFoot'], r: 0.24, ext: 0.12 }, dmg: 80, react: 'spike', stun: 0, kb: [3, -16], hitstop: 7, reach: 2.6 },
      weight: 3,
    },

    // hold LMB: guard-breaking axe kick
    H: {
      name: 'Axe Kick', anim: 'axe_kick', kind: 'heavy', next: null,
      startup: 16, active: 4, recovery: 28, cancel: 99, hitCancel: 26,
      step: { d: 1.2, track: { range: 4.5, max: 2.6, gap: 0.72 } },
      hit: { box: { cap: ['rightLowerLeg', 'rightFoot'], r: 0.26, ext: 0.16 }, dmg: 120, react: 'knockback', stun: 0, kb: [14, 3.5], hitstop: 8, reach: 2.6, guardBreak: true },
      weight: 4,
      armor: false,
    },
  },

  // Jutsu and tools (cost in chakra, cooldown in seconds)
  jutsu: {
    shuriken: {
      name: 'Shuriken', anim: 'throw', layer: 'upper', startup: 7, recovery: 12,
      proj: { speed: 42, life: 0.9, radius: 0.28, homing: 5.5, spin: 40 },
      hit: { dmg: 40, react: 'flinch', stun: 12, kb: [1, 0], hitstop: 3, reach: 40 },
    },
    rasengan: {
      name: 'Rasengan', key: 'Q', cost: 30, cd: 8, anim: 'rasengan',
      windup: 18, lunge: { speed: 26, time: 0.36, dist: 9 }, recovery: 30,
      grind: { ticks: 5, every: 6, dmg: 30, stun: 30 }, // multi-hit while the victim is held in front
      hit: { box: { local: [0.1, 1.1, 0.75], r: 0.6 }, dmg: 110, react: 'launch', stun: 0, kb: [15, 9], hitstop: 10, reach: 3.2 },
    },
    clones: {
      name: 'Shadow Clone Rush', key: 'E', cost: 35, cd: 12, anim: 'handsign', cast: 20,
      clone: { count: 2, speed: 16, life: 3, radius: 0.34, string: ['L1', 'L2', 'L5'] },
      // reach: how far from the caster a clone may land its hits (it rushes the target)
      hit: { dmg: 40, react: 'flinch', stun: 20, kb: [1.8, 0], hitstop: 3, reach: 30 },
      last: { dmg: 70, react: 'knockback', stun: 0, kb: [10, 5], hitstop: 5, reach: 30 },
    },
    rasenshuriken: {
      name: 'Rasenshuriken', key: 'R', ult: true, icon: 'ult', anim: 'rasenshuriken', cast: 40, recovery: 24,
      proj: { speed: 22, life: 2.5, radius: 0.9, homing: 1.2, spin: 30 },
      burst: { radius: 4, ticks: 8, every: 5, dmg: 40, stun: 40 },
      hit: { dmg: 130, react: 'knockback', stun: 0, kb: [16, 11], hitstop: 12, reach: 60, guardBreak: true },
    },
  },

  // Hit reactions: frames of the reaction animation (stun comes from the move and the combo rules)
  react: {
    flinch: { anim: ['hit_head', 'hit_body'] },
    stagger: { anim: ['stagger'] },
    guard: { stun: 14, chakra: 4 },
    guardBreak: { stun: 60 },
    launch: { anim: 'launch' },
    knockback: { anim: 'knock_back', wallBounce: 0.45 },
    spike: { anim: 'knock_back' },
    down: { lie: 36, getup: 34, invuln: 0.6, tech: 0.25 },
    sub: { dist: 6, invuln: 0.4 },
  },
};

// Anti-infinite rules (every character): damage scaling and hitstun decay by combo count, forced knockdown.
export const COMBO = {
  scalePer: 0.08,
  scaleFloor: 0.4,
  stunDecay: 0.045,
  stunFloor: 0.55,
  maxHits: 12,
  maxTime: 3.5, // seconds of continuous combo
  window: 1.0, // seconds after the last hit's stun ends before the combo counter resets
};

export const FRAME = 1 / F;
