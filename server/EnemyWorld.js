// ---------------------------------------------------------------------------
// EnemyWorld -- the single authoritative source of truth for every enemy
// in the game (requirement #6).
//
// This is a server-side port of the local simulation that used to live
// entirely in src/turret/TargetSystem.js + src/turret/Target.js. The big
// difference: this runs ONCE, on the server, for every connected player at
// once -- not once per client -- so every player necessarily sees the same
// enemy IDs, positions, HP, and deaths (requirement #5). Clients no longer
// decide any of this themselves; they only render whatever this class
// reports (see TargetSystem.applyServerState on the client).
//
// Shares its tuning (HP, damage, fire rate, spawn distances, ...) with the
// offline/local client simulation via TurretConfig.js's ENEMY_CONFIG --
// there is exactly one place these numbers live, not one per system (see
// requirement #4/#13).
//
// Shares its terrain-height / road-surface classification with the client
// renderer via WorldGeometry.js, so a spawn point valid on the server is
// guaranteed to be "on grass" for the exact terrain every client draws.
// ---------------------------------------------------------------------------

import { heightAt, surfaceAt, clamp } from "../src/world/WorldGeometry.js";
import { ENEMY_CONFIG, TARGET_CONFIG } from "../src/turret/TurretConfig.js";

const SPAWN_ATTEMPTS = 100;
const HOVER_HEIGHT = TARGET_CONFIG.hoverHeight;
const WORLD_LIMIT = ENEMY_CONFIG.spawn?.worldLimit ?? 185;
const MIN_DISTANCE_FROM_PLAYER_SPAWN = ENEMY_CONFIG.spawn?.minDistanceFromPlayerSpawn ?? 200;
const BOSS_MIN_DISTANCE_FROM_PLAYER_SPAWN = ENEMY_CONFIG.spawn?.bossMinDistanceFromPlayerSpawn ?? 300;
const MIN_DISTANCE_BETWEEN_ENEMIES = ENEMY_CONFIG.spawn?.minDistanceBetweenEnemies ?? 14;
const PLAYER_SPAWN_CENTER = {
  x: ENEMY_CONFIG.spawn?.protectedSpawnCenter?.x ?? 0,
  z: ENEMY_CONFIG.spawn?.protectedSpawnCenter?.z ?? 0
};
const SAFE_ZONE_RADIUS = ENEMY_CONFIG.spawn?.protectedSpawnRadius ?? 30;

// How long a dead enemy stays in the broadcast list (with alive:false)
// before being fully removed -- gives every client one guaranteed frame to
// play the death effect before the id disappears (see
// Target.js#applyNetworkState / TargetSystem.applyServerState).
const CORPSE_LINGER_SECONDS = 0.5;

const AI_STATE = {
  IDLE: "idle",
  ALERT: "alert",
  ATTACKING: "attacking"
};

export class EnemyWorld {
  constructor() {
    this.enemies = new Map();
    this.respawnTimers = []; // seconds remaining, one per pending normal-enemy respawn
    this.bossActive = false;
    this.bossRespawnTimer = ENEMY_CONFIG.boss.initialSpawnDelay;
    this.nextNormalIndex = 1;
    this.nextBossIndex = 1;

    // Deterministic seed -- no longer needs to match anything client-side
    // (clients just render whatever this produces), kept deterministic
    // purely so a given server run's enemy placement is reproducible for
    // debugging.
    this.seed = 908070;

    // Set once by server.js right after construction (see that file).
    // Kept as plain instance properties -- rather than re-passed as
    // update() arguments every tick -- so applyDamage() (called directly
    // from the "turretHit" message handler, not from update()) can also
    // reach onEnemyKilled without a timing dependency on update() having
    // run at least once first.
    this.onPlayerDamage = null; // (playerId, amount, enemyId) => {}
    this.onEnemyKilled = null; // (killerPlayerId, enemy) => {}
  }

  random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  distanceFromPlayerSpawn(x, z) {
    return Math.hypot(x - PLAYER_SPAWN_CENTER.x, z - PLAYER_SPAWN_CENTER.z);
  }

