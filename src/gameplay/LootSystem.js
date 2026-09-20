import * as THREE from "three";

import {
  LOOT_CONFIG,
  despawnSecondsFor,
  getItem,
  neverDespawns,
  rollItem,
  spinRateFor,
  worldColor
} from "./ItemDatabase.js";
import { ItemModelFactory } from "./ItemModels.js";

// ---------------------------------------------------------------------------
// LOOT SYSTEM
// ---------------------------------------------------------------------------
// Owns world drops: the roll on enemy death, the physical pickup in the
// world, its idle animation, lifetime and collection.
//
// Multiplayer note:
//   Enemy deaths are server-authoritative, but loot here is intentionally
//   CLIENT-SIDE and private to the player who earned the kill. Game.js only
//   calls dropFrom() from the two places that already award XP privately
//   (TargetSystem.onEnemyDestroyed in solo play, and the server's private
//   "enemy killed" message in multiplayer). That means:
//     * no new network traffic,
//     * no shared-pickup race conditions between players,
//     * loot cannot desync enemy or battery state.
//   The same rule the game already uses for XP credit therefore also
//   governs loot credit.
//
// Performance:
//   Pickups share one geometry and reuse materials per rarity colour;
//   meshes are disposed on collection/expiry, and update() is a short loop
//   over at most LOOT_CONFIG.maxActiveDrops items.
// ---------------------------------------------------------------------------

// Drop rates and lifetimes come from the SHARED LOOT_CONFIG in
// ItemDatabase.js, which the authoritative server reads too -- so the
// offline fallback below can never disagree with the networked game.
// Per-item lifetime (and despawn immunity for rare collectibles) is
// resolved through despawnSecondsFor() / neverDespawns(), never from a
// constant here and never from an item's display name.
const PICKUP_RADIUS = 6;
const HOVER_HEIGHT = 1.1;

export class LootSystem {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;

    this.items = [];
    this.elapsed = 0;

    // Server-authoritative mode. Flipped on by MultiplayerClient the moment
    // a connection is established (see enableNetworkedMode below). While it
    // is on, this system NEVER invents, moves or deletes a drop of its own:
    // it only renders what the server's LootWorld reports.
    this.networked = false;

    // True once a loot-aware server has taken ownership of world drops.
    // Until then (offline, or connected to a server with no loot support)
    // this client rolls its own drops, exactly as it always did.
    this.serverAuthoritative = true;

    // pickupId -> drop, for O(1) reconciliation against server messages.
    this.byPickupId = new Map();

    // OFFLINE duplicate-drop latch for the boss collectible, mirroring
    // LootWorld.bossCollectiblesAwarded on the server. Keyed by enemy id
    // so a repeated local death event cannot mint a second trophy.
    this.bossCollectiblesAwarded = new Set();

    // Deterministic PRNG, same pattern as TargetSystem/World generation.
    let seed = 515263;
    this.random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    // Per-item world models (battery, medkit, core, ...). Geometries and
    // materials are shared across every instance and released in
    // dispose(); see gameplay/ItemModels.js.
    this.models = new ItemModelFactory();

    this.glowGeometry = new THREE.RingGeometry(0.9, 1.25, 20);

