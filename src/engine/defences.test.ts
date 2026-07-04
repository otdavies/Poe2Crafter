/**
 * Computed properties: local mods fold into the tooltip numbers with the
 * game's (base + flat) × (1 + increased%) formula; global mods don't.
 */
import { describe, expect, it } from "vitest";
import { computedProperties } from "./defences.ts";
import type { Item } from "./item.ts";
import { rollablePool } from "./modpool.ts";
import { findBase, loadEngineData, rareWith } from "./testutil.ts";

const data = loadEngineData();

interface Picked {
  modId: string;
  /** min roll per stat, matching rareWith */
  values: number[];
}

/** A rollable mod on the item with EXACTLY these stat ids (min-rollable). */
function exactMod(item: Item, statIds: string[]): Picked | undefined {
  for (const entry of rollablePool(data, item)) {
    const ids = entry.mod.stats.map((s) => s.id);
    if (ids.length === statIds.length && statIds.every((id, i) => ids[i] === id)) {
      return { modId: entry.mod.id, values: entry.mod.stats.map((s) => s.min) };
    }
  }
  return undefined;
}

/** First base of the class where a mod with exactly these stats can roll. */
function baseWithMod(itemClass: string, statIds: string[]): { baseId: string; mod: Picked } {
  for (const [baseId, base] of data.baseById) {
    if (base.itemClass !== itemClass) continue;
    const mod = exactMod(rareWith(data, baseId, []), statIds);
    if (mod) return { baseId, mod };
  }
  throw new Error(`no ${itemClass} base rolls a mod with exactly [${statIds.join(", ")}]`);
}

describe("computedProperties", () => {
  it("returns bare base properties for an unmodified item", () => {
    const item = rareWith(data, findBase(data, "Body Armour"), []);
    const { properties, augmented } = computedProperties(data, item);
    expect(properties).toEqual(data.base(item.baseId).properties);
    expect(augmented.size).toBe(0);
  });

  it("applies flat then %-increased armour, floored", () => {
    const { baseId, mod: inc } = baseWithMod("Body Armour", [
      "local_physical_damage_reduction_rating_+%",
    ]);
    const flat = exactMod(rareWith(data, baseId, []), [
      "local_base_physical_damage_reduction_rating",
    ]);
    expect(flat).toBeDefined();
    const item = rareWith(data, baseId, [flat!.modId, inc.modId]);

    const baseArmour = data.base(baseId).properties!.armour!;
    const { properties, augmented } = computedProperties(data, item);
    expect(properties.armour).toBe(
      Math.floor((baseArmour + flat!.values[0]) * (1 + inc.values[0] / 100)),
    );
    expect(augmented.has("armour")).toBe(true);
  });

  it("hybrid defence increases touch every listed property", () => {
    const { baseId, mod: hybrid } = baseWithMod("Body Armour", [
      "local_armour_and_energy_shield_+%",
    ]);
    const item = rareWith(data, baseId, [hybrid.modId]);

    const baseProps = data.base(baseId).properties!;
    expect(baseProps.armour ?? 0).toBeGreaterThan(0);
    expect(baseProps.energyShield ?? 0).toBeGreaterThan(0);
    const factor = 1 + hybrid.values[0] / 100;
    const { properties, augmented } = computedProperties(data, item);
    expect(properties.armour).toBe(Math.floor(baseProps.armour! * factor));
    expect(properties.energyShield).toBe(Math.floor(baseProps.energyShield! * factor));
    expect(augmented.has("armour")).toBe(true);
    expect(augmented.has("energyShield")).toBe(true);
    // evasion untouched by this hybrid
    expect(augmented.has("evasion")).toBe(false);
  });

  it("weapon: added phys, %-phys, attack speed, and 1/100-unit crit", () => {
    const baseId = findBase(data, "Bow");
    const empty = rareWith(data, baseId, []);
    const added = exactMod(empty, [
      "local_minimum_added_physical_damage",
      "local_maximum_added_physical_damage",
    ]);
    const physInc = exactMod(empty, ["local_physical_damage_+%"]);
    const speed = exactMod(empty, ["local_attack_speed_+%"]);
    const crit = exactMod(empty, ["local_critical_strike_chance"]);
    expect(added && physInc && speed && crit).toBeTruthy();
    const item = rareWith(data, baseId, [
      added!.modId, physInc!.modId, speed!.modId, crit!.modId,
    ]);

    const p = data.base(baseId).properties!;
    const factor = 1 + physInc!.values[0] / 100;
    const { properties, augmented } = computedProperties(data, item);
    expect(properties.physMin).toBe(Math.round((p.physMin! + added!.values[0]) * factor));
    expect(properties.physMax).toBe(Math.round((p.physMax! + added!.values[1]) * factor));
    expect(properties.attacksPerSecond).toBe(
      Math.round(p.attacksPerSecond! * (1 + speed!.values[0] / 100) * 100) / 100,
    );
    expect(properties.critChance).toBeCloseTo(p.critChance! + crit!.values[0] / 100, 6);
    expect(augmented.has("physMin")).toBe(true);
    expect(augmented.has("attacksPerSecond")).toBe(true);
    expect(augmented.has("critChance")).toBe(true);
    // untouched weapon fields stay put
    expect(properties.range).toBe(p.range);
  });

  it("global mods leave the item card numbers alone", () => {
    const baseId = findBase(data, "Body Armour");
    const empty = rareWith(data, baseId, []);
    const global = exactMod(empty, ["base_fire_damage_resistance_%"]);
    expect(global).toBeDefined();
    const item = rareWith(data, baseId, [global!.modId]);
    const { properties, augmented } = computedProperties(data, item);
    expect(properties).toEqual(data.base(baseId).properties);
    expect(augmented.size).toBe(0);
  });
});
