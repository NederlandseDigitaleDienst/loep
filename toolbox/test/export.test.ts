import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { exportWorkList, workListCsv, workListIssues } from "../src/commands/export.ts";
import { readEvaluation } from "../src/commands/sign.ts";
import { canonicalJson } from "../src/lib/canonical.ts";
import { mergeFindings } from "../src/lib/defects.ts";
import { summarise, type Evaluation, type ReportFinding } from "../src/lib/evaluation.ts";
import { deriveReport } from "../src/lib/report-markdown.ts";
import { exampleEvaluation } from "./fixtures/example-evaluation.ts";

const dir = mkdtempSync(join(tmpdir(), "loep-export-"));
after(() => rmSync(dir, { recursive: true, force: true }));

/** The example evaluation with one grey block that three criteria found, and one other finding with a comma and quotes in it. */
function evaluation(): Evaluation {
  const result = exampleEvaluation();
  const path = ["#menu > app-list > app-list-item:nth-of-type(2)", "div > a"];
  const finding = (criterion: string, extra: Partial<ReportFinding> = {}): ReportFinding => ({
    id: `T-${criterion}-1`,
    criterion,
    titleNl: "Huidige pagina in het menu alleen met een grijs vlak aangegeven",
    observedNl: "Het vlak is #d9dee5 op #f5f7f9 (1,2:1).",
    impactNl: "Wie slecht ziet, ziet niet waar hij is.",
    fixNl: "Geef het item een tweede kenmerk naast de kleur.",
    severity: "midden",
    owner: "design",
    component: "zijmenu",
    locations: [{ page: "P01", where: "zijmenu, het item van de huidige pagina" }],
    pagesAffected: "P01",
    evidence: [],
    targets: [{ page: "P01", path, state: null }],
    ...extra,
  });
  const findings: Record<string, ReportFinding[]> = {
    "1.4.1": [finding("1.4.1")],
    "1.4.3": [finding("1.4.3", { titleNl: "Tekst op het grijze vlak" })],
    "1.4.11": [finding("1.4.11", { titleNl: "Het grijze vlak steekt te weinig af" })],
    "2.4.4": [finding("2.4.4", { titleNl: 'Link "Lees meer", zonder doel', observedNl: "Drie links heten \"Lees meer\", zonder meer.", severity: "hoog", owner: "content", component: null, targets: [{ page: "P02", path: ["#nieuws > a"], state: null }], locations: [{ page: "P02", where: "#nieuws > a" }], pagesAffected: "P02" })],
  };
  for (const criterion of result.criteria) {
    criterion.findings = findings[criterion.id] ?? [];
    criterion.outcome = criterion.findings.length > 0 ? "failed" : criterion.outcome === "failed" ? "passed" : criterion.outcome;
  }
  result.summary = summarise(result.criteria);
  result.defects = mergeFindings(result);
  return result;
}

/** The fields of a CSV text, as RFC 4180 reads them. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [[]];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') (field += '"'), index++;
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") rows.at(-1)!.push(field), (field = "");
    else if (char === "\r" && text[index + 1] === "\n") rows.at(-1)!.push(field), (field = ""), rows.push([]), index++;
    else field += char;
  }
  return rows.filter((row) => row.length > 0);
}

test("the CSV has a row per line of the work list: three findings on one element are one row with the three criteria", () => {
  const rows = parseCsv(workListCsv(evaluation()));
  assert.deepEqual(rows[0], ["gebrek", "titel", "ernst", "eigenaar", "hoofdcriterium", "criteria", "paginas", "onderdeel", "element", "wat_is_er_mis", "wie_heeft_er_last_van", "oplossing", "bevindingen"]);
  assert.equal(rows.length, 3, "a header and two lines");
  // The heaviest first, as in the report.
  const [link, block] = rows.slice(1);
  assert.deepEqual([link![2], link![4], link![5], link![9]], ["hoog", "2.4.4", "2.4.4", 'Drie links heten "Lees meer", zonder meer.'], "a comma and quotes survive");
  assert.equal(link![1], 'Link "Lees meer", zonder doel');
  assert.deepEqual([block![1], block![2], block![3], block![4], block![5], block![6], block![7]], ["Huidige pagina in het menu alleen met een grijs vlak aangegeven", "midden", "design", "1.4.1", "1.4.1 1.4.3 1.4.11", "P01", "zijmenu"]);
  assert.equal(block![12], "T-1.4.1-1 T-1.4.3-1 T-1.4.11-1");
  assert.match(block![0]!, /^T-G-[0-9a-f]{4}$/);
});

test("the issues have a title and a body per line, and export writes them to files or standard output, never into the run", async () => {
  const blocks = workListIssues(evaluation());
  assert.equal(blocks.length, 2);
  const block = blocks.find((entry) => entry.title.startsWith("Huidige pagina"))!;
  assert.ok(block.body.includes("- WCAG-succescriteria: 1.4.1 (hoofdcriterium), raakt ook 1.4.3, 1.4.11"));
  assert.ok(block.body.includes("## Oplossing\n\nGeef het item een tweede kenmerk naast de kleur."));
  assert.ok(block.body.includes("- T-1.4.11-1 onder 1.4.11: Het grijze vlak steekt te weinig af"));
  assert.equal((block.body.match(/^- P01 \(/gm) ?? []).length, 1, "the same place named by three findings stands once");

  writeFileSync(join(dir, "evaluation.json"), canonicalJson(evaluation()));
  const csv = await exportWorkList({ run: dir, format: "csv" });
  assert.equal(csv.text!.split("\r\n")[0], "gebrek,titel,ernst,eigenaar,hoofdcriterium,criteria,paginas,onderdeel,element,wat_is_er_mis,wie_heeft_er_last_van,oplossing,bevindingen");
  const out = join(dir, "issues");
  const written = await exportWorkList({ run: dir, format: "issues", out });
  assert.equal(written.written.length, 2);
  // The evaluation as it was read from the file, as render reads it: its hash is the one the report shows.
  const read = workListIssues(await readEvaluation(join(dir, "evaluation.json")))[1]!;
  const file = readFileSync(written.written.find((path) => path.endsWith(`${read.id}.md`))!, "utf8");
  assert.equal(file.split("\n")[0], `# ${read.title}`);
  assert.equal(file.split("\n").slice(2).join("\n"), read.body);
  assert.ok(read.body.includes(`evaluatie ${deriveReport(await readEvaluation(join(dir, "evaluation.json"))).hashShort}.`), "the issue names the version of the evaluation as the report does");
  await assert.rejects(exportWorkList({ run: dir, format: "xlsx" }), /export verwacht --format csv of issues/);
});
