import * as THREE from "three";
import {
  Target,
  createSharedTargetAssets,
  createSharedBossAssets
} from "./Target.js";
import { TARGET_CONFIG, ENEMY_CONFIG } from "./TurretConfig.js";
import { TurretEffectsPool } from "./TurretEffects.js";

// ---------------------------------------------------------------------------
// WORLD BOUNDS
// ---------------------------------------------------------------------------
// Keep enemies well inside the boundary walls.
// World.js walls sit around +-199.
// ---------------------------------------------------------------------------
const WORLD_LIMIT = 185;

// ---------------------------------------------------------------------------
// SPAWN SEARCH SETTINGS
// ---------------------------------------------------------------------------

const SPAWN_ATTEMPTS = 100;

// Extra minimum distance from the fixed player spawn point.
// This is intentionally separate from the protected safe-zone radius.
//
// Example:
// protectedSpawnRadius = 30
// minDistanceFromPlayerSpawn = 75
//
// This means enemies cannot simply spawn at distance 31.
// They must be at least 75 units away from the original player spawn.
// ---------------------------------------------------------------------------
const DEFAULT_MIN_DISTANCE_FROM_PLAYER_SPAWN = 200;
const DEFAULT_BOSS_MIN_DISTANCE_FROM_PLAYER_SPAWN = 300;

// ---------------------------------------------------------------------------
// TargetSystem
// ---------------------------------------------------------------------------
// Owns every enemy (normal + boss) in the world.
//
// Enemies are local-only gameplay entities. They are not synchronized as
// multiplayer entities.
//
// Enemy attacks always target the local player's vehicle.
// ---------------------------------------------------------------------------
export class TargetSystem {
  constructor(scene, terrain, roads, playerHealth) {
    this.scene = scene;
    this.terrain = terrain;
    this.roads = roads;
    this.playerHealth = playerHealth;

    this.assets = createSharedTargetAssets();
    this.bossAssets = createSharedBossAssets();

    // Enemy projectile/effect pool.
    this.effectsPool = new TurretEffectsPool(scene);

    this.targets = [];
    this.respawnTimers = [];
    this.elapsed = 0;

    this.bossActive = false;
    this.bossRespawnTimer = ENEMY_CONFIG.boss.initialSpawnDelay;

    // Callbacks used by Game.js.
    this.onEnemyDestroyed = null;
    this.onBossSpawned = null;

    // Deterministic random generator.
    this.seed = 908070;

    // -----------------------------------------------------------------------
    // FIXED PLAYER SPAWN
    // -----------------------------------------------------------------------
    // Always use the configured world-space player spawn point.
    //
    // We clone this so the object cannot accidentally be modified by another
    // system.
    // -----------------------------------------------------------------------
    const configuredSpawn = ENEMY_CONFIG.spawn?.protectedSpawnCenter;

    this.playerSpawnCenter = new THREE.Vector3(
      configuredSpawn?.x ?? 0,
      0,
      configuredSpawn?.z ?? 0
    );

    // -----------------------------------------------------------------------
    // SAFE ZONE
    // -----------------------------------------------------------------------
    this.safeZoneRadius =
      ENEMY_CONFIG.spawn?.protectedSpawnRadius ??
      30;

    // -----------------------------------------------------------------------
    // EXTRA SPAWN DISTANCE FROM PLAYER SPAWN
    // -----------------------------------------------------------------------
    //
    // This is deliberately larger than the safe-zone radius.
    //
    // Safe zone:
    //       0 ---------------- 30
    //
    // Enemy minimum:
    //       0 ------------------------------- 75
    //
    // Therefore enemies will never appear immediately outside the safe zone.
    // -----------------------------------------------------------------------
    this.minDistanceFromPlayerSpawn =
      ENEMY_CONFIG.spawn?.minDistanceFromPlayerSpawn ??
      DEFAULT_MIN_DISTANCE_FROM_PLAYER_SPAWN;

    this.bossMinDistanceFromPlayerSpawn =
      ENEMY_CONFIG.spawn?.bossMinDistanceFromPlayerSpawn ??
      DEFAULT_BOSS_MIN_DISTANCE_FROM_PLAYER_SPAWN;
  }

