import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as THREE from "three";

import {
  GROUND_DECAL_BASE,
  GROUND_LAYER,
  GROUND_LAYER_OVERLAY,
  GROUND_LAYER_STEP,
  ROUTE_LAYER_CAPACITY,
  applyGroundDecalDepth,
  groundLayerHeight,
  markingLayer,
  placeGroundDecal
} from "../src/world/GroundLayers.js";

import { createRoads } from "../src/world/Roads.js";
import { buildRoadRoutes } from "../src/world/WorldGeometry.js";

const read = rel => readFileSync(new URL(rel, import.meta.url), "utf8");

// ---------------------------------------------------------------------------
// The layering convention itself
// ---------------------------------------------------------------------------

test("layers are ordered: aprons and pad under roads, markings over them", () => {
  const routeCount = buildRoadRoutes().length;

  assert.ok(GROUND_LAYER.poiApron < GROUND_LAYER.spawnPad);
  assert.ok(GROUND_LAYER.spawnPad < GROUND_LAYER.roadBase);
  assert.ok(markingLayer(routeCount) > GROUND_LAYER.roadBase + routeCount);
  assert.ok(GROUND_LAYER_OVERLAY > markingLayer(routeCount));
});

test("the reserved route head-room actually covers the route table", () => {
  assert.ok(buildRoadRoutes().length <= ROUTE_LAYER_CAPACITY);
});

test("layer height rises monotonically and stays visually flush", () => {
  let previous = -Infinity;

  for (let layer = 0; layer <= GROUND_LAYER_OVERLAY; layer++) {
    const y = groundLayerHeight(layer);
    assert.ok(y > previous, `layer ${layer} must rise`);
    previous = y;
  }

  assert.equal(groundLayerHeight(0), GROUND_DECAL_BASE);
  assert.equal(
    groundLayerHeight(4),
    GROUND_DECAL_BASE + 4 * GROUND_LAYER_STEP
  );

  // The whole stack has to stay inside a few centimetres, otherwise the
  // upper roads visibly float above the grass at their edges.
  assert.ok(groundLayerHeight(GROUND_LAYER_OVERLAY) < 0.1);
});

test("polygon offset is enabled and strengthens with each layer", () => {
  const lower = applyGroundDecalDepth(new THREE.MeshStandardMaterial(), 1);
  const upper = applyGroundDecalDepth(new THREE.MeshStandardMaterial(), 7);

  assert.equal(lower.polygonOffset, true);
  assert.equal(upper.polygonOffset, true);

  // Slope-scaled component, so the bias survives the steep town ramp.
  assert.ok(lower.polygonOffsetFactor < 0);

  // More negative == closer to the camera == wins the depth test.
  assert.ok(upper.polygonOffsetUnits < lower.polygonOffsetUnits);
});

test("placeGroundDecal sets depth bias, render order and height together", () => {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshStandardMaterial()
  );

  placeGroundDecal(mesh, 3);

  assert.equal(mesh.material.polygonOffset, true);
  assert.equal(mesh.renderOrder, 3);
  assert.equal(mesh.position.y, groundLayerHeight(3));

  placeGroundDecal(mesh, 3, { y: 12.5 });
  assert.equal(mesh.position.y, 12.5);
});

// ---------------------------------------------------------------------------
// The road network as actually built
// ---------------------------------------------------------------------------

function buildRoads() {
  const added = [];
  const scene = { add: object => added.push(object) };

  const terrain = {
    heightAt: () => 0,
    body: { addShape: () => {} }
  };

  const result = createRoads(scene, terrain);
  const meshes = [];

  for (const object of added) {
    object.traverse(child => {
      if (child.isMesh) meshes.push(child);
    });
  }

  return { result, meshes };
}

test("every road ribbon gets a depth bias and a distinct render order", () => {
  const { result, meshes } = buildRoads();

  const roads = meshes.filter(
    mesh =>
      mesh.renderOrder >= GROUND_LAYER.roadBase &&
      mesh.renderOrder < GROUND_LAYER.roadBase + result.routeCount
  );

  assert.equal(roads.length, result.routeCount);

  const orders = new Set();

  for (const mesh of roads) {
    assert.equal(mesh.material.polygonOffset, true);
    assert.ok(mesh.material.polygonOffsetUnits < 0);
    assert.equal(orders.has(mesh.renderOrder), false, "render orders collide");
    orders.add(mesh.renderOrder);
  }
});

