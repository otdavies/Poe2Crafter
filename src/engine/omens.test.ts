/**
 * Omens: arming, consumption, and interaction order (filter-then-select).
 * All golden tests run with seeded RNG against the real bundle.
 */
import { describe, expect, it } from "vitest";
import { actionFor, type CraftAction, type CraftEvent } from "./actions.ts";
import { countByGeneration, type Item } from "./item.ts";
import { OMEN } from "./mechanics.ts";
import { seededRng } from "./rng.ts";
import { findBase, loadEngineData, pickPoolMods, rareWith } from "./testutil.ts";

const data = loadEngineData();
const action = (id: string): CraftAction => actionFor(data, id)!;
const armed = (...omens: string[]): Set<string> => new Set(omens);

const bodyBase = findBase(data, "Body Armour");
const emptyBody = rareWith(data, bodyBase, []);

/** 2 prefixes + 2 suffixes, deterministic. */
function balancedRare(): Item {
  return rareWith(data, bodyBase, [
    ...pickPoolMods(data, emptyBody, "prefix", 2),
    ...pickPoolMods(data, emptyBody, "suffix", 2),
  ]);
}

function removedMod(events: CraftEvent[]): string {
  const event = events.find((e) => e.kind === "removed");
  expect(event).toBeDefined();
  return (event as { kind: "removed"; mod: { modId: string } }).mod.modId;
}

describe("removal omens", () => {
  it("Sinistral/Dextral Erasure force the Chaos Orb's removal side", () => {
    for (let seed = 0; seed < 10; seed++) {
      const item = balancedRare();
      const left = action("chaos").apply(data, item, seededRng(seed), armed(OMEN.sinistralErasure));
      expect(data.mod(removedMod(left.events)).generation).toBe("prefix");
      expect(left.consumedOmens).toEqual([OMEN.sinistralErasure]);

      const right = action("chaos").apply(data, item, seededRng(seed), armed(OMEN.dextralErasure));
      expect(data.mod(removedMod(right.events)).generation).toBe("suffix");
    }
  });

  it("Whittling makes the Chaos Orb remove the lowest-required-level mod", () => {
    const item = balancedRare();
    // ties at the lowest level are broken randomly — assert on the level
    const lowest = Math.min(...item.explicits.map((m) => data.mod(m.modId).ilvl));
    for (let seed = 0; seed < 10; seed++) {
      const result = action("chaos").apply(data, item, seededRng(seed), armed(OMEN.whittling));
      expect(data.mod(removedMod(result.events)).ilvl).toBe(lowest);
      expect(result.consumedOmens).toContain(OMEN.whittling);
    }
  });

  it("Whittling + Dextral Erasure removes the lowest-level SUFFIX (order: filter, then select)", () => {
    const item = balancedRare();
    const lowestSuffix = item.explicits
      .map((m) => data.mod(m.modId))
      .filter((m) => m.generation === "suffix")
      .reduce((a, b) => (b.ilvl < a.ilvl ? b : a));
    for (let seed = 0; seed < 10; seed++) {
      const result = action("chaos").apply(
        data,
        item,
        seededRng(seed),
        armed(OMEN.whittling, OMEN.dextralErasure),
      );
      expect(removedMod(result.events)).toBe(lowestSuffix.id);
      expect(result.consumedOmens).toEqual(
        expect.arrayContaining([OMEN.whittling, OMEN.dextralErasure]),
      );
    }
  });

  it("Sinistral/Dextral Annulment restrict the Orb of Annulment", () => {
    const item = balancedRare();
    const result = action("annul").apply(data, item, seededRng(3), armed(OMEN.dextralAnnulment));
    expect(data.mod(removedMod(result.events)).generation).toBe("suffix");
    // and it blocks when the restricted side has nothing to remove
    const suffixOnly = rareWith(data, bodyBase, pickPoolMods(data, emptyBody, "suffix", 2));
    expect(action("annul").canApply(data, suffixOnly, armed(OMEN.sinistralAnnulment))).toMatch(
      /No removable prefix/,
    );
  });

  it("conflicting Sinistral + Dextral omens block the action", () => {
    const item = balancedRare();
    expect(
      action("chaos").canApply(data, item, armed(OMEN.sinistralErasure, OMEN.dextralErasure)),
    ).toMatch(/Conflicting/);
  });

  it("unrelated omens are ignored and left armed", () => {
    const item = balancedRare();
    const result = action("chaos").apply(
      data,
      item,
      seededRng(5),
      armed(OMEN.sinistralAnnulment), // an annulment omen must not affect chaos
    );
    expect(result.consumedOmens ?? []).toEqual([]);
  });
});

