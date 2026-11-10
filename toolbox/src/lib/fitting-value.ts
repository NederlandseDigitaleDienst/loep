import type { ElementHandle } from "playwright";

/** What a field says it accepts, as its attributes give it. Null where the attribute is absent. */
export interface FieldConstraints {
  type: string;
  min: string | null;
  max: string | null;
  step: string | null;
  minLength: number | null;
  maxLength: number | null;
  pattern: string | null;
}

/**
 * Kinds of test value that are meant to be wrong, empty, too long or to find nothing: they go in as they are.
 * Fitting them to the field would undo what they test.
 */
const AS_IS = new Set(["invalid-email", "empty", "long", "search", "search-none"]);

const NUMERIC_TYPES = new Set(["number", "range"]);

function parseNumber(text: string | null): number | null {
  if (text === null || text.trim() === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

const decimalsOf = (value: number): number => (String(value).split(".")[1] ?? "").length;

/**
 * A number the field accepts, close to the fixed one. The fixed value stays when it fits, so most fields
 * get what they always got. Otherwise it is clamped into [min, max] and moved onto the step grid, upwards first:
 * below the minimum that is the smallest valid value at or above min, a value a person would plausibly enter
 * (an amount of at least 100 gets 100). Only when no grid point lies above it within max does it move down.
 * The grid starts at min, as in HTML; without min at 0. Null when no value fits: min above max (otherwise min itself is on the grid).
 */
export function fittingNumber(preferred: number, field: Pick<FieldConstraints, "type" | "min" | "max" | "step">): number | null {
  const range = field.type === "range";
  // A range has a default of 0 to 100; a number field has no bounds of its own.
  const min = parseNumber(field.min) ?? (range ? 0 : null);
  const max = parseNumber(field.max) ?? (range ? 100 : null);
  const stepText = (field.step ?? "").trim().toLowerCase();
  // "any" and an absent step on a plain text field: every number is on the grid. A number or range field steps by 1 by default.
  const parsedStep = stepText === "any" ? null : parseNumber(field.step);
  const step = parsedStep !== null && parsedStep > 0 ? parsedStep : stepText === "any" || !NUMERIC_TYPES.has(field.type) ? null : 1;
  if (min !== null && max !== null && min > max) return null;
  const base = min ?? 0;
  const decimals = Math.max(decimalsOf(base), step === null ? 0 : decimalsOf(step));
  // Rounding to the decimals of base and step keeps 0.1 + 0.2 from becoming 0.30000000000000004.
  const onGrid = (count: number): number => Number((base + count * step!).toFixed(decimals));
  const fits = (value: number): boolean => (min === null || value >= min) && (max === null || value <= max) && (step === null || Math.abs(onGrid(Math.round((value - base) / step)) - value) < 1e-9);
  if (fits(preferred)) return preferred;
  const target = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, preferred));
  if (step === null) return target;
  const up = onGrid(Math.ceil((target - base) / step - 1e-9));
  if (fits(up)) return up;
  const down = onGrid(Math.floor((target - base) / step + 1e-9));
  return fits(down) ? down : null;
}

/** The pattern attribute as the browser applies it: the whole value must match. Null when the pattern does not compile. */
function patternOf(pattern: string): RegExp | null {
  for (const flags of ["v", "u"]) {
    try {
      return new RegExp(`^(?:${pattern})$`, flags);
    } catch {
      // Try the older flag; a pattern that compiles under neither is ignored, as the browser does.
    }
  }
  return null;
}

/** Whether a text satisfies the length and pattern of a field. An empty text is not checked: that is `required`. */
export function satisfiesText(value: string, field: Pick<FieldConstraints, "minLength" | "maxLength" | "pattern">): boolean {
  if (value === "") return true;
  const length = [...value].length;
  if (field.minLength !== null && field.minLength >= 0 && length < field.minLength) return false;
  if (field.maxLength !== null && field.maxLength >= 0 && length > field.maxLength) return false;
  const pattern = field.pattern ? patternOf(field.pattern) : null;
  return pattern === null || pattern.test(value);
}

/**
 * The test value to enter in a field: the value of the kind, made to fit what the field accepts, so that a
 * form can get past the field and what appears after it can be measured. The same kind in the same field
 * always gives the same value. A number follows min, max and step (see `fittingNumber`). A text that does not
 * satisfy minlength, maxlength or pattern is replaced by the first other fixed test value that does, in the order
 * of `values`; nothing is made up, so whatever reaches a person still comes from loep. When nothing fits, the value
 * stays as it is and the field shows what it does with a wrong value. Kinds that are meant to be wrong stay as they are.
 */
export function fittingTestValue(kind: string, values: Record<string, string>, field: FieldConstraints): string {
  const value = values[kind] ?? "";
  if (AS_IS.has(kind) || value === "") return value;
  const type = field.type.toLowerCase();
  const bounded = field.min !== null || field.max !== null || field.step !== null;
  if (kind === "number" && (NUMERIC_TYPES.has(type) || bounded)) {
    const preferred = parseNumber(value);
    const fitted = preferred === null ? null : fittingNumber(preferred, { ...field, type });
    const text = fitted === null ? value : String(fitted);
    // A number field has no length or pattern; a text field that asks for a number may have both.
    if (NUMERIC_TYPES.has(type) || satisfiesText(text, field)) return text;
    return value;
  }
  if (kind === "date" && type === "date" && (field.min !== null || field.max !== null)) {
    // ISO dates compare as text. Out of range, the nearest bound is a valid date.
    if (field.min && value < field.min) return field.min;
    if (field.max && value > field.max) return field.max;
    return value;
  }
  if (NUMERIC_TYPES.has(type) || satisfiesText(value, field)) return value;
  const other = Object.entries(values).find(([name, candidate]) => !AS_IS.has(name) && candidate !== "" && satisfiesText(candidate, field));
  return other ? other[1] : value;
}

/** The constraints of a field on the page. Null when the element is gone or is no field. */
export function readConstraints(handle: ElementHandle<Element>): Promise<FieldConstraints | null> {
  return handle
    .evaluate((element) => {
      if (element.localName !== "input" && element.localName !== "textarea") return null;
      const length = (name: string): number | null => {
        const raw = element.getAttribute(name);
        const parsed = raw === null ? NaN : Number.parseInt(raw, 10);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
      };
      return {
        type: element.localName === "textarea" ? "textarea" : ((element as HTMLInputElement).type || "text"),
        min: element.getAttribute("min"),
        max: element.getAttribute("max"),
        step: element.getAttribute("step"),
        minLength: length("minlength"),
        maxLength: length("maxlength"),
        // A textarea has no pattern in HTML.
        pattern: element.localName === "input" ? element.getAttribute("pattern") : null,
      };
    })
    .catch(() => null);
}
