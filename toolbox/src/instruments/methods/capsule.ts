import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { Frame, Page } from "playwright";
import { fixedOnWindow } from "../../browser/call.ts";
import { TOOLBOX_ROOT, toolboxRequire } from "./registry.ts";

/** The in-page helpers of the second-opinion methods, installed as window.__loepm on demand. */
const INPAGE_METHODS = readFileSync(fileURLToPath(new URL("./inpage-methods.js", import.meta.url)), "utf8");

const sources = new Map<string, string>();

/** The source of a script that an installed package ships for the browser. */
export function packageSource(specifier: string): string {
  let source = sources.get(specifier);
  if (source === undefined) {
    source = readFileSync(toolboxRequire.resolve(specifier), "utf8");
    sources.set(specifier, source);
  }
  return source;
}

/**
 * A package that ships as separate CommonJS files with only relative requires, turned into
 * one expression that evaluates to its exports. Enough of a bundler for such a package, and
 * it keeps a build tool out of the dependencies.
 */
export function commonJsBundle(packageName: string, entry: string): string {
  const key = `cjs:${packageName}:${entry}`;
  const cached = sources.get(key);
  if (cached !== undefined) return cached;
  const root = join(TOOLBOX_ROOT, "node_modules", packageName);
  const dir = dirname(join(root, entry));
  const modules: string[] = [];
  const visit = (folder: string): void => {
    for (const name of readdirSync(folder).sort()) {
      const path = join(folder, name);
      if (statSync(path).isDirectory()) visit(path);
      else if (name.endsWith(".js")) modules.push(`${JSON.stringify(`./${relative(dir, path).slice(0, -3)}`)}: function (module, exports, require) {\n${readFileSync(path, "utf8")}\n}`);
    }
  };
  visit(dir);
  const start = `./${relative(dir, join(root, entry)).slice(0, -3)}`;
  const bundle = `(function () {
  const modules = {${modules.join(",\n")}};
  const loaded = {};
  const load = (from, id) => {
    const parts = from.split("/").slice(0, -1);
    for (const part of id.split("/")) {
      if (part === "..") parts.pop();
      else if (part !== ".") parts.push(part);
    }
    const name = parts.join("/");
    if (loaded[name]) return loaded[name].exports;
    if (!modules[name]) throw new Error("module not in bundle: " + name);
    const module = (loaded[name] = { exports: {} });
    modules[name](module, module.exports, (inner) => load(name, inner));
    return module.exports;
  };
  return load("./x", ${JSON.stringify(start)});
})()`;
  sources.set(key, bundle);
  return bundle;
}

/**
 * Install window.__loepm in a frame when it is not there yet. It only reads, like window.__loep.
 * One that the page put there itself is refused: a method would otherwise read with the page's functions (#143).
 */
export async function ensureHelpers(frame: Frame | Page): Promise<void> {
  if (await frame.evaluate(fixedOnWindow, "__loepm")) return;
  await frame.evaluate(INPAGE_METHODS);
  if (!(await frame.evaluate(fixedOnWindow, "__loepm"))) throw new Error("de pagina heeft zelf een window.__loepm gezet, zodat loep zijn eigen hulpfuncties niet kan gebruiken; wat deze methode op deze pagina zou meten, kan niet worden vastgesteld");
}

/**
 * Run library code inside the page without leaving a trace: the libraries are evaluated in
 * one function scope, `body` (the source of a function taking one argument) runs there, and
 * every global that appeared is taken away again. A library injected for one method can so
 * never break the globals of another method or of the page itself.
 */
export function capsule(libraries: string[], body: string, argument: unknown = null): string {
  const read = SHARED_GLOBALS.filter((name) => new RegExp(`(?<![\\w$.])${name.replace(/\$/g, "\\$")}(?![\\w$])`).test(body));
  return `(async function () {
  // A library announces itself to a loader of modules when it finds one; the page could take it from there and change it.
  var define, module, exports;
  ${refuseFixedGlobals(read)}
  const __names = new Set(Object.getOwnPropertyNames(window));
  const __kept = {};
  for (const name of ${JSON.stringify(SHARED_GLOBALS)}) if (name in window) __kept[name] = Object.getOwnPropertyDescriptor(window, name);
  try {
    ${libraries.join("\n;\n")}
    ;
    return await (${body})(${JSON.stringify(argument)});
  } finally {
    for (const name of Object.getOwnPropertyNames(window)) {
      if (__names.has(name)) continue;
      try { delete window[name]; } catch { /* not configurable: nothing to do */ }
    }
    for (const name of Object.keys(__kept)) {
      try { if (__kept[name]) Object.defineProperty(window, name, __kept[name]); } catch { /* the page made it read-only */ }
    }
  }
}).call(window)`;
}

/**
 * Source that throws when the page made one of these globals its own before a library could set it: not writable,
 * or with a getter or setter, on the window or on its prototypes. The library would then not replace it, and the
 * code after it would run the page's version, or the page would get hold of the library and could change it (#143).
 */
export function refuseFixedGlobals(names: readonly string[]): string {
  if (names.length === 0) return "";
  return `for (const __name of ${JSON.stringify(names)}) {
    let __found;
    for (let __at = window; __at && !__found; __at = Object.getPrototypeOf(__at)) __found = Object.getOwnPropertyDescriptor(__at, __name);
    if (__found && (!("value" in __found) || !__found.writable)) throw new Error("de pagina heeft window." + __name + " zelf vastgezet, zodat loep zijn eigen bibliotheek niet kan laden; wat die op deze pagina zou vinden, kan niet worden vastgesteld");
  }`;
}

/**
 * A library that hangs its exports on `this`, among them a property the window could never
 * lose again. It gets an object of its own for `this`; its exports are then copied to the
 * window, from where the capsule takes them away afterwards.
 */
export function exportsOnThis(source: string): string {
  return `(function () { const scratch = {}; (function () {\n${source}\n}).call(scratch); for (const key of Object.keys(scratch)) window[key] = scratch[key]; })();`;
}

/** Globals that an injected library overwrites when the page happens to have one of the same name; put back afterwards. */
const SHARED_GLOBALS = ["axe", "ace", "qwPage", "QWPage", "DomUtils", "AccessibilityUtils", "ACTRules", "ACTRulesRunner", "WCAGTechniques", "WCAGTechniquesRunner", "LocaleFetcher", "disabledWidgets", "__esModule", "tabbable"];

/** Evaluate a capsule in a frame and give back what its body returned. */
export async function inCapsule<T>(frame: Frame | Page, libraries: string[], body: string, argument: unknown = null): Promise<T> {
  await ensureHelpers(frame);
  return (await frame.evaluate(capsule(libraries, body, argument))) as T;
}
