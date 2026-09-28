// SHINOBI ARENA game server: serves the built client and runs the free-for-all room over WebSockets.
// Clients own their movement (instant controls) and detect their own hits; the server validates hits with lag
// compensation (rewinding the victim to what the attacker saw), computes every result from the shared move data,
// drives reactions as deterministic flights (seq-numbered teleports of the victim's state) and owns HP, KOs,
// respawns, scores and the match loop (warmup -> live -> results -> live ...).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { PORT as DEFAULT_PORT, NET, MATCH, PALETTE, ST, FLAG } from '../src/shared/config.js';
import { charOf, DEFAULT_CHARACTER, CHARACTERS } from '../src/shared/characters.js';
import { buildMap, BOUNDS, mapHash } from '../src/shared/map.js';
import { REACT } from '../src/shared/combat.js';
import { Combat } from './combat.js';
import { parseLag, LagLine } from './lag.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// SHINOBI_DIST lets a test server serve a separate build (dist-test) without touching the live one
const DIST = path.resolve(ROOT, process.env.SHINOBI_DIST || 'dist');
const PORT = Number(process.env.PORT) || DEFAULT_PORT;
const LAG = parseLag(process.env.SHINOBI_LAG);
// SHINOBI_MATCH="duration,results" (seconds) shortens the loop for tests
const T = { duration: MATCH.duration, results: MATCH.results, respawn: MATCH.respawn };
// SHINOBI_HP=n: every fighter's max HP (tests: quick KOs)
const HP_OVERRIDE = Number(process.env.SHINOBI_HP) || 0;
const maxHp = (C) => HP_OVERRIDE || C.stats.hp;
// SHINOBI_ULT=1: every fighter's ultimate gauge stays full (tests)
const ULT_FULL = process.env.SHINOBI_ULT === '1';
if (process.env.SHINOBI_MATCH) {
  const [d, r, rs] = process.env.SHINOBI_MATCH.split(',').map(Number);
  if (d > 0) T.duration = d;
  if (r > 0) T.results = r;
  if (rs > 0) T.respawn = rs;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.vrm': 'model/gltf-binary', '.bin': 'application/octet-stream',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg',
};

const now = () => performance.now();
const clean = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r3 = (v) => Math.round(v * 1000) / 1000;

// ---------------------------------------------------------------- world

const t0 = now();
const MAP = buildMap();
const world = MAP.world;
log(`map built in ${(now() - t0).toFixed(0)} ms (${world.shapes.length} colliders, hash ${mapHash(MAP)})`);
const combat = new Combat(world, now, log);

// ---------------------------------------------------------------- room state

const players = new Map();
const ghosts = new Map(); // token -> { slot, name, k, d, a, score, until }
let nextId = 1;
const match = { phase: 'warmup', endsAt: 0, n: 0, results: null };

// The training dummy: a fighter-shaped log on the training field. Hits wobble it; it shows damage and combos.
const dummy = {
  id: 0, dummy: true, name: 'Training Dummy', ch: DEFAULT_CHARACTER, alive: true, hp: 1000, seq: 0, protectUntil: 0,
  s: [MAP.dummy.p[0], MAP.dummy.p[1], MAP.dummy.p[2], 0, 0, 0, MAP.dummy.yaw, ST.loco, 0, 0], at: now(), lastHit: 0,
};
combat.init(dummy);

function send(p, msg) {
  if (!p.ws || p.ws.readyState !== 1) return;
  const data = typeof msg === 'string' ? msg : JSON.stringify(msg);
  if (p.lagOut) p.lagOut.run(() => p.ws.readyState === 1 && p.ws.send(data));
  else p.ws.send(data);
}
function broadcast(msg, exceptId = -1) {
  const data = JSON.stringify(msg);
  for (const p of players.values()) if (p.id !== exceptId) send(p, data);
}

