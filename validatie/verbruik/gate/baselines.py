"""Classical baselines for the gate, leave-one-site-out."""

import json

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression

from evalgate import load, report, sites

rows = load()
S = sites(rows)
results = {}

# 1. Prior per criterion: how often this criterion failed or stayed open on the other sites.
oof, train = [0.0] * len(rows), {}
for s in S:
    tr = [r for r in rows if r["site"] != s]
    rate = {}
    for r in tr:
        a = rate.setdefault(r["criterion"], [0, 0])
        a[0] += r["label"]; a[1] += 1
    f = lambda r: (rate.get(r["criterion"], [1, 2])[0] + 0.5) / (rate.get(r["criterion"], [1, 2])[1] + 1)
    for i, r in enumerate(rows):
        if r["site"] == s:
            oof[i] = f(r)
    train[s] = (tr, [f(r) for r in tr])
results["prior"] = report("prior per criterion", rows, oof, train)

# 2. Hand features: engine, flags, candidates, size, plus the prior.
def feats(r, prior):
    return [prior, r["engineFailed"], r["engineCantTell"], np.log1p(r["flags"]), np.log1p(r["candidates"]), np.log1p(r["evidenceChars"])]

oof, train = [0.0] * len(rows), {}
for s in S:
    tr = [r for r in rows if r["site"] != s]
    rate = {}
    for r in tr:
        a = rate.setdefault(r["criterion"], [0, 0]); a[0] += r["label"]; a[1] += 1
    pr = lambda r: (rate.get(r["criterion"], [1, 2])[0] + 0.5) / (rate.get(r["criterion"], [1, 2])[1] + 1)
    X = np.array([feats(r, pr(r)) for r in tr]); y = [r["label"] for r in tr]
    m = LogisticRegression(max_iter=2000, class_weight="balanced").fit(X, y)
    for i, r in enumerate(rows):
        if r["site"] == s:
            oof[i] = m.predict_proba([feats(r, pr(r))])[0, 1]
    train[s] = (tr, list(m.predict_proba(X)[:, 1]))
results["features"] = report("hand features + prior (logistic)", rows, oof, train)

# 3. TF-IDF over criterion + title + candidate notes + evidence (first 60k chars), logistic regression.
text = lambda r: f"{r['criterion']} {r['title']} {r['candidateText']} {r['evidence'][:60000]}"
oof, train = [0.0] * len(rows), {}
for s in S:
    tr = [r for r in rows if r["site"] != s]
    vec = TfidfVectorizer(min_df=2, max_features=50000, sublinear_tf=True, ngram_range=(1, 2))
    X = vec.fit_transform([text(r) for r in tr]); y = [r["label"] for r in tr]
    m = LogisticRegression(max_iter=4000, C=4, class_weight="balanced").fit(X, y)
    te = [i for i, r in enumerate(rows) if r["site"] == s]
    p = m.predict_proba(vec.transform([text(rows[i]) for i in te]))[:, 1]
    for i, v in zip(te, p):
        oof[i] = v
    train[s] = (tr, list(m.predict_proba(X)[:, 1]))
results["tfidf"] = report("tf-idf + logistic", rows, oof, train)
json.dump({k: {"pooled": v["pooled"], "honest": v["honest"]} for k, v in results.items()}, open("baselines.json", "w"), indent=1, default=str)
