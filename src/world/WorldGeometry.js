// ---------------------------------------------------------------------------
// Pure-math world geometry helpers.
//
// Deliberately has ZERO dependency on three.js/cannon-es so this same file
// can be imported both by the browser client (Terrain.js / Roads.js use it
// to build the visible/collidable world) AND by the authoritative
// multiplayer server (server/server.js / server/EnemyWorld.js), which runs
// as a plain Node process with no rendering libraries loaded.
//
// The server needs to know the same terrain height and road/grass surface
// classification the client uses so that authoritative enemy spawn points
// are valid (on grass, outside the safe zone, inside world bounds) for
// every connected client -- if client and server disagreed here, an enemy
// could spawn "inside a building" or "underwater" for some players.
// ---------------------------------------------------------------------------

export const WORLD_SIZE = 400;
export const WORLD_HALF = WORLD_SIZE / 2;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(x, edge0, edge1) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// Matches Terrain.js's `hillHeight` exactly -- the terrain collision mesh
// is just this function sampled onto a heightfield grid, so evaluating it
// directly (rather than re-deriving a heightfield) is both simpler and
// exact for any x/z, not just grid points.
export function hillHeight(x, z) {
  const fade = smoothstep(Math.abs(x), 150, 195);

  return fade * (
    3.5 +
    Math.sin(x * 0.06) * 2 +
    Math.cos(z * 0.07) * 1.5 +
    Math.sin((x + z) * 0.035)
  );
}

// ---------------------------------------------------------------------------
// HILLTOP MOTOR TOWN — elevated community plateau + its access ramp
// ---------------------------------------------------------------------------
// Declared here, with the rest of the shared world maths, for exactly the
// reason given in this file's header: the plateau changes the ground height
// and the ramp is a real carriageway, so the authoritative server has to
// agree with the client about both or enemies/loot would spawn inside the
// hillside and the road would be a visual-only ramp the server cannot
// classify.
//
// Shape:
//   * a flat top of radius TOWN_PLATEAU_RADIUS at TOWN_HEIGHT,
//   * a steep, deliberately un-drivable embankment out to TOWN_SKIRT_RADIUS,
//     which is what makes the community feel enclosed,
//   * ONE drivable way up: the ramp polyline below, which leaves the
//     existing crossSouth carriageway and climbs to the entrance.
//
// The ramp's height profile is a smoothstep, so its gradient is zero where
// it meets both the flat ground and the plateau: no kink at either end that
// could launch or destabilise a vehicle.
// ---------------------------------------------------------------------------

export const TOWN_CENTER = { x: -82, z: 40 };
export const TOWN_HEIGHT = 5;
export const TOWN_PLATEAU_RADIUS = 26;
export const TOWN_SKIRT_RADIUS = 36;

// Where the ramp meets the plateau rim (the single entrance) and where it
// meets the existing road network.
export const TOWN_ENTRANCE = { x: -82, z: 66 };
export const TOWN_ACCESS = { x: -16, z: 100 };

export const TOWN_RAMP_WIDTH = 12;

// The ramp polyline finishes 8m inside the rim, on the town side of the
// entrance, so the ramp and plateau surfaces overlap.
const TOWN_RAMP_OVERRUN_Z =
  TOWN_ENTRANCE.z + Math.sign(TOWN_CENTER.z - TOWN_ENTRANCE.z) * 8;
const TOWN_RAMP_SKIRT = 10;

// The climb starts and finishes slightly inside the polyline so the ramp
// has flat aprons at the bottom junction and at the gate.
const TOWN_RAMP_CLIMB_START = 0.06;
// Finishes BEFORE the polyline reaches the plateau rim, so the ramp is
// already level at TOWN_HEIGHT when the plateau term takes over. Without
// that overlap the max() below would hand over mid-climb and leave a slope
// kink right at the gate.
const TOWN_RAMP_CLIMB_END = 0.84;

