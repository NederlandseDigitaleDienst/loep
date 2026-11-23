import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { addSite, readBacklog, slugFor } from "../src/backlog.ts";

const backlogFile = (): string => join(mkdtempSync(join(tmpdir(), "lus-backlog-")), "backlog.yaml");

test("de slug is de host zonder www, zodat de runs van een site bij elkaar staan", () => {
  assert.equal(slugFor("https://www.voorbeeld.nl/"), "voorbeeld.nl");
  assert.equal(slugFor("https://sub.example.org/pad?x=1"), "sub.example.org");
  assert.throws(() => slugFor("geen url"), /geen geldige url/);
});

test("add schrijft een blok dat read terugleest, met de lege velden erbij", () => {
  const path = backlogFile();
  const site = addSite(path, { url: "https://www.voorbeeld.nl/", name: "Voorbeeld", organisation: "Ministerie van Voorbeeld" });
  assert.equal(site.atOnce, 2, "zonder opgave twee agents tegelijk");
  assert.equal(site.slug, "voorbeeld.nl");
  const file = readFileSync(path, "utf8");
  assert.match(file, /# Sites die onder de loep gaan/);
  assert.match(file, /- url: https:\/\/www\.voorbeeld\.nl\//);
  assert.match(file, /  sending:\n    allow: false\n    max: 20/);
  const backlog = readBacklog(path);
  assert.equal(backlog.problems.length, 0);
  assert.deepEqual(backlog.sites, [site]);
  assert.equal(backlog.sites[0]?.purpose, "verbeteren");
});

test("een tweede site met dezelfde slug wordt geweigerd: hun runs zouden één map delen", () => {
  const path = backlogFile();
  addSite(path, { url: "https://www.voorbeeld.nl/", organisation: "A" });
  assert.throws(() => addSite(path, { url: "https://voorbeeld.nl/andere/", organisation: "B" }), /er staat al een site met de slug voorbeeld\.nl/);
  addSite(path, { url: "https://voorbeeld.nl/andere/", organisation: "B", slug: "voorbeeld-andere" });
  assert.equal(readBacklog(path).sites.length, 2);
});

test("commentaar en volgorde in een met de hand bewerkt bestand blijven staan", () => {
  const path = backlogFile();
  addSite(path, { url: "https://een.example/", organisation: "Een" });
  writeFileSync(path, `${readFileSync(path, "utf8")}# nog eentje hieronder\n`);
  addSite(path, { url: "https://twee.example/", organisation: "Twee" });
  const file = readFileSync(path, "utf8");
  assert.match(file, /# nog eentje hieronder/);
  assert.ok(file.indexOf("een.example") < file.indexOf("twee.example"));
});

test("een verkeerd doel en een ontbrekende eigenaar zijn een waarschuwing, geen fout", () => {
  const path = backlogFile();
  writeFileSync(path, "- url: https://www.example.org/\n  purpose: verbeterne\n");
  const backlog = readBacklog(path);
  assert.equal(backlog.sites.length, 1);
  assert.equal(backlog.sites[0]?.purpose, "verbeteren");
  const texts = backlog.problems.map((problem) => problem.textNl).join("\n");
  assert.match(texts, /purpose is "verbeterne"/);
  assert.match(texts, /organisation ontbreekt/);
});

test("een bestand dat geen lijst is zegt hoe het wel moet", () => {
  const path = backlogFile();
  writeFileSync(path, "url: https://www.example.org/\n");
  assert.throws(() => readBacklog(path), /geen lijst van sites/);
});

test("inlog, eigen origins, agents tegelijk en de mailbox komen mee de backlog in", () => {
  const path = backlogFile();
  addSite(path, {
    url: "https://www.example.org/",
    organisation: "Example",
    login: { page: "https://www.example.org/inloggen", role: "testgebruiker" },
    atOnce: 5,
    mailbox: "imap://mail.example.org:993",
    alsoOrigins: ["https://docs.example.org/"],
    neverOpen: ["www.example.org"],
    vendorTags: ["vendor-"],
  });
  const site = readBacklog(path).sites[0];
  assert.deepEqual(site?.login, { page: "https://www.example.org/inloggen", role: "testgebruiker" });
  assert.equal(site?.atOnce, 5);
  assert.equal(site?.mailbox, "imap://mail.example.org:993");
  assert.deepEqual(site?.alsoOrigins, ["https://docs.example.org/"]);
  assert.deepEqual(site?.neverOpen, ["www.example.org"]);
  assert.deepEqual(site?.vendorTags, ["vendor-"]);
});

test("een inlog zonder rol is een waarschuwing: de rol komt in het rapport, een naam niet", () => {
  const path = backlogFile();
  writeFileSync(path, "- url: https://www.example.org/\n  organisation: Example\n  login:\n    page: https://www.example.org/inloggen\n");
  const backlog = readBacklog(path);
  assert.deepEqual(backlog.sites[0]?.login, { page: "https://www.example.org/inloggen", role: "" });
  assert.match(backlog.problems.map((problem) => problem.textNl).join("\n"), /login\.role ontbreekt/);
});
