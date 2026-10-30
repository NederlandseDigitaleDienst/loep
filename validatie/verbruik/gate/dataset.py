"""Build the gate dataset: one row per (run, criterion), with the label from the final verdict,
the cost of judging it from phase 1, cheap features, and a compacted text of the dossier evidence."""

import json
import re
import sys
from pathlib import Path

RUNS_DIR = Path(sys.argv[1])
FASE1 = json.loads(Path(sys.argv[2]).read_text())
OUT = Path(sys.argv[3])

SITE = lambda run: re.sub(r"-2026-.*$", "", run)
# Keys that describe where something is drawn or stored, not what a visitor meets.
DROP = {"box", "x", "y", "width", "height", "files", "light", "dark", "narrow", "accessibilityTree", "screenshot",
        "hash", "stamp", "selector", "path", "xpath", "bbox", "rect", "evidence", "id"}


def compact(o):
    if isinstance(o, dict):
        return {k: compact(v) for k, v in o.items() if k not in DROP and v not in (None, [], {}, "")}
    if isinstance(o, list):
        return [compact(v) for v in o]
    if isinstance(o, str) and re.search(r"\.(png|jpe?g|yaml|json)$", o):
        return None
    return o


def count_flags(o):
    n = 0
    if isinstance(o, dict):
        f = o.get("flags")
        if isinstance(f, list):
            n += len(f)
        for v in o.values():
            n += count_flags(v)
    elif isinstance(o, list):
        for v in o:
            n += count_flags(v)
    return n


rows = []
for run, R in FASE1["runs"].items():
    ev = json.loads((RUNS_DIR / run / "evaluation.json").read_text())
    titles = {c["id"]: c.get("titleNl", "") for c in ev["criteria"]}
    for c in ev["criteria"]:
        crit = c["id"]
        task = RUNS_DIR / run / "tasks" / crit
        try:
            dossier = json.loads((task / "dossier.json").read_text())
        except FileNotFoundError:
            continue
        evidence = dossier.get("evidence", {})
        engine = (evidence.get("engine") or {}).get("results") or []
        try:
            cand = json.loads((task / "kandidaten.json").read_text())
            cand = cand if isinstance(cand, list) else cand.get("candidates", [])
        except FileNotFoundError:
            cand = []
        p = R["perCriterion"].get(crit, {})
        text = json.dumps(compact(evidence), ensure_ascii=False, separators=(",", ":"))
        rows.append({
            "run": run,
            "site": SITE(run),
            "criterion": crit,
            "title": titles.get(crit, ""),
            "outcome": c["outcome"],
            "label": int(c["outcome"] in ("failed", "cantTell")),
            "failed": int(c["outcome"] == "failed"),
            "cost": p.get("judge", 0) + p.get("verifier", 0) + p.get("finisher", 0),
            "turns": p.get("turns", 0),
            "engineFailed": sum(r.get("outcome") == "failed" for r in engine),
            "engineCantTell": sum(r.get("outcome") == "cantTell" for r in engine),
            "flags": count_flags(evidence),
            "candidates": len(cand),
            "candidateText": json.dumps([{k: x.get(k) for k in ("noteNl", "where", "page")} for x in cand], ensure_ascii=False),
            "evidenceChars": len(text),
            "evidence": text,
        })

OUT.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n")
print(len(rows), "rows;", sum(r["label"] for r in rows), "positive;",
      sum(r["failed"] for r in rows), "failed;", "median chars", sorted(r["evidenceChars"] for r in rows)[len(rows) // 2])
