// ---------------------------------------------------------------------------
// Central, easy-to-tune configuration for the transforming roof turret and
// the practice targets it engages. Values are scaled to Driveworld's own
// world units (see world/World.js / Terrain.js -- a 400x400 unit map, cars
// a couple of meters long) rather than picked arbitrarily.
// ---------------------------------------------------------------------------

export const TURRET_CONFIG = {
  // Mechanical transformation timing (seconds for a full 0 -> 1 sweep).
  deployDuration: 1.15,
  undeployDuration: 0.85,

  // Aiming.
  range: 55,
  rotationSpeed: 3.2, // rad/s, yaw tracking speed
  elevationSpeed: 2.6, // rad/s, pitch tracking speed
  maxElevation: 1.0, // ~57 deg up
  minElevation: -0.2, // ~11 deg down
  aimTolerance: 0.035, // rad, how "on target" before firing is allowed

  // Firing.
  fireRate: 3.5, // rounds per second
  damage: 20,
  muzzleFlashDuration: 0.06,
  recoilDuration: 0.14,
  recoilKick: 0.06,
  tracerSpeed: 140, // world units/sec, purely visual travel speed

  // Target detection cadence. Aiming/tracking still happens every frame;
  // only *scanning for a new target* is throttled.
  targetScanInterval: 0.12
};

export const TARGET_CONFIG = {
  maxTargets: 10,
  minSpawnDistance: 18,
  maxSpawnDistance: 48,
  hoverHeight: 3.2,
  maxHealth: 60,
  respawnDelay: 4
};

// Roof anchor points, in each vehicle's own local space. The local player's
// Vehicle.js roof sits a little higher (panoramic glass roof) than the
// lighter-weight RemoteVehicle.js body, so each gets its own anchor. Both
// are positioned toward the rear of the roof, clear of the sunroof glass
// panel and just ahead of the roof's trailing edge.
export const LOCAL_TURRET_ANCHOR = { x: 0, y: 1.34, z: -0.85 };
export const REMOTE_TURRET_ANCHOR = { x: 0, y: 1.05, z: -0.85 };

export const TURRET_WIRE_STATES = [
  "undeployed",
  "deploying",
  "deployed",
  "undeploying"
];
