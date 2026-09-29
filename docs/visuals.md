# SHINOBI ARENA: how the animations and visuals are built

Imported by CLAUDE.md (every session loads it). The playbook for new moves, jutsu effects and screen effects: the
techniques that worked, where they live, how they were checked. **After every successful visual/animation change, add
what was new here** (a technique, a recipe, a number that mattered); the lessons from things that broke go to
docs/gotchas.md. Examples point at real code: copy them.

## 1. Working from the owner's reference shots

The owner sends Shinobi Striker screenshots and wants it "exactly like the images". Recipe (Tsukuyomi, 2026-09-29):
1. List each shot as a **phase**: what is on screen, whose screen (caster / victim / everyone), in what order.
2. Build **one timeline** that hits every phase (a `TSU`-style table of seconds: tsukuyomi.js), eased in and out
   (`ss(a, b, t)` smoothsteps; nothing pops).
3. Shoot **both screens at set times** (`scripts/debug/tsushots.mjs`: times after the event on each page's own clock,
   full size, one sheet per screen) and compare shot by shot. `duo.mjs` for a strip at any lag.
4. Fix, rebuild dist-test, reshoot. Look at every PNG.

## 2. Keyed animation (poses -> clips)

- Clips are pose specs in `src/char/*moves.js` (keyframes.js format): `[frame, spec, ease]` at 60 Hz, eases
  `lin/in/out/io/snap/hold`, `loop: true` for loops, `base:` for a clip's defaults (keys then only say what changes).
- Spec: `h` hips offset, `hips/spine/chest/upperChest/neck/head` Euler degrees (x bends forward, y twists left, z
  leans right), `lh/rh` hand targets (IK: **the target is the wrist**, gotcha 52; placed relative to the shoulders,
  gotcha 34; `pole` = where the elbow points, `open`/`fist`/`fingers` for hand signs), `lf/rf` ankle targets
  (`pitch` > 0 lifts the heel: toes down). Fighter frame: +z forward, +x HIS left.
- Every clip is baked per body at load (`bakeMoves`): tune on the stand-in, check on every character (`CH=`).
- Poses a gameplay state holds (a victim bound to a cross, someone watching) are just looping clips driven through a
  view's `act: { clip, t, key }`; the animator's `flinch` / `flinchDir` layer adds a jolt on top (stab reactions).
