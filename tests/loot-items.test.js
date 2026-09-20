import assert from "node:assert/strict";
import test from "node:test";

import {
  ITEMS,
  LOOT_CONFIG,
  despawnSecondsFor,
  getItem,
  isCollectible,
  neverDespawns,
  rollItem
} from "../src/gameplay/ItemDatabase.js";
import { ItemModelFactory } from "../src/gameplay/ItemModels.js";
import { LootWorld } from "../server/LootWorld.js";
import { LootSystem } from "../src/gameplay/LootSystem.js";

// The drop rate the game shipped with before Milestone 2. Ordinary loot
// must now be meaningfully rarer than this.
const LEGACY_DROP_CHANCE = 0.38;

// Registers a synthetic rare collectible so the rare-item exception can be
// proven independently of any single named item. Milestone 3's Golden
// Arachnid Eye uses the same flags; nothing in the loot pipeline is
// allowed to special-case an item by name.
function withTestCollectible(run) {
  const id = "test-relic";

  ITEMS[id] = {
    id,
    name: "TEST RELIC",
    short: "RELIC",
    description: "Synthetic rare collectible used by the loot tests.",
    icon: "\u25c9",
    rarity: "epic",
    type: "collectible",
    dropWeight: 0,
    maxStack: 1,
    model: "shard",
    neverDespawn: true,
    collectible: true
  };

  try {
    return run(id);
  } finally {
    delete ITEMS[id];
  }
}

function sceneStub() {
  return {
    added: [],
    removed: [],
    add(object) {
      this.added.push(object);
    },
    remove(object) {
      this.removed.push(object);
    }
  };
}

function lootSystemStub() {
  return new LootSystem(sceneStub(), { heightAt: () => 0 });
}

// ---------------------------------------------------------------------------
// C. DROP RATES
// ---------------------------------------------------------------------------

test("ordinary drop chance is configured well below the legacy rate", () => {
  assert.ok(
    LOOT_CONFIG.normalDropChance < LEGACY_DROP_CHANCE,
    "ordinary drops must be rarer than before"
  );
  assert.ok(LOOT_CONFIG.normalDropChance > 0, "ordinary drops must still happen");
});

test("ordinary enemy kills drop loot at roughly the configured rate", () => {
  const world = new LootWorld();
  const kills = 4000;
  let drops = 0;

  for (let i = 0; i < kills; i++) {
    drops += world.dropFromEnemy({
      id: `grunt_${i}`,
      kind: "normal",
      x: i % 200,
      z: -(i % 150)
    }).length;

    // Keep the active set small so the cap never distorts the measurement.
    for (const pickup of [...world.pickups.values()]) {
      world.remove(pickup.pickupId, "test-cleanup");
    }
  }

  const observed = drops / kills;

  assert.ok(
    Math.abs(observed - LOOT_CONFIG.normalDropChance) < 0.04,
    `observed ${observed.toFixed(3)} should track configured ${LOOT_CONFIG.normalDropChance}`
  );
  assert.ok(observed < LEGACY_DROP_CHANCE - 0.1, "clearly rarer than the legacy rate");
});

test("boss rewards are preserved: every boss kill still pays out in full", () => {
  const world = new LootWorld();

  for (let i = 0; i < 12; i++) {
    const dropped = world.dropFromEnemy({
      id: `boss_${i}`,
      kind: "boss",
      x: 10 * i,
      z: 5 * i
    });

    // Counts ORDINARY drops only. Milestone 3 adds the Golden Arachnid Eye
    // as an extra boss reward, so the invariant being guarded here is that
    // the original payout was never reduced -- not that nothing was added.
    const ordinary = dropped.filter(
      pickup => pickup.itemId !== LOOT_CONFIG.bossCollectibleId
    );

    assert.equal(
      ordinary.length,
      LOOT_CONFIG.bossDropRolls,
      "boss drops must not be reduced"
    );
  }
});

test("rollItem never returns an item excluded from the drop table", () => {
  withTestCollectible(id => {
    for (let i = 0; i < 500; i++) {
      assert.notEqual(rollItem(Math.random).id, id, "dropWeight 0 must stay out");
    }
  });
});

// ---------------------------------------------------------------------------
// D/E. LIFETIMES AND THE RARE EXCEPTION
// ---------------------------------------------------------------------------