test("no two road ribbons are left coplanar", () => {
  const { result, meshes } = buildRoads();

  const heights = meshes
    .filter(
      mesh =>
        mesh.renderOrder >= GROUND_LAYER.roadBase &&
        mesh.renderOrder < GROUND_LAYER.roadBase + result.routeCount
    )
    .map(mesh => {
      // Ribbon vertices carry the lift; the mesh itself stays at origin.
      const y = mesh.geometry.attributes.position.array;
      let min = Infinity;

      for (let i = 1; i < y.length; i += 3) min = Math.min(min, y[i]);

      return Number(min.toFixed(6));
    });

  assert.equal(new Set(heights).size, heights.length);
});

test("later routes are drawn on top, matching surfaceAt precedence", () => {
  const { result, meshes } = buildRoads();

  const roads = meshes
    .filter(
      mesh =>
        mesh.renderOrder >= GROUND_LAYER.roadBase &&
        mesh.renderOrder < GROUND_LAYER.roadBase + result.routeCount
    )
    .sort((a, b) => a.renderOrder - b.renderOrder);

  for (let i = 1; i < roads.length; i++) {
    assert.ok(
      roads[i].material.polygonOffsetUnits <
        roads[i - 1].material.polygonOffsetUnits
    );
  }
});

test("the spawn pad sits under the roads and the stripes sit over them", () => {
  const { result, meshes } = buildRoads();

  const pad = meshes.find(mesh => mesh.renderOrder === GROUND_LAYER.spawnPad);
  assert.ok(pad, "spawn pad should be on its own layer");
  assert.ok(pad.position.y < groundLayerHeight(GROUND_LAYER.roadBase));

  const stripeLayer = markingLayer(result.routeCount);
  const stripes = meshes.filter(mesh => mesh.renderOrder === stripeLayer);

  assert.ok(stripes.length > 0, "lane stripes should be on the marking layer");
  assert.ok(
    groundLayerHeight(stripeLayer) >
      groundLayerHeight(GROUND_LAYER.roadBase + result.routeCount - 1)
  );
});

test("POI aprons and the charging zone use the shared layering", () => {
  const poi = read("../src/world/POISystem.js");
  assert.match(poi, /GroundLayers\.js/);
  assert.match(poi, /placeGroundDecal\(\s*mesh,\s*GROUND_LAYER\.poiApron/);

  const station = read("../src/world/ChargingStation.js");
  assert.match(station, /placeGroundDecal\(zoneMesh, GROUND_LAYER_OVERLAY\)/);
  assert.doesNotMatch(station, /zoneMesh\.position\.y = 0\.045/);
});

// ---------------------------------------------------------------------------
// The town plot pads are solid
// ---------------------------------------------------------------------------

test("town plot pads are solid so the car cannot drive through them", () => {
  const poi = read("../src/world/POISystem.js");

  const pad = poi.match(
    /prop\(\[plot\.w, ([\d.]+), plot\.d\], \[px, base \+ ([\d.]+), pz\], 0x585449([^;]*)\);/
  );

  assert.ok(pad, "plot pad prop should still exist");

  const [, height, centre, opts] = pad;

  // No `solid: false` == prop() builds the static collision box.
  assert.doesNotMatch(opts, /solid/);

  // The pad rests ON the ground: its centre is exactly half its height up.
  assert.equal(Number(centre), Number(height) / 2);

  // Low enough to drive onto rather than a wall.
  assert.ok(Number(height) <= 0.2);
});

test("parking bay markings stay flush painted decals", () => {
  const poi = read("../src/world/POISystem.js");

  const bay = poi.match(
    /prop\(\[0\.25, ([\d.]+), 5\], \[px, heightOn\(px, pz\) \+ ([\d.]+), pz\], 0xd8d2c4, \{\s*solid: false/
  );

  assert.ok(bay, "parking bay markings should still exist and be non-solid");

  const top = Number(bay[2]) + Number(bay[1]) / 2;
  assert.ok(top <= 0.05, `bay markings stand ${top}m proud of the ground`);
});
