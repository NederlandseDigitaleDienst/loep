/**
 * Which test files belong to part <i> of <n>, shared out on measured duration instead of on name.
 * Prints the files, one per line, for `node --test`. The durations come from test/durations.json
 * (see scripts/test-durations.ts); a file that is not in it counts as the median, so a new test
 * file always runs in exactly one part.
 *
 *   node scripts/test-shard.ts <i> <n>
 *
 * The longest file goes first to the part with the least time so far (longest processing time first).
 */
import { globSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function shard(files: string[], durations: Record<string, number>, total: number): string[][] {
  const known = Object.values(durations).sort((a, b) => a - b);
  const median = known.length > 0 ? known[Math.floor(known.length / 2)]! : 1;
  const cost = (file: string): number => durations[file] ?? median;
  const parts = Array.from({ length: total }, () => ({ seconds: 0, files: [] as string[] }));
  for (const file of [...files].sort((a, b) => cost(b) - cost(a) || a.localeCompare(b))) {
    const lightest = parts.reduce((min, part) => (part.seconds < min.seconds ? part : min));
    lightest.files.push(file);
    lightest.seconds += cost(file);
  }
  return parts.map((part) => part.files.sort());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [index, total] = process.argv.slice(2).map(Number);
  if (!Number.isInteger(index) || !Number.isInteger(total) || index! < 1 || index! > total!) {
    console.error("gebruik: node scripts/test-shard.ts <i> <n>, met 1 <= i <= n");
    process.exit(2);
  }
  const files = globSync("test/**/*.test.ts").sort();
  const durations = JSON.parse(readFileSync("test/durations.json", "utf8")) as Record<string, number>;
  console.log(shard(files, durations, total!)[index! - 1]!.join("\n"));
}
