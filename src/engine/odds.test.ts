/**
 * The odds panel's one correctness requirement: displayed odds must equal
 * the empirical distribution of apply() under the same conditions. These
 * tests roll actions thousands of times with seeded RNG and compare
 * frequencies against oddsFor() within statistical tolerance.
 */
import { describe, expect, it } from "vitest";
import type { Mod } from "../data/schema.ts";
import { actionFor, type CraftEvent } from "./actions.ts";
import { tradeSlug } from "./data.ts";
import type { Item } from "./item.ts";
import { OMEN } from "./mechanics.ts";
import { oddsFor, type AdditionOdds, type Odds } from "./odds.ts";
import { seededRng, type Rng } from "./rng.ts";
import { findBase, loadEngineData, pickPoolMods, rareWith } from "./testutil.ts";

const data = loadEngineData();

const familyKey = (mod: Mod): string =>
  `${mod.generation}:${mod.groups.join(",") || mod.id}`;

function assertCraft(odds: Odds | undefined): Extract<Odds, { kind: "craft" }> {
  expect(odds?.kind).toBe("craft");
  return odds as Extract<Odds, { kind: "craft" }>;
}

/** Empirical family counts of the mod added by one apply() call. */
function sampleAdded(item: Item, currencyId: string, rng: Rng, n: number): Map<string, number> {
  const action = actionFor(data, currencyId)!;
  const counts = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const result = action.apply(data, item, rng, new Set());
    const added = result.events.find((e) => e.kind === "added") as
      | Extract<CraftEvent, { kind: "added" }>
      | undefined;
    expect(added).toBeDefined();
    const key = familyKey(data.mod(added!.mod.modId));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Every family with expected count >= 50 must be within 4 sd of odds. */
function expectMatchesOdds(counts: Map<string, number>, odds: AdditionOdds, n: number): void {
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  expect(total).toBe(n);
  let covered = 0;
  for (const family of odds.families) {
    covered += family.chance;
    const expected = n * family.chance;
    if (expected < 50) continue;
    const sd = Math.sqrt(n * family.chance * (1 - family.chance));
    const observed = counts.get(familyKey(family.mods[0])) ?? 0;
    expect(
      Math.abs(observed - expected),
      `family ${familyKey(family.mods[0])}: observed ${observed}, expected ${expected.toFixed(1)}`,
    ).toBeLessThanOrEqual(4 * sd);
  }
  expect(covered).toBeCloseTo(1, 6);
  // no family outside the predicted set was ever rolled
  const predicted = new Set(odds.families.map((f) => familyKey(f.mods[0])));
  for (const key of counts.keys()) expect(predicted.has(key), `unpredicted ${key}`).toBe(true);
}

describe("oddsFor vs empirical apply()", () => {
  // 20k apply() calls rebuild the pool each roll — allow for slow CI workers
  it("exalt addition families match 20k rolls", { timeout: 30_000 }, () => {
    const item = rareWith(data, findBase(data, "Amulet"), [
      ...pickPoolMods(data, rareWith(data, findBase(data, "Amulet"), []), "prefix", 1),
      ...pickPoolMods(data, rareWith(data, findBase(data, "Amulet"), []), "suffix", 1),
    ]);
    const odds = assertCraft(oddsFor(data, item, "exalted"));
    expect(odds.addition).toBeDefined();
    expect(odds.addition!.prefixChance + odds.addition!.suffixChance).toBeCloseTo(1, 6);

    const n = 20_000;
    expectMatchesOdds(sampleAdded(item, "exalted", seededRng(7), n), odds.addition!, n);
  });

  it("chaos removal is uniform and addition matches the removal mixture", { timeout: 30_000 }, () => {
    const base = findBase(data, "Ring");
    const empty = rareWith(data, base, []);
    const item = rareWith(data, base, [
      ...pickPoolMods(data, empty, "prefix", 3),
      ...pickPoolMods(data, empty, "suffix", 3),
    ]);
    const odds = assertCraft(oddsFor(data, item, "chaos"));
    expect(odds.removal!.candidates).toHaveLength(6);
    for (const candidate of odds.removal!.candidates) {
      expect(candidate.chance).toBeCloseTo(1 / 6, 6);
    }

    const action = actionFor(data, "chaos")!;
    const rng = seededRng(21);
    const n = 12_000;
    const removed = new Map<string, number>();
    const added = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const result = action.apply(data, item, rng, new Set());
      for (const event of result.events) {
        if (event.kind === "removed") {
          removed.set(event.mod.modId, (removed.get(event.mod.modId) ?? 0) + 1);
        }
        if (event.kind === "added") {
          const key = familyKey(data.mod(event.mod.modId));
          added.set(key, (added.get(key) ?? 0) + 1);
        }
      }
    }
    const sd = Math.sqrt(n * (1 / 6) * (5 / 6));
    for (const rolled of item.explicits) {
      expect(Math.abs((removed.get(rolled.modId) ?? 0) - n / 6)).toBeLessThanOrEqual(4 * sd);
    }
    expectMatchesOdds(added, odds.addition!, n);
  });

  it("annul under Sinistral Annulment hits only prefixes, uniformly", () => {
    const base = findBase(data, "Ring");
    const empty = rareWith(data, base, []);
    const item = rareWith(data, base, [
      ...pickPoolMods(data, empty, "prefix", 3),
      ...pickPoolMods(data, empty, "suffix", 3),
    ]);
    const omens = new Set([OMEN.sinistralAnnulment]);
    const odds = assertCraft(oddsFor(data, item, "annul", omens));
    const byMod = new Map(odds.removal!.candidates.map((c) => [c.mod.modId, c.chance]));
    for (const rolled of item.explicits) {
      const generation = data.mod(rolled.modId).generation;
      expect(byMod.get(rolled.modId)).toBeCloseTo(generation === "prefix" ? 1 / 3 : 0, 6);
    }
  });

  it("chaos under Whittling only removes the lowest-level modifiers", () => {
    const base = findBase(data, "Ring");
    const empty = rareWith(data, base, []);
    const prefixes = pickPoolMods(data, empty, "prefix", 2);
    const item = rareWith(data, base, prefixes);
    const omens = new Set([OMEN.whittling]);
    const odds = assertCraft(oddsFor(data, item, "chaos", omens));
    const lowest = Math.min(...prefixes.map((id) => data.mod(id).ilvl));
    const lowestCount = prefixes.filter((id) => data.mod(id).ilvl === lowest).length;
    for (const candidate of odds.removal!.candidates) {
      const expected =
        data.mod(candidate.mod.modId).ilvl === lowest ? 1 / lowestCount : 0;
      expect(candidate.chance).toBeCloseTo(expected, 6);
    }
  });

  it("vaal outcome split matches 8k corruptions", { timeout: 30_000 }, () => {
    const base = findBase(data, "Body Armour");
    const empty = rareWith(data, base, []);
    const item = rareWith(data, base, [
      ...pickPoolMods(data, empty, "prefix", 2),
      ...pickPoolMods(data, empty, "suffix", 2),
    ]);
    const odds = oddsFor(data, item, "vaal");
    expect(odds?.kind).toBe("outcomes");
    const outcomes = (odds as Extract<Odds, { kind: "outcomes" }>).outcomes;
    expect(outcomes.reduce((sum, o) => sum + o.chance, 0)).toBeCloseTo(1, 6);

    const classify = (events: CraftEvent[]): string => {
      if (events.some((e) => e.kind === "no_change")) return "No change";
      if (events.some((e) => e.kind === "implicit_added")) return "Gains a corrupted implicit";
      if (events.some((e) => e.kind === "values_pushed")) return "All values ×";
      if (events.some((e) => e.kind === "removed")) return "Chaos Orb effect";
      throw new Error(`unclassifiable events: ${events.map((e) => e.kind).join(",")}`);
    };
    const action = actionFor(data, "vaal")!;
    const rng = seededRng(4242);
    const n = 8_000;
    const counts = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const label = classify(action.apply(data, item, rng).events);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    for (const outcome of outcomes) {
      const observed =
        [...counts.entries()].find(([label]) => outcome.label.startsWith(label))?.[1] ?? 0;
      const expected = n * outcome.chance;
      const sd = Math.sqrt(n * outcome.chance * (1 - outcome.chance));
      expect(
        Math.abs(observed - expected),
        `outcome ${outcome.label}`,
      ).toBeLessThanOrEqual(4 * sd);
    }
  });

  it("essence swap: guaranteed mod certain, removal restricted to its full side", () => {
    const base = findBase(data, "Body Armour");
    const itemClass = data.base(base).itemClass;
    const essence = [...data.essenceByCurrencyId.values()].find(
      (e) => e.name.startsWith("Perfect ") && e.mods[itemClass] !== undefined,
    );
    expect(essence).toBeDefined();
    const modId = essence!.mods[itemClass];
    const generation = data.mod(modId).generation as "prefix" | "suffix";
    const empty = rareWith(data, base, []);
    // Fill the guaranteed mod's side (avoiding its group) plus one other mod.
    const sameSide = pickPoolMods(data, empty, generation, 3, (m) =>
      m.groups.every((g) => !data.mod(modId).groups.includes(g)),
    );
    const otherSide = pickPoolMods(data, empty, generation === "prefix" ? "suffix" : "prefix", 1);
    const item = rareWith(data, base, [...sameSide, ...otherSide]);

    const odds = assertCraft(oddsFor(data, item, tradeSlug(essence!.name)));
    expect(odds.guaranteed!.options).toEqual([{ modId, chance: 1 }]);
    const byMod = new Map(odds.removal!.candidates.map((c) => [c.mod.modId, c.chance]));
    for (const id of sameSide) expect(byMod.get(id)).toBeCloseTo(1 / 3, 6);
    for (const id of otherSide) expect(byMod.get(id)).toBeCloseTo(0, 6);
  });

  it("mirrors canApply blockers", () => {
    const item: Item = {
      baseId: findBase(data, "Amulet"),
      ilvl: 82,
      rarity: "magic",
      implicits: [],
      explicits: [],
      corrupted: false,
    };
    const odds = oddsFor(data, item, "exalted");
    expect(odds).toEqual({ kind: "blocked", reason: "Requires a Rare item" });
    expect(oddsFor(data, item, "not-a-currency")).toBeUndefined();
  });

  it("fracturing odds are uniform over all explicits", () => {
    const base = findBase(data, "Ring");
    const empty = rareWith(data, base, []);
    const item = rareWith(data, base, [
      ...pickPoolMods(data, empty, "prefix", 2),
      ...pickPoolMods(data, empty, "suffix", 2),
    ]);
    const odds = assertCraft(oddsFor(data, item, "fracturing-orb"));
    expect(odds.removal!.verb).toBe("fracture");
    for (const candidate of odds.removal!.candidates) {
      expect(candidate.chance).toBeCloseTo(1 / 4, 6);
    }
  });
});
