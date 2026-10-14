import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readJson, writeJson } from "../lib/canonical.ts";
import { evaluationHash, type Evaluation, type Signature } from "../lib/evaluation.ts";
import { checkSeal, readSignature, sealHash, SIGNATURE_FILE, SIGNED_DIR } from "./verify.ts";

export interface SignOptions {
  run: string;
  name: string;
  role: string;
  organisation: string;
  /** What the signer checked personally, in their own words; printed in the report. */
  checkedNl: string | null;
}

/** What a signature means. Printed in the report so nobody reads more into it than it says. */
export const SIGNING_STATEMENT =
  "Ik heb dit rapport gelezen en sta in voor de inhoud. Het onderzoek is automatisch uitgevoerd: scripts hebben het bewijs verzameld en een taalmodel heeft elk criterium beoordeeld. Ik heb de uitkomsten niet zelf opnieuw getoetst, tenzij hieronder anders staat.";

/**
 * The evaluation of a run with the signature that stands next to it. The signature is no part
 * of evaluation.json: that file is sealed, and what is signed is the seal.
 */
export async function readEvaluation(path: string): Promise<Evaluation> {
  return { ...(await readJson<Evaluation>(path)), signature: await readSignature(dirname(path)) };
}

/** Write evaluation.json: everything that was evaluated, without the signature. */
export async function writeEvaluation(path: string, evaluation: Evaluation): Promise<string> {
  const { signature: _signature, ...content } = evaluation;
  return writeJson(path, content);
}

/**
 * Record that a named person stands for this run. What is signed is what was sealed: the
 * signature names the hash of the seal and of the evaluation in it, and is refused when the
 * run has no seal or changed after it. The signature itself stands outside the seal, so
 * signing changes nothing that was sealed.
 */
export async function sign(options: SignOptions): Promise<Signature> {
  const evaluation = await readJson<Evaluation>(join(options.run, "evaluation.json"));
  const untested = evaluation.criteria.filter((criterion) => criterion.outcome === "untested");
  if (untested.length > 0) {
    throw new Error(`${untested.length} criteria have no verdict (${untested.map((criterion) => criterion.id).join(", ")}); an incomplete evaluation cannot be signed`);
  }
  const check = await checkSeal(options.run);
  if (check === null) throw new Error("het onderzoek is niet verzegeld: draai eerst seal, zodat vastligt waarvoor wordt getekend");
  // A signature that is already there says nothing about whether the run still is what was sealed.
  const changed = check.problems.filter((problem) => !problem.startsWith(SIGNATURE_FILE));
  if (changed.length > 0) {
    throw new Error(`er is na het verzegelen iets veranderd (${changed.slice(0, 3).join("; ")}${changed.length > 3 ? `; en nog ${changed.length - 3}` : ""}): maak het rapport opnieuw, verzegel opnieuw en lees het rapport voor je tekent`);
  }
  const signature: Signature = {
    name: options.name,
    role: options.role,
    organisation: options.organisation,
    signedAt: new Date().toISOString(),
    statementNl: options.checkedNl ? `${SIGNING_STATEMENT} Zelf gecontroleerd: ${options.checkedNl}` : SIGNING_STATEMENT,
    evaluationSha256: evaluationHash(evaluation),
    sealSha256: (await sealHash(options.run))!,
  };
  // A report made for an earlier signature goes with that signature.
  await rm(join(options.run, SIGNED_DIR), { recursive: true, force: true });
  await writeJson(join(options.run, SIGNATURE_FILE), signature);
  return signature;
}

/** A signature is valid only for the exact evaluation it was given for. */
export function signatureIsCurrent(evaluation: Evaluation): boolean {
  return Boolean(evaluation.signature) && evaluation.signature!.evaluationSha256 === evaluationHash(evaluation);
}
