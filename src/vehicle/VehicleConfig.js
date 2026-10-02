// ---------------------------------------------------------------------------
// VehicleConfig.js
//
// Registry of vehicle BODY types (visual builders, see VehicleVisual.js's
// buildVehicleBody) and of selectable vehicle CLASSES (what the player picks
// on the start screen). A class bundles: which body to build, which turret
// weapon path to mount, handling numbers, and armor.
//
// The LIGHT class is the original DriveWorld vehicle. Its handling profile
// below is a verbatim copy of the constants that used to be hard-coded in
// VehiclePhysics.js / ArcadeController.js, so selecting it (the default,
// including for every existing player) behaves exactly as before.
//
// Progression note: player level/XP are per-session (the server tracks them
// per connection; nothing is persisted locally), so level is shared by
// design within a session. What is vehicle-SPECIFIC is the turret weapon
// path: each class has its own evolution table and models (see
// EvolutionConfig.js getTurretEvolutionConfig(stage, path)), so the two can
// never overwrite each other.
// ---------------------------------------------------------------------------

export const VEHICLE_TYPES = {
  sedan: {
    id: "sedan",
    label: "Sedan"
  },
  hauler: {
    id: "hauler",
    label: "Armored Hauler"
  }
};

export const DEFAULT_VEHICLE_TYPE = "sedan";

// Original constants (VehiclePhysics.js / ArcadeController.js before
// vehicle classes existed). Do not change: LIGHT must stay the original.
export const LIGHT_HANDLING = Object.freeze({
  mass: 1050,
  chassisHalfExtents: Object.freeze([0.9, 0.3, 2]),
  chassisOffsetY: 0.15,
  wheelPositions: Object.freeze([
    [-0.95, 1.35, true],
    [0.95, 1.35, true],
    [-0.95, -1.35, false],
    [0.95, -1.35, false]
  ]),
  wheelRadius: 0.36,
  driveForce: 1800,
  brakeForce: 35,
  handbrakeForce: 65,
  maxSteerAngle: 0.48,
  steerResponse: 9,
  angularDamping: 0.35
});

export const HEAVY_HANDLING = Object.freeze({
  // ~1.8x the mass with ~1.45x the engine force: acceleration and top speed
  // land around 80% of the light vehicle (cannon-es damping is mass-
  // independent, so terminal speed scales with force/mass).
  mass: 1900,
  chassisHalfExtents: Object.freeze([1.08, 0.38, 2.3]),
  chassisOffsetY: 0.2,
  wheelPositions: Object.freeze([
    [-1.12, 1.55, true],
    [1.12, 1.55, true],
    [-1.12, -1.5, false],
    [1.12, -1.5, false]
  ]),
  wheelRadius: 0.44,
  driveForce: 2600,
  // Absolute brake force is higher, but per kilogram it is ~20% weaker:
  // the heavy vehicle needs a longer stopping distance.
  brakeForce: 52,
  handbrakeForce: 95,
  // Smaller lock and slower steering response = wider, heavier turns.
  maxSteerAngle: 0.4,
  steerResponse: 5.5,
  angularDamping: 0.5
});

export const VEHICLE_CLASSES = Object.freeze({
  light: Object.freeze({
    id: "light",
    label: "Light Vehicle",
    tagline: "Fast and agile",
    bodyType: "sedan",
    turretPath: "light",
    handling: LIGHT_HANDLING,
    // Multiplier on incoming damage (1 = original).
    damageTakenMultiplier: 1,
    // Multiplier on turret yaw/pitch tracking speed and deploy time.
    turretTrackingMultiplier: 1,
    turretDeployMultiplier: 1,
    // Turret hatch position on the roof (vehicle-local). Original value.
    turretAnchor: Object.freeze({ x: 0, y: 1.34, z: -0.65 }),
    // Scale applied to the level-based armour rig so it hugs the body.
    evolutionScale: Object.freeze([1, 1, 1])
  }),
  heavy: Object.freeze({
    id: "heavy",
    label: "Heavy Vehicle",
    tagline: "Armored and powerful",
    bodyType: "hauler",
    turretPath: "heavy",
    handling: HEAVY_HANDLING,
    // Armor plating: takes 30% less damage from every enemy attack.
    damageTakenMultiplier: 0.7,
    // The heavier cannon traverses more slowly and takes longer to deploy.
    turretTrackingMultiplier: 0.6,
    turretDeployMultiplier: 1.35,
    // Flush with the hauler's roof-deck turret collar (VehicleVisual.js).
    turretAnchor: Object.freeze({ x: 0, y: 1.5, z: -0.8 }),
    evolutionScale: Object.freeze([1.17, 1.12, 1.13])
  })
});

export const DEFAULT_VEHICLE_CLASS = "light";

export const VEHICLE_CLASS_STORAGE_KEY = "driveworld.vehicleClass.v1";

export function sanitizeVehicleClass(value) {
  return typeof value === "string" && Object.hasOwn(VEHICLE_CLASSES, value)
    ? value
    : DEFAULT_VEHICLE_CLASS;
}

export function getVehicleClass(id) {
  return VEHICLE_CLASSES[sanitizeVehicleClass(id)];
}

// Existing players have no saved value -> Light (the original vehicle).
export function loadSelectedVehicleClass(storage = globalThis.localStorage) {
  try {
    return sanitizeVehicleClass(storage?.getItem(VEHICLE_CLASS_STORAGE_KEY));
  } catch {
    return DEFAULT_VEHICLE_CLASS;
  }
}

export function saveSelectedVehicleClass(id, storage = globalThis.localStorage) {
  const value = sanitizeVehicleClass(id);
  try {
    storage?.setItem(VEHICLE_CLASS_STORAGE_KEY, value);
  } catch {
    /* Private mode: selection simply won't persist. */
  }
  return value;
}

// Body type used for a remote player, given whatever the server relayed.
export function bodyTypeForVehicleClass(id) {
  return getVehicleClass(id).bodyType;
}
