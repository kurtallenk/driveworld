import assert from "node:assert/strict";
import test from "node:test";

import { LootWorld } from "../server/LootWorld.js";

function playerAt(id, x, z) {
  return { id, state: { position: [x, 1, z] } };
}

test("drops land at the enemy's death position, never the player's", () => {
  const world = new LootWorld();
  const spawned = [];
  world.onSpawn = pickup => spawned.push(pickup);

  // Boss always drops, which keeps this test independent of the RNG roll.
  world.dropFromEnemy({ id: "boss_001", kind: "boss", x: 120, y: 0, z: -64 });

  assert.ok(spawned.length > 0, "boss should drop loot");

  for (const pickup of spawned) {
    assert.ok(Math.abs(pickup.x - 120) < 4, "x near enemy death position");
    assert.ok(Math.abs(pickup.z + 64) < 4, "z near enemy death position");
    assert.equal(typeof pickup.pickupId, "string");
  }
});

test("pickup ids are unique", () => {
  const world = new LootWorld();
  const a = world.spawn("medkit", 1, 1);
  const b = world.spawn("medkit", 1, 1);

  assert.notEqual(a.pickupId, b.pickupId);
});

test("only one player can claim the same pickup", () => {
  const world = new LootWorld();
  const pickup = world.spawn("portable-battery", 10, 10);

  const first = world.claim(pickup.pickupId, playerAt("a", 10, 11));
  const second = world.claim(pickup.pickupId, playerAt("b", 10, 11));

  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.reason, "taken");
});

test("claims are rejected from out of range and for missing pickups", () => {
  const world = new LootWorld();
  const pickup = world.spawn("portable-battery", 0, 0);

  assert.equal(world.claim(pickup.pickupId, playerAt("a", 500, 500)).reason, "too-far");
  assert.equal(world.claim("pickup_99999", playerAt("a", 0, 0)).reason, "missing");
});

test("removal broadcasts once and drops the pickup from serialize()", () => {
  const world = new LootWorld();
  const removed = [];
  world.onRemove = id => removed.push(id);

  const pickup = world.spawn("medkit", 4, 4);

  assert.equal(world.serialize().length, 1);

  assert.equal(world.remove(pickup.pickupId, "collected"), true);
  assert.equal(world.remove(pickup.pickupId, "collected"), false);

  assert.deepEqual(removed, [pickup.pickupId]);
  assert.equal(world.serialize().length, 0);
});

test("pickups expire on the server clock", () => {
  const world = new LootWorld();
  const removed = [];
  world.onRemove = (id, reason) => removed.push(reason);

  world.spawn("medkit", 2, 2);
  world.update(200);

  assert.deepEqual(removed, ["expired"]);
});
