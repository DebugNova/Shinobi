// Madara Uchiha: Naruto's body mechanics and M1 (stats, movement, light/air/heavy moves, reactions) with his own
// jutsu kit. The one data file for his abilities; shared by the client (gameplay, effects, hit detection) and the
// server (validation, damage). Frames are 60 Hz ticks; distances in metres. Tune here.
//   Q  Great Fire Annihilation  a torrent of fire that rolls ~22 m, fanning out to 16 m wide, and leaves a burning field
//   E  Wood Release: Cutting    a line of stakes erupting from the ground toward the target
//   G  Uchiha Return            the gunbai off his back, a spin, a wind barrier: untouchable, everything answered
//   R  Tengai Shinsei           a meteor falls on the target's area 1.8 s after the cast
// Geometry that must match on every screen and the server lives in madarakit.js (built from these numbers).
import { NARUTO } from './naruto.js';

export const MADARA = {
  ...NARUTO,
  id: 'madara',
  name: 'Madara',
  model: '/assets/characters/madara.vrm',
  standin: null,
  card: { tag: 'UCHIHA LEGEND', credit: 'Model: “Madara Uchiha” by AJ Studio · Gunbai by Madara.Uchiha.supreme · CC BY 4.0' },
  hud: 'madara', // his HUD: Rinnegan portrait, Susanoo flames, armour-plate bar, painted icons (src/ui/madara.js)
  kit: { jutsu1: 'fireAnnihilation', jutsu2: 'woodCutting', jutsu3: 'uchihaReturn', ult: 'tengaiShinsei' },

  jutsu: {
    shuriken: NARUTO.jutsu.shuriken, // tool 1: the same as everyone's

    fireAnnihilation: {
      name: 'Great Fire Annihilation', key: 'Q', cost: 35, cd: 10, icon: 'fire',
      // Tiger seal 0-12, inhale 12-26, exhale 26-66 (the torrent), recovery 66-86
      seal: 12, emit: 26, exhale: 40, total: 86,
      life: 8, // seconds the server keeps the cast (wave + field)
      wave: {
        length: 22, // metres the front rolls along the ground
        time: 0.9, // s for the front to get there (ease-out: fast at the mouth)
        w0: 3, w1: 16, // width at the mouth and at the end
        height: 2.1, // hit height above the ground under the victim (a double jump clears it)
        lanes: 9, // rays across the width that find walls (each lane stops at its own obstacle; ~2 m apart)
        mouth: 1.45, // the stream's height above the feet
        airPitch: 0.45, // rad the stream angles down when cast in the air
      },
      tickEvery: 6, // frames between the wave's ticks on one victim
      ticks: 4, // flinch ticks before the last one
      field: { w: 12, d: 6, time: 2.5, every: 30 }, // the burning field at the wave's end: size, seconds, tick frames
      hits: {
        // 4 x 25 + 60 = 160 raw, ~129 after combo scaling: under the Rasengan (~193) for 5 more chakra, but ranged
        tick: { dmg: 25, react: 'flinch', stun: 18, kb: [0.8, 0], hitstop: 2, reach: 26, chip: 0.25, guardChakra: 6, cls: 'area', area: 'fire', kMax: 3 },
        last: { dmg: 60, react: 'knockback', stun: 0, kb: [11, 5], hitstop: 7, reach: 26, chip: 0.25, guardChakra: 6, cls: 'area', area: 'fire', kOnly: 4 },
        // standing in the embers: small, no reaction, unblockable (you are meant to leave)
        field: { dmg: 12, react: 'none', stun: 0, kb: [0, 0], hitstop: 0, reach: 30, unblockable: true, cls: 'area', area: 'field' },
      },
    },

    woodCutting: {
      name: 'Wood Release: Cutting Technique', key: 'E', cost: 30, cd: 9, icon: 'stakes',
      // crouch 0-10, palm slam 12 (the stakes start), hold 12-48, rise 48-66
      slam: 12, total: 66, dive: { speed: 24, max: 1.2 },
      life: 5,
      line: {
        length: 18, // metres of stakes
        speed: 30, // m/s the front runs
        width: 1.1, // hit half-width
        height: 2.4, // hit height above the ground there
        hMin: 0.8, hMax: 2.6, // stake heights
        spacing: 0.8, // metres between stakes (jittered)
        hold: 1.2, sink: 0.45, // s standing, s sinking
      },
      hits: {
        // one clean launch: a juggle starter (air combo after it), like the Rasengan's finisher but no grind
        main: { dmg: 90, react: 'launch', stun: 0, kb: [2, 11.5], hitstop: 8, reach: 20, cls: 'area', area: 'wood' },
      },
    },

    uchihaReturn: {
      name: 'Uchiha Return', key: 'G', cost: 20, cd: 8, icon: 'gunbai',
      // The gunbai comes off his back (the hand on the handle at `grab`, torn free over the shoulder), one full spin
      // sweeps it round him (spinFrom-spinTo; the wind bursts out at `gustAt`), then the guard with the wind swirling
      // round him until `barrier`, and the fan goes back on his back (let go at `release`). From the press to
      // `barrier` nothing touches him: the server answers every hit instead (its phase n:1 comes from the server,
      // never from the client): melee is blown back, projectiles reflected, ultimates and area jutsu deflected.
      counter: true,
      grab: 5, spinFrom: 12, spinTo: 31, gustAt: 20, barrier: 72, release: 84, total: 90,
      slack: 50, // ms of network slack on both edges of the window (server and attacker use the same numbers)
      answer: 4, // frames from a hit on the barrier to its answer leaving the wind shell (the blow, a reflection)
      radius: 1.6, // the wind shell (visual: deflections burst on it)
      gust: { radius: 4.2, height: 2.6 }, // the burst at gustAt throws everyone this close (m round his feet, m up)
      reflectSpeed: 1.3,
      life: 4,
      hits: {
        // server-applied only (a client never reports them). Thrown back "a little": a short knockback, not a launch
        blow: { dmg: 60, react: 'knockback', stun: 0, kb: [9, 5], hitstop: 8, reach: 5, unblockable: true, cls: 'melee', server: true },
        gust: { dmg: 30, react: 'knockback', stun: 0, kb: [8, 4.5], hitstop: 4, reach: 6, unblockable: true, cls: 'area', server: true },
        // a reflected shuriken hits a little harder than a thrown one (40)
        reflect: { dmg: 50, react: 'flinch', stun: 14, kb: [1.5, 0], hitstop: 4, reach: 45, cls: 'proj', server: true },
      },
    },

    tengaiShinsei: {
      name: 'Tengai Shinsei', key: 'R', ult: true, icon: 'meteor',
      release: 30, total: 45, // arm raised, released at 30: he moves freely after
      delay: 1.8, // s from the release to the impact (the telegraph: from the centre, only an instant sprint clears the ring)
      range: 60, // max cast distance
      life: 6,
      meteor: { radius: 7, back: 70, up: 110 }, // rock size; the fall starts this far behind the caster and up
      core: 5.5, outer: 13, // metres
      hits: {
        // an ultimate you can barely run out of (1.8 s of warning): the core is the heaviest hit in the game
        core: { dmg: 420, react: 'knockback', stun: 0, kb: [5, 9], hitstop: 12, reach: 70, unblockable: true, los: true, cls: 'area', area: 'meteor' },
        outer: { dmg: 200, react: 'knockback', stun: 0, kb: [10, 6], hitstop: 8, reach: 70, chip: 0.25, falloff: [5.5, 13, 200, 80], los: true, cls: 'area', area: 'meteor' },
      },
    },
  },
};
