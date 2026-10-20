import { existsSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { readJson, sha256, sha256File, writeJson } from "../lib/canonical.ts";
import { checkDecisions, DECISIONS_DIR } from "../lib/decisions.ts";
import { evaluationHash, type Evaluation, type Signature } from "../lib/evaluation.ts";
import { IDLE_SESSION_FILE, LOGIN_SESSION_FILE } from "../lib/login.ts";
import { recordedNl } from "../lib/recorded.ts";

export interface EvidenceIndex {
  files: Record<string, string>;
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)])),
  );
  return files.flat();
}

const INDEX = "evidence-index.json";
/** Where the signature stands, and the report that names who signed. Both are made after the seal and refer to it. */
export const SIGNED_DIR = "signed";
export const SIGNATURE_FILE = `${SIGNED_DIR}/signature.json`;

/**
 * What the seal never covers, besides itself: the signature that refers to it, and the documents
 * that are made after signing (the signed report, the decisions about each defect, the statement
 * and what the organisation filled in for it). The decisions have a hash of their own. Everything else in the run is evidence and is sealed. That includes the work folder
 * of each session (`werk/<session>/`): a helper script there shows how an agent called the
 * toolbox, and so how its observations came about. Nothing writes there after the agents are done.
 */
const OUTSIDE_SEAL = { files: ["verklaring-invoer.json"], dirs: [SIGNED_DIR, DECISIONS_DIR, "verklaring"] };
const outsideSeal = (name: string): boolean => OUTSIDE_SEAL.files.includes(name) || OUTSIDE_SEAL.dirs.some((dir) => name.startsWith(`${dir}/`));

export async function hashRun(runDir: string): Promise<EvidenceIndex & { outside: string[] }> {
  const files: Record<string, string> = {};
  const outside: string[] = [];
  for (const path of (await walk(runDir)).sort()) {
    const name = relative(runDir, path).split(sep).join("/");
    // The session of a login is a secret and no evidence: it is in no seal and in no list.
    if (name === INDEX || name === LOGIN_SESSION_FILE || name === IDLE_SESSION_FILE || name.endsWith(".tmp")) continue;
    if (outsideSeal(name)) outside.push(name);
    else files[name] = sha256(await readFile(path));
  }
  return { files, outside };
}

/** The hash of the seal as it stands in the run: what a signature refers to. Null when the run is not sealed. */
export async function sealHash(runDir: string): Promise<string | null> {
  return existsSync(join(runDir, INDEX)) ? sha256File(join(runDir, INDEX)) : null;
}

/** The signature of a run, or null when nobody signed. */
export async function readSignature(runDir: string): Promise<Signature | null> {
  const path = join(runDir, SIGNATURE_FILE);
  return existsSync(path) ? readJson<Signature>(path) : null;
}

export interface Sealed {
  sha256: string;
  files: number;
  /** A signature for the seal that this one replaced: it no longer says anything and was removed. */
  signatureVoided: boolean;
}

/**
 * Seal the run: record the hash of every file that was produced. A signature belongs to one
 * seal. When the new seal differs from the one that was signed, the signature and the report
 * made with it are removed: somebody has to read and sign again.
 */
export async function seal(runDir: string): Promise<Sealed> {
  const { files } = await hashRun(runDir);
  const hash = await writeJson(join(runDir, INDEX), { files });
  const signature = await readSignature(runDir).catch(() => null);
  const signatureVoided = existsSync(join(runDir, SIGNED_DIR)) && signature?.sealSha256 !== hash;
  if (signatureVoided) await rm(join(runDir, SIGNED_DIR), { recursive: true, force: true });
  return { sha256: hash, files: Object.keys(files).length, signatureVoided };
}

export interface SealCheck {
  /** Files the seal names. */
  files: number;
  /** Files made after the seal that it does not cover. */
  outside: string[];
  /** Everything that was changed, added or removed since the run was sealed, and a signature that does not belong to this seal. */
  problems: string[];
  signature: Signature | null;
}

