// =============================================================================
// main.js — Bootstrap & frame loop.
// Renders the 4 CAVE viewports DIRECTLY to the screen (SpotLight illumination is
// only reliable there), then post-processes a copy of the framebuffer.
// No DOM UI: the menu is the in-world CRT console, the timer is the wall clock,
// the battery gauge is the beam itself.
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { CaveRig } from './engine/caveRig.js';
import { PostFX } from './engine/postFX.js';
import { Room } from './world/room.js';
import { Flashlight } from './world/flashlight.js';
import { Input } from './input/input.js';
import { EventBus } from './core/events.js';
import { AudioBus } from './audio/audioBus.js';
import { CRTConsole } from './ui/crt.js';
import { Game, GState } from './systems/game.js';

const boot = document.getElementById('boot');
const bar = document.getElementById('bootbar');
const setBoot = (p) => { if (bar) bar.style.width = Math.round(p * 100) + '%'; };

function makeRenderer(canvas) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.render.maxPixelRatio));
  r.setSize(window.innerWidth, window.innerHeight);
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  r.shadowMap.autoUpdate = false;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = CONFIG.render.exposure;
  r.outputColorSpace = THREE.SRGBColorSpace;
  return r;
}

function start() {
  const canvas = document.getElementById('app');
  const renderer = makeRenderer(canvas);
  setBoot(0.2);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.FogExp2(CONFIG.atmos.fogColor, CONFIG.atmos.fogDensity);
  scene.add(new THREE.AmbientLight(CONFIG.atmos.ambient, CONFIG.atmos.ambientIntensity));

  const rig = new CaveRig();
  const room = new Room(); scene.add(room.group);
  setBoot(0.5);
  const flashlight = new Flashlight(scene);
  const input = new Input(canvas, rig);
  const post = CONFIG.render.post ? new PostFX(renderer) : null;
  const bus = new EventBus();
  const audio = new AudioBus();
  const crt = new CRTConsole(scene, room);
  const eye = new THREE.Vector3().fromArray(CONFIG.room.eye);
  setBoot(0.8);

  const soloSurface = new URLSearchParams(location.search).get('surface');
  const game = new Game({
    scene, room, flashlight, eye, bus, audio, crt,
    onPointerLock: () => { input.allowLock = true; if (!soloSurface && canvas.requestPointerLock) canvas.requestPointerLock(); },
    onPointerUnlock: () => { input.allowLock = false; if (document.exitPointerLock) document.exitPointerLock(); },
  });
  game.init();
  setBoot(1);

  // Manual light discipline: turning the flashlight OFF is how you save power.
  const toggle = () => { if (game.state === GState.PLAYING) flashlight.on = !flashlight.on; };
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'f' || k === ' ') { e.preventDefault(); toggle(); }
  });
  window.addEventListener('contextmenu', (e) => { e.preventDefault(); toggle(); });

  window.addEventListener('resize', () => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.render.maxPixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (post) post.setSize();
  });

  // A reticle so the beam is findable even before it hits anything. Drawn in
  // world space as a faint dot at the aim point would need a raycast; instead we
  // keep the flashlight itself as the cursor and only show a tiny glow when the
  // pointer is unlocked (menus), matching the "no HUD" rule in play.
  const reticle = document.createElement('div');
  reticle.style.cssText = 'position:fixed;left:50%;top:50%;width:54px;height:54px;z-index:40;'
    + 'pointer-events:none;transform:translate(-50%,-50%);opacity:0;transition:opacity .25s;mix-blend-mode:screen;'
    + 'background:radial-gradient(circle,rgba(255,238,205,.75) 0%,rgba(255,224,175,.26) 28%,rgba(255,220,170,0) 62%)';
  document.body.appendChild(reticle);

  // Stuttering fluorescent: long darkness, sudden buzzing reveals.
  let fluoT = 0, fluoLevel = 0;
  function flicker(dt) {
    fluoT -= dt;
    if (fluoT <= 0) {
      if (Math.random() < 0.5) { fluoLevel = 18 + Math.random() * 24; fluoT = 0.03 + Math.random() * 0.1; }
      else { fluoLevel = 0; fluoT = 0.8 + Math.random() * 3.4; }
    }
    const L = room.lights;
    if (L && L.fluo) {
      L.fluo.intensity += (fluoLevel - L.fluo.intensity) * Math.min(1, dt * 30);
      L.fluoMesh.material.color.setScalar(0.03 + Math.min(0.5, L.fluo.intensity * 0.02));
    }
  }

  window.__vig = { renderer, scene, rig, room, flashlight, input, post, game, audio, bus, crt, THREE };

  let last = performance.now();
  function loop(now) {
    const t = now / 1000;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;

    flashlight.setAimDir(input.update());
    flashlight.update(dt, t);
    flicker(dt);
    game.update(dt);
    game.tickScare(dt);
    room.update(dt);
    crt.update(dt);

    reticle.style.left = input.px + 'px';
    reticle.style.top = input.py + 'px';
    reticle.style.opacity = (!input.locked && game.state !== GState.SCARE) ? '1' : '0';

    renderer.shadowMap.needsUpdate = true;
    rig.render(renderer, scene, null);
    if (post) post.process(t, game.scareFX, game.shake);

    requestAnimationFrame(loop);
  }
  if (boot) { boot.style.transition = 'opacity .6s'; boot.style.opacity = '0'; setTimeout(() => boot.remove(), 700); }
  requestAnimationFrame(loop);
}

start();