function info(p) {
  return { id: p.id, name: p.name, ch: p.ch, slot: p.slot, s: stateOut(p), at: p.at, hp: p.hp, alive: p.alive ? 1 : 0, seq: p.seq, dummy: p.dummy ? 1 : 0 };
}
function stateOut(p) {
  const s = p.s.slice();
  s[9] = (s[9] & ~FLAG.dead) | (p.alive ? 0 : FLAG.dead);
  return s;
}
function matchInfo() {
  return { ph: match.phase, end: match.endsAt, n: match.n, dur: T.duration * 1000 };
}

function freeSlot() {
  const used = new Set([...players.values()].map((p) => p.slot));
  for (let i = 0; i < PALETTE.length; i++) if (!used.has(i)) return i;
  return 0;
}

/** A player's name: what they typed (cleaned, 16 characters) or their character's name; ' 2', ' 3'... when taken. */
function autoName(want, ch, self = null) {
  const names = new Set([...players.values()].filter((p) => p !== self).map((p) => p.name));
  let base = String(want || '').replace(/[^\p{L}\p{N} _\-.]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 16).trim();
  if (!base) base = charOf(ch).name;
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
}

function handleJoin(ws, msg) {
  if (ws.playerId) return;
  if (players.size >= NET.maxPlayers) {
    ws.send(JSON.stringify({ t: 'full', max: NET.maxPlayers }));
    ws.close();
    return;
  }
  const id = nextId++;
  const token = typeof msg.token === 'string' ? msg.token.slice(0, 40) : '';
  const ghost = token && ghosts.get(token);
  if (ghost) ghosts.delete(token);
  const ch = CHARACTERS[msg.ch] ? msg.ch : DEFAULT_CHARACTER;
  const C = charOf(ch);
  const p = {
    id, ws, token, ch,
    name: ghost ? ghost.name : autoName(msg.name, ch),
    slot: ghost && ![...players.values()].some((o) => o.slot === ghost.slot) ? ghost.slot : freeSlot(),
    s: [0, 0, 0, 0, 0, 0, 0, ST.loco, 0, 0],
    at: now(), seq: 0, hp: maxHp(C), alive: true, respawnAt: 0, protectUntil: 0,
    k: ghost?.k || 0, d: ghost?.d || 0, a: ghost?.a || 0, score: ghost?.score || 0,
    ult: ghost?.ult || 0, staleStates: 0, pips: C.stats.subPips, pipT: 0, ping: 0, dmgFrom: new Map(), casts: new Map(), lastState: 0,
    lagOut: ws.lagOut,
  };
  combat.init(p);
  players.set(id, p);
  ws.playerId = id;
  spawnPlayer(p, pickSpawn(p), false);
  send(p, {
    t: 'welcome', id, st: now(), you: info(p), players: [...players.values()].filter((o) => o !== p).map(info),
    dummy: info(dummy), match: matchInfo(), map: mapHash(MAP), lag: LAG ? 1 : 0,
  });
  broadcast({ t: 'join', player: info(p) }, id);
  log(`+ ${p.name} joined (#${id}, ${players.size} in room)`);
  sendGauge(p);
  updatePhase();
  sendScoreboard();
}

// ---------------------------------------------------------------- spawns

/** The spawn point farthest from every living fighter. */
function pickSpawn(p) {
  let best = MAP.spawns[0], bestD = -1;
  for (const sp of MAP.spawns) {
    let d = 1e9;
    for (const o of players.values()) {
      if (o === p || !o.alive) continue;
      d = Math.min(d, Math.hypot(o.s[0] - sp.p[0], o.s[2] - sp.p[2]));
    }
    d += Math.random() * 4;
    if (d > bestD) {
      bestD = d;
      best = sp;
    }
  }
  return best;
}