// S-curve from the crossSouth carriageway up to the entrance. Sampled (not
// hand-listed) so the visual mesh, the surface classifier and the elevation
// all read the exact same curve.
// Where along the polyline the ramp crosses the plateau rim.
const TOWN_RAMP_RIM_T =
  (TOWN_ENTRANCE.z - TOWN_ACCESS.z) / (TOWN_RAMP_OVERRUN_Z - TOWN_ACCESS.z);

export function buildTownRampPoints(steps = 40) {
  const points = [];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;

    points.push({
      // Eased in x, linear in z: a smooth S rather than a diagonal with
      // two sharp junction kinks.
      //
      // The easing completes exactly at the rim (tRim) so the ramp passes
      // through TOWN_ENTRANCE and then runs straight in, square to the
      // boundary. smoothstep ends with zero gradient, so squaring up adds
      // no kink.
      x: TOWN_ACCESS.x +
        (TOWN_ENTRANCE.x - TOWN_ACCESS.x) *
        smoothstep(Math.min(t / TOWN_RAMP_RIM_T, 1), 0, 1),
      // Runs 8m past the rim, INWARD, so the ramp and the plateau overlap
      // instead of meeting at a seam.
      z: TOWN_ACCESS.z + (TOWN_RAMP_OVERRUN_Z - TOWN_ACCESS.z) * t
    });
  }

  return points;
}

// Sampled finely for the elevation lookup: the chord error of a coarse
// polyline would show up as small lateral wobble in the ground height.
const TOWN_RAMP_POINTS = buildTownRampPoints(240);

// Cumulative arc length, so the climb below is driven by DISTANCE ALONG THE
// ROAD rather than by the polyline index. The curve is eased in x, so its
// index parameter advances at a very uneven speed; profiling the climb
// against the index would pack most of the height gain into the slow
// sections and produce a needlessly steep stretch near the bottom.
const TOWN_RAMP_ARC = (() => {
  const lengths = [0];

  for (let i = 1; i < TOWN_RAMP_POINTS.length; i++) {
    const a = TOWN_RAMP_POINTS[i - 1];
    const b = TOWN_RAMP_POINTS[i];

    lengths.push(lengths[i - 1] + Math.hypot(b.x - a.x, b.z - a.z));
  }

  return lengths;
})();

export const TOWN_RAMP_LENGTH = TOWN_RAMP_ARC[TOWN_RAMP_ARC.length - 1];

// Nearest point on the ramp polyline: returns the perpendicular distance
// and the normalized arc length (0..1) of that nearest point.
function nearestOnTownRamp(x, z) {
  let bestDistance = Infinity;
  let bestS = 0;

  for (let i = 0; i < TOWN_RAMP_POINTS.length - 1; i++) {
    const a = TOWN_RAMP_POINTS[i];
    const b = TOWN_RAMP_POINTS[i + 1];

    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lengthSquared = dx * dx + dz * dz;

    const local = lengthSquared === 0 ? 0 : clamp(
      ((x - a.x) * dx + (z - a.z) * dz) / lengthSquared,
      0,
      1
    );

    const distance = Math.hypot(
      x - (a.x + local * dx),
      z - (a.z + local * dz)
    );

    if (distance < bestDistance) {
      bestDistance = distance;
      bestS = (
        TOWN_RAMP_ARC[i] +
        (TOWN_RAMP_ARC[i + 1] - TOWN_RAMP_ARC[i]) * local
      ) / TOWN_RAMP_LENGTH;
    }
  }

  return { distance: bestDistance, t: bestS };
}

export function townPlateauHeight(x, z) {
  const distance = Math.hypot(x - TOWN_CENTER.x, z - TOWN_CENTER.z);

  return TOWN_HEIGHT * (
    1 - smoothstep(distance, TOWN_PLATEAU_RADIUS, TOWN_SKIRT_RADIUS)
  );
}

export function townRampHeight(x, z) {
  const { distance, t } = nearestOnTownRamp(x, z);

  const lateral = 1 - smoothstep(
    distance,
    TOWN_RAMP_WIDTH / 2,
    TOWN_RAMP_WIDTH / 2 + TOWN_RAMP_SKIRT
  );

  if (lateral <= 0) return 0;

  const climb = smoothstep(t, TOWN_RAMP_CLIMB_START, TOWN_RAMP_CLIMB_END);

  return TOWN_HEIGHT * climb * lateral;
}

