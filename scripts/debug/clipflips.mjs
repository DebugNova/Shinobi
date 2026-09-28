// Keyed clips checked for flips: every bone sampled at quarter frames; a quarter-frame rotation over LIM degrees
// that is also 3x its neighbours is a flip (two keys ~180 degrees apart in some bone: nlerp snaps through).
// usage: node scripts/debug/clipflips.mjs [clip ids, comma separated; default: every keyed clip] [LIM=8]
import { Rig, Pose, BONES, NB } from '../../src/char/rig.js';
import { MOVE_CLIPS } from '../../src/char/moves.js';
import { bakeClip } from '../../src/char/keyframes.js';
const ids = process.argv[2] ? process.argv[2].split(',') : Object.keys(MOVE_CLIPS);
const LIM = +(process.argv[3] || 8);
const rig = new Rig(), H0 = 0.9;
let bad = 0;
for (const id of ids) {
  const c = bakeClip(rig, id, MOVE_CLIPS[id], H0);
  const n = Math.round(c.dur * 60 * 4);
  const poses = [];
  for (let i = 0; i <= n; i++) { const p = new Pose(); c.sample(i / 240, p, rig.hipsY); poses.push(p); }
  const hits = [];
  for (let b = 0; b < NB; b++) {
    if (!rig.has[b] || /Proximal|Intermediate|Distal|Metacarpal/.test(BONES[b])) continue;
    const d = [];
    for (let i = 1; i <= n; i++) {
      const a = poses[i - 1].q, q = poses[i].q, o = b * 4;
      const dot = Math.min(1, Math.abs(a[o] * q[o] + a[o + 1] * q[o + 1] + a[o + 2] * q[o + 2] + a[o + 3] * q[o + 3]));
      d.push((2 * Math.acos(dot) * 180) / Math.PI);
    }
    for (let i = 1; i < d.length - 1; i++) if (d[i] > LIM && d[i] > 3 * Math.max(d[i - 1], d[i + 1])) hits.push(`${BONES[b]} f${(i / 4).toFixed(2)} ${d[i].toFixed(1)} deg (${d[i - 1].toFixed(1)}, ${d[i + 1].toFixed(1)})`);
  }
  if (hits.length) { bad++; console.log(id); for (const h of hits) console.log('   ', h); }
}
console.log(bad ? `${bad} clip(s) with flips` : `no flips in ${ids.length} clips`);
