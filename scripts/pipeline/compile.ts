/**
 * Compile cached upstream data into the compact bundle the app ships with.
 *
 * Reads .pipeline-cache/, writes public/data/<league>/. The committed output
 * is the league pin — the site build never touches upstream sources.
 *
 * Offline-incremental mode: when a cached source is missing (some networks
 * can't reach every upstream host), the compiler reuses the previous
 * committed bundle output derived from that source and marks it
 * `carriedForward` in meta.json. PoB sources are always required — they are
 * the inputs this compiler actively transforms.
 */
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseLuaAssignments, parseLuaData } from "./lua.ts";
import { CACHE_DIR, LEAGUE, OUT_DIR, POB_BASE_FILES, POE_CDN, SOURCES } from "./sources.ts";
import type {
  BaseItem,
  BaseProperties,
  BaseRequirements,
  BundleMeta,
  CurrencyItem,
  DistilledEmotion,
  Essence,
  Mod,
} from "../../src/data/schema.ts";

/** Equipment classes the simulator supports (jewels come from PoB, below). */
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

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
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

async function loadLuaAssignments<T = any>(file: string): Promise<Record<string, T>> {
  return parseLuaAssignments((await loadCache(file)).toString("utf8")) as Record<string, T>;
}

const cached = new Map<string, boolean>();
for (const source of SOURCES) {
  cached.set(source.file, await exists(join(CACHE_DIR, source.file)));
}
const carriedForward = new Set<string>(
  SOURCES.filter((s) => !cached.get(s.file)).map((s) => s.file),
);
if (carriedForward.size > 0) {
  console.warn(
    `WARN: ${carriedForward.size} sources missing from cache, carrying previous ` +
      `bundle outputs forward: ${[...carriedForward].join(", ")}`,
  );
}

/** Previous committed bundle output (offline-incremental fallback input). */
async function loadPrevious<T>(file: string): Promise<T> {
  const path = join(OUT_DIR, file);
  if (!(await exists(path))) {
    throw new Error(`source for ${file} not cached and no previous bundle to carry forward`);
  }
  return JSON.parse(await readFile(path, "utf8")) as T;
}

// --- PoB inputs (required — this compiler actively transforms them) ---------
for (const file of ["Essence.lua", "LiquidEmotions.lua", ...POB_BASE_FILES.map((n) => `Bases/${n}.lua`)]) {
  if (!cached.get(file)) throw new Error(`required PoB source missing from cache: ${file}`);
}
const [essenceLua, emotionsLua] = await Promise.all([
  loadLua<Record<string, any>>("Essence.lua"),
  loadLua<Record<string, any>>("LiquidEmotions.lua"),
]);

interface PobBase {
  type: string;
  tags?: Record<string, boolean>;
  armour?: Record<string, number>;
  weapon?: Record<string, number>;
  req?: Record<string, number>;
}
const pobBases = new Map<string, PobBase>();
for (const name of POB_BASE_FILES) {
  for (const [baseName, entry] of Object.entries(
    await loadLuaAssignments<PobBase>(`Bases/${name}.lua`),
  )) {
    pobBases.set(baseName, entry);
  }
}

function baseProperties(pob: PobBase): BaseProperties | undefined {
  const a = pob.armour ?? {};
  const w = pob.weapon ?? {};
  const properties: BaseProperties = {
    armour: a.Armour,
    evasion: a.Evasion,
    energyShield: a.EnergyShield,
    ward: a.Ward,
    blockChance: a.BlockChance,
    movementPenalty: a.MovementPenalty,
    physMin: w.PhysicalMin,
    physMax: w.PhysicalMax,
    fireMin: w.FireMin,
    fireMax: w.FireMax,
    coldMin: w.ColdMin,
    coldMax: w.ColdMax,
    lightningMin: w.LightningMin,
    lightningMax: w.LightningMax,
    chaosMin: w.ChaosMin,
    chaosMax: w.ChaosMax,
    critChance: w.CritChanceBase,
    attacksPerSecond: w.AttackRateBase,
    range: w.Range,
    reloadTime: w.ReloadTimeBase,
  };
  for (const key of Object.keys(properties) as (keyof BaseProperties)[]) {
    if (properties[key] === undefined) delete properties[key];
  }
  return Object.keys(properties).length > 0 ? properties : undefined;
}

function baseRequirements(pob: PobBase): BaseRequirements | undefined {
  const r = pob.req ?? {};
  const req: BaseRequirements = { level: r.level, str: r.str, dex: r.dex, int: r.int };
  for (const key of Object.keys(req) as (keyof BaseRequirements)[]) {
    if (req[key] === undefined) delete req[key];
  }
  return Object.keys(req).length > 0 ? req : undefined;
}

