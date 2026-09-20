// ---------------------------------------------------------------------------
// KEYBOARD PANEL COLLAPSE CONTROL
// ---------------------------------------------------------------------------
// Adds the minimise/restore affordance to the EXISTING #keyboard-panel that
// index.html already ships. This module does not own the panel's contents or
// its mode switching (Game.js still sets data-mode); it only owns collapsed
// state, the header button, and persisting the player's choice.
//
// ---------------------------------------------------------------------------
// WHY THERE IS A BODY WRAPPER
// ---------------------------------------------------------------------------
// The browser used to warn:
//
//   Blocked aria-hidden on an element because its descendant retained focus.
//
// ...because collapsing put aria-hidden="true" on #keyboard-panel while
// .kbd-panel-toggle -- a focusable descendant that had just been clicked --
// still held focus. Hiding the whole panel is also wrong on its own terms:
// the toggle has to stay reachable, or a keyboard user who collapses the
// panel can never reopen it.
//
// So the collapsible REGION and the always-available HEADER are now different
// elements. The panel's original children are wrapped once in
// .kbd-panel-body (#keyboard-panel-body); the title row, and therefore the
// toggle, stay outside it. Collapsing applies inert + aria-hidden to that
// wrapper only. #keyboard-panel itself is never aria-hidden, so the header
// and its button remain exposed to assistive technology and operable.
//
// Focus is relocated to the toggle BEFORE either attribute is applied, which
// is what actually clears the warning -- no timeout is involved, and no
// accessibility attribute is dropped to silence the browser.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "driveworld.keyboardPanel.collapsed";
const BODY_ID = "keyboard-panel-body";

export class KeyboardPanelControls {
  constructor(panelElement) {
    this.panel = panelElement ?? null;
    this.collapsed = false;

    if (!this.panel) return;

    this.titleEl = this.panel.querySelector(".kbd-panel-title");

    // index.html ships the panel with a static aria-hidden="true". Nothing
    // ever cleared it, so once the panel was on screen it was still being
    // announced as hidden. Visibility is carried by the `hidden` attribute
    // (Game.js owns that), so the redundant attribute is dropped here and
    // aria-hidden from now on means exactly one thing: "this region is
    // collapsed".
    this.panel.removeAttribute("aria-hidden");

    this.body = this.buildBody();

    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "kbd-panel-toggle";
    this.button.setAttribute("aria-controls", this.body?.id || BODY_ID);

    this.button.addEventListener("click", event => {
      event.stopPropagation();
      this.toggle();
    });

    if (this.titleEl) {
      this.titleEl.classList.add("kbd-panel-title--row");
      this.titleEl.append(this.button);
    } else {
      this.panel.prepend(this.button);
    }

    // While collapsed the whole header is clickable, so the panel is always
    // restorable even though only a slim bar is left on screen.
    this.titleEl?.addEventListener("click", () => {
      if (this.collapsed) this.setCollapsed(false);
    });

    this.setCollapsed(this.readStoredState(), { persist: false });
  }

  // Wraps everything that is NOT the title row in one collapsible region, so
  // inert/aria-hidden have a target that excludes the toggle. Idempotent: if
  // a wrapper is already present (hot reload, double construction) it is
  // reused rather than nested.
  buildBody() {
    if (!this.panel) return null;

    const existing = this.panel.querySelector("#" + BODY_ID);
    if (existing) return existing;

    const body = document.createElement("div");
    body.id = BODY_ID;
    body.className = "kbd-panel-body";

    const movable = Array.from(this.panel.childNodes).filter(
      node => node !== this.titleEl
    );

    for (const node of movable) body.append(node);

    this.panel.append(body);

    return body;
  }

  readStoredState() {
    try {
      return window.localStorage?.getItem(STORAGE_KEY) === "1";
    } catch {
      // Private browsing / blocked storage: default to expanded.
      return false;
    }
  }

  storeState(collapsed) {
    try {
      window.localStorage?.setItem(STORAGE_KEY, collapsed ? "1" : "0");
    } catch {
      // Non-fatal: the panel still works, it just will not be remembered.
    }
  }

  // Moves focus out of the region that is about to be hidden. Returns true if
  // it had to act, which the tests assert on. Called BEFORE aria-hidden or
  // inert are applied -- the ordering is the fix, not a side effect of it.
  releaseFocusFromBody() {
    if (!this.body) return false;

    const active =
      typeof document !== "undefined" ? document.activeElement : null;

    if (!active || !this.body.contains(active)) return false;

    // The toggle is the right landing place: it is the control that undoes
    // what just happened, and it is guaranteed to still be reachable.
    this.button?.focus?.({ preventScroll: true });

    // If focusing the button was not possible for any reason, make sure focus
    // does not simply stay inside the hidden region.
    if (document.activeElement && this.body.contains(document.activeElement)) {
      document.activeElement.blur?.();
    }

    return true;
  }

  setCollapsed(collapsed, { persist = true } = {}) {
    if (!this.panel) return false;

    this.collapsed = Boolean(collapsed);

    // Order matters: focus first, then hide.
    if (this.collapsed) this.releaseFocusFromBody();

    this.panel.classList.toggle("kbd-panel--collapsed", this.collapsed);
    this.panel.dataset.collapsed = this.collapsed ? "true" : "false";

    if (this.body) {
      if (this.collapsed) {
        // inert also removes the region from the tab order, which aria-hidden
        // alone does not do; both together keep the visual, focus and
        // assistive-technology states saying the same thing.
        this.body.setAttribute("aria-hidden", "true");
        this.body.inert = true;
      } else {
        this.body.removeAttribute("aria-hidden");
        this.body.inert = false;
      }
    }

    if (this.button) {
      // Minus when open, plus when collapsed.
      this.button.textContent = this.collapsed ? "+" : "\u2212";
      this.button.setAttribute("aria-expanded", this.collapsed ? "false" : "true");
      this.button.setAttribute(
        "aria-label",
        this.collapsed ? "Show keyboard controls" : "Minimise keyboard controls"
      );
      this.button.title = this.collapsed
        ? "Show keyboard controls"
        : "Minimise keyboard controls";
    }

    if (persist) this.storeState(this.collapsed);

    return this.collapsed;
  }

  toggle() {
    return this.setCollapsed(!this.collapsed);
  }
}
