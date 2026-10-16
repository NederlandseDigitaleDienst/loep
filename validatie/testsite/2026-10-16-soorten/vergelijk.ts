// Run the hover and press probes of `states` on every page of both testsites, in the default and
// the narrow window, and write how many kinds of control they found, how many they examined, and
// whether the planted defects that these probes show were reached and shown.
//
// Usage: node vergelijk.ts <toolbox> <out.json>
// Run it once with the toolbox before the change and once after, and lay the two files side by side.
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

const [toolboxArg, out] = process.argv.slice(2);
const toolbox = resolve(toolboxArg!);
const { startFixture } = await import(join(toolbox, "fixtures/serve.ts"));
const { DEFECTS } = await import(join(toolbox, "fixtures/defects.ts"));
const { HoverRun, DownRun } = await import(join(toolbox, "src/commands/states.ts"));
const { INPAGE_PATH, launchBrowser, loadPage, newContext } = await import(join(toolbox, "src/browser/session.ts"));
const { call } = await import(join(toolbox, "src/browser/call.ts"));
const { browserListeners } = await import(join(toolbox, "src/instruments/keys.ts"));
const { DOWN_EVENTS, DELEGATING } = await import(join(toolbox, "src/instruments/pointer.ts"));

/** The defects that the hover and press probes are there to show, and what showing them means. */
const SHOWN: Record<string, (rows: Rows, controls: Set<string>) => boolean> = {
  "1.4.3-menu-aanwijzen": (rows, controls) => rows.contrast.some((row) => controls.has(row.control) && row.trigger === "hover" && row.texts.some((text) => text.ratio !== null && text.ratio < text.required)),
  "1.4.13-uitleg": (rows, controls) => rows.hover.some((row) => controls.has(row.control) && (row.dismissedByEscape === false || row.staysWhenPointerMovesOntoIt === false)),
  "2.4.7-menu": (rows, controls) => rows.contrast.some((row) => controls.has(row.control) && row.trigger === "focus"),
  "3.2.1-voetlink": (rows, controls) => rows.examined.some((control) => controls.has(control)),
  "2.5.2-feedback": (rows, controls) => rows.down.some((row) => controls.has(row.control) && row.changeOnDown !== null && row.undoneByReleasingElsewhere === false),
};

interface Rows {
  hover: { page: string; control: string; dismissedByEscape: boolean | null; staysWhenPointerMovesOntoIt: boolean | null }[];
  contrast: { page: string; control: string; trigger: string; texts: { ratio: number | null; required: number }[] }[];
  down: { page: string; control: string; changeOnDown: string | null; undoneByReleasingElsewhere?: boolean }[];
  examined: string[];
}

const scratch = mkdtempSync(join(tmpdir(), "loep-soorten-"));
const fixture = await startFixture({ ports: { defect: 0, clean: 0, thirdParty: 0 }, logFile: join(scratch, "server.log") });
const browser = await launchBrowser();
const result: Record<string, unknown> = {};

function pagesOf(dir: string): string[] {
  const found: string[] = [];
  const walk = (at: string): void => {
    for (const name of readdirSync(at)) {
      const full = join(at, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".html")) found.push(`/${relative(dir, full)}`.replace(/index\.html$/, ""));
    }
  };
  walk(dir);
  // Behind the login, and the page for an unknown address: not in a sample without a session.
  return found.filter((path) => !path.startsWith("/mijn/") && path !== "/404.html").sort();
}

