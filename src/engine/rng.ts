/**
 * Injected randomness — the engine never calls Math.random directly, so
 * tests and replays can substitute a deterministic source.
 */

export interface Rng {
  /** Uniform float in [0, 1) */
  next(): number;
}

export const liveRng: Rng = { next: () => Math.random() };

/** Deterministic mulberry32 PRNG for tests. */
export function seededRng(seed: number): Rng {
  let state = seed >>> 0;
  return {
    next() {
      state = (state + 0x6d2b79f5) >>> 0;
      let z = state;
      z = Math.imul(z ^ (z >>> 15), z | 1);
      z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
      return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** Uniform float in [min, max). */
export function rollFloat(rng: Rng, min: number, max: number): number {
  return min + rng.next() * (max - min);
}

/** Integer in [min, max], inclusive. */
export function rollInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng.next() * (max - min + 1));
}

/** Pick an index from a weight array; total must be > 0. */
export function pickWeighted(rng: Rng, weights: number[]): number {
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) throw new Error("pickWeighted: no positive weights");
  let roll = rng.next() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll < 0) return i;
  }
  return weights.length - 1;
}
