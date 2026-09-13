import * as THREE from "three";
import { createTurretAssembly } from "./TurretModel.js";
import { applyTurretPose } from "./TurretPose.js";
import { TurretEffectsPool } from "./TurretEffects.js";
import { TURRET_CONFIG, LOCAL_TURRET_ANCHOR } from "./TurretConfig.js";
import { stepAngle, stepToward, clamp, angleDifference } from "./TurretMath.js";

const STATE = {
  UNDEPLOYED: "undeployed",
  DEPLOYING: "deploying",
  DEPLOYED: "deployed",
  UNDEPLOYING: "undeploying"
};

const STATUS_TEXT = {
  [STATE.UNDEPLOYED]: "TURRET: OFFLINE",
  [STATE.DEPLOYING]: "TURRET: DEPLOYING…",
  [STATE.DEPLOYED]: "TURRET: ACTIVE",
  [STATE.UNDEPLOYING]: "TURRET: RETRACTING…"
};

// Reused scratch objects -- avoids allocating a Vector3/Quaternion every
// frame for aiming math (see requirement: avoid per-frame allocations).
const scratchTargetWorld = new THREE.Vector3();
const scratchTurretWorld = new THREE.Vector3();
const scratchLocalDir = new THREE.Vector3();
const scratchInverseQuat = new THREE.Quaternion();
const scratchMuzzleWorld = new THREE.Vector3();

export class Turret {
  constructor(vehicleRoot, scene, audio, initialColor) {
    this.vehicleRoot = vehicleRoot;
    this.scene = scene;
    this.audio = audio ?? null;

    const assembly = createTurretAssembly(initialColor ?? 0xef5350);
    this.parts = assembly.parts;

    assembly.root.position.set(
      LOCAL_TURRET_ANCHOR.x,
      LOCAL_TURRET_ANCHOR.y,
      LOCAL_TURRET_ANCHOR.z
    );
    vehicleRoot.add(assembly.root);

    this.state = STATE.UNDEPLOYED;
    this.progress = 0;

    this.yaw = 0;
    this.pitch = 0;

    this.target = null;
    this.scanTimer = 0;

    this.fireCooldown = 0;
    this.fireSeq = 0;
    this.recoil = 0;
    this.flash = 0;

    // Scaled up by Game.js as the player levels up (see PLAYER_CONFIG's
    // turretDamageBonusPerInterval). Kept as a plain multiplier here so
    // Turret.js doesn't need to know anything about the leveling system.
    this.damageMultiplier = 1;

    this.effects = new TurretEffectsPool(scene);

    applyTurretPose(this.parts, {
      progress: 0, yaw: 0, pitch: 0, recoil: 0, flash: 0
    });
  }

  // Called once when the player dies (see Game.js's playerHealth.onDeath).
  // Interrupts any in-progress deploy and starts the existing retract
  // animation -- reuses UNDEPLOYING's progress-1-to-0 sweep as the "turret
  // droops and stows" death visual instead of adding a separate animation.
  // Also drops the current target so no more shots line up while retracting.
  forceRetract() {
    if (this.state !== STATE.UNDEPLOYED && this.state !== STATE.UNDEPLOYING) {
      this.state = STATE.UNDEPLOYING;
    }
    this.target = null;
  }

  // Edge-triggered: call once per F keypress, never while held.
  toggle() {
    if (this.state === STATE.UNDEPLOYED || this.state === STATE.UNDEPLOYING) {
      this.state = STATE.DEPLOYING;
      this.playServoSound(true);
    } else {
      this.state = STATE.UNDEPLOYING;
      this.playServoSound(false);
    }
  }

  playServoSound(deploying) {
    this.audio?.playToneEffect?.({
      startFrequency: deploying ? 70 : 140,
      endFrequency: deploying ? 140 : 60,
      duration: 0.32,
      volume: 0.03,
      type: "sawtooth",
      destination: this.audio.effectsBus
    });
  }

  playLockSound() {
    this.audio?.playToneEffect?.({
      startFrequency: 900,
      endFrequency: 500,
      duration: 0.05,
      volume: 0.035,
      type: "square",
      destination: this.audio.effectsBus
    });
  }

  get statusText() {
    return STATUS_TEXT[this.state];
  }

  get isActive() {
    return this.state === STATE.DEPLOYED;
  }

  advanceDeployState(dt) {
    if (this.state === STATE.DEPLOYING) {
      this.progress = Math.min(1, this.progress + dt / TURRET_CONFIG.deployDuration);
      if (this.progress >= 1) {
        this.state = STATE.DEPLOYED;
        this.playLockSound();
      }
    } else if (this.state === STATE.UNDEPLOYING) {
      this.progress = Math.max(0, this.progress - dt / TURRET_CONFIG.undeployDuration);
      if (this.progress <= 0) {
        this.state = STATE.UNDEPLOYED;
        this.playLockSound();
      }
    }
  }

