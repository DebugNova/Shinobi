// The ground: the heightfield as a toon mesh (painted grass blended into packed dirt by a per-vertex splat: the
// village's dirt, the forest's paths, worn ground round trees and rocks, noise-broken edges), and instanced grass
// (clumps of tapered blades, dark at the base and sunlit at the tips, swaying in the wind, fading out with distance).
import * as THREE from 'three';
import { SURF } from '../shared/config.js';
import { WATER_Y, riverDist } from '../shared/map.js';
import { mulberry32, fbm } from '../shared/rng.js';
import { toon } from '../gfx/toon.js';

/** Dirt amount (0..1) at a point: the map's surface ids + paths + noise. */
export function dirtAt(map, x, z) {
  const w = map.world;
  const s = w.terrainSurf(x, z);
  let d = s === SURF.dirt ? 1 : 0;
  // forest and field paths (distance to segments between landmarks), with ragged edges
  for (const [a, b] of PATHS) {
    const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
    let t = ((x - a[0]) * dx + (z - a[1]) * dz) / l2;
    t = Math.max(0, Math.min(1, t));
    const px = a[0] + dx * t - x, pz = a[1] + dz * t - z;
    const dist = Math.sqrt(px * px + pz * pz) + fbm(x * 0.3, z * 0.3, 2, 71) * 0.9;
    d = Math.max(d, 1 - Math.min(1, Math.max(0, (dist - 1.1) / 0.7)));
  }
  // worn ground at the river banks
  const r = riverDist(x, z).d;
  if (z > -47 && r < 7.5) d = Math.max(d, 1 - Math.min(1, Math.max(0, (r - 5.6) / 1.4)));
  // patches: grass in the dirt, dirt in the grass
  const n = fbm(x * 0.12, z * 0.12, 3, 99);
  if (d > 0.5 && n > 0.32) d *= 0.2;
  if (d < 0.5 && n < -0.45) d = 0.8;
  return d;
}

// footpaths between the zones (forest, field, bridge, ledge ramp)
const PATHS = [
  [[-60, -20], [-40, -14]], [[-40, -14], [-24, -8]], [[-24, -8], [-8, -2]], [[-8, -2], [-4, 0]],
  [[-40, -14], [-34, 8]], [[-34, 8], [-30, 26]], [[-30, 26], [-26, 36]], [[-26, 36], [-6, 30]],
  [[-24, -8], [-18, -30]], [[-18, -30], [-26, -44]], [[-50, 10], [-40, -14]], [[-6, 30], [8, 40]],
];

export function buildTerrain(map, paint) {
  const hf = map.hf;
  const x0 = -120, x1 = 120, step = 1;
  const nx = Math.round((x1 - x0) / step) + 1;
  const pos = new Float32Array(nx * nx * 3), splat = new Float32Array(nx * nx), uv = new Float32Array(nx * nx * 2);
  for (let j = 0; j < nx; j++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * step, z = x0 + j * step, k = j * nx + i;
      const gi = Math.round((x - hf.x0) / hf.cell), gj = Math.round((z - hf.z0) / hf.cell);
      const y = hf.h[gj * hf.nx + gi];
      pos.set([x, y, z], k * 3);
      uv.set([x * 0.1, z * 0.1], k * 2);
      splat[k] = Math.abs(x) < 80 && Math.abs(z) < 80 ? dirtAt(map, x, z) : 0;
      // the river bed under the water: dirt
      if (y < WATER_Y + 0.05) splat[k] = 1;
    }
  }
  const idx = [];
  for (let j = 0; j < nx - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    // split along the shorter diagonal (smoother ridges)
    if (Math.abs(pos[a * 3 + 1] - pos[d * 3 + 1]) < Math.abs(pos[b * 3 + 1] - pos[c * 3 + 1])) idx.push(a, c, d, a, d, b);
    else idx.push(a, c, b, b, c, d);
  }
  // the grass placement reads the same dirt amounts (cheaper than recomputing the paths and the river)
  map._dirt = { x0, step, n: nx, data: splat };
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aSplat', new THREE.BufferAttribute(splat, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mat = toon({ map: paint.grass, splat: paint.dirt, tri: 0.16, splatScale: 0.2, hatch: 0.5 });
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

/**
 * Instanced grass clumps on the grassy ground (not on dirt, water, or under colliders). One draw call.
 */