// --- Bases -------------------------------------------------------------------
let bases: BaseItem[];
if (cached.get("base_items.min.json")) {
  const rawBases = await loadJson<Record<string, any>>("base_items.min.json");
  bases = Object.entries(rawBases)
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
    }));
} else {
  // Strip previously merged PoB fields and synthesized jewels ("Jewel/" ids);
  // both are re-derived from the PoB sources below.
  bases = (await loadPrevious<BaseItem[]>("bases.json"))
    .filter((b) => !b.id.startsWith("Jewel/"))
    .map(({ properties: _p, req: _r, ...rest }) => rest);
}

// Jewel bases always come from PoB (the repoe equipment filter doesn't cover
// them); synthetic stable ids. Jewels are 1x1, droppable from level 1.
// Timeless Jewels only exist as uniques — not a craftable base.
const existingNames = new Set(bases.map((b) => b.name));
for (const [name, pob] of pobBases) {
  if (pob.type !== "Jewel" || existingNames.has(name) || name === "Timeless Jewel") continue;
  bases.push({
    id: `Jewel/${name}`,
    name,
    itemClass: "Jewel",
    dropLevel: 1,
    tags: Object.keys(pob.tags ?? {}),
    implicits: [],
    width: 1,
    height: 1,
  });
}

// Merge PoB per-base stats (defences, weapon damage, requirements) by name.
let unmatchedPob = 0;
for (const base of bases) {
  const pob = pobBases.get(base.name);
  if (!pob) {
    unmatchedPob++;
    continue;
  }
  const properties = baseProperties(pob);
  const req = baseRequirements(pob);
  if (properties) base.properties = properties;
  if (req) base.req = req;
}
if (unmatchedPob > 0) {
  console.warn(`WARN: ${unmatchedPob}/${bases.length} bases have no PoB stat entry`);
}
bases.sort((a, b) => a.itemClass.localeCompare(b.itemClass) || a.dropLevel - b.dropLevel);

// --- Mods ----------------------------------------------------------------
// The craftable pool: item-domain prefixes/suffixes (incl. essence-only ones,
// flagged) — plus every mod referenced by bases/essences/emotions
// (implicits and essence display mods have generation_type "unique").
let mods: Mod[];
if (cached.get("mods.min.json")) {
  const rawMods = await loadJson<Record<string, any>>("mods.min.json");
  const wanted = new Set<string>();
  for (const [id, m] of Object.entries(rawMods)) {
    if (
      m.domain === "item" &&
      (m.generation_type === "prefix" ||
        m.generation_type === "suffix" ||
        m.generation_type === "corrupted") // Vaal Orb implicit pool
    ) {
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
  mods = [...wanted]
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
        addsTags: m.adds_tags,
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
} else {
  mods = await loadPrevious<Mod[]>("mods.json");
}

// --- Currency / essences / emotions (names + icons from trade API) ----------
let currency: CurrencyItem[];
if (cached.get("trade2_static.json")) {
  const tradeStatic = await loadJson<any>("trade2_static.json");
  currency = tradeStatic.result
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
} else {
  currency = await loadPrevious<CurrencyItem[]>("currency.json");
}

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

// --- Tags --------------------------------------------------------------------
const tags: string[] = cached.get("tags.min.json")
  ? await loadJson<string[]>("tags.min.json")
  : await loadPrevious<string[]>("tags.json");
// Synthetic jewel bases can carry PoB-only tags the dat export lacks.
const tagSet = new Set(tags);
for (const base of bases) {
  for (const tag of base.tags) {
    if (!tagSet.has(tag)) {
      tagSet.add(tag);
      tags.push(tag);
    }
  }
}

// --- Write bundle --------------------------------------------------------------
const previousMeta: BundleMeta | null = (await exists(join(OUT_DIR, "meta.json")))
  ? await loadPrevious<BundleMeta>("meta.json")
  : null;
const sourceHashes: BundleMeta["sources"] = {};
for (const source of SOURCES) {
  if (cached.get(source.file)) {
    const buf = await loadCache(source.file);
    sourceHashes[source.file] = {
      sha256: createHash("sha256").update(buf).digest("hex"),
      url: source.url,
    };
  } else {
    const previous = previousMeta?.sources[source.file];
    if (!previous) throw new Error(`no cache and no previous provenance for ${source.file}`);
    sourceHashes[source.file] = { ...previous, carriedForward: true };
  }
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
    tags: tags.length,
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
  "tags.json": tags,
};
for (const [file, data] of Object.entries(outputs)) {
  const json = JSON.stringify(data);
  await writeFile(join(OUT_DIR, file), json);
  console.log(`  wrote ${file} (${(json.length / 1024).toFixed(0)} KB)`);
}
console.log(`Bundle compiled to ${OUT_DIR}/`, meta.counts);