try {
  for (const [site, origin] of [["lindewaard", fixture.origins.defect], ["berkenveen", fixture.origins.clean]] as const) {
    const paths = pagesOf(join(toolbox, "fixtures/sites", site));
    const hovering = new HoverRun(scratch);
    const pressing = new DownRun();
    const started = Date.now();
    for (const narrow of [false, true]) {
      const context = await newContext(browser, narrow ? { viewport: { width: 360, height: 740 } } : {});
      await context.addInitScript({ path: INPAGE_PATH });
      const empty = await context.newPage();
      const own = await browserListeners(empty);
      await empty.close();
      for (const path of paths) {
        let page: any = null;
        const source = async (fresh = false) => {
          if (page && !fresh) {
            await page.mouse.move(0, 0).catch(() => undefined);
            return page;
          }
          await page?.close().catch(() => undefined);
          page = await context.newPage();
          await loadPage(page, `${origin}${path}`);
          // The cookie notice is closed first, as the sweep does with a blocker of the site model.
          const refuse = page.locator("[data-keuze=weigeren]");
          if (await refuse.isVisible().catch(() => false)) await refuse.click();
          return page;
        };
        const place = { label: path, narrow, shot: `${site}${path.replace(/\W+/g, "-")}${narrow ? "-smal" : ""}` };
        await hovering.on(place, source);
        const first = await source(true);
        const counts = await call(first, "listenerCounts").catch(() => ({}));
        const delegated = DOWN_EVENTS.some((event: string) => DELEGATING.some((target: string) => (counts[event]?.[target] ?? 0) > (own[event]?.[target] ?? 0)));
        await pressing.on(place, source, new Set(), delegated);
        await page?.close().catch(() => undefined);
      }
      await context.close();
    }
    const coverage = hovering.coverage();
    const examined = [...hovering.hover, ...hovering.contrast, ...hovering.iconOnly, ...pressing.results].map((row: { control: string }) => row.control);
    const rows: Rows = { hover: hovering.hover, contrast: hovering.contrast, down: pressing.results, examined: [...new Set(examined)] };
    const defects: Record<string, { pages: number; controls: number; examined: number; shown: boolean }> = {};
    if (site === "lindewaard") {
      for (const defect of DEFECTS.filter((entry: { id: string }) => entry.id in SHOWN)) {
        const on = defect.pages[0] === "*" ? paths : defect.pages;
        // The controls that are the defect, that hold it, or that stand in it, as the probes name them.
        const controls = new Set<string>();
        const context = await newContext(browser, {});
        await context.addInitScript({ path: INPAGE_PATH });
        for (const path of on) {
          const page = await context.newPage();
          await loadPage(page, `${origin}${path}`);
          const targets = [...(await call(page, "hoverTargets")), ...(await call(page, "hoverHints").catch(() => []))];
          const hits = await page.evaluate(([chains, selector]: [string[][], string]) => {
            const loep = (window as unknown as { __loep: { resolve: (chain: string[]) => Element | null } }).__loep;
            return chains.map((chain) => {
              const element = loep.resolve(chain);
              return element !== null && (element.matches(selector) || element.querySelector(selector) !== null || element.closest(selector) !== null);
            });
          }, [targets.map((target: { path: string[] }) => target.path), defect.selector] as [string[][], string]);
          for (const [index, target] of targets.entries()) if (hits[index]) controls.add(`${target.tag} "${target.text.slice(0, 40)}" [${target.region ?? "-"}]`);
          await page.close();
        }
        await context.close();
        defects[defect.id] = { pages: on.length, controls: controls.size, examined: rows.examined.filter((control) => controls.has(control)).length, shown: SHOWN[defect.id]!(rows, controls) };
      }
    }
    result[site] = {
      pages: paths.length,
      seconds: Math.round((Date.now() - started) / 1000),
      hover: { found: coverage.found, kinds: coverage.kinds, examined: coverage.examined, notExamined: coverage.notExamined },
      press: { kinds: pressing.seen.size + pressing.left.size, pressed: pressing.results.length, notExamined: pressing.left.size, actedAndStayed: pressing.results.filter((row: { changeOnDown: string | null; undoneByReleasingElsewhere?: boolean }) => row.changeOnDown !== null && row.undoneByReleasingElsewhere === false).length },
      ...(site === "lindewaard" ? { defects } : {}),
    };
    process.stderr.write(`${site}: ${JSON.stringify(result[site])}\n`);
  }
} finally {
  await browser.close();
  await fixture.close();
}
writeFileSync(out!, `${JSON.stringify(result, null, 2)}\n`);
