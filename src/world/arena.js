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
import { buildVillage, buildLanterns } from './village.js';
import { buildRiver, buildBridge, waterMaterial } from './water.js';
import { SUN_DIR } from './sky.js';

const SIGN_TEXT = ['茶屋', '団子', '本屋', '武器', '薬', '宿'];

export async function buildArena(map, { grass = 26000 } = {}) {
  // the brush font for signs must be loaded before we paint them
  try {
    await Promise.all(['64px "Yuji Syuku"', '64px "Kaushan Script"'].map((f) => document.fonts.load(f)));
  } catch {}
  const P = {
    grass: Paint.grass(), dirt: Paint.dirt(), bark: Paint.bark(), rock: Paint.rock(), plaster: Paint.plaster(),
    timber: Paint.wood(6), woodLight: Paint.wood(16, true), tiles: Paint.tiles(7, 0x5d3b37), tiles2: Paint.tiles(17, 0x3e4a5c),
    stone: Paint.stone(), leaves: Paint.leaves(), chain: Paint.chainlink(), shoji: Paint.shoji(), crate: Paint.crate(),
  };
  TOON.uHatch.value = Paint.hatch();
  const mat = {
    bark: toon({ map: P.bark, tri: 0.32, hatch: 0.95, vertexColors: true }), // vertex colours: moss, the darker foot
    leaves: toon({ map: P.leaves, tri: 0.2, hatch: 0.35, vertexColors: true, near: true }), // vertex colours: canopy occlusion, tint
    rock: toon({ map: P.rock, tri: 0.09, hatch: 0.85 }),
    grassCap: toon({ map: P.grass, tri: 0.18, hatch: 0.5 }),
    woodCut: toon({ color: 0xd9b07c, hatch: 0.3 }),
    chain: toon({ map: P.chain, alphaTest: 0.5, side: THREE.DoubleSide, hatch: 0.2, fade: false }),
    rust: toon({ color: 0x7a4a30, hatch: 0.6 }),
    woodLight: toon({ map: P.woodLight, tri: 0.55, hatch: 0.6 }),
    rope: toon({ color: 0xd9c9a0, hatch: 0.3 }),
    memorial: toon({ map: P.stone, tri: 0.35, color: 0xb9b6c8, hatch: 0.7 }), // dark stone, but not a hole (the tint multiplies in linear space)
    stone: toon({ map: P.stone, tri: 0.45, hatch: 0.7 }),
    stoneWall: toon({ map: P.stone, tri: 0.35, hatch: 0.8 }),
    target: toon({ map: Paint.target(), hatch: 0.2 }),
    plaster: toon({ map: P.plaster, tri: 0.3, hatch: 0.75 }),
    timber: toon({ map: P.timber, tri: 0.7, hatch: 0.8 }),
    interior: toon({ color: 0x2b1f19, hatch: 0 }),
    shoji: toon({ map: P.shoji, hatch: 0.3 }),
    noren: toon({ map: Paint.noren('一楽'), side: THREE.DoubleSide, hatch: 0.3 }),
    ramenSign: toon({ map: Paint.sign('ラーメン', { w: 512, h: 170, size: 120 }), hatch: 0.1 }),
    signs: SIGN_TEXT.map((t, i) => toon({ map: Paint.sign(t, { w: 96, h: 300, size: 76, vertical: true, bg: ['#f1e6c8', '#2b2b30', '#b3261e'][i % 3], fg: ['#2b1d12', '#f1e6c8', '#fff4dc'][i % 3] }), hatch: 0.1 })),
    awnRed: toon({ map: Paint.stripes('#c0342a'), side: THREE.DoubleSide, hatch: 0.5 }),
    awnYellow: toon({ map: Paint.stripes('#e0a82a'), side: THREE.DoubleSide, hatch: 0.5 }),
    roof: toon({ map: P.tiles, hatch: 0.6 }),
    roofRidge: toon({ color: 0x3a2724, hatch: 0.5 }),
    pot: toon({ color: 0xa2552e, hatch: 0.5 }),
    bush: toon({ map: P.leaves, tri: 0.6, hatch: 0.4 }),
    crate: toon({ map: P.crate, hatch: 0.5 }),
    lanternRed: toon({ color: 0xff6a44, emissive: 0xff3c14, hatch: 0 }),
    lanternWhite: toon({ color: 0xfff2d8, emissive: 0xffc890, hatch: 0 }),
    water: waterMaterial(),
  };
  mat.lanternRed.emissiveIntensity = 2.6; // HDR: the lanterns glow through the bloom
  mat.lanternWhite.emissiveIntensity = 1.8;
  mat.water.userData.noShadow = true;
  mat.chain.userData.noShadow = false;

  const group = new THREE.Group();
  group.name = 'arena';
  group.add(buildTerrain(map, P));
  const B = new Batch();
  buildTrees(map, B, mat);
  buildCliffs(map, B, mat);
  buildRocks(map, B, mat);
  buildLogs(map, B, mat);
  buildFences(map, B, mat);
  buildField(map, B, mat);
  const lanterns = buildVillage(map, B, mat, Paint);
  buildBridge(map, B, mat);
  B.build(group);
  group.add(buildLanterns(lanterns, mat));
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
    fall: river.userData.fall,
    grass: grassMesh,
    update(dt, fx) {
      mat.water.uniforms.uTime.value += dt;
      shafts.userData.mat.uniforms.uTime.value += dt;
      leaves.userData.mat.uniforms.uTime.value += dt;
      if (grassMesh) grassMesh.userData.wind.value += dt;
      // spray at the foot of the waterfall
      const f = river.userData.fall;
      if (f && fx && Math.random() < dt * 30) fx.emit(0, f.x + (Math.random() - 0.5) * f.w, f.y + 0.2, f.z, (Math.random() - 0.5) * 1.5, 1.2, 1 + Math.random(), 0.7, 0.3, 1.1, 0.95, 0.98, 1, 0.8);
    },
  };
}
