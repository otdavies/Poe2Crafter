/**
 * Cross-validate our engine's mod-pool resolution against Craft of Exile's
 * PoE2 tables (independent implementation from the same game data).
 *
 * For each sampled item class: build an empty rare at ilvl 100, resolve the
 * rollable pool with OUR engine, and compare mod families + tier ilvls
 * against CoE's basemods/tiers. Requires `npm run data:fetch -- --oracle`.
 *
 * CoE data is used only here as an oracle — never shipped.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { BaseItem, Mod } from "../../src/data/schema.ts";
import { EngineData } from "../../src/engine/data.ts";
import { createItem, type Item } from "../../src/engine/item.ts";
import { rollablePool } from "../../src/engine/modpool.ts";
import { seededRng } from "../../src/engine/rng.ts";
import { CACHE_DIR, OUT_DIR } from "./sources.ts";

/** CoE base name -> how to find a representative base of ours. */
const CLASS_MAP: Record<string, { itemClass: string; tag?: string }> = {
  Amulet: { itemClass: "Amulet" },
  Ring: { itemClass: "Ring" },
  Belt: { itemClass: "Belt" },
  Quiver: { itemClass: "Quiver" },
  Focus: { itemClass: "Focus" },
  Bow: { itemClass: "Bow" },
  Crossbow: { itemClass: "Crossbow" },
  Spear: { itemClass: "Spear" },
  Flail: { itemClass: "Flail" },
  Sceptre: { itemClass: "Sceptre" },
  "Two Hand Mace": { itemClass: "Two Hand Mace" },
  "Body Armour (STR)": { itemClass: "Body Armour", tag: "str_armour" },
  "Body Armour (INT)": { itemClass: "Body Armour", tag: "int_armour" },
  "Boots (DEX)": { itemClass: "Boots", tag: "dex_armour" },
  "Gloves (INT)": { itemClass: "Gloves", tag: "int_armour" },
  "Helmet (STR)": { itemClass: "Helmet", tag: "str_armour" },
};

/** Fail the run if family-set divergence for a class exceeds this. */
const MAX_DIVERGENCE = 0.1;

const read = async <T>(dir: string, file: string): Promise<T> =>
  JSON.parse(await readFile(join(dir, file), "utf8")) as T;

const rawOracle = await readFile(join(CACHE_DIR, "coe_poec_data.json"), "utf8");
const coe = JSON.parse(rawOracle.slice(rawOracle.indexOf("=") + 1));
const data = new EngineData(
  await read<Mod[]>(OUT_DIR, "mods.json"),
  await read<BaseItem[]>(OUT_DIR, "bases.json"),
);

const coeBaseByName = new Map<string, any>(
  coe.bases.seq.map((b: any) => [b.name_base, b]),
);
const coeModById = new Map<string, any>(
  coe.modifiers.seq.map((m: any) => [m.id_modifier, m]),
);

const familyKey = (groups: string[], affix: string): string =>
  `${[...groups].sort().join("+")}|${affix}`;

// CoE's tier tables merge mechanics that live OUTSIDE the random orb pool:
// corrupted implicits, rune sockets, desecrated (Abyss) mods, essence-only
// tiers. Those are legitimate differences, not pool bugs — build a lookup of
// (group, ilvl) pairs explained by the raw dat export so we can subtract them.
const rawMods = await read<Record<string, any>>(CACHE_DIR, "mods.min.json");
const explainedTiers = new Set<string>(); // "group|gen|ilvl"
const explainedFamilies = new Set<string>(); // familyKey
for (const m of Object.values(rawMods)) {
  const outsidePool =
    m.domain === "desecrated" || m.is_essence_only || m.generation_type === "essence";
  if (!outsidePool) continue;
  const gen = m.generation_type === "essence" ? ["prefix", "suffix"] : [m.generation_type];
  for (const g of gen) {
    explainedFamilies.add(familyKey(m.groups, g));
    explainedTiers.add(`${familyKey(m.groups, g)}|${m.required_level}`);
  }
}

