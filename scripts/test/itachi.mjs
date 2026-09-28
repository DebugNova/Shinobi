// Itachi's kit, two clients: A plays Itachi, B plays Naruto. Each ability must do what it says on both screens, the
// damage must agree, and everything that moves must be in the same place on both screens. PASS/FAIL.
// usage: node scripts/test/itachi.mjs [url=http://localhost:3104/] [only=fire,dodge,tsukuyomi,crow,amaterasu]
// The server needs a full ultimate gauge and HP 600 (the 3104 / 3102 test servers):
//   SHINOBI_HP=600 SHINOBI_ULT=1 SHINOBI_MATCH=300,10,2
import puppeteer from 'puppeteer-core';

const URL = process.argv[2] || 'http://localhost:3104/';
const ONLY = (process.argv[3] || 'fire,dodge,tsukuyomi,crow,amaterasu').split(',');
const launch = () => puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, info = '') => {
  results.push([name, ok]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
};
const errors = [];
async function client(name, ch) {
  const b = await launch();
  const p = await b.newPage();
  await p.setViewport({ width: 960, height: 540 });
  p.on('pageerror', (e) => { if (!/Pointer Lock/.test(e.message)) errors.push(`[${name}] ${e.message}`); });
  p.on('console', (m) => { const t = m.text(); if (/rror|GL_INVALID/.test(t) && !/404|Pointer Lock|naruto\.vrm/.test(t)) errors.push(`[${name}] ${t.slice(0, 200)}`); });
  await p.goto(`${URL}?autojoin=1&pw=HUNNY&name=${name}&ch=${ch}`, { waitUntil: 'load' });
  await p.waitForFunction("window.__game && window.__game.state === 'playing'", { timeout: 120000 });
  return { b, p };
}
const status = await fetch(new globalThis.URL('/api/status', URL)).then((r) => r.json()).catch(() => null);
console.log(`server lag: ${JSON.stringify(status?.lag)}`);
const [A, B] = await Promise.all([client('Itachi', 'itachi'), client('Target', 'naruto')]);
await sleep(2500);
const idA = await A.p.evaluate(() => __game.net.id), idB = await B.p.evaluate(() => __game.net.id);
const LOG = `window.__hl = []; __game.net.on('hitr', (m) => window.__hl.push({ a: m.a, v: m.v, m: String(m.m), d: m.d, r: m.r, hp: m.hp, b: m.b, at: m.at, e: m.e, dz: m.dz, k: m.k })); window.__hx = []; __game.net.on('hitx', (m) => window.__hx.push(m)); window.__acts = []; __game.net.on('a', (m) => window.__acts.push({ id: m.id, k: m.k, m: m.m, n: m.n, o: m.o })); 0`;
await A.p.evaluate(LOG);
await B.p.evaluate(LOG);
// A at (x, z) facing -z; B `gap` metres in front of A, facing A
// (a clear flat lane: scripts/debug/lanes.mjs; the training field's posts stand in the way at x = -30)
const place = async (gap, x = -44, z = 58, side = 0) => {
  await A.p.evaluate(({ x, z }) => { __game.teleport(x, z, 0); __game.ctrl.chakra = 100; __game.jutsu.ready = {}; __game.ctrl.lockTarget = null; }, { x, z });
  await B.p.evaluate(({ x, z, gap, side }) => { __game.hold([]); __game.teleport(x + side, z - gap, Math.PI); __game.ctrl.chakra = 100; }, { x, z, gap, side });
  await sleep(1300);
  await A.p.evaluate((id) => { const r = __game.remotes.get(id); if (r?.fighter) __game.ctrl.lockTarget = { id, x: r.fighter.pos.x, y: r.fighter.pos.y, z: r.fighter.pos.z, dead: false }; }, idB);
};
const lastCast = {};
const cast = async (key, m, cd) => {
  const wait = (lastCast[m] || 0) + cd * 1000 + 300 - Date.now();
  if (wait > 0) await sleep(wait);
  lastCast[m] = Date.now();
  await A.p.evaluate((key) => __game.input.press(key), key);
};
const clearLogs = () => Promise.all([A.p, B.p].map((p) => p.evaluate('window.__hl.length = 0; window.__hx.length = 0; window.__acts.length = 0; 0')));
const hpOf = async () => ({ bSelf: await B.p.evaluate(() => __game.hp), aSeesB: await A.p.evaluate((id) => __game.remotes.get(id)?.info.hp, idB) });
const onB = (pre) => B.p.evaluate(({ id, pre }) => window.__hl.filter((h) => h.v === id && h.m.startsWith(pre)), { id: idB, pre });
const onA = (pre) => A.p.evaluate(({ id, pre }) => window.__hl.filter((h) => h.v === id && h.m.startsWith(pre)), { id: idB, pre });
const posB = () => B.p.evaluate(() => [__game.ctrl.body.x, __game.ctrl.body.y, __game.ctrl.body.z]);
const posA = () => A.p.evaluate(() => [__game.ctrl.body.x, __game.ctrl.body.y, __game.ctrl.body.z]);
const hx = () => A.p.evaluate(() => window.__hx.map((x) => x.why));

// ---------------------------------------------------------------- 1. Phoenix Sage Fire
if (ONLY.includes('fire')) {
  await place(13);
  await clearLogs();
  const hp0 = await hpOf();
  await cast('jutsu1', 'fire', 9);
  await sleep(560); // two balls out: both screens have them
  const inst = await A.p.evaluate(() => __game.jutsu.itachi.balls.at(-1)?.inst ?? null);
  const ba = await A.p.evaluate((i) => __game.jutsu.itachi.debugBalls(i), inst), bb = await B.p.evaluate((i) => __game.jutsu.itachi.debugBalls(i), inst);
  check('fire: the fireballs fly on both screens', ba.length >= 1 && bb.length >= 1, `A ${ba.length}, B ${bb.length}`);
  if (ba.length && bb.length) {
    const d = Math.min(...ba.map((x) => { const y = bb.find((z) => z.k === x.k); return y ? Math.hypot(x.pos[0] - y.pos[0], x.pos[2] - y.pos[2]) : 99; }));
    check('fire: a fireball is in about the same place on both screens (<= 1.5 m, ping + interpolation)', d <= 1.5, `${d.toFixed(2)} m`);
  }
  await sleep(1800);
  const ha = await onA('phoenixFire'), hb = await onB('phoenixFire');
  const hp1 = await hpOf();
  console.log('  A saw', ha.map((h) => `${h.m.split(':')[1]}:${h.d}/r${h.r}`).join(' '), '| rejected', JSON.stringify(await hx()));
  check('fire: three fireballs hit (flinch, flinch, knockback)', ha.length === 3 && ha[0].r === 1 && ha[1].r === 1 && ha[2].r === 4 && ha[2].m === 'phoenixFire:last', `${ha.length} hits`);
  check('fire: the victim takes the same hits on its own screen', hb.length === 3);
  check('fire: HP agrees on both screens', hp1.bSelf === hp1.aSeesB && hp1.bSelf < hp0.bSelf, `B ${hp0.bSelf} -> ${hp1.bSelf}, A sees ${hp1.aSeesB}`);
}

// ---------------------------------------------------------------- 2. dodge: a dash shakes the fireballs off
if (ONLY.includes('dodge')) {
  await sleep(2500);
  await place(14);
  await clearLogs();
  await cast('jutsu1', 'fire', 9);
  // a sideways dash as each ball closes in (they leave 0.3, 0.5, 0.7 s after the press; ~0.5 s of flight)
  for (const t of [430, 1050]) {
    await sleep(t - (t === 430 ? 0 : 430));
    await B.p.evaluate((dir) => { __game.hold([dir]); __game.input.press('dash'); }, t === 430 ? 'left' : 'right');
    await sleep(120);
    await B.p.evaluate(() => __game.hold([]));
  }
  await sleep(1500);
  const hd = await onA('phoenixFire');
  const lost = await A.p.evaluate(() => window.__lostSeen || null);
  check('fire: dashing away shakes them off (at most 1 of 3 hits)', hd.length <= 1, `${hd.length} hits: ${hd.map((h) => h.k).join(',')}, rejected ${JSON.stringify(await hx())}`);
  void lost;
  // the server alone: A's screen never sees the dash (its lock can't drop), B dashes as each ball closes in: the
  // server refuses every hit whose ball was in flight during the dash ('dodged')
  await sleep(2500);
  await place(14);
  await clearLogs();
  await A.p.evaluate(() => { const K = __game.jutsu.itachi; K.__dodging ||= K.dodging; K.dodging = () => false; });
  await cast('jutsu1', 'fire', 9);
  for (const t of [430, 1050]) {
    await sleep(t - (t === 430 ? 0 : 430));
    await B.p.evaluate((dir) => { __game.hold([dir]); __game.input.press('dash'); }, t === 430 ? 'left' : 'right');
    await sleep(120);
    await B.p.evaluate(() => __game.hold([]));
  }
  await sleep(1500);
  await A.p.evaluate(() => { const K = __game.jutsu.itachi; K.dodging = K.__dodging; });
  const hs = await onA('phoenixFire'), why = await hx();
  check('fire: the server refuses a ball the victim dashed away from, whatever the caster saw', hs.length === 0 && why.includes('dodged'), `${hs.length} hits, rejected ${JSON.stringify(why)}`);
}

// ---------------------------------------------------------------- 3. Amaterasu (before Tsukuyomi: B needs > 300 HP)
if (ONLY.includes('amaterasu')) {
  await sleep(1500);
  await place(10);
  await clearLogs();
  const hp0 = await hpOf();
  await A.p.evaluate(() => { __game.gauge.u = 100; });
  await cast('ult', 'amaterasu', 0);
  await sleep(1400);
  const burnB = await B.p.evaluate((id) => __game.jutsu.itachi.burning.has(id), idB), burnA = await A.p.evaluate((id) => __game.jutsu.itachi.burning.has(id), idB);
  // it burns through a dash
  await B.p.evaluate(() => { __game.hold(['left']); __game.input.press('dash'); });
  await sleep(400);
  await B.p.evaluate(() => __game.hold([]));
  await sleep(6500);
  const ha = await onA('amaterasu'), hb = await onB('amaterasu');
  const total = ha.reduce((s, h) => s + h.d, 0);
  const hp1 = await hpOf();
  console.log('  A saw', ha.map((h) => `${h.m.split(':')[1]}:${h.d}`).join(' '));
  check('amaterasu: B ignites (on both screens: the black flames)', ha[0]?.m === 'amaterasu:ignite' && burnA && burnB, `${ha[0]?.m}, flames ${burnA}/${burnB}`);
  // (B needs more than half its HP left to see the whole share; with less the flames KO it)
  check('amaterasu: it burns exactly 50% of max HP, through a dash', hp0.bSelf > 300 ? total === 300 && hp1.bSelf === hp0.bSelf - 300 : total >= hp0.bSelf, `${total} damage in ${ha.length} hits (B started at ${hp0.bSelf})`);
  check('amaterasu: the victim takes the same on its own screen, HP agrees', hb.length === ha.length && hp1.bSelf === hp1.aSeesB, `B ${hp0.bSelf} -> ${hp1.bSelf}, A sees ${hp1.aSeesB}`);
  await sleep(1500);
  const out = await B.p.evaluate((id) => { const b = __game.jutsu.itachi.burning.get(id); return b ? __game.net.serverNow() - b.last : null; }, idB);
  check('amaterasu: the flames go out once the share is burnt', out === null || out > 550, `${out}`);
}

// ---------------------------------------------------------------- 4. Tsukuyomi
if (ONLY.includes('tsukuyomi')) {
  await sleep(1500);
  await place(8);
  await clearLogs();
  const hp0 = await hpOf();
  await cast('jutsu2', 'tsukuyomi', 15);
  await sleep(500);
  // (the server's result reaches each screen half a round trip after the gaze reaches the server; a lost segment adds one)
  const got = (p) => p.evaluate((id) => window.__hl.some((h) => h.v === id && h.m.startsWith('tsukuyomi')), idB);
  for (let w = 0; w < 60 && !((await got(A.p)) && (await got(B.p))); w++) await sleep(25);
  const ha = await onA('tsukuyomi'), hb = await onB('tsukuyomi');
  check('tsukuyomi: the victim is caught (daze, 5 s) on both screens', ha.length === 1 && hb.length === 1 && ha[0].r === 9 && ha[0].dz - ha[0].at > 4800 && ha[0].dz - ha[0].at < 5400, ha.map((h) => `r${h.r} ${h.dz - h.at} ms`).join(' '));
  // (the red world fades in over 0.25 s from when B hears of it: up to a round trip after the gaze)
  await B.p.waitForFunction(() => __game.post.genjutsu.uniforms.get('uAmt').value > 0.5, { timeout: 1000, polling: 16 }).catch(() => {});
  const inB = await B.p.evaluate(() => ({ act: __game.ctrl.action?.h?.r ?? null, gen: __game.post.genjutsu.uniforms.get('uAmt').value, clip: __game.view.act?.clip }));
  const markA = await A.p.evaluate((id) => __game.jutsu.itachi.dazed.has(id), idB);
  const markB = await B.p.evaluate((id) => __game.jutsu.itachi.dazed.has(id), idB);
  check('tsukuyomi: B is dazed on its own screen (the dazed pose, the red world)', inB.act === 9 && inB.gen > 0.5 && inB.clip === 'dazed', JSON.stringify(inB));
  check('tsukuyomi: the Mangekyō mark is over B on both screens', markA && markB);
  // B can't move or substitute out of it
  const p0 = await posB();
  await B.p.evaluate(() => { __game.hold(['up']); __game.input.press('dash'); });
  await sleep(1200);
  await B.p.evaluate(() => __game.hold([]));
  const p1 = await posB();
  const subbed = await B.p.evaluate(() => window.__acts.some((a) => a.k === 'sub'));
  check('tsukuyomi: B can neither move nor substitute while dazed', Math.hypot(p1[0] - p0[0], p1[2] - p0[2]) < 0.2 && !subbed, `moved ${Math.hypot(p1[0] - p0[0], p1[2] - p0[2]).toFixed(2)} m`);
  // a hit inside it leaves B dazed to the end
  await A.p.evaluate((b) => { __game.teleport(b[0], b[2] + 1.6, 0); }, p1);
  await sleep(300);
  await A.p.evaluate(() => __game.input.press('attack'));
  await sleep(700);
  const m1 = await onB('U1');
  const still = await B.p.evaluate(() => ({ r: __game.ctrl.action?.h?.r ?? null, dz: __game.ctrl.action?.h?.dz ?? 0, clip: __game.view.act?.clip }));
  check('tsukuyomi: a hit inside the genjutsu keeps B dazed to its end', m1.length === 1 && m1[0].dz === ha[0]?.dz && still.dz === ha[0]?.dz && still.clip === 'dazed', `${JSON.stringify(m1.map((h) => ({ r: h.r, dz: h.dz })))} ${JSON.stringify(still)}`);
  const hpMid = await hpOf();
  check('tsukuyomi: HP agrees (30 + the hit)', hpMid.bSelf === hpMid.aSeesB && hp0.bSelf - hpMid.bSelf >= 30, `B ${hp0.bSelf} -> ${hpMid.bSelf}, A sees ${hpMid.aSeesB}`);
  // released after 5 s: B moves again, the red world gone
  await sleep(Math.max(0, ha[0] ? ha[0].dz - (await A.p.evaluate(() => __game.net.serverNow())) + 600 : 3000));
  const q0 = await posB();
  await B.p.evaluate(() => __game.hold(['left']));
  await sleep(500);
  await B.p.evaluate(() => __game.hold([]));
  const q1 = await posB();
  const genEnd = await B.p.evaluate(() => __game.post.genjutsu.uniforms.get('uAmt').value);
  check('tsukuyomi: B is free after the 5 s (moves, the red world is gone)', Math.hypot(q1[0] - q0[0], q1[2] - q0[2]) > 1 && genEnd < 0.01, `moved ${Math.hypot(q1[0] - q0[0], q1[2] - q0[2]).toFixed(2)} m, uAmt ${genEnd}`);
  // out of the cone (behind him): nothing
  await sleep(Math.max(0, 15800 - 6800));
  await place(-6); // B 6 m BEHIND A
  await clearLogs();
  await A.p.evaluate(() => { __game.ctrl.lockTarget = null; __game.cam.yaw = 0; __game.combat.__aim = __game.combat.aimTarget; __game.combat.aimTarget = () => null; });
  await cast('jutsu2', 'tsukuyomi', 15);
  await sleep(900);
  await A.p.evaluate(() => { __game.combat.aimTarget = __game.combat.__aim; });
  const hbk = await onA('tsukuyomi');
  check('tsukuyomi: someone behind him is not caught', hbk.length === 0, `${hbk.length} hits`);
}

// ---------------------------------------------------------------- 5. Crow Clone Escape
if (ONLY.includes('crow')) {
  await sleep(1500);
  await place(2.5);
  await clearLogs();
  const a0 = await posA(), b0 = await posB();
  await cast('jutsu3', 'crow', 10);
  // B swings at him through it (invulnerable: nothing lands)
  await sleep(40);
  await B.p.evaluate(() => __game.input.press('attack'));
  await sleep(160);
  // (A at once; B once the cast has come round through the server: a full round trip later)
  const hA = await A.p.evaluate(() => !__game.player.root.visible), crowsA = await A.p.evaluate(() => __game.jutsu.itachi.crows.list.length);
  // (a relayed cast takes a round trip plus jitter, and a lost segment another round trip: wait for it)
  const seenB = await B.p.waitForFunction((id) => { const f = __game.remotes.get(id)?.fighter; return f && !f.root.visible && __game.jutsu.itachi.crows.list.length > 10 ? __game.jutsu.itachi.crows.list.length : false; }, { timeout: 800, polling: 16 }, idA).then((h) => h.jsonValue()).catch(() => 0);
  const hB = !!seenB, crowsB = seenB || 0;
  if (process.env.DETAIL) console.log('  B side:', JSON.stringify(await B.p.evaluate((id) => ({ rtt: __game.net.rtt, acts: window.__acts.filter((x) => x.m === 'crowEscape'), act: __game.remotes.get(id)?.act, now: Math.round(__game.net.serverNow()) }), idA)));
  const hidden = [hA, hB];
  await sleep(900);
  const a1 = await posA();
  const seen = await B.p.evaluate((id) => { const f = __game.remotes.get(id)?.fighter; return f ? [f.pos.x, f.pos.y, f.pos.z, f.root.visible] : null; }, idA);
  const d = Math.hypot(a1[0] - a0[0], a1[2] - a0[2]);
  check('crow: he bursts into crows and is hidden on both screens', hidden[0] && hidden[1] && crowsA > 10 && crowsB > 10, `hidden ${hidden}, crows ${crowsA}/${crowsB}`);
  check('crow: he re-forms 7-12 m away, farther from the enemy', d >= 6.5 && d <= 12.5 && Math.hypot(a1[0] - b0[0], a1[2] - b0[2]) > Math.hypot(a0[0] - b0[0], a0[2] - b0[2]) + 4, `${d.toFixed(1)} m, from B ${Math.hypot(a1[0] - b0[0], a1[2] - b0[2]).toFixed(1)} m`);
  check('crow: B sees him re-formed at the same spot (<= 0.35 m), visible', seen && seen[3] && Math.hypot(seen[0] - a1[0], seen[2] - a1[2]) <= 0.35, seen ? `${Math.hypot(seen[0] - a1[0], seen[2] - a1[2]).toFixed(2)} m` : 'no remote');
  const hits = await A.p.evaluate((id) => window.__hl.filter((h) => h.v === id), idA);
  check('crow: nothing lands on him through it', hits.length === 0, `${hits.length} hits`);
  // his states resume from the spot (the server has him there: B's hit on the old spot would be far from history)
  await sleep(600);
  const srv = await B.p.evaluate((id) => { const r = __game.remotes.get(id); return r?.motion.cur ? [r.motion.cur[0], r.motion.cur[2]] : null; }, idA);
  check('crow: the state stream carries on from the spot', srv && Math.hypot(srv[0] - a1[0], srv[1] - a1[2]) < 0.35, srv ? `${Math.hypot(srv[0] - a1[0], srv[1] - a1[2]).toFixed(2)} m` : '');
}

// ---------------------------------------------------------------- 6. fireballs on a runner (last: B's HP budget)
if (ONLY.includes('fire')) {
  // they home: B runs sideways after the cast (no dash): still hit
  await sleep(2500);
  await place(14);
  await clearLogs();
  // (where each ball ends on A's screen, and where B was then: DETAIL=1 prints it)
  await A.p.evaluate((id) => { const K = __game.jutsu.itachi; window.__ends = []; K.__ex ||= K.explode; K.explode = (b) => { const f = __game.remotes.get(id)?.fighter; window.__ends.push({ k: b.k, t: +b.t.toFixed(2), lost: b.lost, p: b.pos.toArray().map((v) => +v.toFixed(1)), B: f ? [+f.pos.x.toFixed(1), +f.pos.y.toFixed(1), +f.pos.z.toFixed(1)] : null }); K.__ex(b); }; }, idB);
  await cast('jutsu1', 'fire', 9);
  // (to B's right is open ground; to its left a wall the balls rightly burst on)
  await B.p.evaluate(() => __game.hold(['right']));
  await sleep(1900);
  await B.p.evaluate(() => __game.hold([]));
  const hr = await onA('phoenixFire');
  if (process.env.DETAIL) console.log('  ends', JSON.stringify(await A.p.evaluate(() => window.__ends)));
  check('fire: they track a target running sideways (>= 2 of 3 hit)', hr.length >= 2, `${hr.length} hits, rejected ${JSON.stringify(await hx())}`);
}

console.log(errors.length ? `errors:\n  ${errors.join('\n  ')}` : 'no page errors');
check('no page errors', errors.length === 0);
const fails = results.filter((r) => !r[1]);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
await A.b.close();
await B.b.close();
process.exit(fails.length ? 1 : 0);
