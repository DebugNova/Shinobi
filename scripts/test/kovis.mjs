// Two clients: the KO fall shows on the victim's OWN screen and on the attacker's (the victim used to stand frozen in
// the killing hit's flinch on its own screen), the two paths agree; then the attacker casts Shadow Clone Rush (E)
// just by looking at the victim, and the victim's screen shows the clones running in and hitting. PASS/FAIL.
// usage: [CH=<id>] node scripts/test/kovis.mjs [url=http://localhost:3104/] [shotsDir]   (CH: both clients' character)
// The server needs short HP and respawn: SHINOBI_HP=600 SHINOBI_MATCH=300,10,2
import puppeteer from 'puppeteer-core';
import fs from 'fs';

const URL = process.argv[2] || 'http://localhost:3104/';
const SHOTS = process.argv[3] || null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const launch = () => puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, info = '') => {
  results.push([name, ok]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
};
async function client(name) {
  const b = await launch();
  const p = await b.newPage();
  await p.setViewport({ width: 960, height: 540 });
  p.on('pageerror', (e) => { if (!/Pointer Lock/.test(e.message)) console.log(`[${name}] PAGEERROR ${e.message}`); });
  await p.goto(`${URL}?autojoin=1&name=${name}${process.env.CH ? `&ch=${process.env.CH}` : ''}`, { waitUntil: 'load' });
  await p.waitForFunction("window.__game && window.__game.state === 'playing'", { timeout: 120000 });
  return { b, p };
}
const [A, B] = await Promise.all([client('Attacker'), client('Victim')]);
await sleep(2000);
const idA = await A.p.evaluate(() => __game.net.id), idB = await B.p.evaluate(() => __game.net.id);
const place = async (dz = 1.4) => {
  await A.p.evaluate(() => __game.teleport(-30, 44, 0));
  await B.p.evaluate((dz) => __game.teleport(-30, 44 - dz, Math.PI), dz);
  await sleep(1200);
};
// per drawn frame: [serverNow, x, y, z, anim key, hips height above the feet] of fighter `who` ('me' or a remote id)
const REC = (who) => `window.__rec = []; window.__recOn = true; (function loop(){ if (!window.__recOn) return; const g = __game;
  const f = ${JSON.stringify(who)} === 'me' ? g.player : g.remotes.get(${JSON.stringify(who)})?.fighter;
  if (f) { const h = f.vrm.humanoid.getRawBoneNode('hips').getWorldPosition(new f.pos.constructor()); window.__rec.push([g.net.serverNow(), f.pos.x, f.pos.y, f.pos.z, f.anim.key, h.y - f.pos.y]); }
  requestAnimationFrame(loop); })(); 0`;
const combo = (n, ms) => `(async () => { for (let i = 0; i < ${n}; i++) { __game.input.press('attack'); await new Promise(r => setTimeout(r, ${ms})); } })(); 0`;

// ---- 1. the KO fall, on both screens
await B.p.evaluate(`window.__killAt = 0; __game.net.on('kill', (m) => { if (m.v === __game.net.id) window.__killAt = __game.net.serverNow(); }); 0`);
await A.p.evaluate(`window.__kills = 0; __game.net.on('kill', () => window.__kills++); 0`);
let killed = false;
for (let round = 0; round < 8 && !killed; round++) {
  await sleep(2600);
  await place();
  await A.p.evaluate(REC(idB));
  await B.p.evaluate(REC('me'));
  // the victim's side camera, for the shots
  if (SHOTS) await B.p.evaluate(() => { __game.studio = { yaw: Math.PI / 2, pitch: 0.15, dist: 5, h: 1 }; });
  await A.p.evaluate(combo(5, 260));
  for (let i = 0; i < 22 && !killed; i++) {
    await sleep(100);
    killed = (await B.p.evaluate(() => window.__killAt)) > 0;
  }
  if (killed && SHOTS) for (let i = 0; i < 6; i++) {
    await B.p.screenshot({ path: `${SHOTS}/ko_victim_${i}.png` });
    await sleep(180);
  }
  await sleep(killed ? 1400 : 1200);
  await A.p.evaluate('window.__recOn = false');
  await B.p.evaluate('window.__recOn = false');
}
check('a KO happens', killed);
if (killed) {
  const killAt = await B.p.evaluate(() => window.__killAt);
  const until = killAt + 1700; // the test server respawns 2 s after the KO
  const rb = (await B.p.evaluate(() => window.__rec)).filter((r) => r[0] >= killAt - 300 && r[0] <= until);
  const ra = (await A.p.evaluate(() => window.__rec)).filter((r) => r[0] >= killAt - 300 && r[0] <= until);
  const summary = (rec) => {
    const keys = [...new Set(rec.map((r) => r[4]))];
    const last = rec.at(-1), first = rec[0];
    return { keys, moved: first && last ? Math.hypot(last[1] - first[1], last[3] - first[3]) : 0, hipsEnd: last ? last[5] : 9, hipsStart: first ? first[5] : 9 };
  };
  const sb = summary(rb), sa = summary(ra);
  console.log('  victim screen:', JSON.stringify({ ...sb, moved: sb.moved.toFixed(2), hipsEnd: sb.hipsEnd.toFixed(2) }));
  console.log('  attacker screen:', JSON.stringify({ ...sa, moved: sa.moved.toFixed(2), hipsEnd: sa.hipsEnd.toFixed(2) }));
  check('the victim sees itself thrown and lying down', sb.keys.includes('act:fly') && sb.keys.at(-1) === 'act:lie' && sb.hipsEnd < 0.5 && sb.moved > 1.5);
  check('the attacker sees the victim thrown and lying down', sa.keys.includes('act:fly') && sa.keys.at(-1) === 'act:lie' && sa.hipsEnd < 0.5 && sa.moved > 1.5);
  // the two paths: the victim's own position vs the attacker's view of it at the same server times, once both have
  // eased in (at high ping each screen eases from what it drew into the flight over ~0.1 s after hearing of the hit)
  let worst = 0, n = 0;
  for (const r of rb) {
    if (r[0] < killAt + 300) continue;
    let best = Infinity;
    for (const s of ra) if (Math.abs(s[0] - r[0]) < 40) best = Math.min(best, Math.hypot(s[1] - r[1], s[2] - r[2], s[3] - r[3]));
    if (best < Infinity) {
      worst = Math.max(worst, best);
      n++;
    }
  }
  check('the KO fall is the same on both screens (within 25 cm)', n > 20 && worst < 0.25, `worst ${(worst * 100).toFixed(1)} cm over ${n} frames`);
  // smoothness on the victim's screen: no frame where the drawn fighter jumps (> 0.5 m in one frame)
  let jump = 0;
  for (let i = 1; i < rb.length; i++) {
    const st = Math.hypot(rb[i][1] - rb[i - 1][1], rb[i][2] - rb[i - 1][2], rb[i][3] - rb[i - 1][3]);
    jump = Math.max(jump, st);
    if (process.env.DETAIL && st > 0.2) for (let j = Math.max(0, i - 3); j <= Math.min(rb.length - 1, i + 2); j++) console.log(`   ${j === i ? '>' : ' '} t ${Math.round(rb[j][0] - killAt)} ms  [${rb[j].slice(1, 4).map((x) => x.toFixed(2))}] ${rb[j][4]}`);
  }
  check('no pops in the victim\'s own fall', jump < 0.5, `largest step ${(jump * 100).toFixed(1)} cm`);
}
await B.p.evaluate(() => { __game.studio = null; });

// ---- 2. Shadow Clone Rush: the attacker only looks at the victim (no lock-on); the victim sees the clones
// (a character whose kit has no Shadow Clone Rush, e.g. Madara: scripts/test/madara.mjs covers its jutsu)
if (!(await A.p.evaluate(() => Object.values(__game.ctrl.C.kit).includes('clones')))) {
  console.log('SKIP  Shadow Clone Rush (not in this character\'s kit)');
  await A.b.close();
  await B.b.close();
  const failed = results.filter((r) => !r[1]).length;
  console.log(failed ? `${failed} FAILED` : 'ALL PASS');
  process.exit(failed ? 1 : 0);
}
await sleep(4500); // respawn + spawn protection
await place(9);
await sleep(600);
await A.p.evaluate(() => { __game.ctrl.lockTarget = null; __game.ctrl.chakra = 100; });
await B.p.evaluate(`window.__cloneHits = 0; window.__cl = []; window.__clOn = true; __game.net.on('hitr', (m) => { if (m.v === __game.net.id && String(m.m).startsWith('clone')) window.__cloneHits++; });
  (function loop(){ if (!window.__clOn) return; const g = __game; const me = g.player.pos;
    for (const c of g.jutsu.clones) if (c.owner === ${idA}) window.__cl.push([g.net.serverNow(), c.idx, Math.hypot(c.x - me.x, c.z - me.z), c.f.root.visible, c.f.anim.key]);
    requestAnimationFrame(loop); })(); 0`);
await A.p.evaluate(`window.__tg = null; const at = __game.combat.aimTarget.bind(__game.combat); __game.combat.aimTarget = (c, r) => { const t = at(c, r); window.__tg = t?.id ?? null; return t; }; __game.input.press('jutsu2'); 0`);
if (SHOTS) {
  await sleep(450);
  for (let i = 0; i < 5; i++) {
    await B.p.screenshot({ path: `${SHOTS}/clones_victim_${i}.png` });
    await sleep(150);
  }
}
await sleep(3500);
await B.p.evaluate('window.__clOn = false');
const tg = await A.p.evaluate(() => window.__tg);
check('the clones target what the camera looks at', tg === idB, `target ${tg}, victim ${idB}`);
const cl = await B.p.evaluate(() => window.__cl);
const idxs = [...new Set(cl.map((c) => c[1]))];
const closest = Math.min(...cl.map((c) => c[2]));
const startD = cl.length ? cl[0][2] : 0;
console.log('  victim sees', cl.length, 'clone frames, clones', idxs.join(','), 'start', startD.toFixed(2), 'm, closest', closest.toFixed(2), 'm, keys', [...new Set(cl.map((c) => c[4]))].join(' '));
check('the victim sees both clones', idxs.length === 2 && cl.every((c) => c[3]));
check('the clones run up to the victim on its screen', closest < 1.6 && startD > 5);
check('the clones attack on the victim\'s screen', cl.some((c) => String(c[4]).startsWith('act:')));
const ch = await B.p.evaluate(() => window.__cloneHits);
check('the clones\' hits land on the victim', ch >= 2, `${ch} clone hits`);

await A.b.close();
await B.b.close();
const failed = results.filter((r) => !r[1]).length;
console.log(failed ? `${failed} FAILED` : 'ALL PASS');
process.exit(failed ? 1 : 0);
