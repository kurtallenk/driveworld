import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { AutoLootController } from "../src/gameplay/AutoLoot.js";

// ---------------------------------------------------------------------------
// Minimal window/document/localStorage stubs. No jsdom in this project (see
// tests/keyboard-panel.test.js for the same approach); InputManager only
// needs keydown/keyup listeners and a localStorage that can fail safely.
// ---------------------------------------------------------------------------
function installDomStub() {
  const listeners = new Map();

  globalThis.window = {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    }
  };

  globalThis.document = {
    hidden: false,
    hasFocus: () => true,
    addEventListener() {}
  };

  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
  };

  globalThis.HTMLElement = class HTMLElement {};

  return {
    keydown(code, repeat = false) {
      for (const fn of listeners.get("keydown") ?? []) {
        fn({ code, repeat, target: null, preventDefault() {} });
      }
    },
    keyup(code) {
      for (const fn of listeners.get("keyup") ?? []) {
        fn({ code, target: null, preventDefault() {} });
      }
    }
  };
}

const dom = installDomStub();
const { InputManager } = await import("../src/input/InputManager.js");

// ---------------------------------------------------------------------------
// 1A / 1C - keyboard bindings
// ---------------------------------------------------------------------------

test("T requests exactly one turret toggle per physical press", () => {
  const input = new InputManager();

  dom.keydown("KeyT");
  assert.equal(input.consumeTurretToggle(), true);
  assert.equal(input.consumeTurretToggle(), false);

  dom.keyup("KeyT");
});

test("F requests exactly one Auto Loot toggle per physical press", () => {
  const input = new InputManager();

  dom.keydown("KeyF");
  assert.equal(input.consumeAutoLootToggle(), true);
  assert.equal(input.consumeAutoLootToggle(), false);

  dom.keyup("KeyF");
});

test("F never toggles the turret and T never toggles Auto Loot", () => {
  const input = new InputManager();

  dom.keydown("KeyF");
  assert.equal(input.consumeTurretToggle(), false, "F must not arm the turret");
  assert.equal(input.consumeAutoLootToggle(), true);
  dom.keyup("KeyF");

  dom.keydown("KeyT");
  assert.equal(input.consumeAutoLootToggle(), false, "T must not flip Auto Loot");
  assert.equal(input.consumeTurretToggle(), true);
  dom.keyup("KeyT");
});

test("browser key repeat cannot toggle Auto Loot or the turret twice", () => {
  const input = new InputManager();

  dom.keydown("KeyF");
  dom.keydown("KeyF", true);
  dom.keydown("KeyF", true);
  assert.equal(input.consumeAutoLootToggle(), true);
  assert.equal(input.consumeAutoLootToggle(), false);
  dom.keyup("KeyF");

  dom.keydown("KeyT");
  dom.keydown("KeyT", true);
  assert.equal(input.consumeTurretToggle(), true);
  assert.equal(input.consumeTurretToggle(), false);
  dom.keyup("KeyT");
});

test("E is no longer an input binding at all", () => {
  const input = new InputManager();

  dom.keydown("KeyE");

  assert.equal(input.keys.has("KeyE"), false, "E must not be a handled key");
  assert.equal(input.consumeTurretToggle(), false);
  assert.equal(input.consumeAutoLootToggle(), false);
  assert.equal(
    typeof input.consumeInteract,
    "undefined",
    "the legacy E interact request must be gone"
  );
});

test("the mobile button and the F key drive the same toggle request", () => {
  const input = new InputManager();

  input.requestAutoLootToggle();
  assert.equal(input.consumeAutoLootToggle(), true);

  dom.keydown("KeyF");
  assert.equal(input.consumeAutoLootToggle(), true);
  dom.keyup("KeyF");
});

// ---------------------------------------------------------------------------
// 1C - Auto Loot behaviour
// ---------------------------------------------------------------------------

