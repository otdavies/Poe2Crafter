/**
 * Validate the compiled bundle: internal consistency invariants that must
 * hold for the crafting engine to be correct. Exits non-zero on any failure.
 *
 * (Cross-validation of computed mod pools against Craft of Exile's blob
 * lands with the engine in phase 2 — pool resolution is what gets compared.)
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { OUT_DIR } from "./sources.ts";
import type {
  BaseItem,
  BundleMeta,
  CurrencyItem,
  DistilledEmotion,
  Essence,
  Mod,
} from "../../src/data/schema.ts";

async function load<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(join(OUT_DIR, file), "utf8")) as T;
}

const [meta, bases, mods, currency, essences, emotions, tags] = await Promise.all([
  load<BundleMeta>("meta.json"),
  load<BaseItem[]>("bases.json"),
  load<Mod[]>("mods.json"),
  load<CurrencyItem[]>("currency.json"),
  load<Essence[]>("essences.json"),
  load<DistilledEmotion[]>("emotions.json"),
  load<string[]>("tags.json"),
]);

const failures: string[] = [];
const warnings: string[] = [];
function check(ok: boolean, message: string): void {
  if (!ok) failures.push(message);
}

const modById = new Map(mods.map((m) => [m.id, m]));
const tagSet = new Set(tags);

// Every base implicit resolves, every base has at least one spawn-weight tag
for (const base of bases) {
  for (const implicit of base.implicits) {
    check(modById.has(implicit), `base ${base.id}: unresolved implicit ${implicit}`);
  }
  check(base.tags.length > 0, `base ${base.id}: no tags`);
  for (const tag of base.tags) {
    check(tagSet.has(tag), `base ${base.id}: unknown tag ${tag}`);
  }
}

// Mod invariants: weights reference known tags, non-negative; prefix/suffix
// mods either spawn somewhere or are essence-only; ilvl sane
const spawnableTags = new Set(bases.flatMap((b) => b.tags));
for (const mod of mods) {
  check(mod.ilvl >= 0 && mod.ilvl <= 100, `mod ${mod.id}: ilvl ${mod.ilvl}`);
  for (const [tag, weight] of mod.weights) {
    check(tagSet.has(tag), `mod ${mod.id}: unknown weight tag ${tag}`);
    check(weight >= 0, `mod ${mod.id}: negative weight on ${tag}`);
  }
  if ((mod.generation === "prefix" || mod.generation === "suffix") && !mod.essenceOnly) {
    const spawnsOnEquipment = mod.weights.some(([tag, w]) => w > 0 && spawnableTags.has(tag));
    if (!spawnsOnEquipment) {
      // Not fatal: plenty of item-domain mods target flasks/jewels/waystones
      warnings.push(`mod ${mod.id}: no positive weight on any equipment tag`);
    }
  }
}

// Essences: every guaranteed mod resolves; every essence has an icon
for (const essence of essences) {
  for (const [itemClass, modId] of Object.entries(essence.mods)) {
    check(modById.has(modId), `essence ${essence.name}: unresolved mod ${modId} (${itemClass})`);
  }
  if (!essence.icon) warnings.push(`essence ${essence.name}: no icon matched from trade API`);
}
for (const emotion of emotions) {
  for (const slots of Object.values(emotion.mods)) {
    for (const modId of Object.values(slots)) {
      check(modById.has(modId), `emotion ${emotion.name}: unresolved mod ${modId}`);
    }
  }
}

// Currency: ids unique within category, icons are absolute CDN URLs
const currencyKeys = new Set<string>();
for (const c of currency) {
  const key = `${c.category}/${c.id}`;
  check(!currencyKeys.has(key), `currency: duplicate ${key}`);
  currencyKeys.add(key);
  check(c.icon.startsWith("https://"), `currency ${c.id}: bad icon URL`);
}

// Bundle-level sanity: the counts a 0.5.x export must roughly have
check(bases.length > 1000, `too few bases: ${bases.length}`);
check(mods.filter((m) => m.generation === "prefix").length > 500, "too few prefixes");
check(mods.filter((m) => m.generation === "suffix").length > 500, "too few suffixes");
check(essences.length >= 80, `too few essences: ${essences.length}`);
check(currency.some((c) => c.id === "chaos"), "chaos orb missing from currency");
check(meta.counts.mods === mods.length, "meta counts out of sync with bundle");

for (const warning of warnings.slice(0, 8)) console.warn(`  warn: ${warning}`);
if (warnings.length > 8) console.warn(`  ...and ${warnings.length - 8} more warnings`);

if (failures.length > 0) {
  console.error(`FAIL: ${failures.length} invariant violations`);
  for (const failure of failures.slice(0, 20)) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(
  `OK: bundle valid — ${bases.length} bases, ${mods.length} mods, ` +
    `${essences.length} essences, ${emotions.length} emotions, ${currency.length} currency ` +
    `(${warnings.length} warnings)`,
);
