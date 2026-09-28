# SHINOBI ARENA: guide for Claude sessions

A browser multiplayer **third-person anime ninja arena fighter** in the style of *Naruto to Boruto: Shinobi Striker*. Players type a name, pick a character (Naruto, Sage
Naruto, Madara or Obito: same fighter, different bodies) and join one free-for-all arena (up to 6 players) on one map, "Training Grounds". Three.js (WebGL2) + three-vrm
client, Node.js + `ws` server, same stack and netcode ideas as ARMORY (`C:\Users\kaust\OneDrive\Desktop\Armory`, the owner's earlier game; its CLAUDE.md gotchas apply
here too). The owner cares most about how it looks, how smooth it runs, how perfect the sync is. Priorities when they conflict: 1. movement/animation quality, 2. combat
feel + exact hitboxes, 3. sync, 4. frame rate, 5. map beauty, 6. UI. Full brief `shinobi-game-prompt.md`; status, milestones, known issues `project.md`; player-facing
`README.md`; the owner's asset checklist (VRoid Naruto + Mixamo clips) `ASSETS.md`.

**Standing rules from the owner:** after every successful change, update CLAUDE.md (+ docs/gotchas.md), project.md and README.md. Keep CLAUDE.md **under 250 lines**
(condense, never drop information). Commit only when the owner asks. Never kill a process on a port without asking (the owner may run ARMORY on 3000 and this on 3100).

## Commands

```bash
npm install; npm start    # vite build + node server/index.js on :3100 (how the owner plays);  npm run serve: server only (serves dist/)
npm run dev               # server :3100 + Vite HMR :5174 (/ws and /api proxied);  npm run build: client -> dist/;  build:test: client -> dist-test/ (tests never touch
                          dist/)
npm run share             # public https link: cloudflared quick tunnel over HTTP/2 (keep --protocol http2!)
npm run deploy            # upload + build + pm2 restart on the VPS (https://shinobi.185-2-49-69.sslip.io); kicks live players
npm run anims             # mixamo/*.fbx (+ mixamo/base/armory-humanoid.json) -> public/assets/anims/clips.json;  npm run fonts: re-download the Google Fonts into
                          public/assets/fonts (no CDN at runtime)
npm run rig -- models/naruto_sage.rig.json   # unrigged T-pose .glb -> game-ready .vrm (public/assets/characters/sage.vrm)
npm run test:mp           # 2 headless Chrome clients vs a test server on :3101;  test:mp-lag: same vs SHINOBI_LAG=200,40,1 on :3102;  test:chars: names + character
                          select (2 clients, :3101)
node scripts/test/<t>.mjs <url>   # mpcombat, kovis (:3104), perf (:3101 5 6), animcheck, zoom, chars, mp; mapwalk.mjs needs no server (see Testing)
```

