import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  POI_SITES,
  TOWN_CENTER,
  TOWN_ENTRANCE,
  TOWN_ACCESS,
  TOWN_HEIGHT,
  TOWN_PLATEAU_RADIUS,
  TOWN_RAMP_WIDTH,
  buildRoadRoutes,
  buildTownRampPoints,
  heightAt,
  hillHeight,
  isInsideTown,
  surfaceAt,
  townRampHeight
} from "../src/world/WorldGeometry.js";

const read = rel => readFileSync(new URL(rel, import.meta.url), "utf8");

const town = POI_SITES.find(site => site.id === "hilltop-town");

// ---------------------------------------------------------------------------
// The POI is data, in the existing table
// ---------------------------------------------------------------------------

test("the town is a normal entry in the shared POI table", () => {
  assert.ok(town, "hilltop-town must exist in POI_SITES");
  assert.equal(town.kind, "town");
  assert.equal(town.hostile, false, "a community is not an enemy anchor");
  assert.equal(town.enemySlots, 0);
  assert.equal(town.x, TOWN_CENTER.x);
  assert.equal(town.z, TOWN_CENTER.z);
  assert.equal(town.radius, TOWN_PLATEAU_RADIUS);
  assert.deepEqual(town.entrance, TOWN_ENTRANCE);
});

test("the town does not get the generic flat dirt access spur", () => {
  // Sites with `access` get a 5m spur drawn straight across the terrain,
  // which would ignore the hillside. The town uses its own ramp instead.
  assert.equal(town.access, undefined);
});

