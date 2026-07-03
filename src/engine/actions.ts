/**
 * Crafting actions: every mechanic is a CraftAction keyed by trade-API
 * currency id. Each action validates preconditions (canApply) and returns a
 * new item plus the events that happened — the events feed the step log,
 * share links, and tutorial view.
 *
 * Omens: the UI arms omens before a currency use; actions receive the armed
 * set, apply the ones relevant to them, and report them in consumedOmens.
 * Interaction order is filter-then-select: side restrictions (Sinistral/
 * Dextral) narrow the candidate set first, then selection rules (Whittling's
 * lowest-level pick) run inside it.
 */
import type { DistilledEmotion, Essence } from "../data/schema.ts";
import type { EngineData } from "./data.ts";
import {
  affixLimit,
  itemTags,
  maxQuality,
  openAffixSlots,
  qualityTag,
  rollMod,
  takenGroups,
  type Item,
  type ItemQuality,
  type Rarity,
  type RolledMod,
} from "./item.ts";
import {
  ALLOYS,
  CATALYSTS,
  catalystQualityPerUse,
  essenceTier,
  FRACTURE_MIN_EXPLICITS,
  MIN_MOD_LEVEL,
  OMEN,
  SANCTIFY_MULTIPLIER,
  TIME_LOST_PREFIX,
  VAAL_BEYOND_LIMITS_MULTIPLIER,
  VAAL_CHAOS_TIMES,
  VAAL_OUTCOMES,
  type AlloySpec,
  type CatalystSpec,
  type CurrencyTier,
} from "./mechanics.ts";
import {
  catalysedPool,
  explicitCatalystTags,
  homogenisedPool,
  pickFromPool,
  rollablePool,
  spawnWeight,
  type PoolEntry,
  type PoolFilter,
} from "./modpool.ts";
import { pickWeighted, rollFloat, rollInt, type Rng } from "./rng.ts";

export type CraftEvent =
  | { kind: "rarity"; to: Rarity }
  | { kind: "added"; mod: RolledMod }
  | { kind: "removed"; mod: RolledMod }
  | { kind: "implicit_added"; mod: RolledMod }
  | { kind: "values_rerolled" }
  | { kind: "values_pushed" }
  | { kind: "sanctified" }
  | { kind: "fractured"; mod: RolledMod }
  | { kind: "quality"; quality: ItemQuality }
  | { kind: "corrupted" }
  | { kind: "no_change" };

export interface CraftResult {
  item: Item;
  events: CraftEvent[];
  /** Armed omens this action consumed — the store un-arms them. */
  consumedOmens?: string[];
}

export type Omens = ReadonlySet<string>;
const NO_OMENS: Omens = new Set();

export interface CraftAction {
  /** trade API currency id, e.g. "chaos" — the key the UI dispatches on. */
  currencyId: string;
  /** Reason the action can't be used right now, or null if it can. */
  canApply(data: EngineData, item: Item, omens?: Omens): string | null;
  apply(data: EngineData, item: Item, rng: Rng, omens?: Omens): CraftResult;
}

const usable = (item: Item): string | null =>
  item.corrupted
    ? "Corrupted items cannot be modified"
    : item.sanctified
      ? "Sanctified items cannot be modified"
      : null;

// --- Omen plumbing -----------------------------------------------------------

type Generation = "prefix" | "suffix";

/** Resolve a Sinistral/Dextral omen pair to a side restriction. */
function sideRestriction(
  omens: Omens,
  sinistral: string,
  dextral: string,
): { side?: Generation; consumed: string[]; blocked?: string } {
  const left = omens.has(sinistral);
  const right = omens.has(dextral);
  if (left && right) {
    return { consumed: [], blocked: "Conflicting Sinistral and Dextral omens are active" };
  }
  if (left) return { side: "prefix", consumed: [sinistral] };
  if (right) return { side: "suffix", consumed: [dextral] };
  return { consumed: [] };
}

interface RemovalPlan {
  candidates: RolledMod[];
  whittling: boolean;
  consumed: string[];
  blocked: string | null;
}