export function buildGrass(map, count = 26000) {
  const w = map.world;
  const rng = mulberry32(4242); // visual only: its own stream, never shifts a collider
  // a clump: 5 tapered blades in a loose tuft (uv.y = height along the blade)
  const blades = [];
  for (let b = 0; b < 5; b++) {
    const a = (b / 5) * Math.PI * 2 + rng() * 0.8, r = 0.04 + rng() * 0.06;
    const h = 0.16 + rng() * 0.14, wd = 0.022 + rng() * 0.01, lean = 0.05 + rng() * 0.08;
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    const tx = Math.cos(a) * lean, tz = Math.sin(a) * lean;
    // quad from base (two verts) to tip (one vert, a triangle) + a middle row: 3 triangles
    const px = -Math.sin(a) * wd, pz = Math.cos(a) * wd;
    blades.push([
      [cx - px, 0, cz - pz, 0], [cx + px, 0, cz + pz, 0],
      [cx - px * 0.6 + tx * 0.5, h * 0.55, cz - pz * 0.6 + tz * 0.5, 0.55], [cx + px * 0.6 + tx * 0.5, h * 0.55, cz + pz * 0.6 + tz * 0.5, 0.55],
      [cx + tx, h, cz + tz, 1],
    ]);
  }
  const pos = [], uvs = [], idx = [];
  for (const bl of blades) {
    const o = pos.length / 3;
    for (const v of bl) {
      pos.push(v[0], v[1], v[2]);
      uvs.push(v[3]);
    }
    idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2, o + 2, o + 3, o + 4);
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aH', new THREE.Float32BufferAttribute(uvs, 1)); // height along the blade (0 root, 1 tip)
  // grass shades like the ground under it: normals straight up
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geo.setIndex(idx);
  const U = { uWind: { value: 0 } };
  const mat = toon({
    color: 0xffffff,
    vertexColors: false,
    hatch: 0.35,
    key: 'grass',
    uniforms: U,
    vertex: {
      pars: `uniform float uWind; attribute float aH; varying float vH; varying vec3 vTint;`,
      main: `
        vH = aH;
        vec4 ip = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec3 wp = (modelMatrix * ip).xyz;
        // distance fade: clumps shrink away beyond ~40 m (and vanish by 55)
        float dist = length(wp - cameraPosition);
        transformed *= 1.0 - smoothstep(38.0, 55.0, dist);
        // wind: gusts travel across the field; the tips move most
        float gust = sin(wp.x * 0.35 + wp.z * 0.2 + uWind * 1.7) * 0.5 + sin(wp.x * 0.9 - uWind * 2.9) * 0.25;
        transformed.x += gust * aH * aH * 0.12;
        transformed.z += gust * aH * aH * 0.07;
        vTint = vec3(fract(sin(dot(wp.xz, vec2(12.9898, 78.233))) * 43758.5453));
      `,
    },
  });
  // base-to-tip colour gradient (dark roots, sunlit tips) and a little per-clump variation
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (s) => {
    prev(s);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vH; varying vec3 vTint;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 base = vec3(0.16, 0.36, 0.1), tip = mix(vec3(0.5, 0.78, 0.26), vec3(0.62, 0.8, 0.3), vTint.x);
        diffuseColor.rgb = mix(base, tip, smoothstep(0.0, 1.0, vH));`);
  };
  mat.side = THREE.DoubleSide;
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const g = {};
  let n = 0;
  for (let tries = 0; tries < count * 6 && n < count; tries++) {
    const x = -70 + rng() * 140, z = -68 + rng() * 138;
    const D = map._dirt;
    const di = Math.round((x - D.x0) / D.step), dj = Math.round((z - D.x0) / D.step);
    if (D.data[dj * D.n + di] > 0.3) continue;
    w.ground(x, z, 80, g);
    const ty = w.terrain(x, z);
    if (g.shape || g.surf === SURF.water || g.y > ty + 0.05 || ty < WATER_Y + 0.15) continue;
    // denser in the forest and round the field, sparser in the open
    const dens = 0.55 + 0.45 * fbm(x * 0.05, z * 0.05, 2, 17);
    if (rng() > dens + 0.25) continue;
    p.set(x, ty - 0.02, z);
    q.setFromAxisAngle(up, rng() * Math.PI * 2);
    const s = 0.8 + rng() * 0.5;
    sc.set(s, s * (0.75 + rng() * 0.6), s);
    mesh.setMatrixAt(n++, m4.compose(p, q, sc));
  }
  mesh.count = n;
  mesh.userData.full = n; // graphics presets draw a fraction
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.name = 'grass';
  mesh.userData.wind = U.uWind;
  return mesh;
}
