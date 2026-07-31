// =============================================================================
// room.js — The night-watch control post, built to docs/FASE1_ESCENARIO.md §2.
// Every opening exists because a real building would need it, and each one is a
// creature's way in:
//   FRONT  corridor (with side doors + red exit backlight) + low air vent
//   LEFT   heavy door, ajar 32° -> the "slit"
//   RIGHT  smashed observation window with a sill to climb over
//   FLOOR  drainage hatch with a grate
// Plus the diegetic wall CLOCK (the night timer) and the shadow pockets S1..S6
// that creatures are allowed to occupy.
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { buildTextures } from './textures.js';
import { mulberry32 } from '../core/util.js';
import { addSignage, addServices, addDoorDetail, addBatteryGauge, updateBatteryGauge, paintedPlate, onFontsReady } from './detail.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

const V3 = THREE.Vector3;

/**
 * Clone a texture set at a given tiling, and optionally ROTATE and OFFSET it.
 *
 * Only four base maps exist (concrete, metal, rust, skin) and a dozen materials
 * draw on them, so the same blotches kept turning up on the pipes, the crates,
 * the door and the skirting — the eye recognises the pattern long before it
 * recognises the material. A per-family rotation and offset costs nothing and
 * decorrelates them: same source, no shared silhouette.
 */
function tiled(maps, rx, ry, rot = 0, ox = 0, oy = 0) {
  const o = {};
  for (const k of ['map', 'normalMap', 'roughnessMap']) {
    if (!maps[k]) continue;
    const t = maps[k].clone(); t.needsUpdate = true;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry);
    if (rot) { t.center.set(0.5, 0.5); t.rotation = rot; }
    if (ox || oy) t.offset.set(ox, oy);
    o[k] = t;
  }
  return o;
}

export class Room {
  constructor() {
    this.group = new THREE.Group();
    this.pickupSpots = [];
    this.alarmOverride = false;   // the jumpscare seizes the room lighting
    this._build();
  }

  _mat(maps, rx, ry, extra = {}) {
    // Each material gets its own rotation and offset off a shared counter, so no
    // two families built from the same base map show the same pattern.
    this._matN = (this._matN || 0) + 1;
    const n = this._matN;
    const t = tiled(maps, rx, ry, (n % 4) * (Math.PI / 4) + n * 0.11,
                    (n * 0.37) % 1, (n * 0.61) % 1);
    return new THREE.MeshStandardMaterial({
      map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap,
      metalness: 0, roughness: 1, normalScale: new THREE.Vector2(1.4, 1.4),
      color: 0x5a5f68, ...extra,
    });
  }

  /**
   * A wall built as FOUR panels around a rectangular hole, in the wall's own 2D
   * coordinates (u across, v up), so the opening behind it is genuinely visible.
   *
   * This exists because every access except the corridor used to be *decorated*
   * onto a solid plane: the recess, the duct and the window void all sat behind
   * an opaque wall, so a creature waiting in them was hidden by the wall itself
   * and then appeared to walk straight through it. Cutting the hole is what
   * makes "it is coming in through the door" legible at all.
   *
   * @param place (u0,v0,uw,vh) -> void, positions one panel centred at (u0,v0)
   */
  _holedWall(uSpan, vSpan, hole, place) {
    const [u0, u1] = uSpan, [v0, v1] = vSpan;
    const { u, v, w: hw, h: hh } = hole;
    const uL = u - hw / 2, uR = u + hw / 2, vB = v - hh / 2, vT = v + hh / 2;
    // left of the hole, right of the hole, then the strips under and over it
    if (uL - u0 > 1e-4) place((u0 + uL) / 2, (v0 + v1) / 2, uL - u0, v1 - v0);
    if (u1 - uR > 1e-4) place((uR + u1) / 2, (v0 + v1) / 2, u1 - uR, v1 - v0);
    if (vB - v0 > 1e-4) place((uL + uR) / 2, (v0 + vB) / 2, hw, vB - v0);
    if (v1 - vT > 1e-4) place((uL + uR) / 2, (vT + v1) / 2, hw, v1 - vT);
  }

