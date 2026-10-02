// ---------------------------------------------------------------------------
// VehicleSelect.js -- start-screen "Choose your vehicle" radio cards.
//
// Markup lives in index.html (#vehicle-select, native radio inputs so
// keyboard arrows / screen readers work for free). This module only syncs
// the saved choice in and out of localStorage. Old saves / no save -> Light.
// ---------------------------------------------------------------------------
import {
  loadSelectedVehicleClass,
  saveSelectedVehicleClass,
  sanitizeVehicleClass
} from "../vehicle/VehicleConfig.js";

export class VehicleSelect {
  constructor(root, storage = globalThis.localStorage) {
    this.root = root;
    this.storage = storage;
    this.inputs = root
      ? Array.from(root.querySelectorAll('input[name="vehicle-class"]'))
      : [];
    this.value = loadSelectedVehicleClass(storage);
    this.sync();

    for (const input of this.inputs) {
      input.addEventListener("change", () => {
        if (input.checked) this.set(input.value);
      });
    }
  }

  set(value) {
    this.value = saveSelectedVehicleClass(value, this.storage);
    this.sync();
    return this.value;
  }

  sync() {
    for (const input of this.inputs) {
      const selected = input.value === this.value;
      input.checked = selected;
      input.closest("[data-vehicle-card]")?.classList.toggle("is-selected", selected);
    }
    if (this.root) this.root.dataset.selected = this.value;
  }

  getValue() {
    return sanitizeVehicleClass(this.value);
  }

  setDisabled(disabled) {
    for (const input of this.inputs) input.disabled = disabled;
    this.root?.classList.toggle("is-disabled", disabled);
  }
}
