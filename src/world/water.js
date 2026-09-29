// The river: a ribbon following the map's centreline, drawn with a stylized water shader (flat colour bands from the
// deep middle to the shallow banks, animated foam lines along the edges and round the stepping stones, toon glints,
// drifting ripple lines); the stream across the ridge and the ledge (the same shader on narrower ribbons); its two
// falls (curved two-layer curtains of scrolling streaks with a bright lip and a churning foot, foam rings spreading
// on the pools, mist rising); the wooden bridge (its planks follow the colliders exactly).
import * as THREE from 'three';
import { WATER_Y } from '../shared/map.js';
import { BOX } from '../shared/collide.js';
import { SURF } from '../shared/config.js';
import { M, boxUV } from './batch.js';
import { mulberry32 } from '../shared/rng.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export function waterMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, ...THREE.UniformsLib.fog },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vW;
      #include <fog_pars_vertex>
      void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec2 vUv; varying vec3 vW;
      #include <common>
      #include <fog_pars_fragment>
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        // across the river: 0 at a bank, 1 in the middle
        float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
        float flow = vUv.y - uTime * 1.2;
        vec3 deep = vec3(0.14, 0.42, 0.72), mid = vec3(0.24, 0.6, 0.84), shallow = vec3(0.45, 0.82, 0.88);
        vec3 col = across > 0.45 ? deep : across > 0.2 ? mid : shallow;
        // ripple lines drifting downstream
        float r = n(vec2(vUv.x * 9.0, flow * 1.3)) + n(vec2(vUv.x * 22.0 + 3.0, flow * 3.0)) * 0.5;
        col = mix(col, col * 1.12 + 0.04, step(1.2, r) * step(r, 1.32));
        // foam along the banks (animated, broken)
        float foam = step(across + n(vec2(vUv.x * 30.0, flow * 4.0)) * 0.08, 0.1);
        col = mix(col, vec3(0.92, 0.97, 1.0), foam * 0.9);
        // glints
        float g = step(0.93, n(vec2(vW.x * 5.0, vW.z * 5.0 + uTime * 0.6)) * n(vec2(vW.z * 6.3 - uTime * 0.4, vW.x * 5.1)) * 1.3);
        col += g * 0.6;
        gl_FragColor = vec4(col, 0.92);
        #include <fog_fragment>
      }`,
    transparent: true,
    fog: true,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
}

/** A water ribbon along a polyline [[x, z, halfWidth]...] at height y (uv.x across, uv.y along in 1/0.12 m). */
function ribbon(pts, y, pad = 0) {
  const pos = [], uv = [], idx = [];
  let dist = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x, z, hw] = pts[i];
    const [px, pz] = pts[Math.max(0, i - 1)], [nx, nz] = pts[Math.min(pts.length - 1, i + 1)];
    let dx = nx - px, dz = nz - pz;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    if (i) dist += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]);
    const w = hw + pad;
    pos.push(x + dz * w, y, z - dx * w, x - dz * w, y, z + dx * w);
    uv.push(0, dist * 0.12, 1, dist * 0.12);
    if (i) {
      const o = (i - 1) * 2;
      idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Catmull-Rom through [x, z, hw] points, one sample every ~step metres. */
function smoothPath(P, step = 0.5) {
  const out = [];
  const cr = (a, b, c, d, t) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push([cr(p0[0], p1[0], p2[0], p3[0], t), cr(p0[1], p1[1], p2[1], p3[1], t), p1[2] + (p2[2] - p1[2]) * t]);
    }
  }
  out.push(P[P.length - 1].slice());
  return out;
}

/**
 * A fall's curtain: from the lip (a little behind the cliff's face, on the notch) over the edge, then out and down on a
 * throw curve (the offset grows with the square root of the drop), widening a little toward the pool. uv.y 0 at the
 * lip, 1 at the pool.
 */
function curtainGeometry(F, back = 0) {
  const H = F.top - F.bottom, nu = 12, nv = 26;
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= nv; j++) {
    const v = j / nv;
    // the first 12% rolls over the lip; the rest falls
    const lip = Math.min(1, v / 0.12), drop = Math.max(0, (v - 0.12) / 0.88) * H;
    const y = F.top + 0.06 - (v < 0.12 ? 0.18 * lip * lip : 0.18 + drop);
    const zo = v < 0.12 ? -0.45 + 0.6 * Math.sin((lip * Math.PI) / 2) : 0.15 + 0.3 * Math.sqrt(drop);
    const w = F.w * (1 + 0.1 * Math.min(1, drop / H));
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      pos.push(F.x + (u - 0.5) * w, Math.max(F.bottom - 0.05, y), F.z + zo - back);
      uv.push(u, v);
    }
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + nu + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

const NOISE = /* glsl */ `
  float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