/**
 * Which mods a removing currency may hit, given armed omens (and, for
 * essence-like swaps, the affix side the guaranteed mod needs room on).
 */
function planRemoval(
  data: EngineData,
  item: Item,
  omens: Omens,
  kind: "chaos" | "annul" | "essence",
  requiredSide?: Generation,
): RemovalPlan {
  const pair = {
    chaos: [OMEN.sinistralErasure, OMEN.dextralErasure],
    annul: [OMEN.sinistralAnnulment, OMEN.dextralAnnulment],
    essence: [OMEN.sinistralCrystallisation, OMEN.dextralCrystallisation],
  }[kind];
  const restriction = sideRestriction(omens, pair[0], pair[1]);
  if (restriction.blocked) {
    return { candidates: [], whittling: false, consumed: [], blocked: restriction.blocked };
  }
  if (requiredSide && restriction.side && restriction.side !== requiredSide) {
    return {
      candidates: [],
      whittling: false,
      consumed: [],
      blocked: `The guaranteed modifier needs a ${requiredSide} slot, but an omen restricts removal to ${restriction.side === "prefix" ? "prefixes" : "suffixes"}`,
    };
  }
  const side = restriction.side ?? requiredSide;
  const consumed = [...restriction.consumed];

  let candidates = item.explicits.filter((m) => !m.fractured);
  if (side) candidates = candidates.filter((m) => data.mod(m.modId).generation === side);

  let whittling = false;
  if (kind === "chaos" && omens.has(OMEN.whittling)) {
    whittling = true;
    consumed.push(OMEN.whittling);
  }

  const blocked =
    candidates.length === 0
      ? side
        ? `No removable ${side} modifiers`
        : "No removable modifiers"
      : null;
  return { candidates, whittling, consumed, blocked };
}

/** Pick the removal target: random, or lowest required level (Whittling). */
function pickRemoval(data: EngineData, rng: Rng, plan: RemovalPlan): RolledMod {
  let pool = plan.candidates;
  if (plan.whittling) {
    const lowest = Math.min(...pool.map((m) => data.mod(m.modId).ilvl));
    pool = pool.filter((m) => data.mod(m.modId).ilvl === lowest);
  }
  return pool[rollInt(rng, 0, pool.length - 1)];
}

function withoutMod(item: Item, target: RolledMod): Item {
  return { ...item, explicits: item.explicits.filter((m) => m !== target) };
}

interface AdditionPlan {
  generation?: Generation;
  homogenise: boolean;
  catalyse: boolean;
  count: number;
  consumed: string[];
  blocked: string | null;
}

/** Omens that shape what an Exalted/Regal Orb adds. */
function planAddition(
  item: Item,
  omens: Omens,
  action: "exalt" | "regal",
): AdditionPlan {
  const plan: AdditionPlan = {
    homogenise: false,
    catalyse: false,
    count: 1,
    consumed: [],
    blocked: null,
  };
  if (action === "exalt") {
    const restriction = sideRestriction(omens, OMEN.sinistralExaltation, OMEN.dextralExaltation);
    if (restriction.blocked) return { ...plan, blocked: restriction.blocked };
    plan.generation = restriction.side;
    plan.consumed.push(...restriction.consumed);
    if (omens.has(OMEN.greaterExaltation)) {
      plan.count = 2;
      plan.consumed.push(OMEN.greaterExaltation);
    }
    if (omens.has(OMEN.homogenisingExaltation)) {
      plan.homogenise = true;
      plan.consumed.push(OMEN.homogenisingExaltation);
    }
    if (omens.has(OMEN.catalysingExaltation)) {
      if (!item.quality || item.quality.percent <= 0) {
        return { ...plan, blocked: "No catalyst quality to consume" };
      }
      plan.catalyse = true;
      plan.consumed.push(OMEN.catalysingExaltation);
    }
  } else if (omens.has(OMEN.homogenisingCoronation)) {
    plan.homogenise = true;
    plan.consumed.push(OMEN.homogenisingCoronation);
  }
  return plan;
}

