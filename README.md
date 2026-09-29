# SHINOBI ARENA

A multiplayer anime ninja arena fighter in the browser: a free-for-all for up to 6 players. Pick your ninja (Naruto,
Sage Naruto, Madara, Obito or Itachi) and type your name on the title screen.

## Play

1. Install once: `npm install`
2. Start: `npm start` (builds the game and starts the server on port **3100**)
3. Open **http://localhost:3100** in Chrome. On the right: type **your name** (e.g. "Nova") and pick a **character card**
   (click it, or press its number **1**-**5** / the arrow keys). Then click **JOIN**, press **Enter** in the name box, or press any
   other key. Your name and character are remembered next time. Leave the name empty and you are named after your
   character ("Naruto", "Sage Naruto 2"...).
   **Itachi is locked** (🔒 on his card): picking him shows a password box, and you can only join as Itachi with the
   right password (ask the owner). A wrong or missing password keeps you on the title screen; pick another ninja to
   play. The password is remembered once it works.
4. Friends on the same Wi-Fi open the "Friends (LAN)" address the server prints.

### Play over the internet

The game is live on the VPS: **https://shinobi.185-2-49-69.sslip.io** (send friends this link; it runs 24/7, your
laptop can be off; the old http://185.2.49.69:3100 still works).
After changing the game, run `npm run deploy` to upload, build and restart it there (it kicks anyone playing, so
deploy when nobody is on).

Without the VPS: run `npm run share` in a second terminal. It prints a `https://....trycloudflare.com` link: send it to your friend.
(It uses HTTP/2 on purpose: the default QUIC was very slow on this network.)

## Controls

| Action | Keyboard + mouse | Gamepad (Xbox) |
|---|---|---|
| Move / look | WASD / mouse | left stick / right stick |
| Jump, double jump | Space | A |
| Wall run | hold Space against a wall, cliff or tree trunk (run up a trunk into a branch to climb onto it, or all the way up to stand on top of the tree) | hold A |
| Dash (in hitstun: Substitution) | Shift | B |
| Light attack / M1 (two 5-hit strings, see below) | left click | X |
| Heavy attack | hold left click, or V | Y |
| Guard | right click, or C | LB |
| Chakra charge | hold F | RT |
| Shuriken | 1 | LT + X |
| Jutsu (Naruto: Rasengan / Shadow Clone Rush; Madara: fire / wood / gunbai; Itachi: fireballs / Tsukuyomi / crows, see below) | Q / E / G | LT + Y / LT + B / LT + A |
| Ultimate (Naruto: Rasenshuriken; Madara: Tengai Shinsei; Itachi: Amaterasu) | R | LT + RT |
| Lock on (the camera follows the target; you still run and sprint freely, and face it when you stop; wheel switches target) | T or middle mouse | RB |
| Zoom in / out | mouse wheel (when not locked on) | |
| Scoreboard / menu | Tab / Esc | View / Menu |
| Performance overlay | F3 | |
| Hitbox view (debug) | F4 | |
| Developer commands | / (see below) | |

### Developer commands (testing)

