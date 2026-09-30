// The roster. Every character is one data file (see naruto.js); players pick one on the title screen and carry
// its `characterId` end to end (join.ch, info.ch). The server checks hits and reactions with the attacker's and the
// victim's data.
import { NARUTO } from './naruto.js';
import { MADARA } from './madara.js';
import { ITACHI } from './itachi.js';

// Sage Mode Naruto: the same fighter (stats, moves, frame data, hitboxes, jutsu) in another body:
// models/naruto_sage.glb, rigged by `npm run rig -- models/naruto_sage.rig.json` and scaled to the default body's
// size so both have the same hurtboxes. Only the looks differ.
export const SAGE = {
  ...NARUTO,
  id: 'sage',
  name: 'Sage Naruto',
  model: '/assets/characters/sage.vrm',
  standin: null,
  card: { tag: 'SAGE MODE', credit: 'Model: “Naruto Sage” by ninjatorent13 · CC BY 4.0' },
};

// Obito (Ten-Tails Jinchūriki): Naruto's fighter in Obito's body, like Sage. models/obito.glb is an A-pose; the rig
// config lifts its arms into a T-pose, pins the Truth-Seeking orbs to the upper chest (and one to each hand) and
// scales it to the same body size (hips 0.908 m) so the hurtboxes match.
export const OBITO = {
  ...NARUTO,
  id: 'obito',
  name: 'Obito',
  model: '/assets/characters/obito.vrm',
  standin: null,
  card: { tag: 'OBITO', credit: 'Model: “Obito Uchiha (Free Fire)” by AJ Studio · CC BY 4.0' },
  hud: null, // Naruto's kit, not his HUD theme (orange chakra, the Leaf headband): the plain HUD
};

// Itachi Uchiha (itachi.js): Naruto's movement with his own M1 strings and jutsu kit (fireballs, Tsukuyomi, crow escape,
// Amaterasu). models/itachi.glb is a display figure (head, closed cloak, shins): the rig config generates the arms,
// hands and trousers under the cloak, turns the cloak into a coat on the hips + thighs, and merges everything into
// one material; scaled to the same body size (hips 0.908 m) so the hurtboxes match.
export { ITACHI };

// Madara Uchiha (madara.js): Naruto's movement and M1 with his own jutsu kit, in Madara's body. models/madara.glb is
// an A-pose: the rig config lifts its arms into a T-pose, puts the long hair on spring bones and makes the robe +
// armour tassets follow the thighs. Scaled 1.12 so shoulders, hips and head sit close to the other bodies' (his legs
// are short for his torso, so no single scale matches them all; keyed hand targets follow the shoulders).
export { MADARA };

export const CHARACTERS = { naruto: NARUTO, sage: SAGE, madara: MADARA, obito: OBITO, itachi: ITACHI };
export const DEFAULT_CHARACTER = 'naruto';

export const charOf = (id) => CHARACTERS[id] || CHARACTERS[DEFAULT_CHARACTER];
