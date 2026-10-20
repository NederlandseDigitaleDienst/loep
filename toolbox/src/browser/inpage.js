// Runs inside the page under test, installed as window.__loep before any page script.
// Plain JavaScript on purpose: it is injected as-is. It only reads; the single
// exception is applyTextSpacing(), which a probe calls on a page it then discards
// or that it gives back with removeTextSpacing().
// The library is fixed to the window, frozen and not writable: a script of the page cannot swap a function of it
// for one that finds nothing (#143). Installed a second time in the same document, it leaves the first in place.
(() => {
  if (Object.getOwnPropertyDescriptor(window, "__loep")) return;
  const registry = [];

  // What the page writes to the clipboard, recorded where it asks for it and before any page
  // script runs. The clipboard itself is never read: not that of the browser, not that of the machine.
  const clipboardLog = [];
  const CLIPBOARD_TEXT_LIMIT = 500;
  const noteClipboard = (kind, text) => {
    const entry = { kind, text: text === null ? null : text.slice(0, CLIPBOARD_TEXT_LIMIT), length: text === null ? null : text.length, ok: null, error: null };
    clipboardLog.push(entry);
    return entry;
  };
  const answerClipboard = (entry, call) => {
    let promise;
    try {
      promise = call();
    } catch (error) {
      entry.ok = false;
      entry.error = error?.name ?? String(error);
      throw error;
    }
    Promise.resolve(promise).then(
      () => (entry.ok = true),
      (error) => {
        entry.ok = false;
        entry.error = error?.name ?? String(error);
      },
    );
    return promise;
  };
  // A page without https has no clipboard object; there the old copy command below is all a page can use.
  const clipboardPrototype = navigator.clipboard ? Object.getPrototypeOf(navigator.clipboard) : null;
  if (clipboardPrototype?.writeText) {
    const writeText = clipboardPrototype.writeText;
    clipboardPrototype.writeText = function (text) {
      const entry = noteClipboard("writeText", String(text));
      return answerClipboard(entry, () => writeText.call(this, text));
    };
  }
  if (clipboardPrototype?.write) {
    const write = clipboardPrototype.write;
    clipboardPrototype.write = function (items) {
      const entry = noteClipboard("write", null);
      try {
        const list = [...items];
        entry.types = list.flatMap((item) => [...item.types]);
        const plain = list.find((item) => item.types.includes("text/plain"));
        // The text of what is offered is read from the item the page made, not from the clipboard.
        plain?.getType("text/plain").then((blob) => blob.text()).then((text) => {
          entry.text = text.slice(0, CLIPBOARD_TEXT_LIMIT);
          entry.length = text.length;
        }, () => undefined);
      } catch {
        // Not a list of items: the browser will say so in its own answer.
      }
      return answerClipboard(entry, () => write.call(this, items));
    };
  }
  // The old way: select something and run the copy command, which fires a copy event. A user who
  // presses the copy shortcut fires the same event without the command.
  EventTarget.prototype.addEventListener.call(window, "copy", (event) => {
    let text = "";
    try {
      text = event.clipboardData?.getData("text/plain") ?? "";
    } catch {
      // Not readable in this browser; what is selected is the next best answer.
    }
    if (text === "") {
      let active = document.activeElement;
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      const field = active && typeof active.value === "string" && typeof active.selectionStart === "number" ? active.value.slice(active.selectionStart, active.selectionEnd ?? active.selectionStart) : "";
      text = field || String(document.getSelection?.() ?? "");
    }
    // Whether the browser took it cannot be seen from an event; the command below knows.
    noteClipboard("copy-event", text);
  });
  const execCommand = Document.prototype.execCommand;
  Document.prototype.execCommand = function (command, ...rest) {
    if (String(command).toLowerCase() !== "copy" && String(command).toLowerCase() !== "cut") return execCommand.call(this, command, ...rest);
    const before = clipboardLog.length;
    const done = execCommand.call(this, command, ...rest);
    const entry = clipboardLog[before] ?? noteClipboard("execCommand", null);
    entry.kind = "execCommand";
    entry.ok = done === true;
    if (!entry.ok) entry.error = "het kopieercommando gaf onwaar terug";
    return done;
  };
  const clipboardWrites = () => clipboardLog.map((entry) => ({ ...entry }));

  // Count what the page registers, before any page script runs. Whether a page uses
  // timers, gestures or key shortcuts cannot be read from the DOM afterwards.
  const listeners = {};
  const timers = { intervals: [], longTimeouts: [] };
  // The counts say how many elements of a kind listen for a click, not which ones.
  // The elements themselves are kept as well, so a clickable div can be pointed at.
  const clickTargets = new WeakSet();
  // The same for a press of the pointer: which elements hear it, so the press probe tries those and not every element of the same tag.
  const DOWN_EVENT_TYPES = ["mousedown", "pointerdown", "touchstart"];
  const downTargets = new WeakSet();
  // What a control does when it is pointed at, gets focus or is pressed, as far as its own code says:
  // per element and event the code of each listener, as a short hash. Two controls whose listeners
  // have the same code behave alike; that is what makes them one kind for the pointer probes.
  const HOVER_FOCUS_TYPES = ["mouseover", "mouseenter", "mouseout", "mouseleave", "pointerover", "pointerenter", "pointerout", "pointerleave", "focus", "focusin", "blur", "focusout"];
  const listenerCode = new WeakMap();
  const functionSource = Function.prototype.toString;
  const codeOf = (listener) => {
    try {
      const handler = typeof listener === "function" ? listener : typeof listener?.handleEvent === "function" ? listener.handleEvent : null;
      return handler ? shortHash(functionSource.call(handler)) : "-";
    } catch {
      return "?";
    }
  };
  let frozenListeners = null;
  const addEventListener = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, ...rest) {
    const target = this === window ? "window" : this === document ? "document" : (this.localName ?? "other");
    listeners[type] ??= {};
    listeners[type][target] = (listeners[type][target] ?? 0) + 1;
    if (type === "click" && frozenListeners === null && this instanceof Element) clickTargets.add(this);
    // Also after the counts were frozen: a component that only starts to listen when it is first drawn or opened is found in the state it is opened in.
    if (DOWN_EVENT_TYPES.includes(type) && this instanceof Element) downTargets.add(this);
    if ((DOWN_EVENT_TYPES.includes(type) || HOVER_FOCUS_TYPES.includes(type)) && this instanceof Element) {
      const known = listenerCode.get(this) ?? new Set();
      known.add(`${type}:${codeOf(rest[0])}`);
      listenerCode.set(this, known);
    }
    return addEventListener.call(this, type, ...rest);
  };
  // Every timer of a second or more is kept with what it did when it went off (WCAG 2.2.1): whether
  // it navigated, opened a window, emptied a form, removed cookies or stored values, or took text
  // away. Shorter timeouts are only counted: they leave the user no time to act in.
  const TIMER_WATCH_FROM_MS = 1000;
  const TIMER_RECORD_LIMIT = 200;
  const TIMER_WATCHED_FIRINGS = 100;
  const timerLog = [];
  const timerByHandle = new Map();
  let timerShortTimeouts = 0;
  let timerDropped = 0;
  let timerWatchedFirings = 0;
  let runningTimer = null;
  let lastTimer = null;
  let forcingTimers = false;
  const storageCalls = { writes: 0, removals: 0, clears: 0, cookieWrites: 0 };
  const timerOf = () => runningTimer ?? (lastTimer && performance.now() <= lastTimer.until ? lastTimer.record : null);
  const noteTimerEffect = (effect, detail) => {
    const record = timerOf();
    if (!record || record.effects.length >= 10) return;
    if (!record.effects.some((entry) => entry.effect === effect)) record.effects.push(detail ? { effect, ...detail } : { effect });
  };
  const storedKeys = (kind) => {
    try {
      const store = window[kind];
      return Array.from({ length: store.length }, (_, index) => store.key(index));
    } catch {
      return null;
    }
  };
  const storageAtStart = { sessionStorage: storedKeys("sessionStorage"), localStorage: storedKeys("localStorage") };
  const textLines = () => new Set(String(document.body?.innerText ?? "").split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean));
  const FILLABLE = 'input:not([type]),input[type=text],input[type=email],input[type=tel],input[type=number],input[type=search],input[type=password],input[type=url],input[type=date],textarea,select';
  const filledFields = () => deepQueryAll(FILLABLE).filter((field) => field.value !== "" && field.value !== undefined).length;
  const openWindows = () => deepQueryAll("dialog[open],[role=dialog],[role=alertdialog],[aria-modal=true]").filter(isVisible).length;
  const cookieNames = () => {
    try {
      return new Set(document.cookie.split(";").map((part) => part.split("=")[0].trim()).filter(Boolean));
    } catch {
      return new Set();
    }
  };
  const storedCount = () => (storedKeys("sessionStorage")?.length ?? 0) + (storedKeys("localStorage")?.length ?? 0);
  const timerSnapshot = () => ({ url: location.href, lines: textLines(), filled: filledFields(), windows: openWindows(), cookies: cookieNames(), stored: storedCount() });
  const clip = (line) => (line.length > 120 ? `${line.slice(0, 117)}...` : line);
  function compareTimerSnapshot(record, before) {
    const after = timerSnapshot();
    const added = [...after.lines].filter((line) => !before.lines.has(line));
    const removed = [...before.lines].filter((line) => !after.lines.has(line));
    const length = (lines) => lines.reduce((sum, line) => sum + line.length, 0);
    const note = (effect, detail) => {
      if (!record.effects.some((entry) => entry.effect === effect)) record.effects.push(detail ? { effect, ...detail } : { effect });
    };
    if (after.url !== before.url) note("navigates", { to: after.url, how: "address" });
    if (after.windows > before.windows) note("opensWindow", { how: "element" });
    if (after.filled < before.filled) note("clearsForm", { fieldsEmptied: before.filled - after.filled });
    const goneCookies = [...before.cookies].filter((name) => !after.cookies.has(name));
    if (goneCookies.length > 0) note("endsSession", { how: "cookies", names: goneCookies.slice(0, 5) });
    if (after.stored < before.stored) note("endsSession", { how: "storage" });
    if (added.length > 0 && removed.length === 0) note("shows");
    else if (removed.length > 0 && added.length === 0) note("removes");
    else if (added.length > 0) note(length(added) >= length(removed) ? "replaces" : "removes");
    if (added.length > 0) record.shownText = added.slice(0, 3).map(clip);
    if (removed.length > 0) record.removedText = removed.slice(0, 3).map(clip);
  }
  function runTimer(record, handler, self, args) {
    record.fired++;
    if (record.firstFiredAtMs === null) record.firstFiredAtMs = Math.round(performance.now());
    const watch = record.delayMs >= TIMER_WATCH_FROM_MS && record.fired <= 2 && timerWatchedFirings < TIMER_WATCHED_FIRINGS;
    const before = watch ? timerSnapshot() : null;
    if (watch) timerWatchedFirings++;
    runningTimer = record;
    try {
      return typeof handler === "function" ? handler.apply(self, args) : (0, eval)(String(handler));
    } finally {
      runningTimer = null;
      lastTimer = { record, until: performance.now() + 150 };
      // Frameworks draw after the handler returned: the comparison waits for that.
      if (before) record.pendingCompare = new Promise((resolve) => nativeSetTimeout.call(window, () => resolve(compareTimerSnapshot(record, before)), 150));
    }
  }
  const newTimerRecord = (kind, delay) => {
    if (timerLog.length >= TIMER_RECORD_LIMIT) {
      timerDropped++;
      return null;
    }
    const record = { kind, delayMs: Number(delay) || 0, startedAtMs: Math.round(performance.now()), fired: 0, firstFiredAtMs: null, cleared: false, forced: false, effects: [], handle: null, handler: null, args: null };
    timerLog.push(record);
    return record;
  };
  const nativeSetInterval = window.setInterval;
  window.setInterval = function (handler, delay, ...rest) {
    timers.intervals.push(Number(delay) || 0);
    const record = newTimerRecord("interval", delay);
    if (!record) return nativeSetInterval.call(window, handler, delay, ...rest);
    record.handler = handler;
    record.args = rest;
    record.handle = nativeSetInterval.call(window, function (...args) {
      return runTimer(record, handler, this, args);
    }, delay, ...rest);
    timerByHandle.set(record.handle, record);
    return record.handle;
  };
  const nativeSetTimeout = window.setTimeout;
  window.setTimeout = function (handler, delay, ...rest) {
    if (Number(delay) >= 20000) timers.longTimeouts.push(Number(delay));
    if (!(Number(delay) >= TIMER_WATCH_FROM_MS)) {
      timerShortTimeouts++;
      return nativeSetTimeout.call(window, handler, delay, ...rest);
    }
    const record = newTimerRecord("timeout", delay);
    if (!record) return nativeSetTimeout.call(window, handler, delay, ...rest);
    record.handler = handler;
    record.args = rest;
    record.handle = nativeSetTimeout.call(window, function (...args) {
      timerByHandle.delete(record.handle);
      return runTimer(record, handler, this, args);
    }, delay, ...rest);
    timerByHandle.set(record.handle, record);
    return record.handle;
  };
  const nativeClearTimeout = window.clearTimeout;
  const nativeClearInterval = window.clearInterval;
  const clearTimer = (native) =>
    function (handle) {
      const record = timerByHandle.get(handle);
      if (record) {
        record.cleared = true;
        timerByHandle.delete(handle);
      }
      return native.call(window, handle);
    };
  window.clearTimeout = clearTimer(nativeClearTimeout);
  window.clearInterval = clearTimer(nativeClearInterval);
  // What a timer can do that is gone before a comparison sees it: a navigation, a browser window, a reset form, removed cookies and stored values.
  try {
    if (window.navigation)
      addEventListener.call(window.navigation, "navigate", (event) => {
        if (!timerOf()) return;
        noteTimerEffect("navigates", { to: event.destination?.url ?? null, how: event.navigationType });
        // When loep sets a waiting timer off itself, the page stays where it is so the next one can be measured.
        if (forcingTimers && event.cancelable) event.preventDefault();
      });
  } catch {
    // No navigation API in this browser: the address comparison above still sees a change within the page.
  }
  for (const name of ["alert", "confirm", "prompt"]) {
    const native = window[name];
    if (typeof native !== "function") continue;
    window[name] = function (...args) {
      noteTimerEffect("opensWindow", { how: name, text: clip(String(args[0] ?? "")) });
      return native.apply(window, args);
    };
  }
  if (window.HTMLDialogElement) {
    for (const name of ["showModal", "show"]) {
      const native = HTMLDialogElement.prototype[name];
      HTMLDialogElement.prototype[name] = function (...args) {
        noteTimerEffect("opensWindow", { how: "dialog" });
        return native.apply(this, args);
      };
    }
  }
  {
    const nativeReset = HTMLFormElement.prototype.reset;
    HTMLFormElement.prototype.reset = function (...args) {
      noteTimerEffect("clearsForm", { how: "reset" });
      return nativeReset.apply(this, args);
    };
    const proto = Storage.prototype;
    const [setItem, removeItem, clear] = [proto.setItem, proto.removeItem, proto.clear];
    proto.setItem = function (...args) {
      storageCalls.writes++;
      return setItem.apply(this, args);
    };
    proto.removeItem = function (...args) {
      storageCalls.removals++;
      noteTimerEffect("endsSession", { how: "storage" });
      return removeItem.apply(this, args);
    };
    proto.clear = function (...args) {
      storageCalls.clears++;
      noteTimerEffect("endsSession", { how: "storage" });
      return clear.apply(this, args);
    };
    const cookie = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
    if (cookie?.set && cookie.get)
      Object.defineProperty(Document.prototype, "cookie", {
        configurable: true,
        enumerable: cookie.enumerable,
        get() {
          return cookie.get.call(this);
        },
        set(value) {
          storageCalls.cookieWrites++;
          if (/expires=thu, 01 jan 1970|max-age=(0|-)/i.test(String(value))) noteTimerEffect("endsSession", { how: "cookies", names: [String(value).split("=")[0].trim()] });
          cookie.set.call(this, value);
        },
      });
  }

  /** The wait and target of each meta refresh, as its content attribute says them. */
  const metaRefreshes = () =>
    [...document.querySelectorAll('meta[http-equiv="refresh" i]')].map((meta) => {
      const content = meta.getAttribute("content") ?? "";
      const match = /^\s*(\d+(?:\.\d+)?)?\s*(?:[;,]\s*(?:url\s*=\s*)?['"]?([^'"]*)['"]?)?/i.exec(content);
      const seconds = match?.[1] !== undefined ? Number(match[1]) : null;
      const target = match?.[2]?.trim() || null;
      return { content, seconds, url: target ? new URL(target, location.href).href : null };
    });

  /**
   * The timers of the page with what each did, the meta refreshes, and what the page keeps in its stores.
   * With `fireWaiting`, each timer of a second or more that has not gone off yet is set off now, the
   * shortest first, so what a timer of twenty minutes does is seen without waiting twenty minutes. Empty
   * text fields get a value first, so that emptying them shows. That changes the page: only on a page
   * that is thrown away afterwards.
   */
  async function timerReport(options = {}) {
    const elapsedMs = Math.round(performance.now());
    for (const record of timerLog) await record.pendingCompare;
    let fieldsFilled = 0;
    const waiting = timerLog.filter((record) => !record.cleared && record.fired === 0).sort((a, b) => a.delayMs - b.delayMs);
    if (options.fireWaiting && waiting.length > 0) {
      for (const field of deepQueryAll('input:not([type]),input[type=text],input[type=email],input[type=tel],input[type=search],textarea')) {
        if (field.value === "" && isVisible(field) && !field.disabled && !field.readOnly) {
          field.value = "loep";
          fieldsFilled++;
        }
      }
      forcingTimers = true;
      try {
        for (const record of waiting.slice(0, options.maxFired ?? 20)) {
          if (record.cleared || record.fired > 0) continue;
          (record.kind === "interval" ? nativeClearInterval : nativeClearTimeout).call(window, record.handle);
          timerByHandle.delete(record.handle);
          record.forced = true;
          record.dueInMs = Math.max(0, record.startedAtMs + record.delayMs - elapsedMs);
          const before = timerSnapshot();
          try {
            runTimer(record, record.handler, window, record.args ?? []);
          } catch (error) {
            record.error = String(error?.message ?? error).slice(0, 200);
          }
          record.pendingCompare = undefined;
          await new Promise((resolve) => nativeSetTimeout.call(window, resolve, 150));
          compareTimerSnapshot(record, before);
        }
      } finally {
        forcingTimers = false;
      }
    }
    return {
      elapsedMs,
      shortTimeouts: timerShortTimeouts,
      dropped: timerDropped,
      fieldsFilledBeforeFiring: fieldsFilled,
      timers: timerLog.map((record) => ({
        kind: record.kind,
        delayMs: record.delayMs,
        startedAtMs: record.startedAtMs,
        fired: record.fired,
        firstFiredAtMs: record.firstFiredAtMs,
        cleared: record.cleared,
        forced: record.forced,
        effects: record.effects,
        ...(record.shownText ? { shownText: record.shownText } : {}),
        ...(record.removedText ? { removedText: record.removedText } : {}),
        ...(record.error ? { error: record.error } : {}),
      })),
      metaRefresh: metaRefreshes(),
      storage: { atStart: storageAtStart, now: { sessionStorage: storedKeys("sessionStorage"), localStorage: storedKeys("localStorage") }, ...storageCalls },
    };
  }

  /** Every element in the document, descending into open shadow roots, in tree order. */
  function* deepElements(root = document) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node = root.nodeType === Node.ELEMENT_NODE ? root : walker.nextNode();
    while (node) {
      yield node;
      if (node.shadowRoot) yield* deepElements(node.shadowRoot);
      node = walker.nextNode();
    }
  }

  function deepQueryAll(selector) {
    const found = [];
    for (const element of deepElements()) if (element.matches(selector)) found.push(element);
    return found;
  }

  /** Parent across shadow boundaries and slots: what the user perceives as the container. */
  function composedParent(element) {
    if (element.assignedSlot) return element.assignedSlot;
    if (element.parentElement) return element.parentElement;
    const root = element.getRootNode();
    return root instanceof ShadowRoot ? root.host : null;
  }

  function box(element) {
    const rect = element.getBoundingClientRect();
    return {
      x: Math.round(rect.x + window.scrollX),
      y: Math.round(rect.y + window.scrollY),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    return element.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true, opacityProperty: true });
  }

  const STANDS_IN = 'input[type=checkbox],input[type=radio],input[type=range],input[type=file]';

  /**
   * The element a user sees for a control. A custom checkbox hides its native input and
   * draws its own box: the input is the control, its host or label is what is on screen.
   */
  function shownAs(element) {
    if (isVisible(element)) return element;
    if (!element.matches?.(STANDS_IN)) return null;
    return standIn(element);
  }

  function standIn(element) {
    const root = element.getRootNode();
    const host = root instanceof ShadowRoot ? root.host : null;
    if (host && isVisible(host)) return host;
    const label = element.labels?.[0] ?? element.closest("label");
    return label && isVisible(label) ? label : null;
  }

  /**
   * What draws a checkbox or radio button whose input is clipped to a pixel (a visually hidden
   * class): its host or label. shownAs keeps the input itself, as it is still on the page.
   */
  function drawnBy(element) {
    return element.matches?.(STANDS_IN) && isVisible(element) && visuallyHidden(element) ? standIn(element) : null;
  }

  /**
   * Selector chain that locates the element again: one CSS selector per shadow
   * level, outermost first. Joined with " >>> " for people, chained locators for scripts.
   */
  function path(element) {
    const chain = [];
    let current = element;
    while (current) {
      const root = current.getRootNode();
      const parts = [];
      let node = current;
      while (node && node.nodeType === Node.ELEMENT_NODE) {
        if (node.id && root.querySelectorAll(`#${CSS.escape(node.id)}`).length === 1) {
          parts.unshift(`#${CSS.escape(node.id)}`);
          break;
        }
        const siblings = node.parentNode ? [...node.parentNode.children].filter((s) => s.localName === node.localName) : [];
        parts.unshift(siblings.length > 1 ? `${node.localName}:nth-of-type(${siblings.indexOf(node) + 1})` : node.localName);
        node = node.parentElement;
      }
      chain.unshift(parts.join(" > "));
      current = root instanceof ShadowRoot ? root.host : null;
    }
    return chain;
  }

  /** Rendered text of the flattened tree: follows shadow roots and slots, skips what is not displayed. */
  function flatText(node, parts = []) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent.trim()) parts.push(node.textContent);
      return parts;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (["script", "style", "noscript", "template"].includes(node.localName)) return parts;
      // Not checkVisibility(): an element with display:contents has no box but its children are rendered.
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || node.getAttribute("aria-hidden") === "true") return parts;
      if (node.localName === "slot") {
        const assigned = node.assignedNodes({ flatten: true });
        for (const child of assigned.length ? assigned : node.childNodes) flatText(child, parts);
        return parts;
      }
      if (node.shadowRoot) {
        for (const child of node.shadowRoot.childNodes) flatText(child, parts);
        return parts;
      }
    }
    for (const child of node.childNodes) flatText(child, parts);
    return parts;
  }

  function text(element, limit = 200) {
    const own = (element.innerText ?? "").replace(/\s+/g, " ").trim();
    return (own || flatText(element).join(" ").replace(/\s+/g, " ").trim()).slice(0, limit);
  }

  const HEADING = "h1,h2,h3,h4,h5,h6,[role=heading]";
  const MAX_LINKS_IN_CARD = 3;

  function headingLevel(element) {
    return Number(element.getAttribute("aria-level") ?? element.localName.slice(1)) || null;
  }

  /**
   * The heading a user has as context for an element, and where it was found. Normally the
   * nearest preceding heading. A link that covers a card often comes before the card's title
   * in the code; the preceding heading is then the title of the previous card. So when the
   * smallest block around the element that holds a heading holds exactly one, that one is used.
   * A block with more than a few links is a region of the page, not a card.
   */
  function headingContextOf(element, headings = deepQueryAll(HEADING).filter(isVisible)) {
    let preceding = null;
    for (const heading of headings) {
      if (heading.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) preceding = heading;
    }
    for (let block = composedParent(element); block && block !== document.body && !block.matches("main,[role=main]"); block = composedParent(block)) {
      const inside = headings.filter((heading) => isComposedAncestor(block, heading));
      if (inside.length === 0) continue;
      if (inside.length === 1 && inside[0] !== preceding && block.querySelectorAll("a[href]").length <= MAX_LINKS_IN_CARD) return { text: text(inside[0], 80), from: "block" };
      break;
    }
    return { text: preceding ? text(preceding, 80) : "", from: preceding ? "preceding" : null };
  }

  function headingContext(element, headings) {
    return headingContextOf(element, headings).text;
  }

  function register(element) {
    registry.push(element);
    return registry.length - 1;
  }

  function closestComposed(element, selector) {
    let current = element;
    while (current) {
      if (current.matches?.(selector)) return current;
      current = composedParent(current);
    }
    return null;
  }

  const INTERACTIVE =
    'a[href],button,input:not([type=hidden]),select,textarea,summary,[tabindex],[contenteditable=""],[contenteditable=true],' +
    "[role=button],[role=link],[role=checkbox],[role=radio],[role=switch],[role=tab],[role=menuitem],[role=combobox],[role=textbox],[role=slider]";

  /** Real controls: what a browser or a role makes operable. Unlike INTERACTIVE, a bare tabindex does not count. */
  const CONTROL =
    "a[href],button,input:not([type=hidden]),select,textarea,summary,label,option," +
    "[role=button],[role=link],[role=checkbox],[role=radio],[role=switch],[role=tab],[role=menuitem],[role=combobox],[role=textbox],[role=slider]";

  const LANDMARK = "main,nav,header,footer,aside,search,form,dialog,[role=main],[role=navigation],[role=banner],[role=contentinfo],[role=complementary],[role=search],[role=dialog]";

  /** Nearest enclosing page region, e.g. "nav:Hoofdnavigatie": where on the page an element lives. */
  function region(element) {
    let landmark = closestComposed(composedParent(element) ?? element, LANDMARK);
    // A header or footer inside an article, section or card belongs to that block, not to the page.
    while (landmark && ["header", "footer"].includes(landmark.localName) && !landmark.getAttribute("role") && closestComposed(composedParent(landmark), "article,aside,main,nav,section,[role=main],[role=article]")) {
      landmark = closestComposed(composedParent(landmark), LANDMARK);
    }
    if (!landmark) return null;
    const label = landmark.getAttribute("aria-label");
    return `${landmark.getAttribute("role") ?? landmark.localName}${label ? `:${label}` : ""}`;
  }

  function describe(element) {
    const style = getComputedStyle(element);
    return {
      region: region(element),
      ref: register(element),
      tag: element.localName,
      path: path(element),
      box: box(shownAs(element) ?? element),
      visible: shownAs(element) !== null,
      text: text(element),
      roleAttr: element.getAttribute("role"),
      ariaLabel: element.getAttribute("aria-label"),
      ariaHidden: closestComposed(element, '[aria-hidden="true"]') !== null,
      lang: element.getAttribute("lang"),
      fontSizePx: Number.parseFloat(style.fontSize),
    };
  }

  const SENTENCE = "p,li,td,th,dd,figcaption";

  /** The sentence or cell an element stands in, for whoever looks it up in the source of the page. Empty when it stands in none. */
  function sentenceOf(element) {
    const block = closestComposed(element, SENTENCE);
    return block && block !== element ? text(block, 160) : "";
  }

  /**
   * What a sighted user reads in the clickable area of a link without text of its own: a link
   * stretched over a card shows the card. Null when the link has text or covers nothing.
   */
  function coveredText(element) {
    if (text(element) || !isVisible(element)) return null;
    const container = element.offsetParent;
    if (!container || container === document.body) return null;
    const own = element.getBoundingClientRect();
    const outer = container.getBoundingClientRect();
    if (own.width * own.height < 0.6 * outer.width * outer.height) return null;
    return text(container, 120) || null;
  }

  /** The first background colour that is painted behind an element: its own or that of an ancestor. White when none is set. */
  function paintedBehind(element) {
    for (let current = element; current; current = composedParent(current)) {
      const colour = toRgba(getComputedStyle(current).backgroundColor);
      if (colour[3] >= 0.5) return colour;
    }
    return [255, 255, 255, 1];
  }

  /**
   * An input that is not rendered at all cannot take focus. That differs from an input that
   * is only moved out of sight (see shownAs), which a keyboard still reaches. Records how the
   * input is hidden and whether a label for it is on screen: a rebuilt checkbox or radio button.
   */
  function notRendered(element) {
    if (!element.matches?.("input,select,textarea")) return {};
    const hiddenBy = !element.checkVisibility() ? "display: none" : getComputedStyle(element).visibility !== "visible" ? "visibility: hidden" : null;
    if (!hiddenBy) return { hiddenBy: null };
    const label = [...(element.labels ?? [])].find(isVisible) ?? null;
    if (!label) return { hiddenBy, labelVisible: false };
    // The box a user sees is usually drawn by a pseudo-element of the label.
    const drawn = ["::before", "::after"]
      .map((pseudo) => ({ pseudo, style: getComputedStyle(label, pseudo) }))
      .filter(({ style }) => style.content !== "none" && style.display !== "none")
      .map(({ pseudo, style }) => ({ pseudo, width: style.width, height: style.height, borderStyle: style.borderTopStyle, borderWidth: style.borderTopWidth, borderColour: toRgba(style.borderTopColor), background: toRgba(style.backgroundColor) }));
    return { hiddenBy, labelVisible: true, labelBox: box(label), labelPath: path(label), drawnBox: drawn, labelBackground: paintedBehind(label) };
  }

  const CLICK_ATTRIBUTES = ["data-toggle", "data-bs-toggle", "data-dismiss", "data-bs-dismiss", "data-target", "data-bs-target", "data-fancybox", "data-href"];

  /** Why an element looks clickable; empty when nothing says so. */
  function clickSignals(element) {
    const signals = [];
    if (clickTargets.has(element)) signals.push("click-listener");
    if (element.hasAttribute("onclick")) signals.push("onclick");
    for (const name of CLICK_ATTRIBUTES) if (element.hasAttribute(name)) signals.push(name);
    // The cursor is inherited: only the element where the pointer starts is the clickable thing.
    const parent = composedParent(element);
    if (getComputedStyle(element).cursor === "pointer" && (!parent || getComputedStyle(parent).cursor !== "pointer")) signals.push("cursor: pointer");
    if (element.localName === "a" && !element.hasAttribute("href")) signals.push("a-without-href");
    return signals;
  }

  const MAX_CLICKABLES = 150;

  /**
   * Visible elements that respond to a click but are not a control: a div with a click
   * handler, an anchor without href. A keyboard does not reach them and assistive technology
   * does not announce them. Left out are real controls, what sits inside one, and wrappers
   * around one (a card with a handler around its own link).
   */
  function clickables() {
    const found = [];
    for (const element of deepElements(document.body)) {
      if (element.matches(INTERACTIVE) || element.matches(CONTROL) || !isVisible(element)) continue;
      const signals = clickSignals(element);
      if (signals.length === 0) continue;
      if (closestComposed(composedParent(element), CONTROL)) continue;
      let wrapsControl = false;
      for (const inner of deepElements(element)) {
        if (inner !== element && inner.matches(CONTROL) && inner.localName !== "label" && inner.localName !== "option" && isVisible(inner)) {
          wrapsControl = true;
          break;
        }
      }
      if (wrapsControl) continue;
      // A handler on a list item and a pointer cursor on the span inside it are one clickable thing.
      const outer = found.find((entry) => isComposedAncestor(entry.element, element) && text(entry.element) === text(element));
      if (outer) {
        for (const signal of signals) if (!outer.signals.includes(signal)) outer.signals.push(signal);
        continue;
      }
      found.push({ element, signals });
    }
    return found.slice(0, MAX_CLICKABLES).map(({ element, signals }) => ({
      ...describe(element),
      signals,
      // The opening tag: often the class name is the only thing that says what an empty clickable div is.
      html: element.cloneNode(false).outerHTML.slice(0, 200),
      tabindex: element.getAttribute("tabindex"),
      focusable: element.tabIndex >= 0,
    }));
  }

  /** Walk the flattened tree in reading order, skipping what is not displayed (as flatText does). */
  function walkFlat(node, onElement, onText) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent.trim()) onText(node);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (["script", "style", "noscript", "template"].includes(node.localName)) return;
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden" || node.getAttribute("aria-hidden") === "true") return;
    if (onElement(node) === false) return;
    if (node.localName === "slot") {
      const assigned = node.assignedNodes({ flatten: true });
      for (const child of assigned.length ? assigned : node.childNodes) walkFlat(child, onElement, onText);
      return;
    }
    for (const child of (node.shadowRoot ?? node).childNodes) walkFlat(child, onElement, onText);
  }

  const squash = (value) => value.replace(/\s+/g, " ").trim();
  const MAX_CANDIDATES = 60;
  /** More text than this before a heading is not a date or label that belongs to it. */
  const MAX_LEAD_IN = 160;
  const DASH_LINE = /^[-\u2010-\u2015\u2022\u00b7*]\s*\S/;

  /**
   * Places where the markup may say something else than the page shows. These are
   * candidates for a reviewer, not findings: a script cannot tell a label from a sentence.
   */
  function structureCandidates(headings) {
    // The page as one sequence of headings and pieces of text, in reading order.
    const sequence = [];
    walkFlat(
      document.body,
      (element) => {
        if (!headings.includes(element)) return true;
        sequence.push({ heading: element });
        return false;
      },
      (node) => sequence.push({ text: squash(node.textContent), parent: node.parentElement ?? node.getRootNode().host }),
    );
    const brief = (heading) => ({ tag: heading.localName, path: path(heading), text: text(heading, 80), level: headingLevel(heading), region: region(heading) });

    const beforeHeading = [];
    const headingsWithoutContent = [];
    for (const [position, item] of sequence.entries()) {
      if (!item.heading) continue;
      const heading = item.heading;
      // The block a heading titles: the largest container that holds no other heading.
      let block = null;
      for (let current = composedParent(heading); current && current !== document.body && !current.matches("main,[role=main]"); current = composedParent(current)) {
        if (headings.some((other) => other !== heading && isComposedAncestor(current, other))) break;
        block = current;
      }
      const before = [];
      if (block) {
        for (let index = position - 1; index >= 0 && sequence[index].text !== undefined && isComposedAncestor(block, sequence[index].parent); index--) before.unshift(sequence[index].text);
        if (before.length > 0 && before.join(" ").length <= MAX_LEAD_IN) beforeHeading.push({ ...brief(heading), before, block: path(block) });
      }

      // Text up to the next heading. A button or link after the heading is not content of the section.
      let next = position + 1;
      const after = [];
      const controlsAfter = [];
      for (; next < sequence.length && !sequence[next].heading; next++) {
        const control = closestComposed(sequence[next].parent, "a[href],button,[role=button],[role=link]");
        if (control && !isComposedAncestor(control, heading)) controlsAfter.push(sequence[next].text);
        else after.push(sequence[next].text);
      }
      const following = sequence[next]?.heading ?? null;
      const level = headingLevel(heading);
      const closes = following === null || (level !== null && (headingLevel(following) ?? 0) <= level);
      // The heading of a closed expander has its content one activation away.
      const expands = heading.querySelector("[aria-expanded],button") !== null || closestComposed(heading, "[aria-expanded],summary,button") !== null;
      if (after.length === 0 && closes && !expands) {
        headingsWithoutContent.push({ ...brief(heading), nextHeading: following ? `h${headingLevel(following)} ${text(following, 60)}` : null, controlsAfter: controlsAfter.slice(0, 3), before: before.slice(-3) });
      }
    }

    // A card title on the level of the heading of the section that the cards are in.
    const headingsIn = (container) => headings.filter((other) => isComposedAncestor(container, other));
    const sharesClass = (first, second) => first.localName === second.localName && [...first.classList].some((name) => second.classList.contains(name));
    // The card a heading titles: a list item, article or slide, or one of a row of alike blocks, each with one heading.
    const cardOf = (heading) => {
      for (let current = composedParent(heading); current && current !== document.body && headingsIn(current).length === 1; current = composedParent(current)) {
        if (current.matches("li,article,[role=listitem],[role=article],[aria-roledescription=slide]")) return current;
        const twins = [...(current.parentElement?.children ?? [])].filter((sibling) => sibling !== current && sharesClass(sibling, current) && headingsIn(sibling).length === 1);
        if (twins.length > 0) return current;
      }
      return null;
    };
    const cardTitlesAtSectionLevel = [];
    for (const heading of headings) {
      const card = cardOf(heading);
      if (!card) continue;
      let sectionHeading = null;
      for (const other of headings) {
        if (other === heading || !(other.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
        // Not the title of another card, nor a heading inside some other block in the same row of cards.
        const row = card.parentElement;
        if (cardOf(other) !== null || (row && row.contains(other) && other.parentElement !== row)) continue;
        sectionHeading = other;
      }
      if (sectionHeading && headingLevel(heading) !== null && headingLevel(sectionHeading) === headingLevel(heading)) {
        cardTitlesAtSectionLevel.push({ ...brief(heading), sectionHeading: text(sectionHeading, 80), card: path(card) });
      }
    }

    // A paragraph that opens with bold text and a line break, or that is bold as a whole: a heading in disguise?
    const boldLeads = [];
    const meaningful = (element) => [...element.childNodes].filter((node) => node.nodeType === Node.ELEMENT_NODE || node.textContent.trim());
    for (const element of deepQueryAll("p,li,dd")) {
      const children = meaningful(element);
      const first = children[0];
      if (!first || first.nodeType !== Node.ELEMENT_NODE || !first.matches("strong,b") || !isVisible(element)) continue;
      const lead = text(first, 100);
      if (!lead || closestComposed(element, "a[href],button,label")) continue;
      const breaksAfter = children[1]?.nodeName === "BR" || (first.lastElementChild?.localName === "br" && children.length > 1);
      const whole = children.length === 1 && element.localName === "p" && lead.length <= 100;
      if (!breaksAfter && !whole) continue;
      const rest = squash(children.slice(1).map((node) => node.textContent).join(" ")).slice(0, 80);
      boldLeads.push({ tag: element.localName, path: path(element), region: region(element), text: lead, kind: whole ? "whole-paragraph" : "lead-and-break", followedBy: rest });
    }

    // Lines inside one element that each start with a dash: a list typed by hand.
    const dashLines = [];
    for (const element of deepQueryAll("p,li,dd,td")) {
      if (!element.querySelector(":scope > br") || !isVisible(element)) continue;
      const lines = [""];
      for (const node of element.childNodes) {
        if (node.nodeName === "BR") lines.push("");
        else if (!node.matches?.("ul,ol")) lines[lines.length - 1] += node.textContent;
      }
      const dashed = lines.map(squash).filter((line) => DASH_LINE.test(line));
      if (dashed.length >= 2) dashLines.push({ tag: element.localName, path: path(element), region: region(element), text: squash(lines[0]).slice(0, 80), lines: dashed.slice(0, 6).map((line) => line.slice(0, 60)), lineCount: dashed.length });
    }

    return {
      beforeHeading: beforeHeading.slice(0, MAX_CANDIDATES),
      headingsWithoutContent: headingsWithoutContent.slice(0, MAX_CANDIDATES),
      cardTitlesAtSectionLevel: cardTitlesAtSectionLevel.slice(0, MAX_CANDIDATES),
      boldLeads: boldLeads.slice(0, MAX_CANDIDATES),
      dashLines: dashLines.slice(0, MAX_CANDIDATES),
    };
  }

  function collectFacts() {
    registry.length = 0;
    const all = [...deepElements()];
    const select = (selector) => all.filter((element) => element.matches(selector));

    const headings = select(HEADING).map((element) => ({
      ...describe(element),
      level: headingLevel(element),
    }));
    const visibleHeadings = select(HEADING).filter(isVisible);

    const landmarks = select(
      "main,nav,header,footer,aside,section[aria-label],section[aria-labelledby],form[aria-label],form[aria-labelledby],search," +
        "[role=main],[role=navigation],[role=banner],[role=contentinfo],[role=complementary],[role=search],[role=region],[role=form]",
    )
      .filter(isVisible)
      .map((element) => ({ ...describe(element), inMain: closestComposed(composedParent(element), "main,[role=main]") !== null }));

    const images = select("img,svg,[role=img],canvas,input[type=image],area,object,embed")
      .filter((element) => element.localName !== "svg" || !element.parentElement?.closest("svg"))
      .map((element) => ({
        ...describe(element),
        alt: element.getAttribute("alt"),
        src: element.currentSrc || element.getAttribute("src") || null,
        svgTitle: element.localName === "svg" ? (element.querySelector(":scope > title")?.textContent ?? null) : null,
        inInteractive: closestComposed(composedParent(element) ?? element, INTERACTIVE)?.localName ?? null,
        interactiveText: text(closestComposed(composedParent(element) ?? element, INTERACTIVE) ?? document.createElement("i"), 80),
        context: headingContext(element, visibleHeadings),
      }));

    const backgroundImages = all
      .filter((element) => isVisible(element) && getComputedStyle(element).backgroundImage.includes("url("))
      .map((element) => ({ ...describe(element), backgroundImage: getComputedStyle(element).backgroundImage.slice(0, 200) }));

    const links = select("a[href],[role=link]").map((element) => {
      const context = headingContextOf(element, visibleHeadings);
      // Only a sentence, paragraph, list item or table cell is context that assistive technology can give with a link.
      const sentence = closestComposed(composedParent(element), SENTENCE);
      return {
        ...describe(element),
        href: element.href ?? element.getAttribute("href"),
        target: element.getAttribute("target"),
        context: context.text,
        contextFrom: context.from,
        sentence: sentence ? text(sentence, 160) : null,
        sentenceFrom: sentence ? sentence.localName : null,
        parentTag: composedParent(element)?.localName ?? null,
        coveredText: coveredText(element),
      };
    });

    const controls = select(INTERACTIVE)
      .filter((element) => !element.matches("a[href]"))
      .map((element) => ({
        ...describe(element),
        type: element.getAttribute("type"),
        name: element.getAttribute("name"),
        autocomplete: element.getAttribute("autocomplete"),
        required: element.required === true || element.getAttribute("aria-required") === "true",
        placeholder: element.getAttribute("placeholder"),
        tabindex: element.getAttribute("tabindex"),
        disabled: element.disabled === true || element.getAttribute("aria-disabled") === "true",
        labelText: element.labels ? [...element.labels].map((label) => text(label, 120)).join(" | ") : null,
        inForm: closestComposed(element, "form,[role=form],nldd-form") !== null,
        ...notRendered(element),
      }));

    const langParts = select("[lang]")
      .filter((element) => element !== document.documentElement)
      .map((element) => ({ ...describe(element), langValue: element.getAttribute("lang") }));

    const iframes = select("iframe,frame").map((element) => ({
      ...describe(element),
      title: element.getAttribute("title"),
      src: element.getAttribute("src"),
    }));

    const tables = select("table,[role=table],[role=grid]").map((element) => ({
      ...describe(element),
      caption: text(element.querySelector("caption") ?? document.createElement("i"), 120),
      headerCells: element.querySelectorAll("th,[role=columnheader],[role=rowheader]").length,
      rows: element.querySelectorAll("tr,[role=row]").length,
      layoutRole: element.getAttribute("role") === "presentation" || element.getAttribute("role") === "none",
    }));

    const ids = new Map();
    for (const element of all) {
      if (!element.id) continue;
      const key = `${path(element).length}:${element.id}`;
      ids.set(key, (ids.get(key) ?? 0) + (element.getRootNode() === document ? 1 : 0));
    }

    const viewportMeta = document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? null;
    const mainText = flatText(deepQueryAll("main,[role=main]")[0] ?? document.body).join(" ").replace(/\s+/g, " ").trim().slice(0, 4000);

    return {
      url: location.href,
      title: document.title,
      lang: document.documentElement.getAttribute("lang"),
      dir: document.documentElement.getAttribute("dir"),
      viewportMeta,
      headings,
      landmarks,
      images,
      backgroundImages,
      links,
      controls,
      clickables: clickables(),
      structure: structureCandidates(visibleHeadings),
      langParts,
      iframes,
      tables,
      mainText,
      listeners: frozenListeners ?? listeners,
      timers,
      counts: {
        elements: all.length,
        shadowRoots: all.filter((element) => element.shadowRoot).length,
        customElements: [...new Set(all.map((e) => e.localName).filter((name) => name.includes("-")))].sort(),
        audio: select("audio").length,
        video: select("video").length,
        autoplayMedia: select("audio[autoplay],video[autoplay]").length,
        track: select("track").length,
        canvas: select("canvas").length,
        objectEmbed: select("object,embed").length,
        iframe: iframes.length,
        forms: select("form,[role=form],nldd-form").length,
        passwordFields: select('input[type="password"]').length,
        fileInputs: select('input[type="file"]').length,
        draggable: select('[draggable="true"]').length,
        dialogs: select("dialog,[role=dialog],[role=alertdialog]").length,
        details: select("details").length,
        liveRegions: select("[aria-live],[role=status],[role=alert],[role=log],output").length,
        accesskeys: select("[accesskey]").length,
        metaRefresh: document.querySelectorAll('meta[http-equiv="refresh" i]').length,
        marqueeBlink: select("marquee,blink").length,
        positiveTabindex: select("[tabindex]").filter((element) => Number(element.getAttribute("tabindex")) > 0).length,
        duplicateIds: [...ids.values()].filter((count) => count > 1).length,
        runningAnimations: document.getAnimations().filter((animation) => animation.playState === "running").length,
        tables: tables.length,
        lists: select("ul,ol,dl,[role=list]").length,
        images: images.length,
        headings: headings.length,
      },
    };
  }

  /** Tag vocabulary of the page: pages built from the same components share a template. */
  function templateSignature() {
    return [...new Set([...deepElements(document.body)].map((element) => element.localName))].sort().join(" ");
  }

  /** Text and structure without volatile attributes: the fingerprint of what was evaluated. */
  function contentSnapshot() {
    const volatile = new Set(["nonce", "style", "data-hydrated"]);
    const lines = [];
    const visit = (node, depth) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const value = node.textContent.replace(/\s+/g, " ").trim();
        if (value) lines.push(`${"  ".repeat(depth)}"${value}"`);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE || ["script", "style", "noscript"].includes(node.localName)) return;
      const attributes = [...node.attributes]
        .filter((attribute) => !volatile.has(attribute.name))
        .map((attribute) => `${attribute.name}=${JSON.stringify(attribute.value)}`)
        .sort()
        .join(" ");
      lines.push(`${"  ".repeat(depth)}<${node.localName}${attributes ? ` ${attributes}` : ""}>`);
      if (node.shadowRoot) {
        lines.push(`${"  ".repeat(depth + 1)}#shadow-root`);
        for (const child of node.shadowRoot.childNodes) visit(child, depth + 2);
      }
      for (const child of node.childNodes) visit(child, depth + 1);
    };
    visit(document.documentElement, 0);
    return lines.join("\n");
  }

  // What a visitor reads, hears or operates, with its value: a change here is a change of the page.
  const STEADY_ATTRIBUTES = new Set(["role", "alt", "title", "lang", "dir", "type", "name", "placeholder", "label", "abbr", "scope", "colspan", "rowspan", "autocomplete", "inputmode", "accesskey", "contenteditable", "disabled", "required", "readonly", "multiple", "min", "max", "step", "pattern", "maxlength", "controls", "autoplay", "loop", "muted", "download", "target", "method"]);
  // Addresses: kept without the tokens a new build or a new session puts in them.
  const ADDRESS_ATTRIBUTES = new Set(["href", "src", "poster", "action", "data", "cite"]);
  // References to an id: an id can be made anew on every load, so only that there is a reference counts.
  const REFERENCE_ATTRIBUTES = new Set(["for", "headers", "list", "form", "aria-labelledby", "aria-describedby", "aria-controls", "aria-owns", "aria-activedescendant", "aria-details", "aria-errormessage", "aria-flowto"]);
  // States a script sets after loading, or a slider changes with time: the same page, in another moment.
  const MOMENT_ATTRIBUTES = new Set(["aria-hidden", "aria-expanded", "aria-selected", "aria-pressed", "aria-checked", "aria-current", "aria-busy", "aria-valuenow", "aria-valuetext"]);
  const MONTH = "(?:januari|january|jan|februari|february|feb|maart|march|mrt|mar|april|apr|mei|may|juni|june|jun|juli|july|jul|augustus|august|aug|september|sept|sep|oktober|october|okt|oct|november|nov|december|dec)(?![a-z])\\.?";
  const WEEKDAY = "(?:(?:maan|dins|woens|donder|vrij|zater|zon)dag|(?:mon|tues|wednes|thurs|fri|satur|sun)day|ma|di|wo|do|vr|za|zo|mon|tue|wed|thu|fri|sat|sun)\\.?,?\\s+";
  const MOMENTS = [
    /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/g,
    new RegExp(`\\b(?:${WEEKDAY})?\\d{1,2}[-/.]\\d{1,2}[-/.](?:\\d{4}|\\d{2})\\b`, "gi"),
    new RegExp(`\\b(?:${WEEKDAY})?\\d{1,2}(?:st|nd|rd|th|e)?\\s+${MONTH}(?:\\s+\\d{4})?`, "gi"),
    new RegExp(`\\b(?:${WEEKDAY})?${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b`, "gi"),
    /\b\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:uur|u|am|pm)\b)?/gi,
    /\b\d{1,2}\.\d{2}\s*(?:uur|u)\b/gi,
    /\b\d+\s+(?:seconden?|sec|minuut|minuten|min|uur|uren|dagen|dag|weken|week|maanden|maand|jaren|jaar|seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s+(?:geleden|ago)\b/gi,
    /\b(?:vandaag|gisteren|morgen|today|yesterday|tomorrow)\b/gi,
  ];

  /** Text without the dates and times that differ from one day or load to the next. */
  function withoutMoments(text) {
    return MOMENTS.reduce((value, pattern) => value.replace(pattern, "{tijd}"), text);
  }

  /** An identifier or token in an address or name: a build hash, a version stamp, a session or a uuid. */
  function withoutTokens(value) {
    return value
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "~")
      .replace(/[A-Za-z0-9]{6,}/g, (run) => (/\d/.test(run) && (run.length >= 8 || /^[0-9a-f]+$/i.test(run)) ? "~" : run));
  }

  /** An address as it points: on the same site without the origin; for a file the page loads (an image, a frame) without the query. */
  function steadyAddress(raw, name) {
    const value = raw.trim();
    if (/^(?:data|blob):/i.test(value)) return value.slice(0, value.indexOf(":") + 1);
    try {
      const url = new URL(value, document.baseURI);
      if (!/^https?:$/.test(url.protocol)) return withoutTokens(value);
      const loaded = name !== "href" && name !== "action" && name !== "cite";
      const place = `${url.origin === location.origin ? "" : url.origin}${url.pathname}${loaded ? "" : url.search}${url.hash}`;
      return withoutTokens(place);
    } catch {
      return withoutTokens(value);
    }
  }

  /**
   * Text, structure and controls of the page as a visitor meets them, without what differs from one
   * load to the next while the page stays the same: the head with its build hashes, class names, ids
   * and the references to them, styles, nonces, data attributes, states a script or a slider sets,
   * tokens in addresses, and dates and times in the text. A later sweep compares this to decide
   * whether a page is still the page that was measured.
   */
  function visitorSnapshot() {
    const lines = [`title "${withoutMoments(document.title.replace(/\s+/g, " ").trim())}"`, `lang ${document.documentElement.getAttribute("lang") ?? ""}`];
    const attributesOf = (element) => {
      const kept = [];
      for (const { name, value } of element.attributes) {
        if (REFERENCE_ATTRIBUTES.has(name)) kept.push(name);
        else if (ADDRESS_ATTRIBUTES.has(name)) kept.push(`${name}=${JSON.stringify(steadyAddress(value, name))}`);
        else if (name === "tabindex") {
          // Only a positive order is part of the page (2.4.3); 0 and -1 move with a slider.
          if (Number(value) > 0) kept.push(`${name}=${JSON.stringify(value)}`);
        } else if (name === "value") {
          // The label of a button; the value of a field is filled in, or a token of the session.
          if (element.localName === "input" && ["button", "submit", "reset"].includes(element.type)) kept.push(`${name}=${JSON.stringify(withoutMoments(value))}`);
        } else if (name === "name") kept.push(`${name}=${JSON.stringify(withoutTokens(value))}`);
        else if (STEADY_ATTRIBUTES.has(name) || (name.startsWith("aria-") && !MOMENT_ATTRIBUTES.has(name))) kept.push(`${name}=${JSON.stringify(withoutMoments(value.replace(/\s+/g, " ").trim()))}`);
      }
      return kept.sort().join(" ");
    };
    const visitChildren = (nodes, depth) => {
      // Text split over several nodes is one text: a script may split it differently on another load.
      let text = "";
      const flush = () => {
        const value = withoutMoments(text.replace(/\s+/g, " ").trim());
        if (value) lines.push(`${"  ".repeat(depth)}"${value}"`);
        text = "";
      };
      for (const child of nodes) {
        if (child.nodeType === Node.TEXT_NODE) text += child.textContent;
        else if (child.nodeType === Node.ELEMENT_NODE) {
          if (["script", "style", "noscript", "template", "link", "meta", "base"].includes(child.localName)) continue;
          flush();
          visit(child, depth);
        }
      }
      flush();
    };
    const visit = (element, depth) => {
      const attributes = attributesOf(element);
      lines.push(`${"  ".repeat(depth)}<${element.localName}${attributes ? ` ${attributes}` : ""}>`);
      if (element.shadowRoot) {
        lines.push(`${"  ".repeat(depth + 1)}#shadow-root`);
        visitChildren(element.shadowRoot.childNodes, depth + 2);
      }
      visitChildren(element.childNodes, depth + 1);
    };
    if (document.body) visit(document.body, 0);
    return lines.join("\n");
  }

  /**
   * The links to follow: those on the origin of the page, and on the other origins of the site
   * when it has more than one (`origins`, given with --also-origin at inventory).
   */
  function sameOriginLinks(origins = []) {
    const own = new Set([location.origin, ...origins]);
    const urls = new Set();
    for (const element of deepElements()) {
      const raw = element.getAttribute?.("href");
      if (!raw || element.localName === "link") continue;
      try {
        const url = new URL(raw, document.baseURI);
        if (!own.has(url.origin)) continue;
        url.hash = "";
        urls.add(url.href);
      } catch {
        // Not a URL (for example "javascript:"); nothing to follow.
      }
    }
    return [...urls].sort();
  }

  function deepActiveElement() {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active;
  }

  /**
   * The nearest ancestor that clips or scrolls horizontally. Content past the edge of the
   * window can be reached when that container scrolls, and cannot when it only clips.
   * Null when nothing clips: then the page itself scrolls sideways.
   */
  function overflowContainer(element) {
    for (let current = composedParent(element); current; current = composedParent(current)) {
      const overflowX = getComputedStyle(current).overflowX;
      if (overflowX === "visible") continue;
      return { tag: current.localName, path: path(current), overflowX, scrollWidth: current.scrollWidth, clientWidth: current.clientWidth };
    }
    return null;
  }

  /**
   * Whether an element that hides its overflow and overflows holds the text that is cut off:
   * text of its own, or a descendant with text whose box sticks out past its padding box. A
   * tile with a fixed height and overflow:hidden holds its lines in spans, and the line that
   * falls away belongs to a span; an image or a decoration that sticks out does not count.
   */
  function cutsOffText(element) {
    const outer = element.getBoundingClientRect();
    const left = outer.left + element.clientLeft;
    const top = outer.top + element.clientTop;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim()) continue;
      const holder = node.parentElement;
      if (holder === element) return true;
      if (!isVisible(holder)) continue;
      const rect = holder.getBoundingClientRect();
      if (rect.left < left - 1 || rect.top < top - 1 || rect.right > left + element.clientWidth + 1 || rect.bottom > top + element.clientHeight + 1) return true;
    }
    return false;
  }

  function overflowReport() {
    const viewportWidth = document.documentElement.clientWidth;
    const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    const offenders = [];
    const clipped = [];
    for (const element of deepElements(document.body)) {
      if (!isVisible(element)) continue;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (rect.right > viewportWidth + 1 && rect.width > 0 && style.position !== "fixed") {
        const parent = composedParent(element);
        const parentOverflows = parent && parent.getBoundingClientRect().right > viewportWidth + 1;
        if (!parentOverflows) offenders.push({ ...describe(element), right: Math.round(rect.right), overflowContainer: overflowContainer(element) });
      }
      const hidesOverflow = ["hidden", "clip"].includes(style.overflowX) || ["hidden", "clip"].includes(style.overflowY);
      if (hidesOverflow && (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1) && cutsOffText(element)) {
        clipped.push({
          ...describe(element),
          scroll: [element.scrollWidth, element.scrollHeight],
          client: [element.clientWidth, element.clientHeight],
          textOverflow: style.textOverflow,
        });
      }
    }
    return { viewportWidth, scrollWidth, horizontalScroll: scrollWidth > viewportWidth + 1, offenders: offenders.slice(0, 50), clipped: clipped.slice(0, 50) };
  }

  /**
   * Force the WCAG 1.4.12 values on all text. A component can pin spacing on slotted
   * content with "::slotted(...) !important", which beats any style from outside the
   * shadow root; a user stylesheet would still win. To see what happens when the text
   * does get the wider spacing, the rule is added inside every shadow root as well,
   * with a selector specific enough to win there.
   *
   * It stays in force for what comes later: a menu that makes its items anew each time it
   * opens gets them in new shadow roots, and a component library assigns its own list of
   * sheets to a root right after creating it. So every shadow root attached from now on gets
   * the sheet, a root that is added to the document later gets it, and an assignment to
   * adoptedStyleSheets keeps it. Calling this again styles what is new and measures again.
   */
  function applyTextSpacing() {
    if (!spacing) startTextSpacing();
    let roots = 0;
    for (const element of deepElements()) {
      if (!element.shadowRoot) continue;
      spacing.style(element.shadowRoot);
      roots++;
    }
    // Which visible text still does not have the spacing: there the measurement says nothing.
    const resistant = [];
    for (const element of deepElements(document.body)) {
      const hasText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      if (!hasText || !isVisible(element)) continue;
      const style = getComputedStyle(element);
      const expected = Number.parseFloat(style.fontSize) * 0.12;
      if (Math.abs(Number.parseFloat(style.letterSpacing) - expected) > 0.5) resistant.push(describe(element));
    }
    return { shadowRootsStyled: roots, resistant: resistant.slice(0, 40), resistantCount: resistant.length };
  }

  /** The wider text spacing while it is in force: its sheet, and how a shadow root gets it. Null when it is not in force. */
  let spacing = null;
  let spacingHooked = false;
  const nativeAttachShadow = Element.prototype.attachShadow;
  const nativeSheetLists = new Map([Document.prototype, ShadowRoot.prototype].map((proto) => [proto, Object.getOwnPropertyDescriptor(proto, "adoptedStyleSheets")]));
  const sheetListOf = (root) => nativeSheetLists.get(root instanceof ShadowRoot ? ShadowRoot.prototype : Document.prototype);

  function startTextSpacing() {
    const values = "line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important";
    const strong = ":not(#loep-a):not(#loep-b)";
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`*${strong}{${values}}p${strong}{margin-bottom:2em!important}::slotted(${strong}){${values}}`);
    const observed = new WeakSet();
    // A part that is added to the document later, with shadow roots of its own, gets the sheet in each of them.
    const observer = new MutationObserver((records) => {
      if (!spacing) return;
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          for (const element of deepElements(node)) if (element.shadowRoot) spacing.style(element.shadowRoot);
        }
      }
    });
    const adopt = (root) => {
      const list = sheetListOf(root);
      const now = [...list.get.call(root)];
      if (!now.includes(sheet)) list.set.call(root, [...now, sheet]);
    };
    spacing = {
      sheet,
      observer,
      style(root) {
        adopt(root);
        if (observed.has(root)) return;
        observed.add(root);
        observer.observe(root, { childList: true, subtree: true });
      },
    };
    if (!spacingHooked) {
      spacingHooked = true;
      // A root attached from now on gets the sheet at once, also one that is closed; a list assigned to a root or the document keeps it.
      // Both hooks do nothing once the spacing is taken away, so a page that wraps these itself afterwards is left alone.
      Element.prototype.attachShadow = function (init) {
        const root = nativeAttachShadow.call(this, init);
        spacing?.style(root);
        return root;
      };
      for (const [proto, descriptor] of nativeSheetLists) {
        if (!descriptor?.set) continue;
        Object.defineProperty(proto, "adoptedStyleSheets", {
          ...descriptor,
          set(list) {
            const own = spacing?.sheet;
            descriptor.set.call(this, own && !list.includes(own) ? [...list, own] : list);
          },
        });
      }
    }
    adopt(document);
    observer.observe(document, { childList: true, subtree: true });
  }

  /** Take the wider text spacing away again, from the document and from every shadow root. */
  function removeTextSpacing() {
    if (!spacing) return;
    const { sheet, observer } = spacing;
    spacing = null;
    observer.disconnect();
    const strip = (root) => {
      const list = sheetListOf(root);
      list.set.call(root, [...list.get.call(root)].filter((entry) => entry !== sheet));
    };
    strip(document);
    for (const element of deepElements()) if (element.shadowRoot) strip(element.shadowRoot);
  }

  function bodyText() {
    return flatText(document.body).map((chunk) => chunk.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
  }

  function frameSources() {
    return deepQueryAll("iframe,frame")
      .map((frame) => frame.src)
      .filter((src) => /^https?:/.test(src));
  }

  function focusState() {
    const element = deepActiveElement();
    if (!element || element === document.body || element === document.documentElement) return null;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const centre = [rect.x + rect.width / 2, rect.y + rect.height / 2];
    let top = document.elementFromPoint(centre[0], centre[1]);
    for (let inner = top?.shadowRoot?.elementFromPoint(centre[0], centre[1]); inner && inner !== top; inner = top.shadowRoot?.elementFromPoint(centre[0], centre[1])) {
      top = inner;
    }
    // Something else is painted over the centre of the focused element (WCAG 2.4.11).
    const covered = top !== null && top !== element && !isComposedAncestor(element, top) && !isComposedAncestor(top, element);
    return {
      ...describe(element),
      scroll: [window.scrollX, window.scrollY],
      inViewport: rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth,
      viewportBox: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`,
      outlineOffset: style.outlineOffset,
      boxShadow: style.boxShadow,
      focusVisible: element.matches(":focus-visible"),
      coveredBy: covered ? describe(top).path : null,
      href: element.getAttribute("href"),
    };
  }

  /**
   * Where the focused skip link points, read before it is activated: the element its href names,
   * and the element that follows it in the code, which a component without href moves focus to.
   * For each whether it is rendered at all: a target that is not, such as a <noscript> block,
   * cannot take focus, and the link then does nothing.
   */
  function skipLinkTarget() {
    const link = deepActiveElement();
    if (!link) return null;
    const brief = (element) => ({ tag: element.localName, id: element.id || null, path: path(element), rendered: element.getClientRects().length > 0, tabindex: element.getAttribute("tabindex") });
    const href = link.getAttribute("href");
    const id = href && href.startsWith("#") ? decodeURIComponent(href.slice(1)) : null;
    const named = id ? (deepQueryAll("[id]").find((element) => element.id === id) ?? null) : null;
    // Out of the shadow tree first: what follows the component is what follows the link for the page.
    let outer = link;
    for (let root = outer.getRootNode(); root instanceof ShadowRoot; root = outer.getRootNode()) outer = root.host;
    const following = outer.nextElementSibling;
    return { href, target: id === null ? null : named ? brief(named) : { missing: id }, following: following ? brief(following) : null };
  }

  /** Where a registered element is painted now, and whether it is painted at all: to check that a screenshot clip shows it. */
  function paintedBox(ref) {
    const element = registry[ref];
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { visible: isVisible(element), viewportBox: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } };
  }

  function isComposedAncestor(ancestor, element) {
    let current = element;
    while (current) {
      if (current === ancestor) return true;
      current = composedParent(current);
    }
    return false;
  }

  function targetSizes() {
    return deepQueryAll(INTERACTIVE)
      .filter((element) => shownAs(element) !== null && !element.disabled)
      .map((element) => {
        const rect = shownAs(element).getBoundingClientRect();
        const inline = getComputedStyle(element).display === "inline" && closestComposed(composedParent(element) ?? element, "p,li,td,dd,span") !== null;
        return { ...describe(element), width: Math.round(rect.width * 10) / 10, height: Math.round(rect.height * 10) / 10, inlineInText: inline };
      });
  }

  /** Regions that scroll on their own; a keyboard user needs a way to scroll each of them (WCAG 2.1.1). */
  function scrollRegions() {
    const regions = [];
    for (const element of deepElements(document.body)) {
      if (!isVisible(element)) continue;
      const style = getComputedStyle(element);
      const scrollsY = ["auto", "scroll"].includes(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
      const scrollsX = ["auto", "scroll"].includes(style.overflowX) && element.scrollWidth > element.clientWidth + 1;
      if (!scrollsY && !scrollsX) continue;
      let focusableInside = false;
      for (const inner of deepElements(element)) {
        if (inner !== element && inner.matches(INTERACTIVE) && inner.tabIndex >= 0 && isVisible(inner)) {
          focusableInside = true;
          break;
        }
      }
      regions.push({ ...describe(element), scrollsX, scrollsY, selfFocusable: element.tabIndex >= 0, focusableInside });
    }
    return regions;
  }

  /** Content that moves, blinks or plays by itself, measured with motion allowed. */
  function motionReport() {
    const animations = document.getAnimations().filter((animation) => animation.playState === "running");
    return {
      runningAnimations: animations.length,
      longOrInfinite: animations
        .map((animation) => {
          const timing = animation.effect?.getComputedTiming?.() ?? {};
          const target = animation.effect?.target;
          return { name: animation.animationName ?? animation.constructor.name, iterations: String(timing.iterations), durationMs: Number(timing.duration) || 0, target: target ? describe(target) : null };
        })
        .filter((animation) => animation.iterations === "Infinity" || animation.durationMs > 5000)
        .slice(0, 20),
      gifImages: deepQueryAll('img[src$=".gif" i]').length,
      autoplayMedia: deepQueryAll("audio[autoplay],video[autoplay]").length,
      marqueeBlink: deepQueryAll("marquee,blink").length,
      intervals: timers.intervals,
      longTimeouts: timers.longTimeouts,
    };
  }

  /** Find an element again from the selector chain that path() produced. */
  function resolve(chain) {
    let root = document;
    let element = null;
    for (const segment of chain) {
      const parts = segment.split(" > ");
      let current = null;
      for (const [index, part] of parts.entries()) {
        if (part.startsWith("#")) {
          current = (index === 0 ? root : current).querySelector(part);
        } else {
          const [, name, nth] = /^([^:]+)(?::nth-of-type\((\d+)\))?$/.exec(part) ?? [];
          const children = [...(current ?? root).children].filter((child) => child.localName === name);
          current = children[nth ? Number(nth) - 1 : 0] ?? null;
        }
        if (!current) return null;
      }
      element = current;
      root = element.shadowRoot ?? element;
    }
    return element;
  }

  const DIALOG = "dialog,[role=dialog],[role=alertdialog],[popover]";

  function visibleDialogs() {
    return deepQueryAll(DIALOG)
      .filter(isVisible)
      .map((element) => ({
        ...describe(element),
        modal: (element.localName === "dialog" && element.matches(":modal")) || element.getAttribute("aria-modal") === "true",
        labelledBy: element.getAttribute("aria-labelledby"),
      }));
  }

  /** Visible text of the page as separate chunks, to see what appears after an action. */
  function textChunks() {
    return flatText(document.body).map((chunk) => chunk.replace(/\s+/g, " ").trim()).filter(Boolean);
  }

  function liveRegionTexts() {
    return deepQueryAll("[aria-live],[role=status],[role=alert],[role=log],output")
      .map((element) => flatText(element).join(" ").replace(/\s+/g, " ").trim())
      .filter(Boolean);
  }

  const FIELD = "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]),select,textarea,[role=textbox],[role=combobox],[contenteditable=true]";

  /**
   * Elements a user perceives as inside the container. A dialog in a shadow root shows
   * content that lives outside it and is slotted in, so plain descendants are not enough.
   */
  function composedWithin(container, selector) {
    const found = [];
    for (const element of deepElements()) {
      if (element !== container && element.matches(selector) && shownAs(element) !== null && isComposedAncestor(container, element)) found.push(element);
    }
    return found;
  }

  function fieldsWithin(container) {
    return composedWithin(container, FIELD);
  }

  function describeField(element) {
    return {
      ...describe(element),
      type: element.getAttribute("type"),
      required: element.required === true || element.getAttribute("aria-required") === "true",
      ariaInvalid: element.getAttribute("aria-invalid") === "true",
      nativeInvalid: typeof element.checkValidity === "function" ? !element.checkValidity() : false,
      validationMessage: element.validationMessage || null,
      describedBy: element.getAttribute("aria-describedby"),
      autocomplete: element.getAttribute("autocomplete"),
      value: element.value ?? null,
    };
  }

  /** Visible forms with their fields and the control that submits them. */
  function formsReport() {
    const forms = deepQueryAll("form,[role=form]").filter((form) => fieldsWithin(form).length > 0);
    return forms.map((form) => {
      const buttons = composedWithin(form, "button,input[type=submit],[role=button]");
      const submit =
        buttons.find((button) => button.getAttribute("type") === "submit") ??
        buttons.find((button) => /verstu|verzend|zoek|opslaan|aanmaken|bewaar|indienen|submit|send|search/i.test(text(button))) ??
        buttons.at(-1) ??
        null;
      return { ...describe(form), fields: fieldsWithin(form).map(describeField), submit: submit ? describe(submit) : null };
    });
  }

  /**
   * The form that the steps of a recipe filled in, and how it would be sent. The fields are
   * found from the selector chains of those steps; when an id further down a chain changed
   * since the recipe was saved, the deepest element that can still be found is taken. Focus
   * is the last resort. Null when none of them stands in a form.
   */
  function submitTarget(chains) {
    const starts = [];
    for (const chain of [...chains].reverse()) {
      for (let length = chain.length; length > 0; length--) {
        const found = resolve(chain.slice(0, length));
        if (!found) continue;
        starts.push(found);
        break;
      }
    }
    const active = deepActiveElement();
    if (active) starts.push(active);
    for (const start of starts) {
      const form = closestComposed(start, "form");
      if (!form) continue;
      const buttons = composedWithin(form, "button,input[type=submit],input[type=image]").filter((button) => !button.disabled);
      const submit =
        buttons.find((button) => (button.getAttribute("type") ?? "").toLowerCase() === "submit" || button.localName === "input") ??
        buttons.find((button) => /verstu|verzend|zoek|opslaan|aanmaken|bewaar|indienen|submit|send|search/i.test(text(button))) ??
        buttons.find((button) => button.localName === "button" && !button.hasAttribute("type") && button.form === form) ??
        null;
      const method = (submit?.getAttribute("formmethod") || form.getAttribute("method") || "get").toLowerCase();
      const action = submit?.hasAttribute("formaction") ? submit.formAction : form.action;
      return { form: describe(form), submit: submit ? describe(submit) : null, method, action };
    }
    return null;
  }

  const STATUS_REGION = "[aria-live],[role=status],[role=alert],[role=log],output";
  /** Each status region as it was when `markStatusRegions` ran, for `statusMessages` to compare with. */
  let regionsBefore = null;
  let chunksBefore = null;

  /** Why an element is not shown or not given to assistive technology, from itself or an ancestor; null when it is. */
  function hiddenHow(element) {
    for (let node = element; node; node = composedParent(node)) {
      const own = node === element ? "het gebied" : "een omringend element";
      const style = getComputedStyle(node);
      if (style.display === "none") return node.hasAttribute("hidden") ? `hidden op ${own}` : `display:none op ${own}`;
      if (style.visibility === "hidden") return `visibility:hidden op ${own}`;
      if (node.getAttribute("aria-hidden") === "true") return `aria-hidden op ${own}`;
    }
    return null;
  }

  const regionText = (element) => flatText(element).join(" ").replace(/\s+/g, " ").trim();

  /** Remember every status region, hidden ones included, and the visible text, before a form is sent. */
  function markStatusRegions() {
    regionsBefore = new Map(deepQueryAll(STATUS_REGION).map((element) => [element, { text: regionText(element), hidden: hiddenHow(element), source: (element.textContent ?? "").replace(/\s+/g, " ").trim() }]));
    chunksBefore = new Set(textChunks());
    return regionsBefore.size;
  }

  /**
   * The messages that stand in a status region after a form was sent: the text, the role and
   * aria-live of the region, and how the region was before sending (hidden, empty in the page,
   * with other text, or not in the page). Only regions with text that is shown now and changed;
   * of nested regions with the same text the innermost. Text that appeared outside every region
   * is listed apart. Without `markStatusRegions` before (a new document) each region is new.
   */
  function statusMessages() {
    const active = deepActiveElement();
    const shown = deepQueryAll(STATUS_REGION).filter((element) => hiddenHow(element) === null && regionText(element) !== "");
    const messages = [];
    for (const element of shown) {
      const now = regionText(element);
      if (shown.some((other) => other !== element && isComposedAncestor(element, other) && regionText(other) === now)) continue;
      const was = regionsBefore?.get(element) ?? null;
      if (was && was.hidden === null && was.text === now) continue;
      const before = !regionsBefore ? "nieuw document" : !was ? "niet in de pagina" : was.hidden !== null ? "verborgen" : was.text === "" ? "leeg" : "andere tekst";
      const roleAttr = element.getAttribute("role");
      messages.push({
        text: now.slice(0, 300),
        role: roleAttr ?? (element.localName === "output" ? "status" : null),
        ariaLive: element.getAttribute("aria-live"),
        where: path(element).join(" >>> "),
        before,
        hiddenBefore: was?.hidden ?? null,
        // What a hidden region already held in its code: a message that was there all along and only shown.
        textBefore: was && was.hidden !== null ? was.source.slice(0, 300) || null : null,
        focusInside: active !== null && (active === element || isComposedAncestor(element, active)),
      });
    }
    const inRegions = messages.map((message) => message.text).join(" ");
    const outside = chunksBefore ? textChunks().filter((chunk) => !chunksBefore.has(chunk) && !inRegions.includes(chunk)) : [];
    const focus = active && active !== document.body ? `${active.localName} "${text(active, 60)}"` : null;
    return { messages, textOutsideRegions: [...new Set(outside)].slice(0, 10), focusAfter: focus };
  }

  function fieldStates(formRef) {
    const form = registry[formRef];
    return form ? fieldsWithin(form).map(describeField) : [];
  }

  function contains(containerRef, element = deepActiveElement()) {
    return element ? isComposedAncestor(registry[containerRef], element) : false;
  }

  function triggers() {
    // A tab that is not selected reveals its panel when activated; the selected one has nothing to show.
    return deepQueryAll("button,[role=button],summary,[aria-haspopup],[aria-expanded],[role=tab]")
      .filter((element) => !(element.getAttribute("role") === "tab" && element.getAttribute("aria-selected") === "true"))
      .filter((element) => isVisible(element) && !element.disabled && element.getAttribute("type") !== "submit" && !closestComposed(element, "form,[role=form]"))
      .map((element) => ({ ...describe(element), title: element.getAttribute("title"), expanded: element.getAttribute("aria-expanded"), hasPopup: element.getAttribute("aria-haspopup") }));
  }

  const OPERABLE =
    'button,input:not([type=hidden]),select,textarea,summary,audio[controls],video[controls],[contenteditable=""],[contenteditable=true],' +
    "[role=button],[role=checkbox],[role=radio],[role=switch],[role=tab],[role=menuitem],[role=combobox],[role=listbox],[role=textbox],[role=searchbox],[role=slider],[role=spinbutton],[aria-expanded],[aria-haspopup]";
  const OPERABLE_FORM = "form,[role=form],[role=search],search,nldd-form";

  /** What kind of thing a visitor operates here; the names are those of the check that lays them next to the site model. */
  function operableKind(element) {
    const role = element.getAttribute("role");
    const type = (element.getAttribute("type") ?? "").toLowerCase();
    const tag = element.localName;
    if (tag === "audio" || tag === "video") return "player";
    if (role === "tab") return "tabs";
    if (type === "range" || role === "slider") return "slider";
    if (tag === "select" || role === "combobox" || role === "listbox") return "select";
    if (type === "search" || role === "searchbox") return "search";
    if (type === "checkbox" || type === "radio" || role === "checkbox" || role === "radio" || role === "switch") return "choice";
    if (tag === "textarea" || role === "textbox" || role === "spinbutton" || element.isContentEditable || (tag === "input" && !["button", "submit", "reset", "image"].includes(type))) return "field";
    if (tag === "summary" || element.hasAttribute("aria-expanded") || element.hasAttribute("aria-haspopup")) return "disclosure";
    return "button";
  }

  /** Selector chain like path(), but without ids: the place of an element whose id differs per page load, and the one a recipe keeps as well. */
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

  /**
   * Everything a visitor can operate on the page as it is now, apart from plain links, in
   * groups a person would name as one thing: a form with its fields, a row of tabs, a player
   * with its buttons, and controls of the same kind at the same kind of place (the questions
   * of an accordion, the buttons of a list of cards). Only reads.
   */
  function operables() {
    const groups = new Map();
    const elements = deepQueryAll(OPERABLE).filter((element) => {
      if (element.matches("a[href],[role=link]") && !element.matches("[aria-expanded],[aria-haspopup]")) return false;
      return shownAs(element) !== null && element.disabled !== true && element.getAttribute("aria-disabled") !== "true";
    });
    const nameOf = (element) => {
      const labels = element.labels ? [...element.labels].map((label) => text(label, 60)).join(" ") : "";
      return (element.getAttribute("aria-label") || labels || text(element, 60) || element.getAttribute("placeholder") || element.getAttribute("title") || element.getAttribute("value") || element.getAttribute("name") || "").replace(/\s+/g, " ").trim().slice(0, 60);
    };
    // The block a control shares with an audio or video element: its nearest ancestors, short of a region of the page.
    const mediaNear = (element) => {
      let block = composedParent(element);
      for (let depth = 0; block && depth < 3 && !block.matches("main,body,[role=main],header,footer,nav,form,article,section"); depth++, block = composedParent(block)) {
        // A wrapper around the page holds a player too, but is no player.
        if (block.querySelector("main,[role=main],header,footer,nav")) return null;
        const media = block.querySelector("audio,video");
        if (media) return media;
      }
      return null;
    };
    for (const element of elements) {
      let kind = operableKind(element);
      const form = closestComposed(element, OPERABLE_FORM);
      const media = kind === "player" ? element : form ? null : mediaNear(element);
      let key;
      let container = element;
      if (form) {
        kind = "form";
        container = form;
        key = `form ${path(form).join(" >>> ")}`;
      } else if (media) {
        kind = "player";
        container = media;
        key = `player ${path(media).join(" >>> ")}`;
      } else if (kind === "tabs" && closestComposed(element, "[role=tablist]")) {
        container = closestComposed(element, "[role=tablist]");
        key = `tabs ${path(container).join(" >>> ")}`;
      } else {
        // The same kind of control at the same kind of place: the chain of element names up to the document.
        key = `${kind} ${structuralPath(element).join(" >>> ").replace(/:nth-of-type\(\d+\)/g, "")}`;
      }
      const group = groups.get(key) ?? { key, kind, path: path(container).join(" >>> "), region: region(container), inMain: closestComposed(element, "main,[role=main]") !== null, text: "", members: [], names: [] };
      // A form with a search field in it, or in a search region, is a search form.
      if (form && (operableKind(element) === "search" || closestComposed(form, "[role=search],search"))) group.kind = "search";
      group.members.push({ path: path(element).join(" >>> "), structural: structuralPath(element).join(" >>> "), kind: operableKind(element) });
      const name = nameOf(element);
      if (name && !group.names.includes(name)) group.names.push(name);
      groups.set(key, group);
    }
    return [...groups.values()].map(({ names, ...group }) => ({ ...group, text: names.slice(0, 5).join(", ").slice(0, 160) }));
  }

  /** Checkboxes, radio buttons, switches and select lists: controls whose value a user changes in place. */
  function settingControls() {
    return deepQueryAll('input[type=checkbox],input[type=radio],select,[role=checkbox],[role=switch],[role=radio]')
      .filter((element) => shownAs(element) !== null && !element.disabled)
      .map((element) => ({ ...describe(element), type: element.getAttribute("type"), options: element.localName === "select" ? element.options.length : null }));
  }

  /** Attributes that point at content shown on hover or focus: a control with one of these is never one of many. */
  const SHOWS_MORE = ["title", "aria-describedby", "aria-details", "aria-haspopup", "popovertarget", "data-tooltip", "data-tip", "data-title"];

  /** A short hash of a text, to compare code and style declarations without keeping them. */
  function shortHash(value) {
    let hash = 5381;
    const length = Math.min(value.length, 4000);
    for (let index = 0; index < length; index++) hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0;
    return `${(hash >>> 0).toString(36)}.${value.length}`;
  }

  /** The pseudo-classes of a pointer that rests on an element, of focus and of a press. */
  const INTERACTION_STATE = /:(?:hover|focus-visible|focus-within|focus|active)(?![\w-])/g;

  /** A selector list split at its top-level commas: the commas inside :is() or :not() stay. */
  function selectorParts(selector) {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let index = 0; index < selector.length; index++) {
      const char = selector[index];
      if (char === "(" || char === "[") depth++;
      else if (char === ")" || char === "]") depth--;
      else if (char === "," && depth === 0) {
        parts.push(selector.slice(start, index).trim());
        start = index + 1;
      }
    }
    parts.push(selector.slice(start).trim());
    return parts.filter(Boolean);
  }

  /**
   * For one selector with an interaction state in it: the element that has to be pointed at, focused
   * or pressed for the rule to apply, as a selector without that state, and which states. For
   * `.card:hover .title` that is `.card`: pointing at a link inside the card applies the rule.
   */
  function stateHolder(part) {
    INTERACTION_STATE.lastIndex = 0;
    const first = INTERACTION_STATE.exec(part);
    if (!first) return null;
    let end = first.index + first[0].length;
    let depth = 0;
    for (; end < part.length; end++) {
      const char = part[end];
      if (char === "(" || char === "[") depth++;
      else if (char === ")" || char === "]") depth--;
      else if (depth === 0 && /[\s>+~]/.test(char)) break;
    }
    const holder = part.slice(0, end).replace(INTERACTION_STATE, "").replace(/::?(?:before|after|marker|placeholder|selection|first-line|first-letter)\b/g, "").trim();
    const selector = holder === "" || /[\s>+~]$/.test(holder) ? `${holder}*` : holder;
    try {
      document.createDocumentFragment().querySelector(selector);
    } catch {
      return null;
    }
    return { selector, states: [...new Set(part.match(INTERACTION_STATE))].sort().join("") };
  }

  /**
   * What the style sheets change when an element is pointed at, focused or pressed. Per element
   * the declarations of every rule with :hover, :focus, :focus-visible, :focus-within or :active
   * that would apply, by their content: two elements that change in the same way under the pointer
   * and with focus have the same answer, whatever their classes. `opaque` is set when a style sheet
   * could not be read (one of another origin): then what changes is not known from the rules.
   */
  function interactionStyles() {
    const byHolder = new Map();
    let opaque = false;
    const roots = new Set([document]);
    for (const element of deepElements()) if (element.shadowRoot) roots.add(element.shadowRoot);
    for (const root of roots) {
      const sheets = [...(root.styleSheets ?? []), ...(root.adoptedStyleSheets ?? [])];
      const add = (rule, selector) => {
        for (const part of selectorParts(selector)) {
          const holder = stateHolder(part);
          if (!holder) continue;
          const declared = `${holder.states}{${shortHash(rule.style.cssText)}}`;
          let holders;
          try {
            holders = root.querySelectorAll(holder.selector);
          } catch {
            continue;
          }
          for (const node of holders) {
            const known = byHolder.get(node) ?? new Set();
            known.add(declared);
            byHolder.set(node, known);
          }
        }
      };
      const walk = (rules, parent) => {
        for (const rule of rules) {
          if (rule instanceof CSSMediaRule && !matchMedia(rule.media.mediaText).matches) continue;
          if (rule instanceof CSSStyleRule) {
            // A nested rule stands for its parent at the & or, without one, inside it.
            const selector = parent === null ? rule.selectorText : rule.selectorText.includes("&") ? rule.selectorText.replaceAll("&", `:is(${parent})`) : `:is(${parent}) ${rule.selectorText}`;
            add(rule, selector);
            if (rule.cssRules?.length) walk(rule.cssRules, selector);
          } else if (rule.cssRules) walk(rule.cssRules, parent);
        }
      };
      for (const sheet of sheets) {
        if (sheet.disabled || (sheet.media?.mediaText && !matchMedia(sheet.media.mediaText).matches)) continue;
        let rules;
        try {
          rules = sheet.cssRules;
        } catch {
          opaque = true;
          continue;
        }
        walk(rules, null);
      }
    }
    return {
      opaque,
      /** The rules that apply when this element is pointed at, focused or pressed: those on it and on what holds it. */
      of(element) {
        const found = new Set();
        for (let node = element; node; node = composedParent(node)) for (const declared of byHolder.get(node) ?? []) found.add(declared);
        return [...found].sort().join(" ");
      },
    };
  }

  /** The code of the listeners of a set of event types on an element and on what holds it, short of the page itself; with `labels` also on its labels. */
  function listenerSignature(element, types, labels = false) {
    const parts = [];
    const handlers = types.map((type) => `on${type}`);
    const of = (node, as) => {
      const own = [...(listenerCode.get(node) ?? [])].filter((entry) => types.includes(entry.slice(0, entry.indexOf(":"))));
      // A handler set as an attribute or a property: onfocus="..." or element.onmousedown = ...
      for (const name of handlers) if (typeof node[name] === "function") own.push(`${name}:${codeOf(node[name])}`);
      if (own.length > 0) parts.push(`${as}:${own.sort().join(",")}`);
    };
    for (let node = element; node && node !== document.body && node !== document.documentElement; node = composedParent(node)) of(node, node === element ? "self" : node.localName);
    if (labels) for (const label of element.labels ?? []) of(label, "label");
    return parts.join(";");
  }

  /** What is known before the press about what pressing an element does: the code of the listeners for a press that reach it. */
  function downSignature(element) {
    return listenerSignature(element, DOWN_EVENT_TYPES, true);
  }

  /** The element that holds a control as one part of the page: a list, a form, a table, a card, a component of its own. */
  const COMPONENT = "form,fieldset,dialog,details,table,ul,ol,dl,menu,figure,article,blockquote,p,label,[role=dialog],[role=menu],[role=menubar],[role=tablist],[role=toolbar],[role=grid],[role=listbox],[role=tree],[role=radiogroup]";

  function componentOf(element) {
    for (let node = composedParent(element); node && node !== document.body; node = composedParent(node)) {
      if (node.localName.includes("-") || node.matches(COMPONENT)) return `${node.localName}${node.getAttribute("role") ? `[${node.getAttribute("role")}]` : ""}`;
    }
    return "";
  }

  /** A class that names one element and not a look: a number in it, or a name a build tool made up. */
  const idLikeClass = (name) => /\d/.test(name) || /^(?:css|sc|jsx|svelte|astro|emotion)-/.test(name) || name.startsWith("_");

  /**
   * The size of a target within a margin. The height in three bands: below 24 pixels (the size that
   * matters for a target, WCAG 2.5.8), from 24 to 44 pixels, and 44 or more (WCAG 2.5.5). The width
   * only as narrower than 24 pixels or not: above that it follows the length of the text, not the look.
   */
  function sizeBand(rect) {
    const band = (value) => (value < 24 ? "s" : value < 44 ? "m" : "l");
    return `${rect.width < 24 ? "s" : "-"}${band(rect.height)}`;
  }

  /**
   * What makes two controls the same kind for the probes that point at them and press them: they
   * look and behave alike (WCAG-EM 2.0, 4.1). The element and its role, the region of the page and
   * the component it stands in, the size of the target within a margin, how it looks at rest, what
   * the style sheets change when it is pointed at, focused or pressed, and the code of its listeners
   * for pointing and focus. Classes, ids, data attributes and names a build tool made up do not
   * count: two links that differ only in those look and behave the same. When a style sheet cannot
   * be read, the classes that are no identifier count instead of the rules. A control with only a
   * pictogram, or with an attribute that announces more content, is a kind of its own.
   */
  function hoverKind(element, styles) {
    const shown = shownAs(element) ?? element;
    const style = getComputedStyle(shown);
    const root = element.getRootNode();
    const host = root instanceof ShadowRoot ? root.host.localName : "";
    const visibleText = text(element, 40);
    const iconOnly = visibleText === "" && element.localName !== "input" && element.localName !== "select" && element.localName !== "textarea";
    const showsMore = SHOWS_MORE.filter((name) => element.hasAttribute(name));
    const atRest = [style.color, style.backgroundColor, style.backgroundImage === "none" ? "" : "image", style.textDecorationLine, style.cursor, style.fontSize, style.fontWeight, `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`].join(" ");
    const changes = styles.opaque ? `${styles.of(element)} ${[...element.classList].filter((name) => !idLikeClass(name)).sort().join(".")}` : styles.of(element);
    const editable = ["contenteditable", "draggable"].filter((name) => element.hasAttribute(name)).join(",");
    // A link in running text that wraps is as high as one line, not as the two together.
    const lines = style.display === "inline" ? shown.getClientRects() : [];
    const size = sizeBand(lines.length > 0 ? lines[0] : shown.getBoundingClientRect());
    const look = [element.localName, element.getAttribute("role") ?? element.getAttribute("type") ?? "", region(element) ?? "-", host, componentOf(element), size, atRest, shortHash(changes), listenerSignature(element, HOVER_FOCUS_TYPES), editable].join("|");
    // The name of a control of its own kind is part of the kind: each one is pointed at.
    const own = iconOnly || showsMore.length > 0 ? `|${element.getAttribute("aria-label") ?? element.getAttribute("title") ?? visibleText}|${path(element).join(" ")}` : "";
    return { kind: look + own, look, iconOnly, showsMore, title: element.getAttribute("title"), describedBy: element.getAttribute("aria-describedby") };
  }

  /** Every control a pointer or focus can reach, with its kind; with `kinds: false` without, for who only looks one up. */
  function hoverTargets({ kinds = true } = {}) {
    const found = deepQueryAll(INTERACTIVE).filter((element) => shownAs(element) !== null && !element.disabled);
    if (!kinds) return found.map(describe);
    const styles = interactionStyles();
    return found.map((element) => ({ ...describe(element), ...hoverKind(element, styles) }));
  }

  /** The controls whose boundary is measured for contrast (WCAG 1.4.11), each with the box of what draws it. */
  function boundaryTargets() {
    return deepQueryAll(INTERACTIVE)
      .filter((element) => shownAs(element) !== null && !element.disabled)
      .map((element) => {
        const drawn = drawnBy(element) ?? shownAs(element);
        return drawn !== element ? { ...describe(element), box: box(drawn), drawnBy: path(drawn) } : describe(element);
      });
  }

  const HINTED = "abbr,dfn,[title],[aria-describedby],[aria-details],[data-tooltip],[data-tip],[data-title]";

  /**
   * Elements that are no control and yet announce more content for whoever points at them: an
   * abbreviation, a term with an explanation, an icon with a description. One kind per element,
   * place and look, as for a control; the hover probe points at a few of each.
   */
  function hoverHints() {
    const styles = interactionStyles();
    return deepQueryAll(HINTED)
      .filter((element) => isVisible(element) && !element.matches(INTERACTIVE) && !closestComposed(composedParent(element) ?? element, INTERACTIVE) && !["html", "body", "iframe", "svg", "img"].includes(element.localName) && !closestComposed(element, "svg"))
      .map((element) => {
        const kind = hoverKind(element, styles);
        // Not the name: an abbreviation is one of many, of which a few are pointed at.
        return { ...describe(element), kind: `geen bediening|${kind.look}`, iconOnly: false, showsMore: kind.showsMore, title: kind.title, describedBy: kind.describedBy, nonControl: true };
      });
  }

  /** Whether a press of the pointer on this element reaches a listener for it: on the element, on something around it, or on its label. */
  function hearsDown(element) {
    const around = (start) => {
      for (let node = start; node; node = composedParent(node)) if (downTargets.has(node)) return true;
      return false;
    };
    return around(element) || [...(element.labels ?? [])].some((label) => around(label));
  }

  const TEXT_BLOCK = "p,li,dt,dd,td,th,blockquote,figcaption,pre,label,legend,summary,caption";

  /**
   * What a visitor has on the page as it is drawn now: the headings, the images and the blocks of
   * text that are visible, by their own words. Laid next to the same list at another window size
   * it says what a size takes away. Also what is drawn a quarter turn, and whether the
   * stylesheets have rules for one orientation only.
   */
  function contentInventory() {
    const squash = (value) => (value ?? "").replace(/\s+/g, " ").trim();
    // Visible to the eye: an element that is only there for a screen reader is not what a size can take away.
    const shown = (element) => isVisible(element) && !visuallyHidden(element);
    const headings = deepQueryAll(HEADING).filter(shown).map((element) => squash(text(element, 120))).filter(Boolean);
    const images = deepQueryAll("img,svg,picture,canvas,video,[role=img]")
      .filter((element) => shown(element) && !closestComposed(composedParent(element) ?? element, "svg,picture,[role=img]"))
      .filter((element) => element.getBoundingClientRect().width >= 16 && element.getBoundingClientRect().height >= 16)
      .map((element) => `${element.localName}:${squash(element.getAttribute("alt") ?? element.getAttribute("aria-label") ?? "") || (element.currentSrc ?? element.getAttribute("src") ?? "").split("/").pop().split("?")[0] || squash(text(element, 40)) || "-"}`);
    const blocks = deepQueryAll(TEXT_BLOCK)
      .filter((element) => shown(element) && [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim()))
      .map((element) => squash(text(element, 80)))
      .filter(Boolean);
    const rotated = [];
    for (const element of deepElements(document.body)) {
      const transform = getComputedStyle(element).transform;
      if (!transform || transform === "none" || !isVisible(element)) continue;
      const matrix = new DOMMatrixReadOnly(transform);
      const angle = Math.round((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI);
      const rect = element.getBoundingClientRect();
      // A quarter turn of something that carries content, not of a chevron.
      if (Math.abs(Math.abs(angle) - 90) <= 5 && rect.width * rect.height >= 0.1 * innerWidth * innerHeight) rotated.push({ ...describe(element), angle });
    }
    let orientationRules = 0;
    const count = (rules) => {
      for (const rule of rules) {
        if (rule.media && /orientation/.test(rule.media.mediaText)) orientationRules++;
        if (rule.cssRules && !(rule.media && /orientation/.test(rule.media.mediaText))) count(rule.cssRules);
      }
    };
    for (const sheet of document.styleSheets) {
      try {
        count(sheet.cssRules);
      } catch {
        // A stylesheet from another origin cannot be read.
      }
    }
    return { viewport: { width: innerWidth, height: innerHeight }, headings, images, textBlocks: blocks, rotatedQuarterTurn: rotated.slice(0, 20), orientationRules };
  }

  let colourCanvas = null;

  /** Any CSS colour as sRGB with alpha, resolved by the browser itself (handles oklch, light-dark and the rest). */
  function toRgba(colour) {
    colourCanvas ??= new OffscreenCanvas(1, 1).getContext("2d", { willReadFrequently: true });
    colourCanvas.clearRect(0, 0, 1, 1);
    colourCanvas.fillStyle = "#000";
    colourCanvas.fillStyle = colour;
    colourCanvas.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = colourCanvas.getImageData(0, 0, 1, 1).data;
    return [r, g, b, Math.round((a / 255) * 100) / 100];
  }

  /**
   * Text that is there for assistive technology only: clipped to a pixel or clipped away.
   * Nobody sees it, so its contrast is not a question.
   */
  function visuallyHidden(element) {
    for (let current = element; current && current !== document.body; current = composedParent(current)) {
      const style = getComputedStyle(current);
      const rect = current.getBoundingClientRect();
      const clipsToNothing = style.overflow !== "visible" && (rect.width <= 1 || rect.height <= 1);
      if (clipsToNothing || /inset\(\s*(50|100)%/.test(style.clipPath) || style.clip === "rect(0px, 0px, 0px, 0px)" || style.clip === "rect(1px, 1px, 1px, 1px)") return true;
    }
    return false;
  }

  /** Every piece of visible text with its colour, size and exact position, for measuring contrast on a screenshot. With `root`: only the text inside that element. */
  function textRuns(root = document.body) {
    const runs = [];
    for (const element of deepElements(root)) {
      if (["script", "style", "noscript", "option"].includes(element.localName)) continue;
      const textNodes = [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0);
      if (textNodes.length === 0 || !isVisible(element) || visuallyHidden(element)) continue;
      const style = getComputedStyle(element);
      let opacity = 1;
      for (let current = element; current; current = composedParent(current)) opacity *= Number(getComputedStyle(current).opacity);
      const range = document.createRange();
      for (const node of textNodes) {
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (rect.width < 4 || rect.height < 4) continue;
          runs.push({
            text: node.textContent.replace(/\s+/g, " ").trim().slice(0, 60),
            colour: toRgba(style.color),
            opacity: Math.round(opacity * 100) / 100,
            fontSizePx: Math.round(Number.parseFloat(style.fontSize) * 10) / 10,
            bold: Number(style.fontWeight) >= 700,
            box: { x: Math.round(rect.x + window.scrollX), y: Math.round(rect.y + window.scrollY), width: Math.round(rect.width), height: Math.round(rect.height) },
            disabled: closestComposed(element, ":disabled,[aria-disabled=true]") !== null,
            ariaHidden: closestComposed(element, '[aria-hidden="true"]') !== null,
            tag: element.localName,
            region: region(element),
            path: path(element),
          });
          break;
        }
      }
    }
    // Placeholder text is not a text node, but it is text a user has to be able to read.
    for (const element of deepQueryAll("input[placeholder],textarea[placeholder]")) {
      if (root !== document.body && !isComposedAncestor(root, element)) continue;
      if (!isVisible(element) || element.value || !element.getAttribute("placeholder").trim()) continue;
      const style = getComputedStyle(element, "::placeholder");
      const own = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const inset = Number.parseFloat(own.paddingLeft) || 0;
      runs.push({
        text: `(voorbeeldtekst) ${element.getAttribute("placeholder").slice(0, 45)}`,
        colour: toRgba(style.color),
        opacity: Number(style.opacity) || 1,
        fontSizePx: Math.round(Number.parseFloat(style.fontSize) * 10) / 10,
        bold: Number(style.fontWeight) >= 700,
        box: { x: Math.round(rect.x + window.scrollX + inset), y: Math.round(rect.y + window.scrollY + 2), width: Math.max(8, Math.round(rect.width - 2 * inset)), height: Math.max(8, Math.round(rect.height - 4)) },
        disabled: element.disabled === true,
        ariaHidden: false,
        tag: element.localName,
        region: region(element),
        path: path(element),
      });
    }
    return runs;
  }

  /** Text inside the element that has focus now: for content that only shows on focus, such as a skip link. */
  function focusedTextRuns() {
    const active = deepActiveElement();
    if (!active || active === document.body) return [];
    const prefix = path(active).join(" >>> ");
    return textRuns().filter((run) => run.path.join(" >>> ").startsWith(prefix));
  }

  /** Keep the listener counts as they are now, before the test browser adds listeners of its own. */
  function freezeListeners() {
    frozenListeners ??= JSON.parse(JSON.stringify(listeners));
  }

  /** Small images and icons with their position, for measuring their contrast on a screenshot. */
  function graphicBoxes() {
    return deepQueryAll("svg,img,[role=img]")
      .filter((element) => {
        if (!isVisible(element) || (element.localName === "svg" && element.parentElement?.closest("svg"))) return false;
        const rect = element.getBoundingClientRect();
        return rect.width >= 8 && rect.height >= 8 && rect.width <= 96 && rect.height <= 96;
      })
      .map((element) => {
        const control = closestComposed(composedParent(element) ?? element, INTERACTIVE);
        return { ...describe(element), inControl: control ? `${control.localName}: "${text(control, 60)}"` : null, controlHasText: control ? text(control, 60).length > 0 : null };
      });
  }

  /**
   * The widths at which the stylesheets change the layout: every length in a media or container
   * query about the width, in CSS pixels. Read from the document, from stylesheets that a link
   * restricts to a width, and from every shadow root. A stylesheet of another origin cannot be read.
   */
  function layoutBreakpoints() {
    const widths = new Set();
    const read = (condition) => {
      if (!condition || !/width/.test(condition)) return;
      for (const match of condition.matchAll(/([\d.]+)(px|em|rem)\b/g)) widths.add(Math.round(Number(match[1]) * (match[2] === "px" ? 1 : 16)));
    };
    const walk = (rules) => {
      for (const rule of rules) {
        read(rule.conditionText ?? rule.media?.mediaText);
        if (rule.cssRules) walk(rule.cssRules);
      }
    };
    const sheetsOf = (root) => [...root.styleSheets, ...(root.adoptedStyleSheets ?? [])];
    const sheets = sheetsOf(document);
    for (const element of deepElements()) if (element.shadowRoot) sheets.push(...sheetsOf(element.shadowRoot));
    for (const sheet of sheets) {
      read(sheet.media?.mediaText);
      try {
        walk(sheet.cssRules);
      } catch {
        // A stylesheet from another origin cannot be read.
      }
    }
    return [...widths].filter((width) => width > 0).sort((a, b) => a - b);
  }

  /** The controls that are on screen now, by where they are: for laying the window sizes next to each other. */
  function shownControls() {
    return deepQueryAll(INTERACTIVE)
      .filter((element) => !element.disabled && shownAs(element) !== null)
      .map((element) => ({ tag: element.localName, text: text(element, 60), ariaLabel: element.getAttribute("aria-label"), region: region(element), path: path(element) }));
  }

  const SPACED_LETTERS = /(?:^|[\s(])((?:\p{L}[  ]){3,}\p{L})(?=$|[\s).,:;!?])/u;
  const WIDE_GAP = /\S(?:[  ]{3,}|\t+| {2,})\S/;
  const CODE = "code,pre code,kbd,samp,var";

  /**
   * Text laid out with spaces or hard line breaks instead of markup (WCAG 1.3.2): a word with its
   * letters apart ("W e l k o m"), and lines with columns made by a run of spaces, tabs or
   * non-breaking spaces where the page keeps the spaces, or between line breaks. Candidates: text
   * in code is marked as such, an address or a poem with line breaks and no gaps is not listed.
   */
  function spacedText() {
    const found = [];
    const seen = new Set();
    const add = (element, kind, lines) => {
      if (seen.has(element) || found.length >= 60) return;
      seen.add(element);
      found.push({ kind, tag: element.localName, region: region(element), path: path(element), inCode: closestComposed(element, CODE) !== null || (element.localName === "pre" && element.querySelector("code") !== null), lines: lines.slice(0, 6).map((line) => line.slice(0, 120)) });
    };
    for (const element of deepElements(document.body)) {
      if (["script", "style", "noscript", "template"].includes(element.localName) || !isVisible(element)) continue;
      const own = [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim()).map((node) => node.textContent);
      if (own.length === 0) continue;
      const raw = own.join("");
      const letters = raw.replace(/\s+/g, " ").match(SPACED_LETTERS);
      if (letters) {
        add(element, "losse letters", [letters[1]]);
        continue;
      }
      const keeps = /^(pre|pre-wrap|break-spaces)$/.test(getComputedStyle(element).whiteSpace);
      const lines = keeps ? raw.split("\n") : element.querySelectorAll(":scope > br").length >= 2 ? (element.innerText ?? raw).split("\n") : [raw];
      const aligned = lines.filter((line) => WIDE_GAP.test(keeps || lines.length > 1 ? line : line.replace(/ {3,}/g, " ")));
      if (aligned.length >= 2 || (aligned.length === 1 && / {2,}|\t/.test(aligned[0]))) add(element, keeps ? "uitgelijnd met spaties" : lines.length > 1 ? "uitgelijnd met harde regeleinden" : "uitgelijnd met harde spaties", aligned);
    }
    return found;
  }

  /** The language that holds for an element: its own lang attribute, or that of the nearest element around it that has one. */
  function declaredLang(element) {
    const from = closestComposed(element, "[lang]");
    return from ? from.getAttribute("lang") : null;
  }

  /**
   * The words that assistive technology reads and a sighted user does not see as text: the text
   * alternative of an image, aria-label, a title, the title of a drawing, a description and the value of
   * an input button, with the language that holds for each (WCAG 3.1.2). Hidden elements are left out.
   */
  function textAlternatives() {
    const pieces = [];
    const seen = new Set();
    const add = (element, kind, value) => {
      const squashed = (value ?? "").replace(/\s+/g, " ").trim();
      if (!squashed || seen.has(`${kind}|${squashed}`)) return;
      seen.add(`${kind}|${squashed}`);
      pieces.push({ kind, text: squashed.slice(0, 300), words: squashed.split(" ").length, declared: declaredLang(element), tag: element.localName, region: region(element), path: path(element) });
    };
    for (const element of deepElements(document.body)) {
      if (["script", "style", "noscript", "template"].includes(element.localName)) continue;
      if (closestComposed(element, '[aria-hidden="true"]')) continue;
      const shown = shownAs(element) !== null || element.localName === "title";
      if (!shown) continue;
      if (element.matches("img,area,input[type=image]")) add(element, "alt", element.getAttribute("alt"));
      if (element.hasAttribute("aria-label")) add(element, "aria-label", element.getAttribute("aria-label"));
      if (element.hasAttribute("title")) add(element, "title", element.getAttribute("title"));
      if (element.hasAttribute("aria-description")) add(element, "aria-description", element.getAttribute("aria-description"));
      if (element.localName === "svg") add(element, "svg-title", element.querySelector(":scope > title")?.textContent);
      if (element.matches("input[type=submit],input[type=button],input[type=reset]")) add(element, "value", element.value);
      if (element.matches("input[placeholder],textarea[placeholder]")) add(element, "placeholder", element.getAttribute("placeholder"));
    }
    return pieces;
  }

  /** Blocks of visible text with the language that holds for each: what a component shows when it is open. */
  function textBlocksWithLang(max = 300) {
    const blocks = [];
    for (const element of deepElements(document.body)) {
      if (blocks.length >= max) break;
      if (["script", "style", "noscript", "template", "option"].includes(element.localName)) continue;
      const own = [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim()).map((node) => node.textContent).join(" ").replace(/\s+/g, " ").trim();
      if (!own || !isVisible(element) || visuallyHidden(element)) continue;
      blocks.push({ kind: "tekst", text: own.slice(0, 300), words: own.split(" ").length, declared: declaredLang(element), tag: element.localName, region: region(element), path: path(element) });
    }
    return blocks;
  }

  /**
   * Every picture on the page that can hold text: images, drawings, canvases, embedded objects and
   * elements with a background image, with where they are and their own text, for recognising the
   * text in them (WCAG 1.4.5). Drawings inside a drawing are part of it.
   */
  function pictures() {
    const out = [];
    for (const element of deepElements(document.body)) {
      const background = getComputedStyle(element).backgroundImage;
      const isPicture = element.matches("img,svg,[role=img],canvas,input[type=image],object,embed,video[poster]") && !(element.localName === "svg" && element.parentElement?.closest("svg"));
      const hasBackground = background.includes("url(");
      if ((!isPicture && !hasBackground) || !isVisible(element)) continue;
      out.push({
        ...describe(element),
        kind: isPicture ? element.localName : "achtergrond",
        src: isPicture ? (element.currentSrc || element.getAttribute("src") || element.getAttribute("data") || element.getAttribute("poster") || null) : background.slice(0, 200),
        alt: element.getAttribute("alt") ?? element.getAttribute("aria-label") ?? (element.localName === "svg" ? (element.querySelector(":scope > title")?.textContent ?? null) : null),
        ownText: hasBackground && !isPicture ? text(element, 200) : "",
      });
    }
    return out;
  }

  /**
   * The text inside one element with the colours the browser paints it in now, for an element that
   * is pointed at or has focus. Running transitions are finished first. A piece of text gets a
   * background only when that is one plain colour: the first opaque background colour around it,
   * with no image, gradient, filter or transparency on the way and nothing painted over the text.
   * Otherwise `complexNl` says why, and the text has to be measured on a picture.
   */
  function plainTextColours(chain) {
    const element = resolve(chain);
    if (!element) return null;
    for (const animation of document.getAnimations()) if (animation instanceof CSSTransition) animation.finish();
    return textRuns(element).map((run) => {
      const owner = resolve(run.path);
      const base = { ...run, background: null, complexNl: null };
      if (!owner) return { ...base, complexNl: "het element van de tekst is niet terug te vinden" };
      if (run.opacity < 1) return { ...base, complexNl: "de tekst of iets eromheen is deels doorzichtig" };
      const centre = [run.box.x - window.scrollX + run.box.width / 2, run.box.y - window.scrollY + run.box.height / 2];
      let top = document.elementFromPoint(centre[0], centre[1]);
      for (let inner = top?.shadowRoot?.elementFromPoint(centre[0], centre[1]); inner && inner !== top; inner = top.shadowRoot?.elementFromPoint(centre[0], centre[1])) top = inner;
      if (!top || !(top === owner || isComposedAncestor(owner, top) || isComposedAncestor(top, owner))) return { ...base, complexNl: "er ligt iets over de tekst" };
      for (let current = owner; current; current = composedParent(current)) {
        const style = getComputedStyle(current);
        if (style.backgroundImage !== "none") return { ...base, complexNl: "een achtergrondafbeelding of kleurverloop" };
        if (style.filter !== "none" || style.mixBlendMode !== "normal" || style.backdropFilter !== "none") return { ...base, complexNl: "een filter of mengmodus" };
        const colour = toRgba(style.backgroundColor);
        if (colour[3] === 0) continue;
        if (colour[3] < 1) return { ...base, complexNl: "een doorzichtige achtergrondkleur" };
        return { ...base, background: colour.slice(0, 3) };
      }
      return { ...base, complexNl: "geen achtergrondkleur gevonden: de achtergrond is die van de browser" };
    });
  }

  const library = {
    plainTextColours,
    layoutBreakpoints,
    shownControls,
    spacedText,
    textAlternatives,
    textBlocksWithLang,
    pictures,
    clipboardWrites,
    clickables,
    paintedBox,
    settingControls,
    bodyText,
    frameSources,
    graphicBoxes,
    textRuns,
    resolve,
    visibleDialogs,
    textChunks,
    liveRegionTexts,
    formsReport,
    submitTarget,
    markStatusRegions,
    statusMessages,
    fieldStates,
    contains,
    triggers,
    hoverTargets,
    boundaryTargets,
    hoverHints,
    hearsDown,
    downSignature,
    contentInventory,
    interactiveWithin: (ref) => composedWithin(registry[ref], INTERACTIVE).map(describe),
    freezeListeners,
    listenerCounts: () => JSON.parse(JSON.stringify(listeners)),
    // What the document registered itself: the counts as they were frozen, or as they are when nothing froze them.
    ownListeners: () => JSON.parse(JSON.stringify(frozenListeners ?? listeners)),
    focusedTextRuns,
    motionReport,
    timerReport,
    // A wait of the toolbox inside the page, on the browser's own timer: it is not counted as a timer of the site.
    wait: (ms) => new Promise((resolve) => nativeSetTimeout.call(window, resolve, ms)),
    flatText,
    scrollRegions,
    registry,
    deepElements,
    deepQueryAll,
    collectFacts,
    operables,
    templateSignature,
    contentSnapshot,
    visitorSnapshot,
    sameOriginLinks,
    deepActiveElement,
    overflowReport,
    applyTextSpacing,
    removeTextSpacing,
    focusState,
    targetSizes,
    isVisible,
    describe,
    headingContextOf,
    sentenceOf,
    skipLinkTarget,
  };
  Object.defineProperty(window, "__loep", { value: Object.freeze(library), writable: false, configurable: false, enumerable: false });
})();
