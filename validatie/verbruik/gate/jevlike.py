"""A Jev-shaped gate on open weights, on MLX.

Jev takes a `state` and a set of independent typed questions (noul, choice, score) and returns one
probability distribution per question. Here: the state (criterion + candidates + evidence) is encoded once
into a KV cache; each question is appended to a copy of that cache and answered by one forward step,
reading a distribution over that question's options from the logits of their label tokens. No text is
generated, every answer is a typed distribution, and all questions share the cost of the state.

usage: python jevlike.py <hf-repo> <max-evidence-tokens> <out.jsonl> [limit]
env GATE_ROWS: the rows file (default gate.jsonl). Resumes from out.jsonl.
"""

import copy
import json
import math
import os
import sys
import time

import mlx.core as mx
from mlx_lm import load
from mlx_lm.models.cache import make_prompt_cache

repo, max_tokens, out_path = sys.argv[1], int(sys.argv[2]), sys.argv[3]
limit = int(sys.argv[4]) if len(sys.argv) > 4 else None

STATE = (
    "Toegankelijkheidsonderzoek, WCAG 2.2 niveau A en AA. Hieronder staat de toestand voor één succescriterium: "
    "wat scripts op de website maten, en wat een rondgang als kandidaat noteerde.\n\n"
    "Succescriterium {criterion}: {title}\n\n"
    "Kandidaten uit de rondgang:\n{candidates}\n\n"
    "Metingen (JSON, ingekort):\n{evidence}\n"
)
# Typed questions, as Jev primitives. Each option is answered by one label token.
QUESTIONS = {
    "risk": {"type": "noul", "instructions": "Kan de site op dit criterium tekortschieten, of is het op grond van dit bewijs niet zeker dat ze voldoet?",
             "criteria": {"A": "ja", "B": "nee"}},
    "outcome": {"type": "choice", "instructions": "Wat wordt de uitkomst voor dit criterium na grondig onderzoek?",
                "criteria": {"A": "voldoet", "B": "voldoet niet", "C": "niet van toepassing", "D": "niet te bepalen"}},
    "severity": {"type": "score", "instructions": "Hoe ernstig is het ergste mogelijke gebrek op dit criterium voor iemand met een beperking?",
                 "criteria": {"A": "geen gebrek", "B": "klein", "C": "merkbaar", "D": "blokkerend"}},
}

model, tok = load(repo)


def chat(content):
    msgs = [{"role": "user", "content": content}]
    try:
        return tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True, enable_thinking=False)
    except TypeError:
        return tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)


# The chat template wraps the user turn; split it so the state is a shared prefix and each question
# a suffix: [template start + state] [question + template end].
MARK = "⁣QUESTION⁣"
template = chat(MARK)
head, tail = template.split(MARK)


def question_text(q):
    opts = "\n".join(f"{k}. {v}" for k, v in q["criteria"].items())
    return f"\nVraag: {q['instructions']}\n{opts}\nAntwoord met alleen de letter.{tail}"


def label_ids(q):
    out = {}
    for k in q["criteria"]:
        ids = {tok.encode(v, add_special_tokens=False)[0] for v in (k, " " + k)}
        out[k] = sorted(ids)
    return out


LABELS = {name: label_ids(q) for name, q in QUESTIONS.items()}


def encode_state(r):
    ev_ids = tok.encode(r["evidence"], add_special_tokens=False)[:max_tokens]
    text = head + STATE.format(criterion=r["criterion"], title=r["title"], candidates=r["candidateText"][:4000], evidence=tok.decode(ev_ids))
    return tok.encode(text, add_special_tokens=False), len(ev_ids)


def prefill(ids, chunk=2048):
    cache = make_prompt_cache(model)
    x = mx.array(ids)
    for i in range(0, len(ids), chunk):
        model(x[i:i + chunk][None], cache=cache)
        mx.eval([c.state for c in cache])
    return cache


def answer(cache, name):
    q = QUESTIONS[name]
    ids = tok.encode(question_text(q), add_special_tokens=False)
    c = copy.deepcopy(cache)
    logits = model(mx.array(ids)[None], cache=c)[0, -1].astype(mx.float32)
    lp = logits - mx.logsumexp(logits)
    raw = {k: mx.logsumexp(lp[mx.array(v)]).item() for k, v in LABELS[name].items()}
    mass = sum(math.exp(v) for v in raw.values())
    m = max(raw.values())
    z = sum(math.exp(v - m) for v in raw.values())
    dist = {q["criteria"][k]: math.exp(v - m) / z for k, v in raw.items()}
    return dist, mass


rows = [json.loads(l) for l in open(os.environ.get("GATE_ROWS", "gate.jsonl"))]
done = set()
if os.path.exists(out_path):
    done = {(j["run"], j["criterion"]) for j in map(json.loads, open(out_path))}
todo = [r for r in rows if (r["run"], r["criterion"]) not in done][:limit]
with open(out_path, "a") as f:
    for k, r in enumerate(todo):
        t0 = time.time()
        ids, ev_len = encode_state(r)
        cache = prefill(ids)
        t_state = time.time() - t0
        res = {name: answer(cache, name) for name in QUESTIONS}
        dt = time.time() - t0
        risk = res["risk"][0]["ja"]
        oc = res["outcome"][0]
        row = {"run": r["run"], "criterion": r["criterion"], "p": risk,
               "pOutcomeNotPass": oc["voldoet niet"] + oc["niet te bepalen"],
               "answers": {n: d for n, (d, _) in res.items()}, "mass": {n: m for n, (_, m) in res.items()},
               "tokens": len(ids), "evidenceTokens": ev_len, "secondsState": t_state, "seconds": dt}
        f.write(json.dumps(row, ensure_ascii=False) + "\n"); f.flush()
        print(f"{k+1}/{len(todo)} {r['criterion']} label={r['label']} risk={risk:.2f} outcome={max(oc, key=oc.get)} tokens={len(ids)} state {t_state:.1f}s total {dt:.1f}s", flush=True)
print("peak memory GB", mx.get_peak_memory() / 1e9)
