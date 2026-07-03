/**
 * Upstream data sources for the pipeline.
 *
 * Pinning strategy: fetch.ts always pulls the latest from each source; the
 * *compiled bundle* committed under public/data/<league>/ is the pin. meta.json
 * records a sha256 + retrieval date per source so any bundle is traceable.
 */

export const LEAGUE = "0.5";
export const CACHE_DIR = ".pipeline-cache";
export const OUT_DIR = `public/data/${LEAGUE}`;

/** GGG requires a descriptive User-Agent on API requests. */
export const USER_AGENT =
  "PoeSolver-data-pipeline/0.1 (github.com/oliverdavies/PoeSolver; oliver@psyfer.io)";

/** Icon paths from the trade API are relative to this CDN host. */
export const POE_CDN = "https://web.poecdn.com";

const REPOE = "https://repoe-fork.github.io/poe2";
const POB =
  "https://raw.githubusercontent.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/dev/src/Data";
const TRADE2 = "https://www.pathofexile.com/api/trade2/data";

/** PoB `src/Data/Bases/<name>.lua` files covering our supported classes. */
export const POB_BASE_FILES = [
  "amulet", "axe", "belt", "body", "boots", "bow", "claw", "crossbow",
  "dagger", "flail", "focus", "gloves", "helmet", "jewel", "mace", "quiver",
  "ring", "sceptre", "shield", "spear", "staff", "sword", "talisman", "wand",
] as const;

export interface Source {
  /** Cache filename, also the key used in meta.json provenance. */
  file: string;
  url: string;
  /** Send the GGG User-Agent (required for pathofexile.com endpoints). */
  ggg?: boolean;
}

export const SOURCES: Source[] = [
  // repoe-fork: dat-file exports (mod pool with spawn weights, bases, tags)
  { file: "mods.min.json", url: `${REPOE}/mods.min.json` },
  { file: "base_items.min.json", url: `${REPOE}/base_items.min.json` },
  { file: "item_classes.min.json", url: `${REPOE}/item_classes.min.json` },
  { file: "tags.min.json", url: `${REPOE}/tags.min.json` },

  // Path of Building PoE2 fork: mappings the dat export lacks
  { file: "Essence.lua", url: `${POB}/Essence.lua` },
  { file: "LiquidEmotions.lua", url: `${POB}/LiquidEmotions.lua` },

  // PoB base-item stat tables: defence/weapon numbers per base (+ the jewel
  // bases, which the repoe export's item filter doesn't cover)
  ...POB_BASE_FILES.map((name) => ({
    file: `Bases/${name}.lua`,
    url: `${POB}/Bases/${name}.lua`,
  })),

  // Official trade API: canonical ids, display names, icon URLs
  { file: "trade2_static.json", url: `${TRADE2}/static`, ggg: true },
  { file: "trade2_stats.json", url: `${TRADE2}/stats`, ggg: true },
  { file: "trade2_items.json", url: `${TRADE2}/items`, ggg: true },
];

/**
 * Craft of Exile's PoE2 data blob. Validation oracle ONLY — unlicensed,
 * reverse-engineered format. Never compiled into the shipped bundle.
 */
export const COE_ORACLE: Source = {
  file: "coe_poec_data.json",
  url: "https://www.craftofexile.com/json/poe2/main/poec_data.json",
};
