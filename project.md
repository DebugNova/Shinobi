# SHINOBI ARENA: project status

Multiplayer third-person anime ninja arena fighter (Shinobi Striker style). Brief: `shinobi-game-prompt.md`.

## Milestones

| # | Milestone | Status |
|---|---|---|
| 1 | Skeleton: stack, server :3100, boot screen, title + JOIN, map + collisions, stand-in character, camera, clock sync, 2 players see each other | **done** |
| 2 | Character + locomotion: VRM, Mixamo pipeline, full locomotion set, foot IK, spring bones | **done** (procedural; polish items below) |
| 3 | Combat core: frame data, light combo, heavy, guard, dash cancels, hurt/hitboxes + F4, hitstop, reactions, knockback, knockdown/get-up, substitution, dummy, combo counter | **done** |
| 4 | Netcode for combat: lag-compensated validation, server-driven reactions (seq), deterministic knockback, predicted feedback, projectiles | **done** (tests pass at 0 ms and 200/40/1) |
| 5 | Jutsu: chakra charge, shuriken, Rasengan, Shadow Clone Rush, Rasenshuriken + effects + cooldown UI | **done** |
| 6 | Real map + art pass: toon shading, outlines, hatching, sky, foliage, water, village, forest, cliffs, river, field; performance | **done** |
| 7 | Full HUD + match loop + audio | **done** (procedural audio; not yet heard by the owner) |
| 8 | Polish | in progress |

## What works now

- `npm start` builds and serves on :3100; boot screen with progress; title screen over the arena; JOIN (or any key)
  spawns you as Naruto (the stand-in avatar until `naruto.vrm` exists).
- Map "Training Grounds" (140 x 140 m), built from one seed identically on client and server (hash logged on both):
  village with shops, signs, lanterns and stairs to an upper street; forest with giant climbable trees and branch
  platforms; cliffs, ledge and a waterfall; a river with a bridge and stepping stones; the training field with the
  dummy. Toon shading with hatching, screen-space outlines, painted procedural textures, instanced grass, animated
  water, light shafts, bloom on lanterns and jutsu.
- Movement: run 8 m/s, ninja sprint 12 m/s, skid turn, jump + double jump (front flip), coyote time, jump buffer,
  ground/air dash (invulnerable start), wall run on any climbable surface, hard landings, water running.
- Animation: procedural gait with exact foot planting, terrain-following feet, lean and bank, ninja-run arms, keyed
  combat clips baked from IK poses, dead blending on every switch, fixed-step spring bones.
- Combat: two 5-hit M1 strings (standing: Uzumaki Barrage; on the move: Scroll Rush, see below), air chain, heavy axe kick, guard (+ guard break), chakra charge, hitstop, flinch /
  stagger / launch / knockdown / get-up / tech roll, substitution (pips), juggle and combo scaling rules, combo
  counter, damage numbers, dummy. The lethal hit is a KO knockback (thrown back, lies until respawn) that looks the
  same on every screen, the victim's own included. Hit detection samples the move's own clip (exact at any frame rate).
- Jutsu: shuriken, Rasengan, Shadow Clone Rush, Rasenshuriken (ultimate) with cooldowns and the ult gauge. Aimed
  casts target whoever the camera looks at (or the lock-on). Clones run on the fighters' body physics: they jump up
  to a target on a ledge (second jump = flip), fall off edges with the air pose, land with the squash, strike in the
  air, and chase a target that gets away mid-string. Every player sees them (they used to show only for the caster).
- Netcode: clock sync, 30 Hz states, adaptive interpolation (70-120 ms), Hermite curves, smoothed corrections, seq
  rule, attacker-side detection with server rewind validation, deterministic reaction flights, predicted hit
  feedback confirmed or corrected by the server, reconnect ghosts, lag simulation.
- Match loop: warm-up, 5:00 FFA, kills / assists / score, respawn at the farthest spawn with protection, results.
- HUD: portrait, HP and chakra, jutsu cooldown icons, timer, score, kill feed, scoreboard (Tab), banners, pause menu
  with settings (sensitivity, invert, FOV, volume, music, graphics preset) and a performance panel.
- Audio: procedural Web Audio (no files): footsteps by surface, whooshes by attack weight, layered impacts, block
  clank, dash, jump, landing, poof, throw, hand signs, Rasengan / ultimate / explosion, charge hum loops, UI clicks,
  zone ambience (forest birds and wind, village murmur, river), optional taiko + flute music.
- Graphics presets: Auto (from the graphics card) / Low / Medium / High / Ultra (High and Ultra render at native
  resolution).
- Wheel zoom (camera.js): the camera dollies along its arm toward the fighter, 3.3 m (fully out = the normal view)
  to 1 m over the shoulder, in equal ratio steps per notch (10 notches), smooth-damp spring (~0.1 s, no overshoot).
  The FOV is never touched (always the settings value). Collision still wins (zooming out stops at a wall at once);
  the focus lag tightens in proportion so the fighter keeps its framing when sprinting zoomed in. Chrome notches,
  Firefox lines and trackpad deltas normalised. Locked on, the wheel still switches targets. Test:
  scripts/test/zoom.mjs. (A first version narrowed the FOV instead; the owner wanted a real move toward the body.)
- Lock-on: the camera frames the target and attacks, guards and aimed jutsu turn to it; movement is exactly the
  free movement (run 8 m/s, ninja sprint 12 m/s, facing the travel direction, dashes turn you); standing still
  (no input, skid over, < 3 m/s) turns you to face the target in the fighting stance. Brackets frame the whole target.
  (It used to strafe: facing the target, 15% / 30% slower sidesteps and backpedals, no sprint: the owner called it
  walking "like a stupid fellow", 2026-09-29.)
- Climbing: wall run up any trunk into a branch and you mantle onto it (every branch reachable).
- Boot screen key art (three in-game shots, scripts/tools/keyart.mjs).
- Debug: F3 performance overlay, F4 hurtboxes / hitboxes / rewound positions, F6 collider greybox.

## Characters + names (2026-09-27)

- Title screen, right side: **your name** (16 characters, remembered) and **character cards** (click, or 1-4 /
  arrows; Enter in the name field or any other key joins; four cards sit in one row). Empty name = the character's
  name ("Naruto 2"...).
  Cards are offscreen renders of each model in its fighting stance (src/ui/portrait.js, shared with the HUD portrait).
- **Sage Naruto** (id `sage`): Naruto's exact data (stats, frame data, hitboxes, jutsu) in the body of "Naruto Sage"
  by ninjatorent13 (Sketchfab, CC BY 4.0, credited in README, on the card and in the VRM meta). The download had no
  skeleton (4,316 triangles, 256 px flat-painted textures): `npm run rig` (scripts/tools/rig.mjs +
  models/naruto_sage.rig.json) builds a 60-bone VRM 1.0: humanoid skeleton incl. all 30 finger bones (fists close),
  T-pose skin weights (spine by height, arms along x, legs by height, soft armpit/crotch masks), the long coat
  following hips + both thighs (never the shins), the back scroll rigid on the spine, small accessories rigid,
  headband tails on spring bones with a back collider, MToon toon materials with outlines; scaled 0.93 to the stand-in's
  body size (hips 0.905 vs 0.908 m) so both characters have the same hurtboxes.
- Every character has its own model, clip library (keyed moves baked for its body), instance pool and clone pool;
  remote players and their Shadow Clones draw in their own character's body; renames relay to every screen.
- Tests (dist-test): chars.mjs ALL PASS (10 checks); mp.mjs 0 ms + 200,40,1 ALL PASS; mpcombat.mjs 0 ms ALL PASS,
  as Sage (`CH=sage`) ALL PASS (flight 0.1 cm), 200,40,1: 3 of 4 runs ALL PASS (1 run's substitution didn't fire:
  loss-stall timing, passed 3 reruns in a row); animcheck as Sage ALL PASS (planted-foot drift max 1.5 cm at 12 m/s, no
  movement pops); animcheck default: the known rare lock-on-release foot spike (16.4 deg) once, else PASS;
  perf.mjs 6 fighters mixing both models, High, 1080p: 225-244 fps, 1% low 112-125, CPU 3.5-3.8 ms, 142-179 calls,
  1.10-1.15 M triangles, 46 shader programs (unchanged: nothing compiles mid-fight). ALL WITHIN BUDGET.

## Madara (2026-09-27)

- **Madara** (id `madara`, card tag UCHIHA LEGEND, key 3): Naruto's exact data (stats, frame data, hitboxes, jutsu)
  in the body of "FreeFire New 3D Character Madara Uchiha." by AJ Studio (Sketchfab, CC BY 4.0; credited in README, on
  the card, in the VRM meta). Red samurai armour over a dark robe, long hair to the thighs. 12,734 triangles, 4
  materials (head+hair, shoes, trousers, robe+arms+armour), no skeleton, **A-pose** (arms ~48 deg down).
