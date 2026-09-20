import assert from "node:assert/strict";
import test from "node:test";

import {
  LOOT_CONFIG,
  RARITY,
  despawnSecondsFor,
  getItem,
  isCollectible,
  itemColor,
  neverDespawns,
  rollItem,
  spinRateFor,
  worldColor
} from "../src/gameplay/ItemDatabase.js";
import { ItemModelFactory } from "../src/gameplay/ItemModels.js";
import { InventorySystem } from "../src/gameplay/InventorySystem.js";
import { LootWorld } from "../server/LootWorld.js";
import { LootSystem } from "../src/gameplay/LootSystem.js";

const EYE = "golden-arachnid-eye";

function boss(id, x = 100, z = -40) {
  return { id, kind: "boss", x, y: 0, z };
}

function eyesIn(pickups) {
  return pickups.filter(pickup => pickup.itemId === EYE);
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
// ITEM DATA
// ---------------------------------------------------------------------------

test("the Golden Arachnid Eye is defined as a permanent rare collectible", () => {
  const item = getItem(EYE);

  assert.ok(item, "item exists");
  assert.equal(item.name, "GOLDEN ARACHNID EYE");
  assert.equal(item.type, "collectible");
  assert.equal(item.collectible, true);
  assert.equal(item.neverDespawn, true);
  assert.equal(isCollectible(EYE), true);
  assert.equal(neverDespawns(EYE), true);
  assert.equal(despawnSecondsFor(EYE), Infinity, "never despawns");
  assert.equal(item.effect, undefined, "a trophy, not a consumable");
});

test("it is excluded from the ordinary drop table entirely", () => {
  assert.equal(getItem(EYE).dropWeight, 0);

  for (let i = 0; i < 2000; i++) {
    assert.notEqual(rollItem(Math.random).id, EYE, "never in an ordinary roll");
  }
});

test("it reads as gold in the world while keeping its epic UI rarity", () => {
  assert.equal(getItem(EYE).rarity, RARITY.EPIC);
  assert.notEqual(worldColor(EYE), itemColor(EYE), "world colour overrides rarity");
  assert.match(worldColor(EYE), /^#f{0,1}f/i, "a warm gold tone");
  assert.ok(spinRateFor(EYE) < 1, "restrained rotation compared to salvage");
});

test("the boss reward is configured as data, not hard-coded", () => {
  assert.equal(LOOT_CONFIG.bossCollectibleId, EYE);
});

// ---------------------------------------------------------------------------
// SERVER-AUTHORITATIVE DROP BEHAVIOUR
// ---------------------------------------------------------------------------

test("killing a boss spawns exactly one Golden Arachnid Eye", () => {
  const world = new LootWorld();
  const spawned = [];
  world.onSpawn = pickup => spawned.push(pickup);

  world.dropFromEnemy(boss("boss_001", 120, -64));

  const eyes = eyesIn(spawned);

  assert.equal(eyes.length, 1, "exactly one trophy");
  assert.ok(Math.abs(eyes[0].x - 120) < 4, "at the boss's death position");
  assert.ok(Math.abs(eyes[0].z + 64) < 4, "at the boss's death position");
  assert.equal(eyes[0].neverDespawn, true);
});

test("the trophy is awarded in addition to existing boss rewards", () => {
  const world = new LootWorld();

  const dropped = world.dropFromEnemy(boss("boss_002"));
  const ordinary = dropped.filter(pickup => pickup.itemId !== EYE);

  assert.equal(
    ordinary.length,
    LOOT_CONFIG.bossDropRolls,
    "ordinary boss drops are untouched"
  );
  assert.equal(eyesIn(dropped).length, 1, "plus the trophy");
});

test("ordinary enemies never drop the collectible", () => {
  const world = new LootWorld();
  const spawned = [];
  world.onSpawn = pickup => spawned.push(pickup);

  for (let i = 0; i < 3000; i++) {
    world.dropFromEnemy({ id: `grunt_${i}`, kind: "normal", x: i % 100, z: i % 70 });
    for (const pickup of [...world.pickups.values()]) {
      world.remove(pickup.pickupId, "test-cleanup");
    }
  }

  assert.equal(eyesIn(spawned).length, 0, "boss-only reward");
});

test("a repeated boss death event cannot mint a second trophy", () => {
  const world = new LootWorld();
  const spawned = [];
  world.onSpawn = pickup => spawned.push(pickup);

  const dead = boss("boss_003");

  world.dropFromEnemy(dead);
  world.dropFromEnemy(dead);
  world.dropFromEnemy(dead);

  assert.equal(eyesIn(spawned).length, 1, "one trophy per boss death");
});

test("each distinct boss still earns its own trophy", () => {
  const world = new LootWorld();
  const spawned = [];
  world.onSpawn = pickup => spawned.push(pickup);

  world.dropFromEnemy(boss("boss_004", 10, 10));
  world.dropFromEnemy(boss("boss_005", 40, 40));

  assert.equal(eyesIn(spawned).length, 2);
});

test("the trophy is spawned clear of the boss's ordinary drops", () => {
  const world = new LootWorld();
  const dropped = world.dropFromEnemy(boss("boss_006", 0, 0));

  const eye = eyesIn(dropped)[0];
  const ordinary = dropped.filter(pickup => pickup.itemId !== EYE);

  for (const pickup of ordinary) {
    const distance = Math.hypot(eye.x - pickup.x, eye.z - pickup.z);
    assert.ok(distance > 1, "separately visible and collectable");
  }
});

// ---------------------------------------------------------------------------
// PERMANENCE
// ---------------------------------------------------------------------------

test("the trophy remains in the world while ordinary boss loot expires", () => {
  const world = new LootWorld();
  const dropped = world.dropFromEnemy(boss("boss_007"));
  const eye = eyesIn(dropped)[0];

  world.update(LOOT_CONFIG.defaultDespawnSeconds * 100);

  assert.equal(world.pickups.size, 1, "only the trophy is left");
  assert.ok(world.pickups.has(eye.pickupId));

  const serialized = world.serialize();
  assert.equal(serialized.length, 1);
  assert.equal(serialized[0].itemId, EYE, "joining clients still see it");
});

test("the trophy survives the active-pickup cap", () => {
  const world = new LootWorld();
  const eye = eyesIn(world.dropFromEnemy(boss("boss_008")))[0];

  for (let i = 0; i < LOOT_CONFIG.maxActivePickups + 30; i++) {
    world.spawn("medkit", i, i);
  }

  assert.ok(
    world.pickups.has(eye.pickupId),
    "ordinary loot cleanup must never remove it"
  );
});

// ---------------------------------------------------------------------------
// MULTIPLAYER PICKUP FRAMEWORK
// ---------------------------------------------------------------------------

test("the trophy is collected through the normal claim framework", () => {
  const world = new LootWorld();
  const removed = [];
  world.onRemove = (pickupId, reason) => removed.push(reason);

  const eye = eyesIn(world.dropFromEnemy(boss("boss_009", 0, 0)))[0];

  const near = { id: "player-a", state: { position: [eye.x, 1, eye.z + 1] } };
  const alsoNear = { id: "player-b", state: { position: [eye.x, 1, eye.z + 1] } };
  const far = { id: "player-c", state: { position: [900, 1, 900] } };

  assert.equal(world.claim(eye.pickupId, far).reason, "too-far");

  const first = world.claim(eye.pickupId, near);
  const second = world.claim(eye.pickupId, alsoNear);

  assert.equal(first.ok, true, "one winner");
  assert.equal(second.ok, false);
  assert.equal(second.reason, "taken", "no duplicate award");

  world.remove(eye.pickupId, "collected");

  assert.deepEqual(removed, ["collected"], "removed once, broadcast once");
  assert.equal(world.pickups.has(eye.pickupId), false, "gone from the world");

  // The boss's ordinary drops are untouched by collecting the trophy.
  assert.equal(world.pickups.size, LOOT_CONFIG.bossDropRolls);
});

test("a collected trophy is not resurrected by the expiry sweep", () => {
  const world = new LootWorld();
  const eye = eyesIn(world.dropFromEnemy(boss("boss_010")))[0];

  world.remove(eye.pickupId, "collected");
  world.update(LOOT_CONFIG.defaultDespawnSeconds * 10);

  assert.equal(world.pickups.has(eye.pickupId), false);
});

test("a client renders the trophy from the server's spawn broadcast", () => {
  const world = new LootWorld();
  const loot = lootSystemStub();
  loot.enableNetworkedMode({ serverAuthoritative: true });

  world.onSpawn = pickup => loot.spawnFromServer(pickup);
  world.dropFromEnemy(boss("boss_011", 20, 20));

  const rendered = loot.items.filter(drop => drop.itemId === EYE);

  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].neverDespawn, true);
  assert.equal(rendered[0].collectible, true);

  // A duplicated broadcast must not double-render it.
  const eye = eyesIn([...world.pickups.values()])[0];
  loot.spawnFromServer(eye);

  assert.equal(loot.items.filter(drop => drop.itemId === EYE).length, 1);

  loot.dispose();
});

