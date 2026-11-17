import assert from "node:assert/strict";
import { test } from "node:test";
import { documents } from "../src/lib/document-evidence.ts";
import { KIND_NAME_NL } from "../src/lib/documents.ts";
import { uiContrast } from "../src/lib/extractors.ts";
import { loadAllProcedures, loadProcedure } from "../src/lib/procedures.ts";
import type { RunData } from "../src/lib/rundata.ts";

/** Every key at any depth of a dossier part. */
function keys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const entry of value) keys(entry, into);
  else if (value && typeof value === "object")
    for (const [key, entry] of Object.entries(value)) {
      into.add(key);
      keys(entry, into);
    }
  return into;
}

/** The procedure names each field between backticks, and the dossier part has it. */
function namedAndThere(id: string, part: unknown, fields: string[]): void {
  const body = loadProcedure(id).body;
  const there = keys(part);
  for (const field of fields) {
    const last = field.split(".").at(-1)!;
    assert.ok(body.includes(`\`${field}\``), `${id} does not name \`${field}\``);
    assert.ok(there.has(last), `the dossier of ${id} has no ${field}`);
  }
}

const picture = (recognised: boolean) => ({
  label: "D01",
  item: { url: "https://voorbeeld.example/organogram.png", kind: "image", linkedFrom: [{ page: "https://voorbeeld.example/", text: "Organogram" }] },
  facts: {
    status: "read", kind: "image", url: "https://voorbeeld.example/organogram.png", title: null, language: null, pages: 1,
    images: [{ page: 1, alt: null, context: "het bestand zelf: een afbeelding van 400 bij 60 pixels" }], headings: [], tables: [], links: [], fields: [],
    image: { format: "png", width: 400, height: 60, recognisedWords: recognised ? 5 : null, recognisedText: recognised ? "Aanvraag indienen voor 1 maart" : null },
    notMeasuredNl: recognised ? [] : ["tekstherkenning is niet beschikbaar; of de afbeelding tekst bevat, is niet nagegaan"],
    files: { text: "documents/D01/text.txt", tagTree: null, pageImages: ["documents/D01/page-1.png"] },
  },
});
const runWith = (document: ReturnType<typeof picture>): RunData => ({ documents: [document], sample: {} }) as unknown as RunData;

test("the procedures on documents name what the dossier gives for a picture file, by the kind the dossier writes (#636)", () => {
  const kind = KIND_NAME_NL.image;
  for (const id of ["1.1.1", "1.4.5", "4.1.1"]) assert.ok(loadProcedure(id).body.includes(`\`kind\` is \`${kind}\``), `${id} does not name the kind ${kind}`);
  const read = runWith(picture(true));
  namedAndThere("1.1.1", documents(read, "1.1.1"), ["pictureFile", "linkTexts", "images.withoutAlternative", "pictureFile.recognisedText"]);
  namedAndThere("1.4.5", documents(read, "1.4.5"), ["pictureFile", "recognisedWords", "recognisedText"]);
  namedAndThere("2.4.2", documents(read, "2.4.2"), ["titleProperty", "notApplicableNl", "linkTexts"]);
  for (const id of ["3.1.1", "3.1.2"]) namedAndThere(id, documents(read, id), ["languageProperty", "notApplicableNl"]);
  // Without text recognition the count is null and notMeasuredNl says why: 1.4.5 names both, so the judge looks instead.
  const unread = documents(runWith(picture(false)), "1.4.5") as { documents: { pictureFile: { recognisedWords: number | null }; notMeasuredNl?: string[] }[] };
  assert.equal(unread.documents[0]!.pictureFile.recognisedWords, null);
  assert.ok(unread.documents[0]!.notMeasuredNl!.length > 0);
  namedAndThere("1.4.5", unread, ["recognisedWords", "notMeasuredNl"]);
});

test("1.4.11 names what the dossier gives under uiContrast.pointedAt, and a run without that measurement says so with examined (#636)", () => {
  const boundary = { tag: "button", text: "Verstuur", region: null, where: "#send", box: { x: 0, y: 0, width: 80, height: 30 }, outside: "#ffffff", edge: "#e6e6e6", fill: "#ffffff", edgeRatio: 1.2, fillRatio: 1, outcome: "kandidaat" };
  const run = {
    pages: [{ label: "P1", item: { slug: "p1" }, tabwalk: { stops: [] }, tabwalkDark: null }],
    contrast: [{ url: "x", slug: "p1", scheme: "light", measurements: [], controls: [], graphics: [] }],
    states: { hoverNonText: [{ page: "P1", control: "button Verstuur", where: "#send", boundary, graphic: null, shapes: [] }] },
  } as unknown as RunData;
  const part = uiContrast(run, "1.4.11");
  namedAndThere("1.4.11", part, ["uiContrast.pointedAt", "pointedAt.candidates", "pointedAt.cantTell", "uiContrast.pointedAt.controlsMeasured", "part", "on", "where", "ratio", "foreground", "background", "occurrences"]);
  // The rows can be missing: then examined is false, and the procedure says what to do before it reads a row.
  const older = (uiContrast({ ...run, states: {} } as unknown as RunData, "1.4.11") as { pointedAt: Record<string, unknown> }).pointedAt;
  assert.deepEqual([older.examined, "candidates" in older], [false, false]);
  assert.ok(loadProcedure("1.4.11").body.includes("Lees `uiContrast.pointedAt`") && loadProcedure("1.4.11").body.includes("`examined: false`"));
});

test("every procedure with documents names the limitation document-limit of the gate, and the dossier lists such a document as not read (#636)", () => {
  const withDocuments = loadAllProcedures().procedures.filter((procedure) => procedure.evidence.includes("documents"));
  assert.equal(withDocuments.length, 11);
  for (const procedure of withDocuments) assert.ok(procedure.body.includes("`document-limit`") && procedure.body.includes("`notRead`"), `${procedure.id} does not name document-limit`);
  const tooLarge = { label: "D02", item: { url: "https://voorbeeld.example/groot.pdf", kind: "pdf", linkedFrom: [] }, facts: { status: "failed", kind: "pdf", reasonNl: "het bestand is 300 MB; de grens is 250 MB", limit: "size" } };
  const part = documents({ documents: [tooLarge], sample: {} } as unknown as RunData, "1.1.1") as { notRead: { document: string; reasonNl: string }[] };
  assert.deepEqual(part.notRead.map((entry) => entry.document), ["D02"]);
  assert.match(part.notRead[0]!.reasonNl, /de grens is/);
});
