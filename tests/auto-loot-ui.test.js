import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { AutoLootController } from "../src/gameplay/AutoLoot.js";

const read = rel => readFileSync(new URL(rel, import.meta.url), "utf8");

// ---------------------------------------------------------------------------
// 2A - desktop status
// ---------------------------------------------------------------------------

test("the Auto Loot pill sits in the existing dash status row", () => {
  const html = read("../index.html");

  const row = html.slice(
    html.indexOf('class="dash-secondary"'),
    html.indexOf('id="start-engine"')
  );

  assert.ok(row.includes('id="turret-status"'));
  assert.ok(row.includes('id="turbo-status"'));
  assert.ok(
    row.includes('id="auto-loot-status"'),
    "Auto Loot must be a sibling pill, not a floating overlay"
  );
  assert.match(row, /id="auto-loot-status"[^>]*class="dash-pill dash-pill-autoloot"/);
  assert.match(row, /id="auto-loot-status"[^>]*role="status"/);
  assert.match(row, /id="auto-loot-status"[^>]*aria-live="polite"/);
  assert.match(row, /id="auto-loot-status"[^>]*aria-label="Auto loot off"/);
  assert.match(row, />AUTO LOOT: OFF</);
});

test("the pill has its own dim and active styling", () => {
  const theme = read("../src/ui/theme.css");

  assert.match(theme, /\.dash-pill-autoloot\s*\{/);
  assert.match(theme, /\.dash-pill-autoloot--active\s*\{/);
});

test("Game renders both surfaces from the one shared state", () => {
  const game = read("../src/core/Game.js");

  assert.match(game, /this\.autoLootStatusElement\s*=\s*document\.querySelector\("#auto-loot-status"\)/);
  assert.match(game, /AUTO LOOT: \$\{active \? "ACTIVE" : "OFF"\}/);
  assert.match(game, /dash-pill-autoloot--active/);
  assert.match(game, /this\.mobileControls\?\.setAutoLootActive\?\.\(active\)/);

  // One toggle entry point, fed by the one consume flag.
  assert.match(game, /toggleAutoLoot\(\)\s*\{\s*return this\.autoLoot\.toggle\(\);/);
  assert.match(game, /consumeAutoLootToggle\(\)\)\s*this\.toggleAutoLoot\(\)/);
});

// Reproduces Game.renderAutoLootState against element stubs.
test("the status text and active class follow the toggle immediately", () => {
  const pill = {
    textContent: "",
    attributes: {},
    classes: new Set(),
    classList: {
      toggle: (name, on) =>
        on ? pill.classes.add(name) : pill.classes.delete(name)
    },
    setAttribute: (k, v) => { pill.attributes[k] = v; }
  };

  let mobileActive = null;

  const render = active => {
    pill.textContent = `AUTO LOOT: ${active ? "ACTIVE" : "OFF"}`;
    pill.classList.toggle("dash-pill-autoloot--active", active);
    pill.setAttribute("aria-label", `Auto loot ${active ? "active" : "off"}`);
    mobileActive = active;
  };

  const autoLoot = new AutoLootController({ onChange: render });

  render(autoLoot.enabled);
  assert.equal(pill.textContent, "AUTO LOOT: OFF");
  assert.equal(pill.classes.has("dash-pill-autoloot--active"), false);
  assert.equal(mobileActive, false);

  autoLoot.toggle();
  assert.equal(pill.textContent, "AUTO LOOT: ACTIVE");
  assert.equal(pill.classes.has("dash-pill-autoloot--active"), true);
  assert.equal(pill.attributes["aria-label"], "Auto loot active");
  assert.equal(mobileActive, true, "the mobile button follows the same state");

  autoLoot.toggle();
  assert.equal(pill.textContent, "AUTO LOOT: OFF");
  assert.equal(mobileActive, false);
});

// ---------------------------------------------------------------------------
// 2B - mobile button
// ---------------------------------------------------------------------------

test("the mobile button lives in the utility rail, clear of the driving controls", () => {
  const mc = read("../src/ui/MobileControls.js");

  // Built as a utility-rail tile (map / bag family), not appended to the
  // steering zone or the pedal/action cluster.
  assert.match(mc, /this\.autoLootBtnEl = this\.makeUtilButton\(\s*"loot"/);
  assert.match(
    mc,
    /this\.utilEl\.append\(\s*this\.mapBtnEl,\s*this\.inventoryBtnEl,\s*this\.autoLootBtnEl,\s*this\.pauseBtnEl/
  );
  const cluster = mc.slice(
    mc.indexOf("this.actionClusterEl.append("),
    mc.indexOf("this.pedal_clusters.append(this.actionClusterEl)")
  );

  assert.ok(
    !cluster.includes("autoLootBtnEl"),
    "Auto Loot must not sit in the handbrake/turbo/turret driving cluster"
  );
});

test("the mobile button and the F key share one toggle path", () => {
  const mc = read("../src/ui/MobileControls.js");

  assert.match(mc, /autoLootBtnEl\.addEventListener\(\s*"click",\s*\(\) => this\.input\.requestAutoLootToggle\(\)/);

  // MobileControls must not keep an Auto Loot boolean of its own.
  assert.doesNotMatch(mc, /this\.autoLootEnabled\s*=/);
  assert.doesNotMatch(mc, /this\.autoLoot\s*=\s*(true|false)/);
});

test("the mobile button is accessible and states its value without colour", () => {
  const mc = read("../src/ui/MobileControls.js");

  assert.match(mc, /setAttribute\("aria-label", "Auto loot, off"\)/);
  assert.match(mc, /setAttribute\("aria-pressed", "false"\)/);

  const setter = mc.slice(
    mc.indexOf("setAutoLootActive(active)"),
    mc.indexOf("setAutoLootActive(active)") + 900
  );

  assert.match(setter, /aria-pressed", on \? "true" : "false"/);
  assert.match(setter, /aria-label", on \? "Auto loot, on" : "Auto loot, off"/);
  assert.match(setter, /AUTO LOOT/);
  assert.match(setter, /"LOOT ON" : "LOOT"/);
  assert.match(setter, /mc-util-btn--on/);
});

test("the button is sized by the existing responsive rail rules in both orientations", () => {
  for (const file of ["../src/ui/landscape-fix.css", "../src/ui/portrait-fix.css"]) {
    const css = read(file);

    assert.ok(
      css.includes(".mc-util-btn--map, .mc-util-btn--bag, .mc-util-btn--loot"),
      `${file} must size the loot tile with the other rail tiles`
    );
  }

  // Shared touch-target floor + safe-area insets already cover .mc-util-btn.
  const layout = read("../src/ui/mobile-layout.css");
  assert.match(layout, /#mobile-controls \.mc-util-btn\b/);

  const mobile = read("../src/ui/mobile.css");
  assert.match(mobile, /\.mc-util-btn--loot \.mc-util-label/);
});
