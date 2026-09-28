// The river: a ribbon following the map's centreline, drawn with a stylized water shader (flat colour bands from the
// deep middle to the shallow banks, animated foam lines along the edges and round the stepping stones, toon glints,
// drifting ripple lines); the waterfall off the ledge; the wooden bridge (its planks follow the colliders exactly).
import * as THREE from 'three';
import { WATER_Y } from '../shared/map.js';
import { BOX } from '../shared/collide.js';
import { SURF } from '../shared/config.js';
import { M, boxUV } from './batch.js';

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
  // the waterfall: a curtain in front of the ledge's rock face
  const wf = map.props.find((p) => p.t === 'waterfall');
  if (wf) {
    const h = wf.top - wf.bottom + 0.3;
    const fg = new THREE.PlaneGeometry(wf.w, h, 1, 8);
    const fm = new THREE.ShaderMaterial({
      uniforms: { uTime: mat.water.uniforms.uTime },
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; vec3 p = position; p.z += (1.0 - uv.y) * (1.0 - uv.y) * 0.9; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
      fragmentShader: /* glsl */ `uniform float uTime; varying vec2 vUv;
        float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
          float col = floor(vUv.x * 26.0);
          float speed = 2.2 + h(vec2(col, 1.0)) * 1.5;
          float s = fract(vUv.y * 1.5 + uTime * speed + h(vec2(col, 3.0)));
          vec3 c = mix(vec3(0.35, 0.7, 0.9), vec3(0.92, 0.97, 1.0), step(0.55, s));
          c = mix(c, vec3(1.0), smoothstep(0.12, 0.0, vUv.y) + smoothstep(0.93, 1.0, vUv.y) * 0.6);
          float edge = smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x);
          gl_FragColor = vec4(c, 0.9 * edge);
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const f = new THREE.Mesh(fg, fm);
    f.position.set(wf.x, wf.bottom + h / 2 - 0.15, wf.z + 0.9);
    f.renderOrder = 2;
    group.add(f);
    group.userData.fall = { x: wf.x, y: wf.bottom, z: wf.z + 1.8, w: wf.w };
  }
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
