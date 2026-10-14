import { existsSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { readJson, sha256File, writeJson } from "../lib/canonical.ts";
import type { FrameRecord } from "../browser/frame.ts";
import type { PassedWrite } from "../lib/writes.ts";
import type { Blocked } from "./safety.ts";

export interface StartState {
  url: string;
  width: number;
  height: number;
  scheme: "light" | "dark";
}

/**
 * One state-changing command, in a form that can be executed again on a fresh page: the element
 * by its selector chain, not by a reference number. A chain goes into an embedded frame the way it
 * goes into a shadow root: the part after a frame element is looked up in the document of that frame.
 */
export interface Step {
  command: string;
  args: string[];
  options: Record<string, string | boolean>;
  target: string[] | null;
  /** Other ways to find the element of the step when its selector chain no longer leads to it, such as an id that differs per page load. */
  locators?: Locators | null;
}

export interface Locators {
  tag: string;
  role: string | null;
  /** aria-label, or else the text of the element. */
  name: string;
  /** Which of the elements with this role and name it is, counted from 0 in document order. */
  nth: number;
  /** Selector chain without ids: only element names and their place among siblings. */
  structural: string[];
}

export interface StateRecord {
  /** Hash of start and steps: two observations with the same id were made in the same state. */
  id: string;
  start: StartState | null;
  steps: Step[];
}

/** The embedded frame an element sits in: address, origin and title, and the part of the chain of the element that leads to the frame element. */
export interface FrameTarget extends FrameRecord {
  path: string[];
}

export interface TargetRecord {
  ref: number;
  /** Selector chain from the tab down, through shadow roots and embedded frames. */
  path: string[];
  tag: string;
  role: string | null;
  text: string;
  /** Where a reader finds the element in the source of the page: the heading it stands under and the sentence or cell around it. Absent in records made before these were kept. */
  heading?: string | null;
  around?: string | null;
  /** Set when the element sits in an embedded frame; `heading` and `around` are then those inside the frame. */
  frame?: FrameTarget;
}

export interface PageRecord {
  url: string;
  title: string;
  viewport: { width: number; height: number };
  scheme: "light" | "dark";
  scroll: [number, number];
  /** Hash of the normalised DOM, shadow roots included, as the page was after the command. */
  domSha256: string;
}

export interface Observation {
  id: string;
  nr: number;
  session: string;
  time: string;
  durationMs: number;
  command: string;
  args: string[];
  options: Record<string, string | boolean>;
  target: TargetRecord | null;
  /** The state the command ran in: how to get there from a fresh page. */
  state: StateRecord;
  /** Set when the command itself changed the state. */
  stateAfter: string | null;
  page: PageRecord | null;
  result: unknown;
  images: { path: string; sha256: string }[];
  /** Requests and messages that were refused while the command ran. */
  blocked: Blocked[];
  /** Requests and socket messages that were let through to the test environment while the command ran; absent when there were none. */
  writes?: PassedWrite[];
  /** Windows the page tried to open, and browser dialogs it showed; both are closed at once. */
  popups: string[];
  alerts: { type: string; message: string }[];
  error: string | null;
}

export const observationId = (session: string, nr: number): string => `${session}-${String(nr).padStart(4, "0")}`;

/** The numbered records of one session: `observations/<session>/<nr>.json` in the run directory. */
export class ObservationLog {
  readonly runDir: string;
  readonly session: string;
  private next = 1;

  constructor(runDir: string, session: string) {
    this.runDir = runDir;
    this.session = session;
  }

  get relativeDir(): string {
    return join("observations", this.session);
  }

  /** A session that is started again under the same name continues its numbering. */
  async init(): Promise<void> {
    const dir = join(this.runDir, this.relativeDir);
    await mkdir(dir, { recursive: true });
    const numbers = (await readdir(dir)).map((name) => /^(\d+)\.json$/.exec(name)?.[1]).filter((value): value is string => value !== undefined).map(Number);
    this.next = Math.max(0, ...numbers) + 1;
  }

  reserve(): number {
    return this.next++;
  }

  /** Path of a file that belongs to an observation, relative to the run directory. */
  file(nr: number, suffix: string): string {
    return join(this.relativeDir, `${String(nr).padStart(4, "0")}${suffix}`);
  }

  async write(observation: Observation): Promise<string> {
    const path = this.file(observation.nr, ".json");
    await writeJson(join(this.runDir, path), observation);
    return path;
  }
}

export async function readObservation(runDir: string, id: string): Promise<Observation> {
  const split = id.lastIndexOf("-");
  const path = join(runDir, "observations", id.slice(0, split), `${id.slice(split + 1)}.json`);
  if (split < 1 || !existsSync(path)) throw new Error(`waarneming ${id} bestaat niet in deze run`);
  return readJson<Observation>(path);
}

/** Collects the image files a command writes, so the record can list each with its hash. */
export class Images {
  readonly runDir: string;
  private readonly stem: string;
  private readonly files: string[] = [];
  private readonly dirs: string[] = [];

  /** `stem` is the path of the observation without extension, relative to the run directory. */
  constructor(runDir: string, stem: string) {
    this.runDir = runDir;
    this.stem = stem;
  }

  /** Reserve `<nr><suffix>.png`; returns the absolute path to write to. */
  image(suffix = ""): string {
    const relative = `${this.stem}${suffix}.png`;
    this.files.push(relative);
    return join(this.runDir, relative);
  }

  /** Reserve `<nr><suffix>` for a file that is not a picture, such as the source of a page; returns the absolute path to write to. */
  file(suffix: string): string {
    const relative = `${this.stem}${suffix}`;
    this.files.push(relative);
    return join(this.runDir, relative);
  }

  /** Reserve a directory `<nr>-<name>` for a series of images; returns its absolute and relative path. */
  dir(name: string): { absolute: string; relative: string } {
    const relative = `${this.stem}-${name}`;
    this.dirs.push(relative);
    return { absolute: join(this.runDir, relative), relative };
  }

  relative(absolute: string): string {
    return absolute.slice(this.runDir.length + 1);
  }

  async hashed(): Promise<{ path: string; sha256: string }[]> {
    const paths = this.files.filter((file) => existsSync(join(this.runDir, file)));
    for (const dir of this.dirs) {
      if (!existsSync(join(this.runDir, dir))) continue;
      for (const name of (await readdir(join(this.runDir, dir))).sort()) paths.push(join(dir, name));
    }
    return Promise.all(paths.map(async (path) => ({ path, sha256: await sha256File(join(this.runDir, path)) })));
  }
}
