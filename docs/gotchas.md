# SHINOBI ARENA: hard-won gotchas

Imported by CLAUDE.md (every Claude session loads it). One entry per lesson: the rule in bold, then what broke and the numbers. Keep the numbering (CLAUDE.md's
index and other notes refer to it).

1. **Standing height includes the hip-joint drop** (VRM hips bone ~8 cm above the thigh joints; hips at rest height bent every knee: a permanent crouch):
   `Gait.H0` = ankle height + leg length + hipDrop.
2. **Run/sprint (8, 12 m/s) far exceed mocap run clips (~4.5 m/s)** (2-3x playback = a frantic cadence), so legs are procedural (gait.js): stance feet
   integrated against the body's real velocity and yaw rate (zero sliding by construction), swing feet on a sprinter's loop (heel up behind, knee drive, reach,
   paw back). Stance ~0.6-0.7 leg lengths, duty factor derived from it (longer stances looked like lunges: both feet planted in a split).
3. **The VRM object has no userData** (not an Object3D): pool flags live on it (`vrm.taken`). 4. **Remote interpolation delay** follows the 80th percentile of
   snapshot ages within 70-120 ms (the 95th, under 1% TCP-like loss, went to ~280 ms: head-of-line stalls); later data is extrapolated (100 ms max);
   `RemoteMotion.smooth()` turns a correction into an offset decaying over ~80 ms (no snaps).
5. **Anti-teleport clamp vs resyncs:** after 10 consecutive rejections the server accepts and logs a resync (else a fighter is locked out forever after a stall:
   later states are compared with the stale position). 6. **Clock sync under simulated lag:** stamp the pong when the server handles the ping, then apply the
   simulated outbound delay (stamping at send time put the clock off by half the RTT).
7. **Google Fonts CJK families come in ~120 unnamed chunks:** fonts.mjs requests Dela Gothic One with `text=` (Latin only) and the Japanese signage font with
   `text=` of the map's characters.
8. **The lag simulator keeps order with one queue per line** (server/lag.js): one `setTimeout` per message reordered messages due at the same instant; a
   match-start `spawn` overtook `welcome`, the client kept a stale seq and all its states were dropped. Real WebSockets never reorder; a test tool that does
   produces bugs that don't exist.
9. **Hit detection samples the move's own clip, not the drawn frames** (Combat.hitboxAt; a 3-frame jab (50 ms) fell between drawn frames at low fps): every half
   frame of the active window since the last check is sampled from the clip (FK on the shared rig) and swept between samples; victims are their drawn hurtboxes.
10. **Hitbox bones must match the animation:** jab = lead (left) hand, cross = rear (right) (swapped data put the jab's hitbox in the right-hand guard). After
    changing a keyed clip, check with F4 or scripts/debug/jabdbg.mjs.
11. **Substitution vs hits on the wire:** at 200 ms the attacker's next hit can reach the server before the victim's dash: the server applies it (it happened
    first), then the substitution; the victim's client ignores the reaction of any hit timed before its own substitution (HP still drops; else it was yanked
    back to the old spot). The server checks every recent hitstun window (not only the latest) with 0.3 s grace; the victim's reaction always shows >= 0.25 s
    (at high ping a light hit's hitstun is mostly over before the victim hears of it).
12. **A late confirmation must not replace a newer prediction:** the attacker predicts hit 2 before hit 1's hitr arrives; that hitr is recorded, not applied (it
    would snap the victim back a hit). 13. **Controller.reset() ends the current action** (a teleport during a knockdown kept the old reaction driving). 14.
    **Constructor names are minified in builds:** compare actions by `netState` (or flags), never `constructor.name`.
15. **Clones and projectiles send their own position** (`hit.c`) so knockback pushes away from them; the server checks `c` is within reach of the caster and
    uses it for the direction and the victim's reach.
16. **ShadowCache.blit() must restore the renderer's target** (it binds framebuffers directly; with no moving caster drawn after the copy, e.g. the HUD
    portrait's scene or every caster off the map, the scene rendered into the canvas: an empty portrait, a wrong frame in play): it ends with
    `setRenderTarget(getRenderTarget(), ...)`. The cache owns the shadow maps: anything rendered before the first `shadows.arm()` samples maps that don't exist
    (GL_INVALID errors).
17. **Shader programs are keyed by output colour space and lights:** compile with `setRenderTarget(post.composer.inputBuffer)` (`compileAsync` with no target
    compiled an unused sRGB variant of every material). The HUD portrait uses the arena's lights (hemisphere + one shadowed directional + fog) or every fighter
    material compiles a second set. 77 -> 44 programs.
18. **Six fighters were CPU-bound in the render submission**, not the GPU (per-instance MToon materials: ~40 uniforms re-uploaded per draw). All instances draw
    with the first instance's materials (vrm.js); Fighter swaps whole material arrays for variants: no outline hull at LOD 1-2 and in the shadow map (hull =
    extra material in a geometry group: use the array without it), own clones for the hit flash. Never set `visible`/`emissive` on a shared material for one
    fighter. `CharacterModel.updateMaterials(dt)` runs MToon's per-frame uniform sync once per frame.
