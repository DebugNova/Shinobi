// Solves the right hand's keys of Madara's Uchiha Return on his real rig: for each listed clip frame, the wrist Euler
// (keyframes.js `wrist`, degrees YXZ) that makes the fist hold the gunbai at a wanted orientation, and for `back`
// frames also how far the hand target must move (key units: reference-body metres) so the fist closes on the handle
// exactly where the fan rides on his back (a seamless grab / release). Also prints how far the IK fell short.
// usage: node scripts/debug/gunbaisolve.mjs <url> '[[frame, "back"|degrees], ...]'
//   degrees: the back orientation turned that far about his side axis (+ = the paddle swings out behind him and up);
//   a list of degrees scans them (pick the most natural wrist)
import puppeteer from 'puppeteer-core';

const [url, specArg = '[[5,"back"],[9,60],[12,180]]'] = process.argv.slice(2);
const spec = JSON.parse(specArg);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage();
p.on('pageerror', (e) => { if (!/Pointer Lock/.test(e.message)) console.log('PAGEERROR', e.message); });
await p.goto(url, { waitUntil: 'load' });
await p.waitForFunction("window.__ready === true && window.__game.state === 'playing'", { timeout: 120000 });
await new Promise((r) => setTimeout(r, 800));
await p.evaluate(() => {
  const g = __game;
  g.teleport(-44, 50, 0);
  const fill = g.fillView.bind(g);
  window.__wb = null;
  g.fillView = (v, c) => {
    fill(v, c);
    if (window.__wb !== null) v.act = { clip: 'mad_counter', t: window.__wb / 60, key: 'wb' };
  };
});
const flat = [];
for (const [fr, want] of spec) for (const w of Array.isArray(want) ? want : [want]) flat.push([fr, w]);
for (const [fr, want] of flat) {
  await p.evaluate((fr) => { window.__wb = fr; }, fr);
  await new Promise((r) => setTimeout(r, 600));
  const r = await p.evaluate((want) => {
    const g = __game, f = g.player, K = g.jutsu.madara, G = K.gunbaiOf.get(f);
    const V = f.root.position.constructor, Q = f.root.quaternion.constructor;
    const H = f.vrm.humanoid, la = H.getNormalizedBoneNode('rightLowerArm'), hand = H.getRawBoneNode('rightHand');
    const Qs = f.vrm.scene.getWorldQuaternion(new Q()), Ps = f.vrm.scene.getWorldPosition(new V()), s = f.vrm.scene.getWorldScale(new V()).x;
    const P0 = new V(), Q0 = new Q(), P1 = new V(), Q1 = new Q();
    G.pose(0, P0, Q0);
    G.pose(1, P1, Q1);
    let Qd;
    if (want === 'back') Qd = Q0.clone();
    else {
      const R = new Q().setFromAxisAngle(new V(1, 0, 0), (want * Math.PI) / 180);
      Qd = Qs.clone().multiply(R).multiply(Qs.clone().invert()).multiply(Q0);
    }
    const Qla = la.getWorldQuaternion(new Q());
    const Qh = Qd.clone().multiply(G.gripQ.clone().invert());
    const local = Qla.clone().invert().multiply(Qh);
    const E = new (f.root.rotation.constructor)().setFromQuaternion(local, 'YXZ');
    const deg = [E.x, E.y, E.z].map((a) => +((a * 180) / Math.PI).toFixed(1));
    // with that wrist: where the neck would be
    const Ph = hand.getWorldPosition(new V()), hs = hand.getWorldScale(new V()).x;
    const fist = G.fist.clone().multiplyScalar(hs).applyQuaternion(Qh).add(Ph);
    const neck = fist.clone().addScaledVector(new V(0, 1, 0).applyQuaternion(Qd), 0.27);
    const toKey = (w) => w.clone().applyQuaternion(Qs.clone().invert()).divideScalar(s);
    const kA = f.anim.rig.armLen / 0.4345;
    const e = toKey(P0.clone().sub(neck)).divideScalar(kA);
    const wristLocal = toKey(Ph.clone().sub(Ps));
    // the fan now vs wanted: angle
    const ang = +((2 * Math.acos(Math.min(1, Math.abs(Q1.dot(Qd))))) * 180 / Math.PI).toFixed(1);
    // the paddle's far end and its middle in the key frame (clearance checks)
    const tip = toKey(new V(0, 0.62, 0).applyQuaternion(Qd).add(want === 'back' ? P0 : neck).sub(Ps));
    return { wrist: deg, move: want === 'back' ? e.toArray().map((x) => +x.toFixed(3)) : null, fanOffNow: ang, wristAt: wristLocal.toArray().map((x) => +x.toFixed(3)), paddleEnd: tip.toArray().map((x) => +x.toFixed(2)), kA: +kA.toFixed(3) };
  }, want);
  console.log(fr, want, JSON.stringify(r));
}
await b.close();
