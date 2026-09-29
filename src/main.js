// SHINOBI ARENA: the game orchestrator. Loading (through the boot screen), the arena, the title screen, joining,
// the fixed-step simulation loop with interpolated rendering, networking, remote fighters, camera, HUD, debug hooks.
import * as THREE from 'three';
import { SIM, NET, ST } from './shared/config.js';
import { buildMap, mapHash } from './shared/map.js';
import { charOf, CHARACTERS, DEFAULT_CHARACTER } from './shared/characters.js';
import { CharacterModel } from './char/vrm.js';
import { ClipLibrary, CLIPS_URL } from './char/clips.js';
import { Input } from './game/input.js';
import { Controller } from './game/controller.js';
import { Fighter, LOD } from './game/fighter.js';
import { RemoteMotion } from './game/remote.js';
import { ThirdPersonCamera } from './game/camera.js';
import { Net, fetchStatus } from './game/net.js';
import { buildGreybox } from './world/greybox.js';
import { buildArena } from './world/arena.js';
import { updateToon } from './gfx/toon.js';
import { Sky } from './world/sky.js';
import { Post } from './gfx/post.js';
import { HUD, loadSettings } from './ui/hud.js';
import { renderPortrait } from './ui/portrait.js';
import { FrameGovernor } from './gfx/governor.js';
import { ShadowCache } from './gfx/shadows.js';
import { gpuInfo, detectPreset } from './gfx/perfcheck.js';
import { BI, BONES } from './char/rig.js';
import { Gait } from './char/gait.js';
import { bakeMoves } from './char/moves.js';
import { buildPose, merge, STANCE } from './char/keyframes.js';
import { Combat } from './game/combat.js';
import { Dummy, Logs } from './game/dummy.js';
import { FX } from './gfx/fx.js';
import { Jutsu } from './game/jutsu.js';
import { FROZEN_INPUT } from './game/amaterasu.js';
import { MoveFX } from './gfx/movefx.js';
import { GUNBAI, loadGunbai } from './gfx/madarafx.js';
import { Audio } from './game/audio.js';
import { DebugDraw } from './gfx/debugdraw.js';
import { SMAAPreset } from 'postprocessing';

const BOOT = window.BOOT || { phase() {}, detail() {}, frac() {}, track() {}, done() {}, fail() {}, fetch: (u) => fetch(u).then((r) => r.arrayBuffer()) };
const params = new URLSearchParams(location.search);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

class Game {
  constructor() {
    this.state = 'loading';
    this.remotes = new Map(); // id -> { fighter, motion, info }
    this.clock = new THREE.Clock();
    this.acc = 0;
    this.sendAcc = 0;
    this.view = {}; // the local fighter's animator view (reused)
    this.stepUp = 0;
    this.timeScale = 1; // debug: slow motion / freeze (0)
    this.studio = null; // debug: { yaw (relative to the fighter), pitch, dist, h, fov } orbit camera
  }

  async init() {
    // ---- renderer
    const canvas = document.createElement('canvas');
    document.getElementById('app').appendChild(canvas);
    const r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.setSize(innerWidth, innerHeight);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NoToneMapping; // the post stack tone maps
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.info.autoReset = false; // counted over every pass of a frame (post, shadows), reset in frame()
    this.renderer = r;
    this.governor = new FrameGovernor(r);
    this.shadows = new ShadowCache(r); // static shadows rendered once; only moving casters redrawn
    // no outline hulls in the shadow map
    this.shadows.onCasters = (drawing, casters, n) => {
      for (let i = 0; i < n; i++) casters[i].root.userData.fighter?.hullVisible(!drawing);
    };
    this.governor.target = 0; // no dynamic resolution on High/Ultra (sharpness first)
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.08, 900);
    this.camera.position.set(40, 20, 40);
    LOD.cam = this.camera;
    addEventListener('resize', () => this.resize());

    BOOT.phase('assets', 'Arena…');
    // ---- the arena (shared with the server: same seed, same colliders)
    const t0 = performance.now();
    this.map = buildMap();
    this.world = this.map.world;
    console.log(`[shinobi] map ${mapHash(this.map)} built in ${(performance.now() - t0).toFixed(0)} ms`);

    // ---- characters + animations: a model and a clip library per character (the hand-keyed moves are baked for
    // each body's proportions)
    const fetchBuf = (u) => BOOT.fetch(u);
    this.chars = new Map(); // character id -> { C, model, lib, standin }
    const loadChar = async (C) => {
      let model = new CharacterModel(C.model, fetchBuf), standin = false;
      try {
        await model.load();
      } catch (e) {
        if (!C.standin) {
          // a character whose model is missing can't be picked (players who picked it elsewhere draw as the default)
          if (C.id === DEFAULT_CHARACTER) throw e;
          console.warn(`[shinobi] ${C.model} unavailable (${e.message}); ${C.name} can't be picked`);
          return;
        }
        // no naruto.vrm yet: the stand-in avatar
        console.warn(`[shinobi] ${C.model} unavailable (${e.message}); using the stand-in`);
        model = await new CharacterModel(C.standin, fetchBuf).load();
        standin = true;
      }
      this.chars.set(C.id, { C, model, lib: null, standin });
    };
    // Madara's gunbai (a prop on his back; undefined when it failed to load: his fighters draw without it)
    const loadFan = async () => {
      try {
        this.gunbaiTex = (await loadGunbai(await fetchBuf(GUNBAI.url))).map;
      } catch (e) {
        console.warn(`[shinobi] ${GUNBAI.url} unavailable (${e.message}); Madara draws without his gunbai`);
      }
    };
    const [clipsBuf] = await Promise.all([fetchBuf(CLIPS_URL), ...Object.values(CHARACTERS).map(loadChar), loadFan()]);
    const clipsJSON = new TextDecoder().decode(clipsBuf);
    for (const e of this.chars.values()) {
      e.lib = new ClipLibrary().loadJSON(clipsJSON);
      bakeMoves(e.model.rig, e.lib, new Gait(e.model.rig).H0);
    }
    this.model = this.charModel(DEFAULT_CHARACTER).model; // (debug hooks)

