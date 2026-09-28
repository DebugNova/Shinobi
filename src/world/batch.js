// Static batching: every static piece of the arena is added as (material, world-space geometry); build() merges each
// material's pieces into one mesh, so the whole map costs a few dozen draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export class Batch {
  constructor() {
    this.parts = new Map(); // material -> [geometry]
  }

  /** geometry in world space (a matrix bakes it); every piece gets position/normal/uv. */
  add(mat, geo, matrix = null) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    // vertex colours only for materials that use them (every piece merged into one then needs them: white if unpainted)
    if (mat.vertexColors && !g.attributes.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
    const keep = mat.vertexColors ? ['position', 'normal', 'uv', 'color'] : ['position', 'normal', 'uv'];
    for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k);
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(g);
  }

  build(group, { cast = true, receive = true } = {}) {
    const meshes = [];
    for (const [mat, list] of this.parts) {
      if (!list.length) continue;
      const g = mergeGeometries(list, false);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.castShadow = cast && !mat.userData.noShadow;
      m.receiveShadow = receive;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      group.add(m);
      meshes.push(m);
    }
    this.parts.clear();
    return meshes;
  }
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();

/** A world matrix from position, Euler rotation (radians, YXZ) and scale. */
export function M(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _e.set(rx, ry, rz, 'YXZ');
  return _m.compose(_p.set(x, y, z), _q.setFromEuler(_e), _s.set(sx, sy, sz)).clone();
}

/** Box geometry with UVs in metres (u along x/z, v along y) so painted textures keep their scale. */
export function boxUV(w, h, d, scale = 1) {
  const g = new THREE.BoxGeometry(w, h, d);
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (ny > 0.5) uv.setXY(i, x * scale, z * scale);
    else if (nx > 0.5) uv.setXY(i, z * scale, y * scale);
    else uv.setXY(i, x * scale, y * scale);
  }
  return g;
}
