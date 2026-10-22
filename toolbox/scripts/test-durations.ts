/**
 * A reporter for the test runner of Node that writes how many seconds each test file took, as the
 * JSON that scripts/test-shard.ts reads. Refresh test/durations.json with:
 *
 *   cd toolbox && node --test --test-reporter=./scripts/test-durations.ts 'test/**\/*.test.ts' > test/durations.json
 *
 * A file's time is the sum of its top-level tests, which run one after the other within the file.
 */
import { relative } from "node:path";

type Event = { type: string; data: { file?: string; nesting?: number; details?: { duration_ms?: number } } };

export default async function* durations(source: AsyncIterable<Event>): AsyncGenerator<string> {
  const seconds: Record<string, number> = {};
  for await (const event of source) {
    if ((event.type !== "test:pass" && event.type !== "test:fail") || event.data.nesting !== 0 || !event.data.file) continue;
    const file = relative(process.cwd(), event.data.file);
    seconds[file] = (seconds[file] ?? 0) + (event.data.details?.duration_ms ?? 0) / 1000;
  }
  const sorted = Object.fromEntries(Object.entries(seconds).sort(([a], [b]) => a.localeCompare(b)).map(([file, s]) => [file, Math.max(1, Math.round(s))]));
  yield `${JSON.stringify(sorted, null, 2)}\n`;
}
