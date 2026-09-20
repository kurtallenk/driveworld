import assert from "node:assert/strict";
import test from "node:test";

import { InventorySystem } from "../src/gameplay/InventorySystem.js";

// The hotbar is a view over InventorySystem: it never stores counts, it
// re-reads them whenever the inventory reports a change. These tests cover
// that contract without a DOM.

test("change listeners fire on add, use and remove", () => {
  const inventory = new InventorySystem(null);
  const seen = [];

  inventory.addChangeListener(() => {
    seen.push({
      medkit: inventory.count("medkit"),
      battery: inventory.count("portable-battery")
    });
  });

  inventory.add("portable-battery", 3);
  inventory.add("medkit", 2);
  inventory.remove("portable-battery", 1);

  assert.deepEqual(seen, [
    { medkit: 0, battery: 3 },
    { medkit: 2, battery: 3 },
    { medkit: 2, battery: 2 }
  ]);
});

test("using a battery routes through the existing battery system", () => {
  const inventory = new InventorySystem(null);
  let charged = 0;

  inventory.context = {
    battery: {
      addCharge(amount) {
        charged += amount;
        return amount;
      }
    }
  };

  inventory.add("portable-battery", 2);

  assert.equal(inventory.useItem("portable-battery"), true);
  assert.equal(charged, 25);

  // One authoritative quantity: the bag decremented, so the hotbar (which
  // reads count()) decrements with it.
  assert.equal(inventory.count("portable-battery"), 1);
});

test("using a medkit routes through the existing player health system", () => {
  const inventory = new InventorySystem(null);
  let healed = 0;

  inventory.context = {
    playerHealth: {
      heal(amount) {
        healed += amount;
        return amount;
      }
    }
  };

  inventory.add("medkit", 1);

  assert.equal(inventory.useItem("medkit"), true);
  assert.equal(healed, 40);
  assert.equal(inventory.count("medkit"), 0);
});

test("an empty stack cannot be used", () => {
  const inventory = new InventorySystem(null);

  inventory.context = { battery: { addCharge: () => 25 } };

  assert.equal(inventory.useItem("portable-battery"), false);
  assert.equal(inventory.count("portable-battery"), 0);
});

test("a full battery refuses the item instead of consuming it", () => {
  const inventory = new InventorySystem(null);

  inventory.context = { battery: { addCharge: () => 0 } };
  inventory.add("portable-battery", 1);

  assert.equal(inventory.useItem("portable-battery"), false);
  assert.equal(inventory.count("portable-battery"), 1);
});

test("removing a change listener stops updates", () => {
  const inventory = new InventorySystem(null);
  let calls = 0;

  const off = inventory.addChangeListener(() => {
    calls += 1;
  });

  inventory.add("medkit", 1);
  off();
  inventory.add("medkit", 1);

  assert.equal(calls, 1);
});
