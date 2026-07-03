/**
 * Render a mod's bundled text ("+(10-19) to maximum Life") with its rolled
 * values ("+14 to maximum Life"). Range groups appear in stat order, so the
 * i-th "(min-max)" is replaced by values[i].
 */
const RANGE = /\((\d+(?:\.\d+)?)[–-](\d+(?:\.\d+)?)\)/;

export function renderModText(text: string, values: number[]): string {
  let out = text;
  for (const value of values) {
    if (!RANGE.test(out)) break;
    out = out.replace(RANGE, String(value));
  }
  return out;
}
