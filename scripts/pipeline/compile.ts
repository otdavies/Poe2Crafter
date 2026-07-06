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
import { tradeSlug } from "../../src/engine/data.ts";
import { CACHE_DIR, LEAGUE, OUT_DIR, POB_BASE_FILES, POE_CDN, SOURCES } from "./sources.ts";
import type {
  AbyssalLord,
  BaseItem,
  BaseProperties,
  BaseRequirements,
  BundleMeta,
  CurrencyItem,
  DistilledEmotion,
  Essence,
  Mod,
  Rune,
  RuneEffect,
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

/**
 * A handful of mods carry no display text in the datamine because their real
 * effect is resolved at runtime (a randomly-chosen passive) rather than being
 * a fixed line. Without a description they render as a blank modifier line, so
 * we substitute a faithful summary keyed by the mod's stat id. Currently the
 * only currency-reachable case is Essence of Delirium's granted passive.
 * Source: poe2wiki Essence_of_Delirium ("Allocates a random Notable Passive
 * Skill" on the item).
 */
const SPECIAL_MOD_TEXT: Record<string, string> = {
  mod_granted_passive_hash_essence: "Allocates a random Notable Passive Skill",
};

/** Display text for a mod, falling back to a summary for text-less specials. */
function modText(raw: any): string {
  const text = stripMarkup(raw.text ?? "");
  if (text.trim() !== "") return text;
  for (const stat of (raw.stats ?? []) as { id: string }[]) {
    const special = SPECIAL_MOD_TEXT[stat.id];
    if (special) return special;
  }
  return text;
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
      // "Art/2DItems/.../Foo.dds" → poecdn image path (UI builds the URL).
      art: (b.visual_identity?.dds_file as string | undefined)?.replace(/\.dds$/, ""),
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
// (implicits and essence display mods have generation_type "unique"), plus
// the desecrated domain (abyssal bones, 0.3+).

// Desecrated-domain mods that spawn on things we don't simulate: waystones
// ("map"), Kulemak invitations, Grand Spectrum watchers, breach-ring
// desecration (Altered Collarbone). Equipment + jewel desecration stays.
const DESECRATION_EXCLUDED_TAGS = new Set([
  "map",
  "watcher_abyss_suffix",
  "kulemak_abyss_prefix",
  "kulemak_abyss_special_prefix",
  "breach_desecration",
]);
const LORD_TAGS = new Map<string, AbyssalLord>([
  ["ulaman_mod", "ulaman"],
  ["amanamu_mod", "amanamu"],
  ["kurgal_mod", "kurgal"],
]);

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
    if (
      m.domain === "desecrated" &&
      (m.generation_type === "prefix" || m.generation_type === "suffix") &&
      m.spawn_weights.some(
        (w: any) => w.weight > 0 && !DESECRATION_EXCLUDED_TAGS.has(w.tag),
      )
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
      const mod: Mod = {
        id,
        name: m.name,
        text: modText(m),
        generation: m.generation_type,
        groups: m.groups,
        ilvl: m.required_level,
        weights: m.spawn_weights.map((w: any) => [w.tag, w.weight] as [string, number]),
        catalystTags: m.implicit_tags,
        addsTags: m.adds_tags,
        essenceOnly: m.is_essence_only,
        stats: m.stats ?? [],
      };
      if (m.domain === "desecrated") {
        mod.desecrated = true;
        const lord = (m.implicit_tags as string[])
          .map((t) => LORD_TAGS.get(t))
          .find((l) => l !== undefined);
        if (lord) mod.lord = lord;
      }
      return mod;
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

/**
 * Abyssal bones (desecration crafting, 0.3+, current in 0.5). The trade
 * static snapshot most sandboxes carry forward predates the Abyss trade
 * category, so the bone list is curated here. Names, trade ids and icon
 * URLs verified against Exiled Exchange 2's PoE2 dataset
 * (github.com/Kvan7/Exiled-Exchange-2, renderer/public/data/en/items.ndjson).
 */
const CDN_GEN = `${POE_CDN}/gen/image`;
const BONES: CurrencyItem[] = ([
  ["gnawed-jawbone", "Gnawed Jawbone", "WzI1LDE0LHsiZiI6IjJESXRlbXMvQ3VycmVuY3kvQWJ5c3MvR25hd2VkSmF3Ym9uZSIsInNjYWxlIjoxLCJyZWFsbSI6InBvZTIifV0/6d343a5e8d/GnawedJawbone.png"],
  ["gnawed-rib", "Gnawed Rib", "WzI1LDE0LHsiZiI6IjJESXRlbXMvQ3VycmVuY3kvQWJ5c3MvR25hd2VkUmlicyIsInNjYWxlIjoxLCJyZWFsbSI6InBvZTIifV0/b0581454e6/GnawedRibs.png"],
  ["gnawed-collarbone", "Gnawed Collarbone", "WzI1LDE0LHsiZiI6IjJESXRlbXMvQ3VycmVuY3kvQWJ5c3MvR25hd2VkQ2xhdmljbGUiLCJzY2FsZSI6MSwicmVhbG0iOiJwb2UyIn1d/ff42f1ab47/GnawedClavicle.png"],
  ["preserved-jawbone", "Preserved Jawbone", "WzI1LDE0LHsiZiI6IjJESXRlbXMvQ3VycmVuY3kvQWJ5c3MvUHJlc2VydmVkSmF3Ym9uZSIsInNjYWxlIjoxLCJyZWFsbSI6InBvZTIifV0/2bb7939b21/PreservedJawbone.png"],
  ["preserved-rib", "Preserved Rib", "WzI1LDE0LHsiZiI6IjJESXRlbXMvQ3VycmVuY3kvQWJ5c3MvUHJlc2VydmVkUmlicyIsInNjYWxlIjoxLCJyZWFsbSI6InBvZTIifV0/3676729ba0/PreservedRibs.png"],
  ["preserved-collarbone", "Preserved Collarbone", "WzI1LDE0LHsiZiI6IjJESXRlbXMvQ3VycmVuY3kvQWJ5c3MvUHJlc2VydmVkQ2FsdmljbGUiLCJzY2FsZSI6MSwicmVhbG0iOiJwb2UyIn1d/6f63f7462d/PreservedCalvicle.png"],
  ["preserved-cranium", "Preserved Cranium", "WzI1LDE0LHsiZiI6IjJESXRlbXMvQ3VycmVuY3kvQWJ5c3MvUHJlc2VydmVkQ3Jhbml1bSIsInNjYWxlIjoxLCJyZWFsbSI6InBvZTIifV0/791fdae503/PreservedCranium.png"],
  ["preserved-vertebrae", "Preserved Vertebrae", "WzI1LDE0LHsiZiI6IjJESXRlbXMvQ3VycmVuY3kvQWJ5c3MvUHJlc2VydmVkU3BpbmUiLCJzY2FsZSI6MSwicmVhbG0iOiJwb2UyIn1d/6605f295c5/PreservedSpine.png"],
  ["ancient-jawbone", "Ancient Jawbone", "WzI1LDE0LHsiZiI6IjJESXRlbXMvQ3VycmVuY3kvQWJ5c3MvQW5jaWVudEphd2JvbmUiLCJzY2FsZSI6MSwicmVhbG0iOiJwb2UyIn1d/bff68187a6/AncientJawbone.png"],
  ["ancient-rib", "Ancient Rib", "WzI1LDE0LHsiZiI6IjJESXRlbXMvQ3VycmVuY3kvQWJ5c3MvQW5jaWVudFJpYnMiLCJzY2FsZSI6MSwicmVhbG0iOiJwb2UyIn1d/0c779c5d3f/AncientRibs.png"],
  ["ancient-collarbone", "Ancient Collarbone", "WzI1LDE0LHsiZiI6IjJESXRlbXMvQ3VycmVuY3kvQWJ5c3MvQW5jaWVudENsYXZpY2xlIiwic2NhbGUiOjEsInJlYWxtIjoicG9lMiJ9XQ/86b2c7a29a/AncientClavicle.png"],
] as const).map(([id, name, icon]) => ({
  id,
  name,
  icon: `${CDN_GEN}/${icon}`,
  category: "Abyss",
}));
currency = [...currency.filter((c) => c.category !== "Abyss"), ...BONES];

// Inventory stack sizes from the datamine (Exalted Orb 20, essences /
// runes / omens 10, …) — currencies live in grids as 1×1 stackables.
if (cached.get("base_items.min.json")) {
  const rawAll = await loadJson<Record<string, any>>("base_items.min.json");
  const stackByName = new Map<string, number>();
  for (const b of Object.values(rawAll)) {
    const s = b?.properties?.stack_size;
    if (typeof s === "number" && s > 0 && b.name) stackByName.set(b.name, s);
  }
  for (const c of currency) {
    const s = stackByName.get(c.name);
    if (s) c.stack = s;
  }
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

// --- Runes (0.5 Runes of Aldur socketables) ----------------------------------
// repoe augments.json: per-host-class effects of every socketable, keyed by
// metadata id (names join through base_items). We ship the Rune-type entries;
// Soul Cores / Idols / Abyssal Eyes are character-build socketables the
// simulator doesn't model (and the trade snapshot doesn't list).

/**
 * Augment `target` strings → our item classes. "Quarterstaves" is the GGG
 * class "Warstaff". Group targets follow the game's equipment taxonomy:
 * armour includes shields/bucklers/foci, martial = every attack weapon.
 */
const MARTIAL_CLASSES = [
  "Bow", "Claw", "Crossbow", "Dagger", "Flail", "Spear", "Warstaff",
  "One Hand Axe", "One Hand Mace", "One Hand Sword",
  "Two Hand Axe", "Two Hand Mace", "Two Hand Sword",
];
const CASTER_CLASSES = ["Wand", "Staff", "Sceptre"];
const ARMOUR_CLASSES = [
  "Body Armour", "Boots", "Gloves", "Helmet", "Shield", "Buckler", "Focus",
];
const TARGET_CLASSES: Record<string, string[]> = {
  "All Equipment": [...MARTIAL_CLASSES, ...CASTER_CLASSES, ...ARMOUR_CLASSES, "Talisman"],
  Armour: ARMOUR_CLASSES,
  Weapon: [...MARTIAL_CLASSES, ...CASTER_CLASSES],
  "[MartialWeapon|Martial Weapon]": MARTIAL_CLASSES,
  "[CasterWeapon|Caster Weapon]": CASTER_CLASSES,
  "[MartialWeapon|Martial Weapon], Wand or Staff": [...MARTIAL_CLASSES, "Wand", "Staff"],
  "Wand or Staff": ["Wand", "Staff"],
  "Crossbow, Bow or Spear": ["Crossbow", "Bow", "Spear"],
  "One Hand Mace or Quarterstaff": ["One Hand Mace", "Warstaff"],
  "One Hand Mace, Two Hand Mace or Talisman": ["One Hand Mace", "Two Hand Mace", "Talisman"],
  "Quarterstaff or Spear": ["Warstaff", "Spear"],
  "Shields and Bucklers": ["Shield", "Buckler"],
  "Body Armours": ["Body Armour"],
  Boots: ["Boots"],
  Gloves: ["Gloves"],
  Helmets: ["Helmet"],
  Bows: ["Bow"],
  Bucklers: ["Buckler"],
  Crossbows: ["Crossbow"],
  Foci: ["Focus"],
  "One Hand Maces": ["One Hand Mace"],
  Quarterstaves: ["Warstaff"],
  Sceptres: ["Sceptre"],
  Shields: ["Shield"],
  Spears: ["Spear"],
  Staves: ["Staff"],
  Talismans: ["Talisman"],
  "Two Hand Maces": ["Two Hand Mace"],
  Wands: ["Wand"],
};

function runeLimit(limit: string | undefined): Rune["limit"] {
  if (!limit) return undefined;
  if (limit.includes("Ancient")) return "ancient";
  if (limit.includes("Aldur")) return "aldurs-legacy";
  return "self"; // "1": at most one copy of this augment per item
}

let runes: Rune[];
if (cached.get("augments.min.json") && cached.get("base_items.min.json")) {
  const rawAugments = await loadJson<Record<string, any>>("augments.min.json");
  const rawBases = await loadJson<Record<string, any>>("base_items.min.json");
  const unknownTargets = new Set<string>();
  runes = Object.entries(rawAugments)
    .filter(([, a]) => a.type_id === "Rune")
    .map(([id, a]): Rune | null => {
      const name: string = rawBases[id]?.name ?? "";
      if (!name || name.startsWith("[DNT")) return null;
      // Categories with only bonded_stat_text are Shaman-ascendancy bonded
      // effects (character passive, not item crafting) — not shipped.
      const effects: RuneEffect[] = Object.values(a.categories as Record<string, any>)
        .filter((c) => (c.stat_text ?? []).length > 0)
        .map((c) => {
          const targets: string[] = Array.isArray(c.target) ? c.target : [c.target];
          const itemClasses = [
            ...new Set(
              targets.flatMap((t) => {
                const classes = TARGET_CLASSES[t];
                if (!classes) unknownTargets.add(t);
                return classes ?? [];
              }),
            ),
          ];
          return {
            itemClasses,
            text: ((c.stat_text ?? []) as string[]).flatMap((t) => stripMarkup(t).split("\n")),
            stats: ((c.stats ?? []) as { id: string }[]).map((s) => s.id),
          };
        });
      return { id: tradeSlug(name), name, limit: runeLimit(a.limit), effects };
    })
    .filter((r): r is Rune => r !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const rune of runes) {
    if (rune.limit === undefined) delete rune.limit;
  }
  if (unknownTargets.size > 0) {
    console.warn(`WARN: unmapped augment targets: ${[...unknownTargets].join(" | ")}`);
  }
} else {
  runes = await loadPrevious<Rune[]>("runes.json");
}

// The trade snapshot's Runes category should join runes.json by id — warn on
// drift so a stale snapshot or a renamed rune is caught at compile time.
{
  const runeIds = new Set(runes.map((r) => r.id));
  const unmatched = currency.filter((c) => c.category === "Runes" && !runeIds.has(c.id));
  if (unmatched.length > 0) {
    console.warn(
      `WARN: ${unmatched.length} trade runes have no augment data: ` +
        unmatched.slice(0, 5).map((c) => c.id).join(", "),
    );
  }
}

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
    runes: runes.length,
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
  "runes.json": runes,
  "tags.json": tags,
};
for (const [file, data] of Object.entries(outputs)) {
  const json = JSON.stringify(data);
  await writeFile(join(OUT_DIR, file), json);
  console.log(`  wrote ${file} (${(json.length / 1024).toFixed(0)} KB)`);
}
console.log(`Bundle compiled to ${OUT_DIR}/`, meta.counts);