19. **Fighter world matrices are computed once per frame** in updateVRM (the springs need them); the root then skips the renderer's scene-wide pass once
    (`fighter.fresh`). three-vrm's node constraints only set quaternions: their targets (and bones under spring chains) get `updateMatrixWorld(true)` after the
    update. Anything moving a fighter's nodes after updateVRM must refresh them itself.
20. **The laptop's CPU speed swings ~2x between runs** (the same 6-fighter scene 95-215 fps, logic+anim time itself doubling): compare perf only within one run
    or back to back; perf.mjs reports logic+anim JS apart from the whole frame's CPU (which includes the WebGL submission).
21. **Branches are overhangs, not walls** (a trunk wall run under one stopped at it as a ceiling): `Controller.mantle()` vaults onto any overhang whose top is
    within 2.2 m of its underside with room to stand (landings searched outward and to the sides); mapwalk went from 9 to 59 of 59 branches.
22. **Tints multiply in linear space:** a material `color` of 0x7a7784 is ~0.19 linear (turned the memorial's stone nearly black): tint textured toon materials
    with light colours (>= 0xb0) or not at all. 23. **Flat planes edge-on become lines:** the forest light shafts are quads turning about their own axis to face
    the camera (nature.js buildShafts), all in one mesh.
24. **Two-bone IK turns both bones about one hinge axis** (normal of the limb line and the pole): deriving the upper bone's twist from "the bend side"
    orthogonalized against it flips 180 degrees once the joint folds past the upper bone being perpendicular to the limb line (shin longer than thigh + the
    sprint's heel kick: knee cap backwards half of every stride). rig.js also does soft IK (last 3% of reach approached exponentially) so knees never lock
    straight and snap back.
25. **The sim runs at 60 Hz, drawing at 144:** anything animation reads from the sim steps (speed +1 m/s per tick accelerating, vy flips on a double jump,
    timers). The gait's style follows a smoothed speed, the air pose a smoothed rise, timers get `alpha * SIM.dt` added (fillView), planted feet move against
    the fighter's drawn per-frame motion (Fighter.update gvf/gvl/gyr), not the sim's velocity.
26. **Gait restarts must be continuous:** a new phase must not jump the arm swing (phOff eases in), touch down a foot in the air (it becomes the swinging foot,
    from where it is) or start a foot mid-arc (late swings run from their lift-off point in the time left); a swing whose phase says "stance" because the duty
    grew (slowing) finishes on its own clock.
27. **A dead fighter's action must keep stepping** (Controller.step skipped `action.step` while `dead`: on the victim's OWN screen the killing reaction froze
    mid-flinch). The lethal hit is a KO knockback on every screen (shared `koHit`: the server decides from HP, the attacker predicts it the same way,
    `hitr.ko`); the dead controller steps the ReactAction with no input; a `kill` with no KO reaction on screen (e.g. the hit crossed a substitution) starts a
    collapse (`Combat.koCollapse`). A KO'd fighter can't be substituted, tech-rolled or hit again; a confirmed KO is never replaced by a later reaction.
28. **The server relayed the clones' cast origin only with 3 numbers** (clones send [x,y,z,yaw]: others got `a{k:jutsu,m:clones}` without `o` and never spawned
    them). When a jutsu shows only on the caster's screen, check payload shapes on both ends.