/** The rollable pool an addition draws from, after omen shaping. */
function additionPool(
  data: EngineData,
  item: Item,
  plan: AdditionPlan,
  filter: PoolFilter,
): PoolEntry[] {
  let pool = rollablePool(data, item, { ...filter, generation: plan.generation });
  if (plan.homogenise) pool = homogenisedPool(pool, explicitCatalystTags(data, item));
  const tag = qualityTag(item);
  if (plan.catalyse && tag && item.quality) {
    pool = catalysedPool(pool, tag, item.quality.percent);
  }
  return pool;
}

// --- Shared helpers ----------------------------------------------------------

/** Add one random mod from the given pool; assumes it is non-empty. */
function addFromPool(
  item: Item,
  rng: Rng,
  pool: PoolEntry[],
): { item: Item; event: CraftEvent } {
  const rolled = rollMod(pickFromPool(rng, pool), rng);
  return {
    item: { ...item, explicits: [...item.explicits, rolled] },
    event: { kind: "added", mod: rolled },
  };
}

/** Add one random mod from the current pool; assumes canApply passed. */
function addRandomMod(
  data: EngineData,
  item: Item,
  rng: Rng,
  filter: PoolFilter,
): { item: Item; event: CraftEvent } {
  return addFromPool(item, rng, rollablePool(data, item, filter));
}

const nonFractured = (item: Item): RolledMod[] =>
  item.explicits.filter((m) => !m.fractured);

/** Pool must be able to yield a mod, else the orb can't be used. */
function requirePool(data: EngineData, item: Item, filter: PoolFilter): string | null {
  return rollablePool(data, item, filter).length === 0
    ? "No modifiers can roll on this item"
    : null;
}

/** Roll the guaranteed mod of an essence-like currency. */
function grantMod(data: EngineData, item: Item, rng: Rng, modId: string): {
  item: Item;
  event: CraftEvent;
} {
  const rolled = rollMod(data.mod(modId), rng);
  return {
    item: { ...item, explicits: [...item.explicits, rolled] },
    event: { kind: "added", mod: rolled },
  };
}

/** "Cannot be used on an item that has the same type of modifier." */
function groupConflict(data: EngineData, item: Item, modId: string): string | null {
  const groups = takenGroups(data, item);
  return data.mod(modId).groups.some((g) => groups.has(g))
    ? "Item already has a modifier of this type"
    : null;
}

/**
 * For essence-like swaps: the affix side removal must come from, if the
 * guaranteed mod's side is full (verified: a full side is guaranteed to lose
 * one of its mods, never the other side).
 */
function requiredRemovalSide(
  data: EngineData,
  item: Item,
  modId: string,
): Generation | undefined {
  const generation = data.mod(modId).generation;
  if (generation !== "prefix" && generation !== "suffix") return undefined;
  const open = openAffixSlots(data, item);
  return open[generation] <= 0 ? generation : undefined;
}

// --- Basic orbs ----------------------------------------------------------------

function transmutation(tier: CurrencyTier, currencyId: string): CraftAction {
  const minModLevel = MIN_MOD_LEVEL[tier];
  return {
    currencyId,
    canApply: (data, item) =>
      usable(item) ??
      (item.rarity !== "normal" ? "Requires a Normal item" : null) ??
      // pool is evaluated as-if the item were already magic (slots open up)
      requirePool(data, { ...item, rarity: "magic" }, { minModLevel: minModLevel || undefined }),
    apply(data, item, rng) {
      const magic: Item = { ...item, rarity: "magic" };
      const added = addRandomMod(data, magic, rng, {
        minModLevel: minModLevel || undefined,
      });
      return { item: added.item, events: [{ kind: "rarity", to: "magic" }, added.event] };
    },
  };
}

function augmentation(tier: CurrencyTier, currencyId: string): CraftAction {
  const minModLevel = MIN_MOD_LEVEL[tier];
  return {
    currencyId,
    canApply: (data, item) =>
      usable(item) ??
      (item.rarity !== "magic" ? "Requires a Magic item" : null) ??
      (item.explicits.length >= 2 * affixLimit(data, item) ? "Item is full" : null) ??
      requirePool(data, item, { minModLevel: minModLevel || undefined }),
    apply(data, item, rng) {
      const added = addRandomMod(data, item, rng, { minModLevel: minModLevel || undefined });
      return { item: added.item, events: [added.event] };
    },
  };
}

