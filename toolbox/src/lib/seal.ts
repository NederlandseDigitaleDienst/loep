import { existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { DECISIONS_DIR } from "./decisions.ts";
import { IDLE_SESSION_FILE, LOGIN_SESSION_FILE } from "./login.ts";

/*
 * What the seal of a run covers, and the guard that keeps a write from landing under it. The
 * hashes themselves are made and checked in `commands/verify.ts`; this module only knows which
 * paths a seal covers, so that a process that writes into a run (the session process above all)
 * can ask before it writes.
 */

/** The file index of a sealed run: every file of the run with its hash. Its presence makes a run sealed. */
export const SEAL_INDEX = "evidence-index.json";
/** Where the signature stands, and the report that names who signed. Both are made after the seal and refer to it. */
export const SIGNED_DIR = "signed";
/** Where the rechecks of findings after the evaluation stand (`recheck`), each in a folder of its own. */
export const RECHECKS_DIR = "rechecks";
/** Points at the session process of the run while it runs: no evidence, and gone when the process stops. */
export const DAEMON_POINTER = "session-daemon.json";

/**
 * What the seal never covers, besides itself: the signature that refers to it, and the documents
 * that are made after signing (the signed report, the decisions about each defect, the statement
 * and what the organisation filled in for it), and the rechecks of findings after the evaluation (`rechecks/`), which
 * measure the site as it is later and change nothing of what was evaluated. The decisions have a hash of their own. Everything else in the run is evidence and is sealed. That includes the work folder
 * of each session (`werk/<session>/`): a helper script there shows how an agent called the
 * toolbox, and so how its observations came about. Nothing writes there after the agents are done.
 */
export const OUTSIDE_SEAL = { files: ["verklaring-invoer.json"], dirs: [SIGNED_DIR, DECISIONS_DIR, "verklaring", RECHECKS_DIR] };
export const outsideSeal = (name: string): boolean => OUTSIDE_SEAL.files.includes(name) || OUTSIDE_SEAL.dirs.some((dir) => name.startsWith(`${dir}/`));

/** Files of a run that are never hashed: the index itself, the sessions of a login (a secret, no evidence) and half-written files. */
export const notHashed = (name: string): boolean => name === SEAL_INDEX || name === LOGIN_SESSION_FILE || name === IDLE_SESSION_FILE || name.endsWith(".tmp");

/** The sealed run a path lies in: the nearest folder at or above it with a seal. Null when no folder above it is sealed. */
export function sealedRunOf(path: string): string | null {
  let dir = resolve(path);
  for (;;) {
    if (existsSync(join(dir, SEAL_INDEX))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Whether a write to this path changes what a seal covers. A recheck has its own folder under
 * `rechecks/` of a sealed run, and writes there freely: that folder is outside the seal.
 */
export function underSeal(path: string): { run: string; name: string } | null {
  const run = sealedRunOf(path);
  if (run === null) return null;
  const name = relative(run, resolve(path)).split(sep).join("/");
  if (name === "" || notHashed(name) || outsideSeal(name) || OUTSIDE_SEAL.dirs.includes(name)) return null;
  return { run, name };
}

/**
 * Why a write under the seal is refused, and the two ways on: a recheck measures in a folder of
 * its own, and measuring in the run itself again starts with opening the seal on purpose.
 */
export const sealedRunNl = (run: string, name: string): string =>
  `geweigerd: deze run is verzegeld, en ${name} valt onder het zegel. Wat hier schrijft, maakt het zegel ongeldig (verify meldt een afwijking). Een nameting heeft de run niet nodig: recheck maakt een eigen map (rechecks/<id>/<moment>/) met een eigen sessieproces, buiten het zegel, en de agent start zijn sessie daar, met --run <die map>. Wil je in de run zelf opnieuw meten, zoals een nieuwe afmaakronde met tasks --again, open het zegel dan eerst met: seal --run ${run} --open. Dan vervalt het zegel, en een handtekening ook. Verzegel daarna opnieuw met seal, en laat opnieuw lezen en tekenen`;

/** Throw when a write to this path would land under the seal of a sealed run. */
export function refuseUnderSeal(path: string): void {
  const sealed = underSeal(path);
  if (sealed) throw new Error(sealedRunNl(sealed.run, sealed.name));
}
