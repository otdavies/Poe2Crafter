/**
 * Rune socketing (0.5 "Runes of Aldur"): Artificer's Orbs add sockets,
 * runes fill them with fixed per-host-class effects. Socketing into an
 * occupied socket destroys the old rune. Rules + sources in mechanics.ts
 * next to SOCKET_MAX.
 */
import type { Rune, RuneEffect } from "../data/schema.ts";
import type { EngineData } from "./data.ts";
import type { Item } from "./item.ts";
import { RUNE_TIERS, SOCKET_MAX } from "./mechanics.ts";

const locked = (item: Item): string | null =>
  item.corrupted
    ? "Corrupted items cannot be modified"
    : item.sanctified
      ? "Sanctified items cannot be modified"
      : null;

export function maxSockets(data: EngineData, item: Item): number {
  return SOCKET_MAX.get(data.base(item.baseId).itemClass) ?? 0;
}

/** The effect variant a rune grants on this item's class, if compatible. */
export function runeEffectFor(
  data: EngineData,
  item: Item,
  rune: Rune,
): RuneEffect | undefined {
  const itemClass = data.base(item.baseId).itemClass;
  return rune.effects.find((e) => e.itemClasses.includes(itemClass));
}

/**
 * A handful of runes carry a `dummy_display_stat_rune_*` placeholder instead
 * of a real stat because their effect is a special mechanic the simulator has
 * no model for: elemental mod conversion (the Aldur breaths), socket
 * transformation (Cadigan's Epiphany → a jewel socket), or unique-consumption
 * (Aldur's Legacy). Their prose IS their effect. Rather than socketing them as
 * an inert no-op that would misrepresent the item (a Betrayal of Aldur that
 * left every fire mod untouched), the engine blocks them and surfaces the
 * description. Returns the effect prose when the rune is non-simulated, else
 * undefined. NOTE: the Masterwork Rune is also a dummy-stat rune but is
 * handled separately as a rune-upgrade action (see mechanics.MASTERWORK_RUNE).
 */
export function runeSpecialEffect(rune: Rune): string | undefined {
  const dummy =
    rune.effects.length > 0 &&
    rune.effects.every(
      (e) => e.stats.length > 0 && e.stats.every((s) => s.startsWith("dummy_display_stat_rune_")),
    );
  return dummy ? rune.effects[0].text.join(" ") : undefined;
}

/** Runes currently socketed (ignoring empty sockets). */
export function socketedRunes(data: EngineData, item: Item): Rune[] {
  return (item.sockets ?? [])
    .filter((id): id is string => id !== null)
    .map((id) => data.rune(id));
}

export function canAddSocket(data: EngineData, item: Item): string | null {
  const blocked = locked(item);
  if (blocked) return blocked;
  const max = maxSockets(data, item);
  if (max === 0) {
    return `${data.base(item.baseId).itemClass} items cannot have Rune Sockets`;
  }
  if ((item.sockets?.length ?? 0) >= max) {
    return "Item already has its maximum number of Rune Sockets";
  }
  return null;
}

export function addSocket(item: Item): Item {
  return { ...item, sockets: [...(item.sockets ?? []), null] };
}

/** The socket a rune lands in when none is chosen: first empty, else 0. */
export function defaultSocketIndex(item: Item): number {
  const empty = (item.sockets ?? []).indexOf(null);
  return empty === -1 ? 0 : empty;
}