/** A server-authoritative teleport: full health, spawn protection, new state sequence. */
function spawnPlayer(p, sp, announce = true) {
  const C = charOf(p.ch);
  p.seq++;
  p.hp = maxHp(C);
  p.alive = true;
  p.respawnAt = 0;
  if (ULT_FULL) p.ult = 100;
  p.react = null;
  p.combo = null;
  p.stuns = [];
  p.dmgFrom.clear();
  p.protectUntil = now() + MATCH.spawnProtect * 1000;
  p.s = [sp.p[0], sp.p[1], sp.p[2], 0, 0, 0, sp.yaw, ST.loco, 0, 0];
  p.hist.length = 0;
  p.at = now();
  combat.record(p, p.at);
  if (announce) broadcast({ t: 'spawn', id: p.id, p: sp.p, yaw: sp.yaw, seq: p.seq, hp: p.hp, prot: MATCH.spawnProtect });
}

// ---------------------------------------------------------------- messages

function handleState(p, msg) {
  const s = msg.s;
  if (!Array.isArray(s) || s.length < 10) return;
  // a state sent before our latest teleport (spawn, hit reaction, substitution) would drag the fighter back
  if (msg.n !== p.seq) {
    if (++p.staleStates % 30 === 0) log(`  ${p.name}: ${p.staleStates} states with seq ${msg.n} dropped (server seq ${p.seq})`);
    return;
  }
  if (!p.alive) return;
  const t = now();
  const x = clamp(clean(s[0], p.s[0]), BOUNDS.minX - 1, BOUNDS.maxX + 1);
  const y = clamp(clean(s[1], p.s[1]), -6, 80);
  const z = clamp(clean(s[2], p.s[2]), BOUNDS.minZ - 1, BOUNDS.maxZ + 1);
  // sanity: nobody moves faster than a dash or a knockback (tolerant of stalls: scaled by the real gap)
  const gap = Math.max(0.033, Math.min(2, (t - p.lastState) / 1000));
  // (a fighter that keeps reporting the new place for ~0.3 s is resynced: a stall or a missed teleport, not a cheat)
  if (p.lastState && Math.hypot(x - p.s[0], z - p.s[2]) > 32 * gap + 2.5 && (p.speedFlags || 0) < 10) {
    p.speedFlags = (p.speedFlags || 0) + 1;
    return;
  }
  if (p.speedFlags >= 10) log(`  ${p.name} resynced after a jump of ${Math.hypot(x - p.s[0], z - p.s[2]).toFixed(1)} m`);
  p.speedFlags = 0;
  p.lastState = t;
  p.s = [
    r3(x), r3(y), r3(z),
    r3(clamp(clean(s[3]), -60, 60)), r3(clamp(clean(s[4]), -60, 60)), r3(clamp(clean(s[5]), -60, 60)),
    r3(clean(s[6])),
    clamp(Math.round(clean(s[7])), 0, 31),
    clamp(Math.round(clean(s[8])), 0, 60000),
    clamp(Math.round(clean(s[9])), 0, 255) & ~FLAG.dead,
  ];
  p.at = t;
  combat.record(p, t);
}

const ACT_KINDS = new Set(['atk', 'dash', 'jump', 'dj', 'sub', 'guard', 'charge', 'jutsu', 'tool', 'tech', 'land', 'emote']);