function regal(tier: CurrencyTier, currencyId: string): CraftAction {
  const minModLevel = MIN_MOD_LEVEL[tier];
  return {
    currencyId,
    canApply: (data, item, omens = NO_OMENS) => {
      const blocked =
        usable(item) ?? (item.rarity !== "magic" ? "Requires a Magic item" : null);
      if (blocked) return blocked;
      const plan = planAddition(item, omens, "regal");
      if (plan.blocked) return plan.blocked;
      if (plan.homogenise) {
        const pool = additionPool(data, { ...item, rarity: "rare" }, plan, {
          minModLevel: minModLevel || undefined,
        });
        if (pool.length === 0) return "No modifier shares a type with an existing modifier";
      }
      return null;
    },
    apply(data, item, rng, omens = NO_OMENS) {
      const plan = planAddition(item, omens, "regal");
      const rare: Item = { ...item, rarity: "rare" };
      const events: CraftEvent[] = [{ kind: "rarity", to: "rare" }];
      const pool = additionPool(data, rare, plan, { minModLevel: minModLevel || undefined });
      if (pool.length > 0) {
        const added = addFromPool(rare, rng, pool);
        return {
          item: added.item,
          events: [...events, added.event],
          consumedOmens: plan.consumed,
        };
      }
      return { item: rare, events, consumedOmens: plan.consumed };
    },
  };
}

function exalted(tier: CurrencyTier, currencyId: string): CraftAction {
  const minModLevel = MIN_MOD_LEVEL[tier];
  const filter = { minModLevel: minModLevel || undefined };
  return {
    currencyId,
    canApply: (data, item, omens = NO_OMENS) => {
      const blocked =
        usable(item) ?? (item.rarity !== "rare" ? "Requires a Rare item" : null);
      if (blocked) return blocked;
      const plan = planAddition(item, omens, "exalt");
      if (plan.blocked) return plan.blocked;
      const open = openAffixSlots(data, item);
      if (plan.generation && open[plan.generation] <= 0) {
        return `Item has no open ${plan.generation} slots`;
      }
      if (open.prefix <= 0 && open.suffix <= 0) return "Item has no open affix slots";
      if (additionPool(data, item, plan, filter).length === 0) {
        return plan.homogenise
          ? "No modifier shares a type with an existing modifier"
          : "No modifiers can roll on this item";
      }
      return null;
    },
    apply(data, item, rng, omens = NO_OMENS) {
      const plan = planAddition(item, omens, "exalt");
      let current = item;
      const events: CraftEvent[] = [];
      for (let i = 0; i < plan.count; i++) {
        const pool = additionPool(data, current, plan, filter);
        if (pool.length === 0) break;
        const added = addFromPool(current, rng, pool);
        current = added.item;
        events.push(added.event);
      }
      if (plan.catalyse && current.quality) {
        current = { ...current, quality: undefined };
        events.push({
          kind: "quality",
          quality: { catalystId: item.quality!.catalystId, percent: 0 },
        });
      }
      return { item: current, events, consumedOmens: plan.consumed };
    },
  };
}

function chaos(tier: CurrencyTier, currencyId: string): CraftAction {
  const minModLevel = MIN_MOD_LEVEL[tier];
  return {
    currencyId,
    canApply: (data, item, omens = NO_OMENS) =>
      usable(item) ??
      (item.rarity !== "rare" ? "Requires a Rare item" : null) ??
      planRemoval(data, item, omens, "chaos").blocked,
    apply(data, item, rng, omens = NO_OMENS) {
      const plan = planRemoval(data, item, omens, "chaos");
      const target = pickRemoval(data, rng, plan);
      const removed = withoutMod(item, target);
      const added = addRandomMod(data, removed, rng, {
        minModLevel: minModLevel || undefined,
      });
      return {
        item: added.item,
        events: [{ kind: "removed", mod: target }, added.event],
        consumedOmens: plan.consumed,
      };
    },
  };
}

