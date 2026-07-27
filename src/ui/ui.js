// =============================================================================
// ui.js — All DOM overlays, drawn above the WebGL strip.
//   • Menu + HUD live ONLY over the FRONT panel (left 25%..50% of the strip) so
//     the side/floor screens stay pure black and immersive.
//   • The jumpscare + win/lose screens cover the WHOLE strip.
// In single-projector mode (?surface=) the front panel fills the screen and
// non-front surfaces show no UI at all.
// =============================================================================

const SVGNS = 'http://www.w3.org/2000/svg';

export class UI {
  constructor() {
    this.root = document.getElementById('ui');
    this.surface = new URLSearchParams(location.search).get('surface');
    this.showOnThis = !this.surface || this.surface === 'front';
    this._injectStyle();
    this._build();
  }

  _frontVars() {
    // front panel occupies [25%,50%] of the strip; full screen in solo-front.
    if (this.surface === 'front') return { fx: '0', fw: '100vw' };
    return { fx: '25vw', fw: '25vw' };
  }

  _injectStyle() {
    const { fx, fw } = this._frontVars();
    const s = document.createElement('style');
    s.textContent = `
    #ui .front{ position:absolute; top:0; left:${fx}; width:${fw}; height:100vh; overflow:hidden;
      font-family:"Segoe UI",system-ui,sans-serif; }
    #ui .full{ position:absolute; inset:0; }
    .vg{ position:absolute; inset:0; pointer-events:none; background:radial-gradient(120% 90% at 50% 42%, transparent 40%, rgba(0,0,0,.85) 100%); }
    /* ---- Menu ---- */
    .menu{ position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center;
      background:radial-gradient(80% 60% at 50% 40%, #0b0d12 0%, #030304 70%, #000 100%); color:#c9cdd6;
      opacity:0; transition:opacity 1.2s ease; pointer-events:none; }
    .menu.on{ opacity:1; pointer-events:auto; }
    .fog{ position:absolute; inset:-20%; opacity:.5; pointer-events:none; mix-blend-mode:screen;
      background:radial-gradient(40% 30% at 30% 60%, rgba(60,70,90,.25), transparent 60%),
                 radial-gradient(50% 40% at 70% 40%, rgba(40,50,70,.22), transparent 60%);
      animation:drift 26s ease-in-out infinite alternate; filter:blur(6px); }
    @keyframes drift{ from{transform:translate(-4%, -2%) scale(1.05);} to{transform:translate(5%, 3%) scale(1.15);} }
    .title{ position:relative; font-weight:900; letter-spacing:.22em; font-size:clamp(26px,4.5vw,58px);
      color:#e7e9ee; text-shadow:0 0 18px rgba(140,30,30,.55), 0 0 3px #000; animation:flick 5s infinite; }
    @keyframes flick{ 0%,97%,100%{opacity:1;} 97.5%{opacity:.25;} 98%{opacity:.9;} 98.5%{opacity:.3;} }
    .sub{ margin-top:10px; letter-spacing:.5em; font-size:12px; color:#7d8290; text-transform:uppercase; }
    .nights{ display:flex; gap:8px; margin-top:26px; }
    .nights button{ font:inherit; color:#aeb3bd; background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.14);
      width:38px; height:38px; border-radius:9px; cursor:pointer; font-weight:700; transition:.15s; }
    .nights button.sel, .nights button:hover{ border-color:#b23; color:#fff; background:rgba(160,30,30,.22); }
    .enter{ margin-top:30px; font:inherit; font-weight:800; letter-spacing:.28em; text-transform:uppercase; font-size:14px;
      color:#e9e9ee; background:linear-gradient(180deg,rgba(150,30,30,.35),rgba(60,10,10,.35)); cursor:pointer;
      border:1px solid rgba(190,60,60,.5); padding:14px 34px; border-radius:10px; animation:pulse 2.2s infinite; }
    .enter:hover{ background:linear-gradient(180deg,rgba(190,40,40,.55),rgba(80,12,12,.55)); }
    @keyframes pulse{ 0%,100%{box-shadow:0 0 0 0 rgba(180,40,40,.0);} 50%{box-shadow:0 0 26px 2px rgba(180,40,40,.35);} }
    .hint{ margin-top:22px; font-size:11px; color:#5b606b; letter-spacing:.12em; text-align:center; line-height:1.7; max-width:80%; }
    /* ---- HUD ---- */
    .hud{ position:absolute; top:6%; left:0; width:100%; display:flex; flex-direction:column; align-items:center;
      gap:8px; opacity:0; transition:opacity .6s; }
    .hud.on{ opacity:1; }
    .hud .night{ letter-spacing:.4em; font-size:12px; color:#9aa0ac; text-transform:uppercase; }
    .hud .bar{ width:56%; height:4px; background:rgba(255,255,255,.08); border-radius:3px; overflow:hidden; }
    .hud .bar > i{ display:block; height:100%; width:100%; background:linear-gradient(90deg,#4a5, #7d5); transition:width .3s linear; }
    .hud .batt{ display:flex; align-items:center; gap:6px; font-size:10px; letter-spacing:.2em; color:#8a8f9a; }
    .hud .batt b{ display:inline-block; width:44px; height:8px; border:1px solid #555; border-radius:2px; position:relative; }
    .hud .batt b > i{ position:absolute; inset:1px; width:100%; background:#7d5; transform-origin:left; }
    .redpulse{ position:absolute; inset:0; pointer-events:none; box-shadow:inset 0 0 120px 20px rgba(150,0,0,0); transition:box-shadow .2s; }
    /* ---- Scare / end ---- */
    .flash{ position:absolute; inset:0; background:#fff; opacity:0; pointer-events:none; }
    .scare{ position:absolute; inset:0; display:none; align-items:center; justify-content:center; background:#000; }
    .scare.on{ display:flex; }
    .shake{ animation:shake .07s infinite; }
    @keyframes shake{ 0%{transform:translate(-6px,4px) scale(1.06);} 50%{transform:translate(7px,-5px) scale(1.09);} 100%{transform:translate(-5px,-3px) scale(1.05);} }
    .endcard{ position:absolute; inset:0; display:none; flex-direction:column; align-items:center; justify-content:center;
      background:radial-gradient(60% 60% at 50% 45%, #0a0405 0%, #000 80%); color:#d9d2d2; }
    .endcard.on{ display:flex; }
    .endcard h2{ font-weight:900; letter-spacing:.18em; font-size:clamp(22px,3.4vw,40px); text-shadow:0 0 16px rgba(150,20,20,.5); }
    .endcard p{ margin-top:10px; color:#8a8f9a; letter-spacing:.28em; font-size:12px; text-transform:uppercase; }
    .endcard button{ margin-top:26px; font:inherit; font-weight:800; letter-spacing:.24em; text-transform:uppercase; font-size:13px;
      color:#eee; background:rgba(150,30,30,.28); border:1px solid rgba(190,60,60,.5); padding:12px 28px; border-radius:9px; cursor:pointer; }
    `;
    document.head.appendChild(s);
  }