- **Locomotion is one procedural gait for every state, lock-on included** (gait.js: speed-driven cadence, stance,
  lift, the sprinter's swing loop, the ninja-run arm layer over 9 m/s). Locked on, the fighter faces its travel so
  the same run and sprint play; only standing still turns it to the target (idle corrective steps + the `stance`
  clip over the idle upper body, `v.combat`). The gait's strafe/backpedal legs (`legYaw`, `backW`) remain for
  velocity off the facing (turning into a run, slides) (gotcha 59).
- Checks: `clipflips(-live).mjs` (flips, gotcha 41), `animcheck.mjs` (sliding, pops), `film.mjs` / `m1film.mjs`
  strips (slow motion for looks only, gotcha 43).

## 2b. A character's own M1 strings (Itachi, 2026-09-30, from Shinobi Striker reference shots)

- **Data first** (src/shared/itachi.js ITACHI_MOVES): three strings picked by `light` (stand I1-I6, moving R1-R5,
  air IA1-IA5). Pace to be read: ~0.4 s contact to contact (startup 11-14, a wind-up key, the strike on `snap`, a held
  follow-through key, a settle). Every hit's stun must cover `cancel - startup + next.startup` frames with room after
  the combo's stun decay (4.5% a hit): stun 34-40 for gaps of 17-24.
- **Clips** (src/char/itachim1.js): same keyframes.js format. Spins with `rot` (limb targets turn with it); flips with
  `tilt` and the body-frame helpers (`flip()`: FF/FH); an airborne clip that lands spreads `AIRL` into its air keys
  instead of `base: AIRL` (its closing `{}` would keep the legs tucked on the ground).
- **Crow warp** (the reference's "teleport and continue"): a move's `warp` flies the body to a spot from the target's
  live position in a few frames (AttackAction.warpStep: weightless, at most 60 m/s, then held there until the strike);
  MOVE_FX `hide` hides it on every screen for those clip frames and itachi.js draws them as the crow shift (ink streak,
  a denser crow + feather burst for an M1 warp, ink re-forming at the end). The yaw snaps to face the target while hidden.
- **The kunai**: a prop like the scroll (movefx.js PROPS: pool, grip box = the hitbox, `glint` when it comes out or
  goes away, an `audio.kunai` scrape); geometry built in code (a 4-sided lathe flattened into a leaf blade, a paler
  copy slightly wider as the edge, a torus ring pommel, flat normals); the wrist turned so the blade leads (gotcha 69).
- **Impacts that sell the big hits**: `hit.fx: 'sphere'`: an additive fresnel shell (white rim, milky body) swelling
  0.3 -> 1.3 m in 0.32 s with white streaks flung out (the reference's launcher bubble), shown on the attacker's
  prediction, on third screens and on the victim's own screen. Dives: MOVE_FX `lines` (white streaks rising off the
  plunging body) and `slamKind: 'cloud'` (a dome of beige toon puffs billowing out and up, grit thrown low, two
  ground rings, a flash, the camera shaken up close).
- **Checking hits, in numbers**: `scripts/debug/hitreach.mjs` (every move's margin at its expected contact spot),
  `clipbones.mjs` (the solved wrists/ankles/hitbox per frame), `clipsheet.mjs` (the clip at exact frames on the real
  model with the hitbox and the dummy's hurtbox), then `scripts/test/itachicombo.mjs` at 0 and 200 ms (every hit
  confirmed, the distance at each first active frame, the warps' end spots).

## 3. Effect building blocks (all in src/gfx/)

- **Instanced quads, weights from JS, shapes in the shader**: SealFx (tsukuyomifx.js), EyeMarks (itachifx.js). One
  draw for every instance; per-instance attributes (position/size, a facing normal or 0 = face the camera, layer
  weights, age, spin); the fragment shader composites layers back to front (`over()`, premultiplied alpha). JS decides
  *when* (weights by time), GLSL decides *what it looks like*. A camera-facing quad wrapping a body is pulled toward
  the camera (`pull`) so the body doesn't cut it.
- **Procedural shapes in GLSL**: polar coordinates (`r`, `a`), seamless noise round a circle (`sCirc`), sickle blades
  (`sSickles`: profile + curve along the radius), ragged brush rings, thorns (`pow(sin(a * k), n)`). The Mangekyō
  (`SEAL_GLSL`) is shared by the in-world seals and the full-screen post effect.
- **GPU-animated particles**: spawn once, the vertex shader animates the whole life from `t0` (fx.js, Ink, Feathers);
  no CPU per particle. Ring buffers of fixed size; `dirty` ranges uploaded once per frame.
- **Instanced meshes with their own tiny shader** (Swords, Crows): geometry built in code (lofted rings: katana
  blade/guard/grip), flat normals for facets, a `part` attribute picks the look, toon bands + a glint.
- **HDR colours (> 1) feed the bloom** (threshold 1.05): cores of fire, the red iris, flashes.
- **World materials** go through `toon()` (toon.js) so props match the arena (bands, hatching, fog, shadows); canvas
  textures painted in code (paint.js style), UVs in metres so nothing stretches.
- **Quality** scales counts by preset (`QUALITY` in itachi.js); `nearness()` scales shakes/grades by distance.

- **Brush-ink streaks along a path** (InkStrokes, itachifx.js: Itachi's dash, the escape's comet): a strand is a
  list of points (position, birth time, arc length); JS lays a point every 0.12 m (the head point slides until then),
  the vertex shader widens the strip about the path toward the camera (`cross(tangent, cameraPosition - p)`, its sign
  from the path's right side, leaned toward the vertical: a standing smear from the side), the fragment shader draws
  the brush: bristle noise pinned to the arc length (fibres don't swim as the stroke grows), a ragged edge (two noise
  octaves), a round tip at the head, a tail thinning to a point, gaps opening between bristles toward the tail, at the
  edges and with age (`dry` threshold), colour purple-black to crimson at fringes/tail. Each point dries `life` s
  after it was laid; `release(S, fade)` finishes the rest within `fade` s by adding to the age (no pop). All strands
  in one dynamic buffer, one draw. A path flying on its own (the comet) is sub-stepped (every 0.5 m) on the frame clock.
- **Overlays on a face only when they add something:** a model that paints its own eyes needs no idle billboard over
  them (it reads as a glassy ball in front of the eye); bring one in only for a moment (the gazes' Mangekyō blaze).
  Skin tone is fixed at the source (rig config `colors`, sRGB hex -> linear baseColorFactor, before the atlas;
  a face in shade also needs a lighter `mtoon.shade`: Itachi #f5d9c3 + [0.86, 0.74, 0.76]), never with a runtime tint (gotcha 22, 18: shared materials).
- **Restraint**: match the reference's *amount*, not just its style. The first dash (four body-high strands, upright
  blots, ~25 ink puffs) read as "overexaggerated"; one slim streak + a thin flick was right. Film the case the owner
  showed (camera behind, sideways dash) before calling a look done.
- **Hide a body for a move from its drawn view** (`view.st`), not from the network event: the effect then starts and
  ends on the exact frames the body does, on every screen (itachi.mjs `shift` checks 0 mismatched frames).

## 4. Screen effects (post)

- One Effect in the post stack per job (GenjutsuEffect: `amt`, `eye`/`eyeS`/`eyeR`, `cover` wipe, `dim`, `mono`,
  `neg`, `flash`), set each frame by the kit, reset in `apply()`: nothing sticks if the kit stops calling.
- The stack is **linear light**: judge lightness by `pow(lum, 1/2.2)` (gotcha 50); guard NaN channels before mixing
  them (gotcha 55); an effect that replaces the image blends with `BlendFunction.SRC` (gotcha 56).
- A negative world: flip perceived luminance onto a colour ramp; objects that must keep their look write their own
  perceived negative (`negSelf`, gotcha 56); a sky/ground written for it outputs `1 - n` directly.
- Wipes: an eye scaling up (`eyeS`), its pupil growing into a black disc (`cover = [0, R]`), a hole opening in it
  (`cover = [R, big]`) with a red rim: hides any switch of scene underneath.

## 5. Cinematics on one screen (Tsukuyomi's world)

- **Build under the black**, where the player is: the stage is objects in the main scene (same lights, fog, shader
  programs: no recompiles), placed and turned to the best view (`viewScore`: line of sight, not in a wall).
- **Stand-ins, not the real fighters**: `Fighter`s built from the model pools (warm one spare instance per kit that
  needs it), posed by clips; the real fighters, rings, clones and the dummy are hidden in `late()` each frame.
- **Borrow and give back**: camera (after the game camera's update), fog (saved `fog0`), HUD (`hud.cinema`), the
  arena + sky dome (hidden only once the fog hides them; the shadow cache redrawn if invalidated meanwhile), the
  outline reach. `switchOff()`/`abort()` restore all of it; a respawn aborts. Tests check every item comes back.
- **Things stuck to a body ride its bone**: store `bone.matrixWorld^-1 * object` at impact, recompose each frame.

## 5b. A cinematic on every screen at once (Amaterasu, 2026-09-29)

- **One clock for everyone:** the timeline (`AMA`, src/game/amaterasu.js) is seconds since the press on the *server*
  clock (the cast's n:0 `at`, relayed to all). A screen that hears late joins where it is; the first 0.5 s is in the
  arena (the fingers to the eye) so nothing is missed. Poses follow the same clock (`r.act.sv`).
- **Decide early, show late:** whom it takes is decided at the pick (n:1, frame 12) and sent to every screen (`v`),
  and the flames' time `e` is fixed; each screen lights them itself at `e` (`latch`), the hitr only brings the damage.
  Checked: the flames 4372 ms after the press on both screens, the same frame.
- **Hold the arena still while nobody can see it:** input replaced by `FROZEN_INPUT`, hits not sent (combat.landHit),
  the server refuses hits in the window and pauses other burns (gotcha 61).
- **Shots:** (A) the negative world, camera low in front (the side picked by `viewScore`), push 2.75 -> 1.9 m, then a
  rush into the face with an accelerating ease (`k^2.4`) ending 0.34 m from the eyes; (B) the painted close-up;
  (C) back in colour on the victim (our own body if taken), from its side toward him. A hard cut home at the end:
  gliding from the victim to the game camera passed through its head. Cuts hide under flashes (cold white into the
  negative, blood red into the eyes) and the black flames.
- **The negative world** (amaterasufx.js): perceived lightness flipped, `pow(n, 1.7)` (the black cloak keeps its folds
  as greys, the bright world sinks), onto a teal ramp (ink / deep teal / steel / bone); past the subject's depth
  (`getViewZ`, `iso` = the camera's distance to him) the arena melts into two-level domain-warped smoke; ink specks
  drift (hashed cells); crows and feathers come out pale by themselves, white fx puffs turn into ink bursts.
- **A painted close-up in the shader** (no textures): eye-local coordinates mirrored so +x is always the outer corner;
  lids as functions of x (`amShut`, `amLoO`, `amUpO`, mixed by `open`: shut, both lids meet on a gentle arc low in
  the eye; opening lifts the upper lid most, `open` > 1 lifts it past the open shape: the Mangekyō's "snap wider");
  a lash line thick at the outer end flicking out past the corner; crease, brows, tear-trough lines; the iris as the
  Sharingan (three tomoe on a ring, tails trailing the spin) crossfading to his Mangekyō from the pupil out behind a
  burning front, spin-blurred by sampling three angles; veins = thin ridges of warped noise grown in from the
  corners; blood = streams with a meandering centre line, a wider bead at the lid, a hanging drop at the head, a
  wet highlight down one side; hair strands as tapered bands (the nearest wins) with their offset shadows; skin in
  three cel tones + soft light added after banding (a banded gaussian read as a pasted oval). Written in display
  colours, converted with `pow(2.2)` at the end; it reads depth, so the pass runs it before tone mapping (gotcha 64):
  judge its colours in the game.
- **A painted face must be the character's face** (the owner: "the face doesn't look like Itachi, the eyes open too
  little"; 2026-09-29): film the model's own face first (`__game.studio = { yaw: 0, dist: 0.45, h: 1.46, fov: 30 }`)
  and paint its identity markers, not a generic anime face. Itachi's: the forehead protector low over the brows (steel
  plate: a brushed gradient, a bevel line, rivets, the Leaf as an SDF (`amLeaf`: an Archimedean spiral, half the
  radius a turn, its tail and the stem's triangle as segments) with the missing-nin slash as a tapered groove whose
  lower lip catches the light); center-parted bangs framing the face with one thin strand across each eye's white
  (never over the iris); sharp brows, thick at the inner end pressed down toward the nose, tapering out; long
  straight tear-trough lines from below the inner corners down and outward; pale skin in his model's tones (#f5d9c3
  lit, its MToon shade), the scene's red added as light (from below, round the sockets), not as the skin's colour.
  Eyes wide as in the reference art: an almond ~0.45 as tall as wide, the outer corner higher than the inner (a
  fierce slant), the iris (r 0.42 of the half-width) fully inside with a sliver of white above and below. Blood that
  reads as blood: gravity-straight streams with a slow meander (a tight wobble read as a worm), the welling flare
  proportional to each stream's width (a fixed flare made thin drips into flat tabs), a band welling along the lower
  lid. Shading that would band into a stripe (the nose) goes on after the cel bands, soft. Check the frame at 16:9,
  21:9 (no letterbox: the plate's top edge shows) and 4:3.
- **The camera on a painting:** `p = sq / zoom + pan` (a point of the painting at the screen's centre, magnified): the
  drive into the pupil centres it. The black flames burst from the pupil's screen position, a radial front with two
  noise octaves round the circle (seamless: noise sampled on the unit direction), then burn away in holes (fbm +
  distance from the centre, so the first hole opens on the victim) with a thin crimson-to-ember edge.
- Review: `scripts/debug/amashots.mjs` (both screens at the same timeline times; HOLD=1 for exact frames, gotcha 60).
- **Sound on the same clock** (the voice line, 2026-09-29): pick the picture's moment (the lids fully open, 3.58-3.64)
  and the recording's (the word's stressed syllable, found by voicing: gotcha 67) and put one on the other: the
  stress, not the onset (the owner by ear: the onset on the full open (3.56) was late; then 3.16, 3.31, 3.26, 2.76, 1.76, 1.46; a re-cut file under the same name needs `cache: no-cache`, or the ear judges the old one); start the
  sound at the press so nothing is silent; trim the file so it starts where the scene wants it (`AMA.voice`) and
  bake the fades into it (the same on every screen, from any offset). Schedule it on the audio clock ahead of time
  (`AudioBufferSourceNode.start(when, offset)`), never by starting it on a frame; subtract `outputLatency` (~50 ms
  here), add a frame of display lag. Prove it with the scheduled times (amavoice.mjs), not by ear.

## 6. HUD art and per-character themes (src/ui/)

- The HUD is DOM + inline SVG (crisp at any size). A character's `hud` field names a theme: `HUD.setKit` sets
  `#hud.t-<theme>` and fills placeholder slots (`#h-theme` behind the portrait and bar, `#h-eye` in the
  portrait, `#h-frame` the ring) from the theme's module (`uchiha.js`, `madara.js`: hud.js THEMES); the layout/animation css is shared
  (`:is(.t-uchiha, .t-madara)`), a theme's colours are overrides after it.
- **Animated pieces are separate `<svg>` elements moved by CSS transform/opacity only** (the compositor runs
  them: no repaint, no main-thread work). The Sharingan is stacked layers: static iris, a tomoe layer spinning,
  the Mangekyō layer spinning the other way at opacity 0 (`.h-me.ult` crossfades), a static gloss on top.
  One-shot effects use Web Animations (`el.animate`: the cooldown pop and ring burst), never a class restart
  with a forced layout.
- **Flames in SVG**: generated paths from a seeded rng (same art every load). Streamers = a tapering band along
  the bar with saw-tooth licks (slow rise, sharp fall) leaning back along the wind, outlined with `smooth()`
  (quadratic curves through midpoints: no corners but the tips; polylines looked scratchy). Crown tongues =
  cubic curves off the circle, tips curled one way. Each layer draws the same path 4 times: two wide faint
  crimson strokes (glow without a filter), the rim stroke, the black fill on top (the rim shows only outside).
- **Icons** (100 box, clipped round by CSS): a painted background gradient, one clear silhouette, a lighting
  accent; small helpers generate repeated shapes (`comet`, `crow` mirrored from a half outline, `flameRow`).
  Gradient ids must be unique across the whole page (every inline SVG shares one id space).
- Rims: a conic-gradient `::before` ring behind the icon (`isolation: isolate` + z-index -1), a box-shadow
  hairline outside it, an inset-shadow + gloss `::after` over it; cooling icons get `saturate/brightness`.

- **A second theme reuses the generators** (Madara, src/ui/madara.js): export the flame builders (crown, streamer,
  shards, layer(cls, d, rim, glow, body)) and change colours and proportions (taller crown, thinner streamers), not the
  code. Rinnegan = concentric rings + ripple layers (a ring outline scaling 0.3 -> 3.7 while fading, two offset by half
  the period: CSS transform/opacity only); a second iris (the Rinne Sharingan) sits at opacity 0 and crossfades in with
  the nine tomoe (three per ring, radii from the ring table) on `.h-me.ult`. Lamellar armour bar = the ::after gradient
  stack: gloss, two cord lines, repeating vertical lacing every 5%. Icon recipes: a fire wall = 4 `flameRow` layers dark
  to light + a heat radial; stakes = a quadratic-curve outline + a shade half + grain lines + a pale cut tip (`stake()`);
  a meteor = a seeded bumpy `rock()` outline, clipped fissures and craters, a hot-face gradient rect clipped to the
  rock, a halo and a trail wedge; wind = a thin bright stroke over a wide faint one (`gust()`).
- **Review icons standalone** (render the SVG strings at 360 px in a page): in the game the cooldown sweep and the
  not-ready filter dim them (an empty ultimate gauge = a 72% black cover), which read as a muddy icon.

## 8. The map (Training Grounds art pass, 2026-09-30, from the owner's Shinobi Striker village shots)

The references: the Leaf village's tall multi-storey blocks, round towers, drainpipes, kanji sign boards, flat roofs,
grass patches in a dirt square, teal/blue/red roofs, cliffs and mountains beyond. What was built and how:

- **Beyond the rim (backdrop.js, drawn only, no colliders):** the heightfield outside the walls is shaped in map.js
  (visual only: nothing out there is reachable, the collider hash doesn't change): forested hills, ridged noise
  (`1 - |fbm|`, squared) for sharper northern peaks, and east of the village terraces (`CITY_Y`) for a town. The
  terrain turns to rock on steep ground (toon `rock` option: triplanar rock mixed in by the normal's y with a noisy
  edge, cooler than the cliffs; branched so flat ground pays nothing, gotcha 73). **Three mountain rings** (r 260 /
  380 / 520 m, one mesh): rows base / shoulder / crest round a circle, heights from ridged noise sampled on the unit
  circle (seamless), two toon bands of sun + vertical streaks, each ring hazed toward the horizon colour by distance
  and at its foot (valley mist); wound to face the centre (gotcha 74). **The hill forest**: instanced broadleaf crowns
  (a lumpy flattened icosahedron with sphere normals: one soft mass) and cedars (three stacked cones), placed on a
  jittered grid over the backdrop, thinning on steep ground and above the tree line, per-instance tints (a few
  autumn crowns). **The town**: rows of lots on the terraces, taller toward the back so the skyline rises over the 12-16
  m rim wall (shops with gable roofs, flat-roofed blocks with water tanks / stair huts / floor bands / pipes / sign
  boards, round towers with a cone roof or a tank), one great round hall (red drum, gallery bands, wide roof, a kanji
  plate facing the village), lanterns strung over its streets. Facades are one painted texture (`Paint.facade`: a 4 m
  bay by one storey: window in a timber frame, sill, glint, floor beam) mapped u = metres/4, v = metres/3.1 on every
  wall and tinted per building by vertex colour.
- **Cliffs (nature.js strataSide):** each visible side is a grid whose rows sit at the strata boundaries (the same
  world heights everywhere, 0.7-2.2 m apart, so bands run on from block to block), each boundary doubled 1 cm apart so
  every band steps out or in by its own amount: a lit ledge and a shadow line in the toon bands. Cracks = narrow
  grooves (three columns 7-12 cm apart, the middle one pushed in 12-24 cm, darkened). Vertex colours: the band's tint
  on a neutral grey rock texture (sand, pale, rust, grey), a darker foot, moss dripping from the top edge (ragged
  length per column), dark wet streaks; rock under a fall darker and bluer. Sides nobody can see are skipped (covered
  by the next block, buried in the plateau, the rim's outer face). On top: a grass sheet on the terrain's own heights
  (it meets the plateau with no step), and a fringe of random-length tufts hanging over every exposed edge (a regular
  sawtooth read as teeth). The east rim is the village wall instead: masonry (stone texture in metres), moss, coping.
- **The stream and its two falls (map.js STREAM/FALLS + water.js):** the stream's channel is carved into the ridge and
  the ledge (a flat 0.3 m bed, surface id water: you wade with ripples), the cliff blocks under each fall are split
  and cut down to the bed (same random draws: nothing else moves), so the water pours over a real lip. The river's
  water shader runs on the stream ribbons (Catmull-Rom path, merged into one mesh). A fall's curtain: rolls over the
  lip in the first 12% of its length, then falls on a throw curve (offset ~ sqrt(drop)), widening a little; two layers
  (back darker and slower) in one mesh (`aLayer`); the shader scrolls noise streaks on world x/y (the pattern never
  stretches), banded deep / mid / white, a bright glassy lip band, a churning white foot with a ragged top, ragged
  see-through sides. At the foot: foam rings spreading out broken by noise (a boil in the middle), mist puffs (GPU
  instanced billboards, each rising, drifting out, swelling and fading on its own cycle) and the old spray particles.
- **The village (village.js):** plaster tinted per house (six tints) and roofs in five colours (one neutral tile
  texture + vertex colours), a dark wainscot round the ground floor, shoji windows with sills and tiled lintels, flower
  boxes, side windows on the gable ends, balconies on tall houses, pent roofs over the back door, hanging and upright
  sign boards (atlas), noren curtains (atlas: four designs), drainpipes and meter boxes, onigawara end tiles and gable
  vents. New south-east street: flat-roofed blocks with walkable parapet roofs, a water tank and a stair hut (colliders
  in map.js), a round tower, two more houses. Stone-paved streets (`PAVED`: flagstones on a sheet 3.5 cm over the
  ground; the surface id is stone: footsteps). A big red torii at the gate from the bridge.
- **Props (props.js) and flora (flora.js):** barrels (lathe with hoops), stone lanterns (hexagonal parts, glowing paper
  windows), benches, a hand cart with sacks, a tea stall under a red parasol with dango, utility poles with insulators
  and sagging wires, nobori banners, stumps, straw training dummies, targets on stands, a weapons rack, log piles,
  bamboo clumps, boulders, a forest shrine with its own small torii, stone lanterns and shimenawa. Cherry trees: many
  small scalloped foliage clumps shaded as one soft mass (nature.js `foliage` with a blossom texture), a fallen-petal
  disc under each (a few big clumps read as pink boulders). Wildflower patches (tiny star flowers, a colour or two per
  patch), bushes at tree feet and along cliff feet, reeds along the river (the grass clumps stretched 3-5x).
- **Cost rules this pass learned (gotchas 72-74):** merge, don't split; flat colours as vertex colours; atlases for
  signs; one mesh per effect type; branch expensive shader work by what's on the pixel; A/B against a baseline build.
  Result: +2 draw calls, 1.40-1.47 M triangles (under 1.5 M), 88 programs (all compiled at load), fps within noise.

## 7. Every visual must

- **Compile at load**: show one of it in `warmShaders` (the kit's `warm(on, p)`), hidden after; the tests compare
  `renderer.info.programs` before/after (no mid-fight compile).
- **Allocate nothing per frame**: pools, preallocated vectors/matrices, fixed-size buffers.
- **Be the same on every screen** when it's gameplay-visible: drive it from the clip time (`v.act`) or the server's
  message (hitr), never local randomness for anything that matters.
- **Cost nothing when idle**: `visible = false` / `instanceCount = 0` when unused; re-check `perf.mjs` after.
