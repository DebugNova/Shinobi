// The in-game HUD, DOM + CSS (crisp at any resolution), laid out like Shinobi Striker:
//   bottom-left: portrait in an ink-brush frame with the chakra ring, the long health bar with a red chip trail,
//                the cyan arrow (ultimate ready); bottom-right: tool / jutsu / ultimate icons with cooldown sweeps,
//                charge pips and key hints, substitution pips; top-right: the match timer on an ink splash, score
//                and kill pills; centre-top: announcement banner; centre: "N HITS", lock-on brackets, hit markers;
//                over fighters: nameplates + red HP bars; top-left: kill feed; Tab: scoreboard; results screen;
//                Esc: pause menu (settings, performance).
// No layout reads in the frame loop: positions go through transforms and CSS custom properties only.
import * as THREE from 'three';
import { PALETTE, MATCH } from '../shared/config.js';
import { charOf } from '../shared/characters.js';
import { renderPortrait } from './portrait.js';
import { gpuInfo, diagnose } from '../gfx/perfcheck.js';

const _v = new THREE.Vector3();
const $ = (root, s) => root.querySelector(s);

/** A rough ink-brush ring as an SVG path (seeded wobble). */
function brushRing(cx, cy, r, w, seed = 1, n = 64) {
  const pts = (rr, s) => {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const k = rr + Math.sin(a * 7 + seed * s) * w * 0.18 + Math.sin(a * 13 + seed * 3.1 * s) * w * 0.12 + Math.sin(a * 3 + seed) * w * 0.2;
      out.push(`${(cx + Math.cos(a) * k).toFixed(1)},${(cy + Math.sin(a) * k).toFixed(1)}`);
    }
    return out;
  };
  const o = pts(r + w / 2, 1), i = pts(r - w / 2, 2).reverse();
  return `M${o.join('L')}Z M${i.join('L')}Z`;
}

/** An ink splash blob behind the timer. */
function splash(seed = 3) {
  const n = 40, out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 44 + Math.sin(a * 5 + seed) * 6 + Math.sin(a * 11 + seed * 2) * 4 + (i % 7 === 0 ? 10 : 0);
    out.push(`${(60 + Math.cos(a) * r * 1.35).toFixed(1)},${(50 + Math.sin(a) * r * 0.78).toFixed(1)}`);
  }
  return `M${out.join('L')}Z`;
}

