/**
 * The item being crafted. Plain immutable data — actions return new items.
 */
import type { Mod } from "../data/schema.ts";
import type { EngineData } from "./data.ts";
import { AFFIX_LIMIT, CATALYSTS, MAX_QUALITY, MAX_QUALITY_STAT } from "./mechanics.ts";
import { rollInt, type Rng } from "./rng.ts";

export type Rarity = "normal" | "magic" | "rare";

export interface RolledMod {
  modId: string;
  /** One rolled value per stat on the mod, in stat order. */
  values: number[];
  fractured?: boolean;
}

/** Catalyst quality on jewellery/jewels. */
export interface ItemQuality {
  /** Trade id of the applied catalyst, e.g. "flesh-catalyst". */
  catalystId: string;
  percent: number;
}

export interface Item {
  baseId: string;
  ilvl: number;
  rarity: Rarity;
  implicits: RolledMod[];
  explicits: RolledMod[];
  corrupted: boolean;
  /** Omen of Sanctification: values locked in, item can never change again. */
  sanctified?: boolean;
  quality?: ItemQuality;
  /**
   * Rune sockets (0.5): one entry per socket, null = empty, otherwise the
   * socketed rune's currency id. Absent = no sockets yet.
   */
  sockets?: (string | null)[];
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

export function isJewel(data: EngineData, item: Item): boolean {
  return data.base(item.baseId).itemClass === "Jewel";
}

/** Max explicit mods of one generation type (prefix or suffix). */
export function affixLimit(data: EngineData, item: Item, rarity: Rarity = item.rarity): number {
  return AFFIX_LIMIT[isJewel(data, item) ? "jewel" : "equipment"][rarity];
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
  const limit = affixLimit(data, item);
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

/** The catalyst tag boosted by the item's current quality, if any. */
export function qualityTag(item: Item): string | undefined {
  return item.quality ? CATALYSTS.get(item.quality.catalystId)?.tag : undefined;
}

/** Max catalyst quality: 20, raised by "+X% to Maximum Quality" mods. */
export function maxQuality(data: EngineData, item: Item): number {
  let max = MAX_QUALITY;
  for (const rolled of [...item.implicits, ...item.explicits]) {
    const mod = data.mod(rolled.modId);
    mod.stats.forEach((stat, i) => {
      if (stat.id === MAX_QUALITY_STAT) max += rolled.values[i] ?? 0;
    });
  }
  return max;
}

/**
 * A rolled mod's values with catalyst quality applied: values of mods whose
 * catalystTags match the item's quality type are multiplied by (1 + q%),
 * rounded to nearest. Stored values stay raw — quality is a live multiplier.
 */
export function effectiveValues(data: EngineData, item: Item, rolled: RolledMod): number[] {
  const tag = qualityTag(item);
  if (!tag || !item.quality || !data.mod(rolled.modId).catalystTags.includes(tag)) {
    return rolled.values;
  }
  const factor = 1 + item.quality.percent / 100;
  return rolled.values.map((v) => Math.round(v * factor));
}