function handleAct(p, msg) {
  if (!ACT_KINDS.has(msg.k) || !p.alive) return;
  const t = now();
  // the action's time on the shared clock; never trust one from the future or far in the past
  const at = clamp(clean(msg.at, t), t - NET.rewindCap - 200, t + 30);
  // r = when it reached the server: remotes play it on the same clock as the state stream (stamped on arrival)
  const out = { t: 'a', id: p.id, k: msg.k, at: Math.round(at), r: Math.round(t) };
  const C = charOf(p.ch);
  switch (msg.k) {
    case 'atk': {
      const m = String(msg.m);
      if (!C.moves[m]) return;
      out.m = m;
      out.i = msg.i | 0;
      if (Number.isFinite(msg.tg)) out.tg = msg.tg | 0;
      p.acts.set(out.i, { m, at, k: 'atk' });
      p.protectUntil = 0;
      break;
    }
    case 'jutsu':
    case 'tool': {
      const m = String(msg.m);
      const J = C.jutsu[m];
      if (!J) return;
      // Madara's kit casts in phases: a later phase (the effect: torrent, slam, release, a reflection) needs the
      // paid first phase of the same instance, so an effect is never free
      const prev = p.acts.get(msg.i | 0);
      if (J.hits && msg.n && !(prev && prev.m === m)) return;
      // n > 0: a later phase of the same cast (the Rasenshuriken's throw, its impact): no new cooldown
      if (J.cd && !msg.n) {
        const last = p.casts.get(m) || -1e9;
        if (t - last < J.cd * 1000 - 600) return send(p, { t: 'deny', k: msg.k, m, i: msg.i | 0 });
        p.casts.set(m, t);
      }
      if (J.ult && !msg.n) {
        if (p.ult < 99.5) return send(p, { t: 'deny', k: msg.k, m, i: msg.i | 0 });
        p.ult = ULT_FULL ? 100 : 0;
        sendGauge(p);
      }
      out.m = m;
      out.i = msg.i | 0;
      // o: an origin [x, y, z] (projectiles) or [x, y, z, yaw] (the shadow clones' cast point and facing)
      if (Array.isArray(msg.o) && (msg.o.length === 3 || msg.o.length === 4) && msg.o.every(Number.isFinite)) out.o = msg.o.map(r3);
      if (Array.isArray(msg.d) && msg.d.length === 3 && msg.d.every(Number.isFinite)) out.d = msg.d.map(r3);
      if (Number.isFinite(msg.tg)) out.tg = msg.tg | 0;
      if (Number.isFinite(msg.n)) out.n = msg.n | 0;
      if (Number.isFinite(msg.f)) out.f = msg.f & 255; // cast flags (Madara's kit: 1 = cast in the air)
      if (J.hits) {
        // Madara's kit: the act keeps its first phase's time and gathers each later phase's payload (the area
        // hits are validated against it: madarakit.js)
        const act = msg.n ? prev : { m, at: out.at, k: msg.k, life: (J.life || 4) * 1000 };
        if (msg.n) combat.castPhase(p, act, out);
        p.acts.set(out.i, act);
        if (process.env.SHINOBI_DEBUG) log(`  ${p.name} cast ${m} #${out.i} phase ${out.n || 0}${act.fx ? ` (${act.fx.kind} placed)` : ''}`);
      } else p.acts.set(out.i, { m, at, k: msg.k });
      p.protectUntil = 0;
      break;
    }
    case 'dash':
      p.dashAt = at;
      if (Array.isArray(msg.d) && msg.d.length === 2) out.d = msg.d.map((v) => Math.round(clean(v) * 100) / 100);
      out.air = msg.air ? 1 : 0;
      break;
    case 'sub': {
      // substitution: only while stunned, costs a pip, invulnerable for a moment; the victim teleports
      if (p.pips < 1 || !combat.stunnedAt(p, at)) {
        if (process.env.SHINOBI_DEBUG) log(`  sub denied (${p.name}): pips ${p.pips}, at ${Math.round(at)} (now ${Math.round(t)}), windows ${JSON.stringify((p.stuns || []).map((w) => w.map(Math.round)))}`);
        return send(p, { t: 'deny', k: 'sub', why: p.pips < 1 ? 'pips' : 'state' });
      }
      p.pips--;
      p.pipT = 0;
      p.subAt = at;
      const from = combat.posAt(p, at, {});
      out.f = [r3(from.x), r3(from.y), r3(from.z)];
      if (Array.isArray(msg.p) && msg.p.length === 3 && msg.p.every(Number.isFinite)) out.p = msg.p.map(r3);
      else out.p = out.f;
      p.react = null;
      p.combo = null;
      p.seq++;
      out.sq = p.seq;
      p.s[0] = out.p[0];
      p.s[1] = out.p[1];
      p.s[2] = out.p[2];
      p.at = t;
      combat.record(p, t);
      broadcast(out); // everyone, the sender included (it learns the new seq)
      sendGauge(p);
      return;
    }
    case 'tech': {
      const r = p.react;
      if (!r || !r.land || at < r.land - 60 || at > r.land + 400) return;
      r.end = at; // the roll hands control back; the roll itself is a dash (invulnerable start)
      p.dashAt = at;
      out.sq = ++p.seq;
      broadcast(out);
      return;
    }
    case 'guard':
    case 'charge':
      out.on = msg.on ? 1 : 0;
      if (msg.k === 'guard') p.guard = !!msg.on;
      break;
    default:
      break;
  }
  broadcast(out, p.id);
}

