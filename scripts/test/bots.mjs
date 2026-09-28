// Network bots for tests: plain WebSocket clients that join, run circles round a centre (ground-snapped with the
// shared map), jump now and then and throw attacks (remotes play the clips). Used by perf.mjs and debug/prof.mjs.
// Characters cycle through the roster (every model on screen at once: the worst case); BOT_CH=<id> gives them all one.
// (Itachi is password-locked: they send the password.)
import WebSocket from 'ws';
import { buildMap } from '../../src/shared/map.js';
import { CHARACTERS } from '../../src/shared/characters.js';

const world = buildMap().world;
const ROSTER = Object.keys(CHARACTERS);
// the M1 strings (U: from a standstill, S: the Scroll Rush) and the heavy: their clips, trails, scroll props and bursts
// (BOT_MOVES=L1,L2 ... another list, e.g. for an A/B perf run)
const MOVES = process.env.BOT_MOVES ? process.env.BOT_MOVES.split(',') : ['U1', 'U2', 'U3', 'U4', 'U5', 'S1', 'S2', 'S3', 'S4', 'S5', 'H'];
export function bot(URL, i, NB, center) {
  const ws = new WebSocket(URL.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws');
  const B = { ws, id: 0, seq: 0, t0: Date.now(), off: 0, ang: (i / NB) * Math.PI * 2, n: 0, center };
  ws.on('open', () => ws.send(JSON.stringify({ t: 'join', name: `Bot${i + 1}`, ch: process.env.BOT_CH || ROSTER[i % ROSTER.length], token: `perfbot${i}`, pw: 'HUNNY' })));
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.t === 'welcome') {
      B.id = m.id;
      B.seq = m.you.seq;
      B.off = m.st - Date.now();
    } else if (m.t === 'snap') {
      for (const p of m.ps) if (p[0] === B.id) B.seq = p[12];
    } else if (m.t === 'spawn' && m.id === B.id) B.seq = m.seq;
  });
  B.timer = setInterval(() => {
    if (!B.id || ws.readyState !== 1) return;
    const t = (Date.now() - B.t0) / 1000;
    // run a circle of radius 4..7 around the centre at sprint speed, jumping now and then
    const R = 4 + (i % 3) * 1.5, w = 9 / R;
    const a = B.ang + t * w * (i % 2 ? 1 : -1);
    const x = B.center[0] + Math.cos(a) * R, z = B.center[1] + Math.sin(a) * R;
    const g = world.ground(x, z, 60, {});
    const jump = (t + i) % 4 < 0.6;
    const y = g.y + (jump ? Math.sin((((t + i) % 4) / 0.6) * Math.PI) * 1.4 : 0);
    const vx = -Math.sin(a) * R * w * (i % 2 ? 1 : -1), vz = Math.cos(a) * R * w * (i % 2 ? 1 : -1);
    const yaw = Math.atan2(-vx, -vz);
    ws.send(JSON.stringify({ t: 's', s: [x, y, z, vx, 0, vz, yaw, jump ? 1 : 0, 0, 1], n: B.seq }));
    // an attack now and then (remotes play the clip)
    if (++B.n % 20 === i) ws.send(JSON.stringify({ t: 'a', k: 'atk', m: MOVES[B.n % MOVES.length], i: B.n, at: Date.now() + B.off }));
  }, 1000 / 30);
  return B;
}

