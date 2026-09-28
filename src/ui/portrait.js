// Offscreen pictures of a fighter model for the UI (the HUD portrait, the title screen's character cards). The
// light setup copies the arena's (hemisphere + one shadowed sun + linear fog) so the model's materials reuse the
// arena's shader programs instead of compiling a second set just for a picture.
import * as THREE from 'three';

/**
 * Renders `object` (temporarily moved into a scene of its own) and returns a PNG data URL with a
 * transparent background. o: { w, h, fov, frame(object) -> { eye, target } (Vector3s, called after the move) }.
 */
export function renderPortrait(renderer, object, shadows, o) {
  const rt = new THREE.WebGLRenderTarget(o.w, o.h, { colorSpace: THREE.SRGBColorSpace });
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xffffff, 1000, 2000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x886644, 2.2));
  const parent = object.parent;
  scene.add(object);
  object.updateMatrixWorld(true);
  const { eye, target } = o.frame(object);
  const l = new THREE.DirectionalLight(0xffffff, 2.5);
  l.position.copy(target).add(new THREE.Vector3(1, 2, 3));
  l.target.position.copy(target);
  l.castShadow = true;
  l.shadow.mapSize.set(64, 64);
  scene.add(l, l.target);
  const cam = new THREE.PerspectiveCamera(o.fov, o.w / o.h, 0.05, 20);
  cam.position.copy(eye);
  cam.lookAt(target);
  const prevT = renderer.getRenderTarget();
  const prevC = renderer.getClearColor(new THREE.Color()), prevA = renderer.getClearAlpha();
  let url = '';
  try {
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    // the shadow cache owns the shadow maps: arm it for this scene first (see ShadowCache)
    shadows?.arm(scene, []);
    renderer.render(scene, cam);
    const px = new Uint8Array(o.w * o.h * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, o.w, o.h, px);
    const c = document.createElement('canvas');
    c.width = o.w;
    c.height = o.h;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(o.w, o.h);
    // render targets are bottom-up
    for (let y = 0; y < o.h; y++) img.data.set(px.subarray((o.h - 1 - y) * o.w * 4, (o.h - y) * o.w * 4), y * o.w * 4);
    ctx.putImageData(img, 0, 0);
    url = c.toDataURL();
  } finally {
    renderer.setRenderTarget(prevT);
    renderer.setClearColor(prevC, prevA);
    l.shadow.map?.dispose();
    rt.dispose();
    if (parent) parent.add(object);
    else scene.remove(object);
  }
  return url;
}