- **Test servers** (never the owner's :3100): `SHINOBI_DIST=dist-test PORT=3101 node server/index.js`; with lag `SHINOBI_LAG=200,40,1 SHINOBI_DIST=dist-test PORT=3102
  node server/index.js`. Rebuild dist-test after client changes (a running server picks up new files); restart it after `server/` or `src/shared/` changes. Ports (all
  mine to start/stop; the owner's are 3000 and 3100): 3101 plain, 3102 lag 200,40,1 (+HP 600), 3103 unminified build (`vite build --minify false --outDir dist-prof`) for
  readable CPU profiles, 3104 HP 600.
- `SHINOBI_LAG=rtt,jitter,loss` (ms, ms, %) delays every message both ways (server/lag.js); loss is TCP-like (a lost segment arrives ~1 RTT late and holds up everything
  behind it: WebSockets never drop messages). `SHINOBI_MATCH=duration,results,respawn` (s) shortens the match loop. `SHINOBI_HP=n`: every fighter's max HP (quick KOs).
  `SHINOBI_DEBUG=1` logs every rejected hit / denied substitution with the reason.
- **Don't use `python`** in shells (Windows Store stub, hangs). Node scripts only; multi-line scripts go in `.mjs` files (heredocs with quotes/backticks have broken).
  Headless Chrome = `C:/Program Files/Google/Chrome/Application/chrome.exe` via puppeteer-core with `--use-angle=d3d11` (real RTX 4050).

## Layout

- `index.html` Boot screen (inline markup/CSS/script: paints before the bundle; window.BOOT API), title, HUD roots.
- `server/index.js` Static server (dist/, gzip cached in memory) + /api/status + the WebSocket room at /ws: join (auto names "Naruto", "Naruto 2"...), states (seq rule,
  sanity clamp), actions (relayed with the owner's start time), hits (validated in combat.js), HP, KOs, assists, respawns (farthest spawn), sub pips, ult gauge, match
  loop (warmup -> live 5:00 -> results 10 s -> live), ghosts.
- `server/combat.js` Per-fighter history (rewind), action instances, reactions as deterministic flights, invulnerability windows, hit validation (window, reach, LOS, dup,
  invuln at the hit time). server/lag.js: SHINOBI_LAG simulation (ordered delay lines per socket and direction).
- `src/shared/` Client AND server (pure JS, no three.js): config.js (PORT, SIM (60 Hz), NET, MATCH, PALETTE, ST state ids, FLAG bits, SURF ids); naruto.js (THE data file
  for Naruto: stats, movement constants, moves + frame data + hitboxes + damage, jutsu, reactions; COMBO = anti-infinite rules; tune here only); characters.js (roster
  CHARACTERS, charOf: naruto (naruto.js) and sage (= NARUTO's data with another model + card); players carry a characterId end to end); combat.js (REACT codes, hitSpec(),
  resolveHit(): damage scaling, stun decay, guard, juggles, forced knockdown, knockback vector; reactionFlight()/reactionTimes()); collide.js (CollisionWorld: heightfield
  + yaw-rotated boxes (optionally sloped tops) + cylinders (optionally cones: r at y0, r1 at y1), grid broad phase; ground(), pushOut(), ceiling(), wall() (wall-run
  surfaces), solidAt() (room here?), raycast(), clear()); physics.js (stepBody(): kinematic capsule: substeps, step-up, snap-down, slopes, ceilings, bounce; Flight:
  deterministic knockback/launch trajectories); map.js (buildMap(seed): terrain, colliders, prop descriptors, spawns; treeRadius(t, y): a trunk's collider radius, the
  tree art follows it); rng.js (mulberry32, value noise/fbm, dsin/dcos: deterministic trig for colliders).
- `src/main.js` Orchestrator: loading + shader warm-up, title/join, fixed-step loop + interpolated rendering, net handlers, remotes, lock-on, camera, shadow casters,
  graphics presets (setPreset), audio hooks, F3/F4/F6 debug keys, debug hooks.
- `src/game/` controller.js (local fighter sim: movement states, actions), fighter.js (a fighter on screen: VRM + animator + root transform + springs + ring + LOD +
  material variants), remote.js (RemoteMotion: stream interpolation), camera.js (third-person spring arm + wheel zoom), input.js (KB/M + gamepad, buffering), net.js,
  combat.js (attack/guard/charge/reaction actions, hit detection on the clip, predicted feedback, hitr/hitx, substitution), hurtbox.js (capsules, swept tests), jutsu.js
  (shuriken, Rasengan, Shadow Clone Rush, Rasenshuriken: actions, projectiles, clones), dummy.js (training dummy + substitution logs), audio.js (procedural Web Audio).
- `src/char/` rig.js (normalized humanoid rig, Pose buffers, FK, two-bone IK), posekit.js (pose helpers), gait.js (procedural locomotion), animator.js (pose sources +
  dead blending + layers + view-driven actions), clips.js (clip library), keyframes.js (keyed poses with IK targets -> clips), moves.js (every combat/jutsu clip, baked at
  load), vrm.js (VRM loading, instance pool, shared textures AND materials).
- `src/world/` arena.js (art pass: materials, batching, update), terrain.js (ground mesh, dirt paths, instanced grass), nature.js (trees: buttressed trunks, tapering
  limbs + twigs, surface roots, one-mass canopies with vertex-colour occlusion; cliffs, rocks, logs, fences, field, light shafts), village.js (houses, shops, signs,
  lanterns), water.js (river, waterfall, bridge), batch.js (merge per material), sky.js (sky dome, sun + shadow frustum, hemisphere, fog), greybox.js.
- `src/gfx/` post.js (outline, bloom by threshold, Neutral tone mapping, grade, SMAA), toon.js (toon patch for Lambert: bands, hatching, triplanar, dither fade of
  occluders), outline.js (screen-space depth/normal outline), paint.js (procedural canvas textures), shadows.js (ShadowCache: static shadows drawn once, moving casters
  redrawn), fx.js (instanced particles), jutsufx.js (jutsu shaders), movefx.js (M1 trails, scroll prop, bursts: by clip + time), debugdraw.js (F4), governor.js +
  perfcheck.js (frame stats, from ARMORY).
- `src/ui/` hud.js (HUD, banners, combo, damage numbers, kill feed, scoreboard, results, pause menu + settings + performance panel), portrait.js (offscreen model
  pictures: HUD portrait, title character cards), hud.css, style.css (incl. the title's name field + character cards).
- `scripts/` tools/: deploy.mjs (npm run deploy: the VPS), anims.mjs, fonts.mjs, keyart.mjs `<url>` (recapture the boot screen key art: public/assets/boot), rig.mjs (npm
  run rig: auto-rig a T-pose .glb into a VRM 1.0) + glb.mjs (GLB read/write). test/: views, film, shoot, errs, eval, sheet, crop, anim, animcheck, mp, mpcombat, kovis,
  chars, perf, bots, mapwalk, zoom (see Testing).
- `scripts/debug/` modelview.mjs (a .glb/.vrm alone from several angles: bones, one bone's weights, test poses; no server), lanes.mjs (clear flat lanes for tests),
  prof.mjs (CPU profile with bots), crowd.mjs (remote state dump + shot), spikes.mjs (long frames), boot.mjs (the boot screen as players see it), climbdbg.mjs (one traced
  trunk climb), embed.mjs (no server: wall runs up every house face and trunk must never end inside a collider; `TRACE=`, `NOUNBURY=1`), stairs.mjs `<url>` (runs up the
  village stairs: the drawn height per frame must rise smoothly), clones.mjs (two clients: clones jumping up to / dropping off a 2.8 m ledge, shots + per-clone trace;
  `VIEW=B` shoots the target's screen), glbinfo.mjs (a .glb's credits, nodes, materials; `islands` lists every connected piece in world space: start of a rig config),
  footdbg.mjs (one animcheck scenario traced per frame for one leg: thigh/shin/foot rotation + the gait's foot state; `SCEN=<js>`), vnc.mjs (the VPS's VNC console: type +
  screenshot), m1film/m1cast/m1trace (M1 review: slow-motion strip, real speed vs a victim, per-frame trace; options in each header), clipflips(-live).mjs (keyframe
  flips), lagdbg/jabdbg/clipdbg/seqdbg (investigations kept for reuse).
- `public/assets/` characters/: standin.vrm = pixiv's VRM1_Constraint_Twist_Sample (VRoid-made; licence: everything allowed incl. violence and modification); sage.vrm =
  npm run rig from models/naruto_sage.glb (CC BY 4.0 ninjatorent13: credit kept in README + its card + VRM meta); madara.vrm, obito.vrm = npm run rig from
  models/madara.glb / obito.glb (CC BY 4.0 AJ Studio, credited the same way); naruto.vrm when the owner adds it. anims/clips.json, fonts/.
- `models/, mixamo/` Source models + rig configs (naruto_sage.glb from Sketchfab + .rig.json; madara.glb + madara.rig.json, obito.glb + obito.rig.json: both A-pose Free
  Fire models). mixamo/: the owner's Mixamo FBX downloads (gitignored) + base/armory-humanoid.json (ARMORY's starter clips, converted by npm run anims).

## Conventions

- **World axes:** +x east, +z south (north = -z), y up, metres. **yaw 0 looks toward -z**; facing = (-sin yaw, -cos yaw); the fighter's left = (-cos yaw, sin yaw); a yaw
  increase turns left. **VRM normalized space** (src/char): rest rotations are identity; the model faces +Z, its left is +X. Spine chain: +X bends forward, +Y twists
  left, +Z leans right. Arms rest along +-X (T-pose, palms down), elbows flex toward +Z; legs rest along -Y, knees flex toward -Z. The VRM scene sits in `Fighter.body`
  turned by PI, so root yaw = game yaw.
- **Colliders must be deterministic:** map.js uses the seeded rng and dsin/dcos only (never Math.random, never Math.sin for anything that becomes a collider). Client and
  server log `map <hash>`: they must match. Box yaw: `box(..., yaw)` (dcos/dsin) or boxDir with a unit direction (no trig).
- **Network protocol** (JSON, `t` = type; times are server-clock ms). Client -> server: `join{name,ch,token}` (empty `join.name` = the character's name + ' 2'...),
  `s{s:[x,y,z,vx,vy,vz,yaw,state,stateMs,flags], n:seq}` (30 Hz), `a{k,at,...}` actions sent immediately (`k`: jump, dj, walljump, dash{d,air}, atk{m,i,tg},
  jutsu/tool{m,i,o,d,tg,n}, sub{p}, tech, guard{on}, charge{on}; `n` = a later phase of a jutsu already paid for: no cooldown/gauge check; `o` = [x,y,z] for projectiles,
  [x,y,z,yaw] for the clones' cast point: the server relays both lengths), `hit{v,m,i,k,at,vt,p:[x,y,z],a:[x,y,z,yaw],c?:[x,y,z,yaw]}` (`c`: the clone/projectile that
  hit), `ping{c,r}`, `name{name}` (rename; relayed as `name{id,name}`).
  Server -> client: `welcome{id,st,you,players,dummy,match,map,lag}`, `join{player}`, `leave{id}`, `snap{st, ps:[[id, x,y,z,vx,vy,vz,yaw,state,stateMs,flags, at, seq]]}`
(30 Hz), `a{id,k,at,...}` (relayed), `hitr{a,v,m,i,k,at,t0,d,r,st,hs,p,kb,l,e,n,b,ko?,sq,hp,rw}` (`rw`: the victim's rewound position, drawn by F4; `ko`: the lethal hit,
a knockback the victim stays down from, `e` = land + KO_HOLD), `hitx{v,i,k,why}` (rejected, to the attacker), `deny{k,...}`, `kill{k,v,as,m,live,rs,st}`,
`spawn{id,p,yaw,seq,hp,prot}`, `match{ph,end,n,dur}`, `sb{ps:[[id,k,d,a,score,ping,alive,slot]]}`, `results{ps,win,mvp,n}`, `gauge{u,sp}` (to the owner: ultimate gauge,
substitution pips), `pong{c,s}`, `full`. `info` (players in welcome/join): `{id,name,ch,slot,s,at,hp,alive,seq,dummy}`; the dummy has id 0.
  **seq rule:** every server-authoritative teleport (spawn, hit reaction, substitution, tech roll) bumps the fighter's `seq`; the server drops states whose `n` differs (a
stale state can't drag a fighter back). Clients adopt the new seq from `spawn.seq`, `hitr.sq`, `a{k:sub}.sq`. Remotes interpolate on `at` (the server's receive time of
each state) `net.interp` ms behind the synced clock.
- **Settings** persist in localStorage under `shinobi.*`; the reconnect token is `shinobi.token` in sessionStorage.

## Where to change what (start here)

- **Balance / move feel** (damage, frame data, hitboxes, speeds, jump heights, cooldowns, chakra): `src/shared/naruto.js` only (shared with the server: restart it); check
  a changed hitbox with F4. **Combat rules** (damage scaling, juggles, guard, knockback): `src/shared/combat.js`; hit validation `server/combat.js`. **Netcode**:
  `src/game/net.js`, `src/game/remote.js`, `server/index.js`; run `mp.mjs` + `mpcombat.mjs` at 0 ms and 200,40,1 after.
- **Movement** (states, wall run, dash, mantle): `src/game/controller.js` + `src/shared/physics.js`; run `mapwalk.mjs` after any change (falls, traps, reachability).
  **Animation**: legs/locomotion `src/char/gait.js`; keyed combat/jutsu poses `src/char/moves.js` (+ keyframes.js); blending/layers `src/char/animator.js`; run
  `animcheck.mjs` after (foot sliding, pops) and look at a `film.mjs` strip. **M1 strings**: naruto.js `light` picks U1-U5 (standing) / S1-S5 (>= 5 m/s or dash; L1-L5 =
  the clones'); AttackAction step/leap/air/dive + counted presses; clips `u_*`/`r_*` (moves.js); effects MOVE_FX (movefx.js); scroll hitbox = `grip` box (hurtbox.js
  gripSegment = the prop). After: clipflips-live, animcheck (light + moving combo), mpcombat, m1trace `run` at 200,40,1.
- **Jutsu** (projectiles, clones, effects): `src/game/jutsu.js`, shaders `src/gfx/jutsufx.js`, data in naruto.js. Aimed casts (clones, shuriken, Rasenshuriken) pick their
  target with `Combat.aimTarget` (lock-on, else the enemy nearest the camera's centre within ~32 degrees). Clones move with `stepBody` (`Jutsu.stepClone`); run
  `kovis.mjs` and `scripts/debug/clones.mjs` after changing them.
- **Graphics**: post (outline, bloom, grade) `src/gfx/post.js`; toon shading `src/gfx/toon.js`; sky/sun/fog `src/world/sky.js`; presets `Game.setPreset` in `src/main.js`;
  run `perf.mjs` after (budget: 6 fighters, High). **UI / HUD**: `src/ui/hud.js` + `hud.css`; boot screen inline in `index.html`.
- **Map**: layout + colliders `src/shared/map.js` (deterministic, hashes must match); art `src/world/*`; run `mapwalk.mjs` and `scripts/debug/embed.mjs` after. Nothing
  drawn may stand outside its collider where a fighter or the camera can reach it (tree art follows `treeRadius`; bark dents and buttress gaps only go inward); leaves
  have no collider (they fade near the camera: toon `near`). Trees: trunk cone + root-flare cone (`wallTop` hands a wall run on to the trunk) + a crown platform on the
  canopy; branches: two sloped boxes each, aimed clear of other trees/walls/the edge. Stairs: one ramp collider under the drawn steps (gotcha 38).
- **Camera zoom** (mouse wheel, not locked on): `ThirdPersonCamera` in `src/game/camera.js` (`ZOOM_NEAR` = arm fully in, metres; `ZOOM_STEP` per notch; `ZOOM_TIME`
  smoothing). A dolly, not an FOV change (the owner rejected FOV zoom): `cam.zf` scales the arm from the shoulder pivot; fully out = the normal 3.3 m arm; FOV stays the
  settings value (`baseFov` + sprint/dash kick). `cam.arm` (collision) stays in unzoomed metres, so zooming out with nothing behind follows the wheel while a wall still
  snaps the camera in. Focus stiffness scales by 1/zf (same on-screen lag when close). Wheel deltas become notches in input.js (`takeZoom`); `takeWheel` (sign only) stays
  for lock-on switching. Run `scripts/test/zoom.mjs` after.
- **The owner's Naruto model**: `public/assets/characters/naruto.vrm` (path = `model` in naruto.js); until then `main.js` falls back to `standin.vrm` (the one console 404
  is expected). Moves are baked for the loaded model's proportions (bakeMoves): no data changes; re-run `animcheck.mjs`, check hitboxes (F4). Mixamo clips: `mixamo/*.fbx`
  -> `npm run anims` (names in ASSETS.md).
- **Another character**: add it to `CHARACTERS` in `src/shared/characters.js` (a data file like naruto.js, or `{ ...NARUTO, id, name, model, card }` for the same fighter
  in another body). main.js loads every model (`game.chars`: id -> { C, model, lib, standin }; `game.charModel(ch)`), bakes keyed moves per body, warms instances + clone
  pools per character, compiles all in warmShaders, renders a title card each. A model that fails to load makes its character unpickable (others who picked it draw as the
  default). Unrigged model: `node scripts/debug/glbinfo.mjs <file.glb> islands` (credits, triangles, pieces), then `npm run rig` with a config like
  `models/naruto_sage.rig.json` (T-pose) or `models/obito.rig.json` (A-pose: `apose` first, then `TPOSE=out.glb npm run rig -- <cfg>` and measure the rest on the lifted
  mesh), scale to hips 0.908 m (other proportions: a compromise between hips, shoulders and head, like Madara's 1.12: hips 0.858, shoulders 1.255, head 1.421 vs the
  stand-in's 0.908 / 1.274 / 1.386), long hair/ribbons as `chains` (`front` keeps bangs on the head), armour tassets over a coat as `plates`, collars etc. as `rigid`;
  check with `scripts/debug/modelview.mjs` (bones, `weights=<bone>`, `pose=run|kick|crouch|arms|punch`) and in game (film, animcheck / mpcombat / kovis / chars / perf
  with `CH=<id>`, F4). After any rig.mjs change, rebuild Sage from a scratch copy of its config and `cmp` it (must stay byte-identical).
- **Title screen** (name field, character cards, number keys 1-9/arrows, Enter in the field joins; 3+ characters: one row of up to 4 compact cards, a wider panel and a
  smaller logo via `.many` + `--cols`): `Game.buildTitleSide`, `pickChar`, `titlePick` in main.js; markup in index.html; saved as `shinobi.name` / `shinobi.char`; URL
  `?name=` and `?ch=` override (tests).

## Hard-won gotchas

Details of each (what broke, numbers, the fix) are in docs/gotchas.md, imported here so every session loads them; add new ones there, numbered. Index: 1. Standing height
includes the hip-joint drop | 2. Run/sprint (8, 12 m/s) far exceed mocap run clips (~4.5 m/s) | 3. The VRM object has no userData | 4. Remote interpolation delay | 5.
Anti-teleport clamp vs resyncs | 6. Clock sync under simulated lag | 7. Google Fonts CJK families come in ~120 unnamed chunks | 8. The lag simulator keeps order with one
queue per line | 9. Hit detection samples the move's own clip, not the drawn frames | 10. Hitbox bones must match the animation | 11. Substitution vs hits on the wire |
12. A late confirmation must not replace a newer prediction | 13. Controller.reset() ends the current action | 14. Constructor names are minified in builds | 15. Clones
and projectiles send their own position | 16. ShadowCache.blit() must restore the renderer's target | 17. Shader programs are keyed by output colour space and lights |
18. Six fighters were CPU-bound in the render submission | 19. Fighter world matrices are computed once per frame | 20. The laptop's CPU speed swings ~2x between runs |
21. Branches are overhangs, not walls | 22. Tints multiply in linear space | 23. Flat planes edge-on become lines | 24. Two-bone IK turns both bones about one hinge axis
| 25. The sim runs at 60 Hz, drawing at 144 | 26. Gait restarts must be continuous | 27. A dead fighter's action must keep stepping | 28. The server relayed the clones'
cast origin only with 3 numbers | 29. Easing into a late reaction starts from the drawn position and aims at the flight's present point | 30. Every fighter draws with its
own character's model AND clip library | 31. Auto-rigging a low-poly model | 32. Two test clients in one browser share localStorage and get throttled in the background |
33. Ripped game meshes (Sketchfab "Free Fire", node names `*.rip`) wind ~half their triangles backwards | 34. Keyed hand targets are placed relative to the shoulders |
35. A-pose lift past the elbow | 36. A swinging foot must not follow the raw velocity direction | 37. A vault's landing must have room | 38. Only a ledge is a step up |
39. Falling, land on anything within a step above the feet | 40. Cones and wall runs | 41. Keys (or blends into them) ~180 degrees apart flip | 42. Effects warmed in
warmShaders are moved to the spawn point | 43. Slow motion breaks server validation | 44. The chain buffer counts presses.

@docs/gotchas.md

## The VPS (production, set up 2026-09-28)

- **Live:** **https://shinobi.185-2-49-69.sslip.io** (also http://185.2.49.69:3100). Shulker VPS `games-1`: Eco series (old Intel Xeon V3/V4), 4 vCPU / 8 GB / 50 GB NVMe,
  monthly ~$5.15 (~Rs 484), Ubuntu 24.04, location in1; the VM is in Dadri (Delhi NCR) on a private NIC (enp0s3 10.77.0.18/16, gateway 10.77.0.1, outbound NAT IP
  45.122.121.132); the public IP came from "Attach IP" in the panel. It will host all the owner's games: ARMORY next (port 3000, `armory.185-2-49-69.sslip.io`; its dist
  is ~205 MB and it runs bots on the server), then 3200...: one Caddy block per game, by subdomain (not by path: the games load `/ws`, `/assets`, `/api` from the root).
  Both games read `PORT` and open the WebSocket on `location.host`: no code changes.
- **Access:** `ssh root@185.2.49.69` with the owner's laptop key (`~/.ssh/id_ed25519`, made 2026-09-28, no passphrase; to be backed up). Password login is off
  (`/etc/ssh/sshd_config.d/00-hardening.conf`: keys only, root by key). The root password (Shulker panel, Access) works only on the VNC console `in-1.shulker.in:5939`
  (RFB 3.8, no VNC password: security None); the owner was told to change it (it was pasted in chat). `scripts/debug/vnc.mjs` drives the console (type + screenshot) when
  SSH is lost.
- **Setup:** Node 24 (NodeSource) + pm2 7 as user `kaustab` (`/home/kaustab/games/ecosystem.config.cjs`: shinobi, PORT 3100; `pm2 startup` = starts on boot; logs `su -
  kaustab -c "pm2 logs shinobi"`), the game in `/home/kaustab/games/shinobi`; ufw allows 22, 80, 443, 3100 (close 3100 once nobody uses the raw link). HTTPS: Caddy 2.6.2
  (Ubuntu package; `/etc/caddy/Caddyfile`, one block per game `<name>.185-2-49-69.sslip.io { reverse_proxy 127.0.0.1:<port> }`, `systemctl reload caddy`; Let's Encrypt
  automatic; no measurable latency).
- **Deploy:** `npm run deploy` (scripts/tools/deploy.mjs; `DEPLOY_HOST=root@<ip>` for another box): packs with Windows' bsdtar (Git Bash's GNU tar reads "C:" as a remote
  host) minus node_modules/mixamo/dist*/shots/models, scp, wipes the old tree except node_modules, npm install, build, `pm2 restart shinobi`. The restart kicks everyone
  (deploy when nobody plays); the live copy changes only on deploy. Check: `node scripts/test/mp.mjs https://shinobi.185-2-49-69.sslip.io/` (PASS over the internet, RTT
  ~87 ms; it joins the live arena: players online see the bots Alpha/Bravo).
- **Domain:** sslip.io (free, no account) resolves any name containing the IP; if the IP changes, so do the names (update the Caddyfile, deploy.mjs's HOST and printed
  link, README, this file). A nicer free name needs the owner's DuckDNS login (duckdns.org: pick a name, IP 185.2.49.69), then swap the name in the Caddyfile. DNS never
  affects ping (one lookup per page load).
- **The public IP is not on the NIC:** it sits on `lo` and arrives over a WireGuard tunnel (`sv-transit`, `/etc/wireguard/sv-transit.conf`, peer 148.113.16.59:51820;
  brought up at boot by Shulker, not the inactive wg-quick@ unit). Replies go back through it only thanks to the tunnel's PostUp rules: `fwmark 0x64/0xff lookup 100` (+
  mangle CONNMARK rules) and `from 185.2.49.69 lookup 100` (table 100 = `default dev sv-transit`). The first `apt upgrade` restarted systemd-networkd, which deletes rules
  it didn't create: SSH timed out (SYN in via sv-transit, SYN-ACK out via enp0s3) while ping still answered (not ufw). Fixed by
  `/etc/systemd/networkd.conf.d/10-keep-shulker-routes.conf` (`ManageForeignRoutingPolicyRules=no`, `ManageForeignRoutes=no`); survives reboots (tested twice).
  Unreachable after an update? Check `ip rule` first (VNC console).
