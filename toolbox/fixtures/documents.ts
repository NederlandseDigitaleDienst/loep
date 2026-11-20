/**
 * The documents of the fixture site: which file in src/documenten/ each site serves at which
 * address, and the budget that the server makes larger than the toolbox reads. The files are
 * made once by src/documenten/bron/make.sh and committed; build.ts copies them, serve.ts pads
 * the large one. Node built-ins only, because the server imports this file.
 */

export interface FixtureDocument {
  /** Where it is served, below the root of the site (or of the third origin). */
  path: string;
  /** The site that serves it: both twins, or the third origin. */
  on: "site" | "thirdParty";
  /** The file in src/documenten/ per variant; for the third origin each twin links to its own. */
  defect: string;
  clean: string;
  /** The switch in the key this document plants. */
  plants: string;
}

export const DOCUMENTS: FixtureDocument[] = [
  { path: "documenten/agenda-raadsvergadering-2026-03-12.pdf", on: "site", defect: "agenda.a.pdf", clean: "agenda.b.pdf", plants: "1.3.1-agenda-pdf" },
  { path: "documenten/besluitenlijst-2026-03-12.pdf", on: "site", defect: "besluitenlijst.a.pdf", clean: "besluitenlijst.b.pdf", plants: "2.4.2-besluitenlijst-pdf" },
  { path: "documenten/begroting-2027.pdf", on: "site", defect: "begroting.a.pdf", clean: "begroting.b.pdf", plants: "1.3.1-begroting-pdf" },
  { path: "documenten/ontheffing-parkeren.docx", on: "site", defect: "ontheffing.a.docx", clean: "ontheffing.b.docx", plants: "1.3.1-ontheffing-docx" },
  { path: "documenten/plattegrond-gemeentehuis.png", on: "site", defect: "plattegrond.a.png", clean: "plattegrond.b.png", plants: "1.1.1-plattegrond" },
  { path: "documenten/afvalwijzer-2027-lindewaard.pdf", on: "thirdParty", defect: "afvalwijzer.a.pdf", clean: "afvalwijzer.a.pdf", plants: "1.3.1-afvalwijzer-extern" },
  { path: "documenten/afvalwijzer-2027-berkenveen.pdf", on: "thirdParty", defect: "afvalwijzer.b.pdf", clean: "afvalwijzer.b.pdf", plants: "1.3.1-afvalwijzer-extern" },
];

/**
 * Served documents that the server makes larger than they are in the repository, with the size
 * they get. Above the 250 MB up to which the toolbox fetches a document (MAX_DOCUMENT_BYTES in
 * src/commands/documents.ts); a test keeps it there.
 */
export const LARGE_DOCUMENTS: Record<string, number> = { "/documenten/begroting-2027.pdf": 262 * 1024 * 1024 };

/**
 * A PDF made larger by an incremental update: an unreferenced stream object of zero bytes after
 * the original, with a cross-reference section and a trailer that point back to the original.
 * A reader opens the same document. Needs a PDF with a cross-reference table, as make.sh writes.
 * Returns the bytes before and after the zeros, and how many zeros go between them.
 */
export function paddedPdf(original: Buffer, size: number): { head: Buffer; zeros: number; tail: Buffer } {
  const text = original.toString("latin1");
  const previous = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(text)?.[1]);
  const trailer = /trailer\s*(<<[\s\S]*?>>)\s*startxref\s+\d+\s+%%EOF\s*$/.exec(text)?.[1];
  const count = Number(/\/Size (\d+)/.exec(trailer ?? "")?.[1]);
  if (!Number.isFinite(previous) || !trailer || !Number.isFinite(count)) throw new Error("the PDF has no cross-reference table to append to");
  const start = original.length;
  const opening = `\n${count} 0 obj\n<< /Length ${"0".repeat(12)} >>\nstream\n`;
  const zerosFor = (tailLength: number): number => size - start - opening.length - tailLength;
  const tailOf = (zeros: number): string => {
    const xref = start + opening.length + zeros + "\nendstream\nendobj\n".length;
    const dictionary = trailer.replace(/\/Size \d+/, `/Size ${count + 1}`).replace(/\s*\/Prev \d+/, "").replace(/^<</, `<< /Prev ${previous}`);
    return `\nendstream\nendobj\nxref\n${count} 1\n${String(start + 1).padStart(10, "0")} 00000 n \ntrailer\n${dictionary}\nstartxref\n${xref}\n%%EOF\n`;
  };
  // The tail names offsets past the zeros; its length settles after one more round.
  let zeros = zerosFor(tailOf(zerosFor(0)).length);
  zeros = zerosFor(tailOf(zeros).length);
  return { head: Buffer.concat([original, Buffer.from(opening.replace("0".repeat(12), String(zeros).padStart(12, "0")), "latin1")]), zeros, tail: Buffer.from(tailOf(zeros), "latin1") };
}
