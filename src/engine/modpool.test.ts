import { describe, expect, it } from "vitest";
import { createItem, itemTags, takenGroups } from "./item.ts";
import { rollablePool, spawnWeight } from "./modpool.ts";
import { seededRng } from "./rng.ts";
import { findBase, loadEngineData } from "./testutil.ts";

const data = loadEngineData();
const rng = seededRng(42);

describe("spawnWeight", () => {
  it("uses the first matching tag in order", () => {
    const mod = {
      weights: [
        ["amulet", 0],
        ["default", 100],
      ],
    };
    expect(spawnWeight(mod as never, new Set(["amulet", "default"]))).toBe(0);
    expect(spawnWeight(mod as never, new Set(["default"]))).toBe(100);
  });

  it("returns 0 when no tag matches", () => {
    const mod = { weights: [["ring", 5]] };
    expect(spawnWeight(mod as never, new Set(["amulet"]))).toBe(0);
  });
});

describe("rollablePool", () => {
  const amulet = findBase(data, "Amulet");

  it("is empty for a normal item (no affix slots)", () => {
    const item = createItem(data, amulet, 82, rng);
    expect(rollablePool(data, item)).toHaveLength(0);
  });

  it("respects item level gating", () => {
    const item = { ...createItem(data, amulet, 5, rng), rarity: "rare" as const };
    for (const entry of rollablePool(data, item)) {
      expect(entry.mod.ilvl).toBeLessThanOrEqual(5);
    }
    const highPool = rollablePool(data, { ...item, ilvl: 82 });
    expect(highPool.length).toBeGreaterThan(rollablePool(data, item).length);
  });

  it("excludes essence-only mods and zero-weight mods", () => {
    const item = { ...createItem(data, amulet, 82, rng), rarity: "rare" as const };
    for (const entry of rollablePool(data, item)) {
      expect(entry.mod.essenceOnly).toBe(false);
      expect(entry.weight).toBeGreaterThan(0);
    }
  });

  it("excludes groups already on the item", () => {
    const item = { ...createItem(data, amulet, 82, rng), rarity: "rare" as const };
    const [first] = rollablePool(data, item);
    const withMod = {
      ...item,
      explicits: [{ modId: first.mod.id, values: [] }],
    };
    const groups = takenGroups(data, withMod);
    for (const entry of rollablePool(data, withMod)) {
      expect(entry.mod.groups.some((g) => groups.has(g))).toBe(false);
    }
  });

  it("respects minModLevel (Greater/Perfect variants)", () => {
    const item = { ...createItem(data, amulet, 82, rng), rarity: "rare" as const };
    for (const entry of rollablePool(data, item, { minModLevel: 70 })) {
      expect(entry.mod.ilvl).toBeGreaterThanOrEqual(70);
    }
  });

  it("only offers mods whose weight tag matches the item's tags", () => {
    const item = { ...createItem(data, amulet, 82, rng), rarity: "rare" as const };
    const tags = itemTags(data, item);
    for (const entry of rollablePool(data, item)) {
      expect(spawnWeight(entry.mod, tags)).toBe(entry.weight);
    }
  });
});