  _build() {
    if (!this.showOnThis) { this.root.style.display = 'none'; return; }
    const front = document.createElement('div'); front.className = 'front'; this.root.appendChild(front);
    const full = document.createElement('div'); full.className = 'full'; this.root.appendChild(full);
    this.front = front; this.full = full;

    // Menu
    this.selNight = 1;
    const menu = document.createElement('div'); menu.className = 'menu';
    menu.innerHTML = `
      <div class="fog"></div>
      <div class="title">VIGILIA</div>
      <div class="sub">El Turno de Noche</div>
      <div class="nights"></div>
      <button class="enter">Entrar</button>
      <div class="hint">Solo tienes una linterna. Muévela con el ratón.<br>Escucha de dónde viene el sonido e ilumínalo antes de que llegue.<br>Sobrevive hasta el amanecer.</div>
      <div class="vg"></div>`;
    front.appendChild(menu); this.menu = menu;
    const nights = menu.querySelector('.nights');
    for (let n = 1; n <= 5; n++) {
      const b = document.createElement('button'); b.textContent = n; if (n === 1) b.classList.add('sel');
      b.onclick = () => { this.selNight = n; nights.querySelectorAll('button').forEach((x) => x.classList.remove('sel')); b.classList.add('sel'); };
      nights.appendChild(b);
    }
    menu.querySelector('.enter').onclick = () => this._onStart && this._onStart(this.selNight);

    // HUD
    const hud = document.createElement('div'); hud.className = 'hud';
    hud.innerHTML = `<div class="night">Noche 1</div>
      <div class="bar"><i></i></div>
      <div class="batt">Linterna <b><i></i></b></div>`;
    front.appendChild(hud); this.hud = hud;
    this.hudNight = hud.querySelector('.night');
    this.hudBar = hud.querySelector('.bar > i');
    this.hudBatt = hud.querySelector('.batt b > i');
    this.redpulse = document.createElement('div'); this.redpulse.className = 'redpulse'; full.appendChild(this.redpulse);

    // Scare + flash + end (full strip)
    this.flash = document.createElement('div'); this.flash.className = 'flash'; full.appendChild(this.flash);
    this.scare = document.createElement('div'); this.scare.className = 'scare'; full.appendChild(this.scare);
    this.endcard = document.createElement('div'); this.endcard.className = 'endcard';
    this.endcard.innerHTML = `<h2></h2><p></p><button>Reintentar</button>`;
    full.appendChild(this.endcard);
    this.endcard.querySelector('button').onclick = () => { this.hideEnd(); this.showMenu(this._onStart); };
  }

