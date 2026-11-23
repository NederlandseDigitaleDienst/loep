import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readBacklog } from "../src/backlog.ts";
import { answering, FIXTURES, metingHome, prepareBacklog, silent } from "../src/meting.ts";

test("een meting heeft een eigen home, los van de sites van echte eigenaren", () => {
  const home = mkdtempSync(join(tmpdir(), "lus-meting-"));
  const before = process.env["LUS_HOME"];
  try {
    process.env["LUS_HOME"] = home;
    assert.equal(metingHome(), home);
    delete process.env["LUS_HOME"];
    assert.match(metingHome(), /onderzoeken\/meting$/, "zonder LUS_HOME staan de metingen naast de runs, in een eigen map");
  } finally {
    if (before === undefined) delete process.env["LUS_HOME"];
    else process.env["LUS_HOME"] = before;
  }
});

test("beide testwebsites komen één keer in de backlog van de meting, met hun eigen slug", () => {
  const path = join(mkdtempSync(join(tmpdir(), "lus-meting-")), "backlog.yaml");
  const first = prepareBacklog(path);
  assert.deepEqual(first.added.map((fixture) => fixture.slug), ["lindewaard", "berkenveen"]);
  const backlog = readBacklog(path);
  assert.deepEqual(backlog.problems, []);
  assert.deepEqual(backlog.sites.map((site) => site.slug), ["lindewaard", "berkenveen"]);
  assert.equal(backlog.sites[0]?.name, "Lindewaard");
  assert.equal(backlog.sites[0]?.organisation, "Testsite");
  assert.match(backlog.sites[0]?.note ?? "", /gebreken/);
  assert.match(backlog.sites[1]?.note ?? "", /schone tweeling/);
  // Een tweede keer voegt niets toe: wat er staat blijft zoals het staat.
  assert.deepEqual(prepareBacklog(path).added, []);
  assert.equal(readBacklog(path).sites.length, 2);
});

test("lus weet of de testsite antwoordt, voordat er een agent begint", async () => {
  const server = createServer((request, response) => response.writeHead(200, { "content-type": "text/html" }).end("<h1>Lindewaard</h1>"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    assert.equal(await answering(`http://127.0.0.1:${port}/`), true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  assert.equal(await answering(`http://127.0.0.1:${port}/`, 500), false, "een poort waar niets luistert telt niet als antwoord");
});

test("een meting begint pas als elke testwebsite antwoordt", async () => {
  const server = createServer((request, response) => response.writeHead(200).end("ok"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const fixtures = [{ slug: "een", url: `http://127.0.0.1:${port}/`, name: "Een", noteNl: "" }];
  try {
    assert.deepEqual(await silent(fixtures), []);
    assert.deepEqual((await silent([...fixtures, { ...fixtures[0]!, slug: "twee", url: "http://127.0.0.1:9/" }])).map((fixture) => fixture.slug), ["twee"]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  assert.equal(FIXTURES.length, 2, "de meting kent de twee testwebsites");
});
