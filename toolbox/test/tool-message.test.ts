import assert from "node:assert/strict";
import { test } from "node:test";
import { toolMessage } from "../src/instruments/documents/pdf.ts";

test("toolMessage: keeps only the name of the file, not the path on this machine", () => {
  const output = "WARNING: /home/someone/loep/toolbox/runs/x/documents/d12/original.pdf: can't find startxref\nsecond line";
  assert.equal(toolMessage(output), "WARNING: original.pdf: can't find startxref");
});

test("toolMessage: a line without a path stays as it is", () => {
  assert.equal(toolMessage("  file is damaged  \n"), "file is damaged");
});
