/**
 * Mod-pool resolution: which mods can roll on this item right now, and with
 * what weight. This is the correctness heart of the simulator — the same
 * code drives crafting actions and the odds panel, so displayed
 * probabilities can never drift from actual behaviour.
 */
import type { Mod } from "../data/schema.ts";
import type { EngineData } from "./data.ts";
import { itemTags, openAffixSlots, takenGroups, type Item } from "./item.ts";
import { pickWeighted, type Rng } from "./rng.ts";

export interface PoolEntry {
  mod: Mod;
  weight: number;
}

export interface PoolFilter {
  /** Restrict to one generation type (e.g. augment fills the open slot). */
  generation?: "prefix" | "suffix";
  /** Greater/Perfect variants: only mods with required level >= this. */
  minModLevel?: number;
}

/**
 * Spawn weight of a mod for a given tag set: the FIRST entry in the mod's
 * ordered weight list whose tag the item has wins (game behaviour — the
 * list always ends with a catch-all "default").
 */
export function spawnWeight(mod: Mod, tags: ReadonlySet<string>): number {
  for (const [tag, weight] of mod.weights) {
    if (tags.has(tag)) return weight;
  }
  return 0;
}

/** All mods that can currently roll on the item, with their weights. */
export function rollablePool(data: EngineData, item: Item, filter: PoolFilter = {}): PoolEntry[] {
  const tags = itemTags(data, item);
  const groups = takenGroups(data, item);
  const open = openAffixSlots(data, item);

  const entries: PoolEntry[] = [];
  for (const mod of data.affixPool) {
    if (filter.generation && mod.generation !== filter.generation) continue;
    if (mod.generation === "prefix" ? open.prefix <= 0 : open.suffix <= 0) continue;
    if (mod.ilvl > item.ilvl) continue;
    if (filter.minModLevel !== undefined && mod.ilvl < filter.minModLevel) continue;
    if (mod.groups.some((g) => groups.has(g))) continue;
    const weight = spawnWeight(mod, tags);
    if (weight <= 0) continue;
    entries.push({ mod, weight });
  }
  return entries;
}

/** Weighted pick from a pool. Throws if the pool is empty. */
export function pickFromPool(rng: Rng, pool: PoolEntry[]): Mod {
  if (pool.length === 0) throw new Error("mod pool is empty");
  return pool[pickWeighted(rng, pool.map((e) => e.weight))].mod;
}

/** Catalyst tags of the item's current explicit mods (for homogenising). */
export function explicitCatalystTags(data: EngineData, item: Item): Set<string> {
  const tags = new Set<string>();
  for (const rolled of item.explicits) {
    for (const tag of data.mod(rolled.modId).catalystTags) tags.add(tag);
  }
  return tags;
}

/**
 * Omen of Homogenising Exaltation/Coronation: restrict the pool to mods
 * sharing a type (catalyst tag) with an existing explicit modifier.
 */
export function homogenisedPool(pool: PoolEntry[], tags: ReadonlySet<string>): PoolEntry[] {
  return pool.filter((e) => e.mod.catalystTags.some((t) => tags.has(t)));
}

/**
 * Omen of Catalysing Exaltation: quality is consumed to boost the chance of
 * matching-type mods. APPROXIMATION (see mechanics.ts OMEN docs): weights of
 * matching mods are multiplied by (1 + quality%).
 */
export function catalysedPool(pool: PoolEntry[], tag: string, percent: number): PoolEntry[] {
  const factor = 1 + percent / 100;
  return pool.map((e) =>
    e.mod.catalystTags.includes(tag) ? { ...e, weight: e.weight * factor } : e,
  );
}