test("every ordinary item despawns on the configured default lifetime", () => {
  for (const id of ["portable-battery", "medkit", "data-core"]) {
    assert.equal(neverDespawns(id), false, `${id} is ordinary loot`);
    assert.equal(isCollectible(id), false, `${id} is not a collectible`);
    assert.equal(despawnSecondsFor(id), LOOT_CONFIG.defaultDespawnSeconds);
  }
});

test("rarity colour does not grant despawn immunity", () => {
  // SALVAGED DATA CORE is rarity RARE but is still ordinary loot. This is
  // the regression guard against deciding lifetime from `rarity`.
  assert.equal(getItem("data-core").rarity, "rare");
  assert.equal(neverDespawns("data-core"), false);
  assert.ok(Number.isFinite(despawnSecondsFor("data-core")));
});

test("a flagged collectible reports an infinite lifetime", () => {
  withTestCollectible(id => {
    assert.equal(isCollectible(id), true);
    assert.equal(neverDespawns(id), true);
    assert.equal(despawnSecondsFor(id), Infinity);
  });
});

test("despawn timing is configurable per item", () => {
  const id = "test-short-life";

  ITEMS[id] = {
    id,
    name: "SHORT LIFE",
    rarity: "common",
    type: "consumable",
    dropWeight: 0,
    maxStack: 1,
    model: "shard",
    neverDespawn: false,
    collectible: false,
    despawnSeconds: 12
  };

  try {
    assert.equal(despawnSecondsFor(id), 12);

    const world = new LootWorld();
    const removed = [];
    world.onRemove = (pickupId, reason) => removed.push(reason);

    world.spawn(id, 0, 0);
    world.update(11);
    assert.deepEqual(removed, [], "must survive until its own lifetime");

    world.update(2);
    assert.deepEqual(removed, ["expired"], "must expire on its own lifetime");
  } finally {
    delete ITEMS[id];
  }
});

test("server expires ordinary pickups only after the configured lifetime", () => {
  const world = new LootWorld();
  const removed = [];
  world.onRemove = (pickupId, reason) => removed.push(reason);

  world.spawn("medkit", 2, 2);

  world.update(LOOT_CONFIG.defaultDespawnSeconds - 1);
  assert.deepEqual(removed, [], "must not expire early");
  assert.equal(world.serialize().length, 1);

  world.update(2);
  assert.deepEqual(removed, ["expired"], "must expire once the lifetime passes");
  assert.equal(world.serialize().length, 0);
});

test("server never expires a rare collectible", () => {
  withTestCollectible(id => {
    const world = new LootWorld();
    const removed = [];
    world.onRemove = pickupId => removed.push(pickupId);

    const relic = world.spawn(id, 5, 5);
    const ordinary = world.spawn("medkit", 6, 6);

    // Far beyond any ordinary lifetime.
    world.update(LOOT_CONFIG.defaultDespawnSeconds * 50);

    assert.deepEqual(removed, [ordinary.pickupId], "only ordinary loot expires");
    assert.ok(world.pickups.has(relic.pickupId), "collectible stays in the world");
    assert.equal(world.serialize().length, 1);
  });
});

test("hitting the active-pickup cap recycles ordinary loot, never a collectible", () => {
  withTestCollectible(id => {
    const world = new LootWorld();

    const relic = world.spawn(id, 0, 0);

    // Fill well past the cap with ordinary loot.
    for (let i = 0; i < LOOT_CONFIG.maxActivePickups + 20; i++) {
      world.spawn("medkit", i, i);
    }

    assert.ok(world.pickups.has(relic.pickupId), "collectible survives recycling");
    assert.ok(
      world.pickups.size <= LOOT_CONFIG.maxActivePickups,
      "cap is still enforced"
    );
  });
});

// ---------------------------------------------------------------------------
// CLEANUP AFTER PICKUP
// ---------------------------------------------------------------------------

test("a claimed pickup is cleaned up exactly once and never expires later", () => {
  const world = new LootWorld();
  const removed = [];
  world.onRemove = (pickupId, reason) => removed.push(reason);

  const pickup = world.spawn("portable-battery", 10, 10);

  const claim = world.claim(pickup.pickupId, {
    id: "player-a",
    state: { position: [10, 1, 11] }
  });

  assert.equal(claim.ok, true);

  world.remove(pickup.pickupId, "collected");

  // A collected pickup must not still be sitting in the expiry sweep.
  world.update(LOOT_CONFIG.defaultDespawnSeconds * 10);

  assert.deepEqual(removed, ["collected"], "exactly one cleanup, no duplicate timer");
  assert.equal(world.pickups.size, 0, "no orphaned server record");
});

