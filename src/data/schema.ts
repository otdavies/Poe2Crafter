/**
 * Compiled bundle schema — the contract between the pipeline and the app.
 * The app imports these types; the pipeline produces JSON conforming to them.
 */

export interface BundleMeta {
  league: string;
  generatedAt: string;
  sources: Record<string, { sha256: string; url: string }>;
  counts: Record<string, number>;
}

export interface BaseItem {
  /** GGG metadata id, e.g. "Metadata/Items/Amulets/FourAmulet1" */
  id: string;
  name: string;
  itemClass: string;
  dropLevel: number;
  tags: string[];
  /** Mod ids resolved against mods.json */
  implicits: string[];
  width: number;
  height: number;
}

export type GenerationType = "prefix" | "suffix" | "essence" | "corrupted" | "unique";

export interface ModStat {
  id: string;
  min: number;
  max: number;
}

export interface Mod {
  /** repoe mod id, e.g. "IncreasedLife3" */
  id: string;
  /** Affix name shown on the item, e.g. "Hale" / "of the Brute" */
  name: string;
  /** Pre-rendered text with value ranges, e.g. "+(10-19) to maximum Life" */
  text: string;
  generation: GenerationType;
  /** Mod family — items can never have two mods sharing a group */
  groups: string[];
  /** Minimum item level */
  ilvl: number;
  /** Ordered (tag, weight) pairs; first matching item tag wins, like the game */
  weights: [tag: string, weight: number][];
  /** Tags used by catalysts to decide what quality boosts */
  catalystTags: string[];
  /** Tags this mod adds to the item, affecting later spawn-weight checks */
  addsTags: string[];
  /** Only rollable via essences, never from the general pool */
  essenceOnly: boolean;
  stats: ModStat[];
}

export interface CurrencyItem {
  /** trade API id, e.g. "chaos" */
  id: string;
  name: string;
  /** Absolute icon URL on GGG's CDN */
  icon: string;
  /** trade static category, e.g. "Currency" | "Ritual" | "Breach" */
  category: string;
}

export interface Essence {
  /** GGG metadata id */
  id: string;
  name: string;
  /** Mod theme, e.g. "Life" */
  type: string;
  tierLevel: number;
  /** item class -> guaranteed mod id */
  mods: Record<string, string>;
  icon?: string;
}

export interface DistilledEmotion {
  id: string;
  name: string;
  tierLevel: number;
  radiusJewel: boolean;
  /** jewel base -> { Prefix?: modId, Suffix?: modId } (0.5: emotions craft jewel mods) */
  mods: Record<string, { Prefix?: string; Suffix?: string }>;
  icon?: string;
}