`;

/** The falls' material: toon streaks scrolling down (two speeds), the lip, the churning foot, ragged sides. */
function fallMaterial(uTime) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime, ...THREE.UniformsLib.fog },
    vertexShader: /* glsl */ `
      attribute float aLayer; varying vec2 vUv; varying vec3 vW; varying float vLayer;
      #include <fog_pars_vertex>
      void main() { vUv = uv; vLayer = aLayer; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec2 vUv; varying vec3 vW; varying float vLayer;
      #include <common>
      #include <fog_pars_fragment>
      ${NOISE}
      void main() {
        float uLayer = vLayer, v = vUv.y, sp = 1.0 - uLayer * 0.35;
        // streaks: noise columns stretched along the fall, scrolling down (world x: the pattern doesn't stretch)
        float s1 = n(vec2(vW.x * 3.1, vW.y * 0.55 + uTime * 2.4 * sp));
        float s2 = n(vec2(vW.x * 8.3 + 4.0, vW.y * 1.1 + uTime * 3.9 * sp));
        float st = s1 * 0.62 + s2 * 0.38;
        vec3 deep = vec3(0.2, 0.52, 0.8), mid = vec3(0.47, 0.78, 0.94), white = vec3(0.93, 0.98, 1.0);
        vec3 c = st > 0.64 ? white : st > 0.46 ? mid : deep;
        // the lip: a bright glassy band rolling over the edge
        c = mix(c, white, 1.0 - smoothstep(0.02, 0.1, v));
        c = mix(c, mid * 1.1, (1.0 - smoothstep(0.1, 0.16, v)) * smoothstep(0.06, 0.1, v));
        // the foot: churning white foam with a ragged top edge
        float churn = n(vec2(vW.x * 3.5, uTime * 2.2)) * 0.12 + n(vec2(vW.x * 9.0, uTime * 3.1)) * 0.06;
        c = mix(c, white, smoothstep(0.8, 0.9, v + churn));
        c *= 1.0 - uLayer * 0.28;
        // sides: ragged, thinning, streak gaps see-through at the edges
        float side = min(vUv.x, 1.0 - vUv.x);
        float edge = smoothstep(0.0, 0.07 + n(vec2(vW.y * 0.9 + uTime * 2.0, vUv.x * 3.0)) * 0.08, side);
        float a = (0.8 + 0.2 * step(0.46, st)) * edge;
        gl_FragColor = vec4(c, a);
        #include <fog_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
}

/** Foam spreading on a pool under a fall: rings pushed outward, broken by noise, thinning with distance. */
function foamMaterial(uTime) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime, ...THREE.UniformsLib.fog },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vW;
      #include <fog_pars_vertex>
      void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec2 vUv; varying vec3 vW;
      #include <common>
      #include <fog_pars_fragment>
      ${NOISE}
      void main() {
        vec2 q = vUv * 2.0 - 1.0;
        float r = length(q);
        if (r > 1.0) discard;
        float ring = fract(r * 3.0 - uTime * 0.55);
        float br = n(vec2(atan(q.y, q.x) * 4.0, r * 5.0 - uTime * 0.8)) * 0.6 + n(vW.xz * 2.3 + uTime * 0.3) * 0.4;
        float foam = step(0.55, br * (1.0 - ring * 0.6)) * (1.0 - smoothstep(0.5, 1.0, r));
        foam = max(foam, 1.0 - smoothstep(0.2, 0.34, r + (br - 0.5) * 0.15)); // the white boil right under the curtain
        if (foam < 0.01) discard;
        gl_FragColor = vec4(vec3(0.93, 0.98, 1.0), foam * 0.9);
        #include <fog_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
}

