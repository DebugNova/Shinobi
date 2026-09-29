// The world beyond the rim walls (drawn only: nothing out here has a collider, nobody can reach it): the backdrop
// hills' forest (instanced broadleaf crowns and cedars on the heightfield outside the arena), three ranges of far
// mountains fading into the haze, and the rest of the town east of the village (a skyline of shops, tall blocks,
// round towers and one big round hall, on the terraces map.js shapes there: CITY_Y).
import * as THREE from 'three';
import { mulberry32, fbm } from '../shared/rng.js';
import { CITY_Y } from '../shared/map.js';
import { SKY, SUN_DIR } from './sky.js';
import { M, boxUV } from './batch.js';
import { tint } from './palette.js';

const TAU = Math.PI * 2;

/** Is (x, z) out in the backdrop (behind the rim walls) and how far. */
const outside = (x, z) => Math.max(-x - 75, x - 75, -z - 72.5, z - 75.5);
/** The town's footprint east of the rim (map.js blends the ground to CITY_Y there). */
const inTown = (x, z) => x > 75 && x < 102.5 && Math.abs(z - 2) < 60;

// ------------------------------------------------------------------ far mountains

/**
 * Three rings of mountains round the whole map, each a strip of ridges (base, a shoulder, the crest) shaded in two
 * toon bands by the sun and faded toward the horizon colour with distance and toward the valley mist at the foot.
 * One mesh, one draw; no fog (they stand past its far end).
 */