const alchemy: CraftAction = {
  currencyId: "alch",
  canApply: (_data, item) =>
    usable(item) ?? (item.rarity !== "normal" ? "Requires a Normal item" : null),
  apply(data, item, rng) {
    let current: Item = { ...item, rarity: "rare" };
    const events: CraftEvent[] = [{ kind: "rarity", to: "rare" }];
    // "Upgrades a Normal item to a Rare item with 4 modifiers"
    for (let i = 0; i < 4; i++) {
      if (rollablePool(data, current, {}).length === 0) break;
      const added = addRandomMod(data, current, rng, {});
      current = added.item;
      events.push(added.event);
    }
    return { item: current, events };
  },
};

const annulment: CraftAction = {
  currencyId: "annul",
  canApply: (data, item, omens = NO_OMENS) =>
    usable(item) ??
    (item.rarity === "normal" ? "Requires a Magic or Rare item" : null) ??
    planRemoval(data, item, omens, "annul").blocked,
  apply(data, item, rng, omens = NO_OMENS) {
    const plan = planRemoval(data, item, omens, "annul");
    const target = pickRemoval(data, rng, plan);
    return {
      item: withoutMod(item, target),
      events: [{ kind: "removed", mod: target }],
      consumedOmens: plan.consumed,
    };
  },
};

const divine: CraftAction = {
  currencyId: "divine",
  canApply: (_data, item, omens = NO_OMENS) =>
    usable(item) ??
    (item.explicits.length + item.implicits.length === 0 ? "No modifiers to reroll" : null) ??
    (omens.has(OMEN.sanctification) && item.rarity !== "rare"
      ? "Omen of Sanctification requires a Rare item"
      : null),
  apply(data, item, rng, omens = NO_OMENS) {
    if (omens.has(OMEN.sanctification)) {
      // Sanctify: every modifier value × random 0.78-1.22 (rounded up), then
      // the item is locked forever (see mechanics.SANCTIFY_MULTIPLIER).
      const sanctify = (rolled: RolledMod): RolledMod => {
        const factor = rollFloat(rng, SANCTIFY_MULTIPLIER.min, SANCTIFY_MULTIPLIER.max);
        return { ...rolled, values: rolled.values.map((v) => Math.ceil(v * factor)) };
      };
      return {
        item: {
          ...item,
          implicits: item.implicits.map(sanctify),
          explicits: item.explicits.map(sanctify),
          sanctified: true,
        },
        events: [{ kind: "values_rerolled" }, { kind: "sanctified" }],
        consumedOmens: [OMEN.sanctification],
      };
    }
    const reroll = (rolled: RolledMod): RolledMod => ({
      ...rollMod(data.mod(rolled.modId), rng),
      fractured: rolled.fractured,
    });
    return {
      item: {
        ...item,
        implicits: item.implicits.map(reroll),
        explicits: item.explicits.map(reroll),
      },
      events: [{ kind: "values_rerolled" }],
    };
  },
};

