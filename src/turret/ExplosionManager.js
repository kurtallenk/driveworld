import * as THREE from "three";
import { Explosion } from "./ExplosionEffect.js";

// ---------------------------------------------------------------------------
// ExplosionManager -- one per scene (getExplosionManager(scene)).
//
// Every explosion in the game (turret shells/missiles, enemy rockets,
// destroyed vehicles, bosses) goes through here so that:
//   * instances are POOLED per config (meshes + materials are built once and
//     replayed via Explosion.reset, so steady fire allocates nothing);
//   * the number of live explosions and live particles is CAPPED -- when the
//     budget is full, the oldest explosion of equal-or-lower priority is
//     recycled, or a low-priority request is simply skipped;
//   * each tier gets a brief light flash from a small FIXED set of point
//     lights created up-front (no runtime light-count changes, which would
//     force every material to recompile);
//   * each tier can request a subtle camera shake via `onShake`, which the
//     manager suppresses entirely when the user prefers reduced motion.
// ---------------------------------------------------------------------------

export const EXPLOSION_TIERS = Object.freeze({
  impact: Object.freeze({ priority: 0, shake: 0, light: null }),
  shell: Object.freeze({
    priority: 1, shake: 0.12,
    light: Object.freeze({ color: 0xffa040, intensity: 6, distance: 9, duration: 0.12 })
  }),
  missile: Object.freeze({
    priority: 2, shake: 0.25,
    light: Object.freeze({ color: 0xff9030, intensity: 10, distance: 14, duration: 0.18 })
  }),
  vehicle: Object.freeze({
    priority: 3, shake: 0.45,
    light: Object.freeze({ color: 0xff8a2a, intensity: 14, distance: 18, duration: 0.25 })
  }),
  boss: Object.freeze({
    priority: 4, shake: 0.7,
    light: Object.freeze({ color: 0xff7a20, intensity: 20, distance: 26, duration: 0.35 })
  })
});

export const EXPLOSION_LIMITS = Object.freeze({
  maxActive: 12,
  maxParticles: 280,
  maxIdlePerConfig: 4,
  // Shakes are attenuated with distance from the listener and ignored
  // beyond this range.
  shakeRange: 45
});

export function tierOf(config) {
  return EXPLOSION_TIERS[config?.tier] ? config.tier : "missile";
}

