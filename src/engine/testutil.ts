/** Test helper: load the real committed data bundle into an EngineData. */
import { readFileSync } from "node:fs";
import type { BaseItem, DistilledEmotion, Essence, Mod, Rune } from "../data/schema.ts";
import { EngineData } from "./data.ts";
import type { Item } from "./item.ts";
import { rollablePool } from "./modpool.ts";

let cached: EngineData | undefined;

export function loadEngineData(): EngineData {
  if (!cached) {
    const read = <T>(file: string): T =>
      JSON.parse(readFileSync(`public/data/0.5/${file}`, "utf8")) as T;
    cached = new EngineData(
      read<Mod[]>("mods.json"),
      read<BaseItem[]>("bases.json"),
      read<Essence[]>("essences.json"),
      read<DistilledEmotion[]>("emotions.json"),
      read<Rune[]>("runes.json"),
    );
  }
  return cached;
}

export function findBase(data: EngineData, itemClass: string): string {
  for (const [id, base] of data.baseById) {
    if (base.itemClass === itemClass) return id;
  }
  throw new Error(`no base with class ${itemClass}`);
}

export function findBaseByName(data: EngineData, name: string): string {
  for (const [id, base] of data.baseById) {
    if (base.name === name) return id;
  }
  throw new Error(`no base named ${name}`);
}

/** A rare item with exactly these explicit mods (min-rolled, no implicits). */
export function rareWith(data: EngineData, baseId: string, modIds: string[], ilvl = 82): Item {
  return {
    baseId,
    ilvl,
    rarity: "rare",
    implicits: [],
    explicits: modIds.map((modId) => ({
      modId,
      values: data.mod(modId).stats.map((s) => s.min),
    })),
    corrupted: false,
  };
}

/**
 * Deterministically pick n rollable mods of one generation from the item's
 * current pool, mutually exclusive by group (optionally filtered).
 */
export function pickPoolMods(
  data: EngineData,
  item: Item,
  generation: "prefix" | "suffix",
  n: number,
  accept: (mod: Mod) => boolean = () => true,
): string[] {
  const picked: string[] = [];
  const groups = new Set<string>();
  for (const entry of rollablePool(data, item, { generation })) {
    if (!accept(entry.mod)) continue;
    if (entry.mod.groups.some((g) => groups.has(g))) continue;
    picked.push(entry.mod.id);
    for (const g of entry.mod.groups) groups.add(g);
    if (picked.length === n) return picked;
  }
  throw new Error(`could not pick ${n} ${generation} mods`);
}
