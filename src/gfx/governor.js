// Frame governor: frame statistics (fps, 1% low, GPU time) and dynamic resolution. The render scale only drops
// below the preset's own resolution while the game can't hold the frame-rate target, and climbs back when there is
// headroom, so a machine that keeps up always sees the full preset. Off by default on High and Ultra (QUALITY.drs),
// and never above 60 fps: higher targets only ever blurred a game held back by the processor. GPU time comes from
// timer queries (EXT_disjoint_timer_query_webgl2) when the browser has them: with vsync the frame time can't show
// headroom (but see adjust(): on ANGLE the timer includes waits too).
// Changing the scale reallocates the post targets, so it moves in 10% steps at most every ~1.5 s. See see CLAUDE.md.
import { gpuInfo } from './perfcheck.js';

const RING = 240;

export class FrameGovernor {
  constructor(renderer) {
    this.gl = renderer.getContext();
    this.ext = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.pool = [];
    this.pending = [];
    this.active = null;
    this.frames = new Float32Array(RING); // frame ms, ring
    this.gpu = new Float32Array(60); // GPU ms, ring
    this.cpuMs = new Float32Array(60); // the game's own work per frame (JS + draw submission), ring
    this.nc = 0;
    this.nf = 0;
    this.ng = 0;
    this.sorted = new Float32Array(RING);
    this.scale = 1;
    this.minScale = 0.6;
    this.target = 60; // fps; 0 = never change the resolution
    this.enabled = true;
    this.onScale = null; // (scale) => apply it
    this.t = 0;
    this.nextCheck = 0;
    this.holdUntil = 0;
    this.slow = 0;
    this.fast = 0;
    this.upDelay = 4; // windows of headroom before stepping up without GPU timing (backs off after a failed probe)
    this.lastUp = -99;
    this.stats = { fps: 0, ms: 0, median: 0, low1: 0, gpu: 0, gpuMid: 0, cpu: 0 };
  }

