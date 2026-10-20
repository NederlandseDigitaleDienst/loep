import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "../../src/lib/canonical.ts";
import { chunksOf, requiredParts, valueAt } from "../../src/lib/dossier-view.ts";
import { recordDossierRead } from "../../src/session/dossier-command.ts";

/** As a judge does before it passes a criterion: read every part of the dossier the criterion counts on, in full, with `dossier`. */
export function readDossierInFull(runDir: string, session: string, criterion: string): void {
  const index = JSON.parse(readFileSync(join(runDir, "tasks", "index.json"), "utf8")) as { tasks: { criterion: string; dossier: string }[] };
  const dossierPath = index.tasks.find((task) => task.criterion === criterion)!.dossier;
  const text = readFileSync(join(runDir, dossierPath), "utf8");
  const dossier = JSON.parse(text) as Record<string, unknown>;
  const read = requiredParts(dossier).flatMap((path) => {
    const chunks = chunksOf(valueAt(dossier, path)).length;
    return Array.from({ length: chunks }, (_, position) => ({ path, chunk: position + 1, chunks }));
  });
  recordDossierRead(runDir, session, { dossier: dossierPath, dossierSha256: sha256(text), criterion, read });
}