  // -------------------------------------------------------------------------
  // FIND SPAWN POSITION
  // -------------------------------------------------------------------------
  // Same set of constraints TargetSystem.findSpawnPosition used to enforce
  // client-side, now enforced once, authoritatively, for every player:
  //   1. Inside the world boundary.
  //   2. Outside the safe zone around the fixed player spawn point.
  //   3. Far enough from the original player spawn (requirement #3).
  //   4. Far enough from every currently connected, alive player
  //      (requirement #3's "avoid spawning directly beside players" --
  //      checked against ALL players, not just one, since this is now
  //      multiplayer).
  //   5. Far enough from every other currently-alive enemy (avoids one
  //      giant cluster -- requirement #3).
  //   6. On grass.
  // -------------------------------------------------------------------------
  findSpawnPosition(players, minDistance, maxDistance, minimumDistanceFromPlayerSpawn) {
    const alivePlayers = Array.from(players.values()).filter(
      p => p.combat && !p.combat.dead
    );

    // Prefer scattering around a random alive player (keeps enemies spread
    // near where the action is) but fall back to the fixed spawn point when
    // nobody is connected/alive yet.
    const anchor = alivePlayers.length > 0
      ? alivePlayers[Math.floor(this.random() * alivePlayers.length)]
      : null;

    const anchorPos = anchor?.state?.position;
    const centerX = Number.isFinite(anchorPos?.[0]) ? anchorPos[0] : PLAYER_SPAWN_CENTER.x;
    const centerZ = Number.isFinite(anchorPos?.[2]) ? anchorPos[2] : PLAYER_SPAWN_CENTER.z;

    for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt++) {
      const angle = this.random() * Math.PI * 2;
      const distance = minDistance + this.random() * (maxDistance - minDistance);

      const x = centerX + Math.cos(angle) * distance;
      const z = centerZ + Math.sin(angle) * distance;

      if (Math.abs(x) > WORLD_LIMIT || Math.abs(z) > WORLD_LIMIT) continue;

      if (this.distanceFromPlayerSpawn(x, z) < SAFE_ZONE_RADIUS) continue;

      if (this.distanceFromPlayerSpawn(x, z) < minimumDistanceFromPlayerSpawn) continue;

      const tooCloseToAPlayer = alivePlayers.some(p => {
        const pos = p.state?.position;
        if (!pos) return false;
        return Math.hypot(x - pos[0], z - pos[2]) < minDistance;
      });
      if (tooCloseToAPlayer) continue;

      const tooCloseToAnotherEnemy = Array.from(this.enemies.values()).some(enemy =>
        enemy.alive &&
        Math.hypot(x - enemy.x, z - enemy.z) < MIN_DISTANCE_BETWEEN_ENEMIES
      );
      if (tooCloseToAnotherEnemy) continue;

      if (surfaceAt(x, z) !== "grass") continue;

      const y = heightAt(x, z) + HOVER_HEIGHT;
      return { x, y, z };
    }