test("spawn broadcasts carry the itemId clients need to build the model", () => {
  const world = new LootWorld();
  const spawned = [];
  world.onSpawn = pickup => spawned.push(pickup);

  world.spawn("medkit", 3, 4);

  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].itemId, "medkit");
  assert.equal(typeof spawned[0].pickupId, "string");
});

// ---------------------------------------------------------------------------
// A/B. ITEM MODELS
// ---------------------------------------------------------------------------

function meshesOf(group) {
  const meshes = [];
  group.traverse(object => {
    if (object.isMesh) meshes.push(object);
  });
  return meshes;
}

test("battery and medkit build distinct, non-trivial models", () => {
  const factory = new ItemModelFactory();

  const battery = meshesOf(factory.create("portable-battery", "#4be3a0"));
  const medkit = meshesOf(factory.create("medkit", "#b9c2cc"));

  assert.ok(battery.length >= 4, "battery is built from multiple parts");
  assert.ok(medkit.length >= 6, "medkit is built from multiple parts");

  const batteryTypes = new Set(battery.map(mesh => mesh.geometry.type));
  const medkitTypes = new Set(medkit.map(mesh => mesh.geometry.type));

  assert.ok(batteryTypes.has("CylinderGeometry"), "battery uses a cell body");
  assert.ok(medkitTypes.has("BoxGeometry"), "medkit uses a case body");
  assert.ok(medkitTypes.has("TorusGeometry"), "medkit has a carry handle");

  // The two items must not look alike any more.
  assert.notDeepEqual([...batteryTypes].sort(), [...medkitTypes].sort());

  factory.dispose();
});

test("medkit carries an emissive medical cross readable from above", () => {
  const factory = new ItemModelFactory();
  const group = factory.create("medkit", "#b9c2cc");

  const crossMeshes = meshesOf(group).filter(
    mesh => mesh.material.emissiveIntensity > 0 && mesh.material.emissive.r > 0.5
  );

  assert.ok(crossMeshes.length >= 4, "cross bars on both the lid and the face");

  const aboveLid = crossMeshes.filter(mesh => mesh.position.y > 0.2);
  assert.ok(aboveLid.length >= 2, "a cross is visible on the lid");

  factory.dispose();
});

test("battery model has an emissive label band and a metal terminal", () => {
  const factory = new ItemModelFactory();
  const meshes = meshesOf(factory.create("portable-battery", "#4be3a0"));

  // MeshStandardMaterial defaults emissiveIntensity to 1 with a BLACK
  // emissive colour, so "is it glowing?" must be asked of the colour.
  const glowing = meshes.filter(
    mesh => mesh.material.emissive.getHex() !== 0x000000
  );
  const metal = meshes.filter(
    mesh =>
      mesh.material.emissive.getHex() === 0x000000 && mesh.material.metalness > 0.3
  );

  assert.ok(
    glowing.length >= 1,
    "emissive label band keeps it readable at distance"
  );
  assert.ok(metal.length >= 2, "brushed metal caps and terminal");
  assert.ok(
    meshes.some(mesh => mesh.position.y > 0.4),
    "raised positive terminal"
  );

  factory.dispose();
});

test("models cast shadows and share geometry between instances", () => {
  const factory = new ItemModelFactory();

  const first = meshesOf(factory.create("medkit", "#b9c2cc"));
  const second = meshesOf(factory.create("medkit", "#b9c2cc"));

  assert.ok(first.every(mesh => mesh.castShadow), "drops cast shadows");

  // Shared resources: a second medkit must not allocate new geometry.
  assert.equal(first.length, second.length);
  for (let i = 0; i < first.length; i++) {
    assert.equal(first[i].geometry, second[i].geometry, "geometry is reused");
    assert.equal(first[i].material, second[i].material, "material is reused");
  }

  factory.dispose();
});

test("an unknown item still renders through the fallback model", () => {
  const factory = new ItemModelFactory();
  const meshes = meshesOf(factory.create("does-not-exist", "#ffffff"));

  assert.ok(meshes.length >= 1, "unknown items must not throw or vanish");

  factory.dispose();
});