function handleHit(p, msg) {
  const allowed = match.phase !== 'results';
  const val = combat.validate(p, msg, { players, dummy, allowed });
  if (!val.ok) {
    if (process.env.SHINOBI_DEBUG) log(`  hit rejected (${p.name} -> ${msg.v} ${msg.m}): ${val.why}`);
    send(p, { t: 'hitx', v: msg.v, i: msg.i, k: msg.k | 0, why: val.why });
    return;
  }
  const v = val.v;
  const out = combat.apply(p, val, msg);
  const res = out.res;
  delete out.res;
  if (v.dummy) {
    v.lastHit = now();
    v.hp = Math.max(1, v.hp - res.dmg);
  } else if (!res.blocked || res.dmg > 0) {
    // (a blocked hit costs HP only when its move chips through guards)
    v.hp = Math.max(0, v.hp - res.dmg);
    const prev = v.dmgFrom.get(p.id);
    v.dmgFrom.set(p.id, { dmg: (prev?.dmg || 0) + res.dmg, t: now() });
    const C = charOf(p.ch), CV = charOf(v.ch);
    p.ult = Math.min(100, p.ult + res.dmg * C.stats.ultDealt);
    v.ult = Math.min(100, v.ult + res.dmg * CV.stats.ultTaken);
    sendGauge(p);
    sendGauge(v);
  }
  out.hp = v.hp;
  broadcast(out);
  if (!v.dummy && v.hp <= 0 && v.alive) kill(v, p, out);
}

function kill(v, killer, hit) {
  const t = now();
  v.alive = false;
  v.respawnAt = t + T.respawn * 1000;
  const counts = match.phase === 'live';
  const assists = [];
  for (const [id, rec] of v.dmgFrom) {
    if (id === killer.id || t - rec.t > MATCH.assistWindow * 1000) continue;
    const ap = players.get(id);
    if (!ap) continue;
    assists.push(id);
    if (counts) {
      ap.a++;
      ap.score += MATCH.assistScore;
    }
  }
  if (counts) {
    v.d++;
    killer.k++;
    killer.score += MATCH.killScore;
  }
  killer.streak = (killer.streak || 0) + 1;
  v.streak = 0;
  broadcast({ t: 'kill', k: killer.id, v: v.id, as: assists, m: hit.m, live: counts ? 1 : 0, rs: T.respawn, st: killer.streak });
  sendScoreboard();
}

function sendGauge(p) {
  send(p, { t: 'gauge', u: Math.round(p.ult * 10) / 10, sp: p.pips });
}

// ---------------------------------------------------------------- match loop

function setPhase(phase, seconds = 0) {
  match.phase = phase;
  match.endsAt = seconds ? now() + seconds * 1000 : 0;
  broadcast({ t: 'match', ...matchInfo() });
  log(`  match: ${phase}${seconds ? ` (${seconds}s)` : ''}`);
}

function updatePhase() {
  const n = players.size;
  if (match.phase === 'warmup' && n >= 2) startMatch();
  else if (match.phase === 'live' && n < 1) setPhase('warmup');
}

