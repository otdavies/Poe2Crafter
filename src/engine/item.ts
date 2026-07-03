/**
 * The item being crafted. Plain immutable data — actions return new items.
 */
import type { Mod } from "../data/schema.ts";
import type { EngineData } from "./data.ts";
import { rollInt, type Rng } from "./rng.ts";

export type Rarity = "normal" | "magic" | "rare";

export interface RolledMod {
  modId: string;
  /** One rolled value per stat on the mod, in stat order. */
  values: number[];
  fractured?: boolean;
}

export interface Item {
  baseId: string;
  ilvl: number;
  rarity: Rarity;
  implicits: RolledMod[];
  explicits: RolledMod[];
  corrupted: boolean;
}

export function createItem(data: EngineData, baseId: string, ilvl: number, rng: Rng): Item {
  const base = data.base(baseId);
  return {
    baseId,
    ilvl,
    rarity: "normal",
    implicits: base.implicits.map((modId) => rollMod(data.mod(modId), rng)),
    explicits: [],
    corrupted: false,
  };
}

export function rollMod(mod: Mod, rng: Rng): RolledMod {
  return { modId: mod.id, values: mod.stats.map((s) => rollInt(rng, s.min, s.max)) };
}

/** Max explicit mods of one generation type (prefix or suffix). */
export function affixLimit(rarity: Rarity): number {
  return rarity === "rare" ? 3 : rarity === "magic" ? 1 : 0;
}

export function countByGeneration(
  data: EngineData,
  item: Item,
  generation: "prefix" | "suffix",
): number {
  return item.explicits.filter((m) => data.mod(m.modId).generation === generation).length;
}

export function openAffixSlots(data: EngineData, item: Item): {
  prefix: number;
  suffix: number;
} {
  const limit = affixLimit(item.rarity);
  return {
    prefix: limit - countByGeneration(data, item, "prefix"),
    suffix: limit - countByGeneration(data, item, "suffix"),
  };
}

/** All spawn-weight tags currently on the item: base tags + tags added by mods. */
export function itemTags(data: EngineData, item: Item): Set<string> {
  const tags = new Set(data.base(item.baseId).tags);
  for (const rolled of item.explicits) {
    for (const tag of data.mod(rolled.modId).addsTags) tags.add(tag);
  }
  return tags;
}

/** Mod groups already occupied on the item (explicits only). */
export function takenGroups(data: EngineData, item: Item): Set<string> {
  const groups = new Set<string>();
  for (const rolled of item.explicits) {
    for (const group of data.mod(rolled.modId).groups) groups.add(group);
  }
  return groups;
}
