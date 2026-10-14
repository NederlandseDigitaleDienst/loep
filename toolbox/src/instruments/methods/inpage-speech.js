// Runs inside a page, around the simulated screen reader (@guidepup/virtual-screen-reader).
// Plain JavaScript on purpose: it is injected as-is, as a function that takes the class of
// the reader. The reader follows the ARIA standard and nothing else. What it does not know
// is added here, and only that: the flat tree of open shadow roots, content the standard
// keeps from assistive technology (inert, a closed details, everything outside a modal
// dialog), and which changes in a live region count as a change. Nothing is written into the
// DOM. While the reader walks, a few elements carry a property of their own (`childNodes`,
// `hidden`) that is taken away again before the call returns.
(Virtual) => {
  const LIVE_ROLES = { alert: "assertive", alertdialog: "assertive", status: "polite", log: "polite" };
  const ATOMIC_ROLES = new Set(["alert", "alertdialog", "status"]);
  /** Attributes that change what a region says without changing its content. */
  const NAMING = new Set(["aria-label", "aria-labelledby", "alt", "title", "value", "aria-valuetext"]);
  const LIVE_SELECTOR = "[aria-live], [role~=alert], [role~=alertdialog], [role~=status], [role~=log], output";
  const MODAL_SELECTOR = 'dialog:modal, [role=dialog][aria-modal="true"], [role=alertdialog][aria-modal="true"]';
  const WALK_LIMIT = 20000;

  const clean = (text) => (text ?? "").replace(/\s+/g, " ").trim();
  /** The parent in the tree a screen reader walks: through a slot and out of a shadow root. */
  const parentOf = (node) => (node.nodeType === 11 ? (node.host ?? null) : (node.assignedSlot ?? node.parentNode));
  const within = (node, ancestor) => {
    for (let current = node; current; current = parentOf(current)) if (current === ancestor) return true;
    return false;
  };
  /** Every element of a document, also inside its open shadow roots. */
  function* everyElement(root) {
    for (const element of root.querySelectorAll("*")) {
      yield element;
      if (element.shadowRoot) yield* everyElement(element.shadowRoot);
    }
  }
  const roleOf = (element) => (element.localName === "output" && !element.hasAttribute("role") ? "status" : (element.getAttribute("role") ?? "").trim().split(/\s+/)[0]);
  const closedDetails = (element) => {
    const parent = element.parentNode;
    return Boolean(parent) && parent.localName === "details" && !parent.open && !(element.localName === "summary" && element === parent.querySelector(":scope > summary"));
  };

  /** The modal dialog on top, when one is open: assistive technology gets nothing outside it. */
  function topModal() {
    const open = [...everyElement(document)].filter((element) => element.matches(MODAL_SELECTOR));
    return open.filter((element) => exposedBut(element, null)).at(-1) ?? null;
  }

  function exposedBut(element, modal) {
    if (getComputedStyle(element).visibility !== "visible") return false;
    for (let node = element; node && node.nodeType !== 9; node = parentOf(node)) {
      if (node.nodeType !== 1) continue;
      if (node.hidden || node.inert || node.getAttribute("aria-hidden") === "true" || getComputedStyle(node).display === "none" || closedDetails(node)) return false;
    }
    return modal === null || within(element, modal);
  }

  /** Whether assistive technology gets an element at all, for the page as it is at this moment. */
  const exposure = () => {
    const modal = topModal();
    return (element) => exposedBut(element, modal);
  };

  /**
   * Let the reader see the page the way assistive technology gets it. Returns the function
   * that takes it all away again, and what was found on the way.
   */
  function prepare() {
    const undo = [];
    const give = (element, name, get) => {
      Object.defineProperty(element, name, { configurable: true, get });
      undo.push(() => delete element[name]);
    };
    const ownChildren = Object.getOwnPropertyDescriptor(Node.prototype, "childNodes").get;
    const found = { shadowRoots: 0, frames: 0, custom: 0, modal: false };
    for (const element of everyElement(document)) {
      if (element.shadowRoot) {
        const inner = element.shadowRoot;
        found.shadowRoots++;
        give(element, "childNodes", () => inner.childNodes);
      }
      if (element.localName === "slot" && element.getRootNode().nodeType === 11) {
        give(element, "childNodes", () => {
          const assigned = element.assignedNodes();
          return assigned.length > 0 ? assigned : ownChildren.call(element);
        });
      }
      if (element.localName === "iframe" || element.localName === "frame") found.frames++;
      if (element.localName.includes("-")) found.custom++;
      if ((element.inert || closedDetails(element)) && !element.hidden) give(element, "hidden", () => true);
    }
    const modal = topModal();
    if (modal) {
      found.modal = true;
      for (let node = modal; node && node !== document.body && node.nodeType !== 9; node = parentOf(node)) {
        const parent = node.nodeType === 11 ? null : node.parentNode;
        for (const sibling of parent?.children ?? []) if (sibling !== node && !sibling.hidden) give(sibling, "hidden", () => true);
      }
    }
    return { found, restore: () => undo.forEach((step) => step()) };
  }

  /** Everything the reader says when it goes through the page from the top, item by item, with the node it stood on. */
  async function walk() {
    const { found, restore } = prepare();
    const reader = new Virtual();
    const phrases = [];
    const nodes = [];
    let ended = "limit";
    try {
      await reader.start({ container: document.body });
      const seen = new Map();
      for (let step = 0; step < WALK_LIMIT; step++) {
        const phrase = await reader.lastSpokenPhrase();
        const node = reader.activeNode;
        // The reader starts again at the top when it runs off the end.
        if (seen.get(node)?.has(phrase)) {
          ended = "end";
          break;
        }
        if (!seen.has(node)) seen.set(node, new Set());
        seen.get(node).add(phrase);
        phrases.push(phrase);
        nodes.push(node);
        if (phrase === "end of document") {
          ended = "end";
          break;
        }
        await reader.next();
      }
    } finally {
      await reader.stop().catch(() => undefined);
      restore();
    }
    return { phrases, nodes, ended, found };
  }

  /**
   * What is said at an element, or from it on, or from the top of the page. `where` is the
   * place of the element in the notation of the toolbox; `count` is how many items.
   */
  async function read({ where, count }) {
    const { phrases, nodes, ended, found } = await walk();
    const coverage = { shadowRootsRead: found.shadowRoots, framesNotEntered: found.frames, customElements: found.custom, modalOpen: found.modal, items: phrases.length, complete: ended === "end" };
    if (!where) return { spoken: phrases.slice(0, count), from: 0, at: "top", coverage };
    const target = window.__loepm.resolveWhere(where);
    if (!target) return { spoken: [], from: null, at: "gone", coverage };
    let from = nodes.indexOf(target);
    let at = "element";
    if (from < 0) {
      from = nodes.findIndex((node) => within(node, target));
      at = "inside";
    }
    if (from < 0) return { spoken: [], from: null, at: exposure()(target) ? "nothing" : "hidden", coverage };
    return { spoken: phrases.slice(from, from + count), from, at, coverage };
  }

  /**
   * Start listening for what is said by itself: a change in a live region. Of what the reader
   * takes for a change only this goes on to it: a change of content or name, in a region that
   * assistive technology had before the change and still has. What was hidden stays unsaid.
   * A region that was hidden and is shown now is kept apart: the standard does not say
   * whether that is spoken, and real screen readers differ.
   */
  async function listen() {
    const reader = new Virtual();
    /** Whether assistive technology had the element before the change at hand. */
    const shownBefore = new WeakMap();
    const said = [];
    const revealed = [];
    const suppressed = [];
    let attributeChanges = 0;
    const regionOf = (node) => {
      for (let current = node; current && current.nodeType !== 9; current = parentOf(current)) {
        if (current.nodeType === 1 && (current.hasAttribute("aria-live") || LIVE_ROLES[roleOf(current)])) return current;
      }
      return null;
    };
    const politeness = (region) => region.getAttribute("aria-live") ?? LIVE_ROLES[roleOf(region)];
    const atomic = (region) => (region.hasAttribute("aria-atomic") ? region.getAttribute("aria-atomic") === "true" : ATOMIC_ROLES.has(roleOf(region)));
    const note = (element, exposed) => {
      shownBefore.set(element, exposed(element));
      for (const inner of element.querySelectorAll("*")) shownBefore.set(inner, exposed(inner));
    };
    const atStart = exposure();
    for (const element of everyElement(document)) if (element.matches(LIVE_SELECTOR)) note(element, atStart);

    /** The mutations the reader gets; what is said about the others is written down here. */
    function sift(mutations, position) {
      const kept = [];
      const shown = new Set();
      const touched = new Set();
      const exposed = exposure();
      for (const mutation of mutations) {
        const target = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement;
        const region = target ? regionOf(target) : null;
        if (mutation.type === "attributes" && target) {
          // An element around a region is shown: the region comes into reach with it.
          for (const inner of target.querySelectorAll(LIVE_SELECTOR)) {
            if (shownBefore.get(inner) !== false || politeness(inner) === "off" || !exposed(inner)) continue;
            shown.add(inner);
            touched.add(inner);
          }
        }
        if (!region || politeness(region) === "off") continue;
        touched.add(target).add(region);
        for (const added of mutation.addedNodes) if (added.nodeType === 1) touched.add(added);
        const text = clean(region.textContent);
        if (!exposed(region) || !exposed(target)) {
          if (text && !suppressed.includes(text)) suppressed.push(text);
          continue;
        }
        if (shownBefore.get(region) === false) {
          shown.add(region);
          continue;
        }
        if (shownBefore.get(target) === false) {
          // A part of a region that was already there: it is added to what assistive technology has, which the standard calls an addition.
          const phrase = `${politeness(region)}: ${clean((atomic(region) ? region : target).textContent)}`;
          if (said.at(-1)?.phrase !== phrase) said.push({ phrase, position });
          continue;
        }
        if (mutation.type === "attributes" && !NAMING.has(mutation.attributeName)) {
          attributeChanges++;
          continue;
        }
        kept.push(mutation);
      }
      for (const region of shown) {
        const text = clean(region.textContent);
        if (text) revealed.push(`${politeness(region)}: ${text}`);
      }
      for (const element of touched) if (element.isConnected) note(element, exposed);
      return kept;
    }

    const livePhrase = (phrase) => phrase.startsWith("polite: ") || phrase.startsWith("assertive: ");
    class Sifted {
      constructor(callback) {
        this.observer = new MutationObserver(async (mutations) => {
          // Where the reader stood in what it said so far: what is written down here comes before what it says about this change.
          const position = (await reader.spokenPhraseLog()).length;
          callback(sift(mutations, position));
        });
      }
      observe(node, options) {
        this.observer.observe(node, options);
        // A change inside a shadow root does not reach an observer outside it.
        for (const element of everyElement(document)) if (element.shadowRoot) this.observer.observe(element.shadowRoot, options);
      }
      disconnect() {
        this.observer.disconnect();
      }
    }
    await reader.start({ container: document.body, window: { MutationObserver: Sifted, document } });
    const startedAt = (await reader.spokenPhraseLog()).length;

    window.__loepSpeech = {
      async stop() {
        delete window.__loepSpeech;
        // Let the reader finish what it was saying.
        for (let turn = 0; turn < 5; turn++) await Promise.resolve();
        const log = await reader.spokenPhraseLog();
        await reader.stop().catch(() => undefined);
        const spoken = [];
        const push = (phrase) => void (spoken.at(-1) !== phrase && spoken.push(phrase));
        for (let index = startedAt; index <= log.length; index++) {
          for (const entry of said) if (entry.position === index) push(entry.phrase);
          if (index < log.length && livePhrase(log[index])) push(log[index]);
        }
        return { spoken, revealed: [...new Set(revealed)], suppressed, attributeChanges };
      },
    };
    return true;
  }

  return { read, listen };
}