/**
 * Mist rising off the pools: soft round puffs, one instanced draw for every fall, animated entirely in the vertex
 * shader (each puff rises, drifts out from the cliff, swells and fades on its own cycle).
 */
function buildMist(falls, uTime) {
  const per = 16, count = falls.length * per;
  const g = new THREE.PlaneGeometry(1, 1);
  const a = new Float32Array(count * 4), b = new Float32Array(count * 4);
  let k = 0;
  const r = mulberry32(606);
  for (const F of falls) {
    for (let i = 0; i < per; i++, k++) {
      a.set([F.x + (r() - 0.5) * F.w, F.bottom + 0.1, F.z + 0.6 + r() * 0.8, r()], k * 4);
      b.set([F.w * 0.32 + 0.6, r(), 0.4 + r() * 0.5, F.upper ? 0.7 : 1], k * 4);
    }
  }
  g.setAttribute('aA', new THREE.InstancedBufferAttribute(a, 4));
  g.setAttribute('aB', new THREE.InstancedBufferAttribute(b, 4));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime, ...THREE.UniformsLib.fog },
    vertexShader: /* glsl */ `
      attribute vec4 aA; attribute vec4 aB; uniform float uTime; varying vec2 vUv; varying float vA;
      #include <fog_pars_vertex>
      void main() {
        float t = fract(uTime * aB.z * 0.35 + aA.w);
        vec3 p = aA.xyz + vec3(sin(uTime * 0.7 + aA.w * 20.0) * 0.4, t * 2.6 * aB.w, t * 1.6);
        float size = (0.9 + t * 1.8) * aB.w * (0.8 + aB.y * 0.5);
        vec4 mvPosition = viewMatrix * vec4(p, 1.0);
        mvPosition.xy += position.xy * size;
        vA = smoothstep(0.0, 0.15, t) * (1.0 - smoothstep(0.55, 1.0, t)) * smoothstep(1.5, 4.0, -mvPosition.z);
        vUv = uv;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv; varying float vA;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        float r = length(vUv * 2.0 - 1.0);
        float a = (1.0 - smoothstep(0.35, 1.0, r)) * vA * 0.45;
        if (a < 0.01) discard;
        gl_FragColor = vec4(0.94, 0.98, 1.0, a);
        #include <fog_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  const m = new THREE.InstancedMesh(g, mat, count);
  m.frustumCulled = false;
  m.renderOrder = 3;
  return m;
}

export function buildRiver(map, mat) {
  const river = map.props.find((p) => p.t === 'river');
  const group = new THREE.Group();
  if (!river) return group;
  const L = river.line, hw = river.hw + 2.2;
  const pos = [], uv = [], idx = [];
  let dist = 0;
  for (let i = 0; i < L.length; i++) {
    const [x, z] = L[i];
    const [px, pz] = L[Math.max(0, i - 1)], [nx, nz] = L[Math.min(L.length - 1, i + 1)];
    let dx = nx - px, dz = nz - pz;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    if (i) dist += Math.hypot(x - L[i - 1][0], z - L[i - 1][1]);
    // the pool under the waterfall is wider
    const w = hw + (z < -38 ? 2.5 * Math.min(1, (-38 - z) / 6) : 0);
    pos.push(x + dz * w, WATER_Y, z - dx * w, x - dz * w, WATER_Y, z + dx * w);
    uv.push(0, dist * 0.12, 1, dist * 0.12);
    if (i) {
      const o = (i - 1) * 2;
      idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat.water);
  m.receiveShadow = false;
  m.renderOrder = 1;
  group.add(m);
  // the stream: one ribbon on the ridge (to the upper fall's lip), one on the ledge (its pool, to the lower fall)
  const st = map.props.find((p) => p.t === 'stream');
  const falls = map.props.filter((p) => p.t === 'waterfall');
  if (st) {
    const up = falls.find((F) => F.upper), lo = falls.find((F) => !F.upper);
    const path = smoothPath(st.pts, 0.5);
    const ridge = path.filter((p) => p[1] <= up.z - 0.3), ledge = path.filter((p) => p[1] >= up.z - 0.2 && p[1] <= lo.z - 0.3);
    const parts = [[ridge, st.ridge], [ledge, st.ledge]].filter(([pts]) => pts.length > 1).map(([pts, y]) => ribbon(pts, y, 0.35));
    const m2 = new THREE.Mesh(mergeGeometries(parts, false), mat.water);
    m2.renderOrder = 1;
    group.add(m2);
  }
  // the falls: a back layer (darker, slower) and the front curtain, foam on the pool, mist
  const uTime = mat.water.uniforms.uTime;
  const curtains = [], foams = [];
  group.userData.falls = [];
  for (const F of falls) {
    // the back layer first (drawn first within the one mesh: transparent, no depth write)
    for (const [back, layer] of [[0.18, 1], [0, 0]]) {
      const g = curtainGeometry(F, back);
      g.setAttribute('aLayer', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(layer), 1));
      curtains.push(g);
    }
    const H = F.top - F.bottom, zo = 0.15 + 0.3 * Math.sqrt(H);
    foams.push(new THREE.PlaneGeometry(F.w * 1.7, F.w * 1.25).rotateX(-Math.PI / 2).translate(F.x, F.bottom + 0.03, F.z + zo + 0.4));
    group.userData.falls.push({ x: F.x, y: F.bottom, z: F.z + zo + 0.3, w: F.w, upper: F.upper });
  }
  if (falls.length) {
    const c = new THREE.Mesh(mergeGeometries(curtains, false), fallMaterial(uTime));
    c.renderOrder = 2;
    const foam = new THREE.Mesh(mergeGeometries(foams, false), foamMaterial(uTime));
    foam.renderOrder = 2;
    group.add(c, foam);
  }
  if (falls.length) group.add(buildMist(falls.map((F) => ({ ...F, z: F.z + 0.15 + 0.3 * Math.sqrt(F.top - F.bottom) })), uTime));
  return group;
}

/** The bridge: planks on its collider boxes (deck and ramps), posts and hand rails. */
export function buildBridge(map, B, mat) {
  const br = map.props.find((p) => p.t === 'bridge');
  if (!br) return;
  const shapes = map.world.shapes.filter((s) => s.k === BOX && s.surf === SURF.wood && Math.abs(s.z - br.z) < 2 && Math.abs(s.x - br.x) < br.len / 2 + 4);
  for (const s of shapes) {
    const w = s.hx * 2, d = s.hz * 2;
    const n = Math.max(3, Math.round(w / 0.32));
    for (let k = 0; k < n; k++) {
      const lx = -s.hx + (k + 0.5) * (w / n);
      const top = s.y1 + s.sx * lx;
      B.add(mat.woodLight, boxUV(w / n - 0.03, 0.12, d, 1.5), M(s.x + lx, top - 0.06, s.z));
    }
    B.add(mat.timber, boxUV(w, 0.3, 0.2), M(s.x, s.y1 - 0.3, s.z - s.hz + 0.1, 0, 0, Math.atan(s.sx)));
    B.add(mat.timber, boxUV(w, 0.3, 0.2), M(s.x, s.y1 - 0.3, s.z + s.hz - 0.1, 0, 0, Math.atan(s.sx)));
  }
  // posts and rails along the deck
  const x0 = br.x - br.len / 2, n = 7;
  for (const sz of [-1, 1]) {
    for (let k = 0; k < n; k++) {
      const x = x0 + (k / (n - 1)) * br.len;
      B.add(mat.timber, boxUV(0.14, 1.3, 0.14), M(x, br.y + 0.5, br.z + sz * 1.5));
    }
    B.add(mat.timber, boxUV(br.len, 0.1, 0.1), M(br.x, br.y + 1.05, br.z + sz * 1.5));
    B.add(mat.timber, boxUV(br.len, 0.08, 0.08), M(br.x, br.y + 0.6, br.z + sz * 1.5));
  }
  // piers down into the water
  for (const sx of [-0.3, 0.3]) for (const sz of [-1, 1]) B.add(mat.timber, new THREE.CylinderGeometry(0.16, 0.18, 2.2, 8), M(br.x + sx * br.len, br.y - 1.2, br.z + sz * 1.2));
}
