// A component with a shadow root, defined by a classic script: a test page for VoiceOver loads it through <base href>.
customElements.define(
  "site-menu",
  class extends HTMLElement {
    connectedCallback() {
      const root = this.attachShadow({ mode: "open" });
      root.innerHTML = '<nav aria-label="Hoofdmenu"><button type="button" aria-expanded="false">Menu</button><ul hidden><li><a href="/">Start</a></li></ul></nav>';
      const button = root.querySelector("button");
      button.addEventListener("click", () => {
        root.querySelector("ul").hidden = false;
        button.setAttribute("aria-expanded", "true");
      });
    }
  },
);
