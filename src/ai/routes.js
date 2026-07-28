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
      [-1.80, 0, 0.35, 'slit'],     // deep in the recess, only eyes in the gap
      [-1.58, 0, 0.35, 'peek'],     // leaning into the gap, still outside
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
  corridorCross: {
    pan: 0.0, surface: 'front', cross: true, access: null,
    points: [
      [-0.95, 0, -2.40, 'cross'],
      [-0.35, 0, -2.40, 'cross'],
      [ 0.35, 0, -2.40, 'cross'],
      [ 0.95, 0, -2.40, 'cross'],
    ],
  },

  // --- R3: the low vent. Half a body pushes out, then drops and crawls. ----
  vent: {
    pan: -0.35, surface: 'front', access: 'vent',
    points: [
      [-0.90, 0.34, -1.78, 'emerge'], // inside the duct, behind the grille
      [-0.90, 0.32, -1.56, 'emerge'], // pressed against the grille
      [-0.89, 0.16, -1.26, 'drop'],   // through it, dropping out
      [-0.72, 0.00, -0.82, 'crawl'],
      [-0.42, 0.00, -0.38, 'close'],
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
  window: {
    pan: 0.95, surface: 'right', access: null,  // already smashed open
    points: [
      [1.72, 0.66, -0.15, 'slit'],    // in the void behind the broken pane
      [1.52, 0.66, -0.15, 'peek'],    // face filling the opening
      [1.22, 0.34, -0.15, 'climb'],   // a leg over the sill
      [0.88, 0.00, -0.15, 'inside'],
      [0.50, 0.00, -0.12, 'close'],
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
