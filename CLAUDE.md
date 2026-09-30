# SHINOBI ARENA: guide for Claude sessions

A browser multiplayer **third-person anime ninja arena fighter** in the style of *Naruto to Boruto: Shinobi Striker*. Players type a name, pick a character (Naruto, Sage
Naruto, Madara, Obito or Itachi: same fighter, different bodies) and join one free-for-all arena (up to 6 players) on one map, "Training Grounds". Three.js (WebGL2) + three-vrm
client, Node.js + `ws` server, same stack and netcode ideas as ARMORY (`C:\Users\kaust\OneDrive\Desktop\Armory`, the owner's earlier game; its CLAUDE.md gotchas apply
here too). The owner cares most about how it looks, how smooth it runs, how perfect the sync is. Priorities when they conflict: 1. movement/animation quality, 2. combat
feel + exact hitboxes, 3. sync, 4. frame rate, 5. map beauty, 6. UI. Full brief `shinobi-game-prompt.md`; status, milestones, known issues `project.md`; player-facing
`README.md`; the owner's asset checklist (VRoid Naruto + Mixamo clips) `ASSETS.md`.

**Standing rules from the owner:** after EVERY successful change update CLAUDE.md, project.md, README.md, docs/gotchas.md (what broke) and docs/visuals.md (HOW each
animation/effect/visual was built: the owner wants the techniques on record). CLAUDE.md **under 250 lines** (condense, never drop info). Commit only when asked. Never kill a process on a port without asking (the owner may run ARMORY on 3000 and this on 3100).

## Commands

```bash
npm install; npm start    # vite build + node server/index.js on :3100 (how the owner plays);  npm run serve: server only (serves dist/)
npm run dev               # server :3100 + Vite HMR :5174 (/ws, /api proxied);  npm run build: client -> dist/;  build:test: -> dist-test/ (tests never touch dist/)
npm run share             # public https link: cloudflared quick tunnel over HTTP/2 (keep --protocol http2!)
npm run deploy            # upload + build + pm2 restart on the VPS (https://shinobi.185-2-49-69.sslip.io); kicks live players
npm run anims             # mixamo/*.fbx (+ mixamo/base/armory-humanoid.json) -> public/assets/anims/clips.json;  npm run fonts: Google Fonts -> public/assets/fonts (no CDN)
npm run rig -- models/naruto_sage.rig.json   # unrigged T-pose .glb -> game-ready .vrm (public/assets/characters/sage.vrm)
npm run test:mp           # 2 headless Chrome clients vs a test server on :3101;  test:mp-lag: same vs SHINOBI_LAG=200,40,1 on :3102;  test:chars: names + picks (:3101)
node scripts/test/<t>.mjs <url>   # mpcombat, kovis (:3104), perf (:3101 5 6), animcheck, zoom, chars, mp; mapwalk.mjs needs no server (see Testing)
```

