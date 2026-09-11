import * as THREE from "three";
import { TARGET_CONFIG } from "./TurretConfig.js";

// ---------------------------------------------------------------------------
// A small hovering drone-like practice target for the turret to engage.
// Geometry is shared (see createSharedTargetAssets); only the emissive core
// material is cloned per-instance so damage flashes/hue shifts don't affect
// other targets.
// ---------------------------------------------------------------------------

export function createSharedTargetAssets() {
  const core = new THREE.IcosahedronGeometry(0.55, 0);
  const ring = new THREE.TorusGeometry(0.85, 0.05, 8, 20);

  const coreMaterial = new THREE.MeshStandardMaterial({
    color: 0x2fe3c8,
    emissive: 0x1fbf9e,
    emissiveIntensity: 0.6,
    metalness: 0.2,
    roughness: 0.4
  });

  const ringMaterial = new THREE.MeshStandardMaterial({
    color: 0x1c2128,
    metalness: 0.7,
    roughness: 0.35
  });

  return { coreGeometry: core, ringGeometry: ring, coreMaterial, ringMaterial };
}

export class Target {
  constructor(scene, assets, position) {
    this.scene = scene;
    this.alive = true;
    this.disposed = false;
    this.health = TARGET_CONFIG.maxHealth;
    this.maxHealth = TARGET_CONFIG.maxHealth;

    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.baseY = position.y;
    this.bobPhase = Math.random() * Math.PI * 2;
    this.flashTimer = 0;

    this.material = assets.coreMaterial.clone();

    const core = new THREE.Mesh(assets.coreGeometry, this.material);
    core.castShadow = true;
    this.group.add(core);

    this.ring = new THREE.Mesh(assets.ringGeometry, assets.ringMaterial);
    this.ring.rotation.x = Math.PI / 2;
    this.group.add(this.ring);

    scene.add(this.group);
  }

  get position() {
    return this.group.position;
  }

  update(dt, elapsed) {
    if (!this.alive) return;

    this.group.position.y = this.baseY + Math.sin(elapsed * 1.4 + this.bobPhase) * 0.15;
    this.group.rotation.y += dt * 0.5;
    this.ring.rotation.z += dt * 1.6;

    if (this.flashTimer > 0) {
      this.flashTimer = Math.max(0, this.flashTimer - dt);
      this.material.emissiveIntensity = 1.6;
    } else {
      this.material.emissiveIntensity = 0.6;
    }
  }

  // Returns true the instant this hit destroys the target (i.e. it was
  // still alive before this call).
  applyDamage(amount) {
    if (!this.alive) return false;

    this.health -= amount;
    this.flashTimer = 0.12;

    const ratio = Math.max(0, this.health / this.maxHealth);
    // Green (healthy) -> red (critical). Hue 0.33 = green, 0 = red.
    this.material.color.setHSL(ratio * 0.33, 0.85, 0.5);
    this.material.emissive.copy(this.material.color);

    if (this.health <= 0) {
      this.alive = false;
      return true;
    }

    return false;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.group);
    this.material.dispose();
  }
}
