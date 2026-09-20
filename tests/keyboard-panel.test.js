import test from "node:test";
import assert from "node:assert/strict";

import { KeyboardPanelControls } from "../src/ui/KeyboardPanelControls.js";

// ---------------------------------------------------------------------------
// A deliberately tiny DOM stub. No jsdom is available in this project, and
// KeyboardPanelControls only touches a narrow slice of the DOM, so the slice
// is modelled here rather than pulling in a dependency.
//
// Every attribute write and focus call is appended to `log`, which is what
// lets the ordering test below assert the actual fix: focus has to leave the
// collapsible region BEFORE aria-hidden is applied to it.
// ---------------------------------------------------------------------------

function createDom() {
  const log = [];

  const doc = { activeElement: null };

  class El {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.childNodes = [];
      this.parentNode = null;
      this.attributes = new Map();
      this.dataset = {};
      this.listeners = new Map();
      this.id = "";
      this.className = "";
      this.textContent = "";
      this.title = "";
      this.inert = false;

      this.classList = {
        add: name => this.classList._set(name, true),
        remove: name => this.classList._set(name, false),
        toggle: (name, force) => this.classList._set(name, force),
        contains: name => this.className.split(/\s+/).includes(name),
        _set: (name, on) => {
          const parts = this.className.split(/\s+/).filter(Boolean);
          const has = parts.includes(name);
          if (on && !has) parts.push(name);
          if (!on && has) parts.splice(parts.indexOf(name), 1);
          this.className = parts.join(" ");
        }
      };
    }

    append(...nodes) {
      for (const node of nodes) {
        if (node.parentNode) {
          const siblings = node.parentNode.childNodes;
          siblings.splice(siblings.indexOf(node), 1);
        }
        node.parentNode = this;
        this.childNodes.push(node);
      }
    }

    prepend(node) {
      node.parentNode = this;
      this.childNodes.unshift(node);
    }

    setAttribute(name, value) {
      log.push(`set:${this.id || this.className}:${name}`);
      this.attributes.set(name, String(value));
    }

    getAttribute(name) {
      return this.attributes.has(name) ? this.attributes.get(name) : null;
    }

    hasAttribute(name) {
      return this.attributes.has(name);
    }

    removeAttribute(name) {
      this.attributes.delete(name);
    }

    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    }

    click() {
      let stopped = false;
      const event = { stopPropagation: () => { stopped = true; } };

      for (const fn of this.listeners.get("click") ?? []) fn(event);

      if (!stopped && this.parentNode?.listeners?.has("click")) {
        for (const fn of this.parentNode.listeners.get("click")) fn(event);
      }
    }

    contains(node) {
      if (node === this) return true;
      return this.childNodes.some(child => child.contains?.(node));
    }

    focus() {
      log.push(`focus:${this.id || this.className}`);
      doc.activeElement = this;
    }

    blur() {
      if (doc.activeElement === this) doc.activeElement = null;
    }

    matches(selector) {
      if (selector.startsWith(".")) {
        return this.classList.contains(selector.slice(1));
      }
      if (selector.startsWith("#")) return this.id === selector.slice(1);
      return this.tagName === selector.toUpperCase();
    }

    querySelector(selector) {
      for (const child of this.childNodes) {
        if (child.matches?.(selector)) return child;
        const nested = child.querySelector?.(selector);
        if (nested) return nested;
      }
      return null;
    }
  }

  doc.createElement = tag => new El(tag);

  return { doc, El, log };
}

// Builds the structure index.html actually ships: a panel carrying a static
// aria-hidden="true", a title row, and several content rows.
function buildPanel(dom) {
  const panel = dom.doc.createElement("div");
  panel.id = "keyboard-panel";
  panel.className = "kbd-panel";
  panel.setAttribute("aria-hidden", "true");

  const title = dom.doc.createElement("div");
  title.className = "kbd-panel-title";

  const row = dom.doc.createElement("div");
  row.className = "kbd-row";

  const key = dom.doc.createElement("button");
  key.className = "kbd-key";
  row.append(key);

  const note = dom.doc.createElement("p");
  note.className = "kbd-note";

  panel.append(title, row, note);

  return { panel, title, row, key, note };
}

function install(dom) {
  const store = new Map();

  globalThis.document = dom.doc;
  globalThis.window = {
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v)
    }
  };
}

test("the collapsible region excludes the toggle", () => {
  const dom = createDom();
  install(dom);

  const { panel, title } = buildPanel(dom);
  const controls = new KeyboardPanelControls(panel);

  assert.equal(controls.body.id, "keyboard-panel-body");

  // The toggle lives in the header, NOT in the region that gets hidden.
  assert.equal(controls.button.parentNode, title);
  assert.equal(controls.body.contains(controls.button), false);

  // ...and the panel's own content moved into the region.
  assert.ok(controls.body.querySelector(".kbd-row"));
  assert.ok(controls.body.querySelector(".kbd-note"));
});

test("the stale static aria-hidden on the panel is cleared", () => {
  const dom = createDom();
  install(dom);

  const { panel } = buildPanel(dom);
  new KeyboardPanelControls(panel);

  // The panel itself must never be aria-hidden, or the toggle inside it is
  // hidden from assistive technology along with everything else.
  assert.equal(panel.hasAttribute("aria-hidden"), false);
});

test("collapsing moves focus out BEFORE hiding the region", () => {
  const dom = createDom();
  install(dom);

  const { panel } = buildPanel(dom);
  const controls = new KeyboardPanelControls(panel);

  // Focus something inside the region, as a keyboard user would have.
  const key = controls.body.querySelector(".kbd-key");
  key.focus();

  dom.log.length = 0;
  controls.button.click();

  const focusIndex = dom.log.findIndex(entry =>
    entry.startsWith("focus:kbd-panel-toggle")
  );
  const hideIndex = dom.log.findIndex(entry => entry.endsWith(":aria-hidden"));

  assert.ok(focusIndex >= 0, "focus should have been moved to the toggle");
  assert.ok(hideIndex >= 0, "the region should have been marked aria-hidden");
  assert.ok(
    focusIndex < hideIndex,
    "focus must leave the region before aria-hidden is applied to it"
  );

  // No focused element may remain inside an aria-hidden subtree.
  assert.equal(controls.body.contains(dom.doc.activeElement), false);
  assert.equal(dom.doc.activeElement, controls.button);
});

test("collapsed state marks the region inert and leaves the toggle usable", () => {
  const dom = createDom();
  install(dom);

  const { panel } = buildPanel(dom);
  const controls = new KeyboardPanelControls(panel);

  controls.button.click();

  assert.equal(controls.collapsed, true);
  assert.equal(controls.body.getAttribute("aria-hidden"), "true");
  assert.equal(controls.body.inert, true);
  assert.equal(panel.hasAttribute("aria-hidden"), false);

  // The toggle is still operable and still says what it controls.
  assert.equal(controls.button.getAttribute("aria-expanded"), "false");
  assert.equal(controls.button.getAttribute("aria-controls"), "keyboard-panel-body");

  controls.button.click();

  assert.equal(controls.collapsed, false);
  assert.equal(controls.body.hasAttribute("aria-hidden"), false);
  assert.equal(controls.body.inert, false);
  assert.equal(controls.button.getAttribute("aria-expanded"), "true");
});

test("a missing panel is a no-op rather than a throw", () => {
  const dom = createDom();
  install(dom);

  const controls = new KeyboardPanelControls(null);

  assert.equal(controls.setCollapsed(true), false);
  assert.equal(controls.collapsed, false);
});