describe("addition omens", () => {
  it("Sinistral/Dextral Exaltation force the added side", () => {
    for (let seed = 0; seed < 10; seed++) {
      const item = balancedRare();
      const result = action("exalted").apply(
        data,
        item,
        seededRng(seed),
        armed(OMEN.dextralExaltation),
      );
      expect(countByGeneration(data, result.item, "suffix")).toBe(3);
      expect(countByGeneration(data, result.item, "prefix")).toBe(2);
    }
  });

  it("Greater Exaltation adds two mods, stacking with Sinistral", () => {
    const item = rareWith(data, bodyBase, [
      pickPoolMods(data, emptyBody, "prefix", 1)[0],
      ...pickPoolMods(data, emptyBody, "suffix", 3),
    ]);
    const result = action("exalted").apply(
      data,
      item,
      seededRng(7),
      armed(OMEN.greaterExaltation, OMEN.sinistralExaltation),
    );
    expect(result.item.explicits).toHaveLength(6);
    expect(countByGeneration(data, result.item, "prefix")).toBe(3);
    expect(result.consumedOmens).toEqual(
      expect.arrayContaining([OMEN.greaterExaltation, OMEN.sinistralExaltation]),
    );
  });

  it("Homogenising Exaltation adds a mod sharing a type with an existing one", () => {
    const empty = emptyBody;
    const [tagged] = pickPoolMods(data, empty, "prefix", 1, (m) => m.catalystTags.length > 0);
    for (let seed = 0; seed < 10; seed++) {
      const item = rareWith(data, bodyBase, [tagged]);
      const result = action("exalted").apply(
        data,
        item,
        seededRng(seed),
        armed(OMEN.homogenisingExaltation),
      );
      const added = result.item.explicits.find((m) => m.modId !== tagged)!;
      const sharedTags = data.mod(tagged).catalystTags;
      expect(data.mod(added.modId).catalystTags.some((t) => sharedTags.includes(t))).toBe(true);
    }
  });

  it("Homogenising Coronation does the same for the Regal Orb", () => {
    const [tagged] = pickPoolMods(data, emptyBody, "prefix", 1, (m) => m.catalystTags.length > 0);
    const magic: Item = { ...rareWith(data, bodyBase, [tagged]), rarity: "magic" };
    const result = action("regal").apply(
      data,
      magic,
      seededRng(11),
      armed(OMEN.homogenisingCoronation),
    );
    expect(result.item.rarity).toBe("rare");
    const added = result.item.explicits.find((m) => m.modId !== tagged)!;
    const sharedTags = data.mod(tagged).catalystTags;
    expect(data.mod(added.modId).catalystTags.some((t) => sharedTags.includes(t))).toBe(true);
    expect(result.consumedOmens).toEqual([OMEN.homogenisingCoronation]);
  });

  it("Catalysing Exaltation consumes the item's catalyst quality", () => {
    const item: Item = { ...balancedRare(), quality: { catalystId: "flesh-catalyst", percent: 12 } };
    const result = action("exalted").apply(
      data,
      item,
      seededRng(13),
      armed(OMEN.catalysingExaltation),
    );
    expect(result.item.quality).toBeUndefined();
    expect(result.consumedOmens).toEqual([OMEN.catalysingExaltation]);
    // and it blocks without quality to consume
    expect(action("exalted").canApply(data, balancedRare(), armed(OMEN.catalysingExaltation)))
      .toMatch(/quality/);
  });
});

