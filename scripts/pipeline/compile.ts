/**
 * Compile cached upstream data into the compact bundle the app ships with.
 *
 * Reads .pipeline-cache/, writes public/data/<league>/. The committed output
 * is the league pin — the site build never touches upstream sources.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseLuaData } from "./lua.ts";
import { CACHE_DIR, LEAGUE, OUT_DIR, POE_CDN, SOURCES } from "./sources.ts";
import type {
  BaseItem,
  BundleMeta,
  CurrencyItem,
  DistilledEmotion,
  Essence,
  Mod,
} from "../../src/data/schema.ts";

/** Equipment classes the simulator supports (v1: all equipment). */
const EQUIPMENT_CLASSES = new Set([
  "Amulet", "Belt", "Ring", "Talisman",
  "Body Armour", "Boots", "Gloves", "Helmet",
  "Buckler", "Focus", "Shield", "Quiver",
  "Bow", "Claw", "Crossbow", "Dagger", "Flail", "Sceptre", "Spear", "Staff",
  "Wand", "Warstaff",
  "One Hand Axe", "One Hand Mace", "One Hand Sword",
  "Two Hand Axe", "Two Hand Mace", "Two Hand Sword",
]);

/** trade2 static categories that hold crafting materials we care about. */
const CURRENCY_CATEGORIES = [
  "Currency", "Essences", "Ritual", "Breach", "Delirium", "Verisium", "Runes",
];

/** Strip GGG's `[Armour]` / `[EnergyShield|Energy Shield]` link markup. */
function stripMarkup(text: string): string {
  return text
    .replace(/\[([^\]|]+)\|([^\]]+)\]/g, "$2")
    .replace(/\[([^\]]+)\]/g, "$1");
}

async function loadCache(file: string): Promise<Buffer> {
  return readFile(join(CACHE_DIR, file));
}

async function loadJson<T = any>(file: string): Promise<T> {
  return JSON.parse((await loadCache(file)).toString("utf8")) as T;
}

async function loadLua<T = any>(file: string): Promise<T> {
  return parseLuaData((await loadCache(file)).toString("utf8")) as T;
}

const [rawMods, rawBases, rawTags, tradeStatic, essenceLua, emotionsLua] =
  await Promise.all([
    loadJson<Record<string, any>>("mods.min.json"),
    loadJson<Record<string, any>>("base_items.min.json"),
    loadJson<string[]>("tags.min.json"),
    loadJson<any>("trade2_static.json"),
    loadLua<Record<string, any>>("Essence.lua"),
    loadLua<Record<string, any>>("LiquidEmotions.lua"),
  ]);

// --- Bases -----------------------------------------------------------------
const bases: BaseItem[] = Object.entries(rawBases)
  .filter(
    ([, b]) =>
      b.domain === "item" &&
      b.release_state === "released" &&
      EQUIPMENT_CLASSES.has(b.item_class),
  )
  .map(([id, b]) => ({
    id,
    name: b.name,
    itemClass: b.item_class,
    dropLevel: b.drop_level,
    tags: b.tags,
    implicits: b.implicits,
    width: b.inventory_width,
    height: b.inventory_height,
  }))
  .sort((a, b) => a.itemClass.localeCompare(b.itemClass) || a.dropLevel - b.dropLevel);

// --- Mods ------------------------------------------------------------------
// The craftable pool: item-domain prefixes/suffixes (incl. essence-only ones,
// flagged) — plus, below, every mod referenced by bases/essences/emotions
// (implicits and essence display mods have generation_type "unique").
const wanted = new Set<string>();
for (const [id, m] of Object.entries(rawMods)) {
  if (m.domain === "item" && (m.generation_type === "prefix" || m.generation_type === "suffix")) {
    wanted.add(id);
  }
}
for (const base of bases) for (const id of base.implicits) wanted.add(id);
for (const essence of Object.values(essenceLua)) {
  for (const id of Object.values(essence.mods as Record<string, string>)) wanted.add(id);
}
for (const emotion of Object.values(emotionsLua)) {
  for (const slots of Object.values(emotion.mods as Record<string, Record<string, string>>)) {
    for (const id of Object.values(slots)) wanted.add(id);
  }
}