// The ramp and the plateau are combined with max() rather than added: they
// both reach TOWN_HEIGHT where they meet, so the join is continuous and
// neither can push the other above the flat top.
export function townElevation(x, z) {
  return Math.max(townPlateauHeight(x, z), townRampHeight(x, z));
}

export function isInsideTown(x, z, padding = 0) {
  return (
    Math.hypot(x - TOWN_CENTER.x, z - TOWN_CENTER.z) <=
    TOWN_PLATEAU_RADIUS + padding
  );
}

// The one ground-height function. Terrain.js samples this into the
// heightfield/mesh and the server samples it directly, so the elevated
// town exists identically for physics, rendering and authority.
export function heightAt(x, z) {
  return hillHeight(x, z) + townElevation(x, z);
}

// ---------------------------------------------------------------------------
// ROAD ROUTES
// ---------------------------------------------------------------------------
// Same point generation Roads.js used to build inline. Centralized here so
// the visual mesh builder (Roads.js) and the surface classifier below can
// never drift apart, and so the server can classify grass/asphalt/dirt at
// any (x, z) without needing three.js.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// POINTS OF INTEREST
// ---------------------------------------------------------------------------
// Pure data, declared here (not in a three.js module) for the same reason
// the road routes are: the authoritative server needs the identical POI
// layout to anchor enemy spawns, and it cannot import rendering code.
//
// Every site is deliberately placed:
//   * off the carriageway but adjacent to an existing route, so it reads as
//     a roadside destination rather than a random prop in a field,
//   * outside the protected player-spawn area (centre -3,-65),
//   * with an access spur generated below, so it is genuinely drivable to.
//
// `level` reuses the existing player level system's scale -- it is a
// suggested player level, NOT a new difficulty currency. Higher-level sites
// simply hold more/denser enemies and better loot.
// ---------------------------------------------------------------------------
export const POI_SITES = [
  {
    id: "depot",
    name: "ROADSIDE DEPOT",
    kind: "depot",
    x: 62,
    z: -116,
    radius: 17,
    level: 1,
    enemySlots: 2,
    hostile: true,
    // Nearest point on the crossSouth carriageway.
    access: { x: 62, z: -130 }
  },
  {
    id: "gas-station",
    name: "ABANDONED GAS STATION",
    kind: "station",
    x: -58,
    z: 114,
    radius: 16,
    level: 2,
    enemySlots: 2,
    hostile: true,
    access: { x: -58, z: 100 }
  },
  {
    id: "warehouse",
    name: "DERELICT WAREHOUSE",
    kind: "warehouse",
    x: -118,
    z: -42,
    radius: 20,
    level: 3,
    enemySlots: 3,
    hostile: true,
    access: { x: -100, z: -42 }
  },
  {
    id: "repair",
    name: "REPAIR STATION",
    kind: "repair",
    x: -148,
    z: 62,
    radius: 15,
    level: 2,
    enemySlots: 0,
    // Neutral: a safe roadside stop, so it is never used as an enemy anchor.
    hostile: false,
    access: { x: -148, z: 100 }
  },
  {
    id: "checkpoint",
    name: "ROADSIDE CHECKPOINT",
    kind: "checkpoint",
    x: 20,
    z: 152,
    radius: 13,
    level: 3,
    enemySlots: 2,
    hostile: true,
    access: { x: 0, z: 152 }
  },
  {
    id: "industrial",
    name: "INDUSTRIAL YARD",
    kind: "industrial",
    x: 150,
    z: 35,
    radius: 22,
    level: 5,
    enemySlots: 4,
    hostile: true,
    // Inside the neighbourhood ring road, reached from its western arc.
    access: { x: 120, z: 35 }
  },
  {
    id: "hilltop-town",
    name: "RIDGEVIEW MOTOR TOWN",
    kind: "town",
    x: -82,
    z: 40,
    radius: 26,
    level: 1,
    enemySlots: 0,
    // A community, not an encounter: never used as an enemy anchor.
    hostile: false,
    // Sits on the elevated plateau (see townElevation above).
    elevated: true,
    // Deliberately NO `access` field: the generic 5m dirt spur generated
    // for the sites above would ignore the hillside. This town is reached
    // by its own purpose-built ramp carriageway, added in buildRoadRoutes.
    entrance: { x: -82, z: 66 }
  },
  {
    id: "rest-area",
    name: "REST AREA",
    kind: "rest",
    x: 92,
    z: 148,
    radius: 14,
    level: 1,
    enemySlots: 1,
    hostile: true,
    access: { x: 92, z: 100 }
  }
];