test("the minimap/discovery system picks the town up automatically", () => {
  // Both read POI_SITES; nothing site-specific is needed.
  const minimap = read("../src/ui/Minimap.js");
  assert.match(minimap, /POI_SITES/);

  const poiSystem = read("../src/world/POISystem.js");
  assert.match(poiSystem, /case "town":/);
  assert.match(poiSystem, /town: \{ primary/, "the town needs a palette entry");
});

// ---------------------------------------------------------------------------
// Elevation: real, shared ground
// ---------------------------------------------------------------------------

test("the plateau is genuinely elevated and flat on top", () => {
  assert.equal(heightAt(TOWN_CENTER.x, TOWN_CENTER.z), TOWN_HEIGHT);

  for (const [dx, dz] of [[0, 0], [12, 8], [-18, 6], [4, -20], [20, 0]]) {
    assert.equal(
      heightAt(TOWN_CENTER.x + dx, TOWN_CENTER.z + dz),
      TOWN_HEIGHT,
      `the flat top must be level at (${dx}, ${dz})`
    );
  }
});

test("the rest of the world is untouched", () => {
  for (const [x, z] of [[0, 0], [0, -65], [62, -116], [150, 35], [-148, 62], [170, 170]]) {
    assert.equal(
      heightAt(x, z),
      hillHeight(x, z),
      `terrain at (${x}, ${z}) must be unchanged`
    );
  }

  for (const site of POI_SITES) {
    if (site.id === "hilltop-town") continue;

    assert.equal(
      heightAt(site.x, site.z),
      hillHeight(site.x, site.z),
      `${site.id} must not have been lifted`
    );
  }
});

test("the town sits clear of every other POI and of the spawn area", () => {
  for (const site of POI_SITES) {
    if (site.id === "hilltop-town") continue;

    const gap = Math.hypot(site.x - town.x, site.z - town.z);

    assert.ok(
      gap > site.radius + town.radius + 10,
      `${site.id} overlaps the town (gap ${gap.toFixed(1)})`
    );
  }

  // Protected player-spawn area, centre (-3, -65).
  assert.ok(Math.hypot(-3 - town.x, -65 - town.z) > town.radius + 20);
});

// ---------------------------------------------------------------------------
// The access road is drivable, follows the terrain and is classified
// ---------------------------------------------------------------------------

test("the ramp starts on the existing road network and ends at the gate", () => {
  assert.equal(
    surfaceAt(TOWN_ACCESS.x, TOWN_ACCESS.z),
    "asphalt",
    "the bottom of the ramp must meet an existing carriageway"
  );

  // The crossNorth carriageway runs along z = 100.
  assert.equal(TOWN_ACCESS.z, 100);

  assert.ok(Math.abs(heightAt(TOWN_ACCESS.x, TOWN_ACCESS.z)) < 0.05,
    "the ramp must start at natural ground level");

  assert.equal(
    heightAt(TOWN_ENTRANCE.x, TOWN_ENTRANCE.z),
    TOWN_HEIGHT,
    "the top of the ramp must meet the plateau with no step"
  );
});

test("the whole ramp is classified as a drivable road surface", () => {
  for (const point of buildTownRampPoints(60)) {
    assert.equal(
      surfaceAt(point.x, point.z),
      "asphalt",
      `ramp point (${point.x.toFixed(1)}, ${point.z.toFixed(1)}) is not road`
    );
  }
});

test("the ramp's visual route and its terrain elevation are the same curve", () => {
  const routes = buildRoadRoutes();

  const ramp = routes.find(route =>
    route.width === TOWN_RAMP_WIDTH &&
    Math.abs(route.points[0].x - TOWN_ACCESS.x) < 0.001 &&
    Math.abs(route.points[0].z - TOWN_ACCESS.z) < 0.001
  );

  assert.ok(ramp, "the ramp must be a real route in the shared road table");
  assert.equal(ramp.surface, "asphalt");

  // Every drawn point of the mesh sits on raised ground, i.e. the road is
  // not a visual ramp floating over flat terrain.
  for (const point of ramp.points) {
    const ground = heightAt(point.x, point.z);
    const ramped = townRampHeight(point.x, point.z);

    assert.ok(
      Math.abs(ground - Math.max(ramped, ground)) < 1e-9,
      "the mesh must follow the elevated ground"
    );
  }

  const top = ramp.points[ramp.points.length - 1];
  assert.equal(heightAt(top.x, top.z), TOWN_HEIGHT);
});

test("the ramp gradient is drivable and free of kinks", () => {
  const points = buildTownRampPoints(600);

  let maxGrade = 0;
  let maxGradeChange = 0;
  let length = 0;
  let previousGrade = 0;
  let previous = null;

  for (const point of points) {
    const height = heightAt(point.x, point.z);

    if (previous) {
      const run = Math.hypot(point.x - previous.point.x, point.z - previous.point.z);

      if (run > 0) {
        length += run;

        const grade = (height - previous.height) / run;

        maxGrade = Math.max(maxGrade, Math.abs(grade));
        maxGradeChange = Math.max(maxGradeChange, Math.abs(grade - previousGrade));
        previousGrade = grade;
      }
    }

    previous = { point, height };
  }

  assert.ok(length > 60, `the climb needs room (got ${length.toFixed(1)}m)`);
  assert.ok(
    maxGrade < 0.15,
    `max gradient ${(maxGrade * 100).toFixed(1)}% is too steep to drive`
  );
  assert.ok(
    maxGradeChange < 0.01,
    `gradient jumps by ${maxGradeChange.toFixed(3)} - that is a kink that could launch a car`
  );
});

test("the ramp is level where it meets the road and where it meets the town", () => {
  const points = buildTownRampPoints(600);

  const gradeAt = index => {
    const a = points[index];
    const b = points[index + 1];
    const run = Math.hypot(b.x - a.x, b.z - a.z);

    return Math.abs((heightAt(b.x, b.z) - heightAt(a.x, a.z)) / run);
  };

  assert.ok(gradeAt(0) < 0.01, "flat apron at the bottom junction");
  assert.ok(gradeAt(points.length - 2) < 0.01, "flat apron at the gate");
});

// ---------------------------------------------------------------------------
// Enclosure: exactly one way in
// ---------------------------------------------------------------------------

test("the perimeter is a steep embankment everywhere except the entrance", () => {
  let shallowest = Infinity;
  let shallowestAngle = null;

  for (let degrees = 0; degrees < 360; degrees += 1) {
    const angle = (degrees * Math.PI) / 180;

    const inner = {
      x: TOWN_CENTER.x + Math.cos(angle) * (TOWN_PLATEAU_RADIUS + 1),
      z: TOWN_CENTER.z + Math.sin(angle) * (TOWN_PLATEAU_RADIUS + 1)
    };

    const outer = {
      x: TOWN_CENTER.x + Math.cos(angle) * (TOWN_PLATEAU_RADIUS + 11),
      z: TOWN_CENTER.z + Math.sin(angle) * (TOWN_PLATEAU_RADIUS + 11)
    };

    const midpoint = {
      x: (inner.x + outer.x) / 2,
      z: (inner.z + outer.z) / 2
    };

    // Skip the ramp corridor - that IS the entrance.
    if (townRampHeight(midpoint.x, midpoint.z) > 0.5) continue;

    const slope =
      Math.abs(heightAt(inner.x, inner.z) - heightAt(outer.x, outer.z)) /
      Math.hypot(outer.x - inner.x, outer.z - inner.z);

    if (slope < shallowest) {
      shallowest = slope;
      shallowestAngle = degrees;
    }
  }

  assert.ok(
    shallowest > 0.3,
    `the hillside at ${shallowestAngle} degrees is only ${(shallowest * 100).toFixed(0)}% - ` +
    "that is a second way in"
  );
});

test("exactly one drivable road crosses the town boundary", () => {
  // Walk the rim and look for actual road surface. The embankment is not
  // drivable, so a road crossing IS a way in -- there must be exactly one
  // contiguous arc of it, centred on the declared entrance.
  const ring = TOWN_PLATEAU_RADIUS + 4;
  const samples = 720;

  const onRoad = [];

  for (let i = 0; i < samples; i++) {
    const angle = (i / samples) * Math.PI * 2;

    onRoad.push(
      surfaceAt(
        TOWN_CENTER.x + Math.cos(angle) * ring,
        TOWN_CENTER.z + Math.sin(angle) * ring
      ) !== "grass"
    );
  }

  let arcs = 0;

  for (let i = 0; i < samples; i++) {
    const previous = onRoad[(i - 1 + samples) % samples];
    if (onRoad[i] && !previous) arcs += 1;
  }

  assert.equal(arcs, 1, "the town must have exactly one entrance");

  // ...and that arc is where the gate is.
  const entranceAngle = Math.atan2(
    TOWN_ENTRANCE.z - TOWN_CENTER.z,
    TOWN_ENTRANCE.x - TOWN_CENTER.x
  );

  const entranceIndex = Math.round(
    ((entranceAngle + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * samples
  ) % samples;

  assert.ok(onRoad[entranceIndex], "the single crossing must be the gate");
});

test("the far side of the town is closed off", () => {
  // Directly opposite the gate there is no road and no drivable slope.
  const entranceAngle = Math.atan2(
    TOWN_ENTRANCE.z - TOWN_CENTER.z,
    TOWN_ENTRANCE.x - TOWN_CENTER.x
  );

  const behind = entranceAngle + Math.PI;

  const inner = {
    x: TOWN_CENTER.x + Math.cos(behind) * (TOWN_PLATEAU_RADIUS + 1),
    z: TOWN_CENTER.z + Math.sin(behind) * (TOWN_PLATEAU_RADIUS + 1)
  };

  const outer = {
    x: TOWN_CENTER.x + Math.cos(behind) * (TOWN_PLATEAU_RADIUS + 11),
    z: TOWN_CENTER.z + Math.sin(behind) * (TOWN_PLATEAU_RADIUS + 11)
  };

  assert.equal(surfaceAt(outer.x, outer.z), "grass");
  assert.equal(townRampHeight(outer.x, outer.z), 0);

  const slope =
    Math.abs(heightAt(inner.x, inner.z) - heightAt(outer.x, outer.z)) /
    Math.hypot(outer.x - inner.x, outer.z - inner.z);

  assert.ok(slope > 0.3, "the back of the town must be a steep embankment");
});

// ---------------------------------------------------------------------------
// Internal layout
// ---------------------------------------------------------------------------

test("the town has an internal street network on the plateau", () => {
  const internal = buildRoadRoutes().filter(route =>
    route.points.every(point => isInsideTown(point.x, point.z, 6))
  );

  assert.ok(
    internal.length >= 3,
    "expected an arrival apron, a main street and a cross street"
  );

  for (const route of internal) {
    assert.equal(route.surface, "asphalt");

    for (const point of route.points) {
      assert.equal(
        heightAt(point.x, point.z),
        TOWN_HEIGHT,
        "internal streets must lie on the flat top, not the embankment"
      );
    }
  }
});

test("isInsideTown covers the plateau and nothing beyond it", () => {
  assert.equal(isInsideTown(TOWN_CENTER.x, TOWN_CENTER.z), true);
  assert.equal(isInsideTown(TOWN_CENTER.x + TOWN_PLATEAU_RADIUS - 1, TOWN_CENTER.z), true);
  assert.equal(isInsideTown(TOWN_CENTER.x + TOWN_PLATEAU_RADIUS + 5, TOWN_CENTER.z), false);
  assert.equal(isInsideTown(0, 0), false);
});

test("scenery is kept out of the town lot", () => {
  const world = read("../src/world/World.js");

  assert.match(world, /isInsideTown/);
});

test("the terrain collider and mesh are built from the shared height function", () => {
  const terrain = read("../src/world/Terrain.js");

  assert.match(terrain, /heightAt as worldHeightAt/);
  assert.match(terrain, /data\[i\]\[j\] = worldHeightAt\(x, z\)/);
  assert.doesNotMatch(
    terrain,
    /data\[i\]\[j\] = hillHeight/,
    "the collider must include the town, or the plateau would be visual only"
  );
});

test("the town props sit on the plateau, not at world zero", () => {
  const poiSystem = read("../src/world/POISystem.js");

  const townCase = poiSystem.slice(
    poiSystem.indexOf('case "town":'),
    poiSystem.indexOf('default: {')
  );

  assert.match(townCase, /heightOn = \(x, z\) => terrain\.heightAt\(x, z\)/);
  assert.match(townCase, /gateGap/, "the perimeter must leave a gate opening");
  assert.match(townCase, /BULLETIN BOARD/);
  assert.match(townCase, /FUTURE PLOTS/);
  assert.match(townCase, /PARKING/);
  assert.ok(
    townCase.includes("service/repair") &&
    townCase.includes("shop") &&
    townCase.includes("car-community meet"),
    "the three reserved plots must be present"
  );
});