export function prefersReducedMotion(win = globalThis.window) {
  try {
    return Boolean(win?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  } catch {
    return false;
  }
}

export class ExplosionManager {
  constructor(scene, { lightCount = 2, limits = EXPLOSION_LIMITS, reducedMotion } = {}) {
    this.scene = scene;
    this.limits = { ...EXPLOSION_LIMITS, ...limits };
    this.active = [];
    this.pools = new Map(); // config -> Explosion[] (idle)
    this.activeParticles = 0;
    this.reducedMotionOverride = reducedMotion;
    this.onShake = null; // (amount 0..1, worldPosition) => void
    this.listenerPosition = null; // THREE.Vector3 (e.g. the player car)
    this.stats = { spawned: 0, reused: 0, recycled: 0, skipped: 0 };

    this.lights = [];
    for (let i = 0; i < lightCount; i++) {
      const light = new THREE.PointLight(0xffa040, 0, 10, 2);
      light.castShadow = false;
      light.userData.life = 0;
      light.userData.duration = 1;
      light.userData.peak = 0;
      scene?.add(light);
      this.lights.push(light);
    }
  }

  get reducedMotion() {
    return this.reducedMotionOverride ?? prefersReducedMotion();
  }

  // Returns the Explosion (pooled) or null if the budget refused it.
  spawn(position, config) {
    const tierName = tierOf(config);
    const tier = EXPLOSION_TIERS[tierName];
    const pool = this.pools.get(config);
    const cost = pool?.[0]?.particleCount ?? estimateParticles(config);

    if (!this.makeRoom(cost, tier.priority)) {
      this.stats.skipped++;
      return null;
    }

    let explosion = pool?.pop();
    if (explosion) {
      explosion.reset(position);
      this.stats.reused++;
    } else {
      explosion = new Explosion(position, config);
    }
    explosion.tierName = tierName;
    explosion.priority = tier.priority;
    explosion.spawnOrder = this.stats.spawned++;

    if (!explosion.group.parent) this.scene?.add(explosion.group);
    this.active.push(explosion);
    this.activeParticles += explosion.particleCount;

    this.flash(position, tier.light);
    this.shake(position, tier.shake);
    return explosion;
  }

  // Frees budget for a new explosion by recycling the oldest live
  // explosions whose priority is <= `priority`. Returns false if the new
  // one still would not fit.
  makeRoom(cost, priority) {
    const fits = () =>
      this.active.length < this.limits.maxActive &&
      this.activeParticles + cost <= this.limits.maxParticles;
    while (!fits()) {
      let victim = -1;
      for (let i = 0; i < this.active.length; i++) {
        const e = this.active[i];
        if (e.priority > priority) continue;
        if (victim < 0 || e.spawnOrder < this.active[victim].spawnOrder) victim = i;
      }
      if (victim < 0) return false;
      this.release(victim);
      this.stats.recycled++;
    }
    return true;
  }

  release(index) {
    const explosion = this.active[index];
    this.active.splice(index, 1);
    this.activeParticles -= explosion.particleCount;
    explosion.group.visible = false;
    let pool = this.pools.get(explosion.sourceConfig);
    if (!pool) {
      pool = [];
      this.pools.set(explosion.sourceConfig, pool);
    }
    if (pool.length < this.limits.maxIdlePerConfig) {
      pool.push(explosion);
    } else {
      explosion.dispose(this.scene);
    }
  }

  flash(position, light) {
    if (!light || this.lights.length === 0) return;
    // Use an idle light, else steal the one closest to finishing.
    let chosen = this.lights[0];
    for (const l of this.lights) {
      if (l.userData.life <= 0) { chosen = l; break; }
      if (l.userData.life < chosen.userData.life) chosen = l;
    }
    chosen.position.set(position.x, position.y + 1, position.z);
    chosen.color.setHex(light.color);
    chosen.distance = light.distance;
    chosen.userData.peak = light.intensity;
    chosen.userData.duration = light.duration;
    chosen.userData.life = light.duration;
    chosen.intensity = light.intensity;
  }

  shake(position, amount) {
    if (!amount || !this.onShake || this.reducedMotion) return;
    let falloff = 1;
    if (this.listenerPosition) {
      const d = this.listenerPosition.distanceTo(position);
      if (d > this.limits.shakeRange) return;
      falloff = 1 - d / this.limits.shakeRange;
    }
    const value = amount * falloff * falloff;
    if (value > 0.01) this.onShake(value, position);
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      if (!this.active[i].update(dt)) this.release(i);
    }
    for (const l of this.lights) {
      if (l.userData.life <= 0) continue;
      l.userData.life = Math.max(0, l.userData.life - dt);
      const t = l.userData.life / Math.max(0.001, l.userData.duration);
      l.intensity = l.userData.peak * t * t;
    }
  }

  getStats() {
    let idle = 0;
    for (const pool of this.pools.values()) idle += pool.length;
    return {
      active: this.active.length,
      particles: this.activeParticles,
      idle,
      litLights: this.lights.filter(l => l.intensity > 0).length,
      ...this.stats
    };
  }

  dispose() {
    for (const e of this.active) e.dispose(this.scene);
    for (const pool of this.pools.values()) for (const e of pool) e.dispose(this.scene);
    this.active.length = 0;
    this.pools.clear();
    this.activeParticles = 0;
    for (const l of this.lights) {
      this.scene?.remove(l);
      l.dispose?.();
    }
    this.lights.length = 0;
  }
}

function estimateParticles(config) {
  return (config?.particleCount ?? 18) + (config?.debrisCount ?? 7) + (config?.smokeCount ?? 7);
}

const managers = new WeakMap();

// Scene-wide singleton. The first call (made eagerly by TurretEffectsPool,
// i.e. during Game construction) creates the fixed flash lights before the
// first render so no shader recompiles happen mid-game.
export function getExplosionManager(scene, options) {
  let manager = managers.get(scene);
  if (!manager) {
    const coarse = (() => {
      try { return globalThis.matchMedia?.("(pointer: coarse)")?.matches; } catch { return false; }
    })();
    manager = new ExplosionManager(scene, {
      lightCount: coarse ? 1 : 2,
      limits: coarse ? { maxActive: 8, maxParticles: 180 } : undefined,
      ...options
    });
    managers.set(scene, manager);
  }
  return manager;
}
