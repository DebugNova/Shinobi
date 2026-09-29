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

## 6. Every visual must

- **Compile at load**: show one of it in `warmShaders` (the kit's `warm(on, p)`), hidden after; the tests compare
  `renderer.info.programs` before/after (no mid-fight compile).
- **Allocate nothing per frame**: pools, preallocated vectors/matrices, fixed-size buffers.
- **Be the same on every screen** when it's gameplay-visible: drive it from the clip time (`v.act`) or the server's
  message (hitr), never local randomness for anything that matters.
- **Cost nothing when idle**: `visible = false` / `instanceCount = 0` when unused; re-check `perf.mjs` after.
