import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Browser, Page } from "playwright";
import { INPAGE_PATH, launchBrowser, loadPage, newContext } from "../src/browser/session.ts";
import { timeLimitsAfterSubmit } from "../src/instruments/timelimits.ts";
import { formErrors } from "../src/lib/extractors.ts";
import { sweepCandidates } from "../src/lib/statusmessages.ts";
import type { AfterSubmit } from "../src/lib/timelimits.ts";
import type { PageData, RunData } from "../src/lib/rundata.ts";
import { startServer, type FixtureServer } from "./fixtures/session-site/server.ts";

/** The messages that appear when the sweep sends a filled-in form (4.1.3), on a page of the test site. */

let site: FixtureServer;
let browser: Browser;

before(async () => {
  site = await startServer();
  browser = await launchBrowser();
});

after(async () => {
  await browser.close();
  await site.close();
});

async function send(form: "verborgen" | "leeg"): Promise<AfterSubmit> {
  const context = await newContext(browser);
  await context.addInitScript({ path: INPAGE_PATH });
  const page: Page = await context.newPage();
  try {
    await loadPage(page, `${site.origin}/status-submit.html`);
    await page.fill(`#${form}-bericht`, "Een bericht");
    return await timeLimitsAfterSubmit(page, [[`#${form}-bericht`]], () => false);
  } finally {
    await context.close();
  }
}

const runWith = (states: Record<string, AfterSubmit>): RunData => {
  const url = `${site.origin}/status-submit.html`;
  return {
    pages: [{ label: "P01", item: { url } } as unknown as PageData],
    states: { examined: { forms: 0 }, formErrors: [] },
    siteStates: { states: Object.keys(states).map((id) => ({ id, kind: "process", reached: true, url, files: { timeLimitsAfterSubmit: `site-states/${id}/timelimits-after-submit.json` } })) },
    stateEvidence: Object.fromEntries(Object.entries(states).map(([id, entry]) => [id, { timeLimitsAfterSubmit: entry }])),
  } as unknown as RunData;
};

test("4.1.3: a thank-you in a status region that was hidden until sending is recorded as such, and is a candidate", async () => {
  const sent = await send("verborgen");
  assert.equal(sent.submitted, true, sent.notSubmittedNl ?? "");
  const messages = sent.messages!.messages;
  assert.equal(messages.length, 1, JSON.stringify(messages));
  const message = messages[0]!;
  assert.equal(message.text, "Bedankt, uw bericht is verstuurd.");
  assert.equal(message.role, "status");
  assert.equal(message.before, "verborgen");
  assert.equal(message.hiddenBefore, "hidden op het gebied");
  assert.equal(message.textBefore, "Bedankt, uw bericht is verstuurd.", "the text was in the code all along");
  assert.equal(message.focusInside, false);
  assert.match(sent.messages!.focusAfter ?? "", /^button "Bericht versturen"/);

  const candidates = sweepCandidates(runWith({ "process-verborgen": sent }));
  assert.equal(candidates.length, 1);
  const candidate = candidates[0]!;
  assert.equal(candidate.id, "S-K01");
  assert.equal(candidate.criterion, "4.1.3");
  assert.equal(candidate.page, "P01");
  assert.match(candidate.where, /process-verborgen/);
  assert.match(candidate.noteNl, /verborgen \(hidden op het gebied\).*loep voiceover/);
  assert.ok(candidate.noteNl.split(/\s+/).length <= 40, candidate.noteNl);
  assert.deepEqual(candidate.evidence, ["site-states/process-verborgen/timelimits-after-submit.json"]);
});

test("4.1.3: a thank-you in a status region that stood empty in the page is recorded, and is no candidate", async () => {
  const sent = await send("leeg");
  const messages = sent.messages!.messages;
  assert.deepEqual(
    messages.map((message) => [message.text, message.role, message.before, message.hiddenBefore]),
    [["Bedankt, uw reactie is verstuurd.", "status", "leeg", null]],
  );
  assert.deepEqual(sweepCandidates(runWith({ "process-leeg": sent })), []);
});

test("4.1.3: the dossier lists what appeared on sending per state, with the reason where it is a candidate", async () => {
  const run = runWith({ "process-verborgen": await send("verborgen"), "process-leeg": await send("leeg") });
  const dossier = formErrors(run, "4.1.3") as { afterFilledSubmit: { examined: boolean; states: { state: string; page: string; messages: { before: string; candidateNl?: string }[]; focusAfter: string }[] } };
  const rows = dossier.afterFilledSubmit;
  assert.equal(rows.examined, true);
  assert.deepEqual(
    rows.states.map((row) => [row.state, row.page, row.messages.map((message) => message.before)]),
    [
      ["process-verborgen", "P01", ["verborgen"]],
      ["process-leeg", "P01", ["leeg"]],
    ],
  );
  assert.match(rows.states[0]!.messages[0]!.candidateNl ?? "", /voor het versturen verborgen/);
  assert.equal(rows.states[1]!.messages[0]!.candidateNl, undefined);
});