test("a networked client never spawns the trophy on its own", () => {
  const loot = lootSystemStub();
  loot.enableNetworkedMode({ serverAuthoritative: true });

  assert.deepEqual(loot.dropFrom({ x: 0, z: 0 }, "boss", { enemyId: "boss_012" }), []);
  assert.equal(loot.items.length, 0);

  loot.dispose();
});

// ---------------------------------------------------------------------------
// OFFLINE / SOLO PARITY
// ---------------------------------------------------------------------------

test("a solo boss kill awards the trophy exactly once", () => {
  const loot = lootSystemStub();

  const dropped = loot.dropFrom({ x: 5, z: 5 }, "boss", { enemyId: "boss_013" });
  assert.equal(dropped.filter(drop => drop.itemId === EYE).length, 1);

  // Same boss, repeated death event.
  loot.dropFrom({ x: 5, z: 5 }, "boss", { enemyId: "boss_013" });
  assert.equal(loot.items.filter(drop => drop.itemId === EYE).length, 1);

  loot.dispose();
});

test("a solo trophy never despawns while ordinary salvage does", () => {
  const loot = lootSystemStub();

  loot.dropFrom({ x: 0, z: 0 }, "boss", { enemyId: "boss_014" });
  loot.update(LOOT_CONFIG.defaultDespawnSeconds * 30);

  assert.equal(loot.items.length, 1);
  assert.equal(loot.items[0].itemId, EYE);

  loot.dispose();
});

