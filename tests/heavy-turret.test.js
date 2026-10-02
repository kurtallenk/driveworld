import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  TURRET_EVOLUTION_CONFIG,
  HEAVY_TURRET_EVOLUTION_CONFIG,
  getTurretEvolutionConfig
} from "../src/gameplay/EvolutionConfig.js";
import { createTurretAssembly } from "../src/turret/TurretModel.js";
import { createHeavyTurretAssembly, createTurretAssemblyForPath } from "../src/turret/HeavyTurretModel.js";
import { TurretEvolutionRig } from "../src/turret/TurretEvolution.js";
import {
  getWeaponImpactExplosion,
  PLAYER_MISSILE_EXPLOSION_CONFIG,
  HEAVY_SHELL_EXPLOSION_CONFIG,
  HEAVY_MORTAR_EXPLOSION_CONFIG
} from "../src/turret/ExplosionEffect.js";
import { Turret } from "../src/turret/Turret.js";
import { TURRET_CONFIG } from "../src/turret/TurretConfig.js";
import { VEHICLE_CLASSES } from "../src/vehicle/VehicleConfig.js";

const dps = c => c.fireRateMultiplier * c.damageMultiplier * c.mounts;

test("light turret path is unchanged and is the default", () => {
  for (let s = 0; s < 6; s++) {
    assert.equal(getTurretEvolutionConfig(s), TURRET_EVOLUTION_CONFIG[s]);
    assert.equal(getTurretEvolutionConfig(s, "light"), TURRET_EVOLUTION_CONFIG[s]);
    assert.equal(getTurretEvolutionConfig(s, "bogus"), TURRET_EVOLUTION_CONFIG[s]);
  }
  assert.equal(TURRET_EVOLUTION_CONFIG[0].label, "DEFAULT GUN");
  assert.equal(TURRET_EVOLUTION_CONFIG[5].weaponType, "missile");
});

test("heavy path is a separate 6-stage table on the same level milestones", () => {
  assert.equal(HEAVY_TURRET_EVOLUTION_CONFIG.length, 6);
  assert.notEqual(HEAVY_TURRET_EVOLUTION_CONFIG, TURRET_EVOLUTION_CONFIG);
  const lightLabels = new Set(TURRET_EVOLUTION_CONFIG.map(c => c.label));
  HEAVY_TURRET_EVOLUTION_CONFIG.forEach((c, s) => {
    assert.equal(c.stage, s);
    assert.equal(c.level, TURRET_EVOLUTION_CONFIG[s].level);
    assert.ok(!lightLabels.has(c.label), `${c.label} is heavy-specific`);
    assert.equal(getTurretEvolutionConfig(s, "heavy"), c);
  });
});

test("heavy cannon is slower but harder hitting, ~1.2x sustained DPS", () => {
  HEAVY_TURRET_EVOLUTION_CONFIG.forEach((h, s) => {
    const l = TURRET_EVOLUTION_CONFIG[s];
    assert.ok(h.fireRateMultiplier < l.fireRateMultiplier || s === 5, `stage ${s} slower`);
    const ratio = dps(h) / dps(l);
    assert.ok(ratio > 1.1 && ratio < 1.3, `stage ${s} dps ratio ${ratio.toFixed(2)}`);
  });
});

test("every heavy hit stays under the server's per-hit damage cap", () => {
  const SERVER_CAP = 20 * 10;
  const maxLevelBonus = 1.5; // generous upper bound on level-up damage scaling
  for (const c of HEAVY_TURRET_EVOLUTION_CONFIG) {
    assert.ok(TURRET_CONFIG.damage * maxLevelBonus * c.damageMultiplier < SERVER_CAP, c.label);
  }
});

test("heavy model keeps the light parts contract with a distinct, larger silhouette", () => {
  const light = createTurretAssembly(0xff0000);
  const heavy = createHeavyTurretAssembly(0xff0000);
  assert.deepEqual(Object.keys(heavy.parts).sort(), Object.keys(light.parts).sort());
  assert.ok(heavy.root.scale.x > 1);
  assert.equal(heavy.root.userData.turretKind, "heavy");
  assert.ok(heavy.barrelLength > light.barrelLength);
  assert.equal(createTurretAssemblyForPath("light", 0).root.userData.turretKind, undefined);
  assert.equal(createTurretAssemblyForPath("heavy", 0).root.userData.turretKind, "heavy");
});

test("each path's evolution rig exposes muzzles matching its config mounts", () => {
  for (const path of ["light", "heavy"]) {
    const assembly = createTurretAssemblyForPath(path, 0x00ff00);
    const rig = new TurretEvolutionRig(assembly.parts, path);
    const table = path === "heavy" ? HEAVY_TURRET_EVOLUTION_CONFIG : TURRET_EVOLUTION_CONFIG;
    for (let s = 0; s < 6; s++) {
      rig.setStage(s, { animate: false });
      assert.equal(rig.getDamageConfig(), table[s]);
      if (!(path === "light" && s === 5)) {
        assert.equal(rig.getMuzzlePoints().length, table[s].mounts, `${path} stage ${s}`);
      }
      rig.update(0.016, { deployed: true, firing: true });
    }
    rig.dispose();
  }
});

test("impact explosions: light sparks, missile and heavy shells explode", () => {
  assert.equal(getWeaponImpactExplosion(TURRET_EVOLUTION_CONFIG[0]), null);
  assert.equal(getWeaponImpactExplosion(TURRET_EVOLUTION_CONFIG[5]), PLAYER_MISSILE_EXPLOSION_CONFIG);
  assert.equal(getWeaponImpactExplosion(HEAVY_TURRET_EVOLUTION_CONFIG[0]), HEAVY_SHELL_EXPLOSION_CONFIG);
  assert.equal(getWeaponImpactExplosion(HEAVY_TURRET_EVOLUTION_CONFIG[4]), HEAVY_MORTAR_EXPLOSION_CONFIG);
  assert.ok(HEAVY_MORTAR_EXPLOSION_CONFIG.radius > HEAVY_SHELL_EXPLOSION_CONFIG.radius);
  assert.ok(HEAVY_SHELL_EXPLOSION_CONFIG.particleCount < PLAYER_MISSILE_EXPLOSION_CONFIG.particleCount);
});

test("Turret picks path, slower tracking and deploy from the vehicle class", () => {
  const scene = new THREE.Scene();
  const light = new Turret(new THREE.Group(), scene, null, 0xff0000);
  assert.equal(light.path, "light");
  assert.equal(light.trackingMultiplier, 1);
  assert.equal(light.deployMultiplier, 1);
  const heavy = new Turret(new THREE.Group(), scene, null, 0xff0000, VEHICLE_CLASSES.heavy);
  assert.equal(heavy.path, "heavy");
  assert.equal(heavy.evolution.path, "heavy");
  assert.equal(heavy.trackingMultiplier, VEHICLE_CLASSES.heavy.turretTrackingMultiplier);
  assert.ok(heavy.deployMultiplier > 1);
});
