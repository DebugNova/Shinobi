// Performance check: which graphics card the browser really uses, and why the frame rate is low when it is.
// Players reported "locked at 20 fps in Chrome". With vsync on a 60 Hz screen a frame that takes a little over
// 33 ms is shown every third refresh: exactly 20 fps. The usual causes are a laptop running Chrome on its
// built-in graphics instead of the NVIDIA/AMD card, hardware acceleration switched off (the CPU draws
// everything), too high a preset for the card, or something outside the game throttling it (Chrome's Energy
// saver, Windows battery saver). The pause menu shows the card, the numbers and the fix. See see CLAUDE.md.

/** What the browser reports about the GPU: { name, short, software, integrated }. */
export function gpuInfo(renderer) {
  let name = '';
  try {
    const gl = renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    name = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch {}
  // "ANGLE (NVIDIA, NVIDIA GeForce RTX 4050 Laptop GPU (0x000028E1) Direct3D11 vs_5_0 ps_5_0, D3D11)" -> the model
  let short = name;
  const m = name.match(/^ANGLE \((?:[^,]+), (.+?)(?: \(0x[0-9a-f]+\))?(?: Direct3D| OpenGL| Vulkan| Metal|,)/i);
  if (m) short = m[1];
  if (/swiftshader/i.test(name)) short = 'none (SwiftShader software renderer)';
  const software = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
  const integrated = !software && /intel|radeon\(tm\) graphics|vega \d+ graphics|radeon graphics/i.test(name) && !/arc/i.test(name);
  return { name, short: short || 'unknown', software, integrated };
}

/**
 * Diagnosis from the frame stats (fps, frame ms, GPU ms from timer queries, CPU ms of the game's frame work).
 * Returns { level: 'ok' | 'warn' | 'bad', title, tips: [html...], offer: null | 'low' | 'potato' }.
 */
export function diagnose(st, gpu, { preset, target, scale, minScale }) {
  const tips = [];
  const fps = st.fps || 0;
  const good = fps >= Math.max(40, (target || 60) * 0.9);
  const lighter = preset === 'potato' ? null : preset === 'low' ? 'potato' : gpu.integrated || gpu.software ? 'potato' : 'low';
  if (gpu.software) {
    tips.push('Your browser is <b>not using the graphics card</b>: the processor draws the whole game, which caps it at a few frames per second whatever the settings.');
    tips.push('Chrome: open <b>chrome://settings/system</b>, turn on <b>"Use graphics acceleration when available"</b>, press <b>Relaunch</b>, then rejoin. Edge: edge://settings/system, same switch.');
    return { level: 'bad', title: 'No graphics acceleration', tips, offer: preset === 'potato' ? null : 'potato' };
  }
  if (gpu.integrated) {
    tips.push('Chrome is using the <b>built-in graphics</b>. If this laptop also has an NVIDIA or AMD card: Windows <b>Settings → System → Display → Graphics</b>, pick <b>Google Chrome</b>, set it to <b>High performance</b>, then close and reopen Chrome.');
  }
  if (good || !fps) return { level: gpu.integrated ? 'warn' : 'ok', title: fps ? 'Running smoothly' : 'Measuring…', tips, offer: null };

  const ms = st.median || st.ms || 1000 / fps;
  const g = st.gpuMid || 0, c = st.cpu || 0;
  if (g && g > ms * 0.7) {
    tips.unshift(`The <b>graphics card is the limit</b> (${g.toFixed(0)} ms of work per frame for ${ms.toFixed(0)} ms per frame). ${!target ? 'Dynamic resolution is off (it can hold 30 or 60 fps by lowering the resolution a little).' : scale <= minScale + 0.01 ? 'The resolution is already as low as it goes on this preset.' : scale < 0.99 ? `The game has already lowered the resolution to ${Math.round(scale * 100)}%.` : 'The game lowers the resolution a little to keep up.'}${lighter ? ` Switch to <b>${lighter === 'potato' ? 'Potato' : 'Low'}</b> below.` : ''}`);
    return { level: 'bad', title: 'Graphics card is the limit', tips, offer: lighter };
  }
  if (c > ms * 0.7) {
    tips.unshift(`The <b>processor is the limit</b> (${c.toFixed(0)} ms of game work per frame). Close other tabs and programs (video, streams, downloads)${lighter ? `, or switch to <b>${lighter === 'potato' ? 'Potato' : 'Low'}</b> below, which also cuts the work` : ''}.`);
    return { level: 'bad', title: 'Processor is the limit', tips, offer: lighter };
  }
  if (g || c) {
    // neither the GPU nor the game is busy, yet frames come slowly: something outside the game throttles it
    tips.unshift('Neither the graphics card nor the game is busy, so <b>something outside the game is holding the frame rate down</b>: turn off Chrome\'s <b>Energy saver</b> (chrome://settings/performance), <b>plug the laptop in</b>, turn off Windows <b>Battery saver</b> / set the power mode to <b>Best performance</b>, and keep this window in front.');
    return { level: 'bad', title: 'Frame rate is being limited', tips, offer: null };
  }
  tips.unshift(`Low frame rate. Try a lighter preset${lighter ? ` (<b>${lighter === 'potato' ? 'Potato' : 'Low'}</b> below)` : ''}, close other tabs, plug the laptop in and turn off Chrome's Energy saver (chrome://settings/performance).`);
  return { level: 'bad', title: 'Low frame rate', tips, offer: lighter };
}

/**
 * First-run graphics preset from the card's name: software rendering -> low, integrated graphics -> medium, a
 * dedicated card -> high, a high-end desktop card -> ultra. (Laptop cards stay on high: their power limits vary.)
 */
export function detectPreset(gpu) {
  if (gpu.software) return 'low';
  if (gpu.integrated || /adreno|mali|powervr|apple (m1|gpu)/i.test(gpu.name)) return 'medium';
  const n = gpu.name;
  if (!/laptop|mobile|max-q/i.test(n) && /rtx (40[7-9]0|50[6-9]0|30[8-9]0)|rx (7[89]|9[07])\d0/i.test(n)) return 'ultra';
  return 'high';
}
