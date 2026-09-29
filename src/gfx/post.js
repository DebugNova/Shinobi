// The post stack (pmndrs postprocessing): scene -> half-float target -> [bloom, tone mapping, colour grade] -> SMAA.
// Tone mapping is Khronos PBR Neutral: it keeps saturated anime colours (filmic curves desaturate them). Bloom is
// selective by threshold: only HDR emissives (jutsu, sparks, lanterns) pass it; the sky and bright grass stay under.
import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode, SMAAEffect, SMAAPreset, BrightnessContrastEffect, HueSaturationEffect } from 'postprocessing';
import { OutlineEffect } from './outline.js';
import { HazeEffect } from './haze.js';
import { GenjutsuEffect } from './itachifx.js';
import { AmaterasuEffect } from './amaterasufx.js';

export class Post {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new BloomEffect({ luminanceThreshold: 1.05, luminanceSmoothing: 0.15, intensity: 0.9, mipmapBlur: true, radius: 0.7 });
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL });
    this.sat = new HueSaturationEffect({ saturation: 0.08 });
    this.bc = new BrightnessContrastEffect({ contrast: 0.04 });
    this.smaa = new SMAAEffect({ preset: SMAAPreset.HIGH });
    this.outline = new OutlineEffect();
    this.haze = new HazeEffect(); // heat shimmer over fire (High+; bends UVs, so it goes first)
    this.hazeOn = true;
    this.genjutsu = new GenjutsuEffect(); // Tsukuyomi's red-and-black world on its victim's screen (0 = off)
    this.amaterasu = new AmaterasuEffect(); // Amaterasu's cinematic: the negative world, the painted eyes, the black flames (0 = off)
    this.camera = camera;
    this.composer.addPass(new EffectPass(camera, this.haze, this.outline, this.bloom, this.tone, this.sat, this.bc, this.genjutsu, this.amaterasu));
    this.composer.addPass(new EffectPass(camera, this.smaa));
    this.grade = { bright: 0, sat: 0 };
    this.setSize(innerWidth, innerHeight);
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
  }

  render(dt) {
    // grade pulses, summed by whoever wants one this frame (a jutsu's flash, the meteor's darkening sky), then reset
    const G = this.grade;
    this.bc.brightness = G.bright;
    this.sat.saturation = 0.08 + G.sat;
    G.bright = 0;
    G.sat = 0;
    this.haze.apply(this.camera, dt, this.hazeOn);
    this.genjutsu.apply(dt);
    this.amaterasu.apply(dt);
    this.composer.render(dt);
  }
}
