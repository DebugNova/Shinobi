// Shared between the browser client and the Node server: network, match and simulation constants.

export const PORT = 3100;

export const SIM = {
  hz: 60, // fixed simulation step for movement, moves and knockback flights (rendering is interpolated)
  dt: 1 / 60,
};

export const NET = {
  sendRate: 30, // client -> server state uploads per second
  snapshotRate: 30, // server -> client snapshots per second
  interpMin: 70, // ms: remotes are drawn this far behind the synced server clock (widens with jitter)...
  interpMax: 120, // ...up to this
  extrapolate: 100, // ms of extrapolation when a packet is late, then hold
  rewindCap: 200, // ms: the server rewinds a victim at most this far behind the attacker's report
  maxPlayers: 6,
  ghostMs: 20000, // a dropped player's slot and score survive this long for a reconnect
};

export const MATCH = {
  duration: 300, // seconds of free-for-all
  results: 10, // seconds of results screen before the next match
  respawn: 5,
  spawnProtect: 2,
  killScore: 100,
  assistScore: 50,
  assistWindow: 10, // seconds: damaged the victim this recently = assist
};

// Per-player colours (ground ring, nameplate, tint of the headband cloth). Index = slot.
export const PALETTE = ['#ff8a1f', '#3fa7ff', '#4fd36b', '#ff4f6d', '#b872ff', '#ffd23f'];

// State ids carried in the 30 Hz state upload (st[7]); the animation a remote plays for continuous states.
export const ST = {
  loco: 0, // ground: idle / run / sprint (speed from velocity)
  air: 1,
  dash: 2,
  wall: 3, // wall run
  attack: 4,
  guard: 5,
  charge: 6,
  hit: 7, // hitstun / stagger / guard stun
  flight: 8, // launched / knocked back
  down: 9, // knocked down, lying
  getup: 10,
  ko: 11,
  jutsu: 12,
  sub: 13, // substitution (teleporting)
  land: 14,
  throw: 15,
};

// Flag bits in the state upload (st[9]).
export const FLAG = {
  sprint: 1,
  lock: 2, // locked on (strafing)
  invuln: 4,
  dead: 8, // set by the server
  water: 16,
  doubleJumped: 32,
  guardBroken: 64,
  skid: 128, // braking hard (the skid stop animation)
};

export const SURF = { dirt: 0, grass: 1, wood: 2, stone: 3, water: 4, plaster: 5, roof: 6, bark: 7, rock: 8, metal: 9 };
