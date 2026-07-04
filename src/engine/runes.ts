/**
 * Rune socketing (0.5 "Runes of Aldur"): Artificer's Orbs add sockets,
 * runes fill them with fixed per-host-class effects. Socketing into an
 * occupied socket destroys the old rune. Rules + sources in mechanics.ts
 * next to SOCKET_MAX.
 */
import type { Rune, RuneEffect } from "../data/schema.ts";
import type { EngineData } from "./data.ts";
import type { Item } from "./item.ts";
import { SOCKET_MAX } from "./mechanics.ts";

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
