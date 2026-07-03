/**
 * The essence-like family: essences (upgrade + swap tiers), Verisium alloys,
 * and Liquid Emotions on jewels. All resolved through actionFor().
 */
import { describe, expect, it } from "vitest";
import { actionFor, type CraftAction } from "./actions.ts";
import { tradeSlug } from "./data.ts";
import { countByGeneration, createItem, type Item } from "./item.ts";
import { ALLOYS, CORRUPTED_ESSENCES } from "./mechanics.ts";
import { seededRng } from "./rng.ts";
import {
  findBase,
  findBaseByName,
  loadEngineData,
  pickPoolMods,
  rareWith,
} from "./testutil.ts";

const data = loadEngineData();

const action = (id: string): CraftAction => {
  const found = actionFor(data, id);
  expect(found, `action for ${id}`).toBeDefined();
  return found as CraftAction;
};

describe("actionFor data-driven registry", () => {
  it("resolves every bundled essence and emotion by trade slug", () => {
    for (const [id] of data.essenceByCurrencyId) expect(actionFor(data, id)).toBeDefined();
    for (const [id] of data.emotionByCurrencyId) expect(actionFor(data, id)).toBeDefined();
    expect(data.essenceByCurrencyId.size).toBeGreaterThanOrEqual(80);
    expect(data.emotionByCurrencyId.size).toBe(26);
  });

  it("knows nothing about junk ids", () => {
    expect(actionFor(data, "mirror-of-kalandra")).toBeUndefined();
  });

  it("every hand-encoded alloy mod exists and never rolls naturally", () => {
    for (const [, spec] of ALLOYS) {
      for (const modIds of Object.values(spec)) {
        for (const modId of modIds) {
          const mod = data.mod(modId); // throws if unknown
          expect(mod.weights.every(([, w]) => w === 0), `${modId} must be alloy-only`).toBe(true);
        }
      }
    }
  });
});

describe("essences", () => {
  const lesserBody = data.essenceByCurrencyId.get("lesser-essence-of-the-body")!;
  const bodyBase = findBase(data, "Body Armour");

  it("upgrade tier: Magic -> Rare with the guaranteed mod", () => {
    const rng = seededRng(31);
    let item = createItem(data, bodyBase, 82, rng);
    item = { ...item, rarity: "magic" };
    const act = action("lesser-essence-of-the-body");
    expect(act.canApply(data, item)).toBeNull();
    const result = act.apply(data, item, rng);
    expect(result.item.rarity).toBe("rare");
    expect(result.item.explicits.map((m) => m.modId)).toContain(
      lesserBody.mods["Body Armour"],
    );
  });

  it("upgrade tier requires a Magic item and a matching item class", () => {
    const rng = seededRng(37);
    const normal = createItem(data, bodyBase, 82, rng);
    expect(action("lesser-essence-of-the-body").canApply(data, normal)).toMatch(/Magic/);
    const wrongClass = { ...createItem(data, findBase(data, "Quiver"), 82, rng), rarity: "magic" as const };
    if (!lesserBody.mods["Quiver"]) {
      expect(action("lesser-essence-of-the-body").canApply(data, wrongClass)).toMatch(
        /Cannot be applied/,
      );
    }
  });

  it("blocks when the item already has the guaranteed mod's group", () => {
    const item = rareWith(data, bodyBase, [lesserBody.mods["Body Armour"]]);
    const magic = { ...item, rarity: "magic" as const, explicits: item.explicits };
    expect(action("lesser-essence-of-the-body").canApply(data, magic)).toMatch(
      /already has a modifier/,
    );
  });

  it("swap tier (Perfect): removes one mod and adds the guaranteed one", () => {
    const perfect = data.essenceByCurrencyId.get("perfect-essence-of-the-body")!;
    const guaranteed = perfect.mods["Body Armour"];
    expect(guaranteed).toBeDefined();
    const item = rareWith(
      data,
      bodyBase,
      pickPoolMods(data, rareWith(data, bodyBase, []), "suffix", 2),
    );
    const result = action("perfect-essence-of-the-body").apply(data, item, seededRng(41));
    expect(result.item.rarity).toBe("rare");
    expect(result.item.explicits).toHaveLength(2);
    expect(result.item.explicits.map((m) => m.modId)).toContain(guaranteed);
    expect(result.events.map((e) => e.kind)).toEqual(["removed", "added"]);
  });

  it("swap tier removes from the guaranteed mod's side when it is full", () => {
    const perfect = data.essenceByCurrencyId.get("perfect-essence-of-the-body")!;
    const guaranteed = data.mod(perfect.mods["Body Armour"]);
    expect(guaranteed.generation).toBe("prefix");
    const empty = rareWith(data, bodyBase, []);
    const prefixes = pickPoolMods(data, empty, "prefix", 3, (m) => m.groups.every(
      (g) => !guaranteed.groups.includes(g),
    ));
    const suffixes = pickPoolMods(data, empty, "suffix", 2);
    for (let seed = 0; seed < 10; seed++) {
      const item = rareWith(data, bodyBase, [...prefixes, ...suffixes]);
      const result = action("perfect-essence-of-the-body").apply(data, item, seededRng(seed));
      // a prefix must have been removed to make room
      expect(countByGeneration(data, result.item, "prefix")).toBe(3);
      expect(result.item.explicits.map((m) => m.modId)).toContain(guaranteed.id);
      for (const suffix of suffixes) {
        expect(result.item.explicits.map((m) => m.modId)).toContain(suffix);
      }
    }
  });

  it("swap tier requires a Rare item", () => {
    const rng = seededRng(43);
    const magic = { ...createItem(data, bodyBase, 82, rng), rarity: "magic" as const };
    expect(action("perfect-essence-of-the-body").canApply(data, magic)).toMatch(/Rare/);
  });

  it("corrupted essences behave like Perfect (swap on rare, no corruption)", () => {
    for (const name of CORRUPTED_ESSENCES) {
      const essence = data.essenceByCurrencyId.get(tradeSlug(name));
      if (!essence) continue;
      const [itemClass, guaranteed] = Object.entries(essence.mods)[0] ?? [];
      if (!itemClass) continue; // e.g. Essence of the Abyss has no datamined map
      const base = findBase(data, itemClass);
      const empty = rareWith(data, base, []);
      const mods = pickPoolMods(data, empty, "suffix", 1, (m) =>
        m.groups.every((g) => !data.mod(guaranteed).groups.includes(g)),
      );
      const item = rareWith(data, base, mods);
      const act = action(tradeSlug(name));
      expect(act.canApply(data, item), name).toBeNull();
      const result = act.apply(data, item, seededRng(47));
      expect(result.item.corrupted, name).toBe(false);
      expect(result.item.explicits.map((m) => m.modId), name).toContain(guaranteed);
    }
  });
});