const vaal: CraftAction = {
  currencyId: "vaal",
  canApply: (_data, item) => usable(item),
  apply(data, item, rng) {
    const outcome = VAAL_OUTCOMES[pickWeighted(rng, VAAL_OUTCOMES.map((o) => o.weight))];
    const corrupted: Item = { ...item, corrupted: true };
    const events: CraftEvent[] = [{ kind: "corrupted" }];
    const noChange: CraftResult = {
      item: corrupted,
      events: [...events, { kind: "no_change" }],
    };

    switch (outcome.kind) {
      case "no_change":
        return noChange;
      case "chaos": {
        // Chaos-Orb-like effect applied 1-3 times.
        if (corrupted.rarity !== "rare") return noChange;
        let current = corrupted;
        const chaosEvents: CraftEvent[] = [];
        const times = rollInt(rng, VAAL_CHAOS_TIMES.min, VAAL_CHAOS_TIMES.max);
        for (let i = 0; i < times; i++) {
          const removable = nonFractured(current);
          if (removable.length === 0) break;
          const target = removable[rollInt(rng, 0, removable.length - 1)];
          const removed = withoutMod(current, target);
          if (rollablePool(data, removed, {}).length === 0) break;
          const added = addRandomMod(data, removed, rng, {});
          current = added.item;
          chaosEvents.push({ kind: "removed", mod: target }, added.event);
        }
        if (chaosEvents.length === 0) return noChange;
        return { item: current, events: [...events, ...chaosEvents] };
      }
      case "enchant": {
        const tags = itemTags(data, corrupted);
        const pool = data.corruptedPool
          .map((mod) => ({ mod, weight: spawnWeight(mod, tags) }))
          .filter((e) => e.weight > 0);
        if (pool.length === 0) return noChange;
        const rolled = rollMod(pickFromPool(rng, pool), rng);
        return {
          item: { ...corrupted, implicits: [...corrupted.implicits, rolled] },
          events: [...events, { kind: "implicit_added", mod: rolled }],
        };
      }
      case "beyond_limits": {
        // 0.5: "multiplies each modifier based on the current value" —
        // values may exceed the normal roll range.
        if (corrupted.explicits.length + corrupted.implicits.length === 0) return noChange;
        const push = (rolled: RolledMod): RolledMod => {
          const factor = rollFloat(
            rng,
            VAAL_BEYOND_LIMITS_MULTIPLIER.min,
            VAAL_BEYOND_LIMITS_MULTIPLIER.max,
          );
          return { ...rolled, values: rolled.values.map((v) => Math.round(v * factor)) };
        };
        return {
          item: {
            ...corrupted,
            implicits: corrupted.implicits.map(push),
            explicits: corrupted.explicits.map(push),
          },
          events: [...events, { kind: "values_pushed" }],
        };
      }
    }
  },
};

const fracturing: CraftAction = {
  currencyId: "fracturing-orb",
  canApply: (_data, item) =>
    usable(item) ??
    (item.rarity !== "rare" ? "Requires a Rare item" : null) ??
    (item.explicits.length < FRACTURE_MIN_EXPLICITS
      ? `Requires at least ${FRACTURE_MIN_EXPLICITS} explicit modifiers`
      : null) ??
    (item.explicits.some((m) => m.fractured) ? "Item already has a fractured modifier" : null),
  apply(_data, item, rng) {
    const index = rollInt(rng, 0, item.explicits.length - 1);
    const fractured = { ...item.explicits[index], fractured: true };
    const explicits = item.explicits.map((m, i) => (i === index ? fractured : m));
    return { item: { ...item, explicits }, events: [{ kind: "fractured", mod: fractured }] };
  },
};

// --- Data-driven actions (essences, alloys, emotions, catalysts) -------------

/** Magic->Rare upgrade (Lesser/base/Greater) or rare swap (Perfect/corrupted). */
function essenceAction(currencyId: string, essence: Essence): CraftAction {
  const tier = essenceTier(essence.name);
  return {
    currencyId,
    canApply(data, item, omens = NO_OMENS) {
      const blocked = usable(item);
      if (blocked) return blocked;
      const modId = essence.mods[data.base(item.baseId).itemClass];
      if (!modId) return `Cannot be applied to ${data.base(item.baseId).itemClass}`;
      // TODO(0.5-verify): whether essence mods respect the item-level gate.
      if (data.mod(modId).ilvl > item.ilvl) {
        return `Item level too low (needs ${data.mod(modId).ilvl})`;
      }
      const conflict = groupConflict(data, item, modId);
      if (conflict) return conflict;
      if (tier === "upgrade") {
        return item.rarity !== "magic" ? "Requires a Magic item" : null;
      }
      if (item.rarity !== "rare") return "Requires a Rare item";
      return planRemoval(data, item, omens, "essence", requiredRemovalSide(data, item, modId))
        .blocked;
    },
    apply(data, item, rng, omens = NO_OMENS) {
      const modId = essence.mods[data.base(item.baseId).itemClass];
      if (tier === "upgrade") {
        const granted = grantMod(data, { ...item, rarity: "rare" }, rng, modId);
        return { item: granted.item, events: [{ kind: "rarity", to: "rare" }, granted.event] };
      }
      const plan = planRemoval(data, item, omens, "essence", requiredRemovalSide(data, item, modId));
      const target = pickRemoval(data, rng, plan);
      const granted = grantMod(data, withoutMod(item, target), rng, modId);
      return {
        item: granted.item,
        events: [{ kind: "removed", mod: target }, granted.event],
        consumedOmens: plan.consumed,
      };
    },
  };
}

