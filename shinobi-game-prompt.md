# SHINOBI ARENA: build brief for Claude Code

You are building a new browser game from scratch in this folder: a **multiplayer third-person anime ninja arena fighter** in the style of *Naruto to Boruto: Shinobi Striker*. Read this whole brief before writing any code. It is long on purpose: every section is a requirement.

---

## 0. Who you are working for, and what already worked

- The owner builds passion-project games to play with a friend (and a few more friends later), mostly on the same Wi-Fi, sometimes over the internet (friend at up to ~200 ms ping). Windows 11 laptop, **RTX 4050**, Chrome. They care about three things above everything else: **how it looks, how smooth it runs, and how perfect the sync is**. They are not going to read code; they judge by playing.
- You (Claude, in an earlier project) already built **ARMORY**, a browser multiplayer FPS at `C:\Users\kaust\OneDrive\Desktop\Armory`. The owner played it with a friend and called the sync perfect, even at 200 ms, and the graphics and smoothness fabulous. **This new game uses the same proven stack and the same netcode ideas.** Before you design anything, read ARMORY's `CLAUDE.md` in full (its "Hard-won gotchas" apply here almost word for word), then study these files as reference. Copy and adapt the patterns; don't import from that repo:
  - `server/index.js`: static server with gzip + in-memory cache, `/api/status`, one WebSocket room, heartbeats, reconnect ghosts with a session token, server time stamps, the spawn `seq` rule, hit validation, match loop.
  - `src/game/net.js`: join handshake, clock sync (ping/pong), state upload, reconnect.
  - `src/game/avatar.js`: remote interpolation on server time stamps, `NET.interpDelay` behind the synced clock, replayed actions.
  - `src/game/humanoid.js` + `scripts/tools/mixamo.mjs`: Mixamo FBX -> compact JSON clip library, retargeting, phase-synced locomotion, foot-speed matching (no foot sliding).
  - `src/gfx/governor.js`, `src/gfx/perfcheck.js`: fps / 1% low / GPU timer overlay (F3), dynamic resolution, "why is my fps low" diagnosis.
  - `src/gfx/shadows.js`: static shadow cache (only moving casters redrawn).
  - `index.html`: the inline boot/loading screen that paints before the bundle.
  - `scripts/test/*.mjs`: the headless Chrome harness (real GPU via ANGLE D3D11), `views.mjs`, `shoot.mjs`, `errs.mjs`, `perf.mjs`, `sheet.mjs`, `crop.mjs`, the two-client multiplayer tests.
  - **Note:** the ARMORY working tree may be mid-merge with conflict markers in some files. Read clean versions with `git -C C:/Users/kaust/OneDrive/Desktop/Armory show main:<path>`.

## 1. The vision (from the owner's reference screenshots)

Shinobi Striker look and feel:
- **Third-person camera** behind and slightly above the character; the camera can swing high over the arena.
- **Anime cel-shaded art**: flat colour bands, black ink outlines, hand-painted textures with **sketchy cross-hatching in the shadows** (tree trunks, cliffs and walls look drawn with pen strokes), saturated greens and warm earth browns, a bright sky. It should look like the anime come alive, not realistic.
- **Locations**: a ninja-village street (plaster and timber shops with red/yellow awnings, a ramen shop with a "ラーメン" sign, hanging lanterns, potted plants, stone stairs up between buildings, a packed-dirt square with grass patches); and a **giant forest training ground** (enormous trees with roots and moss, grassy mounds, dirt paths, rock cliffs with grass on top, rusty chain-link fences, green light shafts through the canopy, falling leaves).
- **Movement is fast and acrobatic**: sprinting (the "ninja run", arms back), double jumps, dashes, and **running up walls, cliffs and tree trunks with glowing blue chakra at the feet**.
- **Fights**: fast melee combos with kunai, big orange impact bursts with speed-line streaks, "7 HITS" combo counter in orange brush lettering, a **log left behind by a substitution jutsu**, a blue chakra aura while charging, green lock-on brackets on the target, small red HP bars over enemies, a coloured ring on the ground under every fighter.

For now: **everyone who joins is instantly spawned as Naruto**, in one **free-for-all arena for up to 6 players** on one medium-sized map. The architecture must already support a roster of characters and player names (coming next), but the UI doesn't expose them yet.

## 2. Priorities (in this order, when they conflict)