    this.onDrop = null;
  }

  // -------------------------------------------------------------------------
  // NETWORKED MODE
  // -------------------------------------------------------------------------
  // Mirrors the pattern TargetSystem/PlayerHealth already use for enemies
  // and player combat: local simulation while offline, pure rendering of
  // server state while connected.
  // -------------------------------------------------------------------------

  // `serverAuthoritative` is negotiated from the server's own `welcome`
  // message: only a server that actually reports a `pickups` list owns the
  // loot world. Against an older/loot-unaware server we stay connected for
  // everything else but keep rolling drops locally, so killing an enemy
  // always produces loot instead of silently producing nothing.
  enableNetworkedMode({ serverAuthoritative = true } = {}) {
    this.serverAuthoritative = Boolean(serverAuthoritative);

    if (this.networked) return;

    this.networked = true;

    if (!this.serverAuthoritative) return;

    // Any locally-rolled drops from the pre-connection/offline session are
    // not part of the authoritative world, so they must not linger.
    this.clearAll();
  }

  disableNetworkedMode() {
    if (!this.networked) return;

    this.networked = false;

    if (!this.serverAuthoritative) {
      this.serverAuthoritative = true;
      return;
    }

    this.serverAuthoritative = true;

    // Server drops are no longer authoritative once the connection is gone.
    this.clearAll();
  }

  clearAll() {
    for (const drop of [...this.items]) this.remove(drop);
    this.byPickupId.clear();
  }

  // Full world state, used on `welcome` so a joining player immediately
  // sees exactly the same pickups everybody else already sees.
  applyServerPickups(pickups = []) {
    const seen = new Set();

    for (const pickup of pickups) {
      if (!pickup?.pickupId) continue;

      seen.add(pickup.pickupId);
      this.spawnFromServer(pickup);
    }

    for (const pickupId of [...this.byPickupId.keys()]) {
      if (!seen.has(pickupId)) this.removeByPickupId(pickupId);
    }
  }

  // One authoritative pickup. Idempotent: a repeated id is ignored rather
  // than producing a duplicate mesh.
  spawnFromServer(pickup) {
    if (!pickup?.pickupId || this.byPickupId.has(pickup.pickupId)) return null;

    const drop = this.spawn(pickup.itemId, { x: pickup.x, z: pickup.z });

    if (!drop) return null;

    drop.pickupId = pickup.pickupId;
    this.byPickupId.set(pickup.pickupId, drop);

    return drop;
  }

  removeByPickupId(pickupId) {
    const drop = this.byPickupId.get(pickupId);
    if (!drop) return false;

    this.remove(drop);
    return true;
  }

  // Called on enemy death. `kind` is the existing enemy kind ("normal" |
  // "boss"); bosses roll several times so high-level POIs pay out better.
  //
  // OFFLINE ONLY. While connected, the server's LootWorld rolls the drop at
  // the enemy's authoritative death position and broadcasts it, so rolling
  // here as well would create a second, private, desynchronised item.
  dropFrom(position, kind = "normal", { enemyId = null } = {}) {
    if (this.networked && this.serverAuthoritative) return [];
    if (!position) return [];

    const rolls = kind === "boss" ? LOOT_CONFIG.bossDropRolls : 1;
    const dropped = [];

    for (let i = 0; i < rolls; i++) {
      if (kind !== "boss" && this.random() > LOOT_CONFIG.normalDropChance) continue;

      const item = rollItem(this.random);
      if (!item) continue;

      const offset = rolls > 1 ? (i - (rolls - 1) / 2) * 1.8 : 0;

      const drop = this.spawn(item.id, {
        x: position.x + offset,
        z: position.z + offset * 0.4
      });

      if (drop) dropped.push(drop);
    }

    const collectible = this.dropBossCollectible(position, kind, enemyId);
    if (collectible) dropped.push(collectible);

    return dropped;
  }

  // -------------------------------------------------------------------------
  // BOSS COLLECTIBLE (offline mirror of LootWorld.dropBossCollectible)
  // -------------------------------------------------------------------------
  // Solo play must award the same trophy as a multiplayer boss kill. In
  // networked play this is never reached, because dropFrom() returns early
  // and the server spawns the collectible instead.
  // -------------------------------------------------------------------------
  dropBossCollectible(position, kind, enemyId = null) {
    if (kind !== "boss") return null;

    const itemId = LOOT_CONFIG.bossCollectibleId;
    if (!itemId || !getItem(itemId)) return null;

    if (typeof enemyId === "string" && enemyId.length > 0) {
      if (this.bossCollectiblesAwarded.has(enemyId)) return null;
      this.bossCollectiblesAwarded.add(enemyId);
    }

    return this.spawn(itemId, {
      x: position.x,
      z: position.z + 2.6
    });
  }

  spawn(itemId, { x, z }) {
    const item = getItem(itemId);
    if (!item) return null;

    // Oldest ORDINARY drop is recycled rather than letting the world fill
    // up. A rare collectible is never the victim: it is skipped here, so
    // reaching the cap can never quietly delete the Golden Arachnid Eye.
    if (this.items.length >= LOOT_CONFIG.maxActiveDrops) {
      const victim = this.items.find(drop => !neverDespawns(drop.itemId));
      if (victim) this.remove(victim);
    }

    // World presentation colour. Defaults to the rarity colour, but an
    // item may override it: the Golden Arachnid Eye is rarity EPIC
    // (purple in the UI) and must still read as gold in the world.
    const color = worldColor(itemId);
    const group = new THREE.Group();

    // Per-item procedural model (battery / medkit / core / ...) instead of
    // the single shared blob every drop used to render as.
    group.add(this.models.create(itemId, color));

    const glow = new THREE.Mesh(
      this.glowGeometry,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = -0.85;
    group.add(glow);

    const groundY = this.terrain?.heightAt?.(x, z) ?? 0;
    group.position.set(x, groundY + HOVER_HEIGHT, z);

    this.scene.add(group);

    const drop = {
      itemId,
      // Assigned by spawnFromServer() in networked mode; stays null for
      // offline drops, which need no shared identity.
      pickupId: null,
      // Latched the moment a pickup is consumed/withdrawn, so a stale
      // interaction target can be detected instead of re-offered.
      collected: false,
      name: item.name,
      color,
      group,
      glow,
      position: group.position,
      baseY: groundY + HOVER_HEIGHT,
      age: 0,

      // Lifetime resolved ONCE at spawn from the item data, so the update
      // loop never re-derives it and a rare collectible is immune to the
      // despawn sweep by data, not by name.
      neverDespawn: neverDespawns(itemId),
      despawnSeconds: despawnSecondsFor(itemId),
      collectible: item.collectible === true,

      // Restrained, slower rotation for rare collectibles; ordinary
      // salvage keeps its original spin.
      spinRate: spinRateFor(itemId)
    };

    this.items.push(drop);
    this.onDrop?.(item, drop);

    return drop;
  }

  remove(drop) {
    const index = this.items.indexOf(drop);
    if (index === -1) return;

    // Marked before detaching so anything still holding a reference to this
    // drop (an interaction target, a queued pickup request) can tell that
    // it is gone rather than acting on a stale object.
    drop.collected = true;

    if (drop.pickupId) this.byPickupId.delete(drop.pickupId);

    this.items.splice(index, 1);
    this.scene.remove(drop.group);
    drop.glow.material.dispose();
  }

  // True only while the drop is still a real, collectable world object.
  isAvailable(drop) {
    return Boolean(drop) && !drop.collected && this.items.includes(drop);
  }

  // Cheap: bob + spin + expiry for a handful of objects.
  update(dt) {
    this.elapsed += dt;

    for (let i = this.items.length - 1; i >= 0; i--) {
      const drop = this.items[i];
      drop.age += dt;

      // In networked mode the SERVER owns expiry and will broadcast the
      // removal; expiring locally would desync the world. Offline, a drop
      // flagged neverDespawn (rare collectible) is skipped entirely.
      if (!this.networked && !drop.neverDespawn && drop.age > drop.despawnSeconds) {
        this.remove(drop);
        continue;
      }

      drop.group.rotation.y += dt * 1.4 * drop.spinRate;
      drop.group.position.y =
        drop.baseY + Math.sin(this.elapsed * 2.2 + drop.age) * 0.18;

      // Fade out over the final seconds as an expiry warning. A drop that
      // never despawns has no warning to show, so it holds full opacity.
      if (drop.neverDespawn) {
        drop.glow.material.opacity = 0.45;
        continue;
      }

      const warning = LOOT_CONFIG.despawnWarningSeconds;
      const remaining = drop.despawnSeconds - drop.age;

      drop.glow.material.opacity =
        remaining < warning
          ? 0.45 * Math.max(0, remaining / warning)
          : 0.45;
    }
  }

  // Nearest drop within pickup range, or null. Used by InteractionSystem.
  nearest(position, radius = PICKUP_RADIUS) {
    let best = null;
    let bestDistance = radius;

    for (const drop of this.items) {
      if (drop.collected) continue;

      const distance = Math.hypot(
        drop.position.x - position.x,
        drop.position.z - position.z
      );

      if (distance < bestDistance) {
        best = drop;
        bestDistance = distance;
      }
    }

    return best;
  }

  // Minimap feed.
  getWorldItems() {
    return this.items;
  }

  dispose() {
    for (const drop of [...this.items]) this.remove(drop);

    this.glowGeometry.dispose();

    // Releases every shared item geometry/material in one place.
    this.models.dispose();
  }
}
