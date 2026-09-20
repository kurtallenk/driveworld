// ---------------------------------------------------------------------------
// LootWorld -- the single authoritative source of truth for every world
// pickup, in exactly the same spirit as EnemyWorld.
//
// Before this existed, loot was rolled on the CLIENT of whoever earned the
// kill, which meant a battery that Player A saw simply did not exist for
// Player B. Enemy deaths were already server-authoritative, so the drop is
// now rolled here, at the enemy's real death position, given a unique
// pickupId, and broadcast to every connected client over the SAME
// WebSocket protocol the rest of the game already uses (see server.js).
//
// This class owns state only. server.js owns the socket I/O and calls into
// it; nothing here imports `ws`.
// ---------------------------------------------------------------------------

import {
  LOOT_CONFIG,
  despawnSecondsFor,
  getItem,
  neverDespawns,
  rollItem
} from "../src/gameplay/ItemDatabase.js";
import { heightAt } from "../src/world/WorldGeometry.js";

// Drop rates and lifetimes live in ItemDatabase's LOOT_CONFIG, which the
// client's LootSystem imports too -- one tuning surface for both sides, so
// the authoritative world and the renderer can never disagree about how
// long a drop lives or how often one appears.
//
// Per-item lifetime and rare-collectible immunity are resolved through
// despawnSecondsFor() / neverDespawns(). Nothing here inspects an item's
// display name to decide whether it may be removed.

// How close a player must actually be for the server to honour a pickup
// request. Deliberately a little larger than the client's PICKUP_RADIUS (6)
// so normal latency/interpolation never causes a legitimate pickup to be
// rejected, while still rejecting a forged request from across the map.
const PICKUP_RADIUS = 9;

const HOVER_HEIGHT = 1.1;

export class LootWorld {
  constructor() {
    // pickupId -> pickup record
    this.pickups = new Map();

    this.nextIndex = 1;

    // Deterministic PRNG, same pattern as EnemyWorld. Only needs to be
    // reproducible for this server run.
    this.seed = 515263;

    // Enemy ids that have already paid out their boss collectible. This is
    // the duplicate-drop latch: EnemyWorld.applyDamage() already refuses to
    // kill an enemy twice, but a replayed or duplicated death event must
    // not be able to mint a second Golden Arachnid Eye either. Boss ids are
    // unique and monotonic (boss_001, boss_002, ...), so this set only
    // grows once per boss that has ever died.
    this.bossCollectiblesAwarded = new Set();

    // Set by server.js right after construction.
    this.onSpawn = null; // (pickup) => {}
    this.onRemove = null; // (pickupId, reason) => {}
  }

  random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  // -------------------------------------------------------------------------
  // CREATION
  // -------------------------------------------------------------------------
  // Called from server.js's onEnemyKilled hook. `enemy` is the authoritative
  // EnemyWorld record, so enemy.x / enemy.z ARE the real world position the
  // enemy died at -- never a player or camera position.
  // -------------------------------------------------------------------------
  dropFromEnemy(enemy) {
    if (!enemy) return [];

    const rolls = enemy.kind === "boss" ? LOOT_CONFIG.bossDropRolls : 1;
    const created = [];

    for (let i = 0; i < rolls; i++) {
      if (enemy.kind !== "boss" && this.random() > LOOT_CONFIG.normalDropChance) {
        continue;
      }

      const item = rollItem(() => this.random());
      if (!item) continue;

      // Multiple boss drops fan out slightly so they are separately
      // collectable instead of stacking into one invisible pile.
      const offset = rolls > 1 ? (i - (rolls - 1) / 2) * 1.8 : 0;

      const pickup = this.spawn(
        item.id,
        enemy.x + offset,
        enemy.z + offset * 0.4,
        { sourceEnemyId: enemy.id, sourceKind: enemy.kind }
      );

      if (pickup) created.push(pickup);
    }

    const collectible = this.dropBossCollectible(enemy);
    if (collectible) created.push(collectible);

    return created;
  }

  // -------------------------------------------------------------------------
  // BOSS COLLECTIBLE
  // -------------------------------------------------------------------------
  // The Golden Arachnid Eye. Spawned IN ADDITION to the boss's existing
  // ordinary drops, never instead of them, and exactly once per boss
  // death. It is an ordinary pickup in every networking respect -- same
  // pickupId scheme, same spawn/remove broadcasts, same claim validation --
  // so multiplayer clients need no special case to see or collect it. Only
  // its lifetime differs, and that comes from the item data.
  // -------------------------------------------------------------------------
  dropBossCollectible(enemy) {
    if (enemy?.kind !== "boss") return null;

    const itemId = LOOT_CONFIG.bossCollectibleId;
    if (!itemId || !getItem(itemId)) return null;

    // One per boss death, even if the death event arrives more than once.
    if (typeof enemy.id === "string" && enemy.id.length > 0) {
      if (this.bossCollectiblesAwarded.has(enemy.id)) return null;
      this.bossCollectiblesAwarded.add(enemy.id);
    }

    // Offset clear of the fanned-out ordinary boss drops so the trophy is
    // separately visible and separately collectable.
    return this.spawn(itemId, enemy.x, enemy.z + 2.6, {
      sourceEnemyId: enemy.id,
      sourceKind: enemy.kind
    });
  }

