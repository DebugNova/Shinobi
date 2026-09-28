# Assets to prepare (owner checklist)

The game runs without any of these: it uses a stand-in avatar (pixiv's VRoid sample, licensed for any use) and
hand-keyed animations until your files arrive. Drop files in the places below, then tell Claude "assets are in"
(or run `npm run anims` yourself for the animations). Nothing else to configure.

---

## 1. Naruto in VRoid Studio -> `public/assets/characters/naruto.vrm`

VRoid Studio is free (Steam or vroid.com). Budget: ~1-2 hours.

1. **New model -> male base.** Body tab: height slider ~-0.3 (Naruto is short), head size +0.1, keep default proportions otherwise.
2. **Face:** eyes bright blue (#2E7CF6, pupil darker), slightly narrow/determined eye shape. **Whiskers:** Face ->
   Skin -> *Edit texture* -> new layer, draw **3 short dark lines on each cheek** (brush 3-4 px, colour #5a3a2a), then
   *Save*. Eyebrows: short, slightly angled.
3. **Hair (the important part):**
   - Hairstyle -> delete the preset groups -> *Create group* -> choose **"Guide"** (hand-drawn) mode.
   - In the guide view, drag the guide so strands radiate **outward and up** all around the head.
   - Draw **10-14 wide spikes**: 3-4 across the front fringe pointing forward/down over the forehead, 3 on each side
     sweeping out and back, 4-5 at the back pointing up/back. For each group: *Width* high, *Tip softness* ~0,
     *Tip shape* pointed, *Curl* off, *Thickness* medium, *Twist* a little for variety.
   - Colour: base **#F6C63A**, shade **#E08A1E** (warm orange shadow), highlight on.
   - Bones tab: add **swaying (spring) bones** to the back and side spike groups, stiffness medium-high (they should
     bounce, not flop).
4. **Forehead protector:** make it from hair, so it gets physics for free:
   - A new hair group (Manual mode) wrapped around the forehead as a **band** (one flat strand, width ~3 cm), colour
     **#1F3F8F** (blue cloth). Paint a **grey metal plate** on its front third in the hair texture editor (flat grey
     #9BA3AD with a darker scratched Leaf symbol if you like).
   - Two more strands from the back knot hanging to mid-back: the **tails**, same blue. Give them swaying bones.
5. **Outfit:**
   - Tops: the *Jacket / zip-up* type. Edit texture: body **orange #FF7A1A**, shoulders/upper back and sleeve tops
     **black #1E1E24**, a white collar lining, a red swirl on the back if you're feeling it.
   - Bottoms: long trousers, **orange** to match, cuffs wrapped in white/blue.
   - Shoes: short **blue sandals** (#2E4F9E) or low boots in that colour.
6. **Export** (top right -> Export -> VRM):
   - Format **VRM 1.0**.
   - *Reduce polygons*: aim for **40,000-60,000 triangles** (the export screen shows the count; lower hair
     cross-sections first).
   - *Texture atlas*: **2048**. *Reduce materials*: on. *Delete transparent meshes*: on.
   - Licence fields: allow violent usage = **yes** (it's a fighting game), avatar permission = only you.
   - Save as **`naruto.vrm`** into `public/assets/characters/`.

Never rip a model out of a commercial game (Shinobi Striker, Storm, etc.). VRoid-made is fine.

---

## 1b. Another character from a downloaded model (.glb)

A model with no skeleton (e.g. a Sketchfab download in T-pose, like `models/naruto_sage.glb`) can be rigged by the
game's tool: put the .glb in `models/`, copy `models/naruto_sage.rig.json` next to it (joint positions, finger
centres, coat/ribbon rules), run `npm run rig -- models/<name>.rig.json`, add the character to
`src/shared/characters.js`. Easiest: ask Claude to do it. Check the licence first (CC BY is fine: credit the author).
Prefer a VRoid/VRM model when you can: it comes with a face that blinks and higher-resolution textures.

---

## 2. Mixamo animations -> `mixamo/<name>.fbx`

Go to mixamo.com (free Adobe login). Keep the default **Y Bot** character selected for every download.

**Download settings for every clip:** Format **FBX Binary (.fbx)**, Skin **Without Skin**, Frames per second **30**,
Keyframe reduction **none**. Tick **In Place** whenever the clip offers it. Leave the other sliders at their defaults.

**Rename each file to the name in the first column** and put it in the `mixamo/` folder of this project.
If a search gives several results, pick the one that looks snappiest and most "athletic" (not tired or drunk).

### Must have (the game looks much better with these)

| Save as | Search Mixamo for | Notes |
|---|---|---|
| `fight_idle.fbx` | fighting idle | fists up, light bounce |
| `idle.fbx` | breathing idle | relaxed standing |
| `run.fbx` | running | **In Place** |
| `sprint.fbx` | fast run | **In Place** (becomes the ninja run) |
| `run_stop.fbx` | run to stop | the skid/stop |
| `strafe_l.fbx` | left strafe | **In Place**, running speed (not the walk) |
| `strafe_r.fbx` | right strafe | **In Place** |
| `run_back.fbx` | running backward | **In Place** |
| `jump.fbx` | jumping up | take-off and rise |
| `fall.fbx` | falling idle | looping fall |
| `land.fbx` | falling to landing | soft landing |
| `flip.fbx` | front flip | double jump |
| `jab.fbx` | lead jab | combo hit 1 |
| `cross.fbx` | cross punch | combo hit 2 |
| `knee.fbx` | knee | combo hit 3 (any quick knee strike) |
| `spin_kick.fbx` | spin kick (or hurricane kick) | combo hit 4 |
| `roundhouse.fbx` | roundhouse kick | combo finisher |
| `axe_kick.fbx` | axe kick (else "mma kick") | heavy attack, the strongest-looking kick |
| `block.fbx` | block idle (or "center block") | guard stance |
| `hit_head.fbx` | head hit | light flinch |
| `hit_body.fbx` | stomach hit | light flinch 2 |
| `knock_back.fbx` | flying back death | thrown back through the air |
| `knockdown.fbx` | knocked down | falls onto the back |
| `getup.fbx` | getting up | from lying on the back |
| `ko.fbx` | dying | KO |
| `throw.fbx` | throw | shuriken throw (a quick one-handed throw) |
| `charge.fbx` | power up | chakra charge |

### Nice to have

| Save as | Search Mixamo for | Notes |
|---|---|---|
| `walk.fbx` | walking | In Place |
| `run_start.fbx` | running start (or "start running") | |
| `turn180.fbx` | running turn 180 | quick 180 |
| `land_hard.fbx` | hard landing | big fall |
| `hook.fbx` | hook punch | |
| `uppercut.fbx` | uppercut | |
| `flying_kick.fbx` | flying kick | air/dash attack |
| `kunai.fbx` | stabbing (or "knife attack") | kunai strike |
| `block_hit.fbx` | block react (any block with an impact) | |
| `hit_left.fbx` / `hit_right.fbx` | hit reaction (side) | |
| `stagger.fbx` | big hit to head / stagger | heavy flinch |
| `kipup.fbx` | kip up | fast get-up |
| `roll.fbx` | sprinting forward roll | tech roll |
| `dodge_l.fbx` / `dodge_r.fbx` / `dodge_back.fbx` | dodging left / right / back | |
| `victory.fbx` | victory | results screen |
| `taunt.fbx` | taunt | |

Missing clips fall back to hand-keyed versions, so download in any order. Re-running `npm run anims` prints which
clips it found, their length, ground speed and gait phase.
