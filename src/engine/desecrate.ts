/**
 * Desecration: abyssal bones + the Well of Souls reveal (mechanics.ts BONES
 * documents the rules and sources). The interactive flow is two-phase —
 * `desecrationReveal` rolls the removal (if the item is full) and the three
 * offered modifiers; `commitDesecration` applies the player's pick. The
 * bone CraftAction in actions.ts auto-picks uniformly for simulation/odds;
 * the UI store runs the two phases so the player chooses.
 *
 * Desecrated mods ignore the usual item-level gate (see mechanics.ts: the
 * Gnawed bone caps the ITEM at level 64 while every equipment desecrated
 * mod requires level 65 — the reveal could never work otherwise).
 */
import type { Mod } from "../data/schema.ts";
import type { CraftEvent, Omens } from "./actions.ts";
import type { EngineData } from "./data.ts";
import {
  affixLimit,
  itemTags,
  openAffixSlots,
  rollMod,
  type Item,
  type RolledMod,
} from "./item.ts";
import { DESECRATION_CHOICES, LORD_OMENS, OMEN, type BoneSpec } from "./mechanics.ts";
import { spawnWeight, type PoolEntry } from "./modpool.ts";
import { pickWeighted, rollInt, type Rng } from "./rng.ts";

export interface DesecrationReveal {
  /** Mod removed to make room (item was full when the bone was applied). */
  removed?: RolledMod;
  /** The Well of Souls offer — up to DESECRATION_CHOICES distinct mods. */
  options: Mod[];
  /** Omens consumed by the desecration (lord + necromancy omens). */
  consumed: string[];
}

export function hasDesecratedMod(data: EngineData, item: Item): boolean {
  return item.explicits.some((m) => data.mod(m.modId).desecrated);
}

/** The necromancy omen side restriction, if exactly one is armed. */
function necromancySide(omens: Omens): "prefix" | "suffix" | "conflict" | undefined {
  const left = omens.has(OMEN.sinistralNecromancy);
  const right = omens.has(OMEN.dextralNecromancy);
  if (left && right) return "conflict";
  if (left) return "prefix";
  if (right) return "suffix";
  return undefined;
}

/** Armed lord omen -> lord filter (first one wins; arming two is blocked). */
function lordRestriction(omens: Omens): { lord?: string; omenId?: string; conflict: boolean } {
  const armed = [...LORD_OMENS.entries()].filter(([omenId]) => omens.has(omenId));
  if (armed.length > 1) return { conflict: true };
  const first = armed[0];
  return { lord: first?.[1], omenId: first?.[0], conflict: false };
}

/**
 * Desecrated mods that could be revealed on `item` right now. `groups` and
 * open sides are evaluated against the given item state — pass the item
 * AFTER any pre-removal. No item-level gate (see module header).
 */
export function desecrationPool(
  data: EngineData,
  item: Item,
  spec: BoneSpec,
  omens: Omens,
): PoolEntry[] {
  const tags = itemTags(data, item);
  const groups = new Set(
    item.explicits.flatMap((m) => data.mod(m.modId).groups),
  );
  const open = openAffixSlots(data, item);
  const side = necromancySide(omens);
  const { lord } = lordRestriction(omens);

  const entries: PoolEntry[] = [];
  for (const mod of data.desecratedPool) {
    if (mod.generation === "prefix" ? open.prefix <= 0 : open.suffix <= 0) continue;
    if (side !== undefined && side !== "conflict" && mod.generation !== side) continue;
    if (lord && mod.lord !== lord) continue;
    if (spec.minModLevel !== undefined && mod.ilvl < spec.minModLevel) continue;
    if (mod.groups.some((g) => groups.has(g))) continue;
    const weight = spawnWeight(mod, tags);
    if (weight <= 0) continue;
    entries.push({ mod, weight });
  }
  return entries;
}

/** The item state the reveal pool is computed against (after pre-removal). */
function preRemoval(
  data: EngineData,
  item: Item,
  omens: Omens,
  rng?: Rng,
): { target?: RolledMod; candidates: RolledMod[] } {
  const open = openAffixSlots(data, item);
  if (open.prefix > 0 || open.suffix > 0) return { candidates: [] };
  // Full item: "the Bone will remove a random modifier and then add a
  // Desecrated Prefix or Suffix". With a necromancy omen the added mod's
  // side is fixed — mirror the verified essence rule and free a slot there.
  // TODO(0.5-verify): removal side under necromancy omens.
  const side = necromancySide(omens);
  let candidates = item.explicits.filter((m) => !m.fractured);
  if (side === "prefix" || side === "suffix") {
    candidates = candidates.filter((m) => data.mod(m.modId).generation === side);
  }
  const target =
    rng && candidates.length > 0
      ? candidates[rollInt(rng, 0, candidates.length - 1)]
      : undefined;
  return { target, candidates };
}

/** Removal candidates when the item is full (for the odds panel). */
export function desecrationRemovalCandidates(
  data: EngineData,
  item: Item,
  omens: Omens,
): RolledMod[] {
  return preRemoval(data, item, omens).candidates;
}

const withoutRolled = (item: Item, target: RolledMod): Item => ({
  ...item,
  explicits: item.explicits.filter((m) => m !== target),
});