function startMatch() {
  match.n++;
  for (const p of players.values()) {
    p.k = p.d = p.a = p.score = 0;
    p.streak = 0;
    spawnPlayer(p, pickSpawn(p));
  }
  setPhase('live', T.duration);
  sendScoreboard();
}

function endMatch() {
  const rows = [...players.values()].map((p) => [p.id, p.name, p.slot, p.k, p.d, p.a, p.score]);
  rows.sort((a, b) => b[6] - a[6] || b[3] - a[3] || a[4] - b[4]);
  match.results = { ps: rows, win: rows[0] ? rows[0][0] : null, mvp: rows[0] ? rows[0][0] : null, n: match.n };
  setPhase('results', T.results);
  broadcast({ t: 'results', ...match.results });
}

let lastTick = now();
setInterval(() => {
  const t = now();
  const dt = (t - lastTick) / 1000;
  lastTick = t;
  if (match.endsAt && t >= match.endsAt) {
    if (match.phase === 'live') endMatch();
    else if (match.phase === 'results') {
      if (players.size >= 2) startMatch();
      else {
        setPhase('warmup');
        for (const p of players.values()) if (!p.alive) spawnPlayer(p, pickSpawn(p));
      }
    }
  }
  for (const p of players.values()) {
    combat.prune(p, t);
    if (!p.alive) {
      if (match.phase !== 'results' && p.respawnAt && t >= p.respawnAt) spawnPlayer(p, pickSpawn(p));
      continue;
    }
    // substitution pips regenerate one at a time
    const C = charOf(p.ch);
    if (p.pips < C.stats.subPips) {
      p.pipT += dt;
      if (p.pipT >= C.stats.subRegen) {
        p.pipT = 0;
        p.pips++;
        sendGauge(p);
      }
    }
  }
  // the dummy heals once it has been left alone
  combat.prune(dummy, t);
  if (dummy.hp < 1000 && t - dummy.lastHit > 3000) dummy.hp = 1000;
}, 100);

function sendScoreboard() {
  // [id, kills, deaths, assists, score, ping, alive, slot]
  const ps = [...players.values()].map((p) => [p.id, p.k, p.d, p.a, p.score, Math.round(p.ping), p.alive ? 1 : 0, p.slot]);
  broadcast({ t: 'sb', ps });
}
setInterval(() => players.size && sendScoreboard(), 1000);

// snapshots: [id, x, y, z, vx, vy, vz, yaw, state, stateMs, flags, at, seq]
setInterval(() => {
  if (!players.size) return;
  const ps = [];
  for (const p of players.values()) ps.push([p.id, ...stateOut(p), Math.round(p.at * 10) / 10, p.seq]);
  broadcast({ t: 'snap', st: Math.round(now() * 10) / 10, ps });
}, 1000 / NET.snapshotRate);

function onMessage(ws, raw) {
  if (raw.length > 4096) return;
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  if (!msg || typeof msg.t !== 'string') return;
  if (msg.t === 'ping') {
    const pp = players.get(ws.playerId);
    if (pp && typeof msg.r === 'number' && msg.r >= 0 && msg.r < 10000) pp.ping = msg.r;
    // stamped when the server handles it; the simulated outbound delay comes after, like a real network
    const out = JSON.stringify({ t: 'pong', c: clean(msg.c), s: now() });
    if (ws.lagOut) ws.lagOut.run(() => ws.readyState === 1 && ws.send(out));
    else ws.send(out);
    return;
  }
  if (msg.t === 'join') return handleJoin(ws, msg);
  const p = players.get(ws.playerId);
  if (!p) return;
  switch (msg.t) {
    case 's':
      handleState(p, msg);
      break;
    case 'a':
      handleAct(p, msg);
      break;
    case 'hit':
      handleHit(p, msg);
      break;
    case 'name':
      p.name = autoName(msg.name, p.ch, p);
      broadcast({ t: 'name', id: p.id, name: p.name });
      break;
  }
}

