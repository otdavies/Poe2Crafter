/**
 * Crafting actions: the basic currency orbs. Each action validates
 * preconditions (canApply) and returns a new item plus the events that
 * happened — the events feed the step log, share links, and tutorial view.
 */
import type { EngineData } from "./data.ts";
import {
  affixLimit,
  itemTags,
  openAffixSlots,
  rollMod,
  type Item,
  type Rarity,
  type RolledMod,
} from "./item.ts";
import { ALCHEMY_MOD_COUNT, MIN_MOD_LEVEL, VAAL_OUTCOMES, type CurrencyTier } from "./mechanics.ts";
import { pickFromPool, rollablePool, spawnWeight, type PoolFilter } from "./modpool.ts";
import { pickWeighted, rollInt, type Rng } from "./rng.ts";

export type CraftEvent =
  | { kind: "rarity"; to: Rarity }
  | { kind: "added"; mod: RolledMod }
  | { kind: "removed"; mod: RolledMod }
  | { kind: "implicit_added"; mod: RolledMod }
  | { kind: "values_rerolled" }
  | { kind: "corrupted" }
  | { kind: "no_change" };

export interface CraftResult {
  item: Item;
  events: CraftEvent[];
}

export interface CraftAction {
  /** trade API currency id, e.g. "chaos" — the key the UI dispatches on. */
  currencyId: string;
  /** Reason the action can't be used right now, or null if it can. */
  canApply(data: EngineData, item: Item): string | null;
  apply(data: EngineData, item: Item, rng: Rng): CraftResult;
}

const usable = (item: Item): string | null =>
  item.corrupted ? "Corrupted items cannot be modified" : null;

/** Add one random mod from the current pool; assumes canApply passed. */
function addRandomMod(
  data: EngineData,
  item: Item,
  rng: Rng,
  filter: PoolFilter,
): { item: Item; event: CraftEvent } {
  const mod = pickFromPool(rng, rollablePool(data, item, filter));
  const rolled = rollMod(mod, rng);
  return {
    item: { ...item, explicits: [...item.explicits, rolled] },
    event: { kind: "added", mod: rolled },
  };
}

function removeRandomMod(item: Item, rng: Rng, removable: RolledMod[]): {
  item: Item;
  event: CraftEvent;
} {
  const target = removable[rollInt(rng, 0, removable.length - 1)];
  return {
    item: { ...item, explicits: item.explicits.filter((m) => m !== target) },
    event: { kind: "removed", mod: target },
  };
}

const nonFractured = (item: Item): RolledMod[] =>
  item.explicits.filter((m) => !m.fractured);

/** Pool must be able to yield a mod, else the orb can't be used. */
function requirePool(data: EngineData, item: Item, filter: PoolFilter): string | null {
  return rollablePool(data, item, filter).length === 0
    ? "No modifiers can roll on this item"
    : null;
}

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
      (item.explicits.length >= 2 * affixLimit("magic") ? "Item is full" : null) ??
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
    canApply: (_data, item) =>
      usable(item) ?? (item.rarity !== "magic" ? "Requires a Magic item" : null),
    apply(data, item, rng) {
      const rare: Item = { ...item, rarity: "rare" };
      const events: CraftEvent[] = [{ kind: "rarity", to: "rare" }];
      const pool = rollablePool(data, rare, { minModLevel: minModLevel || undefined });
      if (pool.length > 0) {
        const added = addRandomMod(data, rare, rng, { minModLevel: minModLevel || undefined });
        return { item: added.item, events: [...events, added.event] };
      }
      return { item: rare, events };
    },
  };
}

function exalted(tier: CurrencyTier, currencyId: string): CraftAction {
  const minModLevel = MIN_MOD_LEVEL[tier];
  return {
    currencyId,
    canApply: (data, item) => {
      const open = openAffixSlots(data, item);
      return (
        usable(item) ??
        (item.rarity !== "rare" ? "Requires a Rare item" : null) ??
        (open.prefix <= 0 && open.suffix <= 0 ? "Item has no open affix slots" : null) ??
        requirePool(data, item, { minModLevel: minModLevel || undefined })
      );
    },
    apply(data, item, rng) {
      const added = addRandomMod(data, item, rng, { minModLevel: minModLevel || undefined });
      return { item: added.item, events: [added.event] };
    },
  };
}

function chaos(tier: CurrencyTier, currencyId: string): CraftAction {
  const minModLevel = MIN_MOD_LEVEL[tier];
  return {
    currencyId,
    canApply: (_data, item) =>
      usable(item) ??
      (item.rarity !== "rare" ? "Requires a Rare item" : null) ??
      (nonFractured(item).length === 0 ? "No removable modifiers" : null),
    apply(data, item, rng) {
      const removed = removeRandomMod(item, rng, nonFractured(item));
      const added = addRandomMod(data, removed.item, rng, {
        minModLevel: minModLevel || undefined,
      });
      return { item: added.item, events: [removed.event, added.event] };
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
    for (let i = 0; i < ALCHEMY_MOD_COUNT; i++) {
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
  canApply: (_data, item) =>
    usable(item) ??
    (item.rarity === "normal" ? "Requires a Magic or Rare item" : null) ??
    (nonFractured(item).length === 0 ? "No removable modifiers" : null),
  apply(_data, item, rng) {
    const removed = removeRandomMod(item, rng, nonFractured(item));
    return { item: removed.item, events: [removed.event] };
  },
};

const divine: CraftAction = {
  currencyId: "divine",
  canApply: (_data, item) =>
    usable(item) ??
    (item.explicits.length + item.implicits.length === 0 ? "No modifiers to reroll" : null),
  apply(data, item, rng) {
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

    switch (outcome.kind) {
      case "no_change":
        return { item: corrupted, events: [...events, { kind: "no_change" }] };
      case "reroll_values": {
        const result = divine.apply(data, { ...corrupted, corrupted: false }, rng);
        return { item: { ...result.item, corrupted: true }, events: [...events, ...result.events] };
      }
      case "corrupt_implicit": {
        const tags = itemTags(data, corrupted);
        const pool = data.corruptedPool
          .map((mod) => ({ mod, weight: spawnWeight(mod, tags) }))
          .filter((e) => e.weight > 0);
        if (pool.length === 0) {
          return { item: corrupted, events: [...events, { kind: "no_change" }] };
        }
        const rolled = rollMod(pickFromPool(rng, pool), rng);
        return {
          item: { ...corrupted, implicits: [...corrupted.implicits, rolled] },
          events: [...events, { kind: "implicit_added", mod: rolled }],
        };
      }
      case "reroll_explicits": {
        const kept = corrupted.explicits.filter((m) => m.fractured);
        const target = corrupted.explicits.length;
        let current: Item = { ...corrupted, explicits: kept };
        const rerollEvents: CraftEvent[] = corrupted.explicits
          .filter((m) => !m.fractured)
          .map((mod) => ({ kind: "removed", mod }));
        while (current.explicits.length < target) {
          if (rollablePool(data, current, {}).length === 0) break;
          const added = addRandomMod(data, current, rng, {});
          current = added.item;
          rerollEvents.push(added.event);
        }
        return { item: current, events: [...events, ...rerollEvents] };
      }
    }
  },
};

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
  ].map((action) => [action.currencyId, action]),
);
