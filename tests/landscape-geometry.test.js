import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// LANDSCAPE GEOMETRY HARNESS
// ---------------------------------------------------------------------------
// There is no browser in CI, so "does the landscape composition match the
// reference" is checked numerically instead of visually.
//
// The custom properties are PARSED OUT OF ui/landscape-fix.css rather than
// duplicated here, so the expected geometry cannot silently drift from the
// stylesheet: change a constant in section 0 and this recomputes. The anchor
// rules (which edge each group is pinned to) are asserted separately, by
// looking for the declaration text, so a reworded anchor fails loudly instead
// of quietly invalidating the maths.
//
// Reference artwork: DriveWorld_UI_Landscape_UI.pdf, authored at 1568 x 704.
// ---------------------------------------------------------------------------

const CSS = readFileSync(
  new URL("../src/ui/landscape-fix.css", import.meta.url),
  "utf8"
);

const REF_W = 1568;
const REF_H = 704;
const REM = 16;

// ---- a very small CSS value evaluator -------------------------------------
// Supports exactly what section 0 uses: calc / min / max / clamp / var, the
// four operators, and px / rem / vw / vh units.

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "");
}

function readBlock(text, selector) {
  const start = text.indexOf(selector);
  if (start < 0) throw new Error(`selector not found: ${selector}`);

  const open = text.indexOf("{", start);
  let depth = 0;

  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }

  throw new Error(`unbalanced block for ${selector}`);
}

// Splits "--a: x; --b: y;" respecting nested parentheses.
function readDeclarations(block) {
  const out = new Map();
  let depth = 0;
  let current = "";

  for (const ch of block) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;

    if (ch === ";" && depth === 0) {
      const colon = current.indexOf(":");
      if (colon > 0) {
        out.set(current.slice(0, colon).trim(), current.slice(colon + 1).trim());
      }
      current = "";
      continue;
    }

    current += ch;
  }

  return out;
}

