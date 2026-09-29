// Itachi Uchiha: Naruto's body mechanics (stats, movement, heavy, reactions) with his own M1 strings (ITACHI_MOVES) and
// jutsu kit. The one data file for his abilities; shared by the client (gameplay, effects, hit detection) and the
// server (validation, damage). Frames are 60 Hz ticks; distances in metres. Tune here.
//   Q  Phoenix Sage Fire   three fireballs blown one after another; each homes on the target until it dashes
//   E  Tsukuyomi           a Mangekyō gaze: everyone in front of him is marked and stunned for 5 s (genjutsu)
//   G  Crow Clone Escape   his body bursts into crows and he re-forms at the safest spot nearby (invulnerable)
//   R  Amaterasu           everyone in front of him bursts into black flames that burn 50% of their health away
// Geometry that must match on the client and the server lives in itachikit.js (built from these numbers).
import { NARUTO } from './naruto.js';

// The kunai in his right fist (I3-I4, R3-R5, IA2): a grip box along the fist's grip axis, the blade `len` past the
// thumb, the handle `back` past the little finger (drawn there: movefx.js PROPS.kunai uses the same numbers).
const KUNAI = { grip: 'rightHand', len: 0.5, back: 0.1, r: 0.17 };
// moves that warp (crows) hold no travel of their own: `step` only names the tracking range
const STILL = (range) => ({ d: 0, f: 1, track: { range, max: 0, gap: 0 } });

