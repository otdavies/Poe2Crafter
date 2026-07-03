/**
 * Hand-encoded game rules that exist nowhere in datamined form — only in
 * item description strings, patch notes, and community testing. This file
 * is deliberately the single place where PoE2 0.5.x rules live by hand;
 * every constant cites its source. Verify on each patch.
 */

/**
 * Greater/Perfect currency variants only roll mods whose required level is
 * at least this. Source: 0.4.0 patch notes; carried into 0.5.
 * TODO(0.5-verify): spot-check in game — community consensus is 50/70.
 */
export const MIN_MOD_LEVEL = { normal: 0, greater: 50, perfect: 70 } as const;
export type CurrencyTier = keyof typeof MIN_MOD_LEVEL;

/** Orb of Alchemy: "Upgrades a Normal item to a Rare item with 4 modifiers". */
export const ALCHEMY_MOD_COUNT = 4;

/**
 * Vaal Orb outcome table for equipment. APPROXIMATION: outcome weights are
 * server-side and have never been datamined; equal weights match community
 * testing within noise (poe2wiki, corruption spreadsheets).
 * TODO(0.5-verify): revisit if better community data lands.
 */
export const VAAL_OUTCOMES = [
  { kind: "no_change", weight: 1 },
  { kind: "corrupt_implicit", weight: 1 },
  { kind: "reroll_values", weight: 1 },
  { kind: "reroll_explicits", weight: 1 },
] as const;
export type VaalOutcomeKind = (typeof VAAL_OUTCOMES)[number]["kind"];