    return null;
  }

  spawnOne(players) {
    const position = this.findSpawnPosition(
      players,
      ENEMY_CONFIG.spawn.minDistance,
      ENEMY_CONFIG.spawn.maxDistance,
      MIN_DISTANCE_FROM_PLAYER_SPAWN
    );

    if (!position) return;

    const id = `enemy_${String(this.nextNormalIndex++).padStart(3, "0")}`;

    this.enemies.set(id, {
      id,
      kind: "normal",
      x: position.x,
      y: position.y,
      z: position.z,
      hp: ENEMY_CONFIG.normal.maxHealth,
      maxHp: ENEMY_CONFIG.normal.maxHealth,
      alive: true,
      aiState: AI_STATE.IDLE,
      targetPlayerId: null,
      attackCooldown: 0,
      fireSeq: 0,
      corpseTimer: 0
    });
  }

  spawnBoss(players) {
    const position = this.findSpawnPosition(
      players,
      ENEMY_CONFIG.spawn.bossMinDistance,
      ENEMY_CONFIG.spawn.bossMaxDistance,
      BOSS_MIN_DISTANCE_FROM_PLAYER_SPAWN
    );

    if (!position) return;

    const id = `boss_${String(this.nextBossIndex++).padStart(3, "0")}`;

    this.enemies.set(id, {
      id,
      kind: "boss",
      x: position.x,
      y: position.y,
      z: position.z,
      hp: ENEMY_CONFIG.boss.maxHealth,
      maxHp: ENEMY_CONFIG.boss.maxHealth,
      alive: true,
      aiState: AI_STATE.IDLE,
      targetPlayerId: null,
      attackCooldown: 0,
      bossPhase: "cooldown",
      telegraphTimer: 0,
      burstShotsFired: 0,
      burstTimer: 0,
      fireSeq: 0,
      corpseTimer: 0
    });

    this.bossActive = true;
  }

  // -------------------------------------------------------------------------
  // NEAREST ALIVE, TARGETABLE PLAYER
  // -------------------------------------------------------------------------
  // A dead player is completely invisible to enemy AI (requirement #2):
  // never selected as a new target, and -- because this is re-evaluated
  // every tick -- an enemy already attacking a player who dies mid-attack
  // drops them immediately on the very next tick.
  // -------------------------------------------------------------------------
  findNearestPlayer(enemy, players) {
    let best = null;
    let bestDistance = Infinity;

    for (const player of players.values()) {
      if (!player.combat || player.combat.dead) continue;

      const pos = player.state?.position;
      if (!pos) continue;

      const distance = Math.hypot(enemy.x - pos[0], enemy.z - pos[2]);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = player;
      }
    }

    return best ? { player: best, distance: bestDistance } : null;
  }

  // -------------------------------------------------------------------------
  // UPDATE -- one authoritative simulation tick.
  // -------------------------------------------------------------------------
  // `players`: the server's live `players` Map (id -> { state, combat, ... }).
  // Damage/kill callbacks are read from this.onPlayerDamage/onEnemyKilled
  // (set once by server.js -- see the constructor comment above).
  // -------------------------------------------------------------------------
  update(dt, players) {
    for (const [id, enemy] of this.enemies) {
      if (!enemy.alive) {
        enemy.corpseTimer -= dt;
        if (enemy.corpseTimer <= 0) this.enemies.delete(id);
        continue;
      }

      const nearest = this.findNearestPlayer(enemy, players);
      const detectionRange = enemy.kind === "boss"
        ? ENEMY_CONFIG.boss.detectionRange
        : ENEMY_CONFIG.normal.detectionRange;
      const attackRange = enemy.kind === "boss"
        ? ENEMY_CONFIG.boss.attackRange
        : ENEMY_CONFIG.normal.attackRange;

      const distance = nearest && nearest.distance <= detectionRange * 1.15
        ? nearest.distance
        : Infinity;

      if (enemy.aiState !== AI_STATE.ATTACKING) {
        enemy.aiState = nearest && nearest.distance <= detectionRange
          ? AI_STATE.ALERT
          : AI_STATE.IDLE;
      } else if (distance > detectionRange * 1.15 || !nearest) {
        enemy.aiState = AI_STATE.IDLE;
        this.resetAttackPhase(enemy);
      }

      enemy.targetPlayerId =
        enemy.aiState === AI_STATE.IDLE ? null : nearest?.player.id ?? null;

      if (enemy.aiState === AI_STATE.ALERT && nearest && nearest.distance <= attackRange) {
        enemy.aiState = AI_STATE.ATTACKING;
      } else if (
        enemy.aiState === AI_STATE.ATTACKING &&
        (!nearest || nearest.distance > attackRange * 1.2)
      ) {
        enemy.aiState = AI_STATE.ALERT;
        this.resetAttackPhase(enemy);
      }

      if (enemy.aiState === AI_STATE.ATTACKING && nearest) {
        if (enemy.kind === "boss") {
          this.updateBossAttack(dt, enemy, nearest.player);
        } else {
          this.updateNormalAttack(dt, enemy, nearest.player);
        }
      } else {
        enemy.telegraph = false;
      }
    }

    // ---------------------------------------------------------------------
    // RESPAWN NORMAL ENEMIES
    // ---------------------------------------------------------------------
    for (let i = this.respawnTimers.length - 1; i >= 0; i--) {
      this.respawnTimers[i] -= dt;
      if (this.respawnTimers[i] <= 0) {
        this.respawnTimers.splice(i, 1);
        this.spawnOne(players);
      }
    }

    const aliveNormal = Array.from(this.enemies.values()).filter(
      e => e.alive && e.kind === "normal"
    ).length;

    if (aliveNormal + this.respawnTimers.length < ENEMY_CONFIG.maxEnemies) {
      this.spawnOne(players);
    }

    if (!this.bossActive) {
      this.bossRespawnTimer -= dt;
      if (this.bossRespawnTimer <= 0) {
        this.spawnBoss(players);
      }
    }

  }

  resetAttackPhase(enemy) {
    enemy.attackCooldown = 0;
    enemy.telegraph = false;
    if (enemy.kind === "boss") enemy.bossPhase = "cooldown";
  }

  updateNormalAttack(dt, enemy, targetPlayer) {
    enemy.attackCooldown = Math.max(0, enemy.attackCooldown - dt);
    if (enemy.attackCooldown > 0) return;

    enemy.attackCooldown = ENEMY_CONFIG.normal.fireRate;
    this.fire(enemy, targetPlayer, ENEMY_CONFIG.normal.attackDamage);
  }

  updateBossAttack(dt, enemy, targetPlayer) {
    const cfg = ENEMY_CONFIG.boss;

    if (enemy.bossPhase === "cooldown") {
      enemy.telegraph = false;
      enemy.attackCooldown = Math.max(0, enemy.attackCooldown - dt);
      if (enemy.attackCooldown <= 0) {
        enemy.bossPhase = "telegraph";
        enemy.telegraphTimer = cfg.telegraphDuration;
        enemy.telegraph = true;
      }
      return;
    }

    if (enemy.bossPhase === "telegraph") {
      enemy.telegraphTimer -= dt;
      enemy.telegraphProgress = clamp(1 - enemy.telegraphTimer / cfg.telegraphDuration, 0, 1);

      if (enemy.telegraphTimer <= 0) {
        enemy.bossPhase = "firing";
        enemy.burstShotsFired = 0;
        enemy.burstTimer = 0;
        enemy.telegraph = false;
      }
      return;
    }

    // firing
    enemy.burstTimer -= dt;
    if (enemy.burstTimer <= 0 && enemy.burstShotsFired < cfg.burstCount) {
      enemy.burstTimer = cfg.burstInterval;
      enemy.burstShotsFired += 1;
      this.fire(enemy, targetPlayer, cfg.burstDamagePerHit);
    }

    if (enemy.burstShotsFired >= cfg.burstCount) {
      enemy.bossPhase = "cooldown";
      enemy.attackCooldown = cfg.attackCooldown;
    }
  }

  fire(enemy, targetPlayer, damage) {
    enemy.fireSeq = (enemy.fireSeq + 1) % 65536;
    this.onPlayerDamage?.(targetPlayer.id, damage, enemy.id);
  }

  // -------------------------------------------------------------------------
  // APPLY DAMAGE (from a player's turret)
  // -------------------------------------------------------------------------
  applyDamage(enemyId, amount, killerPlayerId) {
    const enemy = this.enemies.get(enemyId);
    if (!enemy || !enemy.alive || !Number.isFinite(amount) || amount <= 0) {
      return false;
    }

    enemy.hp = Math.max(0, enemy.hp - amount);

    if (enemy.hp <= 0) {
      enemy.alive = false;
      enemy.corpseTimer = CORPSE_LINGER_SECONDS;
      enemy.targetPlayerId = null;

      if (enemy.kind === "boss") {
        this.bossActive = false;
        this.bossRespawnTimer = ENEMY_CONFIG.boss.respawnDelay;
      } else {
        this.respawnTimers.push(TARGET_CONFIG.respawnDelay);
      }

      this.onEnemyKilled?.(killerPlayerId, enemy);
      return true;
    }

    return false;
  }

  // -------------------------------------------------------------------------
  // SERIALIZE -- what gets sent to clients (welcome + periodic "enemies").
  // -------------------------------------------------------------------------
  serialize(players) {
    return Array.from(this.enemies.values()).map(enemy => {
      const targetPlayer = enemy.targetPlayerId
        ? players.get(enemy.targetPlayerId)
        : null;
      const targetPos = targetPlayer?.state?.position;

      return {
        id: enemy.id,
        kind: enemy.kind,
        x: enemy.x,
        y: enemy.y,
        z: enemy.z,
        hp: enemy.hp,
        maxHp: enemy.maxHp,
        alive: enemy.alive,
        targetPlayerId: enemy.targetPlayerId,
        telegraph: enemy.telegraph === true,
        telegraphProgress: enemy.telegraphProgress ?? 0,
        fireSeq: enemy.fireSeq,
        tx: targetPos ? targetPos[0] : undefined,
        ty: targetPos ? targetPos[1] : undefined,
        tz: targetPos ? targetPos[2] : undefined
      };
    });
  }
}
