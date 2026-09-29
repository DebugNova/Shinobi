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
45. **Server-applied hits are never predicted:** Madara's counter blow, its reflected shuriken and the meteor's impact
    are applied by the server (no client detects them), so the attacker's screen has no predicted burst: onHitr shows
    the feedback for our own `uchihaReturn:*` / `tengaiShinsei:*` hits. The other way round, a hit that the barrier
    will answer must not be predicted either: the attacker reads the remote's barrier window (`countering`, from the
    relayed n:0, or an attack of ours it already deflected: `ai`) and sends the hit without a flinch that the
    `hitx{why:counter}` would undo. The counter's n:1 is
    the server's own message, broadcast to everyone including the owner (main.js remoteAction routes our own id to
    `madara.onOwn`); a client-sent n:1 for it is dropped.
46. **pickLock may pick the training dummy:** it scores every target in view, and the dummy stands near the field's
    test spots (the meteor landed 5.6 m from Madara, on the dummy, instead of on B 20 m away). Tests that need one
    victim lock onto it by id (`lockTarget = { id, x, y, z, dead: false }`).
47. **One long frame in a headless vsync-off run is not a hitch to chase:** during a meteor, one 50-145 ms frame
    showed up in both the old and new builds; a trace put it outside the game's JS (the main thread waiting on the
    GPU process, once rasterizing DOM), and with the HUD hidden there were more, 91 ms with nothing on screen.
    Compare averages and 1% lows back to back (gotcha 20). Chrome traces: the `v8` category makes them > 512 MB
    (too big for one string: stream-parse them); `toplevel` + `gpu` + `disabled-by-default-v8.gc` is enough.
48. **A barrier must not raise the invuln flag:** Madara's wind barrier is total cover, but `FLAG.invuln` in his
    states makes attackers' screens skip him entirely (hit detection and projectiles ignore invulnerable targets), so
    nothing would reach the server to be blown back or reflected. The server answers inside the window instead
    (counterFor) and every client-side check stays off. Its answers are not one-shot: every hit inside the window, and
    every later hit of an attack it answered (`deflected`, 3 s: a Rasenshuriken's burst ticks, a torrent's last
    tick and its burning field) is refused, or the barrier would "run out" on a multi-hit attack.