  _build() {
    const tex = buildTextures();
    this._tex = tex;   // the accesses build their own materials from these
    const w = CONFIG.room.W / 2, d = CONFIG.room.D / 2, h = CONFIG.room.H;
    const g = this.group;

    // --- SURFACE IDENTITY -------------------------------------------------
    // Every wall used to be the same two textures at slightly different tiling
    // and near-identical greys, so the beam revealed a repeating grid and no
    // information: you could not tell concrete from sheet metal. Two changes fix
    // that. First, each surface gets a genuinely different physical answer to
    // light (colour, roughness, metalness and normal depth all separated, not
    // nudged). Second, the tiling drops to ~1 tile per surface, which removes
    // the repeat pattern entirely — the detail now comes from geometry (ribs,
    // seams, bolts, painted plates), which is where it reads properly anyway.
    const floorMat = this._mat(tex.concrete, 1.5, 1.5, { color: 0x4a4e56, roughness: 0.96, normalScale: new THREE.Vector2(1.9, 1.9) });
    // ceiling = painted structural deck: darker, flatter, clearly not the floor
    const ceilMat = this._mat(tex.metal, 1.3, 1.3, { color: 0x2f3439, metalness: 0.1, roughness: 0.92, normalScale: new THREE.Vector2(1.1, 1.1) });
    // FRONT = painted sheet steel: cool, semi-gloss, shallow tooling marks
    const wallMat = this._mat(tex.metal, 1.15, 0.95, { color: 0x4c545a, metalness: 0.15, roughness: 0.76, normalScale: new THREE.Vector2(1.5, 1.5) });
    // LEFT = bare cast concrete: warm, utterly matte, deep pitted relief
    const wallMatB = this._mat(tex.concrete, 1.0, 0.85, { color: 0x635c51, metalness: 0.0, roughness: 0.98, normalScale: new THREE.Vector2(2.5, 2.5) });
    // RIGHT = corrugated industrial cladding: colder, tighter, plus real ribs
    const wallMatC = this._mat(tex.metal, 1.0, 0.9, { color: 0x464d54, metalness: 0.2, roughness: 0.68, normalScale: new THREE.Vector2(1.2, 1.2) });
    this.wallMatB = wallMatB; this.wallMatC = wallMatC;
    // --- MATERIAL FAMILIES: each object type gets its own physical answer -----
    const metal = this._mat(tex.metal, 2, 2, { color: 0x565b62, metalness: 0.22, roughness: 0.84 });

    // ======================================================================
    // THE CONSTRAINT EVERY MATERIAL IN THIS ROOM LIVES UNDER
    //
    // The only real light is a 46 cd torch held at the eye, so surfaces get hit
    // from about a metre. At that irradiance ANYTHING with metalness above ~0.22
    // and roughness below ~0.85 blows out to white, and once the specular lobe
    // saturates the albedo stops mattering at all — which is why tinting by
    // arithmetic did not save the first attempt at this. So differentiation has
    // to come from the MAP's pattern and its tint, never from metalness.
    // The generic metal it replaces sat at 0.22/0.84 for exactly this reason.
    // ======================================================================

    // ---- STRUCTURAL FRAME STEEL -------------------------------------------
    // The one substance shared by the door frame, the window frame and the
    // corridor mouth, exactly as they should be: three openings cut in the same
    // building, framed by the same rolled section, painted once decades ago.
    // Heavier and cooler than the generic metal, and far less shiny than the
    // handles, so a frame never reads as something you would touch.
    // target 0x4a5158 over paintedSheet -> 255*74/105, 255*81/104, 255*88/97
    // Frames sit 1.0-1.5 m from the lamp, so irradiance is ~27 and the albedo has
    // to come down to about 0.035 linear to stay off the ceiling. 0xb4c7e7 over a
    // map mean of 105 was landing at 74-95/255 and glinting; 53/255 does not.
    //   target 53/255 over 105  ->  255 * 53 / 105 = 129, biased cool
    const frameSteel = this._mat(tex.paintedSheet, 1.05, 1.05,
      { color: 0x63697a, metalness: 0.06, roughness: 1.0, normalScale: new THREE.Vector2(1.1, 1.1) });

    // ---- GALVANISED DUCTWORK ----------------------------------------------
    // Everything that carries air or cable: the duct collar and louvre, the cable
    // trays, the tray rungs. Zinc crystallites, cool, and noticeably LIGHTER than
    // the frames — which is the whole point, because the duct sits in the same
    // wall as the door and the two must not read as one object.
    // target 0x70767c over galvanised
    // THE DUCT IS THE CLOSEST THING IN THE ROOM TO THE LAMP. The louvre swings out
    // of the wall toward the player and ends up about 0.7 m from a 46 cd source,
    // square on. Irradiance there is ~94, so radiance = albedo * 94 / pi: anything
    // above 0.03 linear albedo saturates, and the galvanised map is BRIGHT (mean
    // 142/255). Two earlier attempts blamed metalness and then roughness; it was
    // never either, it was plain diffuse overexposure. The tint has to bring the
    // albedo down to about 48/255 before the beam ever reaches it.
    //   target 48/255 over a map mean of 142  ->  255 * 48 / 142
    const duct = this._mat(tex.galvanised, 1.15, 1.15,
      { color: 0x565658, metalness: 0.12, roughness: 0.95, normalScale: new THREE.Vector2(0.55, 0.55) });

    // ---- PAINTED ENCLOSURE -------------------------------------------------
    // Boxes that contain something: the breaker cabinet, junction boxes, the
    // fluorescent housing, the sign backers. Darker than the frames and flatter,
    // so a box reads as a box and not as structure.
    // target 0x33383d over paintedSheet
    const boxPaint = this._mat(tex.paintedSheet, 1.35, 1.35,
      { color: 0x5c6675, metalness: 0.10, roughness: 1.0 });

    // ---- INSTRUMENT BAKELITE ----------------------------------------------
    // Housings for things with a dial or a lens: the charge meter, the clock body,
    // the beacon back plate. Moulded, nearly black, no metallic response at all —
    // the reason the gauge currently reads as "another bit of metal".
    // target 0x24272b over techPlastic
    // Bakelite is the one thing here that may stay slightly glossy: it is dark
    // enough (target 0x24272b) that even a full highlight lands mid grey.
    // Bakelite: the clock body, the meter housing, the beacon plate. Dead matte and
    // very dark — a dial housing that catches a highlight reads as chrome.
    const instrument = this._mat(tex.techPlastic, 1.5, 1.5,
      { color: 0x5e646c, metalness: 0.0, roughness: 1.0, normalScale: new THREE.Vector2(0.4, 0.4) });

    // ---- AND THE REST, so nothing has to borrow ------------------------
    // Most of these come out at colour white: their maps are already dark enough
    // (greasyMetal mean 26, castIron 38, tiledConcrete 52) that the map's own
    // value IS the target, and a multiplier could only make them darker.
    //
    // pipePaint: the ceiling runs. They carry painted colour-code bands, so the
    // pipe under them is painted too — not the bare rust the corridor runs are.
    const pipePaint = this._mat(tex.paintedSheet, 0.9, 0.9,
      { color: 0x6e7784, metalness: 0.10, roughness: 1.0 });
    // tubeFrame: drawn tube used for FURNITURE — chair legs, shelf uprights, bench
    // legs. Distinct from the duct (which is folded sheet) and from the frames.
    const tubeFrame = this._mat(tex.galvanised, 0.8, 0.8,
      { color: 0x5b5f64, metalness: 0.14, roughness: 1.0, normalScale: new THREE.Vector2(0.5, 0.5) });
    // formed: concrete cast against shuttering. Kerbs, skirtings, the window
    // surround, the pump plinth. Not rust — these are all masonry.
    // Rendered at colour white this read as polished granite rather than concrete:
    // tiledConcrete's mean is only 52/255 but its contrast is high, and the bright
    // half of that range saturates at a metre. Halved.
    const formed = this._mat(tex.tiledConcrete, 2.2, 2.2,
      { color: 0x878787, metalness: 0.0, roughness: 1.0, normalScale: new THREE.Vector2(1.6, 1.6) });
    // greasy: the pump and its pipework. Oil-streaked, and the streaks are in the
    // map rather than in the tint.
    const greasy = this._mat(tex.greasyMetal, 1.2, 1.2,
      { color: 0xffffff, metalness: 0.16, roughness: 1.0 });
    // dryMech: mechanism that has NOT been oiled — the valve body, bolt heads,
    // brackets. Dusty cast surface, no lubricated sheen.
    const dryMech = this._mat(tex.castIron, 1.5, 1.5,
      { color: 0xffffff, metalness: 0.14, roughness: 1.0 });
    // plywood and structural timber: two different woods, grain running crosswise
    // to each other so a bench top and a pallet never look like the same board.
    const plywood = this._mat(tex.plywood, 1.2, 1.2,
      { color: 0xa89880, metalness: 0.0, roughness: 1.0 });
    const bearer = this._mat(tex.timber, 0.8, 0.8,
      { color: 0xffffff, metalness: 0.0, roughness: 1.0, normalScale: new THREE.Vector2(1.6, 1.6) });
    // tread: raised-pattern plate. Walkway panels and the grating in the corridor.
    const tread = this._mat(tex.diamondPlate, 1.4, 1.4,
      { color: 0x767c83, metalness: 0.12, roughness: 1.0, normalScale: new THREE.Vector2(1.5, 1.5) });
    // soot: what has lived under the failing beacon or in the corridor draught.
    const soot = this._mat(tex.sootedSteel, 1.25, 1.25,
      { color: 0xffffff, metalness: 0.10, roughness: 1.0 });
    Object.assign(this, {
      frameSteel, duct, boxPaint, instrument,
      pipePaint, tubeFrame, formed, greasy, dryMech, plywood, bearer, tread, soot,
    });
    const rust = this._mat(tex.rust, 1, 1, { color: 0x7a4f30, metalness: 0.12, roughness: 0.97 });
    // painted steel: furniture, lockers, shelving
    const painted = this._mat(tex.metal, 1.6, 1.6, { color: 0x3d4a4e, metalness: 0.18, roughness: 0.8 });
    // Hardware you touch: bars, handles, rails.
    // This was near-chrome (metalness 0.85 / roughness 0.38) and it was the main
    // source of the mirror glare — at 1 m the lamp became a specular sun on every
    // rail and handle. Nothing in a damp, decades-old plant is polished: this is
    // now aged mild steel, still metallic but with a highlight that spreads.
    const steel = new THREE.MeshStandardMaterial({ color: 0x757b83, metalness: 0.52, roughness: 0.64 });
    // Cast iron: the drainage hatch and its frame. Dark, dry, barely specular.
    const iron = this._mat(tex.rust, 2.4, 2.4, { color: 0x35383c, metalness: 0.28, roughness: 0.94, normalScale: new THREE.Vector2(1.7, 1.7) });
    this.iron = iron;

    // ---- MATERIAL LIBRARY --------------------------------------------------
    // One generic grey metal was doing the work of a dozen different substances,
    // which is why the whole room looked machined from the same billet. Each of
    // these answers light differently: the spread of the highlight, how dark it
    // goes in shadow and how much colour it keeps are all separated, not nudged.
    // Tiling is kept at or near 1 on small parts — a repeat of 2 on a 30 cm
    // bracket is a visible pattern inside a single object.
    //
    // galvanised steel: spangled, cool, semi-matte. Ducting, trays, tube frames.
    const galv = this._mat(tex.metal, 1.0, 1.0, { color: 0x777d84, metalness: 0.42, roughness: 0.72, normalScale: new THREE.Vector2(0.8, 0.8) });
    // aluminium: lighter and slightly warmer than galv, finer grain. Motor bodies,
    // kick plates, extrusions.
    const alu = this._mat(tex.metal, 1.0, 1.0, { color: 0x8f949a, metalness: 0.60, roughness: 0.52, normalScale: new THREE.Vector2(0.5, 0.5) });
    // stainless: the only genuinely bright metal in the room, and it is used only
    // on things a hand touches, so a hard highlight always means "handle".
    const stainless = new THREE.MeshStandardMaterial({ color: 0x9ba1a8, metalness: 0.72, roughness: 0.34 });
    // technical plastic: knobs, handles, cable glands. Zero metalness, soft sheen.
    const tech = new THREE.MeshStandardMaterial({ color: 0x2b2f34, metalness: 0.0, roughness: 0.48 });
    // rubber: gaskets, wheels, feet. The flattest thing here — it must never
    // catch a highlight at all.
    const rubber = new THREE.MeshStandardMaterial({ color: 0x14161a, metalness: 0.0, roughness: 0.98 });
    // chipped paint over steel: the sheet where the coating has gone
    const chipped = this._mat(tex.rust, 1.0, 1.2, { color: 0x4a5148, metalness: 0.14, roughness: 0.90, normalScale: new THREE.Vector2(1.9, 1.9) });
    Object.assign(this, { galv, alu, stainless, tech, rubber, chipped });
    // aged plastic / bakelite: knobs, switch bodies
    const plastic = new THREE.MeshStandardMaterial({ color: 0x23252a, metalness: 0.0, roughness: 0.62 });
    // worn timber: crates and pallets
    const timber = this._mat(tex.rust, 1.2, 1.2, { color: 0x6b5638, metalness: 0.0, roughness: 0.95 });
    // chipped enamel paint: the door leaf
    // Dropped from 0x4a5b53: the leaf is the largest surface that ever gets within
    // a metre of the lamp, and at that albedo it washed out to flat cream.
    const enamel = this._mat(tex.rust, 0.9, 1.4, { color: 0x354039, metalness: 0.1, roughness: 0.88 });
    Object.assign(this, { painted, steel, plastic, timber, enamel });
    // fog:false as well — a hole must not drift toward the fog colour with distance
    const voidMat = new THREE.MeshStandardMaterial({ color: 0x030406, roughness: 1, side: THREE.BackSide, fog: false });
    // Dark painted equipment. The big flat faces of the cabinet, pump and bench
    // sit ~1 m from the lamp; in mid-grey metal the beam clipped them to white.
    const equip = this._mat(tex.metal, 2, 2, { color: 0x2a2e33, metalness: 0.3, roughness: 0.9 });
    this.metal = metal; this.rust = rust; this.voidMat = voidMat; this.equip = equip;

    const plane = (pw, ph, m) => new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), m);

    // ---- OPENINGS: the single source of truth for where the holes are -------
    // Shared with routes.js (via the clearance audit) so geometry and AI can
    // never drift apart again.
    const OP = this.openings = {
      corridor: { x: 0, w: 1.30, h: 2.15 },                        // front, floor-standing
      door:     { z: 0.35, w: 1.06, h: 2.10 },                     // left, floor-standing
      // Sill dropped from 0.72 m to 0.34 m and the opening made taller. At the
      // old proportions a creature standing outside had its head at 1.72 m and
      // the aperture stopped at 1.68 m, so you saw shins through the hole and its
      // torso was buried in the wall — which is exactly why it read as "it just
      // appears" instead of "it is climbing in". Now a whole body frames in it
      // and the sill is low enough to actually be climbed over.
      window:   { z: -0.15, y: 1.05, w: 1.32, h: 1.42 },           // right
      // Moved onto the LEFT wall. On the front pier it was competing with the
      // corridor mouth, the exit sign and the plant signage for the same two
      // square metres, and the wall could not say what it was. The left wall is
      // the services side — it has room, and a duct low down beside the door
      // reads immediately as a second way in.
      vent:     { z: -0.95, y: 0.58, w: 0.62, h: 0.52 },           // left
      hatch:    { x: 0.55, z: 0.45, w: 0.80, h: 0.80 },            // floor
    };

    // ---- FLOOR, cut around the drainage pit --------------------------------
    this._holedWall([-w, w], [-d, d], { u: OP.hatch.x, v: OP.hatch.z, w: OP.hatch.w, h: OP.hatch.h },
      (u, v, uw, vh) => {
        const p = plane(uw, vh, floorMat);
        p.rotation.x = -Math.PI / 2; p.position.set(u, 0, v); p.receiveShadow = true; g.add(p);
      });
    const ceil = plane(CONFIG.room.W, CONFIG.room.D, ceilMat);
    ceil.rotation.x = Math.PI / 2; ceil.position.y = h; ceil.receiveShadow = true; g.add(ceil);
    // Back wall: never seen head-on (no rear screen) — minimal, catches shadows.
    const back = plane(CONFIG.room.W, h, wallMat);
    back.position.set(0, h / 2, d); back.rotation.y = Math.PI; back.receiveShadow = true; g.add(back);

    // ---- LEFT wall: TWO apertures, the duct and the personnel door ----------
    // Built as three z-bands so each hole is cut in its own stretch of wall.
    const placeLeft = (u, v, uw, vh) => {
      const p = plane(uw, vh, wallMatB);
      p.position.set(-w, v, u); p.rotation.y = Math.PI / 2; p.receiveShadow = true; g.add(p);
    };
    const dL = OP.door.z - OP.door.w / 2, dR = OP.door.z + OP.door.w / 2;
    this._holedWall([-d, dL], [0, h], { u: OP.vent.z, v: OP.vent.y, w: OP.vent.w, h: OP.vent.h }, placeLeft);
    this._holedWall([dL, dR], [0, h], { u: OP.door.z, v: OP.door.h / 2, w: OP.door.w, h: OP.door.h }, placeLeft);
    placeLeft((dR + d) / 2, h / 2, d - dR, h);

    // ---- RIGHT wall, cut around the observation window ---------------------
    this._holedWall([-d, d], [0, h], { u: OP.window.z, v: OP.window.y, w: OP.window.w, h: OP.window.h },
      (u, v, uw, vh) => {
        const p = plane(uw, vh, wallMatC);
        p.position.set(w, v, u); p.rotation.y = -Math.PI / 2; p.receiveShadow = true; g.add(p);
      });
    // real corrugation, so this wall is unmistakably profiled cladding and not
    // "grey wall #3". Skipped where the window opening is.
    {
      const ribs = [];
      for (let z = -d + 0.11; z < d; z += 0.22) {
        const inHole = z > OP.window.z - OP.window.w / 2 - 0.03 && z < OP.window.z + OP.window.w / 2 + 0.03;
        if (inHole) continue;
        ribs.push(z);
      }
      const ribMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.035, h, 0.055), wallMatC, ribs.length);
      ribMesh.castShadow = ribMesh.receiveShadow = true;
      const mR = new THREE.Matrix4(), qR = new THREE.Quaternion();
      ribs.forEach((z, i) => { mR.compose(new V3(w - 0.018, h / 2, z), qR.identity(), new V3(1, 1, 1)); ribMesh.setMatrixAt(i, mR); });
      ribMesh.instanceMatrix.needsUpdate = true; g.add(ribMesh);
    }

    // ---- FRONT wall: the corridor opening, and nothing else -----------------
    // With the duct gone to the left wall this wall has ONE job: the way out.
    const opW = OP.corridor.w, opH = OP.corridor.h, sideW = (CONFIG.room.W - opW) / 2;
    const flP = plane(sideW, h, wallMat); flP.position.set(-(opW / 2 + sideW / 2), h / 2, -d); flP.receiveShadow = true; g.add(flP);
    const fr = plane(sideW, h, wallMat); fr.position.set(opW / 2 + sideW / 2, h / 2, -d); fr.receiveShadow = true; g.add(fr);
    const ft = plane(opW, h - opH, wallMat); ft.position.set(0, opH + (h - opH) / 2, -d); ft.receiveShadow = true; g.add(ft);

    this._corridor(new V3(0, 0, -d), opW, opH);
    this._door(new V3(-w, 0, OP.door.z), Math.PI / 2);
    this._window(new V3(w, OP.window.y, OP.window.z), -Math.PI / 2);
    this._vent(new V3(-w, OP.vent.y, OP.vent.z), Math.PI / 2);
    this._hatch(new V3(OP.hatch.x, 0, OP.hatch.z));
    this._clock(new V3(0, 2.28, -d + 0.06));
    this._props();
    this._lights();
    // Painted plant signage, ceiling services and door hardware. Kept in
    // detail.js so this file stays about structure and the accesses.
    addSignage(this);
    addServices(this);
    addDoorDetail(this);
    addBatteryGauge(this);

    // ---- shadow pockets S1..S6: the only legal lurking spots -------------
    this.shadowSpots = [
      new V3(-1.30, 0, -1.30), new V3(1.30, 0, -1.30), new V3(0, 0, -1.45),
      new V3(-1.28, 0, -0.85), new V3(1.25, 0, 1.00), new V3(-0.50, 0, 1.05),
    ];
    // ---- battery pickup positions (on ledges / in the pockets) -----------
    // Cells sit where a maintenance crew would actually have left them: on the
    // bench, on the shelving, by the breaker cabinet, on the crates, on the desk
    // and on the pump's flange. Each one makes you look toward a way in.
    // Every spot is ON a surface that exists after the re-layout, and none of
    // them sits inside a creature's approach — a cell you cannot reach without
    // standing in a monster is not a reward, it is a bug.
    // TEN surfaces, spread across all four walls and four different heights, so
    // the spawner has somewhere varied to draw from every time (see PickupField:
    // it picks one when it needs one and excludes the recent ones, instead of
    // seeding a fixed layout at the start of the night).
    // ---- THE CUBE HAS NO REAR SCREEN ---------------------------------------
    // Ten spots, and NINE of them sat at z > 0.8 — on the bench, the shelving, the
    // crates, the cabinet, all behind the player's shoulders where there is no
    // panel to project them onto. A cell there is not hidden, it is unrenderable:
    // the only way to find it was to already know. Every spot now sits forward of
    // z = 0.2, so all of them land on the left, front, right or floor surface, and
    // each one is on a real object at a plausible height.
    this.pickupSpots = [
      { pos: new V3(1.24, 0.14, -1.02), pan: 0.72 },   // pump plinth        RIGHT
      { pos: new V3(1.22, 0.44, -0.88), pan: 0.70 },   // pump casing top    RIGHT
      { pos: new V3(1.30, 0.40, -0.15), pan: 0.85 },   // the window sill    RIGHT
      { pos: new V3(-1.36, 0.66, -0.52), pan: -0.85 }, // bracket shelf      LEFT
      { pos: new V3(-1.36, 0.30, -0.30), pan: -0.85 }, // its lower tier     LEFT
      { pos: new V3(1.00, 0.06, 0.14), pan: 0.42 },    // slab by the hatch  FLOOR
      { pos: new V3(-0.44, 0.06, -1.18), pan: -0.18 }, // slab at the threshold FLOOR
      { pos: new V3(0.46, 0.54, -2.72), pan: 0.10 },   // drum down the hall FRONT
    ];
  }

  _corridor(pos, opW, opH) {
    // tagged so the clearance audit can tell an access's own hardware apart
    // from room furniture: brushing your own doorframe is not a defect.
    const grp = new THREE.Group(); grp.position.copy(pos); this.group.add(grp);
    grp.userData.access = 'corridor';
    const L = 3.2;
    const tube = new THREE.Mesh(new THREE.BoxGeometry(opW, opH, L), this.voidMat);
    tube.position.set(0, opH / 2, -L / 2); tube.receiveShadow = true; grp.add(tube);
    const bar = (x, y, z, sx, sy, sz) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), this.frameSteel); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; grp.add(m); };
    bar(-opW / 2, opH / 2, 0, 0.09, opH, 0.17); bar(opW / 2, opH / 2, 0, 0.09, opH, 0.17); bar(0, opH, 0, opW + 0.1, 0.11, 0.17);
    // side doors down the hall: the plant continues
    const hallDoorMat = new THREE.MeshStandardMaterial({ color: 0x0b0c10, roughness: 0.95 });
    // moved clear of the cross passage at z=-2.40
    for (const z of [-0.75, -3.05]) for (const sx of [-1, 1]) {
      const dr = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 1.55), hallDoorMat);
      dr.position.set(sx * (opW / 2 - 0.012), 0.86, z); dr.rotation.y = sx * Math.PI / 2; grp.add(dr);
      const fr2 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.6, 0.05), this.frameSteel);
      fr2.position.set(sx * (opW / 2 - 0.03), 0.88, z + 0.31); grp.add(fr2);
    }
    // ---- THE FAR END: where the corridor actually goes ---------------------
    // This was a flat dark-red rectangle floating at the end of the tube: it lit
    // nothing, it was not attached to anything, and it read as "a red wall for
    // no reason". The red now has a source and the end has a purpose — a fire
    // exit, which is the thing the whole front wall has been pointing at.
    const endMat = this._mat(this._tex.concrete, 1, 1, { color: 0x33363a, roughness: 0.97 });
    const endWall = new THREE.Mesh(new THREE.PlaneGeometry(opW, opH), endMat);
    endWall.position.set(0, opH / 2, -L + 0.01); endWall.receiveShadow = true; grp.add(endWall);

    // a pair of fire doors, slightly apart so a cold line of light comes through
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f3a35, roughness: 0.88, metalness: 0.12 });
    for (const sx of [-1, 1]) {
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.48, 1.92, 0.05), leafMat);
      leaf.position.set(sx * 0.26, 0.96, -L + 0.06); leaf.castShadow = leaf.receiveShadow = true; grp.add(leaf);
      // wire-glass vision panel in each leaf, lit from behind
      const vp = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.44),
        new THREE.MeshBasicMaterial({ color: 0x243033, toneMapped: false }));
      vp.position.set(sx * 0.26, 1.34, -L + 0.087); grp.add(vp);
      const pb = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.035, 0.035), this.steel);
      pb.position.set(sx * 0.26, 0.98, -L + 0.10); pb.castShadow = true; grp.add(pb);
    }
    // the gap between the leaves: a thin, cold sliver of the stairwell beyond
    const slit = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 1.86),
      new THREE.MeshBasicMaterial({ color: 0x3d4f52, toneMapped: false }));
    slit.position.set(0, 0.96, -L + 0.04); grp.add(slit);
    const cold = new THREE.PointLight(0x5b7d86, 0.9, 2.2, 2);
    cold.position.set(0, 1.05, -L + 0.30); grp.add(cold);

    // the RED: a bulkhead emergency luminaire over the doors, which is what has
    // been washing the corridor red all along
    const bulk = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.13, 0.11), this.boxPaint);
    bulk.position.set(0, opH - 0.20, -L + 0.09); bulk.castShadow = true; grp.add(bulk);
    const bulkLens = new THREE.Mesh(new THREE.PlaneGeometry(0.20, 0.085),
      new THREE.MeshBasicMaterial({ color: 0x8e1a12, toneMapped: false }));
    bulkLens.position.set(0, opH - 0.20, -L + 0.146); grp.add(bulkLens);
    const exit = new THREE.PointLight(0x8e2018, 2.1, 3.8, 2);
    exit.position.set(0, opH - 0.24, -L + 0.22); grp.add(exit);
    // and its cage, so it is a fitting rather than a glowing patch
    for (let i = 0; i < 3; i++) {
      const wire = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.10, 0.006), this.steel);
      wire.position.set(-0.07 + i * 0.07, opH - 0.20, -L + 0.152); grp.add(wire);
    }
    // ---- 11. SERVICE PASSAGE DRESSING ------------------------------------
    // The hall read as an empty tube with a computer parked in it. These are the
    // things that would actually line a plant corridor.
    const m2 = new THREE.Matrix4(), q2 = new THREE.Quaternion();
    // pipe runs along both upper corners, all the way down
    for (const sx of [-1, 1]) {
      for (const [r0, yy] of [[0.045, opH - 0.16], [0.032, opH - 0.30]]) {
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(r0, r0, L - 0.1, 8), this.rust);
        pipe.rotation.x = Math.PI / 2;
        pipe.position.set(sx * (opW / 2 - 0.09), yy, -L / 2);
        pipe.castShadow = true; grp.add(pipe);
      }
    }
    // clamps holding those pipes, instanced
    const clamp2 = new THREE.InstancedMesh(new THREE.TorusGeometry(0.05, 0.009, 4, 8), this.steel, 12);
    let ci = 0;
    for (const sx of [-1, 1]) for (let k = 0; k < 6; k++) {
      m2.compose(new V3(sx * (opW / 2 - 0.09), opH - 0.16, -0.35 - k * 0.52), q2.identity(), new V3(1, 1, 1));
      clamp2.setMatrixAt(ci++, m2);
    }
    clamp2.instanceMatrix.needsUpdate = true; grp.add(clamp2);
    // a cable tray on the ceiling of the hall with instanced rungs
    const trayRail = new THREE.InstancedMesh(new THREE.BoxGeometry(0.016, 0.04, L - 0.1), this.duct, 2);
    [[-0.1], [0.1]].forEach(([x], i) => { m2.compose(new V3(x, opH - 0.05, -L / 2), q2.identity(), new V3(1, 1, 1)); trayRail.setMatrixAt(i, m2); });
    trayRail.instanceMatrix.needsUpdate = true; grp.add(trayRail);
    const trayRung = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.008, 0.022), this.duct, 11);
    for (let k = 0; k < 11; k++) { m2.compose(new V3(0, opH - 0.068, -0.3 - k * 0.26), q2.identity(), new V3(1, 1, 1)); trayRung.setMatrixAt(k, m2); }
    trayRung.instanceMatrix.needsUpdate = true; grp.add(trayRung);
    // wall boxes / junction boxes down the hall
    const jb = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.16, 0.12), this.equip, 4);
    [[-1, -0.45], [1, -1.6], [-1, -2.55], [1, -2.95]].forEach(([sx, z], i) => {
      m2.compose(new V3(sx * (opW / 2 - 0.04), 1.35, z), q2.identity(), new V3(1, 1, 1));
      jb.setMatrixAt(i, m2);
    });
    jb.instanceMatrix.needsUpdate = true; grp.add(jb);
    // a safety rail part-way down: reads as depth and as a real workplace
    const railGrp = new THREE.Group(); railGrp.position.set(0, 0, -1.95); grp.add(railGrp);
    // Shortened and pushed against the wall. At 0.62 m long it reached x=-0.01,
    // straight through the middle of the only lane anything can walk down.
    for (const yy of [0.55, 0.92]) {
      const bar2 = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.30, 8), this.galv);
      bar2.rotation.z = Math.PI / 2; bar2.position.set(-opW / 2 + 0.17, yy, 0); bar2.castShadow = true; railGrp.add(bar2);
    }
    for (const px of [-opW / 2 + 0.035, -opW / 2 + 0.305]) {
      const po = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.95, 8), this.tubeFrame);
      po.position.set(px, 0.475, 0); po.castShadow = true; railGrp.add(po);
    }
    // a toe board at the bottom: without it the two rails and two posts read as
    // an abstract white rectangle hanging in the corridor rather than a guard
    const toe = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.10, 0.02), this.tread);
    toe.position.set(-opW / 2 + 0.17, 0.09, 0); toe.castShadow = true; railGrp.add(toe);
    // a stacked pallet and a drum against the right wall of the hall
    const pallet = new THREE.Group(); pallet.position.set(opW / 2 - 0.17, 0.06, -2.55); grp.add(pallet);
    for (let k = 0; k < 4; k++) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.022, 0.075), this.timber);
      board.position.set(0, 0.05, -0.17 + k * 0.115); board.castShadow = true; pallet.add(board);
    }
    for (const bz of [-0.16, 0, 0.16]) {
      const bear = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.045, 0.05), this.timber);
      bear.position.set(0, 0.022, bz); pallet.add(bear);
    }
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.52, 14), this.rust);
    drum.position.set(opW / 2 - 0.17, 0.26, -1.10); drum.castShadow = drum.receiveShadow = true; grp.add(drum);
    for (const ry2 of [0.16, 0.36]) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(0.163, 0.012, 5, 14), this.rust);
      rib.rotation.x = Math.PI / 2; rib.position.set(opW / 2 - 0.17, ry2, -1.10); grp.add(rib);
    }
    // floor grating panel further down: breaks the flat floor of the hall
    const grate = new THREE.InstancedMesh(new THREE.BoxGeometry(0.62, 0.012, 0.03), this.tread, 9);
    for (let k = 0; k < 9; k++) { m2.compose(new V3(0, 0.012, -1.5 - k * 0.06), q2.identity(), new V3(1, 1, 1)); grate.setMatrixAt(k, m2); }
    grate.instanceMatrix.needsUpdate = true; grp.add(grate);

    // A real side passage at the depth corridorCross uses. Without it the
    // "crosses without entering" false alarm walked through solid wall.
    const crossVoid = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.95, 0.92), this.voidMat);
    crossVoid.position.set(0, 0.975, -3.30); grp.add(crossVoid);
    for (const sx of [-1, 1]) {
      const jam = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.95, 0.07), this.frameSteel);
      jam.position.set(sx * (opW / 2 + 0.02), 0.975, -3.30 + sx * 0.42);
      jam.castShadow = true; grp.add(jam);
    }

    this.corridor = grp;
  }

  _door(pos, ry) {
    // tagged so the clearance audit can tell an access's own hardware apart
    // from room furniture: brushing your own doorframe is not a defect.
    const grp = new THREE.Group(); grp.position.copy(pos); grp.rotation.y = ry; this.group.add(grp);
    grp.userData.access = 'door';
    // ---- THERE IS A BUILDING ON THE OTHER SIDE ----------------------------
    // An empty black box behind a door does not read as another room, it reads as
    // the edge of the level. Everything below is in DOOR-LOCAL space, where local z
    // is depth into the recess and local x runs along the room's z — and all of it
    // is kept clear of local |x| < 0.30, because that is the lane the creature
    // stands in at its first two waypoints.
    const RD = 1.35;                                   // how deep the space goes
    const recess = new THREE.Mesh(new THREE.BoxGeometry(1.06, 2.1, RD), this.voidMat);
    recess.position.set(0, 1.05, -RD / 2 - 0.05); recess.receiveShadow = true; grp.add(recess);
    // the far wall of that room, in block rather than the room's own finishes
    const farW = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.1), this.formed);
    farW.position.set(0, 1.05, -RD - 0.05); grp.add(farW);
    // A WAY ON. One side of it opens into a passage that carries on out of sight,
    // which is the single strongest cue that the building continues.
    const onward = new THREE.Mesh(new THREE.BoxGeometry(0.52, 1.95, 1.1), this.voidMat);
    onward.position.set(0.52, 0.97, -RD - 0.55); grp.add(onward);
    for (const oz of [-RD - 0.06, -RD - 1.02]) {
      const oj = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.95, 0.06), this.frameSteel);
      oj.position.set(0.30, 0.97, oz); oj.castShadow = true; grp.add(oj);
    }
    // SERVICES running through it, along the ceiling where nothing walks
    for (const [py, pr] of [[1.94, 0.045], [1.82, 0.032], [1.70, 0.026]]) {
      const pp = new THREE.Mesh(new THREE.CylinderGeometry(pr, pr, 1.05, 8), this.pipePaint);
      pp.rotation.x = Math.PI / 2; pp.position.set(-0.34, py, -RD / 2);
      pp.castShadow = true; grp.add(pp);
    }
    // a cable tray with rungs, opposite the pipes
    const trR = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 1.05), this.duct);
    trR.position.set(0.40, 1.90, -RD / 2); grp.add(trR);
    const trU = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.01, 0.02), this.duct, 6);
    const mT = new THREE.Matrix4(), qT = new THREE.Quaternion();
    for (let i = 0; i < 6; i++) { mT.compose(new V3(0.47, 1.87, -0.18 - i * 0.19), qT.identity(), new V3(1, 1, 1)); trU.setMatrixAt(i, mT); }
    trU.instanceMatrix.needsUpdate = true; grp.add(trU);
    // A MACHINE, hard against the side so the lane stays clear
    const mBox = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.86, 0.42), this.boxPaint);
    mBox.position.set(-0.36, 0.43, -RD + 0.30); mBox.castShadow = mBox.receiveShadow = true; grp.add(mBox);
    const mMot = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.24, 12), this.greasy);
    mMot.rotation.z = Math.PI / 2; mMot.position.set(-0.36, 0.98, -RD + 0.30); mMot.castShadow = true; grp.add(mMot);
    // a valve on a riser beside it: the vocabulary of a plant room
    const vRis = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 1.6, 8), this.greasy);
    vRis.position.set(-0.44, 0.80, -RD + 0.62); grp.add(vRis);
    const vWh = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.012, 5, 12), this.dryMech);
    vWh.rotation.y = Math.PI / 2; vWh.position.set(-0.44, 1.16, -RD + 0.62); grp.add(vWh);
    // SIGNAGE, because a real corridor tells you where it goes
    const wayTag = paintedPlate(0.30, 0.11, (c, W, H) => {
      c.fillStyle = '#1a1d1a'; c.fillRect(0, 0, W, H);
      c.fillStyle = '#b9bfa8'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = Math.round(H * 0.50) + 'px ' + CONFIG.fonts.stencil;
      c.fillText('SECTOR 4', W / 2, H * 0.55);
    }, { px: 256 });
    wayTag.rotation.y = -Math.PI / 2;
    wayTag.position.set(0.28, 1.42, -RD - 0.30); grp.add(wayTag);
    // AND LIGHT. Without a source in there the whole thing is invisible until the
    // torch happens to point through the gap; a failing tube on the far wall makes
    // the space exist on its own, and backlights anything standing in the doorway.
    const beyondLamp = new THREE.PointLight(0x9fb4c4, 1.05, 2.4, 2);
    beyondLamp.position.set(0.18, 1.86, -RD + 0.18); grp.add(beyondLamp);
    const beyondTube = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.05, 0.07),
      new THREE.MeshBasicMaterial({ color: 0x2b3a44, toneMapped: false }));
    beyondTube.position.set(0.18, 1.92, -RD + 0.18); beyondTube.rotation.y = Math.PI / 2; grp.add(beyondTube);
    this.beyondDoorLight = beyondLamp;
    const jamb = (x) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.14, 0.17), this.frameSteel); m.position.set(x, 1.07, 0); m.castShadow = m.receiveShadow = true; grp.add(m); };
    jamb(-0.56); jamb(0.56);
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.14, 0.17), this.frameSteel);
    lintel.position.set(0, 2.14, 0); lintel.castShadow = true; grp.add(lintel);
    // hinge on the left edge so the gap (the "slit") opens on the right
    const pivot = new THREE.Group(); pivot.position.set(-0.52, 1.02, -0.05); grp.add(pivot);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(1.02, 2.02, 0.06), this.enamel);
    leaf.geometry.translate(0.51, 0, 0);
    leaf.castShadow = leaf.receiveShadow = true; pivot.add(leaf);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.14), this.steel);
    handle.position.set(0.9, 0.02, 0.08); pivot.add(handle);
    // REAR FACE. With the door open you look at its back, and it was a blank
    // slab with every piece of hardware on the far side. Real steel doors are
    // braced: two rails, three stiles and a bottom channel, which also give the
    // beam something to rake across.
    for (const ry2 of [-0.62, 0.28, 0.92]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.07, 0.02), this.enamel);
      rail.position.set(0.51, ry2, -0.04); rail.castShadow = true; pivot.add(rail);
    }
    for (const rx of [0.14, 0.51, 0.88]) {
      const stile = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.86, 0.018), this.enamel);
      stile.position.set(rx, 0.02, -0.038); stile.castShadow = true; pivot.add(stile);
    }
    const closer = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.06, 0.06), this.dryMech);
    closer.position.set(0.22, 0.94, -0.06); closer.castShadow = true; pivot.add(closer);
    this.doorPivot = pivot;
    pivot.rotation.y = 0;              // shut in its frame at the start of a night
  }

  _window(pos, ry) {
    // tagged so the clearance audit can tell an access's own hardware apart
    // from room furniture: brushing your own doorframe is not a defect.
    const grp = new THREE.Group(); grp.position.copy(pos); grp.rotation.y = ry; this.group.add(grp);
    grp.userData.access = 'window';

    // The whole right wall used to read as one uniform mass because the frame,
    // the sill and the wall were all variants of the same metal at similar
    // roughness. Each part now gets a DIFFERENT physical answer to light:
    //   frame   = machined steel, smooth + metallic  -> catches a hard highlight
    //   surround= rough painted concrete lintel      -> matte, kills reflection
    //   sill    = heavily worn, deep normals         -> broken, gritty
    // Machined-looking steel at roughness 0.42 / metalness 0.92 was the single
    // worst offender for glare: the beam turned all five frame bars into mirror
    // streaks. A window frame that has been in a damp plant for thirty years is
    // painted, pitted and oxidised — metallic, but the highlight has to SPREAD.
    // The window frame is the SAME section as the door frame — see frameSteel.
    // It used to be a one-off built from the generic metal maps at metalness 0.50,
    // which is why it read both as a different substance from the door and as
    // something polished.
    const steel = this.frameSteel;
    // Cast concrete, not tinted rust. The lintel, the pilasters and the pipes
    // above them were all sharing one pattern where they meet.
    const lintelMat = this.formed;
    // The sill is the one part something climbs over, so it is the cast-iron
    // nosing you would actually fit there — and at metalness 0.35 the old one was
    // the brightest thing on the wall.
    const sillMat = this.dryMech;
    this._winSteel = steel;

    // Built from the opening's real dimensions rather than hard-coded numbers,
    // so the frame, sill and surround can never drift out of register with the
    // hole that is actually cut in the wall.
    const O = this.openings.window;
    const HW = O.w / 2, HH = O.h / 2, BAR = 0.11;

    // structural surround: a concrete lintel over it and two pilasters, so the
    // opening is framed by architecture instead of floating in a flat wall
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(O.w + 0.54, 0.2, 0.16), lintelMat);
    lintel.position.set(0, HH + 0.10, 0.06); lintel.castShadow = lintel.receiveShadow = true; grp.add(lintel);
    for (const sx of [-1, 1]) {
      const pil = new THREE.Mesh(new THREE.BoxGeometry(0.18, O.h + 0.30, 0.13), lintelMat);
      pil.position.set(sx * (HW + 0.19), -0.05, 0.05); pil.castShadow = pil.receiveShadow = true; grp.add(pil);
    }

    // the frame itself: 4 bars, so the glazing line is a real recess
    const bar = (sx, sy, px, py) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, 0.14), steel);
      m.position.set(px, py, 0.02); m.castShadow = m.receiveShadow = true; grp.add(m);
    };
    // Mounted on the wall FACE, around the hole — not inside it. Sitting inside,
    // the top bar ate the last 11 cm of a 1.42 m aperture and a standing creature
    // put its head through it.
    bar(O.w + 0.20 + BAR * 2, BAR, 0, HH + BAR / 2); bar(O.w + 0.20 + BAR * 2, BAR, 0, -HH - BAR / 2);
    bar(BAR, O.h, -HW - BAR / 2, 0); bar(BAR, O.h, HW + BAR / 2, 0);
    // (A snapped transom stub used to hang across the opening here. Lit from the
    //  room it read as a white plank floating in a grey hole, so it is gone: the
    //  bent sill lip already tells the "something came through" story.)

    // ---- WHAT IS BEHIND THE GLASS -----------------------------------------
    // This was a pure-black void box, and it was the single worst thing on the
    // right wall: with no surface detail inside it, the only thing visible in the
    // aperture was the haze of the beam itself, which the eye reads as a flat
    // pale panel — a filled-in alcove, not a hole. Black is not depth. Depth is
    // a dim surface far enough back, with something in front of it.
    // Distance is the only thing that actually darkens this: the lamp is 46 cd,
    // so at 2 m even a 0.09 albedo comes back as mid grey and a flat plane
    // filling the aperture reads pale however dark you paint it. At 1.5 m the
    // 1/d**2 falloff does the work, and the pipework staggered in front of it
    // gives the depth cue that black alone never provided.
    const DEPTH_W = 1.50;
    const sides = new THREE.Mesh(new THREE.BoxGeometry(O.w, O.h, DEPTH_W), this.voidMat);
    sides.position.set(0, 0, -DEPTH_W / 2 - 0.01); grp.add(sides);
    // a riveted bulkhead closing the far side: dark, but it CATCHES the beam,
    // which is what gives the aperture a readable back plane
    const bulkMat = this._mat(this._tex.metal, 1.6, 1.6, { color: 0x1b1f23, metalness: 0.22, roughness: 0.9 });
    const far = new THREE.Mesh(new THREE.PlaneGeometry(O.w * 1.3, O.h * 1.3), bulkMat);
    far.position.set(0, 0, -DEPTH_W); far.rotation.y = Math.PI; far.receiveShadow = true; grp.add(far);
    // bolt line and a duct crossing it, so there is scale and occlusion in there
    const rv = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.014, 0.016, 0.02, 6), this.dryMech, 8);
    const mV = new THREE.Matrix4(), qV = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
    for (let i = 0; i < 8; i++) { mV.compose(new V3(-O.w * 0.42 + i * (O.w * 0.12), O.h * 0.34, -0.30), qV, new V3(1, 1, 1)); rv.setMatrixAt(i, mV); }
    rv.instanceMatrix.needsUpdate = true; grp.add(rv);
    const crossPipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, O.w * 1.5, 10), this.greasy);
    crossPipe.rotation.z = Math.PI / 2; crossPipe.position.set(0, -O.h * 0.22, -0.42);
    crossPipe.castShadow = true; grp.add(crossPipe);

    // sill: a real ledge at climbing height, standing proud of the wall
    const sill = new THREE.Mesh(new THREE.BoxGeometry(O.w + 0.30, 0.12, 0.34), sillMat);
    sill.position.set(0, -HH - 0.06, 0.13); sill.castShadow = sill.receiveShadow = true; grp.add(sill);
    // bent-up lip on the sill: something has been climbing over this
    const lip = new THREE.Mesh(new THREE.BoxGeometry(O.w + 0.30, 0.05, 0.04), sillMat);
    lip.position.set(0, -HH - 0.01, 0.29); lip.rotation.x = -0.4; grp.add(lip);
    // and the wall under the sill takes the scuffing from being climbed
    const scuff = new THREE.Mesh(new THREE.BoxGeometry(O.w + 0.10, 0.30, 0.03), sillMat);
    scuff.position.set(0, -HH - 0.26, 0.015); scuff.receiveShadow = true; grp.add(scuff);

    // Remaining glass. Was roughness 0.03 with reflectivity 1.0 — a mirror, and
    // the second big source of glare. Broken safety glass is crazed and filthy:
    // it still reads as glass, it just stops behaving like a lens.
    // Rendered against the void these read as white paper scraps taped into a
    // grey rectangle: too big, too pale, too opaque. Broken glass in the dark is
    // mostly EDGE — small, dark, and only visible where a facet catches the beam.
    // ---- WHAT MAKES GLASS READ AS GLASS -----------------------------------
    // Flat planes with transmission do not, however the numbers are tuned: a
    // plane has no EDGE, and the edge is the whole tell. Three things fix it.
    //
    //  1. THICKNESS. Real shards are extruded, so their broken edges catch a hard
    //     specular line while the faces stay nearly invisible. That bright rim on
    //     a dark facet is what the eye recognises.
    //  2. FRACTURE SHAPE. Glass breaks into acute triangles with one long
    //     conchoidal edge, never into rectangles. Rectangles read as paper.
    //  3. GREEN ON EDGE. Float glass is iron-tinted and only shows it through
    //     thickness, so `attenuationColor` over a short `attenuationDistance`
    //     puts the green exactly where a real pane puts it — in the edges.
    // NO `transmission`, deliberately, and it is a measurement not a taste call.
    // Three renders a full transmission pass per render() when any transmissive
    // material is visible, and this rig renders four viewports — so 26 shards cost
    // 3.99 ms/frame, 41% of the budget, dropping 1080p from 175 to 103 fps. What
    // that pass was buying: a view through the shards of a near-black void. In a
    // dark room glass is read almost entirely off its specular edges, so the
    // thickness (below) and a hard highlight do the work, and the iron-green that
    // `attenuationColor` used to provide is folded straight into the albedo.
    // Rendered and LOOKED AT: at opacity 0.42 over a pale albedo these came out as
    // flat white triangles — origami taped into the frame, the exact failure the
    // rework was meant to end. Glass in the dark is nearly black in the face and
    // only bright along an edge, so the body goes dark and thin and the highlight
    // is left to do all the work.
    const shard = new THREE.MeshPhysicalMaterial({
      color: 0x1e2b2c, roughness: 0.05, metalness: 0.0,
      transparent: true, opacity: 0.16, ior: 1.52,
      specularIntensity: 1.0, side: THREE.DoubleSide, depthWrite: false,
    });
    // The fracture surface itself: a conchoidal break is frosted, not polished.
    // Without this every shard is uniformly glossy and reads as plastic.
    const frost = new THREE.MeshStandardMaterial({
      color: 0x53625f, roughness: 0.62, metalness: 0.0,
      transparent: true, opacity: 0.55, side: THREE.DoubleSide,
    });
    this._glassMats = [shard, frost];

    const rnd = mulberry32(0x9155);          // fixed, so the break never changes
    const gw = this.openings.window.w / 2 - 0.06, gh = this.openings.window.h / 2 - 0.05;

    /** An acute, irregular fracture triangle, extruded to real thickness. */
    const shardGeo = (scale) => {
      const pts = [];
      // one long edge and a sharp point: the silhouette a conchoidal break makes
      const a0 = rnd() * Math.PI * 2;
      const spread = 0.55 + rnd() * 0.65;
      for (let k = 0; k < 3; k++) {
        const a = a0 + k * (Math.PI * 2 / 3) + (rnd() - 0.5) * spread;
        const r = scale * (k === 0 ? 1.0 : 0.34 + rnd() * 0.62);
        pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
      }
      const sh = new THREE.Shape(pts);
      const g2 = new THREE.ExtrudeGeometry(sh, { depth: 0.005 + rnd() * 0.004, bevelEnabled: false });
      g2.translate(0, 0, -0.004);
      return g2;
    };

    // Teeth still gripped by the frame: they hang INWARD from the four edges,
    // hugging the perimeter, so nothing floats across the middle of the aperture.
    for (let i = 0; i < 16; i++) {
      const scale = 0.030 + rnd() * 0.055;
      const sh = new THREE.Mesh(shardGeo(scale), i % 5 === 0 ? frost : shard);
      const e = i % 4;
      const along = (rnd() - 0.5) * 1.8;
      if (e === 0) sh.position.set(-gw + 0.006, along * gh, 0.042);
      else if (e === 1) sh.position.set(gw - 0.006, along * gh, 0.042);
      else if (e === 2) sh.position.set(along * gw, -gh + 0.006, 0.042);
      else sh.position.set(along * gw, gh - 0.006, 0.042);
      // Tipped OUT of the pane's plane by a few degrees. A shard still in its
      // rebate is never perfectly flush, and that tilt is what lets the beam find
      // an edge instead of skating across a mirror.
      sh.rotation.z = (rnd() - 0.5) * 2.4;
      sh.rotation.y = (rnd() - 0.5) * 0.55;
      sh.rotation.x = (rnd() - 0.5) * 0.35;
      sh.castShadow = true;
      grp.add(sh);
    }
    // (A radial crack pattern used to be drawn here as thin frosted slivers. Seen
    //  rendered, they read as white sticks floating in the aperture rather than as
    //  fractures in a pane — there is no pane left for them to be in. The bent
    //  sill lip and the shards still gripped by the frame already tell the story.)
    // Grit: half resting ON the sill top, half on the slab directly beneath the
    // opening. Both bands are now clamped to surfaces that actually exist there —
    // the old version left seven pieces floating in mid-air beside the wall.
    // Grit on the sill and on the slab below. Seeded like the rest, so the
    // aftermath is the same break every time rather than reshuffling on reload.
    const grit = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(0.011), frost, 20);
    grit.castShadow = true;
    const mm = new THREE.Matrix4(), qq = new THREE.Quaternion();
    for (let i = 0; i < 20; i++) {
      const onSill = i < 9;
      mm.compose(new V3((rnd() - 0.5) * (onSill ? 1.34 : 1.05),
                        onSill ? -HH - 0.055 : -HH - 0.72,
                        onSill ? 0.06 + rnd() * 0.16 : 0.10 + rnd() * 0.26),
        qq.setFromEuler(new THREE.Euler(rnd() * 3, rnd() * 3, rnd() * 3)),
        new V3(0.6 + rnd() * 0.9, 0.6 + rnd() * 0.9, 0.6 + rnd() * 0.9));
      grit.setMatrixAt(i, mm);
    }
    grit.instanceMatrix.needsUpdate = true; grp.add(grit);

    // LOCAL LIGHT: a dead-cold spill from the machine room behind, so the hole
    // reads as depth and anything climbing through is backlit.
    // At 1.5 the spill filled the recess and the aperture read as a shallow grey
    // alcove instead of a hole into somewhere. Dropped and pushed to the side so
    // it RIMS the opening: the void stays black, the edges get a cold line, and
    // anything climbing through is backlit.
    const back = new THREE.PointLight(0x2a4a66, 0.42, 2.0, 2);
    back.position.set(-O.w * 0.45, -0.20, -0.62); grp.add(back);
    this.windowLight = back;
    // a hint of the hall beyond: two dark verticals, so the black has depth
    const beyond = new THREE.MeshStandardMaterial({ color: 0x0d1114, roughness: 0.95, metalness: 0.1 });
    // The rim details in there (ladder, machine top) need to be only just visible:
    // built from dryMech they came back as a lit room rather than a dark one, which
    // defeats the point of looking THROUGH a hole into somewhere else.
    const farLit = new THREE.MeshStandardMaterial({ color: 0x1b1f22, roughness: 1.0, metalness: 0.08 });
    // ---- WHAT THE LABEL PROMISES --------------------------------------------
    // The plate over this opening says SALA DE MAQUINAS, so there has to be one.
    // Everything here is near-black and staggered in depth: read against the cold
    // rim light it gives the hole a floor, a far side and things standing in it,
    // which is what turns an aperture into a room you are looking into.
    for (const [bx, br, bz] of [[-0.34, 0.05, -0.72], [0.38, 0.07, -0.58], [0.06, 0.035, -1.05]]) {
      const pipeB = new THREE.Mesh(new THREE.CylinderGeometry(br, br, O.h * 1.6, 8), beyond);
      pipeB.position.set(bx, 0, bz); pipeB.castShadow = true; grp.add(pipeB);
    }
    // a machine block squatting on the far floor, only its top edge catching light
    const blk = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.44, 0.34), beyond);
    blk.position.set(0.18, -O.h * 0.5 + 0.22, -1.02); blk.castShadow = true; grp.add(blk);
    const blkTop = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.03, 0.38), farLit);
    blkTop.position.set(0.18, -O.h * 0.5 + 0.45, -1.02); grp.add(blkTop);
    // a caged ladder up the far wall: vertical repetition reads as scale
    const rung = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.012, 0.012, 0.26, 6), farLit, 7);
    const mL = new THREE.Matrix4(), qL = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));
    for (let i = 0; i < 7; i++) { mL.compose(new V3(-0.52, -O.h * 0.42 + i * 0.19, -1.24), qL, new V3(1, 1, 1)); rung.setMatrixAt(i, mL); }
    rung.instanceMatrix.needsUpdate = true; grp.add(rung);
    for (const sx of [-1, 1]) {
      const stile = new THREE.Mesh(new THREE.BoxGeometry(0.016, O.h * 1.3, 0.016), farLit);
      stile.position.set(-0.52 + sx * 0.13, 0, -1.24); grp.add(stile);
    }
    // a horizontal run crossing the whole space, well behind the near pipes
    const runH = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, O.w * 2.4, 8), beyond);
    runH.rotation.z = Math.PI / 2; runH.position.set(0, O.h * 0.30, -1.32); grp.add(runH);
    // and a far floor, so the hole has a bottom rather than fading out
    const farFloor = new THREE.Mesh(new THREE.PlaneGeometry(O.w * 2.2, 1.5), beyond);
    farFloor.rotation.x = -Math.PI / 2;
    farFloor.position.set(0, -O.h * 0.5 - 0.01, -0.85); grp.add(farFloor);

    // ---- AND WHAT MAKES IT A MACHINE HALL --------------------------------
    // A ladder and a box could be any dark room. What names this one is the
    // vocabulary of a plant: a switchboard with breaker rows, a valve station, a
    // motor on its bedplate. All of it in `beyond` or `farLit` so it stays a
    // silhouette — the point is to be recognised, not examined.
    // a switchboard on the far wall, with rows of breakers
    const swb = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.62, 0.10), farLit);
    swb.position.set(-0.28, O.h * 0.06, -DEPTH_W + 0.07); grp.add(swb);
    const swBrk = new THREE.InstancedMesh(new THREE.BoxGeometry(0.028, 0.05, 0.02), beyond, 14);
    const mS2 = new THREE.Matrix4(), qS2 = new THREE.Quaternion();
    for (let i = 0; i < 14; i++) {
      mS2.compose(new V3(-0.28 - 0.13 + (i % 7) * 0.043, O.h * 0.06 + 0.16 - Math.floor(i / 7) * 0.12, -DEPTH_W + 0.13),
        qS2.identity(), new V3(1, 1, 1));
      swBrk.setMatrixAt(i, mS2);
    }
    swBrk.instanceMatrix.needsUpdate = true; grp.add(swBrk);
    // a valve station on the riser that already crosses the space
    for (const [vy, vx] of [[-O.h * 0.22, -0.30], [-O.h * 0.22, 0.26]]) {
      const vb = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.12, 10), farLit);
      vb.position.set(vx, vy, -0.42); grp.add(vb);
      const vw2 = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.013, 5, 12), farLit);
      vw2.rotation.x = Math.PI / 2; vw2.position.set(vx, vy + 0.13, -0.42); grp.add(vw2);
    }
    // a motor on a bedplate, lying on the far floor
    const mtr = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.32, 12), farLit);
    mtr.rotation.z = Math.PI / 2;
    mtr.position.set(-0.46, -O.h * 0.5 + 0.14, -0.88); grp.add(mtr);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.05, 0.26), beyond);
    bed.position.set(-0.46, -O.h * 0.5 + 0.025, -0.88); grp.add(bed);
    // A WORKING LIGHT deep in there. Same reasoning as the space behind the door:
    // without its own source the hall only exists when the player points at it.
    const hallLamp = new THREE.PointLight(0x8fb0c8, 0.85, 2.2, 2);
    hallLamp.position.set(0.30, O.h * 0.30, -DEPTH_W + 0.35); grp.add(hallLamp);
    this.machineHallLight = hallLamp;

    this.window = grp;
  }

  /**
   * The air duct. The hole is now genuinely cut in the pier, so this is a real
   * shaft you can look into — which is the whole point of the access, and what
   * made the old version unreadable (a grille painted on a solid wall, with the
   * duct hidden behind it).
   *
   * The louvre is hinged at the TOP and swings up and out, so it clears the
   * opening completely: nothing crawling out has to pass through it.
   */
  _vent(pos, ry) {
    // tagged so the clearance audit can tell an access's own hardware apart
    // from room furniture: brushing your own doorframe is not a defect.
    const O = this.openings.vent;
    const grp = new THREE.Group(); grp.position.copy(pos); grp.rotation.y = ry; this.group.add(grp);
    grp.userData.access = 'vent';
    const hw = O.w / 2, hh = O.h / 2;

    // the shaft itself: sleeve + closed far end, with stiffening ribs so it
    // reads as ductwork and gives the beam something to fall across
    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(O.w, O.h, 1.10), this.voidMat);
    sleeve.position.set(0, 0, -0.56); grp.add(sleeve);
    const ductMat = this._mat(this._tex.rust, 1, 1, { color: 0x23262a, metalness: 0.18, roughness: 0.95 });
    for (let i = 0; i < 3; i++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(O.w - 0.03, 0.028, 0.028), ductMat);
      rib.position.set(0, -hh + 0.035, -0.22 - i * 0.3); grp.add(rib);
      const rib2 = new THREE.Mesh(new THREE.BoxGeometry(0.028, O.h - 0.03, 0.028), ductMat);
      rib2.position.set(-hw + 0.03, 0, -0.22 - i * 0.3); grp.add(rib2);
    }

    // flanged collar around the mouth: four bars with a visible rebate
    const collar = (sx, sy, px, py) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, 0.075), this.duct);
      m.position.set(px, py, 0.03); m.castShadow = m.receiveShadow = true; grp.add(m);
    };
    collar(O.w + 0.14, 0.07, 0, hh + 0.035); collar(O.w + 0.14, 0.07, 0, -hh - 0.035);
    collar(0.07, O.h + 0.14, -hw - 0.035, 0); collar(0.07, O.h + 0.14, hw + 0.035, 0);
    // fixing screws on the collar, instanced
    const scr = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.008, 0.008, 0.012, 6), this.steel, 8);
    const mS = new THREE.Matrix4(), qS = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
    [[-hw - 0.035, hh + 0.035], [hw + 0.035, hh + 0.035], [-hw - 0.035, -hh - 0.035], [hw + 0.035, -hh - 0.035],
     [0, hh + 0.035], [0, -hh - 0.035], [-hw - 0.035, 0], [hw + 0.035, 0]]
      .forEach(([sx, sy], i) => { mS.compose(new V3(sx, sy, 0.072), qS, new V3(1, 1, 1)); scr.setMatrixAt(i, mS); });
    scr.instanceMatrix.needsUpdate = true; grp.add(scr);

    // hinged louvre: pivot on the TOP edge, blades + backing plate below it
    const cover = new THREE.Group(); cover.position.set(0, hh, 0.055); grp.add(cover);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(O.w + 0.05, O.h + 0.04, 0.012), this.duct);
    plate.position.set(0, -O.h / 2, -0.004); plate.castShadow = plate.receiveShadow = true; cover.add(plate);
    const blades = new THREE.InstancedMesh(new THREE.BoxGeometry(O.w - 0.02, 0.045, 0.022), this.duct, 5);
    blades.castShadow = true;
    const mB = new THREE.Matrix4(), qB = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.42, 0, 0));
    for (let i = 0; i < 5; i++) { mB.compose(new V3(0, -0.065 - i * 0.098, 0.012), qB, new V3(1, 1, 1)); blades.setMatrixAt(i, mB); }
    blades.instanceMatrix.needsUpdate = true; cover.add(blades);
    // the two hinge knuckles it actually turns on
    for (const sx of [-1, 1]) {
      const kn = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.05, 8), this.steel);
      kn.rotation.z = Math.PI / 2; kn.position.set(sx * (hw - 0.06), 0, -0.008); cover.add(kn);
    }
    this.ventCover = cover;
  }

  /**
   * The drainage access — the floor screen's set piece. The floor now has a real
   * hole in it, so the pit is a place, not a decal: chamber walls, a sump and
   * climbing rungs going down into it.
   *
   * The grating is hinged on the FAR (+Z) edge and swings back past vertical, so
   * the whole aperture is clear before anything comes up through it.
   */
  _hatch(pos) {
    // tagged so the clearance audit can tell an access's own hardware apart
    // from room furniture: brushing your own doorframe is not a defect.
    const O = this.openings.hatch;
    const grp = new THREE.Group(); grp.position.copy(pos); this.group.add(grp);
    grp.userData.access = 'hatch';
    const R = O.w / 2;                       // 0.40
    const DEPTH = 0.72;
    const iron = this.iron;

    // --- the chamber: four walls, so looking in reads as depth ---------------
    // Was 0x2b2d31 and the beam turned the chamber into a pale grey box. A wet
    // drainage pit is nearly black; only the rungs should catch anything.
    const wallMat = this._mat(this._tex.concrete, 1, 1, { color: 0x14171a, roughness: 0.98, metalness: 0.0 });
    for (const [px, pz, sx, sz] of [[0, -R, O.w, 0.02], [0, R, O.w, 0.02], [-R, 0, 0.02, O.w], [R, 0, 0.02, O.w]]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(sx || 0.02, DEPTH, sz || 0.02), wallMat);
      s.position.set(px, -DEPTH / 2, pz); s.receiveShadow = true; grp.add(s);
    }
    const sump = new THREE.Mesh(new THREE.PlaneGeometry(O.w, O.w),
      new THREE.MeshStandardMaterial({ color: 0x0a0c0e, roughness: 0.35, metalness: 0.1 }));
    sump.rotation.x = -Math.PI / 2; sump.position.y = -DEPTH; sump.receiveShadow = true; grp.add(sump);
    // climbing rungs down the near wall: says a person goes down there
    const rung = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.016, 0.016, 0.26, 7), iron, 4);
    rung.castShadow = true;
    const mR = new THREE.Matrix4(), qR = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));
    for (let i = 0; i < 4; i++) { mR.compose(new V3(0, -0.14 - i * 0.17, R - 0.05), qR, new V3(1, 1, 1)); rung.setMatrixAt(i, mR); }
    rung.instanceMatrix.needsUpdate = true; grp.add(rung);

    // --- cast-iron kerb sitting proud of the slab ---------------------------
    // Three sides only: the -Z side is the walkway approach, and it is the side
    // anything climbing out steps over. A 35 mm kerb there was clipping the
    // creature's feet on every exit, so that edge is left flush with the slab.
    for (const [px, pz, sx, sz] of [[0, R + 0.045, O.w + 0.18, 0.09],
                                    [-R - 0.045, 0, 0.09, O.w], [R + 0.045, 0, 0.09, O.w]]) {
      const k = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.035, sz), iron);
      k.position.set(px, 0.017, pz); k.castShadow = k.receiveShadow = true; grp.add(k);
    }
    // flush nosing on the approach edge instead
    const nose = new THREE.Mesh(new THREE.BoxGeometry(O.w + 0.18, 0.012, 0.09), iron);
    nose.position.set(0, 0.006, -R - 0.045); nose.receiveShadow = true; grp.add(nose);

    // --- the grating: bearing bars on edge + transverse rods + a bolted frame
    // HINGE LINE. It used to sit at z=R, the inner face of the kerb, so the leaf
    // swept straight through the kerb on its way up and the opening looked
    // mechanically impossible. It now pivots OUTSIDE the kerb and above its top
    // face, which is where a surface-mounted hinge actually goes.
    const ZH = R + 0.09;
    const lid = new THREE.Group();
    // 0.055 put the under-welded cross rods at y=0.030, inside the kerb's own
    // 0..0.035 band, so the grating clipped its frame at every opening angle.
    // The leaf sits in a raised frame: 0.075 clears the kerb by 15 mm.
    lid.position.set(0, 0.075, ZH);
    grp.add(lid);
    const inner = ZH + R + 0.045;             // leaf reaches across the aperture
    const wIn = O.w - 0.05;
    for (const [sx, sz, px, pz] of [[wIn + 0.06, 0.05, 0, 0], [wIn + 0.06, 0.05, 0, -inner],
                                    [0.05, inner, -(wIn + 0.005) / 2, -inner / 2], [0.05, inner, (wIn + 0.005) / 2, -inner / 2]]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.038, sz), iron);
      f.position.set(px, 0, pz); f.castShadow = f.receiveShadow = true; lid.add(f);
    }
    // bearing bars: tall and thin, on edge — this is what a grating actually is
    const nBar = 11;
    const bars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.012, 0.034, inner), iron, nBar);
    bars.castShadow = bars.receiveShadow = true;
    const mB = new THREE.Matrix4(), qB = new THREE.Quaternion();
    for (let i = 0; i < nBar; i++) {
      mB.compose(new V3(-wIn / 2 + (i + 0.5) * (wIn / nBar), 0, -inner / 2), qB.identity(), new V3(1, 1, 1));
      bars.setMatrixAt(i, mB);
    }
    bars.instanceMatrix.needsUpdate = true; lid.add(bars);
    // Cross rods WELDED UNDER the bearing bars. They used to sit at y=-0.008,
    // inside the 34 mm depth of the bars themselves, so the two layers occupied
    // the same space and the grating read as passing through itself.
    const nRod = 5;
    const rods = new THREE.InstancedMesh(new THREE.BoxGeometry(wIn, 0.009, 0.009), iron, nRod);
    rods.castShadow = true;
    for (let i = 0; i < nRod; i++) {
      mB.compose(new V3(0, -0.0245, -0.05 - i * (inner - 0.12) / (nRod - 1)),
        qB.setFromEuler(new THREE.Euler(0, 0, 0.5)), new V3(1, 1, 1));
      rods.setMatrixAt(i, mB);
    }
    rods.instanceMatrix.needsUpdate = true; lid.add(rods);
    // recessed lifting handle at the free edge, and the two hinge knuckles
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.009, 5, 12, Math.PI), this.steel);
    handle.rotation.set(Math.PI / 2, 0, 0); handle.position.set(0, 0.02, -inner + 0.07);
    handle.castShadow = true; lid.add(handle);
    // Real hinges ON the hinge line, both halves, so the axis of rotation is
    // visible and the movement reads as hardware rather than a pivot in mid-air.
    for (const sx of [-1, 1]) {
      const kx = sx * (wIn / 2 - 0.08);
      const kn = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.075, 10), iron);
      kn.rotation.z = Math.PI / 2; kn.position.set(kx, 0, 0);
      kn.castShadow = true; lid.add(kn);
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.014, 0.10), iron);
      strap.position.set(kx, -0.008, -0.05); strap.castShadow = true; lid.add(strap);
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.07), iron);
      base.position.set(kx, 0.025, ZH + 0.045); base.castShadow = true; grp.add(base);
    }
    this.hatchLid = lid;
  }

  _clock(pos) {
    const grp = new THREE.Group(); grp.position.copy(pos); this.group.add(grp);
    const R = 512, C = R / 2;
    const cv = document.createElement('canvas'); cv.width = cv.height = R;
    const x = cv.getContext('2d');
    // The dial is repainted once the webfonts land (see onFontsReady), so the
    // whole paint has to live in a closure rather than run inline.
    const paintDial = () => {
    // DARK DIAL, PALE FIGURES — the opposite way round from before, and it fixes
    // two things at once. A large pale disc is both the brightest thing in frame
    // (so bloom spreads it until it clips and the hours vanish) and, once it had
    // been dimmed enough to stop that, it just looked filthy. Small bright glyphs
    // on a dark face bloom pleasantly instead of clipping, and stay readable.
    x.fillStyle = '#1c1e1f'; x.beginPath(); x.arc(C, C, C - 8, 0, 7); x.fill();
    x.strokeStyle = '#0d0e0f'; x.lineWidth = 12; x.stroke();
    // the shift ends at 6 — mark that sector so the goal is unmistakable
    x.fillStyle = 'rgba(190,48,36,0.22)';
    x.beginPath(); x.moveTo(C, C); x.arc(C, C, C - 20, -Math.PI / 2, Math.PI / 2); x.closePath(); x.fill();
    x.textAlign = 'center'; x.textBaseline = 'middle';
    for (let i = 1; i <= 12; i++) {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      const tx = C + Math.cos(a) * (C - 62), ty = C + Math.sin(a) * (C - 62);
      const six = (i === 6);
      x.fillStyle = six ? '#ff6a52' : '#e8e4d8';
      x.font = `${six ? 'bold ' : ''}${six ? 62 : 44}px ${CONFIG.fonts.stencil}`;
      x.fillText(String(i), tx, ty);
      // minute ticks
      x.beginPath();
      x.arc(C + Math.cos(a) * (C - 22), C + Math.sin(a) * (C - 22), i % 3 === 0 ? 7 : 4, 0, 7);
      x.fillStyle = '#cfcabc'; x.fill();
    }
    x.fillStyle = '#ff7a60'; x.font = `34px ${CONFIG.fonts.crt}`;
    x.fillText('SALIDA 06:00', C, C + 118);
    // A little grime, but far less: the two big blotches read as rust across the
    // whole dial and were half the reason it looked corroded rather than old.
    x.fillStyle = 'rgba(80,74,60,0.10)'; x.beginPath(); x.arc(C * 0.72, C * 1.22, 96, 0, 7); x.fill();
    };
    paintDial();

    const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace;
    // The figures are the whole point of this object, and they were being drawn
    // in a fallback font before Special Elite had loaded. Repaint when it lands.
    onFontsReady(() => { paintDial(); tx.needsUpdate = true; });
    // A clock face is painted pale on purpose, so its map is cream — and with no
    // colour multiplier that albedo went through untouched and the dial saturated
    // to flat white the moment the beam crossed it. You could not read the time,
    // which is the one thing this object exists to tell you. Same halving that
    // paintedPlate applies, for the same reason.
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.17, 32),
      new THREE.MeshStandardMaterial({ map: tx, color: 0xa8a8a8, roughness: 1.0, metalness: 0.0 }));
    face.position.z = 0.035; grp.add(face);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.016, 8, 32), this.instrument); rim.position.z = 0.035; grp.add(rim);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.175, 0.06, 24), this.instrument);
    body.rotation.x = Math.PI / 2; grp.add(body);
    // pale hands, because the dial they sit on is now dark
    const handMat = new THREE.MeshStandardMaterial({ color: 0xb8b2a4, roughness: 1.0, metalness: 0.0 });
    const mk = (len, wid) => { const m = new THREE.Mesh(new THREE.BoxGeometry(wid, len, 0.008), handMat); m.geometry.translate(0, len / 2, 0); m.position.z = 0.045; grp.add(m); return m; };
    this.clock = { grp, hour: mk(0.085, 0.017), minute: mk(0.135, 0.011) };
    this.setClock(0);
  }

  _props() {
    const w = CONFIG.room.W / 2, d = CONFIG.room.D / 2, h = CONFIG.room.H;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();

    // ceiling pipes (they slice the beam into moving shadow bars)
    // painted, because they carry painted colour-code bands (see addServices)
    const pipes = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, CONFIG.room.D, 10), this.pipePaint, 3);
    pipes.castShadow = true;
    [-1.15, 1.05, 1.25].forEach((x, i) => { m.compose(new V3(x, h - 0.13, 0), q.setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), new V3(1, 1, 1)); pipes.setMatrixAt(i, m); });
    pipes.instanceMatrix.needsUpdate = true; this.group.add(pipes);
    // (Three short rods used to hang here from nothing at all, tilted at random,
    //  crossing the cable tray. They represented no object and were the "bar in
    //  the middle of the room" that clipped everything. Deleted, not re-dressed.)

    // ---- LEFT WALL, FORWARD: a two-tier bracket shelf ----------------------
    // Added because the battery spots had to move somewhere the player can
    // actually see, and the left wall forward of the door had nothing on it to
    // stand a cell on.
    const brk2 = new THREE.Group(); brk2.position.set(-1.44, 0, -0.42); this.group.add(brk2);
    for (const [sy, sd] of [[0.64, 0.26], [0.28, 0.22]]) {
      const sh2 = new THREE.Mesh(new THREE.BoxGeometry(sd, 0.026, 0.52), this.bearer);
      sh2.position.set(sd / 2 - 0.01, sy, 0); sh2.castShadow = sh2.receiveShadow = true; brk2.add(sh2);
      // the angle bracket under it, which is what makes a shelf read as fixed
      for (const bz of [-0.20, 0.20]) {
        const ab = new THREE.Mesh(new THREE.BoxGeometry(sd - 0.03, 0.02, 0.02), this.dryMech);
        ab.position.set(sd / 2 - 0.02, sy - 0.02, bz); brk2.add(ab);
        const dg = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.10, 0.018), this.dryMech);
        dg.position.set(0.02, sy - 0.06, bz); dg.rotation.z = -0.7; brk2.add(dg);
      }
    }

    // ---- LEFT-BACK: shelving on the left wall, clear of the door aperture ----
    const shelf = new THREE.Group(); shelf.position.set(-1.34, 0, 1.20); this.group.add(shelf);
    for (let i = 0; i < 3; i++) {
      // timber shelves in a steel frame: the unit no longer shares a look with
      // the duct louvre two metres away, which is what made them read as one thing
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.55), this.bearer);
      s.position.set(0, 0.35 + i * 0.3, 0); s.castShadow = s.receiveShadow = true; shelf.add(s);
    }
    for (const sz of [-0.25, 0.25]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.98, 0.04), this.tubeFrame);
      p.position.set(0, 0.49, sz); p.castShadow = true; shelf.add(p);
    }
    // stock on the shelves, so it is storage rather than empty planks
    const tin = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.045, 0.045, 0.13, 10), this.rust, 5);
    tin.castShadow = true;
    [[0.435, -0.16], [0.435, -0.02], [0.735, 0.13], [0.735, -0.05], [0.135, 0.16]]
      .forEach(([y, z], i) => { m.compose(new V3(-1.34, y, 1.20 + z), q.identity(), new V3(1, 1, 1)); tin.setMatrixAt(i, m); });
    tin.instanceMatrix.needsUpdate = true; this.group.add(tin);

    // ---- RIGHT-BACK: stacked crates, out of every approach lane -------------
    const crates = new THREE.InstancedMesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), this.timber, 3);
    crates.castShadow = crates.receiveShadow = true;
    [[0.80, 0.28, 1.30, 0.3], [0.76, 0.83, 1.26, 0.5], [0.42, 0.28, 1.34, -0.2]]
      .forEach(([x, y, z, ry], i) => { m.compose(new V3(x, y, z), q.setFromEuler(new THREE.Euler(0, ry, 0)), new V3(1, 1, 1)); crates.setMatrixAt(i, m); });
    crates.instanceMatrix.needsUpdate = true; this.group.add(crates);

    // ---- instanced hardware: hundreds of bolts/seams for ONE draw call ----
    const boltGeo = new THREE.CylinderGeometry(0.011, 0.013, 0.012, 6);
    const bolts = [];
    const pushBolt = (x, y, z, rx, ry) => bolts.push([x, y, z, rx, ry]);
    // bolt rows along the wall panel seams
    // Bolt rows must not run across an aperture: they were being driven into
    // thin air where the door and window holes are, and the door row sat 2 cm
    // inside anything standing in the opening.
    const Od = this.openings.door, Ow = this.openings.window;
    const inDoor = (z) => z > Od.z - Od.w / 2 - 0.06 && z < Od.z + Od.w / 2 + 0.06;
    const inWin = (z, y) => z > Ow.z - Ow.w / 2 - 0.06 && z < Ow.z + Ow.w / 2 + 0.06
                            && y > Ow.y - Ow.h / 2 - 0.06 && y < Ow.y + Ow.h / 2 + 0.06;
    for (let i = 0; i < 7; i++) {
      const z = -1.35 + i * 0.45;
      if (!inDoor(z)) { pushBolt(-w + 0.012, 0.16, z, 0, Math.PI / 2); pushBolt(-w + 0.012, 1.62, z, 0, Math.PI / 2); }
      if (!inWin(z, 0.16)) pushBolt(w - 0.012, 0.16, z, 0, -Math.PI / 2);
      if (!inWin(z, 1.62)) pushBolt(w - 0.012, 1.62, z, 0, -Math.PI / 2);
    }
    const Oc = this.openings.corridor, Ov = this.openings.vent;
    for (let i = 0; i < 6; i++) {
      const x = -1.25 + i * 0.5;
      // two of these columns were fixed into thin air: one pair inside the
      // corridor mouth, one inside the duct aperture.
      const inCorr = Math.abs(x - Oc.x) < Oc.w / 2 + 0.06;
      const inVent = Math.abs(x - Ov.x) < Ov.w / 2 + 0.06;
      if (inCorr) continue;
      if (!inVent) pushBolt(x, 0.16, -d + 0.012, Math.PI / 2, 0);
      pushBolt(x, 2.28, -d + 0.012, Math.PI / 2, 0);
    }
    const boltMesh = new THREE.InstancedMesh(boltGeo, this.dryMech, bolts.length);
    boltMesh.castShadow = true; boltMesh.receiveShadow = true;
    bolts.forEach(([x, y, z, rx, ry], i) => {
      m.compose(new V3(x, y, z), q.setFromEuler(new THREE.Euler(rx, ry, 0)), new V3(1, 1, 1));
      boltMesh.setMatrixAt(i, m);
    });
    boltMesh.instanceMatrix.needsUpdate = true; this.group.add(boltMesh);

    // horizontal panel seams (recessed strips) - one instanced batch
    // Split at the apertures for the same reason as the bolts.
    const seamRuns = [];
    for (const [x, y, skip] of [[-w + 0.011, 1.62, 'door'], [-w + 0.011, 0.16, 'door'],
                                [w - 0.011, 1.62, 'win'], [w - 0.011, 0.16, 'win']]) {
      const hole = skip === 'door'
        ? [Od.z - Od.w / 2, Od.z + Od.w / 2]
        : (y > Ow.y - Ow.h / 2 && y < Ow.y + Ow.h / 2 ? [Ow.z - Ow.w / 2, Ow.z + Ow.w / 2] : null);
      if (!hole) { seamRuns.push([x, y, -d + 0.025, d - 0.025]); continue; }
      seamRuns.push([x, y, -d + 0.025, hole[0]], [x, y, hole[1], d - 0.025]);
    }
    seamRuns.forEach(([x, y, z0, z1]) => {
      const len = z1 - z0; if (len < 0.05) return;
      const sm = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.022, len), this.dryMech);
      sm.position.set(x, y, (z0 + z1) / 2); sm.receiveShadow = true; this.group.add(sm);
    });

    // pipe brackets clamping the ceiling runs
    const brGeo = new THREE.TorusGeometry(0.062, 0.012, 5, 10, Math.PI);
    const brackets = new THREE.InstancedMesh(brGeo, this.dryMech, 9);
    brackets.castShadow = true;
    let bi = 0;
    for (const px of [-1.15, 1.05, 1.25]) for (const pz of [-1.1, 0, 1.1]) {
      m.compose(new V3(px, h - 0.13, pz), q.setFromEuler(new THREE.Euler(0, 0, 0)), new V3(1, 1, 1));
      brackets.setMatrixAt(bi++, m);
    }
    brackets.instanceMatrix.needsUpdate = true; this.group.add(brackets);

    // conduit running down the corner + a junction box (reads as a real build)
    const conduit = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.9, 8), this.duct);
    conduit.position.set(-w + 0.06, 1.2, -d + 0.09); conduit.castShadow = true; this.group.add(conduit);
    const jbox = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.08), this.boxPaint);
    jbox.position.set(-w + 0.07, 0.5, -d + 0.1); jbox.castShadow = true; this.group.add(jbox);

    // skirting so walls meet the floor with a real edge, not a seam
    // Skirting used to run wall-to-wall on both sides, straight ACROSS the door
    // aperture — a doorway with a plinth through it, and 3 cm of it inside every
    // creature that stood in the opening. It now stops at each side of the hole.
    const OPd = this.openings.door, dz0 = OPd.z - OPd.w / 2, dz1 = OPd.z + OPd.w / 2;
    const runs = [
      [-w + 0.015, -d, dz0], [-w + 0.015, dz1, d],          // left wall, split
      [w - 0.015, -d, d],                                    // right wall, continuous
    ];
    runs.forEach(([x, z0, z1]) => {
      const len = z1 - z0; if (len < 0.05) return;
      const sk = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.09, len), this.formed);
      sk.position.set(x, 0.045, (z0 + z1) / 2); sk.receiveShadow = true; this.group.add(sk);
    });

    // ---- ZONE IDENTITY: each wall now reads as a specific part of a plant ---
    // LEFT-BACK = maintenance bench. Something a night watchman actually uses,
    // and the natural place to find spare cells.
    // Moved back against the rear corner: at z=0.95 this bench stood squarely
    // across the doorway approach and hid the door itself.
    // Moved off the LEFT wall and turned to run along the BACK wall. It used to
    // stand at x=-1.02 z=1.19 with a 1.15 m top, which pushed it 0.27 m THROUGH
    // the back wall and made it overlap the old desk — the two pieces of
    // furniture were inside each other. There is now one work surface, not two.
    const bench = new THREE.Group(); bench.position.set(-0.42, 0, 1.21); this.group.add(bench);
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.06, 0.52), this.plywood);
    top.position.set(0, 0.88, 0); top.castShadow = top.receiveShadow = true; bench.add(top);
    // an apron under the front edge, so it is joinery and not a floating slab
    const apron = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.09, 0.03), this.painted);
    apron.position.set(0, 0.80, -0.245); apron.castShadow = true; bench.add(apron);
    for (const [bx, bz] of [[-0.42, -0.21], [0.42, -0.21], [-0.42, 0.21], [0.42, 0.21]]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.88, 0.06), this.tubeFrame);
      l.position.set(bx, 0.44, bz); l.castShadow = true; bench.add(l);
    }
    // lower stock shelf between the legs
    const under = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.025, 0.42), this.tubeFrame);
    under.position.set(0, 0.24, 0); under.castShadow = under.receiveShadow = true; bench.add(under);
    const backboard = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.5, 0.035), this.bearer);
    backboard.position.set(0, 1.16, 0.24); backboard.castShadow = true; bench.add(backboard);
    // tools hanging on the backboard: instanced, one draw call
    const tools = new THREE.InstancedMesh(new THREE.BoxGeometry(0.03, 0.22, 0.03), this.stainless, 5);
    tools.castShadow = true;
    for (let i = 0; i < 5; i++) {
      m.compose(new V3(-0.42 - 0.34 + i * 0.17, 1.14, 1.21 + 0.20),
        q.setFromEuler(new THREE.Euler(0, 0, (i % 2 ? 1 : -1) * 0.12)), new V3(1, 1, 1));
      tools.setMatrixAt(i, m);
    }
    tools.instanceMatrix.needsUpdate = true; this.group.add(tools);
    const vice = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.13, 0.14), this.dryMech);
    vice.position.set(0.34, 0.97, -0.12); vice.castShadow = true; bench.add(vice);

    // ---- the watchman's chair ------------------------------------------------
    // A manned post with nothing to sit on was the clearest "unfinished" tell in
    // the room. Tubular frame, worn ply seat and back: a real object, and it
    // stands where no approach route passes.
    const chair = new THREE.Group(); chair.position.set(-0.42, 0, 0.86); chair.rotation.y = 0.22; this.group.add(chair);
    // tubular galvanised frame, aged ply seat, rubber feet: three substances,
    // where before the whole chair was the one generic metal.
    const seatMat = this.plywood, frameMat = this.tubeFrame;
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.035, 0.38), seatMat);
    seat.position.y = 0.44; seat.castShadow = seat.receiveShadow = true; chair.add(seat);
    // slight lip at the front of the pan
    const lip2 = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.03, 0.035), seatMat);
    lip2.position.set(0, 0.428, -0.19); lip2.rotation.x = 0.35; chair.add(lip2);
    // splayed tubular legs
    for (const [lx, lz] of [[-0.17, -0.15], [0.17, -0.15], [-0.17, 0.15], [0.17, 0.15]]) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.44, 7), frameMat);
      l.position.set(lx * 1.06, 0.22, lz * 1.06);
      l.rotation.z = -Math.sign(lx) * 0.055; l.rotation.x = Math.sign(lz) * 0.055;
      l.castShadow = true; chair.add(l);
    }
    // cross-braces between the legs
    for (const [bz, bl] of [[-0.15, 0.34], [0.15, 0.34]]) {
      const br = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, bl, 6), frameMat);
      br.rotation.z = Math.PI / 2; br.position.set(0, 0.14, bz); br.castShadow = true; chair.add(br);
    }
    // back uprights continuing from the rear legs, and the back panel
    for (const bx of [-0.17, 0.17]) {
      const u = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.44, 7), frameMat);
      u.position.set(bx, 0.65, 0.17); u.rotation.x = -0.12; u.castShadow = true; chair.add(u);
    }
    const backRest = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.028), seatMat);
    backRest.position.set(0, 0.80, 0.205); backRest.rotation.x = -0.12;
    backRest.castShadow = backRest.receiveShadow = true; chair.add(backRest);
    const backLow = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.07, 0.026), seatMat);
    backLow.position.set(0, 0.63, 0.185); backLow.rotation.x = -0.12; backLow.castShadow = true; chair.add(backLow);

    // RIGHT-BACK = electrical distribution. Tells you where the power is.
    // ---- BREAKER CABINET, rebuilt ------------------------------------------
    // The old one was a plain box with a thin flat plate hung off it, in the same
    // grey as everything else: no depth, no reveal, no frame, so neither the
    // enclosure nor the door had a readable shape. A distribution board reads
    // through its proportions and its EDGES — a deep enclosure, a rolled-lip
    // door standing proud of it, and a shadow gap between the two.
    const CW = 0.24, CH = 1.06, CD = 0.60;         // wall-depth, height, along-wall
    const cab = new THREE.Group(); cab.position.set(w - CW / 2 - 0.01, 1.02, 1.02); this.group.add(cab);
    // the enclosure: galvanised sheet, recessed back so the door has a rebate
    const box2 = new THREE.Mesh(new THREE.BoxGeometry(CW, CH, CD), this.boxPaint);
    box2.castShadow = box2.receiveShadow = true; cab.add(box2);
    // returned flange all round the opening: this is the edge that makes it read
    for (const [sy, sz, py, pz] of [[0.035, CD, CH / 2 - 0.017, 0], [0.035, CD, -CH / 2 + 0.017, 0],
                                    [CH, 0.035, 0, CD / 2 - 0.017], [CH, 0.035, 0, -CD / 2 + 0.017]]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.05, sy, sz), this.boxPaint);
      f.position.set(-CW / 2 - 0.024, py, pz); f.castShadow = f.receiveShadow = true; cab.add(f);
    }
    // breaker rows on the back plane, behind the door
    const brk = new THREE.InstancedMesh(new THREE.BoxGeometry(0.028, 0.052, 0.019), this.tech, 18);
    for (let i = 0; i < 18; i++) {
      m.compose(new V3(-0.085, 0.30 - (i % 9) * 0.062, -0.13 + Math.floor(i / 9) * 0.24), q.identity(), new V3(1, 1, 1));
      brk.setMatrixAt(i, m);
    }
    brk.instanceMatrix.needsUpdate = true; cab.add(brk);
    // DIN rails the breakers clip onto
    for (const rz of [-0.13, 0.11]) {
      const r2 = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.60, 0.035), this.alu);
      r2.position.set(-0.075, 0.03, rz); cab.add(r2);
    }
    // the door: a shallow pressed panel with a rolled lip, on a real hinge line,
    // opened 38 deg — far enough to show the board, shallow enough that the
    // door's own shape stays legible.
    const cabHinge = new THREE.Group();
    cabHinge.position.set(-CW / 2 - 0.028, 0, -CD / 2 + 0.02);
    // 38 deg swung the leaf across the whole enclosure from the player's side, so
    // the thing you were meant to identify was hidden behind its own door. Barely
    // ajar instead: the box, the flange and the leaf all read, and the label that
    // names it now lives on the OUTSIDE of the door where it can be seen.
    cabHinge.rotation.y = -0.22; cab.add(cabHinge);
    const leafD = CD - 0.05;
    const doorPanel = new THREE.Mesh(new THREE.BoxGeometry(0.026, CH - 0.05, leafD), this.chipped);
    doorPanel.geometry.translate(0, 0, leafD / 2);
    doorPanel.castShadow = doorPanel.receiveShadow = true; cabHinge.add(doorPanel);
    // rolled lip around the leaf: the detail that gives it thickness
    for (const [ly, lz, sy, sz] of [[(CH - 0.05) / 2 - 0.012, leafD / 2, 0.024, leafD],
                                    [-(CH - 0.05) / 2 + 0.012, leafD / 2, 0.024, leafD],
                                    [0, leafD - 0.012, CH - 0.05, 0.024]]) {
      const lp = new THREE.Mesh(new THREE.BoxGeometry(0.05, sy, sz), this.chipped);
      lp.position.set(-0.014, ly, lz); lp.castShadow = true; cabHinge.add(lp);
    }
    // latch: a plastic handle in a stainless escutcheon, at hand height
    const esc = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.012, 12), this.stainless);
    esc.rotation.z = Math.PI / 2; esc.position.set(-0.028, 0.0, leafD - 0.07); cabHinge.add(esc);
    const cabHandle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.085, 0.026), this.tech);
    cabHandle.position.set(-0.046, 0.0, leafD - 0.07); cabHandle.castShadow = true; cabHinge.add(cabHandle);
    // hinges, both halves
    for (const ky of [-0.38, 0.0, 0.38]) {
      const kn = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.0125, 0.055, 10), this.stainless);
      kn.position.set(0, ky, 0); kn.castShadow = true; cabHinge.add(kn);
    }
    // rubber gasket around the frame: the seal you would actually find here
    const gask = new THREE.Mesh(new THREE.BoxGeometry(0.012, CH - 0.10, 0.012), this.rubber);
    gask.position.set(-CW / 2 - 0.006, 0, -CD / 2 + 0.03); cab.add(gask);
    // the identity plate, on the door, facing the room
    const cabTag = paintedPlate(0.34, 0.13, (c, W, H) => {
      c.fillStyle = '#1a1d20'; c.fillRect(0, 0, W, H);
      c.strokeStyle = '#8b9084'; c.lineWidth = 4;
      c.strokeRect(W * 0.06, H * 0.14, W * 0.88, H * 0.72);
      c.fillStyle = '#d6dbc8'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = Math.round(H * 0.34) + 'px ' + CONFIG.fonts.stencil;
      c.fillText('CUADRO', W / 2, H * 0.38);
      c.fillStyle = '#c05a3c';
      c.font = Math.round(H * 0.26) + 'px ' + CONFIG.fonts.crt;
      c.fillText('400 V', W / 2, H * 0.70);
    }, { px: 384 });
    cabTag.rotation.y = -Math.PI / 2;
    cabTag.position.set(-0.016, 0.16, leafD * 0.55); cabHinge.add(cabTag);
    // (the old 12-breaker block that used to sit here is gone: the rebuilt
    //  cabinet above carries 18 of them on real DIN rails.)

    // ---- RIGHT-FRONT: a dead transfer pump ---------------------------------
    // Previously a bare cylinder with a valve wheel hovering beside it, which
    // read exactly as the user described: a barrel with an inexplicable valve
    // over it. A pump is legible only when you can see where the fluid GOES, so
    // the set now states the whole path — suction out of the floor, casing,
    // motor, discharge rising through an isolating valve and elbowing into the
    // wall — plus the plinth it is bolted to.
    const pump = new THREE.Group(); pump.position.set(1.24, 0, -1.05); this.group.add(pump);
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.11, 0.40), this._mat(this._tex.concrete, 1, 1, { color: 0x3c3f43, roughness: 0.97 }));
    plinth.position.y = 0.055; plinth.castShadow = plinth.receiveShadow = true; pump.add(plinth);
    // holding-down bolts
    const hd = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.011, 0.011, 0.05, 6), this.steel, 4);
    [[-0.16, -0.14], [0.16, -0.14], [-0.16, 0.14], [0.16, 0.14]]
      .forEach(([bx, bz], i) => { m.compose(new V3(1.24 + bx, 0.13, -1.05 + bz), q.identity(), new V3(1, 1, 1)); hd.setMatrixAt(i, m); });
    hd.instanceMatrix.needsUpdate = true; this.group.add(hd);
    // volute casing, lying on its axis the way a real pump does
    const casing = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.17, 14), this.greasy);
    casing.rotation.x = Math.PI / 2; casing.position.set(0, 0.24, -0.06);
    casing.castShadow = casing.receiveShadow = true; pump.add(casing);
    // electric motor: ribbed barrel + terminal box, coupled to the casing
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.30, 14), this.alu);
    motor.rotation.x = Math.PI / 2; motor.position.set(0, 0.24, 0.20);
    motor.castShadow = motor.receiveShadow = true; pump.add(motor);
    const fins = new THREE.InstancedMesh(new THREE.TorusGeometry(0.107, 0.007, 4, 14), this.alu, 7);
    for (let i = 0; i < 7; i++) { m.compose(new V3(1.24, 0.24, -1.05 + 0.08 + i * 0.04), q.identity(), new V3(1, 1, 1)); fins.setMatrixAt(i, m); }
    fins.instanceMatrix.needsUpdate = true; this.group.add(fins);
    const term = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.07, 0.13), this.equip);
    term.position.set(0, 0.35, 0.20); term.castShadow = true; pump.add(term);
    const coupling = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.07, 10), this.steel);
    coupling.rotation.x = Math.PI / 2; coupling.position.set(0, 0.24, 0.035); pump.add(coupling);
    // suction: down through the slab
    const suction = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.20, 10), this.greasy);
    suction.position.set(0, 0.10, -0.145); pump.add(suction);
    const sBend = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.052, 8, 10, Math.PI / 2), this.greasy);
    sBend.rotation.set(0, Math.PI / 2, Math.PI / 2); sBend.position.set(0, 0.20, -0.145); pump.add(sBend);
    // discharge: up the wall, through the valve, then an elbow INTO the wall
    const riser = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 1.62, 10), this.greasy);
    riser.position.set(0, 1.14, -0.06); riser.castShadow = true; pump.add(riser);
    const elbow = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.052, 8, 12, Math.PI / 2), this.greasy);
    elbow.rotation.set(0, 0, 0); elbow.position.set(0.075, 1.95, -0.06); elbow.castShadow = true; pump.add(elbow);
    const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.20, 10), this.greasy);
    stub.rotation.z = Math.PI / 2; stub.position.set(0.175, 2.025, -0.06); pump.add(stub);
    // the isolating valve the wheel actually belongs to
    const vBody = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.13, 12), this.dryMech);
    vBody.position.set(0, 0.92, -0.06); vBody.castShadow = true; pump.add(vBody);
    for (const fy of [0.855, 0.985]) {
      const fl2 = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.082, 0.022, 12), this.dryMech);
      fl2.position.set(0, fy, -0.06); pump.add(fl2);
    }
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.14, 8), this.steel);
    stem.rotation.z = Math.PI / 2; stem.position.set(-0.10, 0.92, -0.06); pump.add(stem);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.015, 6, 16), this.iron);
    wheel.position.set(-0.17, 0.92, -0.06); wheel.rotation.y = Math.PI / 2;
    wheel.castShadow = true; pump.add(wheel);
    for (let i = 0; i < 3; i++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.013, 0.20, 0.013), this.dryMech);
      spoke.position.set(-0.17, 0.92, -0.06); spoke.rotation.x = i * 1.047;
      spoke.castShadow = true; pump.add(spoke);
    }
    // pressure gauge on the discharge, above the valve
    const gTap = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.07, 6), this.steel);
    gTap.rotation.z = Math.PI / 2; gTap.position.set(-0.085, 1.22, -0.06); pump.add(gTap);
    const gBody = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.022, 14), this.instrument);
    gBody.rotation.z = Math.PI / 2; gBody.position.set(-0.13, 1.22, -0.06); gBody.castShadow = true; pump.add(gBody);
    const gFace = new THREE.Mesh(new THREE.CircleGeometry(0.036, 16),
      new THREE.MeshStandardMaterial({ color: 0x6f6d66, roughness: 0.72 }));
    gFace.rotation.y = -Math.PI / 2; gFace.position.set(-0.142, 1.22, -0.06); pump.add(gFace);
    // A machine with no name is a prop. This one has a rating plate, which is
    // what makes the valve, the gauge and the pipework read as one device.
    const nameplate = paintedPlate(0.17, 0.075, (c, W, H) => {
      c.fillStyle = '#20242a'; c.fillRect(0, 0, W, H);
      c.strokeStyle = '#7d8274'; c.lineWidth = 4; c.strokeRect(4, 4, W - 8, H - 8);
      c.fillStyle = '#c6cbb8'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = Math.round(H * 0.46) + 'px ' + CONFIG.fonts.stencil;
      c.fillText('BOMBA B-2', W / 2, H / 2);
    }, { px: 256 });
    nameplate.rotation.y = -Math.PI / 2;
    nameplate.position.set(1.24 - 0.108, 0.30, -1.05); this.group.add(nameplate);

    // ---- what this wall IS -------------------------------------------------
    // The right wall carried a window, a pump and a switchboard with nothing to
    // tie them together. One plate high up names the space on the other side of
    // the glass, and then all three objects belong to the same story: the hall
    // is through there, the pump serves it, the board feeds it.
    const zone = paintedPlate(0.66, 0.20, (c, W, H) => {
      c.fillStyle = '#1b1f22'; c.fillRect(0, 0, W, H);
      c.strokeStyle = '#c2c8b6'; c.lineWidth = 5; c.strokeRect(8, 8, W - 16, H - 16);
      c.fillStyle = '#d4dac6'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = Math.round(H * 0.40) + 'px ' + CONFIG.fonts.stencil;
      c.fillText('SALA DE MAQUINAS', W / 2, H * 0.40);
      // an arrow pointing down at the opening it refers to
      c.fillStyle = '#c2c8b6';
      c.beginPath(); c.moveTo(W / 2, H * 0.88); c.lineTo(W / 2 - H * 0.16, H * 0.64);
      c.lineTo(W / 2 + H * 0.16, H * 0.64); c.closePath(); c.fill();
    }, { px: 512 });
    zone.rotation.y = -Math.PI / 2;
    zone.position.set(w - 0.025, 2.06, this.openings.window.z); this.group.add(zone);

    // hazard stripe on the floor at the corridor threshold (scale + reading)
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(1.34, 0.13), new THREE.MeshBasicMaterial({ color: 0x2b2410, toneMapped: false }));
    stripe.rotation.x = -Math.PI / 2; stripe.position.set(0, 0.006, -1.15); this.group.add(stripe);

    // ---- damp patches -----------------------------------------------------
    // These were three PERFECT CIRCLES lying on the slab with nothing above them,
    // which is exactly why they read as unexplained discs instead of as water.
    // Two changes: an irregular outline, and each one placed directly beneath a
    // pipe coupling, so there is a visible reason for the floor to be wet.
    const wet = new THREE.MeshStandardMaterial({ color: 0x0e1014, roughness: 0.16, metalness: 0.05 });
    const puddle = (r) => {
      const N = 26, pos = [0, 0, 0], idx = [];
      for (let i = 0; i < N; i++) {
        const rr = r * (0.62 + 0.38 * Math.abs(Math.sin(i * 2.7) * Math.cos(i * 1.31)));
        const a = (i / N) * Math.PI * 2;
        pos.push(Math.cos(a) * rr, 0, Math.sin(a) * rr);
        idx.push(0, 1 + i, 1 + ((i + 1) % N));
      }
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      gg.setIndex(idx); gg.computeVertexNormals();
      return gg;
    };
    for (const [px, pz, r] of [[-1.12, -0.62, 0.26], [1.08, 0.30, 0.19]]) {
      const pd = new THREE.Mesh(puddle(r), wet);
      pd.position.set(px, 0.004, pz); pd.receiveShadow = true; this.group.add(pd);
      const joint = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.07, 10), this.pipePaint);
      joint.rotation.x = Math.PI / 2; joint.position.set(px, h - 0.13, pz);
      joint.castShadow = true; this.group.add(joint);
      const drip = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.004, 0.16, 6), wet);
      drip.position.set(px, h - 0.24, pz); this.group.add(drip);
    }
  }

  _lights() {
    const h = CONFIG.room.H;
    const tube = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.06, 0.1), new THREE.MeshBasicMaterial({ color: 0x0a0d12, toneMapped: false }));
    tube.position.set(0, h - 0.05, 0.4); this.group.add(tube);
    const fluo = new THREE.PointLight(0xbcd0ea, 0, 9, 2); fluo.position.set(0, h - 0.12, 0.4); this.group.add(fluo);

    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x661414, toneMapped: false }));
    dome.position.set(CONFIG.room.W / 2 - 0.06, 2.15, 1.2); dome.rotation.z = Math.PI / 2; this.group.add(dome);
    // The emitter sat 0.18 m away from its own dome and 0.05 m lower, so the red
    // wash on the right wall demonstrably came from somewhere the beacon wasn't.
    // It now sits INSIDE the shell it belongs to, which is the whole point of a
    // luminaire: the light and the fitting have to agree.
    const emg = new THREE.PointLight(0x8a221a, 3.4, 6.5, 2);
    emg.position.copy(dome.position); this.group.add(emg);
    // a back plate, so the fitting is mounted to something
    const emgBack = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.025, 12), this.instrument);
    emgBack.rotation.z = Math.PI / 2; emgBack.position.set(CONFIG.room.W / 2 - 0.022, 2.15, 1.2);
    emgBack.castShadow = true; this.group.add(emgBack);
    // A fire-alarm beacon whose driver has failed: it keeps trying to strobe,
    // never quite manages it, and drifts between red and a sickly orange.
    const cage = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.008, 5, 10), this.steel);
    cage.position.copy(dome.position); cage.rotation.z = Math.PI / 2; this.group.add(cage);
    this.lights = { fluo, fluoMesh: tube, emergency: emg, emgDome: dome, emgBase: 3.4 };
    this._emgT = 0; this._emgLevel = 1;
  }

  // ---- animated state ----------------------------------------------------
  // ===== PERSISTENT ACCESSES ==============================================
  // Every way into this room starts the night SHUT. Each time a creature pushes
  // through, the access moves one notch further open and stays there — the room
  // is permanently degraded by what has been coming in. Sound is emitted only on
  // a real state change, so a fully-open door never "opens" again.
  _initAccesses() {
    const mk = (kind, steps, pan) => ({ kind, steps, pan, state: 0, anim: 0, target: 0, tellT: 0, pending: 0, push: 0, pushT: 0 });
    this.accesses = {
      door: mk('door', 3, -0.95),
      vent: mk('vent', 3, -0.35),
      hatch: mk('hatch', 3, 0.30),
    };
    // Do NOT clobber the handler here: _initAccesses() runs lazily on the first
    // update(), which is AFTER the Game has registered its callback — resetting
    // it silently killed every door/vent/hatch sound in normal play.
    if (typeof this.onAccessSound !== 'function') this.onAccessSound = null;
  }

  resetAccesses() {
    if (!this.accesses) this._initAccesses();
    for (const a of Object.values(this.accesses)) { a.state = 0; a.anim = 0; a.target = 0; a.tellT = 0; a.pending = 0; a.push = 0; a.pushT = 0; }
  }

  /** A creature forces this access one notch wider. No-op once fully open. */
  openStep(name) {
    const a = this.accesses && this.accesses[name];
    if (!a || a.state >= a.steps) return false;   // already wide open: nothing to hear
    a.pending = 1; a.tellT = 0.42;                // it shudders first, then gives
    return true;
  }

  /** A creature backs out. A partially open access is pulled shut a notch;
   *  one already forced fully open stays that way for the rest of the night. */
  closeStep(name) {
    const a = this.accesses && this.accesses[name];
    if (!a || a.state <= 0 || a.state >= a.steps) return false;
    a.pending = -1; a.tellT = 0.12;
    return true;
  }

  accessState(name) { const a = this.accesses && this.accesses[name]; return a ? a.state : 0; }

  /** How far an access has ACTUALLY travelled, not just what was requested.
   *  Creatures gate their movement on this so nothing crosses closed geometry. */
  accessOpenness(name) {
    const a = this.accesses && this.accesses[name];
    if (!a) return { state: 99, steps: 1, anim: 1, moving: false };
    return { state: a.state, steps: a.steps, anim: a.anim, moving: a.tellT > 0 || a.pushT > 0 || Math.abs(a.target - a.anim) > 0.04 };
  }

  /**
   * Lean on an access. `frac` is 0..1 of the way to the NEXT notch, so a creature
   * crossing a threshold can drive the leaf directly from its own progress.
   *
   * This is what makes an access feel like an object rather than a state machine:
   * the previous version opened a notch on a timer and the creature waited for
   * it, so the two never touched. Now the door moves BECAUSE something is pushing
   * it, at the speed that thing is moving, and stops the moment it stops pushing.
   */
  push(name, frac) {
    const a = this.accesses && this.accesses[name];
    if (!a) return;
    a.pushT = 0.12;                       // released if nothing renews it
    const next = Math.min(1, (a.state + 1) / a.steps);
    a.push = Math.max(a.state / a.steps, Math.min(next, a.state / a.steps + (next - a.state / a.steps) * clamp01(frac)));
  }

  _applyAccess(a, dt, t) {
    // the shudder that precedes any movement
    if (a.tellT > 0) {
      a.tellT -= dt;
      if (a.tellT <= 0 && a.pending !== 0) {
        a.state = Math.max(0, Math.min(a.steps, a.state + a.pending));
        a.target = a.state / a.steps;
        if (this.onAccessSound) this.onAccessSound(a.kind, a.state || 1, a.pan, a.pending < 0);
        a.pending = 0;
      }
    }
    // A live push overrides the eased travel: the leaf tracks the body directly.
    // When the push is released the leaf falls back on its own, which is what
    // gives you "it started to open, then swung shut again" for free.
    if (a.pushT > 0) {
      a.pushT -= dt;
      a.anim += (Math.max(a.target, a.push || 0) - a.anim) * Math.min(1, dt * 14);
    } else {
      a.push = 0;
      a.anim += (a.target - a.anim) * Math.min(1, dt * 3.2);
    }
    const shudder = a.tellT > 0 ? Math.min(1, a.tellT / 0.42) : 0;

    if (a.kind === 'door' && this.doorPivot) {
      // 0 -> shut, 1 -> wide. Hinge groan wobble while it travels.
      this.doorPivot.rotation.y = -a.anim * 1.05 + Math.sin(t * 46) * 0.012 * shudder;
    } else if (a.kind === 'vent' && this.ventCover) {
      // top-hinged: the louvre lifts up and OUT, so the mouth ends up unobstructed
      this.ventCover.rotation.x = -a.anim * 1.72 + Math.sin(t * 74) * 0.06 * shudder;
      this.ventCover.position.x = Math.sin(t * 91) * 0.007 * shudder;
    } else if (a.kind === 'hatch' && this.hatchLid) {
      // hinged on the far edge and thrown back past vertical: at full travel the
      // grating rests on the slab BEYOND the pit, leaving the whole aperture
      // clear. It used to lean across the opening the creature climbs through.
      const bump = shudder * Math.max(0, Math.sin(t * 15)) * 0.05;
      this.hatchLid.position.y = 0.035 + bump;
      this.hatchLid.rotation.x = a.anim * 1.95;
      this.hatchLid.rotation.z = bump * 0.6;
    }
  }

  update(dt) {
    this._t = (this._t || 0) + dt;
    if (!this.accesses) this._initAccesses();

    // --- failing alarm beacon: irregular strobe attempts + slow colour drift --
    const L = this.lights;
    // During a jumpscare the game owns every light in the room, so skip the
    // normal beacon behaviour instead of fighting it.
    if (L && L.emergency && this.alarmOverride) {
      const st = Math.sin(this._t * 34) > -0.25 ? 1 : 0.25;
      L.emergency.intensity = 7.5 * st;
      L.emergency.color.setHSL(0.015, 0.9, 0.42);
      if (L.emgDome) L.emgDome.material.color.setHSL(0.015, 1.0, 0.36 * st);
    } else if (L && L.emergency) {
      this._emgT -= dt;
      if (this._emgT <= 0) {
        // never a fixed rhythm: sometimes a stutter, sometimes a long sulk
        const r = Math.random();
        this._emgLevel = r < 0.18 ? 1.9 : r < 0.55 ? 0.85 : 0.35;
        this._emgT = r < 0.18 ? 0.07 + Math.random() * 0.12 : 0.35 + Math.random() * 2.2;
      }
      const want = L.emgBase * this._emgLevel;
      L.emergency.intensity += (want - L.emergency.intensity) * Math.min(1, dt * 9);
      // subtle hue drift red <-> sickly orange
      const hue = 0.012 + 0.022 * (0.5 + 0.5 * Math.sin(this._t * 0.23));
      L.emergency.color.setHSL(hue, 0.85, 0.32);
      if (L.emgDome) L.emgDome.material.color.setHSL(hue, 0.9, 0.13 + 0.09 * this._emgLevel);
    }
    for (const a of Object.values(this.accesses)) this._applyAccess(a, dt, this._t);
  }

  /** Drive the lamp charge meter (0..1). */
  setBattery(frac, dt) { updateBatteryGauge(this, frac, dt); }

  /** frac 0..1 across the night -> clock hands (00:00 -> 06:00). */
  setClock(frac) {
    if (!this.clock) return;
    const hours = CONFIG.game.clockFrom + frac * (CONFIG.game.clockTo - CONFIG.game.clockFrom);
    this.clock.hour.rotation.z = -(hours / 12) * Math.PI * 2;
    this.clock.minute.rotation.z = -((hours % 1)) * Math.PI * 2;
    // STRIKE ON THE HOUR. The clock is the only thing telling the player how much
    // of the shift is left, and until now it said so silently — you had to think
    // to look up. One strike per hour puts that information in the ear, where it
    // costs no attention, and turns the passage of time into pressure.
    const h = Math.floor(hours);
    if (this._lastHour === undefined) { this._lastHour = h; return; }
    if (h !== this._lastHour) {
      this._lastHour = h;
      if (this.onHour) this.onHour(h);
    }
  }

}
