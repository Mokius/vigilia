// =============================================================================
// flashlight.js — The only real light in the room, and the player's cursor.
//   • THREE.SpotLight with high-res shadows and physical falloff/penumbra.
//   • A custom additive "volumetric" beam cone (soft radial + axial falloff,
//     animated dust noise) that is depth-tested so it terminates on surfaces.
//   • GPU dust motes that only glow when the beam passes through them.
//   • Battery flicker when the aim is driven low / battery drains.
// The aim is a world direction; the CAVE cameras make it land seamlessly on
// whichever screen(s) see it — so the "cursor" wraps across panels for free.
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { clamp } from '../core/util.js';

const NOISE_GLSL = `
float hash(vec3 p){ p=fract(p*0.3183099+vec3(0.1,0.2,0.3)); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){ vec3 i=floor(x),f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),
                 mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
                 mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
`;

export class Flashlight {
  constructor(scene) {
    const cfg = CONFIG.flashlight;
    this.eye = new THREE.Vector3().fromArray(CONFIG.room.eye);
    this.dir = new THREE.Vector3(0, -0.1, -1).normalize();   // current aim
    this.targetDir = this.dir.clone();                        // desired aim
    this.on = true;
    this.battery = 100;
    this.drainEnabled = false;   // set true only while a night is being played
    this._flick = 1;

    // ---- Spotlight ----
    const spot = new THREE.SpotLight(cfg.color, cfg.intensity, cfg.distance, cfg.angle, cfg.penumbra, cfg.decay);
    spot.position.copy(this.eye);
    spot.castShadow = true;
    spot.shadow.mapSize.set(CONFIG.render.shadowMapSize, CONFIG.render.shadowMapSize);
    spot.shadow.camera.near = 0.1;
    spot.shadow.camera.far = cfg.distance;
    spot.shadow.bias = -0.0008;
    spot.shadow.radius = 3;
    spot.shadow.focus = 1;
    this.spot = spot;
    this.target = spot.target;
    scene.add(spot);
    scene.add(spot.target);

    // ---- Volumetric beam cone ----
    const len = 6.0;
    const radius = Math.tan(cfg.angle) * len;
    const geo = new THREE.ConeGeometry(radius, len, 40, 1, true);
    geo.translate(0, -len / 2, 0);       // apex at origin
    geo.rotateX(Math.PI / 2);            // beam points -Z, apex at origin
    this.beamMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: {
        uColor: { value: new THREE.Color(cfg.color) },
        uTime: { value: 0 }, uIntensity: { value: 1 },
        uLen: { value: len }, uRadius: { value: radius },
      },
      vertexShader: `
        varying vec3 vPos;
        void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        precision highp float; varying vec3 vPos;
        uniform vec3 uColor; uniform float uTime, uIntensity, uLen, uRadius;
        ${NOISE_GLSL}
        void main(){
          float t = clamp(-vPos.z / uLen, 0.0, 1.0);          // 0 apex → 1 base
          float rMax = uRadius * t + 1e-3;
          float r = length(vPos.xy) / rMax;                    // 0 axis → 1 edge
          // A real reflector is not a flat disc: a hot core, a softer corona,
          // and faint concentric/lobed irregularities from the optic.
          float rr = clamp(r, 0.0, 1.0);
          float core   = pow(1.0 - rr, 5.0) * 1.35;        // bright centre
          float corona = pow(1.0 - rr, 1.7) * 0.55;        // gradual outer fall
          float lobes  = 0.06 * sin(atan(vPos.y, vPos.x) * 3.0 + 1.7) * (1.0 - rr);
          float rings  = 0.05 * sin(rr * 22.0);            // reflector steps
          float radial = max(0.0, core + corona + lobes + rings);
          // Ramp the beam in slowly: at full density from the lens it saturates
          // anything you stand close to (the menu console) and reads as a white
          // blob. Real beams only become visible after some travel.
          float axial  = smoothstep(0.0,0.30,t) * (1.0 - smoothstep(0.45,1.0,t));
          float n = vnoise(vPos*3.0 + vec3(0.0,0.0,uTime*0.6));
          n = 0.55 + 0.55*n;
          float a = radial * axial * n * 0.24 * uIntensity;
          gl_FragColor = vec4(uColor * a, a);
        }`,
    });
    this.beam = new THREE.Mesh(geo, this.beamMat);
    this.beam.position.copy(this.eye);
    this.beam.frustumCulled = false;
    scene.add(this.beam);

    // ---- Dust motes that light up inside the beam ----
    this._buildDust(scene, len, radius);

    this._q = new THREE.Quaternion();
    this._m = new THREE.Matrix4();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  _buildDust(scene, len, radius) {
    const n = CONFIG.atmos.dustCount;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    const w = CONFIG.room.W / 2, d = CONFIG.room.D / 2, h = CONFIG.room.H;
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() * 2 - 1) * w;
      pos[i * 3 + 1] = Math.random() * h;
      pos[i * 3 + 2] = (Math.random() * 2 - 1) * d;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.dustMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: new THREE.Color(CONFIG.flashlight.color) },
        uTime: { value: 0 }, uIntensity: { value: 1 },
        uOrigin: { value: this.eye.clone() }, uDir: { value: this.dir.clone() },
        uCos: { value: Math.cos(CONFIG.flashlight.angle) }, uLen: { value: len },
        uSize: { value: 16 * (window.devicePixelRatio || 1) }, uH: { value: h },
      },
      vertexShader: `
        attribute float aSeed; varying float vBright;
        uniform vec3 uOrigin, uDir; uniform float uTime, uCos, uLen, uSize, uH, uIntensity;
        void main(){
          vec3 p = position;
          p.y = mod(p.y - uTime*0.03*(0.5+aSeed) , uH);       // slow fall
          p.x += 0.05*sin(uTime*0.3 + aSeed*6.28);
          vec3 v = p - uOrigin; float dist = length(v);
          float cang = dot(normalize(v), uDir);
          float inCone = smoothstep(uCos, uCos+0.05, cang);
          float inLen = 1.0 - smoothstep(uLen*0.35, uLen, dist);
          float near = smoothstep(0.55, 1.5, dist);   // don't let motes at the lens bloom huge
          vBright = inCone * inLen * near * uIntensity * (0.22+0.4*aSeed);
          vec4 mv = modelViewMatrix * vec4(p,1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = min(16.0, uSize * (1.0/-mv.z) * (0.5+0.7*aSeed));
        }`,
      fragmentShader: `
        precision mediump float; varying float vBright; uniform vec3 uColor;
        void main(){
          vec2 uv = gl_PointCoord - 0.5; float d = length(uv);
          float a = smoothstep(0.5,0.0,d) * vBright;
          if(a<0.003) discard;
          gl_FragColor = vec4(uColor*a, a);
        }`,
    });
    this.dust = new THREE.Points(geo, this.dustMat);
    this.dust.frustumCulled = false;
    scene.add(this.dust);
  }

  setAimDir(dir) { this.targetDir.copy(dir).normalize(); }

  recharge(amt) { this.battery = clamp(this.battery + amt, 0, 100); }

  /**
   * Force the lamp to stutter for a moment, independently of charge.
   * Used as cover: a creature leaving asks for this so its removal happens
   * behind a genuine loss of light rather than behind a fade.
   */
  stutter(seconds) { this._stutterT = Math.max(this._stutterT || 0, seconds); }

  /**
   * Angle (radians) between the beam axis and a world point. The lit cone is
   * deliberately wide (~23°), which is far too coarse to pick between small
   * controls sitting side by side — so precise targeting uses this instead.
   */
  aimAngle(worldPos) {
    const v = worldPos.clone().sub(this.eye);
    if (v.lengthSq() < 1e-9) return 0;
    return Math.acos(clamp(v.normalize().dot(this.dir), -1, 1));
  }

  // Angle test used by the AI: is a world point currently lit by the beam?
  litAmount(worldPos) {
    return this.on ? this.coverage(worldPos) * this._flick : 0;
  }

  /**
   * Purely GEOMETRIC beam coverage of a world point: is it inside the cone and
   * within reach? Deliberately independent of `on`, of the battery and of the
   * flicker.
   *
   * The pickups used litAmount() as their targeting test, which meant that once
   * the battery hit exactly 0 the flicker clamped to 0, coverage read as 0, no
   * cell could ever be selected and the night became unwinnable — the player was
   * left blind with no way to recover. Aiming is a DIRECTION, not a light: it
   * has to keep working with a dead lamp, and the cells have their own indicator
   * so they stay findable in the dark.
   */
  coverage(worldPos) {
    const v = worldPos.clone().sub(this.eye);
    const dist = v.length();
    v.normalize();
    const cang = v.dot(this.dir);
    const cone = clamp((cang - Math.cos(CONFIG.flashlight.angle * 1.05)) / 0.05, 0, 1);
    const reach = 1 - clamp((dist - CONFIG.flashlight.distance) / 2, 0, 1);
    return cone * reach;
  }

  update(dt, t) {
    const cfg = CONFIG.flashlight;
    // Smooth aim toward target.
    this.dir.lerp(this.targetDir, clamp(cfg.smoothing * dt * 60, 0, 1)).normalize();

    // Battery drain + flicker.
    // Only a running night consumes power. In the menu / end screens the lamp
    // is effectively on mains: nothing about the game should tick there.
    if (cfg.battery.enabled && this.on && this.drainEnabled) {
      this.battery = clamp(this.battery - cfg.battery.drainPerSec * dt, 0, 100);
    }
    let flick = 1;
    if (this._stutterT > 0) {
      this._stutterT -= dt;
      flick = Math.random() < 0.55 ? 0.06 + Math.random() * 0.12 : 0.85;
    } else if (this.battery <= 0) { flick = 0; }
    else if (this.battery < cfg.battery.flickerBelow) {
      flick = Math.random() < 0.08 ? 0.15 + Math.random() * 0.3 : 1;
    }
    this._flick += (flick - this._flick) * 0.5;

    // Point the spotlight + beam.
    const aim = this.eye.clone().add(this.dir);
    this.target.position.copy(aim);
    this.spot.intensity = (this.on ? cfg.intensity : 0) * this._flick;

    // Orient the beam mesh: local -Z → dir.
    this._m.lookAt(this.eye, aim, this._up);
    this._q.setFromRotationMatrix(this._m);
    this.beam.quaternion.copy(this._q);
    this.beamMat.uniforms.uTime.value = t;
    this.beamMat.uniforms.uIntensity.value = (this.on ? 1 : 0) * this._flick;

    // Dust uniforms.
    const du = this.dustMat.uniforms;
    du.uTime.value = t; du.uDir.value.copy(this.dir);
    du.uIntensity.value = (this.on ? 1 : 0) * this._flick;
  }
}
