import * as THREE from "three";
import { ENEMY_CONFIG } from "./TurretConfig.js";
import { stepAngle } from "./TurretMath.js";
import { HealthBar } from "../gameplay/HealthBar.js";

// ---------------------------------------------------------------------------
// The former "practice target" is now a hostile enemy. Kept as the `Target`
// class (see project note: renaming risk vs. gameplay correctness) but it
// now carries AI state, an attack, and a floating HP bar. `kind` selects
// which half of ENEMY_CONFIG it reads -- "normal" or "boss" -- and boss
// instances additionally get a bigger body, a name, and a telegraphed
// burst attack instead of the normal single-shot attack.
//
// Geometry is shared (see createSharedTargetAssets / createSharedBossAssets)
// across every instance of a kind; only cloned bits (core material for
// damage-flash color, boss telegraph ring material) are per-instance.
// ---------------------------------------------------------------------------

const AI_STATE = {
  IDLE: "idle",
  ALERT: "alert",
  ATTACKING: "attacking",
  DEAD: "dead"
};

export function createSharedTargetAssets() {
  const core = new THREE.IcosahedronGeometry(0.55, 0);
  const ring = new THREE.TorusGeometry(0.85, 0.05, 8, 20);

  // Hostile red/orange rather than the old teal "practice" look.
  const coreMaterial = new THREE.MeshStandardMaterial({
    color: 0xe3502f,
    emissive: 0xbf3a1f,
    emissiveIntensity: 0.6,
    metalness: 0.2,
    roughness: 0.4
  });

  const ringMaterial = new THREE.MeshStandardMaterial({
    color: 0x1c1310,
    metalness: 0.7,
    roughness: 0.35
  });

  return { coreGeometry: core, ringGeometry: ring, coreMaterial, ringMaterial };
}

export function createSharedBossAssets() {
  const core = new THREE.IcosahedronGeometry(0.65, 1);
  const ring = new THREE.TorusGeometry(1.0, 0.08, 8, 24);

  const coreMaterial = new THREE.MeshStandardMaterial({
    color: 0x8a0f0f,
    emissive: 0xff2a1a,
    emissiveIntensity: 0.8,
    metalness: 0.35,
    roughness: 0.35
  });

  const ringMaterial = new THREE.MeshStandardMaterial({
    color: 0x120404,
    metalness: 0.8,
    roughness: 0.3
  });

  const telegraphGeometry = new THREE.RingGeometry(1.1, 1.3, 24);
  const telegraphMaterial = new THREE.MeshBasicMaterial({
    color: 0xff3b1f,
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide,
    depthWrite: false
  });

  return {
    coreGeometry: core,
    ringGeometry: ring,
    coreMaterial,
    ringMaterial,
    telegraphGeometry,
    telegraphMaterial
  };
}

export class Target {
  constructor(scene, assets, position, kind = "normal") {
    this.scene = scene;
    this.kind = kind;
    this.alive = true;
    this.disposed = false;

    const stats = kind === "boss" ? ENEMY_CONFIG.boss : ENEMY_CONFIG.normal;
    this.maxHealth = stats.maxHealth;
    this.health = this.maxHealth;
    this.xpReward = stats.xpReward;
    this.detectionRange = stats.detectionRange;
    this.attackRange = stats.attackRange;
    this.name = kind === "boss" ? "WAR MACHINE" : null;

    this.aiState = AI_STATE.IDLE;
    this.attackCooldown = 0;
    this.bossPhase = "cooldown";
    this.telegraphTimer = 0;
    this.burstShotsFired = 0;
    this.burstTimer = 0;

    this.group = new THREE.Group();
    this.group.position.copy(position);
    if (kind === "boss") this.group.scale.setScalar(ENEMY_CONFIG.boss.scale);

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

    if (kind === "boss") {
      this.telegraphRing = new THREE.Mesh(
        assets.telegraphGeometry,
        assets.telegraphMaterial.clone()
      );
      this.telegraphRing.rotation.x = -Math.PI / 2;
      this.telegraphRing.position.y = -0.3;
      this.telegraphRing.visible = false;
      this.group.add(this.telegraphRing);
    }

    scene.add(this.group);

    this.healthBar = new HealthBar(scene, kind === "boss"
      ? { width: 5.5, height: 0.42, yOffset: 4.4 }
      : { width: 1.5, height: 0.16, yOffset: 1.25 });
    this.healthBar.setRatio(1);
  }

  get position() {
    return this.group.position;
  }

  resetAttackPhase() {
    this.bossPhase = "cooldown";
    this.attackCooldown = 0;
    if (this.telegraphRing) this.telegraphRing.visible = false;
  }

  fireProjectileAt(ctx, damage) {
    const muzzle = this.position.clone();
    muzzle.y += 0.3;
    const impact = ctx.playerPosition.clone();

    ctx.effectsPool?.spawnTracer(muzzle, impact);
    ctx.effectsPool?.spawnImpact(impact);
    ctx.applyPlayerDamage?.(damage, this);
    this.flashTimer = Math.max(this.flashTimer, 0.15);

    ctx.audio?.playToneEffect?.({
      startFrequency: this.kind === "boss" ? 260 : 420,
      endFrequency: this.kind === "boss" ? 90 : 160,
      duration: 0.08,
      volume: 0.04,
      type: "sawtooth",
      destination: ctx.audio.effectsBus
    });
  }