Press **/** in a match, type a command, press **Enter** (Esc closes the bar):

| Command | What it does |
|---|---|
| `/ult` (or `/ultimate`, `/u`) | fills your ultimate gauge: press R straight away |
| `/cd` | resets your jutsu cooldowns and fills your chakra |
| `/sub` | fills your substitution pips |
| `/all` | all of the above |

They only work for a player on the laptop running the server (`npm start` or `npm run dev`, opened on that
laptop). Friends on the LAN, players over `npm run share` and everyone on the VPS are refused, so nobody can cheat
in a real match. To let everyone use them (a test session with friends), start the server with `SHINOBI_DEV=1`;
`SHINOBI_DEV=0` turns them off even for you.

### M1: the two combo strings

Press left click (X) up to five times. What comes out depends on how you start:

- **From a standstill or a walk: Uzumaki Barrage.** A lunging straight punch, a switch roundhouse to the head, a
  wind-chakra double palm (a burst of wind shoves them back), a front-flip heel drop, and a jumping whirlwind
  roundhouse that sends them flying.
- **While running, sprinting or right out of a dash: Scroll Rush.** A sliding kick along the ground, then Naruto draws
  a scroll from his back and clubs them with it, grabs them and heaves them into the air, leaps after them for a rising
  scroll strike, and finishes with a flipping scroll slam that smashes them into the ground (you land with them).

Every hit carries you (and them) forward: a full string covers 8-10 m. Each press counts, so five quick presses
give all five hits even if you press faster than the moves. Hold left click (or V) for the heavy axe kick instead.

### Substitution (the log trick)

When you are being hit, press **Dash** (Shift / B) to escape: you leave a log where you stood, vanish in a puff of
smoke and reappear about 6 m away, off to one side and facing your attacker, briefly invulnerable.

- It only works **while you are reeling from a hit** (hitstun, or flying from a launch/knockback, up to landing).
  Pressing Shift when you are not being hit is just a normal dash.
- It costs one **substitution pip**: the three small dots under your HP bar. You have 3; a used pip comes back after
  8 seconds (one at a time). With no pips left, Shift in hitstun does nothing.
- Not the same as the **tech roll**: pressing Dash just as you hit the ground after a knockdown rolls you back onto
  your feet (free, no pip).
- A K.O. can't be substituted: once your HP hits zero you are thrown down and stay down until you respawn.

### Aiming jutsu

Shadow Clone Rush (E), the shuriken (1) and the Rasenshuriken (R) go for **whoever your camera is looking at** (the
enemy closest to the middle of the screen, within 30 m). No lock-on needed; if you are locked on (T), they go for your
lock-on target. The clones chase their target the whole time: they jump up to someone on a roof or ledge, drop off
edges after them, and run after a target that dashes away between hits.

**Zoom:** scroll up to zoom in, down to zoom out; the camera glides in toward your fighter over the shoulder (from
3.3 m behind down to 1 m) and back out. Fully zoomed out is the normal view; the field of view always stays the one
you picked in the settings. Walls and trees behind you still push the camera in. When you are locked on, the wheel
switches targets instead.

### Madara's jutsu

Madara moves and fights like Naruto (same M1 strings, heavy, shuriken) but has his own jutsu:

- **Q: Great Fire Annihilation** (35 chakra, 10 s). A seal, a deep breath, then a torrent of fire that rolls ~22 m
  along the ground, fanning out to 16 m wide. It flows round thin posts, rolls over fences and low walls, stops at buildings
  and trees (and splashes up them), and leaves a burning field where it comes to rest. Caught in it: 4 burning ticks
  and a knockback (~130 damage); standing in the embers burns a little every half second. A guard blocks it but still
  takes chip damage and extra chakra. Cast in the air, the stream pours down at an angle and the wall rolls on from
  where it lands. Double jump over it, or get out of its way.
- **E: Wood Release: Cutting Technique** (30 chakra, 9 s). He slams his palm on the ground and a line of wooden
  stakes erupts toward the target, 18 m long, racing along the ground at 30 m/s (it follows slopes and stops at
  walls). Whoever it reaches is launched into the air (90 damage): follow up with an air combo. Side-dash out of the
  line or guard it. From the air he dives down first and slams on landing.
- **G: Uchiha Return** (20 chakra, 8 s). Madara carries his war fan (the gunbai) on his back all the time, head down
  over his hair with the handle up past his right shoulder. On G he draws it over his shoulder in one swing behind
  him and over his head, spins once on the spot sweeping it all the way round him, and plants it
  upright in front of him while a whirlwind swirls round him in waves. From the moment you press G until the fan
  starts going back (1.2 s), **nothing can touch him**, from any side: a punch, a kick, the Rasengan or a shadow clone
  is blown back (the attacker takes 60 and is thrown back a few metres; a clone just vanishes), a shuriken flies back
  at its thrower (50), and an ultimate, fire, stakes or a meteor are deflected. Whatever hit the wind is spent: a
  Rasenshuriken's burst or the rest of a torrent won't catch him once the wind drops. The spin's gust also throws back
  anyone within ~4 m (30). Once the wind drops he puts the fan back on his back (0.3 s), and there he can be hit.
- **R: Tengai Shinsei** (ultimate). He raises his arm to the sky: a huge flaming meteor appears high behind him and
  falls onto the target's spot (lock-on target or whoever you look at, up to 60 m). It lands 1.8 seconds later; red
  rings on the ground and the rock's growing shadow show where. The centre (5.5 m) is the heaviest hit in the game
  (420, can't be guarded); up to 13 m out it still does 200 down to 80 (guardable, with chip). Only an instant sprint
  gets you out of the rings from the centre: get behind cover, or dash through the impact. It leaves a smoking crater.

### Itachi's jutsu

Itachi moves like Naruto (same heavy and shuriken) but fights with his own M1 strings and his own jutsu. Through
Tsukuyomi and Amaterasu his Sharingan blazes into the spinning Mangekyō.

His M1 (left click) has three strings, paced so you can see every strike:
- **Standing: Uchiha Taijutsu (6 hits).** Backfist, spinning heel kick, a kunai drawn from his cloak in a low cut, a
  rising cut, then a chakra palm that launches the enemy in a white burst and he leaps after them. Keep clicking and he
  bursts into crows, re-forms above them and drives them into the ground with a heel drop (a dust cloud). Or stop
  clicking after the launch: once his leap ends, click again for the whole air string (a 10-hit juggle).
- **On the move: Crow Rush (5 hits).** A flying side kick, an airborne hook kick, a diagonal kunai cut, crows carry him
  behind the enemy for an elbow, and a spinning crimson cut throws them away.
- **In the air: Crow Heaven (5 hits).** A snap kick, a spinning kunai cut, a heel hook, crows to the enemy's back
  for a backfist, then a front flip into an upside-down diving punch that slams them down in a cloud of dust.

Playing as Itachi, your HUD changes too: your portrait is a Sharingan (its three tomoe turn, and it becomes the
Mangekyō when your ultimate is ready), with black flames streaming off it along a red-framed gold health bar that
pulses red when you're low. His skill icons have crimson metal rims, look dimmed while they recharge, and flash
with a ring when they're ready again.

Madara has his own HUD too: a Rinnegan portrait (ripples run out from the pupil; it turns into the red Rinne Sharingan with
nine turning tomoe when your ultimate is ready), blue Susanoo flames streaming along a dark-iron plated health bar with a
crimson fill, and hand-painted icons for the Great Fire Annihilation, Wood Release stakes, the gunbai barrier and the meteor.

- **Q: Fire Style: Phoenix Sage Fire** (30 chakra, 9 s). A seal, two fingers to his lips, and he blows three
  fireballs one after another. They leave spread out and curve in on the target (lock-on target or whoever you look
  at): they **track you, even running flat out**. The only way out is a **dash (Shift)**: dashing shakes off every
  fireball in flight, and they fly on straight past you. Two flinch, the third knocks you back (~150 damage in all);
  a guard blocks them with a little chip. They burst on walls, trees and posts: cover works too.
- **E: Mangekyō Sharingan: Tsukuyomi** (35 chakra, 15 s). He lowers his head, then raises it and his eyes meet
  yours: a great Mangekyō turns in the air before him, and **everyone in front of him** (up to 18 m, a ~76° cone, in
  his line of sight) is caught. Around each victim a white flash bursts, a violet sphere closes on them, black
  blades sweep in, a red ring tears into ink and the Mangekyō spins over their body; then an eye opens over their
  head. They stand dazed on the spot **for 5 seconds**: no moving, no guard, no substitution. Hits while they are
  dazed don't free them (only being launched or knocked down does), but after a few seconds of combo the game's
  knockdown rule throws them out of it. A dash at the moment of the gaze dodges it; so does being behind him or
  behind cover.
  **If you are the one caught**, your screen leaves the fight: the Mangekyō spins up and its pupil swallows the view,
  and you find yourself bound to a wooden cross where you stood, Itachi watching. The world dims, a white fog
  swallows everything, then it all turns negative (a blood-red sky, white ground) while swords fly in and stab you
  again and again. The eye closes it and you are back in the fight when the 5 seconds are up.
- **G: Crow Clone Escape** (20 chakra, 10 s). His body bursts into a flock of crows that scatter in every direction,
  a streak of black brush ink flies off in an arc, and he re-forms **14-22 m away** at the **safest spot nearby** (the
  one farthest from enemies and out of their sight), where the ink and the crows gather, crouched and facing the
  nearest enemy. Nothing can touch him from the press until he has re-formed (0.6 s).
- **His dash (Shift) is a crow shift**: for the length of the dash his body vanishes into one slim, ragged streak of
  brush ink (purple-black, fading to crimson at its tail), with aqua chakra sparks, white speed lines and falling
  feathers, while a few crows
  scatter from where he left. He takes shape again out of the ink at its end. His **substitution** bursts into crows
  and ink too (the log still drops). Only the look is his: the dash moves exactly like everyone's.
- **R: Amaterasu** (ultimate): a **5-second cinematic on everyone's screen at the same moment**. He raises two
  fingers to his right eye; the world flips into a dark teal negative, his arms fling wide and a flock of crows bursts
  off his back; the camera rushes into his face; his face fills the screen (forehead protector, bangs, the lines under his eyes), eyes
  shut; they open wide, the Sharingan spins into the Mangekyō, veins crawl in and blood runs down from his right eye; the camera drives into the pupil and black
  flames burst out over the view; they burn away onto **everyone he was facing** (up to 30 m, in his line of sight,
  decided 0.2 s after the press), who are now ablaze. **While it plays the whole arena holds still**: nobody can
  move, attack or be hit, and burns wait. The flames can't be put out (not by dashing, substitution or a barrier)
  and keep burning until they have burnt **half of the victim's maximum health** (the ignition included), a tick
  every 0.3 s. Your only answer is not to be in front of him when he presses it. (One cinematic at a time: another
  Itachi's Amaterasu is refused while one plays, his gauge kept.) Everyone hears his voice from the press: "Amaterasu" rings out
  as his eyes open fully, then the black flames roar and slowly fade.

### The map

"Training Grounds": the village (shops, the ramen stand, stone stairs up to the upper street, flagstone streets, a
red torii gate from the bridge, a new south-east street with flat-roofed blocks and a round tower), the forest of
giant trees with a small shrine, layered rock cliffs with a stream falling down them in two waterfalls, the river with
its bridge, stepping stones, reeds and cherry trees, and the training field with dummies, targets and a weapons rack.
Beyond the walls: forested hills, three ranges of mountains fading into the haze, and the rest of the town rising on
terraces east of the village.

- **Trees:** run up a trunk (hold Space) into a branch above you to climb onto it; branches are wide enough to run
  along and jump between. Keep running up the trunk and you come out on top of the canopy, the highest lookout in
  the forest. Leaves never block you or your view: they fade when the camera gets close.
- **Houses:** run up a wall and you vault onto the roof. Roofs are solid all the way through (you can no longer end
  up inside one).
- **Stairs:** the stone stairs between the ramen shop and the next house take you from the square to the upper
  street; walk or sprint up them smoothly.
- **Rooftops:** the flat-roofed blocks and the round tower in the south-east street have walkable roofs behind a low
  parapet (run up a wall to get there).
- **The stream:** you can wade along it across the ridge and the ledge and jump down beside the falls.
- Barrels, lanterns, carts, benches, stalls, dummies, stumps and boulders are solid; flowers, bushes, reeds and grass
  are not (run straight through them).

In the pause menu (Esc): mouse sensitivity, invert Y, field of view, volume, music, and the graphics preset
(Auto picks one from your graphics card; Low / Medium / High / Ultra; High and Ultra render at full resolution).
Sound starts when you join. F3 shows fps, frame times, draw calls, ping, interpolation delay and network stalls.

## Characters

All characters move and fight the same (moves, damage, speed, hitboxes); Naruto, Sage Naruto and Obito also share
Naruto's jutsu, while Madara and Itachi have their own (see "Madara's jutsu" and "Itachi's jutsu" above).

- **Naruto**: your VRoid model once you add it (below); until then the stand-in avatar.
- **Sage Naruto**: "Naruto Sage" by **ninjatorent13** on Sketchfab
  (https://sketchfab.com/3d-models/naruto-sage-161369399a0d4b6e9657023a1bcbfb31), licensed CC BY 4.0
  (https://creativecommons.org/licenses/by/4.0/). Rigged for this game (skeleton, skin weights, finger bones, headband
  physics, toon materials) and scaled to the other character's body size; the credit is also on its character card.
- **Madara**: "FreeFire New 3D Character Madara Uchiha." by **AJ Studio** on Sketchfab
  (https://sketchfab.com/3d-models/freefire-new-3d-character-madara-uchiha-83e56a5dd37a4902b5887625a2e3905d), licensed
  CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Rigged for this game (arms lifted from the model's A-pose
  into a T-pose, skeleton, skin weights, finger bones, the long hair on spring physics, the robe and armour plates
  following the thighs, toon materials) and scaled close to the other characters' body size (he has shorter legs for
  his height, so his hips sit ~5 cm lower); the credit is also on his character card and in the VRM's meta.
  His gunbai: "Madara-Uchiha gunbai" by **Madara.Uchiha.supreme** on Sketchfab
  (https://sketchfab.com/3d-models/madara-uchiha-gunbai-8d45e3bc6f7f4d53ae91f668e0021375), licensed CC BY 4.0
  (https://creativecommons.org/licenses/by/4.0/), scaled to 1.12 m and toon-shaded for this game (also credited on his
  card).
- **Obito** (Ten-Tails Jinchūriki): "Free Fire New 3D Character Obito Uchiha" by **AJ Studio** on Sketchfab
  (https://sketchfab.com/3d-models/free-fire-new-3d-character-obito-uchiha-d032e721b7514a269b8ac83a0e472675), licensed
  CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Rigged for this game (arms lifted from the model's A-pose
  into a T-pose, skeleton, skin weights, finger bones, the cloak following the thighs, the Truth-Seeking orbs floating
  with the body, toon materials) and scaled to the same body size; the credit is also on its character card and in the
  VRM's meta.
- **Itachi** (Akatsuki cloak, Sharingan, Amaterasu blood): "Itachi Uchiha Sharingan Akatsuki Amaterasu" by
  **angelolamonaca** on Sketchfab
  (https://sketchfab.com/3d-models/itachi-uchiha-sharingan-akatsuki-amaterasu-867dfc95e96a49878837f80428918ca9),
  licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). The download is a display figure (head, closed
  cloak and shins only): for this game it got generated arms (Akatsuki sleeves with the red lining, hands with his
  purple nails) and dark trousers under the cloak, a fairer skin tone, a skeleton, skin weights with the cloak opening at its front slit
  over the legs, toon shading in one material, and the stand-in's body size; the credit is also on his character card
  and in the VRM's meta. For now he fights with Naruto's moves and jutsu. Amaterasu's voice line and flame roar
  (public/assets/audio/amaterasu.mp3) are the owner's recording, trimmed and faded for the game.

### Adding a character from an unrigged model (.glb)

`npm run rig -- models/<name>.rig.json` turns a T-pose .glb into a game-ready .vrm (see
`models/naruto_sage.rig.json` for the config: joint positions, finger bands, coat/ribbon rules). An A-pose model
(arms hanging) gets an `apose` block that lifts the arms first (see `models/madara.rig.json` and
`models/obito.rig.json`; `TPOSE=out.glb npm run rig -- ...` writes the lifted mesh to measure the rest of the config
on). Long hair or ribbons become spring chains (`chains`), armour plates over a coat `plates`. A model with no limbs
under its clothes (a display figure) gets generated arms, hands and legs (`parts`, see `models/itachi.rig.json`),
`colors` repaints a material (e.g. a fairer skin), and `atlas` merges many materials into one (one draw per fighter). Then register it in
`src/shared/characters.js`. Check the result with `node scripts/debug/modelview.mjs <file.vrm> out.png front,left
"bones,pose=run"`.

### Your VRoid Naruto

Put your VRoid Naruto at `public/assets/characters/naruto.vrm` (see `ASSETS.md`). Until then a stand-in avatar is
used (the browser console then shows one harmless 404 for `naruto.vrm`). Mixamo animations go in `mixamo/` (names in
`ASSETS.md`), then run `npm run anims`, then `npm start` again (it rebuilds).

## Requirements

Node.js 20+, Chrome (or Edge). A dedicated graphics card is recommended.
