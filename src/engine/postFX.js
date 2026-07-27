// =============================================================================
// postFX.js — Post pipeline that runs on the FRAMEBUFFER, not on a scene RT.
//
// Why: the scene is rendered (4 CAVE viewports) DIRECTLY to the screen, where
// SpotLight illumination is guaranteed correct on every driver. We then COPY
// the framebuffer into a texture and post-process that copy (bloom threshold +
// separable blur, then composite: bloom add → vignette → chromatic aberration →
// film grain → scare tint). Only full-screen texture→texture passes touch an
// FBO — no lit geometry ever renders to an RT — so this is portable and cheap.
// Tone mapping (ACES) is done by the renderer during the direct scene pass.
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';

const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

class FullScreen {
  constructor(material) {
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.mesh);
    this.cam = new THREE.Camera();
  }
  render(renderer, target) { renderer.setRenderTarget(target || null); renderer.render(this.scene, this.cam); }
}

function ldrRT(w, h) {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.UnsignedByteType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: false, stencilBuffer: false, colorSpace: THREE.NoColorSpace,
  });
}

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    this._zero = new THREE.Vector2(0, 0);
    this._makeTargets();

    const b = CONFIG.render.bloom;
    this.bright = new FullScreen(new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uThreshold: { value: b.threshold } },
      vertexShader: VERT,
      fragmentShader: `precision highp float; varying vec2 vUv; uniform sampler2D tSrc; uniform float uThreshold;
        void main(){ vec3 c = texture2D(tSrc, vUv).rgb; float l = dot(c, vec3(0.2126,0.7152,0.0722));
          float k = smoothstep(uThreshold, uThreshold+0.25, l); gl_FragColor = vec4(c * k, 1.0); }`,
    }));
    const blurFS = (dir) => new FullScreen(new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uDir: { value: dir }, uRadius: { value: b.radius } },
      vertexShader: VERT,
      fragmentShader: `precision highp float; varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uTexel,uDir; uniform float uRadius;
        void main(){ vec2 o = uTexel*uDir*uRadius*2.0; vec3 s = vec3(0.0);
          float w[5]; w[0]=0.227027; w[1]=0.194595; w[2]=0.121622; w[3]=0.054054; w[4]=0.016216;
          s += texture2D(tSrc,vUv).rgb*w[0];
          for(int i=1;i<5;i++){ s += texture2D(tSrc, vUv+o*float(i)).rgb*w[i]; s += texture2D(tSrc, vUv-o*float(i)).rgb*w[i]; }
          gl_FragColor = vec4(s,1.0); }`,
    }));
    this.blurH = blurFS(new THREE.Vector2(1, 0));
    this.blurV = blurFS(new THREE.Vector2(0, 1));

    this.composite = new FullScreen(new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: null }, tBloom: { value: null }, uTime: { value: 0 },
        uBloom: { value: b.strength }, uGrain: { value: CONFIG.render.grain },
        uVignette: { value: CONFIG.render.vignette }, uAberr: { value: CONFIG.render.aberration },
        uScare: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: `precision highp float; varying vec2 vUv;
        uniform sampler2D tScene, tBloom; uniform float uTime,uBloom,uGrain,uVignette,uAberr,uScare;
        float hash(vec2 p){ p=fract(p*vec2(443.897,441.423)); p+=dot(p,p+19.19); return fract(p.x*p.y); }
        void main(){
          vec2 uv = vUv; vec2 d = uv - 0.5;
          float ab = uAberr * (1.0 + uScare*5.0);
          vec3 col;
          col.r = texture2D(tScene, uv + d*ab).r;
          col.g = texture2D(tScene, uv).g;
          col.b = texture2D(tScene, uv - d*ab).b;
          col += texture2D(tBloom, uv).rgb * uBloom;
          float vig = smoothstep(1.2, 0.28, length(d*vec2(1.0,1.35)) * uVignette);
          col *= mix(0.32, 1.0, vig);
          float g = hash(uv*vec2(1920.0,1080.0) + fract(uTime)*97.0) - 0.5;
          col += g * uGrain * (1.0 - 0.55*dot(col,vec3(0.33)));
          if(uScare>0.001){ float l=dot(col,vec3(0.33)); col=mix(col, vec3(l)*vec3(1.5,0.42,0.42), uScare*0.6); }
          gl_FragColor = vec4(clamp(col,0.0,1.0), 1.0);
        }`,
    }));
  }

  _size() { const v = new THREE.Vector2(); this.renderer.getDrawingBufferSize(v); return { w: Math.max(2, v.x), h: Math.max(2, v.y) }; }

  _makeTargets() {
    const { w, h } = this._size();
    this._w = w; this._h = h;
    this.sceneTex = new THREE.FramebufferTexture(w, h);
    this.sceneTex.minFilter = THREE.LinearFilter; this.sceneTex.magFilter = THREE.LinearFilter;
    this.sceneTex.colorSpace = THREE.NoColorSpace;
    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
    this.bloomA = ldrRT(hw, hh); this.bloomB = ldrRT(hw, hh);
    this._hw = hw; this._hh = hh;
  }

  setSize() {
    const { w, h } = this._size();
    if (w === this._w && h === this._h) return;
    this.sceneTex.dispose(); this.bloomA.dispose(); this.bloomB.dispose();
    this._makeTargets();
  }

  // Call AFTER the scene has been rendered directly to the screen.
  process(t, scare = 0) {
    const r = this.renderer;
    r.copyFramebufferToTexture(this._zero, this.sceneTex);   // screen → texture

    this.blurH.mesh.material.uniforms.uTexel.value.set(1 / this._hw, 1 / this._hh);
    this.blurV.mesh.material.uniforms.uTexel.value.set(1 / this._hw, 1 / this._hh);
    this.bright.mesh.material.uniforms.tSrc.value = this.sceneTex; this.bright.render(r, this.bloomA);
    this.blurH.mesh.material.uniforms.tSrc.value = this.bloomA.texture; this.blurH.render(r, this.bloomB);
    this.blurV.mesh.material.uniforms.tSrc.value = this.bloomB.texture; this.blurV.render(r, this.bloomA);

    const u = this.composite.mesh.material.uniforms;
    u.tScene.value = this.sceneTex; u.tBloom.value = this.bloomA.texture;
    u.uTime.value = t; u.uScare.value = scare;
    r.autoClear = true;
    this.composite.render(r, null);
  }
}
