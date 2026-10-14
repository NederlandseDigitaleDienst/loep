// Runs inside a page, installed as window.__loepm when a second-opinion method needs it.
// Plain JavaScript on purpose: it is injected as-is. It only reads. Its main job is to say
// where an element is in the one notation the toolbox uses everywhere, whichever tool
// pointed at it: one selector chain per shadow level joined with " >>> ", and one such
// chain per frame joined with " | ", outermost first.
(() => {
  const isShadowRoot = (node) => node !== null && node.nodeType === 11 && Boolean(node.host);

  /** The same selector chain as path() in the read-only library; a test keeps the two equal. Works for an element of any frame. */
  function path(element) {
    const chain = [];
    let current = element;
    while (current) {
      const root = current.getRootNode();
      const parts = [];
      let node = current;
      while (node && node.nodeType === 1) {
        if (node.id && root.querySelectorAll(`#${CSS.escape(node.id)}`).length === 1) {
          parts.unshift(`#${CSS.escape(node.id)}`);
          break;
        }
        const siblings = node.parentNode ? [...node.parentNode.children].filter((sibling) => sibling.localName === node.localName) : [];
        parts.unshift(siblings.length > 1 ? `${node.localName}:nth-of-type(${siblings.indexOf(node) + 1})` : node.localName);
        node = node.parentElement;
      }
      chain.unshift(parts.join(" > "));
      current = isShadowRoot(root) ? root.host : null;
    }
    return chain;
  }

  /** The element a node belongs to: itself, the owner of an attribute, the parent of a text node, the root element of a document. */
  function elementOf(node) {
    if (!node) return null;
    if (node.nodeType === 1) return node;
    if (node.nodeType === 2) return node.ownerElement;
    if (node.nodeType === 9) return node.documentElement;
    if (node.nodeType === 11) return node.host ?? null;
    return node.parentElement ?? (isShadowRoot(node.parentNode) ? node.parentNode.host : null);
  }

  const cache = new WeakMap();

  /** Where a node is, from the top document down: through every frame and every shadow root on the way. */
  function where(node) {
    const element = elementOf(node);
    if (!element) return null;
    const known = cache.get(element);
    if (known !== undefined) return known;
    const hops = [];
    let current = element;
    for (;;) {
      hops.unshift(path(current).join(" >>> "));
      const view = current.ownerDocument.defaultView;
      if (!view || view === window) break;
      let frame = null;
      try {
        frame = view.frameElement;
      } catch {
        frame = null;
      }
      if (!frame) break;
      current = frame;
    }
    const found = hops.join(" | ");
    cache.set(element, found);
    return found;
  }

  function resolveChain(root, chain) {
    let scope = root;
    let element = null;
    for (const segment of chain) {
      let current = null;
      for (const [index, part] of segment.split(" > ").entries()) {
        if (part.startsWith("#")) current = (index === 0 ? scope : current).querySelector(part);
        else {
          const [, name, nth] = /^([^:]+)(?::nth-of-type\((\d+)\))?$/.exec(part) ?? [];
          current = [...(current ?? scope).children].filter((child) => child.localName === name)[nth ? Number(nth) - 1 : 0] ?? null;
        }
        if (!current) return null;
      }
      element = current;
      scope = element.shadowRoot ?? element;
    }
    return element;
  }

  /** The element behind a `where`, or null when it is gone or sits in a frame of another origin. */
  function resolveWhere(found) {
    let scope = document;
    let element = null;
    const hops = found.split(" | ");
    for (const [index, hop] of hops.entries()) {
      element = resolveChain(scope, hop.split(" >>> "));
      if (!element) return null;
      if (index < hops.length - 1) {
        try {
          scope = element.contentDocument;
        } catch {
          scope = null;
        }
        if (!scope) return null;
      }
    }
    return element;
  }

  /**
   * A path of steps from the top document to an element that names every boundary it crosses:
   * "/html[1]/body[1]/my-card[1]/#shadow/button[1]" and ".../iframe[1]/#document/html[1]/...".
   * This is the form in which an element is handed to a tool that works on its own copy of the DOM.
   */
  function deepXPath(element) {
    const steps = [];
    let current = element;
    while (current) {
      const parent = current.parentNode;
      if (current.nodeType === 1) {
        const same = parent ? [...parent.children].filter((sibling) => sibling.localName === current.localName) : [current];
        steps.unshift(`${current.localName}[${same.indexOf(current) + 1}]`);
        current = parent;
      } else if (isShadowRoot(current)) {
        steps.unshift("#shadow");
        current = current.host;
      } else if (current.nodeType === 9) {
        let frame = null;
        try {
          frame = current.defaultView?.frameElement ?? null;
        } catch {
          frame = null;
        }
        if (!frame || current === document) break;
        steps.unshift("#document");
        current = frame;
      } else current = parent;
    }
    return `/${steps.join("/")}`;
  }

  /** The element at the end of such a path, or null. A step for a text node or an attribute ends at its element. */
  function byDeepXPath(xpath) {
    let current = document;
    for (const step of xpath.split("/").filter(Boolean)) {
      if (step === "#shadow" || step.startsWith("#document-fragment")) current = current.shadowRoot ?? null;
      else if (step === "#document") {
        try {
          current = current.contentDocument ?? null;
        } catch {
          current = null;
        }
      } else if (step.startsWith("@") || step.startsWith("text()") || step.startsWith("comment()")) break;
      else {
        const [, name, nth] = /^(.+?)(?:\[(\d+)\])?$/.exec(step) ?? [];
        current = [...current.children].filter((child) => child.localName.toLowerCase() === String(name).toLowerCase())[nth ? Number(nth) - 1 : 0] ?? null;
      }
      if (!current) return null;
    }
    return current.nodeType === 9 ? current.documentElement : current.nodeType === 1 ? current : null;
  }

  /**
   * An axe target: one entry per frame on the way, each a selector or a list of selectors
   * through shadow roots. Returns where the element is; `partial` when a frame of another
   * origin could not be entered and the rest is still axe's own selector.
   */
  function byAxeTarget(target) {
    let scope = document;
    let element = null;
    for (const [index, hop] of target.entries()) {
      let root = scope;
      for (const selector of Array.isArray(hop) ? hop : [hop]) {
        try {
          element = root.querySelector(selector);
        } catch {
          element = null;
        }
        if (!element) return { where: null, partial: false };
        root = element.shadowRoot ?? element;
      }
      if (index === target.length - 1) break;
      let inner = null;
      try {
        inner = element.contentDocument;
      } catch {
        inner = null;
      }
      if (!inner) {
        const rest = target.slice(index + 1).map((part) => (Array.isArray(part) ? part.join(" >>> ") : String(part)));
        return { where: [where(element), ...rest].join(" | "), partial: true };
      }
      scope = inner;
    }
    return { where: where(element), partial: false };
  }

  function composedParent(element) {
    if (element.assignedSlot) return element.assignedSlot;
    if (element.parentElement) return element.parentElement;
    const root = element.getRootNode();
    if (isShadowRoot(root)) return root.host;
    try {
      const view = element.ownerDocument.defaultView;
      return view && view !== window ? view.frameElement : null;
    } catch {
      return null;
    }
  }

  /** How each of a list of places relates to one element: "same", "inside" it, or null. */
  function relate(target, places) {
    const element = resolveWhere(target);
    return places.map((place) => {
      if (place === target) return "same";
      const other = element && place ? resolveWhere(place) : null;
      if (!other) return null;
      for (let current = composedParent(other); current; current = composedParent(current)) if (current === element) return "inside";
      return null;
    });
  }

  /** Every element of the page: through shadow roots and through frames of the same origin. */
  function deepAll(root = document, out = []) {
    for (const element of root.querySelectorAll("*")) {
      out.push(element);
      if (element.shadowRoot) deepAll(element.shadowRoot, out);
      if (element.localName === "iframe" || element.localName === "frame") {
        let inner = null;
        try {
          inner = element.contentDocument;
        } catch {
          inner = null;
        }
        if (inner) deepAll(inner, out);
      }
    }
    return out;
  }

  /** Take away attributes that a tool wrote into the page while it ran. Returns how many were removed. */
  function removeAttributes(names) {
    let removed = 0;
    for (const element of deepAll()) {
      for (const name of names) {
        if (!element.hasAttribute(name)) continue;
        element.removeAttribute(name);
        removed++;
      }
    }
    return removed;
  }

  let canvas = null;

  /** Any CSS colour as [r, g, b, alpha], by letting the browser paint it. */
  function rgba(colour) {
    canvas ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    canvas.canvas.width = 1;
    canvas.canvas.height = 1;
    canvas.clearRect(0, 0, 1, 1);
    canvas.fillStyle = "rgba(0, 0, 0, 0)";
    canvas.fillStyle = colour;
    canvas.fillRect(0, 0, 1, 1);
    const [red, green, blue, alpha] = canvas.getImageData(0, 0, 1, 1).data;
    // The canvas stores colours multiplied by alpha only internally; what comes back is not premultiplied.
    return [red, green, blue, Math.round((alpha / 255) * 1000) / 1000];
  }

  const over = (top, bottom) => {
    const alpha = top[3] + bottom[3] * (1 - top[3]);
    if (alpha === 0) return [0, 0, 0, 0];
    return [0, 1, 2].map((index) => (top[index] * top[3] + bottom[index] * bottom[3] * (1 - top[3])) / alpha).concat(alpha);
  };
  const luminance = (colour) => {
    const [red, green, blue] = colour.map((value) => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const ratio = (first, second) => {
    const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
    return (light + 0.05) / (dark + 0.05);
  };
  const hex = (colour) => `#${colour.slice(0, 3).map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;

  /** What the browser paints behind everything when no element has a background. */
  function canvasColour() {
    const scheme = getComputedStyle(document.documentElement).colorScheme;
    const dark = /dark/.test(scheme) && (!/light/.test(scheme) || matchMedia("(prefers-color-scheme: dark)").matches);
    return dark ? [18, 18, 18, 1] : [255, 255, 255, 1];
  }

  const MAX_PIECES = 60;

  /**
   * Contrast of the text in an element from styles alone: the computed text colour against
   * the background colours of the element and its ancestors, laid over each other until
   * one is opaque. A picture, gradient or filter on the way cannot be read from styles;
   * the outcome is then "cantTell".
   */
  function computedContrast(target) {
    const element = resolveWhere(target);
    if (!element) return null;
    const holders = [];
    const visit = (node) => {
      if (holders.length >= MAX_PIECES) return;
      if ([...node.childNodes].some((child) => child.nodeType === 3 && child.textContent.trim() !== "")) holders.push(node);
      for (const child of node.children) visit(child);
      if (node.shadowRoot) for (const child of node.shadowRoot.children) visit(child);
    };
    visit(element);
    const pieces = [];
    for (const holder of holders) {
      if (typeof holder.checkVisibility === "function" && !holder.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
      const style = getComputedStyle(holder);
      const notes = [];
      let background = [0, 0, 0, 0];
      let assumed = false;
      for (let current = holder; current; current = composedParent(current)) {
        const own = getComputedStyle(current);
        if (own.backgroundImage !== "none") notes.push("background-image");
        if (Number(own.opacity) < 1) notes.push("opacity");
        if (own.filter !== "none" || own.mixBlendMode !== "normal") notes.push("filter");
        background = over(background, rgba(own.backgroundColor));
        if (background[3] >= 0.999) break;
      }
      if (background[3] < 0.999) {
        background = over(background, canvasColour());
        assumed = true;
      }
      if (style.textShadow !== "none") notes.push("text-shadow");
      const foreground = over(rgba(style.color), background);
      const size = Number.parseFloat(style.fontSize);
      const bold = Number(style.fontWeight) >= 700;
      const required = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
      const value = Math.round(ratio(foreground, background) * 100) / 100;
      const unique = [...new Set(notes)];
      pieces.push({
        text: [...holder.childNodes].filter((child) => child.nodeType === 3).map((child) => child.textContent).join(" ").replace(/\s+/g, " ").trim().slice(0, 60),
        where: where(holder),
        foreground: hex(foreground),
        background: hex(background),
        ratio: value,
        required,
        outcome: unique.length > 0 ? "cantTell" : value >= required ? "passed" : "failed",
        ...(unique.length > 0 ? { notes: unique } : {}),
        ...(assumed ? { backgroundAssumed: true } : {}),
      });
    }
    return pieces;
  }

  /** The contrast of the text colour of an element against each of a list of background colours. */
  function contrastAgainst(target, colours) {
    const element = resolveWhere(target);
    if (!element) return null;
    const style = getComputedStyle(element);
    const size = Number.parseFloat(style.fontSize);
    const required = size >= 24 || (Number(style.fontWeight) >= 700 && size >= 18.66) ? 3 : 4.5;
    const text = rgba(style.color);
    const ratios = colours.map((colour) => {
      const background = over(rgba(colour), [255, 255, 255, 1]);
      return Math.round(ratio(over(text, background), background) * 100) / 100;
    });
    return { foreground: hex(over(text, [255, 255, 255, 1])), ratios, required };
  }

  const FOCUS_PROPERTIES = [
    "outline-style", "outline-width", "outline-color", "outline-offset", "box-shadow", "background-color", "background-image", "color",
    "border-top-color", "border-right-color", "border-bottom-color", "border-left-color", "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
    "border-top-style", "border-right-style", "border-bottom-style", "border-left-style", "text-decoration-line", "text-decoration-color", "text-decoration-thickness", "font-weight", "opacity", "transform",
  ];

  /** The computed properties with which a focus indicator is usually drawn, of an element and of its composed ancestors. */
  function focusStyles(target) {
    const element = resolveWhere(target);
    if (!element) return null;
    const read = (node) => {
      const style = getComputedStyle(node);
      return Object.fromEntries(FOCUS_PROPERTIES.map((name) => [name, style.getPropertyValue(name)]));
    };
    const ancestors = [];
    for (let current = composedParent(element); current && ancestors.length < 6; current = composedParent(current)) ancestors.push({ where: where(current), style: read(current) });
    const generated = {};
    for (const pseudo of ["::before", "::after"]) {
      const style = getComputedStyle(element, pseudo);
      if (style.content && style.content !== "none" && style.content !== "normal") generated[pseudo] = Object.fromEntries(FOCUS_PROPERTIES.map((name) => [name, style.getPropertyValue(name)]));
    }
    return { own: read(element), ancestors, generated, focused: element.matches(":focus"), focusVisible: element.matches(":focus-visible") };
  }

  const langOf = (element) => {
    for (let current = element; current; current = composedParent(current)) {
      const value = current.getAttribute("lang") ?? current.getAttribute("xml:lang");
      if (value !== null) return { lang: value.trim(), from: current };
    }
    return { lang: null, from: null };
  };

  const SKIPPED = new Set(["script", "style", "noscript", "template", "svg", "code", "pre", "kbd", "samp", "var"]);

  /** The text of an element that carries its language: without the parts that declare a language of their own, and without what is not rendered. */
  function ownLanguageText(element, parts = []) {
    for (const child of element.shadowRoot ? [...element.shadowRoot.childNodes, ...element.childNodes] : element.childNodes) {
      if (child.nodeType === 3) parts.push(child.textContent);
      else if (child.nodeType === 1) {
        if (SKIPPED.has(child.localName) || child.hasAttribute("lang") || child.hasAttribute("xml:lang")) continue;
        if (typeof child.checkVisibility === "function" && !child.checkVisibility()) continue;
        ownLanguageText(child, parts);
      }
    }
    return parts;
  }

  const squash = (parts) => parts.join(" ").replace(/\s+/g, " ").trim();
  const MAX_LANGUAGE_TEXT = 2000;

  /** The declared language and the text it covers, for one element or for the page. */
  function languageOf(target) {
    const element = target ? resolveWhere(target) : document.documentElement;
    if (!element) return null;
    const declared = langOf(element);
    const text = squash(ownLanguageText(element === document.documentElement ? document.body ?? element : element));
    return { where: where(element), declared: declared.lang, declaredOn: declared.from ? where(declared.from) : null, ownAttribute: element.hasAttribute("lang"), text: text.slice(0, MAX_LANGUAGE_TEXT), words: text ? text.split(" ").length : 0 };
  }

  const BLOCKS = "p,li,h1,h2,h3,h4,h5,h6,td,th,dd,dt,blockquote,figcaption,caption,summary,label,legend,div,span,a,button";

  /**
   * The pieces of the page whose language can be checked on their own: every element that
   * declares a language, and every block that holds text directly.
   */
  function languageBlocks(max) {
    const out = [];
    const seen = new Set();
    for (const element of deepAll()) {
      if (element.ownerDocument !== document || element === document.documentElement) continue;
      if (SKIPPED.has(element.localName) || element.closest("head")) continue;
      const declares = element.hasAttribute("lang");
      const holdsText = element.matches(BLOCKS) && [...element.childNodes].some((child) => child.nodeType === 3 && child.textContent.trim().split(/\s+/).length >= 3);
      if (!declares && !holdsText) continue;
      if (typeof element.checkVisibility === "function" && !element.checkVisibility()) continue;
      // An inline element inside a block that is already listed adds nothing.
      if (!declares && [...seen].some((listed) => listed.contains(element))) continue;
      const text = squash(ownLanguageText(element));
      if (!text) continue;
      seen.add(element);
      const declared = langOf(element);
      out.push({ where: where(element), path: path(element), declared: declared.lang, ownAttribute: declares, text: text.slice(0, 600), words: text.split(" ").length });
      if (out.length >= max) break;
    }
    return out;
  }

  /** The innermost element painted at a point of the window, through shadow roots. */
  function elementAt(x, y) {
    let top = document.elementFromPoint(x, y);
    for (let inner = top?.shadowRoot?.elementFromPoint(x, y); inner && inner !== top; inner = top.shadowRoot?.elementFromPoint(x, y)) top = inner;
    return top ? { where: where(top), path: path(top), tag: top.localName, text: (top.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60) } : null;
  }

  /**
   * The smallest visible element whose box holds a point of the page, in coordinates of the
   * document. Unlike elementAt this also works below the fold, at the price of not knowing what is painted on top.
   */
  function elementAtDocument(x, y) {
    let best = null;
    let bestArea = Number.POSITIVE_INFINITY;
    for (const element of deepAll()) {
      if (element.ownerDocument !== document) continue;
      const rect = element.getBoundingClientRect();
      const left = rect.left + window.scrollX;
      const top = rect.top + window.scrollY;
      if (rect.width < 1 || rect.height < 1 || x < left || y < top || x > left + rect.width || y > top + rect.height) continue;
      const area = rect.width * rect.height;
      if (area < bestArea) {
        best = element;
        bestArea = area;
      }
    }
    return best ? { where: where(best), path: path(best), tag: best.localName, text: (best.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60) } : null;
  }

  /** The element that has keyboard focus, through shadow roots and frames of the same origin. */
  function focusedWhere() {
    let active = document.activeElement;
    for (;;) {
      if (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      else if (active && (active.localName === "iframe" || active.localName === "frame")) {
        let inner = null;
        try {
          inner = active.contentDocument?.activeElement ?? null;
        } catch {
          inner = null;
        }
        if (!inner || inner === active.contentDocument.body || inner === active.contentDocument.documentElement) break;
        active = inner;
      } else break;
    }
    if (!active || active === document.body || active === document.documentElement) return null;
    return { where: where(active), tag: active.localName, text: (active.getAttribute("aria-label") ?? active.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60) };
  }

  const innermost = (selector) => {
    let found = null;
    for (const element of deepAll()) if (element.ownerDocument === document && element.matches(selector)) found = element;
    return found;
  };

  /** What the pointer is on and what has focus: the part of the state of a page that is not in its DOM. */
  function liveState() {
    const hovered = innermost(":hover");
    const focused = focusedWhere();
    return { hover: hovered && hovered !== document.documentElement && hovered !== document.body ? where(hovered) : null, focus: focused ? focused.where : null };
  }

  /** What a measurement has to know about an element before it starts. */
  function elementState(target) {
    const element = resolveWhere(target);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const hasText = (node) => [...node.childNodes].some((child) => (child.nodeType === 3 && child.textContent.trim() !== "") || (child.nodeType === 1 && hasText(child))) || Boolean(node.shadowRoot && hasText(node.shadowRoot));
    return {
      tag: element.localName,
      hover: element.matches(":hover"),
      focus: element.matches(":focus-within"),
      inViewport: rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
      hasText: hasText(element),
      backgroundImage: getComputedStyle(element).backgroundImage !== "none",
      scroll: [window.scrollX, window.scrollY],
    };
  }

  /** Bring an element into the window when it is not fully in it. Returns the scroll position from before, to put back. */
  function intoView(target) {
    const element = resolveWhere(target);
    const before = [window.scrollX, window.scrollY];
    if (element) element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    return before;
  }

  const SHOWN_PROPERTIES = ["color", "background-color", "background-image", "text-decoration-line", "text-decoration-color", "outline-style", "outline-width", "outline-color", "box-shadow", "border-top-color", "border-bottom-color", "border-bottom-width", "font-weight", "opacity", "cursor"];

  /** The computed properties with which a state such as hover is usually shown, of one element. */
  function shownStyles(target) {
    const element = resolveWhere(target);
    if (!element) return null;
    const style = getComputedStyle(element);
    return Object.fromEntries(SHOWN_PROPERTIES.map((name) => [name, style.getPropertyValue(name)]));
  }

  /**
   * For each place: what keeps a user from reaching it although it is in the DOM. An open
   * modal dialog that does not hold it, an inert ancestor, or another element painted over
   * it. Null when nothing does. Only what is in the window can be tested for being covered.
   */
  function blockedPlaces(places) {
    const modal = [...deepAll()].find((element) => element.ownerDocument === document && ((element.localName === "dialog" && element.matches(":modal")) || (element.getAttribute("aria-modal") === "true" && element.checkVisibility?.()))) ?? null;
    return places.map((place) => {
      const element = resolveWhere(place.split(" | ")[0]);
      if (!element) return "niet op de pagina";
      for (let current = element; current; current = composedParent(current)) if (current.inert) return "inert";
      let inModal = false;
      for (let current = element; current; current = composedParent(current)) if (current === modal) inModal = true;
      if (modal && !inModal) return `achter ${where(modal)}`;
      const cover = coveredAt(element);
      return cover ? `bedekt door ${cover}` : null;
    });
  }

  /** The element painted over one of five points of an element (centre and near the corners), when the element is in the window. */
  function coveredAt(element) {
    const rect = element.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    const inset = (size) => Math.min(3, size / 4);
    const points = [[rect.x + rect.width / 2, rect.y + rect.height / 2], [rect.x + inset(rect.width), rect.y + inset(rect.height)], [rect.right - inset(rect.width), rect.y + inset(rect.height)], [rect.x + inset(rect.width), rect.bottom - inset(rect.height)], [rect.right - inset(rect.width), rect.bottom - inset(rect.height)]];
    for (const [x, y] of points) {
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
      let top = document.elementFromPoint(x, y);
      for (let inner = top?.shadowRoot?.elementFromPoint(x, y); inner && inner !== top; inner = top.shadowRoot?.elementFromPoint(x, y)) top = inner;
      if (!top || top === element) continue;
      let related = false;
      for (let current = top; current; current = composedParent(current)) if (current === element) related = true;
      for (let current = element; current; current = composedParent(current)) if (current === top) related = true;
      if (element.labels && [...element.labels].some((label) => label.contains(top))) related = true;
      if (!related) return where(top);
    }
    return null;
  }

  /** Whether something is painted over an element, after bringing it into the window the way a walk with Tab does. */
  function coverOf(target, scroll) {
    const element = resolveWhere(target);
    if (!element) return null;
    const before = [window.scrollX, window.scrollY];
    if (scroll) window.scrollTo({ left: scroll[0], top: scroll[1], behavior: "instant" });
    const cover = coveredAt(element);
    window.scrollTo({ left: before[0], top: before[1], behavior: "instant" });
    return cover;
  }

  const STATE_ATTRIBUTES = ["aria-expanded", "aria-pressed", "aria-selected", "aria-checked", "aria-current", "aria-invalid", "aria-hidden", "aria-disabled"];

  /**
   * The state of everything on the page that has one: whether a box is ticked, what a field
   * holds, whether something is open, expanded, pressed or selected. Taken before and after
   * an action, the difference is what the action did, also where no text appeared.
   */
  function controlStates() {
    const out = {};
    for (const element of deepAll()) {
      if (element.ownerDocument !== document) continue;
      const parts = [];
      const tag = element.localName;
      if (tag === "input" && (element.type === "checkbox" || element.type === "radio")) parts.push(`checked=${element.checked}`);
      else if (tag === "input" && element.type === "password") parts.push(`value=(${element.value.length} tekens)`);
      else if ((tag === "input" && !["hidden", "submit", "button", "image", "reset"].includes(element.type)) || tag === "textarea" || tag === "select") parts.push(`value="${String(element.value).slice(0, 40)}"`);
      if (tag === "details" || tag === "dialog") parts.push(`open=${element.open}`);
      for (const name of STATE_ATTRIBUTES) if (element.hasAttribute(name)) parts.push(`${name}=${element.getAttribute(name)}`);
      if (parts.length > 0) out[where(element)] = parts.join(" ");
    }
    return out;
  }

  const NATIVE_FOCUS = new Set(["a", "button", "input", "select", "textarea", "summary", "audio", "video"]);

  /**
   * For each place: whether it is of a kind that browsers and predictions are known to treat
   * differently as a Tab stop. A frame (some stop on the frame itself, a prediction does not
   * look into it) or a region that scrolls and has no tabindex (a stop in Chromium and Firefox, not in WebKit).
   */
  function stopKinds(places) {
    return places.map((place) => {
      const element = resolveWhere(place.split(" | ")[0]);
      if (!element) return null;
      if (element.localName === "iframe" || element.localName === "frame") return "frame";
      const style = getComputedStyle(element);
      const scrolls = (["auto", "scroll"].includes(style.overflowY) && element.scrollHeight > element.clientHeight + 1) || (["auto", "scroll"].includes(style.overflowX) && element.scrollWidth > element.clientWidth + 1);
      return scrolls && !element.hasAttribute("tabindex") && !NATIVE_FOCUS.has(element.localName) && !element.isContentEditable ? "scroll-region" : null;
    });
  }

  /** Whether an element keeps focus when it is given focus; the element that had focus gets it back. */
  function keepsFocus(place) {
    const element = resolveWhere(place);
    if (!element) return null;
    const before = document.activeElement;
    element.focus({ preventScroll: true });
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    const kept = active === element;
    if (before && before !== element && typeof before.focus === "function") before.focus({ preventScroll: true });
    else if (kept) element.blur();
    return kept;
  }

  /** What an image element is and says about itself, for setting next to the text read from its pixels. */
  function imageFacts(target) {
    const element = resolveWhere(target);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      tag: element.localName,
      alt: element.getAttribute("alt"),
      ariaLabel: element.getAttribute("aria-label"),
      title: element.getAttribute("title"),
      role: element.getAttribute("role"),
      src: element.currentSrc ?? element.getAttribute("src") ?? null,
      natural: element.naturalWidth ? { width: element.naturalWidth, height: element.naturalHeight } : null,
      box: { width: Math.round(rect.width), height: Math.round(rect.height) },
      backgroundImage: getComputedStyle(element).backgroundImage !== "none",
    };
  }

  window.__loepm = { path, where, resolveWhere, deepXPath, byDeepXPath, byAxeTarget, relate, deepAll, removeAttributes, rgba, computedContrast, focusStyles, languageOf, languageBlocks, elementAt, elementAtDocument, focusedWhere, imageFacts, composedParent, contrastAgainst, controlStates, stopKinds, keepsFocus, liveState, elementState, intoView, shownStyles, blockedPlaces, coverOf };
})();