- **Ping ~80 ms from the owner** (84 in game): all in India, but the IP is announced from OVH **Mumbai** (148.113.16.59, ~53 ms from the owner) and tunnelled ~27 ms on to
  Dadri; the datacentre directly is ~40 ms from the owner (the checkout's 13-16 ms wasn't measured from the owner's laptop). The owner is asking Shulker support for a
  public IP routed in Dadri (bridged) or port forwards for TCP 80/443 on a Dadri IP (would save ~35-40 ms); when it arrives, move the Caddy names, ufw and docs to it.

## Testing (headless Chrome on the real RTX 4050)

Build to dist-test first (`npm run build:test`), run a test server (see Commands), then (tools in scripts/test/ unless noted, e.g. `node scripts/test/mp.mjs
http://localhost:3101/`; look at every PNG you produce):
- `views.mjs <url> <prefix> '[["name","js",waitMs], ...]' [w h]`: one load, a screenshot per view. `film.mjs <url> <out.png> <setupJs> [frames] [everyMs] [cols] [w] [h]
  [stepJs]`: filmstrip contact sheet (animation review; `__game.timeScale = 0.25` slow motion, `__game.studio = {...}` camera).
- `mp.mjs <url>`: two clients, PASS/FAIL: see each other, remote path error vs the true path (net of the uplink), settle, jump replication, leave. At 0 ms (:3101) and
  200,40,1 (:3102), where the running-path median lands just over its 0.35 m limit ~1 run in 4 (TCP-like loss stalls): rerun before calling it a regression (a real one
  fails every run).
- `mpcombat.mjs <url>` (combat sync; :3104): two clients fight: 5-hit combo confirmed, HP agrees, knockback flight within 10 cm on both screens, substitution, KO + score
  + respawn. Needs `SHINOBI_HP=600 SHINOBI_MATCH=300,10,2`; at 0 ms and `SHINOBI_LAG=200,40,1`. `DETAIL=1` prints every flight frame off by > 3 cm; `CH=sage` fights as
  another character (its own rig/clips drive the hitboxes). The flight check only measures frames after the finisher (at 200 ms the victim's sim snaps into earlier
  reactions late, by design).
- `kovis.mjs <url> [shotsDir]`: the KO fall on the victim's own screen and the attacker's (thrown, then lying: hips < 0.5 m), paths agree within 25 cm after the ease-in,
  no pops (> 0.5 m in a frame) on the victim's screen; then Shadow Clone Rush cast just by looking at the victim (no lock-on): the target is the victim, who sees both
  clones run in, attack and hit. Same env as mpcombat, 0 ms and 200,40,1. `DETAIL=1`: frames around any step > 20 cm; `CH=<id>`: both clients as that character.
- `chars.mjs <url>`: A goes through the title screen (types "Nova", picks Sage Naruto by its number key, or `CH=<id>`'s card, Enter), B autojoins with no name:
  typed/fallback names, saved choices, each draws the other with the right model + clip library, B sees A's clones in A's body, a rename reaches the other screen.
- `perf.mjs <url> [bots=5] [secs=6]` (budget check): 1920x1080 vsync-off client + network bots (bots.mjs) at four spots; fps, 1% low, worst frame, CPU per frame and
  logic+anim JS, calls, triangles, programs vs the budget. Bots cycle through the roster (every model on screen); `BOT_CH=<id>` gives them one, `CH=<id>` the client. Run
  perf alone (another session's headless Chrome tests wreck the numbers: 88 ms spikes). `SHOTS=shots` saves a shot per spot; `W=/H=` viewport. The match starts (everyone
  respawns) when the bots join: teleport after that.
- `mapwalk.mjs [secsPerTarget] [--verbose]` (map walk + wall-run bot: falls, traps; Node only, no server): the real Controller + CollisionWorld in Node (60 Hz, ~0.2 s for
  30 sim minutes): every 10 m ground cell, every branch (via its trunk, chakra full), every rooftop. PASS = no falls through the world, nothing out of bounds, no trapped
  spots, never standing inside a collider, >= 90% of ground cells (tree crowns are targets too). `TRACE="tree 4 branch 0"` prints one attempt.
- `animcheck.mjs <url>` (foot sliding + pops over 12 movement/combat scenarios): real input, normal speed, on clear flat lanes (scripts/debug/lanes.mjs); per drawn frame:
  ankle drift of planted flat feet (< 2 cm) and pops (> 15 deg in one frame and >= 2.5x the rotation rate of the frames around it). `DETAIL=n`: the worst n events with
  the gait's feet state; `CH=sage` another character. `zoom.mjs <url> [shotsDir]`: wheel zoom (synthetic wheel events): limits (arm 3.3 m / 1 m), FOV never changes, a
  wall behind still limits the arm while zooming out, focus lag sprinting zoomed in, lock-on keeps the wheel, no overshoot; PASS/FAIL.
- `scripts/debug/prof.mjs <url> [bots] [secs]`: Chrome CPU profile, top self and inclusive times per frame; `CALLERS=fn` breaks one function down by caller (use the
  unminified 3103 build). `eval.mjs <url> "<js>"` (join, run an expression, print), `errs.mjs` (startup errors), `shoot.mjs` (one screenshot), `sheet.mjs` (contact sheet
  of PNGs), `crop.mjs` (zoom).

**Debug hooks** (`window.__game`, `window.__ready`, `window.__BI` bone indices): URL `?autojoin=1&name=X` joins without a click. `__game.teleport(x, z, yaw)`: the local
fighter on the ground there. `__game.hold(['up','jump'...])` holds input actions (`[]` releases). `__game.timeScale` (0 freezes). `__game.studio = { yaw, pitch, dist, h,
fov, abs }`: orbit camera around the local fighter (yaw 0 = in front, PI/2 = its left side; `null` = game camera). `__game.player.anim` (Animator): `.gait`, `.pose`,
`.debugPose = (pose, rig, view) => {}` (runs after the layers). `__game.ctrl` (Controller: body, st, chakra...), `__game.remotes` (Map id -> { fighter, motion, info, view
}), `__game.net` (rtt, interp, stats), `__game.world` (CollisionWorld), `__game.map`. F3: performance overlay. F4: hurtboxes (green), swept hitboxes (red), server-rewound
victims (yellow); `__game.debug` is the DebugDraw while on. F6: collider greybox over the art. `__game.autoPreset()`: what "Auto" means (perfcheck.js detectPreset:
software -> low, integrated -> medium, dedicated -> high, high-end desktop -> ultra). `__game.setPreset('low'|'medium'|'high'|'ultra')` (pixel ratio, sun shadow size,
grass density, bloom, SMAA quality; High/Ultra = native resolution), `__game.audio` (Audio), `__game.shadows` (ShadowCache), `LOD` in fighter.js.
## Style

Plain ES modules, no TypeScript, no framework. Two-space indent, single quotes, semicolons. Comments explain *why*, sparsely. Keep files small and organised by
responsibility.