  acquireTarget(targetSystem) {
    // Keep the current target unless it's no longer valid -- selection
    // should not flicker between candidates every scan (see requirement).
    if (this.target && this.target.alive) {
      const distance = scratchTurretWorld.distanceTo(this.target.position);
      if (distance <= TURRET_CONFIG.range) return;
      this.target = null;
    } else {
      this.target = null;
    }

    let best = null;
    let bestDistance = Infinity;
    let bestIsBoss = false;

    // Bosses are the "special encounter" (see requirement #28) -- prefer
    // one over any in-range normal enemy, but still just pick the nearest
    // in-range candidate within each tier so selection never flickers.
    for (const candidate of targetSystem.getActiveTargets()) {
      const distance = scratchTurretWorld.distanceTo(candidate.position);
      if (distance > TURRET_CONFIG.range) continue;

      const isBoss = candidate.kind === "boss";
      if (bestIsBoss && !isBoss) continue;

      if (isBoss && !bestIsBoss) {
        best = candidate;
        bestDistance = distance;
        bestIsBoss = true;
        continue;
      }

      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }

    this.target = best;
  }

  computeDesiredAim() {
    if (!this.target || !this.target.alive) return null;

    scratchTargetWorld.copy(this.target.position);
    this.parts.turretYaw.getWorldPosition(scratchTurretWorld);

    scratchLocalDir.subVectors(scratchTargetWorld, scratchTurretWorld);

    this.vehicleRoot.getWorldQuaternion(scratchInverseQuat).invert();
    scratchLocalDir.applyQuaternion(scratchInverseQuat);

    const horizontalDist = Math.hypot(scratchLocalDir.x, scratchLocalDir.z);
    const desiredYaw = Math.atan2(scratchLocalDir.x, scratchLocalDir.z);
    const desiredPitch = clamp(
      Math.atan2(scratchLocalDir.y, Math.max(0.001, horizontalDist)),
      TURRET_CONFIG.minElevation,
      TURRET_CONFIG.maxElevation
    );

    return { yaw: desiredYaw, pitch: desiredPitch };
  }

  tryFire(dt, targetSystem) {
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);

    if (!this.target || !this.target.alive) return;

    const aim = this.computeDesiredAim();
    if (!aim) return;

    const aimed =
      Math.abs(angleDifference(this.yaw, aim.yaw)) < TURRET_CONFIG.aimTolerance &&
      Math.abs(this.pitch - aim.pitch) < TURRET_CONFIG.aimTolerance;

    if (!aimed || this.fireCooldown > 0) return;

    this.fireCooldown = 1 / TURRET_CONFIG.fireRate;
    this.fireSeq = (this.fireSeq + 1) % 65536;
    this.recoil = 1;
    this.flash = 1;

    this.parts.muzzleTip.getWorldPosition(scratchMuzzleWorld);
    const muzzleOrigin = scratchMuzzleWorld.clone();
    const impactPoint = this.target.position.clone();

    this.effects.spawnTracer(muzzleOrigin, impactPoint);

    const destroyed = targetSystem.applyDamage(
      this.target,
      TURRET_CONFIG.damage * this.damageMultiplier
    );
    this.effects.spawnImpact(impactPoint);

    if (destroyed) this.target = null;

    this.audio?.playToneEffect?.({
      startFrequency: 620,
      endFrequency: 180,
      duration: 0.05,
      volume: 0.05,
      type: "square",
      destination: this.audio.effectsBus
    });
  }

  update(dt, targetSystem) {
    this.advanceDeployState(dt);

    // Update only the ancestor chain down to the turret pivot (vehicle root
    // -> turret root -> lift column -> yaw), not the whole vehicle body
    // mesh tree, so this reflects this frame's vehicle transform without
    // redoing work the renderer will already do for the full scene.
    this.parts.turretYaw.updateWorldMatrix(true, false);
    this.parts.turretYaw.getWorldPosition(scratchTurretWorld);

    let desiredYaw = 0;
    let desiredPitch = 0;

    if (this.state === STATE.DEPLOYED && targetSystem) {
      this.scanTimer -= dt;
      if (this.scanTimer <= 0) {
        this.scanTimer = TURRET_CONFIG.targetScanInterval;
        this.acquireTarget(targetSystem);
      }

      const aim = this.computeDesiredAim();
      if (aim) {
        desiredYaw = aim.yaw;
        desiredPitch = aim.pitch;
      } else {
        this.target = null;
      }

      this.tryFire(dt, targetSystem);
    } else {
      this.target = null;
      this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    }

    this.yaw = stepAngle(this.yaw, desiredYaw, TURRET_CONFIG.rotationSpeed * dt);
    this.pitch = stepToward(this.pitch, desiredPitch, TURRET_CONFIG.elevationSpeed * dt);

    this.recoil = Math.max(0, this.recoil - dt / TURRET_CONFIG.recoilDuration);
    this.flash = Math.max(0, this.flash - dt / TURRET_CONFIG.muzzleFlashDuration);

    applyTurretPose(this.parts, {
      progress: this.progress,
      yaw: this.yaw,
      pitch: this.pitch,
      recoil: this.recoil,
      flash: this.flash
    });

    this.effects.update(dt);
  }

  // Compact payload merged into the player's regular network state message
  // (see MultiplayerClient.sendState). Deliberately excludes every
  // mechanical sub-part -- remote clients replicate the full mechanical
  // animation locally from `state` alone (see RemoteTurret.js).
  getNetworkState() {
    return {
      state: this.state,
      yaw: this.yaw,
      pitch: this.pitch,
      fireSeq: this.fireSeq
    };
  }

  dispose() {
    this.effects.dispose();
  }
}
