// Put at the very top of a test page for VoiceOver: a page of the site, fetched once, that runs
// in Safari in the virtual Mac with the site's own scripts (through <base href>). Two jobs:
//
// 1. Keep the page from sending anything: only GET and HEAD leave it, and only to the hosts of
//    the run. A form is not submitted, a beacon not sent, a socket says nothing. With the
//    options, a new window does not open and an e-mail address does not hand over to Mail.
// 2. Play the steps of a state of the session, so VoiceOver reads the page in that state.
//
// What happened is written into the fragment of the address (#loep-played=<json>), where the
// reader in the guest reads it back: before VoiceOver starts, and again at the end.
//
// It is one function expression; loep calls it with its configuration.
(function (config) {
  "use strict";
  var report = { v: 1, done: false, steps: [], guard: [], options: { noPopup: config.noPopup, noMailto: config.noMailto } };
  var MAX_GUARD = 20;
  var documentUrl = String(location.href).split("#")[0];
  // Whether the page's own scripts worked here: a script Safari could not load, and custom elements nobody defined.
  // In a run with a strict scope the policy of the test page keeps a script of another host out: that one is marked as held.
  var failedScripts = [];
  window.addEventListener(
    "error",
    function (event) {
      var element = event.target;
      if (element && element.localName === "script" && element.src && failedScripts.length < 5) failedScripts.push({ url: String(element.src).slice(0, 160), module: element.type === "module", held: config.strict === true && !inScope(element.src) });
    },
    true,
  );
  var loaded = function () {
    var custom = 0;
    var missing = 0;
    var names = [];
    allElements().forEach(function (element) {
      if (element.localName.indexOf("-") === -1) return;
      custom += 1;
      if (element.matches(":defined")) return;
      missing += 1;
      if (names.indexOf(element.localName) === -1 && names.length < 8) names.push(element.localName.slice(0, 40));
    });
    return { custom: custom, undefined: missing, names: names, scripts: failedScripts };
  };
  var write = function () {
    try {
      if (report.done) report.page = loaded();
      history.replaceState(history.state, "", documentUrl + "#loep-played=" + encodeURIComponent(JSON.stringify(report)));
    } catch (error) {
      // A page that forbids changing its address keeps its own; the reader then says nothing came back.
    }
  };
  var note = function (kind, method, url) {
    if (report.guard.length < MAX_GUARD) report.guard.push({ kind: kind, method: String(method).toUpperCase(), url: String(url).slice(0, 200) });
    write();
  };
  var absolute = function (url) {
    try {
      return new URL(String(url), document.baseURI).href;
    } catch (error) {
      return String(url);
    }
  };
  var inScope = function (url) {
    try {
      var parsed = new URL(String(url), document.baseURI);
      // A host with its port, as the scope of the run names it (see scopeHost); what the page holds itself (data:, blob:) leaves nothing.
      var host = parsed.port === "" || parsed.port === "80" || parsed.port === "443" ? parsed.hostname : parsed.hostname + ":" + parsed.port;
      return !/^(https?|wss?):$/.test(parsed.protocol) || config.hosts.indexOf(host) !== -1;
    } catch (error) {
      return false;
    }
  };
  var reads = function (method) {
    return /^(GET|HEAD)$/i.test(method || "GET");
  };

  // 1. What leaves the page.
  var originalFetch = window.fetch;
  if (originalFetch) {
    window.fetch = function (input, init) {
      var isRequest = typeof Request !== "undefined" && input instanceof Request;
      var method = (init && init.method) || (isRequest ? input.method : "GET");
      var url = isRequest ? input.url : absolute(input);
      if (!reads(method)) {
        note("method", method, url);
        return Promise.reject(new TypeError("Load failed"));
      }
      if (!inScope(url)) {
        note("scope", "GET", url);
        return Promise.reject(new TypeError("Load failed"));
      }
      return originalFetch.apply(this, arguments);
    };
  }
  var open = XMLHttpRequest.prototype.open;
  var send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__loepRefused = !reads(method) ? ["method", method, absolute(url)] : !inScope(url) ? ["scope", "GET", absolute(url)] : null;
    return open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (!this.__loepRefused) return send.apply(this, arguments);
    note(this.__loepRefused[0], this.__loepRefused[1], this.__loepRefused[2]);
    var request = this;
    setTimeout(function () {
      request.dispatchEvent(new ProgressEvent("error"));
      request.dispatchEvent(new ProgressEvent("loadend"));
    }, 0);
  };
  if (navigator.sendBeacon) {
    navigator.sendBeacon = function (url) {
      note("method", "POST", absolute(url));
      return false;
    };
  }
  if (window.WebSocket) {
    WebSocket.prototype.send = function () {
      note("socket", "SEND", this.url);
    };
  }
  // A form is never submitted. The site's own handlers run first; what they leave to the browser does not happen.
  window.addEventListener("submit", function (event) {
    if (event.defaultPrevented) return;
    event.preventDefault();
    var form = event.target;
    note("form", (form.getAttribute && form.getAttribute("method")) || "GET", absolute((form.getAttribute && form.getAttribute("action")) || location.href));
  });
  HTMLFormElement.prototype.submit = function () {
    note("form", this.getAttribute("method") || "GET", absolute(this.getAttribute("action") || location.href));
  };
  var mailto = function (url) {
    return /^mailto:/i.test(String(url || ""));
  };
  var originalOpen = window.open;
  window.open = function (url) {
    if (config.noMailto && mailto(url)) {
      note("mailto", "GET", url);
      return null;
    }
    if (config.noPopup) {
      note("popup", "GET", absolute(url || "about:blank"));
      return null;
    }
    return originalOpen.apply(this, arguments);
  };
  if (config.noMailto || config.noPopup) {
    document.addEventListener(
      "click",
      function (event) {
        var path = event.composedPath ? event.composedPath() : [event.target];
        for (var index = 0; index < path.length; index++) {
          var element = path[index];
          if (!element || element.localName !== "a" || !element.getAttribute) continue;
          var href = element.getAttribute("href") || "";
          if (config.noMailto && mailto(href)) {
            event.preventDefault();
            note("mailto", "GET", href);
          } else if (config.noPopup && element.getAttribute("target") === "_blank") {
            event.preventDefault();
            note("popup", "GET", absolute(href));
          }
          return;
        }
      },
      true,
    );
  }
  // A link to a place in the page itself. Its address resolves against <base>, so Safari would
  // leave the test page for the site. What the browser does on such a link is done here: scroll
  // to the target and give it focus, or make it the place the next Tab starts from.
  var pageUrl = String(config.url || "").split("#")[0];
  var focusStart = null;
  window.addEventListener("focusin", function () {
    focusStart = null;
  });
  window.addEventListener("click", function (event) {
    if (event.defaultPrevented || pageUrl === "") return;
    var path = event.composedPath ? event.composedPath() : [event.target];
    var link = null;
    for (var index = 0; index < path.length && !link; index++) if (path[index] && path[index].localName === "a" && path[index].getAttribute && path[index].hasAttribute("href")) link = path[index];
    if (!link || link.getAttribute("target") === "_blank") return;
    var href = absolute(link.getAttribute("href"));
    var hash = href.indexOf("#");
    if (hash === -1 || href.slice(0, hash) !== pageUrl) return;
    event.preventDefault();
    var id = href.slice(hash + 1);
    try {
      id = decodeURIComponent(id);
    } catch (error) {
      // A fragment that is no valid encoding is looked up as it is written.
    }
    var target = id === "" ? null : document.getElementById(id) || document.getElementsByName(id)[0] || null;
    if (!target) {
      // The top of the page: a browser scrolls there and leaves focus where it is. Any other fragment without a target does nothing in a browser but change the address, which a page may listen for: that is said.
      if (id === "" || id.toLowerCase() === "top") window.scrollTo(0, 0);
      else note("fragment", "GET", href);
      return;
    }
    target.scrollIntoView();
    if (target.focus) target.focus();
    if (deepActive() === target) return;
    var active = deepActive();
    if (active && active.blur) active.blur();
    focusStart = target;
  });
  if (config.noMailto && window.navigation && window.navigation.addEventListener) {
    window.navigation.addEventListener("navigate", function (event) {
      if (event.destination && mailto(event.destination.url) && event.cancelable) {
        event.preventDefault();
        note("mailto", "GET", event.destination.url);
      }
    });
  }

  // 2. The steps. An element is found as the session finds it: by its selector chain, then by role and name, then by the chain without ids.
  var IMPLICIT_ROLE = { a: "link", button: "button", select: "combobox", textarea: "textbox", h1: "heading", h2: "heading", h3: "heading", h4: "heading", h5: "heading", h6: "heading", nav: "navigation", main: "main", dialog: "dialog", summary: "button", img: "img" };
  var INPUT_ROLE = { checkbox: "checkbox", radio: "radio", button: "button", submit: "button", reset: "button", image: "button", range: "slider", search: "searchbox", email: "textbox", text: "textbox", tel: "textbox", url: "textbox", number: "spinbutton" };
  var role = function (element) {
    var explicit = element.getAttribute("role");
    if (explicit) return explicit;
    if (element.localName === "input") return INPUT_ROLE[element.type] || "textbox";
    if (element.localName === "a" && !element.hasAttribute("href")) return null;
    return IMPLICIT_ROLE[element.localName] || null;
  };
  var nameOf = function (element) {
    return (element.getAttribute("aria-label") || element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
  };
  function allElements() {
    var out = [];
    var walk = function (root) {
      var elements = root.querySelectorAll("*");
      for (var index = 0; index < elements.length; index++) {
        out.push(elements[index]);
        if (elements[index].shadowRoot) walk(elements[index].shadowRoot);
      }
    };
    walk(document);
    return out;
  }
  /** The element at the end of a chain; "frame" when the chain goes on into an embedded frame. */
  var resolve = function (chain) {
    var root = document;
    var element = null;
    for (var segment = 0; segment < chain.length; segment++) {
      if (element && (element.localName === "iframe" || element.localName === "frame")) return "frame";
      var parts = chain[segment].split(" > ");
      var current = null;
      for (var index = 0; index < parts.length; index++) {
        var part = parts[index];
        if (part.charAt(0) === "#") {
          try {
            current = (index === 0 ? root : current).querySelector(part);
          } catch (error) {
            current = null;
          }
        } else {
          var match = /^([^:]+)(?::nth-of-type\((\d+)\))?$/.exec(part) || [];
          var children = [].slice.call((current || root).children).filter(function (child) {
            return child.localName === match[1];
          });
          current = children[match[2] ? Number(match[2]) - 1 : 0] || null;
        }
        if (!current) return null;
      }
      element = current;
      root = element.shadowRoot || element;
    }
    return element;
  };
  var find = function (step) {
    var byChain = step.target ? resolve(step.target) : null;
    if (byChain === "frame") return "frame";
    var locators = step.locators;
    if (!locators) return byChain;
    if (byChain && byChain.localName === locators.tag && (locators.name === "" || nameOf(byChain) === locators.name)) return byChain;
    if (locators.name !== "") {
      var equals = allElements().filter(function (element) {
        return element.localName === locators.tag && role(element) === locators.role && nameOf(element) === locators.name;
      });
      var byName = equals[locators.nth] || (equals.length === 1 ? equals[0] : null);
      if (byName) return byName;
    }
    var byStructure = locators.structural ? resolve(locators.structural) : null;
    if (byStructure && byStructure !== "frame" && byStructure.localName === locators.tag) return byStructure;
    return byChain;
  };
  function deepActive() {
    var active = document.activeElement;
    while (active && active.shadowRoot && active.shadowRoot.activeElement) active = active.shadowRoot.activeElement;
    return active || document.body;
  }
  // Tab. The browser itself does not move focus on a key event a script made, so the test page
  // does: to the next stop in the order a browser follows, through shadow roots and slots.
  var flatChildren = function (element) {
    if (element.shadowRoot) return [].slice.call(element.shadowRoot.children);
    var assigned = element.localName === "slot" && element.assignedElements ? element.assignedElements() : [];
    return assigned.length > 0 ? assigned : [].slice.call(element.children);
  };
  /** Every element a visitor can reach, in the order of the page as it is drawn; with a modal dialog open only what is in it. */
  var flatElements = function () {
    var modal = null;
    allElements().forEach(function (element) {
      try {
        if (element.localName === "dialog" && element.matches(":modal")) modal = element;
      } catch (error) {
        // A browser without :modal: the whole page counts.
      }
    });
    var out = [];
    var walk = function (element) {
      if (element.hasAttribute("inert")) return;
      out.push(element);
      flatChildren(element).forEach(walk);
    };
    walk(modal || document.documentElement);
    return out;
  };
  var tabIndexOf = function (element) {
    var written = parseInt(element.getAttribute("tabindex") || "", 10);
    return isNaN(written) ? 0 : written;
  };
  var isTabStop = function (element) {
    var tag = element.localName;
    var native = /^(button|select|textarea|iframe)$/.test(tag) || (tag === "input" && element.type !== "hidden") || (tag === "a" && element.hasAttribute("href")) || (tag === "summary" && element.parentElement && element.parentElement.localName === "details") || ((tag === "audio" || tag === "video") && element.hasAttribute("controls"));
    if (!native && !element.hasAttribute("tabindex") && !element.isContentEditable) return false;
    if (tabIndexOf(element) < 0 || element.matches(":disabled")) return false;
    // A host that hands focus on to its shadow root is no stop itself.
    if (element.shadowRoot && element.shadowRoot.delegatesFocus) return false;
    if (element.getClientRects().length === 0 || getComputedStyle(element).visibility !== "visible") return false;
    // What a closed <details> or content-visibility keeps undrawn still has a box in some browsers.
    if (element.checkVisibility && !element.checkVisibility()) return false;
    // A host with a negative tabindex takes its whole shadow tree out of the order.
    for (var root = element.getRootNode(); root && root.host; root = root.host.getRootNode()) if (tabIndexOf(root.host) < 0) return false;
    if (tag === "input" && element.type === "radio" && element.name && !element.checked) {
      // Of a group of radio buttons one is a stop: the chosen one, or the first when none is chosen.
      var group = [].slice.call(element.getRootNode().querySelectorAll("input[type=radio]")).filter(function (other) {
        return other.name === element.name && other.form === element.form;
      });
      var chosen = group.filter(function (other) {
        return other.checked;
      });
      if (chosen.length > 0 || group[0] !== element) return false;
    }
    return true;
  };
  var moveFocus = function (backward) {
    var order = flatElements();
    var plain = order.filter(isTabStop);
    // A positive tabindex goes first, lowest first; the rest follows in the order of the page.
    var stops = plain
      .filter(function (element) {
        return tabIndexOf(element) > 0;
      })
      .sort(function (a, b) {
        return tabIndexOf(a) - tabIndexOf(b);
      })
      .concat(
        plain.filter(function (element) {
          return tabIndexOf(element) === 0;
        }),
      );
    var active = deepActive();
    // From a frame the browser goes on inside it, to stops the test page cannot see: going on past it would put focus somewhere else than in the session.
    if (active.localName === "iframe" || active.localName === "frame") throw new Error("de focus staat op een ingesloten venster; een Tab gaat daarbinnen verder, en daar komt de proefpagina niet");
    var at = stops.indexOf(active);
    var next;
    if (at !== -1) next = stops[at + (backward ? -1 : 1)];
    else {
      // From an element that is no stop itself, or from where a link within the page led: the nearest stop in the order of the page.
      var from = focusStart && focusStart.isConnected ? focusStart : active;
      var place = from && from !== document.body && from !== document.documentElement ? order.indexOf(from) : -1;
      var near = stops.filter(function (element) {
        return place === -1 || (backward ? order.indexOf(element) < place : order.indexOf(element) > place);
      });
      next = backward ? near[near.length - 1] : near[0];
    }
    if (!next) throw new Error("Tab verlaat hier de pagina, naar de balk van de browser; dat kan de proefpagina niet nadoen");
    next.focus({ focusVisible: true });
    if (deepActive() !== next) throw new Error("het volgende onderdeel in de tabvolgorde nam de focus niet aan");
    return next;
  };
  var fire = function (element, type, init) {
    var Kind = /^(pointer)/.test(type) && typeof PointerEvent !== "undefined" ? PointerEvent : /^(mouse|click)/.test(type) ? MouseEvent : Event;
    element.dispatchEvent(new Kind(type, Object.assign({ bubbles: true, composed: true, cancelable: true }, init || {})));
  };
  var press = function (element) {
    try {
      element.scrollIntoView({ block: "center" });
    } catch (error) {
      // An element that cannot scroll is pressed where it is.
    }
    if (element.focus) element.focus();
    fire(element, "pointerdown");
    fire(element, "mousedown");
    fire(element, "pointerup");
    fire(element, "mouseup");
    element.click();
  };
  var fill = function (element, value) {
    if (element.focus) element.focus();
    var prototype = Object.getPrototypeOf(element);
    var setter = Object.getOwnPropertyDescriptor(prototype, "value");
    if (setter && setter.set) setter.set.call(element, value);
    else if (element.isContentEditable) element.textContent = value;
    else element.value = value;
    fire(element, "input");
    fire(element, "change");
  };
  var key = function (name) {
    var parts = name.split("+");
    var base = parts.pop();
    var keyName = base === "Space" ? " " : base;
    var init = { key: keyName, shiftKey: parts.indexOf("Shift") !== -1, ctrlKey: parts.indexOf("Control") !== -1, altKey: parts.indexOf("Alt") !== -1, metaKey: parts.indexOf("Meta") !== -1 };
    var target = deepActive();
    var down = new KeyboardEvent("keydown", Object.assign({ bubbles: true, composed: true, cancelable: true }, init));
    var allowed = target.dispatchEvent(down);
    // The key comes up where focus is then: after a Tab that is the next stop.
    var stop = allowed && keyName === "Tab" ? moveFocus(init.shiftKey) : null;
    (stop || target).dispatchEvent(new KeyboardEvent("keyup", Object.assign({ bubbles: true, composed: true, cancelable: true }, init)));
    if (!allowed) return "de pagina handelde de toets zelf af";
    if (stop) return "Tab nagedaan in de pagina: de focus is naar het volgende onderdeel in de tabvolgorde gezet" + (stop.localName === "iframe" ? "; dat is een ingesloten venster, en daarbinnen komt de proefpagina niet" : "");
    // What the browser itself does on the key, for the keys where that is plain.
    var tag = target.localName;
    var kind = (target.getAttribute && target.getAttribute("type")) || "";
    if (keyName === "Enter" && (tag === "a" || tag === "button" || tag === "summary" || (tag === "input" && /^(submit|button|image|reset)$/.test(kind)))) {
      target.click();
      return "Enter als klik";
    }
    if (keyName === "Enter" && tag === "input" && target.form) {
      if (target.form.requestSubmit) target.form.requestSubmit();
      return "Enter als versturen van het formulier";
    }
    if (keyName === " " && (tag === "button" || tag === "summary" || (tag === "input" && /^(checkbox|radio|submit|button)$/.test(kind)))) {
      target.click();
      return "spatie als klik";
    }
    if (keyName === "Escape") {
      var dialogs = [].slice.call(document.querySelectorAll("dialog[open]"));
      var open = dialogs[dialogs.length - 1];
      if (open && open.close) {
        var cancel = new Event("cancel", { cancelable: true });
        if (open.dispatchEvent(cancel)) open.close();
        return "Escape sluit het open venster";
      }
    }
    return "alleen de toetsgebeurtenis; wat de browser zelf op de toets doet, is niet nagedaan";
  };
  var choose = function (element, wanted) {
    if (element.localName !== "select") throw new Error("geen keuzelijst");
    var options = [].slice.call(element.options);
    var numbered = /^#(\d+)$/.exec(wanted);
    var index = numbered
      ? Number(numbered[1]) - 1
      : options.findIndex(function (option) {
          return (option.label || option.textContent || "").replace(/\s+/g, " ").trim() === wanted;
        });
    if (index < 0 || index >= options.length) throw new Error('geen optie "' + wanted + '"');
    if (element.focus) element.focus();
    element.selectedIndex = index;
    fire(element, "input");
    fire(element, "change");
  };
  var SPACING = "*{line-height:1.5!important;letter-spacing:0.12em!important;word-spacing:0.16em!important}p{margin-bottom:2em!important}";
  var wait = function (ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  };
  /** The element of a step, waited for a moment: a page that draws itself after loading is not done at once. */
  var findSoon = function (step) {
    var until = Date.now() + config.findMs;
    var look = function () {
      var found = find(step);
      if (found || Date.now() >= until) return Promise.resolve(found);
      return wait(150).then(look);
    };
    return look();
  };
  var playOne = function (step) {
    var how = step.how;
    if (how === "skip") return Promise.resolve({ ok: true, note: step.note });
    if (how === "spacing") {
      var style = document.createElement("style");
      style.textContent = SPACING;
      document.head.appendChild(style);
      return Promise.resolve({ ok: true });
    }
    if (how === "key") {
      // `tab 3` is the key three times, with a moment between them for what the page does on focus.
      var again = function (left) {
        var said = key(step.value);
        return left <= 1 ? { ok: true, note: said } : wait(50).then(function () {
          return again(left - 1);
        });
      };
      return Promise.resolve().then(function () {
        return again(step.times || 1);
      });
    }
    if (how === "scroll" && !step.target) {
      var to = step.value;
      if (to === "top" || to === "bottom") window.scrollTo(0, to === "top" ? 0 : document.documentElement.scrollHeight);
      else window.scrollBy(0, to === "down" ? innerHeight - 100 : to === "up" ? 100 - innerHeight : Number(to) || 0);
      return Promise.resolve({ ok: true });
    }
    return findSoon(step).then(function (element) {
      if (element === "frame") return { ok: false, note: "het element staat in een ingesloten venster; daar kan de proefpagina niet in" };
      if (!element) return { ok: false, note: "het element is niet gevonden" };
      if (how === "click") press(element);
      else if (how === "fill") fill(element, step.value);
      else if (how === "select") choose(element, step.value);
      else if (how === "focus") element.focus();
      else if (how === "hover") ["pointerover", "pointerenter", "mouseover", "mouseenter"].forEach(function (type) {
        fire(element, type);
      });
      else if (how === "scroll") element.scrollIntoView({ block: "center" });
      else return { ok: false, note: "onbekende stap" };
      if (step.after) return { ok: true, note: step.after === "Tab" ? (element.blur(), "het veld verlaten (blur); Tab zelf is niet nagedaan") : key(step.after) };
      return { ok: true, note: how === "hover" ? "alleen de gebeurtenissen van aanwijzen; de opmaak bij aanwijzen (:hover) blijft uit" : undefined };
    });
  };
  var play = function () {
    var steps = config.steps;
    var next = function (index) {
      if (index >= steps.length) {
        report.done = true;
        write();
        return Promise.resolve();
      }
      return Promise.resolve()
        .then(function () {
          return playOne(steps[index]);
        })
        .catch(function (error) {
          return { ok: false, note: String((error && error.message) || error).split("\n")[0] };
        })
        .then(function (outcome) {
          report.steps.push({ i: index + 1, c: steps[index].command, ok: outcome.ok, note: outcome.note || null });
          write();
          // A step that did not work leaves the page in another state than the one asked for: the rest is not played.
          if (!outcome.ok) {
            report.done = true;
            write();
            return undefined;
          }
          return wait(steps[index].how === "skip" ? 0 : config.settleMs).then(function () {
            return next(index + 1);
          });
        });
    };
    return next(0);
  };
  write();
  window.addEventListener("load", function () {
    setTimeout(play, config.startMs);
  });
})