  // -------------------------------------------------------------------------
  // DETERMINISTIC RANDOM
  // -------------------------------------------------------------------------
  random() {
    this.seed =
      (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;

    return this.seed / 4294967296;
  }

  // -------------------------------------------------------------------------
  // DISTANCE FROM PLAYER SPAWN
  // -------------------------------------------------------------------------
  //
  // Uses X/Z only because this is a ground-based spawn check.
  // Y/terrain height should not affect the safe-zone radius.
  // -------------------------------------------------------------------------
  distanceFromPlayerSpawn(x, z) {
    const dx = x - this.playerSpawnCenter.x;
    const dz = z - this.playerSpawnCenter.z;

    return Math.sqrt(dx * dx + dz * dz);
  }

  // -------------------------------------------------------------------------
  // SAFE ZONE CHECK
  // -------------------------------------------------------------------------
  //
  // Returns true if a position is physically inside the protected player
  // spawn area.
  // -------------------------------------------------------------------------
  isInsideProtectedSpawn(x, z) {
    const distance = this.distanceFromPlayerSpawn(x, z);

    return distance < this.safeZoneRadius;
  }

  // -------------------------------------------------------------------------
  // FAR-ENOUGH-FROM-PLAYER-SPAWN CHECK
  // -------------------------------------------------------------------------
  //
  // This is separate from the safe-zone check.
  //
  // An enemy can technically be outside the safe zone but still be too close
  // to the player's spawn. This prevents that.
  // -------------------------------------------------------------------------
  isFarEnoughFromPlayerSpawn(x, z, minimumDistance) {
    const distance = this.distanceFromPlayerSpawn(x, z);

    return distance >= minimumDistance;
  }

  // -------------------------------------------------------------------------
  // FAR-ENOUGH-FROM-CURRENT-PLAYER CHECK
  // -------------------------------------------------------------------------
  //
  // Prevents enemies from spawning directly beside the player while the
  // player is driving around the map.
  //
  // This is particularly important for respawns.
  // -------------------------------------------------------------------------
  isFarEnoughFromPlayer(x, z, center, minimumDistance) {
    if (!center) return true;

    const dx = x - center.x;
    const dz = z - center.z;

    const distanceSquared = dx * dx + dz * dz;

    return distanceSquared >= minimumDistance * minimumDistance;
  }

  // -------------------------------------------------------------------------
  // FIND SPAWN POSITION
  // -------------------------------------------------------------------------
  //
  // `center`
  //     Usually the player's CURRENT position.
  //
  // `minDistance / maxDistance`
  //     Desired distance around the current player.
  //
  // `minimumDistanceFromPlayerSpawn`
  //     Absolute minimum distance from the original player spawn.
  //
  // The candidate must satisfy ALL of the following:
  //
  // 1. Inside world boundary
  // 2. Outside safe zone
  // 3. Far enough from original player spawn
  // 4. Far enough from current player
  // 5. Located on grass
  //
  // -------------------------------------------------------------------------
  findSpawnPosition(
    center,
    minDistance,
    maxDistance,
    minimumDistanceFromPlayerSpawn
  ) {
    const spawnCenter = center ?? this.playerSpawnCenter;

    for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt++) {
      const angle =
        this.random() * Math.PI * 2;

      const distance =
        minDistance +
        this.random() * (maxDistance - minDistance);

      const x =
        spawnCenter.x +
        Math.cos(angle) * distance;

      const z =
        spawnCenter.z +
        Math.sin(angle) * distance;

      // ---------------------------------------------------------------
      // WORLD BOUNDARY
      // ---------------------------------------------------------------
      if (
        Math.abs(x) > WORLD_LIMIT ||
        Math.abs(z) > WORLD_LIMIT
      ) {
        continue;
      }

      // ---------------------------------------------------------------
      // SAFE ZONE
      // ---------------------------------------------------------------
      if (this.isInsideProtectedSpawn(x, z)) {
        continue;
      }

      // ---------------------------------------------------------------
      // EXTRA DISTANCE FROM ORIGINAL PLAYER SPAWN
      // ---------------------------------------------------------------
      if (
        !this.isFarEnoughFromPlayerSpawn(
          x,
          z,
          minimumDistanceFromPlayerSpawn
        )
      ) {
        continue;
      }

      // ---------------------------------------------------------------
      // DISTANCE FROM CURRENT PLAYER
      // ---------------------------------------------------------------
      if (
        !this.isFarEnoughFromPlayer(
          x,
          z,
          spawnCenter,
          minDistance
        )
      ) {
        continue;
      }

      // ---------------------------------------------------------------
      // ONLY SPAWN ON GRASS
      // ---------------------------------------------------------------
      if (
        !this.roads ||
        this.roads.surfaceAt(x, z) !== "grass"
      ) {
        continue;
      }

      // ---------------------------------------------------------------
      // TERRAIN HEIGHT
      // ---------------------------------------------------------------
      const y =
        this.terrain.heightAt(x, z) +
        TARGET_CONFIG.hoverHeight;

      return new THREE.Vector3(x, y, z);
    }

    // No valid position was found.
    return null;
  }

