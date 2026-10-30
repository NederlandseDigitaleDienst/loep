"""Evaluate a Jev-shaped gate run (jevlike.py output).
usage: python evaljl.py <real.jsonl> [<testsite.jsonl>]

Scores compared: the noul question ("risk"), the choice question (P(voldoet niet) + P(niet te bepalen)),
and the max of both. Thresholds per target recall are chosen pooled (optimistic) and per held-out site
from the other sites (honest). Variant A skips the criterion; variant B sends it down a light route
(no verifier, judge at half price), saving verifier + half the judge.
"""

import json
import math
import sys

from evalgate import bootstrap_recall, load, savings, sites, threshold_for

rows = load()
fase1 = json.load(open("fase1.json"))
for r in rows:
    p = fase1["runs"][r["run"]]["perCriterion"].get(r["criterion"], {})
    r["costA"] = r["cost"]
    r["costB"] = p.get("verifier", 0) + 0.5 * p.get("judge", 0)
TOTAL = sum(r["cost"] for r in rows)

SCORES = {
    "noul": lambda j: j["p"],
    "choice": lambda j: j["pOutcomeNotPass"],
    "max": lambda j: max(j["p"], j["pOutcomeNotPass"]),
}


def ece(labels, probs, bins=10):
    n, e = len(labels), 0.0
    for b in range(bins):
        idx = [i for i, p in enumerate(probs) if b / bins <= p < (b + 1) / bins or (b == bins - 1 and p == 1.0)]
        if idx:
            e += len(idx) / n * abs(sum(labels[i] for i in idx) / len(idx) - sum(probs[i] for i in idx) / len(idx))
    return e


def auc(rs, sc):
    pos = [s for r, s in zip(rs, sc) if r["label"]]
    neg = [s for r, s in zip(rs, sc) if not r["label"]]
    return sum((a > b) + 0.5 * (a == b) for a in pos for b in neg) / (len(pos) * len(neg))


def evaluate(path):
    res = {(j["run"], j["criterion"]): j for j in map(json.loads, open(path))}
    rs = [r for r in rows if (r["run"], r["criterion"]) in res]
    print(f"\n### {path}: {len(rs)} of {len(rows)} rows, {sum(r['label'] for r in rs)} positive, "
          f"{sum(res[(r['run'], r['criterion'])]['seconds'] for r in rs) / 60:.0f} min on this machine")
    out = {}
    for name, f in SCORES.items():
        sc = [f(res[(r["run"], r["criterion"])]) for r in rs]
        labels = [r["label"] for r in rs]
        brier = sum((p - y) ** 2 for p, y in zip(sc, labels)) / len(rs)
        print(f"  [{name}] AUC {auc(rs, sc):.3f}  Brier {brier:.3f}  ECE {ece(labels, sc):.3f}")
        out[name] = {"auc": auc(rs, sc), "brier": brier, "ece": ece(labels, sc), "targets": {}}
        for t in (0.9, 0.95, 0.98, 1.0):
            thr = threshold_for(rs, sc, t)
            for variant in ("A", "B"):
                for r in rs:
                    r["cost"] = r["cost" + variant]
                pooled = savings(rs, sc, thr)
                hon = {"missed": 0, "failedMissed": 0, "skipped": 0, "saving": 0.0}
                for s in sites(rs):
                    tr = [(r, p) for r, p in zip(rs, sc) if r["site"] != s]
                    th = threshold_for([a for a, _ in tr], [b for _, b in tr], t)
                    te = [(r, p) for r, p in zip(rs, sc) if r["site"] == s]
                    ss = savings([a for a, _ in te], [b for _, b in te], th)
                    for k in hon:
                        hon[k] += ss[k]
                P = sum(r["label"] for r in rs)
                hon["recall"] = 1 - hon["missed"] / P
                if variant == "A":
                    lo, hi = bootstrap_recall(rs, sc, thr)
                    print(f"    target {t:.2f} A | pooled: skip {pooled['skipped']:3d} save ${pooled['saving']:.0f} ({100 * pooled['saving'] / TOTAL:.0f}%)"
                          f" | honest: recall {hon['recall']:.3f} missed {hon['missed']} (failed {hon['failedMissed']}) save ${hon['saving']:.0f} ({100 * hon['saving'] / TOTAL:.0f}%)")
                else:
                    print(f"    target {t:.2f} B | pooled: save ${pooled['saving']:.0f} ({100 * pooled['saving'] / TOTAL:.0f}%) | honest: save ${hon['saving']:.0f} ({100 * hon['saving'] / TOTAL:.0f}%)")
                out[name]["targets"][f"{t}{variant}"] = {"pooled": pooled, "honest": hon}
        for r in rs:
            r["cost"] = r["costA"]
    return out


def testsite(path, real_path):
    """On the testsite the label is the answer key. Thresholds come from the real sites (target 0.95)."""
    ts = [json.loads(l) for l in open("testsite.jsonl")]
    res = {(j["run"], j["criterion"]): j for j in map(json.loads, open(path))}
    real = {(j["run"], j["criterion"]): j for j in map(json.loads, open(real_path))}
    rr = [r for r in rows if (r["run"], r["criterion"]) in real]
    print(f"\n### testsite {path} (labels from the answer key; threshold from the real sites)")
    for name, f in SCORES.items():
        for t in (0.95, 0.98):
            thr = threshold_for(rr, [f(real[(r["run"], r["criterion"])]) for r in rr], t)
            for site in ("lindewaard", "berkenveen"):
                xs = [r for r in ts if r["site"] == site and (r["run"], r["criterion"]) in res]
                sent = [r for r in xs if f(res[(r["run"], r["criterion"])]) >= thr]
                pos = [r for r in xs if r["label"]]
                caught = [r for r in sent if r["label"]]
                print(f"  [{name}] target {t:.2f} {site:10}: {len(xs)} criteria, {len(pos)} with a defect; "
                      f"sent {len(sent)}, caught {len(caught)}/{len(pos)}, skipped clean {len(xs) - len(sent) - (len(pos) - len(caught))}")


if __name__ == "__main__":
    out = evaluate(sys.argv[1])
    json.dump(out, open(sys.argv[1].replace(".jsonl", ".eval.json"), "w"), indent=1)
    if len(sys.argv) > 2:
        testsite(sys.argv[2], sys.argv[1])
