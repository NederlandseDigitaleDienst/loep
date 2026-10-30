"""Row-level gate, used the way Jev-style models are meant to be used.

- The state is small and dense: one row of the dossier (an image with its alt and context, a link with its
  text and the heading above it, a page title next to its h1), a few hundred tokens.
- The question is concrete and per criterion, a noul ("is there possibly a defect here?").
- One prefill pass; only the last token's hidden state goes through the rows of the output head for the
  answer tokens (as JEV-9B initialises its decision head), never a softmax over the vocabulary.
- Rows are batched (right padding, gather at each row's last token).
- Per criterion the gate's score is the max over its rows: one bad row is enough to send it to the agents.

usage: python rowgate.py <mlx-model-dir> <format: reranker|chat> <out.jsonl>   (env GATE_ROWS)
"""

import json
import math
import os
import sys
import time

import mlx.core as mx
from mlx_lm import load

path, fmt, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
model, tok = load(path)

# Criterion -> (dossier section, question). The question asks for a defect, so P(yes) is the risk.
CHECKS = {
    "1.1.1": [("images.rows", "Kan deze afbeelding tekortschieten op WCAG 1.1.1? Een afbeelding met informatie moet een tekstalternatief hebben dat die informatie geeft; versiering moet verborgen zijn voor hulpsoftware.")],
    "2.4.2": [("titles.rows", "Kan deze paginatitel tekortschieten op WCAG 2.4.2? De titel moet het onderwerp of doel van de pagina beschrijven.")],
    "2.4.4": [("links.flagged", "Kan deze link tekortschieten op WCAG 2.4.4? Het doel van de link moet duidelijk zijn uit de linktekst, samen met de zin, de alinea, de lijst of de kop eromheen.")],
    "2.4.6": [("headings.pages", "Kunnen deze koppen tekortschieten op WCAG 2.4.6? Koppen moeten het onderwerp van de inhoud eronder beschrijven."),
              ("forms.fields", "Kan dit label tekortschieten op WCAG 2.4.6? Een label moet het doel van het veld beschrijven.")],
    "2.5.3": [("labelInName.notContained", "Kan dit element tekortschieten op WCAG 2.5.3? De toegankelijke naam moet de zichtbare tekst bevatten, bij voorkeur aan het begin.")],
    "3.1.2": [("language.textExcerpts", "Kan deze tekst tekortschieten op WCAG 3.1.2? De pagina is Nederlands; een passage in een andere taal moet een eigen taalaanduiding hebben. Namen, technische termen en gangbare leenwoorden tellen niet.")],
    "3.3.2": [("forms.fields", "Kan dit invoerveld tekortschieten op WCAG 3.3.2? Een veld waar iets in moet worden ingevuld of gekozen, moet een zichtbaar label of zichtbare instructie hebben.")],
    "4.1.2": [("controls.rows", "Kan dit bedieningselement tekortschieten op WCAG 4.1.2? Het moet een naam en een rol hebben die passen bij wat het doet, en zijn toestand moet te bepalen zijn.")],
}
DROP = {"box", "where", "fullTextFile", "href", "contextFrom", "sentenceFrom"}
MAX_ROWS = 300


def get(o, dotted):
    for k in dotted.split("."):
        o = o.get(k) if isinstance(o, dict) else None
    return o if isinstance(o, list) else []


def row_text(row):
    return json.dumps({k: v for k, v in row.items() if k not in DROP and v not in (None, [], "")}, ensure_ascii=False)[:2500]


if fmt == "reranker":
    PRE = ("<|im_start|>system\nJudge whether the Document meets the requirements based on the Query and the Instruct provided. "
           "Note that the answer can only be \"yes\" or \"no\".<|im_end|>\n<|im_start|>user\n"
           "<Instruct>: Decide whether this element of a Dutch government website may fail the WCAG success criterion in the Query. "
           "Missing a failure is much worse than a false alarm.\n")
    SUF = "<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n"
    prompt = lambda q, s: f"{PRE}<Query>: {q}\n<Document>: {s}{SUF}"
    YES, NO = [tok.convert_tokens_to_ids("yes")], [tok.convert_tokens_to_ids("no")]
