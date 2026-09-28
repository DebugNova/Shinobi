// Madara's kit, two clients: A plays Madara, B plays Naruto. Each ability must hit, the damage must agree on both
// screens, and every world effect must land in the same place on both screens (<= 10 cm). PASS/FAIL.
// usage: node scripts/test/madara.mjs [url=http://localhost:3104/] [only=fire,wood,counter,meteor]
// The server needs short HP off (the kit's damage is checked against HP) and a full ultimate gauge:
//   SHINOBI_HP=1000 SHINOBI_ULT=1 (the test servers on 3104 / 3102 run HP 600: fine, nobody is KO'd by one ability)
import puppeteer from 'puppeteer-core';

const URL = process.argv[2] || 'http://localhost:3104/';
const ONLY = (process.argv[3] || 'fire,wood,counter,meteor').split(',');
const launch = () => puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, info = '') => {
  results.push([name, ok]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
};
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
async function client(name, ch) {
  const b = await launch();
  const p = await b.newPage();
  await p.setViewport({ width: 960, height: 540 });
  p.on('pageerror', (e) => { if (!/Pointer Lock/.test(e.message)) console.log(`[${name}] PAGEERROR ${e.message}`); });
  p.on('console', (m) => { const t = m.text(); if (/rror|GL_INVALID/.test(t) && !/404|Pointer Lock|naruto\.vrm/.test(t)) console.log(`[${name}] console: ${t.slice(0, 200)}`); });
  await p.goto(`${URL}?autojoin=1&pw=HUNNY&name=${name}&ch=${ch}`, { waitUntil: 'load' });
  await p.waitForFunction("window.__game && window.__game.state === 'playing'", { timeout: 120000 });
  return { b, p };
}
const status = await fetch(new globalThis.URL('/api/status', URL)).then((r) => r.json()).catch(() => null);
console.log(`server lag: ${JSON.stringify(status?.lag)}`);
const [A, B] = await Promise.all([client('Madara', 'madara'), client('Target', 'naruto')]);
await sleep(2500);
const idA = await A.p.evaluate(() => __game.net.id), idB = await B.p.evaluate(() => __game.net.id);
// hit logs on both sides: every hitr with its attacker, victim, hit id, damage, reaction, HP after
const LOG = `window.__hl = []; __game.net.on('hitr', (m) => window.__hl.push({ a: m.a, v: m.v, m: String(m.m), d: m.d, r: m.r, hp: m.hp, b: m.b, sq: m.sq, at: m.at })); window.__hx = []; __game.net.on('hitx', (m) => window.__hx.push(m)); 0`;
await A.p.evaluate(LOG);
await B.p.evaluate(LOG);
// A at (x, z) facing -z; B `gap` metres in front of A, facing A
const place = async (gap, x = -30, z = 44) => {
  await A.p.evaluate(({ x, z }) => { __game.teleport(x, z, 0); __game.ctrl.chakra = 100; __game.jutsu.ready = {}; }, { x, z });
  await B.p.evaluate(({ x, z, gap }) => { __game.teleport(x, z - gap, Math.PI); __game.ctrl.chakra = 100; }, { x, z, gap });
  await sleep(1300);
  await A.p.evaluate(() => { __game.ctrl.lockTarget = __game.pickLock(0); });
};
// the server's cooldowns are authoritative (a cast inside one is denied): wait them out between casts of one jutsu
const lastCast = {};
const cast = async (key, m, cd) => {
  const wait = (lastCast[m] || 0) + cd * 1000 + 300 - Date.now();
  if (wait > 0) await sleep(wait);
  lastCast[m] = Date.now();
  await A.p.evaluate((key) => __game.input.press(key), key);
};
const clearLogs = () => Promise.all([A.p, B.p].map((p) => p.evaluate('window.__hl.length = 0; window.__hx.length = 0; 0')));
const hpOf = async () => ({ bSelf: await B.p.evaluate(() => __game.hp), aSeesB: await A.p.evaluate((id) => __game.remotes.get(id)?.info.hp, idB), aSelf: await A.p.evaluate(() => __game.hp), bSeesA: await B.p.evaluate((id) => __game.remotes.get(id)?.info.hp, idA) });
/** The newest cast of `m` on A's screen (its instance id). */
const lastInst = (arr) => A.p.evaluate((arr) => __game.jutsu.madara[arr].at(-1)?.inst ?? null, arr);

// ---------------------------------------------------------------- 1. Great Fire Annihilation
if (ONLY.includes('fire')) {
  await place(9);
  await clearLogs();
  const hp0 = await hpOf();
  await cast('jutsu1', 'fire', 10);
  await sleep(900); // the cast (seal + inhale) and the torrent's start
  const inst = await lastInst('fires');
  // the same torrent on both screens: origin, direction, lane lengths, the front at one server time, field flames
  await sleep(700);
  const T = await A.p.evaluate(() => Math.round(__game.net.serverNow()));
  const fa = await A.p.evaluate(({ i, T }) => __game.jutsu.madara.debugFire(i, T), { i: inst, T });
  const fb = await B.p.evaluate(({ i, T }) => __game.jutsu.madara.debugFire(i, T), { i: inst, T });
  await sleep(1500);
  const fa2 = await A.p.evaluate(({ i, T }) => __game.jutsu.madara.debugFire(i, T), { i: inst, T });
  const fb2 = await B.p.evaluate(({ i, T }) => __game.jutsu.madara.debugFire(i, T), { i: inst, T });
  check('fire: the torrent exists on both screens', !!fa && !!fb, `inst ${inst}`);
  if (fa && fb) {
    const lanes = Math.max(...fa.lanes.map((l, k) => Math.abs(l - fb.lanes[k])));
    check('fire: same origin, direction and walls on both screens (<= 10 cm)', dist(fa.o, fb.o) <= 0.1 && Math.hypot(fa.d[0] - fb.d[0], fa.d[1] - fb.d[1]) < 0.01 && lanes <= 0.1 && fa.at1 === fb.at1, `origin ${(dist(fa.o, fb.o) * 100).toFixed(1)} cm, lanes ${(lanes * 100).toFixed(1)} cm, at1 ${fa.at1}/${fb.at1}`);
    check('fire: the front at one server time is in the same place (<= 10 cm)', dist(fa.front, fb.front) <= 0.1, `${(dist(fa.front, fb.front) * 100).toFixed(1)} cm`);
    const dd = Math.max(dist(fa.decal.slice(0, 3), fb.decal.slice(0, 3)), dist(fa.decal.slice(3), fb.decal.slice(3)));
    check('fire: the scorch footprint lies in the same place', dd <= 0.1, `${(dd * 100).toFixed(1)} cm`);
    const tg = fa2?.tongues && fb2?.tongues ? Math.max(...fa2.tongues.map((p, k) => Math.hypot(p[0] - fb2.tongues[k][0], p[2] - fb2.tongues[k][2]))) : 99;
    check('fire: the burning field\'s flames stand in the same places', tg <= 0.1, `${tg === 99 ? 'no field' : `${(tg * 100).toFixed(1)} cm`}`);
  }
  await sleep(1500);
  const ha = await A.p.evaluate(() => window.__hl.filter((h) => h.m.startsWith('fireAnnihilation')));
  const hb = await B.p.evaluate(() => window.__hl.filter((h) => h.m.startsWith('fireAnnihilation')));
  const hx = await A.p.evaluate(() => window.__hx);
  const wave = ha.filter((h) => h.v === idB && !h.m.endsWith(':field'));
  const hp1 = await hpOf();
  console.log('  A saw', ha.map((h) => `${h.m.split(':')[1]}:${h.d}/r${h.r}`).join(' '), '| rejected', JSON.stringify(hx.map((x) => x.why)));
  check('fire: the torrent lands its 4 ticks + the knockback on the victim', wave.length === 5 && wave.at(-1).m.endsWith(':last') && wave.at(-1).r === 4, `${wave.length} hits`);
  check('fire: the victim takes the same hits on its own screen', hb.filter((h) => h.v === idB && !h.m.endsWith(':field')).length === 5);
  check('fire: HP agrees on both screens', hp1.bSelf === hp1.aSeesB && hp1.bSelf < hp0.bSelf, `B ${hp0.bSelf} -> ${hp1.bSelf}, A sees ${hp1.aSeesB}`);

  // the field: B walks into the embers after the wave has passed; damage ticks, no reaction, no teleport
  await sleep(2600);
  await place(9);
  await clearLogs();
  // (aimed along -x, away from B: no auto-aim)
  await A.p.evaluate(() => { const c = __game.combat; window.__aim = c.aimTarget; c.aimTarget = () => null; __game.ctrl.lockTarget = null; __game.cam.yaw = Math.PI / 2; __game.ctrl.yaw = Math.PI / 2; });
  await cast('jutsu1', 'fire', 10);
  await sleep(2000);
  const fi = await lastInst('fires');
  const fp = await A.p.evaluate((i) => { const f = __game.jutsu.madara.fires.find((x) => x.inst === i); const s = (f.shape.field.s0 + f.shape.field.s1) / 2; return [f.shape.o[0] + f.shape.dx * s, f.shape.o[2] + f.shape.dz * s]; }, fi);
  const seq0 = await B.p.evaluate(() => __game.net.seq);
  await B.p.evaluate((p) => __game.teleport(p[0], p[1], 0), fp);
  await sleep(1800);
  await A.p.evaluate(() => { __game.combat.aimTarget = window.__aim; });
  const fh = await B.p.evaluate(() => window.__hl.filter((h) => h.m.endsWith(':field')));
  const seq1 = await B.p.evaluate(() => __game.net.seq);
  const act = await B.p.evaluate(() => __game.ctrl.action?.constructor.name ?? null);
  check('fire: the burning field ticks on someone standing in it (no reaction, no teleport)', fh.length >= 2 && fh.every((h) => h.r === 0 && h.d === 12) && seq1 === seq0 && !act, `${fh.length} ticks of ${fh.map((h) => h.d).join(',')}, seq ${seq0}->${seq1}, action ${act}`);

  // guard: B guards the torrent head-on: blocked ticks chip 25%
  await sleep(2500);
  await place(8);
  await clearLogs();
  await B.p.evaluate(() => __game.hold(['guard']));
  await sleep(300);
  await cast('jutsu1', 'fire', 10);
  await sleep(2200);
  await B.p.evaluate(() => __game.hold([]));
  const gh = await A.p.evaluate((id) => window.__hl.filter((h) => h.v === id && h.m.startsWith('fireAnnihilation') && !h.m.endsWith(':field')), idB);
  check('fire: a guard blocks the torrent with chip damage', gh.length >= 4 && gh.every((h) => h.b === 1 && h.d > 0 && h.d <= 15), gh.map((h) => `${h.d}${h.b ? 'b' : ''}`).join(' '));
}

// ---------------------------------------------------------------- 2. Wood Release: Cutting Technique
if (ONLY.includes('wood')) {
  await sleep(2000);
  await place(9);
  await clearLogs();
  const hp0 = await hpOf();
  await cast('jutsu2', 'wood', 9);
  await sleep(600); // the slam (12 f) and the front's run to the victim (~0.3 s)
  const wi = await lastInst('woods');
  const wa = await A.p.evaluate((i) => __game.jutsu.madara.debugWood(i), wi);
  const wb = await B.p.evaluate((i) => __game.jutsu.madara.debugWood(i), wi);
  check('wood: the stake line exists on both screens', !!wa && !!wb, `inst ${wi}, ${wa?.n} stakes, ${wa?.len} m`);
  if (wa && wb) {
    const lay = Math.max(dist(wa.o, wb.o), ...wa.stakes.map((p, k) => dist(p, wb.stakes[k])));
    check('wood: the same stakes in the same places on both screens (<= 10 cm)', wa.n === wb.n && lay <= 0.1 && wa.at1 === wb.at1, `${wa.n}/${wb.n} stakes, worst ${(lay * 100).toFixed(1)} cm`);
    const drawn = wa.drawn && wb.drawn ? Math.max(...wa.drawn.map((p, k) => Math.hypot(p[0] - wb.drawn[k][0], p[2] - wb.drawn[k][2]))) : 99;
    check('wood: the drawn stakes stand in the same places (<= 10 cm)', drawn <= 0.1, `${(drawn * 100).toFixed(1)} cm`);
  }
  await sleep(2200);
  const ha = await A.p.evaluate((id) => window.__hl.filter((h) => h.v === id && h.m.startsWith('woodCutting')), idB);
  const hb = await B.p.evaluate((id) => window.__hl.filter((h) => h.v === id && h.m.startsWith('woodCutting')), idB);
  const hp1 = await hpOf();
  check('wood: one launch hit on the victim (90, launch)', ha.length === 1 && ha[0].d === 90 && ha[0].r === 3, ha.map((h) => `${h.d}/r${h.r}`).join(' ') + ` rejected ${JSON.stringify(await A.p.evaluate(() => window.__hx.map((x) => x.why)))}`);
  check('wood: the victim takes it on its own screen, HP agrees', hb.length === 1 && hp1.bSelf === hp1.aSeesB && hp1.bSelf === hp0.bSelf - 90, `B ${hp0.bSelf} -> ${hp1.bSelf}, A sees ${hp1.aSeesB}`);
  // dodge: B side-steps (dashes sideways) as it comes: no hit
  await sleep(1500);
  await place(12);
  await clearLogs();
  await cast('jutsu2', 'wood', 9);
  await sleep(120);
  await B.p.evaluate(() => { __game.hold(['left']); __game.input.press('dash'); });
  await sleep(250);
  await B.p.evaluate(() => { __game.hold(['left']); });
  await sleep(500);
  await B.p.evaluate(() => __game.hold([]));
  await sleep(1500);
  const hd = await A.p.evaluate((id) => window.__hl.filter((h) => h.v === id && h.m.startsWith('woodCutting')), idB);
  check('wood: a side dash dodges the line', hd.length === 0, `${hd.length} hits`);
  // guard: blocked, no damage
  await sleep(1500);
  await place(9);
  await clearLogs();
  await B.p.evaluate(() => __game.hold(['guard']));
  await sleep(300);
  const hg0 = await hpOf();
  await cast('jutsu2', 'wood', 9);
  await sleep(1500);
  await B.p.evaluate(() => __game.hold([]));
  const hg = await A.p.evaluate((id) => window.__hl.filter((h) => h.v === id && h.m.startsWith('woodCutting')), idB);
  const hg1 = await hpOf();
  check('wood: a guard blocks it', hg.length === 1 && hg[0].b === 1 && hg1.bSelf === hg0.bSelf, `${hg.map((h) => `${h.d}${h.b ? 'b' : ''}`).join(' ')}, HP ${hg0.bSelf} -> ${hg1.bSelf}`);
}

// ---------------------------------------------------------------- 3. Uchiha Return
if (ONLY.includes('counter')) {
  // phase n:1 of A's barrier as each screen hears it (A hears its own from the server too)
  const EV = `window.__ctr = []; __game.net.on('a', (m) => { if (m.m === 'uchihaReturn' && m.n === 1) window.__ctr.push({ id: m.id, f: m.f, at: m.at, tg: m.tg, e: m.e, ai: m.ai }); }); 0`;
  await A.p.evaluate(EV);
  await B.p.evaluate(EV);
  const clearCtr = () => Promise.all([A.p, B.p].map((p) => p.evaluate('window.__ctr.length = 0; 0')));
  const onB = (m) => B.p.evaluate(({ id, m }) => window.__hl.filter((h) => h.v === id && h.m === m), { id: idB, m });
  const onA = (m) => A.p.evaluate(({ id, m }) => window.__hl.filter((h) => h.v === id && h.m === m), { id: idB, m });
  const G = 'uchihaReturn';

  // the gust: B stands 2.5 m away doing nothing: thrown back a little (30, knockback) at the spin, on both screens
  await sleep(1500);
  await place(2.5);
  await clearLogs();
  await clearCtr();
  const g0 = await hpOf();
  await cast('jutsu3', 'counter', 8);
  // (the clip the whole way through, on both screens: no other clip replaces it)
  const clips = await Promise.all([A.p.evaluate(() => new Promise((res) => setTimeout(() => res(__game.ctrl.action?.anim?.().clip ?? null), 700))), B.p.evaluate((id) => new Promise((res) => setTimeout(() => res(__game.remotes.get(id)?.view?.act?.clip ?? null), 700)), idA)]);
  await sleep(1200);
  const gb = await onB(`${G}:gust`), ga = await onA(`${G}:gust`);
  const g1 = await hpOf();
  check('barrier: the gust throws a fighter standing close (30, knockback) on both screens', gb.length === 1 && ga.length === 1 && gb[0].d === 30 && gb[0].r === 4, gb.map((h) => `${h.m}:${h.d}/r${h.r}`).join(' ') || 'no hit');
  check('barrier: HP agrees after the gust, Madara unhurt', g1.bSelf === g0.bSelf - 30 && g1.aSeesB === g1.bSelf && g1.aSelf === g0.aSelf && g1.bSeesA === g0.aSelf, `B ${g0.bSelf} -> ${g1.bSelf} (A sees ${g1.aSeesB}), A ${g0.aSelf} -> ${g1.aSelf}`);
  check('barrier: the cast plays on both screens (mad_counter)', clips[0] === 'mad_counter' && clips[1] === 'mad_counter', `A ${clips[0]}, B sees ${clips[1]}`);

  // melee: B jabs A right at the press: refused, B is blown back (60, knockback) once (the gust doesn't catch it again)
  await sleep(2500);
  await place(1.6);
  await clearLogs();
  await clearCtr();
  const h0 = await hpOf();
  const pred0 = await B.p.evaluate(() => __game.combat.stats.predicted);
  await cast('jutsu3', 'counter', 8);
  await sleep(80);
  await B.p.evaluate(() => __game.input.press('attack'));
  await sleep(1600);
  const bx = await B.p.evaluate(() => window.__hx.map((x) => x.why));
  const hb = await B.p.evaluate((id) => window.__hl.filter((h) => h.v === id), idB);
  const ha = await A.p.evaluate((id) => window.__hl.filter((h) => h.v === id), idB);
  const h1 = await hpOf();
  const evA = await A.p.evaluate(() => window.__ctr), evB = await B.p.evaluate(() => window.__ctr);
  const pred1 = await B.p.evaluate(() => __game.combat.stats.predicted);
  console.log(`  B refused: ${JSON.stringify(bx)}, B took ${hb.map((h) => `${h.m}:${h.d}/r${h.r}`).join(' ')}, B predicted ${pred1 - pred0}`);
  check('barrier: the jab is refused (counter)', bx.includes('counter'));
  check('barrier: both screens hear the answer (a blow)', evA.length >= 1 && evB.length === evA.length && evA[0].f === 1 && evA[0].at === evB[0].at && evA[0].tg === idB, JSON.stringify(evA));
  check('barrier: the attacker is blown back once (60, knockback) on both screens', hb.length === 1 && hb[0].m === `${G}:blow` && hb[0].d === 60 && hb[0].r === 4 && ha.length === 1, hb.map((h) => `${h.m}:${h.d}/r${h.r}`).join(' '));
  check('barrier: Madara takes nothing, HP agrees', h1.aSelf === h0.aSelf && h1.bSeesA === h0.aSelf && h1.bSelf === h0.bSelf - 60 && h1.aSeesB === h1.bSelf, `A ${h0.aSelf} -> ${h1.aSelf} (B sees ${h1.bSeesA}), B ${h0.bSelf} -> ${h1.bSelf} (A sees ${h1.aSeesB})`);

  // projectiles, any number: B (out of the gust's reach) throws two shuriken into one barrier: both fly back (50 each)
  await sleep(2500);
  await place(7);
  await clearLogs();
  await clearCtr();
  const r0 = await hpOf();
  await B.p.evaluate(() => { __game.ctrl.tools = 3; });
  await cast('jutsu3', 'counter', 8);
  await sleep(60);
  await B.p.evaluate(() => { __game.ctrl.lockTarget = __game.pickLock(0); __game.input.press('tool'); });
  // (the second after the first one's reflection has hit B and its flinch is over: ~0.85 s; it lands at ~1.2 s)
  await sleep(820);
  await B.p.evaluate(() => { __game.input.press('tool'); });
  await sleep(1600);
  const rb = await onB(`${G}:reflect`);
  const rev = await B.p.evaluate(() => window.__ctr);
  const r1 = await hpOf();
  check('barrier: two shuriken into one barrier are both reflected (both screens hear it)', rev.length === 2 && rev.every((e) => e.f === 2 && e.e > e.at), JSON.stringify(rev));
  // (the second is the second hit of a combo: damage scaling takes a little off it)
  check('barrier: the reflections hit the thrower (50, then combo-scaled), Madara unhurt', rb.length === 2 && rb[0].d === 50 && rb[1].d > 30 && rb[1].d <= 50 && r1.aSelf === r0.aSelf && r1.bSelf === r0.bSelf - rb[0].d - rb[1].d && r1.aSeesB === r1.bSelf, `${rb.map((h) => `${h.m}:${h.d}/r${h.r}`).join(' ')}; A ${r0.aSelf} -> ${r1.aSelf}, B ${r0.bSelf} -> ${r1.bSelf}`);

  // the window ends: a shuriken thrown as the barrier drops (1.2 s) lands in the recovery (the fan going back)
  await sleep(8200);
  await place(5);
  await clearLogs();
  await clearCtr();
  await B.p.evaluate(() => { __game.ctrl.tools = 3; });
  await cast('jutsu3', 'counter', 8);
  await sleep(1180);
  await B.p.evaluate(() => { __game.ctrl.lockTarget = __game.pickLock(0); __game.input.press('tool'); });
  await sleep(1200);
  const wa = await B.p.evaluate((id) => window.__hl.filter((h) => h.v === id), idA);
  const wev = await B.p.evaluate(() => window.__ctr.filter((e) => e.f !== undefined));
  check('barrier: after the window, a hit lands (the recovery is punishable)', wa.length >= 1 && !wev.length, `${wa.map((h) => `${h.m}:${h.d}`).join(' ')}; answered ${wev.length}`);
}

// ---------------------------------------------------------------- 4. Tengai Shinsei
if (ONLY.includes('meteor')) {
  // (locked on B itself: pickLock may prefer the training dummy next to A)
  const ult = async () => {
    await A.p.evaluate((id) => { const t = __game.combat.targets().find((x) => x.id === id); if (t) __game.ctrl.lockTarget = { id, x: t.x, y: t.y, z: t.z, dead: false }; __game.gauge = { ...(__game.gauge || {}), u: 100 }; __game.input.press('ult'); }, idB);
  };
  const meteorHits = (p) => p.evaluate((id) => window.__hl.filter((h) => h.v === id && h.m.startsWith('tengaiShinsei')), idB);
  // B stands still on the spot: the core (420, knocked away), the same meteor on both screens
  await sleep(2000);
  await place(20);
  await clearLogs();
  const h0 = await hpOf();
  await ult();
  await sleep(1000);
  const mi = await lastInst('meteors');
  // (mid-fall: released 0.5 s after the press, lands 1.8 s after that)
  const T = await A.p.evaluate(() => Math.round(__game.net.serverNow()) + 600);
  const ma = await A.p.evaluate(({ i, T }) => __game.jutsu.madara.debugMeteor(i, T), { i: mi, T });
  const mb = await B.p.evaluate(({ i, T }) => __game.jutsu.madara.debugMeteor(i, T), { i: mi, T });
  check('meteor: the meteor exists on both screens', !!ma && !!mb, `inst ${mi}`);
  if (ma && mb) {
    const d = Math.max(dist(ma.o, mb.o), dist(ma.rock, mb.rock));
    check('meteor: same impact point and fall on both screens (<= 10 cm)', d <= 0.1 && ma.at1 === mb.at1, `${(d * 100).toFixed(1)} cm, at1 ${ma.at1}/${mb.at1}, impact ${ma.o.map((v) => v.toFixed(1))}`);
    const bp = await B.p.evaluate(() => [__game.player.pos.x, __game.player.pos.z]);
    check('meteor: it lands on the target\'s spot', Math.hypot(ma.o[0] - bp[0], ma.o[2] - bp[1]) < 1.5, `${Math.hypot(ma.o[0] - bp[0], ma.o[2] - bp[1]).toFixed(2)} m off`);
  }
  await sleep(3000);
  const ca = await meteorHits(A.p), cb = await meteorHits(B.p);
  const h1 = await hpOf();
  check('meteor: the core hits the target (420, knockback) on both screens, HP agrees', ca.length === 1 && cb.length === 1 && ca[0].m === 'tengaiShinsei:core' && ca[0].d === 420 && ca[0].r === 4 && h1.bSelf === Math.max(0, h0.bSelf - 420) && h1.aSeesB === h1.bSelf, `${ca.map((h) => `${h.m}:${h.d}/r${h.r}`).join(' ')}; B ${h0.bSelf} -> ${h1.bSelf} (A sees ${h1.aSeesB})`);

  // B runs out (sprints sideways right after the release: 13.3 m in 1.6 s): nothing (after a KO above: the respawn comes first)
  await sleep(4000);
  await place(20);
  await clearLogs();
  await ult();
  await sleep(700);
  await B.p.evaluate(() => __game.hold(['left', 'sprint']));
  await sleep(2400);
  await B.p.evaluate(() => __game.hold([]));
  await sleep(1500);
  const wo = await meteorHits(A.p);
  const wd = await A.p.evaluate(({ i }) => { const m = __game.jutsu.madara.meteors.at(-1); const b = __game.remotes.get(i)?.fighter.pos; return m && b ? Math.hypot(m.sh.o[0] - b.x, m.sh.o[2] - b.z) : null; }, { i: idB });
  check('meteor: walking out of it in time: no hit', wo.length === 0, `${wo.length} hits, B ${wd?.toFixed(1)} m from the crater`);

  // B in the outer ring (9.25 m from the centre when it lands, halfway from the core to the edge): the outer hit, scaled
  await sleep(3000);
  await place(20);
  await clearLogs();
  const o0 = await hpOf();
  await ult();
  await sleep(1000);
  const edge = await A.p.evaluate(() => __game.jutsu.madara.meteors.at(-1)?.sh.o);
  await B.p.evaluate((o) => __game.teleport(o[0] + 9.25, o[2], 0), edge);
  await sleep(3500);
  const oh = await meteorHits(A.p);
  const o1 = await hpOf();
  // (falloff 200 at 5.5 m -> 80 at 13 m: 140 at 9.25 m, a little either way for where the server had B)
  check('meteor: the outer ring hits with falloff (knockback, ~140)', oh.length === 1 && oh[0].m === 'tengaiShinsei:outer' && oh[0].d >= 120 && oh[0].d <= 160 && o1.bSelf === o0.bSelf - oh[0].d && o1.aSeesB === o1.bSelf, `${oh.map((h) => `${h.m}:${h.d}/r${h.r}`).join(' ')}; B ${o0.bSelf} -> ${o1.bSelf}`);
}

await A.b.close();
await B.b.close();
const failed = results.filter((r) => !r[1]).length;
console.log(failed ? `${failed} FAILED` : 'ALL PASS');
process.exit(failed ? 1 : 0);
