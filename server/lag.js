// Latency simulation: SHINOBI_LAG=rtt,jitter,loss (ms, ms, percent), e.g. 200,40,1. Every message in both directions
// is delayed by rtt/2 +- jitter/2. WebSockets run over TCP, so a "lost" packet is never dropped: it is retransmitted
// about one round trip later and holds up everything behind it (head-of-line blocking), which is what the real
// internet does to this game. Delivery order is kept per socket and direction.
//
// Order is kept with one queue and one timer per line, never one setTimeout per message: two messages due at the
// same moment got different setTimeout delays (computed at different instants) and Node could fire the later one
// first. That reordered a match-start `spawn` ahead of the `welcome` and left a client on a stale state sequence.

export function parseLag(env) {
  if (!env) return null;
  const [rtt = 0, jitter = 0, loss = 0] = String(env).split(',').map(Number);
  if (!(rtt > 0 || jitter > 0 || loss > 0)) return null;
  return { rtt, jitter, loss };
}

export class LagLine {
  constructor(lag) {
    this.lag = lag;
    this.last = 0;
    this.queue = [];
    this.timer = null;
  }

  /** Runs fn after this direction's simulated delay (order preserved). */
  run(fn) {
    const L = this.lag;
    const now = performance.now();
    let d = L.rtt / 2 + (Math.random() * 2 - 1) * (L.jitter / 2);
    if (Math.random() * 100 < L.loss) d += L.rtt + 20;
    const at = Math.max(now + Math.max(0, d), this.last);
    this.last = at;
    this.queue.push({ at, fn });
    if (!this.timer) this.arm();
  }

  arm() {
    const head = this.queue[0];
    if (!head) {
      this.timer = null;
      return;
    }
    this.timer = setTimeout(() => this.flush(), Math.max(0, head.at - performance.now()));
  }

  flush() {
    const now = performance.now();
    while (this.queue.length && this.queue[0].at <= now + 0.5) {
      const { fn } = this.queue.shift();
      try {
        fn();
      } catch (e) {
        console.error(e);
      }
    }
    this.arm();
  }
}
