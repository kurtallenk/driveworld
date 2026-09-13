import { PLAYER_CONFIG } from "../turret/TurretConfig.js";

// ---------------------------------------------------------------------------
// Centralized player HP + damage + death/respawn state. Enemies, the boss,
// and any future hazard all funnel damage through applyDamage() rather than
// poking at `.health` directly (see requirement #9), which is what keeps
// the "no damage after death" / "exactly one death event" guarantees in one
// place instead of scattered across every damage source.
// ---------------------------------------------------------------------------
export class PlayerHealth {
  constructor() {
    this.maxHealth = PLAYER_CONFIG.maxHealth;
    this.health = this.maxHealth;
    this.dead = false;
    this.respawnTimer = 0;

    this.onDamage = null; // (amount, source) => {}
    this.onDeath = null; // () => {}
    this.onRespawn = null; // () => {}
  }

  get ratio() {
    return this.maxHealth > 0 ? this.health / this.maxHealth : 0;
  }

  // Named alias for `dead` -- reads clearer at call sites that care about
  // the vehicle's state (network sync, UI) rather than a raw boolean.
  get state() {
    return this.dead ? "destroyed" : "alive";
  }

  applyDamage(amount, source = null) {
    if (this.dead || !Number.isFinite(amount) || amount <= 0) return;

    this.health = Math.max(0, this.health - amount);
    this.onDamage?.(amount, source);

    if (this.health <= 0) {
      this.dead = true;
      this.respawnTimer = PLAYER_CONFIG.respawnDelay;
      this.onDeath?.();
    }
  }

  // Called by Game.js's LevelSystem.onLevelUp hook -- also tops off current
  // HP by the same amount so leveling up feels like a reward, not just a
  // higher ceiling.
  addMaxHealth(amount) {
    this.maxHealth += amount;
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  update(dt) {
    if (!this.dead) return;

    this.respawnTimer -= dt;
    if (this.respawnTimer <= 0) this.respawn();
  }

  respawn() {
    this.dead = false;
    this.health = this.maxHealth;
    this.respawnTimer = 0;
    this.onRespawn?.();
  }
}
