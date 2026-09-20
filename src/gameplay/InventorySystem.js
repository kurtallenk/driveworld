import { getItem, itemColor } from "./ItemDatabase.js";

// ---------------------------------------------------------------------------
// INVENTORY
// ---------------------------------------------------------------------------
// Deliberately small: this is a driving game, not an RPG. A flat stack map
// (itemId -> quantity), a compact panel, and one "use" action per row.
//
// The panel DOM is built once in the constructor and then only mutated
// when the inventory actually changes -- nothing here touches the DOM per
// frame.
//
// Item effects are resolved here, in one switch, driven by the declarative
// `effect` field from ItemDatabase. Game.js supplies a context object with
// the systems an effect may touch, so this module never imports gameplay
// systems directly and Game.js never branches on item ids.
// ---------------------------------------------------------------------------

export class InventorySystem {
  constructor(panelElement, { onNotice = null, onUsed = null } = {}) {
    this.panel = panelElement;
    this.listEl = panelElement?.querySelector("#inventory-list") ?? null;
    this.emptyEl = panelElement?.querySelector("#inventory-empty") ?? null;

    this.stacks = new Map();
    this.open = false;

    this.onNotice = onNotice;
    this.onUsed = onUsed;

    // Views that follow the inventory (currently the item hotbar). They
    // never store their own quantities -- they re-read this map, so the
    // Cargo panel and the hotbar can never disagree.
    this.changeListeners = new Set();

    // Context assigned by Game.js: { battery, vehicleDestruction,
    // playerHealth, levelSystem }. Kept as a plain object so the inventory
    // stays decoupled from Game.js's internals.
    this.context = {};

    panelElement
      ?.querySelector("#inventory-close")
      ?.addEventListener("click", () => this.setOpen(false));

    // Event delegation: one listener for the whole list, so adding and
    // removing rows never adds or leaks listeners.
    this.listEl?.addEventListener("click", event => {
      const button = event.target.closest("[data-item-id]");
      if (button) this.useItem(button.dataset.itemId);
    });
  }

  addChangeListener(listener) {
    if (typeof listener !== "function") return () => {};

    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  count(id) {
    return this.stacks.get(id) ?? 0;
  }

  get totalCount() {
    let total = 0;
    for (const quantity of this.stacks.values()) total += quantity;
    return total;
  }

  // Returns the number actually added (0 when the stack is already full),
  // so callers can tell the player their pack is full instead of silently
  // deleting the pickup.
  add(id, quantity = 1) {
    const item = getItem(id);
    if (!item) return 0;

    const current = this.count(id);
    const max = item.maxStack ?? 99;
    const added = Math.max(0, Math.min(quantity, max - current));

    if (added > 0) {
      this.stacks.set(id, current + added);
      this.render();
    }

    return added;
  }

  remove(id, quantity = 1) {
    const current = this.count(id);
    if (current <= 0) return false;

    const next = current - quantity;

    if (next > 0) this.stacks.set(id, next);
    else this.stacks.delete(id);

    this.render();
    return true;
  }

  // -------------------------------------------------------------------
  // EFFECTS
  // -------------------------------------------------------------------
  useItem(id) {
    const item = getItem(id);
    if (!item || this.count(id) <= 0) return false;

    const { battery, playerHealth, levelSystem } = this.context;

    const effect = item.effect ?? {};
    let applied = false;
    let message = "";

    switch (effect.type) {
      case "battery": {
        // Routed through the EXISTING BatterySystem (addCharge), which
        // owns the cap and the state-change notifications. The portable
        // battery is a new source of charge, not a second battery model.
        if (!battery) break;

        const gained = battery.addCharge(effect.amount);

        if (gained <= 0) {
          this.onNotice?.("BATTERY ALREADY FULL", 1.5);
          return false;
        }

        applied = true;
        message = `+${Math.round(gained)}% BATTERY`;
        break;
      }

      case "playerHeal": {
        if (!playerHealth?.heal) break;

        // PlayerHealth exposes `health` / `maxHealth` and returns the
        // amount actually restored from heal().
        const restored = playerHealth.heal(effect.amount);

        if (!restored || restored <= 0) {
          this.onNotice?.("HEALTH ALREADY FULL", 1.5);
          return false;
        }

        applied = true;
        message = `+${Math.round(restored)} HP`;
        break;
      }

      case "xp": {
        if (!levelSystem?.addXP) break;

        levelSystem.addXP(effect.amount);
        applied = true;
        message = `+${effect.amount} XP`;
        break;
      }

      default:
        break;
    }

    if (!applied) return false;

    this.remove(id, 1);
    this.onNotice?.(message, 2);
    this.onUsed?.(item);

    return true;
  }

  // -------------------------------------------------------------------
  // PANEL
  // -------------------------------------------------------------------
  setOpen(open) {
    this.open = Boolean(open);

    if (this.panel) this.panel.hidden = !this.open;
    if (this.open) this.render();

    return this.open;
  }

  toggle() {
    return this.setOpen(!this.open);
  }

  render() {
    // Fired on every change even when the Cargo panel has no DOM to
    // update, so the hotbar stays in sync while the panel is closed.
    for (const listener of this.changeListeners) listener(this);

    if (!this.listEl) return;

    // Only rebuilt on change (pickup/use/open), never on a timer.
    this.listEl.textContent = "";

    const ids = [...this.stacks.keys()];

    if (this.emptyEl) this.emptyEl.hidden = ids.length > 0;

    for (const id of ids) {
      const item = getItem(id);
      if (!item) continue;

      const row = document.createElement("li");
      row.className = "inv-row";
      row.dataset.rarity = item.rarity;

      const icon = document.createElement("span");
      icon.className = "inv-icon";
      icon.textContent = item.icon;
      icon.style.color = itemColor(id);

      const text = document.createElement("span");
      text.className = "inv-text";

      const name = document.createElement("span");
      name.className = "inv-name";
      name.textContent = item.name;

      const description = document.createElement("span");
      description.className = "inv-desc";
      description.textContent = item.description;

      text.append(name, description);

      const quantity = document.createElement("span");
      quantity.className = "inv-qty";
      quantity.textContent = `x${this.count(id)}`;

      // A rare collectible is a trophy, not a consumable: it has no
      // `effect`, so offering USE would present a button that silently
      // does nothing. It is shown as KEPT instead. Driven by the item's
      // `collectible` flag, never by its name.
      let action;

      if (item.collectible) {
        action = document.createElement("span");
        action.className = "inv-use inv-kept";
        action.textContent = "KEPT";
      } else {
        action = document.createElement("button");
        action.type = "button";
        action.className = "inv-use";
        action.dataset.itemId = id;
        action.textContent = "USE";
      }

      row.append(icon, text, quantity, action);
      this.listEl.append(row);
    }
  }
}
