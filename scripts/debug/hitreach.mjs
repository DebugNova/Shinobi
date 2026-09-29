// Does each move's hitbox reach a victim standing where the move expects it? For every move of a character (or the
// listed ones), the hitbox from its own clip on the real rig is swept over the active frames (half-frame samples, like
// Combat.detect) and measured against a victim's body axis: `gap` in front (step.track.gap), or where a warp puts it
// (`behind`: gap in front, `above`: back in front and `up` below the feet). Margin = hitbox r + body r - distance
// (> 0 connects; the deeper the surer). Also where along the victim's height the best contact is.
// usage: node scripts/debug/hitreach.mjs <url> [ids comma] ; CH=<id> (default itachi)
import puppeteer from 'puppeteer-core';

const [url, idsArg] = process.argv.slice(2);
const CH = process.env.CH || 'itachi';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 400, height: 300 });
page.on('pageerror', (e) => { if (!/Pointer Lock/.test(e.message)) console.log('PAGEERROR', e.message); });
await page.goto(`${url}?autojoin=1&pw=HUNNY&name=Reach&grass=0&ch=${CH}`, { waitUntil: 'load' });
await page.waitForFunction("window.__ready === true && window.__game.state === 'playing'", { timeout: 120000 });
const rows = await page.evaluate((idsArg) => {
  const g = __game, C = g.ctrl.C, ids = idsArg ? idsArg.split(',') : Object.keys(C.moves).filter((k) => /^(I|R|IA)\d/.test(k) || !/^(I|R|IA)\d/.test(Object.keys(C.moves)[0]));
  const V = g.player.pos.constructor, A = new V(), B = new V(), P0 = new V(), Q0 = new V();
  const inv = g.player.vrm.scene.matrixWorld.clone().invert();
  const BODY = 0.2; // the victim's torso capsule radius (hurtbox.js ~0.17) + a little for the limbs
  // closest distance between segments p0-p1 and q0-q1
  const segDist = (p0, p1, q0, q1) => {
    let best = 1e9, by = 0;
    for (let i = 0; i <= 20; i++) {
      const u = i / 20, px = p0.x + (p1.x - p0.x) * u, py = p0.y + (p1.y - p0.y) * u, pz = p0.z + (p1.z - p0.z) * u;
      const y = Math.max(q0.y, Math.min(q1.y, py));
      const d = Math.hypot(px - q0.x, py - y, pz - q0.z);
      if (d < best) { best = d; by = y; }
    }
    return [best, by];
  };
  const out = [];
  for (const id of ids) {
    const M = C.moves[id];
    if (!M) continue;
    const W = M.warp;
    const gz = W ? (W.to === 'behind' ? W.gap ?? 0.9 : W.back ?? 0.3) : M.step.track.gap;
    const up = W ? W.up || 0 : 0;
    const q0 = { x: 0, y: -up + 0.35, z: gz }, q1 = { x: 0, y: -up + 1.55, z: gz };
    let best = { m: -9, f: 0, y: 0 };
    let prevA = null, prevB = null;
    for (let f = M.startup; f < M.startup + M.active; f += 0.5) {
      g.combat.hitboxAt({ M }, Math.min(f, M.startup + M.active - 0.01), A, B);
      A.applyMatrix4(inv);
      B.applyMatrix4(inv);
      // the sweep between samples: the tip's and the base's paths too
      const cands = [[A, B]];
      if (prevA) cands.push([prevA, A], [prevB, B], [P0.copy(prevA).lerp(prevB, 0.5), Q0.copy(A).lerp(B, 0.5)]);
      for (const [p, q] of cands) {
        const [d, y] = segDist(p, q, q0, q1);
        const m = M.hit.box.r + BODY - d;
        if (m > best.m) best = { m, f, y: y + up };
      }
      prevA = A.clone();
      prevB = B.clone();
    }
    out.push(`${id.padEnd(4)} ${M.anim.padEnd(14)} margin ${best.m.toFixed(2)} m at f${best.f} (victim height ${best.y.toFixed(2)})  victim at z ${gz}${up ? ` ${-up} below` : ''}`);
  }
  return out;
}, idsArg);
for (const r of rows) console.log(r);
await browser.close();