export function buildRoadRoutes() {
  const routes = [];

  const straight = [];
  for (let z = -170; z <= 170; z += 2) {
    straight.push({ x: 0, z });
  }
  routes.push({ points: straight, width: 12, surface: "asphalt", color: 0x353d44 });

  const loop = [];
  for (let i = 0; i <= 160; i++) {
    const angle = (i / 160) * Math.PI * 2;
    loop.push({ x: Math.sin(angle) * 36, z: Math.cos(angle) * 70 });
  }
  routes.push({ points: loop, width: 8, surface: "asphalt", color: 0x394148 });

  const dirt = [];
  for (let i = 0; i <= 100; i++) {
    const t = i / 100;
    dirt.push({ x: 35 + Math.sin(t * Math.PI) * 40, z: -65 + t * 130 });
  }
  routes.push({ points: dirt, width: 6, surface: "dirt", color: 0xa5875c });

  const crossNorth = [];
  for (let x = -170; x <= 170; x += 2) {
    crossNorth.push({ x, z: 100 });
  }
  routes.push({ points: crossNorth, width: 10, surface: "asphalt", color: 0x3a424a });

  const crossSouth = [];
  for (let x = -150; x <= 150; x += 2) {
    crossSouth.push({ x, z: -130 });
  }
  routes.push({ points: crossSouth, width: 10, surface: "asphalt", color: 0x3a424a });

  const connector = [];
  for (let i = 0; i <= 120; i++) {
    const t = i / 120;
    connector.push({ x: 36 + t * 114, z: Math.sin(t * Math.PI) * 45 + t * 10 });
  }
  routes.push({ points: connector, width: 8, surface: "asphalt", color: 0x3a424a });

  const neighborhood = [];
  for (let i = 0; i <= 120; i++) {
    const angle = (i / 120) * Math.PI * 2;
    neighborhood.push({ x: 150 + Math.cos(angle) * 30, z: 35 + Math.sin(angle) * 28 });
  }
  routes.push({ points: neighborhood, width: 7, surface: "asphalt", color: 0x3f474e });

  // -------------------------------------------------------------------------
  // SECONDARY NETWORK
  // -------------------------------------------------------------------------
  // The original layout was a spine plus a few isolated loops, which left
  // large unreachable quadrants. These narrower secondary roads tie the
  // west, north and east of the map into the existing network and give the
  // world a readable hierarchy: primary spine (12m) > cross routes (10m) >
  // secondary links (7-8m) > POI access spurs (5m, dirt).
  // -------------------------------------------------------------------------

  const westLink = [];
  for (let i = 0; i <= 120; i++) {
    const t = i / 120;
    // Gentle S-curve from the southern cross route up to the northern one,
    // so the western side is a real driving route rather than a straight.
    westLink.push({
      x: -118 - Math.sin(t * Math.PI) * 26,
      z: -130 + t * 230
    });
  }
  routes.push({ points: westLink, width: 7, surface: "asphalt", color: 0x3a424a });

  const northSpur = [];
  for (let i = 0; i <= 90; i++) {
    const t = i / 90;
    // Links the top of the main spine east towards the rest area, curving
    // so the junction with the spine is a proper bend, not a T-stub.
    northSpur.push({
      x: t * 110,
      z: 152 - Math.sin(t * Math.PI) * 10
    });
  }
  routes.push({ points: northSpur, width: 8, surface: "asphalt", color: 0x3a424a });

  const eastLink = [];
  for (let i = 0; i <= 100; i++) {
    const t = i / 100;
    // Connects the neighbourhood ring down to the southern cross route,
    // closing the eastern half of the network into a loop.
    eastLink.push({
      x: 150 + Math.sin(t * Math.PI) * 18,
      z: 7 - t * 137
    });
  }
  routes.push({ points: eastLink, width: 7, surface: "asphalt", color: 0x3a424a });

  // -------------------------------------------------------------------------
  // HILLTOP MOTOR TOWN
  // -------------------------------------------------------------------------
  // The ramp is a first-class carriageway, not a visual prop: it is in this
  // table, so Roads.js draws it, surfaceAt() below classifies it as asphalt
  // and the server sees the same drivable surface. Its points come from
  // buildTownRampPoints(), the same curve townRampHeight() raises the
  // terrain along, so the mesh and the ground can never disagree.
  routes.push({
    points: buildTownRampPoints(),
    width: TOWN_RAMP_WIDTH,
    surface: "asphalt",
    color: 0x3d4148
  });

  // Arrival apron just inside the gate, wide enough to turn around in
  // before committing to the internal street.
  const townArrival = [];
  for (let i = 0; i <= 20; i++) {
    const angle = -Math.PI / 2 + (i / 20) * Math.PI * 2;
    townArrival.push({
      x: TOWN_CENTER.x + Math.cos(angle) * 13,
      z: TOWN_CENTER.z + 8 + Math.sin(angle) * 9
    });
  }
  routes.push({
    points: townArrival, width: 9, surface: "asphalt", color: 0x3f444b
  });

  // Central internal street, gate to the far side of the plateau.
  const townMain = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    townMain.push({
      x: TOWN_CENTER.x,
      z: TOWN_ENTRANCE.z - 2 - t * 32
    });
  }
  routes.push({
    points: townMain, width: 8, surface: "asphalt", color: 0x3f444b
  });

  // Cross street serving the service/shop/meeting plots either side.
  const townCross = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    townCross.push({
      x: TOWN_CENTER.x - 19 + t * 38,
      z: TOWN_CENTER.z - 4
    });
  }
  routes.push({
    points: townCross, width: 7, surface: "asphalt", color: 0x3f444b
  });

  // -------------------------------------------------------------------------
  // POI ACCESS SPURS
  // -------------------------------------------------------------------------
  // Generated from the POI table itself so a site can never end up with no
  // way in: each spur runs from the site's declared access point on an
  // existing carriageway to the centre of the site.
  // -------------------------------------------------------------------------
  for (const site of POI_SITES) {
    if (!site.access) continue;

    const spur = [];
    const steps = 24;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;

      spur.push({
        x: site.access.x + (site.x - site.access.x) * t,
        z: site.access.z + (site.z - site.access.z) * t
      });
    }

    routes.push({ points: spur, width: 5, surface: "dirt", color: 0x8d7450 });
  }

  return routes;
}

const ROAD_ROUTES = buildRoadRoutes();

function distanceToSegment(x, z, a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSquared = dx * dx + dz * dz;

  const t = lengthSquared === 0 ? 0 : clamp(
    ((x - a.x) * dx + (z - a.z) * dz) / lengthSquared,
    0,
    1
  );

  return Math.hypot(x - (a.x + t * dx), z - (a.z + t * dz));
}

// Matches Roads.js's flat test pad covering the spawn location.
export function surfaceAt(x, z) {
  if (Math.abs(x) <= 22 && Math.abs(z + 65) <= 17) {
    return "asphalt";
  }

  for (let r = ROAD_ROUTES.length - 1; r >= 0; r--) {
    const route = ROAD_ROUTES[r];

    for (let i = 0; i < route.points.length - 1; i++) {
      if (
        distanceToSegment(x, z, route.points[i], route.points[i + 1]) <=
        route.width / 2
      ) {
        return route.surface;
      }
    }
  }

  return "grass";
}