29. **Easing into a late reaction starts from the drawn position and aims at the flight's present point:** at 200 ms the victim hears of a launch ~0.1 s into
    its flight (`visOff` covering only the gap to the flight's start popped 0.4 m, and was doubled on the not-yet-moved body before the next sim step). onHitr
    puts the body on the flight at once, `visOff` = drawn - flight(now).
30. **Every fighter draws with its own character's model AND clip library:** keyed moves are baked per body (bakeMoves) and Combat.hitboxAt samples the
    attacker's own clip + rig: never hand a fighter another character's `lib` or `rig`. Give a VRM back to its model (remote entries keep `ch`; clones use
    `jutsu.clonePools.get(id)`).
31. **Auto-rigging a low-poly model:** k-means on finger vertices put the bands between fingers (z -0.033/-0.021/0/0.024 for fingers at
    -0.030/-0.011/0.011/0.031): give `fingerZ`, measured from the tips. A long coat must never follow the shins (it folds at the knees): `skirt` islands blend
    hips -> both thighs (skirtMax 0.6 of the thigh at the knee; 0.75 lifted it like a flap in kicks); the skirt path still applies the arm mask (sleeves); seam
    duplicates get identical weights (weights depend only on position and island). Config coordinates are the source's units (before `scale`, feet at the
    source's lowest vertex).
32. **Two test clients in one browser share localStorage and get throttled in the background** (B took A's saved character; A's jutsu never fired): multi-client
    tests launch one browser per client with anti-throttling flags (mp.mjs, chars.mjs).
33. **Ripped game meshes (Sketchfab "Free Fire", node names `*.rip`) wind ~half their triangles backwards**, hidden by double-sided drawing; one node was
    mirrored (scale -100). MToon's outline hull is drawn from back faces, so they showed the outline colour (dark maroon blotches, worst from behind and on
    clones). rig.mjs orients each triangle to its vertex normals (and undoes a mirror when a primitive has no normals); check the lit back view in modelview
    (fine from the front can still be wrong). Props floating near a hand (Obito's orbs) look like hand to the finger search and cover the face in guard: keep
    them out of the arm lift (`apose.keep`), pinned to the body.
34. **Keyed hand targets are placed relative to the shoulders**, not scaled by hipsY / 0.908 (Madara's short legs put his guard at the chest, the jab at the
    collar): buildPose (keyframes.js) puts them at the rest shoulder height (Rig.shoulderY) + the reference offset scaled by arm length (Rig.armLen / 0.4345);
    feet and the hips offset still scale with hipsY. Identical for the stand-in; Sage's hands sit ~2.7 cm lower (matching the reference look).
35. **A-pose lift past the elbow** uses the forearm's line (`underFore`): the armpit test against the upper arm's line only partly lifted the hanging hand and
    thumb (the glove bent down 17 cm). Put the A-pose elbow at ~52% of shoulder -> wrist (too far down made the forearm 30% shorter than the upper arm).
36. **A swinging foot must not follow the raw velocity direction:** its landing spot is `dir * D/2`; with `dir` the instant velocity, a bump mid-backpedal
    turned it in one frame and a late-swing foot jumped 16 cm (a 16-18 degree pop; only Madara, every run, from his stride phase). Swinging feet follow their
    landing spot over ~50 ms (Gait.follow) and touch down where it is.
37. **A vault's landing must have room:** up a gable end the vault landed on the wall's top, inside the roof's two solid slopes near the ridge, which pushOut
    can't resolve (each pushes into the other): stuck in the attic. Vaults and mantles land via `Controller.standAt` (on the roof itself, or no vault);
    `Controller.unbury` stands a body whose middle is inside a solid on its top (safety net). Check with `scripts/debug/embed.mjs` (`NOUNBURY=1` tests without
    the net).
38. **Only a ledge is a step up:** stepBody reported any slope's rise as `stepUp`, and the renderer smooths a step (pulls the drawn body down, eases it back): a
    sawtooth shake on every ramp, hill and roof. stepUp counts only a rise beyond what the ground's slope explains. Stairs: one ramp collider (a collider per
    step = a real 0.3 m step every half metre).
39. **Falling, land on anything within a step above the feet** (pushOut lets a falling body pass over tops within a step; a landing test looking only 2 cm up
    sank uphill jumps into roof slopes). 40. **Cones and wall runs:** pushOut holds a body off a cone at its widest radius along the body (the feet, for a root
    flare), so wall() measures a cone at the widest radius over the 0.9 m below its probe point (at the probe height alone a flare was out of reach: no wall run
    could start at a tree).
41. **Keys whose bone rotations are ~180 degrees apart flip, and so do blends into them:** nlerp takes the shortest arc,
    so when two orientations of a bone are near-opposite the output snaps to the other side in one frame (a 130-150 degree
    upper-arm snap in the Scroll Draw: the reach behind the hip had its elbow pole pointing forward, a half turn of twist
    from the guard, and the slide kick's arm it blends from). Point poles the way the joint really goes (behind the back:
    elbow back and out) and add an in-between key on long arcs. `scripts/debug/clipflips.mjs` (default rig) and
    `clipflips-live.mjs <url>` (every character's real rig) find flips inside clips; transitions show up in gameplay only
    (a one-frame spike 2.5x its neighbours on the local quaternions).
42. **Effects warmed in `warmShaders` are moved to the spawn point:** a mesh whose vertices are already in world space (the
    M1 trails) must reset its own position, or it draws offset by the spawn position (invisible, far off). Also: an
    impact burst's core was `smoothstep(0, 0.2 * (1 - age * 1.4), r)`, undefined once the edge went negative (age > 0.71):
    ANGLE filled the whole quad, a white square at the end of every hit. Never pass smoothstep edge1 <= edge0.
43. **Slow motion breaks server validation:** `__game.timeScale` stretches the client's moves, the server checks active
    windows on the real clock and rejects the hits (the victim's predicted reaction is undone). Review poses in slow motion
    (`m1film.mjs`), review combos and sync at real speed (`m1cast.mjs`: Chrome's screencast, two browsers).
44. **The chain buffer counts presses:** with one queued flag, presses faster than the moves' cancel frames were
    swallowed (5 presses 270 ms apart gave 4 hits of the Scroll Rush, whose moves take 300-370 ms to their cancel).
    `AttackAction.more` carries up to 2 extra presses into the next hit of the string.
