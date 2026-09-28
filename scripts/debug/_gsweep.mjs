import puppeteer from 'puppeteer-core';
const [url, baseJson, candJson] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11'] });
const p = await b.newPage();
await p.goto(url); await p.waitForFunction("window.__ready === true && window.__game.state === 'playing'", { timeout: 120000 });
const res = await p.evaluate(async (base, cands) => {
  const g = __game, K = __kf, f = g.player, a = f.anim, rig = a.rig; g.teleport(-30, 44, 0);
  g.jutsu.madara.forceGunbai = true;
  const out = [];
  for (const c of cands) {
    const spec = JSON.parse(JSON.stringify(base)); spec.rh = { ...spec.rh, ...c };
    const full = K.merge(K.STANCE, spec);
    a.debugPose = (pose) => K.buildPose(rig, pose, full, K.H0(rig));
    await new Promise((r) => setTimeout(r, 150));
    const G = g.jutsu.madara.gunbaiOf.get(f);
    const inv = f.root.matrixWorld.clone().invert();
    const m = G.group.matrixWorld.clone().premultiply(inv);
    const e = m.elements;
    const toF = (x, y, z) => [-x, y, -z].map((v) => +v.toFixed(2)); // root local -> fighter frame (+x left, +z fwd)
    const ax = new f.pos.constructor(e[4], e[5], e[6]).normalize(), nz = new f.pos.constructor(e[8], e[9], e[10]).normalize();
    const c0 = new f.pos.constructor(0, 0.44, 0).applyMatrix4(m);
    out.push({ c: JSON.stringify(c), handle: toF(ax.x, ax.y, ax.z), normal: toF(nz.x, nz.y, nz.z), faceCenter: toF(c0.x, c0.y, c0.z) });
  }
  return out;
}, JSON.parse(baseJson), JSON.parse(candJson));
for (const r of res) console.log(r.c, 'handle', r.handle, 'normal', r.normal, 'centre', r.faceCenter);
await b.close();
