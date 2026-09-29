// The developer's command bar: "/" in a match opens it, Enter runs the command, Esc closes it. The server owns the
// ultimate gauge, the substitution pips and the jutsu cooldowns, so every command goes to it (`dev{c}`) and works only
// for a player on the server's own machine (server/index.js devAllowed; SHINOBI_DEV=1 opens them to everyone); its
// answer does the client's part (cooldowns and chakra are kept here too).

const CMDS = [
  { c: 'ult', names: ['ult', 'ultimate', 'u'], help: 'ultimate gauge full', done: 'Ultimate charged' },
  { c: 'cd', names: ['cd', 'cooldown', 'cooldowns', 'reset'], help: 'jutsu cooldowns reset, chakra full', done: 'Cooldowns reset, chakra full' },
  { c: 'sub', names: ['sub', 'subs', 'substitution'], help: 'substitutions full', done: 'Substitutions full' },
  { c: 'all', names: ['all', 'full'], help: 'all of the above', done: 'Ultimate, cooldowns, chakra, substitutions: full' },
];
const now = () => performance.now() / 1000;

export class DevBar {
  constructor(game) {
    this.game = game;
    this.open = false;
    this.wasLocked = false;
    const el = (this.el = document.createElement('div'));
    el.id = 'devbar';
    el.innerHTML = '<div class="db-row"><span class="db-slash">/</span><input type="text" spellcheck="false" autocomplete="off" maxlength="40" aria-label="Developer command"></div><div class="db-hint"></div>';
    this.field = el.querySelector('input');
    el.querySelector('.db-hint').innerHTML = CMDS.map((d) => `<p><b>/${d.c}</b>${d.help}</p>`).join('') + '<p class="db-keys">Enter runs · Esc closes</p>';
    document.body.appendChild(el);
    this.field.addEventListener('keydown', (e) => {
      e.stopPropagation(); // (the game's window listeners never see what is typed here)
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        const text = this.field.value;
        this.close(false);
        this.run(text);
      } else if (e.code === 'Escape') {
        e.preventDefault();
        this.close(true);
      }
    });
    this.field.addEventListener('blur', () => this.close(false));
    // (Esc with the pointer locked: the browser drops the lock and may keep the key: close as if Esc was pressed)
    document.addEventListener('pointerlockchange', () => {
      if (this.open && this.wasLocked && !document.pointerLockElement) this.close(true);
    });
  }

  /** Opens it (a match, not paused). */
  show() {
    const g = this.game;
    if (this.open || g.state !== 'playing' || !g.input.enabled) return;
    this.open = true;
    this.wasLocked = !!document.pointerLockElement;
    g.input.down.clear(); // (keys held when it opened are let go: no running on while typing)
    g.input.quietUntil = Infinity; // (no pause menu from the Esc that closes it)
    this.el.classList.add('on');
    this.field.value = '';
    this.field.focus();
  }

  close(byEsc) {
    if (!this.open) return;
    this.open = false;
    this.el.classList.remove('on');
    this.field.blur();
    this.game.input.quietUntil = byEsc ? now() + 0.5 : 0;
  }

  run(text) {
    const w = String(text).trim().replace(/^\/+/, '').toLowerCase().split(/\s+/)[0];
    if (!w) return;
    const hud = this.game.hud;
    if (w === 'help' || w === '?') return hud.toast(CMDS.map((d) => `/${d.c}`).join('   '), 4000);
    const d = CMDS.find((x) => x.names.includes(w));
    if (!d) return hud.toast(`Unknown command /${w} (try /help)`, 3000);
    this.game.net.send({ t: 'dev', c: d.c });
  }

  /** The server's answer (`dev{c,ok,why}`). */
  onAnswer(m) {
    const g = this.game;
    if (!m.ok) return g.hud.toast(m.why === 'off' ? 'Dev commands only work on your own server (this laptop)' : `Unknown command /${m.c}`, 3500);
    if (m.c === 'cd' || m.c === 'all') {
      g.jutsu.ready = {};
      if (g.ctrl) g.ctrl.chakra = g.ctrl.C.stats.chakra;
    }
    g.hud.toast(CMDS.find((x) => x.c === m.c)?.done || 'Done', 2200);
  }
}
