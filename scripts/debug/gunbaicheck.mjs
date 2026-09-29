// Madara's gunbai by the numbers (the pictures: gunbai.mjs; the draw's wrists: gunbaisolve.mjs).
// usage: node scripts/debug/gunbaicheck.mjs <url> <mode> [from,to,step frames of mad_counter]
//   back   his back surface (hair and robe) per 5 cm of height in the upper chest's frame: where the fan can rest
//   rate   per clip frame: the fan's turn (deg/frame) and travel, its hand weight: hitches at keys, pops at the hand-over
//   clear  per clip frame: the paddle's clearance from his skull (13 cm sphere) and torso (17 cm capsules)
//   poke   hair vertices through the fan at idle, running and jumping (past its inner face / out through the tomoe
//          face, by paddle row) and the spring joints' depth in the fan's frame. PASS = none out through the face.
//   env: BACK='{"p":..,"up":..,"face":..}' tries another mount first
import puppeteer from 'puppeteer-core';

const [url, mode = 'poke', range] = process.argv.slice(2);
if (!url) {
  console.log('usage: node scripts/debug/gunbaicheck.mjs <url> back|rate|clear|poke [from,to,step]');
  process.exit(1);
}
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage();
p.on('pageerror', (e) => { if (!/Pointer Lock/.test(e.message)) console.log('PAGEERROR', e.message); });
await p.goto(url, { waitUntil: 'load' });
await p.waitForFunction("window.__ready === true && window.__game.state === 'playing'", { timeout: 120000 });
await new Promise((r) => setTimeout(r, 800));
await p.evaluate((back) => {
  const g = __game;
  g.teleport(-44, 50, 0);
  if (back) g.jutsu.madara.debugGunbai(JSON.parse(back));
  const fill = g.fillView.bind(g);
  window.__wb = null;
  g.fillView = (v, c) => {
    fill(v, c);
    if (window.__wb !== null) v.act = { clip: 'mad_counter', t: window.__wb / 60, key: 'wb' };
  };
}, process.env.BACK || '');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = async (def, fn) => {
  const [a, z, st] = (range || def).split(',').map(Number);
  for (let fr = a; fr <= z + 1e-6; fr += st) {
    await p.evaluate((fr) => { window.__wb = fr; }, fr);
    await wait(120);
    await fn(fr, st);
  }
};