/** Highest alloy mod tier the item's level allows. */
function alloyModId(data: EngineData, item: Item, spec: AlloySpec): string | undefined {
  const mods = spec[data.base(item.baseId).itemClass];
  if (!mods) return undefined;
  const allowed = mods.filter((id) => data.mod(id).ilvl <= item.ilvl);
  return allowed[allowed.length - 1];
}

/** Verisium Alloys: Perfect-essence mechanic with alloy-exclusive mods. */
function alloyAction(currencyId: string, spec: AlloySpec): CraftAction {
  return {
    currencyId,
    canApply(data, item, omens = NO_OMENS) {
      const blocked =
        usable(item) ?? (item.rarity !== "rare" ? "Requires a Rare item" : null);
      if (blocked) return blocked;
      const itemClass = data.base(item.baseId).itemClass;
      if (!spec[itemClass]) return `Cannot be applied to ${itemClass}`;
      const modId = alloyModId(data, item, spec);
      if (!modId) return `Item level too low (needs ${data.mod(spec[itemClass][0]).ilvl})`;
      return (
        groupConflict(data, item, modId) ??
        planRemoval(data, item, omens, "essence", requiredRemovalSide(data, item, modId)).blocked
      );
    },
    apply(data, item, rng, omens = NO_OMENS) {
      const modId = alloyModId(data, item, spec)!;
      const plan = planRemoval(data, item, omens, "essence", requiredRemovalSide(data, item, modId));
      const target = pickRemoval(data, rng, plan);
      const granted = grantMod(data, withoutMod(item, target), rng, modId);
      return {
        item: granted.item,
        events: [{ kind: "removed", mod: target }, granted.event],
        consumedOmens: plan.consumed,
      };
    },
  };
}

/** The emotion's craftable (generation, mod) options for this jewel. */
function emotionOptions(
  data: EngineData,
  emotion: DistilledEmotion,
  item: Item,
): { generation: Generation; modId: string }[] | string {
  const base = data.base(item.baseId);
  if (base.itemClass !== "Jewel") return "Can only be applied to Jewels";
  const timeLost = base.name.startsWith(TIME_LOST_PREFIX);
  if (emotion.radiusJewel && !timeLost) return "Can only be applied to Time-Lost Jewels";
  if (!emotion.radiusJewel && timeLost) return "Cannot be applied to Time-Lost Jewels";
  const key = timeLost ? base.name.slice(TIME_LOST_PREFIX.length) : base.name;
  const slots = emotion.mods[key] ?? {};
  const options: { generation: Generation; modId: string }[] = [];
  if (slots.Prefix) options.push({ generation: "prefix", modId: slots.Prefix });
  if (slots.Suffix) options.push({ generation: "suffix", modId: slots.Suffix });
  if (options.length === 0) return `Cannot be applied to ${base.name}`;
  // TODO(0.5-verify): whether emotion mods respect the item-level gate.
  const leveled = options.filter((o) => data.mod(o.modId).ilvl <= item.ilvl);
  if (leveled.length === 0) {
    return `Item level too low (needs ${Math.min(...options.map((o) => data.mod(o.modId).ilvl))})`;
  }
  return leveled;
}

