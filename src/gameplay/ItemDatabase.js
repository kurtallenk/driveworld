// ---------------------------------------------------------------------------
// ITEM DATABASE
// ---------------------------------------------------------------------------
// Single source of truth for every lootable item: identity, presentation,
// drop weighting and effect.
//
// Effects are declarative (`effect: { type, amount }`) and are resolved in
// exactly one place -- InventorySystem.useItem(), which is handed a small
// context object by Game.js. Nothing in Game.js branches on item ids, so
// adding an item means adding a row here, not editing gameplay code.
//
// Rarity is purely a presentation/weighting concept; it maps onto the
// --dw-rar-* colour tokens already defined in ui/theme.css.
//
// IMPORTANT -- `rarity` vs `collectible`:
//   `rarity` is cosmetic only (it picks a colour token). It does NOT mean
//   an item survives loot cleanup: SALVAGED DATA CORE is rarity RARE but
//   is still ordinary loot that despawns normally.
//   Despawn immunity is driven exclusively by the explicit `neverDespawn`
//   flag, and "is this a rare collectible?" by the explicit `collectible`
//   flag. Nothing in the loot pipeline is allowed to decide either of
//   those from an item's display name or its rarity colour.
// ---------------------------------------------------------------------------

export const RARITY = {
  COMMON: "common",
  UNCOMMON: "uncommon",
  RARE: "rare",
  EPIC: "epic"
};

export const RARITY_COLOR = {
  [RARITY.COMMON]: "#b9c2cc",
  [RARITY.UNCOMMON]: "#4be3a0",
  [RARITY.RARE]: "#48d5ff",
  [RARITY.EPIC]: "#c07aff"
};

// ---------------------------------------------------------------------------
// LOOT CONFIG -- the single tuning surface for drop rates and lifetimes.
// ---------------------------------------------------------------------------
// Imported by BOTH the authoritative server (server/LootWorld.js) and the
// client renderer / offline fallback (gameplay/LootSystem.js), so the two
// can never drift apart. Change a number here and both sides follow.
// ---------------------------------------------------------------------------
export const LOOT_CONFIG = {
  // Chance that killing an ORDINARY enemy drops anything at all.
  // Lowered from the original 0.38 so ordinary salvage is a genuine event
  // rather than a near-guaranteed reward on every kill.
  normalDropChance: 0.16,

  // Boss kills roll this many ordinary drops, unconditionally. Left at the
  // original value on purpose: boss rewards are explicitly preserved.
  bossDropRolls: 3,

  // Lifetime for ordinary drops, in seconds, unless an item overrides it
  // with its own `despawnSeconds`. Items flagged `neverDespawn` ignore
  // this entirely.
  defaultDespawnSeconds: 90,

  // How long the ground glow fades out for, as an expiry warning.
  despawnWarningSeconds: 10,

  // Upper bounds on simultaneously-active pickups. Rare collectibles are
  // never chosen as the recycling victim when these caps are hit.
  maxActivePickups: 48,
  maxActiveDrops: 24,

  // The rare collectible awarded for a boss kill, exactly once per boss
  // death. Data-driven so the boss reward can be changed or disabled
  // (set to null) without touching the drop pipeline on either side.
  bossCollectibleId: "golden-arachnid-eye"
};

