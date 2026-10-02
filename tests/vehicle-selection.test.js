import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_VEHICLE_CLASS,
  HEAVY_HANDLING,
  LIGHT_HANDLING,
  VEHICLE_CLASSES,
  VEHICLE_CLASS_STORAGE_KEY,
  bodyTypeForVehicleClass,
  getVehicleClass,
  loadSelectedVehicleClass,
  sanitizeVehicleClass,
  saveSelectedVehicleClass
} from "../src/vehicle/VehicleConfig.js";
import { ArcadeController } from "../src/vehicle/ArcadeController.js";

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    data
  };
}

test("default vehicle class is light (the original vehicle)", () => {
  assert.equal(DEFAULT_VEHICLE_CLASS, "light");
  assert.equal(getVehicleClass(undefined).id, "light");
  assert.equal(getVehicleClass("light").bodyType, "sedan");
  assert.equal(getVehicleClass("light").turretPath, "light");
});

test("sanitizeVehicleClass rejects unknown or hostile values", () => {
  for (const bad of [undefined, null, "", "tank", "__proto__", "constructor", 42, {}]) {
    assert.equal(sanitizeVehicleClass(bad), "light");
  }
  assert.equal(sanitizeVehicleClass("heavy"), "heavy");
});

test("selection save/load round-trips through storage", () => {
  const storage = memoryStorage();
  assert.equal(saveSelectedVehicleClass("heavy", storage), "heavy");
  assert.equal(storage.data.get(VEHICLE_CLASS_STORAGE_KEY), "heavy");
  assert.equal(loadSelectedVehicleClass(storage), "heavy");
  saveSelectedVehicleClass("light", storage);
  assert.equal(loadSelectedVehicleClass(storage), "light");
});

test("existing players with no / corrupt saved choice load as light", () => {
  assert.equal(loadSelectedVehicleClass(memoryStorage()), "light");
  assert.equal(
    loadSelectedVehicleClass(memoryStorage({ [VEHICLE_CLASS_STORAGE_KEY]: "garbage" })),
    "light"
  );
  const throwing = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
  assert.equal(loadSelectedVehicleClass(throwing), "light");
  assert.equal(saveSelectedVehicleClass("heavy", throwing), "heavy");
  assert.equal(loadSelectedVehicleClass(null), "light");
});

test("light handling is exactly the original vehicle constants", () => {
  assert.equal(LIGHT_HANDLING.mass, 1050);
  assert.deepEqual([...LIGHT_HANDLING.chassisHalfExtents], [0.9, 0.3, 2]);
  assert.equal(LIGHT_HANDLING.chassisOffsetY, 0.15);
  assert.deepEqual(LIGHT_HANDLING.wheelPositions.map(p => [...p]), [
    [-0.95, 1.35, true], [0.95, 1.35, true], [-0.95, -1.35, false], [0.95, -1.35, false]
  ]);
  assert.equal(LIGHT_HANDLING.wheelRadius, 0.36);
  assert.equal(LIGHT_HANDLING.driveForce, 1800);
  assert.equal(LIGHT_HANDLING.brakeForce, 35);
  assert.equal(LIGHT_HANDLING.handbrakeForce, 65);
  assert.equal(LIGHT_HANDLING.maxSteerAngle, 0.48);
  assert.equal(LIGHT_HANDLING.steerResponse, 9);
  assert.equal(LIGHT_HANDLING.angularDamping, 0.35);
  assert.equal(VEHICLE_CLASSES.light.damageTakenMultiplier, 1);
  assert.equal(VEHICLE_CLASSES.light.turretTrackingMultiplier, 1);
  assert.equal(VEHICLE_CLASSES.light.turretDeployMultiplier, 1);
});

test("heavy class trades speed and agility for armor", () => {
  const heavy = VEHICLE_CLASSES.heavy;
  assert.equal(heavy.bodyType, "hauler");
  assert.equal(heavy.turretPath, "heavy");
  assert.equal(bodyTypeForVehicleClass("heavy"), "hauler");
  // Lower acceleration (force per kg) than light.
  assert.ok(HEAVY_HANDLING.driveForce / HEAVY_HANDLING.mass <
    LIGHT_HANDLING.driveForce / LIGHT_HANDLING.mass);
  // Weaker braking per kg -> longer stopping distance.
  assert.ok(HEAVY_HANDLING.brakeForce / HEAVY_HANDLING.mass <
    LIGHT_HANDLING.brakeForce / LIGHT_HANDLING.mass);
  // Wider turns: less steering lock and slower response.
  assert.ok(HEAVY_HANDLING.maxSteerAngle < LIGHT_HANDLING.maxSteerAngle);
  assert.ok(HEAVY_HANDLING.steerResponse < LIGHT_HANDLING.steerResponse);
  // Bigger and heavier.
  assert.ok(HEAVY_HANDLING.mass > LIGHT_HANDLING.mass);
  assert.ok(HEAVY_HANDLING.wheelRadius > LIGHT_HANDLING.wheelRadius);
  // Armor and slower turret.
  assert.equal(heavy.damageTakenMultiplier, 0.7);
  assert.ok(heavy.turretTrackingMultiplier < 1);
  assert.ok(heavy.turretDeployMultiplier > 1);
});

test("class registry is frozen so gameplay code cannot mutate it", () => {
  assert.ok(Object.isFrozen(VEHICLE_CLASSES));
  assert.ok(Object.isFrozen(VEHICLE_CLASSES.heavy));
  assert.ok(Object.isFrozen(LIGHT_HANDLING));
});

test("ArcadeController defaults are unchanged; heavy handling is accepted", () => {
  const original = new ArcadeController();
  assert.equal(original.maxSteerAngle, 0.48);
  assert.equal(original.steerResponse, 9);
  const heavy = new ArcadeController(HEAVY_HANDLING);
  assert.equal(heavy.maxSteerAngle, HEAVY_HANDLING.maxSteerAngle);
  assert.equal(heavy.steerResponse, HEAVY_HANDLING.steerResponse);
});
