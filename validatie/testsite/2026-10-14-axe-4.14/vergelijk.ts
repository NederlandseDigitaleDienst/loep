// Run two versions of axe-core on every page of the testsites the way the toolbox runs it
// (same tags, light and dark, 1280 by 800) and print what changed per rule.
//
// Usage: node vergelijk.ts <toolbox> <workdir>
// <workdir>/old and <workdir>/new each hold an npm install of one axe-core version;
// <workdir>/runs/<site>/inventory.json is the output of `inventory` for each site.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const [toolbox, work] = process.argv.slice(2);
const { chromium } = createRequire(`${toolbox}/package.json`)("playwright");
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const axeIn = (dir) => ({
  version: JSON.parse(readFileSync(`${work}/${dir}/node_modules/axe-core/package.json`, "utf8")).version,
  source: readFileSync(`${work}/${dir}/node_modules/axe-core/axe.min.js`, "utf8"),
});
const VERSIONS = [axeIn("old"), axeIn("new")];
const KIND = { violations: "failed", incomplete: "cantTell", passes: "passed" };

const browser = await chromium.launch();
const rows = [];
for (const site of readdirSync(`${work}/runs`)) {
  const pages = JSON.parse(readFileSync(`${work}/runs/${site}/inventory.json`, "utf8")).pages.filter((page) => page.status === 200);
  for (const { url } of pages) {
    for (const scheme of ["light", "dark"]) {
      for (const { version, source } of VERSIONS) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: scheme });
        const page = await context.newPage();
        // Only reading: anything that could change something on the server is refused.
        await page.route("**/*", (route) => (["GET", "HEAD"].includes(route.request().method()) ? route.continue() : route.abort("blockedbyclient")));
        await page.goto(url, { waitUntil: "load" });
        await page.evaluate(source);
        const result = await page.evaluate((tags) => window.axe.run(document, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations", "incomplete", "passes"] }), TAGS);
        for (const [key, outcome] of Object.entries(KIND))
          for (const rule of result[key])
            for (const node of rule.nodes) rows.push({ site, url, scheme, version, rule: rule.id, outcome, target: JSON.stringify(node.target), wcag: rule.tags.filter((tag) => /^wcag\d{3,4}$/.test(tag)).join(" ") });
        await context.close();
      }
    }
  }
}
await browser.close();
writeFileSync(`${work}/axe-rows.json`, JSON.stringify(rows));

// Per rule: the nodes whose outcome differs between the two versions.
const [old, now] = VERSIONS.map((entry) => entry.version);
const key = (row) => `${row.site}|${row.url}|${row.scheme}|${row.rule}|${row.target}`;
const by = { [old]: new Map(), [now]: new Map() };
for (const row of rows) by[row.version].set(key(row), row);
const summary = {};
for (const k of new Set([...by[old].keys(), ...by[now].keys()])) {
  const before = by[old].get(k)?.outcome ?? "-";
  const after = by[now].get(k)?.outcome ?? "-";
  if (before === after) continue;
  const row = by[now].get(k) ?? by[old].get(k);
  const id = `${row.rule} (${row.wcag || "no wcag tag"}) ${before} -> ${after}`;
  summary[id] ??= { count: 0, sites: new Set(), examples: [] };
  summary[id].count++;
  summary[id].sites.add(row.site);
  if (summary[id].examples.length < 4) summary[id].examples.push(`${row.site} ${new URL(row.url).pathname} ${row.scheme} ${row.target}`);
}
const total = (version, outcome) => rows.filter((row) => row.version === version && row.outcome === outcome).length;
console.log(`pages: ${new Set(rows.map((row) => row.site + row.url)).size}, versions: ${old} and ${now}`);
for (const outcome of ["failed", "cantTell", "passed"]) console.log(`${outcome}: ${old} ${total(old, outcome)}, ${now} ${total(now, outcome)}`);
for (const [id, entry] of Object.entries(summary).sort((a, b) => b[1].count - a[1].count))
  console.log(`\n${id}: ${entry.count} nodes [${[...entry.sites].join(", ")}]\n  ${entry.examples.join("\n  ")}`);
