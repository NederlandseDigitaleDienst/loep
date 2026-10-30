"""Verifier gate in the shape of Jev: the state is the judge's verdict (oordeel.json, about 1,200 tokens),
encoded once; four atomic typed questions are answered on that cached state, each a distribution over
A) ja / B) nee read from the logits of the letter tokens. Code combines them.

Only verdicts "passed" and "inapplicable" are scored: a verifier after "failed" or "cantTell" stays.
usage: python verifygate.py <mlx-model-dir> <out.jsonl>
"""

import copy
import json
import os
import sys
import time

import mlx.core as mx
from mlx_lm import load
from mlx_lm.models.cache import make_prompt_cache

path, out_path = sys.argv[1], sys.argv[2]
model, tok = load(path)
RUNS = os.environ.get("RUNS_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../../toolbox/runs"))

QUESTIONS = {  # name -> (question, which answer is the risk)
    "covered": ("Heeft de beoordelaar elk onderdeel dat dit criterium vraagt zelf gemeten of in het dossier gecontroleerd, op alle paginatypen en toestanden?", "B"),
    "interaction": ("Hangt dit oordeel af van bediening met het toetsenbord, de focus of andere interactie die maar op een deel van de pagina's of toestanden is gemeten?", "A"),
    "assumption": ("Steunt de conclusie ergens op een aanname of een algemene indruk in plaats van op een vastgelegde waarneming?", "A"),
    "flip": ("Zou een tweede beoordelaar die alles zelf opnieuw meet, waarschijnlijk tot een andere uitkomst komen dan dit oordeel?", "A"),
}


def compact(o):
    keep = {"criterion": o.get("criterion"), "outcome": o.get("outcome"), "summaryNl": o.get("summaryNl"), "missingNl": o.get("missingNl")}
    keep["observations"] = [{k: x.get(k) for k in ("checkedNl", "howNl", "observedNl", "ruling")} for x in o.get("observations", [])]
    keep["candidates"] = [{k: x.get(k) for k in ("id", "resolutionNl", "ruling", "noteNl")} for x in (o.get("candidates") or [])][:20]
    return json.dumps(keep, ensure_ascii=False)


MARK = "⁣Q⁣"
msgs = [{"role": "user", "content": MARK}]
try:
    tpl = tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True, enable_thinking=False)
except TypeError:
    tpl = tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)
head, tail = tpl.split(MARK)
A = sorted({tok.encode(v, add_special_tokens=False)[0] for v in ("A", " A")})
B = sorted({tok.encode(v, add_special_tokens=False)[0] for v in ("B", " B")})

lab = json.load(open("verifier-labels.json"))
todo = [(run, c, jo, fo) for run, c, jo, fo, kind, _ in lab if jo in ("passed", "inapplicable")]
if os.path.exists(out_path):
    done = {(j["run"], j["criterion"]) for j in map(json.loads, open(out_path))}
    todo = [t for t in todo if (t[0], t[1]) not in done]
t_all = time.time()
with open(out_path, "a") as f:
    for k, (run, c, jo, fo) in enumerate(todo):
        t0 = time.time()
        o = json.load(open(os.path.join(RUNS, run, "verdicts", c, "oordeel.json")))
        state = f"{head}Toegankelijkheidsonderzoek, WCAG 2.2. Hieronder staat het oordeel van een beoordelaar over succescriterium {c}.\n[state] {compact(o)}\n"
        ids = tok.encode(state, add_special_tokens=False)
        cache = make_prompt_cache(model)
        x = mx.array(ids)
        for i in range(0, len(ids), 2048):
            model(x[i:i + 2048][None], cache=cache)
            mx.eval([cc.state for cc in cache])
        ans = {}
        for name, (q, risky) in QUESTIONS.items():
            qids = tok.encode(f"[question] {q}\n[options]\nA) ja\nB) nee\nAntwoord met alleen de letter.{tail}", add_special_tokens=False)
            cc = copy.deepcopy(cache)
            lg = model(mx.array(qids)[None], cache=cc)[0, -1].astype(mx.float32)
            pa = mx.logsumexp(lg[mx.array(A)]).item(); pb = mx.logsumexp(lg[mx.array(B)]).item()
            p_a = 1 / (1 + pow(2.718281828, pb - pa))
            ans[name] = p_a if risky == "A" else 1 - p_a
        dt = time.time() - t0
        f.write(json.dumps({"run": run, "criterion": c, "judge": jo, "final": fo, "danger": jo != fo, "risk": ans, "tokens": len(ids), "seconds": dt}) + "\n"); f.flush()
        print(f"{k+1}/{len(todo)} {c} {jo}->{fo} " + " ".join(f"{n}={v:.2f}" for n, v in ans.items()) + f" {len(ids)} tok {dt:.1f}s", flush=True)
print(f"{len(todo)} verdicts in {time.time() - t_all:.0f} s; peak memory GB {mx.get_peak_memory() / 1e9:.1f}")
