// The clip library: Mixamo mocap converted by `npm run anims` (public/assets/anims/clips.json) plus the hand-keyed
// clips baked from src/char/authored.js. Every clip is a set of per-bone quaternion tracks in normalized space and a
// hips track (fractions of the source rig's hips height), sampled into a Pose.
import { BI, NB } from './rig.js';

export const CLIPS_URL = '/assets/anims/clips.json';

export class Clip {
  /**
   * id, dur (s), n frames at fps, tracks: Map boneIndex -> Float32Array (n*4 or 4), hips: Float32Array (n*3) as
   * fractions of the hips height, loop, speed (m/s for a rig with hips height hy), phase0, meta.
   */
  constructor(o) {
    Object.assign(this, o);
    this.fps ||= 30;
    this.bones = [...this.tracks.keys()];
  }

  /**
   * Samples time t (s) into pose (overwrites the bones this clip animates; the others are left alone).
   * hipsY = the target model's rest hips height (metres).
   */
  sample(t, pose, hipsY) {
    const n = this.n;
    let f = t * this.fps;
    if (this.loop) {
      f %= n - 1;
      if (f < 0) f += n - 1;
    } else f = Math.max(0, Math.min(n - 1, f));
    const i0 = Math.floor(f), i1 = Math.min(n - 1, i0 + 1), k = f - i0;
    const q = pose.q;
    for (let b = 0; b < this.bones.length; b++) {
      const bi = this.bones[b];
      const v = this.tracks.get(bi);
      const o = bi * 4;
      if (v.length === 4) {
        q[o] = v[0];
        q[o + 1] = v[1];
        q[o + 2] = v[2];
        q[o + 3] = v[3];
        continue;
      }
      const a = i0 * 4, c = i1 * 4;
      let bx = v[c], by = v[c + 1], bz = v[c + 2], bw = v[c + 3];
      if (v[a] * bx + v[a + 1] * by + v[a + 2] * bz + v[a + 3] * bw < 0) {
        bx = -bx;
        by = -by;
        bz = -bz;
        bw = -bw;
      }
      const x = v[a] + (bx - v[a]) * k, y = v[a + 1] + (by - v[a + 1]) * k, z = v[a + 2] + (bz - v[a + 2]) * k, w = v[a + 3] + (bw - v[a + 3]) * k;
      const l = 1 / Math.sqrt(x * x + y * y + z * z + w * w);
      q[o] = x * l;
      q[o + 1] = y * l;
      q[o + 2] = z * l;
      q[o + 3] = w * l;
    }
    if (this.hips) {
      const h = this.hips, a = i0 * 3, c = i1 * 3;
      pose.h[0] = (h[a] + (h[c] - h[a]) * k) * hipsY;
      pose.h[1] = (h[a + 1] + (h[c + 1] - h[a + 1]) * k) * hipsY;
      pose.h[2] = (h[a + 2] + (h[c + 2] - h[a + 2]) * k) * hipsY;
    }
    return pose;
  }

  /** Ground speed of this clip on a model with the given hips height (m/s). */
  speedFor(hipsY) {
    return (this.speed || 0) * (hipsY / (this.hy || 1));
  }
}

export class ClipLibrary {
  constructor() {
    this.clips = new Map();
  }

  /** Parses clips.json (already fetched as an ArrayBuffer or object). */
  loadJSON(json) {
    const j = typeof json === 'string' ? JSON.parse(json) : json;
    for (const [id, c] of Object.entries(j.clips)) {
      const tracks = new Map();
      for (const [bone, v] of Object.entries(c.q)) {
        const i = BI[bone];
        if (i === undefined) continue;
        tracks.set(i, Float32Array.from(v));
      }
      this.clips.set(id, new Clip({
        id, dur: c.dur, n: c.n, fps: j.fps, tracks, hips: Float32Array.from(c.h), loop: c.loop, speed: c.speed, hy: c.hy,
        dir: c.dir, phase0: c.phase0, foot: c.foot, src: c.src, mocap: true,
      }));
    }
    return this;
  }

  /** Adds (or keeps, when a mocap clip of that id already exists and `override` is false) a clip. */
  add(clip, override = false) {
    if (!override && this.clips.has(clip.id) && this.clips.get(clip.id).mocap) return;
    this.clips.set(clip.id, clip);
  }

  get(id) {
    return this.clips.get(id) || null;
  }

  has(id) {
    return this.clips.has(id);
  }
}

export { NB };
