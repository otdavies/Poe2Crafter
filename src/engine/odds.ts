/**
 * Outcome odds for using a currency on the current item — the engine behind
 * the odds panel. Probabilities derive from the exact pool and omen plumbing
 * apply() rolls against (rollablePool, planAddition, planRemoval), so the
 * panel can never drift from simulator behaviour. Odds are exact for
 * single-roll actions; multi-roll actions (Alchemy, Greater Exaltation) show
 * per-roll odds with a note, since the pool narrows as modifiers land.
 */
import type { GenerationType, Mod } from "../data/schema.ts";
import {
  actionFor,
  additionPool,
  alloyModId,
  NO_OMENS,
  planAddition,
  planRemoval,
  removalCandidates,
  requiredRemovalSide,
  validEmotionChoices,
  withoutMod,
  type Omens,
  type RemovalPlan,
} from "./actions.ts";
import type { EngineData } from "./data.ts";
import { desecrationPool, desecrationRemovalCandidates } from "./desecrate.ts";
import { affixLimit, itemTags, maxQuality, type Item, type RolledMod } from "./item.ts";
import {
  ALCHEMY_MOD_COUNT,
  ALLOYS,
  BONES,
  CATALYSTS,
  catalystQualityPerUse,
  DESECRATION_CHOICES,
  essenceTier,
  OMEN,
  SANCTIFY_MULTIPLIER,
  VAAL_BEYOND_LIMITS_MULTIPLIER,
  VAAL_CHAOS_TIMES,
  VAAL_OUTCOMES,
} from "./mechanics.ts";
import { rollablePool, spawnWeight, type PoolEntry, type PoolFilter } from "./modpool.ts";

/** One mod family (shared group set) that can be added, with its chance. */
export interface AdditionFamily {
  /** The family's currently-rollable tiers, lowest required level first. */
  mods: Mod[];
  generation: GenerationType;
  chance: number;
}

export interface AdditionOdds {
  /** Sorted by chance, highest first. Chances sum to 1 per roll. */
  families: AdditionFamily[];
  /** Modifiers added per use (Alchemy 4, Greater Exaltation 2). */
  rolls: number;
  prefixChance: number;
  suffixChance: number;
}

export interface RemovalOdds {
  verb: "remove" | "fracture";
  /** Chance each current explicit is hit, aligned with item.explicits. */
  candidates: { mod: RolledMod; chance: number }[];
}

/** Guaranteed mod grants (essences, alloys, emotions). */
export interface GuaranteedOdds {
  options: { modId: string; chance: number }[];
}

export type Odds =
  | { kind: "blocked"; reason: string }
  | {
      kind: "outcomes";
      outcomes: { label: string; chance: number }[];
      /** Implicit distribution, conditional on the enchant outcome. */
      enchants?: AdditionOdds;
      notes: string[];
    }
  | {
      kind: "craft";
      removal?: RemovalOdds;
      addition?: AdditionOdds;
      guaranteed?: GuaranteedOdds;
      notes: string[];
    };

/** A pool reached with probability p (mixtures over removal outcomes). */
interface WeightedPool {
  p: number;
  pool: PoolEntry[];
}

function additionOdds(pools: WeightedPool[], rolls: number): AdditionOdds {
  const families = new Map<string, AdditionFamily>();
  for (const { p, pool } of pools) {
    const total = pool.reduce((sum, e) => sum + e.weight, 0);
    if (total <= 0) continue;
    for (const entry of pool) {
      const key = `${entry.mod.generation}:${entry.mod.groups.join(",") || entry.mod.id}`;
      let family = families.get(key);
      if (!family) {
        family = { mods: [], generation: entry.mod.generation, chance: 0 };
        families.set(key, family);
      }
      family.chance += (p * entry.weight) / total;
      if (!family.mods.includes(entry.mod)) family.mods.push(entry.mod);
    }
  }
  const sorted = [...families.values()].sort((a, b) => b.chance - a.chance);
  for (const family of sorted) family.mods.sort((a, b) => a.ilvl - b.ilvl);
  const sideChance = (generation: GenerationType) =>
    sorted.reduce((sum, f) => (f.generation === generation ? sum + f.chance : sum), 0);
  return {
    families: sorted,
    rolls,
    prefixChance: sideChance("prefix"),
    suffixChance: sideChance("suffix"),
  };
}

/** Removal chances per current explicit, mixed over plan probabilities. */
function removalOdds(
  data: EngineData,
  item: Item,
  plans: { p: number; plan: RemovalPlan }[],
  verb: RemovalOdds["verb"] = "remove",
): RemovalOdds {
  const chance = new Map<RolledMod, number>();
  for (const { p, plan } of plans) {
    const candidates = removalCandidates(data, plan);
    for (const mod of candidates) {
      chance.set(mod, (chance.get(mod) ?? 0) + p / candidates.length);
    }
  }
  return {
    verb,
    candidates: item.explicits.map((mod) => ({ mod, chance: chance.get(mod) ?? 0 })),
  };
}

