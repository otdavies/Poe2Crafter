/** Catalyst quality on jewellery and (Refined) jewels. */
import { describe, expect, it } from "vitest";
import { actionFor, type CraftAction } from "./actions.ts";
import { effectiveValues, maxQuality, type Item } from "./item.ts";
import { CATALYSTS, catalystQualityPerUse } from "./mechanics.ts";
import { seededRng } from "./rng.ts";
import {
  findBase,
  findBaseByName,
  loadEngineData,
  pickPoolMods,
  rareWith,
} from "./testutil.ts";

const data = loadEngineData();
const rng = seededRng(1);
const action = (id: string): CraftAction => actionFor(data, id)!;

const ringBase = findBase(data, "Ring");

describe("catalyst tables", () => {
  it("every catalyst tag exists in the bundle's catalystTags vocabulary", () => {
    const vocabulary = new Set<string>();
    for (const mod of data.modById.values()) {
      for (const tag of mod.catalystTags) vocabulary.add(tag);
    }
    for (const [id, spec] of CATALYSTS) {
      expect(vocabulary.has(spec.tag), `${id} -> ${spec.tag}`).toBe(true);
    }
  });

  it("quality per use falls with item level, within 2..20", () => {
    expect(catalystQualityPerUse(1)).toBeGreaterThan(catalystQualityPerUse(50));
    expect(catalystQualityPerUse(50)).toBeGreaterThan(catalystQualityPerUse(82));
    for (const ilvl of [1, 40, 60, 82, 100]) {
      const q = catalystQualityPerUse(ilvl);
      expect(q).toBeGreaterThanOrEqual(2);
      expect(q).toBeLessThanOrEqual(20);
    }
  });
});

describe("applying catalysts", () => {
  it("accumulates quality up to 20% on a ring", () => {
    let item = rareWith(data, ringBase, []);
    const act = action("flesh-catalyst");
    while (act.canApply(data, item) === null) {
      item = act.apply(data, item, rng).item;
    }
    expect(item.quality).toEqual({ catalystId: "flesh-catalyst", percent: 20 });
    expect(act.canApply(data, item)).toMatch(/maximum/);
  });

  it("a different catalyst type replaces quality from zero", () => {
    let item: Item = {
      ...rareWith(data, ringBase, []),
      quality: { catalystId: "flesh-catalyst", percent: 20 },
    };
    item = action("neural-catalyst").apply(data, item, rng).item;
    expect(item.quality).toEqual({
      catalystId: "neural-catalyst",
      percent: catalystQualityPerUse(item.ilvl),
    });
  });

  it("regular catalysts fit jewellery only; Refined fit jewels only", () => {
    const boots = rareWith(data, findBase(data, "Boots"), []);
    expect(action("flesh-catalyst").canApply(data, boots)).toMatch(/Ring, Amulet/);
    const ring = rareWith(data, ringBase, []);
    expect(action("refined-flesh-catalyst").canApply(data, ring)).toMatch(/Jewel/);
    const ruby = rareWith(data, findBaseByName(data, "Ruby"), []);
    expect(action("refined-flesh-catalyst").canApply(data, ruby)).toBeNull();
    expect(action("flesh-catalyst").canApply(data, ruby)).toMatch(/Ring, Amulet/);
  });

  it("quality multiplies matching-tag mod values only (display layer)", () => {
    const empty = rareWith(data, ringBase, []);
    const [lifeMod] = pickPoolMods(
      data,
      empty,
      "prefix",
      1,
      (m) => m.catalystTags.includes("life") && m.stats.length > 0,
    );
    const [untagged] = pickPoolMods(data, empty, "suffix", 1, (m) => !m.catalystTags.includes("life"));
    const item: Item = {
      ...rareWith(data, ringBase, [lifeMod, untagged]),
      quality: { catalystId: "flesh-catalyst", percent: 20 },
    };
    const [life, other] = item.explicits;
    expect(effectiveValues(data, item, life)).toEqual(life.values.map((v) => Math.round(v * 1.2)));
    expect(effectiveValues(data, item, other)).toEqual(other.values);
    // raw values stay untouched
    expect(item.explicits[0].values).toEqual(life.values);
  });

  it("Essence of the Breach's mod raises the quality cap", () => {
    const breach = data.essenceByCurrencyId.get("essence-of-the-breach")!;
    const item = rareWith(data, ringBase, [breach.mods["Ring"]]);
    expect(maxQuality(data, item)).toBe(40);
    let quality = item;
    const act = action("flesh-catalyst");
    while (act.canApply(data, quality) === null) {
      quality = act.apply(data, quality, rng).item;
    }
    expect(quality.quality?.percent).toBe(40);
  });
});
