// Runs inside a page of an interactive session, installed as window.__loeps next to window.__loep.
// Plain JavaScript on purpose: it is injected as-is. It only reads. What it adds to the
// read-only library is a reference number per element that stays the same for as long as
// the document lives, so an agent can point at an element again in a later command.
(() => {
  const byRef = new Map();
  const refOf = new WeakMap();
  let next = 1;
  // Identifies this document: a reference from a previous page must never land on an element of this one.
  const doc = `${performance.timeOrigin}`;
  const loep = () => window.__loep;

  const HEADING = "h1,h2,h3,h4,h5,h6,[role=heading]";
  const OPERABLE = 'a[href],button,input,select,textarea,summary,[contenteditable=""],[contenteditable=true],[role=button],[role=link],[role=checkbox],[role=radio],[role=switch],[role=tab],[role=menuitem],[role=combobox],[role=textbox],[role=slider]';
  const MEDIA = "img,svg,[role=img],canvas,video,audio,iframe,object,embed";
  const IMPLICIT_ROLE = {
    a: "link", button: "button", h1: "heading", h2: "heading", h3: "heading", h4: "heading", h5: "heading", h6: "heading", img: "img", nav: "navigation", main: "main",
    header: "banner", footer: "contentinfo", aside: "complementary", form: "form", table: "table", ul: "list", ol: "list", li: "listitem", dialog: "dialog", select: "combobox",
    textarea: "textbox", summary: "button", iframe: "iframe", search: "search", section: "region", article: "article", option: "option", progress: "progressbar", output: "status",
  };
  const INPUT_ROLE = { checkbox: "checkbox", radio: "radio", range: "slider", button: "button", submit: "button", reset: "button", image: "button", search: "searchbox", number: "spinbutton" };

  function composedParent(element) {
    if (element.assignedSlot) return element.assignedSlot;
    if (element.parentElement) return element.parentElement;
    const root = element.getRootNode();
    return root instanceof ShadowRoot ? root.host : null;
  }

  function within(ancestor, element) {
    for (let current = element; current; current = composedParent(current)) if (current === ancestor) return true;
    return false;
  }

  function refFor(element) {
    let ref = refOf.get(element);
    if (!ref) {
      ref = next++;
      refOf.set(element, ref);
      byRef.set(ref, element);
    }
    return ref;
  }

  /** Continue numbering after the references handed out on earlier pages of this session. */
  function sync(base) {
    if (next <= base) next = base + 1;
    // The read-only library registers every element it describes; nothing in a session holds on to those numbers.
    loep().registry.length = 0;
    return { doc, next };
  }

  /**
   * Call a function of this library with the numbering continued after `base`. Every embedded
   * frame has a library and a counter of its own; the session keeps the numbers apart by telling
   * each call where the others have got to.
   */
  function numbered(base, name, parameters) {
    if (next <= base) next = base + 1;
    const value = api[name](...parameters);
    return { value, next };
  }

  const isFrame = (element) => element.localName === "iframe" || element.localName === "frame";

  /**
   * A selector chain goes into an embedded frame the way it goes into a shadow root. How many
   * parts of the chain lead to the first frame element with more of the chain after it; 0 when
   * the whole chain stays in this document.
   */
  function frameHop(chain) {
    for (let length = 1; length < chain.length; length++) {
      const element = loep().resolve(chain.slice(0, length));
      if (!element) return 0;
      if (isFrame(element)) return length;
    }
    return 0;
  }

  /** The embedded frames a visitor sees in this document. */
  function frames() {
    return loep().deepQueryAll("iframe,frame").filter((element) => {
      const rect = element.getBoundingClientRect();
      return loep().isVisible(element) && rect.width >= 8 && rect.height >= 8;
    }).map(identity);
  }

  function get(ref) {
    const element = byRef.get(ref);
    return element?.isConnected ? element : null;
  }

  /**
   * A page that redraws itself replaces its elements; find the element again from its selector
   * chain. When the caller says what the element was (tag and text), the element found there
   * must be that: a block that rotates by itself puts another element at the same place.
   */
  function rebind(ref, chain, tag, text) {
    const element = loep().resolve(chain);
    if (!element) return false;
    if (tag !== undefined && tag !== null && element.localName !== tag) return false;
    if (text !== undefined && text !== null && loep().describe(element).text.slice(0, 80) !== text) return false;
    byRef.set(ref, element);
    refOf.set(element, ref);
    return true;
  }

  function role(element) {
    const explicit = element.getAttribute("role");
    if (explicit) return explicit;
    if (element.localName === "input") return INPUT_ROLE[element.type] ?? "textbox";
    if (element.localName === "a" && !element.hasAttribute("href")) return null;
    return IMPLICIT_ROLE[element.localName] ?? null;
  }

  function viewportBox(element) {
    const rect = element.getBoundingClientRect();
    return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
  }

  const inViewport = (box) => box.x + box.width > 0 && box.y + box.height > 0 && box.x < innerWidth && box.y < innerHeight;

  /** Who an element is: enough to find it again on a fresh page and to recognise it in a record. */
  function identity(element) {
    const described = loep().describe(element);
    return { ref: refFor(element), doc, tag: described.tag, role: role(element), text: described.text.slice(0, 80), heading: loep().headingContextOf(element).text || null, around: loep().sentenceOf(element) || null, path: described.path, region: described.region, box: described.box, visible: described.visible, viewportBox: viewportBox(element) };
  }

  function info(ref) {
    const element = get(ref);
    return element ? identity(element) : null;
  }

  function refForPath(chain) {
    const element = loep().resolve(chain);
    return element ? identity(element) : null;
  }

  const nameOf = (element) => (element.getAttribute("aria-label") ?? loep().describe(element).text ?? "").replace(/\s+/g, " ").trim().slice(0, 80);

  /** Selector chain like path(), but without ids: an id that changes with every page load leads nowhere the next time. */
  function structuralPath(element) {
    const chain = [];
    let current = element;
    while (current) {
      const root = current.getRootNode();
      const parts = [];
      for (let node = current; node && node.nodeType === Node.ELEMENT_NODE; node = node.parentElement) {
        const siblings = node.parentNode ? [...node.parentNode.children].filter((sibling) => sibling.localName === node.localName) : [];
        parts.unshift(siblings.length > 1 ? `${node.localName}:nth-of-type(${siblings.indexOf(node) + 1})` : node.localName);
      }
      chain.unshift(parts.join(" > "));
      current = root instanceof ShadowRoot ? root.host : null;
    }
    return chain;
  }

  const sameRoleAndName = (tag, wantedRole, name) => [...loep().deepElements()].filter((element) => element.localName === tag && role(element) === wantedRole && nameOf(element) === name);

  /** Everything that can find an element again besides its selector chain; recorded with a step of a recipe. */
  function locatorsFor(ref) {
    const element = get(ref);
    if (!element) return null;
    const name = nameOf(element);
    return { tag: element.localName, role: role(element), name, nth: sameRoleAndName(element.localName, role(element), name).indexOf(element), structural: structuralPath(element) };
  }

  /**
   * Find the element of a recorded step: by its selector chain when the element there is
   * still the same kind of thing, else by role, name and place among equals, else by the
   * chain without ids. Says which one matched.
   */
  function resolveStep(chain, locators) {
    const byChain = loep().resolve(chain);
    if (!locators) return byChain ? { ...identity(byChain), matchedBy: "selector" } : null;
    if (byChain && byChain.localName === locators.tag && (locators.name === "" || nameOf(byChain) === locators.name)) return { ...identity(byChain), matchedBy: "selector" };
    if (locators.name !== "") {
      const equals = sameRoleAndName(locators.tag, locators.role, locators.name);
      const byName = equals[locators.nth] ?? (equals.length === 1 ? equals[0] : null);
      if (byName) return { ...identity(byName), matchedBy: "role-and-name" };
    }
    const byStructure = loep().resolve(locators.structural);
    if (byStructure && byStructure.localName === locators.tag) return { ...identity(byStructure), matchedBy: "structure" };
    return byChain ? { ...identity(byChain), matchedBy: "selector-only" } : null;
  }

  /** References for a list of selector chains at once; null where the chain no longer leads anywhere. */
  function refsForPaths(chains) {
    return chains.map((chain) => {
      const element = loep().resolve(chain);
      return element ? refFor(element) : null;
    });
  }

  /** Put the element in the read-only library's registry, for the functions that take a registry number. */
  function toRegistry(ref) {
    const element = get(ref);
    return element ? loep().registry.push(element) - 1 : -1;
  }

  /** Something else is painted over the centre of the element, such as a cookie notice. */
  function coveredBy(element) {
    const rect = element.getBoundingClientRect();
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return null;
    let top = document.elementFromPoint(x, y);
    for (let inner = top?.shadowRoot?.elementFromPoint(x, y); inner && inner !== top; inner = top.shadowRoot?.elementFromPoint(x, y)) top = inner;
    if (!top || top === element || within(element, top) || within(top, element)) return null;
    // A label paints over the input it belongs to; that is the control itself, not a cover.
    if (element.labels && [...element.labels].some((label) => within(label, top))) return null;
    return top;
  }

  /**
   * What an agent can point at: controls, clickable elements that are not a control, headings,
   * images, frames, dialogs and tables, in document order. Limited to the window unless `full`,
   * and to what is in the open modal dialog when there is one.
   */
  function outline(options) {
    const library = loep();
    const kinds = new Map();
    const mark = (element, kind) => {
      if (element && !kinds.has(element)) kinds.set(element, kind);
    };
    const modal = library.deepQueryAll("dialog").find((dialog) => dialog.matches(":modal")) ?? library.deepQueryAll("[aria-modal=true]").find(library.isVisible) ?? null;
    for (const described of library.hoverTargets()) {
      const element = library.registry[described.ref];
      // A region that scripts can move focus to (tabindex -1) is not something a user operates.
      if (element.getAttribute("tabindex") === "-1" && !element.matches(OPERABLE)) continue;
      mark(element, "control");
    }
    for (const described of library.clickables()) mark(library.registry[described.ref], "clickable");
    for (const described of library.visibleDialogs()) mark(library.registry[described.ref], "dialog");
    for (const element of library.deepQueryAll(HEADING)) if (library.isVisible(element)) mark(element, "heading");
    for (const element of library.deepQueryAll(MEDIA)) {
      if (!library.isVisible(element) || (element.localName === "svg" && element.parentElement?.closest("svg"))) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) continue;
      // An icon inside a control is part of that control; the control is what gets the number.
      let inControl = false;
      for (let current = composedParent(element); current; current = composedParent(current)) if (kinds.get(current) === "control") inControl = true;
      if (!inControl) mark(element, element.localName === "iframe" ? "frame" : "image");
    }
    for (const element of library.deepQueryAll("table,[role=table],[role=grid]")) if (library.isVisible(element)) mark(element, "table");

    const items = [];
    let outside = 0;
    let behindDialog = 0;
    for (const element of library.deepElements(document.body)) {
      const kind = kinds.get(element);
      if (!kind) continue;
      if (modal && element !== modal && !within(modal, element)) {
        behindDialog++;
        continue;
      }
      const described = library.describe(element);
      const shown = { x: described.box.x - window.scrollX, y: described.box.y - window.scrollY, width: described.box.width, height: described.box.height };
      if (!options.full && !inViewport(shown)) {
        outside++;
        continue;
      }
      const cover = coveredBy(element);
      items.push({
        ref: refFor(element),
        reg: described.ref,
        kind,
        tag: described.tag,
        role: role(element),
        text: described.text.slice(0, 80),
        path: described.path,
        region: described.region,
        box: options.full ? described.box : shown,
        level: kind === "heading" ? Number(element.getAttribute("aria-level") ?? element.localName.slice(1)) || null : undefined,
        alt: kind === "image" ? element.getAttribute("alt") : undefined,
        type: element.localName === "input" ? element.type : undefined,
        value: element.matches("input:not([type=password]),textarea,select") && element.value ? String(element.value).slice(0, 40) : undefined,
        coveredBy: cover ? `${cover.localName}${cover.id ? `#${cover.id}` : ""}` : undefined,
        inset: kind === "frame" ? ["Left", "Top"].map((side) => (parseFloat(getComputedStyle(element)[`border${side}Width`]) || 0) + (parseFloat(getComputedStyle(element)[`padding${side}`]) || 0)) : undefined,
      });
    }
    const focused = library.deepActiveElement();
    return {
      items: items.slice(0, options.max),
      notShown: Math.max(0, items.length - options.max),
      outsideWindow: outside,
      behindDialog,
      modal: modal ? refFor(modal) : null,
      focus: focused && focused !== document.body && focused !== document.documentElement ? refFor(focused) : null,
    };
  }

  /** What has focus in this document; for focus inside an embedded frame that is the frame element. */
  function focused() {
    const element = loep().deepActiveElement();
    return element && element !== document.body && element !== document.documentElement ? identity(element) : null;
  }

  /** Where the session is: the facts every record carries. */
  function pageState() {
    const library = loep();
    return {
      url: location.href,
      title: document.title,
      viewport: { width: innerWidth, height: innerHeight },
      scroll: [Math.round(window.scrollX), Math.round(window.scrollY)],
      pageHeight: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
      focus: focused(),
      dialogs: library.visibleDialogs().length,
      snapshot: library.contentSnapshot(),
      doc,
      next,
    };
  }

  /** What an action can change, taken before and after it. */
  function changeState() {
    const library = loep();
    return {
      url: location.href,
      doc,
      dialogs: library.visibleDialogs().length,
      expanded: library.deepQueryAll('[aria-expanded="true"]').length,
      chunks: library.textChunks(),
      live: library.liveRegionTexts(),
      scroll: [Math.round(window.scrollX), Math.round(window.scrollY)],
    };
  }

  const matchers = {
    role: (wanted) => (element) => role(element) === wanted,
    tag: (wanted) => (element) => element.localName === wanted,
    css: (selector) => (element) => element.matches(selector),
    text: (wanted) => {
      const needle = wanted.toLowerCase();
      const textOf = (element) => (element.textContent ?? "").replace(/\s+/g, " ").toLowerCase();
      // The innermost elements that hold the text: not every ancestor up to body.
      return (element) => {
        const label = ["aria-label", "alt", "title", "placeholder"].map((name) => element.getAttribute(name) ?? "").join(" ").toLowerCase();
        if (label.includes(needle)) return true;
        if (!textOf(element).includes(needle)) return false;
        return ![...element.children].some((child) => textOf(child).includes(needle));
      };
    },
  };

  function find(kind, wanted, max) {
    const library = loep();
    const matches = matchers[kind](wanted);
    const found = [];
    for (const element of library.deepElements(document.body)) {
      if (["script", "style", "noscript", "template"].includes(element.localName)) continue;
      if (matches(element)) found.push(element);
    }
    // What is on screen comes first; hidden matches still count, an agent may be looking for exactly those.
    const visible = found.filter((element) => library.isVisible(element));
    const hidden = found.filter((element) => !library.isVisible(element));
    return { total: found.length, hidden: hidden.length, items: [...visible, ...hidden].slice(0, max).map(identity) };
  }

  const STYLE_PROPERTIES = [
    "display", "position", "visibility", "opacity", "color", "background-color", "background-image", "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "word-spacing",
    "text-align", "text-decoration-line", "text-transform", "border-top-width", "border-top-style", "border-top-color", "outline-style", "outline-width", "outline-color", "outline-offset",
    "box-shadow", "cursor", "overflow-x", "overflow-y", "text-overflow", "white-space", "order", "flex-direction", "float", "z-index", "width", "height", "pointer-events",
  ];

  function style(ref, properties) {
    const element = get(ref);
    if (!element) return null;
    const computed = getComputedStyle(element);
    const values = {};
    for (const name of properties.length > 0 ? properties : STYLE_PROPERTIES) values[name] = computed.getPropertyValue(name).slice(0, 200);
    // Generated content is invisible in the markup: an icon font or a required-marker lives here.
    const generated = {};
    for (const pseudo of ["::before", "::after"]) {
      const content = getComputedStyle(element, pseudo).content;
      if (content && content !== "none" && content !== "normal") generated[pseudo] = content.slice(0, 80);
    }
    return { values, generated, matchesFocusVisible: element.matches(":focus-visible"), matchesHover: element.matches(":hover") };
  }

  function html(ref, max) {
    const element = get(ref);
    if (!element) return null;
    const outer = element.outerHTML;
    const shadow = element.shadowRoot ? element.shadowRoot.innerHTML : null;
    return { length: outer.length, html: outer.slice(0, max), truncated: outer.length > max, shadowRoot: shadow ? shadow.slice(0, max) : null };
  }

  const api = { sync, get, rebind, info, refFor, refForPath, refsForPaths, locatorsFor, resolveStep, toRegistry, identity, outline, pageState, changeState, find, style, html, role, coveredBy, within, composedParent, frameHop, frames, focused };
  window.__loeps = { ...api, numbered };
})();
