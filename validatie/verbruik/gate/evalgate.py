"""Shared evaluation of a gate: out-of-fold scores per row, leave-one-site-out.

A row scores high when it may hold a defect. Everything at or above the threshold goes to the agents;
below it is skipped (variant A). Reported per target recall:
  - pooled: the best threshold on all out-of-fold scores (optimistic, what the scores allow);
  - honest: the threshold chosen on the training sites only, then applied to the held-out site.
"""

import json
import math
import random


def load(path="gate.jsonl"):
    return [json.loads(l) for l in open(path)]


def sites(rows):
    return sorted({r["site"] for r in rows})


def savings(rows, scores, thr):
    skipped = [r for r, s in zip(rows, scores) if s < thr]
    P = sum(r["label"] for r in rows)
    missed = sum(r["label"] for r in skipped)
    failed_missed = sum(r["failed"] for r in skipped)
    return {
        "recall": 1 - missed / P if P else 1.0,
        "missed": missed,
        "failedMissed": failed_missed,
        "skipped": len(skipped),
        "saving": sum(r["cost"] for r in skipped),
    }


def threshold_for(rows, scores, target):
    """Highest threshold whose recall on these rows is at least target."""
    pos = sorted(s for r, s in zip(rows, scores) if r["label"])
    if not pos:
        return -math.inf
    k = math.floor((1 - target) * len(pos) + 1e-9)  # may miss k positives
    return pos[k]


def report(name, rows, oof, train_scores_by_site=None, targets=(0.9, 0.95, 0.98, 1.0)):
    total = sum(r["cost"] for r in rows)
    out = {"name": name, "pooled": {}, "honest": {}}
    for t in targets:
        thr = threshold_for(rows, oof, t)
        s = savings(rows, oof, thr)
        out["pooled"][t] = s
        if train_scores_by_site:
            agg = {"missed": 0, "failedMissed": 0, "skipped": 0, "saving": 0.0}
            for site, (tr_rows, tr_scores) in train_scores_by_site.items():
                thr_s = threshold_for(tr_rows, tr_scores, t)
                idx = [i for i, r in enumerate(rows) if r["site"] == site]
                ss = savings([rows[i] for i in idx], [oof[i] for i in idx], thr_s)
                for k in agg:
                    agg[k] += ss[k]
            P = sum(r["label"] for r in rows)
            agg["recall"] = 1 - agg["missed"] / P
            out["honest"][t] = agg
    print(f"\n== {name}  (total ${total:.0f}, {len(rows)} rows, {sum(r['label'] for r in rows)} positive)")
    for t in targets:
        p = out["pooled"][t]
        line = f"  target {t:.2f} | pooled: recall {p['recall']:.3f} skipped {p['skipped']:3d} saving ${p['saving']:.0f} ({100*p['saving']/total:.0f}%)"
        if out["honest"]:
            h = out["honest"][t]
            line += f" | honest: recall {h['recall']:.3f} missed {h['missed']} (failed {h['failedMissed']}) saving ${h['saving']:.0f} ({100*h['saving']/total:.0f}%)"
        print(line)
    return out


def bootstrap_recall(rows, scores, thr, n=2000, seed=1):
    rng = random.Random(seed)
    pos = [s >= thr for r, s in zip(rows, scores) if r["label"]]
    vals = sorted(sum(rng.choice(pos) for _ in pos) / len(pos) for _ in range(n))
    return vals[int(0.025 * n)], vals[int(0.975 * n)]
