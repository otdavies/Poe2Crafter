import { describe, expect, it } from "vitest";
import { findBase, loadEngineData, pickPoolMods, rareWith } from "../engine/testutil.ts";
import { itemHeader, rareName } from "./itemname.ts";

const data = loadEngineData();
const base = findBase(data, "Body Armour");

describe("itemHeader", () => {
  it("normal items show the base name only", () => {
    const item = { ...rareWith(data, base, []), rarity: "normal" as const };
    expect(itemHeader(data, item)).toEqual({ name: data.base(base).name });
  });

  it("magic items weave the affix names around the base name", () => {
    const empty = rareWith(data, base, []);
    const [prefixId] = pickPoolMods(data, empty, "prefix", 1);
    const [suffixId] = pickPoolMods(data, empty, "suffix", 1);
    const item = { ...rareWith(data, base, [prefixId, suffixId]), rarity: "magic" as const };
    const header = itemHeader(data, item);
    expect(header.base).toBeUndefined();
    expect(header.name).toBe(
      `${data.mod(prefixId).name} ${data.base(base).name} ${data.mod(suffixId).name}`,
    );
  });

  it("rare items get a stable two-word name above the base name", () => {
    const item = rareWith(data, base, []);
    const header = itemHeader(data, item);
    expect(header.base).toBe(data.base(base).name);
    expect(header.name.split(" ").length).toBe(2);
    // deterministic: same craft, same name
    expect(itemHeader(data, item)).toEqual(header);
  });

  it("rare names vary by seed and never crash on unknown classes", () => {
    const names = new Set(
      Array.from({ length: 40 }, (_, i) => rareName(`seed-${i}`, "Body Armour")),
    );
    expect(names.size).toBeGreaterThan(20);
    expect(rareName("x", "Not A Class").split(" ").length).toBe(2);
  });
});