// skill icons (SVG, drawn inside a 100x100 circle)
const ICONS = {
  scroll: `<defs><radialGradient id="gs" cx=".4" cy=".35"><stop offset="0" stop-color="#9fd0ff"/><stop offset="1" stop-color="#1b4c86"/></radialGradient></defs><circle cx="50" cy="50" r="50" fill="url(#gs)"/><path d="M22 60c10-16 40-24 56-10-8 14-30 22-56 10z" fill="#e9dcc0" stroke="#3a2a1a" stroke-width="3"/><path d="M30 58c12-6 26-8 38-4" stroke="#b33" stroke-width="3" fill="none"/>`,
  shuriken: `<defs><radialGradient id="gh" cx=".4" cy=".35"><stop offset="0" stop-color="#8fc8ff"/><stop offset="1" stop-color="#16365f"/></radialGradient></defs><circle cx="50" cy="50" r="50" fill="url(#gh)"/><g transform="rotate(20 50 50)"><path d="M50 12 L57 43 L88 50 L57 57 L50 88 L43 57 L12 50 L43 43 Z" fill="#d7dee8" stroke="#1d2530" stroke-width="3"/><circle cx="50" cy="50" r="7" fill="#1d2530"/></g><g stroke="#fff" stroke-width="2" opacity=".7"><path d="M20 28l12 6M18 70l12-4M78 24l-10 8"/></g>`,
  rasengan: `<defs><radialGradient id="gr" cx=".45" cy=".4"><stop offset="0" stop-color="#ffffff"/><stop offset=".35" stop-color="#8fe8ff"/><stop offset=".8" stop-color="#1e7fd8"/><stop offset="1" stop-color="#0b2d60"/></radialGradient></defs><circle cx="50" cy="50" r="50" fill="#ffb14a"/><circle cx="50" cy="50" r="36" fill="url(#gr)"/><g fill="none" stroke="#e8fbff" stroke-width="3" opacity=".9"><path d="M26 44c10-18 38-20 48-2"/><path d="M30 62c14 12 34 8 42-8"/><path d="M40 30c16 4 24 20 16 34"/></g>`,
  clones: `<defs><radialGradient id="gc" cx=".4" cy=".35"><stop offset="0" stop-color="#ffd07a"/><stop offset="1" stop-color="#c2410c"/></radialGradient></defs><circle cx="50" cy="50" r="50" fill="url(#gc)"/><g fill="#1a1110"><circle cx="34" cy="38" r="9"/><path d="M22 78c0-18 6-28 12-28s12 10 12 28z"/><circle cx="66" cy="38" r="9"/><path d="M54 78c0-18 6-28 12-28s12 10 12 28z"/></g><path d="M50 20c-6 12-6 26 0 38 6-12 6-26 0-38z" fill="#fff4c9" opacity=".9"/>`,
  ult: `<defs><radialGradient id="gu" cx=".5" cy=".5"><stop offset="0" stop-color="#ffffff"/><stop offset=".4" stop-color="#b9f2ff"/><stop offset="1" stop-color="#2a7fd0"/></radialGradient></defs><circle cx="50" cy="50" r="50" fill="#0f2345"/><g transform="rotate(15 50 50)"><path d="M50 6 C60 30 62 38 94 50 C62 62 60 70 50 94 C40 70 38 62 6 50 C38 38 40 30 50 6Z" fill="#e8fbff" opacity=".85"/></g><circle cx="50" cy="50" r="20" fill="url(#gu)"/>`,
  // Madara's kit
  fire: `<defs><radialGradient id="gf" cx=".5" cy=".65"><stop offset="0" stop-color="#ffcf6a"/><stop offset=".55" stop-color="#d9420f"/><stop offset="1" stop-color="#3a0a06"/></radialGradient></defs><circle cx="50" cy="50" r="50" fill="url(#gf)"/><path d="M50 10c6 14 20 20 22 38 2 16-8 32-22 34-14-2-26-12-24-30 1-10 7-16 10-24 2 8 6 12 10 12-2-10 0-20 4-30z" fill="#ff7a1a" stroke="#2a0905" stroke-width="3"/><path d="M52 34c4 10 12 14 12 26 0 10-6 16-14 16s-14-6-13-16c1-6 5-9 7-14 2 5 4 7 6 7-1-7 0-13 2-19z" fill="#ffd35a"/><path d="M50 56c3 6 6 8 6 13 0 5-3 8-6 8s-6-3-6-8c0-4 3-7 6-13z" fill="#fff8e0"/>`,
  stakes: `<defs><radialGradient id="gw" cx=".45" cy=".35"><stop offset="0" stop-color="#a9d98a"/><stop offset="1" stop-color="#1f3d1c"/></radialGradient></defs><circle cx="50" cy="50" r="50" fill="url(#gw)"/><path d="M8 76 Q50 68 92 76 L92 100 L8 100Z" fill="#4a3120"/><g stroke="#24160c" stroke-width="3" stroke-linejoin="round"><path d="M22 78 L34 40 L40 78Z" fill="#9a6a3e"/><path d="M42 78 L58 14 L64 78Z" fill="#b07a48"/><path d="M66 78 L78 46 L82 78Z" fill="#8a5c34"/></g><path d="M34 40 L36 50 L31 50Z M58 14 L60 26 L55 26Z M78 46 L79 54 L76 54Z" fill="#f3e2c0"/>`,
  gunbai: `<defs><radialGradient id="gg" cx=".4" cy=".35"><stop offset="0" stop-color="#e0525a"/><stop offset="1" stop-color="#43090f"/></radialGradient></defs><circle cx="50" cy="50" r="50" fill="url(#gg)"/><rect x="46" y="58" width="8" height="36" rx="3" fill="#2a1a14" stroke="#0d0706" stroke-width="2"/><ellipse cx="50" cy="38" rx="27" ry="30" fill="#2a1a14"/><ellipse cx="50" cy="38" rx="21" ry="24" fill="#f1e6cc"/><path d="M50 14v48M29 38h42" stroke="#b9a37a" stroke-width="2.5"/><path d="M54 90c6 2 8 6 6 10" stroke="#c9c9d2" stroke-width="3" fill="none" stroke-dasharray="3 2"/>`,
  meteor: `<defs><radialGradient id="gm" cx=".5" cy=".4"><stop offset="0" stop-color="#6a4a8a"/><stop offset="1" stop-color="#140a22"/></radialGradient></defs><circle cx="50" cy="50" r="50" fill="url(#gm)"/><path d="M8 12 L52 48 L40 60Z" fill="#ff9a2a" opacity=".85"/><path d="M18 14 L54 46 L46 54Z" fill="#ffe28a"/><path d="M44 50c2-12 14-18 26-14 12 4 16 16 12 28-4 12-18 16-28 12-10-4-12-14-10-26z" fill="#4b3a36" stroke="#120a08" stroke-width="3"/><path d="M50 70c6 4 16 4 22-2" stroke="#ff6a1a" stroke-width="3" fill="none"/><circle cx="62" cy="50" r="5" fill="#2c211e"/><circle cx="72" cy="60" r="3" fill="#2c211e"/>`,
  // Itachi's kit
  fireballs: `<defs><radialGradient id="gb" cx=".5" cy=".5"><stop offset="0" stop-color="#ffe9a8"/><stop offset=".45" stop-color="#ff8a1c"/><stop offset="1" stop-color="#8a1d06"/></radialGradient></defs><circle cx="50" cy="50" r="50" fill="#2a0c08"/><g stroke="#1a0604" stroke-width="2.5"><circle cx="30" cy="66" r="13" fill="url(#gb)"/><circle cx="62" cy="58" r="16" fill="url(#gb)"/><circle cx="72" cy="28" r="10" fill="url(#gb)"/></g><path d="M8 80c8-4 12-10 14-14M36 88c10-6 16-14 18-20M78 46c4-2 8-6 10-10" stroke="#ffcf6a" stroke-width="3" fill="none" opacity=".8"/>`,
  tsukuyomi: `<defs><radialGradient id="gt" cx=".5" cy=".5"><stop offset="0" stop-color="#ff3a3a"/><stop offset=".75" stop-color="#b3060c"/><stop offset="1" stop-color="#3a0004"/></radialGradient></defs><circle cx="50" cy="50" r="50" fill="#120204"/><circle cx="50" cy="50" r="34" fill="url(#gt)" stroke="#050000" stroke-width="4"/><path d="M52.6,54.7L52.6,57.7L51.5,60.7L49.4,63.5L46.3,65.8L42.4,67.3L37.8,67.8L32.8,67.2L27.7,65.3L29.0,67.0L37.3,70.7L45.5,71.1L52.5,68.7L57.3,64.4L59.8,59.3L59.9,54.4L58.1,50.6L55.2,48.6ZM44.6,49.9L42.1,48.4L40.0,46.0L38.6,42.7L38.2,38.9L38.8,34.8L40.6,30.5L43.7,26.5L47.9,23.1L45.8,23.3L38.4,28.7L33.9,35.6L32.5,42.8L33.8,49.1L37.1,53.8L41.3,56.3L45.4,56.7L48.6,55.2ZM52.8,45.4L55.3,43.9L58.5,43.3L62.0,43.8L65.5,45.3L68.8,47.9L71.5,51.6L73.5,56.3L74.4,61.6L75.2,59.7L74.3,50.6L70.5,43.3L65.0,38.5L58.8,36.4L53.2,36.9L48.9,39.3L46.5,42.7L46.2,46.2Z" fill="#0a0000"/><circle cx="50" cy="50" r="6.5" fill="#0a0000"/>`,
  crows: `<circle cx="50" cy="50" r="50" fill="#3a3f5c"/><circle cx="72" cy="30" r="12" fill="#b3060c" opacity=".8"/><g fill="#08090d"><path d="M50 58c-10-10-24-12-36-6 10 0 18 4 24 10-8 2-12 6-14 12 8-6 16-8 26-6 8 2 16 0 22-6-6 0-10-2-12-6 6-4 14-6 24-4-12-6-26-4-34 6z"/><path d="M30 30c-4-4-10-5-15-2 4 0 7 2 10 4-3 1-5 3-6 5 4-2 7-3 11-2 4 1 7 0 10-3-3 0-5-1-6-3 3-2 7-3 11-2-5-3-11-2-15 3z"/><path d="M76 72c-3-3-8-4-12-2 3 0 6 2 8 3-2 1-4 2-5 4 3-2 6-2 9-1 3 1 6 0 8-2-2 0-4-1-5-2 3-2 6-2 9-1-4-3-9-2-12 1z"/></g>`,
  amaterasu: `<defs><radialGradient id="ga" cx=".5" cy=".7"><stop offset="0" stop-color="#5a0a2a"/><stop offset="1" stop-color="#0a0006"/></radialGradient></defs><circle cx="50" cy="50" r="50" fill="url(#ga)"/><path d="M50 8c8 16 24 22 24 42 0 18-10 34-24 36-16-2-28-14-26-32 1-12 9-18 12-28 2 10 6 14 10 14-2-12 0-22 4-32z" fill="#050305" stroke="#d0105a" stroke-width="3"/><path d="M52 40c4 10 12 16 11 28-1 10-7 16-13 16s-13-6-12-16c1-7 5-10 7-15 2 5 4 7 6 7-1-8 0-14 1-20z" fill="#140812" stroke="#7a0a3a" stroke-width="2"/>`,
  log: `<circle cx="50" cy="50" r="50" fill="#6a4a2e"/><rect x="24" y="30" width="52" height="40" rx="18" fill="#b07a48" stroke="#3a2412" stroke-width="3"/><ellipse cx="30" cy="50" rx="8" ry="18" fill="#d9a877" stroke="#3a2412" stroke-width="3"/>`,
};