  updateNormalAttack(dt, ctx) {
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    if (this.attackCooldown > 0) return;

    this.attackCooldown = ENEMY_CONFIG.normal.fireRate;
    this.fireProjectileAt(ctx, ENEMY_CONFIG.normal.attackDamage);
  }

  updateBossAttack(dt, ctx) {
    const cfg = ENEMY_CONFIG.boss;

    if (this.bossPhase === "cooldown") {
      this.attackCooldown = Math.max(0, this.attackCooldown - dt);
      if (this.attackCooldown <= 0) {
        this.bossPhase = "telegraph";
        this.telegraphTimer = cfg.telegraphDuration;
        if (this.telegraphRing) this.telegraphRing.visible = true;
      }
      return;
    }

    if (this.bossPhase === "telegraph") {
      this.telegraphTimer -= dt;

      if (this.telegraphRing) {
        const urgency = 1 - this.telegraphTimer / cfg.telegraphDuration;
        this.telegraphRing.scale.setScalar(1 + urgency * 0.7);
        this.telegraphRing.material.opacity =
          0.35 + 0.45 * Math.abs(Math.sin(this.telegraphTimer * 16));
      }

      if (this.telegraphTimer <= 0) {
        this.bossPhase = "firing";
        this.burstShotsFired = 0;
        this.burstTimer = 0;
        if (this.telegraphRing) this.telegraphRing.visible = false;
      }
      return;
    }

    // firing
    this.burstTimer -= dt;
    if (this.burstTimer <= 0 && this.burstShotsFired < cfg.burstCount) {
      this.burstTimer = cfg.burstInterval;
      this.burstShotsFired += 1;
      this.fireProjectileAt(ctx, cfg.burstDamagePerHit);
    }

    if (this.burstShotsFired >= cfg.burstCount) {
      this.bossPhase = "cooldown";
      this.attackCooldown = cfg.attackCooldown;
    }
  }

  // ctx: { playerPosition, applyPlayerDamage(amount, source), effectsPool,
  //        camera, audio }
  update(dt, elapsed, ctx) {
    if (!this.alive) return;

    this.group.position.y = this.baseY + Math.sin(elapsed * 1.4 + this.bobPhase) * 0.15;
    this.ring.rotation.z += dt * 1.6;

    const distanceToPlayer = ctx?.playerPosition
      ? ctx.playerPosition.distanceTo(this.position)
      : Infinity;

    if (this.aiState !== AI_STATE.ATTACKING) {
      this.aiState = distanceToPlayer <= this.detectionRange
        ? AI_STATE.ALERT
        : AI_STATE.IDLE;
    } else if (distanceToPlayer > this.detectionRange * 1.15) {
      this.aiState = AI_STATE.IDLE;
      this.resetAttackPhase();
    }

    if (this.aiState === AI_STATE.IDLE) {
      this.group.rotation.y += dt * 0.5;
    } else if (ctx?.playerPosition) {
      const dx = ctx.playerPosition.x - this.position.x;
      const dz = ctx.playerPosition.z - this.position.z;
      const desiredYaw = Math.atan2(dx, dz);
      this.group.rotation.y = stepAngle(this.group.rotation.y, desiredYaw, dt * 3.0);
    }

    if (this.aiState === AI_STATE.ALERT && distanceToPlayer <= this.attackRange) {
      this.aiState = AI_STATE.ATTACKING;
    } else if (
      this.aiState === AI_STATE.ATTACKING &&
      distanceToPlayer > this.attackRange * 1.2
    ) {
      this.aiState = AI_STATE.ALERT;
      this.resetAttackPhase();
    }

    if (this.aiState === AI_STATE.ATTACKING && ctx?.playerPosition) {
      if (this.kind === "boss") this.updateBossAttack(dt, ctx);
      else this.updateNormalAttack(dt, ctx);
    }

    if (this.flashTimer > 0) {
      this.flashTimer = Math.max(0, this.flashTimer - dt);
      this.material.emissiveIntensity = this.kind === "boss" ? 2.0 : 1.6;
    } else {
      this.material.emissiveIntensity = this.kind === "boss" ? 0.8 : 0.6;
    }

    this.healthBar.setRatio(this.health / this.maxHealth);
    if (ctx?.camera) this.healthBar.updateTransform(this.position, ctx.camera);
  }

  // Returns true the instant this hit destroys the target (i.e. it was
  // still alive before this call). Guarding on `this.alive` here is also
  // what keeps XP awards to exactly one per death (see TargetSystem).
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
      this.aiState = AI_STATE.DEAD;
      return true;
    }

    return false;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.group);
    this.material.dispose();
    if (this.telegraphRing) this.telegraphRing.material.dispose();
    this.healthBar.dispose();
  }
}