else:
    def prompt(q, s):
        content = f"[state] {s}\n[question] {q}\n[options]\nA) ja\nB) nee\nAntwoord met alleen de letter."
        msgs = [{"role": "user", "content": content}]
        try:
            return tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True, enable_thinking=False)
        except TypeError:
            return tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)
    YES = sorted({tok.encode(v, add_special_tokens=False)[0] for v in ("A", " A")})
    NO = sorted({tok.encode(v, add_special_tokens=False)[0] for v in ("B", " B")})

# Backbone and output head, whatever the wrapper: hidden state of the last token, then only the answer rows.
lm = getattr(model, "language_model", model)
backbone = lm.model
if getattr(lm, "lm_head", None) is not None:
    W = lm.lm_head
    head = lambda h: W(h)
else:
    head = lambda h: backbone.embed_tokens.as_linear(h)


def decide(batch_ids):
    L = max(len(x) for x in batch_ids)
    pad = tok.pad_token_id if tok.pad_token_id is not None else 0
    x = mx.array([ids + [pad] * (L - len(ids)) for ids in batch_ids])
    h = backbone(x)  # [B, L, H]; causal, so right padding does not change earlier positions
    last = mx.array([len(ids) - 1 for ids in batch_ids])
    hl = h[mx.arange(len(batch_ids)), last]  # [B, H]
    logits = head(hl).astype(mx.float32)
    y = mx.logsumexp(logits[:, mx.array(YES)], axis=-1)
    n = mx.logsumexp(logits[:, mx.array(NO)], axis=-1)
    return mx.sigmoid(y - n).tolist()


rows = [json.loads(l) for l in open(os.environ.get("GATE_ROWS", "gate.jsonl"))]
RUNS = os.environ.get("RUNS_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../../toolbox/runs"))
items = []  # (row index, check, text ids)
for i, r in enumerate(rows):
    if r["criterion"] not in CHECKS:
        continue
    d = json.load(open(os.path.join(RUNS, r["run"], "tasks", r["criterion"], "dossier.json"))).get("evidence", {})
    for section, q in CHECKS[r["criterion"]]:
        for x in get(d, section)[:MAX_ROWS]:
            items.append((i, section, tok.encode(prompt(q, row_text(x)), add_special_tokens=False)))
print(f"{len(items)} decisions over {len({i for i, _, _ in items})} criteria", flush=True)

order = sorted(range(len(items)), key=lambda k: len(items[k][2]))
scores = [None] * len(items)
t0 = time.time()
k = 0
while k < len(order):
    batch = [order[k]]
    while k + len(batch) < len(order) and (len(batch) + 1) * len(items[order[k + len(batch)]][2]) <= 6000 and len(batch) < 32:
        batch.append(order[k + len(batch)])
    for j, p in zip(batch, decide([items[j][2] for j in batch])):
        scores[j] = p
    k += len(batch)
elapsed = time.time() - t0
tokens = sum(len(x[2]) for x in items)
print(f"{len(items)} decisions, {tokens} tokens in {elapsed:.0f} s: {1000 * elapsed / len(items):.0f} ms per decision, {tokens / elapsed:.0f} tok/s", flush=True)

per = {}
for (i, section, ids), p in zip(items, scores):
    a = per.setdefault(i, {"max": 0.0, "n": 0, "sections": {}})
    a["max"] = max(a["max"], p); a["n"] += 1
    s = a["sections"].setdefault(section, {"max": 0.0, "n": 0}); s["max"] = max(s["max"], p); s["n"] += 1
with open(out_path, "w") as f:
    for i, a in per.items():
        r = rows[i]
        f.write(json.dumps({"run": r["run"], "criterion": r["criterion"], "p": a["max"], "pOutcomeNotPass": a["max"], "decisions": a["n"],
                            "sections": a["sections"], "seconds": elapsed * a["n"] / len(items)}, ensure_ascii=False) + "\n")
if os.environ.get("ROWS_OUT"):
    with open(os.environ["ROWS_OUT"], "w") as f:
        for (i, section, ids), p in zip(items, scores):
            f.write(json.dumps({"run": rows[i]["run"], "criterion": rows[i]["criterion"], "section": section, "p": p,
                                "state": tok.decode(ids)[-700:]}, ensure_ascii=False) + "\n")
print("peak memory GB", mx.get_peak_memory() / 1e9)
