// ---------------------------------------------------------------------------
// AUTO LOOT
// ---------------------------------------------------------------------------
// One tiny, DOM-free holder for the Auto Loot setting plus the sweep that
// turns it into pickups.
//
// It deliberately owns NO pickup logic of its own. The sweep is handed the
// exact same "nearest eligible drop" probe the InteractionSystem provider
// uses and the exact same collect() entry point (Game.collectDrop), so Auto
// Loot can never become a second pickup pipeline that bypasses cargo limits,
// pendingPickups, or server authority.
//
// Keeping the state here (rather than in InputManager or in a UI widget) is
// what lets the F key, the mobile button and both status readouts share one
// source of truth.
// ---------------------------------------------------------------------------

export class AutoLootController {
  constructor({ enabled = false, onChange = null } = {}) {
    this.enabled = enabled === true;
    this.onChange = onChange;
  }

  // Idempotent: setting the value it already has fires no change callback,
  // so UI updates only happen on real transitions.
  setEnabled(enabled) {
    const next = enabled === true;

    if (next === this.enabled) return this.enabled;

    this.enabled = next;
    this.onChange?.(this.enabled);

    return this.enabled;
  }

  toggle() {
    return this.setEnabled(!this.enabled);
  }

  // Runs a single collection sweep.
  //
  // `findCandidate()` must return an eligible drop or null -- eligibility
  // (range, availability, in-flight pendingPickups) stays owned by the
  // caller's existing probe. `collect(drop)` must be the existing
  // server-authoritative pickup entry point; a falsy return means the
  // pickup was refused (cargo full, request already in flight, denied),
  // and nothing is retried here this sweep.
  //
  // Returns true only when a pickup was actually started.
  update({ findCandidate, collect } = {}) {
    if (!this.enabled) return false;
    if (typeof findCandidate !== "function" || typeof collect !== "function") {
      return false;
    }

    const drop = findCandidate();
    if (!drop) return false;

    return collect(drop) === true;
  }
}