export const ITEMS = {
  "portable-battery": {
    id: "portable-battery",
    name: "PORTABLE BATTERY",
    short: "BATTERY",
    description:
      "Field charge pack. Restores 25% vehicle battery anywhere \u2014 no charging station required.",
    icon: "\u26a1",
    rarity: RARITY.UNCOMMON,
    type: "consumable",

    // Weight inside the drop table (see LootSystem). The headline item, so
    // it is the most common meaningful drop.
    dropWeight: 42,

    maxStack: 5,

    // World-model builder used by gameplay/ItemModels.js. Data-driven so
    // adding an item never means editing the renderer's switch by hand.
    model: "battery",

    // Ordinary loot: despawns on the normal timer, not a rare collectible.
    neverDespawn: false,
    collectible: false,

    // Resolved by InventorySystem.useItem(). The amount is expressed as a
    // percentage of BATTERY_CONFIG.maxBattery, which is what the existing
    // BatterySystem already works in -- this does NOT introduce a second
    // battery currency.
    effect: { type: "battery", amount: 25 }
  },

  "medkit": {
    id: "medkit",
    name: "FIELD MEDKIT",
    short: "MEDKIT",
    description: "Stabilises the driver. Restores 40 player health.",
    icon: "\u2695",
    rarity: RARITY.COMMON,
    type: "consumable",
    dropWeight: 40,
    maxStack: 5,
    model: "medkit",
    neverDespawn: false,
    collectible: false,
    effect: { type: "playerHeal", amount: 40 }
  },

  "data-core": {
    id: "data-core",
    name: "SALVAGED DATA CORE",
    short: "CORE",
    description:
      "Intact enemy processor. Decrypting it yields 150 XP toward your next evolution.",
    icon: "\u25c8",
    rarity: RARITY.RARE,
    type: "consumable",
    dropWeight: 6,
    maxStack: 3,
    // Rarity RARE is a colour, not a lifetime: this is ordinary loot and
    // despawns like everything else.
    model: "core",
    neverDespawn: false,
    collectible: false,
    effect: { type: "xp", amount: 150 }
  },

  // -------------------------------------------------------------------------
  // RARE COLLECTIBLE -- boss drop only.
  // -------------------------------------------------------------------------
  // `dropWeight: 0` keeps it out of rollItem() entirely, so it can never
  // appear in an ordinary drop no matter how the weights are retuned. It
  // is spawned explicitly, once per boss death, by LootWorld.dropFromEnemy
  // (multiplayer) and LootSystem.dropFrom (offline).
  //
  // It has no `effect`: it is a trophy, not a consumable, so the Cargo
  // panel shows it as KEPT instead of offering a USE button that would do
  // nothing.
  // -------------------------------------------------------------------------
  "golden-arachnid-eye": {
    id: "golden-arachnid-eye",
    name: "GOLDEN ARACHNID EYE",
    short: "EYE",
    description:
      "Trophy prised from a fallen arachnid boss. Gilded, warm to the touch, and still faintly watching.",
    icon: "\u25c9",
    rarity: RARITY.EPIC,
    type: "collectible",

    dropWeight: 0,
    maxStack: 99,

    model: "arachnid-eye",

    // Rarity EPIC is a purple UI token; the world model and its ground
    // glow are gold. `worldColor` keeps the two independent.
    worldColor: "#ffc44a",

    // Slower, statelier spin than ordinary salvage.
    spinRate: 0.55,

    neverDespawn: true,
    collectible: true
  }
};

export function getItem(id) {
  return ITEMS[id] ?? null;
}

export function itemColor(id) {
  const item = getItem(id);
  return item ? RARITY_COLOR[item.rarity] : RARITY_COLOR[RARITY.COMMON];
}

// Colour used for the item's WORLD presentation (model tint and ground
// glow). Defaults to the rarity colour, so existing items are unaffected,
// but an item can override it -- the Golden Arachnid Eye is rarity EPIC
// (purple in the UI) yet must read as gold in the world.
export function worldColor(id) {
  return getItem(id)?.worldColor ?? itemColor(id);
}

// How fast a drop spins in the world, as a multiplier on the base rate.
export function spinRateFor(id) {
  const rate = getItem(id)?.spinRate;
  return Number.isFinite(rate) && rate > 0 ? rate : 1;
}

// ---------------------------------------------------------------------------
// LIFETIME / CLASSIFICATION HELPERS
// ---------------------------------------------------------------------------
// The ONLY sanctioned way for the loot pipeline to ask "is this ordinary
// loot?". Both the server and the client call these, so a rare collectible
// can never be swept up by one side's cleanup while surviving on the
// other. Deliberately flag-driven -- never name-driven.
// ---------------------------------------------------------------------------

// True for a rare collectible (the Golden Arachnid Eye and anything added
// like it), false for ordinary salvage.
export function isCollectible(id) {
  return getItem(id)?.collectible === true;
}

// True when the item must survive the ordinary despawn sweep and the
// active-pickup recycling pass. `collectible` implies immunity as a safety
// net, so a new collectible cannot be silently swept by forgetting a flag.
export function neverDespawns(id) {
  const item = getItem(id);
  if (!item) return false;

  return item.neverDespawn === true || item.collectible === true;
}

// Lifetime in seconds for one item, or Infinity when it never despawns.
// Callers should compare against this rather than a local constant.
export function despawnSecondsFor(id) {
  if (neverDespawns(id)) return Infinity;

  const item = getItem(id);
  const override = item?.despawnSeconds;

  return Number.isFinite(override) && override > 0
    ? override
    : LOOT_CONFIG.defaultDespawnSeconds;
}

// Weighted pick across every droppable item. `random` is injected so the
// caller can supply the game's existing deterministic PRNG instead of
// Math.random.
export function rollItem(random = Math.random) {
  const entries = Object.values(ITEMS).filter(item => item.dropWeight > 0);
  const total = entries.reduce((sum, item) => sum + item.dropWeight, 0);

  let roll = random() * total;

  for (const item of entries) {
    roll -= item.dropWeight;
    if (roll <= 0) return item;
  }

  return entries[entries.length - 1] ?? null;
}
