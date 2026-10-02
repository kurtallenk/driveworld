import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  ExplosionManager,
  EXPLOSION_TIERS,
  getExplosionManager,
  tierOf
} from "../src/turret/ExplosionManager.js";
import {
  PLAYER_MISSILE_EXPLOSION_CONFIG,
  HEAVY_SHELL_EXPLOSION_CONFIG,
  VEHICLE_EXPLOSION_CONFIG,
  BOSS_EXPLOSION_CONFIG,
  APEX_ROCKET_EXPLOSION_CONFIG,
  APEX_ROCKET_LAUNCH_FLASH_CONFIG
} from "../src/turret/ExplosionEffect.js";

const at = (x = 0) => new THREE.Vector3(x, 0, 0);
const run = (m, seconds) => { for (let t = 0; t < seconds; t += 1 / 60) m.update(1 / 60); };

test("every explosion config maps to a size tier, ordered by size", () => {
  assert.equal(tierOf(APEX_ROCKET_LAUNCH_FLASH_CONFIG), "impact");
  assert.equal(tierOf(HEAVY_SHELL_EXPLOSION_CONFIG), "shell");
  assert.equal(tierOf(PLAYER_MISSILE_EXPLOSION_CONFIG), "missile");
  assert.equal(tierOf(VEHICLE_EXPLOSION_CONFIG), "vehicle");
  assert.equal(tierOf(BOSS_EXPLOSION_CONFIG), "boss");
  assert.equal(tierOf(APEX_ROCKET_EXPLOSION_CONFIG), "boss");
  const order = ["impact", "shell", "missile", "vehicle", "boss"];
  for (let i = 1; i < order.length; i++) {
    assert.ok(EXPLOSION_TIERS[order[i]].priority > EXPLOSION_TIERS[order[i - 1]].priority);
    assert.ok(EXPLOSION_TIERS[order[i]].shake >= EXPLOSION_TIERS[order[i - 1]].shake);
  }
  assert.ok(HEAVY_SHELL_EXPLOSION_CONFIG.radius < PLAYER_MISSILE_EXPLOSION_CONFIG.radius);
  assert.ok(PLAYER_MISSILE_EXPLOSION_CONFIG.radius < VEHICLE_EXPLOSION_CONFIG.radius);
  assert.ok(VEHICLE_EXPLOSION_CONFIG.radius < BOSS_EXPLOSION_CONFIG.radius);
});

test("finished explosions are removed from view and pooled, then reused", () => {
  const scene = new THREE.Scene();
  const m = new ExplosionManager(scene, { reducedMotion: true });
  const first = m.spawn(at(), HEAVY_SHELL_EXPLOSION_CONFIG);
  assert.ok(first);
  assert.equal(m.getStats().active, 1);
  run(m, 1);
  assert.equal(m.getStats().active, 0);
  assert.equal(m.getStats().particles, 0);
  assert.equal(first.group.visible, false);
  const second = m.spawn(at(3), HEAVY_SHELL_EXPLOSION_CONFIG);
  assert.equal(second, first, "same instance replayed");
  assert.equal(second.group.visible, true);
  assert.equal(second.group.position.x, 3);
  assert.equal(m.getStats().reused, 1);
});

test("live explosions and particles never exceed the caps", () => {
  const scene = new THREE.Scene();
  const m = new ExplosionManager(scene, { reducedMotion: true, limits: { maxActive: 5, maxParticles: 100 } });
  for (let i = 0; i < 60; i++) {
    m.spawn(at(i), i % 3 ? HEAVY_SHELL_EXPLOSION_CONFIG : PLAYER_MISSILE_EXPLOSION_CONFIG);
    m.update(1 / 120);
    const s = m.getStats();
    assert.ok(s.active <= 5, `active ${s.active}`);
    assert.ok(s.particles <= 100, `particles ${s.particles}`);
  }
  assert.ok(m.getStats().recycled > 0);
});

test("low-priority requests cannot evict bigger explosions", () => {
  const scene = new THREE.Scene();
  const m = new ExplosionManager(scene, { reducedMotion: true, limits: { maxActive: 1 } });
  const boss = m.spawn(at(), BOSS_EXPLOSION_CONFIG);
  assert.ok(boss);
  assert.equal(m.spawn(at(), HEAVY_SHELL_EXPLOSION_CONFIG), null);
  assert.equal(m.getStats().skipped, 1);
  assert.ok(m.active.includes(boss));
});

test("flash lights are a fixed set created up front and fade out", () => {
  const scene = new THREE.Scene();
  const m = new ExplosionManager(scene, { lightCount: 2, reducedMotion: true });
  const lightCount = () => scene.children.filter(c => c.isPointLight).length;
  assert.equal(lightCount(), 2);
  for (let i = 0; i < 6; i++) m.spawn(at(i), VEHICLE_EXPLOSION_CONFIG);
  assert.equal(lightCount(), 2, "no lights added at runtime");
  assert.ok(m.getStats().litLights > 0);
  run(m, 1.5);
  assert.equal(m.getStats().litLights, 0);
});

test("camera shake is attenuated by distance and disabled for reduced motion", () => {
  const scene = new THREE.Scene();
  const shakes = [];
  const m = new ExplosionManager(scene, { reducedMotion: false });
  m.onShake = a => shakes.push(a);
  m.listenerPosition = new THREE.Vector3();
  m.spawn(at(2), VEHICLE_EXPLOSION_CONFIG);
  m.spawn(at(30), VEHICLE_EXPLOSION_CONFIG);
  m.spawn(at(500), VEHICLE_EXPLOSION_CONFIG);
  m.spawn(at(1), APEX_ROCKET_LAUNCH_FLASH_CONFIG); // impact tier: no shake
  assert.equal(shakes.length, 2);
  assert.ok(shakes[0] > shakes[1]);
  assert.ok(shakes[0] <= EXPLOSION_TIERS.vehicle.shake);

  const calm = [];
  const r = new ExplosionManager(scene, { reducedMotion: true });
  r.onShake = a => calm.push(a);
  r.spawn(at(), BOSS_EXPLOSION_CONFIG);
  assert.equal(calm.length, 0);
});

test("dispose removes everything from the scene", () => {
  const scene = new THREE.Scene();
  const m = new ExplosionManager(scene, { reducedMotion: true });
  m.spawn(at(), PLAYER_MISSILE_EXPLOSION_CONFIG);
  m.spawn(at(), HEAVY_SHELL_EXPLOSION_CONFIG);
  run(m, 0.2);
  m.dispose();
  assert.equal(scene.children.length, 0);
});

test("getExplosionManager is a per-scene singleton", () => {
  const a = new THREE.Scene();
  const b = new THREE.Scene();
  assert.equal(getExplosionManager(a), getExplosionManager(a));
  assert.notEqual(getExplosionManager(a), getExplosionManager(b));
});
