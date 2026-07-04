/**
 * Render a mod's bundled text ("+(10-19) to maximum Life") with its rolled
 * values ("+14 to maximum Life"). Range groups appear in stat order, so the
 * i-th "(min-max)" is replaced by values[i].
 *
 * Datamined stat values are often stored in different units than the
 * display text (life regen per MINUTE vs "per second" text, leech in
 * permyriad, "reduced" stats as negatives, crit chance in 1/100 %). The
 * pre-rendered text ranges carry the display units, so when the text has
 * one range per stat we linearly remap the rolled value from the stat range
 * onto the text range instead of hand-encoding unit tables.
 */
import type { ModStat } from "../data/schema.ts";

const RANGE = /\((\d+(?:\.\d+)?)[–-](\d+(?:\.\d+)?)\)/;
const RANGE_ALL = new RegExp(RANGE.source, "g");

const decimalsOf = (raw: string): number => raw.split(".")[1]?.length ?? 0;

function formatValue(value: number, decimals: number): string {
  const rounded = value.toFixed(Math.min(Math.max(decimals, value % 1 === 0 ? 0 : 2), 2));
  return String(Number(rounded));
}

/** Remap a rolled value from its stat range onto the text's display range. */
function displayValue(
  value: number,
  stat: ModStat | undefined,
  tminRaw: string,
  tmaxRaw: string,
): string {
  const decimals = Math.max(decimalsOf(tminRaw), decimalsOf(tmaxRaw));
  const tmin = Number(tminRaw);
  const tmax = Number(tmaxRaw);
  if (!stat || stat.max === stat.min) return formatValue(value, decimals);
  const span = (value - stat.min) / (stat.max - stat.min);
  // "reduced" stats are stored negative but displayed positive: the largest
  // magnitude (stat min) is the largest displayed number.
  const reversed = stat.min + stat.max < 0 && tmin >= 0;
  const display = reversed ? tmax - span * (tmax - tmin) : tmin + span * (tmax - tmin);
  return formatValue(display, decimals);
}

/**
 * Label for a mod family spanning several tiers: per range position, the
 * span from the lowest tier minimum to the highest tier maximum (display
 * units — tier texts carry them already). Falls back to the last (highest)
 * tier's text when tier texts differ structurally.
 */
export function familyText(texts: string[]): string {
  if (texts.length <= 1) return texts[0] ?? "";
  const HOLE = "\u0000"; // placeholder no mod text can contain
  const skeletons = texts.map((t) => t.replace(RANGE_ALL, HOLE));
  if (!skeletons.every((s) => s === skeletons[0])) return texts[texts.length - 1];
  const ranges = texts.map((t) =>
    [...t.matchAll(RANGE_ALL)].map((m) => [Number(m[1]), Number(m[2])] as const),
  );
  const merged = ranges[0].map((_, i) => [
    Math.min(...ranges.map((r) => r[i][0])),
    Math.max(...ranges.map((r) => r[i][1])),
  ]);
  let index = 0;
  return skeletons[0].replaceAll(HOLE, () => {
    const [min, max] = merged[index++];
    return min === max ? String(min) : `(${min}\u2013${max})`;
  });
}

/** Per-range rendered value, in text order (undefined = leave the range raw). */
function renderings(
  text: string,
  values: number[],
  stats: ModStat[] | undefined,
  withRanges: boolean,
): (string | undefined)[] {
  const matches = [...text.matchAll(RANGE_ALL)];
  // Unit remapping needs one text range per stat; otherwise pair each range
  // with the first unused stat sharing its exact bounds (same units).
  const indexPaired = stats !== undefined && matches.length === stats.length;
  const used = new Set<number>();
  return matches.map((match, i) => {
    let rendered: string | undefined;
    if (indexPaired && i < values.length) {
      rendered = displayValue(values[i], stats[i], match[1], match[2]);
    } else if (stats) {
      const j = stats.findIndex(
        (s, k) => !used.has(k) && s.min === Number(match[1]) && s.max === Number(match[2]),
      );
      if (j >= 0 && j < values.length) {
        used.add(j);
        rendered = String(values[j]);
      }
    }
    rendered ??= i < values.length ? String(values[i]) : undefined;
    if (rendered !== undefined && withRanges && match[1] !== match[2]) {
      // negated "reduced" texts can carry high-to-low ranges; show low→high
      const [lo, hi] = [Number(match[1]), Number(match[2])].sort((a, b) => a - b);
      rendered += `(${lo}–${hi})`;
    }
    return rendered;
  });
}

function substitute(text: string, rendered: (string | undefined)[]): string {
  let i = 0;
  return text.replace(RANGE_ALL, (raw) => rendered[i++] ?? raw);
}

export function renderModText(text: string, values: number[], stats?: ModStat[]): string {
  return substitute(text, renderings(text, values, stats, false));
}

/**
 * Advanced-descriptions variant (game: hold Alt): each rolled value is
 * followed by its tier's display range, "+104(100–109) to maximum Life".
 * The en-dash marks inserted ranges so the UI can dim them.
 */
export function renderModTextRanges(text: string, values: number[], stats?: ModStat[]): string {
  return substitute(text, renderings(text, values, stats, true));
}