1. **Character movement and animation quality.** Idle, run, sprint, stop, turn, jump, double jump, fall, land, dash in 8 directions, strafing, wall run, chakra charge, every attack and every hit reaction must be fluid, weighty, snappy and free of pops, foot sliding, T-poses, jitter, sliding into walls, getting stuck, or animation/gameplay mismatch. **This is the heart of the game. Spend most of your iteration time here.**
2. **Combat feel and hitboxes.** What you see hit is what hits. Hitstop, knockback, reactions and combo flow feel like a real anime fighter.
3. **Sync.** At 200 ms ping with jitter, the game still feels local for your own character, remotes move smoothly, and hits agree on every screen.
4. **Frame rate.** Locked smooth. Target: 144 fps on High at 1920x1080 on the RTX 4050 with 6 fighters and effects on screen, never under 60. Zero hitches during fights (no shader compiles, no GC spikes, no texture uploads mid-fight).
5. **Beauty of the map and sky.**
6. UI matching the screenshots.

No flaws, bugs or glitches is the bar. Test and look at everything yourself (screenshots, measurements) before you call it done.

## 3. Tech stack and project setup

- **Client:** Three.js (latest, WebGL2), plain ES modules, Vite. No TypeScript, no framework. Two-space indent, single quotes, semicolons. Comments explain *why*, sparsely.
- **VRM characters:** `@pixiv/three-vrm` (MToon shader, spring bones, expressions) for the character model. `postprocessing` (pmndrs) for the post stack.
- **Server:** Node.js + `ws`. One process serves the built client from `dist/` (gzipped, cached in memory) and the WebSocket room at `/ws`.
- **Port 3100** (not 3000: the owner often has ARMORY running on 3000 and both must run at once). Never kill a process on a port without asking.
- **Code shared by client and server** lives in `src/shared/` (config, character/move data, frame data, movement physics constants, collision queries, map collider data). The server must be able to run the same movement/collision and hitbox math as the client.
- **npm scripts:** `start` (build + serve, how the owner plays), `serve`, `dev` (server + Vite HMR with `/ws` proxied), `build`, `share` (`npx cloudflared tunnel --protocol http2 --url http://localhost:3100`: **keep `--protocol http2`**, QUIC was 100x slower on the owner's network), `anims` (Mixamo -> clip library), and one script per test.
- The client builds its WebSocket URL from `location` (`wss` on https) so the share link just works.
- `.gitignore`: `node_modules`, `dist`, `dist-test`, `shots`, raw downloads (`mixamo/*.fbx`). Keep the repo **private** (Mixamo licence and fan content).
- Create `CLAUDE.md` (architecture, layout, conventions, protocol, gotchas, test commands, debug hooks), `project.md` (status, milestones, known issues, ideas) and `README.md` (how to play, controls, how to share). **Update all of them after every successful change**; that's a standing rule from the owner.

## 4. Environment rules (hard-won on this machine)

- **Don't use `python`** in shells: it is the Windows Store stub and hangs. Use Node scripts. For multi-line scripts, write an `.mjs` file with the Write tool; bash heredocs with quotes and backticks have broken before.
- Headless tests use system Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe` via `puppeteer-core` with `--use-angle=d3d11`, so they render on the real RTX 4050. Always build before testing. Test builds go to `dist-test/` and run on another port (e.g. `PORT=3101`) so the owner's running game is untouched.
- Screenshot everything you change and **look at the PNGs**. Use contact sheets to review many views at once.

## 5. The character: Naruto

### 5.1 Model pipeline
- Format: **VRM** (anime proportions, MToon toon shading, spring bones for hair/headband tails/jacket, expression blendshapes). Load with three-vrm. Use `VRMUtils` to optimise (remove unused vertices, combine skeletons) and clone one loaded model per player with `SkeletonUtils.clone` (one download, six fighters).
- **The owner provides `public/assets/characters/naruto.vrm`**, made in **VRoid Studio** (free): spiky blond hair, blue eyes, whisker marks, orange-and-black tracksuit, forehead protector with long tails, sandals. Give the owner exact VRoid tips up front (hair guides for spiky hair, the jacket as a texture edit, export VRM 1.0 with ~40-60k triangles, texture atlas 2048). Until it arrives, work with a VRoid sample avatar or a stand-in so nothing blocks. **Never rip models from commercial games.**
- Make the six Narutos tell-apart-able: a per-player tint (headband cloth / jacket accent colour from a fixed 6-colour palette), a nameplate, and the coloured ground ring.
- Face expressions: blink, angry (attacking), shout (jutsu), pain (hit), eyes closed (KO). Lip/face shapes via VRM expressions.
- Secondary motion: VRM spring bones for hair spikes, headband tails and jacket hem. Tune them so they swing on turns, dashes and hits but never jitter, explode on teleports (reset springs on respawn/substitution) or clip through the body badly. Spring bones must run at a fixed step so they look the same at 60 and 144 fps.

### 5.2 Animation pipeline
- **The owner downloads Mixamo clips** (FBX, *Without Skin*, 30 fps, "In Place" where available) into `mixamo/`. At the start, give the owner a precise checklist of search terms, one per needed clip (fighting idle, idle breathing, run, fast run/sprint, run start, run-to-stop/skid, turn 180, jump up, falling loop, landing (soft and hard), front flip (double jump), 8-direction dodges/rolls, strafe walk/run in 4 directions, punches (jab, cross, hook, uppercut), kicks (roundhouse, spin kick, flying kick, knee), a kunai/knife combo, block idle + block hit, hit reactions (head, stomach, left, right, big stagger), knocked back/flying back, knocked down + getting up + kip up, falling from air hit, death/KO, throwing (for shuriken), casting/power-up (chakra charge), victory taunt). Tell them which clips are "must have" and which are "nice to have".
- Build `npm run anims` (adapt ARMORY's `scripts/tools/mixamo.mjs`) to convert the FBX set into one compact clip library retargeted onto the **VRM humanoid** (three-vrm's normalised humanoid bones: follow the official three-vrm "load Mixamo animation" retarget approach, including the hips height scale and rest-pose rotation fix). Report which clips are present, their length, measured ground speed and gait phase.
- **Derived / procedural animation** where Mixamo has nothing:
  - The **ninja run** (sprint): the sprint clip with arms swept back and torso leaned forward, as an additive/override layer on the arms and spine.
  - **Wall run**: run cycle oriented to the wall surface (the body perpendicular to the wall, feet on it), with lean and the blue chakra glow on the feet.
  - Jutsu poses (Rasengan hold, hand signs) as authored keyframe poses on the humanoid bones.
- **Animation system requirements** (quality bar is AAA third-person action games):
  - A **state machine with gameplay authority in code**: moves are defined by frame data (section 6); animations are *retimed to fit* their move's startup/active/recovery windows (as ARMORY retimed reloads to CS:GO timings), never the other way round.
  - **Inertialization blending** (or at least very short, per-transition-tuned crossfades with pose matching) so transitions are instant in response but have no visible pop.
  - **Locomotion:** speed-driven blend (idle -> walk -> run -> sprint) with playback rate matched to foot speed (no sliding); start and stop transitions; turn-in-place; quick 180 turn; **lean/bank into turns** from angular velocity; 8-direction strafe blend space when locked on.
  - **Upper/lower body layers**: throw shuriken or charge while running without stopping the legs.
  - **Foot IK** on slopes, stairs and roots so feet plant on the ground; pelvis lowers on slopes. **Align the body to wall normals** during wall runs.
  - **Air states**: jump takeoff anticipation (short), rise, apex, fall loop, landing with squash (soft land keeps momentum, hard land after a big fall has a short recovery unless you dash out).
  - Everything framerate independent (fixed-step simulation, interpolated rendering).
- **Anime flair:** afterimage ghost trails on dashes and substitutions, speed lines at sprint, dust kicks on stops/landings/dashes, smear-like motion blur on fast strikes (trail meshes along fists/feet/kunai), brief impact frames on big hits (a 2-frame high-contrast flash), camera shake scaled by hit weight.

## 6. Combat system

All numbers below are starting values in **one data file** in `src/shared/` (per character: movement constants, moves with frame data, hitbox shapes, damage, reactions). Tune by playing; keep the file the single source of truth for client and server.

### 6.1 Stats
- HP 1000. Chakra 100 (passive regen 3/s, charging 35/s). Substitution gauge: 3 pips (one used per substitution, each regenerates in 8 s). Ultimate gauge 0-100 (filled by dealing and taking damage). 2 dash charges (regenerate 1.2 s each).
- Kill = +100 score, assist = +50 (damaged the victim in the last 10 s).

### 6.2 Movement (feel: fast anime ninja, never floaty)
- Run 8 m/s; after 0.5 s of running, **ninja sprint** 12 m/s. Acceleration high (reach run speed in ~0.15 s), tight turns at run, wider arcs at sprint.
- Jump 9.5 m/s up, gravity 26 m/s² (heavier on the way down, 1.3x, for snappy arcs), **double jump** (front flip), coyote time 0.1 s, jump buffering 0.12 s.
- **Dash** (Shift + direction; neutral = backstep): 0.28 s burst at 18 m/s, invulnerable for the first 0.15 s, cancels recovery of most attacks on hit, one **air dash** per jump.
- **Wall run / chakra climb:** hold jump (or run into it) against any climbable surface steeper than 60° (building walls, cliffs, big tree trunks): run up and along it at 9 m/s with blue chakra at the feet, drains 8 chakra/s; jump off the wall (kicks away along the wall normal); reaching the top vaults you over the edge onto it.
- **Water walking:** the river surface is walkable (ripple rings at each footstep).
- Stepping up small ledges/roots automatically; never snagging on geometry edges; sliding off steep slopes; smooth push-apart between fighters (no overlapping, no being stuck inside someone).

### 6.3 Naruto's moveset (controls in section 8)
- **Light combo** (LMB, up to 5 hits): jab, cross, knee, spin kick, finisher (launching kick that knocks back). Each hit has a small step-in; with a target within 4 m the step-in **tracks toward the target** (like Shinobi Striker) so combos connect. Air variant: 3 hits + a downward spike finisher.
- **Heavy attack** (hold LMB 0.35 s): guard-breaking axe kick, big knockback.
- **Guard** (hold RMB): blocks attacks from the front 180°, costs 4 chakra per blocked hit, 0 damage; heavy attacks and ultimates break guard (1 s stun).
- **Substitution jutsu** (press dash *while in hitstun*): poof of smoke, Naruto teleports 6 m behind/away, a **log** drops where he stood and takes the rest of the combo. Costs 1 pip. Invulnerable 0.4 s.
- **Chakra charge** (hold F): blue flame aura, fills chakra, vulnerable.
- **Ninja tool: shuriken** (key 1, 3 charges shown as pips over the icon): quick throw, fast projectile, mild homing to the lock-on target, small flinch, chip damage 40.
- **Ninjutsu 1: Rasengan** (Q, 30 chakra, 8 s cooldown): 0.3 s wind-up (swirling blue sphere in the palm), then a 9 m lunge; on hit a multi-hit grind then a spinning launch, 260 damage total.
- **Ninjutsu 2: Shadow Clone Rush** (E, 35 chakra, 12 s cooldown): two clones poof out and rush the target (or forward), each doing a 3-hit string; the clones are short-lived entities owned by the caster, with their own hitboxes.
- **Ultimate: Rasenshuriken** (R, full ultimate gauge): a spinning wind-shuriken projectile that expands into a large sphere on impact, multi-hit, 450 damage, big knockdown.
- **Hit reactions:** flinch (light), stagger (heavy), guard stun, launch (juggle-able in the air), knockback (flying back, bounce off walls), knockdown (lying, then get-up with 0.6 s invulnerability; press dash on landing to tech-roll away), KO.
- **Anti-infinite rules** (fair PvP): damage scaling per hit in a combo (-8% per hit, floor 40%), hitstun decays over a combo, and after 12 hits or 3.5 s of continuous combo the victim is forced into a knockdown with invulnerable get-up.
- **Hit feel:** hitstop 60 ms (light) to 120 ms (heavy/finishers) on attacker and victim; victim white rim flash; orange impact burst with speed-line streaks and particles; camera shake; hit sound layered with a whoosh; combo counter ("N HITS") after 2+ hits.
- **Death and respawn:** KO fall, 5 s respawn at the spawn point farthest from other fighters, 2 s spawn invulnerability (flicker). Log out = removed.

### 6.4 Hitboxes (must be exact)
- **Hurtboxes:** capsules attached to the animated bones (head, chest, pelvis, upper/lower arms, upper/lower legs), updated from the *drawn* pose, so what you see is what can be hit. Dash invulnerability, get-up, spawn protection and substitution are flags on the hurtbox set with exact time windows.
- **Hitboxes:** per move, spheres/capsules attached to bones (fist, foot, kunai tip) or to the character (Rasengan sphere in front), **active only during the move's active frames**, and **swept** between simulation steps (capsule from last position to this one) so fast strikes never tunnel through a target at any frame rate or ping.
- One hit per move instance per victim (multi-hit moves list their hit ticks explicitly).
- **F4 debug view** draws hurtboxes (green), active hitboxes (red), the server's rewound victim positions (yellow) and hit contact points. Use it to verify every move.
- Hits never go through walls (line-of-sight check from the attacker's chest to the contact point against the map's colliders).

## 7. Netcode ("perfect sync" at up to 200 ms)

Start from ARMORY's model, which the owner already judged perfect, then add what a fighter needs.

- **Clients own their own movement** (instant, zero-latency controls) using the shared movement code; the server clamps to the map and sanity-checks speed (catches teleports/cheats, tolerant of legitimate dashes and knockback). The server stamps each state with server time; remotes interpolate on that stamp an adaptive **70-120 ms** behind the synced clock (widen with measured jitter), with a short extrapolation fallback when a packet is late. States upload at **30 Hz** in compact arrays (position, velocity, yaw, state id, state time, flags).
- **Actions are events, sent immediately**, not on the next state tick: attack start (move id, combo step, time), dash start, jump, substitution, jutsu cast, charge start/stop, guard on/off. Remotes start the animation **time-aligned**: skip into the clip by the measured latency (capped) so the remote's move is at the same frame it is on the owner's screen when the hitbox goes active.
- **Hit detection: attacker-side, server-validated with lag compensation** (ARMORY's approach, extended):
  1. The attacker's client tests its active hitboxes against remotes as drawn (interpolated) on its screen, and sends `hit{victim, move, instance, hitTick, t}`.
  2. The server keeps a ~1 s history of every fighter's states and action windows. It rewinds the victim to the attacker's view time (capped at 200 ms), and checks the move was active at that time, reach/geometry with a small tolerance, line of sight, one hit per instance, victim invulnerability at that rewound time (dashes and substitutions are timestamped events, so "I dodged" is honoured when the dodge really started first), teams/phase/alive, rate limits.
  3. The server computes damage, scaling, reaction and knockback **from the shared move data** (never trusts client numbers) and broadcasts `hitr{attacker, victim, move, dmg, hp, reaction, kb, stun, seq}`.
- **Hit reactions are server-driven teleports of the victim's state, like ARMORY's spawn `seq`:** the victim's client enters the reaction (input locked for the stun, velocity = kb) and the server drops that victim's stale states whose seq is older. Because knockback/launch trajectories are **deterministic** (shared physics: kb vector + gravity + collisions), every client can simulate the victim's flight from the hit event itself instead of waiting for streamed positions. That keeps juggles and follow-ups connecting at 200 ms.
- **Predicted feedback on the attacker's screen:** on a local hit, play hitstop, sparks, sound and the victim's flinch/knockback immediately (predicted), then reconcile smoothly (blend over ~100 ms, never snap) if the server disagrees. The attacker must never wait a round trip to feel a hit.
- **Projectiles and clones** are spawned by events carrying (origin, direction, speed, t0, target) and simulated identically on every client from the spawn time; the owner detects their hits like melee.
- Clock sync, heartbeats (tolerate missed beats: a long main-thread stall must not drop the socket), reconnect with a session token (a ghost keeps the player's slot and score for a few seconds), and server-authoritative spawns, all as in ARMORY.
- **Latency simulation built in:** `SHINOBI_LAG=rtt,jitter,loss` on the server (e.g. `200,40,1`) delays/drops messages in both directions, so you can test 200 ms locally. Every netcode milestone is tested at 0 ms and at `200,40,1`.
- JSON messages with short keys and compact arrays are fine for 6 players; keep every regular message under ~200 bytes. Document the full protocol in `CLAUDE.md`.

## 8. Camera and controls

- **Camera:** third-person spring arm behind the right shoulder (~3.2 m back, 1.1 m up, slightly right), mouse orbit, collision (pulls in against walls/trees without clipping, smoothly, no jitter), slight positional lag, FOV 70 with a small kick on sprint/dash, subtle shake on hits. Lock-on shifts the camera to frame both fighters. Never lets a wall or trunk hide your character for more than a moment (fade occluders near the camera to dithered transparency).
- **Lock-on** (middle mouse or T): nearest enemy in view; green bracket reticle on them; flick the mouse/scroll to switch targets; auto-releases on death/out of range. Movement becomes strafing around the target; attacks home in.
- **Keyboard + mouse:** WASD move, mouse look, Space jump / double jump / wall run, Shift dash (in hitstun: substitution), LMB light / hold heavy, RMB guard, F chakra charge, 1 shuriken, Q Rasengan, E Shadow Clone Rush, R ultimate, T lock-on, Tab scoreboard, Esc pause menu (settings: sensitivity, invert Y, FOV, volume, graphics preset, fps overlay). Pointer lock on click.
- **Gamepad** (Gamepad API, Xbox layout): left stick move, right stick camera, A jump, B dash/substitution, X light, Y heavy, LB guard, RB lock-on, LT + face buttons for tool/jutsu, both triggers ultimate. Hot-swappable with keyboard.
- Input buffering (150 ms) for attacks, dash and jump; cancel windows defined in frame data.

## 9. Art direction and rendering

Match the screenshots: painted anime, not realistic.

- **Toon shading:** one shared toon lighting model for world and characters (the VRM's MToon for characters, a custom `onBeforeCompile` patch or ShaderMaterial for the world): 2-3 light bands with soft band edges, coloured (not grey) shadow tones, rim light on characters, the world's albedo from hand-painted-looking textures.
- **Ink outlines:** characters with inverted-hull outlines (MToon outline) of constant screen width; the world with a **screen-space edge pass** (depth + normal discontinuities, Sobel) at half the character line weight, fading with distance so far detail doesn't turn into black noise.
- **Hatching:** in the world's shadow bands, overlay world-space pen-stroke hatching (a tileable hatch texture, triplanar), plus sparse sketch lines on bark, rock and plaster, as in the screenshots.
- **Textures:** stylized, hand-painted look: generated procedurally (canvas/shader noise baked at build time into small PNGs) and/or CC0 stylized packs you can download by script. Keep the total download **under ~60 MB** (ARMORY was ~200 MB and the owner's friends waited for it).
- **Lighting:** 1 directional sun (shadowed, soft, cached for static geometry like ARMORY's ShadowCache) + 1 hemisphere/ambient. No other real lights; fake local light (lanterns, jutsu glow) in shaders and emissive + bloom. Never add or remove lights at runtime (recompiles every shader, multi-second freeze).
- **Sky:** a bright anime sky dome: deep-to-pale blue gradient, big painted cumulus clouds (layered, toon-banded, slowly drifting), a sun glow, distant painted mountains/forest silhouettes on the horizon, a gentle aerial perspective (distant things shift toward sky blue).
- **Foliage:** instanced anime grass with a base-to-tip colour gradient and wind sway; tree canopies as clumps with **spherized normals** (the standard anime-foliage trick) so they shade as soft blobs; falling leaf particles; god-ray light shafts in the forest.
- **Water:** stylized river: flat colour bands, animated foam lines along banks and rocks, toon highlights, ripples, a small waterfall.
- **Effects:** blue chakra aura (layered animated flame shells, additive), Rasengan (swirling sphere shader with rings), Rasenshuriken (spinning blades + expanding sphere), orange impact bursts with radial speed-line streaks (as in screenshot 4), smoke poof (substitution, clones), dust puffs, afterimages, shuriken trails. All pooled and instanced; every effect's shader precompiled at load (warm them the way ARMORY's `warmWorld` does) so the first Rasengan never hitches.
- **Post:** pmndrs postprocessing: toon-friendly tone mapping (keep saturated colours; no filmic desaturation), selective bloom (effects and emissives only: threshold high enough that the sky and bright grass never bloom), light colour grading, SMAA. No motion blur, no heavy AO.
- **Resolution:** always native resolution on High and Ultra (the owner reported dynamic-resolution blur as a regression in ARMORY: never trade sharpness for fps on those presets). Presets Low / Medium / High / Ultra, with Low allowed to scale down. First-run preset from the GPU name (ARMORY's `detectPreset`).

## 10. The map: "Training Grounds" (medium, 6 players)

About **140 x 140 m** of playable space, dense with vertical routes, readable, beautiful from every angle. Bounded naturally (tall cliffs, giant trees, chain-link fences, village walls), never by invisible walls in open space. Build it procedurally in code with a seeded RNG (deterministic: colliders must match on every client and on the server), like ARMORY's war-zone kit.

Zones, connected so fights flow between them:
1. **Village square (screenshot 1):** packed-dirt plaza with grass patches, two- and three-storey shops (plaster, dark timber, curved tiled roofs, red and yellow awnings, sliding doors, windows with painted interiors), a ramen shop with a noren curtain and "ラーメン" sign, lanterns, potted plants, crates, a stone staircase climbing between buildings to an upper street. **Rooftops are reachable** (wall run up) and connected by jumps.
2. **Forest training ground (screenshots 2-5):** giant trees (trunks 3-6 m wide, root flares, moss patches, hatched bark) that you can wall-run up to **thick branches used as platforms**; grassy mounds, dirt paths, fallen logs, rock outcrops, rusty chain-link fences, light shafts through the canopy.
3. **Cliffs and ridge:** layered rock cliffs with grassy tops (screenshot 5), a high ridge overlooking the arena, ledges connected by wall runs.
4. **River:** crosses the map, walkable water, stepping stones, a wooden bridge, a small waterfall from the cliffs.
5. **Open training field:** wooden training posts, a stone memorial, targets on trees: the one place with long sight lines.

Six spawn points spread around the map. Everything the player can stand on has a collider made of simple shapes (boxes, capsules, cylinders, heightfield for terrain) in `src/shared/` so the server can use it. Surfaces tagged climbable vs not. No coplanar faces (z-fighting), no gaps you can fall through, no spots you can get stuck in: write a test that walks and wall-runs the whole map (like ARMORY's `stairs.mjs`).

## 11. UI / UX (match the screenshots)

- **Boot screen:** inline in `index.html` (paints before the bundle), progress weighted by file size, key art, then the title screen. Removes itself under `navigator.webdriver` so tests skip it.
- **Title screen:** game logo, big **JOIN** button (or press any key / A). Clicking it spawns you as Naruto straight into the running free-for-all. Name is auto ("Naruto", "Naruto 2" …; `?name=` for tests). Data model already has `name` + `characterId` for the upcoming name and character select.
- **In-game HUD (all DOM/CSS or one canvas overlay, crisp at any resolution):**
  - Bottom-left: circular character portrait in a black ink-brush frame with a blue ring (chakra), a long **green health bar with a red chip-damage trail** that drains after a delay, and a small cyan up-arrow indicator (buff/ultimate ready).
  - Bottom-right: **four circular skill icons** (ninja tool, shuriken with 3 charge pips above it, ninjutsu 1, ninjutsu 2) plus the ultimate (dark until charged, fills clockwise), cooldown sweeps with seconds, key hints; substitution pips.
  - Top-right: match timer in bold white italic on a black ink splash (e.g. 4:49).
  - Right side: rounded pill bars for score and kills.
  - Centre-top: announcement banner on a torn ink-brush strip ("FIGHT!", "Naruto 3 is on a 3-kill streak!", "1 minute left").
  - Centre: combo counter "N HITS" in orange brush lettering; lock-on green bracket reticle; subtle hit markers.
  - Over other fighters: nameplate + short red HP bar; coloured ring on the ground under each fighter (your colour vs others).
  - Kill feed (top-left), Tab scoreboard (name, kills, deaths, assists, score, ping), results screen at match end (winner, MVP, stats), then the next match starts.
  - Fonts: bold italic sans for numbers plus a brush font for combo/banners (Google Fonts, bundled locally).
- **Pause menu (Esc):** resume, settings, performance panel (GPU name, fps, diagnosis), leave.
- **Match loop:** free-for-all, 5:00 timer, most score wins, 10 s results, restart. Drop in / drop out at any time. Warmup when alone (training dummy active).
- **Training dummy:** a log dummy on the training field that takes hits, shows damage and combo count, and resets; useful solo and for tests.

## 12. Audio

Procedural Web Audio like ARMORY (no licensing trouble) plus CC0 samples where procedural can't sound good (whooshes and impacts can; voices can't). Spatialised: footsteps (surface-based: dirt, grass, wood, water, wall run), whooshes per attack weight, layered impacts, guard clank, dash swish, substitution poof, chakra charge hum, Rasengan whirr, clone poofs, ultimate roar, UI clicks, ambience per zone (forest birds and wind, village murmur, river). A light battle music loop with a volume setting (off by default is fine).

## 13. Performance rules

- Budgets at 1080p on High with 6 fighters mid-fight: < 300 draw calls, < 1.5M triangles, < 60 shader programs, JS < 4 ms/frame, no per-frame allocations in hot paths (pool vectors, events, particles).
- Batch static geometry per material, instance repeated props, cache static shadows.
- **Precompile every shader before the first frame** with `renderer.compileAsync` behind the boot screen (including every effect, every character state, every material in both lit and shadowed variants). Check with `renderer.info.programs.length`: it must not grow during a fight.
- Upload every texture before play (`renderer.initTexture`).
- F3 overlay: fps, frame ms, 1% low, GPU ms (timer queries), draw calls, triangles, ping, interp delay, packet loss.
- A `perf.mjs` benchmark (adapt ARMORY's) at fixed spots with 6 simulated fighters fighting; run it before and after any rendering change.

## 14. Testing and verification (definition of done for every feature)

- **Visual:** `views.mjs`-style screenshots of every state (idle, run, sprint, jump, apex, fall, land, dash in 8 directions, wall run, each attack at startup/active/recovery, each hit reaction, charge aura, each jutsu), with F4 hitboxes on for combat. Contact sheets. Look at them.
- **Animation checks (automated where possible):** foot sliding (planted foot drift per step < 2 cm), no pops (max bone angular velocity per frame under a threshold across every transition), no clipping of the camera, correct facing.
- **Multiplayer:** two or more headless Chrome clients (like ARMORY's mptest scripts) at 0 ms and at `SHINOBI_LAG=200,40,1`: join, move, every action replicates, a combo lands and the victim's HP/reaction agree on both screens, knockback trajectories agree within 10 cm, substitution works, kill/respawn/score, leave. Print PASS/FAIL per check. Measure remote position error and hit-confirm time.
- **Map:** walk + wall-run bot covering every zone: no stuck spots, no falls through the world.
- **Performance:** `perf.mjs` numbers recorded in `project.md`.
- Report honestly: if something fails, say so with the output.

## 15. Milestones

Work through these in order. At the end of each: run the tests, screenshot, update the docs, and tell the owner what to try.

1. **Skeleton project:** stack, server on :3100, boot screen, title + JOIN, a grey-box map with collisions, a stand-in character, third-person camera, clock sync, 2 players see each other move smoothly. Tests + share link working.
2. **Character + locomotion:** VRM (or stand-in), Mixamo pipeline, the full locomotion set (idle, run, sprint/ninja run, starts/stops/turns, jump, double jump, fall, land, dash, strafe, wall run, water walk), foot IK, spring bones. Iterate until it looks AAA. **Spend the time here.**
3. **Combat core:** frame-data system, light combo, heavy, guard, dash cancels, hurtboxes/hitboxes with F4 view, hitstop, reactions, knockback, knockdown/get-up, substitution, training dummy, combo counter.
4. **Netcode for combat:** events, lag-compensated validation, server-driven reactions with seq, deterministic knockback, predicted attacker feedback, projectiles; pass all tests at 200 ms.
5. **Jutsu:** chakra charge, shuriken, Rasengan, Shadow Clone Rush, Rasenshuriken, with their effects and cooldown UI.
6. **The real map + art pass:** toon shading, outlines, hatching, sky, foliage, water, village, forest, cliffs, river, field. Performance pass.
7. **Full HUD + match loop:** everything in section 11, kill feed, scoreboard, results, audio.
8. **Polish:** feel tuning with the owner, bugs, perf, docs.
Then later (not now): name entry, character select and more characters (Sasuke, Sakura …), team modes, server bots, more maps.

## 16. How to work

- Start by (1) reading ARMORY's `CLAUDE.md` and the reference files, (2) giving the owner **the asset checklist right away** (VRoid Naruto how-to + the Mixamo clip list with search terms and download settings) so they can prepare while you build, then (3) writing the milestone plan into `project.md` and starting milestone 1 without waiting.
- Decide technical questions yourself with sensible defaults; ask the owner only about taste (how something looks or feels) or when something is truly theirs to decide.
- Keep files small and organised by responsibility (e.g. `src/game/` controller, camera, combat, net, avatar; `src/char/` character data and animation; `src/world/` map and sky; `src/gfx/` rendering, post, perf; `src/ui/`; `src/shared/`; `server/`; `scripts/test/`).
- After every successful change, update `CLAUDE.md`, `project.md` and `README.md`. Record every hard-won lesson as a numbered gotcha in `CLAUDE.md`.
- Commit only when the owner asks.
