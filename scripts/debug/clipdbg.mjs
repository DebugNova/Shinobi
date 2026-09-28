import { Rig, Pose, BI } from '../../src/char/rig.js';
import { MOVE_CLIPS } from '../../src/char/moves.js';
import { bakeClip, buildPose, STANCE } from '../../src/char/keyframes.js';
const rig = new Rig();
const H0 = 0.9;
const c = bakeClip(rig, 'jab', MOVE_CLIPS.jab, H0);
const p = new Pose();
for (const f of [0, 6, 8]) {
  c.sample(f / 60, p, rig.hipsY);
  rig.fk(p);
  const f3 = (v) => v.toArray().map((x) => +x.toFixed(2));
  console.log(f, 'Lelbow', f3(rig.P[BI.leftLowerArm]), 'Lhand', f3(rig.P[BI.leftHand]), 'Relbow', f3(rig.P[BI.rightLowerArm]), 'Rhand', f3(rig.P[BI.rightHand]));
}
const q = buildPose(rig, new Pose(), { ...STANCE, lh: { p: [0.07, 1.31, 0.66], pole: [1, -0.4, -0.2] } }, H0);
rig.fk(q);
console.log('direct', rig.P[BI.leftHand].toArray().map((x) => +x.toFixed(2)), 'shoulder', rig.P[BI.leftUpperArm].toArray().map((x) => +x.toFixed(2)));