/** Reason this bone can't desecrate the item right now, or null. */
export function canDesecrate(
  data: EngineData,
  item: Item,
  spec: BoneSpec,
  omens: Omens,
): string | null {
  if (item.corrupted) return "Corrupted items cannot be modified";
  if (item.sanctified) return "Sanctified items cannot be modified";
  if (item.rarity !== "rare") return "Requires a Rare item";
  const itemClass = data.base(item.baseId).itemClass;
  if (!spec.itemClasses.includes(itemClass)) {
    return `Cannot be applied to ${itemClass}`;
  }
  if (spec.maxItemLevel !== undefined && item.ilvl > spec.maxItemLevel) {
    return `Gnawed bones only desecrate items of level ${spec.maxItemLevel} or lower`;
  }
  if (hasDesecratedMod(data, item)) {
    return "Item already has a Desecrated modifier";
  }
  if (necromancySide(omens) === "conflict") {
    return "Conflicting Sinistral and Dextral omens are active";
  }
  if (lordRestriction(omens).conflict) return "Conflicting abyssal lord omens are active";
  const removal = preRemoval(data, item, omens);
  const open = openAffixSlots(data, item);
  if (open.prefix <= 0 && open.suffix <= 0 && removal.candidates.length === 0) {
    return "No removable modifiers";
  }
  // Necromancy with the forced side full (item not full) can't make room.
  const side = necromancySide(omens);
  if (
    (side === "prefix" || side === "suffix") &&
    open[side] <= 0 &&
    (open.prefix > 0 || open.suffix > 0)
  ) {
    return `Item has no open ${side} slots`;
  }
  const after = removal.candidates.length > 0
    ? withoutRolled(item, removal.candidates[0])
    : item;
  if (desecrationPool(data, after, spec, omens).length === 0) {
    return "No Desecrated modifiers can appear on this item";
  }
  return null;
}

/** Weighted draw of up to `count` DISTINCT mods (without replacement). */
function drawOptions(rng: Rng, pool: PoolEntry[], count: number): Mod[] {
  const remaining = [...pool];
  const options: Mod[] = [];
  while (options.length < count && remaining.length > 0) {
    const index = pickWeighted(rng, remaining.map((e) => e.weight));
    options.push(remaining[index].mod);
    remaining.splice(index, 1);
  }
  return options;
}

/** Phase 1: pre-removal (if full) + the Well of Souls offer. */
export function desecrationReveal(
  data: EngineData,
  item: Item,
  rng: Rng,
  spec: BoneSpec,
  omens: Omens,
): DesecrationReveal {
  const consumed: string[] = [];
  const side = necromancySide(omens);
  if (side === "prefix") consumed.push(OMEN.sinistralNecromancy);
  if (side === "suffix") consumed.push(OMEN.dextralNecromancy);
  const { omenId } = lordRestriction(omens);
  if (omenId) consumed.push(omenId);

  const removed = preRemoval(data, item, omens, rng).target;
  const after = removed ? withoutRolled(item, removed) : item;
  const options = drawOptions(
    rng,
    desecrationPool(data, after, spec, omens),
    DESECRATION_CHOICES,
  );
  return { removed, options, consumed };
}

/** Re-offer three modifiers (Omen of Abyssal Echoes). Removal stands. */
export function rerollReveal(
  data: EngineData,
  item: Item,
  rng: Rng,
  spec: BoneSpec,
  omens: Omens,
  reveal: DesecrationReveal,
): DesecrationReveal {
  const after = reveal.removed ? withoutRolled(item, reveal.removed) : item;
  const options = drawOptions(
    rng,
    desecrationPool(data, after, spec, omens),
    DESECRATION_CHOICES,
  );
  return { ...reveal, options, consumed: [...reveal.consumed, OMEN.abyssalEchoes] };
}

/** Phase 2: apply the chosen modifier. */
export function commitDesecration(
  _data: EngineData,
  item: Item,
  reveal: DesecrationReveal,
  choice: number,
  rng: Rng,
): { item: Item; events: CraftEvent[]; consumedOmens: string[] } {
  const mod = reveal.options[choice];
  const base = reveal.removed ? withoutRolled(item, reveal.removed) : item;
  const rolled = rollMod(mod, rng);
  const events: CraftEvent[] = [];
  if (reveal.removed) events.push({ kind: "removed", mod: reveal.removed });
  events.push({ kind: "added", mod: rolled });
  return {
    item: { ...base, explicits: [...base.explicits, rolled] },
    events,
    consumedOmens: reveal.consumed,
  };
}

/**
 * Omen of Putrefaction: "replaces all modifiers with six Desecrated
 * modifiers and corrupts the item" — no reveal choice. Sides fill to the
 * item's affix limit; groups stay exclusive. TODO(0.5-verify): fractured
 * mods are assumed to be replaced like the rest.
 */
export function putrefy(
  data: EngineData,
  item: Item,
  rng: Rng,
  spec: BoneSpec,
  omens: Omens,
): { item: Item; events: CraftEvent[]; consumedOmens: string[] } {
  const events: CraftEvent[] = [];
  for (const mod of item.explicits) events.push({ kind: "removed", mod });
  let current: Item = { ...item, explicits: [] };
  const limit = affixLimit(data, current);
  const poolOmens: Omens = new Set(
    [...omens].filter(
      (o) => o !== OMEN.sinistralNecromancy && o !== OMEN.dextralNecromancy,
    ),
  );
  for (let i = 0; i < 2 * limit; i++) {
    const pool = desecrationPool(data, current, spec, poolOmens);
    if (pool.length === 0) break;
    const rolled = rollMod(pool[pickWeighted(rng, pool.map((e) => e.weight))].mod, rng);
    current = { ...current, explicits: [...current.explicits, rolled] };
    events.push({ kind: "added", mod: rolled });
  }
  current = { ...current, corrupted: true };
  events.push({ kind: "corrupted" });
  const consumed: string[] = [OMEN.putrefaction];
  const { omenId } = lordRestriction(omens);
  if (omenId) consumed.push(omenId);
  return { item: current, events, consumedOmens: consumed };
}
