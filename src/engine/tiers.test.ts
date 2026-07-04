/**
 * Tier numbering golden tests: PoE2 tiers count up (Tier 1 = weakest), the
 * ladder covers every same-family mod spawnable on the base regardless of
 * item level, and essence-granted mods slot into the same ladder.
 */
import { describe, expect, it } from "vitest";
import type { Mod } from "../data/schema.ts";
import { itemTags } from "./item.ts";
import { spawnWeight } from "./modpool.ts";
import { modTier } from "./tiers.ts";
import { findBase, loadEngineData, rareWith } from "./testutil.ts";

const data = loadEngineData();
const base = findBase(data, "Body Armour");
const item = rareWith(data, base, []);

const groupsKey = (mod: Mod): string => [...mod.groups].sort().join(",");

/** Largest prefix family spawnable on the base — a real multi-tier ladder. */
function largestFamily(): Mod[] {
  const tags = itemTags(data, item);
  const families = new Map<string, Mod[]>();
  for (const mod of data.affixPool) {
    if (mod.generation !== "prefix" || spawnWeight(mod, tags) <= 0) continue;
    const key = groupsKey(mod);
    families.set(key, [...(families.get(key) ?? []), mod]);
  }
  return [...families.values()].reduce((a, b) => (b.length > a.length ? b : a));
}

describe("modTier", () => {
  it("numbers a family 1..count, counting up from the lowest ilvl", () => {
    const family = largestFamily();
    expect(family.length).toBeGreaterThan(3);
    const tiers = family.map((mod) => modTier(data, item, mod.id)!);
    for (const t of tiers) expect(t.count).toBe(family.length);
    expect(new Set(tiers.map((t) => t.tier)).size).toBe(family.length);

    const byTier = [...family].sort(
      (a, b) => modTier(data, item, a.id)!.tier - modTier(data, item, b.id)!.tier,
    );
    for (let i = 1; i < byTier.length; i++) {
      expect(byTier[i].ilvl).toBeGreaterThanOrEqual(byTier[i - 1].ilvl);
    }
    const minIlvl = Math.min(...family.map((m) => m.ilvl));
    const tierOne = byTier[0];
    expect(tierOne.ilvl).toBe(minIlvl);
    expect(modTier(data, item, tierOne.id)!.tier).toBe(1);
  });

  it("tiers ignore the item's current ilvl (higher tiers still count)", () => {
    const family = largestFamily();
    const top = [...family].sort((a, b) => b.ilvl - a.ilvl)[0];
    const lowItem = { ...item, ilvl: 1 };
    expect(modTier(data, lowItem, top.id)).toEqual(modTier(data, item, top.id));
  });

  it("essence-only mods are inserted into the base's ladder", () => {
    // Corrupted essences grant mods outside the general pool.
    let found: { itemClass: string; modId: string } | undefined;
    for (const essence of data.essenceByCurrencyId.values()) {
      for (const [itemClass, modId] of Object.entries(essence.mods)) {
        if (data.mod(modId).essenceOnly) found = { itemClass, modId };
        if (found) break;
      }
      if (found) break;
    }
    expect(found).toBeDefined();
    const essenceItem = rareWith(data, findBase(data, found!.itemClass), []);
    const result = modTier(data, essenceItem, found!.modId);
    expect(result).toBeDefined();
    expect(result!.tier).toBeGreaterThanOrEqual(1);
    expect(result!.tier).toBeLessThanOrEqual(result!.count);
  });

  it("implicit and corrupted mods have no tier", () => {
    const implicitId = data.base(base).implicits[0] ?? data.corruptedPool[0].id;
    if (data.base(base).implicits.length > 0) {
      expect(modTier(data, item, implicitId)).toBeUndefined();
    }
    expect(modTier(data, item, data.corruptedPool[0].id)).toBeUndefined();
  });
});
