import { getItem, itemColor } from "../gameplay/ItemDatabase.js";

// ---------------------------------------------------------------------------
// ITEM HOTBAR
// ---------------------------------------------------------------------------
// A deliberately tiny consumable bar for the two items a driver actually
// needs mid-fight: the medkit and the portable battery. This is a driving
// game, so it is two slots -- not an RPG action bar.
//
// IMPORTANT: this is a VIEW ONLY. It stores no quantities of its own. Every
// count is read live from the one existing InventorySystem, and every use is
// routed straight through InventorySystem.useItem(), which is where the
// existing BatterySystem / PlayerHealth effects are already resolved. That
// makes it impossible for the hotbar and the Cargo panel to disagree, and no
// second health or battery mechanic is introduced.
// ---------------------------------------------------------------------------

// Order matters: these are the slots, left to right.
const SLOT_ITEM_IDS = ["medkit", "portable-battery"];

// Digit hotkeys, matching the slot order.
const SLOT_KEYS = ["Digit1", "Digit2"];

export class ItemHotbar {
  constructor(inventory, { container = document.body, onNotice = null } = {}) {
    this.inventory = inventory;
    this.onNotice = onNotice;

    this.slots = [];

    this.root = document.createElement("div");
    this.root.id = "item-hotbar";
    this.root.className = "hotbar";
    this.root.setAttribute("aria-label", "Consumable hotbar");

    SLOT_ITEM_IDS.forEach((itemId, index) => {
      const item = getItem(itemId);
      if (!item) return;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "hotbar-slot";
      button.dataset.itemId = itemId;
      button.dataset.rarity = item.rarity;
      button.title = item.name + " - " + item.description;

      const key = document.createElement("span");
      key.className = "hotbar-key";
      key.textContent = String(index + 1);

      const icon = document.createElement("span");
      icon.className = "hotbar-icon";
      icon.textContent = item.icon;
      icon.style.color = itemColor(itemId);

      const name = document.createElement("span");
      name.className = "hotbar-name";
      name.textContent = item.short ?? item.name;

      const quantity = document.createElement("span");
      quantity.className = "hotbar-qty";
      quantity.textContent = "x0";

      button.append(key, icon, name, quantity);
      this.root.append(button);

      this.slots.push({ itemId, button, quantityEl: quantity });
    });

    // One delegated listener for the whole bar.
    this.root.addEventListener("click", event => {
      const button = event.target.closest("[data-item-id]");
      if (button) this.use(button.dataset.itemId);
    });

    // Same instant pressed feedback the mobile driving controls use.
    this.root.addEventListener("pointerdown", event => {
      const button = event.target.closest(".hotbar-slot");
      if (button) button.classList.add("hotbar-slot--pressed");
    });

    const clearPressed = () => {
      for (const slot of this.slots) {
        slot.button.classList.remove("hotbar-slot--pressed");
      }
    };

    this.root.addEventListener("pointerup", clearPressed);
    this.root.addEventListener("pointercancel", clearPressed);
    this.root.addEventListener("pointerleave", clearPressed);

    container.append(this.root);

    // The inventory is the single source of truth, so the bar simply
    // re-reads it whenever it changes.
    this.inventory?.addChangeListener?.(() => this.render());

    this.render();
  }

  // Keyboard 1/2, wired up in Game.js next to the existing I/M/E handlers.
  handleKey(code) {
    const index = SLOT_KEYS.indexOf(code);
    if (index === -1) return false;

    const slot = this.slots[index];
    if (!slot) return false;

    this.use(slot.itemId);
    return true;
  }

  use(itemId) {
    if (!itemId) return false;

    if ((this.inventory?.count?.(itemId) ?? 0) <= 0) {
      const item = getItem(itemId);
      this.onNotice?.("NO " + (item?.short ?? "ITEM") + " IN CARGO", 1.4);
      return false;
    }

    // Effects (battery charge / player heal) are resolved by the existing
    // InventorySystem, never here.
    return this.inventory.useItem(itemId);
  }

  // Re-reads live quantities. Only called on inventory change, never per frame.
  render() {
    for (const slot of this.slots) {
      const count = this.inventory?.count?.(slot.itemId) ?? 0;

      slot.quantityEl.textContent = "x" + count;

      // Empty slots stay visible (so the player knows the bar exists) but
      // are visibly and functionally unavailable.
      const empty = count <= 0;

      slot.button.disabled = empty;
      slot.button.classList.toggle("hotbar-slot--empty", empty);
    }
  }

  setVisible(visible) {
    this.root.hidden = !visible;
  }

  dispose() {
    this.root.remove();
  }
}