type CraftOdds = Extract<Odds, { kind: "craft" }>;

const craft = (odds: Omit<CraftOdds, "kind">): Odds => ({ kind: "craft", ...odds });

function vaalOdds(data: EngineData, item: Item): Odds {
  const total = VAAL_OUTCOMES.reduce((sum, o) => sum + o.weight, 0);
  const corrupted: Item = { ...item, corrupted: true };
  const tags = itemTags(data, corrupted);
  const enchantPool = data.corruptedPool
    .map((mod) => ({ mod, weight: spawnWeight(mod, tags) }))
    .filter((e) => e.weight > 0);
  const modCount = item.explicits.length + item.implicits.length;

  // Outcomes that can't affect this item fold into "no change", like apply().
  let noChange = 0;
  const outcomes: { label: string; chance: number }[] = [];
  let enchants: AdditionOdds | undefined;
  for (const outcome of VAAL_OUTCOMES) {
    const chance = outcome.weight / total;
    switch (outcome.kind) {
      case "no_change":
        noChange += chance;
        break;
      case "chaos":
        if (item.rarity === "rare" && item.explicits.some((m) => !m.fractured)) {
          outcomes.push({
            label: `Chaos Orb effect ×${VAAL_CHAOS_TIMES.min}–${VAAL_CHAOS_TIMES.max}`,
            chance,
          });
        } else noChange += chance;
        break;
      case "enchant":
        if (enchantPool.length > 0) {
          outcomes.push({ label: "Gains a corrupted implicit", chance });
          enchants = additionOdds([{ p: 1, pool: enchantPool }], 1);
        } else noChange += chance;
        break;
      case "beyond_limits":
        if (modCount > 0) {
          outcomes.push({
            label: `All values ×${VAAL_BEYOND_LIMITS_MULTIPLIER.min}–${VAAL_BEYOND_LIMITS_MULTIPLIER.max}`,
            chance,
          });
        } else noChange += chance;
        break;
    }
  }
  return {
    kind: "outcomes",
    outcomes: [{ label: "No change", chance: noChange }, ...outcomes],
    enchants,
    notes: ["Corrupts the item permanently. Outcome weights are community estimates."],
  };
}

/**
 * The odds of what `currencyId` would do to `item` right now, under the
 * armed omens. undefined = currency not simulated; "blocked" mirrors
 * canApply()'s reason.
 */
