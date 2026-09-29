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
  lids as functions of x (`amLo`, `amUpO`; shut = the upper lid lying on the lower, opening lifts it); a lash line
  thick at the outer end flicking out past the corner; crease, brows, Itachi's tear-trough lines; the iris as the
  Sharingan (three tomoe on a ring, tails trailing the spin) crossfading to his Mangekyō from the pupil out behind a
  burning front, spin-blurred by sampling three angles; veins = thin ridges of warped noise grown in from the
  corners; blood = streams with a meandering centre line, a wider bead at the lid, a hanging drop at the head, a
  wet highlight down one side; hair strands as tapered bands (the nearest wins) with their offset shadows; skin in
  three cel tones + soft light added after banding (a banded gaussian read as a pasted oval). Written in display
  colours, converted with `pow(2.2)` at the end; it reads depth, so the pass runs it before tone mapping (gotcha 64):
  judge its colours in the game.
- **The camera on a painting:** `p = sq / zoom + pan` (a point of the painting at the screen's centre, magnified): the
  drive into the pupil centres it. The black flames burst from the pupil's screen position, a radial front with two
  noise octaves round the circle (seamless: noise sampled on the unit direction), then burn away in holes (fbm +
  distance from the centre, so the first hole opens on the victim) with a thin crimson-to-ember edge.
- Review: `scripts/debug/amashots.mjs` (both screens at the same timeline times; HOLD=1 for exact frames, gotcha 60).

## 6. HUD art and per-character themes (src/ui/)

- The HUD is DOM + inline SVG (crisp at any size). A character's `hud` field names a theme: `HUD.setKit` sets
  `#hud.t-<theme>` and fills placeholder slots (`#h-theme` behind the portrait and bar, `#h-eye` in the
  portrait, `#h-frame` the ring) from the theme's module (`uchiha.js`); hud.css overrides under the class.
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

## 7. Every visual must

- **Compile at load**: show one of it in `warmShaders` (the kit's `warm(on, p)`), hidden after; the tests compare
  `renderer.info.programs` before/after (no mid-fight compile).
- **Allocate nothing per frame**: pools, preallocated vectors/matrices, fixed-size buffers.
- **Be the same on every screen** when it's gameplay-visible: drive it from the clip time (`v.act`) or the server's
  message (hitr), never local randomness for anything that matters.
- **Cost nothing when idle**: `visible = false` / `instanceCount = 0` when unused; re-check `perf.mjs` after.