export class HUD {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('hud');
    this.plates = document.getElementById('plates');
    this.root.innerHTML = `
      <div class="h-feed" id="h-feed"></div>
      <div class="h-timer"><svg viewBox="0 0 120 100"><path d="${splash()}" fill="#0d0908"/></svg><b id="h-time">5:00</b><small id="h-phase"></small></div>
      <div class="h-pills">
        <div class="h-pill"><i class="h-ico-score"></i><b id="h-score">0</b></div>
        <div class="h-pill"><i class="h-ico-coin"></i><b id="h-kills">0</b></div>
      </div>
      <div class="h-banner" id="h-banner"><span></span></div>
      <div class="h-combo" id="h-combo"><b>0</b><i>HITS</i></div>
      <div class="h-dmg" id="h-dmg"></div>
      <div class="h-lock" id="h-lock"><i></i><i></i><i></i><i></i></div>
      <div class="h-me">
        <div class="h-port">
          <svg viewBox="0 0 120 120" class="h-port-frame"><path d="${brushRing(60, 60, 50, 14, 2)}" fill="#0d0908" fill-rule="evenodd"/></svg>
          <div class="h-port-img" id="h-port"></div>
          <svg viewBox="0 0 120 120" class="h-chakra"><circle cx="60" cy="60" r="46" id="h-chakra" pathLength="100"/></svg>
        </div>
        <div class="h-hpwrap">
          <svg viewBox="0 0 400 40" preserveAspectRatio="none" class="h-hp-ink"><path d="M0 12 Q30 2 80 8 L390 6 Q400 8 398 20 L396 34 Q300 38 60 34 Q10 36 4 26 Z" fill="#0d0908"/></svg>
          <div class="h-hp"><s id="h-chip"></s><b id="h-hpb"></b></div>
          <i class="h-arrow" id="h-arrow"></i>
          <div class="h-subs" id="h-subs"><i></i><i></i><i></i></div>
        </div>
      </div>
      <div class="h-skills" id="h-skills"></div>
      <div class="h-toast" id="toast"></div>
      <pre class="h-perf hidden" id="perf"></pre>
      <div class="h-board hidden" id="h-board"></div>
      <div class="h-results hidden" id="h-results"></div>
      <div class="h-dead hidden" id="h-dead"><b>K.O.</b><small id="h-dead-t"></small></div>`;
    this.el = {
      time: $(this.root, '#h-time'), phase: $(this.root, '#h-phase'), score: $(this.root, '#h-score'), kills: $(this.root, '#h-kills'),
      banner: $(this.root, '#h-banner'), combo: $(this.root, '#h-combo'), dmg: $(this.root, '#h-dmg'), lock: $(this.root, '#h-lock'),
      hp: $(this.root, '#h-hpb'), chip: $(this.root, '#h-chip'), chakra: $(this.root, '#h-chakra'), arrow: $(this.root, '#h-arrow'),
      subs: $(this.root, '#h-subs'), pips: $(this.root, '#h-pips'), feed: $(this.root, '#h-feed'), board: $(this.root, '#h-board'),
      results: $(this.root, '#h-results'), dead: $(this.root, '#h-dead'), deadT: $(this.root, '#h-dead-t'), port: $(this.root, '#h-port'),
    };
    this.setKit(charOf());
    this.toastEl = $(this.root, '#toast');
    this.perfEl = $(this.root, '#perf');
    this.perfOn = false;
    this.perfT = 0;
    this.frames = [];
    this.chipV = 1;
    this.chipHold = 0;
    this.hpV = 1;
    this.comboT = 0;
    this.sb = null;
    this.cache = {};
    this.pauseEl = document.getElementById('pause');
    this.buildPause();
    addEventListener('keydown', (e) => {
      if (e.code === 'Tab' && this.game.state === 'playing') this.board(true);
    });
    addEventListener('keyup', (e) => {
      if (e.code === 'Tab') this.board(false);
    });
  }

  show(on) {
    this.root.classList.toggle('hidden', !on);
  }

  /** The skill row for a character's kit: scroll, shuriken (1), Q, E, G (kits with a third jutsu), R. */
  setKit(C) {
    const K = C.kit, J = C.jutsu;
    const row = [['tool', 'scroll', ''], ['shuriken', 'shuriken', '1'], [K.jutsu1, 'Q'], [K.jutsu2, 'E'], [K.jutsu3, 'G']]
      .filter(([id]) => id)
      .map(([id, a, b]) => (b === undefined ? [id, J[id]?.icon || id, a] : [id, a, b]));
    row.push(['ult', J[K.ult]?.icon || K.ult, 'R']);
    const el = $(this.root, '#h-skills');
    el.innerHTML = `<div class="h-pips" id="h-pips"><i></i><i></i><i></i></div>${row
      .map(([id, ico, key]) => `<div class="h-skill ${id === 'ult' ? 'ult' : ''}" data-s="${id}"><svg viewBox="0 0 100 100">${ICONS[ico] || ICONS.scroll}</svg><div class="h-cd"></div><b></b>${key ? `<kbd>${key}</kbd>` : ''}</div>`)
      .join('')}`;
    this.el.pips = $(this.root, '#h-pips');
    this.skills = Object.fromEntries([...el.querySelectorAll('.h-skill')].map((e) => [e.dataset.s, e]));
  }

  /** A face portrait of the fighter model, rendered once into the portrait circle. face: metres to raise the view
   *  above the head bone (card.face: Itachi's collar hides everything below his eyes). */
  portrait(renderer, vrm, shadows, face = 0) {
    try {
      const url = renderPortrait(renderer, vrm.scene, shadows, {
        w: 256, h: 256, fov: 22,
        frame: () => {
          const head = vrm.humanoid.getRawBoneNode('head').getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, face, 0));
          const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(vrm.scene.getWorldQuaternion(new THREE.Quaternion()));
          return { eye: head.clone().addScaledVector(fwd, 0.85).add(new THREE.Vector3(0, 0.04, 0)), target: head.clone().setY(head.y - 0.02) };
        },
      });
      this.el.port.style.backgroundImage = `url(${url})`;
    } catch (e) {
      console.warn('[shinobi] portrait', e);
    }
  }

  toast(text, ms = 2500) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('on');
    clearTimeout(this._tt);
    this._tt = setTimeout(() => this.toastEl.classList.remove('on'), ms);
  }

  /** The torn-ink announcement banner ("FIGHT!", streaks, "1 minute left"). */
  banner(text, ms = 2200) {
    const b = this.el.banner;
    b.firstChild.textContent = text;
    b.classList.remove('on');
    void b.offsetWidth;
    b.classList.add('on');
    clearTimeout(this._bt);
    this._bt = setTimeout(() => b.classList.remove('on'), ms);
  }

  togglePerf(on = !this.perfOn) {
    this.perfOn = on;
    this.perfEl.classList.toggle('hidden', !on);
    try {
      localStorage.setItem('shinobi.perf', on ? '1' : '0');
    } catch {}
  }

  // ---- combat feedback

  combo(n) {
    if (n < 2) return;
    const e = this.el.combo;
    e.firstChild.textContent = n;
    e.classList.remove('pop');
    void e.offsetWidth;
    e.classList.add('pop', 'on');
    this.comboT = 1.6;
  }

  /** Floating damage number (the training dummy shows its combo too). */
  damage(pos, dmg, n) {
    const d = document.createElement('div');
    d.className = 'h-num';
    d.textContent = dmg;
    d.dataset.x = pos.x;
    d.dataset.y = pos.y + 2.1;
    d.dataset.z = pos.z;
    d.dataset.t = 0;
    this.el.dmg.appendChild(d);
    if (this.el.dmg.children.length > 12) this.el.dmg.firstChild.remove();
    void n;
  }

  hurt(d, hp) {
    this.chipHold = 0.55;
    this.flashT = 0.25;
    this.root.classList.remove('hit');
    void this.root.offsetWidth;
    this.root.classList.add('hit');
    void d;
    void hp;
  }

  hp(entry) {
    entry.hpDirty = true;
  }

  kill(m) {
    const g = this.game;
    const name = (id) => (id === g.net.id ? g.me?.name || 'You' : g.remotes.get(id)?.info.name || '?');
    const slot = (id) => (id === g.net.id ? g.me?.slot ?? 0 : g.remotes.get(id)?.info.slot ?? 0);
    const e = document.createElement('div');
    e.className = 'h-kf';
    e.innerHTML = `<b style="--c:${PALETTE[slot(m.k) % 6]}"></b><i></i><b style="--c:${PALETTE[slot(m.v) % 6]}"></b>`;
    e.children[0].textContent = name(m.k);
    e.children[2].textContent = name(m.v);
    this.el.feed.prepend(e);
    setTimeout(() => e.classList.add('out'), 5000);
    setTimeout(() => e.remove(), 5600);
    while (this.el.feed.children.length > 5) this.el.feed.lastChild.remove();
    if (m.k === g.net.id) this.banner(m.st >= 3 ? `${m.st}-KILL STREAK!` : 'K.O.!', 1600);
    else if (m.st >= 3) this.banner(`${name(m.k)} is on a ${m.st}-kill streak!`);
    if (m.v === g.net.id) {
      this.deadUntil = performance.now() + (m.rs || MATCH.respawn) * 1000;
      this.el.dead.classList.remove('hidden');
    }
  }

  deny(m) {
    if (m.k === 'jutsu' || m.k === 'tool') this.toast('Not ready');
  }

  matchPhase(m) {
    if (m.ph === 'live') this.banner('FIGHT!', 1600);
    if (m.ph === 'warmup') this.banner('WARM-UP', 1400);
    this.el.results.classList.add('hidden');
    this.warned = false;
  }

  scoreboard(m) {
    this.sb = m;
    const me = m.ps.find((p) => p[0] === this.game.net.id);
    if (me) {
      this.set('score', me[4]);
      this.set('kills', me[1]);
    }
    if (!this.el.board.classList.contains('hidden')) this.board(true);
  }

  board(on) {
    const el = this.el.board;
    el.classList.toggle('hidden', !on);
    if (!on || !this.sb) return;
    const g = this.game;
    const name = (id) => (id === g.net.id ? g.me?.name : g.remotes.get(id)?.info.name) || '?';
    const rows = this.sb.ps.slice().sort((a, b) => b[4] - a[4] || b[1] - a[1]);
    el.innerHTML = `<h3>FREE-FOR-ALL<small>Training Grounds</small></h3><table><tr><th></th><th>NINJA</th><th>K</th><th>D</th><th>A</th><th>SCORE</th><th>PING</th></tr>${rows
      .map((p, i) => `<tr class="${p[0] === g.net.id ? 'me' : ''}"><td>${i + 1}</td><td><i style="--c:${PALETTE[p[7] % 6]}"></i>${esc(name(p[0]))}</td><td>${p[1]}</td><td>${p[2]}</td><td>${p[3]}</td><td>${p[4]}</td><td>${p[5]}</td></tr>`)
      .join('')}</table>`;
  }

  results(m) {
    const g = this.game;
    const el = this.el.results;
    const win = m.ps[0];
    el.innerHTML = `<div class="r-in"><small>MATCH OVER</small><h2>${esc(win ? win[1] : '—')}</h2><p>WINS</p><table>${m.ps
      .map((p, i) => `<tr class="${p[0] === g.net.id ? 'me' : ''}"><td>${i + 1}</td><td><i style="--c:${PALETTE[p[2] % 6]}"></i>${esc(p[1])}${p[0] === m.mvp ? ' <em>MVP</em>' : ''}</td><td>${p[3]} K</td><td>${p[4]} D</td><td>${p[5]} A</td><td><b>${p[6]}</b></td></tr>`)
      .join('')}</table><small>Next match soon…</small></div>`;
    el.classList.remove('hidden');
  }

  set(k, v) {
    if (this.cache[k] === v) return;
    this.cache[k] = v;
    this.el[k].textContent = v;
  }

  // ---- nameplates

  addPlate(entry) {
    const el = document.createElement('div');
    el.className = 'plate';
    el.innerHTML = `<b></b><i><s></s></i>`;
    el.querySelector('b').textContent = entry.info.name;
    el.style.setProperty('--c', PALETTE[entry.info.slot % PALETTE.length]);
    this.plates.appendChild(el);
    entry.plate = el;
    entry.plateHp = el.querySelector('s');
    entry.hpDirty = true;
  }

  removePlate(entry) {
    entry.plate?.remove();
  }

  // ---- pause menu

  buildPause() {
    const s = this.settings = loadSettings();
    this.pauseEl.innerHTML = `
      <div class="pz-panel">
        <h2>PAUSED</h2>
        <nav><button data-a="resume">RESUME</button><button data-a="settings">SETTINGS</button><button data-a="perf">PERFORMANCE</button><button data-a="leave">LEAVE</button></nav>
        <section class="pz-page" data-p="settings">
          <label>Mouse sensitivity <input type="range" min="0.2" max="3" step="0.05" data-k="sens" value="${s.sens}"><output></output></label>
          <label>Invert Y <input type="checkbox" data-k="invertY" ${s.invertY ? 'checked' : ''}></label>
          <label>Field of view <input type="range" min="60" max="95" step="1" data-k="fov" value="${s.fov}"><output></output></label>
          <label>Volume <input type="range" min="0" max="1" step="0.05" data-k="volume" value="${s.volume}"><output></output></label>
          <label>Music <input type="range" min="0" max="1" step="0.05" data-k="music" value="${s.music}"><output></output></label>
          <label>Graphics <select data-k="preset"><option value="" ${!s.preset ? 'selected' : ''}>Auto (${cap(this.game.autoPreset())})</option>${['low', 'medium', 'high', 'ultra'].map((p) => `<option value="${p}" ${s.preset === p ? 'selected' : ''}>${cap(p)}</option>`).join('')}</select></label>
          <label>FPS overlay (F3) <input type="checkbox" data-k="perf" ${s.perf ? 'checked' : ''}></label>
        </section>
        <section class="pz-page" data-p="perf"><div id="pz-perf"></div></section>
      </div>`;
    const P = this.pauseEl;
    P.addEventListener('click', (e) => {
      const a = e.target?.dataset?.a;
      if (a === 'resume') this.togglePause(false);
      if (a === 'leave') location.reload();
      if (a === 'settings' || a === 'perf') {
        P.querySelectorAll('.pz-page').forEach((x) => x.classList.toggle('on', x.dataset.p === a));
        if (a === 'perf') this.perfPanel();
      }
      if (e.target?.dataset?.preset) this.game.setPreset?.(e.target.dataset.preset);
    });
    const out = () => P.querySelectorAll('input[type=range]').forEach((i) => (i.nextElementSibling.textContent = (+i.value).toFixed(i.step < 1 ? 2 : 0)));
    out();
    P.addEventListener('input', (e) => {
      const k = e.target?.dataset?.k;
      if (!k) return;
      s[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'range' ? +e.target.value : e.target.value;
      saveSettings(s);
      out();
      this.game.applySettings?.(s, k);
    });
  }

  perfPanel() {
    const g = this.game, el = this.pauseEl.querySelector('#pz-perf');
    const gpu = gpuInfo(g.renderer);
    const st = g.governor?.stats || this.stats || {};
    const d = diagnose(st, gpu, { preset: this.settings.preset, target: 60, scale: 1, minScale: 1 });
    el.innerHTML = `<p><b>Graphics card:</b> ${esc(gpu.short)}</p><p><b>${(st.fps || 0).toFixed(0)} fps</b> · ${(st.ms || 0).toFixed(1)} ms · 1% low ${(st.low1 || 0).toFixed(0)} · GPU ${(st.gpu || 0).toFixed(1)} ms</p><h4 class="lv-${d.level}">${d.title}</h4>${d.tips.map((t) => `<p>${t}</p>`).join('')}${d.offer ? `<button data-preset="${d.offer === 'potato' ? 'low' : d.offer}">Switch to ${d.offer === 'potato' ? 'Low' : d.offer}</button>` : ''}`;
  }

  togglePause(on = this.pauseEl.classList.contains('hidden')) {
    this.pauseEl.classList.toggle('hidden', !on);
    const g = this.game;
    if (on) g.input.unlock();
    else g.input.lock();
    g.input.enabled = !on;
  }

  // ---- per frame

  update(dt) {
    const g = this.game;
    this.frames.push(dt);
    if (this.frames.length > 240) this.frames.shift();
    if (g.state === 'playing') this.updateGame(dt);
    if (this.perfOn && (this.perfT += dt) > 0.25) {
      this.perfT = 0;
      const st = g.governor?.stats;
      const info = g.renderer.info;
      const r = g.frameInfo || {};
      this.perfEl.textContent = [
        `${st ? st.fps.toFixed(0) : '?'} fps  ${st ? st.ms.toFixed(1) : '?'} ms  1% low ${st ? st.low1.toFixed(0) : '?'}  GPU ${st?.gpu ? st.gpu.toFixed(1) : '—'} ms`,
        `cpu ${g.cpuMs?.toFixed(2)} ms (logic ${g.simMs?.toFixed(2)})  calls ${r.calls ?? '?'}  tris ${((r.tris ?? 0) / 1000).toFixed(0)}k  progs ${info.programs?.length}`,
        `ping ${g.net.rtt.toFixed(0)} ms  interp ${g.net.interp.toFixed(0)} ms  late hits ${g.net.stats.late || 0}  stalls ${g.net.stats.stalls} (loss)`,
      ].join('\n');
    }
  }

  updateGame(dt) {
    const g = this.game, c = g.ctrl, C = c.C, cam = g.camera, w = innerWidth, h = innerHeight;
    // health: green bar + red chip trail that drains after a delay
    const hpF = Math.max(0, (g.hp ?? C.stats.hp) / (g.maxHp || C.stats.hp));
    this.hpV += (hpF - this.hpV) * Math.min(1, dt * 18);
    if (this.chipHold > 0) this.chipHold -= dt;
    else this.chipV += (this.hpV - this.chipV) * Math.min(1, dt * 3);
    if (this.chipV < this.hpV) this.chipV = this.hpV;
    this.style(this.el.hp, 'transform', `scaleX(${this.hpV.toFixed(4)})`);
    this.style(this.el.chip, 'transform', `scaleX(${this.chipV.toFixed(4)})`);
    this.style(this.el.chakra, 'strokeDasharray', `${((c.chakra / C.stats.chakra) * 100).toFixed(1)} 100`);
    const ultReady = (g.gauge?.u || 0) >= 99.5;
    this.el.arrow.classList.toggle('on', ultReady);
    this.pipsTo(this.el.subs, g.gauge?.sp ?? 3);
    this.pipsTo(this.el.pips, c.tools ?? C.stats.toolCharges);
    // skill cooldowns (sweeps)
    const cds = g.jutsu?.cooldowns?.() || {};
    for (const [k, el] of Object.entries(this.skills)) {
      const cd = k === 'ult' ? 1 - (g.gauge?.u || 0) / 100 : cds[k] || 0; // fraction remaining
      const left = k === 'ult' ? 0 : g.jutsu?.cooldownLeft?.(k) || 0;
      this.style(el, '--cd', cd.toFixed(3));
      el.classList.toggle('ready', cd <= 0.001);
      const txt = left > 0.05 ? Math.ceil(left) : '';
      if (el._t !== txt) {
        el._t = txt;
        el.querySelector('b').textContent = txt;
      }
    }
    // match timer
    const m = g.match;
    if (m) {
      const left = m.end ? Math.max(0, m.end - g.net.serverNow()) / 1000 : 0;
      const t = m.ph === 'live' || m.ph === 'results' ? `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}` : '—:—';
      this.set('time', t);
      this.set('phase', m.ph === 'warmup' ? 'WARM-UP' : m.ph === 'results' ? 'RESULTS' : '');
      if (m.ph === 'live' && left < 60 && left > 58 && !this.warned) {
        this.warned = true;
        this.banner('1 MINUTE LEFT');
      }
    }
    // combo counter
    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.el.combo.classList.remove('on');
    }
    // KO overlay
    if (this.deadUntil) {
      const s = (this.deadUntil - performance.now()) / 1000;
      if (s <= 0 || !c.dead) {
        this.deadUntil = 0;
        this.el.dead.classList.add('hidden');
      } else this.set('deadT', `Back in ${Math.ceil(s)}`);
    }
    // lock-on brackets
    const L = c.lockTarget;
    if (L) {
      // framed round the whole fighter: the brackets' height is its projected height (feet to above the head)
      _v.set(L.x, L.y - 0.05, L.z).project(cam);
      const yFeet = _v.y;
      _v.set(L.x, L.y + 1.95, L.z).project(cam);
      const px = Math.round(Math.min(h * 0.8, Math.max(70, ((_v.y - yFeet) / 2) * h)) / 4) * 4;
      this.style(this.el.lock, 'height', `${px}px`);
      this.style(this.el.lock, 'width', `${Math.round(px * 0.62)}px`);
      _v.set(L.x, L.y + 0.95, L.z).project(cam);
      const vis = _v.z < 1;
      this.style(this.el.lock, 'transform', `translate3d(${(((_v.x + 1) / 2) * w).toFixed(1)}px, ${(((1 - _v.y) / 2) * h).toFixed(1)}px, 0) translate(-50%, -50%)`);
      this.el.lock.classList.toggle('on', vis);
    } else this.el.lock.classList.remove('on');
    // nameplates + HP bars over remote fighters
    for (const r of g.remotes.values()) {
      const el = r.plate, f = r.fighter;
      if (!el || !f) continue;
      _v.copy(f.pos);
      _v.y += 1.95;
      const d = _v.distanceTo(cam.position);
      _v.project(cam);
      const vis = _v.z < 1 && d < 55 && !f.dead;
      if (!vis) {
        if (el.style.display !== 'none') el.style.display = 'none';
        continue;
      }
      if (el.style.display === 'none') el.style.display = '';
      const s = Math.max(0.6, Math.min(1, 12 / d));
      el.style.transform = `translate3d(${(((_v.x + 1) / 2) * w).toFixed(1)}px, ${(((1 - _v.y) / 2) * h).toFixed(1)}px, 0) translate(-50%, -100%) scale(${s.toFixed(3)})`;
      if (r.hpDirty) {
        r.hpDirty = false;
        r.plateHp.style.transform = `scaleX(${Math.max(0, (r.info.hp ?? 1000) / (g.maxHp || 1000))})`;
      }
    }
    // floating damage numbers
    for (const n of this.el.dmg.children) {
      const t = (+n.dataset.t + dt);
      n.dataset.t = t;
      _v.set(+n.dataset.x, +n.dataset.y + t * 0.8, +n.dataset.z).project(cam);
      n.style.transform = `translate3d(${(((_v.x + 1) / 2) * w).toFixed(1)}px, ${(((1 - _v.y) / 2) * h).toFixed(1)}px, 0) translate(-50%, -50%) scale(${(1 + Math.max(0, 0.25 - t) * 2).toFixed(2)})`;
      n.style.opacity = Math.max(0, 1 - Math.max(0, t - 0.6) * 2.5);
      if (t > 1.2) n.remove();
    }
  }

  pipsTo(el, n) {
    if (el._n === n) return;
    el._n = n;
    [...el.children].forEach((p, i) => p.classList.toggle('on', i < n));
  }

  style(el, k, v) {
    const key = `_${k}`;
    if (el[key] === v) return;
    el[key] = v;
    if (k.startsWith('--')) el.style.setProperty(k, v);
    else el.style[k] = v;
  }
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

const cap = (p) => p[0].toUpperCase() + p.slice(1);

export function loadSettings() {
  const d = { sens: 1, invertY: false, fov: 70, volume: 0.8, music: 0, preset: '', perf: false };
  try {
    return { ...d, ...JSON.parse(localStorage.getItem('shinobi.settings') || '{}') };
  } catch {
    return d;
  }
}

function saveSettings(s) {
  try {
    localStorage.setItem('shinobi.settings', JSON.stringify(s));
  } catch {}
}

export { charOf };
