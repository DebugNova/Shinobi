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
- Lock-on strafing: the legs run toward the travel direction while the chest keeps facing the target; backpedal
  beyond ~115 degrees; strafing is 15% and backpedalling 30% slower than running. Brackets frame the whole target.
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
- `scripts/debug/vnc.mjs` drives the VPS's VNC console (type + screenshot) for when SSH is lost (how the routing bug
  above was found and fixed).
- Docs: CLAUDE.md is kept under 250 lines (owner's rule); the 40 hard-won gotchas live in `docs/gotchas.md`, which
  CLAUDE.md imports (`@docs/gotchas.md`) and indexes by title.

## Known issues / next

- animcheck.mjs: one rare residual spike (13-19 deg on a foot, about 1 run in 3): releasing lock-on mid-backpedal
  while both feet are in the air and the body turns 180 degrees. Since the gait's swing-follow fix (2026-09-27
  evening) Sage and Obito passed every run so far.
- M1 strings: the scroll is a prop drawn in the right fist; Sage's model keeps its own scroll on its back while the
  prop is out (the back scroll is baked into the mesh, rigid on the spine: hiding it would need a rig change). The
  Scroll Rush's air half (S4/S5) is aimed at the target S3 launched: after a whiffed S3 the leap and the slam still play
  (and look right) but mostly pass over a target standing on the ground. Locomotion animcheck on 2026-09-28 flagged single
  15-20 deg frames (a different scenario each run) only while another session ran headless Chrome: re-run quiet.
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

## Ideas

- Characters with their own movesets (Sasuke; Madara and Obito have their bodies already, next their own data files +
  keyed clips), team modes, bots, more maps.