/** Our view: family -> sorted tier ilvls, from the engine's rollable pool. */
function ourFamilies(item: Item): Map<string, number[]> {
  const families = new Map<string, number[]>();
  for (const { mod } of rollablePool(data, item)) {
    const key = familyKey(mod.groups, mod.generation);
    families.set(key, [...(families.get(key) ?? []), mod.ilvl].sort((a, b) => a - b));
  }
  return families;
}

/** CoE view: family -> sorted tier ilvls with positive weighting. */
function coeFamilies(idBase: string): Map<string, number[]> {
  const families = new Map<string, number[]>();
  for (const modId of coe.basemods[idBase] ?? []) {
    const mod = coeModById.get(String(modId));
    if (!mod || mod.notable !== "0" || mod.vex !== "0") continue;
    // only the random orb pool: skip corrupted implicits, socket mods, etc.
    if (mod.affix !== "prefix" && mod.affix !== "suffix") continue;
    const rows = (coe.tiers[String(modId)]?.[idBase] ?? []).filter(
      (row: any) => Number(row.weighting) > 0,
    );
    if (rows.length === 0) continue;
    const groups: string[] = JSON.parse(mod.modgroups ?? "[]");
    const key = familyKey(groups, mod.affix);
    const ilvls = rows.map((row: any) => Number(row.ilvl)).sort((a: number, b: number) => a - b);
    families.set(key, [...(families.get(key) ?? []), ...ilvls].sort((a, b) => a - b));
  }
  return families;
}

let failed = false;
for (const [coeName, pick] of Object.entries(CLASS_MAP)) {
  const coeBase = coeBaseByName.get(coeName);
  if (!coeBase) {
    console.warn(`skip ${coeName}: not in CoE data`);
    continue;
  }
  const base = [...data.baseById.values()].find(
    (b) => b.itemClass === pick.itemClass && (!pick.tag || b.tags.includes(pick.tag)),
  );
  if (!base) throw new Error(`no local base for ${coeName}`);

  const item: Item = {
    ...createItem(data, base.id, 100, seededRng(1)),
    rarity: "rare",
  };
  const ours = ourFamilies(item);
  const theirs = coeFamilies(coeBase.id_base);

  const oursOnly = [...ours.keys()].filter((k) => !theirs.has(k));
  const theirsOnly = [...theirs.keys()].filter(
    (k) => !ours.has(k) && !explainedFamilies.has(k),
  );
  const common = [...ours.keys()].filter((k) => theirs.has(k));
  // CoE-extra tiers are fine if a desecrated/essence mod explains that ilvl
  const tierMismatches = common.filter((k) => {
    const ourTiers = ours.get(k) as number[];
    const coeTiers = (theirs.get(k) as number[]).filter(
      (ilvl) => ourTiers.includes(ilvl) || !explainedTiers.has(`${k}|${ilvl}`),
    );
    return JSON.stringify(ourTiers) !== JSON.stringify(coeTiers);
  });

  const divergence =
    (oursOnly.length + theirsOnly.length) / Math.max(1, ours.size + theirs.size);
  const status = divergence > MAX_DIVERGENCE ? "FAIL" : "ok";
  if (status === "FAIL") failed = true;

  console.log(
    `${status.padEnd(4)} ${coeName.padEnd(20)} ours=${ours.size} coe=${theirs.size} ` +
      `common=${common.length} ours-only=${oursOnly.length} coe-only=${theirsOnly.length} ` +
      `tier-mismatch=${tierMismatches.length}`,
  );
  for (const key of [...oursOnly.slice(0, 3)]) console.log(`       ours-only: ${key}`);
  for (const key of [...theirsOnly.slice(0, 3)]) console.log(`       coe-only:  ${key}`);
  for (const key of tierMismatches.slice(0, 2)) {
    console.log(`       tiers ${key}: ours=${JSON.stringify(ours.get(key))} coe=${JSON.stringify(theirs.get(key))}`);
  }
}

if (failed) {
  console.error("\nOracle divergence above threshold — investigate before trusting the pool.");
  process.exit(1);
}
console.log("\nOracle comparison within tolerance.");
