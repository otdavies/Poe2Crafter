/**
 * Mod tier numbering for advanced mod descriptions (hold Alt in game).
 *
 * As of 0.5, Tier 1 is the STRONGEST roll of a family (PoE1-style, verified
 * in game by the project owner July 2026; guides agree — game8.co/605507,
 * mmojugg "Understanding item tiers in PoE2": "Tier 1 usually represents
 * the strongest value range"). Early-access builds counted the other way
 * (T1 weakest); if GGG flips it again this module is the only place to fix.
 *
 * A mod's family ladder is every mod sharing its generation and group set
 * that can spawn on the item's BASE (spawn weight > 0 for the base's tags,
 * no ilvl gate — tiers the item can't roll yet still count), ordered
 * strongest-first by required ilvl, then value magnitude. Mods granted from
 * outside the general pool (essence-only, alloys) are inserted into that
 * same ladder by the same ordering — the closest match to the in-game
 * display computable from datamined weights.
 */
import type { Mod } from "../data/schema.ts";
import type { EngineData } from "./data.ts";
import type { Item } from "./item.ts";
import { spawnWeight } from "./modpool.ts";

const groupsKey = (mod: Mod): string => [...mod.groups].sort().join(",");

/** Weaker-first tiebreak within an ilvl: total value magnitude. */
const strength = (mod: Mod): number =>
  mod.stats.reduce((sum, s) => sum + Math.abs(s.min) + Math.abs(s.max), 0);

const ladderOrder = (a: Mod, b: Mod): number =>
  a.ilvl - b.ilvl || strength(a) - strength(b) || a.id.localeCompare(b.id);

/**
 * Tier of a rolled explicit within its family on this item's base.
 * Undefined for mods without tiers (implicits, corrupted, unique).
 */
export function modTier(
  data: EngineData,
  item: Item,
  modId: string,
): { tier: number; count: number } | undefined {
  const target = data.mod(modId);
  if (target.generation !== "prefix" && target.generation !== "suffix") return undefined;
  const tags = new Set(data.base(item.baseId).tags);
  const key = groupsKey(target);
  const family = data.affixPool.filter(
    (mod) =>
      mod.generation === target.generation &&
      groupsKey(mod) === key &&
      spawnWeight(mod, tags) > 0,
  );
  if (!family.some((mod) => mod.id === target.id)) family.push(target);
  family.sort(ladderOrder);
  // Ladder is sorted weakest-first; T1 is the top of it.
  const index = family.findIndex((mod) => mod.id === target.id);
  return { tier: family.length - index, count: family.length };
}