/** Liquid Emotions on jewels: swap a random mod for the emotion's mod. */
function emotionAction(currencyId: string, emotion: DistilledEmotion): CraftAction {
  return {
    currencyId,
    canApply(data, item, omens = NO_OMENS) {
      const blocked =
        usable(item) ?? (item.rarity !== "rare" ? "Requires a Rare Jewel" : null);
      if (blocked) return blocked;
      const options = emotionOptions(data, emotion, item);
      if (typeof options === "string") return options;
      // Usable if any listed side works (Potent emotions offer both sides).
      const reasons = options.map(
        (o) =>
          groupConflict(data, item, o.modId) ??
          planRemoval(data, item, omens, "essence", requiredRemovalSide(data, item, o.modId))
            .blocked,
      );
      return reasons.every((r) => r !== null) ? reasons[0] : null;
    },
    apply(data, item, rng, omens = NO_OMENS) {
      const options = emotionOptions(data, emotion, item) as {
        generation: Generation;
        modId: string;
      }[];
      const valid = options.filter(
        (o) =>
          groupConflict(data, item, o.modId) === null &&
          planRemoval(data, item, omens, "essence", requiredRemovalSide(data, item, o.modId))
            .blocked === null,
      );
      const choice = valid[rollInt(rng, 0, valid.length - 1)];
      const plan = planRemoval(
        data,
        item,
        omens,
        "essence",
        requiredRemovalSide(data, item, choice.modId),
      );
      const target = pickRemoval(data, rng, plan);
      const granted = grantMod(data, withoutMod(item, target), rng, choice.modId);
      return {
        item: granted.item,
        events: [{ kind: "removed", mod: target }, granted.event],
        consumedOmens: plan.consumed,
      };
    },
  };
}

/** Catalysts: quality that boosts matching-tag modifier values. */
function catalystAction(currencyId: string, spec: CatalystSpec): CraftAction {
  return {
    currencyId,
    canApply(data, item) {
      const blocked = usable(item);
      if (blocked) return blocked;
      const itemClass = data.base(item.baseId).itemClass;
      if (!spec.itemClasses.includes(itemClass)) {
        return `Can only be applied to ${spec.itemClasses.join(", ")}s`;
      }
      if (item.quality?.catalystId === currencyId &&
          item.quality.percent >= maxQuality(data, item)) {
        return "Quality is already at maximum";
      }
      return null;
    },
    apply(data, item, _rng) {
      const perUse = catalystQualityPerUse(item.ilvl);
      const max = maxQuality(data, item);
      // A different catalyst type replaces existing quality from zero.
      const current = item.quality?.catalystId === currencyId ? item.quality.percent : 0;
      const quality: ItemQuality = {
        catalystId: currencyId,
        percent: Math.min(max, current + perUse),
      };
      return { item: { ...item, quality }, events: [{ kind: "quality", quality }] };
    },
  };
}

// --- Registry ------------------------------------------------------------------

export const ACTIONS: ReadonlyMap<string, CraftAction> = new Map(
  [
    transmutation("normal", "transmute"),
    transmutation("greater", "greater-orb-of-transmutation"),
    transmutation("perfect", "perfect-orb-of-transmutation"),
    augmentation("normal", "aug"),
    augmentation("greater", "greater-orb-of-augmentation"),
    augmentation("perfect", "perfect-orb-of-augmentation"),
    regal("normal", "regal"),
    regal("greater", "greater-regal-orb"),
    regal("perfect", "perfect-regal-orb"),
    exalted("normal", "exalted"),
    exalted("greater", "greater-exalted-orb"),
    exalted("perfect", "perfect-exalted-orb"),
    chaos("normal", "chaos"),
    chaos("greater", "greater-chaos-orb"),
    chaos("perfect", "perfect-chaos-orb"),
    alchemy,
    annulment,
    divine,
    vaal,
    fracturing,
  ].map((action) => [action.currencyId, action]),
);

/**
 * Resolve any usable currency id to its action: the static orb registry,
 * plus data-driven essences, emotions, catalysts, and alloys.
 */
export function actionFor(data: EngineData, currencyId: string): CraftAction | undefined {
  const staticAction = ACTIONS.get(currencyId);
  if (staticAction) return staticAction;
  const essence = data.essenceByCurrencyId.get(currencyId);
  if (essence) return essenceAction(currencyId, essence);
  const emotion = data.emotionByCurrencyId.get(currencyId);
  if (emotion) return emotionAction(currencyId, emotion);
  const catalyst = CATALYSTS.get(currencyId);
  if (catalyst) return catalystAction(currencyId, catalyst);
  const alloy = ALLOYS.get(currencyId);
  if (alloy) return alloyAction(currencyId, alloy);
  return undefined;
}