49. **A display figure has no body under its clothes; one piece per material costs a draw each:** the Itachi
    download is a head, a closed cloak (its sleeves fused into its sides, the arms hanging inside, not modelled) and
    the shins: no arms, hands, torso or thighs. Render it without the outer garment first (modelview on a stripped
    copy) and list its islands (glbinfo). rig.mjs then generates the missing limbs (`parts`: tubes, with fingers the
    finger search finds), flattens the fused sleeves (`reshape`), keeps the garment off the arm bones (`islands.noArm`:
    modelled for arms down, it would fold into the body whenever the arms hang), and splits the coat sharply at its
    front slit (`skirtSplit` 0.03, `skirtMax` 0.75) so the panels part over a striding thigh instead of the thigh
    piercing the cloth (trousers near-black so what still pokes through reads as cloak). The source had 25 materials
    and 28 primitives (46k triangles, 16k of them a necklace hidden in the collar): `drop` + `simplify` + `atlas` (flat
    colours as palette cells in the texture's empty space) made it 1 material, 1 primitive, 24k triangles.
50. **Post effects see linear light:** the stack runs before the output's sRGB encode, so a luminance threshold written
    for what you see (0.1-0.6) puts sunlit grass (~0.1 linear) in the shadows: Tsukuyomi's red world came out dark
    green. Judge light and shade by `pow(luminance, 1/2.2)` inside an Effect.
51. **Test lanes need line of sight, not just flat ground:** the training field's posts (x -30, z 36: 1.7 m tall)
    and a 2.6 m wall at (-38, 48) stood between the test fighters: the fireballs rightly burst on them, the gaze was
    rightly refused ("spared: cover") and a victim teleported onto the post stood 1.7 m up (a punch went under it).
    Check a lane with `node scripts/debug/los.mjs x0 h0 z0 x1 h1 z1` (the first collider in the way); Itachi's
    tests use x -44, z 58 -> 30. A laggy test samples the relayed result when it has arrived (wait for it: a round
    trip plus jitter, a lost segment one more), never at a fixed delay.
52. **A keyed hand target is the wrist:** fingers pointing up from a wrist placed at eye height end ~20 cm above the
    head (Amaterasu's two fingers "at the eye" were over his hair). Put the wrist a hand's length below where the
    fingertips go (at the chin for the eye).
53. **Spring collider matrices are refreshed in the scene pass:** three-vrm updates a collider's `colliderMatrix`
    (world matrix + shape offset) only in `updateWorldMatrix`, which `updateMatrixWorld` (the pass Fighter.updateVRM
    runs before the springs) never calls, so hair collided with where the body was a frame or more ago (8 cm behind
    a running fighter). vrm.js patches `VRMSpringBoneCollider.prototype.updateMatrixWorld` to refresh it; a collider
    added at runtime (the gunbai's plane) needs nothing more than a parent in the fighter's tree.
54. **A prop resting on spiky spring hair:** holding the joints a fixed distance off the prop still let spike tips
    through (the mane stands 11 cm behind its joints at the shoulders, 3 cm at its tail, and the hips' collider leaves
    the tail no room): lean the collider plane against the prop (deep where the hair is thick). Vertices driven by the
    head (the hair's root at the nape) can't be moved by any collider: keep the prop clear of where the head goes in
    the run pose (it tips back toward a chest-mounted prop). Count, don't eyeball: `scripts/debug/gunbaicheck.mjs
    poke`. Keyed hands holding a prop are solved, not guessed (gunbaisolve.mjs: the wrist Euler for a wanted prop
    orientation on the real rig, and the target move that closes the fist on the handle); a straight arm overhead
    can't hold a fan upright with a natural wrist (the solver said [-39, -76, 101] degrees).
55. **A post effect that mixes channels must guard against NaN:** the colour grade's saturation boost can push a
    saturated colour's weakest channel below 0, and the sRGB transfer wrapped round the contrast effect turns it into
    NaN. Invisible while each channel passes through on its own (it was ~0 anyway), but Tsukuyomi's negative world
    computes luminance from all three: sunlit grass came out bright yellow, Itachi's clouds stayed red. The
    GenjutsuEffect zeroes any channel that isn't `>= 0.0` first (a NaN fails every comparison). Found by forcing the
    grade on a plain scene (`G.apply` wrapped to set `neg = 1`): test a new grade on the arena, not only on its stage.
56. **Something drawn to survive the negative must be written as its perceived negative:** the victim's post flips
    perceived lightness (luminance^(1/2.2)), so steel written as `1 - c` in linear light came back dark red-brown.
    tsukuyomifx.js `negSelf(c, neg)` flips in perceived space (`pow(1 - pow(c, 1/2.2), 2.2)`) and follows the post's
    own `neg` exactly; the sky and ground write their final darkness directly (luminance = 1 - n on the ramp). The
    effect also blends with `BlendFunction.SRC`: blended by the buffer's alpha, see-through hair and cloth kept part of
    their own colour (pink edges on Itachi).
57. **Effects thrown back from a third-person fighter fly into the camera:** "behind him" is where the camera is. Itachi's
    dash crows, burst away from the way he went, filled the view (a crow 1 m from the lens is a third of the screen), and
    the ink puffs flung back became big dark blots. Crows go out to the sides and up, `flyOff` removes the camera-ward
    part of any crow's velocity, and the crow shader shrinks every crow within 3 m of the camera. Review an effect from
    the player's own camera (studio yaw PI), not only from the side. Related: a strip widened toward the camera about
    its path needs a stable sign for its lean (from the path's right side: s.y is ~0 seen from behind and flickered),
    and an effect's timeline belongs on the frame clock, not the server's (in slow motion the escape's ink comet,
    timed on the server clock, was over before the crows had left).
58. **Don't draw over what the model already paints, and check a ripped model's colours in the game's light:** Itachi's
    idle Sharingan billboards (EyeMarks at glow 0.25, always on) sat over the model's own painted Sharingan and read
    as translucent eyeballs bulging off his face; they now show only while the Mangekyō blazes. His source skin
    (#9e8878, fine on a grey modelview background) came out dark brown under the toon bands and the grade: repaint it
    in the rig config (`colors`) and judge it in an in-game close-up next to the others. The shade colour counts as
    much as the base: MToon multiplies the shaded side by `shadeColorFactor` ([0.78, 0.62, 0.66] by default: brown on
    skin), and a face under hair and a high collar is mostly shade (Itachi: #eed0b8 too dark, #fde9da + [0.9, 0.8, 0.82] too fair, #f5d9c3 +
    [0.86, 0.74, 0.76] right).
59. **Lock-on must not change how a fighter moves:** it strafed (body held facing the target, legs sidestepping or
    backpedalling, 15% / 30% slower, and the sprint timer blocked), so moving left/right while locked on read as a
    walk next to the free ninja sprint (the owner: "walks like a stupid fellow"). It also hid a bug: a dash's carry into
    the sprint (`runT = sprintAfter`) was reset the next tick while locked. Now Controller.stepMove runs, sprints,
    faces and dashes the same locked or not; the lock only turns a fighter standing still (no input, skid over,
    < 3 m/s) toward the target, and the camera, attacks, guard and aimed jutsu use it as before. Check with animcheck's
    "lock-on run + sprint" scenario and a filmstrip from the game camera (the case the owner showed).
60. **Screenshots of a real-time cinematic land late; review looks with its clock held:** a headless screenshot with
    two browsers on one GPU takes ~150 ms, so a dense list of shots drifted 0.2-0.5 s behind their labels (a "leak"
    through Amaterasu's black cover chased for a while was just the burn-away's first hole, filmed late). Look at
    frames with the clock held (`scripts/debug/amashots.mjs` HOLD=1: `cine.hold`), and prove timing with per-frame
    samples inside the pages (itachi.mjs `amaterasu` records every drawn frame: the same frame on both screens to
    0 ms, the flames 4372 ms after the press on both).
61. **A window that refuses hits must not drop ones already counted:** the server's cinematic window refused
    Amaterasu's first burn tick after burnStep had already taken it off the share (250 of 300 burnt). The window
    exempts its own cast entirely; other burns are paused (their next tick moved past the window, nothing counted).
62. **In a painted shader check every smoothstep's edges and every mask's side:** seven reversed edges (gotcha 42:
    undefined on ANGLE) and a "beside the nose" band written as two "left of" terms painted a dark rectangle across
    half the face. Find reversed edges with a scan (numeric first two arguments, a >= b) and write `1.0 -
    smoothstep(b, a, x)`.
63. **Headless vsync-off runs flood the GPU queue: judge hitches with vsync on:** Amaterasu's press showed a 1-2 s
    frame in 5 of 6 casts (the main thread in `CommandBufferProxyImpl::WaitForGetOffset`, inside the shadow pass);
    bisected through the cinematic, the effect, the clip, the gaze, the server and the HUD, none of them alone
    removed it, and with vsync on (as players run it) 0 of 6 casts had even a 100 ms frame, the whole cinematic
    locked at 144 fps. The page submits 300+ frames a second, and any extra GPU-process work (a DOM raster) waits
    behind them. `scripts/debug/amaspike.mjs` VSYNC=1 for hitches; vsync-off numbers only compare costs back to back.
64. **postprocessing's EffectPass sorts its effects by their attributes:** an effect that reads depth (the ink outline,
    Amaterasu's) runs before bloom, tone mapping and the grades whatever order the pass was given (the constructor's
    list is only the order among equals). Amaterasu's painting is therefore tone mapped (Neutral) and graded like
    the scene: judged as it looks in the game, not as written.