  spawn(itemId, x, z, metadata = {}) {
    const item = getItem(itemId);

    if (!item || !Number.isFinite(x) || !Number.isFinite(z)) return null;

    // Oldest ORDINARY pickup is recycled rather than letting the world
    // fill up. Rare collectibles are skipped, so hitting the cap can never
    // silently delete one; only ordinary salvage is ever recycled.
    if (this.pickups.size >= LOOT_CONFIG.maxActivePickups) {
      for (const candidate of this.pickups.values()) {
        if (neverDespawns(candidate.itemId)) continue;

        this.remove(candidate.pickupId, "recycled");
        break;
      }
    }

    const id = `pickup_${String(this.nextIndex++).padStart(5, "0")}`;

    const pickup = {
      pickupId: id,
      itemId,
      x,
      y: heightAt(x, z) + HOVER_HEIGHT,
      z,
      createdAt: Date.now(),
      age: 0,
      // `claimedBy` is the anti-duplication latch: the FIRST request to get
      // here wins and every later one sees a non-null value.
      claimedBy: null,
      ...metadata,

      // Resolved from item data AFTER the metadata spread, so a caller can
      // never accidentally hand a rare collectible an ordinary lifetime.
      neverDespawn: neverDespawns(itemId),
      despawnSeconds: despawnSecondsFor(itemId)
    };

    this.pickups.set(id, pickup);
    this.onSpawn?.(pickup);

    return pickup;
  }

  // -------------------------------------------------------------------------
  // PICKUP VALIDATION
  // -------------------------------------------------------------------------
  // Returns { ok: true, pickup } for exactly ONE caller per pickup; every
  // other caller gets { ok: false, reason }. The claim is taken
  // synchronously before anything is broadcast, so two players tapping the
  // same battery in the same tick can never both be awarded it.
  // -------------------------------------------------------------------------
  claim(pickupId, player) {
    if (typeof pickupId !== "string" || pickupId.length === 0 || pickupId.length > 32) {
      return { ok: false, reason: "invalid" };
    }

    const pickup = this.pickups.get(pickupId);

    if (!pickup) return { ok: false, reason: "missing" };
    if (pickup.claimedBy) return { ok: false, reason: "taken" };

    const position = player?.state?.position;

    if (!Array.isArray(position) || position.length !== 3) {
      return { ok: false, reason: "unknown-position" };
    }

    const distance = Math.hypot(position[0] - pickup.x, position[2] - pickup.z);

    if (!Number.isFinite(distance) || distance > PICKUP_RADIUS) {
      return { ok: false, reason: "too-far" };
    }

    pickup.claimedBy = player.id;

    return { ok: true, pickup };
  }

  remove(pickupId, reason = "removed") {
    if (!this.pickups.delete(pickupId)) return false;

    this.onRemove?.(pickupId, reason);
    return true;
  }

  // -------------------------------------------------------------------------
  // TICK -- expiry only. Pickups are static, so there is nothing to simulate.
  // -------------------------------------------------------------------------
  update(dt) {
    for (const pickup of Array.from(this.pickups.values())) {
      pickup.age += dt;

      // Rare collectibles opt out of the sweep entirely and stay in the
      // world until a player actually collects them.
      if (pickup.neverDespawn) continue;

      if (pickup.age > pickup.despawnSeconds) {
        this.remove(pickup.pickupId, "expired");
      }
    }
  }

  // What a joining client needs to render the current world exactly as
  // everybody else already sees it.
  serialize() {
    return Array.from(this.pickups.values())
      .filter(pickup => !pickup.claimedBy)
      .map(pickup => ({
        pickupId: pickup.pickupId,
        itemId: pickup.itemId,
        x: pickup.x,
        y: pickup.y,
        z: pickup.z,
        age: pickup.age
      }));
  }
}

// DESPAWN_SECONDS is no longer a constant here: lifetime is per-item and
// comes from ItemDatabase (LOOT_CONFIG.defaultDespawnSeconds plus any
// per-item override). Re-exported below so existing importers keep a
// single, accurate source.
export { LOOT_CONFIG, despawnSecondsFor, neverDespawns };
export { PICKUP_RADIUS };
