// The art pass of the Training Grounds: builds every visual of the map from its descriptors (src/shared/map.js),
// with one shared set of toon materials and procedurally painted textures, batched into a few dozen draw calls.
// Static meshes are merged per material (batch.js); lanterns and grass are instanced; the river, waterfall and
// light shafts animate in their shaders. Nothing here creates a collider.
import * as THREE from 'three';
import { Paint } from '../gfx/paint.js';
import { toon, TOON } from '../gfx/toon.js';
import { Batch } from './batch.js';
import { buildTerrain, buildGrass } from './terrain.js';
import { buildTrees, buildCliffs, buildRocks, buildLogs, buildFences, buildField, buildShafts, buildLeaves } from './nature.js';
import { buildVillage, buildLanterns, SIGN_TEXTS, NOREN } from './village.js';
import { buildProps } from './props.js';
import { buildFlora } from './flora.js';
import { buildRiver, buildBridge, waterMaterial } from './water.js';
import { SUN_DIR } from './sky.js';
import { buildMountains, buildBackdropForest, forestMeshes, buildTown } from './backdrop.js';

export async function buildArena(map, { grass = 26000 } = {}) {
  // the brush font for signs must be loaded before we paint them
  try {
    await Promise.all(['64px "Yuji Syuku"', '64px "Kaushan Script"'].map((f) => document.fonts.load(f)));
  } catch {}
  const P = {
    grass: Paint.grass(), dirt: Paint.dirt(), bark: Paint.bark(), rock: Paint.rock(), plaster: Paint.plaster(),
    timber: Paint.wood(6), woodLight: Paint.wood(16, true), tiles: Paint.tiles(7, 0xe2e2e2), facade: Paint.facade(),
    stone: Paint.stone(), leaves: Paint.leaves(), chain: Paint.chainlink(), shoji: Paint.shoji(), crate: Paint.crate(),
  };
  TOON.uHatch.value = Paint.hatch();
  const mat = {
    bark: toon({ map: P.bark, tri: 0.32, hatch: 0.95, vertexColors: true }), // vertex colours: moss, the darker foot
    leaves: toon({ map: P.leaves, tri: 0.2, hatch: 0.35, vertexColors: true, near: true }), // vertex colours: canopy occlusion, tint
    rock: toon({ map: P.rock, tri: 0.16, hatch: 0.85, vertexColors: true }), // vertex colours: strata, moss, stains
    grassCap: toon({ map: P.grass, tri: 0.16, hatch: 0.5, side: THREE.DoubleSide }), // the terrain's grass exactly (seamless); fringes are single planes
    woodCut: toon({ color: 0xd9b07c, hatch: 0.3 }),
    chain: toon({ map: P.chain, alphaTest: 0.5, side: THREE.DoubleSide, hatch: 0.2, fade: false }),
    rust: toon({ color: 0x7a4a30, hatch: 0.6 }),
    woodLight: toon({ map: P.woodLight, tri: 0.55, hatch: 0.6 }),
    rope: toon({ color: 0xd9c9a0, hatch: 0.3 }),
    memorial: toon({ map: P.stone, tri: 0.35, color: 0xb9b6c8, hatch: 0.7 }), // dark stone, but not a hole (the tint multiplies in linear space)
    stone: toon({ map: P.stone, tri: 0.45, hatch: 0.7 }),
    stoneWall: toon({ map: P.stone, tri: 0.35, hatch: 0.8, vertexColors: true }),
    target: toon({ map: Paint.target(), hatch: 0.2 }),
    plaster: toon({ map: P.plaster, tri: 0.3, hatch: 0.75, vertexColors: true }), // vertex colours: each house's tint
    timber: toon({ map: P.timber, tri: 0.7, hatch: 0.8 }),
    interior: toon({ color: 0x2b1f19, hatch: 0 }),
    shoji: toon({ map: P.shoji, hatch: 0.3 }),
    noren: toon({ map: Paint.noren('一楽'), side: THREE.DoubleSide, hatch: 0.3 }),
    ramenSign: toon({ map: Paint.sign('ラーメン', { w: 512, h: 170, size: 120 }), hatch: 0.1 }),
    signAtlas: toon({ map: Paint.signAtlas(SIGN_TEXTS), hatch: 0.1 }), // every sign board (one texture, one draw)
    norenAtlas: toon({ map: Paint.norenAtlas(NOREN), side: THREE.DoubleSide, hatch: 0.3 }),
    blossom: toon({ map: Paint.blossom(), tri: 0.3, hatch: 0.25, vertexColors: true, near: true }), // cherry trees
    awnRed: toon({ map: Paint.stripes('#c0342a'), side: THREE.DoubleSide, hatch: 0.5 }),
    awnYellow: toon({ map: Paint.stripes('#e0a82a'), side: THREE.DoubleSide, hatch: 0.5 }),
    roof: toon({ map: P.tiles, hatch: 0.6, vertexColors: true }), // neutral tiles: every roof's colour is its vertex colour
    palette: toon({ vertexColors: true, hatch: 0.5 }), // flat-coloured props (palette.js tint): one draw for all of them
    facade: toon({ map: P.facade, vertexColors: true, hatch: 0.5 }), // the backdrop town's walls (tinted per building)
    hallSign: toon({ map: Paint.sign('火', { w: 256, h: 256, size: 190, bg: '#f1e6c8', fg: '#b3261e' }), hatch: 0 }),
    // the backdrop forest (instanced): far and fogged, so its own UVs (one fetch, not triplanar) and no hatching
    forest: toon({ map: P.leaves, hatch: 0, vertexColors: true, fade: false }),
    roofRidge: toon({ color: 0x3a2724, hatch: 0.5 }),
    pot: toon({ color: 0xa2552e, hatch: 0.5 }),
    bush: toon({ map: P.leaves, tri: 0.6, hatch: 0.4 }),
    crate: toon({ map: P.crate, hatch: 0.5 }),
    lanternRed: toon({ color: 0xff6a44, emissive: 0xff3c14, hatch: 0 }),
    lanternWhite: toon({ color: 0xfff2d8, emissive: 0xffc890, hatch: 0 }),
    water: waterMaterial(),
  };
  // flat-coloured materials only ever batched: folded into the palette (Batch.add paints their colour per vertex)
  for (const k of ['pot', 'rust', 'woodCut', 'rope', 'roofRidge', 'interior']) mat[k].userData.palette = mat.palette;
  mat.lanternRed.emissiveIntensity = 2.6; // HDR: the lanterns glow through the bloom
  mat.lanternWhite.emissiveIntensity = 1.8;
  mat.water.userData.noShadow = true;
  mat.chain.userData.noShadow = false;

  const group = new THREE.Group();
  group.name = 'arena';
  group.add(buildTerrain(map, P));
  group.add(buildMountains());
  group.add(forestMeshes(buildBackdropForest(map), mat.forest));
  const B = new Batch();
  const townLanterns = buildTown(map, B, mat);
  buildTrees(map, B, mat);
  buildCliffs(map, B, mat);
  buildRocks(map, B, mat);
  buildLogs(map, B, mat);
  buildFences(map, B, mat);
  buildField(map, B, mat);
  const lanterns = buildVillage(map, B, mat, Paint);
  buildBridge(map, B, mat);
  buildProps(map, B, mat);
  buildFlora(map, B, mat);
  B.build(group);
  group.add(buildLanterns([...lanterns, ...townLanterns], mat));
  const river = buildRiver(map, mat);
  group.add(river);
  const shafts = buildShafts(map, SUN_DIR);
  group.add(shafts);
  const leaves = buildLeaves();
  group.add(leaves);
  const grassMesh = grass > 0 ? buildGrass(map, grass) : null;
  if (grassMesh) group.add(grassMesh);
  const textures = [...Object.values(P), TOON.uHatch.value];
  return {
    group,
    mat,
    textures,
    falls: river.userData.falls,
    grass: grassMesh,
    update(dt, fx, cam) {
      if (cam) Batch.cull(group.userData.far, cam.position);
      mat.water.uniforms.uTime.value += dt;
      shafts.userData.mat.uniforms.uTime.value += dt;
      leaves.userData.mat.uniforms.uTime.value += dt;
      if (grassMesh) grassMesh.userData.wind.value += dt;
      // spray at the foot of each fall
      if (fx) {
        for (const f of river.userData.falls) {
          if (Math.random() < dt * (f.upper ? 18 : 30)) fx.emit(0, f.x + (Math.random() - 0.5) * f.w, f.y + 0.2, f.z, (Math.random() - 0.5) * 1.5, 1.2, 1 + Math.random(), 0.7, 0.3, 1.1, 0.95, 0.98, 1, 0.8);
        }
      }
    },
  };
}
