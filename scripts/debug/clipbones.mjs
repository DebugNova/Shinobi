// Where a keyed clip really puts the wrists, ankles and head at given frames on a character's rig (fighter frame:
// +x its left, +z forward, feet at 0; the model's own metres), plus the move's hitbox segment when the clip belongs to a
// move. Numbers, not pictures: check a key reached its target (IK can't: out of reach, a flipped pole).
// usage: node scripts/debug/clipbones.mjs <url> <clip|moveId> [frames=0,5,10...] ; CH=<id> (default itachi)
import puppeteer from 'puppeteer-core';

const [url, name, framesArg] = process.argv.slice(2);
const CH = process.env.CH || 'itachi';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 400, height: 300 });
page.on('pageerror', (e) => { if (!/Pointer Lock/.test(e.message)) console.log('PAGEERROR', e.message); });
await page.goto(`${url}?autojoin=1&pw=HUNNY&name=Bones&grass=0&ch=${CH}`, { waitUntil: 'load' });
await page.waitForFunction("window.__ready === true && window.__game.state === 'playing'", { timeout: 120000 });
const rows = await page.evaluate((name, framesArg) => {
  const g = __game, a = g.player.anim, rig = a.rig, BI = __BI;
  const M = g.ctrl.C.moves[name], clip = a.lib.get(M ? M.anim : name);
  const pose = new a.pose.constructor(), n = Math.round(clip.dur * 60);
  const frames = framesArg ? framesArg.split(',').map(Number) : Array.from({ length: Math.floor(n / 3) + 1 }, (_, i) => i * 3);
  const V = g.player.pos.constructor, A = new V(), B = new V();
  const f3 = (v) => v.toArray().map((x) => x.toFixed(2)).join(',');
  const out = [];
  for (const f of frames) {
    clip.sample(f / 60, pose, rig.hipsY);
    rig.fk(pose);
    const row = { f, hips: f3(rig.P[BI.hips]), head: f3(rig.P[BI.head]), lh: f3(rig.P[BI.leftHand]), rh: f3(rig.P[BI.rightHand]), lf: f3(rig.P[BI.leftFoot]), rf: f3(rig.P[BI.rightFoot]) };
    if (M) {
      // the hitbox in the fighter frame (hitboxAt gives world: undo the drawn root)
      g.combat.hitboxAt({ M }, f, A, B);
      const inv = g.player.vrm.scene.matrixWorld.clone().invert();
      A.applyMatrix4(inv);
      B.applyMatrix4(inv);
      row.box = `${f3(A)} -> ${f3(B)}${f >= M.startup && f < M.startup + M.active ? ' ACTIVE' : ''}`;
    }
    out.push(row);
  }
  return out;
}, name, framesArg);
for (const r of rows) console.log(Object.entries(r).map(([k, v]) => `${k} ${v}`).join(' | '));
await browser.close();