test("Auto Loot starts off and toggles on/off with each request", () => {
  const changes = [];
  const autoLoot = new AutoLootController({ onChange: v => changes.push(v) });

  assert.equal(autoLoot.enabled, false);
  assert.equal(autoLoot.toggle(), true);
  assert.equal(autoLoot.toggle(), false);
  assert.deepEqual(changes, [true, false]);
});

test("setting the same state again is a no-op (state stays stable)", () => {
  const changes = [];
  const autoLoot = new AutoLootController({ onChange: v => changes.push(v) });

  autoLoot.setEnabled(true);
  autoLoot.setEnabled(true);
  autoLoot.setEnabled(true);

  assert.equal(autoLoot.enabled, true);
  assert.deepEqual(changes, [true]);
});

test("Auto Loot OFF never collects", () => {
  const collected = [];
  const autoLoot = new AutoLootController();

  const result = autoLoot.update({
    findCandidate: () => ({ pickupId: "p1" }),
    collect: drop => { collected.push(drop); return true; }
  });

  assert.equal(result, false);
  assert.deepEqual(collected, []);
});

test("Auto Loot ON collects an eligible nearby drop through collect()", () => {
  const collected = [];
  const autoLoot = new AutoLootController({ enabled: true });

  const result = autoLoot.update({
    findCandidate: () => ({ pickupId: "p1" }),
    collect: drop => { collected.push(drop.pickupId); return true; }
  });

  assert.equal(result, true);
  assert.deepEqual(collected, ["p1"]);
});

test("Auto Loot collects nothing when no candidate is eligible", () => {
  let collectCalls = 0;
  const autoLoot = new AutoLootController({ enabled: true });

  const result = autoLoot.update({
    findCandidate: () => null,
    collect: () => { collectCalls += 1; return true; }
  });

  assert.equal(result, false);
  assert.equal(collectCalls, 0);
});

test("a pending networked pickup is never requested twice", () => {
  // Models Game.nearestPickupCandidate + Game.collectDrop: the candidate
  // probe hides drops with an in-flight request, and collectDrop refuses a
  // duplicate even if one slipped through.
  const pendingPickups = new Set();
  const drop = { pickupId: "p1" };
  const sent = [];

  const findCandidate = () =>
    (drop.pickupId && pendingPickups.has(drop.pickupId)) ? null : drop;

  const collect = candidate => {
    if (pendingPickups.has(candidate.pickupId)) return false;
    pendingPickups.add(candidate.pickupId);
    sent.push(candidate.pickupId);
    return true;
  };

  const autoLoot = new AutoLootController({ enabled: true });

  for (let sweep = 0; sweep < 10; sweep += 1) {
    autoLoot.update({ findCandidate, collect });
  }

  assert.deepEqual(sent, ["p1"], "exactly one server pickup request");
});

test("a refused pickup (cargo full) is not reported as collected", () => {
  const autoLoot = new AutoLootController({ enabled: true });

  const result = autoLoot.update({
    findCandidate: () => ({ pickupId: "p1" }),
    collect: () => false
  });

  assert.equal(result, false);
});

// ---------------------------------------------------------------------------
// 1B - the keyboard panel must agree with the real bindings
// ---------------------------------------------------------------------------

test("#keyboard-panel shows T TURRET and F AUTO LOOT, not the legacy keys", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

  const panel = html.slice(
    html.indexOf('id="keyboard-panel"'),
    html.indexOf('id="combat-hud"')
  );

  assert.match(panel, /data-key="KeyT">T<\/span>Turret/);
  assert.match(panel, /data-key="KeyF">F<\/span>Auto loot/);
  assert.doesNotMatch(panel, />F<\/span>Turret/);
  assert.doesNotMatch(panel, />E<\/span>Pick up/);
});

test("no source file still binds KeyE or binds the turret to KeyF", () => {
  const source = readFileSync(
    new URL("../src/input/InputManager.js", import.meta.url), "utf8"
  );

  assert.doesNotMatch(source, /"KeyE"/);
  assert.match(source, /event\.code === "KeyT"[\s\S]{0,120}turretToggleRequested/);
  assert.match(source, /event\.code === "KeyF"[\s\S]{0,120}autoLootToggleRequested/);
});