  onStart(cb) { this._onStart = cb; }

  showMenu(onStart) { if (!this.showOnThis) return; this._onStart = onStart; this.menu.classList.add('on'); this.hud.classList.remove('on'); }
  hideMenu() { if (this.menu) this.menu.classList.remove('on'); }
  showHud() { if (this.hud) this.hud.classList.add('on'); }
  hideHud() { if (this.hud) this.hud.classList.remove('on'); }

  setHud({ night, timeFrac, battery, tension }) {
    if (!this.showOnThis) return;
    if (this.hudNight) this.hudNight.textContent = 'Noche ' + night;
    if (this.hudBar) { this.hudBar.style.width = Math.max(0, timeFrac * 100) + '%'; }
    if (this.hudBatt) { this.hudBatt.style.transform = `scaleX(${Math.max(0, battery / 100)})`; this.hudBatt.style.background = battery < 25 ? '#c33' : '#7d5'; }
    if (this.redpulse) this.redpulse.style.boxShadow = `inset 0 0 120px 20px rgba(150,0,0,${(tension || 0) * 0.5})`;
  }

  // Full-strip jumpscare: white flash → shaking creature face → callback.
  showScare(eyeColor, onDone) {
    if (!this.showOnThis) { setTimeout(() => onDone && onDone(), 1200); return; }
    this.hideHud();
    this.flash.style.transition = 'none'; this.flash.style.opacity = '1';
    requestAnimationFrame(() => { this.flash.style.transition = 'opacity .5s'; this.flash.style.opacity = '0'; });
    this.scare.innerHTML = ''; this.scare.classList.add('on');
    const face = this._faceSVG(eyeColor); face.classList.add('shake'); this.scare.appendChild(face);
    setTimeout(() => { this.scare.classList.remove('on'); this.scare.innerHTML = ''; onDone && onDone(); }, 1150);
  }

  _faceSVG(eyeColor) {
    const hex = '#' + (eyeColor >>> 0).toString(16).padStart(6, '0').slice(-6);
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 400 400');
    svg.setAttribute('width', '78%'); svg.setAttribute('height', '78%');
    svg.innerHTML = `
      <defs>
        <radialGradient id="g" cx="50%" cy="42%" r="60%">
          <stop offset="0%" stop-color="#111"/><stop offset="70%" stop-color="#050505"/><stop offset="100%" stop-color="#000"/>
        </radialGradient>
        <filter id="gl"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      <ellipse cx="200" cy="200" rx="150" ry="185" fill="url(#g)"/>
      <g filter="url(#gl)" fill="${hex}">
        <ellipse cx="150" cy="165" rx="26" ry="34"/><ellipse cx="250" cy="165" rx="26" ry="34"/>
      </g>
      <ellipse cx="150" cy="168" rx="9" ry="15" fill="#000"/><ellipse cx="250" cy="168" rx="9" ry="15" fill="#000"/>
      <path d="M120 275 Q140 250 160 278 Q180 250 200 280 Q220 250 240 278 Q260 250 280 276
               L280 300 Q200 350 120 300 Z" fill="#0a0a0a" stroke="${hex}" stroke-width="2"/>
      <g fill="#d8d2c8">
        <path d="M140 282 l10 20 l10 -20z"/><path d="M170 286 l10 22 l10 -22z"/>
        <path d="M200 288 l10 22 l10 -22z"/><path d="M230 286 l10 22 l10 -22z"/>
      </g>`;
    return svg;
  }

  showEnd(win, night, onRetry) {
    if (!this.showOnThis) return;
    this.endcard.querySelector('h2').textContent = win ? 'HAS SOBREVIVIDO' : 'TE ATRAPÓ';
    this.endcard.querySelector('p').textContent = win ? `Amanece · Noche ${night} superada` : `No llegaste al amanecer · Noche ${night}`;
    this.endcard.querySelector('button').textContent = win ? 'Siguiente noche' : 'Reintentar';
    this.endcard.classList.add('on');
    this._retry = onRetry;
    this.endcard.querySelector('button').onclick = () => { this.hideEnd(); onRetry && onRetry(win); };
  }
  hideEnd() { if (this.endcard) this.endcard.classList.remove('on'); }
}