// Itachi's M1 strings (the frame data format of naruto.js `moves`; the keyed clips it_* are src/char/itachimoves.js,
// their effects movefx.js MOVE_FX). New fields: warp (the crow warp: at, f frames, to 'behind'|'above', gap/back/up
// metres from the target's live position, max metres: src/game/combat.js warpStep), leap.at (the leap comes later in
// the move), nextOnHit (the string only continues from a hit), hit.fx ('sphere': the chakra sphere burst on impact).
export const ITACHI_MOVES = {
  // ---- Uchiha Taijutsu (M1 from a standstill): backfist, spinning heel, the kunai drawn in a low cut, a rising cut,
  // a palm that launches (he leaps after the victim), and the crows carry him above it for a heel drop to the ground
  I1: {
    name: 'Uchiha Backfist', anim: 'it_backhand', kind: 'light', next: 'I2',
    startup: 11, active: 4, recovery: 16, cancel: 16, hitCancel: 16,
    step: { d: 1.8, from: 2, f: 9, k: [1.4, 0.6], track: { range: 6, max: 3, gap: 0.66 } },
    hit: { box: { cap: ['rightLowerArm', 'rightHand'], r: 0.2, ext: 0.1 }, dmg: 40, react: 'flinch', stun: 34, kb: [5.5, 0], hitstop: 5, reach: 2.4 },
    weight: 1,
  },
  I2: {
    name: 'Spinning Heel', anim: 'it_spinheel', kind: 'light', next: 'I3',
    startup: 13, active: 5, recovery: 17, cancel: 20, hitCancel: 19,
    step: { d: 1.4, from: 1, f: 11, k: [1.3, 0.7], track: { range: 6, max: 2.6, gap: 0.85 } },
    hit: { box: { cap: ['leftLowerLeg', 'leftFoot'], r: 0.23, ext: 0.14 }, dmg: 45, react: 'flinch', stun: 36, kb: [6, 0], hitstop: 6, reach: 2.6 },
    weight: 2,
  },
  I3: {
    name: 'Kunai Draw', anim: 'it_kunaidraw', kind: 'light', next: 'I4',
    startup: 12, active: 4, recovery: 18, cancel: 19, hitCancel: 18,
    step: { d: 1.6, from: 3, f: 9, k: [1.5, 0.5], track: { range: 6, max: 2.8, gap: 0.95 } },
    hit: { box: KUNAI, dmg: 50, react: 'flinch', stun: 38, kb: [6, 0], hitstop: 6, reach: 2.8 },
    weight: 2,
  },
  I4: {
    name: 'Rising Cut', anim: 'it_risingcut', kind: 'light', next: 'I5',
    startup: 11, active: 4, recovery: 18, cancel: 18, hitCancel: 18,
    step: { d: 1.4, from: 2, f: 9, k: [1.4, 0.6], track: { range: 6, max: 2.6, gap: 0.78 } },
    hit: { box: KUNAI, dmg: 55, react: 'stagger', stun: 40, kb: [6.5, 0], hitstop: 7, reach: 2.8 },
    weight: 2,
  },
  I5: {
    name: 'Chakra Palm Launch', anim: 'it_palmrise', kind: 'light', next: 'I6', nextOnHit: true,
    startup: 14, active: 4, recovery: 22, cancel: 26, hitCancel: 22,
    step: { d: 1.4, from: 3, f: 10, k: [1.5, 0.5], track: { range: 6, max: 2.6, gap: 0.7 } },
    // he leaps after the victim once the palm has struck (the victim's flight: the same arc, a little ahead). M1
    // pressed on through it: the crow finisher (I6); let it end in the air and M1 starts the air string (IA1-IA5)
    leap: { at: 18, vy: 11, g: 0.66 },
    hit: { box: { cap: ['rightLowerArm', 'rightHand'], r: 0.27, ext: 0.18 }, dmg: 60, react: 'launch', stun: 0, kb: [1.5, 11], hitstop: 9, reach: 2.4, fx: 'sphere' },
    weight: 3,
  },
  I6: {
    name: 'Crow Descent', anim: 'it_crowdrop', kind: 'light', next: null, air: true, hover: 0.2,
    startup: 20, active: 5, recovery: 28, cancel: 99, hitCancel: 30,
    step: STILL(9),
    // crows at 3, re-formed above the victim (0.7 m over its feet, 0.6 m short of it) by 11, the heel comes down at 20
    warp: { at: 3, f: 8, to: 'above', up: 0.7, back: 0.6, max: 7 },
    dive: { at: 25, vy: -22, land: 34 },
    hit: { box: { cap: ['rightLowerLeg', 'rightFoot'], r: 0.27, ext: 0.14 }, dmg: 85, react: 'spike', stun: 0, kb: [2, -18], hitstop: 9, reach: 3.2 },
    weight: 4,
  },

  // ---- Crow Rush (M1 on the move): a flying side kick, an airborne hook kick, the kunai drawn in a diagonal cut,
  // crows to the target's back for an elbow, a spinning crimson cut that throws the victim away
  R1: {
    name: 'Flying Side Kick', anim: 'it_flykick', kind: 'light', next: 'R2',
    startup: 12, active: 5, recovery: 16, cancel: 18, hitCancel: 18,
    step: { d: 4.2, f: 13, k: [1.3, 0.7], track: { range: 9, max: 5, gap: 0.95 } },
    hit: { box: { cap: ['rightLowerLeg', 'rightFoot'], r: 0.25, ext: 0.16 }, dmg: 45, react: 'flinch', stun: 36, kb: [6.5, 0], hitstop: 6, reach: 2.8 },
    weight: 2,
  },
  R2: {
    name: 'Aerial Hook Kick', anim: 'it_airhook', kind: 'light', next: 'R3',
    startup: 13, active: 5, recovery: 17, cancel: 19, hitCancel: 19,
    step: { d: 1.6, from: 1, f: 11, k: [1.3, 0.7], track: { range: 6, max: 2.8, gap: 0.85 } },
    hit: { box: { cap: ['leftLowerLeg', 'leftFoot'], r: 0.24, ext: 0.14 }, dmg: 45, react: 'flinch', stun: 36, kb: [6, 0], hitstop: 6, reach: 2.7 },
    weight: 2,
  },
  R3: {
    name: 'Kunai Crescent Draw', anim: 'it_crossslash', kind: 'light', next: 'R4',
    startup: 11, active: 4, recovery: 17, cancel: 17, hitCancel: 17,
    step: { d: 1.6, from: 2, f: 9, k: [1.5, 0.5], track: { range: 6, max: 2.8, gap: 0.95 } },
    hit: { box: KUNAI, dmg: 50, react: 'flinch', stun: 38, kb: [5.5, 0], hitstop: 6, reach: 2.8 },
    weight: 2,
  },
  R4: {
    name: 'Crow Flank', anim: 'it_crowflank', kind: 'light', next: 'R5',
    startup: 18, active: 4, recovery: 16, cancel: 20, hitCancel: 20,
    step: STILL(8),
    // crows at 3, re-formed at the target's back (0.62 m past it, facing it) by 10, a turning elbow at 18
    warp: { at: 3, f: 7, to: 'behind', gap: 0.62, max: 7 },
    hit: { box: { cap: ['rightUpperArm', 'rightLowerArm'], r: 0.22, ext: 0.12 }, dmg: 55, react: 'stagger', stun: 40, kb: [7, 0], hitstop: 7, reach: 2.4 },
    weight: 3,
  },
  R5: {
    name: 'Crimson Crescent', anim: 'it_crescent', kind: 'light', next: null,
    startup: 15, active: 5, recovery: 26, cancel: 99, hitCancel: 24,
    step: { d: 1.2, from: 2, f: 12, k: [1.2, 0.8], track: { range: 6, max: 2.4, gap: 0.95 } },
    hit: { box: { ...KUNAI, r: 0.2 }, dmg: 90, react: 'knockback', stun: 0, kb: [13, 6], hitstop: 9, reach: 3, fx: 'sphere' },
    weight: 4,
  },

  // ---- Crow Heaven (M1 in the air): a snap kick, a spinning kunai cut, a heel hook, crows to the victim's back for a
  // backfist, then a front flip over it into an upside-down diving fist that drives it into the ground
  IA1: {
    name: 'Air Snap Kick', anim: 'it_air_snap', kind: 'air', next: 'IA2', hover: 0.15,
    startup: 9, active: 4, recovery: 14, cancel: 13, hitCancel: 12,
    step: { d: 0.7, track: { range: 4.5, max: 2.2, gap: 0.8, vertical: true } },
    hit: { box: { cap: ['rightLowerLeg', 'rightFoot'], r: 0.22, ext: 0.12 }, dmg: 35, react: 'flinch', stun: 30, kb: [1.2, 2.6], hitstop: 5, reach: 2.5 },
    weight: 1,
  },
  IA2: {
    name: 'Air Spin Slash', anim: 'it_air_slash', kind: 'air', next: 'IA3', hover: 0.15,
    startup: 11, active: 5, recovery: 14, cancel: 15, hitCancel: 14,
    step: { d: 0.6, track: { range: 4.5, max: 2, gap: 0.95, vertical: true } },
    hit: { box: KUNAI, dmg: 40, react: 'flinch', stun: 30, kb: [1.3, 2.8], hitstop: 5, reach: 2.8 },
    weight: 2,
  },
  IA3: {
    name: 'Air Heel Hook', anim: 'it_air_heel', kind: 'air', next: 'IA4', hover: 0.15,
    startup: 11, active: 5, recovery: 14, cancel: 15, hitCancel: 14,
    step: { d: 0.6, track: { range: 4.5, max: 2, gap: 0.85, vertical: true } },
    hit: { box: { cap: ['leftLowerLeg', 'leftFoot'], r: 0.23, ext: 0.12 }, dmg: 45, react: 'flinch', stun: 30, kb: [1.4, 3], hitstop: 6, reach: 2.7 },
    weight: 2,
  },
  IA4: {
    name: 'Crow Ambush', anim: 'it_air_ambush', kind: 'air', next: 'IA5', hover: 0.15,
    startup: 17, active: 4, recovery: 15, cancel: 20, hitCancel: 18,
    step: STILL(7),
    warp: { at: 3, f: 7, to: 'behind', gap: 0.68, up: -0.12, max: 6 },
    hit: { box: { cap: ['rightLowerArm', 'rightHand'], r: 0.22, ext: 0.1 }, dmg: 50, react: 'flinch', stun: 30, kb: [1.5, 3.2], hitstop: 6, reach: 2.5 },
    weight: 2,
  },
  IA5: {
    name: 'Heaven Drop', anim: 'it_air_drop', kind: 'air', next: null, hover: 0.2,
    startup: 16, active: 5, recovery: 28, cancel: 99, hitCancel: 28,
    step: STILL(7),
    // no crows: a rising front flip carries him up over the victim (the warp, visible), head down by 12, 0.55 m short of
    // it (closer, the fighters' separation push would shove him back)
    warp: { at: 2, f: 9, to: 'above', up: 0.55, back: 0.55, max: 5 },
    dive: { at: 21, vy: -24, land: 30 },
    hit: { box: { cap: ['rightLowerArm', 'rightHand'], r: 0.28, ext: 0.16 }, dmg: 85, react: 'spike', stun: 0, kb: [2.5, -18], hitstop: 9, reach: 3.2 },
    weight: 4,
  },
};

