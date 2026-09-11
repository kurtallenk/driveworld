import * as THREE from "three";
import { Target, createSharedTargetAssets } from "./Target.js";
import { TARGET_CONFIG } from "./TurretConfig.js";

// Keep spawns well inside the boundary walls (see world/World.js, walls sit
// at +-199).
const WORLD_LIMIT = 185;

// ---------------------------------------------------------------------------
// Owns every practice target in the world. Only runs for the local player
// (see requirement: remote turrets never run their own target AI) --
// targets themselves are a single-player practice feature layered on top of
// the shared multiplayer world, not a synchronized entity type.
// ---------------------------------------------------------------------------
export class TargetSystem {
  constructor(scene, terrain, roads) {
    this.scene = scene;
    this.terrain = terrain;
    this.roads = roads;
    this.assets = createSharedTargetAssets();

    this.targets = [];
    this.respawnTimers = [];
    this.elapsed = 0;

    // Small deterministic LCG so target placement is reproducible within a
    // session (same spirit as World.js's tree scattering) without pulling
    // in Math.random() churn every attempt.
    this.seed = 908070;
  }

  random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  findSpawnPosition(center) {
    for (let attempt = 0; attempt < 24; attempt++) {
      const angle = this.random() * Math.PI * 2;
      const distance =
        TARGET_CONFIG.minSpawnDistance +
        this.random() * (TARGET_CONFIG.maxSpawnDistance - TARGET_CONFIG.minSpawnDistance);

      const x = center.x + Math.cos(angle) * distance;
      const z = center.z + Math.sin(angle) * distance;

      if (Math.abs(x) > WORLD_LIMIT || Math.abs(z) > WORLD_LIMIT) continue;
      if (this.roads.surfaceAt(x, z) !== "grass") continue;

      const y = this.terrain.heightAt(x, z) + TARGET_CONFIG.hoverHeight;
      return new THREE.Vector3(x, y, z);
    }

    return null;
  }

  spawnOne(center) {
    const position = this.findSpawnPosition(center);
    if (!position) return;

    this.targets.push(new Target(this.scene, this.assets, position));
  }

  update(dt, playerPosition) {
    this.elapsed += dt;

    for (const target of this.targets) {
      target.update(dt, this.elapsed);
    }

    // Drop fully-disposed entries so the array doesn't grow forever.
    if (this.targets.some(t => t.disposed)) {
      this.targets = this.targets.filter(t => !t.disposed);
    }

    for (let i = this.respawnTimers.length - 1; i >= 0; i--) {
      this.respawnTimers[i] -= dt;

      if (this.respawnTimers[i] <= 0) {
        this.respawnTimers.splice(i, 1);
        this.spawnOne(playerPosition);
      }
    }

    const alive = this.targets.filter(t => t.alive).length;
    const pending = alive + this.respawnTimers.length;

    if (pending < TARGET_CONFIG.maxTargets) {
      this.spawnOne(playerPosition);
    }
  }

  getActiveTargets() {
    return this.targets.filter(t => t.alive);
  }

  // Applies damage and, if this shot destroys the target, disposes it and
  // queues a respawn after TARGET_CONFIG.respawnDelay. Returns true if the
  // target was destroyed by this call.
  applyDamage(target, amount) {
    const destroyed = target.applyDamage(amount);

    if (destroyed) {
      target.dispose();
      this.respawnTimers.push(TARGET_CONFIG.respawnDelay);
    }

    return destroyed;
  }

  dispose() {
    for (const target of this.targets) target.dispose();
    this.targets.length = 0;
    this.respawnTimers.length = 0;
  }
}