    // ---- world visuals
    BOOT.phase('world', 'Painting the arena…');
    this.sky = new Sky(this.scene, this.renderer);
    this.art = await buildArena(this.map, { grass: params.get('grass') === '0' ? 0 : 26000 });
    this.arena = this.art.group;
    this.scene.add(this.arena);
    // F6: the collider greybox over the art (debug)
    this.greybox = buildGreybox(this.map);
    this.greybox.visible = false;
    this.scene.add(this.greybox);
    this.post = new Post(this.renderer, this.scene, this.camera);
    this.fx = new FX(this.scene);
    this.debugDraw = new DebugDraw(this.scene); // F4
    this.debug = null; // = debugDraw while F4 is on (Combat reports hitboxes to it)
    this.logs = new Logs(this.scene);
    this.logs.world = this.world;
    this.combat = new Combat(this);
    this.jutsu = new Jutsu(this);
    this.movefx = new MoveFX(this); // the M1 strings' trails, scroll and bursts
    this.gauge = { u: 0, sp: 3 };

    // ---- more fighter instances behind the loading screen (a join never parses a VRM mid-fight): enough of every
    // character for a full room of it
    // (+1 for a Tsukuyomi caster's body: its victim's genjutsu draws both stand-ins from these pools)
    for (const e of this.chars.values()) await e.model.warm(NET.maxPlayers + 1 + (e.C.jutsu.tsukuyomi ? 1 : 0));
    await this.jutsu.warmClones(4);

    // ---- gameplay objects
    this.input = new Input(canvas);
    this.input.onPause = () => this.togglePause();
    this.input.onKey = (code) => this.debugKey(code);
    this.net = new Net();
    this.cam = new ThirdPersonCamera(this.camera, this.world);
    this.hud = new HUD(this);
    this.audio = new Audio();
    addEventListener('click', (e) => e.target?.closest?.('button, select, .pm-tab') && this.audio.click());
    this.applySettings(loadSettings());
    this.wireNet();

    // ---- shaders: compile everything before the first visible frame
    BOOT.phase('shaders', 'Compiling…');
    await this.warmShaders();
    this.renderCards();