test("a solo normal kill never awards the trophy", () => {
  const loot = lootSystemStub();

  for (let i = 0; i < 1500; i++) {
    loot.dropFrom({ x: i % 50, z: i % 40 }, "normal", { enemyId: `grunt_${i}` });
  }

  assert.equal(loot.items.filter(drop => drop.itemId === EYE).length, 0);

  loot.dispose();
});

// ---------------------------------------------------------------------------
// APPEARANCE
// ---------------------------------------------------------------------------

test("the trophy has a distinct golden, eye-like model", () => {
  const factory = new ItemModelFactory();

  const meshes = [];
  factory.create(EYE, worldColor(EYE)).traverse(object => {
    if (object.isMesh) meshes.push(object);
  });

  assert.ok(meshes.length >= 12, "orb, spines, socket, iris, pupil, catchlight");

  const types = new Set(meshes.map(mesh => mesh.geometry.type));
  assert.ok(types.has("SphereGeometry"), "golden orb");
  assert.ok(types.has("ConeGeometry"), "arachnid spines");
  assert.ok(types.has("TorusGeometry"), "eye socket ring");

  const emissive = meshes.filter(
    mesh => mesh.material.emissive.getHex() !== 0x000000
  );
  assert.ok(emissive.length >= 2, "subtle emissive glow, not a flat prop");

  assert.ok(
    meshes.some(mesh => mesh.material.metalness > 0.5),
    "gold metal"
  );
  assert.ok(meshes.every(mesh => mesh.castShadow));

  factory.dispose();
});

test("the trophy does not look like ordinary loot", () => {
  const factory = new ItemModelFactory();

  const signature = id => {
    const parts = [];
    factory.create(id, worldColor(id)).traverse(object => {
      if (object.isMesh) parts.push(object.geometry.type);
    });
    return parts.sort().join(",");
  };

  const eye = signature(EYE);

  for (const other of ["portable-battery", "medkit", "data-core"]) {
    assert.notEqual(eye, signature(other), `distinct from ${other}`);
  }

  factory.dispose();
});

// ---------------------------------------------------------------------------
// INVENTORY INTEGRATION
// ---------------------------------------------------------------------------

test("the trophy stacks in the existing inventory and is never consumed", () => {
  const inventory = new InventorySystem(null);

  assert.equal(inventory.add(EYE, 1), 1);
  assert.equal(inventory.add(EYE, 1), 1);
  assert.equal(inventory.count(EYE), 2, "collection accumulates");

  // No effect means nothing to apply: the trophy must not be destroyed by
  // a stray use, and no gameplay system should be touched.
  assert.equal(inventory.useItem(EYE), false);
  assert.equal(inventory.count(EYE), 2, "still in the collection");
});

test("the Cargo panel shows the trophy as KEPT, not USE", () => {
  const created = [];

  const makeElement = tag => {
    const element = {
      tag,
      className: "",
      textContent: "",
      dataset: {},
      style: {},
      children: [],
      hidden: false,
      append(...nodes) {
        this.children.push(...nodes);
      },
      querySelector: () => null,
      addEventListener() {}
    };
    created.push(element);
    return element;
  };

  const previousDocument = globalThis.document;
  globalThis.document = { createElement: makeElement };

  try {
    const list = makeElement("ul");
    const panel = {
      hidden: true,
      querySelector: selector => (selector === "#inventory-list" ? list : null),
      addEventListener() {}
    };

    const inventory = new InventorySystem(panel);
    inventory.add(EYE, 1);
    inventory.add("medkit", 1);

    // add() renders on every change; only inspect the final render.
    created.length = 0;
    list.children.length = 0;
    inventory.render();

    const actions = created.filter(
      element => typeof element.className === "string" &&
        element.className.includes("inv-use")
    );

    const kept = actions.filter(element => element.textContent === "KEPT");
    const use = actions.filter(element => element.textContent === "USE");

    assert.equal(kept.length, 1, "the trophy renders a KEPT tag");
    assert.equal(kept[0].tag, "span", "not a clickable button");
    assert.equal(kept[0].dataset.itemId, undefined, "no use handler target");

    assert.equal(use.length, 1, "the medkit still renders a USE button");
    assert.equal(use[0].tag, "button");
    assert.equal(use[0].dataset.itemId, "medkit");
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