if (mode === 'back') {
  await wait(1500);
  const rows = await p.evaluate(() => {
    const f = __game.player, vrm = f.vrm, V = f.root.position.constructor;
    const chest = vrm.humanoid.getNormalizedBoneNode('upperChest'), inv = chest.matrixWorld.clone().invert(), rootY = f.root.getWorldPosition(new V()).y;
    const bands = {}, v = new V();
    vrm.scene.traverse((o) => {
      if (!o.isMesh) return;
      const P = o.geometry.attributes.position;
      for (let i = 0; i < P.count; i++) {
        o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld);
        const y = Math.round((v.y - rootY) * 20) / 20;
        v.applyMatrix4(inv);
        const e = (bands[`${o.name}:${y.toFixed(2)}`] ||= { mesh: o.name, y, z: 9, x0: 9, x1: -9 });
        e.z = Math.min(e.z, v.z); e.x0 = Math.min(e.x0, v.x); e.x1 = Math.max(e.x1, v.x);
      }
    });
    return Object.values(bands).sort((a, c) => a.mesh.localeCompare(c.mesh) || c.y - a.y);
  });
  for (const r of rows) console.log(r.mesh.padEnd(10), 'y', r.y.toFixed(2), ' rearmost z', r.z.toFixed(3), ' x', r.x0.toFixed(3), '..', r.x1.toFixed(3));
} else if (mode === 'rate') {
  let prev = null;
  await frames('2,90,1', async (fr, st) => {
    const r = await p.evaluate(() => {
      const f = __game.player, G = __game.jutsu.madara.gunbaiOf.get(f), m = G.mesh;
      const Qs = f.vrm.scene.getWorldQuaternion(m.quaternion.clone()).invert(), Ps = f.vrm.scene.getWorldPosition(m.position.clone());
      const q = m.quaternion.clone(), pp = m.position.clone(), s = m.position.clone();
      m.matrixWorld.decompose(pp, q, s);
      return { q: Qs.clone().multiply(q).toArray(), p: pp.sub(Ps).applyQuaternion(Qs).toArray(), w: G.w };
    });
    if (prev) {
      const d = Math.abs(r.q.reduce((s, x, i) => s + x * prev.q[i], 0));
      const ang = (2 * Math.acos(Math.min(1, d)) * 180) / Math.PI / st, mv = Math.hypot(...r.p.map((x, i) => x - prev.p[i])) / st;
      console.log(`${fr.toFixed(1).padStart(5)}  w ${r.w.toFixed(2)}  ${ang.toFixed(1).padStart(5)} deg/f  ${mv.toFixed(3)} m/f  neck ${r.p.map((x) => x.toFixed(2)).join(',')}`);
    }
    prev = r;
  });
} else if (mode === 'clear') {
  await frames('4,32,1', async (fr) => {
    console.log(String(fr).padStart(3), await p.evaluate(() => {
      const f = __game.player, G = __game.jutsu.madara.gunbaiOf.get(f), H = f.vrm.humanoid, V = f.root.position.constructor;
      const bone = (n) => H.getNormalizedBoneNode(n).getWorldPosition(new V());
      const head = bone('head').add(new V(0, 0.12, 0)), segs = [[bone('hips'), bone('upperChest')], [bone('upperChest'), bone('neck')]];
      const segD = (q, [a, c]) => { const ab = c.clone().sub(a), t = Math.max(0, Math.min(1, q.clone().sub(a).dot(ab) / ab.lengthSq())); return q.distanceTo(a.clone().addScaledVector(ab, t)); };
      let dh = 9, dt = 9, wh = '', wt = '';
      const q = new V();
      for (let y = -0.1; y <= 0.66; y += 0.04) for (let x = -0.24; x <= 0.24; x += 0.04) {
        if (Math.abs(x) > (y < 0.14 ? 0.19 : y < 0.3 ? 0.17 : 0.25)) continue; // roughly the outline
        G.point(x, y, 0, q);
        const d1 = q.distanceTo(head) - 0.13, d2 = Math.min(...segs.map((s) => segD(q, s))) - 0.17;
        if (d1 < dh) { dh = d1; wh = `${x.toFixed(2)},${y.toFixed(2)}`; }
        if (d2 < dt) { dt = d2; wt = `${x.toFixed(2)},${y.toFixed(2)}`; }
      }
      return `w ${G.w.toFixed(2)}  head ${dh.toFixed(3)} (paddle ${wh})  torso ${dt.toFixed(3)} (paddle ${wt})`;
    }));
  });
} else {
  const measure = () => p.evaluate(() => {
    const f = __game.player, G = __game.jutsu.madara.gunbaiOf.get(f);
    let hair = null;
    f.vrm.scene.traverse((o) => { if (o.isMesh && !hair && o.material?.[0]?.name?.startsWith('mat0') !== false && o.name === 'Body_1') hair = o; });
    const inv = G.mesh.matrixWorld.clone().invert(), v = G.mesh.position.clone(), P = hair.geometry.attributes.position, rows = {};
    let over = 0, inner = 0, out = 0, max = 0;
    for (let i = 0; i < P.count; i++) {
      hair.getVertexPosition(i, v).applyMatrix4(hair.matrixWorld).applyMatrix4(inv);
      if (v.y < -0.12 || v.y > 0.66 || Math.abs(v.x) > (v.y < 0.14 ? 0.19 : v.y < 0.3 ? 0.17 : 0.25)) continue;
      over++;
      if (v.z > -0.0067) inner++; // into the paddle (hidden)
      if (v.z > 0.004) { out++; max = Math.max(max, v.z); const k = v.y.toFixed(1); rows[k] = (rows[k] || 0) + 1; } // out through the tomoe face
    }
    const js = [...f.vrm.springBoneManager.joints].map((j) => +j.bone.getWorldPosition(v.clone()).applyMatrix4(inv).z.toFixed(3));
    return { s: `over the paddle ${over}, into it ${inner}, out through the face ${out} (max ${max.toFixed(3)}) rows ${JSON.stringify(rows)} joints z ${js}`, out };
  });
  let worst = 0;
  const log = async (tag) => { const r = await measure(); worst = Math.max(worst, r.out); console.log(tag.padEnd(8), r.s); };
  await wait(1500);
  await log('idle');
  await p.evaluate(() => __game.hold(['up']));
  for (let i = 0; i < 14; i++) { await wait(110); await log(`run ${i}`); }
  await p.evaluate(() => __game.hold(['up', 'jump']));
  for (let i = 0; i < 8; i++) { await wait(110); await log(`jump ${i}`); }
  console.log(worst ? `FAIL: up to ${worst} hair vertices out through the fan` : 'PASS: no hair through the fan');
}
await b.close();
