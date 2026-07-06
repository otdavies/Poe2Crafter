/**
 * Base-quality currencies: Blacksmith's Whetstone (martial weapons),
 * Arcanist's Etcher (caster weapons) and Armourer's Scrap (armour) raise an
 * item's own quality — a %-increase to physical damage or defences, distinct
 * from catalyst quality (which boosts matching-tag mod values). Glassblower's
 * Bauble and Gemcutter's Prism target flasks/gems the sim doesn't craft and
 * block gracefully.
 */
import { describe, expect, it } from "vitest";
import { actionFor, type CraftAction } from "./actions.ts";
import { computedProperties } from "./defences.ts";
import type { Item } from "./item.ts";
import { catalystQualityPerUse, QUALITY_CURRENCIES } from "./mechanics.ts";
import { oddsFor } from "./odds.ts";
import { seededRng } from "./rng.ts";
import { findBase, loadEngineData, rareWith } from "./testutil.ts";

const data = loadEngineData();
const rng = seededRng(1);
const action = (id: string): CraftAction => actionFor(data, id)!;

const maceBase = findBase(data, "Two Hand Mace");
const bodyBase = findBase(data, "Body Armour");
const wandBase = findBase(data, "Wand");

const maxOut = (item: Item, id: string): Item => {
  const act = action(id);
  let current = item;
  while (act.canApply(data, current) === null) current = act.apply(data, current, rng).item;
  return current;
};

describe("base-quality currency registry", () => {
  it("resolves each quality currency to a quality action", () => {
    for (const [id] of QUALITY_CURRENCIES) {
      expect(actionFor(data, id)?.kind, id).toBe("quality");
    }
  });
});

describe("Blacksmith's Whetstone (weapon quality)", () => {
  it("accumulates untyped quality up to 20% and scales physical damage", () => {
    const mace = rareWith(data, maceBase, [], 65);
    const before = computedProperties(data, mace).properties;
    const quality = maxOut(mace, "whetstone");
    expect(quality.quality).toEqual({ percent: 20 });
    expect(quality.quality?.catalystId).toBeUndefined();
    const after = computedProperties(data, quality);
    // +20% is additive-increased physical damage: (base) × 1.20, rounded.
    expect(after.properties.physMax).toBe(Math.round(before.physMax! * 1.2));
    expect(after.properties.physMin).toBe(Math.round(before.physMin! * 1.2));
    expect(after.augmented.has("physMax")).toBe(true);
    expect(action("whetstone").canApply(data, quality)).toMatch(/maximum/);
  });

  it("adds the item-level-scaled amount per use", () => {
    const mace = rareWith(data, maceBase, [], 65);
    const once = action("whetstone").apply(data, mace, rng).item;
    expect(once.quality?.percent).toBe(catalystQualityPerUse(65));
  });

  it("is refused on armour", () => {
    expect(action("whetstone").canApply(data, rareWith(data, bodyBase, []))).toMatch(
      /Martial Weapon/,
    );
  });
});

describe("Armourer's Scrap (armour quality)", () => {
  it("scales the present defences of the piece", () => {
    const body = rareWith(data, bodyBase, [], 65);
    const before = computedProperties(data, body).properties;
    const quality = maxOut(body, "scrap");
    expect(quality.quality).toEqual({ percent: 20 });
    const after = computedProperties(data, body).properties;
    const armoured = computedProperties(data, quality).properties;
    // Defences floor after the ×1.20 increase.
    expect(armoured.armour).toBe(Math.floor(before.armour! * 1.2));
    expect(after.armour).toBe(before.armour); // pure fn: original untouched
  });

  it("is refused on a weapon", () => {
    expect(action("scrap").canApply(data, rareWith(data, maceBase, []))).toMatch(/Armour/);
  });
});

describe("Arcanist's Etcher (caster weapon quality)", () => {
  it("applies to caster weapons and tracks quality even with no datamined damage", () => {
    const wand = rareWith(data, wandBase, [], 65);
    expect(action("etcher").canApply(data, wand)).toBeNull();
    const quality = action("etcher").apply(data, wand, rng).item;
    expect(quality.quality?.percent).toBe(catalystQualityPerUse(65));
    // Wands carry no base properties in the bundle, so nothing to scale — but
    // it must not throw and quality is still recorded.
    expect(() => computedProperties(data, quality)).not.toThrow();
  });
});

describe("flask/gem quality currencies block gracefully", () => {
  it("Bauble and Gemcutter's Prism never apply to craftable items", () => {
    const targets = [rareWith(data, maceBase, []), rareWith(data, bodyBase, [])];
    for (const item of targets) {
      expect(action("bauble").canApply(data, item)).toMatch(/Flask/);
      expect(action("gcp").canApply(data, item)).toMatch(/Skill Gem/);
    }
  });
});

describe("quality odds", () => {
  it("describe the concrete target and are deterministic", () => {
    const whetstone = oddsFor(data, rareWith(data, maceBase, [], 65), "whetstone");
    if (whetstone?.kind !== "craft") throw new Error("expected craft");
    expect(whetstone.notes[0]).toMatch(/increasing physical damage/);
    expect(whetstone.notes).toContain("Deterministic — quality has no random outcome");

    const scrap = oddsFor(data, rareWith(data, bodyBase, [], 65), "scrap");
    if (scrap?.kind !== "craft") throw new Error("expected craft");
    expect(scrap.notes[0]).toMatch(/increasing defences/);
  });

  it("mirror canApply when blocked", () => {
    const odds = oddsFor(data, rareWith(data, bodyBase, []), "whetstone");
    expect(odds).toEqual({ kind: "blocked", reason: "Can only be applied to a Martial Weapon" });
  });
});
