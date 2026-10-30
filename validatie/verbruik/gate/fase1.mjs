// Phase 1: where the tokens of a loep run go, per role, per outcome, per kind of tool call.
// Usage: node fase1.mjs <runs-dir> <usage-dir> <projects-dir> <workflows.json> > fase1.json
import fs from "node:fs";
import path from "node:path";

const [runsDir, usageDir, projectsDir] = process.argv.slice(2);
// run -> workflow transcript folder, relative to <projects-dir>; written per machine, not in the repository.
const WORKFLOWS = JSON.parse(fs.readFileSync(process.argv[5], "utf8"));
// API prices per million tokens, as in validatie/verbruik/README.md (Opus 5.5, 19 Oct 2026); Sonnet is half.
const PRICE = { opus: { i: 4, cw: 5, cr: 0.2, o: 20 }, sonnet: { i: 2, cw: 2.5, cr: 0.1, o: 10 }, haiku: { i: 1, cw: 1.25, cr: 0.1, o: 5 } };
const family = (m) => (/sonnet/.test(m) ? "sonnet" : /haiku/.test(m) ? "haiku" : "opus");
const cost = (u, m) => { const p = PRICE[family(m)]; return (u.input * p.i + u.cacheWrite * p.cw + u.cacheRead * p.cr + u.output * p.o) / 1e6; };

// What a tool call does, coarse enough to say "reading and judging" against "measuring in the browser".
const LIVE = new Set(["open", "find", "click", "html", "look", "ax", "name", "focus", "crop", "scroll", "contrast", "state", "style", "hover", "key", "type", "target", "wait", "press", "lang", "tab", "distinct", "voiceover", "zoom", "reflow", "spacing", "text", "media", "motion", "select", "back", "reload", "viewport", "resize", "dark", "print", "check", "list", "pdf"]);
function kind(block) {
  if (block.type !== "tool_use") return null;
  const n = block.name;
  if (n === "Read") {
    const p = block.input.file_path || "";
    if (/\.(png|jpe?g|webp)$/i.test(p)) return "beeld lezen";
    if (/(beoordeel|verifieer|afmaak|opdracht)[^/]*\.md$/.test(p)) return "opdracht lezen";
    if (/dossier/.test(p)) return "dossier";
    return "ander bestand lezen";
  }
  if (n === "Write" || n === "Edit") return "oordeel schrijven";
  if (n !== "Bash") return "ander gereedschap";
  const cmd = block.input.command || "";
  if (/check-verdict|check-walk/.test(cmd)) return "controle oordeel";
  const direct = cmd.match(/cli\.ts\s+session\s+(?:--\S+\s+\S+\s+)*([a-z-]+)/) || cmd.match(/^\s*(?:sh\s+)?\S*\/werk\/[a-z]+-\d+\S*\s+([a-z-]+)/);
  if (direct) return direct[1] === "dossier" ? "dossier" : direct[1] === "start" || direct[1] === "stop" ? "sessie start/stop" : "live meten";
  // Worktree-isolated runs call the session through a wrapper script in the scratchpad ($L open P01).
  if (/scratchpad\/[^\s;]*\s+[a-z-]+|\$L\s+[a-z-]+/.test(cmd) && !/^\s*cat\s*>/.test(cmd)) return /\$L\s+dossier|\/l\d+\s+dossier/.test(cmd) ? "dossier" : "live meten";
  const body = cmd.split(/;\s*\}\s*;?/).slice(1).join(" ") || cmd;
  const m = body.match(/(?:^|[;&|(]\s*|\s)loep\s+([a-z-]+)/);
  if (m) {
    if (m[1] === "dossier") return "dossier";
    if (m[1] === "start" || m[1] === "stop") return "sessie start/stop";
    return "live meten";
  }
  if (/dossier|kandidaten|aria\.yaml|pages\/|gate\.json|site\.json|facts|states\/|\.json|\.png|\.yaml/.test(cmd)) return "bewijs lezen (eigen script)";
  return "eigen scripts, overig";
}

function messages(file) {
  const seen = new Map();
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.type !== "assistant" || !o.message?.usage) continue;
    const id = o.message.id || o.uuid;
    const prev = seen.get(id);
    const u = o.message.usage;
    const rec = prev || { usage: u, model: o.message.model || "", kinds: [] };
    if (!prev || (u.output_tokens || 0) > (prev.usage.output_tokens || 0)) rec.usage = u;
    for (const b of o.message.content || []) { const k = kind(b); if (k) rec.kinds.push(k); }
    seen.set(id, rec);
  }
  return [...seen.values()];
}

const out = { runs: {} };
for (const [run, wf] of Object.entries(WORKFLOWS)) {
  const usage = JSON.parse(fs.readFileSync(path.join(usageDir, run + ".json"), "utf8"));
  const ev = JSON.parse(fs.readFileSync(path.join(runsDir, run, "evaluation.json"), "utf8"));
  const outcome = Object.fromEntries(ev.criteria.map((c) => [c.id, c.outcome]));
  const R = { roles: {}, byOutcome: {}, perCriterion: {}, byKind: {}, rulings: {}, candidates: 0 };
  for (const a of usage.agents) {
    const c = cost(a, a.model);
    const r = (R.roles[a.role] ??= { agents: 0, turns: 0, cost: 0, cacheRead: 0 });
    r.agents++; r.turns += a.turns; r.cost += c; r.cacheRead += a.cacheRead;
    if (a.role === "judge" || a.role === "verifier" || a.role === "finisher") {
      const p = (R.perCriterion[a.criterion] ??= { outcome: outcome[a.criterion], judge: 0, verifier: 0, finisher: 0, turns: 0 });
      p[a.role] += c; p.turns += a.turns;
    }
  }
  for (const [crit, p] of Object.entries(R.perCriterion)) {
    const g = (R.byOutcome[p.outcome ?? "?"] ??= { criteria: 0, cost: 0, turns: 0 });
    g.criteria++; g.cost += p.judge + p.verifier + p.finisher; g.turns += p.turns;
    try {
      const f = JSON.parse(fs.readFileSync(path.join(runsDir, run, "verdicts", crit, "final.json"), "utf8"));
      for (const o of f.observations || []) R.rulings[o.ruling] = (R.rulings[o.ruling] || 0) + 1;
      p.findings = (f.findings || []).length;
    } catch {}
    try {
      const k = JSON.parse(fs.readFileSync(path.join(runsDir, run, "tasks", crit, "kandidaten.json"), "utf8"));
      p.candidates = (Array.isArray(k) ? k : k.candidates || []).length; R.candidates += p.candidates;
    } catch {}
  }
  // Cost of each turn, attributed evenly to the tool calls it makes; a turn without a call is "denken en tekst".
  const dir = path.join(projectsDir, wf);
  for (const meta of fs.readdirSync(dir).filter((f) => f.endsWith(".meta.json"))) {
    const role = (JSON.parse(fs.readFileSync(path.join(dir, meta), "utf8")).description || "").split(" ")[0];
    if (role !== "judges" && role !== "verifiers") continue;
    for (const m of messages(path.join(dir, meta.replace(".meta.json", ".jsonl")))) {
      const u = m.usage;
      const c = cost({ input: u.input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, output: u.output_tokens || 0 }, m.model);
      const ks = m.kinds.length ? m.kinds : ["denken en tekst"];
      for (const k of ks) {
        const b = (R.byKind[k] ??= { calls: 0, cost: 0 });
        b.calls += m.kinds.length ? 1 : 0; b.cost += c / ks.length;
      }
    }
  }
  out.runs[run] = R;
}
console.log(JSON.stringify(out, null, 1));