export function canSocketRune(
  data: EngineData,
  item: Item,
  rune: Rune,
  index: number = defaultSocketIndex(item),
): string | null {
  const blocked = locked(item);
  if (blocked) return blocked;
  const special = runeSpecialEffect(rune);
  if (special) return `Not simulated: ${special}`;
  const sockets = item.sockets ?? [];
  if (sockets.length === 0) {
    return maxSockets(data, item) === 0
      ? `${data.base(item.baseId).itemClass} items cannot have Rune Sockets`
      : "Item has no Rune Sockets (use an Artificer's Orb)";
  }
  if (index < 0 || index >= sockets.length) return "No such socket";
  if (!runeEffectFor(data, item, rune)) {
    return `Cannot be socketed into ${data.base(item.baseId).itemClass} items`;
  }
  // Limits ignore the socket being overwritten — replacing the conflicting
  // rune itself is fine.
  const others = sockets.filter((id, i): id is string => i !== index && id !== null);
  if (rune.limit === "self" && others.includes(rune.id)) {
    return "Limited to 1 per item";
  }
  if (rune.limit === "ancient" && others.some((id) => data.rune(id).limit === "ancient")) {
    return "Limited to 1 Ancient rune per item";
  }
  if (
    rune.limit === "aldurs-legacy" &&
    others.some((id) => data.rune(id).limit === "aldurs-legacy")
  ) {
    return "Limited to 1 Aldur's Legacy rune per item";
  }
  return null;
}

/** Socket the rune; the displaced rune (if any) is destroyed. */
export function socketRune(
  item: Item,
  rune: Rune,
  index: number = defaultSocketIndex(item),
): { item: Item; index: number; replaced?: string } {
  const sockets = [...(item.sockets ?? [])];
  const replaced = sockets[index] ?? undefined;
  sockets[index] = rune.id;
  return { item: { ...item, sockets }, index, replaced };
}

// --- Masterwork Rune: upgrade a socketed rune one tier ----------------------

/** Split a rune name into its tier index (into RUNE_TIERS) and family name. */
function runeTier(name: string): { family: string; tier: number } {
  for (let i = 0; i < RUNE_TIERS.length; i++) {
    const prefix = RUNE_TIERS[i];
    if (prefix !== "" && name.startsWith(prefix)) {
      return { family: name.slice(prefix.length), tier: i };
    }
  }
  // No Lesser/Greater/Perfect prefix -> the base tier (RUNE_TIERS index of "").
  return { family: name, tier: RUNE_TIERS.indexOf("") };
}

/**
 * The id of the next tier up for a rune, or undefined when it is already at
 * its highest tier or belongs to a family with no higher tier in the bundle
 * (special/Ancient/Aldur's runes have no Lesser/Greater/Perfect variants).
 */
export function upgradedRuneId(data: EngineData, runeId: string): string | undefined {
  const rune = data.runeById.get(runeId);
  if (!rune) return undefined;
  const { family, tier } = runeTier(rune.name);
  const nextTier = tier + 1;
  if (nextTier >= RUNE_TIERS.length) return undefined;
  const nextName = RUNE_TIERS[nextTier] + family;
  for (const candidate of data.runeById.values()) {
    if (candidate.name === nextName) return candidate.id;
  }
  return undefined;
}

/** First socket holding a rune (Masterwork's default target), or -1. */
export function firstSocketedIndex(item: Item): number {
  return (item.sockets ?? []).findIndex((id) => id !== null);
}

/** Why the Masterwork Rune can't upgrade the socket right now, or null. */
export function canMasterwork(
  data: EngineData,
  item: Item,
  index: number = firstSocketedIndex(item),
): string | null {
  const blocked = locked(item);
  if (blocked) return blocked;
  const sockets = item.sockets ?? [];
  if (sockets.length === 0) {
    return maxSockets(data, item) === 0
      ? `${data.base(item.baseId).itemClass} items cannot have Rune Sockets`
      : "Item has no Rune Sockets (use an Artificer's Orb)";
  }
  if (index < 0) return "No socketed Rune to upgrade";
  if (index >= sockets.length) return "No such socket";
  const runeId = sockets[index];
  if (runeId === null) return "That socket is empty";
  if (!upgradedRuneId(data, runeId)) {
    return `${data.rune(runeId).name} is already at its highest tier`;
  }
  return null;
}

/** Upgrade the socketed rune one tier; the old rune is consumed in place. */
export function masterworkUpgrade(
  data: EngineData,
  item: Item,
  index: number = firstSocketedIndex(item),
): { item: Item; index: number; from: string; to: string } {
  const sockets = [...(item.sockets ?? [])];
  const from = sockets[index]!;
  const to = upgradedRuneId(data, from)!;
  sockets[index] = to;
  return { item: { ...item, sockets }, index, from, to };
}
