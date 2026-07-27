// =============================================================================
// main.js — Bootstrap & frame loop. Builds the renderer, CAVE rig, world,
// flashlight, post-FX, audio, UI and the Game Manager, then drives the loop.
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
import { UI } from './ui/ui.js';
import { Game } from './systems/game.js';

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
  // The scene is rendered directly to the screen (SpotLight illumination is
  // reliable there on every driver); post runs on a copy of the framebuffer.
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = CONFIG.render.exposure;
  r.outputColorSpace = THREE.SRGBColorSpace;
  return r;
}

function start() {
  const canvas = document.getElementById('app');
  const usePost = CONFIG.render.post;
  const renderer = makeRenderer(canvas);
  setBoot(0.25);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.FogExp2(CONFIG.atmos.fogColor, CONFIG.atmos.fogDensity);
  scene.add(new THREE.AmbientLight(CONFIG.atmos.ambient, CONFIG.atmos.ambientIntensity));

  const rig = new CaveRig();
  const room = new Room(); scene.add(room.group);
  setBoot(0.55);
  const flashlight = new Flashlight(scene);
  const input = new Input(canvas, rig);
  const post = usePost ? new PostFX(renderer) : null;
  setBoot(0.75);

  const bus = new EventBus();
  const audio = new AudioBus();
  const ui = new UI();
  const eye = new THREE.Vector3().fromArray(CONFIG.room.eye);

  // Custom flashlight reticle — the cursor is hidden, so this warm glow is the
  // pointer in the menu / end screens (left→left, centre→centre, right→right)
  // and previews the flashlight. It hides once pointer-lock takes over in play.
  const reticle = document.createElement('div');
  reticle.style.cssText = 'position:fixed;left:50%;top:50%;width:58px;height:58px;z-index:40;'
    + 'pointer-events:none;transform:translate(-50%,-50%);opacity:0;transition:opacity .25s;mix-blend-mode:screen;'
    + 'background:radial-gradient(circle,rgba(255,238,205,.85) 0%,rgba(255,224,175,.32) 26%,rgba(255,220,170,0) 60%);';
  reticle.innerHTML = '<div style="position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;'
    + 'border-radius:50%;background:#fff6e8;box-shadow:0 0 10px 3px rgba(255,236,205,.9);"></div>';
  document.body.appendChild(reticle);

  const game = new Game({
    scene, room, flashlight, eye, bus, audio, ui,
    onPointerLock: () => { input.enabled = true; input.allowLock = true; if (!ui.surface && canvas.requestPointerLock) canvas.requestPointerLock(); },
    onPointerUnlock: () => { input.allowLock = false; if (document.exitPointerLock) document.exitPointerLock(); },
  });
  game.init();
  setBoot(1);

  window.addEventListener('resize', () => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.render.maxPixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (post) post.setSize();
  });

  // Stuttering fluorescent: mostly dark, sudden buzzing flashes that briefly
  // reveal the room. Bursts of rapid flicker, then long darkness.
  let fluoT = 0, fluoLevel = 0;
  function flicker(dt) {
    fluoT -= dt;
    if (fluoT <= 0) {
      if (Math.random() < 0.5) { fluoLevel = 20 + Math.random() * 22; fluoT = 0.03 + Math.random() * 0.1; }
      else { fluoLevel = 0; fluoT = 0.7 + Math.random() * 3.2; }
    }
    const L = room.lights;
    if (L && L.fluo) { L.fluo.intensity += (fluoLevel - L.fluo.intensity) * Math.min(1, dt * 30); L.fluoMesh.material.color.setScalar(0.03 + Math.min(0.5, L.fluo.intensity * 0.22)); }
  }

  window.__vig = { renderer, scene, rig, room, flashlight, input, post, game, audio, bus, THREE };

  let last = performance.now();
  function loop(now) {
    const t = now / 1000;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;

    const dir = input.update();
    flashlight.setAimDir(dir);
    flashlight.update(dt, t);
    flicker(dt);
    game.update(dt);        // sets vent/hatch targets, battery logic
    room.update(dt, t);     // animates vent/hatch/doors + battery-cell glow

    // Reticle follows the pointer while not locked (menu / end); hidden in play.
    reticle.style.left = input.px + 'px';
    reticle.style.top = input.py + 'px';
    reticle.style.opacity = (!input.locked && game.state !== 'scare') ? '1' : '0';

    renderer.shadowMap.needsUpdate = true;
    rig.render(renderer, scene, null);          // 4 CAVE viewports → screen
    if (post) post.process(t, game.scareFX);    // bloom/grain/vignette on the copy

    requestAnimationFrame(loop);
  }
  if (boot) { boot.style.transition = 'opacity .6s'; boot.style.opacity = '0'; setTimeout(() => boot.remove(), 700); }
  requestAnimationFrame(loop);
}

start();
