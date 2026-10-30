"""Latency of one Jev-style decision on this machine: one prefill pass over state + question, logits of
the answer tokens, no generation. Per model and state length: one decision alone, and a batch of 16.

usage: python bench.py <mlx-model-dir>...
"""

import sys
import time

import mlx.core as mx
from mlx_lm import load

text = open("gate.jsonl").read()  # real dossier text as filler, so tokenisation is realistic
for path in sys.argv[1:]:
    model, tok = load(path)
    base = tok.encode(text[:400000], add_special_tokens=False)
    print(f"\n{path.rstrip('/').split('/')[-1]}")
    for n in (200, 500, 1000, 2000, 8000):
        ids = mx.array(base[:n])[None]
        mx.eval(model(ids))  # warm up this shape
        t0 = time.time(); mx.eval(model(ids)); one = time.time() - t0
        batch = mx.array([base[i * n:(i + 1) * n] for i in range(16)]) if 16 * n <= len(base) else None
        if batch is not None and n <= 2000:
            mx.eval(model(batch))
            t0 = time.time(); mx.eval(model(batch)); b = time.time() - t0
            bs = f"batch 16: {b:.2f} s, {16 / b:.1f} decisions/s, {16 * n / b:.0f} tok/s"
        else:
            bs = ""
        print(f"  {n:5d} tokens: one decision {one * 1000:7.0f} ms ({n / one:.0f} tok/s)  {bs}", flush=True)
    del model
    mx.clear_cache()
