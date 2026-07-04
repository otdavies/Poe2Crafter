/**
 * Share links: the whole session (initial item + every step with its events)
 * compressed into the URL hash with lz-string. Steps store outcomes, so a
 * shared craft replays exactly without RNG state. Decoding validates every
 * referenced id against the loaded bundle — a stale or hand-edited link is
 * rejected rather than half-loaded.
 */
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import type { EngineData } from "../engine/data.ts";
import type { Item, RolledMod } from "../engine/item.ts";
import type { Session } from "./store.ts";

/** Bump when the Session shape changes incompatibly. */
const VERSION = 1;
const HASH_KEY = "c";

export function encodeSession(session: Session): string {
  return compressToEncodedURIComponent(JSON.stringify({ v: VERSION, session }));
}

/** The URL fragment for a session, e.g. "#c=NoIgLg...". */
export function sessionHash(session: Session): string {
  return `#${HASH_KEY}=${encodeSession(session)}`;
}

/** Extract the encoded session from a location hash, if present. */
export function encodedFromHash(hash: string): string | undefined {
  const match = /^#c=(.+)$/.exec(hash);
  return match?.[1];
}

function checkMods(data: EngineData, mods: unknown): void {
  if (!Array.isArray(mods)) throw new Error("mods not an array");
  for (const rolled of mods as RolledMod[]) {
    data.mod(rolled.modId); // throws on unknown ids
    if (!Array.isArray(rolled.values) || rolled.values.some((v) => typeof v !== "number")) {
      throw new Error(`bad values on ${rolled.modId}`);
    }
  }
}

function checkItem(data: EngineData, item: Item): void {
  data.base(item.baseId); // throws on unknown ids
  if (typeof item.ilvl !== "number") throw new Error("bad ilvl");
  if (!["normal", "magic", "rare"].includes(item.rarity)) throw new Error("bad rarity");
  checkMods(data, item.implicits);
  checkMods(data, item.explicits);
  if (item.sockets !== undefined) {
    if (!Array.isArray(item.sockets)) throw new Error("sockets not an array");
    for (const socket of item.sockets) {
      if (socket !== null) data.rune(socket); // throws on unknown ids
    }
  }
}

/**
 * Decode and validate an encoded session. Returns undefined for anything
 * malformed or referencing ids the current bundle doesn't know.
 */
export function decodeSession(data: EngineData, encoded: string): Session | undefined {
  try {
    const json = decompressFromEncodedURIComponent(encoded);
    if (!json) return undefined;
    const parsed = JSON.parse(json) as { v?: number; session?: Session };
    if (parsed.v !== VERSION || !parsed.session) return undefined;
    const session = parsed.session;
    checkItem(data, session.initial);
    if (!Array.isArray(session.steps)) return undefined;
    for (const step of session.steps) {
      if (typeof step.currencyId !== "string") return undefined;
      if (!Array.isArray(step.omens) || !Array.isArray(step.events)) return undefined;
      checkItem(data, step.after);
    }
    return session;
  } catch {
    return undefined;
  }
}