export const ITACHI = {
  ...NARUTO,
  id: 'itachi',
  name: 'Itachi',
  model: '/assets/characters/itachi.vrm',
  standin: null,
  locked: true, // the title screen asks for a password; the server checks it (server/index.js LOCKED)
  card: { tag: 'AKATSUKI', face: 0.07, credit: 'Model: “Itachi Uchiha Sharingan Akatsuki Amaterasu” by angelolamonaca · CC BY 4.0' },
  kit: { jutsu1: 'phoenixFire', jutsu2: 'tsukuyomi', jutsu3: 'crowEscape', ult: 'amaterasu' },
  hud: 'uchiha', // his HUD: Sharingan portrait, black flames, red-framed bar and icons (src/ui/uchiha.js)
  // (card.face: his collar hides everything below the eyes; eye: the eyes' place from the head bone, metres, in the
  // fighter's frame: up, forward, apart. The Mangekyō glows there through his casts)
  eyes: { up: 0.072, fwd: 0.085, apart: 0.032 },
  // his dash (and substitution) is a crow shift. The movement is everyone's; only the look differs: the body turns
  // into a streak of brush ink for the dash, crows scatter from where he left, he re-forms at its end (visual only:
  // src/game/itachi.js updateShift, itachifx.js InkStrokes)
  crowShift: true,

  // His own M1 (Naruto's moves stay in the table for bots and tests, unused by his input): from a standstill the
  // Uchiha Taijutsu string (I1-I6), on the move the Crow Rush (R1-R5), in the air the Crow Heaven string (IA1-IA5).
  // Paced to be read (~0.4 s from hit to hit, every strike with a wind-up and a follow-through); every hit's stun
  // covers the gap to the next contact with room to spare (gap = cancel - startup + next startup, after hitstop).
  light: { stand: 'I1', moving: 'R1', movingSpeed: 5, air: 'IA1' },
  // every step of his strings re-aims at the target's live position each tick (src/game/combat.js AttackAction):
  // each strike meets the victim at its own contact distance even while the last hit's push still slides it
  liveTrack: true,
  moves: {
    ...NARUTO.moves,
    ...ITACHI_MOVES,
  },

  jutsu: {
    shuriken: NARUTO.jutsu.shuriken, // tool 1: the same as everyone's

    phoenixFire: {
      name: 'Fire Style: Phoenix Sage Fire', key: 'Q', cost: 30, cd: 9, icon: 'fireballs',
      // Tiger seal 0-10, the fingers to the mouth 10-16, a fireball blown at each of `shots` (the body pumps forward),
      // recovery to `total`. Each shot is its own phase (n = 1, 2, 3) with its origin and direction.
      seal: 10, shots: [18, 30, 42], total: 62, life: 6,
      mouth: 0.22, // metres in front of the head bone the balls leave from (outside the collar)
      spread: [0.32, -0.32, 0], // rad each shot leaves off the aim line (left, right, straight): they curve in
      lift: 0.1, // rad above the aim line
      proj: {
        speed: 25, life: 2.2, radius: 0.5,
        turn: 4.2, // rad/s the ball can turn toward where its target will be (running doesn't outrun it; a dash does)
        accel: 6, // m/s^2 it speeds up in flight (to 25 + 6 * 2.2)
      },
      hits: {
        // 45 + 45 + 75 = 165 raw: the two first flinch (the next ball lands inside the stun), the third knocks back.
        // dodge: the server refuses a ball's hit when the victim dashed (or substituted) while it flew
        shot: { dmg: 45, react: 'flinch', stun: 24, kb: [3, 0], hitstop: 5, reach: 70, chip: 0.2, guardChakra: 5, cls: 'proj', dodge: true },
        last: { dmg: 75, react: 'knockback', stun: 0, kb: [10, 5], hitstop: 8, reach: 70, chip: 0.2, guardChakra: 5, cls: 'proj', dodge: true },
      },
    },

    tsukuyomi: {
      name: 'Mangekyō Sharingan: Tsukuyomi', key: 'E', cost: 35, cd: 15, icon: 'tsukuyomi',
      // head lowered 0-10, raised: the eyes meet theirs at `gaze` (the genjutsu takes hold: phase n:1), held to 38
      gaze: 18, total: 44, life: 4,
      range: 18, cone: 38, height: 5, // metres, degrees either side of his facing, metres up/down
      hits: {
        // server-applied (the server checks the cone at the gaze on each victim's own view): 5 s stunned, no guard,
        // no substitution out of it; hits during it keep the victim in it (a launch or a knockdown breaks it)
        main: { dmg: 30, react: 'daze', stun: 300, kb: [0, 0], hitstop: 10, reach: 40, unblockable: true, cls: 'area', server: true },
      },
    },

    crowEscape: {
      name: 'Crow Clone Escape', key: 'G', cost: 20, cd: 10, icon: 'crows', escape: true,
      // the body bursts into crows at `vanish` (the teleport: phase n:1 with the spot), they gather at the spot and
      // he re-forms at `form`, crouched, standing by `total`. Invulnerable for `invuln` s from the press. Between the
      // two, an ink streak flies from where he vanished to the spot (itachi.js inkComet).
      vanish: 5, form: 26, total: 38, invuln: 0.6,
      dist: [14, 22], // metres the spot is picked from (the safest: farthest from enemies, out of their sight)
      maxDist: 26, // the server's limit from where he pressed
    },

    amaterasu: {
      name: 'Amaterasu', key: 'R', ult: true, icon: 'amaterasu',
      // A cinematic on EVERY screen, on the server clock from the press (src/game/amaterasu.js: timeline AMA): the
      // fingers to the right eye, the world turning negative, the crows, the camera rushing into his face, his eyes
      // opening in close-up, the Mangekyō, the blood, black flames bursting out of the pupil; back in the arena the
      // flames latch onto everyone he took. `cinema` [from, to] (frames): the whole arena holds still (no input on any
      // screen, no hit lands anywhere, burns pause), he is untouchable from the press to its end.
      // `pick` (phase n:1: his eyes + facing): the server takes the cone then and tells every screen who (`v`);
      // `focus`: the server ignites them (its own clock: the flames land on every screen at once); recovery to `total`.
      cinema: [12, 300], pick: 12, focus: 262, total: 312, life: 14,
      range: 30, cone: 34, height: 8,
      // the black flames burn until they have taken `frac` of the victim's max HP (the ignition counts), a tick
      // every `every` frames; they can't be put out (not by a dash, a substitution or a barrier)
      burn: { frac: 0.5, every: 18 },
      hits: {
        ignite: { dmg: 40, react: 'stagger', stun: 34, kb: [3, 0], hitstop: 12, reach: 60, unblockable: true, los: true, cls: 'ult', server: true },
        burn: { dmg: 25, react: 'none', stun: 0, kb: [0, 0], hitstop: 0, reach: 60, unblockable: true, cls: 'ult', server: true },
      },
    },
  },
};
