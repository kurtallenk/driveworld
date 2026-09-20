// ---------------------------------------------------------------------------
// INTERACTION SYSTEM
// ---------------------------------------------------------------------------
// One consistent "you can interact with this" contract for the whole game.
//
// Providers register a `probe(position)` function that returns either null
// or { label, verb, activate() }. The system picks the nearest available
// one, drives a single reusable DOM prompt (desktop) and the mobile
// interact button (MobileControls.setInteraction), and routes E / tap to
// the active target.
//
// Performance: the prompt element is created once and only written to when
// the target or its label actually changes -- no per-frame DOM churn. The
// update() call is driven from Game.js's throttled 100ms HUD tick.
// ---------------------------------------------------------------------------

export class InteractionSystem {
  constructor(promptElement, { mobileControls = null } = {}) {
    this.promptEl = promptElement;
    this.labelEl = promptElement?.querySelector("#interaction-label") ?? null;
    this.keyEl = promptElement?.querySelector("#interaction-key") ?? null;

    this.mobileControls = mobileControls;

    this.providers = [];
    this.current = null;
    this._renderedLabel = null;
    this._touchMode = false;
  }

  register(probe) {
    if (typeof probe === "function") this.providers.push(probe);
  }

  // Mirrors how the rest of the UI switches between desktop and touch
  // affordances (MobileControls.setActive).
  setTouchMode(enabled) {
    this._touchMode = Boolean(enabled);
    this._renderedLabel = null;
  }

  update(position) {
    if (!position) return;

    let best = null;
    let bestDistance = Infinity;

    for (const probe of this.providers) {
      const candidate = probe(position);
      if (!candidate) continue;

      const distance = Number.isFinite(candidate.distance)
        ? candidate.distance
        : 0;

      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }

    this.current = best;
    this.render();
  }

  // Immediately drops the active target and hides both affordances, without
  // waiting for the next throttled update(). Called whenever the thing the
  // player was standing next to stops being collectable -- consumed
  // locally, awarded to somebody else, or removed by the server -- so a
  // stale "E PICK UP BATTERY" prompt can never survive the item.
  clear() {
    this.current = null;
    this._renderedLabel = null;

    if (this.promptEl) this.promptEl.hidden = true;

    this.mobileControls?.setInteraction(false);
  }

  render() {
    const label = this.current
      ? `${this.current.verb ?? "PICK UP"}  ${this.current.label ?? ""}`.trim()
      : null;

    // Skip all DOM work when nothing changed.
    if (label === this._renderedLabel) return;
    this._renderedLabel = label;

    if (this.promptEl) {
      this.promptEl.hidden = !label || this._touchMode;

      if (label && this.labelEl) this.labelEl.textContent = label;
      if (this.keyEl) this.keyEl.textContent = "E";
    }

    this.mobileControls?.setInteraction(
      Boolean(label),
      label ? `TAP TO ${label}` : "TAP TO PICK UP"
    );
  }

  // Called by the E key and the mobile interact button.
  activate() {
    const target = this.current;

    if (!target?.activate) return false;

    // Cleared BEFORE the activation runs. The target is either consumed or
    // has an in-flight server request against it either way, so it must
    // stop being offered immediately -- and clearing first means an
    // activate() that synchronously re-renders (e.g. a pickup rejection
    // notice) can't resurrect the old prompt.
    this.clear();

    const result = target.activate();

    return result !== false;
  }
}