  /** GPU timer around the frame's rendering (no-ops without the extension). */
  begin() {
    if (!this.ext || this.active || this.pending.length > 4) return;
    const q = this.pool.pop() || this.gl.createQuery();
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  end() {
    if (!this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  poll() {
    const gl = this.gl;
    while (this.pending.length) {
      const q = this.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending.shift();
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
      if (!gl.getParameter(this.ext.GPU_DISJOINT_EXT)) this.gpu[this.ng++ % this.gpu.length] = ns / 1e6;
      this.pool.push(q);
    }
  }

  /** The main-thread time the game spent on this frame (frame() start to end). */
  cpu(ms) {
    this.cpuMs[this.nc++ % this.cpuMs.length] = ms;
  }

  /** Call once per rendered frame with the real frame interval. The resolution only adapts while `live` (in game). */
  update(dt, live) {
    if (this.ext) this.poll();
    this.t += dt;
    // a hidden tab or a load stall is not a frame time
    if (dt > 0.25) return;
    this.frames[this.nf++ % RING] = dt * 1000;
    if (this.t < this.nextCheck) return;
    this.nextCheck = this.t + 0.5;
    this.measure();
    if (live && this.enabled && this.target > 0 && this.t > this.holdUntil) this.adjust();
    else this.slow = this.fast = 0;
  }

  measure() {
    const n = Math.min(this.nf, RING);
    if (!n) return;
    const s = this.sorted.subarray(0, n);
    s.set(this.frames.subarray(0, n));
    s.sort();
    let sum = 0;
    for (let i = 0; i < n; i++) sum += s[i];
    let worst = 0;
    const k = Math.max(1, Math.floor(n / 100));
    for (let i = n - k; i < n; i++) worst += s[i];
    const st = this.stats;
    st.ms = sum / n;
    st.fps = 1000 / st.ms;
    st.median = s[n >> 1];
    st.low1 = 1000 / (worst / k);
    st.gpu = this.gpuP(0.8);
    st.gpuMid = this.gpuP(0.5);
    const nc = Math.min(this.nc, this.cpuMs.length);
    if (nc) {
      const c = this.sorted.subarray(0, nc);
      c.set(this.cpuMs.subarray(0, nc));
      c.sort();
      st.cpu = c[nc >> 1];
    }
  }

  /** A percentile of the recent GPU frame times, or 0 without timer queries. */
  gpuP(p) {
    const n = Math.min(this.ng, this.gpu.length);
    if (!n) return 0;
    const s = this.sorted.subarray(0, n);
    s.set(this.gpu.subarray(0, n));
    s.sort();
    return s[Math.min(n - 1, Math.floor(n * p))];
  }

  adjust() {
    const st = this.stats, budget = 1000 / this.target;
    // judge the last ~second, not the whole ring; a GPU that can't finish frames in time is slow even when the
    // browser keeps calling requestAnimationFrame on schedule (it drops frames instead)
    const gpuMid = this.gpuP(0.5);
    const recent = Math.max(this.recentMedian(45), gpuMid);
    // On Chrome/ANGLE the timer also counts the wait for the swap chain, so a frame held back by vsync or by the
    // processor reads as a GPU frame as long as the frame interval (measured: 6.9 ms at 144 fps, 9.4 ms at 105 fps,
    // at any scale). Only a reading clearly under the interval says how busy the card really is.
    const gpu = st.gpu && gpuMid < recent * 0.85 ? st.gpu : 0;
    const gpuBound = !gpu || gpu > budget * 0.8;
    // the game's own frame work doesn't shrink with the resolution: when that is the limit, a lower scale only blurs
    const cpuBound = st.cpu > recent * 0.75;
    if (recent > budget * 1.1 && gpuBound && !cpuBound) {
      this.fast = 0;
      if (++this.slow >= 2 && this.t > this.holdUntil) {
        this.slow = 0;
        if (this.scale > this.minScale + 1e-3) {
          // a failed probe up: wait longer before trying again
          if (this.t - this.lastUp < 4) this.upDelay = Math.min(40, this.upDelay * 2);
          this.set(Math.max(this.minScale, this.scale - 0.1));
        }
      }
      return;
    }
    this.slow = 0;
    if (this.scale >= 1) return;
    const up = Math.min(1, this.scale + 0.1);
    // GPU time grows with the pixel count (scale squared)
    // (processor-bound: the lower scale isn't buying anything, give the resolution back)
    const roomy = cpuBound || (gpu ? gpu * (up / this.scale) ** 2 < budget * 0.78 && recent < budget * 1.05 : recent < budget * 1.03);
    if (!roomy) {
      this.fast = 0;
      return;
    }
    if (++this.fast >= (gpu ? 4 : this.upDelay) && this.t > this.holdUntil) {
      this.fast = 0;
      this.lastUp = this.t;
      this.set(up);
    }
  }

  recentMedian(count) {
    const n = Math.min(this.nf, RING, count);
    if (!n) return 0;
    const s = this.sorted.subarray(0, n);
    for (let i = 0; i < n; i++) s[i] = this.frames[(this.nf - 1 - i + RING) % RING];
    s.sort();
    return s[n >> 1];
  }

  set(scale) {
    this.scale = Math.round(scale * 100) / 100;
    this.holdUntil = this.t + 1.5;
    this.nf = 0; // frames at the old resolution no longer say anything
    this.ng = 0;
    this.onScale?.(this.scale);
  }

  /** Loading hitches aren't slowness: no resolution changes for `secs` (join, world change). */
  settle(secs) {
    this.holdUntil = Math.max(this.holdUntil, this.t + secs);
    this.slow = this.fast = 0;
  }

  /** Back to the preset's full resolution (preset or target changed). */
  reset() {
    this.scale = 1;
    this.nf = this.ng = 0;
    this.slow = this.fast = 0;
    this.upDelay = 4;
    this.holdUntil = this.t + 1.5;
  }
}

/**
 * First-run preset from the GPU the browser reports: software rendering and Intel HD/UHD-class integrated graphics
 * get Potato, other integrated graphics Low, everything else High (the game's default).
 */
export function detectPreset(renderer) {
  const { name, software } = gpuInfo(renderer);
  const cores = navigator.hardwareConcurrency || 8, mem = navigator.deviceMemory || 8;
  let preset = 'high';
  if (/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i.test(name)) preset = 'potato';
  else if (/intel/i.test(name) && !/iris|arc|xe/i.test(name)) preset = 'potato';
  else if (/intel|mali|adreno|powervr|apple gpu|radeon\(tm\) graphics|vega \d+ graphics/i.test(name)) preset = 'low';
  if (preset === 'high' && (cores <= 2 || mem <= 2)) preset = 'low';
  // software: no hardware acceleration at all, the CPU draws every triangle (a few fps whatever the settings)
  return { preset, gpu: name, software };
}