const missingRefs: string[] = [];
const mods: Mod[] = [...wanted]
  .map((id) => {
    const m = rawMods[id];
    if (!m) {
      missingRefs.push(id);
      return null;
    }
    return {
      id,
      name: m.name,
      text: stripMarkup(m.text ?? ""),
      generation: m.generation_type,
      groups: m.groups,
      ilvl: m.required_level,
      weights: m.spawn_weights.map((w: any) => [w.tag, w.weight] as [string, number]),
      catalystTags: m.implicit_tags,
      essenceOnly: m.is_essence_only,
      stats: m.stats ?? [],
    } satisfies Mod;
  })
  .filter((m): m is Mod => m !== null)
  .sort((a, b) => a.id.localeCompare(b.id));

if (missingRefs.length > 0) {
  console.warn(`WARN: ${missingRefs.length} referenced mod ids missing from mods.json:`);
  for (const id of missingRefs.slice(0, 10)) console.warn(`  ${id}`);
}

// --- Currency / essences / emotions (names + icons from trade API) ----------
const currency: CurrencyItem[] = tradeStatic.result
  .filter((cat: any) => CURRENCY_CATEGORIES.includes(cat.id))
  .flatMap((cat: any) =>
    // "sep" rows are dropdown separators on the trade site, not items
    cat.entries.filter((e: any) => e.id !== "sep").map((e: any) => ({
      id: e.id,
      name: e.text,
      icon: e.image ? `${POE_CDN}${e.image}` : "",
      category: cat.id,
    })),
  );

const iconByName = new Map(currency.map((c) => [c.name, c.icon]));

const essences: Essence[] = Object.entries(essenceLua)
  .map(([id, e]) => ({
    id,
    name: e.name,
    type: e.type,
    tierLevel: e.tierLevel,
    mods: e.mods,
    icon: iconByName.get(e.name),
  }))
  .sort((a, b) => a.tierLevel - b.tierLevel || a.name.localeCompare(b.name));

const emotions: DistilledEmotion[] = Object.entries(emotionsLua)
  .map(([id, e]) => ({
    id,
    name: e.name,
    tierLevel: e.tierLevel,
    radiusJewel: e.radiusJewel,
    mods: e.mods,
    icon: iconByName.get(e.name),
  }))
  .sort((a, b) => a.tierLevel - b.tierLevel || a.name.localeCompare(b.name));

// --- Write bundle ------------------------------------------------------------
const sourceHashes: BundleMeta["sources"] = {};
for (const source of SOURCES) {
  const buf = await loadCache(source.file);
  sourceHashes[source.file] = {
    sha256: createHash("sha256").update(buf).digest("hex"),
    url: source.url,
  };
}

const meta: BundleMeta = {
  league: LEAGUE,
  generatedAt: new Date().toISOString(),
  sources: sourceHashes,
  counts: {
    bases: bases.length,
    mods: mods.length,
    currency: currency.length,
    essences: essences.length,
    emotions: emotions.length,
    tags: rawTags.length,
  },
};

await mkdir(OUT_DIR, { recursive: true });
const outputs: Record<string, unknown> = {
  "meta.json": meta,
  "bases.json": bases,
  "mods.json": mods,
  "currency.json": currency,
  "essences.json": essences,
  "emotions.json": emotions,
  "tags.json": rawTags,
};
for (const [file, data] of Object.entries(outputs)) {
  const json = JSON.stringify(data);
  await writeFile(join(OUT_DIR, file), json);
  console.log(`  wrote ${file} (${(json.length / 1024).toFixed(0)} KB)`);
}
console.log(`Bundle compiled to ${OUT_DIR}/`, meta.counts);