export function oddsFor(
  data: EngineData,
  item: Item,
  currencyId: string,
  omens: Omens = NO_OMENS,
): Odds | undefined {
  const action = actionFor(data, currencyId);
  if (!action) return undefined;
  const reason = action.canApply(data, item, omens);
  if (reason !== null) return { kind: "blocked", reason };

  const filter: PoolFilter = { minModLevel: action.minModLevel };
  const minLevelNote = action.minModLevel
    ? [`Only modifiers requiring level ${action.minModLevel}+ can roll`]
    : [];

  switch (action.kind) {
    case "transmute": {
      const magic: Item = { ...item, rarity: "magic" };
      return craft({
        addition: additionOdds([{ p: 1, pool: rollablePool(data, magic, filter) }], 1),
        notes: minLevelNote,
      });
    }
    case "augment":
      return craft({
        addition: additionOdds([{ p: 1, pool: rollablePool(data, item, filter) }], 1),
        notes: minLevelNote,
      });
    case "alchemy": {
      const rare: Item = { ...item, rarity: "rare" };
      return craft({
        addition: additionOdds(
          [{ p: 1, pool: rollablePool(data, rare, {}) }],
          ALCHEMY_MOD_COUNT,
        ),
        notes: ["Odds are per modifier; the pool narrows as each of the 4 lands"],
      });
    }
    case "regal": {
      const plan = planAddition(item, omens, "regal");
      const rare: Item = { ...item, rarity: "rare" };
      return craft({
        addition: additionOdds([{ p: 1, pool: additionPool(data, rare, plan, filter) }], 1),
        notes: minLevelNote,
      });
    }
    case "exalt": {
      const plan = planAddition(item, omens, "exalt");
      const notes = [...minLevelNote];
      if (plan.count > 1) notes.push("Odds are per modifier; the pool narrows after the first");
      if (plan.catalyse && item.quality) {
        notes.push(`Consumes the item's ${item.quality.percent}% quality to boost matching modifiers`);
      }
      return craft({
        addition: additionOdds([{ p: 1, pool: additionPool(data, item, plan, filter) }], plan.count),
        notes,
      });
    }
    case "chaos": {
      const plan = planRemoval(data, item, omens, "chaos");
      const candidates = removalCandidates(data, plan);
      // The replacement pool depends on which mod is removed — mix exactly.
      const pools = candidates.map((mod) => ({
        p: 1 / candidates.length,
        pool: rollablePool(data, withoutMod(item, mod), filter),
      }));
      return craft({
        removal: removalOdds(data, item, [{ p: 1, plan }]),
        addition: additionOdds(pools, 1),
        notes: minLevelNote,
      });
    }
    case "annul":
      return craft({
        removal: removalOdds(data, item, [{ p: 1, plan: planRemoval(data, item, omens, "annul") }]),
        notes: [],
      });
    case "divine":
      return craft({
        notes: omens.has(OMEN.sanctification)
          ? [
              `Sanctifies: every value ×${SANCTIFY_MULTIPLIER.min}–${SANCTIFY_MULTIPLIER.max} (rounded up), then the item is locked forever`,
            ]
          : ["Rerolls the values of all modifiers (identities unchanged)"],
      });
    case "vaal":
      return vaalOdds(data, item);
    case "fracture": {
      const plan: RemovalPlan = {
        candidates: item.explicits,
        whittling: false,
        consumed: [],
        blocked: null,
      };
      return craft({
        removal: removalOdds(data, item, [{ p: 1, plan }], "fracture"),
        notes: ["The fractured modifier can never be changed or removed"],
      });
    }
    case "essence": {
      const essence = data.essenceByCurrencyId.get(currencyId)!;
      const modId = essence.mods[data.base(item.baseId).itemClass];
      const guaranteed: GuaranteedOdds = { options: [{ modId, chance: 1 }] };
      if (essenceTier(essence.name) === "upgrade") {
        return craft({
          guaranteed,
          notes: ["Upgrades the item to Rare and adds the guaranteed modifier"],
        });
      }
      const plan = planRemoval(data, item, omens, "essence", requiredRemovalSide(data, item, modId));
      return craft({ removal: removalOdds(data, item, [{ p: 1, plan }]), guaranteed, notes: [] });
    }
    case "alloy": {
      const modId = alloyModId(data, item, ALLOYS.get(currencyId)!)!;
      const plan = planRemoval(data, item, omens, "essence", requiredRemovalSide(data, item, modId));
      return craft({
        removal: removalOdds(data, item, [{ p: 1, plan }]),
        guaranteed: { options: [{ modId, chance: 1 }] },
        notes: [],
      });
    }
    case "emotion": {
      const emotion = data.emotionByCurrencyId.get(currencyId)!;
      const valid = validEmotionChoices(data, item, emotion, omens);
      const p = 1 / valid.length;
      const plans = valid.map((option) => ({
        p,
        plan: planRemoval(
          data,
          item,
          omens,
          "essence",
          requiredRemovalSide(data, item, option.modId),
        ),
      }));
      return craft({
        removal: removalOdds(data, item, plans),
        guaranteed: { options: valid.map((option) => ({ modId: option.modId, chance: p })) },
        notes: [],
      });
    }
    case "catalyst": {
      const spec = CATALYSTS.get(currencyId)!;
      const perUse = catalystQualityPerUse(item.ilvl);
      const replaces = item.quality !== undefined && item.quality.catalystId !== currencyId;
      return craft({
        notes: [
          `+${perUse}% quality per use (max ${maxQuality(data, item)}%), boosting ${spec.tag} modifiers`,
          ...(replaces ? ["Replaces the item's existing quality type, starting from zero"] : []),
        ],
      });
    }
    case "desecrate": {
      const spec = BONES.get(currencyId)!;
      if (omens.has(OMEN.putrefaction)) {
        return craft({
          addition: additionOdds(
            [{ p: 1, pool: desecrationPool(data, { ...item, explicits: [] }, spec, omens) }],
            2 * affixLimit(data, item),
          ),
          notes: [
            "Omen of Putrefaction: ALL modifiers are replaced with Desecrated modifiers and the item is corrupted",
            "Odds are per modifier; the pool narrows as each lands",
          ],
        });
      }
      // Removal only happens when the item is full; the offer is drawn from
      // the post-removal pool, mixed exactly over each possible removal.
      const removalTargets = desecrationRemovalCandidates(data, item, omens);
      const pools =
        removalTargets.length > 0
          ? removalTargets.map((target) => ({
              p: 1 / removalTargets.length,
              pool: desecrationPool(data, withoutMod(item, target), spec, omens),
            }))
          : [{ p: 1, pool: desecrationPool(data, item, spec, omens) }];
      const removal: RemovalOdds | undefined =
        removalTargets.length > 0
          ? {
              verb: "remove",
              candidates: item.explicits.map((mod) => ({
                mod,
                chance: removalTargets.includes(mod) ? 1 / removalTargets.length : 0,
              })),
            }
          : undefined;
      return craft({
        removal,
        addition: additionOdds(pools, 1),
        notes: [
          `The Well of Souls reveals ${DESECRATION_CHOICES} of these — you keep one (chances shown are per revealed slot)`,
        ],
      });
    }
  }
}