describe("Omen of Sanctification", () => {
  it("divine sanctifies a rare: values scaled 0.78-1.22 (ceil) and locked forever", () => {
    const item = balancedRare();
    const result = action("divine").apply(data, item, seededRng(17), armed(OMEN.sanctification));
    expect(result.item.sanctified).toBe(true);
    expect(result.consumedOmens).toEqual([OMEN.sanctification]);
    result.item.explicits.forEach((rolled, i) => {
      expect(rolled.modId).toBe(item.explicits[i].modId);
      rolled.values.forEach((value, j) => {
        const before = item.explicits[i].values[j];
        expect(value).toBeGreaterThanOrEqual(Math.ceil(before * 0.78));
        expect(value).toBeLessThanOrEqual(Math.ceil(before * 1.22));
      });
    });
    for (const id of ["chaos", "exalted", "annul", "divine", "vaal"]) {
      expect(action(id).canApply(data, result.item), id).toMatch(/Sanctified/);
    }
  });

  it("requires a rare item while armed", () => {
    const magic: Item = { ...balancedRare(), rarity: "magic", explicits: [] };
    const withMods = {
      ...magic,
      explicits: rareWith(data, bodyBase, pickPoolMods(data, emptyBody, "prefix", 1)).explicits,
    };
    expect(action("divine").canApply(data, withMods, armed(OMEN.sanctification))).toMatch(/Rare/);
  });
});

describe("Crystallisation omens (essence-like swaps)", () => {
  const perfectBody = "perfect-essence-of-the-body";
  const guaranteed = data.mod(
    data.essenceByCurrencyId.get(perfectBody)!.mods["Body Armour"],
  );

  it("restricts which side the essence removes", () => {
    const clean = (n: number, generation: "prefix" | "suffix") =>
      pickPoolMods(data, emptyBody, generation, n, (m) =>
        m.groups.every((g) => !guaranteed.groups.includes(g)),
      );
    for (let seed = 0; seed < 10; seed++) {
      const item = rareWith(data, bodyBase, [...clean(1, "prefix"), ...clean(2, "suffix")]);
      const result = action(perfectBody).apply(
        data,
        item,
        seededRng(seed),
        armed(OMEN.dextralCrystallisation),
      );
      expect(data.mod(removedMod(result.events)).generation).toBe("suffix");
      expect(result.consumedOmens).toEqual([OMEN.dextralCrystallisation]);
    }
  });

  it("blocks when the omen contradicts the slot the guaranteed mod needs", () => {
    expect(guaranteed.generation).toBe("prefix");
    const prefixes = pickPoolMods(data, emptyBody, "prefix", 3, (m) =>
      m.groups.every((g) => !guaranteed.groups.includes(g)),
    );
    const item = rareWith(data, bodyBase, prefixes); // prefixes full
    expect(
      action(perfectBody).canApply(data, item, armed(OMEN.dextralCrystallisation)),
    ).toMatch(/omen restricts removal/);
  });

  it("also applies to Verisium alloys", () => {
    const ringBase = findBase(data, "Ring");
    const emptyRing = rareWith(data, ringBase, []);
    const item = rareWith(data, ringBase, [
      ...pickPoolMods(data, emptyRing, "prefix", 1, (m) => m.groups[0] !== "BaseRunicWard"),
      ...pickPoolMods(data, emptyRing, "suffix", 1),
    ]);
    const result = action("runic-alloy").apply(
      data,
      item,
      seededRng(19),
      armed(OMEN.sinistralCrystallisation),
    );
    expect(data.mod(removedMod(result.events)).generation).toBe("prefix");
  });
});
