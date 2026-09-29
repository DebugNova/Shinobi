// Itachi Uchiha: Naruto's body mechanics and M1 (stats, movement, light/air/heavy moves, reactions) with his own
// jutsu kit. The one data file for his abilities; shared by the client (gameplay, effects, hit detection) and the
// server (validation, damage). Frames are 60 Hz ticks; distances in metres. Tune here.
//   Q  Phoenix Sage Fire   three fireballs blown one after another; each homes on the target until it dashes
//   E  Tsukuyomi           a Mangekyō gaze: everyone in front of him is marked and stunned for 5 s (genjutsu)
//   G  Crow Clone Escape   his body bursts into crows and he re-forms at the safest spot nearby (invulnerable)
//   R  Amaterasu           everyone in front of him bursts into black flames that burn 50% of their health away
// Geometry that must match on the client and the server lives in itachikit.js (built from these numbers).
import { NARUTO } from './naruto.js';

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