- Rig (models/madara.rig.json, `npm run rig`): `apose` lifts the arms into a T-pose (48.2 deg at the shoulder, 4.5 at
  the elbow; shoulder plates turn rigidly), 57-bone VRM with all finger bones, face/ears/side locks rigid on the head,
  the long hair a 5-joint spring chain from the head (bangs in front stay on the head: `front`) with back colliders,
  the robe (one piece with the torso and arms) a coat below the waist (hips + thighs, never the shins), the 32
  tasset plates and their cords `plates` (rigid, the coat's weights at their centre: they swing with the legs without
  bending), the tall collar flaps rigid on the upper chest, pauldrons and buckles rigid. Checked in modelview: skeleton,
  weights, run / kick / crouch / arms / punch poses (no tearing), then in game.
- Body size: his legs are ~15% shorter for his torso than the other bodies', so no single scale matches hips, shoulders
  and head. Scale 1.12 puts them between: hips 0.858 m (others 0.905-0.908), shoulders 1.255 (1.243-1.274), head
  bone 1.421 (1.361-1.386), height 1.72 m with the hair spikes. Arms 0.4425 m (stand-in 0.4345).
- Game changes made for him (all bodies benefit): keyed hand targets now follow the shoulders (keyframes.js +
  Rig.shoulderY/armLen; Madara's guard would otherwise sit at his chest), swinging feet follow their landing spot over
  ~50 ms (gait.js Gait.follow: a sudden velocity change jumped a late-swinging foot 16 cm), the title's card grid fits
  3-4 cards in one row (wider panel, smaller logo). rig.mjs: `apose` (with the forearm-line armpit test), TPOSE
  output, `plates`, chain `front`, `fingerSkip`, `thumbTip`, `apose.keep` (the last three for Obito); Sage rebuilds
  byte-identical after each.
- Tests (dist-test, ports 3101/3102/3104): mpcombat `CH=madara` ALL PASS at 0 ms (flight 0.1 cm) and 200,40,1 (flight
  0.0 cm); kovis `CH=madara` ALL PASS at 0 ms (KO paths within 6.8 cm, 6 clone hits) and 200,40,1 (6.7 cm); chars.mjs
  `CH=madara` ALL PASS (key 3, remembered, remote model + clip library, clones in Madara's body), default chars ALL
  PASS; regressions after the keyframes/gait changes: mpcombat `CH=sage` and default ALL PASS, animcheck Sage ALL PASS
  2 of 2, default ALL PASS. animcheck `CH=madara`: ALL PASS 3 of 3 on a quiet machine (planted-foot drift max 1.35 cm
  at 12 m/s); the every-run strafe pop (16-18 deg) is fixed. While two sessions ran headless Chrome at once, single
  runs flagged one frame of the sprint's fast mid-swing (his shorter legs step faster at 12 m/s, so the smooth foot
  rotation peak sits nearer the detector's limit): load noise, gone on the quiet machine.
  Filmstrips (shots/madara/): idle, guard, stance, sprint (hair streams back), light combo, Rasengan, Shadow Clone
  Rush (Madara clones), Rasenshuriken, shuriken; in-game close-ups front/back show no outline blotches after the
  winding fix. perf.mjs back to back: 6 Madaras 168-228 fps (CPU 3.7-5.0 ms, 107-144 calls, 1.0 M tris, 46
  programs), 6 Sages 192-231 fps: within noise of each other. Final quiet-machine run: 6 Madaras 202-224 fps (1% low
  115-128, CPU 3.7-4.2 ms), mixed 4-model roster 153-168 fps (1% low 92-105, CPU 5.1-5.9 ms): ALL WITHIN BUDGET. The
  mixed roster is the slowest scene because of the stand-in (6 stand-in Narutos: 93-97 fps, CPU 9.4-9.8 ms, 230 calls,
  measured under load), not the new models; with other tests running it dipped to 131-151 fps.

## Obito (2026-09-27)

- **Obito** (id `obito`, card tag OBITO, key 4): Naruto's exact data in the body of "Free Fire New 3D Character Obito
  Uchiha" by AJ Studio (Sketchfab, CC BY 4.0; credited in README, on the card, in the VRM meta). Ten-Tails Jinchūriki
  look: open white cloak to the ankles, flared dark pants, bare feet, horns, collar spikes, 10 Truth-Seeking orbs.
  12,422 triangles, 2 materials (body, head), no skeleton, **A-pose** (arms 51 deg down).
- Rig (models/obito.rig.json, `npm run rig`): `apose` lifts the arms into a T-pose (51 deg at the shoulder, 10.7 at
  the elbow; the orbs stay put via `keep`), 52-bone VRM with all finger bones (`thumbTip` + `thumbRadius`: the thumb
  runs along x under the index finger, so it is told apart by distance, not z), head mesh rigid on the head, the cloak
  (one piece with the torso and arms) a skirt below the waist (hips + thighs, never the shins), pants and feet on the
  legs, the 8 back orbs + collar spikes rigid on the upper chest, the 2 orbs beside the hands rigid on the hips (on
  the hands they covered the face in the guard stance and the HUD portrait). Scale 1.101: hips 0.908 m like the
  others (height 1.61 m, shoulders 1.25 m), so the hurtboxes are the same.
- rig.mjs fixes found with this model (Sage rebuilds byte-identical after each): a mirroring node transform
  (negative determinant) is handled, and every triangle is oriented to its vertex normals. The ripped Free Fire
  meshes wind ~half their triangles backwards (the source hides it by drawing double-sided); MToon's outline hull then
  showed as dark maroon blotches on the cloak and pants (Madara had the same). Now 100% of triangles agree.
- Tests (dist-obito builds, ports 3105-3107): chars.mjs `CH=obito` ALL PASS (key 4, remembered, remote model + clip
  library, clones in Obito's body on the other screen); mpcombat `CH=obito` ALL PASS at 0 ms (flight 0.1 cm) and at
  200,40,1 (flight 0.0 cm); kovis `CH=obito` ALL PASS at 0 ms and 200,40,1 (KO paths within 6.9 cm, clones hit);
  animcheck `CH=obito` ALL PASS 2 of 2 with the gait swing-follow fix (planted-foot drift under the 2 cm limit, no
  pops; Sage ALL PASS in the same session; before that fix both showed the same lock-on-release foot spike);
  filmstrips of idle, sprint, combo, Rasengan, Shadow Clone Rush and shuriken look right. perf.mjs (run alone):
  6 Obitos 190-226 fps, 1% low 109-137, 77-108 calls, 1.0 M triangles, 46 programs: ALL WITHIN BUDGET (fewer calls
  than 6 Sages: 2 materials vs 3). The mixed roster (130-146 fps) is held back by the stand-in's VRoid model, not the
  new ones.

## Itachi (2026-09-28, owner's request)

- **Itachi** (id `itachi`, card tag AKATSUKI, key 5): Naruto's data (M1 strings, stats, hitboxes; his own jutsu since:
  see "Itachi's kit" below) in the body of "Itachi Uchiha Sharingan Akatsuki Amaterasu" by angelolamonaca (Sketchfab, CC BY
  4.0; credited in README, on the card, in the VRM meta). Akatsuki cloak with clouds, forehead protector, Sharingan,
  Amaterasu blood under the left eye, leg wraps, sandals with purple toenails.
- The download is a **display figure**: a head, a closed cloak whose sleeves are fused into its sides (arms hanging
  inside, never modelled), and the shins + sandals below the hem. No arms, hands, torso or thighs; 46,043 triangles
  in 28 primitives / 25 materials (a 13,776-triangle necklace and the shirts hidden in the closed collar).
- Rig (models/itachi.rig.json, `npm run rig`; new optional rig.mjs steps, Sage/Obito/Madara rebuild byte-identical):
  `shift` (feet to 0), `drop` (the hidden shirt, undershirt, necklace), `simplify` (toes 7,472 -> 1,847, sandals
  5,212 -> 1,824 triangles, meshoptimizer from three's libs), `reshape` (the fused sleeves pulled into the cloak's
  sides: it hangs like a cape), `parts` (generated: Akatsuki sleeves with a flared cuff and red lining, wrists, hands
  with 4 fingers + thumb and purple nails, near-black trousers from the hips into the leg wraps), `islands.noArm`
  (the cloak, modelled for arms down, never follows the arm bones), a coat split sharply at its front slit
  (`skirtSplit` 0.03, `skirtMax` 0.75: the front panels part over a striding thigh and show the red lining), `atlas`
  (all 14 flat colours painted as 32 px cells into the cloud texture's empty middle, ears drawn in the skin colour):
  **1 material, 1 primitive, 24,320 triangles**, 52 bones (all finger bones; fists close), height 1.61 m, hips
  0.908 m (the stand-in's proportions; the legs keep the model's wide stance), 1.2 MB. scripts/tools/png.mjs: a small
  PNG codec for the atlas.
- Game changes: title screen fits 5 cards in one row (`.five`: wider panel, smaller type and logo; checked at 1280,
  1600, 1920 wide); the HUD portrait takes `card.face` (m above the head bone; Itachi 0.07: his collar hides
  everything below the eyes).
- Tests (dist-test): chars.mjs `CH=itachi` ALL PASS (key 5, remembered, drawn with his model + clip library on the
  other screen, clones in his body) and default ALL PASS; animcheck `CH=itachi` ALL PASS 2 of 2 (drift max 1.72 cm);
  the moving combo's one 26 deg leg frame is the strike clip's (Naruto 27.1, Obito 27.2: strikes are not limited);
  mpcombat `CH=itachi` ALL PASS at 0 ms (flight median 0.2 cm) and 200,40,1 (0.0 cm); kovis `CH=itachi` ALL PASS
  (KO fall within 6.1 cm on both screens, 6 clone hits). perf 6 Itachis 213-248 fps, 1% low 118-137, CPU 3.3-4.0 ms,
  68-98 calls, 1.29-1.38 M triangles; 6 Obitos back to back 208-232 fps, 82-114 calls. Programs 65 either way, and
  65 with Itachi left out of the roster: he adds none (the count was over the 60 budget before, see Madara's kit).
  Shots in shots/itachi/ (source figure, the cloak alone, the rig in modelview poses, films of run/combo/idle/guard).

## Itachi's kit (2026-09-28, owner's request)

Itachi keeps Naruto's movement, M1 strings, heavy and shuriken, with his own jutsu (data src/shared/itachi.js, shared
geometry itachikit.js, client src/game/itachi.js, visuals src/gfx/itachifx.js + Madara's Billows, clips
src/char/itachimoves.js). Casts come in phases like Madara's (n:0 at the press, n:1.. the effect).
- **Q Phoenix Sage Fire** (30 chakra, 9 s): seal, fingers to the mouth, fireballs at frames 18/30/42 (each phase n =
  1..3 with its origin + direction; they leave spread ±0.32 rad and curve in). Homing = a turn-rate limit (4.2 rad/s)
  toward an intercept point (the target's smoothed drawn velocity × time to reach it): a sprinting target is hit;
  a dash (the target's ST.dash or FLAG.invuln on this screen) loses the lock for good. The caster's copy detects hits
  (swept sphere vs drawn hurtboxes, like the shuriken); other screens fast-forward a late copy and burst it on bodies.
  45 flinch, 45 flinch, 75 knockback (`phoenixFire:shot`/`:last`, cls proj: Madara's barrier reflects them).
  The dodge is also the server's (`spec.dodge`): a ball's hit is refused ("dodged") when the victim dashed or
  substituted while it flew (its phase time to the hit), whatever the caster saw: at 200 ms the caster sees the dash
  ~330 ms late and its ball would "hit" where the victim was (found by the lag run, one in three).
- **E Tsukuyomi** (35 chakra, 15 s): the gaze at frame 18 (n:1: his eyes + facing); the **server** takes everyone in
  the cone (18 m, 38° + body radius, ±5 m height, clear line from his eyes to the chest, not invulnerable at that
  time, each victim where its own screen had it: like the meteor). New reaction `REACT.daze` (9): 5 s standing
  (stun 300), unblockable, no substitution (no stun window), opens no combo. `keepDaze` (shared/combat.js): a hit
  that doesn't throw a dazed victim leaves it dazed to the genjutsu's end (`dz`, in hitr; the attacker predicts the
  same); a launch/knockdown breaks it; the knockdown rule (3.5 s / 12 hits) still applies. The victim stands in the
  `dazed` loop clip for everyone else.
  **Its looks (2026-09-29, from the owner's Shinobi Striker reference shots):**
  - Every screen, from the clip (frames 10-40): a great Mangekyō projected ~1.1 m before his eyes, facing his gaze,
    popping in and turning (SealFx, tsukuyomifx.js: Itachi's pattern: a red iris with a hot core, three sickle blades
    off the pupil, a ragged black brush ring with thorns and three horns sweeping off it).
  - Every screen, on each victim from its hitr (updateDazed, ~2.6 s): a white flash sphere tearing wind streaks off
    it, a violet sphere (rim-lit, a highlight, a dark core), three great black blades sweeping in and closing, a red
    ring tearing into ink, then the whole Mangekyō over the body (the body shows through the iris); then the eye mark
    opens over the head for the rest of the daze.
  - The victim's own screen (src/game/tsukuyomi.js, timeline `TSU`): the Mangekyō spins up over the arena as it
    reddens, its pupil swallows the view (GenjutsuEffect `eye`/`cover`); under the black a stage is built where the
    victim stood (turned so the stand-in Itachi stands toward the real one; the camera side/angle with a clear view:
    viewScore): a T cross of pale weathered wood (toon, canvas grain), rope at the wrists and ankles, the victim's own
    body bound to it (`tsu_bound` clip: arms along the bar, feet off the ground, head rolling) and the caster's standing
    before it (`tsu_watch`), both stand-ins from the model pools (Tsukuyomi kits warm one more instance); a hole opens
    in the black onto it (the violet sphere over the victim, image 7). The world dims and drains (the ink pinwheel
    over the victim, the first katanas streaking in: image 8), a white fog closes in (fog near/far eased, then mono;
    at full fog the arena, its sky dome and every real fighter are hidden and the stage's sky shell + ground disc take
    over: image 9), then under a flash it turns negative (luminance flipped onto a black / blood-brown / dusty-rose /
    white ramp; a boiling blood-brown sky with black cloud masses, white ground, the fog its own negative: image 10)
    while katana volleys (12, ~40 blades, 1.4x size, faceted steel with a hamon, wrapped grips, motion streaks) fly in
    from Itachi's side at every angle and stick on the victim's bones (quivering, ink bursting out the far side, drops
    arcing and staining the ground, the body jerking, the camera shaking). A slow dolly in + a slight dutch tilt; the
    HUD and nameplates fade; its own sounds (tsukuyomi in/dim/fog/neg/out, a sword stab). The eye closes it (the same
    wipe backwards) half a second before the daze ends (sooner if a launch breaks it, at once on a respawn), and
    everything is given back: the arena, sky, fog, outline reach, HUD, the real bodies, the stand-ins' VRMs.
    Purely local and visual: no protocol change; other players see the capture and the mark.
- **G Crow Clone Escape** (20 chakra, 10 s): the spot is picked at the press (itachikit escapeSpot: rings 14-22 m
  (2026-09-29, owner's request; were 7-12), falling back to rings at half that when nothing is free (the arena's edge),
  free standing room, no drop, not the river, in bounds; score = distance from the nearest enemy + 6 if no enemy can
  see it + a little randomness). Frame 5: n:1 with the spot, moved there locally (not teleportTo: it ends the action);
  the server checks reach (maxDist 26 m) and room and broadcasts it to everyone incl. the sender (no seq bump needed: the
  socket keeps order). Invulnerable 0.6 s from the press (`p.escape`, FLAG.invuln). Hidden from frame 5 until the
  crows have gathered (form 26; a late screen still gets >= 0.25 s of gathering). Crows: instanced low-poly birds,
  two-joint flapping wings in the vertex shader, banking; feathers fall on the GPU.
- **R Amaterasu** (ult): since 2026-09-29 a cinematic on every screen (see "Amaterasu's cinematic" below; before it,
  the eye opened at frame 30, now the pick is at frame 12 and the flames at 262): the server takes the cone (30 m, 34°, ±8 m, line of sight): `amaterasu:ignite` (40, stagger)
  then `v.burn`: server ticks every 18 frames (25, react none, through invulnerability, substitution and barriers)
  until the flames have taken 50% of max HP (the ignition counted; the last tick is the remainder). A KO or respawn
  puts them out. Black flames: Billows with `black` (ink-black, crimson-violet rims, tall tongues: `stretchK`),
  licking off the victim's hurtbox capsules; burn ticks don't white-flash.
- Server hits (the gazes, the burn) go through `serverHit` (now returns whether it applied; `srv` hits don't
  count toward the attacker's rate limit). The attacker's screen shows their feedback from hitr (SERVER_HIT).
- Tests: `scripts/test/itachi.mjs` (31 checks since Tsukuyomi's world: + B's screen enters it (stage up, real bodies
  hidden, two stand-ins, HUD away), the caster's doesn't, the fog hides the arena, everything given back, no shader
  compiled mid-fight; 31/31 at 0 ms and at 200,40,1; mpcombat ALL PASS; perf default roster 146-154 fps, 1% low
  78-98, CPU 5.4-5.8 ms, 79 programs (+9, all compiled at load). Earlier: 26 checks: fireballs hit + sync + HP, dash dodge (client and server-only), Amaterasu exactly 300 of 600
  through a dash on both screens, Tsukuyomi 5 s daze on both screens + no move/sub + a hit keeps the daze + free after +
  none behind him, crow burst/hidden/re-form 7-12 m away at the same spot on both screens, invulnerable, a runner hit
  by all 3) **26/26 at 0 ms (:3104) and 26/26 at 200,40,1 (:3102)**, several runs each. Regressions ALL PASS:
  madara.mjs, mpcombat, mp, chars (default and CH=itachi; its clone check skips kits without clones);
  clipflips-live `^(ita_|dazed)`: no flips on any body. perf 6 Itachis 231-254 fps, 1% low 122-139, CPU 3.2-3.6 ms,
  69 programs (+4: black flames, eye marks, crows, feathers; all compiled at load). `scripts/test/itachiperf.mjs`
  (1080p High, each ability on the dummy): quiet 305 fps, everything at once 255 fps (1% low 141), 0 programs
  compiled mid-fight. Shots in shots/itachi/ (look*, film_*, duo_*: both screens).
- Not yet: the owner's review (looks, feel, balance: a 5 s stun every 15 s is strong; Amaterasu's 50% is certain
  once caught); Madara's barrier reflects a fireball as a shuriken.

## Itachi's crow shift + longer G (2026-09-29, owner's request)

- The owner's references (Shinobi Striker, an Uchiha dashing): the body gone for the dash, a torn stroke of dark ink
  where it went, feathers, cyan-green chakra, speed lines, then the fighter swiftly shown where it arrives. Wanted on
  his Shift dash and on G (the same look), crows from where he left on the dash and on any ability, G farther.
- **Data:** `crowShift: true` in itachi.js (visual only: the dash's movement is everyone's). G `dist` [14, 22],
  `maxDist` 26 (the server's limit).
- **InkStrokes** (itachifx.js): every ink stroke on screen in one dynamic mesh, one draw, one program (compiled at load).
  A strand = a path of points (x, y, z, birth time, arc length); the vertex shader widens it about the path toward the
  camera, leaned toward the vertical (`lean`; its sign from the path's right side: taken from s.y it flickered seen from
  behind), so from the side it stands up like a body-high smear and from behind two opposite leans cross like brush
  strokes. Fragment: bristle fibres pinned to the arc length (they don't swim as it grows), a ragged torn edge, a round
  tip at the head, a dry-brush tail, fibres fraying at the edges; each point dries `life` s after it was laid
  (purple-black, crimson at the fringes and bleeding in toward the tail, per-strand alpha). `release(S, fade)`: the
  rest dries within `fade` s (its fresh head lingered by the body), added on top of the age: no pop.
- **The dash** (src/game/itachi.js `updateShift`, every Itachi on every screen, from the drawn view: `view.st ===
  ST.dash`, so it matches the body exactly, remotes included): hidden while dashing; SHIFT_STRANDS following the body;
  at the start crows out to the sides and up, feathers, an ink splash, aqua sparks, a wing flutter
  (`audio.crowShift`); on the way aqua sparks (fx kind 6), white speed lines (kind 2), feathers (`inkWake`); at the
  end the brush lifts and he takes shape in ink drawn in round him (`inkForm`).
- **Toned down (2026-09-29, owner's review with a screenshot: "the black thing is too much, overexaggerated", pointing
  at the reference's single slim streak):** the dash was four strands up to 1.4 m wide (0.2-1.7 m high) + two upright
  camera-facing ink blots where he was + ~25 dark ink puffs; now **one slim streak** (half width 0.3 at 0.8 m: hips,
  alpha 0.88, dries in 0.36 s) + a thin dry flick above it (0.09 at 1.22 m), no blots (a slim one left read as a stray
  stick), dark puffs x0.15 on the way, x0.3 at the start, x0.35 at the re-forming (`ink` share arg of
  inkWake/inkSplash/inkForm). Crows, feathers, sparks, speed lines unchanged; G's comet and the substitution unchanged
  (bold on purpose). Colour: purple-black bleeding to crimson toward the tail like the reference. itachi.mjs
  crow+shift 11/11 at 0 ms and at 200,40,1; mpcombat CH=itachi ALL PASS. Shots: shots/shift/lite_left2, lite_fwd.
- **G:** the burst adds an ink splash; `crowGather` launches `inkComet`: three strands flying from where he vanished to
  the spot on an arc (up to 3 m high), fast off the mark and easing in as the crows arrive, sub-stepped every 0.5 m
  (a smooth arc at any frame rate), on its own frame clock (on the server clock it outran everything in slow motion);
  `formFx` adds `inkForm`. **Substitution** (`onSub`, local combat.substitute + remote main.js sub): crows, feathers
  and ink where he stood, ink gathering where he appears.
- **Crows never fill the view** (gotcha 57): `flyOff` takes the camera-ward part out of a crow's velocity, and every
  crow shrinks away within 3 m of the camera (Crows vertex shader). Inside Tsukuyomi's world (this screen) none of it
  is drawn (the body still hides).
- **Tests:** itachi.mjs `shift` (new): every drawn frame on both screens, hidden exactly while the view says dash (0
  mismatched frames), ink drawn, crows, visible after, the ink dried out; `crow` now checks 14-22 m. **36/36 at 0 ms
  (:3104)**, crow/shift/fire **17/17 at 200,40,1 (:3102)**; mpcombat CH=itachi ALL PASS at both (substitution with the
  crows). Programs 79 before and after a dash, a G and a substitution (nothing compiles mid-fight). perf (6 Itachis,
  back to back): quiet 231-248 fps, 1% low 98-141, logic+anim 1.5 ms; `BOT_DASH=1` (bots.mjs: every bot dashes 0.28 s
  of every 1.2 s) 215-238 fps, 1% low 98-134, logic+anim 1.6 ms. Shots: shots/shift/ (behind2, side, g: slow motion).

## Itachi password lock (2026-09-28, owner's request)

- Itachi can only be played with the password **HUNNY** (exact, case-sensitive). The SERVER checks it
  (server/index.js `LOCKED`; never in the client bundle): `join{..., pw}` for a locked character with a wrong or no
  password gets `locked{ch, pw}` (no player created, logged "refused itachi"). Characters with `locked: true`
  (itachi.js) get a 🔒 in their card tag and a password field under the cards while picked (focused when picked by
  hand); Enter in it joins; a missing/wrong password shows a red field + message and stays on the title screen. The
  password is saved (`shinobi.pw`) once the server accepts it; URL `?pw=` fills it (tests: every script that can join
  as Itachi adds `&pw=HUNNY`; bots.mjs sends it).
- Tests: chars.mjs (sage and CH=itachi) ALL PASS, with 3 new checks (field shown + focused, no password stays, wrong
  password refused by the server); a raw WebSocket join: no password / "hunny" refused, "HUNNY" welcomed.

## Map pass: trees, houses, stairs (2026-09-28, owner's bug report)

- **Houses: you could end up inside a roof.** Wall-running up a gable end and vaulting landed on the wall's top,
  which is inside the roof's solid slopes near the ridge; pushOut can't free a body whose centre is inside both slopes
  (each pushes it into the other), so you were stuck in the attic. Also, jumping uphill at a roof slope could sink
  into it (the landing test looked only 2 cm above the feet, while sideways a body passes over anything within a
  step). Fixes: vaults and mantles land only where there is room (`Controller.standAt`: on the roof itself if the
  wall's top is inside it, else keep climbing under the eave); a falling body lands on anything within a step above
  its feet (physics.js, the same rule as pushOut); and a safety net (`Controller.unbury`): a body whose middle is
  inside a solid stands on that solid's top. `scripts/debug/embed.mjs` (wall runs up every face of every house and
  every trunk): 116 of 624 ended inside a roof before, 0 after (0 also with the safety net off: `NOUNBURY=1`).
- **Stairs shook the fighter.** Two causes: a collider per step (a 0.31 m step-up every 0.46 m), and physics reported
  ground rising along ANY slope as a "step up", so the renderer pulled the drawn fighter down every tick and eased
  it back (a sawtooth on every ramp, hill and roof). Now the stairs are one ramp collider under the drawn steps (through
  the middle of each tread), and only a real ledge counts as a step up (rise beyond what the slope explains).
  `scripts/debug/stairs.mjs` (real input up the stairs, per drawn frame): the drawn height's rate went from a
  sawtooth (spread 6.5 m/s, 16.8 frame-to-frame) to smooth (0.56-1.2 m/s, 2.5 sprinting).
- **Stairs looked buggy** (full-height slabs as side walls, no colliders on them, dead-end gaps between them and the
  houses, an invisible landing past the last step): rebuilt to fill the whole slot between the ramen shop and the
  next house: 16 steps with pale nosed treads, balustrades on both sides (a newel post at the foot, a wall whose top
  follows the steps, a post at the top, coping stones; all with colliders), a landing onto the terrace.
- **Trees.** The drawn root flare stood up to 60% outside the trunk's collider (you and the camera ended up inside the
  wood: the "in between the trees" screenshot), branches were straight logs poking out of the trunk with a ball of
  leaves at the end (some ran into neighbouring trunks and cliffs), and the trunk's top ended inside the canopy.
  Now: colliders can be cones (`cyl(..., { r1 })`: pushOut, wall runs, rays, ground all handle the taper); each tree
  is a trunk cone (r -> 0.72 r), a root-flare cone (1.6 r at the ground) and a crown platform on top of the canopy
  (run up the trunk and you mantle onto it: a lookout). The drawn trunk follows `treeRadius(t, y)` exactly on its
  buttress roots and sinks between them and in the bark grooves: nothing drawn stands outside a collider. Branches
  taper from w to w/2, rise 0.35-0.8 m outward (two sloped boxes each, their tops on the bark), swell into a collar
  at the trunk, curl up past the walkable end, fork into twigs, and carry leaf sprays out past where you stand; they
  are aimed clear of other trees, walls and the map edge. The canopy is ~20 scalloped clumps whose normals blend with
  one ellipsoid's (the whole crown shades as one mass) with vertex-colour occlusion (darker underside and inside) and
  a per-tree tint; limbs get moss on top, trunks a darker mossy foot. Leaves dissolve within ~3 m of the camera
  (toon `near`). The bark texture's round moss patches (green polka dots) became faint streaks.
- Tests: mapwalk PASS (168/168 ground cells, 56/57 branches, 22/22 tree crowns, 16/16 roofs, 0 falls, 0 trapped, and a
  new check: never standing inside a collider), embed.mjs 0/624, mp 0 ms + 200,40,1 ALL PASS, mpcombat 0 ms +
  200,40,1 ALL PASS, kovis 0 ms + 200,40,1 ALL PASS, chars ALL PASS, animcheck ALL PASS, perf.mjs (run alone) 148-159
  fps, 1% low 82-98, CPU 5.5-6.0 ms, 146-179 calls, 1.29-1.34 M triangles, 48 programs (+2: bark and leaves use vertex
  colours): ALL WITHIN BUDGET. The one missed branch is the bot's steering (a head-on climb lands on it).
- The map hash changed (new colliders): restart the server with the client (`npm start` does both).

## M1 rework: two strings (2026-09-28, owner's request)

The old light chain (jab, cross, knee, spin kick, launch kick; short steps) is replaced for players by two new strings
that travel 8-10 m, all keyed on the frame data (naruto.js U1-U5, S1-S5; clips in moves.js; Madara and Obito share
them). L1-L5 stay only for the Shadow Clone Rush's clones.
- **Uzumaki Barrage** (M1 from a standstill or a walk): U1 Lunge Straight (a skip-lunge rear straight), U2 Switch
  Roundhouse (head-height left shin), U3 Wind Palm (double palm + a wind-release gust, stagger), U4 Flip Heel Drop
  (a tucked front flip, the right heel chops down, scissor landing), U5 Whirlwind Roundhouse (jumping 360, knockback).
- **Scroll Rush** (M1 at >= 5 m/s or out of a dash): S1 Slide Kick (3.4-4.2 m along the ground, stagger), S2 Scroll
  Draw Strike (the scroll comes off the back in a puff, a diagonal club strike), S3 Grapple Toss (seize + heave:
  launch), S4 Rising Scroll (a leap aimed at the airborne target, juggle), S5 Scroll Meteor Slam (a front flip in the
  air, the slam spikes, a dive, a kneeling landing with a shockwave).
- AttackAction: per-move travel profile (`step.from/f/k`), `leap` (aimed vy, hangs through hitstop), `air` (hover
  like the air combo), `dive` (drop, the clip waits at the landing frame); turns to the target at 40 rad/s instead of
  in one tick; the drawn clip time is interpolated between sim ticks (strikes were stepped at 60 Hz on
  144 Hz screens); presses are counted (up to 2 ahead: five presses = five hits even faster than the moves).
- Scroll hitboxes are `grip` boxes: a capsule along the fist's grip axis (hurtbox.js gripSegment), the same segment
  the scroll prop is drawn on: F4 shows it on the scroll.
- src/gfx/movefx.js (MoveFX): limb/scroll trails (Catmull-Rom ribbons, 0.11 s), the scroll prop (8 pooled, toon), and
  frame events (wind gust, chakra flashes, dust, grab flash, puffs, the slam's shockwave + camera shake), driven by
  each fighter's clip + time: identical on every screen (the victim's client drew the scroll 114 frames, trails 81).
  ~0.04 ms per frame (max 0.8).
- keyframes.js: `roll` (cartwheel axis); moves.js: flip helpers FF/FH (limbs in the body frame of a tilted pose).
- fx.js: the impact burst's core was undefined in its last 30% (smoothstep with edge1 < edge0): a white square
  flashed at the end of every hit's burst. Fixed.
- Tests: mpcombat 0 ms and 200,40,1 ALL PASS (5/5 confirmed, 0 corrected, flight p90 0.1 cm); Scroll Rush under
  200,40,1 5/5 confirmed, 0 rejected, 3 of 3 runs (scripts/debug/m1trace.mjs); kovis both ALL PASS; chars, mp ALL
  PASS; clipflips (default rig) and clipflips-live (every character's rig): no flips; animcheck light + moving combo
  PASS for the stand-in and Sage (locomotion scenarios flagged single load-noise frames while another session ran
  headless Chrome, a different scenario each run: see Known issues); perf.mjs A/B old vs new bot moves back to back:
  same fps (231-250 quiet, logic+anim 1.4 ms both), 54 programs (all compiled at load).
- Review tools: scripts/debug/m1film.mjs (slow-motion filmstrip of one move or a string, F4=1 hitboxes),
  m1cast.mjs (real speed vs a real victim via Chrome's screencast, VIEW=B the victim's screen), m1trace.mjs (per-frame
  heights, gap, confirmations), clipflips.mjs / clipflips-live.mjs (keyframe flips).

## Test results (2026-09-27, dist-test builds)

- `mp.mjs` at 0 ms: ALL PASS (remote error vs the true path median 0.04 m, p90 0.11 m; settles to 0.000 m).
- `mp.mjs` at SHINOBI_LAG=200,40,1: PASS in 3 of 4 final runs (median 0.13-0.25 m, p90 0.40-0.49 m; interp ~111 ms).
- `mpcombat.mjs` at 0 ms: ALL PASS (5/5 hits, HP agrees, flight 0.1 cm median, substitution, KO + respawn).
- `mpcombat.mjs` at 200,40,1: ALL PASS, 3 of 3 runs after the final animation changes (flight p90 0.0-0.1 cm; late
  confirms handled). The flight check used to fail about 1 run in 3: its speed filter also counted the victim's own
  sim snapping into an earlier hit's reaction when it hears of it ~100 ms late (by design; the drawn model eases over
  it). It now only measures frames after the finisher.
- `perf.mjs` 1920x1080, vsync off, 6 fighters (5 bots + the client), RTX 4050 laptop, High:
  217-233 fps, 1% low 115-157, worst frame 7-16 ms, CPU 3.7-4.1 ms/frame (logic+anim 1.5-1.6 ms), draw calls
  188-233, triangles 1.31-1.43 M, 46 shader programs. ALL WITHIN BUDGET. Solo: 314-363 fps, ~120 calls, 0.87 M tris.
  (The same laptop sometimes runs ~2x slower on the CPU side: an earlier run measured ~105 fps for the same scene.)
  Before this pass: 80 fps, 338 calls, 1.61 M tris, 77 programs.
- Shader programs stay at 46 through combos, heavy, shuriken, Rasengan, clones, charge, guard, the ultimate, dash,
  double jump and F4 (nothing compiles mid-fight).
- `animcheck.mjs` (automated animation checks, 12 scenarios): planted-foot drift max 1.7 cm at 12 m/s (limit 2),
  no pops (> 15 deg in one frame and 2.5x the frames around it) in 2 of 3 full runs; see Known issues. Fixed on the
  way: a 180-degree thigh flip every sprint stride (two-bone IK), ninja-run arms, toe-off snaps, the double jump,
  feet teleporting on gait restarts / skids / slowing down, run-start arm snaps, the lock-on release spin.
- `mapwalk.mjs` (before the 2026-09-28 map pass; see above for now): PASS: 170/170 ground cells, 59/59 branches, 16/16 rooftops, 22/26 other high cells (the 4 missed
  are points on branches/roofs whose surfaces were reached through other targets), 0 falls, 0 out of bounds, 0 trapped.
- mp.mjs at 200/40/1 is sensitive to TCP-like loss stalls: about 1 run in 4 lands just over the median limit
  (0.39 m and 0.62 m seen, limit 0.35); the reruns measure 0.12-0.30 m. A test-noise tail, not a sync bug.

- `kovis.mjs` (new, 2026-09-27): ALL PASS at 0 ms and 3 of 3 runs at 200,40,1: the victim's own screen shows
  the KO flight and lying pose (thrown 4.6 m, hips 0.16 m), both screens agree within 7 cm, largest per-frame step
  6-17 cm (the flight's own speed; it was a 0.4-0.9 m pop at 200 ms before the ease-in fix); both clones seen by
  the target, run 9 m in, 6 clone hits. After the fixes: mpcombat 0 ms + 200,40,1 ALL PASS, mp 0 ms + 200,40,1 ALL
  PASS, mapwalk PASS (170/170, 59/59, 16/16). `scripts/debug/clones.mjs`: clones jump a 2.8 m ledge and land ~1 m
  from the target on both screens (they overshot by 1 m before the jump arc was aimed), and drop off it cleanly.

## Fixed (2026-09-27, owner's bug report)

- KO: the dying player's own screen froze in the killing hit's flinch (the dead controller stopped stepping the
  action). Now a KO knockback + lying pose on every screen, predicted by the attacker, with a collapse fallback.
- Shadow Clone Rush: the target (everyone but the caster) never saw the clones: the server dropped the 4-number cast
  origin. Clones also got physics (jumps, falls, walls), camera-based aiming, and lost the orange player ring they
  showed under them.
- Getting hit at high ping: the drawn fighter popped ~0.4 m when joining a flight already under way; it now eases.

## Hosting on the VPS (2026-09-28)

- Live at **http://185.2.49.69:3100** on the owner's Shulker VPS `games-1` (Eco, 4 vCPU / 8 GB / 50 GB, Ubuntu 24.04,
  in1). Node 24, pm2 (user `kaustab`, starts on boot), ufw (22, 80, 443, 3100), SSH by key only. `npm run deploy`
  (scripts/tools/deploy.mjs) uploads, builds and restarts. mp.mjs passes against it over the internet (RTT ~90 ms).
- HTTPS: **https://shinobi.185-2-49-69.sslip.io** (free wildcard DNS that embeds the IP, no signup) via Caddy 2.6
  (`/etc/caddy/Caddyfile`, Let's Encrypt). Same RTT as the raw port. mp.mjs passes over it. A nicer free name
  (DuckDNS) needs the owner's login; ARMORY can go at `armory.185-2-49-69.sslip.io` -> port 3000.
- Ping is ~80 ms from the owner's place. Everything is in India, but the route detours: the public IP is announced
  from OVH **Mumbai** (148.113.16.59, ~53 ms from the owner) and tunnelled to the VM in **Dadri / Delhi NCR** (~27 ms
  more). The datacentre directly (its NAT IP 45.122.121.132) is ~40 ms from the owner. Asked the owner to request
  port forwarding / a native IP on the Dadri side from Shulker (would save ~35-40 ms).
- Packet loss on that detour (measured 2026-09-28, second deploy): 10-16% from the owner's laptop to OVH Mumbai
  (148.113.16.59) and to 185.2.49.69, 0% to 1.1.1.1 / 8.8.8.8 from the same laptop; downloads from the game crawl at
  ~40 KB/s (TCP backs off on loss: the 10.7 MB stand-in takes minutes, mp.mjs times out at 120 s waiting to join).
  Not the VPS (it fetches its own public link at full speed) nor the tunnel MTU (DF pings pass up to 1420 bytes).
  The fix is the same Dadri-side IP from Shulker (skips the Mumbai hop); report the loss to Shulker support.
- `scripts/debug/vnc.mjs` drives the VPS's VNC console (type + screenshot) for when SSH is lost (how the routing bug
  above was found and fixed).
- Docs: CLAUDE.md is kept under 250 lines (owner's rule); the 40 hard-won gotchas live in `docs/gotchas.md`, which
  CLAUDE.md imports (`@docs/gotchas.md`) and indexes by title.

## Docs for the craft (2026-09-29, owner's request)

- `docs/visuals.md` (imported by CLAUDE.md): the playbook of HOW animations, effects and screen effects are built
  (reference shots -> phased timeline -> both-screen shots; keyed clips; instanced quad effects with layer weights;
  GPU particles; post grades; one-screen cinematics that borrow and give back; the must-haves: warmed at load, no
  per-frame allocation, same on every screen, free when idle). Updated after every visual change, like gotchas.md.

## Known issues / next

- Tsukuyomi's world (2026-09-29) awaits the owner's look. Limits: it plays where the victim stood, so right against a
  wall or among trees the camera takes the clearest of 14 sides/angles but may still have something in the first
  second (before the fog); a victim caught in the air gets a floating cross; real hits landed on the victim during it
  are not shown on its own screen (HP still drops, the HUD returns with the right value). Tested with the stand-in as
  the victim (no naruto.vrm yet): re-check the bound pose on the real model (the crossbar follows the wrists).
- animcheck.mjs: the old rare lock-on-release foot spike (releasing lock-on mid-backpedal) can't happen any more:
  lock-on no longer backpedals (2026-09-29). The strafe/backpedal code in gait.js stays for velocity that isn't
  along the facing (turning into a run, knockback slides).
- M1 strings: the scroll is a prop drawn in the right fist; Sage's model keeps its own scroll on its back while the
  prop is out (the back scroll is baked into the mesh, rigid on the spine: hiding it would need a rig change). The
  Scroll Rush's air half (S4/S5) is aimed at the target S3 launched: after a whiffed S3 the leap and the slam still play
  (and look right) but mostly pass over a target standing on the ground. Locomotion animcheck on 2026-09-28 flagged single
  15-20 deg frames (a different scenario each run) only while another session ran headless Chrome: re-run quiet.
- Itachi: his arms, hands and trousers are generated (the source has none): simple anime-style tubes, fine at play
  distance, plain up close. The cloak is a coat on the hips + thighs: in deep poses (crouch, high kicks, the guard's
  back leg) a thigh can still push through it (near-black, so it reads as cloak). His own kit and M1 (Sharingan,
  Amaterasu, fire style...) are not made yet: he fights with Naruto's.
- Obito: the source is a low-poly game model (Free Fire). Hands are coarse (fists close, but fingers are blocky up
  close), no facial expressions, and the shoulders stretch where the A-pose arms were lifted (fine at play distance,
  visible in a close T-pose). Licence caveat: the Sketchfab upload is marked CC BY 4.0 by its uploader, but its node
  names (`*.rip`) suggest it was extracted from the Free Fire game, so the uploader may not own it. Fine for a private
  fan project; check before anything public or commercial (the same applies to Madara, same uploader).
- Madara: the same low-poly Free Fire source (and the same licence caveat as Obito: `*.rip` node names). Up close:
  blocky gloves (fists close but the fingers are coarse), faceted sleeves, no facial expressions, small textures; the
  armpits stretch a little where the A-pose arms were lifted. His hips sit 5 cm lower than the other bodies' (shorter
  legs): kicks reach a few cm less, punches a little more (arms 0.8 cm longer). The robe's white lining shows between
  the legs in high kicks (it is the model's texture). The hair can clip into the robe in extreme poses (spring
  colliders cover the back only).
- The stand-in Naruto is the most expensive body (6 of them: ~95 fps / CPU 9.8 ms vs ~200 fps for 6 of any other
  character, same session): a mixed lobby with stand-ins can dip under the 144 fps budget on this laptop.
- Sage Naruto's model is low-poly with 256 px textures (a test model): up close it is softer than a VRoid model, and it
  has no facial expressions (no blinking). A VRoid-made or commissioned VRM drops in the same way.
- The hit-impact effect draws large white flash quads over the dummy in slow motion (seen with both characters;
  it predates the character work).
- The console shows one 404 for /assets/characters/naruto.vrm until the owner adds it (expected: the stand-in loads).
- Audio is untested by ear (headless tests can't listen): levels and character of the sounds need the owner's ears.
- The owner's real Naruto VRM and Mixamo clips are not in yet (ASSETS.md); everything runs on the stand-in avatar and
  procedural/keyed animation.

## Madara's kit (2026-09-27/28)

Madara keeps Naruto's body mechanics and M1 but has his own jutsu (data: src/shared/madara.js; shared geometry:
src/shared/madarakit.js; game: src/game/madara.js; visuals: src/gfx/madarafx.js + haze.js; clips:
src/char/madaramoves.js; test: scripts/test/madara.mjs). Every cast runs in phases (n:0 at the press: cooldown / gauge;
n:1 when the effect becomes real, with its placement), and every world effect runs on the server clock from n:1, so
it is identical on every screen (the tests measure 0.0 cm differences) and a late screen fast-forwards.

- **Q Great Fire Annihilation:** Tiger seal, inhale, a 40-frame torrent of toon fire (instanced fbm "billows",
  opaque with ink outlines, HDR into the bloom) rolling 22 m over the ground, 3 m wide at the mouth fanning out to
  16 m (was 2 -> 10 m until 2026-09-28), in 9 lanes that each stop at their own
  obstacle (thin posts flowed round, low walls rolled over, walls/trunks splash), a glowing then scorched footprint, a
  burning field (flame tongues, 12 dmg ticks, no reaction), heat haze (High/Ultra), a heat flash. 4 flinch ticks + a
  knockback. Air cast: a jet from the mouth down to where the wall starts.
- **E Wood Release:** palm slam (kneeling key pose), an 18 m line of seeded stakes (instanced, toon, shadowed) erupting
  at 30 m/s with a racing crack decal, dust and flying debris, holding 1.2 s then splitting and sinking. One launch (90).
  From the air: a fast dive, the slam on landing.
- **G Uchiha Return: the wind barrier** (redesigned 2026-09-28 at the owner's request; the first version was a
  half-second counter stance with a procedural fan that poofed into his hand). The gunbai is the owner's model
  (models/gunbai.glb -> public/assets/props/gunbai.glb, "Madara-Uchiha gunbai" by Madara.Uchiha.supreme, CC BY 4.0:
  credited in README + his card; 1,190 triangles, loaded behind the loading screen, baked to a prop frame, toon
  material, casts shadows). It rides on EVERY Madara's back at all times (upper chest's frame, head down like a
  sword since 2026-09-29, see "Gunbai fix" below; GUNBAI.back in madarafx.js,
  `__game.jutsu.madara.debugGunbai({p, up}, grip)` to try mounts live). The 90-frame clip `mad_counter`: the hand
  reaches over the right shoulder and closes on the handle (5), swings the fan out behind him and up (5-12), one
  full spin to his left with the arm out so the face pushes the air (12-31, rot keys
  <= 90 degrees apart, feet just off the ground; he turns toward the target inside the spin), the gust at 20, the
  planted guard (the fan upright in front of face and chest), the same arc back onto his back (72-84).
  Server: from the press to frame 72 (+50 ms slack each side) EVERY hit on him is answered, any number of times:
  melee -> refused (`hitx why:counter`), the attacker blown back once (`uchihaReturn:blow` 60, knockback [9, 5]:
  a few metres; a clone is dispelled); projectiles -> reflected (50 each, every shuriken of the cast); ultimates and
  areas (fire, stakes, meteor, another Madara's gust/blow/reflection) -> deflected (`f:3`). An attack the barrier
  answered is spent: its later hits are refused for 3 s (`deflected`: a Rasenshuriken's burst, a torrent's ticks and
  its field don't catch him when the wind drops; `n:1` carries `ai`, the attack's instance, so the attacker's screen
  stops predicting it too). The gust (server-applied at the press + 20 f, judged like the meteor): everyone within
  4.2 m of his feet (2.6 m up), in the open, is thrown back (`uchihaReturn:gust` 30, knockback [8, 4.5]); someone the
  blow already threw isn't caught again. The blow/gust/reflect specs are `server: true`: a client reporting one is
  rejected (`move`). Frames 72-90 (the fan going back) are vulnerable. No invulnerability FLAG in his states (it would
  stop attackers' screens sending the hits the barrier answers). Visuals (madarafx.js WindBarrier, pooled x4): 26
  wind ribbons built in the vertex shader (70% thin broken brush lines, 30% soft bands; faint on the camera's side), a
  faint shell whose hit rings run from where it was struck, the gust's wave (tapered wind strokes on an expanding
  band, faded edge-on and near the camera) then a small pulse every 0.5 s, dust and grass bits whirled at his feet, a
  wind trail off the fan through the draw/spin/return, heat-haze distortion (High/Ultra). Sounds: the draw, the spin
  whoosh, the gust's thump, a swirling wind loop while it holds, a clang per answer. A cast cut short with the fan out
  (a hit before the barrier rose) puts it back in a puff.
- **R Tengai Shinsei**: the arm raised to the sky, released at frame 30; a 7 m rock (lumpy, cratered,
  faceted toon basalt with molten cracks glowing on its leading face, flames licking round it, a black smoke trail)
  falls from 70 m behind and 110 m above the impact point, landing 1.8 s later. The ground shows red danger rings (core
  5.5 m, outer 13 m, pulsing faster) and the rock's shadow growing dark and sharp; the light dims and the ground
  trembles as it comes. Impact: a fireball rolling out along the ground, a smoke column, 30 flying rocks, dust,
  shockwave, flash, camera shake by distance, a crater whose cracks glow and cool, fading after ~9 s. The server
  applies the impact itself (it lands even if the caster dies or lags): everyone inside the outer ring, in the open,
  not invulnerable, judged where their own screen had them (+ half their ping, max 150 ms): core 420 knockback
  (unblockable), outer 200 -> 80 by distance (chip through guard).
- **Tuning pass (2026-09-28, owner's request after playing):** the torrent fatter (w0 2 -> 3, w1 10 -> 16 m, lanes
  7 -> 9, field 8 -> 12 m wide with 76 tongues, blobs ~10% bigger, fanning out from the mouth over 3.5 m instead of
  5, 330 blobs/s instead of 220; smoke puffs and embers per blob cut so the totals stay the same); the meteor faster
  and bigger (delay 3 -> 1.8 s, rock 5 -> 7 m, core 4 -> 5.5 m, outer 10 -> 13 m, falloff [5.5, 13, 200, 80];
  impact effects scaled by the ring and the rock; the fall's roar follows `delay`). From the centre, the ring's edge
  is 13.3 m: a sprint started right at the release reaches it just in time. Frame times (1080p High, vsync off):
  the same as the old build within the laptop's noise (fire ~170-260 fps, meteor ~190-200 fps, back to back).
- Tests: `scripts/test/madara.mjs` (33 checks: fire, wood, the barrier's 10 (gust, blow once, two reflections in one
  cast, the window's end), meteor) ALL PASS at 0 ms (:3104); the barrier's ALL PASS at 200,40,1 (:3102) (2026-09-28,
  after the barrier). Also ALL PASS: mpcombat (Naruto and CH=madara), kovis CH=madara, mp, chars; clipflips-live
  `^mad_`: no flips. perf 6 Madaras 161-181 fps, 1% low 102-143, 66 programs (the barrier adds 4 programs, the old fan's
  3 are gone: +1; the count was already over the 60 budget before). Shots in shots/mkit/ (freeze.mjs sheets: meteor
  fall, impact, crater) and shots/gunbai/ (the mount, slow-motion strips of the cast, the two screens side by side).
- At 200 ms a jab thrown in the first ~0.1 s of the barrier is predicted on the attacker's screen (it hasn't heard of
  the cast yet) and undone by the `hitx`: inherent to the latency; the server's answer is right.
- **Gunbai fix (2026-09-29, owner's bug report: "upside down", "a gap between the gunbai and the hair"):**
  - Mount: head down like a sword on the back: the paddle hangs down his back over the hair toward his left hip
    (18 degrees), the wrapped handle rises past his right shoulder, tomoe face out (GUNBAI.back `p [-0.03, 0.11,
    -0.275], up [0.309, -0.951, 0.1]`). The paddle's inner face rests on the hair: its back measured on the model
    (gunbaicheck.mjs `back`: z -0.23..-0.27 from 0.9 to 1.45 m, robe -0.14 at 0.75 m); leaning in 6 degrees at
    the bottom. 4 cm lower than first tried: running tips his head back toward the chest-mounted fan, and the
    hair's root at the nape (driven by the head, not the springs) poked through its top edge.
  - Hair collider: while on his back the fan is a spring-bone plane for his hair (Gunbai.attach: a
    VRMSpringBoneColliderShapePlane on the normalized upper chest in the mount's frame, added to every joint's
    colliderGroups). It leans against the fan (`GUNBAI.hair`: joints held 12.5 cm off the mid-plane at the
    shoulder blades, 7 cm at the tail): the mane's spikes stand 11 cm behind its joints up top, 3 cm at the tail,
    and the hips' collider leaves the tail only ~8 cm. A flat 7.5 cm still let 10-24 spike tips through while
    running. The plane backs off as the hand takes the fan (100 m away once in the hand) and sweeps back in over
    the release's frames (a hair behind it is pressed forward, not snapped). gunbaicheck.mjs `poke`: 0 vertices
    through the face at idle, over 14 running samples, over a jump.
  - Collider matrices fixed for every character (vrm.js): three-vrm refreshes a collider's matrix only in
    updateWorldMatrix, which the scene pass never calls; they lagged a frame (8 cm behind a running fighter).
    Patched VRMSpringBoneCollider.updateMatrixWorld (gotcha 53).
  - Draw/return keys (madaramoves.js BACK / swingR / overR): the right hand over the shoulder, palm to the neck,
    elbow up and forward; the fan swings out behind him and up over the head (the paddle a half circle away from
    his back), fist out at head height at 12, then the unchanged spin. Wrists solved on his rig (gunbaisolve.mjs):
    at 5 and 82 the fist holds the fan exactly as it rides (0.1 degrees, 0 mm), so the hand-over blend is 2-3
    frames (madara.js) and invisible (the fan moves 0-0.6 deg/frame through it); the swing's wrist picked as the
    most natural (smallest deviation). Eases matched so the turn runs 4, 14, 23, 30, 30, 32, 30, 31, 33 deg/frame
    into the spin (no hitch at a key); the return lifts, holds a beat, flicks down into the grip (peak 51 deg/f).
    The paddle stays 6 cm or more off the skull, 10 cm off the torso (gunbaicheck.mjs `clear`). Timings in
    madara.js unchanged (the server's window, gust and release are the same).
  - Tests: madara.mjs ALL PASS at 0 ms; at 200,40,1 the counter set 3 of 3 PASS (one full run missed a second
    reflected shuriken: a lag stall, the server side is untouched); animcheck CH=madara, mpcombat CH=madara, chars
    ALL PASS; perf 6 Madaras 306-341 fps, logic+anim 1.0 ms, 70 programs (the last commit: 70 too). Shots in
    shots/gunbai/ (before, rest, run, draw1-2, head, air).
- Not yet: the owner's review (looks, feel, balance: 1.2 s of total cover every 8 s for 20 chakra, sound by ear);
  perf with several meteors at once (2 pooled); the Rasenshuriken/torrent still draw their own explosion on the
  attacker's screen when the barrier deflects them (the damage is refused; only the wind's deflect burst is new).

## Ideas

- Characters with their own movesets (Sasuke; Obito has his body already, next his own data file + keyed clips, like
  Madara's kit), team modes, bots, more maps.

## Itachi's HUD theme (2026-09-29, owner's request, from a Shinobi Striker screenshot)
- A character's data can carry `hud: 'uchiha'` (Itachi has it); HUD.setKit applies the theme (`#hud.t-uchiha`) and
  its art from src/ui/uchiha.js; other characters keep the ink-brush HUD, unchanged.
- Portrait: a Sharingan medallion instead of the face render (iris gradient + fibres, three tomoe turning; the Mangekyō
  fades in and turns the other way while the ultimate is ready, with a pulsing red rim), a black ring with crimson
  hairlines, the chakra arc on the ring. Black flames with a crimson rim stream off it above and below the bar (four
  layers: sway, flicker, two of drifting torn-off shards).
- Health bar: crimson metal frame, dark trough with 10% ticks and gloss, gold fill (red-orange + pulsing red glow
  under 30%), red chip trail; diamond substitution/tool pips; a red ultimate arrow.
- Skill icons repainted for his kit (Phoenix Sage Fire's fireball volley, Tsukuyomi's bound figure on the cross
  before the Mangekyō moon, crows against the moon (the big one with a red eye), Amaterasu's black flames under
  the Mangekyō) with crimson conic rims, gloss, desaturated while cooling; every character's icons now pop with a
  ring burst when a cooldown ends.
- Checked in shots (normal, ult ready, low HP; Naruto's HUD unchanged). Not yet: the owner's review.

## Itachi's eyes + fair skin (2026-09-29, owner's request with a screenshot)
- **Eyes:** the "translucent eyeballs in front of his eyes" were the game's idle Sharingan billboards (EyeMarks, a faint
  mark at glow 0.25 over each eye, always on); the model has its own painted Sharingan under them. The marks now show
  only while the Mangekyō blazes (Tsukuyomi frames 12-44, Amaterasu 14-54, same peak brightness as before);
  src/game/itachi.js `updateItachi` skips them at glow 0.
- **Skin:** the source's Skin material (face, ears, toes, the generated hands) was a grey tan (#9e8878) that read dark
  brown in the toon light; new rig.mjs option `colors` ({ material: '#rrggbb' }, sRGB, applied to the source before
  the atlas paints its palette cells) sets it in models/itachi.rig.json: #eed0b8 first, still too dark in the owner's
  game, then #fde9da + shade [0.9, 0.8, 0.82] ("a bit too fair"), so in between: #f5d9c3 + a lighter shade colour
  for his material, mtoon.shade [0.86, 0.74, 0.76] (the default
  [0.78, 0.62, 0.66] turned his face brown in the shadow of his hair and collar); itachi.vrm rebuilt (Sage, Madara,
  Obito rebuild byte-identical). The cloak stays black (it is the Akatsuki cloak).
- Checked: in-game close-ups (face, eyes at 2x, body); itachi.mjs 36/36 at 0 ms (:3104), 79 programs before/after.

## Lock-on moves like free movement (2026-09-29, owner's request with two screenshots)

Locked on (T), moving left/right only side-stepped at walking pace facing the target; unlocked, the same input gave
the ninja sprint. Now lock-on never changes movement, for every character (all share Controller.stepMove):
- the sprint timer runs locked on too (it was blocked; a dash's "carry into the sprint" was also cancelled the next
  tick), full run/sprint speed (the 15%/30% strafe/backpedal penalties are gone);
- facing = the travel direction (the gait's normal run and ninja-run arms); dashes turn you toward their direction;
- standing still locked on (no input, skid over, < 3 m/s) turns you to the target at the normal turn rate (idle
  corrective steps + fighting stance); attacks, guard and aimed jutsu turn to the target themselves as before.
- Remotes need nothing: they draw from the synced yaw + velocity (FLAG.lock only adds the idle stance).
Tests: animcheck ALL PASS (scenario "lock-on run + sprint": 0.00 cm slide, no pops), a trace (locked, hold left:
8 m/s, then 12 m/s sprint with ninja arms 1.00, facing within 5 degrees of travel; stop: faces the target), film
strips (shots/lockrun/: Naruto and Itachi), mapwalk PASS, mp.mjs ALL PASS.

## Amaterasu's cinematic (2026-09-29, owner's request, from Shinobi Striker reference shots + two fan paintings)

Itachi's R is now a 5 s cinematic that plays **on every screen at the same moment** (the owner: "visible to everyone,
at exactly the same time"). Timeline on the server clock from the press (src/game/amaterasu.js `AMA`):
- 0-0.5 s, in the arena: two fingers to his right eye, the view darkening and draining round him; HUD away, letterbox in.
- 0.5 s, a cold flash: the **negative world** (light and dark swapped onto teal, the arena past him sunk into smoke, ink
  specks), a low camera in front of him; his arms fling wide, head bowed; a flock of crows bursts off his back (pale in
  the negative), feathers drift past the lens; the camera pushes in, then rushes into his face (2.05-2.5 s).
- 2.47 s, a red flash: **his eyes painted over the view** (a shader, src/gfx/amaterasufx.js): shut, a flutter, opening
  slowly (3.0-3.6 s); the Sharingan spins up into the Mangekyō with a red shock ring (3.3-3.65 s); veins crawl in, blood
  wells on the right eye's lower lid and runs down in two streams (3.45-4.3 s), embers rise, black flames lick up the
  bottom edge; the camera drives into the right pupil (3.9-4.2 s) and **black flames burst out of it** over everything.
- 4.3 s, under the black: the arena in colour, the camera on a victim (your own body if you were taken); at 4.37 s the
  flames latch onto everyone taken (every screen at the same instant) and spread over the body from the side facing
  him; the black burns away in holes with crimson edges (4.42-4.9 s). 5.0 s: a cut back to the game camera, HUD back.
- **Sync:** who burns is decided at the pick (n:1, frame 12; `a{m:amaterasu,n:1,v:[ids],e}` to everyone incl. the
  caster) and the server ignites them on its own clock at `e`; each screen lights the flames itself at `e`.
- **The arena holds still** from frame 12 to 300 on every screen and the server: no input (FROZEN_INPUT), no hit sent
  or accepted (`hitx why:cinema`), other burns paused; he is untouchable from the press (`p.cine`). One cinematic at a
  time (another Amaterasu is denied, the gauge kept); it ends if its caster leaves or respawns.
- The clip `ita_amaterasu` is 312 frames acted for the shots (SPREAD, SINK, STILL, STARE, the release at 262); the
  white hit flash no longer shows on the black-flame ignition.
- Audio: hooks only, `audio.amaterasuCine?.(phase)` at start / negative / eyes / open / mangekyo / blood / focus /
  burst / ignite / end (the owner's voice line and the fire sounds come later).
- Tests: itachi.mjs `amaterasu` rewritten (14 checks): the same press time on both screens, the victim's screen joins in
  0.012 s, the negative world and the eyes switch on together on both (0 ms apart), cinema camera + HUD away on both,
  the victim frozen while holding left and dashing, the flames on both screens 4372 ms after the press (focus 4367),
  all given back, 79 programs before and after, the victim moves again, exactly 300 of 600 burnt, HP agrees. Review:
  `scripts/debug/amashots.mjs` (shots/ama*: both screens at the same timeline times; HOLD=1 for exact frames).
- Performance (scripts/debug/amaspike.mjs, 1080p High, vsync on as players run it): locked at 144 fps (6.9 ms) through the
  negative world, the painted eyes and the return, the same as idle and as with the effect muted; 0 programs compiled
  (79 before and after). One 27-35 ms frame at the press of a page's first cast. (Headless vsync-off runs showed 1-2 s
  frames at the press that no bisect could pin on the cinematic and that vsync never shows: gotcha 63.)
- Also at 200 ms RTT / 40 jitter / 1% loss (:3102): itachi.mjs amaterasu,tsukuyomi,crow 32/32 (the layers switch on
  within 2 ms of each other across screens, the flames 4376 / 4373 ms after the press); the full suite 45/45 at 0 ms;
  mpcombat ALL PASS.
- Not yet: the owner's review; the audio. (The model has no blink shapes: the eyes' performance is the painted shot.)