- **Test servers** (never the owner's :3100): `SHINOBI_DIST=dist-test PORT=3101 node server/index.js`; with lag `SHINOBI_LAG=200,40,1 SHINOBI_DIST=dist-test PORT=3102
  node server/index.js`. Rebuild dist-test after client changes (a running server picks up new files); restart it after `server/` or `src/shared/` changes. Ports (all
  mine to start/stop; the owner's are 3000 and 3100): 3101 plain, 3102 lag 200,40,1 (+HP 600), 3103 unminified build (`vite build --minify false --outDir dist-prof`) for
  readable CPU profiles, 3104 HP 600.
- `SHINOBI_LAG=rtt,jitter,loss` (ms, ms, %) delays every message both ways (server/lag.js); loss is TCP-like (a lost segment arrives ~1 RTT late and holds up everything
  behind it: WebSockets never drop messages). `SHINOBI_MATCH=duration,results,respawn` (s) shortens the match loop. `SHINOBI_HP=n`: every fighter's max HP (quick KOs).
  `SHINOBI_ULT=1`: ultimate gauges stay full. In game, "/" = dev bar (/ult /cd /sub /all; server-side, this laptop only: `SHINOBI_DEV=1` everyone, `0` off). `SHINOBI_DEBUG=1` logs every rejected hit / denied substitution with the reason.
- **Don't use `python`** in shells (Windows Store stub, hangs). Node scripts only; multi-line scripts go in `.mjs` files (heredocs with quotes/backticks have broken).
  Headless Chrome = `C:/Program Files/Google/Chrome/Application/chrome.exe` via puppeteer-core with `--use-angle=d3d11` (real RTX 4050).

## Layout

- `index.html` Boot screen (inline markup/CSS/script: paints before the bundle; window.BOOT API), title, HUD roots.
- `server/index.js` Static server (dist/, gzip in memory), /api/status, WebSocket room /ws: join (auto names "Naruto", "Naruto 2"...), states (seq rule, sanity
  clamp), actions (relayed with the owner's start time), hits (validated in combat.js), HP, KOs, assists, respawns (farthest spawn), sub pips, ult gauge, match loop
  (warmup -> live 5:00 -> results 10 s -> live), ghosts.
- `server/combat.js` Per-fighter history (rewind), action instances, reactions as deterministic flights, invulnerability windows, hit validation (window, reach, LOS, dup,
  invuln at the hit time). server/lag.js: SHINOBI_LAG simulation (ordered delay lines per socket and direction).
- `src/shared/` Client AND server (pure JS, no three.js): config.js (PORT, SIM (60 Hz), NET, MATCH, PALETTE, ST state ids, FLAG bits, SURF ids); naruto.js (THE data file
  for Naruto: stats, movement constants, moves + frame data + hitboxes + damage, jutsu (his Jiraiya-era kit: Q shadowClones, E rasengan, G cloneDefense, X clones = the Rush), reactions; COMBO = anti-infinite rules; tune here only); characters.js (roster
  CHARACTERS, charOf: naruto (naruto.js) and sage (= NARUTO's data with another model + card); players carry a characterId end to end); combat.js (REACT codes, hitSpec(),
  resolveHit(): damage scaling, stun decay, guard, juggles, forced knockdown, knockback vector; reactionFlight()/reactionTimes()); collide.js (CollisionWorld: heightfield +
  yaw-rotated boxes (optionally sloped tops) + cylinders (optionally cones: r at y0, r1 at y1), grid broad phase; ground(), pushOut(), ceiling(), wall() (wall-run
  surfaces), solidAt() (room here?), raycast(), clear()); physics.js (stepBody(): kinematic capsule: substeps, step-up, snap-down, slopes, ceilings, bounce; Flight:
  deterministic knockback/launch trajectories); map.js (buildMap(seed): terrain, colliders, prop descriptors, spawns; treeRadius(t, y): a trunk's collider radius, the tree
  art follows it); rng.js (mulberry32, value noise/fbm, dsin/dcos: deterministic trig for colliders); madara.js (Madara: Naruto's body + M1, his own kit: THE data file for
  it); madarakit.js (the kit's deterministic geometry, also the server's: fire wave, stake line, meteor path, barrier window); itachi.js (Itachi: Naruto's body + M1, his own
  kit: THE data file) + itachikit.js (its geometry, also the server's: gaze cone, escape spot, fireball spread).
- `src/main.js` Orchestrator: loading + shader warm-up, title/join, fixed-step loop + interpolated rendering, net handlers, remotes, lock-on, camera, shadow casters,
  graphics presets (setPreset), audio hooks, F3/F4/F6 debug keys, debug hooks.
- `src/game/` controller.js (local fighter sim: movement states, actions), fighter.js (a fighter on screen: VRM + animator + root transform + springs + ring + LOD +
  material variants), remote.js (RemoteMotion: stream interpolation), camera.js (third-person spring arm + wheel zoom), input.js (KB/M + gamepad, buffering), net.js,
  combat.js (attack/guard/charge/reaction actions, hit detection on the clip, predicted feedback, hitr/hitx, substitution), hurtbox.js (capsules, swept tests), jutsu.js
  (the slots Q/E/G/X/R, cooldowns, chakra; shuriken, Rasenshuriken), naruto.js (Naruto's kit: owner-run shadow clones streamed + hittable, Rasengan, the substitution's decoy, the Rush's timeline; clone Bodies pool), madara.js (Madara's kit: casts, area hits, gunbai + wind barrier, meteor) + madaragenjutsu.js (his X) + madaravision.js (its victim's screen), itachi.js
  (Itachi's kit: fireballs, gazes, crows, marks, burning, capture seals), tsukuyomi.js (the victim's Tsukuyomi world), amaterasu.js (Amaterasu's cinematic, every screen; FROZEN_INPUT), dummy.js (dummy + sub logs), audio.js (Web Audio: procedural + `FILES`, recorded lines: playFile).
- `src/char/` rig.js (normalized humanoid rig, Pose buffers, FK, two-bone IK), posekit.js (pose helpers), gait.js (procedural locomotion), animator.js (pose sources + dead
  blending + layers + view-driven actions), clips.js (clip library), keyframes.js (keyed poses with IK targets -> clips), moves.js (every combat/jutsu clip, baked at load)
  + madaramoves.js / itachimoves.js / narutomoves.js (their jutsu clips; `dazed`) + itachim1.js (Itachi's own M1 clips it_*), vrm.js (VRM loading, instance pool, shared textures AND materials).
- `src/world/` arena.js (materials, batching, update), terrain.js (ground, dirt paths, rock on slopes, grass + reeds), nature.js (trees: buttressed trunks, limbs,
  roots, one-mass canopies; strata cliffs + grass fringes, rocks, logs, fences, field, light shafts), village.js (houses in 5 roof colours + tinted plaster, shop fronts,
  balconies, signs, flat-roofed blocks + tower, flagstones, lanterns), props.js (barrels, stone lanterns, carts, stall, poles + wires, banners, sakura, bamboo, dummies,
  shrine, torii), flora.js (flowers, bushes), backdrop.js (mountain rings, hill forest, the town beyond the east rim), palette.js (flat colours as vertex colours),
  water.js (river, stream, two falls, foam, mist, bridge), batch.js (merge per material), sky.js (sky dome, sun, hemisphere, fog), greybox.js.
- `src/gfx/` post.js (outline, bloom by threshold, Neutral tone mapping, grade, SMAA), toon.js (toon patch for Lambert: bands, hatching, triplanar, dither fade of
  occluders), outline.js (screen-space depth/normal outline), paint.js (procedural canvas textures), shadows.js (ShadowCache: static shadows drawn once, moving casters
  redrawn), fx.js (instanced particles; kind 7 = the toon cloud ball of every poof), jutsufx.js (jutsu shaders), movefx.js (M1 trails, scroll prop, bursts: by clip + time), narutofx.js (Afterimages: frozen skinned ghosts, one draw each; the Rasengan's blast), madarafx.js (the kit's visuals: fire/smoke
  billows (`black`: Amaterasu's), decals, field flames, stakes, debris, the gunbai prop (GLB) + wind barrier, meteor), amaterasufx.js (Amaterasu's cinematic post effect), madaravisionfx.js (Madara's eyes in GLSL + VisionEffect), itachifx.js (Mangekyō marks (EyeMarks/SealFx take another eye: pattern), crows, feathers,
  GenjutsuEffect: the victim's grades + eye wipe), tsukuyomifx.js (seals, stage, katanas, ink), haze.js (heat shimmer), debugdraw.js (F4), governor.js + perfcheck.js (ARMORY's).
- `src/ui/` hud.js (HUD, banners, combo, damage numbers, kill feed, scoreboard, results, pause + settings + perf panel; per-character theme from `C.hud`), uchiha.js (Itachi's
  `hud: 'uchiha'`: Sharingan portrait, black flames, his icons; its flame generators are exported) + madara.js (`hud: 'madara'`: Rinnegan portrait, Susanoo flames, plate bar, his icons) + naruto.js (`hud: 'naruto'`, Naruto + Sage; Obito `hud: null`: his face kept (THEMES `face`), chakra flames -> Kurama's cloak at ult, headband bar + Leaf plate `.h-cap`, his icons + the tool icons; hud.js THEMES; css `.t-uchiha`/`.t-madara`/`.t-naruto` share layout), portrait.js (offscreen pictures: HUD portrait, title cards), devbar.js (the "/" dev command bar), hud.css, style.css (title, cards).
- `scripts/` tools/: deploy.mjs (npm run deploy: the VPS), anims.mjs, fonts.mjs, keyart.mjs `<url>` (recapture the boot screen key art: public/assets/boot), rig.mjs (npm
  run rig: auto-rig a T-pose .glb into a VRM 1.0) + glb.mjs (GLB read/write). test/: views, film, shoot, errs, eval, sheet, crop, anim, animcheck, mp, mpcombat, kovis,
  chars, perf, bots, mapwalk, zoom, madara, itachi, itachicombo, itachiperf, naruto (see Testing).
- `scripts/debug/` modelview.mjs (a .glb/.vrm alone from several angles: bones, one bone's weights, test poses; no server), lanes.mjs (clear flat lanes for tests), prof.mjs (CPU
  profile with bots), crowd.mjs (remote state dump + shot), spikes.mjs (long frames), boot.mjs (the boot screen as players see it), climbdbg.mjs (one traced trunk climb), embed.mjs
  (no server: wall runs up every house face and trunk must never end inside a collider; `TRACE=`, `NOUNBURY=1`), stairs.mjs `<url>` (runs up the village stairs: the drawn height per
  frame must rise smoothly), clones.mjs (two clients: clones jumping up to / dropping off a 2.8 m ledge, shots + per-clone trace; `VIEW=B` shoots the target's screen), glbinfo.mjs (a
  .glb's credits, nodes, materials; `islands` lists every connected piece in world space: start of a rig config), footdbg.mjs (one animcheck scenario traced per frame for one leg:
  thigh/shin/foot rotation + the gait's foot state; `SCEN=<js>`), vnc.mjs (the VPS's VNC console: type + screenshot), m1film/m1cast/m1trace (M1 review: slow-motion strip, real speed
  vs a victim, per-frame trace; options in each header), clipflips(-live).mjs (keyframe flips), jshots.mjs (screenshots from a JSON config: one load, one sheet),
  lagdbg/jabdbg/clipdbg/seqdbg (investigations kept for reuse), freeze.mjs (effect freeze-frame sheets), posetest.mjs (keyed-pose workbench), duo.mjs (both screens filmed side by
  side, any lag; X/Z: where), los.mjs (the first collider on a line: test lanes, gotcha 51), gunbai.mjs (Madara's fan at clip frames, several angles; `RUN=1`), gunbaisolve.mjs
  (wrist/target that hold it as wanted), gunbaicheck.mjs (back surface, turn rate, clearance, hair through it), tsushots.mjs (Tsukuyomi: both screens at set times), mgenshots.mjs (Madara's genjutsu: the caster's screen live, the victim's held at each time), amashots.mjs (Amaterasu: both screens at the same timeline times; HOLD=1 exact frames), amaspike.mjs (its frame times per phase, effect on/muted; VSYNC=1), amavoice.mjs (its voice line vs the eyes, both screens), clipsheet.mjs (a move's clip at exact frames on the real model, hitbox + dummy), clipbones.mjs (solved wrists/ankles/hitbox per frame, in numbers), hitreach.mjs (every move's reach margin at its contact spot: gotcha 71), clonesperf.mjs (boot time + frame cost with Naruto's clones out).
- `public/assets/` characters/: standin.vrm = pixiv's VRM1_Constraint_Twist_Sample (VRoid-made; licence: everything allowed incl. violence and modification); sage.vrm =
  npm run rig from models/naruto_sage.glb (CC BY 4.0 ninjatorent13: credit kept in README + its card + VRM meta); madara.vrm, obito.vrm, itachi.vrm = npm run rig
  from models/madara.glb / obito.glb (CC BY 4.0 AJ Studio) / itachi.glb (CC BY 4.0 angelolamonaca), credited the same way; naruto.vrm when the owner adds it.
  anims/clips.json, fonts/, audio/ (the owner's recordings, trimmed with ffmpeg). `models/` Source models + rig configs (naruto_sage.glb from Sketchfab + .rig.json; madara, obito: A-pose Free Fire models; itachi: a
  display figure, limbs generated: gotcha 49). `mixamo/` the owner's Mixamo FBX downloads (gitignored) + base/armory-humanoid.json (ARMORY's starter clips, npm run anims).

## Conventions

- **World axes:** +x east, +z south (north = -z), y up, metres. **yaw 0 looks toward -z**; facing = (-sin yaw, -cos yaw); the fighter's left = (-cos yaw, sin yaw); a yaw increase turns
  left. **VRM normalized space** (src/char): rest rotations are identity; the model faces +Z, its left is +X. Spine chain: +X bends forward, +Y twists left, +Z leans right. Arms rest
  along +-X (T-pose, palms down), elbows flex toward +Z; legs rest along -Y, knees flex toward -Z. The VRM scene sits in `Fighter.body` turned by PI, so root yaw = game yaw.
- **Colliders must be deterministic:** map.js uses the seeded rng and dsin/dcos only (never Math.random, never Math.sin for anything that becomes a collider). Client and
  server log `map <hash>`: they must match. Box yaw: `box(..., yaw)` (dcos/dsin) or boxDir with a unit direction (no trig).
- **Network protocol** (JSON, `t` = type; times are server-clock ms). Client -> server: `join{name,ch,token,pw}` (empty name = the character's name + ' 2'...; `pw`: locked characters),
  `s{s:[x,y,z,vx,vy,vz,yaw,state,stateMs,flags], n:seq}` (30 Hz), `a{k,at,...}` actions sent immediately (`k`: jump, dj, walljump, dash{d,air}, atk{m,i,tg},
  jutsu/tool{m,i,o,d,tg,n,c,s}, sub{p}, tech, guard{on}, charge{on}; `n` = a later phase of a jutsu already paid for: no cooldown/gauge check; `o` = [x,y,z] for projectiles,
  [x,y,z,yaw] for the clones' cast point: the server relays both lengths), `hit{v,m,i,k,at,vt,p:[x,y,z],a:[x,y,z,yaw],c?:[x,y,z,yaw],vc?,cs?}` (`c`: the clone/projectile that
  hit; `vc`: the victim is v's shadow clone of that slot; `cs`: our shadow clone struck), `cs{i,c:[[slot, 10 state numbers, clip#n, clipMs]]}` (our shadow clones, 20 Hz), `ping{c,r}`, `name{name}` (rename; relayed as `name{id,name}`), `dev{c}` (ult/cd/sub/all: `devAllowed`, the real client address behind proxies).
  Server -> client: `welcome{id,st,you,players,dummy,match,map,lag}`, `join{player}`, `leave{id}`, `snap{st, ps:[[id, x,y,z,vx,vy,vz,yaw,state,stateMs,flags, at, seq]]}`
(30 Hz), `a{id,k,at,...}` (relayed), `hitr{a,v,m,i,k,at,t0,d,r,st,hs,p,kb,l,e,n,b,ko?,sq,hp,rw}` (`rw`: the victim's rewound position, drawn by F4; `ko`: the lethal hit,
a knockback the victim stays down from, `e` = land + KO_HOLD), `hitx{v,i,k,why}` (rejected, to the attacker; `counter`: Madara's wind barrier answered it; `cinema`: inside Amaterasu's cinematic; `decoy`: Naruto's clone took it), `deny{k,...}`, `cs{id,i,at,c}` (relayed clone states), `ch{a,o,s,m,i,k,at,d,hp,hs,kb}` (a hit on o's clone s),
`kill{k,v,as,m,live,rs,st}`, `locked{ch,pw}` (join refused: wrong/no password), `spawn{id,p,yaw,seq,hp,prot}`, `match{ph,end,n,dur}`, `sb{ps:[[id,k,d,a,score,ping,alive,slot]]}`, `results{ps,win,mvp,n}`, `gauge{u,sp}` (to
the owner: ultimate gauge, substitution pips), `dev{c,ok,why}`, `pong{c,s}`, `full`. `info` (players in welcome/join): `{id,name,ch,slot,s,at,hp,alive,seq,dummy}`; the dummy has id 0.
  **seq rule:** every server-authoritative teleport (spawn, hit reaction, substitution, tech roll) bumps the fighter's `seq`; the server drops states whose `n` differs (a
stale state can't drag a fighter back). Clients adopt the new seq from `spawn.seq`, `hitr.sq`, `a{k:sub}.sq`, the substitution's catch `a{m:cloneDefense,n:2}.sq`. Remotes interpolate on `at` (the server's receive time of each state) `net.interp` ms behind the synced clock. **Settings** persist in localStorage under `shinobi.*`; the reconnect token is `shinobi.token` in sessionStorage.

## Where to change what (start here)

- **Balance / move feel** (damage, frame data, hitboxes, speeds, jump heights, cooldowns, chakra): `src/shared/naruto.js` only (shared with the server: restart it); check
  a changed hitbox with F4. **Combat rules** (damage scaling, juggles, guard, knockback): `src/shared/combat.js`; hit validation `server/combat.js`. **Netcode**:
  `src/game/net.js`, `src/game/remote.js`, `server/index.js`; run `mp.mjs` + `mpcombat.mjs` at 0 ms and 200,40,1 after.
- **Movement** (states, wall run, dash, mantle): `src/game/controller.js` + `src/shared/physics.js`; run `mapwalk.mjs` after any change (falls, traps, reachability). Lock-on never changes movement (gotcha 59).
  **Animation**: legs/locomotion `src/char/gait.js`; keyed combat/jutsu poses `src/char/moves.js` (+ keyframes.js); blending/layers `src/char/animator.js`; run
  `animcheck.mjs` after (foot sliding, pops) and look at a `film.mjs` strip. **M1 strings**: naruto.js `light` picks U1-U5 (standing) / S1-S5 (>= 5 m/s or dash; L1-L5 =
  the clones'); AttackAction step/leap/air/dive + counted presses; clips `u_*`/`r_*` (moves.js); effects MOVE_FX (movefx.js); scroll hitbox = `grip` box (hurtbox.js
  gripSegment = the prop). After: clipflips-live, animcheck (light + moving combo), mpcombat, m1trace `run` at 200,40,1.
- **Madara's kit** (Q Great Fire Annihilation, E Wood Release, G Uchiha Return, X Sharingan Genjutsu, R Tengai Shinsei): data src/shared/madara.js (a hit's `cls` melee/proj/ult/area decides what the
  barrier does); geometry madarakit.js; src/game/madara.js; madarafx.js; madaramoves.js. Casts come in phases: n:0 at the press (cooldown/gauge), n:1 = the effect with o/d/at (`f` 1
  = cast in the air); area hits: the caster detects, the server checks them with the same geometry (checkArea). G: the gunbai (public/assets/props/gunbai.glb) rides head down on every Madara's
  back (GUNBAI.back; `debugGunbai`) as a spring plane for his hair (GUNBAI.hair), in the fist from `grab` to `release` of `mad_counter` (the fist matches the back pose there: keys
  solved with gunbaisolve.mjs, gotcha 54); from the press to `barrier` the server answers EVERY hit (`a{m:uchihaReturn,n:1,f:1 blow|2 reflect|3 deflect,o,tg,ai,e?,cl?}` to everyone
  incl. the owner; an answered attack is spent: `deflected`, 3 s), throws everyone near at `gustAt` (gustBurst); server hits go through `serverHit` (another barrier deflects them;
  the meteor too: at1 + delay, victims + ping/2, max 150 ms). **X** = a gaze like Tsukuyomi (n:1 eyes + facing, server gazeHits, `REACT.daze` 3 s; madaragenjutsu.js); its victim's
  screen: madaravision.js (`VIS`; a pooled stand-in Madara filmed up close, post.vision: depth-graded face, painted eyes at the projected spots, then only the eyes; `hold`). After:
  `scripts/test/madara.mjs` at :3104 and :3102, jshots/freeze/duo for the looks (fan: gunbai(check).mjs; the genjutsu: scripts/debug/mgenshots.mjs).
- **Itachi's M1** (his own: stand I1-I6, moving R1-R5, air IA1-IA5; data itachi.js ITACHI_MOVES, clips src/char/itachim1.js, MOVE_FX it_*; AttackAction `warp` (crow warp: MOVE_FX `hide`, drawn as the crow shift), `leap.at`, `nextOnHit`, `light.air`, `C.liveTrack`; hit.fx `sphere`; kunai = movefx PROPS): after, hitreach.mjs + itachicombo.mjs at :3104 and :3102 (docs/visuals.md 2b). **Itachi's kit** (Q Phoenix Sage Fire, E Tsukuyomi, G Crow Clone Escape, R Amaterasu): data src/shared/itachi.js; itachikit.js; src/game/itachi.js; itachifx.js;
  itachimoves.js. Fireballs (n:1-3): the caster detects (turn-rate homing on an intercept point; a dash seen drops the lock; the server refuses a ball whose victim
  dashed/substituted during its flight: `spec.dodge`). Gazes (n:1: eyes + facing): the SERVER takes the cone (gazeHits); Tsukuyomi = `REACT.daze` (5 s, no sub; `keepDaze`:
  hits keep it, `dz` in hitr). Crows: n:1 = the spot (14-22 m; crowTeleport), invulnerable (`p.escape`), an ink comet flies there (`inkComet`). **Crow shift** (`crowShift`, visual only): his dash = ink (`updateShift`, from `view.st` on every screen: body hidden, one slim InkStrokes streak (toned down on review: keep effects restrained), crows via `flyOff` (never at the camera: gotcha 57), `inkWake`/`inkForm`); his substitution: `onSub`. Test: itachi.mjs `shift`.
  **Tsukuyomi's looks** (tsukuyomifx.js): every screen: the eye before him (clip frames 10-40), the capture round each victim (SealFx: flash, violet, blades, ring, seal;
  updateDazed), then the head mark. The victim's screen (tsukuyomi.js, TSU): eye + pupil wipe; a stage where it stood (T cross, stand-ins `tsu_bound`/`tsu_watch` from
  the pools, +1 warmed), camera/fog/HUD borrowed (`late()`), dim -> fog (arena hidden) -> negative (gotchas 55-56), katanas on bones, ink; all given back (`abort()`). After: `scripts/test/itachi.mjs` at :3104 and :3102, itachiperf.mjs, `scripts/debug/tsushots.mjs` (the looks).
  **Amaterasu = a 5 s cinematic on EVERY screen at once** (src/game/amaterasu.js `AMA`: seconds on the server clock from the press `at`; amaterasufx.js: teal negative, painted face (his protector, bangs, brows, tear troughs; eyes wide: amShut/amLoO/amUpO) + eyes, black-flame burst + burn-away; clip `ita_amaterasu` 312 f): n:1 at `pick` (frame 12) -> the server takes the cone and sends `v` (ids) + `e` to all incl. the caster,
  ignites at `focus` (262) on its own clock (each screen `latch`es the flames at `e`), then `v.burn` ticks to 50% (burnStep). Frames 12-300 the arena holds still (FROZEN_INPUT, landHit off; server `cinemaAt`: `hitx why:cinema`, other burns paused; `p.cine` invuln; one at a time). Looks: amashots.mjs (HOLD=1). Voice (`AMA.voice` 0: from the press, "Amaterasu" at 1.46 (the owner's ear; the file fetched no-cache), `voiceStep`, audio-clock scheduled, latency compensated): amavoice.mjs (0 ms and :3102).
- **Naruto's kit** (Q Shadow Clone Jutsu, E Rasengan, G Shadow Clone Substitution, X Shadow Clone Rush; R Rasenshuriken in jutsu.js): data naruto.js (`kind`: clones / rasengan / decoy / rush),
  client src/game/naruto.js, visuals narutofx.js, clips narutomoves.js. Shadow clones: only the caster runs them (stepBody + a small AI: `pack` 1 attacker per target, `gap` after a string: gotcha 77), streams `cs`, the server keeps a fighter-like record each (history, HP 1: any hit pops one; `cloneHit`, `cloneGone` = n:2; server-applied areas: `popClones`); the Rasengan dash homes only inside `dash.cone`/`dash.range`; targets carry the caster's id + `vc` (gotcha 76). The Rush (redesigned 2026-09-30: the old one, clones round the target following it, was unavoidable) = three clones out of smoke beside him charging the target (every screen steps them at 60 Hz from the press on the server clock, homing turn-limited on the target it draws; past it or 1 s: gone; he holds the seal, a hit on him bursts them: `rushStruck`); its finisher is the NR move. The substitution: the server's `decoyCaught` (window, seq teleport behind the attacker, `cloneDefense:counter`); no invuln flag in the window (`ctrl.invulnFrom`). Aimed jutsu use `Combat.aimTarget` (fighters only). After: `scripts/test/naruto.mjs` at :3104 and :3102, kovis, chars, clonesperf; films for the looks (docs/visuals.md 2c).
- **Graphics**: post `src/gfx/post.js`; toon `src/gfx/toon.js`; sky/sun/fog `src/world/sky.js`; presets `Game.setPreset` (main.js); run `perf.mjs` after (budget: 6
  fighters, High; A/B against a baseline build, gotcha 73). New effects/poses: docs/visuals.md. **UI / HUD**: `src/ui/hud.js` + `hud.css`; boot screen: `index.html`.
- **Map**: layout + colliders `src/shared/map.js` (deterministic, hashes must match); art `src/world/*`; run `mapwalk.mjs` and `scripts/debug/embed.mjs` after. Nothing
  drawn may stand outside its collider where a fighter or the camera can reach it (tree art follows `treeRadius`; bark dents and buttress gaps only go inward); leaves
  have no collider (they fade near the camera: toon `near`). Trees: trunk cone + root-flare cone (`wallTop` hands a wall run on to the trunk) + a crown platform on the
  canopy; branches: two sloped boxes each, aimed clear of other trees/walls/the edge. Stairs: one ramp collider under the drawn steps (gotcha 38). New colliders go
  last with their own rng (`rp`: nothing placed before moves); the stream + falls notch the cliff rows (same draws); art: flat colours via palette.js (gotcha 72).
- **Camera zoom** (mouse wheel, not locked on): `ThirdPersonCamera` in `src/game/camera.js` (`ZOOM_NEAR` = arm fully in, metres; `ZOOM_STEP` per notch; `ZOOM_TIME`
  smoothing). A dolly, not an FOV change (the owner rejected FOV zoom): `cam.zf` scales the arm from the shoulder pivot; fully out = the normal 3.3 m arm; FOV stays the
  settings value (`baseFov` + sprint/dash kick). `cam.arm` (collision) stays in unzoomed metres, so zooming out with nothing behind follows the wheel while a wall still
  snaps the camera in. Focus stiffness scales by 1/zf (same on-screen lag when close). Wheel deltas become notches in input.js (`takeZoom`); `takeWheel` (sign only) stays
  for lock-on switching. Run `scripts/test/zoom.mjs` after.
- **The owner's Naruto model**: `public/assets/characters/naruto.vrm` (`model` in naruto.js); until then main.js uses `standin.vrm` (the one console 404 is
  expected). Moves are baked for the model's proportions (bakeMoves): re-run `animcheck.mjs`, check hitboxes (F4). Mixamo clips: `mixamo/*.fbx` -> `npm run anims` (ASSETS.md).
- **Another character**: add it to `CHARACTERS` in `src/shared/characters.js` (a data file like naruto.js, or `{ ...NARUTO, id, name, model, card }` for the same fighter
  in another body). main.js loads every model (`game.chars`: id -> { C, model, lib, standin }; `game.charModel(ch)`), bakes keyed moves per body, warms instances + clone
  pools per character, compiles all in warmShaders, renders a title card each. A model that fails to load makes its character unpickable (others who picked it draw as the
  default). Unrigged model: `node scripts/debug/glbinfo.mjs <file.glb> islands` (credits, triangles, pieces), then `npm run rig` with a config like
  `models/naruto_sage.rig.json` (T-pose) or `models/obito.rig.json` (A-pose: `apose` first, then `TPOSE=out.glb npm run rig -- <cfg>` and measure the rest on the lifted
  mesh), scale to hips 0.908 m (other proportions: a compromise between hips, shoulders and head, like Madara's 1.12: hips 0.858, shoulders 1.255, head 1.421 vs the
  stand-in's 0.908 / 1.274 / 1.386), long hair/ribbons as `chains` (`front` keeps bangs on the head), armour tassets over a coat as `plates`, collars etc. as `rigid`;
  no limbs under the clothes (`models/itachi.rig.json`): `colors` (repaint a material: his fair skin), `drop`, `simplify`, `reshape`, `parts` (generated sleeves, hands, legs), `islands.noArm`, `atlas` (1 material,
  1 primitive: each material costs a draw); check with `scripts/debug/modelview.mjs` (bones, `weights=<bone>`, `pose=run|kick|crouch|arms|punch`) and in game (film,
  animcheck / mpcombat / kovis / chars / perf with `CH=<id>`, F4). After any rig.mjs change, rebuild Sage, Obito, Madara from scratch copies of their configs and `cmp`.
- **Title screen** (name, cards, keys 1-9/arrows, Enter in the field joins; 3+ characters: one row of up to 5 cards, wider panel, smaller logo: `.many`/`.five` +
  `--cols`; HUD portrait raised `card.face` m): main.js `buildTitleSide`, `pickChar`, `titlePick`; index.html; `shinobi.name`/`.char`; URL `?name=` `?ch=` override.
  **Itachi is password-locked (owner's rule: HUNNY):** `locked: true` in its data = 🔒 tag + password field (`askPassword`); the SERVER checks (`LOCKED` in server/index.js, never in the bundle); `shinobi.pw`, URL `?pw=` (tests joining as Itachi pass `&pw=HUNNY`; bots send it).

## Hard-won gotchas

Details of each (what broke, numbers, the fix) are in docs/gotchas.md, imported here so every session loads them; add new ones there, numbered. Index: 1. Standing height includes
the hip-joint drop | 2. Run/sprint (8, 12 m/s) far exceed mocap run clips (~4.5 m/s) | 3. The VRM object has no userData | 4. Remote interpolation delay | 5. Anti-teleport clamp
vs resyncs | 6. Clock sync under simulated lag | 7. Google Fonts CJK families come in ~120 unnamed chunks | 8. The lag simulator keeps order with one queue per line | 9. Hit
detection samples the move's own clip, not the drawn frames | 10. Hitbox bones must match the animation | 11. Substitution vs hits on the wire | 12. A late confirmation must not
replace a newer prediction | 13. Controller.reset() ends the current action | 14. Constructor names are minified in builds | 15. Clones and projectiles send their own position |
16. ShadowCache.blit() must restore the renderer's target | 17. Shader programs are keyed by output colour space and lights | 18. Six fighters were CPU-bound in the render
submission | 19. Fighter world matrices are computed once per frame | 20. The laptop's CPU speed swings ~2x between runs | 21. Branches are overhangs, not walls | 22. Tints
multiply in linear space | 23. Flat planes edge-on become lines | 24. Two-bone IK turns both bones about one hinge axis | 25. The sim runs at 60 Hz, drawing at 144 | 26. Gait
restarts must be continuous | 27. A dead fighter's action must keep stepping | 28. The server relayed the clones' cast origin only with 3 numbers | 29. Easing into a late
reaction starts from the drawn position and aims at the flight's present point | 30. Every fighter draws with its own character's model AND clip library | 31. Auto-rigging a
low-poly model | 32. Two test clients in one browser share localStorage and get throttled in the background | 33. Ripped game meshes (Sketchfab "Free Fire", node names `*.rip`)
wind ~half their triangles backwards | 34. Keyed hand targets are placed relative to the shoulders | 35. A-pose lift past the elbow | 36. A swinging foot must not follow the raw
velocity direction | 37. A vault's landing must have room | 38. Only a ledge is a step up | 39. Falling, land on anything within a step above the feet | 40. Cones and wall runs |
41. Keys (or blends into them) ~180 degrees apart flip | 42. Effects warmed in warmShaders are moved to the spawn point | 43. Slow motion breaks server validation | 44. The chain
buffer counts presses | 45. Server-applied hits are never predicted | 46. pickLock may pick the training dummy | 47. One long frame in a headless vsync-off run is not a hitch to
chase | 48. A barrier must not raise the invuln flag | 49. A display figure has no body under its clothes; one piece per material costs a draw each | 50. Post effects see linear
light | 51. Test lanes need line of sight, not just flat ground | 52. A keyed hand target is the wrist | 53. Spring collider matrices are refreshed in the scene pass | 54. A prop
resting on spiky spring hair | 55. A post effect that mixes channels must guard against NaN | 56. Something drawn to survive the negative must be written as its perceived
negative | 57. Effects thrown back from a third-person fighter fly into the camera | 58. Don't draw over what the model already paints; check its colours in game | 59. Lock-on must not change how a fighter moves | 60. Screenshots of a real-time cinematic land late | 61. A window that refuses hits must not drop counted ones | 62. Check every smoothstep's edges and every mask's side in a painted shader | 63. Headless vsync-off runs flood the GPU queue: judge hitches with vsync on | 64. EffectPass sorts effects by attributes (depth readers run before tone mapping) | 65. A HUD icon judged in game may just be on cooldown | 66. A painted face must carry the character's identity markers | 67. Find a word in a recording by its voicing, not its loudness | 68. Behind a proxy every player is localhost | 69. A held blade sticks out of the fist's thumb side | 70. A step aims where the victim was when the move began | 71. The separation push moves a warp's end spot | 72. Draw calls cost, triangles don't: never split a batch to cull it | 73. Judge a map's cost against a baseline build, back to back | 74. A ring seen from inside must face inward; far opaque art keeps the default order | 75. Pooled bodies added at runtime upload their buffers when first drawn: draw them at the warm-up | 76. A target that shares an id needs its own key (shadow clones) | 77. Several AI attackers on one target stunlock it | 78. A new kind of target must join every server-side area loop too | 79. Near-white particles bleed a bloom halo | 80. An attack placed round its target and following it cannot be dodged | 81. A timeline's exit phases are seconds, not a ratio | 82. A glow built from a shape's own edge curves shows their steep ends | 83. A painted thing that closes must stop drawing its outline | 84. Judge an icon by what its silhouette reads as at 66 px.

@docs/gotchas.md
@docs/visuals.md
## The VPS (production, set up 2026-09-28)

- **Live:** **https://shinobi.185-2-49-69.sslip.io** (also http://185.2.49.69:3100): Shulker VPS `games-1` (4 vCPU / 8 GB, Ubuntu 24.04, Dadri), to host all
  the owner's games (ARMORY next on 3000; one Caddy block per game, by subdomain). **Access:** `ssh root@185.2.49.69` with the laptop key (keys only; the VNC console
  + scripts/debug/vnc.mjs when SSH is lost). **Setup:** Node 24 + pm2 as user `kaustab` (`pm2 logs shinobi`), ufw, Caddy for HTTPS. Every detail (the box, its
  network, keys and passwords' whereabouts, pm2, ufw, Caddy): docs/vps.md "Box, access, setup".
- **Deploy:** `npm run deploy` (scripts/tools/deploy.mjs; `DEPLOY_HOST=root@<ip>` for another box): packs with Windows' bsdtar (Git Bash's GNU tar reads "C:" as a remote
  host) minus node_modules/mixamo/dist*/shots/models, scp, wipes the old tree except node_modules, npm install, build, `pm2 restart shinobi`. The restart kicks everyone
  (deploy when nobody plays); the live copy changes only on deploy. Check: `node scripts/test/mp.mjs https://shinobi.185-2-49-69.sslip.io/` (PASS over the internet, RTT
  ~87 ms; it joins the live arena: players online see the bots Alpha/Bravo).
- **Domain (sslip.io), public IP (WireGuard via OVH Mumbai; unreachable after an update? `ip rule` first), ping (~80 ms; a Dadri IP saves ~35), 10-16% loss via Mumbai (slow loads):** docs/vps.md.

## Testing (headless Chrome on the real RTX 4050)

Build dist-test (`npm run build:test`), start a test server (Commands), run the tools (scripts/test/ unless noted: `node scripts/test/mp.mjs http://localhost:3101/`); look at every PNG:
- `views.mjs <url> <prefix> '[["name","js",waitMs], ...]' [w h]`: one load, a screenshot per view. `film.mjs <url> <out.png> <setupJs> [frames] [everyMs] [cols] [w] [h]
  [stepJs]`: filmstrip contact sheet (animation review; `__game.timeScale = 0.25` slow motion, `__game.studio = {...}` camera).
- `mp.mjs <url>`: two clients, PASS/FAIL: see each other, remote path error vs the true path (net of the uplink), settle, jump replication, leave. At 0 ms (:3101) and
  200,40,1 (:3102), where the running-path median lands just over its 0.35 m limit ~1 run in 4 (TCP-like loss stalls): rerun before calling it a regression (a real
  one fails every run; madara.mjs's two-shuriken reflection at 200,40,1 too).
- `mpcombat.mjs <url>` (combat sync; :3104): two clients fight: 5-hit combo confirmed, HP agrees, knockback flight within 10 cm on both screens, substitution, KO + score
  + respawn. Needs `SHINOBI_HP=600 SHINOBI_MATCH=300,10,2`; at 0 ms and `SHINOBI_LAG=200,40,1`. `DETAIL=1` prints every flight frame off by > 3 cm; `CH=sage` fights as
  another character (its own rig/clips drive the hitboxes). The flight check only measures frames after the finisher (200 ms: earlier reactions snap in late).
- `madara.mjs <url> [fire,wood,counter,meteor,genjutsu]` (Madara vs Naruto, `SHINOBI_ULT=1`): each ability hits, same place on both screens, HP agrees; dodges, guards, the barrier's gust/blow/reflections/window end; the genjutsu's daze (3 s + hitstop), the vision on B (all given back, no compile), a launch breaking it.
- `itachicombo.mjs <url> [stand,juggle,run]` (Itachi vs Naruto, HP 600): his M1 strings at real speed: every hit confirmed, none rejected, HP agrees, launch/spike/knockback, warp end spots, contact distances. `itachi.mjs <url> [fire,dodge,amaterasu,tsukuyomi,crow]` (vs Naruto, `SHINOBI_ULT=1`, HP 600, lane x -44): fireballs hit + sync, a dash shakes them off, a runner is
  hit; Amaterasu: the cinematic on both screens (same frame, flames at the same ms), the victim frozen, all given back, burns exactly 300; the daze (5 s, no move/sub, kept by a hit) + B's world (arena hidden, all given back, no compile); crows. `itachiperf.mjs`: fps each.
- `kovis.mjs <url> [shotsDir]`: the KO fall on the victim's own screen and the attacker's (thrown, then lying: hips < 0.5 m), paths agree within 25 cm after the ease-in,
  no pops (> 0.5 m in a frame) on the victim's screen; then the Rush (X) cast just by looking at the victim: it sees all four clones appear round it, dart in, strike, and takes the hits. Same env as mpcombat, 0 ms and 200,40,1. `DETAIL=1`: frames around any step > 20 cm; `CH=<id>`: both clients as that character.
- `naruto.mjs <url> [clones,rasengan,rush,defense]` (Naruto vs Naruto, HP 600, lane x -44): the clones on both screens (drawn where their caster runs them, net of the uplink), their hits + HP, B beating one, all gone after 9 s; the Big and the tapped Rasengan (thrown 8+ m, same landing on both); the Rush's four clones + three strikes + launch + spike; the substitution uncaught (6 m, same spot) and caught (behind the attacker, stagger, no damage).
- `devcmd.mjs <url>` (:3101): the "/" bar with real keys + who the server serves. `chars.mjs <url>`: A goes through the title screen (types "Nova", picks Sage Naruto by its number key, or `CH=<id>`'s card, Enter), B autojoins with no name:
  typed/fallback names, saved choices, each draws the other with the right model + clip library, B sees A's clones in A's body, a rename reaches the other screen.
- `perf.mjs <url> [bots=5] [secs=6]` (budget check): 1920x1080 vsync-off client + network bots (bots.mjs; `BOT_DASH=1`: they dash) at four spots; fps, 1% low, worst frame, CPU per frame and
  logic+anim JS, calls, triangles, programs vs the budget. Bots cycle through the roster (every model on screen); `BOT_CH=<id>` gives them one, `CH=<id>` the client. Run
  perf alone (another session's headless Chrome tests wreck the numbers: 88 ms spikes). `SHOTS=shots` saves a shot per spot; `W=/H=` viewport. The match starts (everyone respawns) when the bots join: teleport after that.
- `mapwalk.mjs [secsPerTarget] [--verbose]` (map walk + wall-run bot: falls, traps; Node only, no server): the real Controller + CollisionWorld in Node (60 Hz, ~0.2 s for
  30 sim minutes): every 10 m ground cell, every branch (via its trunk, chakra full), every rooftop. PASS = no falls through the world, nothing out of bounds, no trapped
  spots, never standing inside a collider, >= 90% of ground cells (tree crowns are targets too). `TRACE="tree 4 branch 0"` prints one attempt.
- `animcheck.mjs <url>` (foot sliding + pops over 12 movement/combat scenarios): real input, normal speed, on clear flat lanes (scripts/debug/lanes.mjs); per drawn frame:
  ankle drift of planted flat feet (< 2 cm) and pops (> 15 deg in one frame and >= 2.5x the rotation rate of the frames around it). `DETAIL=n`: the worst n events with
  the gait's feet state; `CH=sage` another character. `zoom.mjs <url> [shotsDir]`: wheel zoom (synthetic wheel events): limits (arm 3.3 m / 1 m), FOV never changes, a
  wall behind still limits the arm while zooming out, focus lag sprinting zoomed in, lock-on keeps the wheel, no overshoot; PASS/FAIL.
- `scripts/debug/prof.mjs <url> [bots] [secs]`: Chrome CPU profile, top self/inclusive times per frame; `CALLERS=fn` splits one function by caller (unminified 3103 build).
  `eval.mjs <url> "<js>"` (join, run an expression, print), `errs.mjs` (startup errors), `shoot.mjs` (one screenshot), `sheet.mjs` (PNG contact sheet), `crop.mjs` (zoom).

**Debug hooks** (`window.__game`, `window.__ready`, `window.__BI` bone indices): URL `?autojoin=1&name=X` joins without a click. `__game.teleport(x, z, yaw)`: the local
fighter on the ground there. `__game.hold(['up','jump'...])` holds input actions (`[]` releases). `__game.timeScale` (0 freezes). `__game.studio = { yaw, pitch, dist, h,
fov, abs, at }`: orbit camera around the local fighter (`at: [x, y, z]`: a fixed point instead) (yaw 0 = in front, PI/2 = its left side; `null` = game camera). `__game.player.anim` (Animator): `.gait`, `.pose`,
`.debugPose = (pose, rig, view) => {}` (runs after the layers). `__game.ctrl` (Controller: body, st, chakra...), `__game.remotes` (Map id -> { fighter, motion, info, view
}), `__game.net` (rtt, interp, stats), `__game.world` (CollisionWorld), `__game.map`. F3: performance overlay. F4: hurtboxes (green), swept hitboxes (red), server-rewound
victims (yellow); `__game.debug` is the DebugDraw while on. F6: collider greybox over the art. `__game.autoPreset()`: what "Auto" means (perfcheck.js detectPreset:
software -> low, integrated -> medium, dedicated -> high, high-end desktop -> ultra). `__game.setPreset('low'|'medium'|'high'|'ultra')` (pixel ratio, sun shadow size,
grass density, bloom, SMAA quality; High/Ultra = native resolution), `__game.audio` (Audio), `__game.shadows` (ShadowCache), `LOD` in fighter.js.
## Style
Plain ES modules, no TypeScript, no framework. Two-space indent, single quotes, semicolons. Comments explain *why*, sparsely. Small files, one responsibility. Update all md files and claude.md everytime u do some changes.