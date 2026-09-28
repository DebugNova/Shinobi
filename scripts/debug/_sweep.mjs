import puppeteer from 'puppeteer-core';
const [url, baseJson, key, candJson] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11'] });
const p = await b.newPage();
await p.goto(url); await p.waitForFunction("window.__ready === true && window.__game.state === 'playing'", { timeout: 120000 });
const res = await p.evaluate(async (base, key, cands) => {
  const g = __game, K = __kf, f = g.player, a = f.anim, rig = a.rig; g.teleport(-30, 44, 0);
  const out = [];
  for (const c of cands) {
    const spec = JSON.parse(JSON.stringify(base)); spec[key] = { ...spec[key], ...c };
    const full = K.merge(K.STANCE, spec);
    a.debugPose = (pose) => K.buildPose(rig, pose, full, K.H0(rig));
    await new Promise((r) => setTimeout(r, 120));
    const inv = f.root.matrixWorld.clone().invert(), o = {};
    for (const bn of ['head', 'rightHand', 'rightIndexDistal', 'rightMiddleProximal', 'leftHand', 'leftIndexDistal']) {
      const q = f.vrm.humanoid.getRawBoneNode(bn).getWorldPosition(new f.pos.constructor()).applyMatrix4(inv);
      o[bn] = [-q.x, q.y, -q.z].map((v) => +v.toFixed(3));
    }
    out.push({ c: JSON.stringify(c), ...o });
  }
  return out;
}, JSON.parse(baseJson), key, JSON.parse(candJson));
for (const r of res) console.log(r.c, 'head', r.head, 'hand', r.rightHand ?? '', 'tip', r.rightIndexDistal, '| L', r.leftHand, r.leftIndexDistal);
await b.close();
