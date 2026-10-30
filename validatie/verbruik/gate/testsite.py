"""Gate rows on the testsite, labelled by the answer key instead of by the agents:
lindewaard (79 built-in defects under 51 criteria) and berkenveen (the clean twin, none)."""
import json, sys
from pathlib import Path
src = Path(__file__).with_name("dataset.py").read_text()
ns = {}
exec(src.split("rows = []")[0].replace("RUNS_DIR = Path(sys.argv[1])", "").replace("FASE1 = json.loads(Path(sys.argv[2]).read_text())", "").replace("OUT = Path(sys.argv[3])", ""), ns)
compact = ns["compact"]
RUNS = Path(sys.argv[1])
keys = {"lindewaard": json.load(open(RUNS.parent / "fixtures/reference-lindewaard.json")), "berkenveen": json.load(open(RUNS.parent / "fixtures/reference-berkenveen.json"))}
sets = [("meting-0.11.0/n1", "lindewaard"), ("kandidaat-0.12.0/b1", "berkenveen")]
rows = []
for run, site in sets:
    failed = set(keys[site]["failed"])
    ev = json.loads((RUNS / run / "evaluation.json").read_text())
    titles = {c["id"]: c.get("titleNl", "") for c in ev["criteria"]}
    for task in sorted((RUNS / run / "tasks").iterdir()):
        if not (task / "dossier.json").exists():
            continue
        crit = task.name
        d = json.loads((task / "dossier.json").read_text())
        try:
            cand = json.loads((task / "kandidaten.json").read_text()); cand = cand if isinstance(cand, list) else cand.get("candidates", [])
        except FileNotFoundError:
            cand = []
        rows.append({"run": run, "site": site, "criterion": crit, "title": titles.get(crit, ""), "label": int(crit in failed), "failed": int(crit in failed),
                     "cost": 0, "candidateText": json.dumps([{k: x.get(k) for k in ("noteNl", "where", "page")} for x in cand], ensure_ascii=False),
                     "evidence": json.dumps(compact(d.get("evidence", {})), ensure_ascii=False, separators=(",", ":"))})
Path(sys.argv[2]).write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n")
print(len(rows), "rows,", sum(r["label"] for r in rows), "with a defect in the key")
