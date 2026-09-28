// Two clients fighting: a combo lands and HP/reactions agree on both screens, the knockback flight is the same on
// both (within 10 cm), substitution teleports and replicates, a KO scores and the victim respawns. PASS/FAIL.
// usage: node scripts/test/mpcombat.mjs [url=http://localhost:3101/]
// The server must run with short HP and respawn for the KO part: SHINOBI_HP=600 SHINOBI_MATCH=300,10,2
import puppeteer from 'puppeteer-core';

const URL = process.argv[2] || 'http://localhost:3101/';
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
const status = await fetch(new globalThis.URL('/api/status', URL)).then((r) => r.json()).catch(() => null);
console.log(`server lag: ${JSON.stringify(status?.lag)}`);
const [A, B] = await Promise.all([client('Attacker'), client('Victim')]);
await sleep(2000);
const idA = await A.p.evaluate(() => __game.net.id), idB = await B.p.evaluate(() => __game.net.id);
const place = async () => {
  await A.p.evaluate(() => __game.teleport(-30, 44, 0));
  await B.p.evaluate(() => __game.teleport(-30, 42.6, Math.PI));
  await sleep(1200);
};
// in-page recorder: [serverNow, x, y, z] of a fighter every frame
const REC = `window.__rec = []; window.__recOn = true; (function loop(){ if (!window.__recOn) return; const g = __game; const f = g.__recTarget === 'me' ? g.player : g.remotes.get(g.__recTarget)?.fighter; if (f) window.__rec.push([g.net.serverNow(), f.pos.x, f.pos.y, f.pos.z]); requestAnimationFrame(loop); })();`;
// presses attack every `ms` inside the page (no harness latency)
const combo = (n, ms) => `(async () => { for (let i = 0; i < ${n}; i++) { __game.input.press('attack'); await new Promise(r => setTimeout(r, ${ms})); } })(); 0`;

// ---- 1. a full combo lands; HP and reactions agree
await place();
const hp0 = await B.p.evaluate(() => __game.hp);
await A.p.evaluate(`window.__hits = 0; __game.net.on('hitr', (m) => { if (m.a === __game.net.id) window.__hits++; });`);
await B.p.evaluate(`window.__hitsB = 0; window.__reacts = []; __game.net.on('hitr', (m) => { if (m.v === __game.net.id) { window.__hitsB++; window.__reacts.push(m.r); } });`);
await A.p.evaluate(`__game.__recTarget = ${idB}; ${REC}`);
// the victim's own simulation (fixed steps with their server time): what the game logic uses
await B.p.evaluate(`window.__rec = []; window.__recOn = true; __game.ctrl.onStepped = (t) => { if (window.__recOn) { const b = __game.ctrl.body; window.__rec.push([t * 1000, b.x, b.y, b.z]); } }; 0`);
await A.p.evaluate('__game.combat.log = []; 0');
await A.p.evaluate(combo(5, 260));
await sleep(3500);
await A.p.evaluate('window.__recOn = false');
await B.p.evaluate('window.__recOn = false');
const aHits = await A.p.evaluate(() => window.__hits);
console.log('  A hit log:', JSON.stringify(await A.p.evaluate(() => ({ log: __game.combat.log, stats: __game.combat.stats }))));
const bInfo = await B.p.evaluate(() => ({ hp: __game.hp, hits: window.__hitsB, reacts: window.__reacts }));
const aSeesHp = await A.p.evaluate((id) => __game.remotes.get(id)?.info.hp, idB);
check('combo lands (5 hits confirmed by the server)', aHits >= 5, `A confirmed ${aHits}, B took ${bInfo.hits}, reactions ${bInfo.reacts.join(',')}`);
check('victim HP agrees on both screens', bInfo.hp === aSeesHp && bInfo.hp < hp0, `B: ${bInfo.hp}, A sees ${aSeesHp}, was ${hp0}`);
check('the finisher knocks back (reaction 4)', bInfo.reacts.includes(4));
// knockback flight: B's own position vs A's view of B at the same server times, during the flight
const ra = await A.p.evaluate(() => window.__rec), rb = await B.p.evaluate(() => window.__rec);
// only the finisher's flight: at high ping the victim's own sim snaps into earlier reactions when it hears of them
// (its drawn model eases over that), which the speed filter below would otherwise count as flight
const flightStart = await A.p.evaluate(() => __game.combat.log.at(-1)?.at ?? 0);
const at = (rec, t) => {
  for (let i = 1; i < rec.length; i++) if (rec[i][0] >= t && rec[i - 1][0] <= t) {
    const k = (t - rec[i - 1][0]) / (rec[i][0] - rec[i - 1][0] || 1);
    return [1, 2, 3].map((j) => rec[i - 1][j] + (rec[i][j] - rec[i - 1][j]) * k);
  }
  return null;
};
// the flight: the stretch where B moves fastest (after the launch kick)
let errs = [], moving = 0;
for (let i = 1; i < rb.length; i++) {
  const sp = Math.hypot(rb[i][1] - rb[i - 1][1], rb[i][3] - rb[i - 1][3]) / Math.max(1e-3, (rb[i][0] - rb[i - 1][0]) / 1000);
  if (sp < 5 || rb[i][0] < flightStart) continue;
  moving++;
  // the attacker's drawn path vs the victim's own: the nearest point within 80 ms (each client renders at its own
  // estimate of the server clock; a few ms of clock-sync error at flight speed is not a disagreement of the path)
  let best = Infinity;
  for (const s of ra) if (Math.abs(s[0] - rb[i][0]) < 80) best = Math.min(best, Math.hypot(s[1] - rb[i][1], s[2] - rb[i][2], s[3] - rb[i][3]));
  const a = at(ra, rb[i][0]);
  if (a && best < Infinity) { errs.push(best); if (process.env.DETAIL && best > 0.03) console.log(`  flight frame ${i}/${rb.length} t=${rb[i][0].toFixed(0)} speed ${sp.toFixed(1)} err ${(best * 100).toFixed(1)} cm`); }
}
errs.sort((x, y) => x - y);
const med = errs[Math.floor(errs.length / 2)] ?? 99, p90 = errs[Math.floor(errs.length * 0.9)] ?? 99;
check('knockback flight agrees on both screens (within 10 cm)', errs.length > 5 && p90 < 0.1, `stats ${JSON.stringify(await A.p.evaluate(() => __game.combat.stats))} median ${(med * 100).toFixed(1)} cm, p90 ${(p90 * 100).toFixed(1)} cm, n=${errs.length}, moving frames ${moving}`);