function onClose(ws) {
  const p = players.get(ws.playerId);
  if (!p) return;
  players.delete(p.id);
  if (p.token) ghosts.set(p.token, { name: p.name, slot: p.slot, k: p.k, d: p.d, a: p.a, score: p.score, ult: p.ult, until: now() + NET.ghostMs });
  broadcast({ t: 'leave', id: p.id });
  log(`- ${p.name} left (${players.size} in room)`);
  updatePhase();
}
setInterval(() => {
  const t = now();
  for (const [k, g] of ghosts) if (g.until < t) ghosts.delete(k);
}, 5000);

// ---------------------------------------------------------------- http

// gzip text and models once, keep them in memory (the owner's upload is the bottleneck over a tunnel)
const GZIP = new Set(['.html', '.js', '.css', '.json', '.bin', '.glb', '.vrm', '.svg']);
const gzCache = new Map();
function gzipped(file, st) {
  const hit = gzCache.get(file);
  if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit.buf;
  const buf = fs.promises.readFile(file).then((data) => new Promise((ok, fail) => zlib.gzip(data, { level: 6 }, (err, out) => (err ? fail(err) : ok(out)))));
  gzCache.set(file, { mtime: st.mtimeMs, size: st.size, buf });
  buf.catch(() => gzCache.delete(file));
  return buf;
}

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({
      players: players.size, max: NET.maxPlayers, names: [...players.values()].map((p) => p.name),
      match: { ph: match.phase, left: match.endsAt ? Math.max(0, Math.round((match.endsAt - now()) / 1000)) : 0 },
      lag: LAG,
    }));
    return;
  }
  if (!fs.existsSync(DIST)) {
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    res.end('Client not built yet. Run "npm start" (builds + serves) or "npm run build".');
    return;
  }
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(DIST, rel));
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end();
    return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const head = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': rel.startsWith('/assets/') ? 'public, max-age=86400' : 'no-cache' };
    if (GZIP.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      gzipped(file, st).then((buf) => {
        res.writeHead(200, { ...head, 'Content-Encoding': 'gzip', 'Content-Length': buf.length, Vary: 'Accept-Encoding' });
        res.end(req.method === 'HEAD' ? undefined : buf);
      }, () => res.writeHead(500).end());
      return;
    }
    res.writeHead(200, { ...head, 'Content-Length': st.size });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1 << 16 });

wss.on('connection', (ws) => {
  ws.missed = 0;
  if (LAG) {
    ws.lagOut = new LagLine(LAG);
    ws.lagIn = new LagLine(LAG);
  }
  ws.on('pong', () => (ws.missed = 0));
  ws.on('message', (data) => {
    const raw = data.toString();
    if (ws.lagIn) ws.lagIn.run(() => onMessage(ws, raw));
    else onMessage(ws, raw);
  });
  ws.on('close', () => (ws.lagIn ? ws.lagIn.run(() => onClose(ws)) : onClose(ws)));
  ws.on('error', () => {});
});

// drop connections that stop answering; a tab can stall for seconds (shader compiles), so allow missed beats
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.missed >= 4) {
      ws.terminate();
      continue;
    }
    ws.missed++;
    ws.ping();
  }
}, 4000);

function log(s) {
  console.log(`[${new Date().toLocaleTimeString()}] ${s}`);
}

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`\n  Port ${PORT} is already in use (is the game already running?). Set PORT=... to use another one.\n`);
  else console.error(e);
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  const lan = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log('\n  SHINOBI ARENA server running\n');
  console.log(`  This laptop:     http://localhost:${PORT}`);
  for (const ip of lan) console.log(`  Friends (LAN):   http://${ip}:${PORT}`);
  console.log(`  Over the internet: npm run share  (prints a https link)`);
  if (LAG) console.log(`\n  LAG SIMULATION ON: rtt ${LAG.rtt} ms, jitter ${LAG.jitter} ms, loss ${LAG.loss}%`);
  console.log('');
});

export { REACT };
