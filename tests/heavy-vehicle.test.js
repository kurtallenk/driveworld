import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import * as CANNON from "cannon-es";
import { VEHICLE_CLASSES, LIGHT_HANDLING, HEAVY_HANDLING } from "../src/vehicle/VehicleConfig.js";
import { VehiclePhysics } from "../src/vehicle/VehiclePhysics.js";
import { HEAVY_NOTE } from "../src/ui/DrivingTutorial.js";

// Minimal canvas stub so the shared cockpit's CanvasTexture displays build
// under Node (no DOM).
function withCanvasStub(fn) {
  const had = "document" in globalThis;
  const prev = globalThis.document;
  const ctx = new Proxy({}, { get: () => () => ({ addColorStop() {} }), set: () => true });
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (had) globalThis.document = prev;
      else delete globalThis.document;
    });
}

function bounds(root) {
  root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(root);
}

test("hauler body builds with the same contract as the sedan and is bigger", () =>
  withCanvasStub(async () => {
    const { buildVehicleBody } = await import("../src/vehicle/VehicleVisual.js");
    const sedanRoot = new THREE.Group();
    const haulerRoot = new THREE.Group();
    const sedan = buildVehicleBody(sedanRoot, 0xff0000, "sedan");
    const hauler = buildVehicleBody(haulerRoot, 0xff0000, "hauler");
    for (const key of Object.keys(sedan)) {
      assert.ok(hauler[key] !== undefined, `hauler returns ${key}`);
    }
    assert.equal(hauler.exhaustPoints.length, 2);
    const s = bounds(sedanRoot).getSize(new THREE.Vector3());
    const h = bounds(haulerRoot).getSize(new THREE.Vector3());
    assert.ok(h.x > s.x && h.z > s.z, "hauler is wider and longer");
    // Distinct silhouette: different mesh count, not a re-skin.
    let sm = 0, hm = 0;
    sedanRoot.traverse(o => { if (o.isMesh) sm++; });
    haulerRoot.traverse(o => { if (o.isMesh) hm++; });
    assert.notEqual(sm, hm);
    // Driver eye sits inside the hauler's cab (below its roof deck).
    const eye = hauler.driverEye.getWorldPosition(new THREE.Vector3());
    assert.ok(eye.y < VEHICLE_CLASSES.heavy.turretAnchor.y);
  }));

test("heavy turret anchor sits on the hauler roof, light anchor unchanged", () => {
  assert.deepEqual({ ...VEHICLE_CLASSES.light.turretAnchor }, { x: 0, y: 1.34, z: -0.65 });
  assert.ok(VEHICLE_CLASSES.heavy.turretAnchor.y > VEHICLE_CLASSES.light.turretAnchor.y);
});

function simulate(handling, seconds) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.solver.iterations = 10;
  const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(500, 1, 500)) });
  ground.position.set(0, -1, 0);
  ground.surface = "asphalt";
  world.addBody(ground);
  const vp = new VehiclePhysics(world, handling);
  vp.setVehicleTransform(0, 1.5, 0, 0);
  for (let i = 0; i < 60; i++) world.step(1 / 60);
  for (let i = 0; i < seconds * 60; i++) {
    vp.applyControls({ drive: 1, brake: 0, handbrake: 0, steeringAngle: 0 });
    world.step(1 / 60);
  }
  return vp.body.velocity.length();
}

test("heavy accelerates slower than light in a real cannon-es simulation", () => {
  const light = simulate(LIGHT_HANDLING, 4);
  const heavy = simulate(HEAVY_HANDLING, 4);
  assert.ok(light > 5, "light actually drives");
  assert.ok(heavy > 3, "heavy actually drives");
  assert.ok(heavy < light * 0.95, `heavy ${heavy} vs light ${light}`);
});

test("tutorial carries a short heavy-vehicle note", () => {
  assert.equal(HEAVY_NOTE[0], "HEAVY");
  assert.match(HEAVY_NOTE[1], /brake earlier/i);
});