// ---- 2. substitution: B dashes out of hitstun
await sleep(2500);
await place();
const before = await B.p.evaluate(() => [__game.ctrl.body.x, __game.ctrl.body.z, __game.gauge.sp]);
await B.p.evaluate(`window.__subdbg = []; __game.net.on('hitr', (m) => { if (m.v === __game.net.id && !window.__subbed) { window.__subbed = 1; window.__subdbg.push({ hitr: [m.r, m.at, m.t0, m.e, m.st], now: Math.round(__game.net.serverNow()), act: __game.ctrl.action?.constructor.name, subAt: __game.combat.subAt }); setTimeout(() => { __game.input.press('dash'); const g = __game, a = g.ctrl.action; window.__subdbg.push({ act: a?.constructor.name, sp: g.gauge.sp, n: Math.round(g.net.serverNow()), end: a?.h?.end, land: a?.h?.land, dead: g.ctrl.dead }); setTimeout(() => window.__subdbg.push({ after: g.ctrl.action?.constructor.name, subbed: a?.subbed }), 150); }, 60); } }); 0`);
await A.p.evaluate('__game.combat.log = []; 0');
await A.p.evaluate(combo(3, 260));
await sleep(1500);
const after = await B.p.evaluate(() => [__game.ctrl.body.x, __game.ctrl.body.z, __game.gauge.sp, __game.net.seq]);
const moved = Math.hypot(after[0] - before[0], after[1] - before[1]);
if (moved < 3.5) console.log('  sub debug:', JSON.stringify(await B.p.evaluate(() => window.__subdbg)), JSON.stringify(await A.p.evaluate(() => ({ log: __game.combat.log, stats: __game.combat.stats, me: [__game.ctrl.body.x, __game.ctrl.body.z], act: __game.ctrl.action?.id }))));
check('substitution teleports the victim and costs a pip', moved > 3.5 && after[2] === before[2] - 1, `moved ${moved.toFixed(1)} m, pips ${before[2]} -> ${after[2]}`);
await sleep(600);
const aSeesB = await A.p.evaluate((id) => { const f = __game.remotes.get(id).fighter; return [f.pos.x, f.pos.z]; }, idB);
const bNow = await B.p.evaluate(() => [__game.ctrl.body.x, __game.ctrl.body.z]);
check('the attacker sees the substitution', Math.hypot(aSeesB[0] - bNow[0], aSeesB[1] - bNow[1]) < 0.5, `A sees B ${Math.hypot(aSeesB[0] - bNow[0], aSeesB[1] - bNow[1]).toFixed(2)} m from B's own position`);

// ---- 3. KO, score, respawn (needs SHINOBI_HP low)
await A.p.evaluate(`window.__kills = []; __game.net.on('kill', (m) => window.__kills.push(m)); 0`);
let killed = false;
for (let round = 0; round < 8 && !killed; round++) {
  await sleep(2600);
  await place();
  await A.p.evaluate(combo(5, 260));
  await sleep(2200);
  killed = (await A.p.evaluate(() => window.__kills.length)) > 0;
}
const kills = await A.p.evaluate(() => window.__kills);
check('a KO is announced', killed && kills[0].k === idA && kills[0].v === idB, JSON.stringify(kills[0] || {}));
const sb = await A.p.evaluate(() => new Promise((r) => __game.net.on('sb', (m) => r(m))));
const rowA = sb.ps.find((p) => p[0] === idA);
check('the kill scores (+100)', rowA && rowA[1] >= 1 && rowA[4] >= 100, JSON.stringify(rowA));
await sleep(3500);
const alive = await B.p.evaluate(() => ({ dead: __game.ctrl.dead, hp: __game.hp }));
check('the victim respawns', !alive.dead && alive.hp > 0, JSON.stringify(alive));

await A.b.close();
await B.b.close();
const failed = results.filter((r) => !r[1]).length;
console.log(failed ? `${failed} FAILED` : 'ALL PASS');
process.exit(failed ? 1 : 0);
