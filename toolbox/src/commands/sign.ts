import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readJson, writeJson } from "../lib/canonical.ts";
import { evaluationHash, type Evaluation, type Signature } from "../lib/evaluation.ts";
import { confirmByTyping, processTerminal, type Terminal } from "../lib/recorded.ts";
import { checkSeal, readSignature, sealHash, SIGNATURE_FILE, SIGNED_DIR } from "./verify.ts";

export interface SignOptions {
  run: string;
  name: string;
  role: string;
  organisation: string;
  /** What the signer checked personally, in their own words; printed in the report. */
  checkedNl: string | null;
  /** Where the signer confirms by typing the start of the seal; a test plays the signer here. An agent never signs. */
  terminal?: Terminal | undefined;
}

/** How many characters of the seal the signer types back. */
export const SEAL_CONFIRM_LENGTH = 8;

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
 * signing changes nothing that was sealed. Only a person signs: at an interactive terminal, the
 * signer sees the seal, name and role and types the start of the seal back.
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
  const seal = (await sealHash(options.run))!;
  const statementNl = options.checkedNl ? `${SIGNING_STATEMENT} Zelf gecontroleerd: ${options.checkedNl}` : SIGNING_STATEMENT;
  const shownNl = [
    `Tekenen voor het onderzoek in ${options.run}`,
    `Rapport: ${join(options.run, "report", "rapport.pdf")}`,
    `Zegel: ${seal}`,
    `Naam: ${options.name}`,
    `Functie: ${options.role}`,
    `Organisatie: ${options.organisation}`,
    `Verklaring: ${statementNl}`,
  ].join("\n");
  const recording = await confirmByTyping("sign", shownNl, seal.slice(0, SEAL_CONFIRM_LENGTH), `de eerste ${SEAL_CONFIRM_LENGTH} tekens van het zegel`, options.terminal ?? processTerminal());
  const signature: Signature = {
    name: options.name,
    role: options.role,
    organisation: options.organisation,
    // The moment of the confirmation.
    signedAt: new Date().toISOString(),
    statementNl,
    evaluationSha256: evaluationHash(evaluation),
    sealSha256: seal,
    ...recording,
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
