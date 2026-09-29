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
import { REACT, hitSpec } from '../src/shared/combat.js';
import { counterWindow, COUNTER_KIND } from '../src/shared/madarakit.js';
import { inGaze } from '../src/shared/itachikit.js';
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
// Password-locked characters (the owner's rule): joining as one needs `join.pw`. Kept here only, never in the
// client bundle; the title screen asks for it (characters with `locked: true`).
const LOCKED = { itachi: 'HUNNY' };
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
// An ultimate's cinematic (Itachi's Amaterasu): { id, i, at, from, to } (server ms). From `from` to `to` the whole arena
// holds still: every screen plays the same cinematic on this clock, no input moves anyone, no hit lands (the cinematic's
// own ignition aside) and burns wait. One at a time: another is refused while one runs.
let cinema = null;
const cinemaAt = (t) => !!cinema && t >= cinema.from && t <= cinema.to;

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
  const ch = CHARACTERS[msg.ch] ? msg.ch : DEFAULT_CHARACTER;
  if (LOCKED[ch] && String(msg.pw ?? '').trim() !== LOCKED[ch]) {
    ws.send(JSON.stringify({ t: 'locked', ch, pw: msg.pw ? 1 : 0 }));
    log(`  refused ${ch} (${msg.pw ? 'wrong' : 'no'} password)`);
    return;
  }
  const id = nextId++;
  const token = typeof msg.token === 'string' ? msg.token.slice(0, 40) : '';
  const ghost = token && ghosts.get(token);
  if (ghost) ghosts.delete(token);
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
  p.burn = null;
  p.escape = null;
  p.cine = null;
  // (its caster respawned, e.g. a match starting: a cinematic ends; every screen drops it on his spawn)
  if (cinema?.id === p.id) cinema.to = Math.min(cinema.to, now());
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
      if (J.counter && msg.n) return; // (the counter's later phase comes from the server)
      if ((J.hits || J.escape) && msg.n && !(prev && prev.m === m)) return;
      // Itachi's kit: each later phase once (a fireball per shot, one gaze, one teleport)
      const maxN = J.shots ? J.shots.length : J.gaze !== undefined || J.focus !== undefined || J.escape ? 1 : 0;
      if (maxN && msg.n && (msg.n > maxN || prev.phases?.[msg.n])) return;
      // n > 0: a later phase of the same cast (the Rasenshuriken's throw, its impact): no new cooldown
      if (J.cd && !msg.n) {
        const last = p.casts.get(m) || -1e9;
        if (t - last < J.cd * 1000 - 600) return send(p, { t: 'deny', k: msg.k, m, i: msg.i | 0 });
        p.casts.set(m, t);
      }
      // (an ultimate's cinematic while another plays: refused, the gauge kept)
      if (J.cinema && !msg.n && cinema && t < cinema.to + 150) return send(p, { t: 'deny', k: msg.k, m, i: msg.i | 0 });
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
      // an aimed area (the meteor) can't land farther than its range from where the caster stood
      if (J.hits && J.range && msg.n && out.o) {
        const c = combat.posAt(p, at, {});
        if (Math.hypot(out.o[0] - c.x, out.o[2] - c.z) > J.range + 8) return;
      }
      if (J.escape) {
        // Crow Clone Escape: invulnerable from the press; the teleport (n:1) goes to everyone, the sender included
        if (!msg.n) {
          p.escape = [at, at + J.invuln * 1000];
          p.acts.set(out.i, { m, at, k: msg.k, life: 3000 });
        } else return crowTeleport(p, J, prev, out);
      } else if (J.hits) {
        // Madara's kit: the act keeps its first phase's time and gathers each later phase's payload (the area
        // hits are validated against it: madarakit.js)
        const act = msg.n ? prev : { m, at: out.at, k: msg.k, life: (J.life || 4) * 1000 };
        if (msg.n) combat.castPhase(p, act, out);
        p.acts.set(out.i, act);
        if (J.cinema && !msg.n) {
          // the cinematic: everyone's screen plays it from out.at; he is untouchable from the press to its end
          const F = 1000 / 60;
          cinema = { id: p.id, i: out.i, at: out.at, from: out.at + J.cinema[0] * F, to: out.at + J.cinema[1] * F };
          p.cine = [out.at, cinema.to];
          if (process.env.SHINOBI_DEBUG) log(`  ${p.name}'s ${m}: the arena holds still ${Math.round(cinema.from)}-${Math.round(cinema.to)}`);
        }
        // (its victims are taken at the pick and told to everyone, the caster included: see gazeHits)
        if (J.cinema && msg.n === 1) {
          if (out.o && out.d) gazeHits(p, J, m, out, act);
          return;
        }
        // Itachi's gazes (Tsukuyomi, Amaterasu): who they take is decided here, at the gaze's time
        if (msg.n === 1 && (J.gaze !== undefined || J.focus !== undefined) && out.o && out.d) gazeHits(p, J, m, out);
        // the meteor lands on the server's clock whatever happens to its caster's client
        if (act.fx?.kind === 'meteor' && !act.fx.due) {
          act.fx.due = act.fx.at1 + J.delay * 1000;
          setTimeout(() => meteorImpact(p, act, out.i), Math.max(0, act.fx.due + METEOR_LEAD + 10 - now()));
        }
        // the wind barrier: up from the press, unless a hit's reaction already had him then (it reached the server
        // first; his client's cast ends when that hitr arrives). The gust bursts out at gustAt (server clock).
        if (J.counter) {
          const r = p.react;
          p.counter = r && at <= r.end && r.react !== REACT.guard ? null : { m, i: out.i, at, w: counterWindow(J, at), nr: 0, last: new Map() };
          if (p.counter) {
            const ctr = p.counter;
            setTimeout(() => gustBurst(p, ctr), Math.max(0, at + J.gustAt * (1000 / 60) + METEOR_LEAD - now()));
          }
        }
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
  // (inside an ultimate's cinematic nothing lands: every screen was watching it)
  if (val.ok && cinemaAt(val.at)) Object.assign(val, { ok: false, why: 'cinema' });
  if (!val.ok) {
    if (process.env.SHINOBI_DEBUG) log(`  hit rejected (${p.name} -> ${msg.v} ${msg.m}): ${val.why}`);
    send(p, { t: 'hitx', v: msg.v, i: msg.i, k: msg.k | 0, why: val.why });
    return;
  }
  // Madara's wind barrier: a hit inside its window is answered instead of taken, and so is every later hit of an
  // attack it already deflected (a Rasenshuriken's burst, a torrent's ticks: they don't resume when it drops)
  const dk = val.v.deflected?.get(`${p.id}:${msg.i | 0}`);
  if (dk && now() < dk) return send(p, { t: 'hitx', v: val.v.id, i: msg.i, k: msg.k | 0, why: 'counter' });
  const ctr = !val.v.dummy && combat.counterFor(val.v, val.spec, val.at);
  if (ctr) return counterHit(val.v, p, val, msg, ctr);
  applyHit(p, val, msg);
}