    this.titleCam();
    BOOT.done();
    this.state = 'title';
    this.showTitle(true);
    window.__ready = true;
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.frame());
    if (params.get('autojoin')) this.join();
  }

  /** Compiles every program with one of each thing on screen (a fighter included), then uploads textures. */
  async warmShaders() {
    const warm = [];
    for (const e of this.chars.values()) {
      const vrm = await e.model.take();
      const f = new Fighter({ id: -1, name: '', slot: 0, local: false, vrm, rig: e.model.rig, lib: e.lib, world: this.world, scene: this.scene });
      f.snap(this.map.spawns[0].p[0] + warm.length * 0.8, this.map.spawns[0].p[1], this.map.spawns[0].p[2], 0);
      warm.push({ e, f, vrm });
    }
    // one of every effect on screen so their programs compile now, not at the first hit
    const sp = { x: this.map.spawns[0].p[0], y: this.map.spawns[0].p[1] + 1, z: this.map.spawns[0].p[2] };
    this.fx.impact(sp, 2);
    this.fx.poof(sp);
    this.fx.dust(sp);
    this.fx.ripple(sp);
    this.fx.update(0.01);
    this.logs.spawn(sp, 0);
    // jutsu effects: visible for the compile, hidden after
    const J = this.jutsu, jfx = [...J.auras.map((a) => a.group), ...J.rasengans.map((a) => a.group), ...J.rsh.flatMap((a) => [a.group, a.boom]), ...J.shuriken, ...this.movefx.warmObjects()];
    this.jutsu.madara.warm(true, sp); // Madara's kit: fire blobs, footprint decals, field flames (world-space, not moved)
    this.jutsu.itachi.warm(true, sp); // Itachi's kit: black flames, Mangekyō marks, crows, feathers
    this.post.genjutsu.amt = 0.5; // (its branch compiles either way; this just shows it once)
    for (const o of jfx) {
      o.visible = true;
      o.position.set(sp.x, sp.y, sp.z);
    }
    this.camera.position.set(this.map.spawns[0].p[0] + 3, this.map.spawns[0].p[1] + 2, this.map.spawns[0].p[2] + 3);
    this.camera.lookAt(this.map.spawns[0].p[0], this.map.spawns[0].p[1] + 1, this.map.spawns[0].p[2]);
    try {
      // compile against the composer's buffer: programs are keyed by output colour space, and the screen's (sRGB)
      // variants would never be used (the scene always renders into the post chain)
      const prevT = this.renderer.getRenderTarget();
      this.renderer.setRenderTarget(this.post.composer.inputBuffer);
      await this.renderer.compileAsync(this.scene, this.camera);
      this.renderer.setRenderTarget(prevT);
    } catch (e) {
      console.warn('[shinobi] compileAsync', e);
    }
    // the shadow cache owns the shadow maps: arm it or this render samples maps that don't exist yet
    this.shadows.arm(this.scene, warm.map(({ f }) => ({ root: f.root, sphere: new THREE.Sphere(f.pos.clone(), 2) })));
    this.post.render(1 / 60);
    this.scene.traverse((o) => {
      if (!o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        for (const k in m) if (m[k] && m[k].isTexture) this.renderer.initTexture(m[k]);
      }
    });
    for (const o of jfx) o.visible = false;
    this.jutsu.madara.warm(false);
    this.jutsu.itachi.warm(false);
    for (const t of this.art.textures) this.renderer.initTexture(t);
    for (const { e, f, vrm } of warm) {
      f.dispose();
      e.model.give(vrm);
    }
  }

  /** The model + clip library a character draws with (the default character's if its model is missing). */
  charModel(ch) {
    return this.chars.get(ch) || this.chars.get(DEFAULT_CHARACTER);
  }

  /** Title screen character cards: each model in its fighting stance, rendered once. */
  renderCards() {
    this.cards = {};
    const sp = this.map.spawns[0].p;
    for (const [id, e] of this.chars) {
      const vrm = e.model.pool.find((v) => !v.taken);
      if (!vrm) continue;
      vrm.taken = true;
      const f = new Fighter({ id: -2, name: '', slot: 0, local: false, vrm, rig: e.model.rig, lib: e.lib, world: this.world, scene: this.scene });
      f.noRing = true;
      f.snap(sp[0], sp[1], sp[2], 0.5);
      // standing in the fighting stance, blends settled
      const v = { x: sp[0], y: sp[1], z: sp[2], yaw: 0.5, vf: 0, vl: 0, vy: 0, speed: 0, yawRate: 0, st: ST.loco, stT: 5, sprint: false, skid: 0, ground: true, flipT: -1, landT: 5, landV: 0, hardLand: false, wall: null, wallDir: null, wallSpeed: 0, act: null, combat: true, stepUp: 0, flags: 0 };
      for (let i = 0; i < 90; i++) f.update(1 / 60, v);
      try {
        this.cards[id] = renderPortrait(this.renderer, f.root, this.shadows, {
          w: 360, h: 480, fov: 26,
          frame: () => {
            const head = vrm.humanoid.getRawBoneNode('head').getWorldPosition(new THREE.Vector3());
            const target = new THREE.Vector3(f.pos.x, (f.pos.y + head.y + 0.25) / 2, f.pos.z);
            // in front of the fighter (yaw 0 looks toward -z), a little to its left, eye level with the chest
            const a = f.yaw + 0.35, d = 3.6;
            return { eye: new THREE.Vector3(target.x - Math.sin(a) * d, target.y + 0.15, target.z - Math.cos(a) * d), target };
          },
        });
      } catch (err) {
        console.warn('[shinobi] card', err);
      }
      f.dispose();
      e.model.give(vrm);
    }
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.post.setSize(innerWidth, innerHeight);
  }

  // ---------------------------------------------------------------- title / join

  showTitle(on) {
    const t = document.getElementById('title');
    t.classList.toggle('hidden', !on);
    if (on) {
      this.buildTitleSide();
      const btn = document.getElementById('join');
      btn.onclick = () => this.join();
      const onKey = (e) => {
        if (this.state !== 'title' || e.repeat) return;
        if (['Escape', 'F3', 'F4', 'F5', 'F11', 'F12', 'Tab'].includes(e.code)) return;
        // typing a name or a password: Enter joins, every other key is a letter of it
        if (document.activeElement === this.nameEl || document.activeElement === this.pwEl) {
          if (e.code === 'Enter' || e.code === 'NumpadEnter') {
            e.preventDefault();
            this.join();
          }
          return;
        }
        // character select: 1, 2... or the arrow keys; any other key joins
        const ids = this.pickable();
        const num = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
        if (num && +num[1] <= ids.length) return this.pickChar(ids[num[1] - 1], true, true);
        if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
          const i = Math.max(0, ids.indexOf(this.picked));
          return this.pickChar(ids[(i + (e.code === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length], true, true);
        }
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        this.join();
      };
      addEventListener('keydown', onKey);
      this.titleKey = onKey;
      this.statusTimer = setInterval(() => this.refreshStatus(), 3000);
      this.refreshStatus();
    } else {
      clearInterval(this.statusTimer);
      if (this.titleKey) removeEventListener('keydown', this.titleKey);
    }
  }

  /** The characters with a loaded model, in roster order. */
  pickable() {
    return Object.keys(CHARACTERS).filter((id) => this.chars.has(id));
  }

  /** The title screen's right side: the name field and one card per character (built once). */
  buildTitleSide() {
    if (this.nameEl) return;
    const store = (k, v) => {
      try {
        localStorage.setItem(k, v);
      } catch {}
    };
    const load = (k) => {
      try {
        return localStorage.getItem(k) || '';
      } catch {
        return '';
      }
    };
    this.nameEl = document.getElementById('ti-name');
    this.nameEl.value = params.get('name') ?? load('shinobi.name');
    this.nameEl.addEventListener('input', () => store('shinobi.name', this.nameEl.value.trim()));
    // Esc leaves the field (so the next key joins)
    this.nameEl.addEventListener('keydown', (e) => e.code === 'Escape' && this.nameEl.blur());
    // password for a locked character (checked by the server; remembered once it let us in)
    this.pwBox = document.getElementById('ti-pw');
    this.pwEl = document.getElementById('ti-pw-in');
    this.pwEl.value = params.get('pw') ?? load('shinobi.pw');
    this.pwEl.addEventListener('input', () => this.pwBox.classList.remove('bad'));
    this.pwEl.addEventListener('keydown', (e) => e.code === 'Escape' && this.pwEl.blur());
    const box = document.getElementById('ti-cards');
    box.innerHTML = '';
    // one row of up to 5 cards; from 3 on, a wider panel with compact cards; 5: wider still, smaller type
    const n = this.pickable().length;
    box.style.setProperty('--cols', Math.min(Math.max(n, 2), 5));
    box.closest('.ti-side')?.classList.toggle('many', n > 2);
    box.closest('.ti-side')?.classList.toggle('five', n > 4);
    document.getElementById('title')?.classList.toggle('many', n > 2); // (a smaller logo leaves room)
    document.getElementById('title')?.classList.toggle('five', n > 4);
    this.cardEls = new Map();
    this.pickable().forEach((id, i) => {
      const e = this.chars.get(id), C = e.C;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'ti-card';
      el.innerHTML = `<div class="ti-card-in"><img alt="" /><kbd>${i + 1}</kbd><b><span></span><i></i><em></em></b></div>`;
      if (this.cards?.[id]) el.querySelector('img').src = this.cards[id];
      el.querySelector('span').textContent = C.name;
      el.querySelector('i').textContent = e.standin ? 'STAND-IN MODEL' : `${C.locked ? '🔒 ' : ''}${C.card?.tag || ''}`;
      el.classList.toggle('locked', !!C.locked);
      el.querySelector('em').textContent = C.card?.credit || '';
      el.onclick = () => this.pickChar(id);
      box.appendChild(el);
      this.cardEls.set(id, el);
    });
    const want = params.get('ch') || load('shinobi.char');
    this.pickChar(this.chars.has(want) ? want : this.pickable()[0], false);
  }

  pickChar(id, save = true, sound = false) {
    if (!id) return;
    this.picked = id;
    for (const [k, el] of this.cardEls) el.classList.toggle('on', k === id);
    if (sound) this.audio?.click?.(); // (clicks on a card already make the button sound)
    const C = this.chars.get(id)?.C;
    this.pwBox?.classList.toggle('hidden', !C?.locked);
    if (C?.locked) {
      document.getElementById('ti-pw-label').textContent = `🔒 ${C.name.toUpperCase()} IS LOCKED · PASSWORD`;
      if (save && !this.pwEl.value) setTimeout(() => this.pwEl.focus(), 0); // (after the key that picked it)
    }
    if (save) {
      try {
        localStorage.setItem('shinobi.char', id);
      } catch {}
    }
  }

  /** What the title screen says to join as: { name (may be empty: the server names you), ch }. */
  titlePick() {
    const name = (this.nameEl?.value ?? params.get('name') ?? '').trim().slice(0, 16);
    const ch = this.picked || DEFAULT_CHARACTER;
    const pw = this.chars.get(ch)?.C.locked ? (this.pwEl?.value ?? params.get('pw') ?? '').trim() : '';
    return { name, ch, pw };
  }

  /** A locked character's password was missing or wrong: say so on the title screen, put the cursor in the field. */
  askPassword(msg) {
    const st = document.getElementById('ti-status');
    st.textContent = msg;
    st.className = 'ti-status bad';
    this.statusHold = performance.now() + 8000; // (the server status line waits)
    this.pwBox?.classList.remove('hidden');
    this.pwBox?.classList.add('bad');
    this.pwEl?.focus();
    this.pwEl?.select();
  }

  async refreshStatus() {
    const s = await fetchStatus();
    const el = document.getElementById('ti-status');
    if (!el || performance.now() < (this.statusHold || 0)) return;
    el.textContent = s ? `${s.players} / ${s.max} ninja in the arena${s.match?.ph === 'live' ? ' · match in progress' : ''}` : 'Server unreachable';
    el.className = `ti-status ${s ? 'ok' : 'bad'}`;
  }

  titleCam() {
    this.titleT = 0;
  }

  async join() {
    if (this.state !== 'title') return;
    const pick = this.titlePick();
    if (this.chars.get(pick.ch)?.C.locked && !pick.pw) return this.askPassword(`${this.chars.get(pick.ch).C.name} is locked: enter the password, or pick another ninja.`);
    this.state = 'joining';
    this.audio.start(); // needs the click / key press that got us here
    this.nameEl?.blur();
    this.input.lock();
    const btn = document.getElementById('join');
    btn.classList.add('busy');
    try {
      const w = await this.net.join(pick.name, pick.ch, pick.pw);
      if (pick.pw) {
        try {
          localStorage.setItem('shinobi.pw', pick.pw);
        } catch {}
      }
      await this.enter(w);
    } catch (e) {
      console.error(e);
      btn.classList.remove('busy');
      this.state = 'title';
      if (e.locked) {
        this.input.unlock();
        this.askPassword(`${e.message} ${this.chars.get(e.locked)?.C.name || 'This ninja'} stays locked: try again, or pick another ninja.`);
      } else document.getElementById('ti-status').textContent = e.message;
    }
  }

  async enter(w) {
    this.showTitle(false);
    this.me = w.you;
    const e = this.charModel(w.you.ch);
    const vrm = await e.model.take();
    this.player = new Fighter({ id: w.id, name: w.you.name, slot: w.you.slot, local: true, vrm, rig: e.model.rig, lib: e.lib, world: this.world, scene: this.scene });
    this.combat.attach(this.player);
    this.ctrl = new Controller(this.world, w.you.ch);
    this.ctrl.combatHook = (c, input) => this.combat.preStep(c, input);
    this.hud.setKit(this.ctrl.C); // Q / E / G / R icons of this character's kit
    this.hp = w.you.hp;
    this.maxHp = w.you.hp;
    this.match = w.match;
    this.hud.portrait(this.renderer, vrm, this.shadows, this.ctrl.C.card?.face);
    if (!this.dummy && w.dummy) this.dummy = new Dummy(this, w.dummy);
    this.player.anim.onStep = (side, speed) => this.footstep(this.player, speed);
    const s = w.you.s;
    this.ctrl.reset([s[0], s[1], s[2]], s[6]);
    this.player.snap(s[0], s[1], s[2], s[6]);
    this.cam.reset(s[0], s[1], s[2], s[6]);
    for (const p of w.players) this.addRemote(p);
    this.state = 'playing';
    this.input.enabled = true;
    this.hud.show(true);
    this.acc = 0;
  }

  // ---------------------------------------------------------------- network

  wireNet() {
    const n = this.net;
    n.on('join', (m) => this.addRemote(m.player));
    n.on('leave', (m) => {
      this.jutsu.itachi.cine.drop(m.id); // (its caster gone: an Amaterasu cinematic ends)
      this.removeRemote(m.id);
    });
    n.on('snap', (m) => {
      for (const p of m.ps) {
        if (p[0] === n.id) continue;
        const r = this.remotes.get(p[0]);
        if (!r) continue;
        r.motion.push(p[11], p.slice(1, 11));
        r.seq = p[12];
      }
    });
    n.on('spawn', (m) => {
      this.jutsu.itachi.cine.drop(m.id); // (its caster respawned, e.g. a match starting: the cinematic ends)
      if (m.id === n.id) {
        n.seq = m.seq;
        this.hp = m.hp;
        if (this.ctrl) {
          this.ctrl.dead = false;
          this.player.dead = false;
          this.ctrl.action = null;
          this.ctrl.lockTarget = null;
        }
        this.ctrl?.reset(m.p, m.yaw);
        this.player?.snap(m.p[0], m.p[1], m.p[2], m.yaw);
        this.cam.reset(m.p[0], m.p[1], m.p[2], m.yaw);
        this.jutsu.itachi.world.abort(); // (a respawn ends a Tsukuyomi on this screen at once)
      } else {
        const r = this.remotes.get(m.id);
        if (r) {
          r.motion.clear();
          r.motion.push(n.serverNow() - n.interp - 1, [m.p[0], m.p[1], m.p[2], 0, 0, 0, m.yaw, ST.loco, 0, 0]);
          r.fighter?.snap(m.p[0], m.p[1], m.p[2], m.yaw);
          if (r.fighter) r.fighter.dead = false;
          r.react = null;
          r.act = null;
          r.info.hp = m.hp;
        }
      }
    });
    n.on('a', (m) => this.remoteAction(m));
    n.on('hitr', (m) => {
      if (this.debug && m.rw) this.debug.rewound(m.rw);
      this.combat.onHitr(m);
    });
    n.on('hitx', (m) => this.combat.onHitx(m));
    n.on('gauge', (m) => (this.gauge = m));
    n.on('match', (m) => {
      this.match = m;
      this.hud.matchPhase?.(m);
    });
    n.on('kill', (m) => {
      if (m.v === n.id) {
        this.ctrl.dead = true;
        this.player.dead = true;
        this.hp = 0;
        this.combat.koCollapse(null);
      } else {
        const r = this.remotes.get(m.v);
        if (r?.fighter) {
          r.fighter.dead = true;
          this.combat.koCollapse(r);
        }
      }
      this.hud.kill?.(m);
    });
    n.on('name', (m) => {
      if (m.id === n.id && this.me) this.me.name = m.name;
      const r = this.remotes.get(m.id);
      if (r) {
        r.info.name = m.name;
        if (r.plate) r.plate.querySelector('b').textContent = m.name;
      }
    });
    n.on('sb', (m) => this.hud.scoreboard?.(m));
    n.on('results', (m) => this.hud.results?.(m));
    n.on('deny', (m) => {
      this.hud.deny?.(m);
      this.jutsu.madara.onDeny(m); // (a denied cast takes its local effect back)
      this.jutsu.itachi.onDeny(m);
    });
    n.on('rejoined', (m) => {
      for (const id of [...this.remotes.keys()]) this.removeRemote(id);
      for (const p of m.players) this.addRemote(p);
      this.hud.toast('Reconnected');
    });
    n.on('disconnected', () => this.hud.toast('Connection lost. Reconnecting…'));
  }

  async addRemote(info) {
    if (this.remotes.has(info.id) || info.id === this.net.id) return;
    const ch = this.charModel(info.ch);
    const entry = { info, fighter: null, motion: new RemoteMotion(this.world), seq: info.seq, view: {}, ch };
    this.remotes.set(info.id, entry);
    const vrm = await ch.model.take();
    if (this.remotes.get(info.id) !== entry) return ch.model.give(vrm); // left while we were getting ready
    entry.fighter = new Fighter({ id: info.id, name: info.name, slot: info.slot, local: false, vrm, rig: ch.model.rig, lib: ch.lib, world: this.world, scene: this.scene });
    this.combat.attach(entry.fighter);
    entry.fighter.anim.onStep = (side, speed) => this.footstep(entry.fighter, speed);
    entry.fighter.dead = !info.alive;
    entry.motion.push(info.at, info.s);
    entry.fighter.snap(info.s[0], info.s[1], info.s[2], info.s[6]);
    this.hud.addPlate(entry);
  }

  removeRemote(id) {
    const r = this.remotes.get(id);
    if (!r) return;
    this.remotes.delete(id);
    if (r.fighter) {
      this.jutsu.release(r.fighter);
      r.fighter.dispose(this.scene);
      r.ch.model.give(r.fighter.vrm);
    }
    this.hud.removePlate(r);
  }

  // ---------------------------------------------------------------- frame

  frame() {
    const t0 = performance.now();
    const raw = Math.min(this.clock.getDelta(), 0.25);
    const dt = Math.min(raw, 0.1) * this.timeScale;
    this.renderer.info.reset();
    this.input.poll();
    if (this.state === 'playing') this.play(dt);
    else this.idle(dt);
    for (const e of this.chars.values()) e.model.updateMaterials(dt);
    this.simMs = performance.now() - t0; // game logic + animation, before the render submission
    this.shadows.arm(this.scene, this.shadowCasters());
    this.governor.begin();
    this.post.render(dt);
    this.governor.end();
    const ri = this.renderer.info.render;
    this.frameInfo = { calls: ri.calls, tris: ri.triangles };
    this.hud.update(dt);
    this.cpuMs = performance.now() - t0;
    this.governor.cpu(this.cpuMs);
    this.governor.update(raw, this.state === 'playing');
  }

  /** Everything that moves and casts a shadow this frame: fighters, clones, the dummy, substitution logs. */
  shadowCasters() {
    const out = (this._casters ||= []);
    let n = 0;
    const add = (root, x, y, z, r) => {
      const c = (out[n++] ||= { root: null, sphere: new THREE.Sphere() });
      c.root = root;
      c.sphere.center.set(x, y, z);
      c.sphere.radius = r;
    };
    const fighter = (f) => f && f.root.visible && add(f.root, f.pos.x, f.pos.y + 1, f.pos.z, f.dead ? 2 : 1.7);
    if (this.player) fighter(this.player);
    for (const r of this.remotes.values()) fighter(r.fighter);
    if (this.jutsu) for (const c of this.jutsu.clones) if (!c.gone) fighter(c.f);
    this.jutsu?.madara.casters(add); // Madara's stakes (and the meteor) while they stand
    this.jutsu?.itachi.world.casters(add); // Tsukuyomi's cross and its two stand-ins (while it stands in the arena)
    if (this.dummy) add(this.dummy.root, this.dummy.pos.x, this.dummy.pos.y + 1, this.dummy.pos.z, 1.4);
    if (this.logs) for (const L of this.logs.pool) if (L.m.visible) add(L.m, L.m.position.x, L.m.position.y, L.m.position.z, 0.9);
    out.length = n;
    return out;
  }

  /**
   * Graphics presets. High/Ultra render at native resolution (no dynamic resolution); Low/Medium trade pixel ratio,
   * shadow resolution, grass density and the post passes. '' = Auto (from the graphics card, see autoPreset).
   */
  /** The preset 'Auto' stands for: from the graphics card's name (perfcheck.js). */
  autoPreset() {
    return (this._auto ||= detectPreset(gpuInfo(this.renderer)));
  }

  setPreset(p) {
    const P = {
      low: { pr: 0.75, shadow: 1024, grass: 0.3, bloom: false, smaa: false },
      medium: { pr: 1, shadow: 2048, grass: 0.6, bloom: true, smaa: false },
      high: { pr: Math.min(devicePixelRatio, 1.5), shadow: 4096, grass: 1, bloom: true, smaa: true },
      ultra: { pr: Math.min(devicePixelRatio, 2), shadow: 4096, grass: 1, bloom: true, smaa: true },
    }[p || this.autoPreset()] || null;
    if (!P) return;
    this.preset = p || this.autoPreset();
    const r = this.renderer;
    if (r.getPixelRatio() !== P.pr) {
      r.setPixelRatio(P.pr);
      this.resize();
    }
    const S = this.sky.sun.shadow;
    if (S.mapSize.x !== P.shadow) {
      S.mapSize.set(P.shadow, P.shadow);
      S.map?.dispose();
      S.map = null;
      this.shadows.invalidate();
    }
    const gm = this.art.grass;
    if (gm) gm.count = Math.round(gm.userData.full * P.grass);
    this.post.bloom.blendMode.opacity.value = P.bloom ? 1 : 0;
    this.post.smaa.applyPreset(P.smaa ? SMAAPreset.HIGH : SMAAPreset.LOW);
    this.post.hazeOn = this.preset === 'high' || this.preset === 'ultra'; // heat shimmer over fire
  }

  /** Settings from the pause menu (and at start). */
  applySettings(s, key) {
    this.settings = s;
    this.input.sens = s.sens;
    this.input.invertY = !!s.invertY;
    this.cam.baseFov = s.fov;
    this.hud.togglePerf(!!s.perf);
    this.audio?.setVolume?.(s.volume, s.music);
    if (key === 'preset' || !key) this.setPreset?.(s.preset);
  }

  /** Title screen: a slow camera drift over the arena. */
  idle(dt) {
    this.titleT = (this.titleT || 0) + dt;
    const a = this.titleT * 0.05;
    this.camera.position.set(Math.cos(a) * 55 + 10, 26, Math.sin(a) * 55);
    this.camera.lookAt(10, 3, 0);
    this.sky.update(dt, this.camera);
    updateToon(this.sky.sun, this.camera, null, dt);
    this.art.update(dt, this.fx);
    this.fx.update(dt);
  }

  play(dt) {
    const n = this.net, c = this.ctrl, input = this.input;
    // mouse look (every frame, not per sim step: no latency)
    const [ly, lp] = input.look(dt);
    // (an ultimate's cinematic holds the whole arena still: no input moves anyone, on any screen)
    const frozen = this.jutsu.itachi.cine.frozen(n.serverNow());
    if (!frozen) this.cam.look(ly, lp);
    const others = this._others ||= [];
    others.length = 0;
    for (const r of this.remotes.values()) if (r.fighter && !r.fighter.dead) others.push({ x: r.fighter.pos.x, y: r.fighter.pos.y, z: r.fighter.pos.z, r: 0.34 });

    // fixed-step simulation
    this.acc = Math.min(this.acc + dt, 0.25);
    while (this.acc >= SIM.dt) {
      c.step(frozen ? FROZEN_INPUT : input, this.cam.yaw, others, n.serverNow() / 1000);
      this.stepUp += c.stepUp;
      for (const e of c.events) this.onEvent(e);
      c.events.length = 0;
      this.sendAcc += SIM.dt;
      if (this.sendAcc >= 1 / NET.sendRate - 1e-6) {
        this.sendAcc = 0;
        n.sendState(c.netState(this._ns ||= new Array(10)));
      }
      this.acc -= SIM.dt;
    }
    const alpha = this.acc / SIM.dt;

    this.updateLock(input);

    // local fighter view (interpolated between the last two sim steps; a server correction eases in)
    const b = c.body, v = this.view;
    const vo = (this.visOff ||= [0, 0, 0]), ko = Math.exp(-dt / 0.1);
    for (let i = 0; i < 3; i++) vo[i] *= ko;
    v.x = c.prevX + (b.x - c.prevX) * alpha + vo[0];
    v.y = c.prevY + (b.y - c.prevY) * alpha + vo[1];
    v.z = c.prevZ + (b.z - c.prevZ) * alpha + vo[2];
    v.yaw = c.prevYaw + wrap(c.yaw - c.prevYaw) * alpha;
    this.alpha = alpha;
    this.fillView(v, c);
    v.stepUp = this.stepUp;
    this.stepUp = 0;
    this.player.update(dt, v);

    // remotes
    const rt = n.renderTime();
    for (const r of this.remotes.values()) {
      if (!r.fighter) continue;
      const rv = this.remoteView(r, dt, rt);
      if (rv) r.fighter.update(dt, rv);
    }
    this.dummy?.update(dt);
    // hits happen on the drawn poses
    this.combat.detect();
    this.jutsu.update(dt);
    this.movefx.update(dt);
    this.fx.update(dt);
    this.logs.update(dt);

    // camera
    if (this.studio) this.studioCam();
    else this.cam.update(dt, this.player.pos, { sprint: c.sprint, dash: c.st === ST.dash, wall: c.wall });
    this.cam.lock = c.lockTarget;
    // (inside Tsukuyomi's world the view is the genjutsu's: its camera, the real fighters hidden)
    const tw = this.jutsu.itachi.world, inWorld = tw.late(this.camera);
    // (Amaterasu's cinematic films with its own camera on every screen)
    const cine = this.jutsu.itachi.cine, inCine = cine.late(this.camera);
    this.sky.update(dt, this.camera);
    this._focus ||= new THREE.Vector3();
    updateToon(this.sky.sun, this.camera, inCine ? cine.focus : inWorld ? tw.focus : this._focus.copy(this.player.pos).setY(this.player.pos.y + 1.0), dt);
    this.art.update(dt, this.fx);
    if (this.debug) {
      const hurts = (this._hurts ||= []);
      hurts.length = 0;
      hurts.push(this.player.hurt);
      for (const t of this.combat.targets()) hurts.push(t.hurt);
      this.debug.update(dt, hurts);
    }
    // audio: listener at the camera, zone ambience from where the player is, the chakra charge hums
    const au = this.audio;
    au.update(dt, this.camera, this.player.pos);
    au.chargeHum('me', c.st === ST.charge, this.player.pos);
    for (const [id, r] of this.remotes) if (r.fighter) au.chargeHum(id, r.fighter.view?.st === ST.charge, r.fighter.pos);
  }

  fillView(v, c) {
    const b = c.body;
    const s = Math.sin(c.yaw), co = Math.cos(c.yaw);
    // on the ground the gait gets the drawn body's motion (the last tick's average velocity: positions are
    // interpolated between ticks): with the end-of-tick velocity, planted feet slid ~2 cm while accelerating
    const vx = b.ground ? (b.x - c.prevX) / SIM.dt : b.vx, vz = b.ground ? (b.z - c.prevZ) / SIM.dt : b.vz;
    v.vf = -vx * s - vz * co;
    v.vl = -vx * co + vz * s;
    v.vy = b.vy;
    v.speed = c.speed;
    v.yawRate = c.yawRate;
    v.st = c.st;
    // the sim's timers advance at 60 Hz: drawn frames in between add their share (timer-driven poses, e.g. the
    // double jump's flip, would otherwise turn in steps)
    const ta = (this.alpha || 0) * SIM.dt;
    v.stT = c.stT + ta;
    v.sprint = c.sprint;
    v.skid = c.skid > 0 && b.ground ? 1 : 0;
    v.ground = b.ground;
    v.flipT = c.flipT >= 0 ? c.flipT + ta : c.flipT;
    v.landT = c.landT + ta;
    v.landV = c.landV;
    v.hardLand = c.hardLand;
    if (c.st === ST.dash) {
      const dx = c.dashDir[0], dz = c.dashDir[1];
      v.dashLocal = [-dx * co + dz * s, -dx * s - dz * co];
      v.dashBack = c.dashBack;
      v.dashT = c.dashT + ta;
      v.dashAir = c.dashAir;
    }
    v.wall = c.wall;
    v.wallDir = c.wallDir;
    v.wallSpeed = c.st === ST.wall ? Math.hypot(b.vx, b.vy, b.vz) : 0;
    v.act = c.action?.anim ? c.action.anim() : null;
    if (c.dead && !c.action) v.act = { clip: 'lie', t: 1, key: 'ko' };
    // the fighting stance while locked on or right after a fight
    if (c.action) this.lastFight = performance.now();
    v.combat = !!c.lockTarget || performance.now() - (this.lastFight || 0) < 4000;
  }

  /** A remote fighter's view: its reaction (deterministic flight) or the state stream, plus its current action. */
  remoteView(r, dt, rt) {
    const v = r.view;
    if (this.combat.reactionView(r, dt, v)) {
      v.combat = true;
      return v;
    }
    if (!r.motion.view(rt, dt, v)) return null;
    v.act = null;
    v.flags = r.motion.cur[9];
    if (r.fighter.dead) v.act = { clip: 'lie', t: 1, key: 'ko' };
    else if (v.st === ST.guard) v.act = { clip: 'guard', t: v.stT, key: 'guard' };
    else if (v.st === ST.charge) v.act = { clip: 'charge', t: v.stT, key: 'charge' };
    else if (r.act) {
      // the move started when its event reached the server: the same clock the positions are stamped with
      if (performance.now() < (r.hitstopUntil || 0)) r.act.pause += dt;
      // (`sv`: a cast whose world effect runs on the server clock from its phase times: its pose follows that clock)
      const t = (r.act.sv ? this.net.serverNow() - r.act.at : rt - r.act.r) / 1000 - r.act.pause;
      if (t >= r.act.dur) r.act = null;
      else if (t >= 0) v.act = { clip: r.act.clip, t, key: r.act.key, upper: r.act.upper };
    }
    if (v.act) r.lastFight = performance.now();
    v.combat = performance.now() - (r.lastFight || 0) < 4000 || !!(v.flags & 2);
    return v;
  }

  /** Relayed actions of other fighters. */
  remoteAction(m) {
    if (m.id === this.net.id) {
      // our own substitution, confirmed: adopt the new state sequence
      if (m.k === 'sub') this.net.seq = m.sq;
      // a phase of our own cast that comes from the server (Madara's counter firing)
      else if (m.k === 'jutsu') {
        this.jutsu.madara.onOwn(m);
        this.jutsu.itachi.onOwn(m);
      }
      return;
    }
    const r = this.remotes.get(m.id);
    if (!r) return;
    const C = charOf(r.info.ch);
    switch (m.k) {
      case 'atk': {
        const M = C.moves[m.m];
        if (M) r.act = { clip: M.anim, r: m.r, key: `${m.m}:${m.i}`, dur: (M.startup + M.active + M.recovery) / 60, pause: 0 };
        if (M && r.fighter) this.audio.whoosh(M.weight, r.fighter.pos);
        break;
      }
      case 'sub': {
        // a log where they stood, poofs, and they reappear elsewhere
        const f = m.f || [r.fighter.pos.x, r.fighter.pos.y, r.fighter.pos.z];
        this.fx.poof({ x: f[0], y: f[1], z: f[2] });
        this.logs.spawn({ x: f[0], y: f[1], z: f[2] }, r.fighter?.yaw || 0);
        r.react = null;
        r.act = null;
        r.motion.clear();
        r.motion.push(this.net.renderTime() - 1, [m.p[0], m.p[1], m.p[2], 0, 0, 0, r.fighter?.yaw || 0, ST.loco, 0, 0]);
        r.fighter?.snap(m.p[0], m.p[1], m.p[2], r.fighter.yaw);
        this.fx.poof({ x: m.p[0], y: m.p[1], z: m.p[2] }, 0.8);
        this.jutsu.itachi.onSub(C, { x: f[0], y: f[1], z: f[2] }, { x: m.p[0], y: m.p[1], z: m.p[2] });
        this.audio.poof({ x: f[0], y: f[1], z: f[2] });
        break;
      }
      case 'tech':
        if (r.react) r.react.end = this.net.serverNow();
        break;
      case 'dash':
        if (r.fighter && !m.air) this.fx.dust(r.fighter.pos, 5, 0.9);
        if (r.fighter) this.audio.dash(r.fighter.pos);
        break;
      case 'tool':
      case 'jutsu':
        this.jutsu.onRemote(m, r);
        break;
    }
  }

  /**
   * Lock-on: T / middle mouse picks the nearest enemy in view; the wheel switches; it lets go on death or range.
   * Not locked on, the wheel zooms.
   */
  updateLock(input) {
    const c = this.ctrl;
    const L = c.lockTarget;
    if (L) {
      const t = L.id === 0 ? this.dummy : this.remotes.get(L.id)?.fighter;
      if (!t || t.dead || Math.hypot(t.pos.x - c.body.x, t.pos.z - c.body.z) > 32) c.lockTarget = null;
      else {
        L.x = t.pos.x;
        L.y = t.pos.y;
        L.z = t.pos.z;
      }
    }
    const wheel = input.takeWheel();
    if (input.take('lock', 0.2)) {
      if (c.lockTarget) c.lockTarget = null;
      else c.lockTarget = this.pickLock(0);
    } else if (wheel && c.lockTarget) c.lockTarget = this.pickLock(Math.sign(wheel)) || c.lockTarget;
    const zoom = input.takeZoom();
    if (zoom && !c.lockTarget) this.cam.zoomBy(zoom);
  }

  pickLock(dir) {
    const c = this.ctrl, cam = this.camera;
    const fwd = (this._fwd ||= new THREE.Vector3());
    cam.getWorldDirection(fwd);
    const list = [];
    for (const t of this.combat.targets()) {
      const d = Math.hypot(t.x - c.body.x, t.z - c.body.z);
      if (d > 28) continue;
      const tx = t.x - cam.position.x, ty = t.y + 1 - cam.position.y, tz = t.z - cam.position.z;
      const dot = (tx * fwd.x + ty * fwd.y + tz * fwd.z) / Math.hypot(tx, ty, tz);
      if (dot < 0.55) continue;
      list.push({ t, score: d * 0.05 + (1 - dot) * 4, ang: Math.atan2(tx, tz) });
    }
    if (!list.length) return null;
    let pick;
    if (!dir) pick = list.sort((a, b) => a.score - b.score)[0].t;
    else {
      list.sort((a, b) => a.ang - b.ang);
      const i = list.findIndex((e) => e.t.id === c.lockTarget?.id);
      pick = list[(i + dir + list.length) % list.length].t;
    }
    return { id: pick.id, x: pick.x, y: pick.y, z: pick.z, dead: false };
  }

  footstep(f, speed) {
    const v = f.view;
    if (!v) return;
    if (v.st === ST.loco && speed > 6 && Math.random() < 0.5) this.fx.dust(f.pos, 1, 0.5);
    const g = this.world.ground(f.pos.x, f.pos.z, f.pos.y + 0.3, (this._gs ||= {}));
    this.audio.footstep(f === this.player ? null : f.pos, g.surf, Math.min(1, speed / 9));
    if ((v.flags ?? 0) & 16 || (f === this.player && this.ctrl.water)) this.fx.ripple(f.pos, 0.8);
  }

  onEvent(e) {
    const n = this.net;
    switch (e.k) {
      case 'jump':
      case 'dj':
      case 'walljump':
        n.act(e.k);
        this.audio.jump(null);
        break;
      case 'dash':
        n.act('dash', { d: e.d, air: e.air ? 1 : 0 });
        this.audio.dash(null);
        if (!e.air) this.fx.dust(this.player.pos, 6, 1);
        break;
      case 'land':
        if (e.v > 8) this.cam.addTrauma(Math.min(0.35, e.v * 0.015));
        if (e.v > 3) this.audio.land(null, e.v);
        if (e.v > 4) this.fx.dust(this.ctrl.body, e.v > 12 ? 10 : 5, e.v > 12 ? 1.4 : 0.9);
        if (this.ctrl.water) this.fx.ripple(this.ctrl.body, 1.5);
        break;
    }
  }

  /** Debug: a tight orbit around the local fighter (animation checks). */
  studioCam() {
    const S = this.studio, p = this.player.pos, cam = this.camera;
    const yaw = (S.abs ? 0 : this.ctrl.yaw) + (S.yaw || 0);
    const d = S.dist ?? 3, h = S.h ?? 0.9, pitch = S.pitch ?? 0;
    cam.position.set(p.x - Math.sin(yaw) * Math.cos(pitch) * d, p.y + h + Math.sin(pitch) * d, p.z - Math.cos(yaw) * Math.cos(pitch) * d);
    cam.lookAt(p.x, p.y + h, p.z);
    if (cam.fov !== (S.fov ?? 35)) {
      cam.fov = S.fov ?? 35;
      cam.updateProjectionMatrix();
    }
  }

  /** Debug: puts the local fighter at (x, z) on the ground there, facing yaw (camera behind). */
  teleport(x, z, yaw = 0, y = null) {
    const gy = y ?? this.world.ground(x, z, 60, {}).y;
    this.ctrl.reset([x, gy, z], yaw);
    this.player.snap(x, gy, z, yaw);
    this.cam.reset(x, gy, z, yaw);
    this.acc = 0;
  }

  /** Debug: hold input actions (e.g. ['up']) for the local fighter, or [] to release. */
  hold(actions) {
    this.input.down.clear();
    for (const a of actions) {
      this.input.down.add(a);
      this.input.press(a);
    }
  }

  togglePause() {
    this.hud.togglePause();
  }

  debugKey(code) {
    if (code === 'F3') {
      this.hud.togglePerf();
      return true;
    }
    if (code === 'F6') {
      this.greybox.visible = !this.greybox.visible;
      return true;
    }
    if (code === 'F4') {
      this.debugView = !this.debugView;
      this.debugDraw.setOn(this.debugView);
      this.debug = this.debugView ? this.debugDraw : null;
      return true;
    }
    return false;
  }
}

function wrap(a) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

const game = new Game();
window.__game = game;
window.__BI = BI; // debug: bone indices
window.__kf = { buildPose, merge, STANCE, H0: (rig) => new Gait(rig).H0 }; // debug: key a pose live (scripts/debug/posetest.mjs)
window.__BONES = BONES;
game.init().catch((e) => {
  console.error(e);
  BOOT.fail(e.message);
});