/** Recompute every hash of a sealed run. Null when the run has no seal. */
export async function checkSeal(runDir: string): Promise<SealCheck | null> {
  if (!existsSync(join(runDir, INDEX))) return null;
  const sealed = await readJson<EvidenceIndex>(join(runDir, INDEX));
  const current = await hashRun(runDir);
  const problems: string[] = [];
  for (const [name, hash] of Object.entries(sealed.files)) {
    if (!(name in current.files)) problems.push(`ontbreekt: ${name}`);
    else if (current.files[name] !== hash) problems.push(`gewijzigd: ${name}`);
  }
  for (const name of Object.keys(current.files)) {
    if (!(name in sealed.files)) problems.push(`niet in het zegel: ${name}`);
  }
  let signature: Signature | null = null;
  try {
    signature = await readSignature(runDir);
  } catch {
    problems.push(`onleesbaar: ${SIGNATURE_FILE}`);
  }
  if (signature) {
    // The signature names the seal it was given for, and the evaluation in it.
    if (signature.sealSha256 !== (await sealHash(runDir))) problems.push(`${SIGNATURE_FILE}: de handtekening hoort bij een ander zegel`);
    // An evaluation that is gone or can no longer be read is not the one that was signed either.
    const signedEvaluation = await readJson<Evaluation>(join(runDir, "evaluation.json")).then(evaluationHash, () => null);
    if (signature.evaluationSha256 !== signedEvaluation) problems.push(`${SIGNATURE_FILE}: de handtekening hoort bij een andere evaluatie`);
  }
  return { files: Object.keys(sealed.files).length, outside: current.outside, problems, signature };
}

/** How many answers of a person the run keeps, and how each came about. */
async function answersRecorded(runDir: string): Promise<{ answers: number; viaConversation: number; viaTerminal: number }> {
  const dir = join(runDir, "antwoorden");
  const counts = { answers: 0, viaConversation: 0, viaTerminal: 0 };
  if (!existsSync(dir)) return counts;
  for (const name of (await readdir(dir)).filter((entry) => entry.endsWith(".json"))) {
    const stored = (await readJson<{ answers?: { recordedVia?: string }[] }>(join(dir, name)).catch(() => ({ answers: [] }))).answers ?? [];
    counts.answers += stored.length;
    counts.viaConversation += stored.filter((answer) => answer.recordedVia === "gesprek").length;
    counts.viaTerminal += stored.filter((answer) => answer.recordedVia === "terminal").length;
  }
  return counts;
}

/** "3 in een terminal bevestigd, 1 in een gesprek vastgelegd, 1 zonder vastgelegde wijze". */
const waysNl = (total: number, terminal: number, conversation: number): string =>
  [`${terminal} in een terminal bevestigd`, `${conversation} in een gesprek vastgelegd`, ...(total - terminal - conversation > 0 ? [`${total - terminal - conversation} zonder vastgelegde wijze`] : [])].join(", ");

/**
 * Recompute every hash and report anything that was changed, added or removed since the run was
 * sealed. The decisions after signing are checked as their own layer: against their index, and
 * against the defects of the evaluation.
 */
export async function verify(runDir: string): Promise<boolean> {
  const check = await checkSeal(runDir);
  if (check === null) {
    process.stderr.write("deze run is niet verzegeld; verzegel met seal\n");
    return false;
  }
  const evaluation = await readJson<Evaluation>(join(runDir, "evaluation.json")).catch(() => null);
  const decisions = await checkDecisions(runDir, evaluation?.defects);
  const problems = [...check.problems, ...(decisions?.problems ?? [])];
  for (const problem of problems) process.stderr.write(`${problem}\n`);
  process.stdout.write(`${check.files} bestanden nagerekend, ${problems.length === 1 ? "1 afwijking" : `${problems.length} afwijkingen`}\n`);
  const via = check.signature ? recordedNl(check.signature, check.signature.signedAt) : null;
  process.stdout.write(check.signature ? `afgetekend op ${check.signature.signedAt.slice(0, 10)} voor zegel ${check.signature.sealSha256.slice(0, 12)}${via ? `, ${via}` : ""}\n` : "niet afgetekend\n");
  const answers = await answersRecorded(runDir);
  if (answers.answers > 0) process.stdout.write(`antwoorden van een persoon: ${answers.answers} (${waysNl(answers.answers, answers.viaTerminal, answers.viaConversation)})\n`);
  if (decisions) process.stdout.write(`besluiten over gebreken: ${decisions.decisions} (${waysNl(decisions.decisions, decisions.viaTerminal, decisions.viaConversation)}); buiten het zegel, als eigen laag ${decisions.sha256 ? decisions.sha256.slice(0, 12) : "zonder index"}\n`);
  if (check.outside.length > 0) process.stdout.write(`buiten het zegel, gemaakt na het verzegelen (handtekening, afgetekend rapport, besluiten, verklaring): ${check.outside.length}\n`);
  return problems.length === 0;
}
