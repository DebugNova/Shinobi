// Static batching: every static piece of the arena is added as (material, world-space geometry); build() merges the
// pieces per material, so the whole map costs a few dozen draw calls. Draw calls are what the CPU pays for (~25 us
// each with the toon materials' uniforms: the frame is CPU-bound), triangles are cheap on the GPU, so a material
// is split into square cells (frustum-culled) only when asked (`mat.userData.cell` or o.cell: big spread-out sets).
// Small clutter (`far`: flowers, pebbles, window boxes) goes into cells hidden beyond that distance (Batch.cull,
// every frame; it casts no shadow, so the cached static shadow map never misses it).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const _c = new THREE.Vector3();

export class Batch {
  /** cell: the chunk size in metres; detailCell: the chunk size of distance-culled pieces. */
  constructor({ cell = Infinity, detailCell = 36 } = {}) {
    this.parts = new Map(); // key -> { mat, far, list: [geometry] }
    this.cell = cell;
    this.detailCell = detailCell;
  }

  /**
   * geometry in world space (a matrix bakes it); every piece gets position/normal/uv. o.far: hide the piece beyond
   * this many metres from the camera (and no shadow); o.cell: its own chunk size (Infinity: never split).
   */
  add(mat, geo, matrix = null, o = null) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    // a flat-coloured material folded into the palette: its colour becomes the piece's vertex colour (one draw less)
    const into = mat.userData.palette;
    if (into) {
      const c = new Float32Array(g.attributes.position.count * 3);
      for (let i = 0; i < c.length; i += 3) c.set([mat.color.r, mat.color.g, mat.color.b], i);
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      mat = into;
    }
    if (matrix) g.applyMatrix4(matrix);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    // vertex colours only for materials that use them (every piece merged into one then needs them: white if unpainted)
    if (mat.vertexColors && !g.attributes.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
    const keep = mat.vertexColors ? ['position', 'normal', 'uv', 'color'] : ['position', 'normal', 'uv'];
    for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k);
    const far = o?.far || 0;
    const cs = o?.cell ?? mat.userData.cell ?? (far ? this.detailCell : this.cell);
    let key = `${mat.uuid}|${far}`;
    if (cs < Infinity) {
      g.computeBoundingBox();
      g.boundingBox.getCenter(_c);
      key += `|${Math.floor(_c.x / cs)}|${Math.floor(_c.z / cs)}`;
    }
    let p = this.parts.get(key);
    if (!p) this.parts.set(key, (p = { mat, far, list: [] }));
    p.list.push(g);
  }

  build(group, { cast = true, receive = true } = {}) {
    const meshes = [];
    for (const { mat, far, list } of this.parts.values()) {
      if (!list.length) continue;
      const g = mergeGeometries(list, false);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.castShadow = cast && !far && !mat.userData.noShadow;
      m.receiveShadow = receive;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      if (far) {
        m.userData.far = far;
        (group.userData.far ||= []).push(m);
      }
      group.add(m);
      meshes.push(m);
    }
    this.parts.clear();
    return meshes;
  }

  /** Hides the distance-culled chunks of `list` (meshes with userData.far) beyond their distance from `pos`. */
  static cull(list, pos) {
    if (!list) return;
    for (const m of list) {
      const s = m.geometry.boundingSphere, r = m.userData.far + s.radius;
      m.visible = s.center.distanceToSquared(pos) < r * r;
    }
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