/** A validated hit: the result, HP, gauges, the broadcast, a KO. */
function applyHit(p, val, msg) {
  const v = val.v;
  // (a server-applied hit inside an ultimate's cinematic (a meteor, a barrier's answer) is lost like any other; the
  // cinematic's own ignition and burn are its point)
  if (val.srv && cinemaAt(val.at) && !(cinema.id === p.id && msg.i === cinema.i)) return;
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

/**
 * Madara's wind barrier answers a hit (v: the barrier's owner, att: whoever hit it). The hit is refused (the attacker's
 * client undoes its prediction, though it never makes one against a barrier it knows of) and every screen, the
 * owner's included, gets the cast's phase n:1: `f` = 1 a blow (a melee hit: the attacker is thrown back; `cl`: it
 * answered a shadow clone, which is dispelled), 2 a reflection (a projectile flies back to the thrower, arriving at
 * `e`), 3 a deflection (an ultimate, an area jutsu). `o`: where the threat was. Any number of answers per cast; the
 * effects of one attacker's kind are sent at most every 150 ms (a torrent's ticks, a string's follow-ups).
 */
const DEFLECTED_MS = 3000; // how long a deflected attack's later hits are refused (its longest: a Rasenshuriken's burst)
function counterHit(v, att, val, msg, ctr) {
  const t = now(), J = charOf(v.ch).jutsu[ctr.m], F = 1000 / 60;
  const kind = COUNTER_KIND[val.spec.cls] || 3;
  send(att, { t: 'hitx', v: v.id, i: msg.i, k: msg.k | 0, why: 'counter' });
  // the owner where the attacker saw him; the threat at its own position (a clone, a projectile, a flame), else the attacker
  const vp = val.p, o = [val.ax, val.ay, val.az].map(r3);
  const tb = val.at + J.answer * F; // the answer leaves the wind shell
  const clone = kind === 1 && String(msg.m).split(':')[0] === 'clone';
  // the rest of this attack is spent on the barrier too (the attacker's screen hears it from `ai`)
  (v.deflected ||= new Map()).set(`${att.id}:${msg.i | 0}`, t + DEFLECTED_MS);
  for (const [k, until] of v.deflected) if (until < t) v.deflected.delete(k);
  const tk = `${att.id}:${kind}:${clone ? 1 : 0}`;
  if (kind !== 2 && t - (ctr.last.get(tk) ?? -1e9) < 150) return;
  ctr.last.set(tk, t);
  const out = { t: 'a', id: v.id, k: 'jutsu', m: ctr.m, i: ctr.i, n: 1, at: Math.round(val.at), r: Math.round(t), tg: att.id, ai: msg.i | 0, f: kind, o };
  if (clone) out.cl = 1;
  if (kind === 2) {
    const ap = combat.posAt(att, t, {}), speed = charOf(att.ch).jutsu.shuriken.proj.speed * J.reflectSpeed;
    out.e = Math.round(tb + (Math.hypot(ap.x - o[0], ap.y + 1.1 - o[1], ap.z - o[2]) / speed) * 1000);
  }
  if (process.env.SHINOBI_DEBUG) log(`  ${v.name}'s barrier answered ${att.name}'s ${msg.m} (kind ${kind}${out.cl ? ', a clone' : ''})`);
  broadcast(out);
  if (kind === 1 && !clone) {
    // the blow: the attacker is in reach (a melee hit just connected) unless it dodged away in time; once per cast
    const spec = hitSpec(v.ch, `${ctr.m}:blow`);
    if (combat.invulnAt(att, tb) || Math.hypot(o[0] - vp[0], o[2] - vp[2]) > spec.reach + 1.5) return;
    serverHit(v, att, spec, `${ctr.m}:blow`, ctr.i, 0, tb, [val.ax, val.ay, val.az], vp, `${v.id}:${ctr.i}:0:${att.id}`);
  } else if (kind === 2) {
    const n = ctr.nr++;
    setTimeout(() => reflectHit(v, att, ctr, o, out.e, n), Math.max(0, out.e - now()));
  }
}

/** A reflected projectile reaches its thrower: it hits unless the thrower is invulnerable then or behind cover. */
function reflectHit(v, att, ctr, o, at, n) {
  if (!players.has(att.id) || !players.has(v.id) || !att.alive || match.phase === 'results') return;
  const why = combat.invulnAt(att, at);
  const ap = combat.posAt(att, at, {});
  if (why || !world.clear(o[0], o[1], o[2], ap.x, ap.y + 1.1, ap.z)) {
    if (process.env.SHINOBI_DEBUG) log(`  reflection missed ${att.name}: ${why || 'cover'}`);
    return;
  }
  serverHit(v, att, hitSpec(v.ch, `${ctr.m}:reflect`), `${ctr.m}:reflect`, ctr.i, 1, at, [ap.x, ap.y, ap.z], o, `${v.id}:${ctr.i}:1:${att.id}:${n}`);
}

/**
 * The barrier's burst (server clock T = the press + gustAt, the middle of the spin): everyone within the gust's
 * radius of his feet, in the open, not invulnerable, is thrown back a little. Judged where each victim's own screen
 * had it (its states arrive ~half its ping later, up to METEOR_LEAD), like the meteor.
 */
function gustBurst(p, ctr) {
  if (!players.has(p.id) || !p.alive || p.counter !== ctr || match.phase === 'results') return;
  const J = charOf(p.ch).jutsu[ctr.m], T = ctr.at + J.gustAt * (1000 / 60), G = J.gust;
  const c = combat.posAt(p, T, {}), spec = hitSpec(p.ch, `${ctr.m}:gust`);
  for (const v of [...players.values(), dummy]) {
    // (one throw per cast: an attacker the barrier already blew back isn't caught again)
    if (v === p || !v.alive || v.hitDone.has(`${p.id}:${ctr.i}:0:${v.id}`)) continue;
    const vp = combat.posAt(v, T + (v.dummy ? 0 : Math.min(METEOR_LEAD, (v.ping || 0) / 2)), {});
    if (Math.hypot(vp.x - c.x, vp.z - c.z) > G.radius + 0.34 || Math.abs(vp.y - c.y) > G.height) continue;
    const why = combat.invulnAt(v, T) || (world.clear(c.x, c.y + 1.0, c.z, vp.x, vp.y + 1.0, vp.z) ? null : 'cover');
    if (why) {
      if (process.env.SHINOBI_DEBUG) log(`  gust spared ${v.name}: ${why}`);
      continue;
    }
    serverHit(p, v, spec, `${ctr.m}:gust`, ctr.i, 2, T, [vp.x, vp.y, vp.z], [c.x, c.y, c.z], `${p.id}:${ctr.i}:2:${v.id}`);
  }
}

/**
 * A hit the server applies itself (the barrier's blow / reflection / gust, the meteor): once per key, and another
 * Madara's barrier deflects it like any other hit. src: where it comes from (the knockback pushes away from it).
 */
function serverHit(att, v, spec, m, i, k, at, p, src, key) {
  if (v.hitDone.has(key)) return false;
  const ctr = !v.dummy && combat.counterFor(v, spec, at);
  if (ctr) {
    const tk = `${att.id}:3:0`, t = now();
    if (t - (ctr.last.get(tk) ?? -1e9) < 150) return false;
    ctr.last.set(tk, t);
    broadcast({ t: 'a', id: v.id, k: 'jutsu', m: ctr.m, i: ctr.i, n: 1, at: Math.round(at), r: Math.round(t), tg: att.id, f: 3, o: src.map(r3) });
    return false;
  }
  applyHit(att, { v, spec, at, p, rw: p.map(r3), ax: src[0], ay: src[1], az: src[2], ayaw: 0, key, srv: true }, { m, i, k });
  return true;
}

/**
 * Itachi's gaze (Tsukuyomi, Amaterasu) at the caster's gaze time T (his n:1: o = his eyes, d = his facing): everyone
 * inside the cone (itachikit.js inGaze) with a clear line from his eyes to their chest, not invulnerable then, is
 * taken. Each victim is judged where its own screen had it (its states arrive ~half its ping later, like the meteor).
 * Tsukuyomi dazes; Amaterasu ignites, then burns (burnStep) until the flames have taken their share of max HP.
 */
function gazeHits(p, J, m, out, act = null) {
  // (a cinematic's pick always reaches every screen, empty or not: they wait for it to know whom the flames take)
  const tell = () => J.cinema && broadcast(out);
  if (J.cinema) out.v = [];
  if (match.phase === 'results') return tell();
  const T = out.at, o = out.o, d = out.d;
  const c = combat.posAt(p, T, {});
  if (Math.hypot(o[0] - c.x, o[2] - c.z) > 2.5 || o[1] - c.y < 0.3 || o[1] - c.y > 2.6) {
    if (process.env.SHINOBI_DEBUG) log(`  ${p.name}'s ${m}: eyes too far from the body`);
    return tell();
  }
  const hid = m === 'tsukuyomi' ? `${m}:main` : `${m}:ignite`, spec = hitSpec(p.ch, hid);
  for (const v of [...players.values(), dummy]) {
    if (v === p || !v.alive) continue;
    const vp = combat.posAt(v, T + (v.dummy ? 0 : Math.min(METEOR_LEAD, (v.ping || 0) / 2)), {});
    if (!inGaze(J, o, d, [vp.x, vp.y, vp.z])) continue;
    const why = combat.invulnAt(v, T) || (world.clear(o[0], o[1], o[2], vp.x, vp.y + 1.1, vp.z) ? null : 'cover');
    if (why) {
      if (process.env.SHINOBI_DEBUG) log(`  ${m} spared ${v.name}: ${why}`);
      continue;
    }
    if (J.cinema) out.v.push(v.id);
    else if (serverHit(p, v, spec, hid, out.i, 0, T, [vp.x, vp.y, vp.z], o, `${p.id}:${out.i}:0:${v.id}`) && J.burn && v.alive) ignite(p, v, J, m, out.i, spec, T);
  }
  if (!J.cinema) return;
  // the cinematic: every screen learns now whom the flames take and when (e); the server lights them on its own clock
  // at the focus, whatever becomes of the caster's client meanwhile
  const TF = act.at + J.focus * (1000 / 60);
  out.e = Math.round(TF);
  tell();
  if (process.env.SHINOBI_DEBUG) log(`  ${p.name}'s ${m} takes [${out.v.join(', ')}], flames at ${out.e}`);
  const ids = out.v.slice();
  setTimeout(() => {
    // (cut short: its caster respawned or left before the flames)
    if (!players.has(p.id) || match.phase === 'results' || !(cinema?.id === p.id && cinema.i === out.i && cinema.to >= TF - 1)) return;
    for (const id of ids) {
      const v = id === 0 ? dummy : players.get(id);
      if (!v || !v.alive) continue;
      const vp = combat.posAt(v, TF, {});
      if (serverHit(p, v, spec, hid, out.i, 0, TF, [vp.x, vp.y, vp.z], o, `${p.id}:${out.i}:0:${v.id}`) && v.alive) ignite(p, v, J, m, out.i, spec, TF);
    }
  }, Math.max(0, TF - now()));
}

/** Amaterasu's flames take hold on v at T: they burn frac of max HP, the ignition included (a new one starts the count again). */
function ignite(p, v, J, m, i, spec, T) {
  const max = v.dummy ? 1000 : maxHp(charOf(v.ch));
  v.burn = { att: p.id, m, i, left: Math.round(max * J.burn.frac) - spec.dmg, next: T + J.burn.every * (1000 / 60), every: J.burn.every * (1000 / 60), k: 0 };
}

/** Amaterasu burning on v: every tick due by t (server-applied, unblockable, through any invulnerability or barrier). */
function burnStep(v, t) {
  const b = v.burn;
  // (another ultimate's cinematic: the flames wait for its end)
  if (cinemaAt(b.next) && !(cinema.id === b.att && cinema.i === b.i)) b.next = cinema.to + 1;
  while (v.burn === b && t >= b.next) {
    const att = players.get(b.att);
    if (!att || !v.alive || match.phase === 'results' || b.left <= 0) {
      v.burn = null;
      return;
    }
    const base = hitSpec(att.ch, `${b.m}:burn`), dmg = Math.min(base.dmg, b.left);
    const spec = dmg === base.dmg ? base : { ...base, dmg };
    const at = b.next, vp = combat.posAt(v, at, {}), pp = [vp.x, vp.y, vp.z];
    b.left -= dmg;
    const k = 10 + b.k++;
    b.next += b.every;
    if (b.left <= 0) v.burn = null;
    applyHit(att, { v, spec, at, p: pp, rw: pp.map(r3), ax: vp.x, ay: vp.y, az: vp.z, ayaw: v.s[6], key: `${att.id}:${b.i}:${k}:${v.id}`, srv: true }, { m: `${b.m}:burn`, i: b.i, k });
  }
}

/**
 * Crow Clone Escape's teleport (phase n:1, o = the spot his client picked): within reach of where he pressed, room to
 * stand there. He is invulnerable through it (p.escape). Everyone, the sender included, hears it; his states from
 * then on come from the spot (the socket keeps order: no stale state can drag him back).
 */
function crowTeleport(p, J, prev, out) {
  const o = out.o;
  if (!o || o.length !== 3) return;
  const c = combat.posAt(p, prev.at, {});
  if (Math.hypot(o[0] - c.x, o[2] - c.z) > J.maxDist || Math.abs(o[1] - c.y) > 7 || world.solidAt(o[0], o[2], o[1] + 0.15, o[1] + 1.6, 0.05)) {
    if (process.env.SHINOBI_DEBUG) log(`  ${p.name}'s crow escape refused (${Math.hypot(o[0] - c.x, o[2] - c.z).toFixed(1)} m)`);
    return send(p, { t: 'deny', k: 'jutsu', m: out.m, i: out.i, n: 1 });
  }
  prev.phases = { 1: out.at };
  p.s[0] = o[0];
  p.s[1] = o[1];
  p.s[2] = o[2];
  p.s[3] = p.s[4] = p.s[5] = 0;
  p.at = now();
  p.lastState = p.at;
  combat.record(p, p.at);
  broadcast(out);
}

/**
 * Tengai Shinsei lands (server clock `fx.due`): every fighter inside the outer ring, in the open (no cover between
 * the crater and them), not invulnerable, takes the core or the outer hit (knocked away from the centre). Each is
 * judged where its own screen had it at the impact: its states arrive ~half its ping later, up to METEOR_LEAD.
 */
const METEOR_LEAD = 150;
function meteorImpact(p, act, i) {
  if (!players.has(p.id) || match.phase === 'results') return;
  const fx = act.fx, J = fx.J, o = fx.shape.o, T = fx.due;
  for (const v of [...players.values(), dummy]) {
    if (v === p || !v.alive) continue;
    const vp = combat.posAt(v, T + (v.dummy ? 0 : Math.min(METEOR_LEAD, (v.ping || 0) / 2)), {});
    const dist = Math.hypot(vp.x - o[0], vp.z - o[2]);
    if (dist > J.outer + 0.34 || vp.y - o[1] > 9 || vp.y < o[1] - 4) continue;
    const why = combat.invulnAt(v, T) || (world.clear(o[0], o[1] + 1.5, o[2], vp.x, vp.y + 1.0, vp.z) ? null : 'cover');
    if (why) {
      if (process.env.SHINOBI_DEBUG) log(`  meteor spared ${v.name}: ${why}`);
      continue;
    }
    const part = dist <= J.core + 0.34 ? 'core' : 'outer', spec = hitSpec(p.ch, `tengaiShinsei:${part}`), pp = [vp.x, vp.y, vp.z];
    serverHit(p, v, spec, `tengaiShinsei:${part}`, i, 0, T, pp, o, `${p.id}:${i}:0:${v.id}`);
  }
}

function kill(v, killer, hit) {
  const t = now();
  v.alive = false;
  v.respawnAt = t + T.respawn * 1000;
  v.burn = null;
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
  // Amaterasu's flames
  for (const p of players.values()) if (p.burn) burnStep(p, t);
  if (dummy.burn) burnStep(dummy, t);
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
  // (its caster gone, a cinematic ends: every screen drops it on his leave)
  if (cinema?.id === p.id) cinema.to = Math.min(cinema.to, now());
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
