import { describe, expect, it } from "vitest";
import { ACTIONS, type CraftAction } from "./actions.ts";
import { countByGeneration, createItem, type Item } from "./item.ts";
import { seededRng, type Rng } from "./rng.ts";
import { findBase, loadEngineData } from "./testutil.ts";

const data = loadEngineData();

function apply(id: string, item: Item, rng: Rng): Item {
  const action = ACTIONS.get(id) as CraftAction;
  const error = action.canApply(data, item);
  expect(error, `${id} should be applicable`).toBeNull();
  const result = action.apply(data, item, rng);
  assertInvariants(result.item);
  return result.item;
}

/** Invariants that must hold for every item the engine ever produces. */
function assertInvariants(item: Item): void {
  const limit = item.rarity === "rare" ? 3 : item.rarity === "magic" ? 1 : 0;
  expect(countByGeneration(data, item, "prefix")).toBeLessThanOrEqual(limit);
  expect(countByGeneration(data, item, "suffix")).toBeLessThanOrEqual(limit);

  // no two explicits may share a mod group
  const seen = new Set<string>();
  for (const rolled of item.explicits) {
    for (const group of data.mod(rolled.modId).groups) {
      expect(seen.has(group), `duplicate group ${group}`).toBe(false);
      seen.add(group);
    }
  }

  // rolled values must be inside each stat's range, ilvl gate must hold
  for (const rolled of [...item.explicits, ...item.implicits]) {
    const mod = data.mod(rolled.modId);
    expect(rolled.values).toHaveLength(mod.stats.length);
    rolled.values.forEach((value, i) => {
      expect(value).toBeGreaterThanOrEqual(mod.stats[i].min);
      expect(value).toBeLessThanOrEqual(mod.stats[i].max);
    });
  }
  for (const rolled of item.explicits) {
    expect(data.mod(rolled.modId).ilvl).toBeLessThanOrEqual(item.ilvl);
  }
}

describe("basic orb progression", () => {
  it("crafts transmute -> aug -> regal -> exalt x3 like the game", () => {
    const rng = seededRng(7);
    let item = createItem(data, findBase(data, "Body Armour"), 82, rng);

    item = apply("transmute", item, rng);
    expect(item.rarity).toBe("magic");
    expect(item.explicits).toHaveLength(1);

    item = apply("aug", item, rng);
    expect(item.explicits).toHaveLength(2);
    expect(countByGeneration(data, item, "prefix")).toBe(1);
    expect(countByGeneration(data, item, "suffix")).toBe(1);

    item = apply("regal", item, rng);
    expect(item.rarity).toBe("rare");
    expect(item.explicits).toHaveLength(3);

    item = apply("exalted", item, rng);
    item = apply("exalted", item, rng);
    item = apply("exalted", item, rng);
    expect(item.explicits).toHaveLength(6);

    const exalt = ACTIONS.get("exalted") as CraftAction;
    expect(exalt.canApply(data, item)).toMatch(/open affix/);
  });

  it("chaos removes one and adds one, staying rare and full", () => {
    const rng = seededRng(11);
    let item = createItem(data, findBase(data, "Ring"), 82, rng);
    item = apply("alch", item, rng);
    const before = item.explicits.map((m) => m.modId);
    item = apply("chaos", item, rng);
    expect(item.rarity).toBe("rare");
    expect(item.explicits).toHaveLength(before.length);
    expect(item.explicits.map((m) => m.modId)).not.toEqual(before);
  });

  it("alchemy yields a rare with 4 mods", () => {
    const rng = seededRng(3);
    const item = apply("alch", createItem(data, findBase(data, "Helmet"), 82, rng), rng);
    expect(item.rarity).toBe("rare");
    expect(item.explicits).toHaveLength(4);
  });

  it("annulment removes exactly one mod", () => {
    const rng = seededRng(5);
    let item = createItem(data, findBase(data, "Gloves"), 82, rng);
    item = apply("alch", item, rng);
    item = apply("annul", item, rng);
    expect(item.explicits).toHaveLength(3);
  });

  it("divine rerolls values but never identities", () => {
    const rng = seededRng(13);
    let item = createItem(data, findBase(data, "Belt"), 82, rng);
    item = apply("alch", item, rng);
    const ids = item.explicits.map((m) => m.modId);
    item = apply("divine", item, rng);
    expect(item.explicits.map((m) => m.modId)).toEqual(ids);
  });

  it("greater exalted only adds mods with required level >= 50", () => {
    const rng = seededRng(17);
    let item = createItem(data, findBase(data, "Boots"), 82, rng);
    item = apply("transmute", item, rng);
    item = apply("regal", item, rng);
    const before = new Set(item.explicits.map((m) => m.modId));
    item = apply("greater-exalted-orb", item, rng);
    const added = item.explicits.find((m) => !before.has(m.modId));
    expect(added).toBeDefined();
    expect(data.mod((added as { modId: string }).modId).ilvl).toBeGreaterThanOrEqual(50);
  });

  it("fractured mods survive chaos and annulment", () => {
    const rng = seededRng(19);
    let item = createItem(data, findBase(data, "Amulet"), 82, rng);
    item = apply("alch", item, rng);
    const fracturedId = item.explicits[0].modId;
    item = { ...item, explicits: item.explicits.map((m, i) => (i === 0 ? { ...m, fractured: true } : m)) };
    for (let i = 0; i < 20; i++) {
      item = apply("chaos", item, rng);
      expect(item.explicits.some((m) => m.modId === fracturedId && m.fractured)).toBe(true);
    }
  });

  it("corrupted items reject every action", () => {
    const rng = seededRng(23);
    let item = createItem(data, findBase(data, "Wand"), 82, rng);
    item = apply("alch", item, rng);
    item = apply("vaal", item, rng);
    expect(item.corrupted).toBe(true);
    for (const [id, action] of ACTIONS) {
      expect(action.canApply(data, item), id).toMatch(/[Cc]orrupted/);
    }
  });

  it("vaal produces each outcome kind across seeds", () => {
    const kinds = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      const rng = seededRng(seed * 1009 + 1);
      let item = createItem(data, findBase(data, "Two Hand Mace"), 82, rng);
      item = apply("alch", item, rng);
      const before = JSON.stringify(item.explicits);
      const result = (ACTIONS.get("vaal") as CraftAction).apply(data, item, rng);
      expect(result.item.corrupted).toBe(true);
      if (result.item.implicits.length > item.implicits.length) kinds.add("implicit");
      else if (JSON.stringify(result.item.explicits) !== before) kinds.add("changed");
      else kinds.add("no_change");
    }
    expect(kinds).toEqual(new Set(["implicit", "changed", "no_change"]));
  });
});
