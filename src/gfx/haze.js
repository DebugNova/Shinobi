// Heat haze: a screen-space shimmer over hot areas (the fire torrent, the burning field). Up to 4 spheres, projected on
// the CPU each frame to screen circles; inside them the pass samples the scene through a rising, wobbling offset. It
// only bends UVs (mainUv), so it merges into the post stack's first EffectPass at the cost of a few ALU per pixel;
// strength 0 turns it off (Low/Medium never set any).
import * as THREE from 'three';
import { Effect } from 'postprocessing';

const N = 4;
const frag = /* glsl */ `
uniform vec4 uHaze[${N}];
uniform float uTime;
void mainUv(inout vec2 uv) {
  vec2 off = vec2(0.0);
  for (int i = 0; i < ${N}; i++) {
    vec4 h = uHaze[i];
    if (h.w <= 0.0) continue;
    vec2 d = (uv - h.xy) * vec2(aspect, 1.0);
    float k = 1.0 - smoothstep(h.z * 0.35, h.z, length(d));
    if (k <= 0.0) continue;
    vec2 q = uv * vec2(aspect, 1.0) * 55.0 + vec2(0.0, -uTime * 5.0);
    off += vec2(sin(q.y + sin(q.x * 0.7) * 1.7), cos(q.x * 0.8 + q.y * 0.45)) * k * h.w;
  }
  uv += off * 0.0024;
}`;

export class HazeEffect extends Effect {
  constructor() {
    super('HeatHaze', frag, {
      uniforms: new Map([
        ['uHaze', new THREE.Uniform(Array.from({ length: N }, () => new THREE.Vector4()))],
        ['uTime', new THREE.Uniform(0)],
      ]),
    });
    this.list = []; // this frame's spheres: { x, y, z, r, s }
    this._v = new THREE.Vector3();
  }

  /** Queues a hot sphere for this frame (world centre, radius m, strength 0..1). */
  add(x, y, z, r, s) {
    if (this.list.length < N && s > 0.01) this.list.push({ x, y, z, r, s });
  }

  /** Projects the queued spheres for `camera` and clears the queue (call once per frame before rendering). */
  apply(camera, dt, enabled) {
    const u = this.uniforms.get('uHaze').value;
    this.uniforms.get('uTime').value += dt;
    const cp = camera.position;
    for (let i = 0; i < N; i++) {
      const h = enabled ? this.list[i] : null;
      u[i].set(0, 0, 0, 0);
      if (!h) continue;
      const v = this._v.set(h.x, h.y, h.z).project(camera);
      if (v.z > 1 || v.z < -1) continue;
      const dist = Math.max(1, Math.hypot(h.x - cp.x, h.y - cp.y, h.z - cp.z));
      // screen radius (fraction of the screen height) of a sphere of radius r at that distance
      const rs = h.r / (dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / 2;
      // fades out far away (tiny on screen) and very close (it would fill the view)
      const s = h.s * Math.min(1, 40 / dist) * Math.min(1, dist / 3);
      u[i].set((v.x + 1) / 2, (v.y + 1) / 2, Math.min(1.2, rs), s);
    }
    this.list.length = 0;
  }
}
