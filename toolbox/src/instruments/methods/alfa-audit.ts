import { Worker } from "node:worker_threads";
import type { AuditedOutcome } from "./alfa-worker.ts";

/**
 * Alfa's audit on a thread of its own. Matching a selector can take hours on a page, and all that
 * time it never yields, so no limit in the thread that asked could fire and the whole sweep stood still.
 * A thread can be stopped from outside: then this engine has no answer on this page, and the others do.
 */
export function auditInWorker(page: { toJSON(): unknown }, limitMs: number): Promise<AuditedOutcome[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./alfa-worker.ts", import.meta.url), { workerData: { page: page.toJSON() } });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error(`geen antwoord binnen ${Math.round(limitMs / 1000)} s`));
    }, limitMs);
    const settle = (finish: () => void): void => {
      clearTimeout(timer);
      void worker.terminate();
      finish();
    };
    worker.once("message", (audited: AuditedOutcome[]) => settle(() => resolve(audited)));
    worker.once("error", (error) => settle(() => reject(error)));
  });
}
