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

// ---------------------------------------------------------------------------
// Enemy/boss gameplay tuning. The "Target" entity (Target.js) is the same
// class for both -- `kind: "normal" | "boss"` picks which half of this
// config it reads. Kept separate from TARGET_CONFIG above (still used for
// hover height / spawn distances / respawn) so nothing there needs to move.
// ---------------------------------------------------------------------------
export const ENEMY_CONFIG = {
  maxEnemies: 10,

  normal: {
    maxHealth: 60,
    xpReward: 25,
    detectionRange: 45,
    attackRange: 30,
    attackDamage: 5,

    // Seconds between shots. Deliberately slow/"modern RPG" paced rather
    // than a fast machine-gun tick -- this is the single, authoritative
    // cooldown value: both the local visual sim (Target.js, used offline)
    // and the authoritative multiplayer server (server/EnemyWorld.js) read
    // this exact number, so there is nowhere else a competing cooldown
    // could be hardcoded.
    fireRate: 2.6
  },

  boss: {
    maxHealth: 1000,
    xpReward: 500,
    detectionRange: 100,
    attackRange: 80,
    burstDamagePerHit: 12,
    burstCount: 3,
    burstInterval: 0.3, // seconds between projectiles within a burst
    attackCooldown: 9, // seconds between bursts -- the actual gameplay pace
    telegraphDuration: 1.4, // warning time before the burst fires
    respawnDelay: 60,
    initialSpawnDelay: 20, // grace period before the first boss appears
    scale: 3.2
  },

  spawn: {
    minDistance: 18,
    maxDistance: 48,
    bossMinDistance: 60,
    bossMaxDistance: 110,

    // Matches VehiclePhysics.reset()'s spawn point -- fixed in world space,
    // never re-derived from the player's current position, so the zone
    // stays protected even after the player drives away and comes back.
    protectedSpawnCenter: { x: -3, z: -65 },
    protectedSpawnRadius: 35,

    // Extra minimum distance from the fixed player spawn point, deliberately
    // larger than protectedSpawnRadius above so enemies never appear
    // immediately outside the safe zone edge (see requirement #3).
    minDistanceFromPlayerSpawn: 200,
    bossMinDistanceFromPlayerSpawn: 300,

    // Keeps enemies from bunching into a single cluster (requirement #3).
    minDistanceBetweenEnemies: 14,

    // Kept a little inside World.js's boundary walls (+-199).
    worldLimit: 185
  }
};

// ---------------------------------------------------------------------------
// Player HP, leveling and progression. Centralized here alongside the
// enemy config since both feed the same combat loop.
// ---------------------------------------------------------------------------
export const PLAYER_CONFIG = {
  maxHealth: 100,
  respawnDelay: 3, // seconds spent in the death state before respawning -- gives the destruction sequence (explosion, wreck, death screen countdown) room to read
  hpPerLevel: 10, // + max HP each level
  turretDamageLevelInterval: 3, // every N levels...
  turretDamageBonusPerInterval: 0.05 // ...+5% turret damage
};

export const LEVEL_CONFIG = {
  baseXP: 100,
  curveExponent: 1.35 // xpRequired(level) = baseXP * level^curveExponent
};

// Roof anchor points, in each vehicle's own local space. The local player's
// Vehicle.js roof sits a little higher (panoramic glass roof) than the
// lighter-weight RemoteVehicle.js body, so each gets its own anchor. Both
// are positioned toward the rear of the roof, clear of the sunroof glass
// panel and just ahead of the roof's trailing edge.
export const LOCAL_TURRET_ANCHOR = { x: 0, y: 1.34, z: -0.65 };
export const REMOTE_TURRET_ANCHOR = { x: 0, y: 1.34, z: -0.65 };

export const TURRET_WIRE_STATES = [
  "undeployed",
  "deploying",
  "deployed",
  "undeploying"
];
