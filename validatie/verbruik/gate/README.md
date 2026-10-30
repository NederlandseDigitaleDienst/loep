# Scripts bij gate.md

Losse scripts voor [../gate.md](../gate.md). Ze zijn geen deel van loep en lezen alleen runs die er al zijn. Draai ze in een eigen werkmap, met `uv`.

| Stap | Script | Wat het doet |
|---|---|---|
| 1 | `loep usage` per run, dan `fase1.mjs` | Kosten per rol, per uitkomst en per soort aanroep. Het laatste argument is een JSON-bestand met per run de map van de werkstroom onder de map met projecten van Claude Code; dat bestand hoort niet in de repository. |
| 2 | `dataset.py`, `testsite.py` | Eén rij per run en criterium (`gate.jsonl`), en dezelfde rijen voor de testsite met de sleutel als label (`testsite.jsonl`). |
| 3 | `baselines.py` | Poortwachters zonder taalmodel, met een drempel van de andere sites. |
| 4 | `jevlike.py`, `evaljl.py` | Jev-vorm op het hele criterium: toestand één keer ingelezen, drie getypeerde vragen. |
| 5 | `rowgate.py`, `evaljl.py` | Per rij van het dossier, voor acht tekstcriteria; `ROWS_OUT` schrijft de score per rij. |
| 6 | `verifygate.py`, `evalvg.py` | De verifieerder-poort: het oordeel als toestand, vier vragen. |
| 7 | `bench.py` | Tijd per beslissing per lengte van de toestand. |

De modellen worden lokaal met MLX gedraaid (`uv run --with mlx-lm`). JevK5 heeft in zijn config `model_type` `qwen3_5_text`; zet dat op `qwen3_5` en zet het om met `mlx_lm convert -q`.
