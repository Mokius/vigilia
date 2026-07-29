// =============================================================================
// routes.js — The five approach routes from docs/FASE1_ESCENARIO.md §4.3.
// A route is an ordered list of waypoints; an enemy interpolates ALONG it, so
// it is never teleported — it is always somewhere real in the room.
//
// Each waypoint: [x, y, z, stage] where `stage` names the beat that begins here.
// `y` is the floor height the creature stands on at that point (creatures that
// come out of the vent start high and drop, so y varies).
// =============================================================================

export const ROUTES = {
  // --- R1: the left door, ajar. Eyes in the slit, then it leans out. --------
  door: {
    pan: -0.95, surface: 'left', access: 'door',
    // x = -1.5 is the wall plane. Stations 0-1 sit BEHIND it, in the recess, so
    // nothing is ever standing inside a shut door.
    points: [
      [-2.02, 0, 0.35, 'slit'],     // deep in the recess, only eyes in the gap
      [-1.86, 0, 0.35, 'peek'],     // leaning into the gap, clear of the shut leaf
      [-1.24, 0, 0.28, 'threshold'],// crossing the plane: needs a real opening
      [-0.85, 0, 0.14, 'inside'],
      [-0.38, 0, 0.02, 'close'],
    ],
  },

  // --- R2: the service corridor. Backlit silhouette walking up the hall. ---
  corridor: {
    pan: 0.0, surface: 'front', access: null,   // a permanent opening
    points: [
      [0.00, 0, -4.20, 'far'],      // silhouette against the red exit light
      [0.00, 0, -3.00, 'hall'],
      [0.00, 0, -2.00, 'hall'],
      [0.00, 0, -1.55, 'threshold'],// framed in the corridor mouth
      [0.00, 0, -0.90, 'inside'],
      [0.00, 0, -0.45, 'close'],
    ],
  },

  // --- R2b: crosses the corridor without ever entering. Pure false alarm. --
  // It walks the CROSS PASSAGE at z=-3.30. The old span (x +-0.95) was wider
  // than the corridor itself (+-0.65), so the silhouette used to walk through
  // solid wall on both sides; room.js now cuts a real side passage there.
  corridorCross: {
    pan: 0.0, surface: 'front', cross: true, access: null,
    points: [
      [-1.30, 0, -3.30, 'cross'],
      [-0.45, 0, -3.30, 'cross'],
      [ 0.45, 0, -3.30, 'cross'],
      [ 1.30, 0, -3.30, 'cross'],
    ],
  },

  // --- R3: the low duct, now in the LEFT wall ------------------------------
  // It shares that wall with the door but sits well forward of it, so the two
  // ways in never overlap and the left panel reads as the services side.
  vent: {
    pan: -0.80, surface: 'left', access: 'vent',
    points: [
      [-1.90, 0.32, -0.95, 'emerge'], // inside the duct, behind the louvre
      [-1.60, 0.30, -0.95, 'emerge'], // pressed against the louvre
      [-1.22, 0.14, -0.95, 'drop'],   // through it, dropping out
      [-0.82, 0.00, -0.78, 'crawl'],
      [-0.40, 0.00, -0.52, 'close'],
    ],
  },

  // --- R4: the floor hatch. Pushes the grate up from below. ----------------
  hatch: {
    pan: 0.30, surface: 'floor', access: 'hatch',
    points: [
      [0.55, -0.62, 0.45, 'emerge'],  // down in the pit, under the grate
      [0.55, -0.30, 0.45, 'emerge'],  // pushing up against it
      [0.55, 0.00, 0.42, 'crawl'],    // through: needs the grate shifted
      [0.42, 0.00, 0.12, 'crawl'],
      [0.24, 0.00, -0.10, 'close'],
    ],
  },

  // --- R5: the smashed window. A leg over the sill, then in. ---------------
  // The old route stood it at y=0.66 — level with a sill that was itself 0.72 m
  // up — so the creature floated with its head above the aperture and its trunk
  // inside the masonry. It now stands on the machine-room floor BEHIND the wall,
  // which frames its whole body in the opening, then rises onto the sill and
  // comes down into the room. The climb is a real change of height.
  window: {
    pan: 0.95, surface: 'right', access: null,  // already smashed open
    points: [
      [1.74, 0.00, -0.15, 'slit'],    // in the void behind the broken pane
      [1.54, 0.00, -0.15, 'peek'],    // body filling the opening
      [1.12, 0.16, -0.15, 'climb'],   // up over the sill, inboard of the lintel
      [0.92, 0.06, -0.15, 'inside'],  // stepping down off it
      [0.54, 0.00, -0.12, 'close'],
    ],
  },

};

// Position + stage at normalized progress p in [0,1] along a route.
export function samplePath(route, p) {
  const pts = route.points;
  const n = pts.length - 1;
  const t = Math.max(0, Math.min(0.9999, p)) * n;
  const i = Math.floor(t), f = t - i;
  const a = pts[i], b = pts[Math.min(n, i + 1)];
  return {
    x: a[0] + (b[0] - a[0]) * f,
    y: a[1] + (b[1] - a[1]) * f,
    z: a[2] + (b[2] - a[2]) * f,
    stage: a[3],
    nextStage: b[3],
  };
}
