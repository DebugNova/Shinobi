// Greybox view of the arena: the terrain heightfield and every collider, coloured by surface. It is what the art
// pass (src/world/arena.js) replaces; kept for debugging collisions (F6 toggles it over the art).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BOX } from '../shared/collide.js';
import { SURF } from '../shared/config.js';
import { WATER_Y } from '../shared/map.js';

const SURF_COLOR = {
  [SURF.dirt]: 0xb89060, [SURF.grass]: 0x6fae4a, [SURF.wood]: 0x9a6a3e, [SURF.stone]: 0xa9a49a, [SURF.water]: 0x4a8fc0,
  [SURF.plaster]: 0xe8dcc4, [SURF.roof]: 0x6a3a30, [SURF.bark]: 0x6b4a33, [SURF.rock]: 0x8c857a, [SURF.metal]: 0x7a8088,
};

export function terrainGeometry(hf, x0, z0, x1, z1, step = 1) {
  const i0 = Math.max(0, Math.floor((x0 - hf.x0) / hf.cell)), i1 = Math.min(hf.nx - 1, Math.ceil((x1 - hf.x0) / hf.cell));
  const j0 = Math.max(0, Math.floor((z0 - hf.z0) / hf.cell)), j1 = Math.min(hf.nz - 1, Math.ceil((z1 - hf.z0) / hf.cell));
  const nx = Math.floor((i1 - i0) / step) + 1, nz = Math.floor((j1 - j0) / step) + 1;
  const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3);
  const c = new THREE.Color();
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const gi = i0 + i * step, gj = j0 + j * step, k = j * nx + i;
      pos[k * 3] = hf.x0 + gi * hf.cell;
      pos[k * 3 + 1] = hf.h[gj * hf.nx + gi];
      pos[k * 3 + 2] = hf.z0 + gj * hf.cell;
      c.setHex(SURF_COLOR[hf.surf[gj * hf.nx + gi]] ?? 0x6fae4a);
      col.set([c.r, c.g, c.b], k * 3);
    }
  }
  const idx = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, d = a + nx, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** The mesh of one collider shape (world space). */
export function shapeGeometry(s) {
  let g;
  if (s.k === BOX) {
    g = new THREE.BoxGeometry(s.hx * 2, s.y1 - s.y0, s.hz * 2);
    g.translate(0, (s.y1 + s.y0) / 2, 0);
    if (s.sx || s.sz) {
      // sloped top: move the top vertices onto the slope plane
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        if (p.getY(i) > (s.y0 + s.y1) / 2) p.setY(i, s.y1 + s.sx * p.getX(i) + s.sz * p.getZ(i));
      }
      g.computeVertexNormals();
    }
    g.rotateY(-Math.atan2(s.s, s.c));
  } else {
    g = new THREE.CylinderGeometry(s.r1 ?? s.r, s.r, s.y1 - s.y0, 20);
    g.translate(0, (s.y1 + s.y0) / 2, 0);
  }
  g.translate(s.x, 0, s.z);
  return g;
}

export function buildGreybox(map) {
  const group = new THREE.Group();
  group.name = 'greybox';
  const tMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const terrain = new THREE.Mesh(terrainGeometry(map.hf, -100, -100, 100, 100), tMat);
  terrain.receiveShadow = true;
  group.add(terrain);
  // colliders, merged per surface
  const bySurf = new Map();
  for (const s of map.world.shapes) {
    const g = shapeGeometry(s).toNonIndexed();
    if (!bySurf.has(s.surf)) bySurf.set(s.surf, []);
    bySurf.get(s.surf).push(g);
  }
  for (const [surf, list] of bySurf) {
    const m = new THREE.Mesh(mergeGeometries(list), new THREE.MeshLambertMaterial({ color: SURF_COLOR[surf] ?? 0x999999 }));
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  // water
  const river = map.props.find((p) => p.t === 'river');
  if (river) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(220, 220).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x3f8fd0, transparent: true, opacity: 0.75 }));
    w.position.y = WATER_Y;
    group.add(w);
  }
  // canopies
  const leaf = new THREE.MeshLambertMaterial({ color: 0x3f8a3a });
  const blobs = [];
  for (const t of map.trees) {
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + t.seed;
      const g = new THREE.IcosahedronGeometry(t.r * 2.2, 1);
      g.translate(t.x + Math.cos(a) * t.r * 1.6, t.top + 1.5 + (k % 2) * 1.2, t.z + Math.sin(a) * t.r * 1.6);
      blobs.push(g);
    }
  }
  if (blobs.length) {
    const c = new THREE.Mesh(mergeGeometries(blobs), leaf);
    c.castShadow = true;
    group.add(c);
  }
  return group;
}