test("factory dispose releases every shared geometry and material", () => {
  const factory = new ItemModelFactory();

  factory.create("portable-battery", "#4be3a0");
  factory.create("medkit", "#b9c2cc");
  factory.create("data-core", "#48d5ff");

  const geometries = [...factory.geometries.values()];
  const materials = [...factory.materials.values()];

  assert.ok(geometries.length > 0 && materials.length > 0);

  let disposed = 0;
  for (const resource of [...geometries, ...materials]) {
    resource.addEventListener?.("dispose", () => {
      disposed++;
    });
  }

  factory.dispose();

  assert.equal(disposed, geometries.length + materials.length, "all released");
  assert.equal(factory.geometries.size, 0);
  assert.equal(factory.materials.size, 0);
});

// ---------------------------------------------------------------------------
// CLIENT LOOT SYSTEM (offline fallback + rendering lifecycle)
// ---------------------------------------------------------------------------

test("offline drops expire on the shared lifetime and free their scene object", () => {
  const loot = lootSystemStub();
  const drop = loot.spawn("medkit", { x: 0, z: 0 });

  assert.equal(loot.items.length, 1);

  loot.update(LOOT_CONFIG.defaultDespawnSeconds - 1);
  assert.equal(loot.items.length, 1, "must not expire early");

  loot.update(2);

  assert.equal(loot.items.length, 0, "expired");
  assert.equal(drop.collected, true, "marked so stale references can tell");
  assert.ok(loot.scene.removed.includes(drop.group), "removed from the scene");

  loot.dispose();
});

test("offline rare collectibles never expire client-side", () => {
  withTestCollectible(id => {
    const loot = lootSystemStub();
    const relic = loot.spawn(id, { x: 1, z: 1 });
    loot.spawn("medkit", { x: 2, z: 2 });

    loot.update(LOOT_CONFIG.defaultDespawnSeconds * 20);

    assert.equal(loot.items.length, 1);
    assert.equal(loot.items[0], relic, "only the collectible remains");
    assert.equal(relic.neverDespawn, true);

    loot.dispose();
  });
});

test("client never expires drops while the server owns loot", () => {
  const loot = lootSystemStub();
  loot.enableNetworkedMode({ serverAuthoritative: true });

  loot.spawnFromServer({ pickupId: "pickup_00001", itemId: "medkit", x: 0, z: 0 });

  loot.update(LOOT_CONFIG.defaultDespawnSeconds * 5);

  assert.equal(loot.items.length, 1, "expiry is the server's decision alone");
  assert.equal(loot.byPickupId.size, 1);

  loot.dispose();
});

test("networked clients roll no drops of their own", () => {
  const loot = lootSystemStub();
  loot.enableNetworkedMode({ serverAuthoritative: true });

  const dropped = loot.dropFrom({ x: 0, z: 0 }, "boss");

  assert.deepEqual(dropped, [], "server-authoritative loot only");

  loot.dispose();
});

test("removing a drop clears its pickup index and marks it uncollectable", () => {
  const loot = lootSystemStub();
  loot.enableNetworkedMode({ serverAuthoritative: true });

  const drop = loot.spawnFromServer({
    pickupId: "pickup_00007",
    itemId: "portable-battery",
    x: 4,
    z: 4
  });

  assert.equal(loot.isAvailable(drop), true);

  assert.equal(loot.removeByPickupId("pickup_00007"), true);
  assert.equal(loot.removeByPickupId("pickup_00007"), false, "no duplicate cleanup");
  assert.equal(loot.isAvailable(drop), false);
  assert.equal(loot.byPickupId.size, 0, "no orphaned index entry");
  assert.equal(loot.items.length, 0);

  loot.dispose();
});

test("client cap recycles ordinary drops but keeps collectibles", () => {
  withTestCollectible(id => {
    const loot = lootSystemStub();

    const relic = loot.spawn(id, { x: 0, z: 0 });

    for (let i = 0; i < LOOT_CONFIG.maxActiveDrops + 10; i++) {
      loot.spawn("medkit", { x: i, z: i });
    }

    assert.ok(loot.items.includes(relic), "collectible is never recycled");
    assert.ok(loot.items.length <= LOOT_CONFIG.maxActiveDrops);

    loot.dispose();
  });
});

test("dispose leaves no drops behind", () => {
  const loot = lootSystemStub();

  loot.spawn("medkit", { x: 0, z: 0 });
  loot.spawn("portable-battery", { x: 1, z: 1 });

  loot.dispose();

  assert.equal(loot.items.length, 0);
  assert.equal(loot.byPickupId.size, 0);
});