function makeResolver(declarations, { width, height, safe = 0 }) {
  const externals = new Map([
    ["--mc-vw", `${width}px`],
    ["--mc-vh", `${height}px`],
    ["--mc-safe-t", `${safe}px`],
    ["--mc-safe-r", `${safe}px`],
    ["--mc-safe-b", `${safe}px`],
    ["--mc-safe-l", `${safe}px`]
  ]);

  const cache = new Map();

  function lookup(name) {
    if (cache.has(name)) return cache.get(name);

    const raw = declarations.get(name) ?? externals.get(name);
    if (raw === undefined) return undefined;

    const value = evaluate(raw);
    cache.set(name, value);
    return value;
  }

  function expandVars(expression) {
    let out = expression;
    let guard = 0;

    while (out.includes("var(") && guard < 50) {
      guard += 1;
      const start = out.indexOf("var(");

      let depth = 0;
      let end = start;
      for (let i = start + 3; i < out.length; i += 1) {
        if (out[i] === "(") depth += 1;
        else if (out[i] === ")") {
          depth -= 1;
          if (depth === 0) { end = i; break; }
        }
      }

      const inner = out.slice(start + 4, end);
      const comma = splitTop(inner)[0];
      const name = comma.trim();
      const fallback = splitTop(inner).slice(1).join(",").trim();

      const resolved = lookup(name);
      const replacement =
        resolved !== undefined ? `${resolved}px` : fallback || "0px";

      out = out.slice(0, start) + `(${replacement})` + out.slice(end + 1);
    }

    return out;
  }

  function splitTop(text) {
    const parts = [];
    let depth = 0;
    let current = "";

    for (const ch of text) {
      if (ch === "(") depth += 1;
      if (ch === ")") depth -= 1;

      if (ch === "," && depth === 0) {
        parts.push(current);
        current = "";
        continue;
      }
      current += ch;
    }

    parts.push(current);
    return parts;
  }

  function evaluate(expression) {
    let js = expandVars(expression);

    js = js
      .replace(/\bclamp\(/g, "__clamp(")
      .replace(/\bmin\(/g, "Math.min(")
      .replace(/\bmax\(/g, "Math.max(")
      .replace(/\bcalc\(/g, "(")
      .replace(/(-?[\d.]+)vw/g, (_, n) => `(${n} * ${width} / 100)`)
      .replace(/(-?[\d.]+)vh/g, (_, n) => `(${n} * ${height} / 100)`)
      .replace(/(-?[\d.]+)rem/g, (_, n) => `(${n} * ${REM})`)
      .replace(/(-?[\d.]+)px/g, "$1");

    // eslint-disable-next-line no-new-func
    const fn = new Function(
      "__clamp",
      `"use strict"; return (${js});`
    );

    return fn((lo, value, hi) => Math.min(Math.max(value, lo), hi));
  }

  return { get: lookup, evaluate };
}

function scaleFor(width, height, safe = 0) {
  const block = readBlock(
    stripComments(CSS),
    'body[data-mc-orientation="landscape"] {'
  );

  return makeResolver(readDeclarations(block), { width, height, safe });
}

// ---- the box model --------------------------------------------------------
// Each entry mirrors one anchor rule in landscape-fix.css. Sizes and offsets
// come from the parsed variables; only the choice of anchored edge is encoded
// here, and that choice is re-asserted textually further down.

function layout(width, height, { mode = "default", safe = 0 } = {}) {
  const s = scaleFor(width, height, safe);
  const v = name => s.get(name);
  const u = v("--lf-u");

  const et = v("--lf-et");
  const er = v("--lf-er");
  const el = v("--lf-el");

  const tileW = v("--lf-tile-w");
  const tileH = v("--lf-tile-h");
  const tileGap = v("--lf-tile-gap");

  const boxes = {};

  // --- top-right row of four, right-anchored, MENU outermost -------------
  const rowRight = width - er;
  for (let i = 0; i < 4; i += 1) {
    const right = rowRight - i * (tileW + tileGap);
    boxes[["menu", "hud", "fullscreen", "camera"][i]] = {
      x: right - tileW, y: et, w: tileW, h: tileH
    };
  }

  // --- top-left stack -----------------------------------------------------
  boxes.vitals = { x: el, y: et, w: v("--lf-vitals-w"), h: v("--lf-vitals-h") };
  boxes.players = {
    x: el,
    y: et + v("--lf-vitals-h") + 8 * u,
    w: v("--lf-pc-w"),
    h: 42 * u
  };

  // --- chat ---------------------------------------------------------------
  boxes.chatBubble = {
    x: width - er - 56 * u,
    y: et + tileH + 24 * u,
    w: 56 * u,
    h: v("--lf-bubble-h")
  };
  boxes.chat = {
    x: width - er - v("--lf-chat-w"),
    y: v("--lf-chat-top"),
    w: v("--lf-chat-w"),
    h: 258 * u
  };

  // --- bottom-left steering ----------------------------------------------
  const steer = v("--lf-steer");
  boxes.steerLeft = { x: el, y: height - 8 * u - steer, w: steer, h: steer };
  boxes.steerRight = {
    x: el + steer + v("--lf-steer-gap"),
    y: boxes.steerLeft.y,
    w: steer,
    h: steer
  };

  // --- bottom-right deck --------------------------------------------------
  const deckBottom = height - 16 * u;
  const pedW = v("--lf-ped-w");
  const gasH = v("--lf-gas-h");
  const brakeH = v("--lf-brake-h");
  const pedGap = v("--lf-ped-gap");
  const clusterGap = v("--lf-cluster-gap");
  const hbW = v("--lf-hb-w");
  const actW = v("--lf-act-w");
  const turboH = v("--lf-turbo-h");
  const turretH = v("--lf-turret-h");
  const actGap = v("--lf-act-gap");

  const pedRight = width - er;
  boxes.brake = { x: pedRight - pedW, y: deckBottom - brakeH, w: pedW, h: brakeH };
  boxes.gas = {
    x: pedRight - pedW,
    y: deckBottom - brakeH - pedGap - gasH,
    w: pedW,
    h: gasH
  };

  const actHeight = turboH + actGap + turretH;
  const actTop = deckBottom - actHeight;

  boxes.handbrake = {
    x: pedRight - pedW - clusterGap - hbW,
    y: actTop,
    w: hbW,
    h: actHeight
  };
  boxes.turbo = {
    x: boxes.handbrake.x - clusterGap - actW,
    y: actTop,
    w: actW,
    h: turboH
  };
  boxes.turret = {
    x: boxes.turbo.x,
    y: actTop + turboH + actGap,
    w: actW,
    h: turretH
  };

  // --- bottom-centre: MAP/BAG, dash, hotbar -------------------------------
  // `right: calc(50% - N)` puts the RIGHT EDGE at 50% + N.
  const utilW = v("--lf-util-w") * 2 + 10 * u;
  const utilRightEdge = width - (width / 2 - (mode === "simplified" ? 66 : 4) * u);
  const utilBottom = Math.max(
    (mode === "simplified" ? 126 : 129) * u,
    v("--lf-util-clear")
  );
  boxes.util = {
    x: utilRightEdge - utilW,
    y: height - utilBottom - v("--lf-util-h"),
    w: utilW,
    h: v("--lf-util-h")
  };

  if (mode !== "hidden") {
    const dashOffset = mode === "simplified" ? 139 : 93;
    const dashW =
      mode === "simplified" ? v("--lf-dash-simple-w") : v("--lf-dash-w");
    const dashH = mode === "simplified" ? 105 * u : v("--lf-gauge");
    const dashRightEdge = width - (width / 2 - dashOffset * u);

    boxes.dash = {
      x: dashRightEdge - dashW,
      y: height - 10 * u - dashH,
      w: dashW,
      h: dashH
    };
  }

  const slotW = v("--lf-slot-w");
  const slotH = v("--lf-slot-h");
  const slotGap = v("--lf-slot-gap");

  if (mode === "default") {
    boxes.hotbar = {
      x: width / 2 + 100 * u,
      y: height - 39 * u - slotH,
      w: slotW * 2 + slotGap,
      h: slotH
    };
  } else if (mode === "simplified") {
    const barW = v("--lf-simple-bar-w");
    const barY = height - 14 * u - slotH;

    boxes.hotbarLeft = {
      x: width / 2 - barW / 2, y: barY, w: slotW, h: slotH
    };
    boxes.hotbarRight = {
      x: width / 2 + barW / 2 - slotW, y: barY, w: slotW, h: slotH
    };
  } else {
    const barW = slotW * 2 + slotGap;
    boxes.hotbar = {
      x: width - 437 * u - barW,
      y: height - 14 * u - slotH,
      w: barW,
      h: slotH
    };
  }

  return { u, boxes };
}

// ---- reference coordinates, read off the three PDF pages -------------------

const PAGE_1 = {
  vitals: [12, 14, 329, 86],
  players: [14, 108, 241, 42],
  camera: [1173, 20, 84, 56],
  fullscreen: [1270, 20, 84, 56],
  hud: [1368, 20, 84, 56],
  menu: [1465, 20, 86, 56],
  chat: [1205, 118, 346, null],
  steerLeft: [8, 516, 180, 180],
  steerRight: [230, 516, 180, 180],
  gas: [1418, 388, 122, 145],
  brake: [1418, 546, 122, 142],
  handbrake: [1280, 546, 127, 142],
  turbo: [1144, 546, 124, 64],
  turret: [1144, 628, 124, 55],
  util: [645, 541, 143, 34],
  dash: [464, 550, 413, 144],
  hotbar: [884, 585, 215, 80]
};

const PAGE_2 = {
  dash: [643, 583, 279, 105],
  hotbarLeft: [530, 610, 100, 80],
  hotbarRight: [935, 610, 100, 80],
  util: [707, 545, 143, 34]
};

const PAGE_3 = {
  hotbar: [925, 610, 215, 80]
};

function assertNear(actual, expected, tolerance, label) {
  const [x, y, w, h] = expected;
  const deltas = {
    x: Math.abs(actual.x - x),
    y: Math.abs(actual.y - y),
    w: Math.abs(actual.w - w),
    h: Math.abs(actual.h - h)
  };

  for (const [key, delta] of Object.entries(deltas)) {
    if ({ x, y, w, h }[key] === null) continue;

    assert.ok(
      delta <= tolerance,
      `${label}.${key} is ${Math.round(actual[key])}, reference ${
        { x, y, w, h }[key]
      } (off by ${Math.round(delta)}, tolerance ${tolerance})`
    );
  }
}

// ---- tests ----------------------------------------------------------------

test("page 1 geometry matches the reference at 1568 x 704", () => {
  const { u, boxes } = layout(REF_W, REF_H);

  assert.equal(Math.round(u * 1000) / 1000, 1, "one reference px per unit");

  for (const [name, expected] of Object.entries(PAGE_1)) {
    assertNear(boxes[name], expected, 13, name);
  }
});

test("page 2 (SIMPLIFIED) geometry matches the reference", () => {
  const { boxes } = layout(REF_W, REF_H, { mode: "simplified" });

  for (const [name, expected] of Object.entries(PAGE_2)) {
    assertNear(boxes[name], expected, 13, name);
  }
});

test("page 3 (HIDE ALL) hotbar sits inboard of the action cluster", () => {
  const { boxes } = layout(REF_W, REF_H, { mode: "hidden" });

  assertNear(boxes.hotbar, PAGE_3.hotbar, 13, "hotbar");
  assert.equal(boxes.dash, undefined, "the dash is not drawn in HIDE ALL");

  // The whole point of the inboard move: it must clear TURBO/TURRET.
  assert.ok(
    boxes.hotbar.x + boxes.hotbar.w <= boxes.turbo.x,
    "hotbar must not reach the action cluster"
  );
});

// Every aspect ratio the brief names, plus a genuinely small landscape phone.
const VIEWPORTS = [
  { label: "16:9  (1136 x 640)", w: 1136, h: 640 },
  { label: "18:9  (1280 x 640)", w: 1280, h: 640 },
  { label: "19.5:9 (1560 x 720)", w: 1560, h: 720 },
  { label: "20:9  (1600 x 720)", w: 1600, h: 720 },
  { label: "small (568 x 320)", w: 568, h: 320 },
  { label: "tablet (2048 x 1536)", w: 2048, h: 1536 }
];

function overlaps(a, b) {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

// Pairs the artwork itself draws adjacent or deliberately overlapping.
// `dash|util`   - MAP/BAG sit over the dash's empty upper-left quadrant, as
//                 drawn; the info card itself starts lower than the box model.
// `chat|chatBubble` - #chat-show carries [hidden] whenever #chat-panel is on
//                 screen, so the two are never visible at the same time.
const ALLOWED = new Set([
  "dash|util",
  "steerLeft|steerRight",
  "chat|chatBubble"
]);

test("no region overlaps another, at any tested aspect ratio or HUD mode", () => {
  for (const { label, w, h } of VIEWPORTS) {
    for (const mode of ["default", "simplified", "hidden"]) {
      const { boxes } = layout(w, h, { mode });
      const names = Object.keys(boxes);

      for (let i = 0; i < names.length; i += 1) {
        for (let j = i + 1; j < names.length; j += 1) {
          const key = [names[i], names[j]].sort().join("|");
          if (ALLOWED.has(key)) continue;

          assert.ok(
            !overlaps(boxes[names[i]], boxes[names[j]]),
            `${label} / ${mode}: ${names[i]} overlaps ${names[j]}`
          );
        }
      }
    }
  }
});

test("every region stays inside the viewport, safe area included", () => {
  for (const { label, w, h } of VIEWPORTS) {
    for (const safe of [0, 44]) {
      const { boxes } = layout(w, h, { safe });

      for (const [name, box] of Object.entries(boxes)) {
        assert.ok(box.x >= -1, `${label} safe:${safe}: ${name} off the left edge`);
        assert.ok(box.y >= -1, `${label} safe:${safe}: ${name} off the top edge`);
        assert.ok(
          box.x + box.w <= w + 1,
          `${label} safe:${safe}: ${name} off the right edge`
        );
        assert.ok(
          box.y + box.h <= h + 1,
          `${label} safe:${safe}: ${name} off the bottom edge`
        );
      }
    }
  }
});

test("every touch target keeps a 44px minimum on its shortest side", () => {
  const TOUCH = [
    "camera", "fullscreen", "hud", "menu",
    "steerLeft", "steerRight",
    "gas", "brake", "handbrake", "turbo", "turret",
    "util"
  ];

  for (const { label, w, h } of VIEWPORTS) {
    const { boxes } = layout(w, h);

    for (const name of TOUCH) {
      const box = boxes[name];
      assert.ok(
        Math.min(box.w, box.h) >= 44 - 0.5,
        `${label}: ${name} is ${Math.round(Math.min(box.w, box.h))}px on its shortest side`
      );
    }
  }
});

test("the anchor declarations the box model assumes are still present", () => {
  const expected = [
    // the group each composition is pinned to
    "right: var(--lf-er);",
    "left: var(--lf-el);",
    "right: var(--lf-util-right);",
    "left: calc(50% + 100 * var(--lf-u));",
    "right: calc(50% - 93 * var(--lf-u)) !important;",
    "right: calc(50% - 139 * var(--lf-u)) !important;",
    "right: calc(437 * var(--lf-u));",
    // MENU pinned into the fourth cell of the top row
    "grid-template-columns: repeat(4, var(--lf-tile-w));"
  ];

  for (const declaration of expected) {
    assert.ok(
      CSS.includes(declaration),
      `anchor rule missing or reworded: ${declaration}`
    );
  }
});

test("the scale is capped and tracks the scarcer axis", () => {
  // The reference is 1568 / 704 = 2.227 wide. A viewport NARROWER than that
  // is width-limited; a wider one is height-limited. 16:9 (1.78) is narrower,
  // which is exactly why the tap-target floors matter there.
  const narrow = scaleFor(1136, 640).get("--lf-u");
  const wide = scaleFor(1800, 720).get("--lf-u");

  assert.ok(
    Math.abs(narrow - 1136 / 1568) < 0.001,
    "16:9 is narrower than the reference, so width is the scarcer axis"
  );
  assert.ok(
    Math.abs(wide - 720 / 704) < 0.001,
    "2.5:1 is wider than the reference, so height is the scarcer axis"
  );

  // Cap holds on a large tablet.
  assert.equal(scaleFor(2732, 2048).get("--lf-u"), 1.25);
});

test("the chat ceiling clears the GAS pedal at every tested viewport", () => {
  for (const { label, w, h } of VIEWPORTS) {
    const { boxes } = layout(w, h);

    assert.ok(
      boxes.chat.y + boxes.chat.h <= boxes.gas.y,
      `${label}: the chat ceiling reaches the GAS pedal`
    );
  }
});