  // -------------------------------------------------------------------------
  // SPAWN NORMAL ENEMY
  // -------------------------------------------------------------------------
  spawnOne(center) {
    const position = this.findSpawnPosition(
      center,
      ENEMY_CONFIG.spawn.minDistance,
      ENEMY_CONFIG.spawn.maxDistance,
      this.minDistanceFromPlayerSpawn
    );

    if (!position) {
      return;
    }

    const target = new Target(
      this.scene,
      this.assets,
      position,
      "normal"
    );

    this.targets.push(target);
  }

  // -------------------------------------------------------------------------
  // SPAWN BOSS
  // -------------------------------------------------------------------------
  spawnBoss(center) {
    const position = this.findSpawnPosition(
      center,
      ENEMY_CONFIG.spawn.bossMinDistance,
      ENEMY_CONFIG.spawn.bossMaxDistance,
      this.bossMinDistanceFromPlayerSpawn
    );

    if (!position) {
      return;
    }

    const boss = new Target(
      this.scene,
      this.bossAssets,
      position,
      "boss"
    );

    this.targets.push(boss);

    this.bossActive = true;

    this.onBossSpawned?.(boss);
  }

  // -------------------------------------------------------------------------
  // UPDATE
  // -------------------------------------------------------------------------
  update(dt, playerPosition, camera, audio) {
    this.elapsed += dt;

    const ctx = {
      playerPosition,

      applyPlayerDamage: (amount, source) =>
        this.playerHealth?.applyDamage(amount, source),

      effectsPool: this.effectsPool,

      camera,

      audio
    };

    // -----------------------------------------------------------------------
    // UPDATE ALL TARGETS
    // -----------------------------------------------------------------------
    for (const target of this.targets) {
      target.update(
        dt,
        this.elapsed,
        ctx
      );
    }

    // -----------------------------------------------------------------------
    // UPDATE EFFECTS
    // -----------------------------------------------------------------------
    this.effectsPool.update(dt);

    // -----------------------------------------------------------------------
    // REMOVE DISPOSED TARGETS
    // -----------------------------------------------------------------------
    if (this.targets.some(t => t.disposed)) {
      this.targets =
        this.targets.filter(t => !t.disposed);
    }

    // -----------------------------------------------------------------------
    // RESPAWN NORMAL ENEMIES
    // -----------------------------------------------------------------------
    //
    // Respawned enemies go through the exact same safe/far spawn system.
    // -----------------------------------------------------------------------
    for (
      let i = this.respawnTimers.length - 1;
      i >= 0;
      i--
    ) {
      this.respawnTimers[i] -= dt;

      if (this.respawnTimers[i] <= 0) {
        this.respawnTimers.splice(i, 1);

        this.spawnOne(playerPosition);
      }
    }

    // -----------------------------------------------------------------------
    // NORMAL ENEMY COUNT
    // -----------------------------------------------------------------------
    const aliveNormal =
      this.targets.filter(
        t =>
          t.alive &&
          t.kind === "normal"
      ).length;

    const pendingNormal =
      aliveNormal +
      this.respawnTimers.length;

    if (
      pendingNormal <
      ENEMY_CONFIG.maxEnemies
    ) {
      this.spawnOne(playerPosition);
    }

    // -----------------------------------------------------------------------
    // BOSS
    // -----------------------------------------------------------------------
    //
    // Only one boss can exist at a time.
    // -----------------------------------------------------------------------
    if (!this.bossActive) {
      this.bossRespawnTimer -= dt;

      if (this.bossRespawnTimer <= 0) {
        this.spawnBoss(playerPosition);
      }
    }
  }

  // -------------------------------------------------------------------------
  // GET ACTIVE TARGETS
  // -------------------------------------------------------------------------
  getActiveTargets() {
    return this.targets.filter(
      target => target.alive
    );
  }

  // -------------------------------------------------------------------------
  // APPLY DAMAGE
  // -------------------------------------------------------------------------
  //
  // Applies damage and handles target destruction.
  // -------------------------------------------------------------------------
  applyDamage(target, amount) {
    const destroyed =
      target.applyDamage(amount);

    if (destroyed) {
      const kind = target.kind;

      target.dispose();

      if (kind === "boss") {
        this.bossActive = false;

        this.bossRespawnTimer =
          ENEMY_CONFIG.boss.respawnDelay;
      } else {
        this.respawnTimers.push(
          TARGET_CONFIG.respawnDelay
        );
      }

      this.onEnemyDestroyed?.(target);
    }

    return destroyed;
  }

  // -------------------------------------------------------------------------
  // DISPOSE
  // -------------------------------------------------------------------------
  dispose() {
    for (const target of this.targets) {
      target.dispose();
    }

    this.targets.length = 0;

    this.respawnTimers.length = 0;

    this.effectsPool.dispose();
  }
}