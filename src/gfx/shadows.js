// Static shadow caching. Every shadowed light used to redraw its whole shadow map every frame (5 spots in the
// armory, the 4096 sun over the whole war zone) although almost nothing that casts a shadow moves. Now each light
// keeps a copy of its static-only depth map, rendered once. On a frame with moving casters (fighters, clones, the dummy, a dropped
// gun, the sniper turntable, an inspected weapon) the static depth is copied back only inside the rectangle those
// casters covered last frame or cover now, and only they are drawn on top. A light with no moving caster in view
// costs nothing. The result is the same depth map as a full redraw (see CLAUDE.md).
import * as THREE from 'three';

const _m = new THREE.Matrix4();
const noop = () => {};

export class ShadowCache {
  constructor(renderer) {
    this.renderer = renderer;
    this.gl = renderer.getContext();
    this.entries = new Map(); // light -> { fb, rb, w, h, map, valid, rect }
    this.enabled = true;
    this._rect = [0, 0, 0, 0];
    this.armed = null;
    // three calls shadowMap.render inside every renderer.render, after world matrices and skeletons are updated.
    // Take that call over: the first render of the armed scene each frame updates the cache, every other render
    // (floor reflection, AO) reuses the maps.
    const sm = renderer.shadowMap;
    sm.autoUpdate = false;
    this.draw = sm.render;
    sm.render = (lights, scene, camera) => {
      const a = this.armed;
      if (!a || scene !== a.scene) return;
      this.armed = null;
      this.update(scene, camera, lights, a.casters, a.count);
    };
  }

  /** Called once per frame before rendering: the next render of `scene` updates its shadow maps. */
  arm(scene, casters, count = casters.length) {
    const a = (this._arm ||= {});
    a.scene = scene;
    a.casters = casters;
    a.count = count;
    this.armed = a;
  }

  /** Drops the cached static maps (e.g. static shadow casters were added or removed). */
  invalidate() {
    this.gen = (this.gen || 0) + 1; // (counted: Tsukuyomi's world hides the arena and redraws it if this happened meanwhile)
    for (const e of this.entries.values()) e.valid = false;
  }

  /**
   * Brings a world's shadow maps up to date (from inside its main render, see arm()). `casters` are this frame's
   * moving shadow casters, [{ root: Object3D, sphere: THREE.Sphere (world space) }]; the first `count` are used.
   */
  update(scene, camera, lights, casters, count = casters.length) {
    const sm = this.renderer.shadowMap;
    if (!sm.enabled) return;
    for (const light of lights) {
      if (!light.castShadow || !light.visible) continue;
      const shadow = light.shadow;
      const e = this.entry(light);
      if (!this.enabled) {
        // fallback: plain full redraw every frame (the old behaviour)
        this.render(sm, light, scene, camera);
        e.valid = false;
        continue;
      }
      if (!e.valid || !shadow.map || shadow.map !== e.map || shadow.map.width !== e.w || shadow.map.height !== e.h) {
        this.renderStatic(sm, light, scene, camera, casters, count, e);
      }
      // the rectangle (in shadow-map texels) the moving casters cover now
      shadow.updateMatrices(light);
      const cam = shadow.camera;
      _m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, any = false;
      for (let i = 0; i < count; i++) {
        const r = this.project(casters[i].sphere, e.w, e.h);
        if (!r) continue;
        casters[i].lit = true;
        any = true;
        x0 = Math.min(x0, r[0]);
        y0 = Math.min(y0, r[1]);
        x1 = Math.max(x1, r[2]);
        y1 = Math.max(y1, r[3]);
      }
      const prev = e.rect;
      if (!any && !prev) continue;
      // restore the static depth where casters were last frame and are now, then draw them again
      let bx0 = x0, by0 = y0, bx1 = x1, by1 = y1;
      if (prev) {
        bx0 = Math.min(bx0, prev[0]);
        by0 = Math.min(by0, prev[1]);
        bx1 = Math.max(bx1, prev[2]);
        by1 = Math.max(by1, prev[3]);
      }
      this.blit(e.fb, this.fbOf(shadow.map), bx0, by0, bx1, by1);
      if (any) {
        const clear = this.renderer.clear;
        this.renderer.clear = noop; // the copy above is the "clear"
        this.onCasters?.(true, casters, count);
        try {
          for (let i = 0; i < count; i++) {
            if (!casters[i].lit) continue;
            casters[i].lit = false;
            this.render(sm, light, casters[i].root, camera);
          }
        } finally {
          this.renderer.clear = clear;
          this.onCasters?.(false, casters, count);
        }
        e.rect = prev && prev.length ? prev : [];
        e.rect[0] = x0;
        e.rect[1] = y0;
        e.rect[2] = x1;
        e.rect[3] = y1;
      } else e.rect = null;
    }
  }

