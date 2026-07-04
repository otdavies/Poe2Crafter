/**
 * Compiled bundle schema — the contract between the pipeline and the app.
 * The app imports these types; the pipeline produces JSON conforming to them.
 */

export interface BundleMeta {
  league: string;
  generatedAt: string;
  /**
   * carriedForward: this compile could not reach the source and reused the
   * previous bundle's output (hash is the one recorded by that compile).
   */
  sources: Record<string, { sha256: string; url: string; carriedForward?: boolean }>;
  counts: Record<string, number>;
}

/** Base defence/weapon numbers (from PoB's per-base stat tables). */
export interface BaseProperties {
  armour?: number;
  evasion?: number;
  energyShield?: number;
  /** Runic Ward (0.5 defence). */
  ward?: number;
  blockChance?: number;
  movementPenalty?: number;
  physMin?: number;
  physMax?: number;
  fireMin?: number;
  fireMax?: number;
  coldMin?: number;
  coldMax?: number;
  lightningMin?: number;
  lightningMax?: number;
  chaosMin?: number;
  chaosMax?: number;
  critChance?: number;
  attacksPerSecond?: number;
  range?: number;
  reloadTime?: number;
}

export interface BaseRequirements {
  level?: number;
  str?: number;
  dex?: number;
  int?: number;
}

export interface BaseItem {
  /**
   * GGG metadata id, e.g. "Metadata/Items/Amulets/FourAmulet1".
   * Jewel bases are synthesized from PoB data and use "Jewel/<name>".
   */
  id: string;
  name: string;
  itemClass: string;
  dropLevel: number;
  tags: string[];
  /** Mod ids resolved against mods.json */
  implicits: string[];
  width: number;
  height: number;
  /**
   * Canonical 2D art path ("Art/2DItems/.../Foo", no extension). PoE2's CDN
   * only serves signed URLs, so the UI can't build image links from this
   * yet — kept for a future icon resolver. Synthesized jewel bases: none.
   */
  art?: string;
  properties?: BaseProperties;
  req?: BaseRequirements;
}

export type GenerationType = "prefix" | "suffix" | "essence" | "corrupted" | "unique";

export interface ModStat {
  id: string;
  min: number;
  max: number;
}

/** Abyssal lords whose desecrated modifiers bones can reveal (0.3+). */
export type AbyssalLord = "ulaman" | "amanamu" | "kurgal";

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
  /** Desecrated-domain mod: only obtainable via abyssal bones, never rolled. */
  desecrated?: boolean;
  /** Which abyssal lord the desecrated mod belongs to (datamined tag). */
  lord?: AbyssalLord;
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

/**
 * One host-class variant of a rune's effect. Rune effects are FIXED values
 * (no rolls) — the numbers live inside the display text.
 */
export interface RuneEffect {
  /** Item classes this variant applies to when the rune is socketed. */
  itemClasses: string[];
  /** Display lines, markup stripped ("16% increased Physical Damage"). */
  text: string[];
  /** Stat ids behind the lines, in display order (for local-stat folding). */
  stats: string[];
}

/** A socketable rune (0.5 Runes of Aldur; datamined from repoe augments). */
export interface Rune {
  /** Trade currency id (joins currency.json by name), e.g. "iron-rune". */
  id: string;
  name: string;
  /**
   * Socketing limit: "self" = at most one copy of this rune per item;
   * "ancient" / "aldurs-legacy" = at most one rune of that group per item.
   */
  limit?: "self" | "ancient" | "aldurs-legacy";
  effects: RuneEffect[];
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
