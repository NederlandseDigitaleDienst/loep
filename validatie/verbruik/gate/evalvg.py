"""Evaluate verifier-gate runs: python evalvg.py vg-*.jsonl"""
import json, re, sys, random
f1 = json.load(open("fase1.json"))
RUNS, RUN = 7, 213
def site(run): return re.sub(r"-2026-.*$", "", run)
for path in sys.argv[1:]:
    rs = [json.loads(l) for l in open(path)]
    for r in rs:
        r["v"] = f1["runs"][r["run"]]["perCriterion"].get(r["criterion"], {}).get("verifier", 0)
        r["mean"] = sum(r["risk"].values()) / len(r["risk"]); r["site"] = site(r["run"])
    d = [r for r in rs if r["danger"]]
    secs = sum(r["seconds"] for r in rs)
    print(f"\n### {path}: {len(rs)} verdicts, {len(d)} dangerous, {secs/len(rs):.1f} s per verdict")
    for key in ("mean", "covered", "interaction", "assumption", "flip"):
        sc = (lambda r: r["mean"]) if key == "mean" else (lambda r, k=key: r["risk"][k])
        order = sorted(rs, key=lambda r: -sc(r)); ranks = sorted(order.index(r) + 1 for r in d)
        top = max(ranks); thr = min(sc(r) for r in d)
        ins = [r for r in rs if sc(r) < thr]
        # chance that all dangerous fall within the top `top` under a random order
        p = 1.0
        for i in range(len(d)): p *= (top - i) / (len(rs) - i)
        hon = {s: min([sc(r) for r in d if r["site"] != s] or [0]) for s in {r["site"] for r in rs}}
        hs = [r for r in rs if sc(r) < hon[r["site"]]]
        print(f"  {key:11} ranks {ranks} | in-sample skip {len(ins)} save ${sum(r['v'] for r in ins)/RUNS:.1f}/run (p chance {p:.3f})"
              f" | per-site skip {len(hs)} missed {sum(r['danger'] for r in hs)} save ${sum(r['v'] for r in hs)/RUNS:.1f}/run")