describe("verisium alloys", () => {
  const ringBase = findBase(data, "Ring");

  it("swaps a random mod for the alloy's guaranteed mod", () => {
    const empty = rareWith(data, ringBase, []);
    const item = rareWith(data, ringBase, pickPoolMods(data, empty, "suffix", 2));
    const result = action("runic-alloy").apply(data, item, seededRng(53));
    expect(result.item.explicits).toHaveLength(2);
    expect(result.item.explicits.map((m) => m.modId)).toContain("AlloyMaximumRunicWard1");
  });

  it("requires a rare item of a matching class and level", () => {
    const rng = seededRng(59);
    expect(action("runic-alloy").canApply(data, createItem(data, ringBase, 82, rng))).toMatch(
      /Rare/,
    );
    const gloves = rareWith(data, findBase(data, "Gloves"), []);
    expect(action("runic-alloy").canApply(data, gloves)).toMatch(/Cannot be applied/);
    const lowLevel = rareWith(
      data,
      ringBase,
      pickPoolMods(data, rareWith(data, ringBase, [], 5), "suffix", 1),
      5,
    );
    expect(action("runic-alloy").canApply(data, lowLevel)).toMatch(/level too low/);
  });

  it("grants the highest mod tier the item level allows (Sovereign)", () => {
    const bodyBase = findBase(data, "Body Armour");
    const high = rareWith(
      data,
      bodyBase,
      pickPoolMods(data, rareWith(data, bodyBase, []), "suffix", 1),
    );
    expect(
      action("sovereign-alloy").apply(data, high, seededRng(61)).item.explicits.map((m) => m.modId),
    ).toContain("AlloyLocalWardIncreasePercent2");
    const low = rareWith(
      data,
      bodyBase,
      pickPoolMods(data, rareWith(data, bodyBase, [], 30), "suffix", 1),
      30,
    );
    expect(
      action("sovereign-alloy").apply(data, low, seededRng(61)).item.explicits.map((m) => m.modId),
    ).toContain("AlloyLocalWardIncreasePercent1");
  });
});

describe("liquid emotions on jewels", () => {
  const ruby = findBaseByName(data, "Ruby");
  const timeLostRuby = findBaseByName(data, "Time-Lost Ruby");
  const dilutedIre = data.emotionByCurrencyId.get("diluted-liquid-ire")!;

  function rareRubyWithout(guardModIds: string[], n = 2): Item {
    const empty = rareWith(data, ruby, []);
    const guardGroups = new Set(guardModIds.flatMap((id) => data.mod(id).groups));
    return rareWith(
      data,
      ruby,
      pickPoolMods(data, empty, "suffix", n, (m) => m.groups.every((g) => !guardGroups.has(g))),
    );
  }

  it("swaps a random jewel mod for the emotion's fixed mod", () => {
    const guaranteed = dilutedIre.mods["Ruby"].Prefix!;
    const item = rareRubyWithout([guaranteed]);
    const act = action("diluted-liquid-ire");
    expect(act.canApply(data, item)).toBeNull();
    const result = act.apply(data, item, seededRng(67));
    expect(result.item.explicits).toHaveLength(2);
    expect(result.item.explicits.map((m) => m.modId)).toContain(guaranteed);
  });

  it("regular emotions reject Time-Lost jewels and vice versa", () => {
    const regular = rareRubyWithout([]);
    expect(action("ancient-diluted-liquid-ire").canApply(data, regular)).toMatch(/Time-Lost/);
    const timeLost = rareWith(data, timeLostRuby, []);
    expect(action("diluted-liquid-ire").canApply(data, timeLost)).toMatch(/Time-Lost/);
  });

  it("requires a rare jewel and rejects non-jewels", () => {
    const rng = seededRng(71);
    expect(
      action("diluted-liquid-ire").canApply(data, createItem(data, ruby, 82, rng)),
    ).toMatch(/Rare/);
    const ring = rareWith(data, findBase(data, "Ring"), []);
    expect(action("diluted-liquid-ire").canApply(data, ring)).toMatch(/Jewel/);
  });

  it("rare jewels cap at 2 prefixes / 2 suffixes", () => {
    const empty = rareWith(data, ruby, []);
    const item = rareWith(data, ruby, [
      ...pickPoolMods(data, empty, "prefix", 2),
      ...pickPoolMods(data, empty, "suffix", 2),
    ]);
    const exalt = actionFor(data, "exalted")!;
    expect(exalt.canApply(data, item)).toMatch(/open affix/);
  });
});