  entry(light) {
    let e = this.entries.get(light);
    if (!e) this.entries.set(light, (e = { fb: null, rb: null, w: 0, h: 0, map: null, valid: false, rect: null }));
    return e;
  }

  render(sm, light, root, camera) {
    light.shadow.needsUpdate = true;
    sm.needsUpdate = true;
    this._one ||= [];
    this._one[0] = light;
    this.draw.call(sm, this._one, root, camera);
  }

  /** Full redraw without the moving casters, then keep a copy of the depth. */
  renderStatic(sm, light, scene, camera, casters, count, e) {
    const hidden = [];
    for (let i = 0; i < count; i++) {
      const o = casters[i].root;
      if (o.visible) {
        o.visible = false;
        hidden.push(o);
      }
    }
    try {
      this.render(sm, light, scene, camera);
    } finally {
      for (const o of hidden) o.visible = true;
    }
    const map = light.shadow.map;
    if (e.w !== map.width || e.h !== map.height || !e.fb) this.alloc(e, map.width, map.height);
    this.blit(this.fbOf(map), e.fb, 0, 0, e.w, e.h);
    e.map = map;
    e.valid = true;
    e.rect = null;
  }

  /** Sphere -> texel rectangle [x0, y0, x1, y1] in the light's map, or null when it is off the map. */
  project(sphere, w, h) {
    const m = _m.elements, c = sphere.center, s = sphere.radius;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = 0; k < 8; k++) {
      const x = c.x + (k & 1 ? s : -s), y = c.y + (k & 2 ? s : -s), z = c.z + (k & 4 ? s : -s);
      const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
      // a corner behind a spot light: the caster straddles the light, take the whole map
      if (cw <= 1e-4) return [0, 0, w, h];
      const nx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / cw;
      const ny = (m[1] * x + m[5] * y + m[9] * z + m[13]) / cw;
      x0 = Math.min(x0, nx);
      x1 = Math.max(x1, nx);
      y0 = Math.min(y0, ny);
      y1 = Math.max(y1, ny);
    }
    if (x1 < -1 || x0 > 1 || y1 < -1 || y0 > 1) return null;
    const r = this._rect;
    // a few texels of margin for rasterization
    r[0] = Math.max(0, Math.floor((x0 * 0.5 + 0.5) * w) - 3);
    r[1] = Math.max(0, Math.floor((y0 * 0.5 + 0.5) * h) - 3);
    r[2] = Math.min(w, Math.ceil((x1 * 0.5 + 0.5) * w) + 3);
    r[3] = Math.min(h, Math.ceil((y1 * 0.5 + 0.5) * h) + 3);
    return r[2] > r[0] && r[3] > r[1] ? r : null;
  }

  fbOf(target) {
    return this.renderer.properties.get(target).__webglFramebuffer;
  }

  /** A depth-only framebuffer in the shadow map's format (DEPTH_COMPONENT24: three's DepthFormat + UnsignedIntType). */
  alloc(e, w, h) {
    const gl = this.gl, st = this.renderer.state;
    if (e.fb) this.free(e);
    e.rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, e.rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    e.fb = gl.createFramebuffer();
    st.bindFramebuffer(gl.FRAMEBUFFER, e.fb);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, e.rb);
    st.bindFramebuffer(gl.FRAMEBUFFER, null);
    e.w = w;
    e.h = h;
  }

  free(e) {
    this.gl.deleteFramebuffer(e.fb);
    this.gl.deleteRenderbuffer(e.rb);
    e.fb = e.rb = null;
    e.w = e.h = 0;
  }

  blit(src, dst, x0, y0, x1, y1) {
    const gl = this.gl, st = this.renderer.state;
    st.bindFramebuffer(gl.READ_FRAMEBUFFER, src);
    st.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dst);
    st.setScissorTest(false);
    st.buffers.depth.setMask(true);
    gl.blitFramebuffer(x0, y0, x1, y1, x0, y0, x1, y1, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    st.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    st.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    // back to the render in progress's target: without this, a frame with no moving caster to draw after the copy
    // (the portrait, casters leaving the map) renders the scene into the canvas instead of its target
    const r = this.renderer;
    r.setRenderTarget(r.getRenderTarget(), r.getActiveCubeFace(), r.getActiveMipmapLevel());
  }
}
