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
    pan: -0.95, surface: 'left',
    openVent: false,
    points: [
      [-1.34, 0, 0.35, 'slit'],     // inside the recess, only eyes in the gap
      [-1.16, 0, 0.32, 'peek'],     // leans around the door edge
      [-0.92, 0, 0.22, 'threshold'],// steps into the doorway
      [-0.62, 0, 0.08, 'inside'],
      [-0.30, 0, 0.00, 'close'],
    ],
  },

  // --- R2: the service corridor. Backlit silhouette walking up the hall. ---
  corridor: {
    pan: 0.0, surface: 'front',
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
    pan: 0.0, surface: 'front', cross: true,
    points: [
      [-0.95, 0, -2.40, 'cross'],
      [-0.35, 0, -2.40, 'cross'],
      [ 0.35, 0, -2.40, 'cross'],
      [ 0.95, 0, -2.40, 'cross'],
    ],
  },

  // --- R3: the low vent. Half a body pushes out, then drops and crawls. ----
  vent: {
    pan: -0.35, surface: 'front',
    openVent: true,
    points: [
      [-0.90, 0.34, -1.44, 'emerge'], // inside the duct, pushing the cover
      [-0.90, 0.30, -1.22, 'emerge'], // half out
      [-0.88, 0.00, -1.00, 'drop'],   // on the floor
      [-0.70, 0.00, -0.70, 'crawl'],
      [-0.40, 0.00, -0.35, 'close'],
    ],
  },

  // --- R4: the floor hatch. Pushes the grate up from below. ----------------
  hatch: {
    pan: 0.30, surface: 'floor',
    openHatch: true,
    points: [
      [0.55, -0.35, 0.45, 'emerge'],  // still down in the pit
      [0.55, -0.05, 0.45, 'emerge'],  // head and shoulders out
      [0.55, 0.00, 0.35, 'crawl'],
      [0.40, 0.00, 0.10, 'crawl'],
      [0.22, 0.00, -0.10, 'close'],
    ],
  },

  // --- R5: the smashed window. A leg over the sill, then in. ---------------
  window: {
    pan: 0.95, surface: 'right',
    points: [
      [1.44, 0.62, -0.15, 'slit'],    // face behind the opening
      [1.34, 0.62, -0.15, 'peek'],
      [1.16, 0.30, -0.15, 'threshold'],// climbing over the sill
      [0.92, 0.00, -0.15, 'inside'],
      [0.55, 0.00, -0.12, 'close'],
    ],
  },

  // --- Shadow corners: it just stands there, watching. ---------------------
  corner_l: {
    pan: -0.6, surface: 'left',
    points: [
      [-1.30, 0, -1.30, 'stare'],
      [-1.05, 0, -1.05, 'stare'],
      [-0.70, 0, -0.70, 'inside'],
      [-0.35, 0, -0.35, 'close'],
    ],
  },
  corner_r: {
    pan: 0.6, surface: 'right',
    points: [
      [1.30, 0, -1.30, 'stare'],
      [1.05, 0, -1.05, 'stare'],
      [0.70, 0, -0.70, 'inside'],
      [0.35, 0, -0.35, 'close'],
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