export function buildMountains() {
  const layers = [
    { r: 260, h0: 38, h1: 88, lit: '#7aa56c', shade: '#4d7470', haze: 0.34, seed: 3, f: 5 },
    { r: 380, h0: 60, h1: 130, lit: '#98b9ad', shade: '#6d8c98', haze: 0.52, seed: 7, f: 4 },
    { r: 520, h0: 85, h1: 175, lit: '#c3d7e4', shade: '#9db3cc', haze: 0.66, seed: 11, f: 3 },
  ];
  const pos = [], nrm = [], col = [], idx = [];
  const lit = [], shade = [];
  const n = 256;
  layers.forEach((L, li) => {
    const rng = mulberry32(L.seed);
    const off = rng() * 100;
    const height = (a) => {
      // ridged noise round the circle (seamless: sampled on the unit direction), a few tall peaks
      const cx = Math.cos(a) * L.f, cz = Math.sin(a) * L.f;
      const ridge = 1 - Math.abs(fbm(cx + off, cz, 4, L.seed));
      const peaks = Math.max(0, fbm(cx * 0.6 + off, cz * 0.6 + 9, 2, L.seed + 1));
      return L.h0 + (L.h1 - L.h0) * Math.min(1, ridge * ridge * 0.8 + peaks * 0.9);
    };
    const base = pos.length / 3;
    const rows = [[-60, 0], [0.45, 0.35], [0.82, 0.7], [1, 1]]; // [height fraction (or y), inward fraction]
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * TAU, h = height(a), dep = L.r * 0.16;
      for (const [fy, fin] of rows) {
        const y = fy < 0 ? fy : h * fy + fbm(Math.cos(a) * 20, Math.sin(a) * 20 + fy * 7, 2, L.seed + 3) * h * 0.06;
        const r = L.r - dep * fin;
        pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
        col.push(li, fy < 0 ? 0 : fy, 0);
      }
    }
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < rows.length - 1; k++) {
        const a = base + i * rows.length + k, b = a + rows.length;
        idx.push(a, b, a + 1, a + 1, b, b + 1); // facing the centre (seen from inside the ring)
      }
    }
    lit.push(new THREE.Color(L.lit));
    shade.push(new THREE.Color(L.shade));
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('info', new THREE.Float32BufferAttribute(col, 3)); // layer, height fraction
  g.setIndex(idx);
  g.computeVertexNormals();
  const haze = layers.map((L) => L.haze);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uLit: { value: lit },
      uShade: { value: shade },
      uHaze: { value: haze },
      uHorizon: { value: SKY.horizon },
      uSun: { value: SUN_DIR },
    },
    vertexShader: /* glsl */ `
      attribute vec3 info; varying vec3 vInfo; varying vec3 vN; varying vec3 vW;
      void main() {
        vInfo = info; vN = normal;
        vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uLit[3]; uniform vec3 uShade[3]; uniform float uHaze[3]; uniform vec3 uHorizon; uniform vec3 uSun;
      varying vec3 vInfo; varying vec3 vN; varying vec3 vW;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        int li = int(vInfo.x + 0.5);
        vec3 N = normalize(vN);
        // streaks of rock and forest down the slopes (noise stretched vertically), then two toon bands of sun
        float streak = n2(vec2(atan(vW.z, vW.x) * 90.0, vW.y * 0.02)) * 0.6 + n2(vec2(atan(vW.z, vW.x) * 260.0, vW.y * 0.05)) * 0.4;
        float l = dot(N, uSun) + (streak - 0.5) * 0.35;
        float band = smoothstep(-0.05, 0.08, l) * 0.55 + smoothstep(0.3, 0.42, l) * 0.45;
        vec3 c = mix(uShade[li], uLit[li], band);
        // bare rock toward the crests of the nearer ranges
        c = mix(c, c * vec3(1.18, 1.12, 1.05), smoothstep(0.7, 0.95, vInfo.y) * step(float(li), 1.5) * 0.6);
        // haze: the layer's distance, and the valley mist at the foot
        float mist = 1.0 - smoothstep(0.0, 0.55, vInfo.y);
        c = mix(c, uHorizon, clamp(uHaze[li] + mist * 0.55, 0.0, 0.96));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
    fog: false,
  });
  const m = new THREE.Mesh(g, mat);
  m.name = 'mountains';
  m.frustumCulled = false;
  // (default render order: opaque objects draw front to back, so everything in front of the mountains hides their
  // pixels before they are shaded; drawn first, all of their screen area was shaded and then overdrawn)
  m.matrixAutoUpdate = false;
  return m;
}

// ------------------------------------------------------------------ backdrop forest

/** A broadleaf crown: a lumpy, flattened ball (soft sphere normals: the anime foliage mass), dark underneath. */
function crownGeometry(seed) {
  const rng = mulberry32(seed);
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position, c = new Float32Array(p.count * 3);
  const f = [rng() * 10, rng() * 10, rng() * 10];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.14 * Math.sin(x * 5 + f[0]) * Math.sin(y * 4 + f[1]) + 0.1 * Math.sin(z * 7 + f[2]);
    p.setXYZ(i, x * k, y * k * 0.82 + 0.35, z * k);
    const ao = 0.55 + 0.45 * Math.min(1, Math.max(0, (y + 0.7) / 1.4));
    c.set([ao * 0.95, ao, ao * 1.02], i * 3);
  }
  g.computeVertexNormals();
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * 1.5); // leaf dabs about the size they are up close
  // sphere normals: the whole crown shades as one soft mass
  const nn = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i) - 0.35, z = p.getZ(i), l = Math.hypot(x, y, z);
    nn.setXYZ(i, x / l, y / l, z / l);
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

/** A cedar: three stacked cones on a short trunk (unit radius at the base tier, ~4.5 tall). */
function cedarGeometry() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.12, 0.16, 1.2, 5);
  trunk.translate(0, 0.6, 0);
  const paint = (g, r, gr, b) => {
    const c = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < c.length; i += 3) c.set([r, gr, b], i);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return g;
  };
  parts.push(paint(trunk, 0.35, 0.25, 0.2));
  [[1, 1.9, 1.0], [0.78, 1.7, 2.1], [0.52, 1.5, 3.1]].forEach(([r, h, y], i) => {
    const cone = new THREE.ConeGeometry(r, h, 8, 1, true);
    cone.translate(0, y + h / 2 - 0.2, 0);
    const k = 0.62 + i * 0.12;
    parts.push(paint(cone.toNonIndexed(), k * 0.85, k, k * 0.9));
  });
  const g = new THREE.BufferGeometry();
  const merged = [];
  for (const q of parts) merged.push(q.index ? q.toNonIndexed() : q);
  const pos = [], nor = [], col = [];
  for (const q of merged) {
    q.computeVertexNormals();
    pos.push(...q.attributes.position.array);
    nor.push(...q.attributes.normal.array);
    col.push(...q.attributes.color.array);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/**
 * The forest on the backdrop hills: crowns and cedars packed over the heightfield outside the rim, thinning out up
 * the northern mountains (bare rock above ~55 m) and on steep ground, none in the town. Two instanced draws (crowns,
 * cedars) with per-instance tints: splitting them into culled quadrants cost more draws than the few thousand
 * low-poly instances cost the GPU.
 */
export function buildBackdropForest(map) {
  const w = map.world;
  const rng = mulberry32(8080);
  const crown = crownGeometry(1), cedar = cedarGeometry();
  const lists = { crown: [], cedar: [] };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  const STEP = 4.6;
  for (let z = -119; z <= 119; z += STEP) {
    for (let x = -119; x <= 119; x += STEP) {
      const px = x + (rng() - 0.5) * STEP * 0.9, pz = z + (rng() - 0.5) * STEP * 0.9;
      const o = outside(px, pz);
      if (o < 0.5 || inTown(px, pz) || Math.abs(px) > 119.5 || Math.abs(pz) > 119.5) continue;
      const y = w.terrain(px, pz);
      // slope from the heightfield
      const dx = w.terrain(px + 1, pz) - w.terrain(px - 1, pz), dz = w.terrain(px, pz + 1) - w.terrain(px, pz - 1);
      const slope = Math.hypot(dx, dz) / 2;
      if (slope > 1.35 && rng() < 0.7) continue;
      if (y > 50 + fbm(px * 0.05, pz * 0.05, 2, 5) * 12 && rng() < 0.85) continue; // above the tree line
      if (fbm(px * 0.04, pz * 0.04, 2, 9) < -0.35) continue; // clearings
      const isCedar = rng() < 0.3 + Math.max(0, (y - 20) / 60);
      const sc = isCedar ? 1.6 + rng() * 1.3 : 2.8 + rng() * 2.2 + Math.min(2, o * 0.03);
      q.setFromAxisAngle(up, rng() * TAU);
      p.set(px, y - (isCedar ? 0.3 : sc * 0.25), pz);
      s.set(sc, isCedar ? sc * (1.25 + rng() * 0.5) : sc * (0.85 + rng() * 0.3), sc);
      m4.compose(p, q, s);
      // tints: warmer yellow-greens, cooler blue-greens, a few autumn-touched crowns
      const t = rng();
      if (isCedar) col.setRGB(0.62 + t * 0.08, 0.78 + t * 0.06, 0.66);
      else if (t < 0.06) col.setRGB(1.2, 0.95, 0.55);
      else col.setRGB(0.82 + t * 0.3, 0.9 + t * 0.12, 0.72 + (1 - t) * 0.2);
      (isCedar ? lists.cedar : lists.crown).push([m4.clone(), col.clone()]);
    }
  }
  return { lists, crown, cedar };
}

/** Instanced meshes for the backdrop forest (the toon material comes from arena.js). */
export function forestMeshes(F, mat) {
  const group = new THREE.Group();
  group.name = 'backdrop-forest';
  {
    const sets = [[F.crown, F.lists.crown], [F.cedar, F.lists.cedar]];
    for (const [geo, list] of sets) {
      if (!list.length) continue;
      const m = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach(([mm, c], i) => {
        m.setMatrixAt(i, mm);
        m.setColorAt(i, c);
      });
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
      m.castShadow = false;
      m.receiveShadow = false;
      m.matrixAutoUpdate = false;
      group.add(m);
    }
  }
  return group;
}

// ------------------------------------------------------------------ the town beyond the east rim

/**
 * Box with its sides UV-mapped for a facade texture: u = metres along the face / bay, v = metres up / storey.
 * Top and bottom faces get uv 0 (they are covered by a roof slab).
 */
function facadeBox(w, h, d, bay = 4, storey = 3.1) {
  const g = new THREE.BoxGeometry(w, h, d);
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
    const x = p.getX(i), y = p.getY(i) + h / 2, z = p.getZ(i);
    if (ny > 0.5) uv.setXY(i, 0.02, 0.02);
    else if (nx > 0.5) uv.setXY(i, (z + d / 2) / bay, y / storey);
    else uv.setXY(i, (x + w / 2) / bay, y / storey);
  }
  return g;
}

/** A round tower's wall with the facade texture wrapped round it (windows every ~4 m). */
function facadeCyl(r, h, seg = 16, storey = 3.1) {
  const g = new THREE.CylinderGeometry(r, r, h, seg, 1, true);
  const uv = g.attributes.uv, p = g.attributes.position;
  const bays = Math.max(3, Math.round((TAU * r) / 4));
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * bays, (p.getY(i) + h / 2) / storey);
  return g;
}

const WALLS = ['#efe4cc', '#e2e6ea', '#f2dcc6', '#dde7d8', '#e9e0d6', '#d6dde8'];
const ROOFS = ['#6b3a33', '#3e5876', '#2f6d69', '#7c3326', '#4f6b3c', '#5a4b6e'];

/**
 * The town: lots on the terraces east of the rim (x 77..112), taller toward the back so the skyline rises; shops with
 * tiled gable roofs near the wall, flat-roofed blocks with water tanks and roof huts, round towers, sign boards, and
 * one great round hall with a red drum and a wide roof. Everything goes into the arena's batch (shared materials).
 */
export function buildTown(map, B, mat) {
  const rng = mulberry32(4711);
  const rows = [79.5, 88.5, 97.5];
  const HALL = { x: 99, z: -8, r: 10 };
  const putFacade = (g, color, matrix) => B.add(mat.facade, tint(g, color), matrix);
  rows.forEach((rx, ri) => {
    let z = -56 + rng() * 4;
    while (z < 60) {
      const wz = 7 + rng() * 6, wx = 6.5 + rng() * 1.5;
      const cz = z + wz / 2;
      z += wz + 1 + rng() * 2.5;
      if (Math.hypot(rx - HALL.x, cz - HALL.z) < HALL.r + 6) continue;
      if (rng() < 0.12) continue; // a gap (an alley, a garden)
      const gy = Math.min(CITY_Y(rx - wx / 2, cz), CITY_Y(rx + wx / 2, cz)) - 0.3;
      const wall = WALLS[Math.floor(rng() * WALLS.length)], roof = ROOFS[Math.floor(rng() * ROOFS.length)];
      // the rim wall (12-16 m) hides anything low right behind it: the skyline starts at ~4 storeys and rises
      const type = rng() < 0.16 + ri * 0.08 ? 'tower' : rng() < 0.22 ? 'shop' : 'block';
      if (type === 'shop') {
        const fl = 3 + (rng() < 0.5 ? 1 : 0) + ri, H = fl * 3.1 + 0.4;
        putFacade(facadeBox(wx, H, wz), wall, M(rx, gy + H / 2, cz));
        // a gable roof along z (ridge running north-south), eaves overhanging
        const rise = wx * 0.3, half = wx / 2 + 0.5, len = Math.hypot(half, rise), ang = Math.atan2(rise, half);
        for (const sg of [-1, 1]) {
          const r = boxUV(0.14, len, wz + 1, 0.9);
          B.add(mat.roof, tint(r, roof), M(rx + (sg * half) / 2, gy + H + rise / 2, cz, 0, 0, sg * (Math.PI / 2 - ang)));
        }
        const ridge = new THREE.CylinderGeometry(0.16, 0.16, wz + 1.2, 6);
        ridge.rotateX(Math.PI / 2);
        B.add(mat.palette, tint(ridge, '#3a2a26'), M(rx, gy + H + rise + 0.1, cz));
        // gable ends
        for (const sz of [-1, 1]) {
          const tri = new THREE.BufferGeometry();
          tri.setAttribute('position', new THREE.Float32BufferAttribute([-wx / 2, 0, 0, wx / 2, 0, 0, 0, rise, 0], 3));
          tri.computeVertexNormals();
          B.add(mat.palette, tint(tri, wall), M(rx, gy + H, cz + sz * (wz / 2 + 0.01), 0, sz > 0 ? 0 : Math.PI, 0));
        }
        if (rng() < 0.7) B.add(mat.palette, tint(boxUV(0.08, 0.28, wz * 0.8), rng() < 0.5 ? '#c0342a' : '#e0a82a'), M(rx - wx / 2 - 0.04, gy + 3.0, cz)); // awning strip
      } else if (type === 'block') {
        const fl = 4 + ri + Math.floor(rng() * (3 + ri * 1.5)), H = fl * 3.1 + 0.3;
        putFacade(facadeBox(wx, H, wz), wall, M(rx, gy + H / 2, cz));
        // floor bands, a parapet slab, roof clutter: a water tank on legs, a stair hut, pipes down the face
        B.add(mat.palette, tint(boxUV(wx + 0.3, 0.45, wz + 0.3), '#8b8f96'), M(rx, gy + H + 0.1, cz));
        for (let f = 1; f < fl; f += 2) B.add(mat.palette, tint(boxUV(wx + 0.12, 0.16, wz + 0.12), '#6b5a4a'), M(rx, gy + f * 3.1, cz));
        if (rng() < 0.7) {
          const tx = rx + (rng() - 0.5) * (wx - 3), tz = cz + (rng() - 0.5) * (wz - 3), ty = gy + H + 0.3;
          const tank = new THREE.CylinderGeometry(1, 1, 1.8, 12);
          B.add(mat.palette, tint(tank, rng() < 0.5 ? '#9fb3c4' : '#c9b89a'), M(tx, ty + 1.9, tz));
          B.add(mat.palette, tint(new THREE.ConeGeometry(1.05, 0.5, 12), '#6f7c89'), M(tx, ty + 3.05, tz));
          for (const [ax, az] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) B.add(mat.palette, tint(boxUV(0.12, 1.0, 0.12), '#4a4a50'), M(tx + ax, ty + 0.5, tz + az));
        }
        if (rng() < 0.5) B.add(mat.palette, tint(boxUV(2.2, 2.2, 2.6), wall), M(rx + (rng() - 0.5) * 2, gy + H + 1.3, cz + (rng() - 0.5) * 2));
        if (rng() < 0.6) {
          // a vertical sign board on the street side (west), coloured
          const sh = 3 + rng() * 4;
          B.add(mat.palette, tint(boxUV(0.25, sh, 1.1), ['#b3261e', '#2b2b30', '#e0a82a', '#2f5d8a'][Math.floor(rng() * 4)]), M(rx - wx / 2 - 0.4, gy + H * 0.55, cz + (rng() - 0.5) * (wz - 2)));
        }
        const pipe = new THREE.CylinderGeometry(0.09, 0.09, H, 6);
        B.add(mat.palette, tint(pipe, '#5d6670'), M(rx - wx / 2 - 0.1, gy + H / 2, cz + wz / 2 - 0.4));
      } else {
        const r = Math.min(wx, wz) / 2 - 0.2, fl = 5 + ri + Math.floor(rng() * (3 + ri * 2)), H = fl * 3.1;
        putFacade(facadeCyl(r, H), wall, M(rx, gy + H / 2, cz));
        for (let f = 1; f <= fl; f += 2) B.add(mat.palette, tint(new THREE.CylinderGeometry(r + 0.12, r + 0.12, 0.22, 16, 1, true), '#6b5a4a'), M(rx, gy + f * 3.1, cz));
        if (rng() < 0.5) {
          B.add(mat.palette, tint(new THREE.CylinderGeometry(r + 0.3, r + 0.3, 0.4, 16), '#8b8f96'), M(rx, gy + H + 0.2, cz));
          B.add(mat.palette, tint(new THREE.CylinderGeometry(r * 0.55, r * 0.55, 1.6, 12), '#9fb3c4'), M(rx, gy + H + 1.2, cz));
        } else B.add(mat.roof, tint(new THREE.ConeGeometry(r + 0.8, r * 0.9, 16), roof), M(rx, gy + H + r * 0.45, cz));
      }
    }
  });
  // the great round hall: a stone base, a red drum with windows, a gallery band, a wide tiled roof, a tall sign
  {
    const { x, z, r } = HALL, gy = CITY_Y(x, z) - 0.3;
    B.add(mat.stone, new THREE.CylinderGeometry(r + 0.6, r + 1, 3, 32), M(x, gy + 1.5, z));
    const H = 16;
    B.add(mat.facade, tint(facadeCyl(r, H, 32), '#e0553f'), M(x, gy + 3 + H / 2, z));
    for (const y of [3 + 6.2, 3 + 12.4]) B.add(mat.palette, tint(new THREE.CylinderGeometry(r + 0.5, r + 0.5, 0.5, 32), '#f1e6c8'), M(x, gy + y, z));
    B.add(mat.roof, tint(new THREE.ConeGeometry(r + 3.2, 5.5, 32, 1, true), '#8a2f25'), M(x, gy + 3 + H + 2.4, z));
    B.add(mat.palette, tint(new THREE.CylinderGeometry(r + 3.2, r + 3.2, 0.35, 32), '#3a2a26'), M(x, gy + 3 + H - 0.2, z));
    B.add(mat.roof, tint(new THREE.CylinderGeometry(2.2, 3, 3, 16), '#8a2f25'), M(x, gy + 3 + H + 5.5, z));
    B.add(mat.palette, tint(new THREE.SphereGeometry(0.7, 10, 6), '#e0a82a'), M(x, gy + 3 + H + 7.4, z));
    // the kanji plate facing the village (west)
    B.add(mat.hallSign, new THREE.PlaneGeometry(4.2, 4.2), M(x - r - 0.35, gy + 3 + H - 3.4, z, 0, -Math.PI / 2, 0));
  }
  // lines of lanterns strung over the town's streets (between the rows): catch the eye above the rim wall
  const out = [];
  for (let k = 0; k < rows.length - 1; k++) {
    const x = (rows[k] + rows[k + 1]) / 2;
    for (let zz = -50; zz < 58; zz += 6 + rng() * 5) out.push({ p: new THREE.Vector3(x, CITY_Y(x, zz) + 5 + rng() * 1.5, zz), color: rng() < 0.6 ? 'red' : 'white', small: true });
  }
  return out;
}

export { outside, inTown };
