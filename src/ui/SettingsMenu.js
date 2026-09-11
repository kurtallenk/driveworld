export class SettingsMenu {
  constructor() {
    this.isOpen = false;

    this.element = document.querySelector("#settings-menu");
    this.openButton = document.querySelector("#open-menu");
    this.closeButton = document.querySelector("#close-menu");
    this.previousFocus = null;

    // Move existing DOM nodes. Their registered listeners are preserved.
    this.moveButtonGroup("menu-controls", [
      "enable-v99",
      "use-keyboard",
      "use-mobile"
    ]);

    this.moveElement("control-status", "menu-controls");

    this.moveButtonGroup("menu-driving", [
  "select-arcade",
  "select-manual"
]);

    this.moveElement("driving-status", "menu-driving");

    this.moveButtonGroup("menu-presentation", [
      "camera-toggle",
      "enable-audio"
    ]);

    for (const id of ["master-volume", "camera-vibration"]) {
      const input = document.getElementById(id);
      const label = input?.closest("label");

      if (label) {
        document.querySelector("#menu-presentation").append(label);
      }
    }

    this.moveElement("presentation-status", "menu-presentation");

    const options = document.querySelector(".presentation-options");
    if (options) {
      options.open = true;
      document.querySelector("#menu-presentation").append(options);
    }

    // Remove groups left empty by moving their buttons.
    document.querySelectorAll("#debug .debug-actions").forEach(group => {
      if (!group.children.length) group.remove();
    });

    document.querySelector("#debug").open = false;

    this.openButton.hidden = false;
    this.openButton.addEventListener("click", () => this.open());
    this.closeButton.addEventListener("click", () => this.close());

    document.querySelectorAll("[data-settings-tab]").forEach(button => {
      button.addEventListener("click", () => {
        this.selectPage(button.dataset.settingsTab);
      });
    });

    this.selectPage("controls");

    // Capture prevents camera shortcuts or driving keys from reaching
    // gameplay while the modal menu is open.
    window.addEventListener("keydown", event => {
      if (event.code === "Escape" && !event.repeat) {
        // The chat input handles its own Escape (unfocus/close chat)
        // instead of this toggling the settings menu underneath it.
        if (document.activeElement?.dataset?.chatInput !== undefined) {
          return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();

        if (this.isOpen) this.close();
        else this.open();

        return;
      }

      if (!this.isOpen) return;

      if (event.code === "Tab") {
        this.trapFocus(event);
      }

      // Do not prevent default: sliders, buttons and Tab still work.
      event.stopImmediatePropagation();
    }, true);
  }

  moveElement(id, destinationId) {
    const element = document.getElementById(id);
    const destination = document.getElementById(destinationId);

    if (element && destination) destination.append(element);
  }

  moveButtonGroup(destinationId, ids) {
    const group = document.createElement("div");
    group.className = "debug-actions";

    for (const id of ids) {
      const button = document.getElementById(id);
      if (button) group.append(button);
    }

    document.getElementById(destinationId).append(group);
  }

  selectPage(name) {
    document.querySelectorAll("[data-settings-page]").forEach(page => {
      page.hidden = page.dataset.settingsPage !== name;
    });

    document.querySelectorAll("[data-settings-tab]").forEach(button => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.settingsTab === name)
      );
    });
  }

  open() {
    this.previousFocus = document.activeElement;
    this.isOpen = true;
    this.element.hidden = false;
    this.closeButton.focus();
  }

  close() {
    this.isOpen = false;
    this.element.hidden = true;
    this.previousFocus?.focus();
  }

  trapFocus(event) {
    const focusable = Array.from(this.element.querySelectorAll(
      "button:not(:disabled), input:not(:disabled), summary, [tabindex='0']"
    )).filter(element => element.getClientRects().length > 0);

    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}